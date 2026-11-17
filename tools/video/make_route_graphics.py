"""Route, satellite and evidence graphics for the submission video, drawn from the exported case file.

Draws on the case's own satellite images (IR and cloud-top phase), the Natural Earth state and coast lines, the five
lanes, and the evidence cube. Nothing is invented: every colour on the route comes from `evidence` at one altitude, and
the gate numbers come from `node tools/video/gate_plan.mjs --json`. No logos; attribution is plain text.

Outputs (git-ignored, data/video/assets/):
  route-sat.png       IR image, state lines, five lanes, centre route, airports
  route-phase.png     cloud-top phase image with a colour key, same route
  route-evidence.png  IR image, the centre lane coloured by evidence level at the chosen altitude, numbered gates
  route-anim/NNNN.png and route-anim.mp4   the route is flown left to right, gates appear as they are reached

Run from the repository root:  python tools/video/make_route_graphics.py [--case <file>] [--alt 12000] [--no-video]
"""
from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFont

ROOT = Path(__file__).resolve().parents[2]
CASES = ROOT / "static" / "cloud-dive" / "cases"
OUT = ROOT / "data" / "video" / "assets"
W, H, FPS = 1920, 1080, 25

KM_PER_DEG_LON_EQ, KM_PER_DEG_LAT = 111.32, 110.57  # must match static/cloud-dive/map.js

LEVEL_COLOUR = {3: (255, 150, 30), 2: (90, 160, 255), 1: (205, 212, 224), 0: (125, 125, 125)}
LEVEL_NAME = {3: "Observed supercooled layer at planned altitude", 2: "Possible (forecast only)",
              1: "Not indicated", 0: "Not assessed"}
LEVEL_WIDTH = {3: 14, 2: 12, 1: 9, 0: 9}
PHASE_KEY = [("Supercooled liquid", (200, 0, 0)), ("Liquid", (255, 170, 30)), ("Mixed", (200, 60, 200)),
             ("Ice", (200, 225, 255)), ("Clear (satellite state)", (255, 255, 255))]


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    for name in (("segoeuib.ttf", "arialbd.ttf") if bold else ("segoeui.ttf", "arial.ttf")):
        try:
            return ImageFont.truetype(str(Path("C:/Windows/Fonts") / name), size)
        except OSError:
            continue
    return ImageFont.load_default()


class Geo:
    """Case map projection (equirect-local-v1) to output pixels. The image is scaled to the frame width."""

    def __init__(self, case: dict):
        m = case["map"]
        self.m = m
        self.scale = W / m["width"]
        self.y0 = (H - m["height"] * self.scale) / 2
        self.cos = math.cos(math.radians(m["lat0"]))

    def px(self, lat: float, lon: float) -> tuple[float, float]:
        m = self.m
        x = (lon - m["lon0"]) * self.cos * KM_PER_DEG_LON_EQ
        y = (lat - m["lat0"]) * KM_PER_DEG_LAT
        return ((x - m["xMinKm"]) / m["pxKm"] * self.scale, self.y0 + (m["yMaxKm"] - y) / m["pxKm"] * self.scale)

    def km_to_px(self, km: float) -> float:
        return km / self.m["pxKm"] * self.scale


