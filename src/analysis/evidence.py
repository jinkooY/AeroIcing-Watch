"""Cloud Dive evidence rule v2 (`cloud-dive-evidence-v2`).

Assigns exactly one of four evidence levels to a cell (lane, step, altitude) from satellite
cloud-top evidence and an ECMWF forecast screen. Pure functions: no I/O, no randomness, no clock,
no network and no language model (requirement R2.8).

Levels (science guardrails):
  Observed supercooled layer at planned altitude   satellite sees a supercooled cloud top and the
                                                   altitude is inside the candidate layer
  Possible (forecast only)                         forecast temperature/humidity screen met, never
                                                   labelled observed
  Not indicated                                    evidence says nothing points to icing here
  Not assessed                                     evidence is missing; never turned into
                                                   "Not indicated"

Decision order (first match wins), as implemented:
  1. satellite `clear`                                     -> Not indicated   `satellite_clear`
  2. satellite `observed`, top known, altitude above top   -> Not indicated   `above_cloud_top`
  3. satellite `observed`, supercooled, top known:
       isotherms missing                                   -> Not assessed    `isotherm_unavailable`
       base known, altitude in candidate layer             -> Observed        `inside_candidate_layer`
       base unknown, altitude in [0 C height, min(top, -20 C height)]
                                                           -> Not assessed    `cloud_base_unknown`
  4. forecast criterion met                                -> Possible        `forecast_criterion_met`
  5. forecast available, criterion not met                 -> Not indicated   `forecast_criterion_not_met`
                                                              (satellite observed) or
                                                              `no_supercooled_signal_forecast_dry`
  6. forecast missing, satellite observed, supercooled false
                                                           -> Not indicated   `no_supercooled_signal`
  7. otherwise                                             -> Not assessed    the missing-evidence reason

Thresholds are uncalibrated screening values and are echoed by `rule_metadata()`.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable, Mapping, Sequence

RULE_NAME = "cloud-dive-evidence-v2"
RULE_VERSION = 2

LEVEL_NOT_ASSESSED = "Not assessed"
LEVEL_NOT_INDICATED = "Not indicated"
LEVEL_POSSIBLE = "Possible (forecast only)"
LEVEL_OBSERVED = "Observed supercooled layer at planned altitude"
# Index = compact code stored in case files.
LEVELS: tuple[str, ...] = (LEVEL_NOT_ASSESSED, LEVEL_NOT_INDICATED, LEVEL_POSSIBLE, LEVEL_OBSERVED)
LEVEL_CODE: dict[str, int] = {name: code for code, name in enumerate(LEVELS)}

# Satellite retrieval states that carry evidence.
STATE_OBSERVED = "observed"
STATE_CLEAR = "clear"

# Reason codes.
R_INSIDE_LAYER = "inside_candidate_layer"
R_BASE_UNKNOWN = "cloud_base_unknown"
R_ISOTHERM_UNAVAILABLE = "isotherm_unavailable"
R_ABOVE_TOP = "above_cloud_top"
R_SATELLITE_CLEAR = "satellite_clear"
R_FORECAST_MET = "forecast_criterion_met"
R_FORECAST_NOT_MET = "forecast_criterion_not_met"
R_FORECAST_DRY = "no_supercooled_signal_forecast_dry"
R_NO_SIGNAL = "no_supercooled_signal"
R_FORECAST_UNAVAILABLE = "forecast_unavailable"
R_EVIDENCE_INCOMPLETE = "evidence_incomplete"
R_SATELLITE_UNAVAILABLE = "satellite_unavailable"

# Forecast screen `ifs-temperature-rh-v1` (uncalibrated).
FORECAST_RULE_ID = "ifs-temperature-rh-v1"
FORECAST_TEMP_C_MIN = -25.0
FORECAST_TEMP_C_MAX = 0.0
FORECAST_RH_PCT_MIN = 85.0

# Isotherm estimate from cloud-top temperature (uncalibrated ISA-like lapse rate).
LAPSE_C_PER_KFT = 1.98
METHOD_PROFILE = "ifs_profile"
METHOD_PROFILE_EXTRAPOLATED = "ifs_profile_extrapolated"
METHOD_CLOUD_TOP = "cloud_top_lapse_rate_estimate"
METHOD_UNAVAILABLE = "unavailable"


@dataclass(frozen=True)
class CellEvidence:
    """Evidence level of one cell and the reason code behind it."""

    level: str
    reason: str

    @property
    def code(self) -> int:
        return LEVEL_CODE[self.level]


def rule_metadata() -> dict:
    """Rule name, version and every threshold; echoed into each case file (R2.7)."""
    return {
        "name": RULE_NAME,
        "version": RULE_VERSION,
        "levels": list(LEVELS),
        "satelliteStatesWithEvidence": [STATE_OBSERVED, STATE_CLEAR],
        "forecastScreen": {
            "id": FORECAST_RULE_ID,
            "tempCMin": FORECAST_TEMP_C_MIN,
            "tempCMax": FORECAST_TEMP_C_MAX,
            "rhPctMin": FORECAST_RH_PCT_MIN,
            "uncalibrated": True,
        },
        "isotherms": {
            "zeroCFt": "height of 0 C",
            "minus20CFt": "height of -20 C",
            "lapseRateCPerKft": LAPSE_C_PER_KFT,
            "methods": [METHOD_PROFILE, METHOD_PROFILE_EXTRAPOLATED, METHOD_CLOUD_TOP],
            "uncalibrated": True,
        },
    }


def _num(value) -> float | None:
    """Finite float or None. NaN and infinity are missing values (guardrail: never reach JSON)."""
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


# ---------------------------------------------------------------------------------------------
# Isotherm heights and candidate layer (task 2.2)
# ---------------------------------------------------------------------------------------------

def isotherm_heights_from_cloud_top(top_ft, ctt_c) -> dict:
    """0 C and -20 C heights from the cloud-top temperature and a fixed lapse rate.

    T(z) = ctt + lapse * (top - z) / 1000, so 0 C lies |ctt| / lapse below the top for a cold top.
    """
    top, ctt = _num(top_ft), _num(ctt_c)
    if top is None or ctt is None:
        return {"zero_c_ft": None, "minus20_c_ft": None, "method": METHOD_UNAVAILABLE}
    return {
        "zero_c_ft": top + ctt / LAPSE_C_PER_KFT * 1000.0,
        "minus20_c_ft": top + (ctt + 20.0) / LAPSE_C_PER_KFT * 1000.0,
        "method": METHOD_CLOUD_TOP,
    }


def isotherm_heights_from_profile(levels: Iterable[tuple]) -> dict:
    """0 C and -20 C heights from a temperature profile `[(height_ft, temp_c), ...]`.

    The freezing level is the lowest height where the temperature falls from above 0 C to 0 C or
    below. The -20 C height is the lowest such crossing above it. Without a crossing the height is
    extrapolated with `LAPSE_C_PER_KFT` and the method says so. `minus20_c_ft >= zero_c_ft` always.
    """
    pts = sorted(
        (h, t) for h, t in ((_num(a), _num(b)) for a, b in levels) if h is not None and t is not None
    )
    if len(pts) < 2:
        return {"zero_c_ft": None, "minus20_c_ft": None, "method": METHOD_UNAVAILABLE}
    extrapolated = False

    def crossing(start: int, threshold: float) -> tuple[float, int] | None:
        for i in range(start, len(pts) - 1):
            (z0, t0), (z1, t1) = pts[i], pts[i + 1]
            if t0 > threshold >= t1:
                return z0 + (t0 - threshold) / (t0 - t1) * (z1 - z0), i
        return None

    z_low, t_low = pts[0]
    z_top, t_top = pts[-1]
    if t_low <= 0.0:
        zero = z_low + t_low / LAPSE_C_PER_KFT * 1000.0  # at or below the lowest level
        start, extrapolated = 0, True
    else:
        found = crossing(0, 0.0)
        if found is not None:
            zero, start = found[0], found[1]
        else:  # whole profile above 0 C
            zero, start, extrapolated = z_top + t_top / LAPSE_C_PER_KFT * 1000.0, len(pts) - 1, True

    if start == len(pts) - 1 and extrapolated:
        minus20 = z_top + (t_top + 20.0) / LAPSE_C_PER_KFT * 1000.0
    else:
        probe = crossing(start, -20.0)
        if probe is not None:
            minus20 = probe[0]
        elif pts[start][1] <= -20.0:
            minus20 = pts[start][0] + (pts[start][1] + 20.0) / LAPSE_C_PER_KFT * 1000.0
            extrapolated = True
        else:
            minus20 = z_top + (t_top + 20.0) / LAPSE_C_PER_KFT * 1000.0
            extrapolated = True
    return {
        "zero_c_ft": zero,
        "minus20_c_ft": minus20,
        "method": METHOD_PROFILE_EXTRAPOLATED if extrapolated else METHOD_PROFILE,
    }


def candidate_layer(base_ft, top_ft, zero_c_ft, minus20_c_ft) -> dict:
    """Altitude band inside the cloud between the 0 C and -20 C heights.

    lower = max(base, zero C height) (zero C height if the base is unknown),
    upper = min(top, -20 C height). Returns `lower_ft`/`upper_ft` and a `reason`;
    both heights are None when the band is empty or an input is missing.
    """
    base, top = _num(base_ft), _num(top_ft)
    zero, minus20 = _num(zero_c_ft), _num(minus20_c_ft)
    if top is None or zero is None or minus20 is None:
        return {"lower_ft": None, "upper_ft": None, "reason": "inputs_missing"}
    lower = zero if base is None else max(base, zero)
    upper = min(top, minus20)
    if lower <= upper:
        return {"lower_ft": lower, "upper_ft": upper, "reason": "ok"}
    if base is not None and minus20 < base:
        reason = "cloud_colder_than_minus20"
    elif zero > top:
        reason = "cloud_warmer_than_freezing"
    else:
        reason = "layer_empty"
    return {"lower_ft": None, "upper_ft": None, "reason": reason}


# ---------------------------------------------------------------------------------------------
# Evidence rule (task 2.3)
# ---------------------------------------------------------------------------------------------

def forecast_criterion(temp_c, rh_pct) -> bool | None:
    """Forecast screen `ifs-temperature-rh-v1`. None when temperature or humidity is missing."""
    t, rh = _num(temp_c), _num(rh_pct)
    if t is None or rh is None:
        return None
    return FORECAST_TEMP_C_MIN <= t <= FORECAST_TEMP_C_MAX and rh >= FORECAST_RH_PCT_MIN


def evaluate_cell(
    satellite: Mapping | None,
    forecast: Mapping | None,
    alt_ft,
    isotherms: Mapping | None,
) -> CellEvidence:
    """Evidence level of one cell.

    satellite: {state, top_ft, base_ft, supercooled} or None
    forecast:  {temp_c, rh_pct} or None
    isotherms: {zero_c_ft, minus20_c_ft} or None
    """
    alt = _num(alt_ft)
    if alt is None:
        return CellEvidence(LEVEL_NOT_ASSESSED, "altitude_missing")
    sat = satellite or {}
    state = sat.get("state") if satellite else None
    top = _num(sat.get("top_ft"))
    base = _num(sat.get("base_ft"))
    supercooled = sat.get("supercooled")
    supercooled = supercooled if isinstance(supercooled, bool) else None
    fc = forecast or {}
    screen = forecast_criterion(fc.get("temp_c"), fc.get("rh_pct")) if forecast else None
    iso = isotherms or {}
    zero, minus20 = _num(iso.get("zero_c_ft")), _num(iso.get("minus20_c_ft"))

    observed = state == STATE_OBSERVED
    if observed and top is None:
        observed = False  # an observed cloud without a top is incomplete evidence
        state = R_EVIDENCE_INCOMPLETE

    # 1. Clear sky.
    if state == STATE_CLEAR:
        return CellEvidence(LEVEL_NOT_INDICATED, R_SATELLITE_CLEAR)

    if observed:
        # 2. Above the highest observed cloud top there is no cloud (no isotherms needed).
        if alt > top:
            return CellEvidence(LEVEL_NOT_INDICATED, R_ABOVE_TOP)
        # 3. Supercooled cloud top: decide whether this altitude is in the candidate layer.
        if supercooled is True:
            if zero is None or minus20 is None:
                return CellEvidence(LEVEL_NOT_ASSESSED, R_ISOTHERM_UNAVAILABLE)
            upper = min(top, minus20)
            if base is not None:
                lower = max(base, zero)
                if lower <= alt <= upper and lower <= upper:
                    return CellEvidence(LEVEL_OBSERVED, R_INSIDE_LAYER)
            elif zero <= alt <= upper:
                return CellEvidence(LEVEL_NOT_ASSESSED, R_BASE_UNKNOWN)

    # 4./5. Forecast screen.
    if screen is True:
        return CellEvidence(LEVEL_POSSIBLE, R_FORECAST_MET)
    if screen is False:
        return CellEvidence(LEVEL_NOT_INDICATED, R_FORECAST_NOT_MET if observed else R_FORECAST_DRY)

    # 6. Forecast missing: a satellite top that is not supercooled is a (limited) negative signal.
    if observed and supercooled is False:
        return CellEvidence(LEVEL_NOT_INDICATED, R_NO_SIGNAL)

    # 7. Missing evidence stays Not assessed, with the reason it is missing.
    if observed:
        reason = R_FORECAST_UNAVAILABLE
    elif satellite is None:
        reason = R_SATELLITE_UNAVAILABLE
    else:
        reason = str(state) if state else R_SATELLITE_UNAVAILABLE
    return CellEvidence(LEVEL_NOT_ASSESSED, reason)


# ---------------------------------------------------------------------------------------------
# Route summary (task 2.4)
# ---------------------------------------------------------------------------------------------

def route_summary(levels: Sequence[str], step_km: float, total_km: float | None = None) -> dict:
    """Kilometres and merged segments per evidence level along a path.

    `levels[i]` is the level of the i-th step; step i covers [i*step_km, (i+1)*step_km). When
    `total_km` is given the last step is shortened or extended so that the sum equals `total_km`.
    All four level keys are always present.
    """
    step = _num(step_km)
    if step is None or step <= 0:
        raise ValueError("step_km must be a positive finite number")
    unknown = [lv for lv in levels if lv not in LEVEL_CODE]
    if unknown:
        raise ValueError(f"unknown evidence level: {unknown[0]!r}")
    summary = {name: {"km": 0.0, "segments": []} for name in LEVELS}
    n = len(levels)
    if n == 0:
        return summary
    end_total = float(total_km) if total_km is not None else n * step
    if not math.isfinite(end_total) or end_total < (n - 1) * step:
        raise ValueError("total_km must be finite and cover all steps")
    previous = None
    for i, level in enumerate(levels):
        start = i * step
        end = end_total if i == n - 1 else (i + 1) * step
        entry = summary[level]
        entry["km"] += end - start
        if previous == level and entry["segments"]:
            entry["segments"][-1][1] = end
        else:
            entry["segments"].append([start, end])
        previous = level
    return summary
