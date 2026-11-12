"""Project one archived WeatherPath KO NetCDF frame into the local cache."""

import argparse
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from tempfile import NamedTemporaryFile

import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("weatherpath", type=Path, help="Path to the WeatherPath checkout.")
    parser.add_argument("stamp", help="UTC observation timestamp in YYYYMMDDHHMM.")
    args = parser.parse_args()
    if re.fullmatch(r"[0-9]{12}", args.stamp) is None:
        parser.error("stamp must be in YYYYMMDDHHMM")
    try:
        datetime.strptime(args.stamp, "%Y%m%d%H%M")
    except ValueError as exc:
        parser.error(str(exc))

    weatherpath = args.weatherpath.resolve()
    date = args.stamp[:8]
    raw = weatherpath / "data/overlay/gk2a_l2/CTPS/KO" / date / f"{args.stamp}.nc"
    output = PROJECT_ROOT / "data/overlay/gk2a_l2/FIELD/KO" / date / f"{args.stamp}.npz"
    if output.resolve().is_relative_to(weatherpath):
        parser.error("The output cache must be outside the WeatherPath checkout")
    if not raw.is_file():
        parser.error(f"Archived CTPS frame not found: {raw}")

    # WeatherPath resolves some geolocation references from its checkout.
    # These imports are used by this offline command only.
    sys.path.insert(0, str(weatherpath))
    os.chdir(weatherpath)
    from src.integration.gk2a_cloud import _project_dataset, prepare_ctps_product

    projected = _project_dataset(raw, "CTPS", "KO")
    if projected is None or "cth_km" not in projected:
        parser.exit(1, "Could not project the archived CTPS frame.\n")
    fields = prepare_ctps_product(**projected)

    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with NamedTemporaryFile(dir=output.parent, delete=False) as handle:
            temporary = Path(handle.name)
            np.savez_compressed(handle, schema_version=4, ctps_available=1, **fields)
        temporary.replace(output)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    print(output)


if __name__ == "__main__":
    main()
