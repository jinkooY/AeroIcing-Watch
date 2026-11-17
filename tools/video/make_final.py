"""Final edit of the submission video (task 23.3): cuts the recorded takes, the Blender cloud shots and the stills to
the narration timeline, following docs/video/edl.json, then burns in the captions and mixes the narration.

Timing: each voice line owns a slot from its start to the next line's start (timeline-<voice>.json written by
tools/video/make_narration.py). The shots listed for that line in the EDL fill the slot in order; a shot with "dur"
takes that many seconds, the last shot without "dur" takes the rest. A shot whose source span differs from its slot
time is played faster or slower (speed ramp), never frozen.

Shot kinds (all times in seconds):
  {"take": "T2", "from": "gate 5-0.3", "to": "2D view on", "zoom": "#gate-panel", "text": [...], "box": [...]}
      a recorded take; "from"/"to" are numbers or marker names from data/video/takes/<take>.markers.json with an
      optional +/- offset ("gate 5+1.5"). Without "to" the shot plays at speed 1 (or "speed").
  {"clip": "data/video/blender/anim/pv2_A_approach.mp4", "from": 0}   any video file
  {"still": "data/video/assets/diagram-1.png"}                          a picture, letterboxed
  {"card": "Title|Subtitle", "placeholder": true}                       a plain title card
  "zoom": a CSS selector whose rectangle the take recorded at the "from" marker, or [x, y, w, h]; cropped to 16:9
  "text": [{"text": "Observed", "at": 0.5, "dur": 3, "pos": "top-left", "color": "orange"}] own on-screen text
  "box": [{"rect": "#gate-choices", "at": 0, "dur": 2.5}] a highlight frame (rectangles in take pixels, before zoom)
  "push": 0.05  slow push-in over the shot (the EDL "push" is the default for takes at about real speed; 0 turns it off)
  "dim": 0.5    darkens the picture (for a large number laid over it)

Output: data/video/final-<voice>.mp4 and final-<voice>.srt (the separate caption file for YouTube). Captions sit above
the game note and the source line at the bottom of the screen (R23.7). Without a narration WAV the video is silent and
labelled a rough cut. A freeze check runs on the result and lists every still stretch longer than 2 s.
Run from the repository root:
  python tools/video/make_final.py                 # estimated timeline, silent rough cut
  python tools/video/make_final.py --voice Charon  # measured timeline and the real narration
  python tools/video/make_final.py --plan          # print the shot plan only (no ffmpeg)
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "video"
TAKES = OUT / "takes"
EDL = ROOT / "docs" / "video" / "edl.json"
W, H = 1920, 1080
FONT = "C\\:/Windows/Fonts/segoeui.ttf"
FONT_BOLD = "C\\:/Windows/Fonts/segoeuib.ttf"
COLORS = {"white": "white", "orange": "0xFFB454", "blue": "0x4F8CFF", "grey": "0xA9B8D6"}
TAIL_S = 1.5  # picture after the last voice line
REF = re.compile(r"^\s*(?P<name>.*?)\s*(?:(?P<sign>[+-])\s*(?P<off>\d+(?:\.\d+)?))?\s*$")


# ---- pure planning (tested in tests/test_make_final.py without ffmpeg) -------------------------------------------

def resolve_time(ref, markers: list[dict]) -> float:
    """A number, or a marker name with an optional offset, to seconds in the take. The first marker of that name wins."""
    if isinstance(ref, (int, float)):
        return float(ref)
    text = str(ref)
    try:
        return float(text)
    except ValueError:
        pass
    m = REF.match(text)
    name = m.group("name")
    hit = next((mk for mk in markers if mk["event"] == name), None)
    if hit is None:
        raise KeyError(f"marker {name!r} not found")
    off = float(m.group("off") or 0.0)
    return hit["t"] + (off if m.group("sign") != "-" else -off)


def marker_rect(selector: str, markers: list[dict], at: float) -> list[int] | None:
    """The rectangle of a selector recorded at the latest marker at or before `at` (or the first one that has it)."""
    best = None
    for mk in markers:
        rects = mk.get("rects", mk)
        r = rects.get(selector) if isinstance(rects, dict) else None
        if r and isinstance(r, dict) and "w" in r:
            if mk["t"] <= at + 1e-6 or best is None:
                best = [r["x"], r["y"], r["w"], r["h"]]
    return best


def zoom_rect(z, markers: list[dict], at: float) -> list[float] | None:
    """The rectangle to zoom on: [x, y, w, h] as given, one selector, or a list of selectors (their union)."""
    if isinstance(z, list) and z and all(isinstance(v, (int, float)) for v in z):
        return [float(v) for v in z]
    rects = [marker_rect(s, markers, at) for s in ([z] if isinstance(z, str) else z)]
    rects = [r for r in rects if r]
    if not rects:
        return None
    x0, y0 = min(r[0] for r in rects), min(r[1] for r in rects)
    x1, y1 = max(r[0] + r[2] for r in rects), max(r[1] + r[3] for r in rects)
    return [x0, y0, x1 - x0, y1 - y0]


def zoom_crop(rect: list[float], pad: float = 40.0, min_w: float = 480.0) -> tuple[int, int, int, int]:
    """A 16:9 crop around `rect` (x, y, w, h) with padding, kept inside the 1920x1080 frame. Returns x, y, w, h (even)."""
    x, y, w, h = rect
    cw = max(w + 2 * pad, (h + 2 * pad) * W / H, min_w)
    cw = min(cw, W)
    ch = cw * H / W
    cx, cy = x + w / 2, y + h / 2
    left = min(max(cx - cw / 2, 0), W - cw)
    top = min(max(cy - ch / 2, 0), H - ch)
    ev = lambda v: int(round(v / 2) * 2)
    return ev(left), ev(top), ev(cw), ev(ch)


def slots(timeline: list[dict], tail: float = TAIL_S) -> dict[str, tuple[float, float]]:
    """Line id -> (start, length) of its picture slot: to the next line's start, the last one to its end plus `tail`."""
    out = {}
    for i, item in enumerate(timeline):
        end = timeline[i + 1]["start"] if i + 1 < len(timeline) else item["end"] + tail
        out[item["id"]] = (item["start"], round(end - item["start"], 3))
    return out


