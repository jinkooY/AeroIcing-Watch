"""Unit tests for the Cloud Dive game core on SYNTHETIC cases."""
import dataclasses

import numpy as np
import pytest

from src.analysis.game_core import (
    NOT_INDICATED, OBSERVED, POSSIBLE, compute_ice_gain, cost_components, fly_policy, gate_reason,
    initial_state, lookahead_levels, make_case, run_until_gate, set_targets, step, summary,
)
from tests.game_synthetic import ALTS, synthetic_case, synthetic_params


def flat_case(level_at=None, n_steps=12, hw=0.0, params=None, ice_gain=None, **kw):
    """Uniform case: every cell NOT_INDICATED except those listed in level_at[(lane, step, alt)]."""
    L, A = 5, len(ALTS)
    ev = np.full((L, n_steps + 1, A), NOT_INDICATED, dtype=np.uint8)
    for (lane, s, alt), level in (level_at or {}).items():
        ev[lane, s, alt] = level
    case = make_case(
        step_km=10.0, distance_km=10.0 * n_steps, lanes_km=(-30, -15, 0, 15, 30), alts_ft=ALTS, evidence=ev,
        headwind_kt=np.full(ev.shape, hw), temp_c=np.full(ev.shape, -10.0), lwp=np.full((L, n_steps + 1), np.nan),
        params=params or synthetic_params(), start_lane=2, start_alt=1, **kw,
    )
    if ice_gain is not None:
        case = dataclasses.replace(case, ice_gain=np.full(ev.shape, ice_gain, dtype=int) * (ev == OBSERVED))
    return case


# -- ice gain -----------------------------------------------------------------------------------

def test_ice_gain_fixed_numbers_synthetic():
    p = synthetic_params()
    ev = np.array([[[OBSERVED, OBSERVED, POSSIBLE, NOT_INDICATED, OBSERVED]]])
    temp = np.array([[[-10.0, -10.0, -5.0, -10.0, 5.0]]])
    lwp = np.array([[100.0]])
    # Observed at the peak with LWP 100: 7 * 1 * 1.5 = 10.5 -> 11 (half rounds up)
    # Possible at -5 C: 7 * 0.5 * 1 * 0.25 = 0.875 -> 1; warm cell: temperature factor 0
    assert compute_ice_gain(ev, temp, lwp, p).tolist() == [[[11, 11, 1, 0, 0]]]


def test_ice_gain_missing_temperature_and_water_synthetic():
    p = synthetic_params()
    ev = np.array([[[OBSERVED]]])
    assert compute_ice_gain(ev, np.array([[[np.nan]]]), np.array([[np.nan]]), p).tolist() == [[[4]]]  # 7*0.5 = 3.5 -> 4


# -- cost ---------------------------------------------------------------------------------------

def test_cost_formula_fixed_numbers_synthetic():
    case = flat_case(hw=20.0)
    tas, flow, price = 278.0, 1790.0, 0.79  # level 1 (7,000 ft) of synthetic_params
    c = cost_components(case, 0, 2, 2, 1, 1, False, 0)
    hours = 10.0 / ((tas - 20.0) * 1.852)
    assert float(c["base"]) == pytest.approx(flow * hours * price)
    assert float(c["antiIce"]) == 0.0 and float(c["ice"]) == 0.0 and float(c["climb"]) == 0.0 and float(c["detour"]) == 0.0
    ai = cost_components(case, 0, 2, 2, 1, 1, True, 0)
    assert float(ai["antiIce"]) == pytest.approx(flow * 0.08 * hours * price)
    iced = cost_components(case, 0, 2, 2, 1, 1, False, 50)
    term = 0.5 ** 1.5
    hours_i = 10.0 / ((tas * (1 - 0.12 * term) - 20.0) * 1.852)
    expected = flow * (1 + 0.20 * term) * hours_i * price
    assert float(iced["base"] + iced["ice"]) == pytest.approx(expected)


def test_climb_lane_change_and_no_descent_credit_synthetic():
    case = flat_case()
    up = cost_components(case, 0, 2, 2, 1, 2, False, 0)
    down = cost_components(case, 0, 2, 2, 2, 1, False, 0)
    assert float(up["climb"]) == pytest.approx(10.0 * 0.79) and float(down["climb"]) == 0.0
    lane = cost_components(case, 0, 2, 3, 1, 1, False, 0)
    extra_km = np.hypot(10.0, 15.0) - 10.0
    assert extra_km == pytest.approx(8.0277, abs=1e-3)
    flow, tas = 1790.0, 278.0
    assert float(lane["detour"]) == pytest.approx(flow * extra_km / (tas * 1.852) * 0.79)


