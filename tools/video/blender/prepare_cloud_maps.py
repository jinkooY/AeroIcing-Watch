"""Cloud height maps for the Blender cloud shots, made from the exported case file (satellite cloud top and base).

For a window along the route (s0 to s1 km) and +-70 km across, this writes three PNG maps and a JSON file:
  top16.png   cloud top height, 16 bit, value = metres / 10000 (the satellite cloud-top height, geopotential, as used by the game)
  base16.png  cloud base height, 16 bit, same scale
  mask8.png   R = cloud present (satellite state `observed` with a finite top), G = base unknown (the base is only a stand-in)
  meta.json   window, size, height range, what the maps mean
Rules kept from the game (design 14.4, science guardrails): only cells whose retrieval state is `observed` carry cloud; the cloud
base is the case file's estimate and an unknown base is never invented: such a cell gets a thin faded cap (G = 1). Across the five
lanes (-30 to +30 km) the values are interpolated; beyond the outer lanes the edge value is repeated and fades out over 40 km.
This is an illustration of the data, not an observation of the sky between the lanes.

Run from the repository root:
  python tools/video/blender/prepare_cloud_maps.py --s0 420 --s1 580 [--case <file>] [--out data/video/blender/maps] [--res 0.25]
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
FT = 0.3048
HALF_WIDTH_KM = 70.0
THIN_CAP_M = 400.0  # drawn thickness of the faded cap when the base is unknown (the game draws 350 ft)
SCALE_M = 10000.0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--case", default=str(ROOT / "static/cloud-dive/cases/20261112-kjfk-kbna-1930z.json"))
    ap.add_argument("--s0", type=float, required=True, help="window start along the route, km")
    ap.add_argument("--s1", type=float, required=True, help="window end along the route, km")
    ap.add_argument("--out", default=str(ROOT / "data/video/blender/maps"))
    ap.add_argument("--res", type=float, default=0.25, help="map pixel size, km")
    args = ap.parse_args()

    case = json.loads(Path(args.case).read_text(encoding="utf-8"))
    sat = case["satellite"]
    lanes_n, steps = sat["shape"]
    step_km = float(case["grid"]["stepKm"])
    lanes_km = np.array(case["grid"]["lanesKm"], dtype=float)
    observed = sat["stateNames"].index("observed")

    def arr(key):
        return np.array([np.nan if v is None else v for v in sat[key]], dtype=float).reshape(lanes_n, steps)

    state = np.array(sat["state"], dtype=int).reshape(lanes_n, steps)
    top = arr("topFt") * FT
    base = arr("baseFt") * FT
    present = (state == observed) & np.isfinite(top)
    base_known = present & np.isfinite(base) & (base <= top)
    base_eff = np.where(base_known, base, top - THIN_CAP_M)

    width = int(round((args.s1 - args.s0) / args.res))
    height = int(round(2 * HALF_WIDTH_KM / args.res))
    s = args.s0 + (np.arange(width) + 0.5) * args.res               # along track, km
    y = -HALF_WIDTH_KM + (np.arange(height) + 0.5) * args.res         # across, km (positive left)
    centre = (np.arange(steps) + 0.5) * step_km                       # km at the centre of each step cell

    # interpolate along the track per lane, with weights so that cells without cloud do not pull the values toward zero
    def along(field, weight):
        num = np.stack([np.interp(s, centre, np.where(weight[l], field[l], 0.0)) for l in range(lanes_n)])
        den = np.stack([np.interp(s, centre, weight[l].astype(float)) for l in range(lanes_n)])
        return num, den

    t_num, t_den = along(top, present)
    b_num, _ = along(base_eff, present)
    m_num, m_den = along(present.astype(float), np.ones_like(present, dtype=bool))
    u_num, _ = along((present & ~base_known).astype(float), np.ones_like(present, dtype=bool))

    def across(num_by_lane):
        # linear between the lanes, edge value repeated outside
        return np.stack([np.interp(y, lanes_km, num_by_lane[:, i]) for i in range(width)], axis=1)

    top_m = across(t_num / np.maximum(t_den, 1e-6))
    base_m = across(b_num / np.maximum(t_den, 1e-6))
    mask = across(m_num)
    unknown = across(u_num)
    fade = np.clip(1.0 - (np.abs(y) - lanes_km.max()) / 40.0, 0.0, 1.0)[:, None]
    mask = np.clip(mask * fade, 0.0, 1.0)
    # where no lane has any cloud near this point the heights are meaningless; keep them finite
    top_m = np.where(np.isfinite(top_m) & (top_m > 0), top_m, np.nanmean(top[present]))
    base_m = np.where(np.isfinite(base_m) & (base_m > 0), base_m, top_m - THIN_CAP_M)
    base_m = np.minimum(base_m, top_m - 50.0)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    def to16(a):  # 16 bit grey, value = metres / SCALE_M
        return Image.fromarray((np.clip(np.flipud(a) / SCALE_M, 0, 1) * 65535).astype(np.uint16))
    # image row 0 is the top of the picture = largest y (left of the track)
    to16(top_m).save(out / "top16.png")
    to16(base_m).save(out / "base16.png")
    rgb = np.zeros((height, width, 3), dtype=np.uint8)
    rgb[..., 0] = np.round(255 * mask)
    rgb[..., 1] = np.round(255 * np.clip(unknown, 0, 1))
    Image.fromarray(np.flipud(rgb)).save(out / "mask8.png")
    meta = {
        "case": case["id"], "s0Km": args.s0, "s1Km": args.s1, "halfWidthKm": HALF_WIDTH_KM, "pixelKm": args.res,
        "width": width, "height": height, "scaleM": SCALE_M,
        "topMinM": float(np.nanmin(top_m[mask > 0.5])) if (mask > 0.5).any() else None,
        "topMaxM": float(np.nanmax(top_m[mask > 0.5])) if (mask > 0.5).any() else None,
        "baseMinM": float(np.nanmin(base_m[mask > 0.5])) if (mask > 0.5).any() else None,
        "coverFraction": float((mask > 0.5).mean()),
        "note": "Illustration from satellite cloud top and the case's base estimate on five lanes; detail between the lanes is procedural.",
        "imageRow0": "largest y (left of the track)",
    }
    (out / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"maps {width}x{height} in {out.relative_to(ROOT) if out.is_relative_to(ROOT) else out}: "
          f"top {meta['topMinM']:.0f}-{meta['topMaxM']:.0f} m, base min {meta['baseMinM']:.0f} m, cover {100 * meta['coverFraction']:.0f} percent")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
