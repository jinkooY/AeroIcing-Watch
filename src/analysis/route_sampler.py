"""Distance-based WGS84 route sampling."""

import math

from pyproj import Geod

_GEOD = Geod(ellps="WGS84")


def split_legs(points, max_leg_m: float = 25000, max_legs: int = 400):
    """Split a waypoint route into equal geodesic legs of at most ``max_leg_m`` per waypoint pair.

    Each leg is ``(start, midpoint, end, azimuth_at_midpoint, metres)`` with points as
    ``(lat, lon)``. Leg boundaries fall exactly on every waypoint, and adjacent legs share a
    boundary. The route evaluator and the replay exporter both use this split.
    """
    legs = []
    for (lat1, lon1), (lat2, lon2) in zip(points, points[1:]):
        azimuth, _, metres = _GEOD.inv(lon1, lat1, lon2, lat2)
        if metres < 1:
            raise ValueError("Adjacent waypoints must be distinct")
        n = math.ceil(metres / max_leg_m)
        if len(legs) + n > max_legs:
            raise ValueError(f"Route exceeds the {max_legs}-segment evaluation limit")
        step = metres / n
        start = (lat1, lon1)
        for i in range(n):
            offset = metres * i / n
            mid_lon, mid_lat, reverse = _GEOD.fwd(lon1, lat1, azimuth, offset + metres / (2 * n))
            if i == n - 1:
                end = (lat2, lon2)
            else:
                end_lon, end_lat, _ = _GEOD.fwd(lon1, lat1, azimuth, metres * (i + 1) / n)
                end = (end_lat, end_lon)
            legs.append((start, (mid_lat, mid_lon), end, reverse + 180, step))
            start = end
    return legs


def sample_route(
    lat1: float, lon1: float, lat2: float, lon2: float, spacing_km: float,
) -> list[tuple[float, float, float]]:
    azimuth, _, metres = _GEOD.inv(lon1, lat1, lon2, lat2)
    if metres <= 0:
        raise ValueError("Route endpoints must be distinct")
    legs = min(199, max(9, math.floor(metres / (spacing_km * 1000) + 0.5)))
    points = _GEOD.fwd_intermediate(
        lon1, lat1, azimuth, legs + 1, metres / legs,
        initial_idx=0, terminus_idx=0, return_back_azimuth=False,
    )
    return [
        (index * metres / (1000 * legs), lat, lon)
        for index, (lat, lon) in enumerate(zip(points.lats, points.lons))
    ]
