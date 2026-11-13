"""GOES-R ABI CONUS Level-2 scenes at native resolution (GOES-18 West, GOES-19 East).

One scene is one 5-minute CONUS scan with four products from the anonymous NOAA AWS buckets:

  phase   ABI-L2-ACTPC  Phase    2 km   0 clear, 1 liquid, 2 super-cooled, 3 mixed, 4 ice, 5 unknown
  height  ABI-L2-ACHAC  HT      10 km   cloud-top geopotential height, metres (sea-level basis)
  cod     ABI-L2-CODC   COD      2 km   cloud optical depth at 640 nm (daytime algorithm)
  cps     ABI-L2-CPSC   CPS      2 km   cloud particle effective radius, micrometres

Arrays are kept on their own native grids (x, y are fixed-grid scan angles in radians), so no
detail is invented and none is claimed beyond one satellite pixel. Fill values become NaN (float
layers) or 255/65535 (flag layers, kept raw). Scenes are cached as compressed `.npz` files under
the git-ignored `data/goes_conus/` folder; the same format is used for small test fixtures.

Network access happens only in `fetch_scene` / `get_scene(download=True)`.
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Mapping, Sequence

import numpy as np

SATELLITES: dict[str, dict] = {
    "G19": {"bucket": "noaa-goes19", "label": "GOES-19 (East)"},
    "G18": {"bucket": "noaa-goes18", "label": "GOES-18 (West)"},
}
# layer name -> (S3 product id, variable, nominal resolution km, units)
PRODUCTS: dict[str, tuple[str, str, float, str]] = {
    "phase": ("ABI-L2-ACTPC", "Phase", 2.0, "1"),
    "height": ("ABI-L2-ACHAC", "HT", 10.0, "m"),
    "cod": ("ABI-L2-CODC", "COD", 2.0, "1"),
    "cps": ("ABI-L2-CPSC", "CPS", 2.0, "um"),
}
PHASE_NAMES = {0: "clear", 1: "liquid", 2: "supercooled", 3: "mixed", 4: "ice", 5: "unknown"}
PHASE_FILL = 255
DEFAULT_MAX_DELTA = timedelta(minutes=10)

_START = re.compile(r"_s(\d{4})(\d{3})(\d{2})(\d{2})(\d{2})(\d)_")
ROOT = Path(__file__).resolve().parents[2]


class SceneNotFound(LookupError):
    """No scene (cached or on S3) within the allowed time distance."""


def default_cache_root() -> Path:
    return Path(os.getenv("GOES_CONUS_CACHE") or ROOT / "data" / "goes_conus")


# ---------------------------------------------------------------------------------------------
# File names and times
# ---------------------------------------------------------------------------------------------

def parse_start_time(name: str) -> datetime:
    """Scan start time from a GOES file name (`..._sYYYYDDDHHMMSSt_...`)."""
    m = _START.search(name)
    if not m:
        raise ValueError(f"no scan start time in {name!r}")
    year, doy, hh, mm, ss, tenth = (int(g) for g in m.groups())
    return datetime(year, 1, 1, tzinfo=timezone.utc) + timedelta(
        days=doy - 1, hours=hh, minutes=mm, seconds=ss + tenth / 10.0
    )


def choose_nearest(names: Sequence[str], at: datetime, max_delta: timedelta = DEFAULT_MAX_DELTA) -> str:
    """Name whose scan start is closest to `at`; SceneNotFound if none is within `max_delta`."""
    at = at.astimezone(timezone.utc)
    best, best_delta = None, None
    for name in names:
        try:
            delta = abs(parse_start_time(name.rsplit("/", 1)[-1]) - at)
        except ValueError:
            continue
        if best_delta is None or delta < best_delta:
            best, best_delta = name, delta
    if best is None or best_delta > max_delta:
        raise SceneNotFound(f"no scan within {max_delta} of {at.isoformat()}")
    return best


def scan_token(name: str) -> str:
    """The `sYYYYDDDHHMMSSt` token that identifies one scan across products."""
    m = re.search(r"_(s\d{14})_", name)
    if not m:
        raise ValueError(f"no scan token in {name!r}")
    return m.group(1)


# ---------------------------------------------------------------------------------------------
# Projection and layers
# ---------------------------------------------------------------------------------------------

@dataclass(frozen=True)
class Projection:
    """GOES-R fixed-grid geostationary projection."""

    lon0: float
    height_m: float
    semi_major_m: float
    semi_minor_m: float
    sweep: str = "x"

    def proj4(self) -> str:
        return (
            f"+proj=geos +lon_0={self.lon0} +h={self.height_m} +a={self.semi_major_m} "
            f"+b={self.semi_minor_m} +sweep={self.sweep} +no_defs"
        )

    def to_dict(self) -> dict:
        return {"lon0": self.lon0, "height_m": self.height_m, "semi_major_m": self.semi_major_m,
                "semi_minor_m": self.semi_minor_m, "sweep": self.sweep}


@lru_cache(maxsize=8)
def _transformers(projection: Projection):
    from pyproj import CRS, Transformer

    geos = CRS.from_proj4(projection.proj4())
    wgs = CRS.from_epsg(4326)
    return (Transformer.from_crs(wgs, geos, always_xy=True), Transformer.from_crs(geos, wgs, always_xy=True))


def lonlat_to_scan(projection: Projection, lat, lon) -> tuple[np.ndarray, np.ndarray]:
    """Scan angles (x, y) in radians; inf where the point is not visible from the satellite."""
    fwd, _ = _transformers(projection)
    lon_a = np.atleast_1d(np.asarray(lon, float))
    lat_a = np.atleast_1d(np.asarray(lat, float))
    x, y = (np.asarray(v, float).reshape(lon_a.shape) for v in fwd.transform(lon_a.ravel(), lat_a.ravel()))
    h = projection.height_m
    return x / h, y / h


def scan_to_lonlat(projection: Projection, x_rad, y_rad) -> tuple[np.ndarray, np.ndarray]:
    """Latitude, longitude of scan-angle coordinates (radians)."""
    _, inv = _transformers(projection)
    h = projection.height_m
    xa = np.atleast_1d(np.asarray(x_rad, float))
    ya = np.atleast_1d(np.asarray(y_rad, float))
    lon, lat = (np.asarray(v, float).reshape(xa.shape) for v in inv.transform(xa.ravel() * h, ya.ravel() * h))
    return lat, lon


@dataclass
class Layer:
    """One product on its own native grid."""

    name: str
    product: str
    variable: str
    resolution_km: float
    units: str
    x: np.ndarray  # scan angle, radians, increasing
    y: np.ndarray  # scan angle, radians, decreasing (north to south)
    values: np.ndarray  # (len(y), len(x)); uint8 for phase, float32 (NaN = missing) otherwise
    dqf: np.ndarray  # raw data-quality flags, same shape

    def rowcol(self, projection: Projection, lat, lon) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Nearest pixel (row, col) and an `ok` mask for points inside this grid."""
        xs, ys = lonlat_to_scan(projection, lat, lon)
        dx = (self.x[-1] - self.x[0]) / (len(self.x) - 1)
        dy = (self.y[-1] - self.y[0]) / (len(self.y) - 1)
        with np.errstate(invalid="ignore"):
            col = np.rint((xs - self.x[0]) / dx)
            row = np.rint((ys - self.y[0]) / dy)
            ok = np.isfinite(col) & np.isfinite(row) & (col >= 0) & (col < len(self.x)) & (row >= 0) & (row < len(self.y))
        col = np.where(ok, col, 0).astype(int)
        row = np.where(ok, row, 0).astype(int)
        return row, col, ok

    def pixel_size_km(self) -> float:
        return self.resolution_km


