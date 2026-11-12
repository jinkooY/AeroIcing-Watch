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
    clear        float32  1 = ACTP positively reports clear sky (GOES only)
    (emis11 is not available from ABI and is not stored)

Products (anonymous S3): ABI-L2-ACHAF (HT), ABI-L2-ACHTF (TEMP), ABI-L2-ACTPF (Phase).
ACHAF has no phase and no temperature; phase comes from ACTPF, never inferred.

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
    # GOES-19 replaced GOES-16 as GOES-East in April 2025; G16 is archive-only.
    "G19": {
        "bucket": "noaa-goes19",
        "sub_lon": -75.2,
        "label": "GOES-19",
        "bounds": ((-81.0, -155.0), (81.0, -15.0)),
    },
    # Himawari-9 AHI shares this cache format; downloads live in himawari_cloud.py.
    "H09": {
        "bucket": "noaa-himawari9",
        "sub_lon": 140.7,
        "label": "Himawari-9",
        "kind": "ahi",
        "bounds": ((-70.0, 85.0), (70.0, -155.0)),   # wraps 180 deg
    },
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
_CACHE_SCHEMA = 11          # version tag for GOES npz files

REQUIRED_FIELDS = ("cth_ft", "ctt_k", "phase", "supercooled", "clear")
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


# ── S3 download + projection ─────────────────────────────────────────────────

_PRODUCTS = {"cth": "ABI-L2-ACHAF", "ctt": "ABI-L2-ACHTF", "phase": "ABI-L2-ACTPF"}


def _scan_start(key: str) -> datetime | None:
    """Parse the scan start (sYYYYJJJHHMMSSt) from an ABI file name."""
    for part in key.split("/")[-1].split("_"):
        if part.startswith("s") and len(part) == 15 and part[1:].isdigit():
            try:
                return datetime.strptime(part[1:14], "%Y%j%H%M%S").replace(tzinfo=timezone.utc)
            except ValueError:
                return None
    return None


def _list_scans(fs, bucket: str, product: str, dt: datetime) -> dict[datetime, str]:
    """Map scan start -> key for the hour of ``dt`` and the previous hour."""
    found: dict[datetime, str] = {}
    for delta_h in (0, -1):
        t = dt + timedelta(hours=delta_h)
        prefix = f"{bucket}/{product}/{t.year}/{t.timetuple().tm_yday:03d}/{t.hour:02d}/"
        try:
            keys = fs.ls(prefix, detail=False)
        except FileNotFoundError:
            continue
        for key in keys:
            start = _scan_start(key)
            if start is not None:
                found[start] = key
    return found


def project_abi(ds_vars: dict, satellite: str) -> dict:
    """Inverse-sample ABI arrays (scan-angle grid) onto the shared grid.

    ``ds_vars`` maps name -> (x, y, 2-D array in physical units, NaN = missing).
    """
    from src.integration.geogrid import sample_geos

    sat = SATELLITES[satellite]
    out: dict = {}
    for name, (x, y, arr) in ds_vars.items():
        out.update(sample_geos(x, y, sat["sub_lon"], sat["bounds"], _GRID_SHAPE, {name: arr}))
    return out


def _read_abi(raw: bytes, var: str, max_dqf: int | None = None):
    import netCDF4 as nc4
    with nc4.Dataset("inmemory", memory=raw) as ds:
        arr = np.ma.asarray(ds.variables[var][:]).astype(np.float32).filled(np.nan)
        if max_dqf is not None and "DQF" in ds.variables:
            dqf = np.ma.asarray(ds.variables["DQF"][:]).filled(255)
            arr = np.where(dqf <= max_dqf, arr, np.nan)
        x = np.asarray(ds.variables["x"][:], dtype=np.float64)
        y = np.asarray(ds.variables["y"][:], dtype=np.float64)
    return x, y, arr


