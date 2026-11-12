"""Collect a small ECMWF Open Data IFS forecast into the local route cache."""

import argparse
import hashlib
import json
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile

import eccodes as ec
import numpy as np
import requests

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.integration.ifs_bbox import normalize_bbox, route_bbox  # noqa: E402

# Index selection and scan-direction-aware cropping adapted from WeatherPath
# ecmwf_highres.py and tools/ecmwf_highres/archive.py at b9caa0f1.
ROOTS = {
    "aws": "https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com",
    "ecmwf": "https://data.ecmwf.int/forecasts",
    "google": "https://storage.googleapis.com/ecmwf-open-data",
}
FIELDS = ("gh", "t", "r", "u", "v")
LEVELS = (850, 500, 300, 250)
BOUNDS = (30, 46, 118, 143)  # default (south, north, west, east); see --bbox / --route
BBOX_MAX_CELLS_DEG2 = 12000   # sanity cap on bbox area (deg^2); keeps bundles small
LIMIT = 64 * 1024 * 1024
PROJECT = Path(__file__).resolve().parents[1]


def read(url, *, offset=None, length=None, limit=4 * 1024 * 1024):
    headers = {"Accept-Encoding": "identity"}
    if offset is not None:
        headers["Range"] = f"bytes={offset}-{offset + length - 1}"
    with requests.get(url, headers=headers, stream=True, timeout=(10, 40)) as response:
        response.raise_for_status()
        if offset is not None and (
            response.status_code != 206
            or not response.headers.get("Content-Range", "").startswith(
                f"bytes {offset}-{offset + length - 1}/"
            )
        ):
            raise ValueError("Upstream did not honor the GRIB range")
        data = bytearray()
        for chunk in response.iter_content(65536):
            data.extend(chunk)
            if len(data) > limit:
                raise ValueError("Response exceeds byte budget")
    if length is not None and len(data) != length:
        raise ValueError("Truncated GRIB range")
    return bytes(data)


def select(url, run, step):
    rows = [json.loads(line) for line in read(url).splitlines() if line.strip()]
    matches = {}
    for row in rows:
        if (
            row.get("levtype") != "pl" or row.get("param") not in FIELDS
            or str(row.get("date")) != run.strftime("%Y%m%d")
            or str(row.get("time")).zfill(4) != run.strftime("%H%M")
            or str(row.get("step")) != str(step) or row.get("stream") != "oper"
            or row.get("type") != "fc"
        ):
            continue
        level = int(row["levelist"])
        if level not in LEVELS:
            continue
        key = (row["param"], level)
        if key in matches:
            raise ValueError(f"Duplicate index field {key}")
        offset, length = int(row["_offset"]), int(row["_length"])
        if offset < 0 or length < 20:
            raise ValueError("Invalid GRIB byte range")
        matches[key] = (offset, length)
    if len(matches) != len(FIELDS) * len(LEVELS):
        raise ValueError("Incomplete IFS pressure-level index")
    return matches


def decode(data, run, step, field, level, resolution, bounds=None):
    if not data.startswith(b"GRIB") or not data.endswith(b"7777"):
        raise ValueError("Invalid GRIB envelope")
    handle = ec.codes_new_from_message(data)
    try:
        def get(name):
            return ec.codes_get(handle, name)

        if (
            get("gridType") != "regular_ll" or get("jPointsAreConsecutive")
            or get("alternativeRowScanning") or get("shortName") != field
            or get("dataDate") != int(run.strftime("%Y%m%d"))
            or get("dataTime") != run.hour * 100 or get("endStep") != step
            or get("typeOfLevel") != "isobaricInhPa" or get("level") != level
        ):
            raise ValueError("Unexpected GRIB grid or field identity")
        ni, nj = get("Ni"), get("Nj")
        dx, dy = get("iDirectionIncrementInDegrees"), get("jDirectionIncrementInDegrees")
        if not (np.isclose(dx, resolution) and np.isclose(dy, resolution)):
            raise ValueError("Unexpected GRIB resolution")
        lon = (get("longitudeOfFirstGridPointInDegrees") + np.arange(ni) * dx *
               (-1 if get("iScansNegatively") else 1)) % 360
        lat = (get("latitudeOfFirstGridPointInDegrees") + np.arange(nj) * dy *
               (1 if get("jScansPositively") else -1))
        south, north, west, east = bounds or BOUNDS
        # Longitudes are measured eastward from ``west`` so a box across 180 deg
        # stays contiguous; the stored axis is unwrapped (west .. east, east may exceed 180).
        rel = (lon - west) % 360
        span = east - west
        if span >= 360:
            rel = (lon - west) % 360
        iy = np.flatnonzero((lat >= south - 1e-6) & (lat <= north + 1e-6))
        ix = np.flatnonzero(rel <= span + 1e-6)
        lon = west + rel
        iy, ix = iy[np.argsort(lat[iy])], ix[np.argsort(lon[ix])]
        values = ec.codes_get_values(handle).reshape(nj, ni)[np.ix_(iy, ix)]
        if get("bitmapPresent"):
            values[values == get("missingValue")] = np.nan
        return lat[iy], lon[ix], values.astype(np.float32), str(get("units"))
    finally:
        ec.codes_release(handle)


