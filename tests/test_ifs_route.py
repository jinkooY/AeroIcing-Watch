"""Regression checks for IFS availability, sampling and cue validation."""

import json
from datetime import datetime, timezone

import numpy as np
from fastapi.testclient import TestClient
from openap import FuelFlow

from main import app
from src.analysis.route_weather import ground_speed
from tools.validate_ifs_icing import metrics


def _fixture(path, *, missing_wind=False):
    shape = (2, 4, 2, 2)
    meta = {
        "schema": 1, "product": "0p25", "resolution_deg": 0.25,
        "initialized_at": "2026-11-11T00:00:00Z", "received_at": "2026-11-11T06:00:00Z",
        "valid_times": ["2026-11-11T06:00:00Z", "2026-11-11T09:00:00Z"],
        "pressure_levels_hpa": [850, 500, 300, 250],
        "units": dict(gh="gpm", t="K", r="%", u="m s**-1", v="m s**-1"),
    }
    np.savez(path, metadata=json.dumps(meta), lat=[30., 45.], lon=[118., 143.],
             gh=np.full(shape, 9200.), t=np.full(shape, 260.), r=np.full(shape, 90.),
             u=np.full(shape, np.nan if missing_wind else 10.), v=np.full(shape, 0.))


REQUEST = {
    "waypoints": [{"lat": 37.4602, "lon": 126.4407}, {"lat": 35.55, "lon": 139.78}],
    "decision_at": "2026-11-11T06:01:00Z",
    "departure_at": "2026-11-11T06:05:00Z",
}
URL = "/api/route-review/evaluate"


def test_ifs_route_and_receipt_cutoff(monkeypatch, tmp_path):
    monkeypatch.setenv("IFS_CACHE_ROOT", str(tmp_path))
    _fixture(tmp_path / "test.npz")
    with TestClient(app) as client:
        response = client.post(URL, json=REQUEST)
        assert response.status_code == 200
        profile = response.json()
        assert profile["state"] == "complete"
        assert profile["start"]["wind_from_deg"] == 270
        assert profile["end"]["temperature_c"] == 260 - 273.15
        assert all(s["icing_environment"] == "possible_environment" for s in profile["segments"])
        assert all(s["ground_speed_kt"] > 450 for s in profile["segments"])
        assert profile["icing"]["automatic_exclusion"] is False
        assert profile["ctps_observation"]["used_for_forecast_evaluation"] is False
        direct = FuelFlow("A320").enroute(mass=62000, tas=450, alt=30000,
                                          dT=260 - (288.15 - 0.0065 * 9144))
        first = profile["segments"][0]
        assert np.isclose(first["fuel_kg"], direct * first["duration_s"])
        assert np.isclose(profile["estimated_fuel_kg"], sum(s["fuel_kg"] for s in profile["segments"]))
        assert np.isclose(profile["total_time_s"], sum(s["duration_s"] for s in profile["segments"]))
        too_early = dict(REQUEST, decision_at="2026-11-11T05:59:00Z")
        assert client.post(URL, json=too_early).status_code == 404
        assert client.post(URL, json=dict(REQUEST, product="0p1")).status_code == 404
        assert client.get("/api/route-review/ifs/status").json()["state"] == "ready"


def test_missing_fields_and_ranges(monkeypatch, tmp_path):
    monkeypatch.setenv("IFS_CACHE_ROOT", str(tmp_path))
    path = tmp_path / "test.npz"
    _fixture(path)
    with TestClient(app) as client:
        cases = [
            (dict(REQUEST, flight_alt_ft=44000), "outside_level"),
            (dict(REQUEST, departure_at="2026-11-11T10:00:00Z"), "outside_time"),
            (dict(REQUEST, waypoints=[{"lat": 35, "lon": 145}, {"lat": 35, "lon": 146}]),
             "outside_domain"),
        ]
        for body, state in cases:
            profile = client.post(URL, json=body).json()
            assert profile["state"] == "incomplete"
            assert profile["segments"][0]["state"] == state
            assert profile["estimated_fuel_kg"] is None
        _fixture(path, missing_wind=True)
        partial = client.post(URL, json=REQUEST).json()
        assert partial["segments"][0]["state"] == "partial_fields"
        assert partial["estimated_fuel_kg"] is None


def test_crosswind_reduces_along_track_groundspeed():
    assert np.isclose(ground_speed(0, 15, 0, 450), 450 * 1852 / 3600 + 15)
    assert ground_speed(15, 0, 0, 450) < 450 * 1852 / 3600


def test_aircraft_options_explicit_and_default_engines(monkeypatch, tmp_path):
    monkeypatch.setenv("IFS_CACHE_ROOT", str(tmp_path))
    _fixture(tmp_path / "test.npz")
    with TestClient(app) as client:
        options = client.get("/api/route-review/aircraft").json()
        assert options["version"] == "2.4"
        assert all(item["aircraft"] != "A318" for item in options["aircraft"])
        b789 = next(item for item in options["aircraft"] if item["aircraft"] == "B789")
        assert "GENX-1B74" in b789["engines"]
        assert b789["min_mass_kg"] == 128000
        legacy = client.post(URL, json=REQUEST).json()
        assert legacy["assumptions"]["engine_source"] == "legacy_demo_default"
        explicit = dict(REQUEST, aircraft="B789", engine="GEnx-1B74", mass_kg=180000)
        other = client.post(URL, json=explicit).json()
        assert other["state"] == "complete"
        assert other["assumptions"]["engine"] == "GENX-1B74"
        assert other["assumptions"]["engine_source"] == "user_selected"
        assert other["estimated_fuel_kg"] > legacy["estimated_fuel_kg"]
        implicit = dict(explicit, engine=None)
        default = client.post(URL, json=implicit).json()
        assert default["assumptions"]["engine"] == b789["default_engine"]
        assert default["assumptions"]["engine_source"] == "openap_aircraft_default"
        for invalid in (dict(explicit, engine="CFM56-5B4"),
                        dict(explicit, mass_kg=62000), dict(explicit, mass_kg=None)):
            assert client.post(URL, json=invalid).status_code == 422


def test_explicit_labels_and_unknown_reports():
    at = datetime(2026, 11, 11, tzinfo=timezone.utc).isoformat()
    segment = dict(latitude=37.5, longitude=127.0, eta=at,
                   icing_environment="possible_environment")
    profile = dict(assumptions=dict(altitude_ft_pressure=30000),
                   segments=[segment, dict(segment, icing_environment="unassessed")])
    label = dict(lat=37.5, lon=127, alt_ft=30000, observed_at=at)
    reports = [dict(label, id="1", label="icing"), dict(label, id="2", label="no_icing"),
               dict(label, id="3", label="unknown"), dict(label, id="4", label="icing", lon=140)]
    result = metrics([profile], reports, radius_km=25, minutes=15, altitude_ft=1000,
                     label_kind="synthetic")
    assert result["matched_reports"] == 2
    assert result["report_coverage"] == 2 / 3
    assert result["segment_coverage"] == 1 / 2
    assert result["probability_of_detection"] == 1
    assert result["false_alarm_ratio"] == 1 / 2
    empty = metrics([profile], [], radius_km=25, minutes=15, altitude_ft=1000,
                    label_kind="independent")
    assert empty["state"] == "unevaluated"
    assert empty["probability_of_detection"] is None
