"""Cloud Dive game core (Python reference of `static/cloud-dive/engine.js`).

Pure functions and frozen state; no I/O, no clock, no randomness (requirement R2.8). A flight is
`n_steps` segments of `step_km`; segment `s` is flown in the cell `(lane, s, alt)` chosen by the
move made at the start of that segment (at most one lane and 1,000 ft toward the targets).

Ice index: integer 0..100, raised only while anti-ice is off in a cell whose precomputed
`ice_gain` is positive; it never decreases; at 100 the flight ends as a forced diversion
(not ranked). Fuel cost per segment (see design section 5):

    iceTerm = (ice/100) ** iceExponent
    TAS     = tas[alt] * (1 - speedLossAtFull * iceTerm)
    GS      = max(TAS - headwind, minGroundSpeed)
    flow    = flow[alt] * (antiIceFactor if anti-ice) * (1 + dragFlowAtFull * iceTerm)
    cost    = flow * hours * price  (+ climb extra per 1,000 ft climbed, + detour for lane changes)

split into non-negative components: base, antiIce, ice, climb, detour (+ diversion).
All numbers are illustrative game values (science guardrails, amendment of 2026-11-13).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field, replace
from typing import Sequence

import numpy as np

from src.analysis.cost_model import Params

NOT_ASSESSED, NOT_INDICATED, POSSIBLE, OBSERVED = 0, 1, 2, 3
N_LEVELS = 4
ICE_MAX = 100
LOOKAHEAD_STEPS = 3
COMPONENTS = ("base", "antiIce", "ice", "climb", "detour")


def _round_half_up(x):
    return np.floor(np.asarray(x, dtype=float) + 0.5).astype(int)


def compute_ice_gain(evidence, temp_c, lwp, params: Params) -> np.ndarray:
    """Integer ice gain per step for every cell `[lane][step][alt]` with anti-ice off.

    gain = round(baseGain * tempFactor(T) * waterFactor(LWP) * rateFactor); rate 1 for Observed,
    possibleRateFactor for Possible, 0 otherwise. `temp_c` may hold NaN (factor 0.5); `lwp`
    `[lane][step]` may hold NaN (factor 1) and is used for Observed cells only.
    """
    ev = np.asarray(evidence)
    t = np.asarray(temp_c, dtype=float)
    temp_factor = np.where(np.isnan(t), 0.5, np.maximum(0.0, 1.0 - np.abs(np.nan_to_num(t) + 10.0) / 10.0))
    w = np.asarray(lwp, dtype=float)[:, :, None]
    water = np.where(np.isnan(w) | (ev != OBSERVED), 1.0, np.minimum(1.5, 0.5 + np.nan_to_num(w) / 100.0))
    rate = np.where(ev == OBSERVED, 1.0, np.where(ev == POSSIBLE, params.possible_rate_factor, 0.0))
    return _round_half_up(params.base_gain * temp_factor * water * rate)


@dataclass(frozen=True)
class Case:
    """Everything the engine and solver need. Arrays are `[lane][step][alt]`."""

    step_km: float
    distance_km: float
    lanes_km: tuple
    alts_ft: tuple
    evidence: np.ndarray
    headwind_kt: np.ndarray
    ice_gain: np.ndarray
    params: Params
    start_lane: int
    start_alt: int  # index into alts_ft

    @property
    def n_lanes(self) -> int:
        return len(self.lanes_km)

    @property
    def n_alts(self) -> int:
        return len(self.alts_ft)

    @property
    def n_steps(self) -> int:
        return math.ceil(self.distance_km / self.step_km - 1e-9)

    def segment_km(self, s: int) -> float:
        return min(self.step_km, self.distance_km - s * self.step_km)

    def table(self, name: str) -> np.ndarray:
        p = self.params
        src = {"tas": p.tas_kt_by_alt, "flow": p.flow_kg_h_by_alt, "climb": p.climb_extra_kg_per_1000ft_by_alt}[name]
        return np.array([src[int(a)] for a in self.alts_ft], dtype=float)


def make_case(*, step_km, distance_km, lanes_km, alts_ft, evidence, headwind_kt, temp_c, lwp, params,
              start_lane, start_alt) -> Case:
    ev = np.asarray(evidence, dtype=np.uint8)
    gain = compute_ice_gain(ev, temp_c, lwp, params)
    case = Case(float(step_km), float(distance_km), tuple(float(v) for v in lanes_km),
                tuple(int(a) for a in alts_ft), ev, np.asarray(headwind_kt, dtype=float), gain,
                params, int(start_lane), int(start_alt))
    expected = (case.n_lanes, case.n_steps + 1, case.n_alts)
    for name in ("evidence", "headwind_kt", "ice_gain"):
        if getattr(case, name).shape != expected:
            raise ValueError(f"{name} must have shape {expected}")
    return case


# ---------------------------------------------------------------------------------------------
# Cost of one segment (works on scalars and broadcastable arrays)
# ---------------------------------------------------------------------------------------------

def cost_components(case: Case, s, lane_from, lane_to, alt_from, alt_to, anti_ice, ice) -> dict:
    """Dollar components of segment `s` flown in cell (lane_to, s, alt_to) after moving from
    (lane_from, alt_from). `ice` is the index before the segment; all arguments may be arrays."""
    p = case.params
    tas0 = case.table("tas")[alt_to]
    flow0 = case.table("flow")[alt_to]
    hw = case.headwind_kt[lane_to, s, alt_to]
    d = case.segment_km(s) if np.ndim(s) == 0 else np.array([case.segment_km(int(v)) for v in s])
    ice_term = (np.asarray(ice, dtype=float) / ICE_MAX) ** p.ice_exponent
    ai = np.asarray(anti_ice, dtype=bool)
    ai_factor = np.where(ai, p.anti_ice_factor, 1.0)

    gs0 = np.maximum(tas0 - hw, p.min_ground_speed_kt)
    hours0 = d / (gs0 * 1.852)
    c0 = flow0 * hours0 * p.fuel_usd_per_kg
    c1 = flow0 * ai_factor * hours0 * p.fuel_usd_per_kg

    tas = tas0 * (1.0 - p.speed_loss_at_full * ice_term)
    gs = np.maximum(tas - hw, p.min_ground_speed_kt)
    hours = d / (gs * 1.852)
    flow = flow0 * ai_factor * (1.0 + p.drag_flow_at_full * ice_term)
    c2 = flow * hours * p.fuel_usd_per_kg

    lanes = np.array(case.lanes_km)
    lateral = np.abs(lanes[lane_to] - lanes[lane_from])
    extra_km = np.where(lateral > 0, np.hypot(case.step_km, lateral) - case.step_km, 0.0)
    detour = flow * (extra_km / (gs * 1.852)) * p.fuel_usd_per_kg
    climbed = np.where(np.asarray(alt_to) > np.asarray(alt_from), 1.0, 0.0)  # one level per segment
    climb = case.table("climb")[alt_to] * climbed * p.fuel_usd_per_kg
    return {
        "base": c0, "antiIce": c1 - c0, "ice": np.maximum(c2 - c1, 0.0), "climb": climb, "detour": detour,
        "hours": hours,
    }


# ---------------------------------------------------------------------------------------------
# State and stepping
# ---------------------------------------------------------------------------------------------

@dataclass(frozen=True)
class State:
    step: int
    lane: int
    alt: int
    target_lane: int
    target_alt: int
    anti_ice: bool
    ice: int = 0
    cost: tuple = (0.0,) * len(COMPONENTS)  # base, antiIce, ice, climb, detour (USD)
    km_per_level: tuple = (0.0,) * N_LEVELS
    anti_ice_km: float = 0.0
    minutes: float = 0.0
    minutes_anti_ice: float = 0.0
    prev_level: int | None = None  # level of the last cell flown
    prev2_level: int | None = None
    announced_entry: int | None = None  # first Possible/Observed cell index of the last entry gate
    status: str = "flying"  # flying | arrived | diverted
    events: tuple = field(default=(), compare=False)

    def total_usd(self, case: Case) -> float:
        extra = case.params.diversion_usd if self.status == "diverted" else 0.0
        return float(sum(self.cost)) + extra

    @property
    def distance_km(self) -> float:
        return float(sum(self.km_per_level))


def initial_state(case: Case, anti_ice: bool = False) -> State:
    return State(0, case.start_lane, case.start_alt, case.start_lane, case.start_alt, bool(anti_ice))


def _toward(cur: int, target: int) -> int:
    return cur + (target > cur) - (target < cur)


def set_targets(case: Case, state: State, lane: int | None = None, alt: int | None = None,
                anti_ice: bool | None = None) -> State:
    """Player action: new target lane/altitude (clamped to the corridor/block) and anti-ice switch."""
    tl = state.target_lane if lane is None else min(max(int(lane), 0), case.n_lanes - 1)
    ta = state.target_alt if alt is None else min(max(int(alt), 0), case.n_alts - 1)
    return replace(state, target_lane=tl, target_alt=ta,
                   anti_ice=state.anti_ice if anti_ice is None else bool(anti_ice))


def step(case: Case, state: State) -> State:
    """Fly one segment."""
    if state.status != "flying":
        return state
    s = state.step
    lane, alt = _toward(state.lane, state.target_lane), _toward(state.alt, state.target_alt)
    level = int(case.evidence[lane, s, alt])
    comp = cost_components(case, s, state.lane, lane, state.alt, alt, state.anti_ice, state.ice)
    gain = 0 if state.anti_ice else int(case.ice_gain[lane, s, alt])
    ice = min(ICE_MAX, state.ice + gain)
    d = case.segment_km(s)
    hours = float(comp["hours"])
    km = list(state.km_per_level)
    km[level] += d
    status = "diverted" if ice >= ICE_MAX else ("arrived" if s + 1 >= case.n_steps else "flying")
    return replace(
        state, step=s + 1, lane=lane, alt=alt, ice=ice,
        cost=tuple(float(state.cost[i] + comp[name]) for i, name in enumerate(COMPONENTS)),
        km_per_level=tuple(km), anti_ice_km=state.anti_ice_km + (d if state.anti_ice else 0.0),
        minutes=state.minutes + hours * 60.0,
        minutes_anti_ice=state.minutes_anti_ice + (hours * 60.0 if state.anti_ice else 0.0),
        prev2_level=state.prev_level, prev_level=level, status=status,
        events=({"step": s, "lane": lane, "alt": alt, "level": level, "iceGain": gain, "iceAfter": ice},),
    )


# ---------------------------------------------------------------------------------------------
# Gates
# ---------------------------------------------------------------------------------------------

def _is_icing_level(level) -> bool:
    return level in (POSSIBLE, OBSERVED)


def lookahead_levels(case: Case, state: State, n: int = LOOKAHEAD_STEPS) -> list[int]:
    """Levels of the next `n` cells when the aircraft keeps the current targets and anti-ice."""
    lane, alt, out = state.lane, state.alt, []
    for i in range(n):
        s = state.step + i
        if s >= case.n_steps:
            break
        lane, alt = _toward(lane, state.target_lane), _toward(alt, state.target_alt)
        out.append(int(case.evidence[lane, s, alt]))
    return out


def entry_index(case: Case, state: State) -> int | None:
    """Index of the first Possible/Observed cell within the lookahead, when the aircraft is not
    already in such a cell; otherwise None."""
    if _is_icing_level(state.prev_level):
        return None
    for i, level in enumerate(lookahead_levels(case, state)):
        if _is_icing_level(level):
            return state.step + i
    return None


def gate_reason(case: Case, state: State) -> str | None:
    """'entry' (cloud within 3 steps), 'exit' (first step outside with anti-ice on) or None."""
    if state.status != "flying":
        return None
    exited = (state.anti_ice and not _is_icing_level(state.prev_level) and _is_icing_level(state.prev2_level)
              and state.prev_level is not None)
    if exited:
        return "exit"
    idx = entry_index(case, state)
    if idx is not None and idx != state.announced_entry:
        return "entry"
    return None


def run_until_gate(case: Case, state: State, *, check_start: bool = True) -> tuple[State, str]:
    """Fast-forward until a gate or the end of the flight. Always flies at least one segment,
    except that a gate at the very start of a flight (step 0) is reported first.

    Returns (state, reason) with reason 'entry' | 'exit' | 'arrived' | 'diverted'.
    """
    if check_start and state.step == 0 and state.status == "flying":
        reason = gate_reason(case, state)
        if reason:
            return _announce(case, state, reason), reason
    while True:
        state = step(case, state)
        if state.status != "flying":
            return state, state.status
        reason = gate_reason(case, state)
        if reason:
            return _announce(case, state, reason), reason


def _announce(case: Case, state: State, reason: str) -> State:
    if reason == "entry":
        return replace(state, announced_entry=entry_index(case, state))
    return replace(state, announced_entry=None)


def summary(case: Case, state: State) -> dict:
    """Report numbers for a finished (or running) flight."""
    parts = dict(zip(COMPONENTS, state.cost))
    parts["diversion"] = case.params.diversion_usd if state.status == "diverted" else 0.0
    return {
        "status": state.status, "ranked": state.status == "arrived",
        "totalUsd": state.total_usd(case), "components": parts, "icePeak": state.ice,
        "minutesAntiIce": state.minutes_anti_ice, "antiIceKm": state.anti_ice_km,
        "kmPerLevel": list(state.km_per_level), "distanceKm": state.distance_km,
    }


def fly_policy(case: Case, actions: Sequence[tuple]) -> State:
    """Fly a fixed per-segment policy `[(lane, alt, anti_ice), ...]` (targets set every step)."""
    state = initial_state(case)
    for lane, alt, ai in actions:
        if state.status != "flying":
            break
        state = step(case, set_targets(case, state, lane, alt, ai))
    return state
