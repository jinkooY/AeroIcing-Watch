"""Synthetic Cloud Dive cases for tests (SYNTHETIC data; no OpenAP, no weather)."""
from __future__ import annotations

import numpy as np

from src.analysis.cost_model import Params
from src.analysis.game_core import Case, make_case

ALTS = (6000, 7000, 8000, 9000, 10000, 11000, 12000, 13000)


def synthetic_params(alts=ALTS, **over) -> Params:
    tas = {a: 270.0 + (a - 6000) / 1000.0 * 8.0 for a in alts}
    flow = {a: 1800.0 - (a - 6000) / 1000.0 * 10.0 for a in alts}
    climb = {a: 10.0 for a in alts}
    return Params(tas_kt_by_alt=tas, flow_kg_h_by_alt=flow, climb_extra_kg_per_1000ft_by_alt=climb).replace(**over)


def synthetic_case(seed=0, *, n_steps=30, lanes_km=(-30.0, -15.0, 0.0, 15.0, 30.0), alts=ALTS, step_km=10.0,
                   cloud=0.4, wind=25.0, params=None, last_km=None, start_lane=None, start_alt=1) -> Case:
    """Random clouds: each (lane, step) holds a vertical cloud band; levels follow the band."""
    rng = np.random.RandomState(seed)
    L, A = len(lanes_km), len(alts)
    ev = np.ones((L, n_steps + 1, A), dtype=np.uint8)
    temp = np.zeros((L, n_steps + 1, A))
    for lane in range(L):
        for s in range(n_steps + 1):
            for a in range(A):
                temp[lane, s, a] = 10.0 - 2.5 * a - 8.0
    lwp = np.full((L, n_steps + 1), np.nan)
    # clouds persist over several steps so that gates have something to find
    s = 0
    while s <= n_steps:
        length = rng.randint(3, 9)
        if rng.rand() < cloud:
            lane_mask = rng.rand(L) < 0.7
            low, high = sorted(rng.randint(0, A, size=2))
            kind = rng.choice([2, 3, 3])
            for lane in np.flatnonzero(lane_mask):
                ev[lane, s:s + length, low:high + 1] = kind
                lwp[lane, s:s + length] = rng.uniform(10, 200)
        s += length + rng.randint(1, 5)
    ev[rng.rand(*ev.shape) < 0.02] = 0
    hw = rng.uniform(-wind, wind, size=ev.shape)
    distance = n_steps * step_km if last_km is None else (n_steps - 1) * step_km + last_km
    return make_case(
        step_km=step_km, distance_km=distance, lanes_km=lanes_km, alts_ft=alts, evidence=ev,
        headwind_kt=hw, temp_c=temp, lwp=lwp, params=params or synthetic_params(alts),
        start_lane=L // 2 if start_lane is None else start_lane, start_alt=start_alt,
    )
