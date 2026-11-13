"""ECMWF IFS forecast cube for Cloud Dive: values at (lane, step, altitude).

Altitude (ft MSL) is converted to pressure with the International Standard Atmosphere, so the
cube is a screening background, not a statement about the true pressure altitude. Values are
sampled with `ifs_grid.sample` (bilinear in space, linear in time, linear in log-pressure).
A missing value stays None; nothing is filled in. Pure and deterministic: no network, no clock.

Per cell:  forecast = {temp_c, rh_pct} (for `evidence.forecast_criterion`) and headwind_kt
(positive when the wind is against the flight). Per (lane, step): isotherm heights from the
temperature profile at the bundle's pressure levels (for `evidence.isotherm_heights_from_profile`).
"""
from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime

from src.analysis.evidence import isotherm_heights_from_profile
from src.analysis.lanes import Lanes
from src.integration.ifs_grid import sample

KELVIN = 273.15
MS_TO_KT = 1.0 / 0.514444
FT_PER_M = 3.28084

_P0_HPA = 1013.25
_T0_K = 288.15
_LAPSE_K_PER_M = 0.0065
_TROPOPAUSE_M = 11000.0
_P_TROPOPAUSE_HPA = 226.3206
_G_OVER_RL = 5.255877  # g / (R * lapse)
_G_OVER_RT = 1.577e-4  # g / (R * T) in 1/m, isothermal layer at 216.65 K


def isa_pressure_hpa(alt_ft: float) -> float:
    """ISA pressure at a geopotential altitude in feet (valid to 65,617 ft)."""
    h = alt_ft / FT_PER_M
    if h <= _TROPOPAUSE_M:
        return _P0_HPA * (1.0 - _LAPSE_K_PER_M * h / _T0_K) ** _G_OVER_RL
    return _P_TROPOPAUSE_HPA * math.exp(-_G_OVER_RT * (h - _TROPOPAUSE_M))


def headwind_kt(u_ms: float | None, v_ms: float | None, azimuth_deg: float) -> float | None:
    """Wind component against the flight in knots; u east, v north (m/s), azimuth of travel."""
    if u_ms is None or v_ms is None:
        return None
    az = math.radians(azimuth_deg)
    return round(-(u_ms * math.sin(az) + v_ms * math.cos(az)) * MS_TO_KT, 1)


def sample_cell(bundle, lat: float, lon: float, alt_ft: float, azimuth_deg: float, at: datetime):
    """(status, cell) for one point; cell is {forecast, headwind_kt} or None with a reason status."""
    status, v = sample(bundle, lat, lon, isa_pressure_hpa(alt_ft), at)
    if status != "ready":
        return status, None
    t, r = v["t"], v["r"]
    forecast = None if t is None or r is None else {"temp_c": round(t - KELVIN, 2), "rh_pct": round(r, 1)}
    return "ready", {"forecast": forecast, "headwind_kt": headwind_kt(v["u"], v["v"], azimuth_deg)}


def temperature_profile(bundle, lat: float, lon: float, at: datetime):
    """[(height_ft, temp_c)] at the bundle's pressure levels (geopotential height from `gh`)."""
    points = []
    for level in bundle[0]["pressure_levels_hpa"]:
        status, v = sample(bundle, lat, lon, float(level), at)
        if status == "ready" and v["gh"] is not None and v["t"] is not None:
            points.append((v["gh"] * FT_PER_M, v["t"] - KELVIN))
    return points


@dataclass
class IfsCube:
    alts_ft: tuple[int, ...]
    forecast: list  # [lane][step][alt] -> {"temp_c","rh_pct"} | None
    headwind_kt: list  # [lane][step][alt] -> float | None
    isotherms: list  # [lane][step] -> {"zero_c_ft","minus20_c_ft","method"}
    reasons: Counter = field(default_factory=Counter)  # status of every unavailable sample

    def n_unavailable(self) -> int:
        return sum(self.reasons.values())


def build_cube(bundle, lanes: Lanes, alts_ft, at: datetime) -> IfsCube:
    """Forecast cube for all lane points and altitudes at validity time `at` (timezone-aware)."""
    if at.tzinfo is None:
        raise ValueError("`at` must be timezone-aware (UTC)")
    alts = tuple(int(a) for a in alts_ft)
    reasons: Counter = Counter()
    forecast, wind, iso = [], [], []
    for i in range(lanes.n_lanes):
        f_lane, w_lane, i_lane = [], [], []
        for k in range(lanes.n_steps + 1):
            lat, lon, az = float(lanes.lat[i][k]), float(lanes.lon[i][k]), float(lanes.azimuth_deg[k])
            f_row, w_row = [], []
            for alt in alts:
                status, cell = sample_cell(bundle, lat, lon, alt, az, at)
                if cell is None:
                    reasons[status] += 1
                    f_row.append(None)
                    w_row.append(None)
                else:
                    if cell["forecast"] is None:
                        reasons["missing_value"] += 1
                    f_row.append(cell["forecast"])
                    w_row.append(cell["headwind_kt"])
            f_lane.append(f_row)
            w_lane.append(w_row)
            i_lane.append(isotherm_heights_from_profile(temperature_profile(bundle, lat, lon, at)))
        forecast.append(f_lane)
        wind.append(w_lane)
        iso.append(i_lane)
    return IfsCube(alts, forecast, wind, iso, reasons)
