"""Build a Cloud Dive case file from lane samples and the forecast cube (pure; no network).

`tools/export_cloud_dive.py` does the I/O (GOES scene, IFS bundle, airports) and calls this module.
A `--simulated` case uses `simulated_inputs`, a deterministic synthetic world that is labelled
"Simulated" everywhere and never mixed with real data.
"""
from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Mapping, Sequence

import numpy as np

from src.analysis import evidence as ev
from src.analysis.case_io import SCHEMA_VERSION, game_block
from src.analysis.cost_model import Params
from src.analysis.game_core import Case, make_case
from src.analysis.lanes import Lanes
from src.analysis.solver import Reference, balance

STATE_NAMES = ("observed", "clear", "no_retrieval", "quality_rejected", "inconsistent_retrieval", "outside_domain")
BASE_METHODS = ("goes_cod_cps", "median", "night_thick", "regression", "cirrus", "deep_convection", "unavailable")
PHASE_NAMES = {0: "clear", 1: "liquid", 2: "supercooled liquid", 3: "mixed", 4: "ice", 5: "unknown"}
PROFILE_PHASE = {1: "liquid", 2: "liquid", 3: "unknown", 4: "ice", 5: "unknown"}  # viewer.js vocabulary


@dataclass(frozen=True)
class Manifest:
    id: str
    title: str
    origin: str
    destination: str
    satellite: str  # "G19" | "G18" | "simulated"
    observed_utc: datetime
    forecast_run: datetime | None
    alt_min_ft: int
    alt_max_ft: int
    alt_start_ft: int
    lanes_km: tuple = (-30.0, -15.0, 0.0, 15.0, 30.0)
    step_km: float = 10.0
    param_overrides: Mapping = field(default_factory=dict)  # camelCase Params keys
    note: str = ""

    @property
    def alts_ft(self) -> tuple:
        return tuple(range(self.alt_min_ft, self.alt_max_ft + 1, 1000))

    @property
    def start_lane(self) -> int:
        return self.lanes_km.index(0.0)

    @property
    def simulated(self) -> bool:
        return self.satellite == "simulated"


def load_manifest(d: Mapping) -> Manifest:
    def utc(text):
        return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(timezone.utc)

    run = d.get("forecastRun")
    m = Manifest(
        id=d["id"], title=d["title"], origin=d["from"], destination=d["to"], satellite=d["satellite"],
        observed_utc=utc(d["observedUtc"]),
        forecast_run=None if not run else datetime.strptime(run, "%Y%m%d%H").replace(tzinfo=timezone.utc),
        alt_min_ft=int(d["altitudes"]["minFt"]), alt_max_ft=int(d["altitudes"]["maxFt"]),
        alt_start_ft=int(d["altitudes"]["startFt"]),
        lanes_km=tuple(float(v) for v in d.get("lanesKm", (-30, -15, 0, 15, 30))),
        step_km=float(d.get("stepKm", 10.0)), param_overrides=dict(d.get("params", {})), note=d.get("note", ""),
    )
    if m.alt_start_ft not in m.alts_ft or 0.0 not in m.lanes_km:
        raise ValueError("start altitude must be a block level and the lanes must include 0 km")
    if m.alt_min_ft % 1000 or m.alt_max_ft % 1000 or m.alt_start_ft % 1000:
        raise ValueError("altitudes must be multiples of 1,000 ft")
    return m


# ---------------------------------------------------------------------------------------------
# Evidence grid
# ---------------------------------------------------------------------------------------------

@dataclass
class Grid:
    evidence: np.ndarray  # uint8 [lane][step][alt]
    headwind_kt: np.ndarray
    temp_c: np.ndarray  # NaN where the forecast is missing
    lwp: np.ndarray  # [lane][step], NaN where unknown
    reasons: dict
    headwind_missing: int


