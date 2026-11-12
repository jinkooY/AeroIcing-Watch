"""Trans-Pacific coverage: Himawari, wider GK-2A area, IFS dateline crops, view geometry."""
import json
from datetime import datetime, timedelta, timezone

import numpy as np

from src.analysis import satellite_router as router
from src.analysis.cloud_base import view_zenith_deg
from src.analysis.icing_profile import build_global_profile
from src.integration import gk2a_cloud, goes_cloud, himawari_cloud
from src.integration.ifs_bbox import normalize_bbox, route_bbox
from src.integration.ifs_grid import sample

NOW = datetime(2026, 11, 12, 13, 30, tzinfo=timezone.utc)
SHAPE = goes_cloud._GRID_SHAPE


def _frame(root, sat, when, top=30000.0):
    goes_cloud.save_frame(goes_cloud.frame_path(root, sat, when), dict(
        cth_ft=np.full(SHAPE, top, np.float32), ctt_k=np.full(SHAPE, 250, np.float32),
        phase=np.full(SHAPE, 1.0, np.float32), supercooled=np.full(SHAPE, 1.0, np.float32),
        clear=np.zeros(SHAPE, np.float32)))


# -- Himawari -----------------------------------------------------------------

def test_himawari_projection_uses_product_phase_only():
    lat = np.array([[35.0, 35.0, 35.0, 35.0]], np.float32)
    lon = np.array([[150.0, 151.0, 152.0, 153.0]], np.float32)
    cth = np.array([[8000.0, 8000.0, np.nan, np.nan]], np.float32)
    ctt = np.array([[260.0, 230.0, np.nan, np.nan]], np.float32)
    phase = np.array([[2, 4, 0, 1]], np.float32)   # SCW, ice, clear, liquid-but-no-height
    out = himawari_cloud.project_ahi(lat, lon, cth, ctt, phase)
    sc = out["supercooled"][np.isfinite(out["supercooled"])]
    assert sorted(sc.tolist()) == [0.0, 1.0]             # SCW -> 1, ice -> 0
    assert (out["clear"] == 1).sum() == 1                # only the ACTP-clear cell
    # liquid phase without height is neither cloud nor clear
    assert (np.isfinite(out["cth_ft"])).sum() == 2


def test_router_prefers_himawari_over_far_goes18_near_japan(tmp_path):
    _frame(tmp_path, "G18", NOW - timedelta(minutes=5))
    _frame(tmp_path, "H09", NOW - timedelta(minutes=20))
    assert router.select_source_for_point(36.0, 150.0, NOW, tmp_path) == "H09"
    assert router.select_source_for_point(36.0, 170.0, NOW, tmp_path) == "H09"
    assert router.select_source_for_point(47.0, -122.0, NOW, tmp_path) == "G18"
    assert router.select_source_for_point(21.0, -158.0, NOW, tmp_path) == "G18"


def test_no_gap_on_trans_pacific_route_with_goes_and_himawari(tmp_path):
    _frame(tmp_path, "G18", NOW - timedelta(minutes=5))
    _frame(tmp_path, "H09", NOW - timedelta(minutes=20))
    from src.analysis.route_sampler import sample_route
    pts = sample_route(37.62, -122.38, 35.55, 139.78, 100.0)   # KSFO-RJTT
    profile = build_global_profile(pts, 30000, NOW, tmp_path)
    states = {s["retrievalState"] for s in profile["samples"]}
    assert states == {"observed"}
    assert set(profile["satelliteSources"]) == {"G18", "H09"}


# -- Wider GK-2A area ----------------------------------------------------------

def test_gk2a_area_is_configurable(monkeypatch):
    monkeypatch.setenv("GK2A_CLOUD_AREA", "EA")
    area, bounds, shape = gk2a_cloud.configured_area()
    assert area == "EA" and bounds[1][1] >= 165 and shape[1] > 620
    monkeypatch.setenv("GK2A_CLOUD_BOUNDS", "20,110,50,170")
    monkeypatch.setenv("GK2A_CLOUD_SHAPE", "400,700")
    assert gk2a_cloud.configured_area() == ("EA", ((20.0, 110.0), (50.0, 170.0)), (400, 700))
    monkeypatch.setenv("GK2A_CLOUD_BOUNDS", "oops")
    assert gk2a_cloud.configured_area()[1] == gk2a_cloud.AREAS["EA"]["bounds"]
    monkeypatch.setenv("GK2A_CLOUD_AREA", "nope")
    monkeypatch.delenv("GK2A_CLOUD_BOUNDS")
    monkeypatch.delenv("GK2A_CLOUD_SHAPE")
    assert gk2a_cloud.configured_area()[0] == "KO"


def test_router_registers_configured_gk2a_domain(monkeypatch):
    assert "gk2a" not in router.sources_for_point(36.0, 150.0)       # KO default
    monkeypatch.setattr(gk2a_cloud, "BOUNDS", gk2a_cloud.AREAS["EA"]["bounds"])
    assert "gk2a" in router.sources_for_point(36.0, 150.0)


# -- View geometry -------------------------------------------------------------

def test_view_geometry_flags_are_additive_and_flag_large_angles(tmp_path):
    _frame(tmp_path, "G18", NOW - timedelta(minutes=5))
    pts = [(0.0, 21.0, -158.0), (100.0, 47.0, -122.0), (200.0, 40.0, 175.0)]
    samples = build_global_profile(pts, 30000, NOW, tmp_path)["samples"]
    near, far = samples[0], samples[2]
    assert near["domainEdge"] is False and near["qualityNote"] is None
    assert far["domainEdge"] is True and far["viewZenithDeg"] > 60 and "view angle" in far["qualityNote"]
    for key in ("topFt", "baseFt", "icingLevel", "retrievalState", "satelliteSource"):
        assert key in far                                              # contract fields intact
    assert 0 <= view_zenith_deg(0.0, 140.7, 140.7) < 1


# -- IFS dateline ----------------------------------------------------------------

def test_bbox_helpers_cross_the_antimeridian():
    assert normalize_bbox(20, 60, 140, -120) == (20.0, 60.0, 140.0, 240.0)
    south, north, west, east = route_bbox(37.62, -122.38, 35.55, 139.78, 5.0)
    assert west < 180 < east and east - west < 140 and south < 35.55 and north > 37.62
    assert route_bbox(37.46, 126.44, 33.51, 126.49, 2.0)[3] < 180      # no spurious wrap


def test_ifs_sampling_across_180(tmp_path):
    lon = np.arange(170.0, 191.0, 5.0)                                  # 170..190 (= -170)
    lat = np.array([30.0, 40.0])
    t0 = NOW
    valid = [t0, t0 + timedelta(hours=6)]
    levels = np.log(np.array([250.0, 300.0, 500.0, 850.0]))
    axes = (np.array([v.timestamp() for v in valid]), levels, lat, lon)
    shape = tuple(len(a) for a in axes)
    data = np.zeros(shape + (5,))
    data[..., 1] = 250.0                                                # temperature
    bundle = ({}, axes, data)
    for query in (175.0, -178.0, -170.0, 182.0):
        state, vals = sample(bundle, 35.0, query, 400.0, t0 + timedelta(hours=1))
        assert state == "ready" and abs(vals["t"] - 250.0) < 1e-6
    assert sample(bundle, 35.0, 160.0, 400.0, t0 + timedelta(hours=1))[0] == "outside_domain"
    assert sample(bundle, 35.0, -160.0, 400.0, t0 + timedelta(hours=1))[0] == "outside_domain"
    json.dumps(vals)