def load_case(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def lane_points(case: dict, lane: int) -> list[tuple[float, float]]:
    n = case["grid"]["lanesKm"]
    steps = case["evidence"]["shape"][1]
    data = case["lanesLatLon"]["data"]
    return [(data[lane * steps + s][0], data[lane * steps + s][1]) for s in range(steps)]


def background(case: dict, geo: Geo, kind: str) -> Image.Image:
    name = case["map"]["images"][kind]
    img = Image.open(CASES / name).convert("RGB")
    img = img.resize((W, round(img.height * geo.scale)), Image.LANCZOS)
    if kind == "ir":
        img = ImageEnhance.Contrast(img).enhance(1.35)
        img = ImageEnhance.Brightness(img).enhance(0.85)
    else:
        img = ImageEnhance.Brightness(img).enhance(0.8)
    canvas = Image.new("RGB", (W, H), (11, 18, 32))
    canvas.paste(img, (0, round(geo.y0)))
    return canvas


def polylines(canvas: Image.Image, geo: Geo, lines, colour, width: int) -> None:
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for line in lines:
        pts = [geo.px(lat, lon) for lat, lon in line]
        if any(-200 < x < W + 200 and -200 < y < H + 200 for x, y in pts):
            d.line(pts, fill=colour, width=width, joint="curve")
    canvas.alpha_composite(layer) if canvas.mode == "RGBA" else canvas.paste(layer, (0, 0), layer)


def base_layer(case: dict, geo: Geo, kind: str, basemap: dict) -> Image.Image:
    canvas = background(case, geo, kind)
    polylines(canvas, geo, basemap["states"], (255, 255, 255, 110), 2)
    polylines(canvas, geo, basemap["coast"], (255, 255, 255, 170), 3)
    return canvas


def draw_lanes(canvas: Image.Image, geo: Geo, case: dict, centre_colour=(255, 255, 255, 255), centre_width=8) -> None:
    for lane in range(5):
        pts = lane_points(case, lane)
        if lane == 2:
            continue
        polylines(canvas, geo, [pts], (255, 255, 255, 120), 2)
    if centre_colour[3] > 0:  # a transparent centre line means the evidence colours are drawn on top later
        polylines(canvas, geo, [lane_points(case, 2)], (0, 0, 0, 150), centre_width + 6)
        polylines(canvas, geo, [lane_points(case, 2)], centre_colour, centre_width)


def label(d: ImageDraw.ImageDraw, xy, text: str, size=34, fill=(255, 255, 255), bold=True, anchor="la", pad=10) -> None:
    f = font(size, bold)
    box = d.textbbox(xy, text, font=f, anchor=anchor)
    d.rounded_rectangle([box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad], radius=10, fill=(8, 14, 28, 220))
    d.text(xy, text, font=f, fill=fill, anchor=anchor)


def airports(canvas: Image.Image, geo: Geo, case: dict) -> None:
    d = ImageDraw.Draw(canvas, "RGBA")
    pts = lane_points(case, 2)
    for (lat, lon), code, name, side in ((pts[0], case["route"]["from"], "New York", "l"),
                                         (pts[-1], case["route"]["to"], "Nashville", "r")):
        x, y = geo.px(lat, lon)
        d.ellipse([x - 13, y - 13, x + 13, y + 13], fill=(255, 255, 255), outline=(0, 0, 0), width=4)
        if side == "r":  # Nashville, lower left: the label sits above-left of the marker, clear of the gates
            label(d, (20, y - 190), f"{code}  {name}", 36, anchor="la")
        else:  # New York, upper right
            label(d, (x - 44, y - 62), f"{code}  {name}", 36, anchor="ra")


def scale_bar(canvas: Image.Image, geo: Geo) -> None:
    d = ImageDraw.Draw(canvas, "RGBA")
    x0, y0, length = 90, H - 108, geo.km_to_px(200)
    d.rectangle([x0 - 14, y0 - 46, x0 + length + 14, y0 + 30], fill=(8, 14, 28, 220))
    d.line([x0, y0, x0 + length, y0], fill=(255, 255, 255), width=6)
    d.line([x0, y0 - 12, x0, y0 + 12], fill=(255, 255, 255), width=4)
    d.line([x0 + length, y0 - 12, x0 + length, y0 + 12], fill=(255, 255, 255), width=4)
    d.text((x0 + length / 2, y0 - 30), "200 km", font=font(28), fill=(255, 255, 255), anchor="mm")


def footer(canvas: Image.Image, case: dict, kind: str) -> None:
    d = ImageDraw.Draw(canvas, "RGBA")
    sat = case["sources"]["satellite"]
    scan = case["map"]["scanUtc"][:16].replace("T", " ") + " UTC"
    what = "infrared" if kind == "ir" else "cloud-top phase"
    text = (f"{sat['satellite']} {what}, scan {scan}  |  ECMWF Open Data (CC BY 4.0)  |  Made with Natural Earth  |  "
            "Lanes and corridor are illustrative, not airways.")
    f = font(24)
    box = d.textbbox((W // 2, H - 14), text, font=f, anchor="mb")
    d.rectangle([0, box[1] - 10, W, H], fill=(8, 14, 28, 230))
    d.text((W // 2, H - 14), text, font=f, fill=(210, 220, 238), anchor="mb")


def title(canvas: Image.Image, case: dict, sub: str) -> None:
    d = ImageDraw.Draw(canvas, "RGBA")
    label(d, (40, 36), case["title"].replace("JFK to Nashville", "JFK to Nashville"), 46, anchor="la", pad=14)
    label(d, (40, 112), sub, 30, bold=False, anchor="la", pad=12)


def legend(canvas: Image.Image, rows, heading: str, alt_note: str | None = None) -> None:
    d = ImageDraw.Draw(canvas, "RGBA")
    f, fb = font(30), font(32, True)
    width = max(max(d.textlength(t, font=f) for t, _ in rows) + 110, d.textlength(heading, font=fb) + 48)
    height = 66 + 50 * len(rows) + (44 if alt_note else 0)
    x, y = W - 40, H - 70 - height  # bottom right: the route runs from the upper right to the lower left, so the corner is free
    d.rounded_rectangle([x - width, y, x, y + height], radius=14, fill=(8, 14, 28, 225))
    d.text((x - width + 24, y + 14), heading, font=fb, fill=(255, 255, 255))
    yy = y + 66
    for text, colour in rows:
        d.rounded_rectangle([x - width + 24, yy + 4, x - width + 74, yy + 30], radius=5, fill=colour + (255,), outline=(0, 0, 0))
        d.text((x - width + 90, yy), text, font=f, fill=(235, 240, 250))
        yy += 50
    if alt_note:
        d.text((x - width + 24, yy + 2), alt_note, font=font(26), fill=(169, 184, 214))


def evidence_levels(case: dict, alt_ft: int) -> list[int]:
    alts = [int(a) for a in case["grid"]["altitudesFt"]]
    a = alts.index(alt_ft)
    lanes, steps, n_alt = case["evidence"]["shape"]
    data = case["evidence"]["data"]
    return [data[(2 * steps + s) * n_alt + a] for s in range(steps)]


def draw_evidence_route(canvas: Image.Image, geo: Geo, case: dict, levels: list[int], upto: int | None = None) -> None:
    pts = [geo.px(*p) for p in lane_points(case, 2)]
    steps = len(pts) if upto is None else min(upto + 1, len(pts))
    d = ImageDraw.Draw(canvas, "RGBA")
    for s in range(steps - 1):
        d.line([pts[s], pts[s + 1]], fill=(0, 0, 0, 170), width=LEVEL_WIDTH[levels[s]] + 6)
    for s in range(steps - 1):
        d.line([pts[s], pts[s + 1]], fill=LEVEL_COLOUR[levels[s]] + (255,), width=LEVEL_WIDTH[levels[s]])


def draw_gates(canvas: Image.Image, geo: Geo, case: dict, gates: list[dict], upto_km: float | None = None) -> None:
    d = ImageDraw.Draw(canvas, "RGBA")
    pts = [geo.px(*p) for p in lane_points(case, 2)]
    step_km = case["grid"]["stepKm"]
    f = font(26, True)
    for g in gates:
        if upto_km is not None and g["km"] > upto_km:
            continue
        s = min(int(round(g["km"] / step_km)), len(pts) - 1)
        x, y = pts[s]
        # alternate above and below the route so that neighbouring gates do not overlap
        dy = 46 if (g["n"] == 1 or g["n"] % 2 == 0) else -46
        special = g["n"] == 5
        r = 21 if special else 17
        d.line([(x, y), (x, y + dy * 0.55)], fill=(255, 255, 255, 220), width=3)
        d.ellipse([x - r, y + dy - r, x + r, y + dy + r], fill=(255, 255, 255) if not special else (255, 150, 30),
                  outline=(0, 0, 0), width=3)
        d.text((x, y + dy), str(g["n"]), font=f, fill=(0, 0, 0), anchor="mm")
        if special:
            label(d, (x - 38, y + dy), "Gate 5: first Observed gate, 500 km", 28, anchor="rm", pad=8)


def aircraft(canvas: Image.Image, geo: Geo, case: dict, s: float) -> None:
    pts = [geo.px(*p) for p in lane_points(case, 2)]
    i = min(int(s), len(pts) - 2)
    t = s - i
    x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t
    y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t
    ang = math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0])
    shape = [(34, 0), (-20, 17), (-8, 0), (-20, -17)]
    poly = [(x + px * math.cos(ang) - py * math.sin(ang), y + px * math.sin(ang) + py * math.cos(ang)) for px, py in shape]
    d = ImageDraw.Draw(canvas, "RGBA")
    d.polygon(poly, fill=(255, 255, 255), outline=(0, 0, 0))


def gates_from_node() -> list[dict]:
    out = subprocess.run(["node", str(ROOT / "tools" / "video" / "gate_plan.mjs"), "--json"], cwd=ROOT,
                         capture_output=True, text=True, check=True).stdout
    return json.loads(out.strip().splitlines()[-1])["gates"]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--case", default=str(CASES / "20261112-kjfk-kbna-1930z.json"))
    ap.add_argument("--alt", type=int, default=12000, help="altitude (ft) whose evidence colours the route")
    ap.add_argument("--no-video", action="store_true")
    args = ap.parse_args()

    case = load_case(Path(args.case))
    basemap = json.loads((CASES / "basemap.json").read_text(encoding="utf-8"))
    geo = Geo(case)
    levels = evidence_levels(case, args.alt)
    gates = gates_from_node()
    OUT.mkdir(parents=True, exist_ok=True)
    km = round(case["distanceKm"])
    sub = f"{km:,} km  |  five lanes, 15 km apart  |  real satellite and forecast"

    # 1. satellite and route
    img = base_layer(case, geo, "ir", basemap).convert("RGBA")
    draw_lanes(img, geo, case)
    airports(img, geo, case); scale_bar(img, geo); title(img, case, sub); footer(img, case, "ir")
    img.convert("RGB").save(OUT / "route-sat.png")

    # 2. phase image
    img = base_layer(case, geo, "phase", basemap).convert("RGBA")
    draw_lanes(img, geo, case)
    airports(img, geo, case); scale_bar(img, geo); title(img, case, sub); footer(img, case, "phase")
    legend(img, PHASE_KEY, "Cloud-top phase (satellite)", "The satellite sees cloud tops only.")
    img.convert("RGB").save(OUT / "route-phase.png")

    # 3. evidence along the centre lane, with gates
    key_rows = [(LEVEL_NAME[k], LEVEL_COLOUR[k]) for k in (3, 2, 1)]
    img = base_layer(case, geo, "ir", basemap).convert("RGBA")
    draw_lanes(img, geo, case, centre_colour=(255, 255, 255, 0), centre_width=2)
    draw_evidence_route(img, geo, case, levels)
    draw_gates(img, geo, case, gates)
    airports(img, geo, case); scale_bar(img, geo); title(img, case, f"Evidence along the centre lane at {args.alt:,} ft")
    footer(img, case, "ir"); legend(img, key_rows, "Evidence level", f"at {args.alt:,} ft, centre lane")
    img.convert("RGB").save(OUT / "route-evidence.png")
    print("wrote route-sat.png, route-phase.png, route-evidence.png in", OUT.relative_to(ROOT))

    if args.no_video:
        return 0

    # 4. animation: the route is flown, gates appear when passed
    frames = OUT / "route-anim"
    frames.mkdir(parents=True, exist_ok=True)
    for old in frames.glob("*.png"):
        old.unlink()
    base = base_layer(case, geo, "ir", basemap).convert("RGBA")
    draw_lanes(base, geo, case, centre_colour=(255, 255, 255, 0), centre_width=2)
    airports(base, geo, case); scale_bar(base, geo); title(base, case, f"Evidence along the centre lane at {args.alt:,} ft")
    footer(base, case, "ir"); legend(base, key_rows, "Evidence level", f"at {args.alt:,} ft, centre lane")
    n_steps = len(levels) - 1
    fly, hold = 6 * FPS, 2 * FPS
    for i in range(fly + hold):
        s = n_steps * min(i / fly, 1.0)
        # ease in and out
        s = n_steps * (0.5 - 0.5 * math.cos(math.pi * min(i / fly, 1.0)))
        frame = base.copy()
        draw_evidence_route(frame, geo, case, levels, upto=int(s))
        draw_gates(frame, geo, case, gates, upto_km=s * case["grid"]["stepKm"])
        aircraft(frame, geo, case, min(s, n_steps - 1e-6))
        d = ImageDraw.Draw(frame, "RGBA")
        label(d, (W - 40, 36), f"{int(s * case['grid']['stepKm']):,} / {km:,} km", 40, anchor="ra", pad=14)
        frame.convert("RGB").save(frames / f"{i:04d}.png")
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        hits = sorted((Path.home() / "AppData/Local/Microsoft/WinGet/Packages").glob("Gyan.FFmpeg*/**/bin/ffmpeg.exe"))
        ffmpeg = str(hits[0]) if hits else None
    if not ffmpeg:
        print("ffmpeg not found; frames only")
        return 0
    out = OUT / "route-anim.mp4"
    subprocess.run([ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-framerate", str(FPS), "-i",
                    str(frames / "%04d.png"), "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", str(out)],
                   check=True, cwd=ROOT)
    print("wrote", out.relative_to(ROOT), f"({(fly + hold) / FPS:.0f} s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