def evaluate_grid(sat, forecast_cells, headwind, isotherms, alts_ft: Sequence[int]) -> Grid:
    """Evidence level of every cell with `evidence.evaluate_cell` (no other logic here).

    sat[lane][step]            satellite record dicts
    forecast_cells[lane][step][alt]   {temp_c, rh_pct} | None
    headwind[lane][step][alt]  knots | None
    isotherms[lane][step]      {zero_c_ft, minus20_c_ft}
    """
    L, S, A = len(sat), len(sat[0]), len(alts_ft)
    evidence = np.zeros((L, S, A), dtype=np.uint8)
    hw = np.zeros((L, S, A))
    temp = np.full((L, S, A), np.nan)
    lwp = np.full((L, S), np.nan)
    reasons: dict = {}
    missing = 0
    for i in range(L):
        for k in range(S):
            rec = sat[i][k]
            if rec.get("state") == "observed" and rec.get("lwp_gm2") is not None:
                lwp[i, k] = rec["lwp_gm2"]
            for a, alt in enumerate(alts_ft):
                fc = forecast_cells[i][k][a]
                out = ev.evaluate_cell(rec, fc, alt, isotherms[i][k])
                evidence[i, k, a] = ev.LEVEL_CODE[out.level]
                reasons[out.reason] = reasons.get(out.reason, 0) + 1
                if fc is not None:
                    temp[i, k, a] = fc["temp_c"]
                w = headwind[i][k][a]
                if w is None:
                    missing += 1
                else:
                    hw[i, k, a] = w
    return Grid(evidence, np.rint(hw), temp, lwp, reasons, missing)


def make_game_case(manifest: Manifest, lanes: Lanes, grid: Grid, params: Params) -> Case:
    return make_case(
        step_km=lanes.step_km, distance_km=lanes.distance_km, lanes_km=lanes.lanes_km, alts_ft=manifest.alts_ft,
        evidence=grid.evidence, headwind_kt=grid.headwind_kt, temp_c=grid.temp_c, lwp=grid.lwp, params=params,
        start_lane=manifest.start_lane, start_alt=manifest.alts_ft.index(manifest.alt_start_ft),
    )


# ---------------------------------------------------------------------------------------------
# Case file
# ---------------------------------------------------------------------------------------------

def _round(v, n=0):
    return None if v is None or not math.isfinite(v) else (int(round(v)) if n == 0 else round(float(v), n))


def satellite_block(sat) -> dict:
    """Columnar satellite records (flat, lane-major) for the cross-section display."""
    flat = [r for lane in sat for r in lane]
    shape = [len(sat), len(sat[0])]
    return {
        "shape": shape, "stateNames": list(STATE_NAMES), "baseMethodNames": list(BASE_METHODS),
        "state": [STATE_NAMES.index(r["state"]) for r in flat],
        "topFt": [_round(r["top_ft"]) for r in flat],
        "baseFt": [_round(r["base_ft"]) for r in flat],
        "phaseCode": [r["phase_code"] for r in flat],
        "supercooled": [None if r["supercooled"] is None else int(r["supercooled"]) for r in flat],
        "baseMethod": [None if r["base_method"] is None else BASE_METHODS.index(r["base_method"]) for r in flat],
        "cloudWaterQuality": [r["cloud_water_quality"] for r in flat],
        "parallaxKm": [r["parallax_km"] for r in flat],
    }


def viewer_profile(manifest: Manifest, lanes: Lanes, sat, title_suffix: str = "") -> dict:
    """Centre-lane profile in the unchanged viewer.js contract."""
    centre = manifest.start_lane
    samples = []
    for k in range(lanes.n_steps + 1):
        r = sat[centre][k]
        top = r["top_ft"] if r["state"] == "observed" else None
        base = None if top is None or r["base_ft"] is None else min(r["base_ft"], top)
        samples.append({
            "distanceKm": round(lanes.along_km(k), 3),
            "topFt": _round(top), "baseFt": _round(base),
            "phase": None if top is None else PROFILE_PHASE.get(r["phase_code"]),
            "supercooled": None if top is None else r["supercooled"],
        })
    return {
        "title": manifest.title + title_suffix,
        "source": "Simulated test world" if manifest.simulated else f"GOES-R ABI L2 CONUS ({manifest.satellite})",
        "dataKind": "simulated" if manifest.simulated else "observation",
        "observedAt": manifest.observed_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "samples": samples,
    }


