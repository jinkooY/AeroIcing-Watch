"""Read and interpolate local ECMWF IFS pressure-level bundles."""

import json
from datetime import datetime
from functools import lru_cache
from itertools import product
from pathlib import Path
from zipfile import BadZipFile

import numpy as np

FIELDS = ("gh", "t", "r", "u", "v")
UNITS = {"gh": {"gpm", "m"}, "t": {"K"}, "r": {"%"}, "u": {"m s**-1", "m/s"}, "v": {"m s**-1", "m/s"}}


@lru_cache(maxsize=8)
def load_bundle(path: Path, mtime_ns: int, size: int):
    with np.load(path, allow_pickle=False) as file:
        meta = json.loads(file["metadata"].item())
        lat, lon = file["lat"], file["lon"]
        data = np.stack([file[field] for field in FIELDS], axis=-1)
    valid = [datetime.fromisoformat(value) for value in meta["valid_times"]]
    if any(dt.utcoffset() is None for dt in valid):
        raise ValueError("IFS validity timestamps must be timezone-aware")
    levels = np.log(np.array(meta["pressure_levels_hpa"], dtype=float)[::-1])
    axes = tuple(np.asarray(a, dtype=float) for a in ([dt.timestamp() for dt in valid], levels, lat, lon))
    if (
        meta["schema"] != 1 or meta["product"] not in ("0p25", "0p1")
        or any(meta["units"].get(k) not in u for k, u in UNITS.items())
        or data.shape != tuple(len(a) for a in axes) + (len(FIELDS),)
        or any(len(a) < 2 or not np.isfinite(a).all() or np.any(np.diff(a) <= 0) for a in axes)
    ):
        raise ValueError("Invalid IFS bundle units, axes or shape")
    return meta, axes, data[:, ::-1]


def bundles(root: Path):
    for path in root.glob("*.npz"):
        try:
            stat = path.stat()
            bundle = load_bundle(path, stat.st_mtime_ns, stat.st_size)
            initialized = datetime.fromisoformat(bundle[0]["initialized_at"])
            received = datetime.fromisoformat(bundle[0]["received_at"])
            if initialized.utcoffset() is None or received.utcoffset() is None or received < initialized:
                continue
            yield initialized, received, bundle
        except (OSError, ValueError, TypeError, KeyError, EOFError, BadZipFile):
            continue


def choose_bundle(root: Path, decision: datetime, product_name: str, initialized_at: datetime | None):
    choices = [
        (run, received, bundle)
        for run, received, bundle in bundles(root)
        if received <= decision and bundle[0]["product"] == product_name
        and (initialized_at is None or run == initialized_at)
    ]
    return max(choices, key=lambda value: value[:2])[2] if choices else None


def _weights(axis, coordinate):
    index = int(np.searchsorted(axis, coordinate))
    if index < len(axis) and np.isclose(axis[index], coordinate, rtol=0, atol=1e-9):
        return ((index, 1.0),)
    if index == 0 or index == len(axis):
        return None
    weight = (coordinate - axis[index - 1]) / (axis[index] - axis[index - 1])
    return ((index - 1, 1 - weight), (index, weight))


def sample(bundle, lat: float, lon: float, pressure_hpa: float, at: datetime):
    _, axes, data = bundle
    lon_axis = axes[3]
    # Bundles may be unwrapped across the antimeridian (e.g. 140 .. 240 deg E).
    lon = float(lon_axis[0] + (lon - lon_axis[0]) % 360.0)
    coords = (at.timestamp(), np.log(pressure_hpa), lat, lon)
    weights = [_weights(axis, coordinate) for axis, coordinate in zip(axes, coords)]
    for weight, reason in zip(weights, ("outside_time", "outside_level", "outside_domain", "outside_domain")):
        if weight is None:
            return reason, None
    values = np.zeros(len(FIELDS))
    for corner in product(*weights):
        indices, coefficients = zip(*corner)
        values += data[indices] * np.prod(coefficients)
    return "ready", {
        key: float(value) if np.isfinite(value) else None for key, value in zip(FIELDS, values)
    }
