"""Himawari-9 AHI Level-2 cloud reader (NOAA open S3 bucket ``noaa-himawari9``).

Verified against real files (AHI-L2-FLDK-Clouds, 2026-11-12 13:20 UTC):
    AHI-CHGT  CldTopHght (m), CldTopTemp (K), Latitude, Longitude   (5500 x 5500, 2 km)
    AHI-CPHS  CloudPhase int8, valid_range 0-5, same grid
Phase codes follow the NOAA Common Cloud Framework / ABI ACTP convention
(0 clear, 1 liquid, 2 supercooled, 3 mixed, 4 ice, 5 unknown). The file
metadata does not list the codes, but cloud-top temperature per code agrees
(mean CTT: liquid 284 K, supercooled 264 K, mixed 253 K, ice 231 K). Phase is
only ever taken from CloudPhase, never inferred from temperature.

``CloudHgtQF`` semantics are undocumented in the file and are not used.

A scan is ~0.9 GB for the two files; use ``tools/collect_himawari.py``
(never called from API requests). Output uses the shared goes_cloud cache
format (``FIELD/H09/...``, schema 11).
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

from src.integration import goes_cloud
from src.integration.geogrid import bin_latlon

log = logging.getLogger(__name__)

BUCKET = "noaa-himawari9"
PREFIX = "AHI-L2-FLDK-Clouds"


def _scan_dirs(fs, dt: datetime) -> list[str]:
    """Ten-minute scan directories for the hour of ``dt`` and the previous hour."""
    out: list[str] = []
    for delta_h in (0, -1):
        t = dt + timedelta(hours=delta_h)
        base = f"{BUCKET}/{PREFIX}/{t:%Y/%m/%d}/"
        try:
            out += [d for d in fs.ls(base, detail=False) if d.rstrip("/").split("/")[-1].startswith(f"{t:%H}")]
        except FileNotFoundError:
            continue
    return out


def _dir_time(path: str) -> datetime | None:
    parts = path.rstrip("/").split("/")
    try:
        return datetime.strptime("".join(parts[-4:]), "%Y%m%d%H%M").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def project_ahi(lat, lon, cth_m, ctt_k, phase_raw, satellite: str = "H09") -> dict:
    """Bin AHI pixels (per-pixel lat/lon) onto the shared grid."""
    ph, sc = goes_cloud._map_phase(np.nan_to_num(phase_raw, nan=-1).astype(np.int16))
    cth_ft = (cth_m * np.float32(3.28084)).astype(np.float32)
    cloudy = np.isfinite(cth_ft)
    ph = np.where(cloudy & ~np.isfinite(ph), np.float32(6.0), ph)
    clear = ((phase_raw == 0) & ~cloudy).astype(np.float32)
    ph[~cloudy] = np.nan
    sc[~cloudy] = np.nan
    bounds = goes_cloud.SATELLITES[satellite]["bounds"]
    out = bin_latlon(
        lat, lon,
        {"cth_ft": cth_ft, "ctt_k": ctt_k, "phase": ph, "supercooled": sc, "clear": clear},
        bounds, goes_cloud._GRID_SHAPE,
    )
    # Cells never hit by a pixel are "no data", not clear.
    out["clear"] = np.nan_to_num(out["clear"], nan=0.0)
    return out


def download_frame(dt: datetime, cache_root: Path, satellite: str = "H09") -> datetime | None:
    """Download the newest complete AHI cloud scan at or before ``dt`` into the cache."""
    try:
        import s3fs
        import netCDF4 as nc4
    except ImportError:
        log.info("s3fs/netCDF4 missing; Himawari download unavailable")
        return None
    utc = dt.astimezone(timezone.utc)
    try:
        fs = s3fs.S3FileSystem(anon=True)
        dirs = sorted(((t, d) for d in _scan_dirs(fs, utc) if (t := _dir_time(d)) and t <= utc), reverse=True)
        for start, d in dirs:
            keys = fs.ls(d, detail=False)
            chgt = next((k for k in keys if "AHI-CHGT" in k), None)
            cphs = next((k for k in keys if "AHI-CPHS" in k), None)
            if chgt and cphs:
                break
        else:
            return None
        def var(raw, name):
            with nc4.Dataset("inmemory", memory=raw) as ds:
                return np.ma.asarray(ds.variables[name][:]).astype(np.float32).filled(np.nan)
        raw = fs.open(chgt, "rb").read()
        lat, lon = var(raw, "Latitude"), var(raw, "Longitude")
        cth, ctt = var(raw, "CldTopHght"), var(raw, "CldTopTemp")
        del raw
        raw = fs.open(cphs, "rb").read()
        phase = var(raw, "CloudPhase")
        del raw
        arrays = project_ahi(lat, lon, cth, ctt, phase, satellite)
    except Exception as exc:
        log.warning("Himawari download/decode failed: %s", exc)
        return None
    goes_cloud.save_frame(goes_cloud.frame_path(cache_root, satellite, start), arrays)
    log.info("Himawari %s: cached scan %s", satellite, start.isoformat())
    return start
