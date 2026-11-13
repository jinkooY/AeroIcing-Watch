"""Unit tests for the Cloud Dive evidence rule v2 (task 2.5). All data is synthetic."""
import math

import pytest

from src.analysis.evidence import (
    LAPSE_C_PER_KFT,
    LEVEL_NOT_ASSESSED,
    LEVEL_NOT_INDICATED,
    LEVEL_OBSERVED,
    LEVEL_POSSIBLE,
    LEVELS,
    candidate_layer,
    evaluate_cell,
    forecast_criterion,
    isotherm_heights_from_cloud_top,
    isotherm_heights_from_profile,
    route_summary,
    rule_metadata,
)

# A synthetic supercooled cloud: top 14,000 ft, base 9,000 ft, top temperature -12 C.
SAT = {"state": "observed", "top_ft": 14000, "base_ft": 9000, "supercooled": True}
ISO = isotherm_heights_from_cloud_top(14000, -12.0)  # 0 C at 7,939 ft, -20 C at 18,040 ft
WET_COLD = {"temp_c": -8.0, "rh_pct": 90.0}
DRY = {"temp_c": -8.0, "rh_pct": 50.0}
WARM = {"temp_c": 4.0, "rh_pct": 95.0}


def ev(satellite, forecast, alt, isotherms=ISO):
    return evaluate_cell(satellite, forecast, alt, isotherms)


# ---- rule rows --------------------------------------------------------------------------------

def test_row1_clear_sky_is_not_indicated_even_when_forecast_is_wet_synthetic():
    out = ev({"state": "clear"}, WET_COLD, 10000)
    assert (out.level, out.reason) == (LEVEL_NOT_INDICATED, "satellite_clear")


def test_row2_above_cloud_top_is_not_indicated_without_isotherms_synthetic():
    out = ev(SAT, None, 14500, isotherms=None)
    assert (out.level, out.reason) == (LEVEL_NOT_INDICATED, "above_cloud_top")


def test_row3_observed_inside_candidate_layer_synthetic():
    for alt in (9000, 10000, 14000):
        out = ev(SAT, DRY, alt)
        assert (out.level, out.reason) == (LEVEL_OBSERVED, "inside_candidate_layer"), alt


def test_row3_layer_bounds_are_inclusive_synthetic():
    lower = max(9000, ISO["zero_c_ft"])
    upper = min(14000, ISO["minus20_c_ft"])
    assert ev(SAT, None, lower).level == LEVEL_OBSERVED
    assert ev(SAT, None, upper).level == LEVEL_OBSERVED
    assert ev(SAT, None, lower - 1).level != LEVEL_OBSERVED
    assert ev(SAT, None, upper + 1).level != LEVEL_OBSERVED


def test_row3_below_the_base_falls_back_to_the_forecast_synthetic():
    assert ev(SAT, WET_COLD, 8000).level == LEVEL_POSSIBLE
    out = ev(SAT, DRY, 8000)
    assert (out.level, out.reason) == (LEVEL_NOT_INDICATED, "forecast_criterion_not_met")


def test_row3_warmer_than_freezing_inside_cloud_is_not_observed_synthetic():
    iso = {"zero_c_ft": 12000.0, "minus20_c_ft": 22000.0}
    assert ev(SAT, DRY, 10000, iso).level == LEVEL_NOT_INDICATED  # cloud air still above 0 C


def test_row3_unknown_base_inside_the_cold_band_is_not_assessed_synthetic():
    sat = dict(SAT, base_ft=None)
    out = ev(sat, None, 10000)
    assert (out.level, out.reason) == (LEVEL_NOT_ASSESSED, "cloud_base_unknown")
    assert ev(sat, WET_COLD, 10000).level == LEVEL_NOT_ASSESSED  # the satellite doubt wins over the forecast


def test_row3_missing_isotherms_is_not_assessed_synthetic():
    out = ev(SAT, DRY, 10000, isotherms=None)
    assert (out.level, out.reason) == (LEVEL_NOT_ASSESSED, "isotherm_unavailable")
    assert ev(SAT, DRY, 10000, {"zero_c_ft": 7000.0, "minus20_c_ft": None}).reason == "isotherm_unavailable"


def test_row4_forecast_only_is_possible_never_observed_synthetic():
    out = ev(None, WET_COLD, 10000)
    assert (out.level, out.reason) == (LEVEL_POSSIBLE, "forecast_criterion_met")
    assert ev({"state": "outside_domain"}, WET_COLD, 10000).level == LEVEL_POSSIBLE
    assert ev({"state": "observed", "top_ft": 14000, "base_ft": 9000, "supercooled": False}, WET_COLD, 10000).level == LEVEL_POSSIBLE


@pytest.mark.parametrize(
    "temp,rh,expected",
    [(-25.0, 85.0, True), (0.0, 85.0, True), (-25.1, 90.0, False), (0.1, 90.0, False), (-8.0, 84.9, False)],
)
def test_forecast_screen_boundaries_synthetic(temp, rh, expected):
    assert forecast_criterion(temp, rh) is expected


