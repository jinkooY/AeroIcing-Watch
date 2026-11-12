"""Global satellite source router.

Selects the best available projected field for a given (lat, lon, time) by
checking freshness and domain coverage across all configured sources:

    GK-2A  (128.2°E) — East Asia / West Pacific   lat 32–44.5°N  lon 122–134.5°E
    GOES-16 (75.2°W) — Americas / E Atlantic       lat 81°S–81°N  lon 155°W–15°W
    GOES-18(137.0°W) — W Pacific / Americas west   lat 81°S–81°N  lon 165°E–95°W
    Meteosat  (0°E)  — Europe / Africa / Indian O. lat 60°S–80°N  lon 60°W–80°E

Selection priority per sample point:
    1. Prefer the source whose domain is best-centered on the point
       (smallest angular distance to sub-satellite longitude).
    2. Among tied sources, prefer the freshest cached frame.
    3. Fall back to the next-best source if the preferred has no fresh cache.

The router returns a unified field dict (cth_ft, ctt_k, phase, supercooled)
plus metadata indicating which source and frame were used.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from src.integration import gk2a_cloud, goes_cloud, meteosat_cloud

# Maximum age before a frame is considered stale.
_MAX_AGE = timedelta(hours=1)

# Sub-satellite longitudes for proximity scoring
_SUB_LON = {
    "gk2a":  128.2,
    "G16":   -75.2,
    "G18":  -137.0,
    "msg":     0.0,
}


def _cache_root() -> Path:
    return Path(os.getenv("GK2A_CACHE_ROOT") or Path(__file__).resolve().parents[2] / "data/overlay/gk2a_l2")


def _lon_distance(sat_lon: float, point_lon: float) -> float:
    """Minimum angular distance between a sub-satellite longitude and a point."""
    diff = abs((point_lon - sat_lon + 180) % 360 - 180)
    return diff


def _in_domain(source: str, lat: float, lon: float) -> bool:
    """Return True when (lat, lon) is inside the source's nominal domain."""
    if source == "gk2a":
        bounds = gk2a_cloud.BOUNDS
        return bounds[0][0] <= lat <= bounds[1][0] and bounds[0][1] <= lon <= bounds[1][1]
    if source in ("G16", "G18"):
        sat = goes_cloud.SATELLITES[source]
        (lat_min, lon_min), (lat_max, lon_max) = sat["bounds"]
        in_lat = lat_min <= lat <= lat_max
        wraps = lon_min > lon_max
        if wraps:
            in_lon = lon >= lon_min or lon <= lon_max
        else:
            in_lon = lon_min <= lon <= lon_max
        return in_lat and in_lon
    if source == "msg":
        (lat_min, lon_min), (lat_max, lon_max) = meteosat_cloud.BOUNDS
        return lat_min <= lat <= lat_max and lon_min <= lon <= lon_max
    return False


def _freshness(source: str, root: Path, now: datetime) -> timedelta | None:
    """Return age of the most recent cached frame, or None if no frame."""
    if source == "gk2a":
        times = gk2a_cloud.frame_times(root, now)
    elif source in ("G16", "G18"):
        times = goes_cloud.frame_times(root, source, now)
    elif source == "msg":
        times = meteosat_cloud.frame_times(root, now)
    else:
        return None
    if not times:
        return None
    return now - times[0]


def _load_field(source: str, root: Path, dt: datetime) -> dict | None:
    """Load the most recent field for a source at or before ``dt``."""
    if source == "gk2a":
        times = gk2a_cloud.frame_times(root, dt)
        for t in times:
            if dt - t > _MAX_AGE:
                break
            _, _, arrays = gk2a_cloud.read_frame(gk2a_cloud.frame_path(root, t))
            if arrays is not None:
                return arrays, t
    elif source in ("G16", "G18"):
        times = goes_cloud.frame_times(root, source, dt)
        for t in times:
            if dt - t > _MAX_AGE:
                break
            _, _, arrays = goes_cloud.read_frame(goes_cloud.frame_path(root, source, t))
            if arrays is not None:
                return arrays, t
    elif source == "msg":
        times = meteosat_cloud.frame_times(root, dt)
        for t in times:
            if dt - t > _MAX_AGE:
                break
            _, _, arrays = meteosat_cloud.read_frame(meteosat_cloud.frame_path(root, t))
            if arrays is not None:
                return arrays, t
    return None, None


def select_source_for_point(lat: float, lon: float, now: datetime, root: Path) -> str | None:
    """Return the best source name for a single (lat, lon) point."""
    candidates = [s for s in _SUB_LON if _in_domain(s, lat, lon)]
    if not candidates:
        return None

    # Score: (freshness_seconds, angular_distance_to_sub_lon)
    def _score(s: str) -> tuple:
        age = _freshness(s, root, now)
        age_s = age.total_seconds() if age is not None else 999999
        dist = _lon_distance(_SUB_LON[s], lon)
        return (age_s, dist)

    return min(candidates, key=_score)


def load_best_field(
    lat: float,
    lon: float,
    dt: datetime,
    root: Path | None = None,
) -> tuple[dict | None, str | None, datetime | None]:
    """Return (field_arrays, source_name, frame_time) for the best source.

    Falls back through all in-domain sources if the preferred one has no cache.
    Returns (None, None, None) when no source has a usable frame.
    """
    if root is None:
        root = _cache_root()
    now = dt.astimezone(timezone.utc)

    candidates = sorted(
        [s for s in _SUB_LON if _in_domain(s, lat, lon)],
        key=lambda s: (
            (_freshness(s, root, now) or timedelta(seconds=999999)).total_seconds(),
            _lon_distance(_SUB_LON[s], lon),
        ),
    )
    for source in candidates:
        result = _load_field(source, root, now)
        if result is not None and result[0] is not None:
            arrays, frame_time = result
            return arrays, source, frame_time

    return None, None, None


def available_sources(dt: datetime, root: Path | None = None) -> list[dict]:
    """Return status of all sources with their latest frame times."""
    if root is None:
        root = _cache_root()
    now = dt.astimezone(timezone.utc)
    result = []
    for source in _SUB_LON:
        age = _freshness(source, root, now)
        result.append({
            "source": source,
            "has_cache": age is not None,
            "age_min": round(age.total_seconds() / 60, 1) if age else None,
            "stale": age > _MAX_AGE if age else True,
            "sub_lon": _SUB_LON[source],
        })
    return result
