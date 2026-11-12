"""Flight metadata adapter contract tests with synthetic provider responses."""

import pytest
import requests
from fastapi.testclient import TestClient

from main import app

URL = "/api/route-review/flights/lookup"
QUERY = {"flight_number": " tst 71 ", "departure_local_date": "2026-11-12"}


class ProviderResponse:
    def __init__(self, status_code, payload=None):
        self.status_code = status_code
        self.payload = payload

    def json(self):
        if isinstance(self.payload, Exception):
            raise self.payload
        return self.payload


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("AERODATABOX_ENABLE_DEMO_LOOKUP", "1")
    monkeypatch.setenv("AERODATABOX_API_KEY", "test-only")
    with TestClient(app) as client:
        yield client


def test_multiple_candidates_subtypes_and_timestamps(client, monkeypatch):
    rows = [
        {
            "number": "TST71", "callSign": "TST71", "codeshareStatus": "IsOperator",
            "departure": {
                "airport": {"icao": "RJTT", "iata": "HND"},
                "scheduledTime": {"utc": "2026-11-11 15:40Z", "local": "2026-11-12 00:40+09:00"},
                "revisedTime": {"utc": "2026-11-11T15:55:00Z"},
                "runwayTime": {"utc": "2026-11-11T16:06:00Z"},
            },
            "arrival": {"airport": {"icao": "RJBB", "iata": "KIX"}},
            "aircraft": {"model": "Airbus A320-214", "reg": "TEST-REG"},
        },
        {"number": "XY701", "codeshareStatus": "IsCodeshared",
         "aircraft": {"model": "Airbus A320"}, "arrival": None},
    ]

    def fake_get(url, **kwargs):
        assert url == "https://api.aerodatabox.com/flights/number/TST71/2026-11-12"
        assert kwargs["params"]["dateLocalRole"] == "Departure"
        assert kwargs["params"]["withFlightPlan"] == "false"
        assert kwargs["headers"]["X-Api-Key"] == "test-only"
        assert kwargs["allow_redirects"] is False
        return ProviderResponse(200, rows)

    monkeypatch.setattr("src.integration.flight_lookup.requests.get", fake_get)
    response = client.get(URL, params=QUERY)
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert "test-only" not in response.text
    result = response.json()
    assert result["state"] == "multiple" and result["usage"] == "non_operational_demo"
    first, second = result["candidates"]
    assert first["departure"]["airport"]["icao"] == "RJTT"
    assert first["departure"]["scheduled_at"]["utc"] == "2026-11-11T15:40:00Z"
    assert first["departure"]["scheduled_at"]["local"] == "2026-11-12 00:40+09:00"
    assert first["departure"]["revised_at"]["utc"] == "2026-11-11T15:55:00Z"
    assert first["departure"]["actual_at"] is None
    assert first["aircraft"]["engine_suggestion"]["engine"] == "CFM56-5B4"
    assert first["aircraft"]["confirmed_engine"] is None
    assert second["arrival"]["airport"] is None
    assert second["aircraft"]["engine_suggestion"] is None
    assert "waypoints" not in first and "mass_kg" not in first


@pytest.mark.parametrize(("upstream", "payload", "expected"), [
    (204, None, 200), (200, {}, 502), (200, ValueError("private upstream data"), 502),
    (401, None, 502), (429, None, 503), (503, None, 502),
])
def test_empty_invalid_and_provider_errors(client, monkeypatch, upstream, payload, expected):
    monkeypatch.setattr("src.integration.flight_lookup.requests.get",
                        lambda *a, **kw: ProviderResponse(upstream, payload))
    response = client.get(URL, params=QUERY)
    assert response.status_code == expected
    assert "private upstream data" not in response.text
    if upstream == 204:
        assert response.json()["candidates"] == []


def test_timeout_disabled_and_bad_number(client, monkeypatch):
    def timed_out(*args, **kwargs):
        raise requests.Timeout("private upstream information")

    monkeypatch.setattr("src.integration.flight_lookup.requests.get", timed_out)
    response = client.get(URL, params=QUERY)
    assert response.status_code == 504 and "private upstream information" not in response.text
    assert client.get(URL, params=dict(QUERY, flight_number="../unsafe")).status_code == 422
    monkeypatch.setenv("AERODATABOX_ENABLE_DEMO_LOOKUP", "0")
    assert client.get(URL, params=QUERY).status_code == 503


def test_single_scheduled_candidate_keeps_missing_actual(client, monkeypatch):
    payload = [{
        "number": "QX403", "status": "Expected",
        "departure": {"scheduledTime": {"local": "2026-12-01 11:00+01:00"}},
        "aircraft": {"model": "Boeing 787-9"},
    }]
    monkeypatch.setattr("src.integration.flight_lookup.requests.get",
                        lambda *a, **kw: ProviderResponse(200, payload))
    response = client.get(URL, params={"flight_number": "QX403",
                                       "departure_local_date": "2026-12-01"})
    assert response.status_code == 200
    result = response.json()
    assert result["state"] == "single"
    candidate = result["candidates"][0]
    assert candidate["departure"]["scheduled_at"]["local"] == "2026-12-01 11:00+01:00"
    assert candidate["departure"]["actual_at"] is None
    assert candidate["aircraft"]["engine_suggestion"] is None