@dataclass
class ConusScene:
    """One CONUS scan: projection, four native-grid layers and provenance."""

    satellite: str
    start: datetime  # scan start, UTC
    projection: Projection
    layers: dict[str, Layer]
    files: dict[str, str] = field(default_factory=dict)

    @property
    def label(self) -> str:
        return SATELLITES.get(self.satellite, {}).get("label", self.satellite)

    @property
    def sub_lon(self) -> float:
        return self.projection.lon0

    def provenance(self) -> dict:
        return {"satellite": self.label, "scanStartUtc": self.start.isoformat().replace("+00:00", "Z"),
                "files": dict(self.files), "projectionLon0": self.projection.lon0}


# ---------------------------------------------------------------------------------------------
# Cache (.npz) - also the test-fixture format
# ---------------------------------------------------------------------------------------------

def save_scene(scene: ConusScene, path: Path) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    meta = {
        "satellite": scene.satellite,
        "start": scene.start.astimezone(timezone.utc).isoformat(),
        "projection": scene.projection.to_dict(),
        "files": scene.files,
        "layers": {n: {"product": l.product, "variable": l.variable, "resolution_km": l.resolution_km, "units": l.units}
                   for n, l in scene.layers.items()},
    }
    arrays = {"meta": np.array(json.dumps(meta))}
    for name, layer in scene.layers.items():
        arrays.update({f"{name}__x": layer.x, f"{name}__y": layer.y, f"{name}__values": layer.values, f"{name}__dqf": layer.dqf})
    tmp = path.with_suffix(".tmp.npz")
    np.savez_compressed(tmp, **arrays)
    tmp.replace(path)


