"""Cloud Dive case file <-> `Case` (the game arrays stored in `static/cloud-dive/cases/<id>.json`).

Arrays are stored flat in row-major `[lane][step][alt]` order with an explicit shape. The ice gain
is stored (not recomputed) so Python and JavaScript read the same integers; the temperature and
cloud-water proxy are stored as well so `tools/tune_params.py` can recompute it for other parameters.
Missing values are `null`; NaN never reaches JSON.
"""
from __future__ import annotations

import math
from typing import Mapping

import numpy as np

from src.analysis.cost_model import Params
from src.analysis.game_core import Case, compute_ice_gain

SCHEMA_VERSION = 2


def _flat(a: np.ndarray, *, ints: bool = False) -> list:
    out = []
    for v in np.asarray(a).ravel():
        if ints:
            out.append(int(v))
        else:
            out.append(None if not math.isfinite(float(v)) else float(v))
    return out


def _array(block: Mapping, dtype=float) -> np.ndarray:
    shape = tuple(int(n) for n in block["shape"])
    data = [np.nan if v is None else v for v in block["data"]]
    arr = np.array(data, dtype=float).reshape(shape)
    return arr if dtype is float else arr.astype(dtype)


def game_block(case: Case, temp_c: np.ndarray, lwp: np.ndarray) -> dict:
    """The part of a case file the engine and solver read."""
    shape = list(case.evidence.shape)
    return {
        "grid": {"stepKm": case.step_km, "lanesKm": list(case.lanes_km), "altitudesFt": list(case.alts_ft)},
        "distanceKm": case.distance_km,
        "start": {"lane": case.start_lane, "altFt": case.alts_ft[case.start_alt]},
        "params": case.params.to_dict(),
        "evidence": {"shape": shape, "data": _flat(case.evidence, ints=True)},
        "headwindKt": {"shape": shape, "data": _flat(np.rint(case.headwind_kt), ints=True)},
        "temperatureC": {"shape": shape, "data": _flat(np.round(temp_c, 2))},
        "lwpGm2": {"shape": shape[:2], "data": _flat(np.round(lwp, 1))},
        "iceGain": {"shape": shape, "data": _flat(case.ice_gain, ints=True)},
    }


def case_from_dict(d: Mapping, *, params: Params | None = None) -> Case:
    """Build a `Case` from a case file. With `params` the ice gain is recomputed for those values."""
    grid = d["grid"]
    alts = tuple(int(a) for a in grid["altitudesFt"])
    p = params or Params.from_dict(d["params"])
    evidence = _array(d["evidence"], np.uint8)
    case = Case(
        step_km=float(grid["stepKm"]), distance_km=float(d["distanceKm"]),
        lanes_km=tuple(float(v) for v in grid["lanesKm"]), alts_ft=alts, evidence=evidence,
        headwind_kt=_array(d["headwindKt"]), ice_gain=_array(d["iceGain"], int), params=p,
        start_lane=int(d["start"]["lane"]), start_alt=alts.index(int(d["start"]["altFt"])),
    )
    if params is not None:
        gain = compute_ice_gain(evidence, _array(d["temperatureC"]), _array(d["lwpGm2"]), p)
        case = Case(**{**case.__dict__, "ice_gain": gain})
    expected = (case.n_lanes, case.n_steps + 1, case.n_alts)
    for name in ("evidence", "headwind_kt", "ice_gain"):
        if getattr(case, name).shape != expected:
            raise ValueError(f"{name} has shape {getattr(case, name).shape}, expected {expected}")
    return case