@dataclass
class Piece:
    line: str
    kind: str
    source: str
    start: float          # in the source (seconds)
    span: float           # source seconds used
    dur: float            # seconds in the video
    shot: dict = field(default_factory=dict)

    @property
    def speed(self) -> float:
        return self.span / self.dur if self.dur else 1.0


def plan_line(line: str, slot_len: float, shots: list[dict], markers_of) -> list[Piece]:
    """Split one slot over its shots. `markers_of(take)` returns that take's markers."""
    fixed = sum(float(s["dur"]) for s in shots if "dur" in s)
    free = [s for s in shots if "dur" not in s]
    if fixed > slot_len + 1e-6:
        raise ValueError(f"{line}: shots need {fixed:.2f} s but the slot is {slot_len:.2f} s")
    if len(free) > 1:
        raise ValueError(f"{line}: only one shot per line may leave out 'dur'")
    rest = slot_len - fixed
    pieces = []
    for s in shots:
        dur = float(s["dur"]) if "dur" in s else rest
        if dur <= 0:
            continue
        if "take" in s:
            mk = markers_of(s["take"])
            a = resolve_time(s.get("from", 0), mk)
            span = resolve_time(s["to"], mk) - a if "to" in s else dur * float(s.get("speed", 1.0))
            if span <= 0:
                raise ValueError(f"{line}: shot ends before it starts ({s})")
            pieces.append(Piece(line, "take", s["take"], a, span, dur, s))
        elif "clip" in s:
            a = float(s.get("from", 0))
            span = float(s["to"]) - a if "to" in s else dur * float(s.get("speed", 1.0))
            pieces.append(Piece(line, "clip", s["clip"], a, span, dur, s))
        elif "still" in s:
            pieces.append(Piece(line, "still", s["still"], 0.0, dur, dur, s))
        elif "card" in s:
            pieces.append(Piece(line, "card", s["card"], 0.0, dur, dur, s))
        else:
            raise ValueError(f"{line}: unknown shot {s}")
    return pieces


def push_amount(p: "Piece", default: float) -> float:
    """Push-in zoom for a piece: the shot's "push", else the EDL default for takes played at about real speed."""
    if "push" in p.shot:
        return float(p.shot["push"])
    return default if p.kind == "take" and p.speed <= 1.3 else 0.0


