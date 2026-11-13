"""Property-based tests for the Cloud Dive evidence rule v2 (task 2.6, CD-P1 to CD-P5).

Hypothesis generates the inputs. The strategies cover every retrieval state, missing values,
temperatures from -80 to +30 C and altitudes 0 to 45,000 ft. All data is synthetic.
"""
import math

import pytest
from hypothesis import given, settings, strategies as st

from src.analysis.evidence import (
    LEVEL_CODE,
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
)

PROP = settings(max_examples=400, deadline=None)

STATES = ["observed", "clear", "quality_rejected", "outside_domain", "no_retrieval", "inconsistent_retrieval"]
NO_EVIDENCE_STATES = [s for s in STATES if s not in ("observed", "clear")]

heights = st.floats(min_value=0, max_value=60000, allow_nan=False, allow_infinity=False)
altitudes = st.floats(min_value=0, max_value=45000, allow_nan=False, allow_infinity=False)
temps_c = st.floats(min_value=-80, max_value=30, allow_nan=False, allow_infinity=False)
rh_pct = st.floats(min_value=0, max_value=100, allow_nan=False, allow_infinity=False)
maybe = lambda s: st.one_of(st.none(), s)  # noqa: E731


@st.composite
def satellites(draw):
    """Satellite dicts: every state, optional top/base/supercooled, base never above top."""
    state = draw(st.sampled_from(STATES))
    top = draw(maybe(heights))
    base = draw(maybe(heights))
    if top is not None and base is not None and base > top:
        base = top
    return {"state": state, "top_ft": top, "base_ft": base, "supercooled": draw(st.sampled_from([True, False, None]))}


forecasts = maybe(st.fixed_dictionaries({"temp_c": maybe(temps_c), "rh_pct": maybe(rh_pct)}))


@st.composite
def isotherm_pairs(draw):
    zero = draw(heights)
    return {"zero_c_ft": zero, "minus20_c_ft": zero + draw(st.floats(0, 20000, allow_nan=False))}


isotherms = maybe(st.one_of(
    isotherm_pairs(),
    st.fixed_dictionaries({"zero_c_ft": maybe(heights), "minus20_c_ft": maybe(heights)}),
))


def has_forecast(forecast):
    return bool(forecast) and forecast_criterion(forecast.get("temp_c"), forecast.get("rh_pct")) is not None


# ---- CD-P1: Not assessed is sticky -----------------------------------------------------------------

@PROP
@given(state=st.sampled_from(NO_EVIDENCE_STATES + [None]), top=maybe(heights), base=maybe(heights),
       sc=st.sampled_from([True, False, None]), alt=altitudes, iso=isotherms,
       fc=maybe(st.fixed_dictionaries({"temp_c": st.none(), "rh_pct": maybe(rh_pct)})))
def test_cd_p1_no_satellite_evidence_and_no_forecast_is_always_not_assessed(state, top, base, sc, alt, iso, fc):
    satellite = None if state is None else {"state": state, "top_ft": top, "base_ft": base, "supercooled": sc}
    assert evaluate_cell(satellite, fc, alt, iso).level == LEVEL_NOT_ASSESSED


@PROP
@given(sc=st.sampled_from([True, False, None]), alt=altitudes, iso=isotherms)
def test_cd_p1_observed_cloud_without_a_top_and_without_forecast_is_not_assessed(sc, alt, iso):
    # An observed cloud whose top is missing is incomplete evidence.
    satellite = {"state": "observed", "top_ft": None, "base_ft": None, "supercooled": sc}
    assert evaluate_cell(satellite, None, alt, iso).level == LEVEL_NOT_ASSESSED


# ---- CD-P2: Observed implies evidence (and the rule is complete for that row) --------------------------

@PROP
@given(sat=satellites(), fc=forecasts, alt=altitudes, iso=isotherms)
def test_cd_p2_observed_requires_satellite_evidence_inside_the_layer(sat, fc, alt, iso):
    out = evaluate_cell(sat, fc, alt, iso)
    if out.level != LEVEL_OBSERVED:
        return
    assert sat["state"] == "observed" and sat["supercooled"] is True
    assert sat["top_ft"] is not None and sat["base_ft"] is not None and iso is not None
    lower = max(sat["base_ft"], iso["zero_c_ft"])
    upper = min(sat["top_ft"], iso["minus20_c_ft"])
    assert lower <= alt <= upper


@PROP
@given(top=st.floats(3000, 40000), base_frac=st.floats(0, 1), zero=st.floats(0, 30000),
       span=st.floats(5000, 15000), data=st.data(), fc=forecasts)
def test_cd_p2_inside_the_candidate_layer_is_always_observed(top, base_frac, zero, span, data, fc):
    base = top * base_frac
    iso = {"zero_c_ft": zero, "minus20_c_ft": zero + span}
    lower, upper = max(base, zero), min(top, zero + span)
    if lower > upper:
        return
    alt = data.draw(st.floats(lower, upper))
    sat = {"state": "observed", "top_ft": top, "base_ft": base, "supercooled": True}
    assert evaluate_cell(sat, fc, alt, iso).level == LEVEL_OBSERVED


@PROP
@given(sat=satellites(), fc=forecasts, alt=altitudes, iso=isotherms)
def test_cd_p2_possible_is_forecast_only_and_never_beats_observed(sat, fc, alt, iso):
    out = evaluate_cell(sat, fc, alt, iso)
    if out.level == LEVEL_POSSIBLE:
        assert sat["state"] != "clear"
        assert forecast_criterion(fc["temp_c"], fc["rh_pct"]) is True


