"""Write the satellite map images of the Cloud Dive cases (design.md section 3.5).

For each committed case this adds ONE field, `map`, and two PNG files next to the case:

  <id>.ir.png     ABI-L2-CMIPC band 13 (10.3 um) brightness temperature, greyscale, 180 K white to 310 K black
  <id>.phase.png  ABI-L2-ACTPC cloud-top phase, palette PNG (classes differ in greyscale brightness)

Both are sampled nearest-neighbour from the ABI fixed grid onto a local equirectangular grid
(`equirect-local-v1`, 2 km pixels, extent = all lane points + 100 km). Missing and off-disk pixels
are transparent. The tool refuses to write when any other field of the case would change.

    python tools/export_map_images.py [--cases static/cloud-dive/cases] [--no-download]

Source: NOAA GOES-R ABI Level-2, public domain, anonymous AWS access. Cache: git-ignored `data/`.
"""
from __future__ import annotations

import argparse
import io
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.analysis.case_builder import dumps_strict  # noqa: E402
from src.integration.goes_conus import SATELLITES, Layer, Projection, lonlat_to_scan  # noqa: E402

PROJECTION_ID = "equirect-local-v1"
PX_KM = 2.0
PAD_KM = 100.0
KM_PER_DEG_LON_EQ = 111.32
KM_PER_DEG_LAT = 110.57
IR_WHITE_K = 180.0
IR_BLACK_K = 310.0
BUDGET_BYTES = 400 * 1024
ATTRIBUTION = "NOAA GOES"
PRODUCT = "ABI-L2-CMIPC-C13+ABI-L2-ACTPC"

# Palette index 0 is transparent (missing). Index k+1 is ACTPC phase class k.
# Brightness (0.299 R + 0.587 G + 0.114 B) differs by 28 or more between any two classes.
PHASE_COLOURS = {
    0: ("clear", (255, 255, 255)),
    1: ("liquid", (255, 170, 30)),
    2: ("supercooled", (200, 0, 0)),
    3: ("mixed", (200, 60, 200)),
    4: ("ice", (200, 225, 255)),
    5: ("unknown", (90, 90, 90)),
}


class MapExportError(RuntimeError):
    """The export was refused; nothing was written."""


def brightness(rgb) -> float:
    return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]


# -- grid -----------------------------------------------------------------------------------------

def make_grid(lanes_latlon) -> dict:
    """Grid description from the lane points `[[lat, lon], ...]` (all lanes, all steps)."""
    pts = np.asarray(lanes_latlon, float).reshape(-1, 2)
    if not len(pts) or not np.isfinite(pts).all():
        raise MapExportError("lane points are empty or not finite")
    lat0 = round(float((pts[:, 0].min() + pts[:, 0].max()) / 2), 4)
    lon0 = round(float((pts[:, 1].min() + pts[:, 1].max()) / 2), 4)
    x, y = to_km(lat0, lon0, pts[:, 0], pts[:, 1])
    x_min = math.floor((x.min() - PAD_KM) / PX_KM) * PX_KM
    x_max = math.ceil((x.max() + PAD_KM) / PX_KM) * PX_KM
    y_min = math.floor((y.min() - PAD_KM) / PX_KM) * PX_KM
    y_max = math.ceil((y.max() + PAD_KM) / PX_KM) * PX_KM
    return {"projection": PROJECTION_ID, "lat0": lat0, "lon0": lon0, "xMinKm": float(x_min), "yMaxKm": float(y_max),
            "pxKm": 2, "width": int(round((x_max - x_min) / PX_KM)), "height": int(round((y_max - y_min) / PX_KM))}


def to_km(lat0, lon0, lat, lon):
    lat = np.asarray(lat, float)
    lon = np.asarray(lon, float)
    return (lon - lon0) * math.cos(math.radians(lat0)) * KM_PER_DEG_LON_EQ, (lat - lat0) * KM_PER_DEG_LAT


def from_km(lat0, lon0, x_km, y_km):
    x_km = np.asarray(x_km, float)
    y_km = np.asarray(y_km, float)
    return lat0 + y_km / KM_PER_DEG_LAT, lon0 + x_km / (math.cos(math.radians(lat0)) * KM_PER_DEG_LON_EQ)


def pixel_centres(grid: dict) -> tuple[np.ndarray, np.ndarray]:
    """Latitude and longitude of every pixel centre, shape (height, width)."""
    i = np.arange(grid["width"]) + 0.5
    j = np.arange(grid["height"]) + 0.5
    xx, yy = np.meshgrid(grid["xMinKm"] + i * PX_KM, grid["yMaxKm"] - j * PX_KM)
    return from_km(grid["lat0"], grid["lon0"], xx, yy)


def resample(layer: Layer, projection: Projection, grid: dict):
    """Layer values at the pixel centres (nearest neighbour) and a mask of pixels inside the layer grid."""
    lat, lon = pixel_centres(grid)
    row, col, ok = layer.rowcol(projection, lat.ravel(), lon.ravel())
    values = layer.values[row, col].reshape(lat.shape)
    return values, ok.reshape(lat.shape)


# -- images ---------------------------------------------------------------------------------------

def _png_bytes(image, **save_args) -> bytes:
    from PIL.PngImagePlugin import PngInfo

    info = PngInfo()
    info.add_text("Source", ATTRIBUTION)
    buf = io.BytesIO()
    image.save(buf, format="PNG", optimize=True, pnginfo=info, **save_args)
    return buf.getvalue()