def test_ground_speed_floor_synthetic():
    case = flat_case(hw=900.0)
    c = cost_components(case, 0, 2, 2, 1, 1, False, 0)
    assert float(c["hours"]) == pytest.approx(10.0 / (120.0 * 1.852))


# -- stepping -----------------------------------------------------------------------------------

def test_step_moves_one_lane_and_one_level_toward_targets_synthetic():
    case = flat_case()
    s = set_targets(case, initial_state(case), lane=0, alt=6)
    s = step(case, s)
    assert (s.lane, s.alt) == (1, 2)
    s = step(case, s)
    assert (s.lane, s.alt) == (0, 3)
    s = step(case, s)
    assert (s.lane, s.alt) == (0, 4)


def test_targets_are_clamped_synthetic():
    case = flat_case()
    s = set_targets(case, initial_state(case), lane=99, alt=-5)
    assert (s.target_lane, s.target_alt) == (4, 0)


def test_flight_arrives_and_distance_is_conserved_synthetic():
    case = synthetic_case(3, n_steps=12, last_km=4.0)
    state = fly_policy(case, [(2, 1, False)] * 12)
    assert state.status == "arrived" and state.step == 12
    assert state.distance_km == pytest.approx(case.distance_km)
    assert state.distance_km == pytest.approx(11 * 10.0 + 4.0)


def test_ice_rises_only_without_anti_ice_and_diverts_at_100_synthetic():
    case = flat_case(level_at={(2, s, 1): OBSERVED for s in range(12)}, ice_gain=30)
    on = fly_policy(case, [(2, 1, True)] * 12)
    assert on.ice == 0 and on.status == "arrived"
    off = fly_policy(case, [(2, 1, False)] * 12)
    assert off.status == "diverted" and off.ice == 100 and off.step == 4
    assert summary(case, off)["ranked"] is False


def test_diversion_cost_is_added_but_unranked_synthetic():
    case = flat_case(level_at={(2, s, 1): OBSERVED for s in range(12)}, ice_gain=60,
                     params=synthetic_params(diversion_usd=500.0))
    off = fly_policy(case, [(2, 1, False)] * 12)
    assert off.status == "diverted"
    assert off.total_usd(case) == pytest.approx(sum(off.cost) + 500.0)
    assert summary(case, off)["components"]["diversion"] == 500.0


# -- gates --------------------------------------------------------------------------------------

def test_entry_gate_three_steps_ahead_synthetic():
    case = flat_case(level_at={(2, 5, 1): OBSERVED, (2, 6, 1): OBSERVED})
    state, reason = run_until_gate(case, initial_state(case))
    assert reason == "entry" and state.step == 3  # cell 5 is within steps 3..5
    assert lookahead_levels(case, state) == [NOT_INDICATED, NOT_INDICATED, OBSERVED]


def test_no_gate_without_cloud_reaches_arrival_synthetic():
    case = flat_case()
    state, reason = run_until_gate(case, initial_state(case))
    assert reason == "arrived" and state.status == "arrived"


def test_gate_at_flight_start_when_cloud_is_already_ahead_synthetic():
    case = flat_case(level_at={(2, 1, 1): POSSIBLE})
    state, reason = run_until_gate(case, initial_state(case))
    assert reason == "entry" and state.step == 0


def test_continue_does_not_regate_for_the_same_cloud_and_exit_gate_fires_with_anti_ice_synthetic():
    case = flat_case(level_at={(2, s, 1): OBSERVED for s in (5, 6)})
    state, reason = run_until_gate(case, initial_state(case))
    assert reason == "entry"
    state = set_targets(case, state, anti_ice=True)
    state, reason = run_until_gate(case, state)
    assert reason == "exit" and state.step == 8 and state.ice == 0  # first cell after the cloud


def test_no_exit_gate_with_anti_ice_off_synthetic():
    case = flat_case(level_at={(2, s, 1): POSSIBLE for s in (5, 6)})
    state, _ = run_until_gate(case, initial_state(case))
    state, reason = run_until_gate(case, state)
    assert reason == "arrived"


def test_lookahead_follows_current_targets_synthetic():
    case = flat_case(level_at={(0, 2, 1): OBSERVED})
    state = initial_state(case)
    assert gate_reason(case, state) is None
    moving = set_targets(case, state, lane=0)
    # lane 2 -> 1 (step 0) -> 0 (step 1) -> 0 (step 2): the third cell is the Observed one
    assert lookahead_levels(case, moving) == [NOT_INDICATED, NOT_INDICATED, OBSERVED]
    assert gate_reason(case, moving) == "entry"