def reference_block(ref: Reference) -> dict:
    d = ref.to_dict()
    d.pop("name")
    return d


def assemble_case_file(
    manifest: Manifest, lanes: Lanes, case: Case, grid: Grid, sat, cube, refs: Mapping[str, Reference],
    flags: Mapping, sources: Mapping, airports: Mapping,
) -> dict:
    block = game_block(case, grid.temp_c, grid.lwp)
    route_summary = ev.route_summary(
        [ev.LEVELS[int(c)] for c in grid.evidence[manifest.start_lane, : lanes.n_steps, case.start_alt]],
        lanes.step_km, total_km=lanes.distance_km,
    )
    simulated = manifest.simulated
    out = {
        "schemaVersion": SCHEMA_VERSION, "id": manifest.id,
        "title": ("Simulated: " if simulated else "") + manifest.title,
        "dataKind": "simulated" if simulated else "observation",
        "observedAtUtc": manifest.observed_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "route": {
            "from": manifest.origin, "to": manifest.destination,
            "fromName": airports.get(manifest.origin, {}).get("name"), "toName": airports.get(manifest.destination, {}).get("name"),
            "lengthKm": round(lanes.distance_km, 1), "note": "Lanes and corridor are illustrative, not airways.",
        },
        "sources": dict(sources),
        "rule": ev.rule_metadata(),
        **block,
        "lanesLatLon": {"shape": [lanes.n_lanes, lanes.n_steps + 1, 2],
                        "data": [[round(float(lanes.lat[i][k]), 4), round(float(lanes.lon[i][k]), 4)]
                                 for i in range(lanes.n_lanes) for k in range(lanes.n_steps + 1)]},
        "satellite": satellite_block(sat),
        "isotherms": {
            "shape": [lanes.n_lanes, lanes.n_steps + 1],
            "zeroCFt": [_round(cube.isotherms[i][k]["zero_c_ft"]) for i in range(lanes.n_lanes) for k in range(lanes.n_steps + 1)],
            "minus20CFt": [_round(cube.isotherms[i][k]["minus20_c_ft"]) for i in range(lanes.n_lanes) for k in range(lanes.n_steps + 1)],
            "methods": sorted({cube.isotherms[i][k]["method"] for i in range(lanes.n_lanes) for k in range(lanes.n_steps + 1)}),
        },
        "evidenceReasons": dict(sorted(grid.reasons.items())),
        "routeSummaryStartAltitude": {name: {"km": round(v["km"], 3), "segments": [[round(a, 3), round(b, 3)] for a, b in v["segments"]]}
                                      for name, v in route_summary.items()},
        "headwindMissingCells": grid.headwind_missing,
        "references": {name: reference_block(r) for name, r in refs.items()},
        "balance": dict(flags),
        "viewerProfile": viewer_profile(manifest, lanes, sat),
        "labels": {
            "gameModel": "Game model: the ice index, dollar costs and parameters are illustrative game values, not weather statements.",
            "references": "Best, Straight-ahead and Wasteful extreme are game references, not procedures.",
        },
        "notes": manifest.note,
    }
    return out


# ---------------------------------------------------------------------------------------------
# Output checks
# ---------------------------------------------------------------------------------------------

_LEAKS = [
    (re.compile(r"\b[A-Za-z]:\\"), "Windows path"),
    (re.compile(r"(?<![A-Za-z])[A-Za-z]:/(?!/)"), "drive path"),
    (re.compile(r"/Users/|/home/|\\Users\\"), "home path"),
    (re.compile(r"KMA_API_KEY|AWS_SECRET|AKIA[0-9A-Z]{16}|-----BEGIN|(?i:api[_-]?key\s*[:=])|(?i:bearer\s+[a-z0-9])"), "secret"),
    (re.compile(r"\.env\b"), ".env reference"),
]


