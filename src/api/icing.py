"""Cached satellite observation endpoints."""

import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from src.analysis.icing_profile import build_profile
from src.analysis.route_sampler import sample_route
from src.integration.gk2a_cloud import (
    AREA, BOUNDS, SOURCE, frame_path, frame_times, iso_utc, read_frame, timestamp,
)

ROOT = Path(__file__).resolve().parents[2]
FRESHNESS = timedelta(minutes=30)
router = APIRouter(prefix="/api/icing", tags=["icing"])


def _cache_root() -> Path:
    return Path(os.getenv("GK2A_CACHE_ROOT") or ROOT / "data/overlay/gk2a_l2")


def _age_minutes(now: datetime, at: datetime) -> float:
    return round((now - at).total_seconds() / 60, 1)


def _fallback(
    altitude: int, state: str, at: datetime | None, selected: datetime | None, now: datetime,
) -> dict:
    sample_js = (ROOT / "static/sample.js").read_text(encoding="utf-8")
    sample = json.loads(sample_js[sample_js.index("{"):sample_js.rindex("}") + 1])
    return dict(
        sample,
        source=f"Illustrative sample · CTPS {state}",
        flightAlt_ft=altitude,
        cacheState=state,
        requestedAt=iso_utc(at) if at else None,
        selectedAt=iso_utc(selected) if selected else None,
        ageMin=_age_minutes(now, selected) if selected else None,
        assessmentState="not_assessed",
        icingRisk=None,
        altitudeSuggestions=[],
        disclaimer=(
            "Dispatcher review aid only. No satellite cache available — "
            "showing illustrative sample data. Always consult AIRMETs, "
            "SIGMETs, and NOTAMs through official channels before flight."
        ),
    )


@router.get("/frames")
def frames():
    now = datetime.now(timezone.utc)
    root = _cache_root()
    items = [
        {"ts": iso_utc(dt), "age_min": _age_minutes(now, dt), "stale": now - dt > FRESHNESS}
        for dt in frame_times(root, now)
    ]
    return {"frames": items, "count": len(items), "domain": AREA, "bounds": BOUNDS}


@router.get("/status")
def status():
    now = datetime.now(timezone.utc)
    root = _cache_root()
    times = frame_times(root, now)
    latest = None
    state = "missing"
    if times:
        at = times[0]
        path = frame_path(root, at)
        state, schema, _ = read_frame(path)
        if state == "ready" and now - at > FRESHNESS:
            state = "stale"
        latest = {
            "ts": timestamp(at), "observed_at": iso_utc(at),
            "age_min": _age_minutes(now, at), "schema_version": schema,
        }
        try:
            latest["bytes"] = path.stat().st_size
        except FileNotFoundError:
            latest["bytes"] = None
    return {
        "source": SOURCE, "domain": AREA, "configured_slots": [],
        "latest_field": latest, "status": {"stage": state, "mode": "cache_only"},
        "freshness_minutes": FRESHNESS.total_seconds() / 60,
    }


@router.get("/cross-section")
def cross_section(
    from_lat: Annotated[float, Query(ge=-90, le=90)],
    from_lon: Annotated[float, Query(ge=-180, le=180)],
    to_lat: Annotated[float, Query(ge=-90, le=90)],
    to_lon: Annotated[float, Query(ge=-180, le=180)],
    alt_ft: Annotated[int, Query(ge=0, le=60_000)],
    at: Annotated[str | None, Query(
        pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::00)?(?:Z|\+00:00)$",
        description="Exact UTC frame timestamp on a whole minute.",
    )] = None,
    spacing_km: Annotated[float, Query(ge=5, le=100)] = 15.0,
):
    now = datetime.now(timezone.utc)
    try:
        requested = datetime.fromisoformat(at.replace("Z", "+00:00")) if at else None
    except ValueError as exc:
        raise HTTPException(422, "at must be a valid UTC timestamp") from exc
    if requested is not None and requested > now:
        raise HTTPException(422, "at must be at or before the current time")
    try:
        points = sample_route(from_lat, from_lon, to_lat, to_lon, spacing_km)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

    root = _cache_root()
    selected = requested
    if selected is None:
        times = frame_times(root, now)
        if not times:
            return _fallback(alt_ft, "missing", None, None, now)
        selected = times[0]

    cache_state, schema, field = read_frame(frame_path(root, selected))
    age = _age_minutes(now, selected)
    if field is None:
        return _fallback(alt_ft, cache_state, requested, selected, now)
    stale = now - selected > FRESHNESS
    if requested is None and stale:
        return _fallback(alt_ft, "stale", None, selected, now)
    optics_state, _, optics = read_frame(frame_path(root, selected, "OPTICS"), optics=True)
    profile = build_profile(points, alt_ft, selected, field, optics or {})
    if stale and profile["icingRisk"] == "NONE":
        # A stale (archived) observation can never support a "no icing" statement.
        profile["icingRisk"] = None
        profile["assessmentState"] = "stale_observation"
    return dict(
        profile,
        cacheState="stale" if stale else "ready",
        requestedAt=iso_utc(requested) if requested else None, selectedAt=iso_utc(selected),
        ageMin=age, fieldSchemaVersion=schema, opticsCacheState=optics_state,
        domain=AREA, bounds=BOUNDS, receivedAt=None,
    )
