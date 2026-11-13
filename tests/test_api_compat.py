"""API compatibility: existing /api/icing/* fields keep their types, new fields are additive (R11.1)."""
from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from check_viewer_contract import profile_errors  # noqa: E402
from main import app  # noqa: E402
from src.analysis.evidence import LEVELS  # noqa: E402
from src.integration.gk2a_cloud import SHAPE, frame_path  # noqa: E402

API = "/api/icing"
PARAMS = dict(from_lat=37.4602, from_lon=126.4407, to_lat=33.5113, to_lon=126.4930,
              alt_ft=25000, at="2026-09-01T13:24:00Z")
ARCHIVE_TIME = datetime(2026, 9, 1, 13, 24, tzinfo=timezone.utc)
NUM = (int, float)

# Field -> accepted types, as served before the additive evidence fields (task 9.2).
PROFILE_TYPES = {
    "title": str, "source": str, "dataKind": str, "observedAt": (str, type(None)),
    "flightAlt_ft": NUM, "icingRisk": (str, type(None)), "assessmentState": str,
    "altitudeSuggestions": list, "disclaimer": str, "samples": list,
    "cacheState": str, "requestedAt": (str, type(None)), "selectedAt": (str, type(None)),
    "ageMin": (int, float, type(None)),
}
OBSERVED_PROFILE_TYPES = {
    **PROFILE_TYPES, "satelliteSource": str, "polarGap": bool, "notices": list,
    "coverage": dict, "fieldSchemaVersion": int, "opticsCacheState": str, "domain": str,
    "bounds": (dict, list),
}
SAMPLE_TYPES = {
    "distanceKm": NUM, "latitude": NUM, "longitude": NUM, "topFt": (int, float, type(None)),
    "baseFt": (int, float, type(None)), "phase": (str, type(None)),
    "supercooled": (bool, type(None)), "icingExposure": bool, "icingLevel": (str, type(None)),
    "cloudTopTemperatureC": (int, float, type(None)), "retrievalState": str,
}
ADDITIVE_PROFILE = {"evidenceKm": dict, "evidenceRule": dict}
ADDITIVE_SAMPLE = {"evidenceLevel": str, "evidenceReason": str}


def _make_frame(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        path, schema_version=4, ctps_available=1,
        cth_ft=np.full(SHAPE, 20000, dtype=np.float32),
        ctt_k=np.full(SHAPE, 245, dtype=np.float32),
        phase=np.ones(SHAPE, dtype=np.float32),
        ctps_flag=np.zeros(SHAPE, dtype=np.float32),
        supercooled=np.ones(SHAPE, dtype=np.float32),
        emis11=np.full(SHAPE, 0.9, dtype=np.float32),
    )


def _check_types(obj: dict, spec: dict, where: str) -> None:
    for key, types in spec.items():
        assert key in obj, f"{where}: missing field {key}"
        value = obj[key]
        if isinstance(value, bool) and bool not in (types if isinstance(types, tuple) else (types,)):
            raise AssertionError(f"{where}.{key}: bool where {types} expected")
        assert isinstance(value, types), f"{where}.{key}: {type(value).__name__} is not {types}"


def _check_additive(profile: dict) -> None:
    _check_types(profile, ADDITIVE_PROFILE, "profile")
    assert set(profile["evidenceKm"]) == set(LEVELS)
    assert all(isinstance(v, NUM) for v in profile["evidenceKm"].values())
    for i, s in enumerate(profile["samples"]):
        _check_types(s, ADDITIVE_SAMPLE, f"samples[{i}]")
        assert s["evidenceLevel"] in LEVELS


def test_synthetic_observed_profile_keeps_legacy_types_and_viewer_contract(monkeypatch, tmp_path):
    monkeypatch.setenv("GK2A_CACHE_ROOT", str(tmp_path))
    _make_frame(frame_path(tmp_path, ARCHIVE_TIME))
    with TestClient(app) as client:
        response = client.get(f"{API}/cross-section", params=PARAMS)
    assert response.status_code == 200
    profile = response.json()
    _check_types(profile, OBSERVED_PROFILE_TYPES, "profile")
    assert profile["dataKind"] == "observation"
    assert profile_errors(profile) == []
    assert profile["samples"]
    for i, s in enumerate(profile["samples"]):
        _check_types(s, SAMPLE_TYPES, f"samples[{i}]")
    _check_additive(profile)


def test_synthetic_missing_cache_fallback_keeps_legacy_types_and_viewer_contract(monkeypatch, tmp_path):
    monkeypatch.setenv("GK2A_CACHE_ROOT", str(tmp_path))
    with TestClient(app) as client:
        profile = client.get(f"{API}/cross-section", params=PARAMS).json()
    _check_types(profile, PROFILE_TYPES, "profile")
    assert profile["dataKind"] == "simulated"
    assert profile["icingRisk"] is None and profile["altitudeSuggestions"] == []
    assert profile_errors(profile) == []


def test_synthetic_frames_status_and_sources_keep_legacy_types(monkeypatch, tmp_path):
    monkeypatch.setenv("GK2A_CACHE_ROOT", str(tmp_path))
    _make_frame(frame_path(tmp_path, ARCHIVE_TIME))
    with TestClient(app) as client:
        frames = client.get(f"{API}/frames").json()
        status = client.get(f"{API}/status").json()
        sources = client.get(f"{API}/sources").json()
    _check_types(frames, {"frames": list, "count": int, "domain": str, "bounds": (dict, list)}, "frames")
    _check_types(frames["frames"][0], {"ts": str, "age_min": NUM, "stale": bool}, "frames[0]")
    _check_types(status, {"source": str, "domain": str, "configured_slots": list,
                          "latest_field": (dict, type(None)), "status": dict,
                          "freshness_minutes": NUM}, "status")
    _check_types(status["status"], {"stage": str, "mode": str}, "status.status")
    _check_types(status["latest_field"], {"ts": str, "observed_at": str, "age_min": NUM,
                                          "schema_version": (int, type(None))}, "latest_field")
    _check_types(sources, {"sources": (list, dict), "polar_limit_deg": NUM}, "sources")


def test_synthetic_evidence_fields_are_additive_only(monkeypatch, tmp_path):
    """Removing the evidence fields leaves a profile that still satisfies the old type map."""
    monkeypatch.setenv("GK2A_CACHE_ROOT", str(tmp_path))
    _make_frame(frame_path(tmp_path, ARCHIVE_TIME))
    with TestClient(app) as client:
        profile = client.get(f"{API}/cross-section", params=PARAMS).json()
    for key in ("evidenceKm", "evidenceRule"):
        profile.pop(key)
    for s in profile["samples"]:
        for key in ("evidenceLevel", "evidenceReason", "evidenceKm", "evidenceRule"):
            s.pop(key, None)
    _check_types(profile, OBSERVED_PROFILE_TYPES, "profile")
    assert profile_errors(profile) == []
