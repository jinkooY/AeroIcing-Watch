"""Read-only WeatherPath-compatible GK-2A projected caches."""

import logging
import os
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from zipfile import BadZipFile

import numpy as np

log = logging.getLogger(__name__)

# Projected-cache areas, selected with GK2A_CLOUD_AREA. Each cache is a lat/lon
# (Mercator-row) grid written by the external collector under FIELD/<AREA>/.
# KO is the verified legacy domain. EA / FD bounds are *planned* cache grids for
# the wider KMA APIHub GK-2A L2 areas (East Asia, Full Disk). They are
# UNVERIFIED: no KMA key was available, so what APIHub really delivers for CTPS
# beyond KO has not been checked. Override with GK2A_CLOUD_BOUNDS="S,W,N,E" and
# GK2A_CLOUD_SHAPE="H,W" to match the collector actually used.
AREAS = {
    "KO": {"bounds": ((32.0, 122.0), (44.5, 134.5)), "shape": (500, 620)},
    "EA": {"bounds": ((15.0, 100.0), (55.0, 170.0)), "shape": (500, 880)},
    "FD": {"bounds": ((-60.0, 70.0), (60.0, 180.0)), "shape": (500, 880)},
}


def configured_area() -> tuple[str, tuple, tuple]:
    """Return (area, bounds, shape) from GK2A_CLOUD_AREA / _BOUNDS / _SHAPE."""
    name = (os.getenv("GK2A_CLOUD_AREA") or "KO").strip().upper()
    if name not in AREAS:
        log.warning("Unknown GK2A_CLOUD_AREA %r; using KO", name)
        name = "KO"
    bounds, shape = AREAS[name]["bounds"], AREAS[name]["shape"]
    try:
        if os.getenv("GK2A_CLOUD_BOUNDS"):
            s, w, n, e = (float(v) for v in os.environ["GK2A_CLOUD_BOUNDS"].split(","))
            if not (-90 <= s < n <= 90 and -180 <= w < e <= 180):
                raise ValueError("bounds out of range")
            bounds = ((s, w), (n, e))
        if os.getenv("GK2A_CLOUD_SHAPE"):
            h, wd = (int(v) for v in os.environ["GK2A_CLOUD_SHAPE"].split(","))
            if h < 2 or wd < 2:
                raise ValueError("shape too small")
            shape = (h, wd)
    except ValueError as exc:
        log.warning("Invalid GK-2A area override ignored: %s", exc)
    return name, bounds, shape


AREA, BOUNDS, SHAPE = configured_area()
SOURCE = "GK2A_L2_CTPS"
CTPS_FIELDS = ("cth_ft", "ctt_k", "phase", "ctps_flag")
OPTIONAL_FIELDS = ("supercooled", "emis11")
OPTICS_FIELDS = ("lwp_gm2", "iwp_gm2", "cot", "dcoew_dqf")


def timestamp(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y%m%d%H%M")


def iso_utc(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def frame_path(root: Path, dt: datetime, product: str = "FIELD") -> Path:
    stamp = timestamp(dt)
    return root / product / AREA / stamp[:8] / f"{stamp}.npz"


def frame_times(root: Path, now: datetime) -> list[datetime]:
    times = []
    for path in (root / "FIELD" / AREA).glob("*/*.npz"):
        if len(path.stem) != 12 or path.parent.name != path.stem[:8]:
            continue
        try:
            dt = datetime.strptime(path.stem, "%Y%m%d%H%M").replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        if dt <= now:
            times.append(dt)
    return sorted(times, reverse=True)


@lru_cache(maxsize=8)
def _read_arrays(path: Path, mtime_ns: int, size: int, optics: bool) -> tuple[int, dict]:
    # The file identity in the cache key invalidates a replaced frame.
    with np.load(path, allow_pickle=False) as values:
        schema = int(values["schema_version"].item())
        if schema not in ({1} if optics else {2, 3, 4}):
            raise ValueError("Unsupported projected cache schema")
        if not optics and int(values["ctps_available"].item()) != 1:
            raise ValueError("Projected CTPS frame is unavailable")
        required = OPTICS_FIELDS if optics else CTPS_FIELDS
        names = required if optics else required + tuple(
            name for name in OPTIONAL_FIELDS if name in values
        )
        arrays = {name: values[name] for name in names}
        for array in arrays.values():
            if array.shape != SHAPE or array.dtype.kind not in "iuf":
                raise ValueError("Invalid projected grid shape or dtype")
            array.setflags(write=False)
        return schema, arrays


def read_frame(path: Path, *, optics: bool = False) -> tuple[str, int | None, dict | None]:
    try:
        stat = path.stat()
        schema, arrays = _read_arrays(path, stat.st_mtime_ns, stat.st_size, optics)
        return "ready", schema, arrays
    except FileNotFoundError:
        return "missing", None, None
    except (OSError, ValueError, TypeError, KeyError, EOFError, BadZipFile):
        log.warning("Unreadable GK-2A cache frame %s", path.name, exc_info=True)
        return "corrupt", None, None