def build_arrays(cth_m, ctt_k, abi_phase, grids: dict, satellite: str) -> dict:
    """Combine raw (grid-separate) ABI arrays into the shared field dict.

    ``grids`` holds the (x, y) scan-angle coordinates for each of the inputs.
    """
    proj = project_abi(
        {
            "cth_m": (*grids["cth"], cth_m),
            "ctt_k": (*grids["ctt"], ctt_k),
            "abi_phase": (*grids["phase"], abi_phase),
        },
        satellite,
    )
    cth_ft = proj["cth_m"] * np.float32(3.28084)
    phase, sc = _map_phase(np.nan_to_num(proj["abi_phase"], nan=-1).astype(np.int16))
    cloudy = np.isfinite(cth_ft)
    # Cloud-top height defines where cloud exists; phase only qualifies it.
    phase = np.where(cloudy & ~np.isfinite(phase), np.float32(6.0), phase)
    phase[~cloudy] = np.nan
    sc[~cloudy] = np.nan
    # 1 only where ACTP positively reports clear sky; a missing height under a
    # cloudy/unknown phase is an unassessed pixel, never "clear".
    clear = ((proj["abi_phase"] == 0) & ~cloudy).astype(np.float32)
    return {
        "clear": clear,
        "cth_ft": cth_ft.astype(np.float32),
        "ctt_k": proj["ctt_k"].astype(np.float32),
        "phase": phase.astype(np.float32),
        "supercooled": sc.astype(np.float32),
    }


def save_frame(path: Path, arrays: dict) -> None:
    buf = BytesIO()
    np.savez_compressed(
        buf, schema_version=np.int16(_CACHE_SCHEMA),
        **{k: arrays[k].astype(np.float32) for k in REQUIRED_FIELDS},
    )
    _atomic_write(path, buf.getvalue())


def download_frame(satellite: str, dt: datetime, cache_root: Path) -> datetime | None:
    """Download the newest ABI full-disk scan at or before ``dt`` into the cache.

    Returns the scan start time, or None when S3 / s3fs is unavailable or no
    complete scan exists. Phase is taken from ACTP and temperature from ACHT;
    nothing is inferred from temperature alone.
    """
    try:
        import s3fs
    except ImportError:
        log.info("s3fs not installed; GOES download unavailable")
        return None
    sat = SATELLITES[satellite]
    utc = dt.astimezone(timezone.utc)
    try:
        fs = s3fs.S3FileSystem(anon=True)
        scans = {p: _list_scans(fs, sat["bucket"], prod, utc) for p, prod in _PRODUCTS.items()}
    except Exception as exc:  # network / credentials-less S3 errors
        log.warning("GOES %s: S3 listing failed: %s", satellite, exc)
        return None
    common = sorted(
        (t for t in scans["cth"] if t <= utc and all(
            any(abs((t - u).total_seconds()) < 60 for u in scans[p]) for p in ("ctt", "phase"))),
        reverse=True,
    )
    if not common:
        return None
    start = common[0]
    try:
        raws = {}
        for p in _PRODUCTS:
            key = next(k for u, k in scans[p].items() if abs((start - u).total_seconds()) < 60)
            raws[p] = fs.open(key, "rb").read()
        cth_x, cth_y, cth = _read_abi(raws["cth"], "HT", max_dqf=1)
        ctt_x, ctt_y, ctt = _read_abi(raws["ctt"], "TEMP", max_dqf=1)
        ph_x, ph_y, ph = _read_abi(raws["phase"], "Phase")
        arrays = build_arrays(
            cth, ctt, ph,
            {"cth": (cth_x, cth_y), "ctt": (ctt_x, ctt_y), "phase": (ph_x, ph_y)},
            satellite,
        )
    except Exception as exc:
        log.warning("GOES %s: download/decode failed: %s", satellite, exc)
        return None
    frame_time = start.replace(second=0, microsecond=0)
    save_frame(frame_path(cache_root, satellite, frame_time), arrays)
    log.info("GOES %s: cached scan %s", satellite, frame_time.isoformat())
    return frame_time


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

    frame_time = download_frame(satellite, dt, cache_root)
    if frame_time is None:
        return None
    _, _, arrays = read_frame(frame_path(cache_root, satellite, frame_time))
    return arrays


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
