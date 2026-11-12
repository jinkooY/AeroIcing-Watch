"""Build viewer profiles from multi-source projected satellite evidence.

Supports GK-2A (KO), GOES-16, GOES-18, and Meteosat MSG globally.
Source selection is handled by satellite_router.py.
"""

from collections import Counter
from datetime import datetime, timezone
from math import isfinite
from pathlib import Path

import numpy as np

from src.analysis.cloud_base import apparent_latlon, is_gk2a_daytime, estimate_base
from src.analysis.satellite_router import available_sources, load_best_field
from src.integration.gk2a_cloud import iso_utc

_KM_TO_FT = 3280.84
_PHASE = {1: "liquid", 2: "ice", 6: "unknown"}

# Source-specific grid bounds and Mercator row arrays are built on demand.
_GRID_CACHE: dict[str, tuple] = {}


def _grid_for_source(source: str, field: dict) -> tuple:
    """Return (min_lat, max_lat, min_lon, max_lon, shape, mercator_rows) for source."""
    if source in _GRID_CACHE:
        return _GRID_CACHE[source]

    from src.analysis.satellite_router import _in_domain
    if source == "gk2a":
        from src.integration.gk2a_cloud import BOUNDS, SHAPE
        (lat_min, lon_min), (lat_max, lon_max) = BOUNDS
        shape = SHAPE
    elif source in ("G16", "G18"):
        from src.integration.goes_cloud import SATELLITES, _GRID_SHAPE
        sat = SATELLITES[source]
        (lat_min, lon_min), (lat_max, lon_max) = sat["bounds"]
        shape = _GRID_SHAPE
    elif source == "msg":
        from src.integration.meteosat_cloud import BOUNDS, _GRID_SHAPE
        (lat_min, lon_min), (lat_max, lon_max) = BOUNDS
        shape = _GRID_SHAPE
    else:
        raise ValueError(f"Unknown source: {source!r}")

    h, w = shape
    mercator_rows = np.degrees(np.arctan(np.sinh(np.linspace(
        np.arcsinh(np.tan(np.radians(lat_max))),
        np.arcsinh(np.tan(np.radians(lat_min))),
        h,
    ))))
    result = (lat_min, lat_max, lon_min, lon_max, shape, mercator_rows)
    _GRID_CACHE[source] = result
    return result


def _latlon_to_rc(source: str, lat: float, lon: float, grid: tuple) -> tuple[int, int] | None:
    lat_min, lat_max, lon_min, lon_max, shape, mercator_rows = grid
    h, w = shape
    # G18 wraps around 180°
    if source == "G18" and lon_min > lon_max:
        in_lon = lon >= lon_min or lon <= lon_max
        if not in_lon:
            return None
        if lon >= 0:
            col = round((lon - lon_min) / (360.0 + lon_max - lon_min) * (w - 1))
        else:
            col = round((lon - lon_min + 360.0) / (360.0 + lon_max - lon_min) * (w - 1))
    else:
        if not (lon_min <= lon <= lon_max):
            return None
        col = round((lon - lon_min) / (lon_max - lon_min) * (w - 1))
    if not (lat_min <= lat <= lat_max):
        return None
    row = int(np.argmin(np.abs(mercator_rows - lat)))
    return row, max(0, min(w - 1, col))


def _pixel_for(source: str, field: dict, grid: tuple, lat: float, lon: float) -> tuple[int, int] | None:
    corrected_lat, corrected_lon = lat, lon
    for _ in range(3):
        rc = _latlon_to_rc(source, corrected_lat, corrected_lon, grid)
        if rc is None:
            return None
        top = float(field["cth_ft"][rc])
        if not isfinite(top):
            return rc
        corrected_lat, corrected_lon = apparent_latlon(lat, lon, top / _KM_TO_FT)
    return _latlon_to_rc(source, corrected_lat, corrected_lon, grid)


def _value(field: dict, name: str, rc: tuple[int, int]) -> float | None:
    array = field.get(name)
    if array is None:
        return None
    value = float(array[rc])
    return value if isfinite(value) else None


def _assess_icing(
    top_ft: int | None,
    base_ft: int | None,
    phase_str: str | None,
    supercooled: bool | None,
    ctt_k: float | None,
    alt_ft: int,
) -> tuple[str, bool]:
    if top_ft is None:
        return "NONE", False
    base = base_ft if base_ft is not None else 0
    in_layer = base <= alt_ft <= top_ft
    if not in_layer:
        return "NONE", False
    if supercooled is True:
        return "HIGH", True
    if phase_str == "liquid" and ctt_k is not None and ctt_k < 273.15:
        return "MODERATE", True
    return "LOW", True


