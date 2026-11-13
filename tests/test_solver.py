"""Solver tests on SYNTHETIC cases: exactness against brute force, P12, P16, P17, balance."""
from itertools import product

import numpy as np
import pytest
from hypothesis import given, settings, strategies as st

from src.analysis.game_core import (
    OBSERVED, POSSIBLE, fly_policy, initial_state, set_targets, step,
)
from src.analysis.solver import ACTIONS, _solve, balance, solve_references, straight_ahead_policy
from tests.game_synthetic import ALTS, synthetic_case, synthetic_params


def tiny_case(seed, **kw):
    params = synthetic_params(ALTS[:3], base_gain=kw.pop("base_gain", 25.0))
    return synthetic_case(seed, n_steps=3, lanes_km=(-15.0, 0.0, 15.0), alts=ALTS[:3], cloud=0.9, wind=40.0,
                          params=params, start_alt=1, **kw)


def brute_force(case):
    """All policies of per-segment (lane, alt, anti-ice) choices that respect one move per step."""
    completed = []
    for combo in product(range(len(ACTIONS)), repeat=case.n_steps):
        lane, alt, policy = case.start_lane, case.start_alt, []
        for k in combo:
            dl, da, ai = ACTIONS[k]
            lane, alt = lane + dl, alt + da
            if not (0 <= lane < case.n_lanes and 0 <= alt < case.n_alts):
                policy = None
                break
            policy.append((lane, alt, ai))
        if policy is None:
            continue
        final = fly_policy(case, policy)
        if final.status == "arrived":
            completed.append((final.total_usd(case), final))
    return completed


@pytest.mark.parametrize("seed", [1, 2, 3, 4])
def test_dp_matches_brute_force_minimum_and_maximum_synthetic(seed):
    case = tiny_case(seed)
    costs = [c for c, _ in brute_force(case)]
    assert costs, "synthetic case must have completed flights"
    refs = solve_references(case)
    assert refs["best"].cost_usd == pytest.approx(min(costs), rel=1e-12)
    assert refs["wasteful"].cost_usd == pytest.approx(max(costs), rel=1e-12)


def test_dp_value_equals_simulated_cost_of_its_policy_synthetic():
    case = synthetic_case(7, n_steps=20, cloud=0.8)
    V, _ = _solve(case, maximize=False, allow_ai=(False, True))
    best = solve_references(case)["best"]
    assert float(V[0][case.start_lane, case.start_alt, 0]) == pytest.approx(best.cost_usd, rel=1e-12)
    assert best.completed and best.summary["ranked"]


def test_forced_variants_synthetic():
    case = synthetic_case(5, n_steps=24, cloud=0.9, params=synthetic_params(base_gain=20.0))
    refs = solve_references(case)
    assert all(a for _, _, a in refs["best_always_anti_ice"].policy)
    assert not any(a for _, _, a in refs["best_no_anti_ice"].policy)


def test_unwinnable_without_anti_ice_is_reported_not_completed_synthetic():
    # Observed everywhere at every lane and altitude with a big gain: only anti-ice can finish.
    case = synthetic_case(1, n_steps=10, params=synthetic_params(base_gain=60.0))
    ev = np.full(case.evidence.shape, OBSERVED, dtype=np.uint8)
    import dataclasses
    from src.analysis.game_core import compute_ice_gain
    case = dataclasses.replace(case, evidence=ev, ice_gain=compute_ice_gain(ev, np.full(ev.shape, -10.0), np.full(ev.shape[:2], np.nan), case.params))
    refs = solve_references(case)
    assert refs["best_no_anti_ice"].completed is False and refs["best_no_anti_ice"].cost_usd is None
    # Best may spend the first segment without anti-ice (index 60 < 100), so it can undercut always-on
    assert refs["best"].completed and refs["best"].cost_usd <= refs["best_always_anti_ice"].cost_usd
    assert balance(refs)["B2"] is True


PROP = settings(max_examples=40, deadline=None)


@PROP
@given(seed=st.integers(0, 5000), rnd=st.integers(0, 10**6))
def test_cd_p12_best_le_random_policy_le_wasteful(seed, rnd):
    case = synthetic_case(seed, n_steps=18, cloud=0.7, params=synthetic_params(base_gain=15.0))
    refs = solve_references(case)
    rng = np.random.RandomState(rnd)
    state = initial_state(case)
    while state.status == "flying":
        state = step(case, set_targets(case, state, int(rng.randint(0, 5)), int(rng.randint(0, 8)), bool(rng.rand() < 0.5)))
    if state.status == "arrived":
        cost = state.total_usd(case)
        assert refs["best"].cost_usd <= cost + 1e-9 <= refs["wasteful"].cost_usd + 2e-9


@PROP
@given(seed=st.integers(0, 5000))
def test_cd_p16_straight_ahead_equals_the_fixed_policy(seed):
    case = synthetic_case(seed, n_steps=20, cloud=0.7)
    ref = solve_references(case)["straight_ahead"]
    # independent re-implementation: hold lane/altitude, anti-ice exactly while the cell is Possible/Observed
    state = initial_state(case)
    while state.status == "flying":
        icing = int(case.evidence[case.start_lane, state.step, case.start_alt]) in (POSSIBLE, OBSERVED)
        state = step(case, set_targets(case, state, case.start_lane, case.start_alt, icing))
    assert ref.cost_usd == pytest.approx(state.total_usd(case), rel=1e-12)
    assert ref.policy == straight_ahead_policy(case)
    assert state.ice == 0 and state.status == "arrived"


@PROP
@given(seed=st.integers(0, 5000))
def test_cd_p17_restricted_solvers_are_never_cheaper_than_best(seed):
    case = synthetic_case(seed, n_steps=18, cloud=0.8, params=synthetic_params(base_gain=15.0))
    refs = solve_references(case)
    best = refs["best"]
    assert best.completed
    for name in ("best_no_anti_ice", "best_always_anti_ice"):
        r = refs[name]
        assert (not r.completed) or r.cost_usd >= best.cost_usd - 1e-9
    assert refs["straight_ahead"].cost_usd >= best.cost_usd - 1e-9


def test_balance_flags_are_computed_synthetic():
    refs = solve_references(synthetic_case(11, n_steps=24, cloud=0.9, params=synthetic_params(base_gain=20.0)))
    flags = balance(refs)
    assert set(flags) == {"B1", "B2", "B3", "antiIceKmInBest"}
    assert all(isinstance(flags[k], bool) for k in ("B1", "B2", "B3"))
