"""Sampler on a REAL cropped GOES-19 scan (2026-11-12 19:31 UTC). Source: NOAA GOES-R ABI L2, public domain."""
import collections
import math
from pathlib import Path

import pytest

from src.analysis.goes_lane_sampler import sample_lanes
from src.analysis.lanes import build_lanes
from src.integration.goes_conus import load_scene

FIXTURE = Path(__file__).parent / "fixtures" / "goes19_20261112_1931_crop.npz"
STATES = {"observed", "clear", "no_retrieval", "quality_rejected", "inconsistent_retrieval", "outside_domain"}


@pytest.fixture(scope="module")
def sampled():
    scene = load_scene(FIXTURE)
    lanes = build_lanes(39.0, -77.0, 41.0, -73.0)
    return scene, lanes, sample_lanes(scene, lanes)


def test_real_fixture_is_small_and_attributed_to_goes19():
    assert FIXTURE.stat().st_size < 200_000
    assert load_scene(FIXTURE).satellite == "G19"


def test_real_fixture_records_are_well_formed(sampled):
    _, lanes, rec = sampled
    assert len(rec) == 5 and all(len(lane) == lanes.n_steps + 1 for lane in rec)
    for lane in rec:
        for r in lane:
            assert r["state"] in STATES
            if r["state"] == "observed":
                assert r["top_ft"] > 0
                assert r["base_ft"] is None or r["base_ft"] <= r["top_ft"]
                assert r["supercooled"] in (True, False, None)
                assert math.isfinite(r["parallax_km"])
            else:
                assert r["top_ft"] is None and r["supercooled"] is None


def test_real_fixture_centre_lane_state_counts_are_pinned(sampled):
    _, _, rec = sampled
    assert collections.Counter(r["state"] for r in rec[2]) == {
        "observed": 30, "inconsistent_retrieval": 7, "clear": 4, "quality_rejected": 1,
    }


def test_real_fixture_has_supercooled_observations(sampled):
    _, _, rec = sampled
    assert sum(1 for lane in rec for r in lane if r["supercooled"]) > 0


def test_real_fixture_is_deterministic(sampled):
    scene, lanes, rec = sampled
    assert sample_lanes(scene, lanes) == rec
