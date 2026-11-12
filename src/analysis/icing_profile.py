"""Build viewer profiles from projected CTPS evidence."""

from collections import Counter
from datetime import datetime
from math import isfinite, inf

import numpy as np

from src.analysis.cloud_base import (
    apparent_latlon,
    is_gk2a_daytime,
    estimate_base,
)
from src.integration.gk2a_cloud import BOUNDS, SHAPE, iso_utc

_KM_TO_FT = 3280.84
_PHASE = {1: "liquid", 2: "ice", 6: "unknown"}
_MIN_LAT, _MIN_LON = BOUNDS[0]
_MAX_LAT, _MAX_LON = BOUNDS[1]
_MERCATOR_ROWS = np.degrees(np.arctan(np.sinh(np.linspace(
    np.arcsinh(np.tan(np.radians(_MAX_LAT))),
    np.arcsinh(np.tan(np.radians(_MIN_LAT))),
    SHAPE[0],
))))

DISCLAIMER = (
    "Dispatcher review aid based on GK-2A CTPS satellite observations. "
    "Does not replace AIRMETs, SIGMETs, PIREPs, or flight dispatch authority. "
    "Satellite observes the topmost cloud layer only."
)


def _latlon_to_rc(lat: float, lon: float) -> tuple[int, int] | None:
    if not (_MIN_LAT <= lat <= _MAX_LAT and _MIN_LON <= lon <= _MAX_LON):
        return None
    col = round((lon - _MIN_LON) / (_MAX_LON - _MIN_LON) * (SHAPE[1] - 1))
    return int(np.argmin(np.abs(_MERCATOR_ROWS - lat))), col


def _pixel_for(field: dict, lat: float, lon: float) -> tuple[int, int] | None:
    corrected_lat, corrected_lon = lat, lon
    for _ in range(3):
        rc = _latlon_to_rc(corrected_lat, corrected_lon)
        if rc is None:
            return None
        top = float(field["cth_ft"][rc])
        if not isfinite(top):
            return rc
        corrected_lat, corrected_lon = apparent_latlon(lat, lon, top / _KM_TO_FT)
    return _latlon_to_rc(corrected_lat, corrected_lon)


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
    """Return (risk_level, in_layer) for the planned altitude.

    risk_level : 'HIGH' | 'MODERATE' | 'LOW' | 'NONE'
    in_layer   : True when planned altitude is within the cloud layer
    """
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


def _find_altitude_suggestions(samples: list[dict], max_fl: int = 450) -> list[dict]:
    """Find icing-free altitude bands above and below the cloud layers."""
    suggestions = []
    tops = [s["topFt"] for s in samples if s.get("topFt") is not None]
    bases = [s["baseFt"] for s in samples if s.get("baseFt") is not None]
    if not tops:
        return suggestions

    # Above: find the lowest altitude above ALL cloud tops
    max_top = max(tops)
    clear_above = max_top + 2000  # 2000 ft buffer above highest top
    if clear_above <= max_fl * 100:
        suggestions.append({
            "band": "above",
            "alt_ft": int(round(clear_above / 1000) * 1000),
            "note": f"No icing detected above approximately FL{int(clear_above / 100):03d} "
                    f"based on current satellite observations.",
            "confidence": "satellite_observation",
        })

    # Below: find the highest altitude below ALL estimated bases
    if bases:
        min_base = min(bases)
        clear_below = min_base - 2000  # 2000 ft buffer below lowest base
        if clear_below > 0:
            suggestions.append({
                "band": "below",
                "alt_ft": int(round(clear_below / 1000) * 1000),
                "note": f"Below estimated cloud bases for most of route near "
                        f"FL{int(clear_below / 100):03d}. "
                        f"Confirm terrain clearance independently.",
                "confidence": "estimated_base",
            })

    return suggestions


def _sample(point: tuple, field: dict, optics: dict, daytime: bool, alt_ft: int) -> dict:
    distance, lat, lon = point
    sample = dict(
        distanceKm=round(distance, 2),
        latitude=round(lat, 5),
        longitude=round(lon, 5),
        topFt=None,
        baseFt=None,
        phase=None,
        supercooled=None,
        icingExposure=False,
        icingLevel="NONE",
        cloudTopTemperatureC=None,
        cloudBaseMethod=None,
        cloudBaseState=None,
        ctpsQualityFlag=None,
        retrievalState=None,
    )
    rc = _pixel_for(field, lat, lon)
    if rc is None:
        return dict(sample, retrievalState="outside_domain")

    top = _value(field, "cth_ft", rc)
    quality = _value(field, "ctps_flag", rc)
    sample["ctpsQualityFlag"] = quality
    if top is None:
        state = "clear" if quality == 2 else "no_retrieval"
        return dict(sample, retrievalState=state)
    if quality != 0 or not 0 <= top <= 25 * _KM_TO_FT:
        return dict(sample, retrievalState="quality_rejected")

    phase = _value(field, "phase", rc)
    if phase == 0:
        return dict(sample, retrievalState="inconsistent_retrieval")

    phase_str = _PHASE.get(int(phase)) if phase is not None else None
    flag = _value(field, "supercooled", rc)
    supercooled = bool(flag) if flag in (0.0, 1.0) else None
    ctt = _value(field, "ctt_k", rc)
    base, method = estimate_base(
        top, int(phase) if phase is not None else None, ctt,
        _value(field, "emis11", rc), daytime,
        _value(optics, "dcoew_dqf", rc), _value(optics, "lwp_gm2", rc),
        _value(optics, "iwp_gm2", rc), _value(optics, "cot", rc),
    )

    risk, in_layer = _assess_icing(round(top), base, phase_str, supercooled, ctt, alt_ft)

    return dict(
        sample,
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


def build_profile(
    points: list,
    altitude: int,
    at: datetime,
    field: dict,
    optics: dict,
) -> dict:
    daytime = is_gk2a_daytime(at)
    samples = [_sample(point, field, optics, daytime, altitude) for point in points]

    # Overall icing risk = highest level across all samples
    risk = max(
        (s.get("icingLevel", "NONE") for s in samples),
        key=lambda lvl: _RISK_ORDER.get(lvl, 0),
        default="NONE",
    )

    # Altitude suggestions based on observed cloud layer extents
    cloud_samples = [s for s in samples if s.get("retrievalState") == "observed"]
    alt_suggestions = _find_altitude_suggestions(cloud_samples, max_fl=600)

    return {
        "title": "GK-2A cloud cross-section",
        "source": "KMA/NMSC GK-2A CTPS L2 (KO) · Estimated cloud base",
        "dataKind": "observation",
        "observedAt": iso_utc(at),
        "flightAlt_ft": altitude,
        "icingRisk": risk,
        "assessmentState": "assessed",
        "altitudeSuggestions": alt_suggestions,
        "disclaimer": DISCLAIMER,
        "coverage": dict(Counter(p["retrievalState"] for p in samples)),
        "samples": samples,
    }