# ---- CD-P3: layer containment ----------------------------------------------------------------------------

@PROP
@given(base=maybe(heights), top=heights, zero=heights, span=st.floats(0, 20000, allow_nan=False))
def test_cd_p3_candidate_layer_is_inside_the_cloud_and_between_the_isotherms(base, top, zero, span):
    minus20 = zero + span
    layer = candidate_layer(base, top, zero, minus20)
    if layer["lower_ft"] is None:
        assert layer["upper_ft"] is None and layer["reason"] != "ok"
        return
    assert layer["reason"] == "ok"
    assert layer["lower_ft"] <= layer["upper_ft"] <= top
    assert layer["lower_ft"] >= zero and layer["upper_ft"] <= minus20
    if base is not None:
        assert layer["lower_ft"] >= base


# ---- CD-P4: isotherm ordering ------------------------------------------------------------------------------

profiles = st.lists(
    st.tuples(st.floats(0, 60000, allow_nan=False), st.floats(-80, 40, allow_nan=False)),
    min_size=0, max_size=14,
)


@PROP
@given(levels=profiles)
def test_cd_p4_minus20_is_never_below_zero_for_any_profile(levels):
    out = isotherm_heights_from_profile(levels)
    if out["zero_c_ft"] is None:
        assert out["minus20_c_ft"] is None and out["method"] == "unavailable"
        return
    assert out["minus20_c_ft"] >= out["zero_c_ft"]
    assert out["method"] in ("ifs_profile", "ifs_profile_extrapolated")
    assert all(math.isfinite(out[k]) for k in ("zero_c_ft", "minus20_c_ft"))


@PROP
@given(top=heights, ctt=st.floats(-90, 30, allow_nan=False))
def test_cd_p4_cloud_top_isotherms_are_ordered_and_ten_thousand_feet_apart(top, ctt):
    out = isotherm_heights_from_cloud_top(top, ctt)
    assert out["minus20_c_ft"] > out["zero_c_ft"]
    assert out["minus20_c_ft"] - out["zero_c_ft"] == pytest.approx(20.0 / 1.98 * 1000.0)


@PROP
@given(top=heights, ctt=st.floats(-90, 30, allow_nan=False), bump=st.floats(0.01, 40))
def test_cd_p4_a_colder_cloud_top_lowers_both_isotherms(top, ctt, bump):
    warmer = isotherm_heights_from_cloud_top(top, ctt + bump)
    colder = isotherm_heights_from_cloud_top(top, ctt)
    assert colder["zero_c_ft"] < warmer["zero_c_ft"] and colder["minus20_c_ft"] < warmer["minus20_c_ft"]


# ---- CD-P5: summary conservation ----------------------------------------------------------------------------

@PROP
@given(levels=st.lists(st.sampled_from(LEVELS), min_size=0, max_size=200), step=st.floats(1, 50),
       extra=st.one_of(st.none(), st.floats(0, 49)))
def test_cd_p5_summary_covers_the_route_exactly_once(levels, step, extra):
    n = len(levels)
    total = None if (extra is None or n == 0) else (n - 1) * step + extra
    out = route_summary(levels, step, total_km=total)
    assert set(out) == set(LEVELS)
    expected_total = 0.0 if n == 0 else (total if total is not None else n * step)
    assert abs(sum(v["km"] for v in out.values()) - expected_total) < 1e-6
    pieces = sorted((seg[0], seg[1], name) for name, v in out.items() for seg in v["segments"])
    if n == 0:
        assert pieces == []
        return
    assert pieces[0][0] == 0.0 and abs(pieces[-1][1] - expected_total) < 1e-6
    for (s0, e0, name0), (s1, e1, name1) in zip(pieces, pieces[1:]):
        assert abs(e0 - s1) < 1e-9, "segments leave a gap or overlap"
        assert name0 != name1, "adjacent segments of one level must be merged"
    for name, v in out.items():
        assert abs(sum(e - s for s, e in v["segments"]) - v["km"]) < 1e-6


# ---- Determinism and closure ----------------------------------------------------------------------------------------

@PROP
@given(sat=maybe(satellites()), fc=forecasts, alt=altitudes, iso=isotherms)
def test_evaluate_cell_is_deterministic_and_stays_in_the_four_levels(sat, fc, alt, iso):
    first = evaluate_cell(sat, fc, alt, iso)
    assert first == evaluate_cell(sat, fc, alt, iso)
    assert first.level in LEVEL_CODE and first.reason
    assert first.level in (LEVEL_NOT_ASSESSED, LEVEL_NOT_INDICATED, LEVEL_POSSIBLE, LEVEL_OBSERVED)


@PROP
@given(sat=satellites(), fc=forecasts, alt=altitudes, iso=isotherms)
def test_a_nan_value_behaves_exactly_like_a_missing_value(sat, fc, alt, iso):
    nan = float("nan")
    with_nan = dict(sat, base_ft=nan if sat["base_ft"] is not None else None)
    with_none = dict(sat, base_ft=None)
    if sat["base_ft"] is not None:
        assert evaluate_cell(with_nan, fc, alt, iso) == evaluate_cell(with_none, fc, alt, iso)
