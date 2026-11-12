"""Shared lat/lon grid helpers for projected satellite caches.

Rows are evenly spaced in Web-Mercator y (matching the GK-2A cache), columns
are evenly spaced in longitude. A domain whose ``lon_min > lon_max`` wraps the
antimeridian (e.g. GOES-18: 165E -> 95W).
"""
from __future__ import annotations

import numpy as np


def lat_rows(lat_min: float, lat_max: float, h: int) -> np.ndarray:
    """Latitude of each row, north (row 0) to south."""
    return np.degrees(np.arctan(np.sinh(np.linspace(
        np.arcsinh(np.tan(np.radians(lat_max))),
        np.arcsinh(np.tan(np.radians(lat_min))),
        h,
    ))))


def lon_span(lon_min: float, lon_max: float) -> float:
    span = (lon_max - lon_min) % 360.0
    return span if span else 360.0


def lon_cols(lon_min: float, lon_max: float, w: int) -> np.ndarray:
    """Longitude (-180..180) of each column, west to east."""
    lon = lon_min + lon_span(lon_min, lon_max) * np.arange(w) / (w - 1)
    return (lon + 180.0) % 360.0 - 180.0


def col_for_lon(lon: float, lon_min: float, lon_max: float, w: int) -> int | None:
    span = lon_span(lon_min, lon_max)
    offset = (lon - lon_min) % 360.0
    if offset > span:
        return None
    return max(0, min(w - 1, int(round(offset / span * (w - 1)))))


def bin_latlon(lat, lon, values: dict, bounds, shape) -> dict:
    """Bin scattered (lat, lon, value) samples onto the shared grid (last write wins)."""
    (lat_min, lon_min), (lat_max, lon_max) = bounds
    h, w = shape
    out = {k: np.full(shape, np.nan, dtype=np.float32) for k in values}
    lat = np.asarray(lat, dtype=np.float64).ravel()
    lon = np.asarray(lon, dtype=np.float64).ravel()
    ok = np.isfinite(lat) & np.isfinite(lon) & (lat >= lat_min) & (lat <= lat_max)
    span = lon_span(lon_min, lon_max)
    offset = (lon - lon_min) % 360.0
    ok &= offset <= span
    if not ok.any():
        return out
    y = np.arcsinh(np.tan(np.radians(lat[ok])))
    y0, y1 = np.arcsinh(np.tan(np.radians(lat_max))), np.arcsinh(np.tan(np.radians(lat_min)))
    ri = np.round((y0 - y) / (y0 - y1) * (h - 1)).astype(int)
    ci = np.round(offset[ok] / span * (w - 1)).astype(int)
    for k, v in values.items():
        out[k][ri, ci] = np.asarray(v, dtype=np.float32).ravel()[ok]
    return out


def sample_geos(x_rad, y_rad, sub_lon: float, bounds, shape, values: dict,
                height_m: float = 35786023.0) -> dict:
    """Inverse-sample a geostationary scan-angle grid onto the shared grid.

    ``x_rad``/``y_rad`` are 1-D scan-angle coordinates (radians, as in the ABI
    ``x``/``y`` variables); ``values`` maps name -> 2-D array (len(y), len(x)).
    """
    from pyproj import CRS, Transformer

    (lat_min, lon_min), (lat_max, lon_max) = bounds
    h, w = shape
    lats = lat_rows(lat_min, lat_max, h)
    lons = lon_cols(lon_min, lon_max, w)
    lon2, lat2 = np.meshgrid(lons, lats)
    geos = CRS.from_proj4(
        f"+proj=geos +lon_0={sub_lon} +h={height_m} +sweep=x "
        "+a=6378137 +b=6356752.3142 +no_defs"
    )
    t = Transformer.from_crs(CRS.from_epsg(4326), geos, always_xy=True)
    with np.errstate(all="ignore"):
        xm, ym = t.transform(lon2, lat2)
    xm = np.where(np.isfinite(xm) & (np.abs(xm) < 1e15), xm, np.nan) / height_m
    ym = np.where(np.isfinite(ym) & (np.abs(ym) < 1e15), ym, np.nan) / height_m
    x_rad = np.asarray(x_rad, dtype=np.float64)
    y_rad = np.asarray(y_rad, dtype=np.float64)
    dx = (x_rad[-1] - x_rad[0]) / (len(x_rad) - 1)
    dy = (y_rad[-1] - y_rad[0]) / (len(y_rad) - 1)
    with np.errstate(invalid="ignore"):
        ci = np.round((xm - x_rad[0]) / dx)
        ri = np.round((ym - y_rad[0]) / dy)
    ok = np.isfinite(ci) & np.isfinite(ri) & (ci >= 0) & (ci < len(x_rad)) & (ri >= 0) & (ri < len(y_rad))
    ci = np.where(ok, ci, 0).astype(int)
    ri = np.where(ok, ri, 0).astype(int)
    out = {}
    for k, arr in values.items():
        res = np.asarray(arr, dtype=np.float32)[ri, ci]
        res[~ok] = np.nan
        out[k] = res
    return out