def esc_text(text: str) -> str:
    """Escape text for an ffmpeg drawtext value inside single quotes."""
    return text.replace("\\", "\\\\").replace("'", "\u2019").replace(":", "\\:").replace("%", "\\%").replace(",", "\\,")


def text_filter(item: dict, offset: float = 0.0) -> str:
    """drawtext for one on-screen text item (time relative to the piece)."""
    pos = item.get("pos", "top-left")
    size = int(item.get("size", 44))
    x = {"top-left": "64", "lower-left": "64", "top-right": "w-tw-64", "lower-right": "w-tw-64", "center": "(w-tw)/2",
         "top-center": "(w-tw)/2", "below-center": "(w-tw)/2"}[pos]
    y = {"top-left": "64", "top-right": "64", "top-center": "64", "lower-left": "h-th-200", "lower-right": "h-th-200",
         "center": "(h-th)/2", "below-center": "(h-th)/2+120"}[pos]
    a = float(item.get("at", 0)) + offset
    b = a + float(item.get("dur", 3))
    color = COLORS.get(item.get("color", "white"), "white")
    font = FONT_BOLD if item.get("bold", True) else FONT
    return (f"drawtext=fontfile='{font}':text='{esc_text(item['text'])}':fontsize={size}:fontcolor={color}:x={x}:y={y}:"
            f"box=1:boxcolor=0x0B1220@0.72:boxborderw=18:enable='between(t,{a:.2f},{b:.2f})'")


def srt_from_timeline(timeline: list[dict], cues_for) -> str:
    out, n = [], 1
    for item in timeline:
        for a, b, text in cues_for(item["text"], item["start"], item["end"]):
            out.append(f"{n}\n{_stamp(a)} --> {_stamp(b)}\n{text}\n")
            n += 1
    return "\n".join(out)


def _stamp(sec: float) -> str:
    ms = int(round(sec * 1000))
    return f"{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}"


def freezes(log: str, allowed: float = 2.0) -> list[tuple[float, float]]:
    """(start, duration) of every freeze in an ffmpeg freezedetect log longer than `allowed` seconds."""
    starts = [float(v) for v in re.findall(r"freeze_start: ([\d.]+)", log)]
    durs = [float(v) for v in re.findall(r"freeze_duration: ([\d.]+)", log)]
    return [(s, d) for s, d in zip(starts, durs) if d > allowed]


# ---- rendering --------------------------------------------------------------------------------------------------

def find_tool(name: str) -> str:
    found = shutil.which(name)
    if found:
        return found
    base = Path.home() / "AppData/Local/Microsoft/WinGet/Packages"
    hits = sorted(base.glob(f"Gyan.FFmpeg*/**/bin/{name}.exe")) if base.exists() else []
    if hits:
        return str(hits[0])
    sys.exit(f"{name} not found. Install it with: winget install --id Gyan.FFmpeg -e")


