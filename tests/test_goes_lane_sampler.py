import numpy as np
import pytest

from src.analysis.cloud_base import apparent_latlon
from src.analysis.goes_lane_sampler import sample_point
from src.analysis.lanes import build_lanes
from src.analysis.goes_lane_sampler import sample_lanes
from src.integration.goes_conus import load_scene, save_scene
from tests.goes_synthetic import CENTER, NIGHT, PROJ, synthetic_scene

LAT, LON = CENTER


def test_synthetic_uniform_deck_is_observed_supercooled_with_parallax():
    rec = sample_point(synthetic_scene(top_m=8000.0), LAT, LON)
    assert rec["state"] == "observed"
    assert rec["supercooled"] is True
    assert rec["top_ft"] == pytest.approx(8000 * 3.28084, abs=1)
    assert rec["parallax_km"] > 5  # 8 km top viewed from 75W at 40N is displaced several km
    assert rec["base_method"] == "goes_cod_cps"
    assert rec["base_ft"] is not None and rec["base_ft"] <= rec["top_ft"]


def test_synthetic_deck_visible_only_through_parallax():
    """Cloud exists only north of the midpoint between the ground point and its apparent position."""
    alat, _ = apparent_latlon(LAT, LON, 14.0, PROJ.lon0)
    boundary = LAT + (alat - LAT) / 2
    scene = synthetic_scene(top_m=14000.0, cloud=lambda la, lo: la > boundary)
    rec = sample_point(scene, LAT, LON)
    assert rec["state"] == "observed"
    assert rec["top_ft"] == pytest.approx(14000 * 3.28084, abs=1)
    # the naive ground-pixel read would be clear
    assert sample_point(scene, LAT - 0.5, LON)["state"] == "clear"


def test_synthetic_clear_sky():
    rec = sample_point(synthetic_scene(cloud=lambda la, lo: la > 99), LAT, LON)
    assert rec["state"] == "clear" and rec["top_ft"] is None and rec["supercooled"] is None


def test_synthetic_outside_domain():
    assert sample_point(synthetic_scene(), 25.0, -75.0)["state"] == "outside_domain"
    assert sample_point(synthetic_scene(), 40.0, 10.0)["state"] == "outside_domain"


@pytest.mark.parametrize("code,expected", [(1, False), (2, True), (3, False), (4, False), (5, None)])
def test_synthetic_phase_codes_to_supercooled(code, expected):
    rec = sample_point(synthetic_scene(phase=code), LAT, LON)
    assert rec["state"] == "observed" and rec["supercooled"] is expected


def test_synthetic_phase_fill_is_no_retrieval():
    assert sample_point(synthetic_scene(phase=255), LAT, LON)["state"] == "no_retrieval"


def test_synthetic_phase_degraded_dqf_is_quality_rejected():
    assert sample_point(synthetic_scene(phase_dqf=1), LAT, LON)["state"] == "quality_rejected"


def test_synthetic_height_not_good_dqf_is_quality_rejected():
    rec = sample_point(synthetic_scene(height_dqf=2), LAT, LON)
    assert rec["state"] == "quality_rejected" and rec["top_ft"] is None


def test_synthetic_clear_phase_with_height_is_inconsistent():
    scene = synthetic_scene()
    scene.layers["phase"].values[:] = 0
    assert sample_point(scene, LAT, LON)["state"] == "inconsistent_retrieval"


def test_synthetic_cloud_without_height_is_no_retrieval():
    scene = synthetic_scene()
    scene.layers["height"].values[:] = np.nan
    assert sample_point(scene, LAT, LON)["state"] == "no_retrieval"


def test_synthetic_degraded_cod_is_used_and_labelled():
    rec = sample_point(synthetic_scene(water_dqf=(1 << 2) | (1 << 5)), LAT, LON)
    assert rec["base_method"] == "goes_cod_cps"
    assert rec["cloud_water_quality"] == "degraded" and rec["cloud_water_nonconverged"] is True


def test_synthetic_good_cod_quality():
    rec = sample_point(synthetic_scene(water_dqf=0), LAT, LON)
    assert rec["cloud_water_quality"] == "good" and rec["cloud_water_nonconverged"] is False


@pytest.mark.parametrize("bit", [0, 6])
def test_synthetic_not_day_or_glint_cod_is_not_used(bit):
    rec = sample_point(synthetic_scene(water_dqf=1 << bit), LAT, LON)
    assert rec["state"] == "observed"
    assert rec["cloud_water_quality"] is None and rec["base_method"] != "goes_cod_cps"


def test_synthetic_night_does_not_use_cod():
    rec = sample_point(synthetic_scene(start=NIGHT), LAT, LON)
    assert rec["cloud_water_quality"] is None and rec["base_method"] != "goes_cod_cps"


def test_synthetic_sampling_is_deterministic():
    scene = synthetic_scene()
    assert sample_point(scene, LAT, LON) == sample_point(scene, LAT, LON)


def test_synthetic_lane_shape_and_roundtrip(tmp_path):
    scene = synthetic_scene()
    save_scene(scene, tmp_path / "s.npz")
    again = load_scene(tmp_path / "s.npz")
    lanes = build_lanes(39.8, -75.3, 40.2, -74.7, step_km=20.0)
    a, b = sample_lanes(scene, lanes), sample_lanes(again, lanes)
    assert a == b
    assert len(a) == 5 and len(a[0]) == lanes.n_steps + 1
