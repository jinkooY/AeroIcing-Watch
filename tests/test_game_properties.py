"""Property tests CD-P6 to CD-P11 and CD-P14 on SYNTHETIC cases with random action sequences."""
import numpy as np
from hypothesis import given, settings, strategies as st

from src.analysis.game_core import (
    OBSERVED, POSSIBLE, cost_components, initial_state, run_until_gate, set_targets, step, summary,
)
from tests.game_synthetic import synthetic_case

PROP = settings(max_examples=120, deadline=None)

seeds = st.integers(0, 10_000)
action = st.tuples(st.integers(-1, 5), st.integers(-1, 8), st.booleans())  # may exceed bounds on purpose
actions = st.lists(action, min_size=1, max_size=40)


def case_for(seed, n_steps=24):
    return synthetic_case(seed, n_steps=n_steps, cloud=0.6, last_km=7.0)


def play(case, acts):
    """Single-step play (the player pauses at every step); yields every state."""
    state = initial_state(case)
    yield state
    for lane, alt, ai in acts:
        if state.status != "flying":
            return
        state = step(case, set_targets(case, state, lane, alt, ai))
        yield state


@PROP
@given(seed=seeds, acts=actions)
def test_cd_p6_cost_components_are_non_negative_and_sum_to_total(seed, acts):
    case = case_for(seed)
    prev = 0.0
    for state in play(case, acts):
        assert all(c >= 0.0 for c in state.cost)
        total = state.total_usd(case)
        assert abs(total - (sum(state.cost) + (case.params.diversion_usd if state.status == "diverted" else 0.0))) < 1e-9
        assert total >= prev - 1e-12
        prev = total


@PROP
@given(seed=seeds, s=st.integers(0, 23), lane=st.integers(0, 4), alt=st.integers(0, 7),
       ice=st.integers(0, 99), extra=st.integers(1, 99 - 0))
def test_cd_p8_anti_ice_and_ice_monotonicity(seed, s, lane, alt, ice, extra):
    case = case_for(seed)
    hi = min(99, ice + extra)
    off = cost_components(case, s, lane, lane, alt, alt, False, ice)
    on = cost_components(case, s, lane, lane, alt, alt, True, ice)
    total = lambda c: float(c["base"] + c["antiIce"] + c["ice"] + c["climb"] + c["detour"])  # noqa: E731
    assert total(on) >= total(off) - 1e-12  # anti-ice never lowers the cost (fuel flow)
    worse = cost_components(case, s, lane, lane, alt, alt, False, hi)
    assert total(worse) >= total(off) - 1e-12  # more ice never lowers the cost of a step
    assert float(worse["hours"]) >= float(off["hours"]) - 1e-15  # ... and never raises the speed


@PROP
@given(seed=seeds, acts=actions)
def test_cd_p8_p9_ice_never_decreases_never_rises_with_anti_ice_and_ends_at_100(seed, acts):
    case = case_for(seed)
    previous = None
    for state in play(case, acts):
        if previous is not None:
            assert state.ice >= previous.ice
        assert 0 <= state.ice <= 100
        assert (state.status == "diverted") == (state.ice == 100)
        previous = state


@PROP
@given(seed=seeds, acts=actions)
def test_cd_p8_anti_ice_on_keeps_the_ice_index_unchanged(seed, acts):
    case = case_for(seed)
    state = initial_state(case)
    for lane, alt, _ in acts:
        if state.status != "flying":
            break
        before = state.ice
        state = step(case, set_targets(case, state, lane, alt, True))
        assert state.ice == before


@PROP
@given(seed=seeds, acts=actions)
def test_cd_p10_bounds_and_one_move_per_step(seed, acts):
    case = case_for(seed)
    previous = None
    for state in play(case, acts):
        assert 0 <= state.lane < case.n_lanes and 0 <= state.alt < case.n_alts
        assert 0 <= state.target_lane < case.n_lanes and 0 <= state.target_alt < case.n_alts
        if previous is not None and state.step == previous.step + 1:
            assert abs(state.lane - previous.lane) <= 1 and abs(state.alt - previous.alt) <= 1
        previous = state


@PROP
@given(seed=seeds, acts=actions)
def test_cd_p11_kilometres_per_level_sum_to_the_distance_flown(seed, acts):
    case = case_for(seed)
    for state in play(case, acts):
        flown = sum(case.segment_km(s) for s in range(state.step))
        assert abs(sum(state.km_per_level) - flown) < 1e-9
    if state.status == "arrived":
        assert abs(sum(state.km_per_level) - case.distance_km) < 1e-9
        assert abs(summary(case, state)["distanceKm"] - case.distance_km) < 1e-9


@PROP
@given(seed=seeds, choices=st.lists(st.tuples(st.integers(0, 4), st.integers(0, 7), st.booleans()), min_size=0, max_size=12))
def test_cd_p14_no_silent_entry_into_observed_cells_with_anti_ice_off(seed, choices):
    """Gate-driven play: the player acts only at gates. Every entry into an Observed cell with
    anti-ice off is preceded by a stop within the previous two boundaries or at the boundary of entry."""
    case = case_for(seed, n_steps=30)
    state = initial_state(case)
    stops = [0]
    i = 0
    flown_states = []
    while state.status == "flying":
        lane, alt, ai = choices[i % len(choices)] if choices else (2, 1, False)
        i += 1
        state = set_targets(case, state, lane, alt, ai)
        before = state
        state, reason = run_until_gate(case, state, check_start=(len(stops) == 1 and state.step == 0))
        if reason in ("entry", "exit"):
            stops.append(state.step)
        # replay the segment range to find entries (cells flown between the stops)
        replay = before
        while replay.step < state.step:
            nxt = step(case, replay)
            level = nxt.prev_level
            if level == OBSERVED and not (replay.prev_level in (POSSIBLE, OBSERVED)) and not replay.anti_ice:
                entry = replay.step
                assert any(entry - 2 <= g <= entry for g in stops + [before.step]), (entry, stops)
            replay = nxt
        flown_states.append(state)
        assert len(flown_states) < 200
