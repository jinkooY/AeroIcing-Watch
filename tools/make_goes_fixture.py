"""Create a small REAL GOES CONUS test fixture by cropping one downloaded scan.

Source data: NOAA GOES-R ABI Level-2 (ACTPC, ACHAC, CODC, CPSC), public domain, anonymous AWS access.
Default: GOES-19 scan nearest 2026-11-12 19:30 UTC, lat 38.5..41.5, lon -77.5..-72.5.

    python tools/make_goes_fixture.py [--out tests/fixtures/goes19_20261112_1931_crop.npz]
"""
from __future__ import annotations

import argparse
import sys
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.integration.goes_conus import ConusScene, Layer, get_scene, lonlat_to_scan, save_scene  # noqa: E402


def crop_scene(scene: ConusScene, lat_min: float, lat_max: float, lon_min: float, lon_max: float) -> ConusScene:
    corners_lat = [lat_min, lat_min, lat_max, lat_max]
    corners_lon = [lon_min, lon_max, lon_min, lon_max]
    xs, ys = lonlat_to_scan(scene.projection, corners_lat, corners_lon)
    layers = {}
    for name, layer in scene.layers.items():
        cols = np.flatnonzero((layer.x >= xs.min()) & (layer.x <= xs.max()))
        rows = np.flatnonzero((layer.y >= ys.min()) & (layer.y <= ys.max()))
        sl = np.ix_(rows, cols)
        layers[name] = replace(layer, x=layer.x[cols], y=layer.y[rows], values=layer.values[sl], dqf=layer.dqf[sl])
    return replace(scene, layers=layers)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "tests" / "fixtures" / "goes19_20261112_1931_crop.npz"))
    ap.add_argument("--at", default="2026-11-12T19:30:00+00:00")
    ap.add_argument("--satellite", default="G19")
    args = ap.parse_args()
    scene = get_scene(args.satellite, datetime.fromisoformat(args.at).astimezone(timezone.utc))
    small = crop_scene(scene, 38.5, 41.5, -77.5, -72.5)
    save_scene(small, Path(args.out))
    print(args.out, Path(args.out).stat().st_size, "bytes", {n: l.values.shape for n, l in small.layers.items()})


if __name__ == "__main__":
    main()
