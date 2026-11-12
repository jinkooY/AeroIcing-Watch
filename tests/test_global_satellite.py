"""Router source selection, GOES phase mapping, projection, polar gap, global API."""
from datetime import datetime, timedelta, timezone

import numpy as np
from fastapi.testclient import TestClient

from main import app
from src.analysis import satellite_router as router
from src.analysis.icing_profile import build_global_profile
from src.integration import goes_cloud
from src.integration.geogrid import col_for_lon, lat_rows, lon_cols, sample_geos

NOW = datetime(2026, 11, 12, 13, 30, tzinfo=timezone.utc)
SHAPE = goes_cloud._GRID_SHAPE


def _goes_frame(root, sat, when, *, top=30000.0, phase=1.0, sc=1.0, clear=0.0):
    arrays = dict(
        cth_ft=np.full(SHAPE, top, np.float32), ctt_k=np.full(SHAPE, 250, np.float32),
        phase=np.full(SHAPE, phase, np.float32), supercooled=np.full(SHAPE, sc, np.float32),
        clear=np.full(SHAPE, clear, np.float32),
    )
    goes_cloud.save_frame(goes_cloud.frame_path(root, sat, when), arrays)


# -- GOES phase mapping -------------------------------------------------------

def test_goes_phase_mapping_matches_design():
    raw = np.array([0, 1, 2, 3, 4, 5, 255], dtype=np.int16)
    phase, sc = goes_cloud._map_phase(raw)
    assert np.isnan(phase[0]) and np.isnan(phase[6])          # clear / fill
    assert (phase[1], sc[1]) == (1.0, 0.0)                    # liquid
    assert (phase[2], sc[2]) == (1.0, 1.0)                    # supercooled
    assert (phase[3], sc[3]) == (1.0, 1.0)                    # mixed (conservative)
    assert (phase[4], sc[4]) == (2.0, 0.0)                    # ice
    assert phase[5] == 6.0 and np.isnan(sc[5])                # unknown: no flag


def test_build_arrays_never_infers_clear_from_missing_height():
    n = 8
    grid = (np.linspace(-0.05, 0.05, n), np.linspace(0.05, -0.05, n))
    cth = np.full((n, n), np.nan, np.float32)
    cth[:4] = 5000.0                       # cloud tops in the north half
    ph = np.zeros((n, n), np.float32)      # ACTP says clear ...
    ph[2:4] = 5                            # ... except unknown-phase cloud with height
    ph[6:] = 4                             # ice cloud without height -> unassessed
    out = goes_cloud.build_arrays(cth, np.full((n, n), 240, np.float32), ph,
                                  {"cth": grid, "ctt": grid, "phase": grid}, "G19")
    cloudy = np.isfinite(out["cth_ft"])
    assert cloudy.any()
    assert (out["clear"][cloudy] == 0).all()
    assert (out["clear"] == 1).any()                           # real clear sky exists
    unknown = cloudy & (out["phase"] == 6)
    assert not np.isfinite(out["supercooled"][unknown]).any()  # no inferred supercooling