def test_forecast_screen_with_missing_value_is_unknown_synthetic():
    assert forecast_criterion(None, 90.0) is None
    assert forecast_criterion(-5.0, None) is None
    assert forecast_criterion(float("nan"), 90.0) is None


def test_row5_forecast_dry_reasons_depend_on_the_satellite_state_synthetic():
    assert ev(SAT, DRY, 8000).reason == "forecast_criterion_not_met"
    assert ev(None, DRY, 8000).reason == "no_supercooled_signal_forecast_dry"
    assert ev({"state": "quality_rejected"}, WARM, 8000).level == LEVEL_NOT_INDICATED


def test_row6_not_supercooled_top_without_forecast_is_a_limited_negative_synthetic():
    sat = dict(SAT, supercooled=False)
    out = ev(sat, None, 10000)
    assert (out.level, out.reason) == (LEVEL_NOT_INDICATED, "no_supercooled_signal")


def test_row7_missing_evidence_stays_not_assessed_with_the_reason_synthetic():
    assert ev(None, None, 10000).reason == "satellite_unavailable"
    for state in ("outside_domain", "quality_rejected", "no_retrieval", "inconsistent_retrieval"):
        out = ev({"state": state}, None, 10000)
        assert (out.level, out.reason) == (LEVEL_NOT_ASSESSED, state)
    # supercooled flag unknown, below the top, no forecast: not enough to say anything
    out = ev({"state": "observed", "top_ft": 14000, "base_ft": 9000, "supercooled": None}, None, 10000)
    assert (out.level, out.reason) == (LEVEL_NOT_ASSESSED, "forecast_unavailable")
    # forecast block present but empty counts as missing
    assert ev(None, {"temp_c": None, "rh_pct": 90.0}, 10000).level == LEVEL_NOT_ASSESSED


def test_observed_cloud_without_a_top_is_incomplete_evidence_synthetic():
    out = ev({"state": "observed", "top_ft": None, "base_ft": None, "supercooled": True}, None, 10000)
    assert out.level == LEVEL_NOT_ASSESSED


def test_nan_and_infinity_are_treated_as_missing_synthetic():
    nan, inf = float("nan"), float("inf")
    assert ev(SAT, DRY, nan).level == LEVEL_NOT_ASSESSED
    assert ev(dict(SAT, base_ft=nan), None, 10000) == ev(dict(SAT, base_ft=None), None, 10000)
    assert ev(SAT, {"temp_c": nan, "rh_pct": 90.0}, 8000) == ev(SAT, {"temp_c": None, "rh_pct": 90.0}, 8000)
    assert ev(SAT, None, 10000, {"zero_c_ft": inf, "minus20_c_ft": 18000.0}).reason == "isotherm_unavailable"


def test_level_codes_are_stable_synthetic():
    assert LEVELS == (LEVEL_NOT_ASSESSED, LEVEL_NOT_INDICATED, LEVEL_POSSIBLE, LEVEL_OBSERVED)
    assert [ev(None, None, 1).code, ev({"state": "clear"}, None, 1).code, ev(None, WET_COLD, 1).code] == [0, 1, 2]
    assert ev(SAT, None, 10000).code == 3


# ---- isotherms and candidate layer --------------------------------------------------------------

def test_isotherms_from_cloud_top_use_the_lapse_rate_synthetic():
    assert ISO["method"] == "cloud_top_lapse_rate_estimate"
    assert ISO["zero_c_ft"] == pytest.approx(14000 - 12.0 / LAPSE_C_PER_KFT * 1000.0)
    assert ISO["minus20_c_ft"] == pytest.approx(14000 + 8.0 / LAPSE_C_PER_KFT * 1000.0)
    assert isotherm_heights_from_cloud_top(None, -12.0)["method"] == "unavailable"
    assert isotherm_heights_from_cloud_top(14000, None)["zero_c_ft"] is None


def test_isotherms_from_a_profile_interpolate_linearly_synthetic():
    profile = [(2500, 5.0), (5000, 0.5), (9000, -6.0), (14000, -17.0), (20000, -25.0)]
    out = isotherm_heights_from_profile(profile)
    assert out["method"] == "ifs_profile"
    assert out["zero_c_ft"] == pytest.approx(5000 + 0.5 / 6.5 * 4000)
    assert out["minus20_c_ft"] == pytest.approx(14000 + 3.0 / 8.0 * 6000)


def test_profile_input_order_does_not_matter_synthetic():
    profile = [(2500, 5.0), (5000, 0.5), (9000, -6.0), (14000, -17.0), (20000, -25.0)]
    assert isotherm_heights_from_profile(list(reversed(profile))) == isotherm_heights_from_profile(profile)


