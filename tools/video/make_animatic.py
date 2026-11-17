"""Build a silent animatic of the submission video: stills from earlier builds, placeholder cards for footage
that is not recorded yet, the diagram stages, and burned-in captions, all timed from the narration timeline.
Purpose: check the pacing and the story before recording. It is not the submission video.

Needs: ffmpeg (winget install Gyan.FFmpeg), Pillow, and the diagram PNGs (tools/video/render_diagram.ps1).
Run from the repository root:
  python tools/video/make_animatic.py            # uses the estimated timeline (dry run, no API call)
  python tools/video/make_animatic.py --voice Charon   # uses the measured timeline after real narration exists
Output: data/video/animatic-<suffix>.mp4 (git-ignored).
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "video"
SCREENS = ROOT / "docs" / "screens"
W, H, FPS = 1920, 1080, 25

# line id -> still. "card:<text>" makes a placeholder card; "diagram:<n>" uses a rendered diagram stage;
# "asset:<file>" uses a picture from data/video/assets (tools/video/make_route_graphics.py).
SHOT = {
    "h1": "21.10-frost-first.png", "h2": "21.10-frost-50.png",
    "p1": "21.10-start.png", "p2": "asset:route-sat.png",
    "g1": "21.10-gate.png", "n1": "21.10-gate.png", "g4": "21.10-gate.png", "n2": "21.10-gate-antiice.png",
    "n3": "asset:route-evidence.png", "g3": "21.10-gate-antiice.png", "n4": "21.10-gate-antiice.png",
    "g5": "21.10-frost-50.png",
    "r1": "21.10-report.png", "n5": "21.10-report.png",
    "d1": "diagram:1", "d2": "diagram:2", "d3": "diagram:3", "d4": "diagram:4", "d5": "diagram:5",
    "k1": "card:T7 Kiro IDE footage|spec files, tasks.md",
    "k2b": "card:T7 Kiro IDE footage|requirements and properties",
    "k3b": "card:T7 Kiro IDE footage|hooks panel, wording test run, steering",
    "c1": "card:T8 close|README Limits list and the game note",
    "c2": "card:End card|Cloud Dive, demo URL, repository URL",
}


def find_ffmpeg() -> str:
    found = shutil.which("ffmpeg")
    if found:
        return found
    base = Path.home() / "AppData/Local/Microsoft/WinGet/Packages"
    hits = sorted(base.glob("Gyan.FFmpeg*/**/bin/ffmpeg.exe")) if base.exists() else []
    if hits:
        return str(hits[0])
    sys.exit("ffmpeg not found. Install it with: winget install --id Gyan.FFmpeg -e")


def font(size: int) -> ImageFont.FreeTypeFont:
    for name in ("segoeui.ttf", "arial.ttf"):
        try:
            return ImageFont.truetype(str(Path("C:/Windows/Fonts") / name), size)
        except OSError:
            continue
    return ImageFont.load_default()


def letterbox(img: Image.Image) -> Image.Image:
    img = img.convert("RGB")
    scale = min(W / img.width, H / img.height)
    img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    canvas = Image.new("RGB", (W, H), (11, 18, 32))
    canvas.paste(img, ((W - img.width) // 2, (H - img.height) // 2))
    return canvas


def card(title: str, sub: str) -> Image.Image:
    img = Image.new("RGB", (W, H), (18, 28, 51))
    d = ImageDraw.Draw(img)
    d.rectangle([60, 60, W - 60, H - 60], outline=(79, 140, 255), width=4)
    d.text((W // 2, H // 2 - 50), title, font=font(84), fill=(255, 255, 255), anchor="mm")
    d.text((W // 2, H // 2 + 60), sub, font=font(46), fill=(169, 184, 214), anchor="mm")
    d.text((W // 2, H // 2 + 150), "placeholder: not recorded yet", font=font(36), fill=(255, 180, 84), anchor="mm")
    return img


def stamp(img: Image.Image, label: str) -> Image.Image:
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 760, 46], fill=(0, 0, 0))
    d.text((14, 6), label, font=font(30), fill=(255, 180, 84))
    return img


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--voice", help="use timeline-<voice>.json and captions-<voice>.srt (measured)")
    args = ap.parse_args()
    suffix = args.voice or "estimated"
    timeline_path = OUT / f"timeline-{suffix}.json"
    srt = OUT / f"captions-{suffix}.srt"
    if not timeline_path.exists() or not srt.exists():
        sys.exit(f"missing {timeline_path.name} or {srt.name}. Run tools/video/make_narration.py "
                 f"{'--dry-run' if suffix == 'estimated' else '--voice ' + suffix} first.")
    timeline = json.loads(timeline_path.read_text(encoding="utf-8"))
    ffmpeg = find_ffmpeg()
    frames = OUT / "animatic-frames"
    frames.mkdir(parents=True, exist_ok=True)
    label = "ANIMATIC: " + ("estimated timing, silent" if suffix == "estimated" else "measured timing") + ", old stills"

    entries = []
    for i, item in enumerate(timeline):
        shot = SHOT.get(item["id"], "card:No shot assigned|" + item["id"])
        if shot.startswith("card:"):
            title, sub = shot[5:].split("|", 1)
            img = card(title, sub)
        elif shot.startswith("asset:"):
            path = OUT / "assets" / shot[6:]
            if not path.exists():
                sys.exit(f"{path.relative_to(ROOT)} is missing. Run tools/video/make_route_graphics.py.")
            img = Image.open(path)
        elif shot.startswith("diagram:"):
            path = OUT / "assets" / f"diagram-{shot.split(':')[1]}.png"
            if not path.exists():
                sys.exit(f"{path.relative_to(ROOT)} is missing. Run tools/video/render_diagram.ps1.")
            img = Image.open(path)
        else:
            img = Image.open(SCREENS / shot)
        frame = frames / f"{i:02d}-{item['id']}.png"
        stamp(letterbox(img), label).save(frame)
        nxt = timeline[i + 1]["start"] if i + 1 < len(timeline) else item["end"] + 1.0
        entries.append((frame, max(0.5, nxt - item["start"])))

    listing = frames / "list.txt"
    with listing.open("w", encoding="utf-8") as f:
        for frame, dur in entries:
            f.write(f"file '{frame.as_posix()}'\nduration {dur:.3f}\n")
        f.write(f"file '{entries[-1][0].as_posix()}'\n")  # concat needs the last file repeated

    total = sum(d for _, d in entries)
    out = OUT / f"animatic-{suffix}.mp4"
    style = "FontName=Segoe UI,FontSize=22,Outline=2,Shadow=0,MarginV=48,PrimaryColour=&H00FFFFFF"
    vf = f"subtitles={srt.relative_to(ROOT).as_posix()}:force_style='{style}',format=yuv420p"
    cmd = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(listing),
           "-vf", vf, "-r", str(FPS), "-t", f"{total:.3f}", "-c:v", "libx264", "-crf", "20", "-preset", "medium", str(out)]
    subprocess.run(cmd, check=True, cwd=ROOT)
    print(f"{out.relative_to(ROOT)}: {len(entries)} shots, {int(total // 60)}:{int(total % 60):02}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