def test_geos_projection_places_subsatellite_point():
    n = 21
    x = np.linspace(-0.1, 0.1, n)
    y = np.linspace(0.1, -0.1, n)
    vals = np.arange(n * n, dtype=np.float32).reshape(n, n)
    bounds = goes_cloud.SATELLITES["G19"]["bounds"]
    out = sample_geos(x, y, -75.2, bounds, SHAPE, {"v": vals})["v"]
    (lat_min, lon_min), (lat_max, lon_max) = bounds
    r = int(np.argmin(abs(lat_rows(lat_min, lat_max, SHAPE[0]) - 0.0)))
    c = col_for_lon(-75.2, lon_min, lon_max, SHAPE[1])
    assert out[r, c] == vals[n // 2, n // 2]
    assert np.isnan(out[0, 0])                                 # far off the small scan window


def test_wrapping_longitude_columns():
    cols = lon_cols(165.0, -95.0, 620)
    assert cols[0] == 165.0 and abs(cols[-1] - (-95.0)) < 1e-6
    assert col_for_lon(-170.0, 165.0, -95.0, 620) is not None
    assert col_for_lon(100.0, 165.0, -95.0, 620) is None


# -- Router selection ---------------------------------------------------------

def test_router_prefers_closest_subpoint_over_freshest(tmp_path):
    _goes_frame(tmp_path, "G18", NOW - timedelta(minutes=25))
    _goes_frame(tmp_path, "G19", NOW - timedelta(minutes=2))   # newer, but far from Seattle
    assert router.select_source_for_point(47.4, -122.3, NOW, tmp_path) == "G18"
    assert router.select_source_for_point(40.6, -73.8, NOW, tmp_path) == "G19"


def test_router_falls_back_when_best_source_has_no_fresh_frame(tmp_path):
    _goes_frame(tmp_path, "G18", NOW - timedelta(hours=3))     # too old
    _goes_frame(tmp_path, "G19", NOW - timedelta(minutes=5))
    assert router.select_source_for_point(39.9, -105.0, NOW, tmp_path) == "G19"


def test_router_none_without_cache_or_domain(tmp_path):
    assert router.select_source_for_point(40.6, -73.8, NOW, tmp_path) is None
    _goes_frame(tmp_path, "G19", NOW)
    assert router.select_source_for_point(35.0, 100.0, NOW, tmp_path) is None
    assert "G19" in router.sources_for_point(40.6, -73.8)
    assert "gk2a" in router.sources_for_point(37.5, 127.0)


def test_polar_points_have_no_source():
    assert router.sources_for_point(71.0, -75.0) == []
    assert router.sources_for_point(-75.0, 0.0) == []


# -- Profiles and API ---------------------------------------------------------

def test_global_profile_polar_gap_and_unassessed_levels(tmp_path):
    _goes_frame(tmp_path, "G19", NOW - timedelta(minutes=5))
    points = [(0.0, 60.0, -75.0), (500.0, 69.0, -75.0), (1000.0, 72.0, -75.0), (1500.0, 80.0, -75.0)]
    profile = build_global_profile(points, 30000, NOW, tmp_path)
    assert [s["retrievalState"] for s in profile["samples"]] == [
        "observed", "observed", "outside_domain", "outside_domain"]
    assert profile["polarGap"] is True and profile["notices"] == ["polar_gap"]
    assert [s["icingLevel"] for s in profile["samples"][2:]] == [None, None]
    assert [s["satelliteSource"] for s in profile["samples"]] == ["G19", "G19", None, None]
    assert profile["altitudeSuggestions"] == []        # never through unassessed samples
    assert profile["satelliteSources"] == ["G19"]


def test_global_profile_empty_cache_falls_back_to_sample(tmp_path):
    profile = build_global_profile([(0.0, 40.0, -75.0), (50.0, 41.0, -75.0)], 30000, NOW, tmp_path)
    assert profile["assessmentState"] == "not_assessed" and profile["icingRisk"] is None
    assert len(profile["samples"]) > 1


def test_missing_height_is_not_reported_as_clear(tmp_path):
    arrays = dict(
        cth_ft=np.full(SHAPE, np.nan, np.float32), ctt_k=np.full(SHAPE, np.nan, np.float32),
        phase=np.full(SHAPE, np.nan, np.float32), supercooled=np.full(SHAPE, np.nan, np.float32),
        clear=np.zeros(SHAPE, np.float32),
    )
    goes_cloud.save_frame(goes_cloud.frame_path(tmp_path, "G19", NOW), arrays)
    profile = build_global_profile([(0.0, 40.0, -75.0)], 30000, NOW, tmp_path)
    s = profile["samples"][0]
    assert s["retrievalState"] == "no_retrieval" and s["icingLevel"] is None
    assert profile["icingRisk"] is None


def test_cross_section_api_us_route_and_empty_cache(monkeypatch, tmp_path):
    monkeypatch.setenv("GK2A_CACHE_ROOT", str(tmp_path))
    params = dict(from_lat=47.45, from_lon=-122.3, to_lat=33.94, to_lon=-118.4, alt_ft=30000)
    with TestClient(app) as client:
        empty = client.get("/api/icing/cross-section", params=params)
        assert empty.status_code == 200 and empty.json()["dataKind"] == "simulated"
        when = datetime.now(timezone.utc).replace(second=0, microsecond=0) - timedelta(minutes=5)
        _goes_frame(tmp_path, "G18", when)
        body = client.get("/api/icing/cross-section", params=params).json()
        assert body["dataKind"] == "observation" and body["satelliteSources"] == ["G18"]
        assert body["cacheState"] == "ready" and body["icingRisk"] == "HIGH"
        assert all(s["satelliteSource"] == "G18" for s in body["samples"])
        assert client.get("/api/icing/sources").json()["polar_limit_deg"] == 70