def load_scene(path: Path) -> ConusScene:
    with np.load(Path(path), allow_pickle=False) as z:
        meta = json.loads(str(z["meta"].item()))
        layers = {}
        for name, info in meta["layers"].items():
            layers[name] = Layer(
                name=name, product=info["product"], variable=info["variable"],
                resolution_km=float(info["resolution_km"]), units=info["units"],
                x=z[f"{name}__x"].astype(float), y=z[f"{name}__y"].astype(float),
                values=z[f"{name}__values"], dqf=z[f"{name}__dqf"],
            )
    return ConusScene(
        satellite=meta["satellite"], start=datetime.fromisoformat(meta["start"]),
        projection=Projection(**meta["projection"]), layers=layers, files=dict(meta.get("files", {})),
    )


def _cache_name(start: datetime) -> str:
    return start.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%S") + ".npz"


def _cached_names(root: Path, satellite: str) -> list[str]:
    folder = root / satellite
    return [p.name for p in folder.glob("*.npz")] if folder.exists() else []


def _cache_start(name: str) -> datetime:
    return datetime.strptime(name[:15], "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc)


# ---------------------------------------------------------------------------------------------
# NetCDF decoding (pure; takes bytes)
# ---------------------------------------------------------------------------------------------

def _decode_layer(name: str, blob: bytes) -> tuple[Layer, Projection, datetime]:
    import netCDF4 as nc4

    product, variable, resolution_km, units = PRODUCTS[name]
    ds = nc4.Dataset("scene", mode="r", memory=blob)
    try:
        var = ds.variables[variable]
        var.set_auto_maskandscale(False)
        raw = np.asarray(var[:])
        dqf_var = ds.variables["DQF"]
        dqf_var.set_auto_maskandscale(False)
        dqf = np.asarray(dqf_var[:])
        if name == "phase":
            values = raw.astype(np.uint8)
        else:
            scale = float(getattr(var, "scale_factor", 1.0))
            offset = float(getattr(var, "add_offset", 0.0))
            fill = int(getattr(var, "_FillValue", np.iinfo(raw.dtype).max))
            vmax = getattr(var, "valid_range", [0, fill])[1]
            values = np.where((raw == fill) | (raw > vmax), np.nan, raw.astype(np.float64) * scale + offset).astype(np.float32)
        x = np.asarray(ds.variables["x"][:], dtype=float)
        y = np.asarray(ds.variables["y"][:], dtype=float)
        p = ds.variables["goes_imager_projection"]
        projection = Projection(
            lon0=float(p.longitude_of_projection_origin), height_m=float(p.perspective_point_height),
            semi_major_m=float(p.semi_major_axis), semi_minor_m=float(p.semi_minor_axis),
            sweep=str(p.sweep_angle_axis),
        )
        start = datetime.strptime(str(ds.time_coverage_start)[:21], "%Y-%m-%dT%H:%M:%S.%f").replace(tzinfo=timezone.utc)
    finally:
        ds.close()
    layer = Layer(name=name, product=product, variable=variable, resolution_km=resolution_km, units=units,
                  x=x, y=y, values=values, dqf=dqf)
    return layer, projection, start


def scene_from_blobs(satellite: str, blobs: Mapping[str, bytes], files: Mapping[str, str] | None = None) -> ConusScene:
    """Build a scene from the four NetCDF files (bytes), keyed by layer name."""
    layers, projection, start = {}, None, None
    for name in PRODUCTS:
        layer, proj, t0 = _decode_layer(name, blobs[name])
        layers[name] = layer
        projection = projection or proj
        start = start or t0
        if proj != projection:
            raise ValueError("products of one scene must share the projection")
    return ConusScene(satellite=satellite, start=start, projection=projection, layers=layers, files=dict(files or {}))


# ---------------------------------------------------------------------------------------------
# S3 access (the only network code)
# ---------------------------------------------------------------------------------------------

def _hour_listing(fs, bucket: str, product: str, t: datetime) -> list[str]:
    prefix = f"{bucket}/{product}/{t.year}/{t.timetuple().tm_yday:03d}/{t.hour:02d}"
    try:
        return list(fs.ls(prefix, detail=False))
    except FileNotFoundError:
        return []


def fetch_scene(satellite: str, at: datetime, *, max_delta: timedelta = DEFAULT_MAX_DELTA) -> ConusScene:
    """Download the CONUS scan nearest to `at` (all four products of the same scan)."""
    import s3fs

    if satellite not in SATELLITES:
        raise ValueError(f"unknown satellite {satellite!r}")
    at = at.astimezone(timezone.utc)
    bucket = SATELLITES[satellite]["bucket"]
    fs = s3fs.S3FileSystem(anon=True)
    listings = {
        name: [k for h in (-1, 0, 1) for k in _hour_listing(fs, bucket, PRODUCTS[name][0], at + timedelta(hours=h))]
        for name in PRODUCTS
    }
    phase_key = choose_nearest(listings["phase"], at, max_delta)
    token = scan_token(phase_key)
    keys = {"phase": phase_key}
    for name in ("height", "cod", "cps"):
        matches = [k for k in listings[name] if scan_token(k) == token]
        if not matches:
            raise SceneNotFound(f"{PRODUCTS[name][0]} has no file for scan {token}")
        keys[name] = matches[0]
    blobs = {name: fs.open(key, "rb").read() for name, key in keys.items()}
    return scene_from_blobs(satellite, blobs, {n: k.rsplit("/", 1)[-1] for n, k in keys.items()})


def get_scene(
    satellite: str,
    at: datetime,
    *,
    cache_root: Path | None = None,
    download: bool = True,
    max_delta: timedelta = DEFAULT_MAX_DELTA,
) -> ConusScene:
    """Cached scene nearest to `at`; downloads and caches it when missing (and allowed)."""
    root = Path(cache_root) if cache_root else default_cache_root()
    at = at.astimezone(timezone.utc)
    names = _cached_names(root, satellite)
    if names:
        try:
            best = min(names, key=lambda n: abs(_cache_start(n) - at))
            if abs(_cache_start(best) - at) <= max_delta:
                return load_scene(root / satellite / best)
        except ValueError:
            pass
    if not download:
        raise SceneNotFound(f"no cached {satellite} scene within {max_delta} of {at.isoformat()}")
    scene = fetch_scene(satellite, at, max_delta=max_delta)
    save_scene(scene, root / satellite / _cache_name(scene.start))
    return scene
