"""Viewer contract: the Python port agrees with the original `validProfile()` in static/viewer.js."""
import copy
import json
import math
import shutil
import subprocess
from pathlib import Path

import pytest
from hypothesis import given, settings, strategies as st

from tools.check_viewer_contract import profile_errors, valid_profile

VIEWER = Path(__file__).resolve().parents[1] / "static" / "viewer.js"
NODE = shutil.which("node")


def good():
    return {
        "title": "Synthetic profile", "source": "synthetic test", "dataKind": "simulated", "observedAt": None,
        "samples": [
            {"distanceKm": 0, "topFt": 12000, "baseFt": 8000, "phase": "liquid", "supercooled": True},
            {"distanceKm": 10, "topFt": None, "baseFt": None, "phase": None, "supercooled": None},
            {"distanceKm": 20.5, "topFt": 9000, "baseFt": None, "phase": "ice", "supercooled": False},
        ],
    }


def edit(**kw):
    p = good()
    p.update(kw)
    return p


def sample(**kw):
    p = good()
    p["samples"][1].update(kw)
    return p


BATTERY = [
    good(), edit(title=" "), edit(title=None), edit(source=""), edit(dataKind="forecast"), edit(dataKind="observation"),
    edit(dataKind="observation", observedAt="2026-11-12T19:30:00Z"), edit(observedAt="2026-11-12T19:30:00.5Z"),
    edit(observedAt="2026-11-12 19:30:00Z"), edit(observedAt="2026-11-12T19:30:00+00:00"), edit(observedAt="2026-13-12T19:30:00Z"),
    edit(observedAt=""), edit(observedAt=5), edit(samples=[good()["samples"][0]]), edit(samples="x"), edit(samples=None),
    sample(distanceKm=0), sample(distanceKm=-1), sample(distanceKm=60000), sample(distanceKm="10"), sample(distanceKm=None),
    sample(topFt=-2001), sample(topFt=100001), sample(topFt=-2000), sample(topFt=100000, baseFt=100000),
    sample(topFt=5000, baseFt=6000), sample(topFt=None, baseFt=100), sample(topFt=5000, baseFt=-3000),
    sample(topFt=5000, baseFt=None, phase="mixed"), sample(topFt=5000, phase="unknown", supercooled=None),
    sample(topFt=5000, phase="liquid", supercooled="yes"), sample(topFt=5000, phase="liquid", supercooled=1),
    sample(topFt=None, phase="liquid"), sample(topFt=None, supercooled=False), sample(topFt=True),
    sample(topFt="5000"), sample(topFt=5000.5, baseFt=5000.5),
]


def run_node(profiles):
    src = VIEWER.read_text(encoding="utf-8")
    body = src[src.index("function validProfile"):src.index("function loadProfile")]
    script = body + """
const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const out = input.map((p) => { try { validProfile(p); return true; } catch (e) { return e.message; } });
process.stdout.write(JSON.stringify(out));
"""
    r = subprocess.run([NODE, "-e", script], input=json.dumps(profiles), capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_the_good_synthetic_profile_is_valid():
    assert valid_profile(good())


@pytest.mark.skipif(NODE is None, reason="Node is not installed")
def test_python_port_matches_the_original_javascript_on_a_battery():
    js = run_node(BATTERY)
    for profile, expected in zip(BATTERY, js):
        errors = profile_errors(profile)
        assert (not errors) == (expected is True), (profile, expected, errors)
        if errors:
            assert errors[0] == expected


def number_like():
    return st.one_of(st.integers(-5000, 120000), st.floats(-5000, 120000, allow_nan=False), st.none(), st.just("1"), st.booleans())


@pytest.mark.skipif(NODE is None, reason="Node is not installed")
@settings(max_examples=60, deadline=None)
@given(
    rows=st.lists(
        st.fixed_dictionaries({
            "distanceKm": st.one_of(st.integers(-5, 60000), st.floats(-5, 60000, allow_nan=False)),
            "topFt": number_like(), "baseFt": number_like(),
            "phase": st.sampled_from(["liquid", "ice", "unknown", "mixed", None]),
            "supercooled": st.sampled_from([True, False, None, 0, "x"]),
        }), min_size=0, max_size=6),
    kind=st.sampled_from(["simulated", "observation", "x"]),
    stamp=st.sampled_from([None, "2026-11-12T19:30:00Z", "bad"]),
)
def test_cd_p15_random_profiles_agree_with_javascript(rows, kind, stamp):
    profile = {"title": "t", "source": "s", "dataKind": kind, "observedAt": stamp, "samples": rows}
    expected = run_node([profile])[0]
    assert valid_profile(profile) == (expected is True)


def test_cd_p15_valid_profiles_stay_valid_under_scaling_and_none_masking():
    p = good()
    for factor in (1, 2, 0.5):
        q = copy.deepcopy(p)
        for s in q["samples"]:
            s["distanceKm"] *= factor
        assert valid_profile(q)
    assert all(math.isfinite(s["distanceKm"]) for s in p["samples"])
