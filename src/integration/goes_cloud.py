"""GOES-16 / GOES-18 ABI Level-2 cloud observation reader.

Reads projected npz caches produced by the collector worker.
Falls back to downloading directly from the NOAA GOES-R open S3 bucket
(anonymous access, no credentials required) when boto3/s3fs is available
and ``allow_download=True``.

Shared field schema (matches gk2a_cloud.py):
    cth_ft       float32  cloud top height ft MSL  (NaN = no cloud / clear)
    ctt_k        float32  cloud top temperature K
    phase        float32  1=liquid 2=ice 6=unknown  (NaN = clear)
    supercooled  float32  1=yes 0=no               (NaN = unknown)
    emis11       float32  not available from ABI; always NaN

GOES ABI ACTP/ACHA phase codes → shared schema:
    0 clear         → NaN (no cloud)
    1 liquid water  → phase=1  supercooled=0
    2 supercooled   → phase=1  supercooled=1   ← primary icing signal
    3 mixed         → phase=1  supercooled=1   (conservative)
    4 ice           → phase=2  supercooled=0
    5 unknown       → phase=6  supercooled=NaN
    255 fill        → NaN
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from io import BytesIO
from pathlib import Path
from zipfile import BadZipFile

import numpy as np

log = logging.getLogger(__name__)

# Two satellites; each is registered as a separate "source".
SATELLITES = {
    "G16": {
        "bucket": "noaa-goes16",
        "sub_lon": -75.2,
        "label": "GOES-16",
        # Full-disk nominal coverage (conservative)
        "bounds": ((-81.0, -155.0), (81.0, -15.0)),
    },
    "G18": {
        "bucket": "noaa-goes18",
        "sub_lon": -137.0,
        "label": "GOES-18",
        "bounds": ((-81.0, 165.0), (81.0, -95.0)),   # wraps 180°
    },
}

# Standard projected grid shared with gk2a_cloud.py cache format.
# Each satellite uses its own AREA subdirectory.
_GRID_SHAPE = (500, 620)   # height × width — same as GK-2A KO for consistency
_CACHE_SCHEMA = 10          # version tag for GOES npz files

REQUIRED_FIELDS = ("cth_ft", "ctt_k", "phase", "supercooled")
FRESHNESS = timedelta(minutes=20)   # ABI Full Disk scans every 10 min


# ── GOES phase code → shared schema ─────────────────────────────────────────

def _map_phase(abi_phase: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Map ABI ACTP phase codes to shared (phase, supercooled) arrays."""
    phase = np.full(abi_phase.shape, np.nan, dtype=np.float32)
    sc    = np.full(abi_phase.shape, np.nan, dtype=np.float32)
    liquid_mask     = np.isin(abi_phase, [1])
    supercooled_mask = np.isin(abi_phase, [2, 3])
    ice_mask        = np.isin(abi_phase, [4])
    unknown_mask    = np.isin(abi_phase, [5])

    phase[liquid_mask]      = 1.0;  sc[liquid_mask]      = 0.0
    phase[supercooled_mask] = 1.0;  sc[supercooled_mask] = 1.0
    phase[ice_mask]         = 2.0;  sc[ice_mask]         = 0.0
    phase[unknown_mask]     = 6.0
    return phase, sc


# ── Cache paths ──────────────────────────────────────────────────────────────

