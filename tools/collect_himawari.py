"""Download the newest Himawari-9 AHI cloud scan into the projected cache (~0.9 GB download).

Usage: python tools/collect_himawari.py [--cache-root PATH] [--at ISO_UTC]
Anonymous NOAA S3 access (needs s3fs, netCDF4). Needs ~3 GB RAM.
"""
import argparse
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.integration import himawari_cloud  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache-root", default=os.getenv("GK2A_CACHE_ROOT")
                    or str(Path(__file__).resolve().parents[1] / "data/overlay/gk2a_l2"))
    ap.add_argument("--at", help="UTC ISO time (default: now)")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO)
    at = datetime.fromisoformat(args.at.replace("Z", "+00:00")) if args.at else datetime.now(timezone.utc)
    t = himawari_cloud.download_frame(at, Path(args.cache_root))
    print(f"H09: {t.isoformat() if t else 'no frame'}")
    return 0 if t else 1


if __name__ == "__main__":
    raise SystemExit(main())