def card_png(text: str, placeholder: bool, path: Path) -> Path:
    from PIL import Image, ImageDraw, ImageFont

    def font(size, bold=False):
        try:
            return ImageFont.truetype("C:/Windows/Fonts/" + ("segoeuib.ttf" if bold else "segoeui.ttf"), size)
        except OSError:
            return ImageFont.load_default()
    title, _, sub = text.partition("|")
    img = Image.new("RGB", (W, H), (11, 18, 32))
    d = ImageDraw.Draw(img)
    d.text((W // 2, H // 2 - 40), title, font=font(96, True), fill=(255, 255, 255), anchor="mm")
    if sub:
        d.text((W // 2, H // 2 + 70), sub, font=font(44), fill=(169, 184, 214), anchor="mm")
    if placeholder:
        d.text((W // 2, H - 140), "placeholder: recorded by the owner after the feature freeze", font=font(34), fill=(255, 180, 84), anchor="mm")
    img.save(path)
    return path


def render_piece(ffmpeg: str, p: Piece, idx: int, fps: int, markers_of, work: Path, default_push: float = 0.0) -> Path:
    out = work / f"{idx:03d}-{p.line}.mp4"
    vf: list[str] = []
    inp: list[str]
    if p.kind == "take":
        inp = ["-ss", f"{p.start:.3f}", "-t", f"{p.span:.3f}", "-i", str(TAKES / f"{p.source}.mp4")]
    elif p.kind == "clip":
        inp = ["-ss", f"{p.start:.3f}", "-t", f"{p.span:.3f}", "-i", str(ROOT / p.source)]
    elif p.kind == "still":
        inp = ["-loop", "1", "-t", f"{p.dur:.3f}", "-i", str(ROOT / p.source)]
    else:
        png = card_png(p.source, bool(p.shot.get("placeholder")), work / f"{idx:03d}-card.png")
        inp = ["-loop", "1", "-t", f"{p.dur:.3f}", "-i", str(png)]
    # highlight boxes and the zoom use take pixels, so they come before the scale
    if p.kind == "take":
        mk = markers_of(p.source)
        for b in p.shot.get("box", []):
            r = b["rect"] if isinstance(b["rect"], list) else marker_rect(b["rect"], mk, p.start)
            if r:
                a = float(b.get("at", 0)) * p.speed
                e = a + float(b.get("dur", 2.5)) * p.speed
                vf.append(f"drawbox=x={r[0] - 6}:y={r[1] - 6}:w={r[2] + 12}:h={r[3] + 12}:color=0xFFB454@0.95:t=6:enable='between(t,{a:.2f},{e:.2f})'")
        z = p.shot.get("zoom")
        if z:
            r = zoom_rect(z, mk, p.start)
            if r is None:
                raise KeyError(f"{p.line}: no rectangle recorded for {z}")
            x, y, w, h = zoom_crop(r, float(p.shot.get("pad", 40)))
            vf.append(f"crop={w}:{h}:{x}:{y}")
    if p.shot.get("dim"):  # takes and clips: darkens the picture under a large text
        vf.append(f"colorlevels=romax={1 - p.shot['dim']}:gomax={1 - p.shot['dim']}:bomax={1 - p.shot['dim']}")
    vf.append(f"scale={W}:{H}:force_original_aspect_ratio=decrease:flags=lanczos,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=0x0B1220")
    if abs(p.speed - 1.0) > 1e-3 and p.kind in ("take", "clip"):
        vf.append(f"setpts=PTS/{p.speed:.5f}")
    vf.append(f"fps={fps}")
    push = push_amount(p, default_push)
    if push > 0:
        # slow push-in toward the centre, so a held gate (the game is paused there) is not a frozen frame
        n = max(1, round(p.dur * fps))
        vf.append(f"zoompan=z='1+{push:.4f}*on/{n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s={W}x{H}:fps={fps}")
    for item in p.shot.get("text", []):
        vf.append(text_filter(item))
    if p.shot.get("caption"):
        vf.append(text_filter({"text": p.shot["caption"], "pos": "top-left", "size": 30, "bold": False, "color": "grey",
                               "at": 0, "dur": p.dur}))
    vf.append("format=yuv420p")
    cmd = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error", *inp, "-vf", ",".join(vf), "-t", f"{p.dur:.3f}", "-an",
           "-c:v", "libx264", "-crf", "18", "-preset", "fast", "-r", str(fps), str(out)]
    subprocess.run(cmd, check=True, cwd=ROOT)
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--voice", help="use timeline-<voice>.json and narration-<voice>.wav (measured)")
    ap.add_argument("--plan", action="store_true", help="print the shot plan and stop")
    ap.add_argument("--only", help="comma-separated line ids to render (a check; the result is not a full video)")
    args = ap.parse_args(argv)
    suffix = args.voice or "estimated"
    timeline_path = OUT / f"timeline-{suffix}.json"
    if not timeline_path.exists():
        sys.exit(f"missing {timeline_path.name}; run tools/video/make_narration.py "
                 f"{'--dry-run' if suffix == 'estimated' else '--voice ' + suffix} first")
    timeline = json.loads(timeline_path.read_text(encoding="utf-8"))
    edl = json.loads(EDL.read_text(encoding="utf-8"))
    fps = int(edl.get("fps", 60))
    cache: dict[str, list[dict]] = {}

    def markers_of(take: str) -> list[dict]:
        if take not in cache:
            f = TAKES / f"{take}.markers.json"
            if not f.exists():
                sys.exit(f"{f.relative_to(ROOT)} is missing; run node tools/video/record_takes.mjs")
            cache[take] = json.loads(f.read_text(encoding="utf-8"))["markers"]
        return cache[take]

    sl = slots(timeline, float(edl.get("tail", TAIL_S)))
    pieces: list[Piece] = []
    for item in timeline:
        shots = edl["lines"].get(item["id"])
        if not shots:
            sys.exit(f"docs/video/edl.json has no shots for line {item['id']}")
        pieces += plan_line(item["id"], sl[item["id"]][1], shots, markers_of)
    for p in pieces:
        print(f"{p.line:4} {p.kind:5} {Path(p.source).name[:28]:28} from {p.start:7.2f} span {p.span:6.2f} -> {p.dur:5.2f} s"
              + (f"  x{p.speed:.2f}" if abs(p.speed - 1) > 1e-3 and p.kind in ('take', 'clip') else ""))
    total = sum(p.dur for p in pieces)
    print(f"{len(pieces)} pieces, {int(total // 60)}:{total % 60:04.1f}")
    if args.plan:
        return 0

    ffmpeg = find_tool("ffmpeg")
    work = OUT / "final-work"
    work.mkdir(parents=True, exist_ok=True)
    only = set(args.only.split(",")) if args.only else None
    files = []
    for i, p in enumerate(pieces):
        if only and p.line not in only:
            continue
        files.append(render_piece(ffmpeg, p, i, fps, markers_of, work, float(edl.get("push", 0.0))))
    listing = work / "list.txt"
    listing.write_text("".join(f"file '{f.as_posix()}'\n" for f in files), encoding="utf-8")
    joined = work / "joined.mp4"
    subprocess.run([ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(listing),
                    "-c", "copy", str(joined)], check=True, cwd=ROOT)

    sys.path.insert(0, str(ROOT / "tools" / "video"))
    from make_narration import cues_for  # same caption split as the narration tool
    srt = OUT / f"final-{suffix}.srt"
    srt.write_text(srt_from_timeline(timeline, cues_for), encoding="utf-8")
    out = OUT / (f"final-{suffix}.mp4" if not only else f"final-{suffix}-check.mp4")
    wav = OUT / f"narration-{suffix}.wav"
    # MarginV 48 of the 288-line subtitle canvas puts the captions about 180 px above the bottom edge, clear of the
    # game note and the source line (R23.7)
    style = "FontName=Segoe UI,FontSize=17,Bold=1,Outline=2,Shadow=0,MarginV=48,PrimaryColour=&H00FFFFFF,OutlineColour=&H00101010"
    vf = f"subtitles={srt.relative_to(ROOT).as_posix()}:force_style='{style}'" if not only else "null"
    if not args.voice:
        vf += ",drawtext=fontfile='" + FONT + "':text='ROUGH CUT - silent, estimated timing':fontsize=26:fontcolor=0xFFB454:x=w-tw-24:y=16:box=1:boxcolor=black@0.6:boxborderw=8"
    cmd = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-i", str(joined)]
    if wav.exists():
        cmd += ["-i", str(wav), "-filter_complex", f"[0:v]{vf}[v];[1:a]loudnorm=I=-14:TP=-1.0:LRA=11,aresample=48000[a]",
                "-map", "[v]", "-map", "[a]", "-c:a", "aac", "-b:a", "192k", "-shortest"]
    else:
        cmd += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-filter_complex", f"[0:v]{vf}[v]",
                "-map", "[v]", "-map", "1:a", "-c:a", "aac", "-b:a", "128k", "-shortest"]
    cmd += ["-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out)]
    subprocess.run(cmd, check=True, cwd=ROOT)

    log = subprocess.run([ffmpeg, "-hide_banner", "-i", str(out), "-vf", "freezedetect=n=0.002:d=2", "-map", "0:v", "-f", "null", "-"],
                         capture_output=True, text=True, cwd=ROOT).stderr
    allowed_lines = set(edl.get("stillLines", []))
    flagged = []
    for s, d in freezes(log):
        line = next((i["id"] for i in reversed(timeline) if i["start"] <= s + 0.05), "?")
        if line not in allowed_lines:
            flagged.append((s, d, line))
    print(f"{out.relative_to(ROOT)}: {int(total // 60)}:{total % 60:04.1f}; captions {srt.relative_to(ROOT)}")
    for s, d, line in flagged:
        print(f"  still picture {d:.1f} s at {s:.1f} s (line {line})")
    if not flagged:
        print("  freeze check: no still stretch over 2 s outside the stills and cards")
    return 0


if __name__ == "__main__":
    sys.exit(main())
