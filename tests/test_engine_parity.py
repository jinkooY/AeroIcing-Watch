"""CD-P7: the JavaScript engine equals the Python reference on random action sequences.

Real exported cases are used (not synthetic). Python generates seeded scripts of target / anti-ice
changes, single steps and run-until-gate calls; Node replays them; the full state is compared after
every operation. Integers, flags and status match exactly; dollars, minutes and kilometres within
a tiny tolerance. Skipped when Node is missing.

**Validates: Requirements 6.1, 5.4**
"""
import json
import math
import random
import shutil
import subprocess
from pathlib import Path

import pytest

from src.analysis import game_core as gc
from src.analysis.case_io import case_from_dict

ROOT = Path(__file__).resolve().parent.parent
ENGINE = ROOT / "static" / "cloud-dive" / "engine.js"
RUNNER = ROOT / "tests" / "js" / "parity_runner.mjs"
CASES = ROOT / "static" / "cloud-dive" / "cases"
CASE_FILES = ["20261107-kbuf-kpwm-1900z.json", "20261101-kden-klax-2100z.json"]

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node is not installed")

N_SCRIPTS = 60
MAX_OPS = 40
REL = 1e-9


def random_script(rng, case):
    ops = []
    for _ in range(rng.randint(1, MAX_OPS)):
        r = rng.random()
        if r < 0.35:
            pick = lambda hi: rng.choice([None, rng.randint(-2, hi + 2)])
            ai = rng.choice([None, True, False])
            ops.append(["set", pick(case.n_lanes - 1), pick(case.n_alts - 1), ai])
        elif r < 0.65:
            ops.append(["step"])
        else:
            ops.append(["gate"])
    return ops


def py_snapshot(case, state, reason):
    return {
        "reason": reason, "step": state.step, "lane": state.lane, "alt": state.alt,
        "targetLane": state.target_lane, "targetAlt": state.target_alt, "antiIce": state.anti_ice,
        "ice": state.ice, "cost": list(state.cost), "kmPerLevel": list(state.km_per_level),
        "antiIceKm": state.anti_ice_km, "minutes": state.minutes, "minutesAntiIce": state.minutes_anti_ice,
        "prevLevel": state.prev_level, "prev2Level": state.prev2_level,
        "lastIcingStep": state.last_icing_step, "announcedEntry": state.announced_entry, "iceGateDone": state.ice_gate_done, "status": state.status, "events": list(state.events),
        "totalUsd": state.total_usd(case),
    }


def py_replay(case, ops):
    state = gc.initial_state(case)
    trace = []
    for op in ops:
        reason = None
        if op[0] == "set":
            state = gc.set_targets(case, state, op[1], op[2], op[3])
        elif op[0] == "step":
            state = gc.step(case, state)
        elif state.status == "flying":
            state, reason = gc.run_until_gate(case, state)
        trace.append(py_snapshot(case, state, reason))
    return trace


def close(a, b):
    return math.isclose(a, b, rel_tol=REL, abs_tol=1e-9)


def diff(py, js, path=""):
    """Return the first difference between two snapshots, or None."""
    if isinstance(py, dict):
        if set(py) != set(js):
            return f"{path}: keys {sorted(py)} != {sorted(js)}"
        for k in py:
            d = diff(py[k], js[k], f"{path}.{k}")
            if d:
                return d
        return None
    if isinstance(py, list):
        if len(py) != len(js):
            return f"{path}: length {len(py)} != {len(js)}"
        for i, (a, b) in enumerate(zip(py, js)):
            d = diff(a, b, f"{path}[{i}]")
            if d:
                return d
        return None
    if py is None or isinstance(py, (bool, str, int)):  # exact: integers, flags, status
        same = py == js and isinstance(js, bool) == isinstance(py, bool)
        return None if same else f"{path}: {py!r} != {js!r}"
    return None if close(py, js) else f"{path}: {py!r} != {js!r}"


@pytest.mark.parametrize("name", CASE_FILES)
def test_engine_matches_python_on_random_action_sequences_real_case(name, tmp_path):
    data = json.loads((CASES / name).read_text(encoding="utf-8"))
    case = case_from_dict(data)
    rng = random.Random(20261113)
    scripts = [random_script(rng, case) for _ in range(N_SCRIPTS)]
    scripts_path = tmp_path / "scripts.json"
    scripts_path.write_text(json.dumps(scripts), encoding="utf-8")

    proc = subprocess.run([NODE, str(RUNNER), str(ENGINE), str(CASES / name), str(scripts_path)],
                          capture_output=True, text=True, timeout=120)
    assert proc.returncode == 0, proc.stderr
    js_traces = json.loads(proc.stdout)
    assert len(js_traces) == len(scripts)

    statuses, gates = set(), set()
    for si, (ops, js_trace) in enumerate(zip(scripts, js_traces)):
        py_trace = py_replay(case, ops)
        assert len(py_trace) == len(js_trace)
        for oi, (p, j) in enumerate(zip(py_trace, js_trace)):
            d = diff(p, j)
            assert d is None, f"{name} script {si} op {oi} {ops[oi]}: {d}"
            statuses.add(p["status"])
            if p["reason"]:
                gates.update(p["reason"])
    # the random scripts must actually exercise gates (otherwise the test proves little)
    assert "entry" in gates
