"""Lateral lanes along a great-circle route (Cloud Dive).

Lane 0 offset is the route itself; positive offsets are to the right of the direction of travel.
Each lane has one point per step, so lane/step indices are shared by the weather sampler, the
exporter and the game engine.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from pyproj import Geod

GEOD = Geod(ellps="WGS84")
DEFAULT_LANES_KM = (-30.0, -15.0, 0.0, 15.0, 30.0)
DEFAULT_STEP_KM = 10.0


@dataclass(frozen=True)
class Lanes:
    """Sample points: `lat[lane][step]`, `lon[lane][step]` for step 0..n_steps (inclusive)."""

    lanes_km: tuple[float, ...]
    step_km: float
    distance_km: float  # great-circle length of the centre line
    n_steps: int
    lat: np.ndarray
    lon: np.ndarray
    azimuth_deg: np.ndarray  # centre-line forward azimuth at each step

    @property
    def n_lanes(self) -> int:
        return len(self.lanes_km)

    def along_km(self, step: int) -> float:
        return min(step * self.step_km, self.distance_km)


def build_lanes(
    from_lat: float,
    from_lon: float,
    to_lat: float,
    to_lon: float,
    step_km: float = DEFAULT_STEP_KM,
    lanes_km: tuple[float, ...] = DEFAULT_LANES_KM,
) -> Lanes:
    """Lane sample points; n_steps = ceil(length / step) and the last point is the destination."""
    if step_km <= 0:
        raise ValueError("step_km must be positive")
    az, _, dist_m = GEOD.inv(from_lon, from_lat, to_lon, to_lat)
    distance_km = dist_m / 1000.0
    if distance_km <= 0:
        raise ValueError("route has zero length")
    n_steps = max(1, math.ceil(distance_km / step_km - 1e-9))
    along_m = np.minimum(np.arange(n_steps + 1) * step_km * 1000.0, dist_m)
    lons, lats, back = GEOD.fwd(
        np.full(along_m.shape, from_lon), np.full(along_m.shape, from_lat), np.full(along_m.shape, az), along_m
    )
    forward = (np.asarray(back) + 180.0) % 360.0  # azimuth of travel at each point
    lat = np.zeros((len(lanes_km), n_steps + 1))
    lon = np.zeros_like(lat)
    for i, off in enumerate(lanes_km):
        if off == 0:
            lat[i], lon[i] = lats, lons
            continue
        side = 90.0 if off > 0 else -90.0
        lo, la, _ = GEOD.fwd(lons, lats, (forward + side) % 360.0, np.full(along_m.shape, abs(off) * 1000.0))
        lat[i], lon[i] = la, lo
    return Lanes(tuple(float(v) for v in lanes_km), float(step_km), distance_km, n_steps, lat, lon, forward)