def _find_altitude_suggestions(samples: list[dict], max_fl: int = 600) -> list[dict]:
    suggestions = []
    # Never suggest an altitude through a part of the route that was not assessed.
    if any(s.get("icingLevel") is None for s in samples):
        return suggestions
    cloud_only = [s for s in samples if s.get("retrievalState") == "observed"]
    tops  = [s["topFt"] for s in cloud_only if s.get("topFt") is not None]
    bases = [s["baseFt"] for s in cloud_only if s.get("baseFt") is not None]
    if not tops:
        return suggestions
    max_top = max(tops)
    clear_above = max_top + 2000
    if clear_above <= max_fl * 100:
        suggestions.append({
            "band": "above",
            "alt_ft": int(round(clear_above / 1000) * 1000),
            "note": (f"No icing detected above approximately FL{int(clear_above / 100):03d} "
                     f"based on current satellite observations."),
            "confidence": "satellite_observation",
        })
    if bases:
        min_base = min(bases)
        clear_below = min_base - 2000
        if clear_below > 0:
            suggestions.append({
                "band": "below",
                "alt_ft": int(round(clear_below / 1000) * 1000),
                "note": (f"Below estimated cloud bases near FL{int(clear_below / 100):03d}. "
                         f"Confirm terrain clearance independently."),
                "confidence": "estimated_base",
            })
    return suggestions


def _sample(
    point: tuple,
    source: str,
    field: dict,
    optics: dict,
    grid: tuple,
    daytime: bool,
    alt_ft: int,
) -> dict:
    distance, lat, lon = point
    base_sample = dict(
        distanceKm=round(distance, 2),
        latitude=round(lat, 5),
        longitude=round(lon, 5),
        topFt=None, baseFt=None,
        phase=None, supercooled=None,
        icingExposure=False, icingLevel=None,  # None = unassessed, never "NONE"
        cloudTopTemperatureC=None,
        cloudBaseMethod=None, cloudBaseState=None,
        satelliteSource=source,
        ctpsQualityFlag=None,
        retrievalState=None,
    )
    rc = _pixel_for(source, field, grid, lat, lon)
    if rc is None:
        return dict(base_sample, retrievalState="outside_domain")

    top = _value(field, "cth_ft", rc)

    # GK-2A has a quality flag; other satellites do not
    quality = _value(field, "ctps_flag", rc) if source == "gk2a" else None
    base_sample["ctpsQualityFlag"] = quality

    # Quality gate (GK-2A only)
    if source == "gk2a":
        if top is None:
            if quality == 2:
                return dict(base_sample, retrievalState="clear", icingLevel="NONE")
            return dict(base_sample, retrievalState="no_retrieval")
        if quality != 0 or not 0 <= top <= 25 * _KM_TO_FT:
            return dict(base_sample, retrievalState="quality_rejected")
    else:
        if top is None or not (0 <= top <= 25 * _KM_TO_FT):
            return dict(base_sample, retrievalState="clear", icingLevel="NONE")

    phase = _value(field, "phase", rc)
    if phase == 0:
        return dict(base_sample, retrievalState="inconsistent_retrieval")

    phase_str = _PHASE.get(int(phase)) if phase is not None else None
    flag = _value(field, "supercooled", rc)
    supercooled = bool(flag) if flag in (0.0, 1.0) else None
    ctt = _value(field, "ctt_k", rc)

    base, method = estimate_base(
        top,
        int(phase) if phase is not None else None,
        ctt,
        _value(field, "emis11", rc),  # NaN for GOES/MSG — falls back to night path
        daytime,
        _value(optics, "dcoew_dqf", rc),
        _value(optics, "lwp_gm2", rc),
        _value(optics, "iwp_gm2", rc),
        _value(optics, "cot", rc),
    )

    risk, in_layer = _assess_icing(round(top), base, phase_str, supercooled, ctt, alt_ft)

    return dict(
        base_sample,
        retrievalState="observed",
        topFt=round(top),
        baseFt=base,
        phase=phase_str,
        supercooled=supercooled,
        icingExposure=in_layer,
        icingLevel=risk,
        cloudTopTemperatureC=round(ctt - 273.15, 1) if ctt is not None else None,
        cloudBaseMethod=method,
        cloudBaseState="estimated" if base is not None else "unknown",
    )


_RISK_ORDER = {"HIGH": 3, "MODERATE": 2, "LOW": 1, "NONE": 0}

def _route_risk(samples: list[dict]) -> str | None:
    """Highest assessed level; None when no sample could be assessed."""
    levels = [s["icingLevel"] for s in samples if s.get("icingLevel") is not None]
    return max(levels, key=lambda lvl: _RISK_ORDER.get(lvl, 0)) if levels else None