def _stamp(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y%m%d%H%M")


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def frame_path(root: Path, satellite: str, dt: datetime) -> Path:
    stamp = _stamp(dt)
    return root / "FIELD" / satellite / stamp[:8] / f"{stamp}.npz"


def frame_times(root: Path, satellite: str, now: datetime) -> list[datetime]:
    area_root = root / "FIELD" / satellite
    times: list[datetime] = []
    for path in area_root.glob("*/*.npz"):
        if len(path.stem) != 12:
            continue
        try:
            dt = datetime.strptime(path.stem, "%Y%m%d%H%M").replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        if dt <= now:
            times.append(dt)
    return sorted(times, reverse=True)


# ── npz I/O ──────────────────────────────────────────────────────────────────

def _atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_bytes(data)
    tmp.replace(path)


@lru_cache(maxsize=6)
def _read_arrays(path: Path, mtime_ns: int, size: int) -> tuple[int, dict]:
    with np.load(path, allow_pickle=False) as f:
        schema = int(f["schema_version"].item())
        if schema != _CACHE_SCHEMA:
            raise ValueError(f"Unsupported GOES cache schema {schema}")
        arrays = {name: f[name] for name in REQUIRED_FIELDS}
        for arr in arrays.values():
            if arr.shape != _GRID_SHAPE:
                raise ValueError("Grid shape mismatch")
            arr.setflags(write=False)
        return schema, arrays


def read_frame(path: Path) -> tuple[str, int | None, dict | None]:
    try:
        s = path.stat()
        schema, arrays = _read_arrays(path, s.st_mtime_ns, s.st_size)
        return "ready", schema, arrays
    except FileNotFoundError:
        return "missing", None, None
    except (OSError, ValueError, TypeError, KeyError, EOFError, BadZipFile):
        log.warning("Unreadable GOES cache %s", path.name, exc_info=True)
        return "corrupt", None, None


# ── Projection helpers ───────────────────────────────────────────────────────

def _goes_latlon(satellite: str, height: int, width: int) -> tuple[np.ndarray, np.ndarray]:
    """Project GOES ABI fixed grid to lat/lon using pyproj."""
    from pyproj import CRS, Transformer

    sat = SATELLITES[satellite]
    # GOES-R ABI fixed-grid CRS (CGMS Doc. 416)
    crs_goes = CRS.from_proj4(
        f"+proj=geos +lon_0={sat['sub_lon']} +h=35786023 "
        "+sweep=x +a=6378137 +b=6356752.3142 +no_defs"
    )
    crs_wgs84 = CRS.from_epsg(4326)
    t = Transformer.from_crs(crs_goes, crs_wgs84, always_xy=True)

    # Build grid in CGMS fixed-grid units (radians scaled by satellite height)
    # Full Disk extent: ±0.151844 rad
    extent = 0.151844
    h = 35786023.0
    x = np.linspace(-extent * h, extent * h, width, dtype=np.float64)
    y = np.linspace(extent * h, -extent * h, height, dtype=np.float64)
    xx, yy = np.meshgrid(x, y)
    lon, lat = t.transform(xx, yy)
    lat = np.where(np.abs(lat) <= 90, lat, np.nan).astype(np.float32)
    lon = np.where(np.isfinite(lon), lon, np.nan).astype(np.float32)
    return lat, lon


def _project_to_grid(
    src_lat: np.ndarray,
    src_lon: np.ndarray,
    src_cth_m: np.ndarray,
    src_ctt_k: np.ndarray,
    src_phase_raw: np.ndarray,
    bounds: tuple,
    satellite: str,
) -> dict:
    """Resample ABI arrays to the shared lat/lon grid."""
    (lat_min, lon_min), (lat_max, lon_max) = bounds
    h, w = _GRID_SHAPE
    # Handle G18 wrap-around (lon_min > lon_max means crosses 180°)
    wraps = lon_min > lon_max

    out_cth  = np.full((h, w), np.nan, dtype=np.float32)
    out_ctt  = np.full((h, w), np.nan, dtype=np.float32)
    out_ph, out_sc = (np.full((h, w), np.nan, dtype=np.float32) for _ in range(2))

    src_phase, src_sc = _map_phase(src_phase_raw)
    src_cth_ft = (src_cth_m * 3.28084).astype(np.float32)

    # Nearest-neighbour onto output grid
    out_lats = np.linspace(lat_max, lat_min, h)
    out_lons = np.linspace(lon_min, lon_max, w) if not wraps else np.concatenate([
        np.linspace(lon_min, 180.0, w // 2),
        np.linspace(-180.0, lon_max, w - w // 2),
    ])

    # Vectorised bilinear-equivalent: bin source pixels into output cells
    flat_lat  = src_lat.ravel()
    flat_lon  = src_lon.ravel()
    valid = (
        np.isfinite(flat_lat) & np.isfinite(flat_lon) &
        (flat_lat >= lat_min) & (flat_lat <= lat_max)
    )
    if wraps:
        valid &= (flat_lon >= lon_min) | (flat_lon <= lon_max)
    else:
        valid &= (flat_lon >= lon_min) & (flat_lon <= lon_max)

    if not valid.any():
        log.warning("GOES %s: no valid pixels in domain after masking", satellite)
        return {"cth_ft": out_cth, "ctt_k": out_ctt,
                "phase": out_ph, "supercooled": out_sc}

    vlat = flat_lat[valid]
    vlon = flat_lon[valid]
    vcth = src_cth_ft.ravel()[valid]
    vctt = src_ctt_k.ravel()[valid] if np.isfinite(src_ctt_k).any() else np.full(valid.sum(), np.nan, dtype=np.float32)
    vph  = src_phase.ravel()[valid]
    vsc  = src_sc.ravel()[valid]

    row_idx = np.round((lat_max - vlat) / (lat_max - lat_min) * (h - 1)).astype(int)
    if wraps:
        # Map [lon_min..180] to [0..w//2-1], [-180..lon_max] to [w//2..w-1]
        col_idx = np.where(
            vlon >= 0,
            np.round((vlon - lon_min) / (360.0 + lon_max - lon_min) * (w - 1)).astype(int),
            np.round((vlon - lon_min + 360.0) / (360.0 + lon_max - lon_min) * (w - 1)).astype(int),
        )
    else:
        col_idx = np.round((vlon - lon_min) / (lon_max - lon_min) * (w - 1)).astype(int)

    mask = (row_idx >= 0) & (row_idx < h) & (col_idx >= 0) & (col_idx < w)
    ri, ci = row_idx[mask], col_idx[mask]

    # Last-write wins (acceptable for 10-min cadence nearest-neighbour)
    out_cth[ri, ci]  = vcth[mask]
    out_ctt[ri, ci]  = vctt[mask]
    out_ph[ri, ci]   = vph[mask]
    out_sc[ri, ci]   = vsc[mask]

    return {"cth_ft": out_cth, "ctt_k": out_ctt,
            "phase": out_ph, "supercooled": out_sc}


# ── S3 download ──────────────────────────────────────────────────────────────

def _latest_s3_key(bucket: str, dt: datetime) -> str | None:
    """Find the most recent ABI-L2-ACHA Full Disk key on S3 near ``dt``."""
    try:
        import s3fs
    except ImportError:
        log.debug("s3fs not installed; GOES S3 download unavailable")
        return None

    fs = s3fs.S3FileSystem(anon=True)
    utc = dt.astimezone(timezone.utc)
    doy = utc.timetuple().tm_yday

    # Search the hour directory, then ±1 hour
    for delta_h in (0, -1, 1):
        t = utc + timedelta(hours=delta_h)
        prefix = f"{bucket}/ABI-L2-ACHAF/{t.year}/{t.timetuple().tm_yday:03d}/{t.hour:02d}/"
        try:
            keys = fs.ls(prefix, detail=False)
        except FileNotFoundError:
            continue
        if keys:
            # Pick the key whose start time is closest to dt
            def _start(key: str) -> datetime | None:
                stem = key.split("/")[-1]
                parts = stem.split("_")
                for p in parts:
                    if p.startswith("s") and len(p) == 16:
                        try:
                            return datetime.strptime(p[1:14], "%Y%j%H%M%S").replace(tzinfo=timezone.utc)
                        except ValueError:
                            pass
                return None

            closest = min(
                keys,
                key=lambda k: abs((_start(k) or datetime.min.replace(tzinfo=timezone.utc)) - utc).total_seconds(),
            )
            return closest
    return None


def _download_goes_frame(
    satellite: str,
    dt: datetime,
    cache_root: Path,
) -> dict | None:
    """Download one GOES ABI-L2-ACHA frame and project to shared grid."""
    sat = SATELLITES[satellite]
    key = _latest_s3_key(sat["bucket"], dt)
    if key is None:
        return None

    try:
        import s3fs
        import netCDF4 as nc4
    except ImportError:
        return None

    log.info("GOES %s: downloading %s", satellite, key)
    fs = s3fs.S3FileSystem(anon=True)
    try:
        raw = fs.open(key, "rb").read()
    except Exception as exc:
        log.warning("GOES S3 download failed %s: %s", key, exc)
        return None

    try:
        with nc4.Dataset("inmemory", memory=raw) as ds:
            # ABI L2 ACHA variable names
            ht_var  = ds.variables.get("HT")
            tmp_var = ds.variables.get("TEMP")
            # ACTP phase is in a separate product; approximate from ACHA quality
            # Use DQF (Data Quality Flag) as phase proxy if no phase variable
            phase_var = ds.variables.get("PHASE")

            if ht_var is None:
                log.warning("GOES %s: HT variable missing in %s", satellite, key)
                return None

            cth_m    = np.ma.asarray(ht_var[:]).squeeze().astype(np.float32).filled(np.nan)
            ctt_k    = np.ma.asarray(tmp_var[:]).squeeze().astype(np.float32).filled(np.nan) if tmp_var else np.full_like(cth_m, np.nan)

            if phase_var is not None:
                raw_phase = np.ma.asarray(phase_var[:]).squeeze().filled(255).astype(np.int16)
            else:
                # Derive a simplified phase from temperature (conservative)
                raw_phase = np.full(cth_m.shape, 5, dtype=np.int16)   # unknown default
                valid_ctt = np.isfinite(ctt_k) & np.isfinite(cth_m)
                raw_phase[valid_ctt & (ctt_k >= 273.15)] = 1   # liquid
                raw_phase[valid_ctt & (ctt_k < 273.15) & (ctt_k >= 253.15)] = 2  # supercooled
                raw_phase[valid_ctt & (ctt_k < 253.15)] = 4   # ice

            proj_lat, proj_lon = _goes_latlon(satellite, *cth_m.shape)
    except Exception as exc:
        log.warning("GOES %s: NetCDF decode failed: %s", satellite, exc)
        return None

    arrays = _project_to_grid(proj_lat, proj_lon, cth_m, ctt_k, raw_phase,
                               sat["bounds"], satellite)
    # Cache the projected field
    path = frame_path(cache_root, satellite, dt)
    buf = BytesIO()
    np.savez_compressed(
        buf,
        schema_version=np.int16(_CACHE_SCHEMA),
        **{k: v.astype(np.float32) for k, v in arrays.items()},
    )
    _atomic_write(path, buf.getvalue())
    log.info("GOES %s: cached %s (%d bytes)", satellite, path.name, path.stat().st_size)
    return arrays


# ── Public API (mirrors gk2a_cloud.py interface) ─────────────────────────────

def latest_goes_field(
    satellite: str,
    dt: datetime,
    cache_root: Path,
    *,
    allow_download: bool = False,
    max_age: timedelta = timedelta(hours=2),
) -> dict | None:
    """Return the most recent projected GOES field at or before ``dt``.

    Checks the npz cache first. Downloads from S3 only when
    ``allow_download=True`` and s3fs is installed.
    """
    if satellite not in SATELLITES:
        raise ValueError(f"Unknown GOES satellite: {satellite!r}")

    now = dt.astimezone(timezone.utc)
    times = frame_times(cache_root, satellite, now)

    # Try cached frames within max_age
    for t in times:
        if now - t > max_age:
            break
        _, _, arrays = read_frame(frame_path(cache_root, satellite, t))
        if arrays is not None:
            return arrays

    if not allow_download:
        return None

    # Attempt S3 download for the requested time
    return _download_goes_frame(satellite, dt, cache_root)


def goes_status(satellite: str, cache_root: Path) -> dict:
    """Return collection health dict for one GOES satellite."""
    now = datetime.now(timezone.utc)
    times = frame_times(cache_root, satellite, now)
    latest = None
    if times:
        t = times[0]
        state, schema, _ = read_frame(frame_path(cache_root, satellite, t))
        latest = {
            "ts": _stamp(t),
            "observed_at": _iso(t),
            "age_min": round((now - t).total_seconds() / 60, 1),
            "schema_version": schema,
            "state": state,
        }
    sat = SATELLITES[satellite]
    return {
        "source": f"NOAA_ABI_L2_ACHA_{satellite}",
        "satellite": sat["label"],
        "bucket": sat["bucket"],
        "domain_bounds": sat["bounds"],
        "latest_field": latest,
        "frame_count": len(times),
    }
