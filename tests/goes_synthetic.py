"""Synthetic GOES CONUS scene builder for tests (SYNTHETIC data, not a real scan)."""
from __future__ import annotations

from datetime import datetime, timezone

import numpy as np

from src.integration.goes_conus import ConusScene, Layer, Projection, lonlat_to_scan, scan_to_lonlat

PROJ = Projection(lon0=-75.0, height_m=35786023.0, semi_major_m=6378137.0, semi_minor_m=6356752.31414)
DAY = datetime(2026, 11, 12, 19, 30, tzinfo=timezone.utc)
NIGHT = datetime(2026, 11, 12, 3, 30, tzinfo=timezone.utc)
CENTER = (40.0, -75.0)  # lat, lon
PX2 = 56e-6  # 2 km pixel, radians
PX10 = 280e-6


def _grid(n: int, step: float, cx: float, cy: float):
    x = cx + (np.arange(n) - n / 2) * step
    y = cy - (np.arange(n) - n / 2) * step  # decreasing
    return x, y


def synthetic_scene(
    *, cloud=None, phase=2, top_m=8000.0, cod=10.0, re_um=15.0, start=DAY, n2=120,
    phase_dqf=0, height_dqf=0, water_dqf=0,
) -> ConusScene:
    """Uniform scene; `cloud(lat, lon) -> bool` array selects where cloud exists (default: everywhere)."""
    cx, cy = lonlat_to_scan(PROJ, CENTER[0], CENTER[1])
    n10 = n2 * 2 // 10
    x2, y2 = _grid(n2, PX2, cx[0], cy[0])
    x10, y10 = _grid(n10, PX10, cx[0], cy[0])

    def mask(x, y):
        if cloud is None:
            return np.ones((len(y), len(x)), bool)
        xx, yy = np.meshgrid(x, y)
        lat, lon = scan_to_lonlat(PROJ, xx.ravel(), yy.ravel())
        return np.asarray(cloud(lat, lon), bool).reshape(xx.shape)

    m2, m10 = mask(x2, y2), mask(x10, y10)
    layers = {
        "phase": Layer("phase", "ABI-L2-ACTPC", "Phase", 2.0, "1", x2, y2,
                       np.where(m2, phase, 0).astype(np.uint8), np.full(m2.shape, phase_dqf, np.uint8)),
        "height": Layer("height", "ABI-L2-ACHAC", "HT", 10.0, "m", x10, y10,
                        np.where(m10, top_m, np.nan).astype(np.float32), np.full(m10.shape, height_dqf, np.uint8)),
        "cod": Layer("cod", "ABI-L2-CODC", "COD", 2.0, "1", x2, y2,
                     np.where(m2, cod, np.nan).astype(np.float32), np.full(m2.shape, water_dqf, np.uint16)),
        "cps": Layer("cps", "ABI-L2-CPSC", "CPS", 2.0, "um", x2, y2,
                     np.where(m2, re_um, np.nan).astype(np.float32), np.full(m2.shape, water_dqf, np.uint16)),
    }
    return ConusScene("G19", start, PROJ, layers, {})