def ir_png(layer: Layer, projection: Projection, grid: dict) -> bytes:
    from PIL import Image

    values, ok = resample(layer, projection, grid)
    valid = ok & np.isfinite(values)
    grey = np.clip((IR_BLACK_K - np.where(valid, values, IR_BLACK_K)) / (IR_BLACK_K - IR_WHITE_K), 0, 1)
    la = np.stack([np.rint(grey * 255).astype(np.uint8), np.where(valid, 255, 0).astype(np.uint8)], axis=-1)
    return _png_bytes(Image.frombytes("LA", (la.shape[1], la.shape[0]), la.tobytes()))


def phase_png(layer: Layer, projection: Projection, grid: dict) -> bytes:
    from PIL import Image

    values, ok = resample(layer, projection, grid)
    valid = ok & (values <= max(PHASE_COLOURS))
    index = np.where(valid, values.astype(np.int64) + 1, 0).astype(np.uint8)
    image = Image.frombytes("P", (index.shape[1], index.shape[0]), index.tobytes())
    palette = [0, 0, 0]
    for k in sorted(PHASE_COLOURS):
        palette += list(PHASE_COLOURS[k][1])
    image.putpalette(palette + [0] * (768 - len(palette)))
    return _png_bytes(image, transparency=0)


def max_parallax_km(satellite_group) -> float:
    """Largest finite `parallaxKm` of the lane samples (flat array of the satellite group)."""
    arr = satellite_group.get("parallaxKm") if isinstance(satellite_group, dict) else None
    if isinstance(arr, dict):
        arr = arr.get("data")
    vals = [v for v in (arr or []) if isinstance(v, (int, float)) and math.isfinite(v)]
    if not vals:
        raise MapExportError("no finite parallaxKm in the case")
    return round(float(max(vals)), 1)


def build_map(case: dict, ir_layer: Layer, phase_layer: Layer, projection: Projection, scan_utc: datetime):
    """Return (map field, {file name: PNG bytes}) for one case."""
    case_id = case["id"]
    lanes = case["lanesLatLon"]["data"]
    grid = make_grid(lanes)
    images = {f"{case_id}.ir.png": ir_png(ir_layer, projection, grid),
              f"{case_id}.phase.png": phase_png(phase_layer, projection, grid)}
    total = sum(len(b) for b in images.values())
    if total > BUDGET_BYTES:
        raise MapExportError(f"images take {total} bytes, budget is {BUDGET_BYTES}")
    field = {**grid, "images": {"ir": f"{case_id}.ir.png", "phase": f"{case_id}.phase.png"},
             "scanUtc": scan_utc.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
             "product": PRODUCT, "maxParallaxKm": max_parallax_km(case["satellite"])}
    return field, images


# -- writing --------------------------------------------------------------------------------------

def write_case_map(case_path: Path, field: dict, images: dict[str, bytes]) -> None:
    """Set `map` in the case file and write the PNGs; refuse if any other field would change."""
    case_path = Path(case_path)
    old = json.loads(case_path.read_text(encoding="utf-8"))
    new = dict(old)
    new["map"] = field
    text = dumps_strict(new)  # raises on NaN, infinity, paths and secrets
    if {k: v for k, v in json.loads(text).items() if k != "map"} != {k: v for k, v in old.items() if k != "map"}:
        raise MapExportError(f"{case_path.name}: a field other than 'map' would change; nothing written")
    for name, data in images.items():
        (case_path.parent / name).write_bytes(data)
    case_path.write_text(text + "\n", encoding="utf-8")


# -- real run -------------------------------------------------------------------------------------

def satellite_code(label: str) -> str:
    for code, info in SATELLITES.items():
        if info["label"] == label:
            return code
    raise MapExportError(f"unknown satellite label {label!r}")


def export_case(case_path: Path, cache_root: Path | None, download: bool) -> bool:
    from src.integration.goes_conus import get_band13, get_scene

    case = json.loads(Path(case_path).read_text(encoding="utf-8"))
    sat = (case.get("sources") or {}).get("satellite")
    if not sat or "scanStartUtc" not in sat:
        print(f"{case_path.name}: no satellite scan (simulated case), skipped")
        return False
    code = satellite_code(sat["satellite"])
    at = datetime.fromisoformat(sat["scanStartUtc"].replace("Z", "+00:00"))
    ir, projection, start, _ = get_band13(code, at, cache_root=cache_root, download=download)
    scene = get_scene(code, at, cache_root=cache_root, download=download)
    if abs((scene.start - start).total_seconds()) > 1 or scene.projection != projection:
        raise MapExportError("band 13 and ACTPC are not from the same scan")
    field, images = build_map(case, ir, scene.layers["phase"], projection, start)
    write_case_map(case_path, field, images)
    print(f"{case_path.name}: {field['width']}x{field['height']} px, images {sum(map(len, images.values())) // 1024} KB, "
          f"maxParallaxKm {field['maxParallaxKm']}")
    return True


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cases", type=Path, default=ROOT / "static" / "cloud-dive" / "cases")
    ap.add_argument("--cache-root", type=Path, default=None)
    ap.add_argument("--no-download", action="store_true")
    args = ap.parse_args()
    try:
        for p in sorted(args.cases.glob("2026*.json")):
            export_case(p, args.cache_root, not args.no_download)
    except MapExportError as exc:
        print("refused:", exc)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
