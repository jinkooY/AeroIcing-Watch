import math

import pytest
from hypothesis import given, settings, strategies as st

from src.analysis.lanes import GEOD, build_lanes

JFK = (40.6398, -73.7789)
BNA = (36.1245, -86.6782)


def test_jfk_bna_step_count():
    lanes = build_lanes(*JFK, *BNA)
    assert 1200 < lanes.distance_km < 1260
    assert lanes.n_steps == math.ceil(lanes.distance_km / 10.0)
    assert lanes.lat.shape == (5, lanes.n_steps + 1)


def test_centre_lane_hits_endpoints():
    lanes = build_lanes(*JFK, *BNA)
    assert lanes.lat[2][0] == pytest.approx(JFK[0], abs=1e-6)
    assert lanes.lon[2][-1] == pytest.approx(BNA[1], abs=1e-6)
    assert lanes.lat[2][-1] == pytest.approx(BNA[0], abs=1e-6)


def test_offsets_are_perpendicular_distance_and_right_positive():
    lanes = build_lanes(*JFK, *BNA)
    k = lanes.n_steps // 2
    for i, off in enumerate(lanes.lanes_km):
        _, _, d = GEOD.inv(lanes.lon[2][k], lanes.lat[2][k], lanes.lon[i][k], lanes.lat[i][k])
        assert d / 1000.0 == pytest.approx(abs(off), abs=0.01)
        if off:
            az, _, _ = GEOD.inv(lanes.lon[2][k], lanes.lat[2][k], lanes.lon[i][k], lanes.lat[i][k])
            expected = (lanes.azimuth_deg[k] + (90 if off > 0 else -90)) % 360
            assert abs((az - expected + 180) % 360 - 180) < 0.01


def test_rejects_bad_input():
    with pytest.raises(ValueError):
        build_lanes(*JFK, *BNA, step_km=0)
    with pytest.raises(ValueError):
        build_lanes(*JFK, *JFK)


@settings(max_examples=60, deadline=None)
@given(
    st.floats(25, 49), st.floats(-120, -70), st.floats(25, 49), st.floats(-120, -70),
    st.sampled_from([5.0, 10.0, 20.0]),
)
def test_cd_p13_step_count_and_spacing(a, b, c, d, step):
    if GEOD.inv(b, a, d, c)[2] < 50_000:
        return
    lanes = build_lanes(a, b, c, d, step_km=step)
    assert lanes.n_steps == math.ceil(lanes.distance_km / step - 1e-9)
    # consecutive centre points are `step` apart except possibly the last
    for k in range(lanes.n_steps - 1):
        _, _, dm = GEOD.inv(lanes.lon[2][k], lanes.lat[2][k], lanes.lon[2][k + 1], lanes.lat[2][k + 1])
        assert dm / 1000.0 == pytest.approx(step, abs=0.01)
    assert lanes.lat[2][-1] == pytest.approx(c, abs=1e-5)