def leak_findings(text: str) -> list[str]:
    return [f"{label}: {m.group(0)!r}" for pattern, label in _LEAKS for m in [pattern.search(text)] if m]


def dumps_strict(case_file: Mapping) -> str:
    """JSON text of the case; raises ValueError on NaN or infinity, absolute paths or secrets."""
    text = json.dumps(case_file, allow_nan=False, separators=(",", ":"), ensure_ascii=False)
    findings = leak_findings(text)
    if findings:
        raise ValueError("case file would leak: " + "; ".join(findings))
    return text


def refusal_reasons(flags: Mapping, refs: Mapping[str, Reference]) -> list[str]:
    reasons = [f"{k} failed" for k in ("B1", "B2", "B3", "B5") if not flags.get(k)]
    if not refs["best"].completed:
        reasons.append("Best does not complete")
    return reasons


# ---------------------------------------------------------------------------------------------
# Simulated world (deterministic, no data, no network)
# ---------------------------------------------------------------------------------------------

class _SimCube:
    def __init__(self, forecast, headwind, isotherms):
        self.forecast, self.headwind_kt, self.isotherms = forecast, headwind, isotherms


def simulated_inputs(manifest: Manifest, lanes: Lanes):
    """Satellite records, forecast cube and isotherms of a deterministic synthetic world."""
    alts = manifest.alts_ft
    sat, fc, hw, iso = [], [], [], []
    for i, off in enumerate(lanes.lanes_km):
        s_lane, f_lane, h_lane, i_lane = [], [], [], []
        for k in range(lanes.n_steps + 1):
            x = lanes.along_km(k)
            deck = math.sin(x / 140.0 + off / 60.0) + 0.6 * math.sin(x / 55.0 - off / 25.0)
            top = 17000 + 4000 * math.sin(x / 220.0 + off / 90.0)
            if deck > 0.55:
                supercooled = math.sin(x / 90.0 + 1.0) > -0.3
                s_lane.append({
                    "state": "observed", "top_ft": round(top), "base_ft": round(top - 5500 - 800 * math.sin(x / 70.0)),
                    "supercooled": supercooled, "phase_code": 2 if supercooled else 4, "base_method": "goes_cod_cps",
                    "cloud_water_quality": "good", "cloud_water_nonconverged": False, "parallax_km": 6.0,
                    "lwp_gm2": round(70 + 50 * math.sin(x / 40.0), 1) if supercooled else None,
                })
            elif deck < -1.3:
                s_lane.append({"state": "quality_rejected", "top_ft": None, "base_ft": None, "supercooled": None,
                               "phase_code": None, "base_method": None, "cloud_water_quality": None,
                               "cloud_water_nonconverged": None, "parallax_km": None, "lwp_gm2": None})
            else:
                s_lane.append({"state": "clear", "top_ft": None, "base_ft": None, "supercooled": None,
                               "phase_code": 0, "base_method": None, "cloud_water_quality": None,
                               "cloud_water_nonconverged": None, "parallax_km": None, "lwp_gm2": None})
            f_row, h_row = [], []
            for alt in alts:
                t = 12.0 - 1.98 * alt / 1000.0
                rh = 55.0 + 40.0 * max(0.0, deck) + (8.0 if 12000 <= alt <= 20000 else 0.0)
                f_row.append({"temp_c": round(t, 2), "rh_pct": round(min(100.0, rh), 1)})
                h_row.append(round(22 + 12 * math.sin(x / 300.0) + alt / 1000.0 - off * 0.1))
            f_lane.append(f_row)
            h_lane.append(h_row)
            i_lane.append({"zero_c_ft": 6060.0, "minus20_c_ft": 16160.0, "method": "simulated_lapse"})
        sat.append(s_lane)
        fc.append(f_lane)
        hw.append(h_lane)
        iso.append(i_lane)
    return sat, _SimCube(fc, hw, iso)
