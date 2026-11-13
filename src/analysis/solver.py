"""Exact reference solver for Cloud Dive (design section 8).

Dynamic programme over (step, lane, altitude level, ice) with ice 0..99 (100 = diversion, not a
completed flight). Anti-ice can be switched freely each segment, so it is an action, not state.
The transition and the segment cost are the very functions the engine uses
(`game_core.cost_components`, `Case.ice_gain`); the DP only evaluates them on whole arrays.

References produced:
  best                 minimum cost over completed flights
  best_no_anti_ice     same with anti-ice forced off (may not complete)
  best_always_anti_ice same with anti-ice forced on
  wasteful             maximum cost over completed flights ("Wasteful extreme")
  straight_ahead       centre lane, start altitude, anti-ice on exactly in Possible/Observed cells
"""
from __future__ import annotations

from dataclasses import dataclass, field
from itertools import product

import numpy as np

from src.analysis.game_core import (
    ICE_MAX, OBSERVED, POSSIBLE, Case, State, fly_policy, summary,
)

ACTIONS = tuple(product((-1, 0, 1), (-1, 0, 1), (False, True)))  # (dLane, dAlt, antiIce)


@dataclass
class Reference:
    """One solved reference flight."""

    name: str
    completed: bool
    cost_usd: float | None  # None when the restricted problem cannot complete
    policy: list = field(default_factory=list)  # per-segment (lane, alt, antiIce)
    summary: dict | None = None

    def to_dict(self) -> dict:
        return {
            "name": self.name, "completed": self.completed, "costUsd": self.cost_usd,
            "policy": [[int(a), int(b), int(c)] for a, b, c in self.policy], "summary": self.summary,
        }


def _solve(case: Case, *, maximize: bool, allow_ai: tuple[bool, ...]):
    """Value table V[s] over (lane, alt, ice) and the argmin/argmax action index table."""
    L, A, n = case.n_lanes, case.n_alts, case.n_steps
    I = ICE_MAX  # ice 0..99
    bad = -np.inf if maximize else np.inf
    best = np.minimum if not maximize else np.maximum
    V = np.zeros((n + 1, L, A, I))
    choice = np.full((n, L, A, I), -1, dtype=np.int16)
    lane_idx = np.arange(L)[:, None, None]
    alt_idx = np.arange(A)[None, :, None]
    ice = np.arange(I)[None, None, :]
    for s in range(n - 1, -1, -1):
        cur = np.full((L, A, I), bad)
        arg = np.full((L, A, I), -1, dtype=np.int16)
        for k, (dl, da, ai) in enumerate(ACTIONS):
            if ai not in allow_ai:
                continue
            lt = lane_idx + dl
            at = alt_idx + da
            valid = (lt >= 0) & (lt < L) & (at >= 0) & (at < A)
            lt_c = np.clip(lt, 0, L - 1) + np.zeros((L, A, 1), dtype=int)
            at_c = np.clip(at, 0, A - 1) + np.zeros((L, A, 1), dtype=int)
            comp = cost_components_vec(case, s, lane_idx, lt_c, alt_idx, at_c, ai, ice)
            gain = (0 if ai else case.ice_gain[lt_c, s, at_c])
            ice_next = ice + gain
            ok = valid & (ice_next < ICE_MAX)
            nxt = V[s + 1][lt_c, at_c, np.minimum(ice_next, ICE_MAX - 1)]
            total = np.where(ok, comp + nxt, bad)
            better = (total > cur) if maximize else (total < cur)
            better &= np.isfinite(total)
            cur = np.where(better, total, cur)
            arg = np.where(better, k, arg).astype(np.int16)
        V[s] = cur
        choice[s] = arg
    return V, choice


def cost_components_vec(case, s, lane_from, lane_to, alt_from, alt_to, ai, ice):
    from src.analysis.game_core import cost_components

    c = cost_components(case, s, lane_from, lane_to, alt_from, alt_to, ai, ice)
    return c["base"] + c["antiIce"] + c["ice"] + c["climb"] + c["detour"]


def _extract(case: Case, V, choice, name: str) -> Reference:
    start = V[0][case.start_lane, case.start_alt, 0]
    if not np.isfinite(start):
        return Reference(name, False, None)
    lane, alt, ice, policy = case.start_lane, case.start_alt, 0, []
    for s in range(case.n_steps):
        dl, da, ai = ACTIONS[int(choice[s, lane, alt, ice])]
        lane, alt = lane + dl, alt + da
        policy.append((lane, alt, ai))
        ice = ice + (0 if ai else int(case.ice_gain[lane, s, alt]))
    final = fly_policy(case, policy)
    return Reference(name, final.status == "arrived", float(final.total_usd(case)), policy, summary(case, final))


def straight_ahead_policy(case: Case) -> list:
    return [(case.start_lane, case.start_alt, int(case.evidence[case.start_lane, s, case.start_alt]) in (POSSIBLE, OBSERVED))
            for s in range(case.n_steps)]


def solve_references(case: Case) -> dict[str, Reference]:
    """Best, restricted bests, Wasteful extreme and Straight-ahead for a case."""
    out = {}
    for name, ai_opts in (("best", (False, True)), ("best_no_anti_ice", (False,)), ("best_always_anti_ice", (True,))):
        V, choice = _solve(case, maximize=False, allow_ai=ai_opts)
        out[name] = _extract(case, V, choice, name)
    V, choice = _solve(case, maximize=True, allow_ai=(False, True))
    out["wasteful"] = _extract(case, V, choice, "wasteful")
    policy = straight_ahead_policy(case)
    final = fly_policy(case, policy)
    out["straight_ahead"] = Reference("straight_ahead", final.status == "arrived", float(final.total_usd(case)),
                                      policy, summary(case, final))
    return out


def balance(refs: dict[str, Reference]) -> dict:
    """Per-case balance criteria B1..B3 (B4 needs several cases) and the anti-ice km of Best."""
    best, ahead = refs["best"], refs["straight_ahead"]
    b1 = bool(best.completed and ahead.completed and best.cost_usd <= 0.97 * ahead.cost_usd)
    no_ai = refs["best_no_anti_ice"]
    b2 = bool(best.completed and (not no_ai.completed or no_ai.cost_usd >= 1.03 * best.cost_usd))
    all_ai = refs["best_always_anti_ice"]
    b3 = bool(best.completed and all_ai.completed and all_ai.cost_usd >= 1.03 * best.cost_usd)
    ai_km = best.summary["antiIceKm"] if best.summary else 0.0
    return {"B1": b1, "B2": b2, "B3": b3, "antiIceKmInBest": ai_km}