_SOURCE_LABEL = {
    "gk2a": "KMA/NMSC GK-2A CTPS L2 (KO)",
    "G16":  "NOAA GOES-16 ABI L2 ACHA",
    "G18":  "NOAA GOES-18 ABI L2 ACHA",
    "msg":  "EUMETSAT Meteosat MSG CTTH",
}

DISCLAIMER = (
    "Dispatcher review aid based on geostationary satellite observations. "
    "Does not replace AIRMETs, SIGMETs, PIREPs, or flight dispatch authority. "
    "Satellite observes the topmost cloud layer only. "
    "Cloud base is a statistical estimate (Noh et al. 2017)."
)


def build_profile(
    points: list,
    altitude: int,
    at: datetime,
    field: dict,
    optics: dict,
    source: str = "gk2a",
    frame_time: datetime | None = None,
) -> dict:
    """Build a viewer.js-compatible icing profile from a pre-loaded field."""
    daytime = is_gk2a_daytime(at)
    grid = _grid_for_source(source, field)
    samples = [_sample(p, source, field, optics, grid, daytime, altitude) for p in points]

    risk = _route_risk(samples)
    alt_suggestions = _find_altitude_suggestions(samples, max_fl=600)

    source_label = _SOURCE_LABEL.get(source, source)
    obs_time = frame_time or at

    return {
        "title": "Satellite cloud cross-section",
        "source": f"{source_label} · Estimated cloud base (Noh et al. 2017)",
        "dataKind": "observation",
        "observedAt": iso_utc(obs_time),
        "flightAlt_ft": altitude,
        "icingRisk": risk,
        "assessmentState": "assessed",
        "satelliteSource": source,
        "altitudeSuggestions": alt_suggestions,
        "disclaimer": DISCLAIMER,
        "coverage": dict(Counter(p["retrievalState"] for p in samples)),
        "samples": samples,
    }


def build_global_profile(
    points: list,
    altitude: int,
    at: datetime,
    cache_root: Path | None = None,
) -> dict:
    """Build a profile by routing each sample to the best available satellite.

    When multiple satellites cover the same point, picks by freshness + proximity.
    Returns a fallback simulated profile when no satellite cache is available.
    """
    if not points:
        return _fallback_profile(altitude)

    # For global routes, different segments may come from different satellites.
    # Group consecutive points by their best source, then merge.
    now = at.astimezone(timezone.utc)
    samples: list[dict] = []
    used_sources: set[str] = set()

    for point in points:
        _, lat, lon = point
        field, source, frame_time = load_best_field(lat, lon, now, cache_root)
        if field is None:
            # No satellite data for this point
            distance = point[0]
            samples.append({
                "distanceKm": round(distance, 2),
                "latitude": round(lat, 5),
                "longitude": round(lon, 5),
                "topFt": None, "baseFt": None,
                "phase": None, "supercooled": None,
                "icingExposure": False, "icingLevel": None,
                "cloudTopTemperatureC": None,
                "cloudBaseMethod": None, "cloudBaseState": None,
                "satelliteSource": None,
                "ctpsQualityFlag": None,
                "retrievalState": "no_satellite_coverage",
            })
            continue

        daytime = is_gk2a_daytime(at)
        grid = _grid_for_source(source, field)
        s = _sample(point, source, field, {}, grid, daytime, altitude)
        s["satelliteSource"] = source
        if frame_time:
            s["observedAt"] = iso_utc(frame_time)
        samples.append(s)
        used_sources.add(source)

    if not used_sources:
        return _fallback_profile(altitude)

    risk = _route_risk(samples)
    alt_suggestions = _find_altitude_suggestions(samples, max_fl=600)
    source_labels = " + ".join(_SOURCE_LABEL.get(s, s) for s in sorted(used_sources))

    return {
        "title": "Global satellite cloud cross-section",
        "source": f"{source_labels} · Estimated cloud base (Noh et al. 2017)",
        "dataKind": "observation",
        "observedAt": iso_utc(now),
        "flightAlt_ft": altitude,
        "icingRisk": risk,
        "assessmentState": "assessed",
        "satelliteSources": sorted(used_sources),
        "altitudeSuggestions": alt_suggestions,
        "disclaimer": DISCLAIMER,
        "coverage": dict(Counter(p["retrievalState"] for p in samples)),
        "samples": samples,
    }


def _fallback_profile(altitude: int) -> dict:
    """Return a viewer.js-compatible simulated profile."""
    import json
    static = Path(__file__).resolve().parents[2] / "static" / "sample.js"
    text = static.read_text(encoding="utf-8")
    sample = json.loads(text[text.index("{"):text.rindex("}") + 1])
    return dict(
        sample,
        source="Illustrative sample · No satellite cache available",
        flightAlt_ft=altitude,
        assessmentState="not_assessed",
        icingRisk=None,
        altitudeSuggestions=[],
        satelliteSource=None,
        disclaimer=DISCLAIMER,
    )
