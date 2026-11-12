"""Meteosat MSG CTTH Level-2 cloud observation reader.

Reads projected npz caches produced by the collector worker, or downloads
from the EUMETSAT Data Store when credentials are configured.

Product: EO:EUM:DAT:MSG:CTTH
  - Cloud Top Temperature and Height (CTTH)
  - Sensor: SEVIRI aboard Meteosat-9/12
  - Update: every 15 min (Rapid Scan: 5 min over Europe)
  - Coverage: lat 60°S–80°N, lon 60°W–80°E (Meteosat-12 at 0°E)

Shared field schema (matches gk2a_cloud.py and goes_cloud.py):
    cth_ft       float32  cloud top height ft MSL
    ctt_k        float32  cloud top temperature K
    phase        float32  1=liquid 2=ice 6=unknown
    supercooled  float32  1=yes 0=no (NaN when not retrieved)
    emis11       float32  not available from MSG CTTH; always NaN

Meteosat CTTH phase codes → shared schema:
    1  liquid     → phase=1  supercooled=0
    2  ice        → phase=2  supercooled=0
    3  supercooled→ phase=1  supercooled=1
    4  mixed      → phase=1  supercooled=1  (conservative)
    8  uncertain  → phase=6
    0/fill        → NaN (clear or missing)
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

SATELLITE = "MSG"
LABEL = "Meteosat MSG CTTH"
PRODUCT_ID = "EO:EUM:DAT:MSG:CTTH"
SUB_LON = 0.0
BOUNDS = ((-60.0, -60.0), (80.0, 80.0))   # (lat_min, lon_min), (lat_max, lon_max)
_GRID_SHAPE = (500, 620)
_CACHE_SCHEMA = 20
FRESHNESS = timedelta(minutes=20)
REQUIRED_FIELDS = ("cth_ft", "ctt_k", "phase", "supercooled")


# ── Phase mapping ─────────────────────────────────────────────────────────────

def _map_phase(msg_phase: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    phase = np.full(msg_phase.shape, np.nan, dtype=np.float32)
    sc    = np.full(msg_phase.shape, np.nan, dtype=np.float32)
    phase[np.isin(msg_phase, [1])]    = 1.0;  sc[np.isin(msg_phase, [1])]    = 0.0
    phase[np.isin(msg_phase, [2])]    = 2.0;  sc[np.isin(msg_phase, [2])]    = 0.0
    phase[np.isin(msg_phase, [3, 4])] = 1.0;  sc[np.isin(msg_phase, [3, 4])] = 1.0
    phase[np.isin(msg_phase, [8])]    = 6.0
    return phase, sc


# ── Cache paths ───────────────────────────────────────────────────────────────

def _stamp(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y%m%d%H%M")


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def frame_path(root: Path, dt: datetime) -> Path:
    stamp = _stamp(dt)
    return root / "FIELD" / SATELLITE / stamp[:8] / f"{stamp}.npz"


def frame_times(root: Path, now: datetime) -> list[datetime]:
    area_root = root / "FIELD" / SATELLITE
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


# ── npz I/O ───────────────────────────────────────────────────────────────────

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
            raise ValueError(f"Unsupported MSG cache schema {schema}")
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
        log.warning("Unreadable MSG cache %s", path.name, exc_info=True)
        return "corrupt", None, None


# ── EUMETSAT Data Store download ──────────────────────────────────────────────

def _eumetsat_token() -> str | None:
    """Obtain OAuth2 bearer token from EUMETSAT Data Store."""
    client_id     = os.getenv("EUMETSAT_CLIENT_ID", "").strip()
    client_secret = os.getenv("EUMETSAT_CLIENT_SECRET", "").strip()
    if not client_id or not client_secret:
        return None
    try:
        import requests
        resp = requests.post(
            "https://api.eumetsat.int/token",
            data={"grant_type": "client_credentials"},
            auth=(client_id, client_secret),
            timeout=(5, 15),
        )
        if resp.status_code == 200:
            return resp.json().get("access_token")
        log.warning("EUMETSAT token request failed: HTTP %d", resp.status_code)
    except Exception as exc:
        log.warning("EUMETSAT token error: %s", exc)
    return None


def _project_msg_to_grid(src_lat, src_lon, src_cth_m, src_ctt_k, src_phase_raw) -> dict:
    """Bin MSG arrays (with per-pixel lat/lon) onto the shared Mercator-row grid."""
    from src.integration.geogrid import bin_latlon

    ph, sc = _map_phase(src_phase_raw)
    cth_ft = (src_cth_m * np.float32(3.28084)).astype(np.float32)
    out = bin_latlon(
        src_lat, src_lon,
        {"cth_ft": cth_ft, "ctt_k": src_ctt_k, "phase": ph, "supercooled": sc},
        BOUNDS, _GRID_SHAPE,
    )
    cloudy = np.isfinite(out["cth_ft"])
    for k in ("phase", "supercooled"):
        out[k][~cloudy] = np.nan
    return out


def _collection() -> str:
    # The CTTH collection id is configurable because it could not be verified
    # without EUMETSAT credentials (see docs/Global_Satellite_Status.md).
    return os.getenv("EUMETSAT_CTTH_COLLECTION", PRODUCT_ID).strip()


def _download_msg_frame(dt: datetime, cache_root: Path) -> dict | None:
    """Download one MSG CTTH granule and project it. UNVERIFIED against live API.

    Returns None (graceful "source unavailable") without credentials or on any
    network/decode problem.
    """
    token = _eumetsat_token()
    if token is None:
        log.debug("MSG download skipped: no EUMETSAT credentials")
        return None
    import requests
    from urllib.parse import quote

    utc = dt.astimezone(timezone.utc)
    headers = {"Authorization": f"Bearer {token}"}
    collection = _collection()
    try:
        resp = requests.get(
            "https://api.eumetsat.int/data/search-products/1.0.0/os",
            params={
                "format": "json", "pi": collection, "c": 1,
                "dtstart": (utc - timedelta(minutes=30)).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "dtend": utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
            },
            headers=headers, timeout=(5, 20),
        )
        resp.raise_for_status()
        feats = resp.json().get("features", [])
        if not feats:
            return None
        product_id = feats[0]["id"]
        raw_resp = requests.get(
            f"https://api.eumetsat.int/data/download/1.0.0/collections/"
            f"{quote(collection, safe='')}/products/{quote(product_id, safe='')}",
            headers=headers, timeout=(5, 120),
        )
        raw_resp.raise_for_status()
        raw = raw_resp.content
    except Exception as exc:
        log.warning("MSG CTTH search/download failed: %s", exc)
        return None

    try:
        import netCDF4 as nc4
        import zipfile
        from io import BytesIO as _B
        if raw[:2] == b"PK":  # Data Store delivers a zip of product files
            with zipfile.ZipFile(_B(raw)) as zf:
                name = next(n for n in zf.namelist() if n.endswith((".nc", ".h5")))
                raw = zf.read(name)
        with nc4.Dataset("inmemory", memory=raw) as ds:
            def pick(*names):
                for n in names:
                    if n in ds.variables:
                        return np.ma.asarray(ds.variables[n][:]).squeeze()
                return None
            lat = pick("lat", "latitude"); lon = pick("lon", "longitude")
            cth = pick("CTH", "cth", "cloud_top_height")
            ctt = pick("CTT", "ctt", "cloud_top_temperature")
            phs = pick("PHASE", "phase", "cloud_phase")
            if lat is None or lon is None or cth is None or phs is None:
                log.warning("MSG CTTH: required variables missing; product layout unverified")
                return None
            f32 = lambda a: a.astype(np.float32).filled(np.nan)
            cth_m = f32(cth)
            ctt_k = f32(ctt) if ctt is not None else np.full_like(cth_m, np.nan)
            raw_phase = phs.filled(0).astype(np.int16)
            arrays = _project_msg_to_grid(f32(lat), f32(lon), cth_m, ctt_k, raw_phase)
    except Exception as exc:
        log.warning("MSG CTTH decode failed: %s", exc)
        return None

    buf = BytesIO()
    np.savez_compressed(
        buf, schema_version=np.int16(_CACHE_SCHEMA),
        **{k: arrays[k].astype(np.float32) for k in REQUIRED_FIELDS},
    )
    path = frame_path(cache_root, dt.replace(second=0, microsecond=0))
    _atomic_write(path, buf.getvalue())
    return arrays


# ── Public API ────────────────────────────────────────────────────────────────

def latest_msg_field(
    dt: datetime,
    cache_root: Path,
    *,
    allow_download: bool = False,
    max_age: timedelta = timedelta(hours=2),
) -> dict | None:
    now = dt.astimezone(timezone.utc)
    for t in frame_times(cache_root, now):
        if now - t > max_age:
            break
        _, _, arrays = read_frame(frame_path(cache_root, t))
        if arrays is not None:
            return arrays
    if not allow_download:
        return None
    return _download_msg_frame(dt, cache_root)


def msg_status(cache_root: Path) -> dict:
    now = datetime.now(timezone.utc)
    times = frame_times(cache_root, now)
    latest = None
    if times:
        t = times[0]
        state, schema, _ = read_frame(frame_path(cache_root, t))
        latest = {
            "ts": _stamp(t),
            "observed_at": _iso(t),
            "age_min": round((now - t).total_seconds() / 60, 1),
            "schema_version": schema,
            "state": state,
        }
    configured = bool(os.getenv("EUMETSAT_CLIENT_ID"))
    return {
        "source": "EUMETSAT_MSG_CTTH",
        "satellite": LABEL,
        "product_id": PRODUCT_ID,
        "domain_bounds": BOUNDS,
        "credentials_configured": configured,
        "latest_field": latest,
        "frame_count": len(times),
    }
