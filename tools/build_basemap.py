"""Build the Cloud Dive basemap (design.md section 3.5): `static/cloud-dive/cases/basemap.json`.

Natural Earth 1:50m state/province boundary lines (admin-1 lines) and coastline, public domain.
Lines are clipped to the union of the case map extents (the `equirect-local-v1` grid of
tools/export_map_images.py: all lane points + 100 km), simplified to about 1 km (Douglas-Peucker in
the local km plane) and stored as lat/lon polylines rounded to 3 decimals (about 100 m).

    python tools/build_basemap.py [--cases static/cloud-dive/cases] [--out .../basemap.json]
                                  [--coastline PATH] [--states PATH]

Without --coastline / --states the GeoJSON files are downloaded into the git-ignored `data/` cache
(never committed). Local paths may be GeoJSON files. No new dependencies: own reader, clipper, simplifier.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import urllib.request
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tools import export_map_images as emi  # noqa: E402

NE_VERSION = "v5.1.2"
NE_BASE = f"https://raw.githubusercontent.com/nvkelso/natural-earth-vector/{NE_VERSION}/geojson/"
SOURCES = {"coast": "ne_50m_coastline.geojson", "states": "ne_50m_admin_1_states_provinces_lines.geojson"}
SOURCE_URL = "https://www.naturalearthdata.com/"
ATTRIBUTION = "Made with Natural Earth"
TOLERANCE_KM = 1.0
DECIMALS = 3
BUDGET_BYTES = 150 * 1024
CACHE_DIR = ROOT / "data" / "naturalearth"
DEFAULT_CASES = ROOT / "static" / "cloud-dive" / "cases"


class BasemapError(RuntimeError):
    """The build was refused; nothing was written."""


# -- reading --------------------------------------------------------------------------------------

def read_lines(geojson: dict) -> list[list[tuple[float, float]]]:
    """Polylines `[(lat, lon), ...]` from a GeoJSON object (LineString, MultiLineString, polygon rings)."""
    out: list[list[tuple[float, float]]] = []

    def add(coords):
        pts = [(float(c[1]), float(c[0])) for c in coords]
        if len(pts) >= 2 and all(math.isfinite(v) for p in pts for v in p):
            out.append(pts)

    def geom(g):
        if not g:
            return
        t, c = g.get("type"), g.get("coordinates")
        if t == "LineString":
            add(c)
        elif t in ("MultiLineString", "Polygon"):
            for part in c:
                add(part)
        elif t == "MultiPolygon":
            for poly in c:
                for ring in poly:
                    add(ring)
        elif t == "GeometryCollection":
            for sub in g.get("geometries", []):
                geom(sub)

    if geojson.get("type") == "FeatureCollection":
        for f in geojson.get("features", []):
            geom(f.get("geometry"))
    elif geojson.get("type") == "Feature":
        geom(geojson.get("geometry"))
    else:
        geom(geojson)
    return out


def load_source(kind: str, path: Path | None, cache_dir: Path = CACHE_DIR) -> dict:
    """GeoJSON of `kind` from a local path, else from the cache, else downloaded into the cache."""
    if path is None:
        path = cache_dir / SOURCES[kind]
        if not path.exists():
            cache_dir.mkdir(parents=True, exist_ok=True)
            with urllib.request.urlopen(NE_BASE + SOURCES[kind], timeout=120) as r:  # noqa: S310 (fixed https URL)
                path.write_bytes(r.read())
    return json.loads(Path(path).read_text(encoding="utf-8"))


# -- extents --------------------------------------------------------------------------------------

def case_grids(cases_dir: Path) -> list[dict]:
    """The map grid of every committed case, from the same code as the map images."""
    grids = []
    for p in sorted(Path(cases_dir).glob("2026*.json")):
        case = json.loads(p.read_text(encoding="utf-8"))
        grids.append(emi.make_grid(case["lanesLatLon"]["data"]))
    if not grids:
        raise BasemapError(f"no case files in {cases_dir}")
    return grids


# -- geometry -------------------------------------------------------------------------------------

def clip_polyline(xy: np.ndarray, box: tuple[float, float, float, float]) -> list[np.ndarray]:
    """Parts of the polyline `xy` (n, 2) inside box (x0, y0, x1, y1), Liang-Barsky per segment."""
    x0, y0, x1, y1 = box
    parts: list[list[np.ndarray]] = []
    cur: list[np.ndarray] = []
    for a, b in zip(xy[:-1], xy[1:]):
        dx, dy = b[0] - a[0], b[1] - a[1]
        t0, t1, keep = 0.0, 1.0, True
        for p, q in ((-dx, a[0] - x0), (dx, x1 - a[0]), (-dy, a[1] - y0), (dy, y1 - a[1])):
            if p == 0:
                if q < 0:
                    keep = False
                    break
                continue
            r = q / p
            if p < 0:
                t0 = max(t0, r)
            else:
                t1 = min(t1, r)
            if t0 > t1:
                keep = False
                break
        if not keep:
            if len(cur) >= 2:
                parts.append(cur)
            cur = []
            continue
        pa, pb = a + t0 * (b - a), a + t1 * (b - a)
        if not cur or not np.allclose(cur[-1], pa):
            if len(cur) >= 2:
                parts.append(cur)
            cur = [pa]
        cur.append(pb)
        if t1 < 1.0:
            parts.append(cur)
            cur = []
    if len(cur) >= 2:
        parts.append(cur)
    return [np.array(p) for p in parts if len(p) >= 2]


def simplify(xy: np.ndarray, tol: float) -> np.ndarray:
    """Douglas-Peucker (iterative); every dropped vertex lies within `tol` of the result."""
    n = len(xy)
    if n <= 2:
        return xy
    keep = np.zeros(n, bool)
    keep[[0, n - 1]] = True
    stack = [(0, n - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        a, b = xy[i], xy[j]
        d = xy[i + 1:j] - a
        ab = b - a
        L2 = float(ab @ ab)
        if L2 == 0:
            dist = np.hypot(d[:, 0], d[:, 1])
        else:
            t = np.clip((d @ ab) / L2, 0, 1)
            dist = np.hypot(d[:, 0] - t * ab[0], d[:, 1] - t * ab[1])
        k = int(np.argmax(dist))
        if dist[k] > tol:
            m = i + 1 + k
            keep[m] = True
            stack += [(i, m), (m, j)]
    return xy[keep]


def process_lines(lines, grids: list[dict], tol_km: float = TOLERANCE_KM, decimals: int = DECIMALS):
    """Clip each polyline to every case box, simplify in km, return `[[lat, lon], ...]` lists."""
    out = []
    for g in grids:
        lat0, lon0 = g["lat0"], g["lon0"]
        box = (g["xMinKm"], g["yMaxKm"] - g["height"] * emi.PX_KM,
               g["xMinKm"] + g["width"] * emi.PX_KM, g["yMaxKm"])
        for line in lines:
            ll = np.asarray(line, float)
            x, y = emi.to_km(lat0, lon0, ll[:, 0], ll[:, 1])
            for part in clip_polyline(np.column_stack([x, y]), box):
                s = simplify(part, tol_km)
                lat, lon = emi.from_km(lat0, lon0, s[:, 0], s[:, 1])
                pts = np.round(np.column_stack([lat, lon]), decimals)
                keep = np.r_[True, np.any(np.diff(pts, axis=0) != 0, axis=1)]
                pts = pts[keep]
                if len(pts) >= 2:
                    out.append(pts.tolist())
    return out


# -- build ----------------------------------------------------------------------------------------

def build_basemap(coast_geojson: dict, states_geojson: dict, grids: list[dict]) -> dict:
    doc = {
        "attribution": ATTRIBUTION,
        "source": {"name": "Natural Earth 1:50m", "url": SOURCE_URL, "version": NE_VERSION,
                   "files": [SOURCES["coast"], SOURCES["states"]], "license": "public domain"},
        "projection": "lat/lon (degrees, WGS84)",
        "toleranceKm": TOLERANCE_KM,
        "decimals": DECIMALS,
        "coast": process_lines(read_lines(coast_geojson), grids),
        "states": process_lines(read_lines(states_geojson), grids),
    }
    text = dumps(doc)
    if len(text.encode("utf-8")) > BUDGET_BYTES:
        raise BasemapError(f"basemap is {len(text.encode('utf-8'))} bytes, budget is {BUDGET_BYTES}")
    return doc


def dumps(doc: dict) -> str:
    return json.dumps(doc, allow_nan=False, separators=(",", ":"), ensure_ascii=False)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cases", type=Path, default=DEFAULT_CASES)
    ap.add_argument("--out", type=Path, default=None)
    ap.add_argument("--coastline", type=Path, default=None, help="local GeoJSON instead of the download")
    ap.add_argument("--states", type=Path, default=None, help="local GeoJSON instead of the download")
    args = ap.parse_args()
    out = args.out or args.cases / "basemap.json"
    try:
        doc = build_basemap(load_source("coast", args.coastline), load_source("states", args.states),
                            case_grids(args.cases))
    except BasemapError as exc:
        print("refused:", exc)
        return 1
    text = dumps(doc)
    out.write_text(text + "\n", encoding="utf-8")
    print(f"{out}: {len(text.encode('utf-8')) / 1024:.1f} KB, coast {len(doc['coast'])} lines, "
          f"states {len(doc['states'])} lines")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
