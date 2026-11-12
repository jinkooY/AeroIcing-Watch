"""AeroDataBox adapter for non-operational flight metadata lookup."""

import os
import re
from datetime import date, datetime, timezone

import requests

PROVIDER = "AeroDataBox"
PROVIDER_URL = "https://aerodatabox.com/"
GATEWAY = "https://api.aerodatabox.com"
# Model suggestions describe a compatible type, not the installed engine.
# EASA.A.064, issue 61, A320 series, section 5.
_SUBTYPES = {
    "A320-214": ("A320", "CFM56-5B4"),
    "A320-232": ("A320", "V2527-A5"),
    "A320-233": ("A320", "V2527E-A5"),
}
_SUBTYPE = re.compile(r"(?:AIRBUS\s+)?(A\d{3}-\d{3}[A-Z]?)", re.IGNORECASE)


class LookupError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def normalize_number(number: str) -> str:
    value = "".join(number.split()).upper()
    if not re.fullmatch(r"(?:[A-Z0-9]{2}|[A-Z]{3})[0-9]{1,4}[A-Z]?", value):
        raise ValueError("Use an IATA or ICAO flight number")
    return value


def _obj(value):
    return value if isinstance(value, dict) else {}


def _text(value):
    return value.strip() or None if isinstance(value, str) else None


def _utc(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.utcoffset() is None:
        return None
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _time(value):
    value = _obj(value)
    utc, local = _utc(value.get("utc")), _text(value.get("local"))
    return {"utc": utc, "local": local} if utc or local else None


def _movement(raw):
    raw = _obj(raw)
    airport = _obj(raw.get("airport"))
    codes = {
        "iata": _text(airport.get("iata")), "icao": _text(airport.get("icao")),
        "name": _text(airport.get("name") or airport.get("shortName") or airport.get("fullName")),
        "time_zone": _text(airport.get("timeZone")),
    }
    quality = raw.get("quality")
    return {
        "airport": codes if any(codes.values()) else None,
        "scheduled_at": _time(raw.get("scheduledTime")),
        "revised_at": _time(raw.get("revisedTime")),
        "predicted_at": _time(raw.get("predictedTime")),
        "runway_at": _time(raw.get("runwayTime")),
        "actual_at": _time(raw.get("actualTime")),
        "quality": [item for item in quality if isinstance(item, str)] if isinstance(quality, list) else [],
    }


def _aircraft(raw):
    raw = _obj(raw)
    model = _text(raw.get("model"))
    match = _SUBTYPE.fullmatch(model or "")
    subtype = match[1].upper() if match else None
    suggestion = None
    if subtype in _SUBTYPES:
        from src.analysis.aircraft_performance import catalog

        code, engine = _SUBTYPES[subtype]
        try:
            supported = engine in catalog().get(code, {}).get("engines", ())
        except ImportError:
            supported = False
        if supported:
            suggestion = {
                "aircraft": code, "engine": engine, "state": "suggested",
                "source": "EASA.A.064 subtype mapping",
            }
    return {
        "model": model, "subtype": subtype,
        "registration": _text(raw.get("reg")), "mode_s": _text(raw.get("modeS")),
        "engine_suggestion": suggestion, "confirmed_engine": None,
    }


def _candidate(raw, index):
    airline = _obj(raw.get("airline"))
    return {
        "candidate_index": index,
        "flight_number": _text(raw.get("number")), "callsign": _text(raw.get("callSign")),
        "codeshare_status": _text(raw.get("codeshareStatus")), "status": _text(raw.get("status")),
        "airline": {k: _text(airline.get(k)) for k in ("name", "iata", "icao")},
        "provider_updated_at": _utc(raw.get("lastUpdatedUtc")),
        "departure": _movement(raw.get("departure")), "arrival": _movement(raw.get("arrival")),
        "aircraft": _aircraft(raw.get("aircraft")),
    }


def lookup(number: str, departure_local_date: date) -> dict:
    key = os.getenv("AERODATABOX_API_KEY", "").strip()
    if os.getenv("AERODATABOX_ENABLE_DEMO_LOOKUP") != "1" or not key:
        raise LookupError(503, "AeroDataBox demo lookup is not configured")
    try:
        response = requests.get(
            f"{GATEWAY}/flights/number/{number}/{departure_local_date.isoformat()}",
            headers={"X-Api-Key": key, "Accept": "application/json"},
            params={"dateLocalRole": "Departure", "withLocation": "false",
                    "withAircraftImage": "false", "withFlightPlan": "false"},
            timeout=(5, 15), allow_redirects=False,
        )
    except requests.Timeout as exc:
        raise LookupError(504, "Flight data provider timed out") from exc
    except requests.RequestException as exc:
        raise LookupError(502, "Flight data provider is unavailable") from exc
    if response.status_code == 204:
        rows = []
    elif response.status_code == 429:
        raise LookupError(503, "Flight data provider rate limit reached")
    elif response.status_code != 200:
        raise LookupError(502, "Flight data provider did not accept the lookup")
    else:
        try:
            rows = response.json()
        except ValueError as exc:
            raise LookupError(502, "Invalid flight data provider response") from exc
        if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
            raise LookupError(502, "Invalid flight data provider response")

    return {
        "provider": PROVIDER, "provider_url": PROVIDER_URL, "usage": "non_operational_demo",
        "looked_up_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "flight_number": number, "departure_local_date": departure_local_date.isoformat(),
        "state": "multiple" if len(rows) > 1 else "single" if rows else "no_result",
        "candidates": [_candidate(row, i) for i, row in enumerate(rows)],
    }
