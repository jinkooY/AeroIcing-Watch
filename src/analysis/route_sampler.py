"""Distance-based WGS84 route sampling."""

import math

from pyproj import Geod

_GEOD = Geod(ellps="WGS84")


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
