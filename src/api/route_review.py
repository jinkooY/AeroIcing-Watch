"""Cached IFS route evaluation API."""

import os
from datetime import date, datetime, timedelta, timezone
from importlib.metadata import version
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel, Field

from src.analysis.aircraft_performance import catalog
from src.analysis.icing_profile import build_profile
from src.analysis.route_weather import evaluate
from src.api.icing import _cache_root
from src.integration.flight_lookup import LookupError, lookup, normalize_number
from src.integration.gk2a_cloud import frame_path, frame_times, read_frame
from src.integration.ifs_grid import bundles, choose_bundle

ROOT = Path(__file__).resolve().parents[2]
router = APIRouter(prefix="/api/route-review", tags=["route-review"])


class Waypoint(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class Evaluation(BaseModel):
    waypoints: list[Waypoint] = Field(min_length=2, max_length=16)
    decision_at: datetime
    departure_at: datetime
    initialized_at: datetime | None = None
    product: Literal["0p25", "0p1"] = "0p25"
    flight_alt_ft: int = Field(default=30000, ge=0, le=45000)
    tas_kt: float = Field(default=450, ge=250, le=480)
    mass_kg: float | None = Field(default=None, gt=0, allow_inf_nan=False)
    aircraft: str | None = Field(default=None, min_length=4, max_length=12)
    engine: str | None = Field(default=None, min_length=1, max_length=50)


def _ifs_root() -> Path:
    return Path(os.getenv("IFS_CACHE_ROOT") or ROOT / "data" / "ifs")


def _public_meta(meta):
    return {k: v for k, v in meta.items() if k != "messages"}


@router.get("/ifs/status")
def status():
    available = sorted(bundles(_ifs_root()), key=lambda item: item[:2], reverse=True)
    return {"state": "ready" if available else "empty", "bundles": [
        _public_meta(bundle[0]) for _, _, bundle in available
    ]}


@router.get("/aircraft")
def supported_aircraft():
    try:
        aircraft = list(catalog().values())
    except ImportError as exc:
        raise HTTPException(503, "OpenAP is required for aircraft options") from exc
    return {"model": "OpenAP", "version": version("openap"), "aircraft": aircraft}


@router.get("/flights/lookup")
def flight_lookup(
    response: Response,
    departure_local_date: date,
    flight_number: str = Query(min_length=3, max_length=16),
):
    response.headers["Cache-Control"] = "no-store"
    try:
        return lookup(normalize_number(flight_number), departure_local_date)
    except LookupError as exc:
        raise HTTPException(exc.status, str(exc), headers={"Cache-Control": "no-store"}) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/evaluate")
def route_review(request: Evaluation):
    now = datetime.now(timezone.utc)
    dates = (request.decision_at, request.departure_at, request.initialized_at)
    if any(dt is not None and dt.utcoffset() != timedelta(0) for dt in dates):
        raise HTTPException(422, "Use UTC timestamps")
    if request.decision_at > min(now, request.departure_at):
        raise HTTPException(422, "Decision time must be at or before now and departure")
    bundle = choose_bundle(_ifs_root(), request.decision_at, request.product, request.initialized_at)
    if bundle is None:
        raise HTTPException(404, "No matching IFS bundle received by decision time")
    points = [(point.lat, point.lon) for point in request.waypoints]
    try:
        result = evaluate(bundle, points, request.departure_at, request.flight_alt_ft,
                          request.tas_kt, request.mass_kg, request.aircraft, request.engine)
    except ImportError as exc:
        raise HTTPException(503, "OpenAP is required for the route fuel estimate") from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

    result["forecast"] = _public_meta(bundle[0])
    result["decision_at"] = request.decision_at.isoformat()
    segments = result["segments"]
    result["ctps_observation"] = {
        "state": "no_recent_observation", "source": "GK2A_L2_CTPS",
        "used_for_forecast_evaluation": False,
    }
    frames = frame_times(_cache_root(), request.decision_at)
    if frames and request.decision_at - frames[0] <= timedelta(minutes=30):
        at = frames[0]
        state, _, field = read_frame(frame_path(_cache_root(), at))
        result["ctps_observation"]["state"] = "availability_unverified" if field is not None else state
        if field is not None:
            distance = 0.0
            sample_points = []
            for segment in segments:
                half = segment["distance_km"] / 2
                sample_points.append((distance + half, segment["latitude"], segment["longitude"]))
                distance += 2 * half
            profile = build_profile(sample_points, request.flight_alt_ft, at, field, {})
            result["ctps_observation"].update(
                observed_at=profile["observedAt"], received_at=None, coverage=profile["coverage"],
                samples=profile["samples"],
            )
    return result
