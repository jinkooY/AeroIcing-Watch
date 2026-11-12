"""Global satellite source router.

Picks, per sample point, the geostationary source to read:

    GK-2A   (128.2E) — KO domain 32–44.5N, 122–134.5E
    GOES-19 ( 75.2W) — GOES-East (replaced GOES-16 in 2025)
    GOES-16 ( 75.2W) — archive only (no data after April 2025)
    GOES-18 (137.0W) — GOES-West
    Meteosat( 0.0E)  — Europe / Africa

Selection per point:
    1. Only in-domain sources with a usable (not older than MAX_AGE) cached
       frame qualify.
    2. Prefer the source whose sub-satellite point is closest (smallest
       viewing angle -> least parallax/limb degradation).
    3. Ties go to the freshest frame.
Points above POLAR_LIMIT_DEG have no source ("outside_domain").
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from src.integration import geogrid, gk2a_cloud, goes_cloud, meteosat_cloud

MAX_AGE = timedelta(hours=1)
_MAX_AGE = MAX_AGE  # backwards-compatible alias
POLAR_LIMIT_DEG = 70.0

SUB_LON = {
    "gk2a": 128.2,
    "G19": -75.2,
    "G16": -75.2,
    "G18": -137.0,
    "msg": 0.0,
}
_SUB_LON = SUB_LON


def _cache_root() -> Path:
    return Path(os.getenv("GK2A_CACHE_ROOT") or Path(__file__).resolve().parents[2] / "data/overlay/gk2a_l2")


def _lon_distance(sat_lon: float, point_lon: float) -> float:
    return abs((point_lon - sat_lon + 180) % 360 - 180)


def view_angle_proxy(source: str, lat: float, lon: float) -> float:
    """Angular distance (deg) from the sub-satellite point, for ranking only."""
    return (lat ** 2 + _lon_distance(SUB_LON[source], lon) ** 2) ** 0.5


def is_polar(lat: float) -> bool:
    return abs(lat) > POLAR_LIMIT_DEG


def _in_domain(source: str, lat: float, lon: float) -> bool:
    if is_polar(lat):
        return False
    if source == "gk2a":
        (lat_min, lon_min), (lat_max, lon_max) = gk2a_cloud.BOUNDS
    elif source in goes_cloud.SATELLITES:
        (lat_min, lon_min), (lat_max, lon_max) = goes_cloud.SATELLITES[source]["bounds"]
    elif source == "msg":
        (lat_min, lon_min), (lat_max, lon_max) = meteosat_cloud.BOUNDS
    else:
        return False
    return (lat_min <= lat <= lat_max
            and geogrid.col_for_lon(lon, lon_min, lon_max, 2) is not None)


def sources_for_point(lat: float, lon: float) -> list[str]:
    return [s for s in SUB_LON if _in_domain(s, lat, lon)]


def _frame_times(source: str, root: Path, now: datetime) -> list[datetime]:
    if source == "gk2a":
        return gk2a_cloud.frame_times(root, now)
    if source in goes_cloud.SATELLITES:
        return goes_cloud.frame_times(root, source, now)
    if source == "msg":
        return meteosat_cloud.frame_times(root, now)
    return []


def _freshness(source: str, root: Path, now: datetime) -> timedelta | None:
    times = _frame_times(source, root, now)
    return now - times[0] if times else None


def _load_field(source: str, root: Path, dt: datetime):
    """Return (arrays, frame_time) of the newest readable frame within MAX_AGE."""
    for t in _frame_times(source, root, dt):
        if dt - t > MAX_AGE:
            break
        if source == "gk2a":
            _, _, arrays = gk2a_cloud.read_frame(gk2a_cloud.frame_path(root, t))
        elif source == "msg":
            _, _, arrays = meteosat_cloud.read_frame(meteosat_cloud.frame_path(root, t))
        else:
            _, _, arrays = goes_cloud.read_frame(goes_cloud.frame_path(root, source, t))
        if arrays is not None:
            return arrays, t
    return None, None


def rank_sources(lat: float, lon: float, root: Path, now: datetime) -> list[str]:
    """In-domain sources with a usable frame, best first."""
    usable = []
    for s in sources_for_point(lat, lon):
        age = _freshness(s, root, now)
        if age is not None and age <= MAX_AGE:
            usable.append((view_angle_proxy(s, lat, lon), age.total_seconds(), s))
    return [s for _, _, s in sorted(usable)]


def select_source_for_point(lat: float, lon: float, now: datetime, root: Path) -> str | None:
    ranked = rank_sources(lat, lon, root, now)
    return ranked[0] if ranked else None


def load_best_field(lat: float, lon: float, dt: datetime, root: Path | None = None):
    """Return (field_arrays, source_name, frame_time); (None, None, None) if none."""
    root = root or _cache_root()
    now = dt.astimezone(timezone.utc)
    for source in rank_sources(lat, lon, root, now):
        arrays, t = _load_field(source, root, now)
        if arrays is not None:
            return arrays, source, t
    return None, None, None


def available_sources(dt: datetime, root: Path | None = None) -> list[dict]:
    root = root or _cache_root()
    now = dt.astimezone(timezone.utc)
    out = []
    for source in SUB_LON:
        age = _freshness(source, root, now)
        out.append({
            "source": source,
            "has_cache": age is not None,
            "age_min": round(age.total_seconds() / 60, 1) if age is not None else None,
            "stale": age is None or age > MAX_AGE,
            "sub_lon": SUB_LON[source],
        })
    return out
