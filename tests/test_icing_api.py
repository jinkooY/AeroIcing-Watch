"""Regression checks for exact-frame semantics and observation evidence."""

from datetime import datetime, timezone

import numpy as np
from fastapi.testclient import TestClient

from main import app
from src.integration.gk2a_cloud import SHAPE, frame_path

API = "/api/icing"
PARAMS = dict(
    from_lat=37.4602, from_lon=126.4407,
    to_lat=33.5113, to_lon=126.4930,
    alt_ft=25000, at="2026-09-01T13:24:00Z",
)
ARCHIVE_TIME = datetime(2026, 9, 1, 13, 24, tzinfo=timezone.utc)


def _make_frame(path, *, schema=4, top=20000, quality=0):
    path.parent.mkdir(parents=True, exist_ok=True)
    values = dict(
        schema_version=schema,
        ctps_available=1,
        cth_ft=np.full(SHAPE, top, dtype=np.float32),
        ctt_k=np.full(SHAPE, 245, dtype=np.float32),
        phase=np.ones(SHAPE, dtype=np.float32),
        ctps_flag=np.full(SHAPE, quality, dtype=np.float32),
    )
    if schema >= 4:
        values["supercooled"] = np.ones(SHAPE, dtype=np.float32)
        values["emis11"] = np.full(SHAPE, 0.9, dtype=np.float32)
    np.savez_compressed(path, **values)


def test_exact_archived_frame_and_partial_coverage(monkeypatch, tmp_path):
    monkeypatch.setenv("GK2A_CACHE_ROOT", str(tmp_path))
    _make_frame(frame_path(tmp_path, ARCHIVE_TIME))
    with TestClient(app) as client:
        profile = client.get(f"{API}/cross-section", params=PARAMS).json()
        assert profile["observedAt"] == PARAMS["at"]
        assert profile["cacheState"] == "stale"
        assert profile["icingRisk"] is None
        assert profile["samples"][0]["distanceKm"] == 0
        assert all(s["supercooled"] is True for s in profile["samples"])
        partial = client.get(
            f"{API}/cross-section", params=dict(PARAMS, to_lat=35.55, to_lon=139.78)
        ).json()
        assert partial["coverage"]["outside_domain"] > 0
        assert partial["coverage"]["observed"] > 0
        assert partial["samples"][-1]["topFt"] is None

        missing = client.get(
            f"{API}/cross-section", params=dict(PARAMS, at="2026-09-01T13:25:00Z")
        ).json()
        assert missing["observedAt"] is None
        assert missing["cacheState"] == "missing"
        assert missing["dataKind"] == "simulated"

        default = client.get(
            f"{API}/cross-section", params={k: v for k, v in PARAMS.items() if k != "at"}
        ).json()
        assert default["cacheState"] == "stale"
        assert default["selectedAt"] == PARAMS["at"]
        assert default["dataKind"] == "simulated"
        assert client.get(f"{API}/frames").json()["count"] == 1


def test_quality_and_legacy_frames(monkeypatch, tmp_path):
    monkeypatch.setenv("GK2A_CACHE_ROOT", str(tmp_path))
    path = frame_path(tmp_path, ARCHIVE_TIME)
    with TestClient(app) as client:
        _make_frame(path, schema=2)
        profile = client.get(f"{API}/cross-section", params=PARAMS).json()
        assert profile["samples"][0]["supercooled"] is None

        _make_frame(path, top=20000, quality=2)
        rejected = client.get(f"{API}/cross-section", params=PARAMS).json()
        assert rejected["samples"][0]["retrievalState"] == "quality_rejected"
        assert rejected["samples"][0]["topFt"] is None

        _make_frame(path, top=float("nan"), quality=2)
        clear = client.get(f"{API}/cross-section", params=PARAMS).json()
        assert clear["samples"][0]["retrievalState"] == "clear"


def test_empty_and_corrupt_cache(monkeypatch, tmp_path):
    monkeypatch.setenv("GK2A_CACHE_ROOT", str(tmp_path))
    path = frame_path(tmp_path, ARCHIVE_TIME)
    with TestClient(app) as client:
        assert client.get(f"{API}/frames").json()["frames"] == []
        assert client.get(f"{API}/status").json()["status"]["stage"] == "missing"
        empty = client.get(f"{API}/cross-section", params=PARAMS).json()
        assert empty["dataKind"] == "simulated"
        assert empty["cacheState"] == "missing"

        path.parent.mkdir(parents=True)
        path.write_bytes(b"not a frame")
        corrupt = client.get(f"{API}/cross-section", params=PARAMS).json()
        assert corrupt["cacheState"] == "corrupt"
        assert client.get(f"{API}/status").json()["status"]["stage"] == "corrupt"
        assert path.read_bytes() == b"not a frame"
        assert client.get(f"{API}/cross-section", params=dict(PARAMS, at="123")).status_code == 422


def test_daytime_optics_can_leave_base_unknown(monkeypatch, tmp_path):
    monkeypatch.setenv("GK2A_CACHE_ROOT", str(tmp_path))
    daytime = ARCHIVE_TIME.replace(hour=3)
    _make_frame(frame_path(tmp_path, daytime))
    optics = frame_path(tmp_path, daytime, "OPTICS")
    optics.parent.mkdir(parents=True)
    np.savez_compressed(
        optics, schema_version=1,
        dcoew_dqf=np.zeros(SHAPE, dtype=np.uint8),
        lwp_gm2=np.full(SHAPE, 2000, dtype=np.float32),
        iwp_gm2=np.zeros(SHAPE, dtype=np.float32),
        cot=np.full(SHAPE, 50, dtype=np.float32),
    )
    with TestClient(app) as client:
        profile = client.get(
            f"{API}/cross-section", params=dict(PARAMS, at="2026-09-01T03:24:00Z")
        ).json()
        sample = profile["samples"][0]
        assert profile["opticsCacheState"] == "ready"
        assert sample["retrievalState"] == "observed"
        assert sample["topFt"] == 20000
        assert sample["baseFt"] is None
        assert sample["cloudBaseState"] == "unknown"
        assert sample["cloudBaseMethod"] == "deep_convection"