def test_profile_entirely_below_freezing_is_extrapolated_downward_synthetic():
    out = isotherm_heights_from_profile([(1000, -5.0), (10000, -15.0)])
    assert out["method"] == "ifs_profile_extrapolated"
    assert out["zero_c_ft"] == pytest.approx(1000 - 5.0 / LAPSE_C_PER_KFT * 1000.0)
    assert out["minus20_c_ft"] == pytest.approx(10000 + 5.0 / LAPSE_C_PER_KFT * 1000.0)


def test_profile_entirely_above_freezing_is_extrapolated_upward_synthetic():
    out = isotherm_heights_from_profile([(1000, 10.0), (10000, 3.0)])
    assert out["method"] == "ifs_profile_extrapolated"
    assert out["zero_c_ft"] == pytest.approx(10000 + 3.0 / LAPSE_C_PER_KFT * 1000.0)
    assert out["minus20_c_ft"] == pytest.approx(10000 + 23.0 / LAPSE_C_PER_KFT * 1000.0)


def test_profile_with_too_few_levels_is_unavailable_synthetic():
    for levels in ([], [(5000, 0.0)], [(None, 1.0), (5000, float("nan"))]):
        out = isotherm_heights_from_profile(levels)
        assert out == {"zero_c_ft": None, "minus20_c_ft": None, "method": "unavailable"}


def test_profile_with_an_inversion_uses_the_lowest_freezing_crossing_synthetic():
    profile = [(1000, 4.0), (3000, -2.0), (5000, 3.0), (9000, -8.0)]
    out = isotherm_heights_from_profile(profile)
    assert out["zero_c_ft"] == pytest.approx(1000 + 4.0 / 6.0 * 2000)
    assert out["minus20_c_ft"] >= out["zero_c_ft"]


def test_candidate_layer_cases_synthetic():
    ok = candidate_layer(9000, 14000, 7939, 18040)
    assert ok == {"lower_ft": 9000.0, "upper_ft": 14000.0, "reason": "ok"}
    assert candidate_layer(None, 14000, 7939, 18040)["lower_ft"] == 7939.0
    assert candidate_layer(9000, 14000, 10000, 12000) == {"lower_ft": 10000.0, "upper_ft": 12000.0, "reason": "ok"}
    assert candidate_layer(9000, 14000, 2000, 8000)["reason"] == "cloud_colder_than_minus20"
    assert candidate_layer(9000, 14000, 16000, 26000)["reason"] == "cloud_warmer_than_freezing"
    assert candidate_layer(9000, 14000, None, 18000)["reason"] == "inputs_missing"
    assert candidate_layer(9000, None, 7000, 18000)["lower_ft"] is None


# ---- route summary --------------------------------------------------------------------------------

def test_route_summary_merges_segments_and_sums_to_the_total_synthetic():
    levels = [LEVEL_OBSERVED] * 3 + [LEVEL_NOT_INDICATED] * 2 + [LEVEL_OBSERVED]
    out = route_summary(levels, 10.0, total_km=57.0)
    assert set(out) == set(LEVELS)
    assert out[LEVEL_OBSERVED]["segments"] == [[0.0, 30.0], [50.0, 57.0]]
    assert out[LEVEL_OBSERVED]["km"] == pytest.approx(37.0)
    assert out[LEVEL_NOT_INDICATED]["segments"] == [[30.0, 50.0]]
    assert out[LEVEL_NOT_ASSESSED]["km"] == 0.0 and out[LEVEL_NOT_ASSESSED]["segments"] == []
    assert sum(v["km"] for v in out.values()) == pytest.approx(57.0)


def test_route_summary_without_total_uses_whole_steps_synthetic():
    out = route_summary([LEVEL_POSSIBLE, LEVEL_POSSIBLE], 10.0)
    assert out[LEVEL_POSSIBLE] == {"km": 20.0, "segments": [[0.0, 20.0]]}


def test_route_summary_of_an_empty_path_has_all_keys_synthetic():
    out = route_summary([], 10.0)
    assert set(out) == set(LEVELS) and all(v["km"] == 0.0 for v in out.values())


def test_route_summary_rejects_bad_input_synthetic():
    with pytest.raises(ValueError):
        route_summary([LEVEL_OBSERVED], 0.0)
    with pytest.raises(ValueError):
        route_summary(["Safe"], 10.0)
    with pytest.raises(ValueError):
        route_summary([LEVEL_OBSERVED] * 3, 10.0, total_km=5.0)
    with pytest.raises(ValueError):
        route_summary([LEVEL_OBSERVED], 10.0, total_km=math.inf)


# ---- rule metadata ----------------------------------------------------------------------------------

def test_rule_metadata_echoes_name_version_and_thresholds_synthetic():
    meta = rule_metadata()
    assert (meta["name"], meta["version"]) == ("cloud-dive-evidence-v2", 2)
    assert meta["forecastScreen"] == {
        "id": "ifs-temperature-rh-v1", "tempCMin": -25.0, "tempCMax": 0.0, "rhPctMin": 85.0, "uncalibrated": True,
    }
    assert meta["isotherms"]["lapseRateCPerKft"] == LAPSE_C_PER_KFT
    assert meta["levels"] == list(LEVELS)
