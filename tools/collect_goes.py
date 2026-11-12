"""Download the newest GOES ABI cloud scan(s) into the projected cache.

Usage: python tools/collect_goes.py G18 G19 [--cache-root PATH]
Anonymous NOAA S3 access (needs s3fs); no credentials. Never writes outside the cache.
"""
import argparse
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.integration import goes_cloud  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("satellites", nargs="+", choices=sorted(goes_cloud.SATELLITES))
    ap.add_argument("--cache-root", default=os.getenv("GK2A_CACHE_ROOT")
                    or str(Path(__file__).resolve().parents[1] / "data/overlay/gk2a_l2"))
    ap.add_argument("--at", help="UTC ISO time (default: now)")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO)
    at = datetime.fromisoformat(args.at.replace("Z", "+00:00")) if args.at else datetime.now(timezone.utc)
    ok = 0
    for sat in args.satellites:
        t = goes_cloud.download_frame(sat, at, Path(args.cache_root))
        print(f"{sat}: {t.isoformat() if t else 'no frame'}")
        ok += t is not None
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