def collect(root, run, steps, source, product, bounds=None):
    bounds = bounds or BOUNDS
    resolution = {"0p25": 0.25, "0p1": 0.1}[product]
    suffix = "-pl" if product == "0p1" else ""
    jobs = []
    urls = []
    for step in steps:
        url = (f"{ROOTS[source]}/{run:%Y%m%d}/{run:%H}z/ifs/{product}/oper/"
               f"{run:%Y%m%d%H}0000-{step}h-oper-fc{suffix}")
        urls.append(url + ".grib2")
        jobs.extend((step, key, offset, length, url + ".grib2")
                    for key, (offset, length) in select(url + ".index", run, step).items())
    size = sum(job[3] for job in jobs)
    if size > LIMIT:
        raise ValueError("Requested forecast exceeds 64 MiB")
    print(f"{len(jobs)} GRIB messages, {size} bytes", flush=True)

    def fetch(job):
        step, (field, level), offset, length, url = job
        data = read(url, offset=offset, length=length, limit=length)
        return step, field, level, data, url, offset, length, datetime.now(timezone.utc).isoformat()

    with ThreadPoolExecutor(max_workers=4) as pool:
        downloads = list(pool.map(fetch, jobs))
    lat, lon = None, None
    arrays = {}
    units = {}
    messages = []
    for step, field, level, data, url, offset, length, received in downloads:
        y, x, values, unit = decode(data, run, step, field, level, resolution, bounds)
        if lat is None:
            lat, lon = y, x
        if not (np.array_equal(y, lat) and np.array_equal(x, lon)):
            raise ValueError("Inconsistent IFS grid coordinates")
        if units.setdefault(field, unit) != unit:
            raise ValueError("Inconsistent IFS field units")
        arrays[step, field, level] = values
        messages.append(dict(step=step, field=field, level_hpa=level, sha256=hashlib.sha256(data).hexdigest(),
                             url=url, offset=offset, bytes=length, received_at=received))
    received = datetime.now(timezone.utc)
    meta = dict(schema=1, source="ECMWF Open Data IFS", mirror=source, product=product,
                resolution_deg=resolution, initialized_at=run.isoformat(),
                received_at=received.isoformat(), steps=steps,
                valid_times=[(run + timedelta(hours=s)).isoformat() for s in steps],
                pressure_levels_hpa=LEVELS, bbox=list(bounds), units=units,
                urls=urls, messages=messages, downloaded_bytes=size)
    root.mkdir(parents=True, exist_ok=True)
    path = root / f"{product}-{run:%Y%m%d%H}-{received:%Y%m%dT%H%M%S%f}.npz"
    temporary = None
    try:
        with NamedTemporaryFile(dir=root, delete=False) as f:
            temporary = Path(f.name)
            np.savez_compressed(
                f, lat=lat, lon=lon, metadata=json.dumps(meta),
                **{field: np.stack([np.stack([arrays[s, field, p] for p in LEVELS])
                                   for s in steps]) for field in FIELDS},
            )
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", required=True, help="UTC YYYYMMDDHH")
    parser.add_argument("--steps", nargs="+", type=int, required=True)
    parser.add_argument("--source", choices=ROOTS, default="google")
    parser.add_argument("--product", choices=("0p25", "0p1"), default="0p25")
    parser.add_argument("--root", type=Path, default=PROJECT / "data" / "ifs")
    box = parser.add_mutually_exclusive_group()
    box.add_argument("--bbox", nargs=4, type=float, metavar=("S", "N", "W", "E"),
                     help="crop box; E may be < W or > 180 to cross the antimeridian")
    box.add_argument("--route", nargs=4, type=float, metavar=("LAT1", "LON1", "LAT2", "LON2"),
                     help="derive the box from the great circle between two points")
    parser.add_argument("--margin", type=float, default=5.0, help="degrees added around --route")
    args = parser.parse_args()
    run = datetime.strptime(args.run, "%Y%m%d%H").replace(tzinfo=timezone.utc)
    steps = sorted(set(args.steps))
    if run.hour not in (0, 6, 12, 18) or run > datetime.now(timezone.utc):
        parser.error("run must be a past standard UTC cycle")
    if len(steps) < 2 or any(s < 0 or s > 144 or s % 3 for s in steps):
        parser.error("supply at least two forecast steps from 0 to 144 in increments of 3")
    bounds = None
    try:
        if args.bbox:
            bounds = normalize_bbox(*args.bbox)
        elif args.route:
            bounds = route_bbox(*args.route, margin_deg=args.margin)
    except ValueError as exc:
        parser.error(str(exc))
    if bounds and (bounds[1] - bounds[0]) * (bounds[3] - bounds[2]) > BBOX_MAX_CELLS_DEG2:
        parser.error("bbox area too large for a route bundle")
    print("bbox (S N W E):", bounds or BOUNDS)
    print(collect(args.root, run, steps, args.source, args.product, bounds))


if __name__ == "__main__":
    main()
