"""Build the submission-video narration: one Gemini TTS clip per line, one joined WAV, one SRT.

Reads docs/video/script.json. Writes only under data/video/ (git-ignored).
The API key comes from the GEMINI_API_KEY environment variable or .env; it is never printed.

Usage (repository root):
  python tools/video/make_narration.py --dry-run          # SRT with estimated timing, no API call
  python tools/video/make_narration.py --audition         # one sample line in several voices
  python tools/video/make_narration.py                    # synthesize missing lines, join, write SRT
  python tools/video/make_narration.py --only h1 h2 --force
  python tools/video/make_narration.py --voice Sadaltager --force
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import sys
import time
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "docs" / "video" / "script.json"
OUT = ROOT / "data" / "video"
ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions"
RATE = 24000  # Gemini TTS output: 24 kHz, mono, 16-bit
AUDITION_VOICES = ["Charon", "Sadaltager", "Achird", "Sulafat", "Puck", "Kore", "Orus", "Iapetus"]
PLACEHOLDER = re.compile(r"\[[A-Z][^\]]*\]")
TAG = re.compile(r"<[^>]+>")
WORDS_PER_SECOND = 2.1  # measured on Gemini TTS audition clips; used only by --dry-run
MAX_LINE = 42


def load_key() -> str:
    key = os.environ.get("GEMINI_API_KEY", "")
    if not key:
        try:
            from dotenv import load_dotenv

            load_dotenv(ROOT / ".env")
            key = os.environ.get("GEMINI_API_KEY", "")
        except ImportError:
            pass
    if not key:
        sys.exit("GEMINI_API_KEY is not set (environment variable or .env).")
    return key


def synthesize(text: str, style: str, voice: str, model: str, key: str) -> bytes:
    import requests

    body = {
        "model": model,
        "input": [{
            "type": "user_input",
            "content": [{
                "type": "text",
                "text": text,
                "annotations": [{"type": "speech_metadata", "style": style}],
            }],
        }],
        "response_format": {"type": "audio"},
        "generation_config": {"speech_config": [{"voice": voice}]},
    }
    last = ""
    wait = 0.0
    for attempt in range(8):
        if wait:
            print(f"  waiting {wait:.0f}s (rate limit)")
            time.sleep(wait)
        resp = requests.post(ENDPOINT, json=body, headers={"x-goog-api-key": key}, timeout=120)
        if resp.status_code == 200:
            audio = [
                c for s in resp.json().get("steps", []) if s.get("type") == "model_output"
                for c in s.get("content", []) if c.get("type") == "audio"
            ]
            if audio:
                return base64.b64decode(audio[-1]["data"])
            last = "no audio in response"
        else:
            last = f"HTTP {resp.status_code}: {resp.text[:200]}"
            if resp.status_code not in (429, 500, 502, 503, 504):
                break
        m = re.search(r"retry in (\d+(?:\.\d+)?)s", resp.text)  # the free tier allows 3 requests per minute
        wait = float(m.group(1)) + 2 if m else 5 * (attempt + 1)
    raise RuntimeError(last)


def wav_seconds(path: Path) -> float:
    with wave.open(str(path), "rb") as w:
        return w.getnframes() / w.getframerate()


def estimate_seconds(text: str) -> float:
    return max(0.8, len(TAG.sub("", text).split()) / WORDS_PER_SECOND)


def wrap(text: str) -> list[str]:
    lines, cur = [], ""
    for word in text.split():
        if cur and len(cur) + 1 + len(word) > MAX_LINE:
            lines.append(cur)
            cur = word
        else:
            cur = f"{cur} {word}".strip()
    if cur:
        lines.append(cur)
    return lines


def cues_for(text: str, start: float, end: float) -> list[tuple[float, float, str]]:
    clean = re.sub(r"\s+", " ", TAG.sub("", text)).strip()
    parts: list[str] = []
    for p in (p.strip() for p in re.split(r"(?<=[.!?])\s+", clean) if p.strip()):
        if parts and len(parts[-1]) < 30:  # merge very short sentences into one readable cue
            parts[-1] = f"{parts[-1]} {p}"
        else:
            parts.append(p)
    total = sum(len(p) for p in parts) or 1
    cues, t = [], start
    for p in parts:
        d = (end - start) * len(p) / total
        cues.append((t, t + d, "\n".join(wrap(p))))
        t += d
    return cues


def stamp(sec: float) -> str:
    ms = int(round(sec * 1000))
    return f"{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}"


def write_wav(path: Path, pcm: bytes) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm)


def read_pcm(path: Path) -> bytes:
    with wave.open(str(path), "rb") as w:
        if (w.getframerate(), w.getnchannels(), w.getsampwidth()) != (RATE, 1, 2):
            raise RuntimeError(f"{path.name}: expected 24 kHz mono 16-bit")
        return w.readframes(w.getnframes())


def clip_key(line: dict, style: str, voice: str, model: str) -> str:
    """Hash of everything that changes the audio, so an edited line is never served from an old clip."""
    blob = json.dumps([line["text"], style, voice, model], ensure_ascii=False)
    return hashlib.sha1(blob.encode("utf-8")).hexdigest()


def clip_state(clip: Path, key: str) -> str:
    """'ok', 'legacy' (clip without a hash file, adopted as is), 'stale' (hash differs) or 'missing'."""
    if not clip.exists():
        return "missing"
    sidecar = clip.with_suffix(".key")
    if not sidecar.exists():
        return "legacy"
    return "ok" if sidecar.read_text(encoding="utf-8").strip() == key else "stale"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="estimate timing, no API call")
    ap.add_argument("--audition", action="store_true", help="render one sample line in several voices")
    ap.add_argument("--force", action="store_true", help="re-synthesize even if a clip exists")
    ap.add_argument("--voice", help="override the voice in script.json")
    ap.add_argument("--model", help="override the model in script.json, e.g. gemini-3.8-flash-lite-tts")
    ap.add_argument("--only", nargs="*", help="line ids to synthesize")
    args = ap.parse_args(argv)

    script = json.loads(SCRIPT.read_text(encoding="utf-8"))
    model, default_style = script["model"], script["default_style"]
    if args.model:
        model = args.model
    voice = args.voice or script["voice"]
    tag = voice if model == script["model"] else f"{voice}-{model.replace('gemini-', '')}"
    audio_dir = OUT / tag
    lines = script["lines"]

    if args.audition:
        key = load_key()
        sample = next(l for l in lines if l["id"] == "p1")
        (OUT / "audition").mkdir(parents=True, exist_ok=True)
        for v in AUDITION_VOICES:
            target = OUT / "audition" / f"{v}.wav"
            try:
                target.write_bytes(synthesize(sample["text"], default_style, v, model, key))
                print(f"audition: {target.relative_to(ROOT)}")
            except RuntimeError as exc:
                print(f"audition {v} failed: {exc}")
        return 0

    skipped = [l["id"] for l in lines if PLACEHOLDER.search(l["text"])]
    ready = [l for l in lines if l["id"] not in skipped]
    if skipped:
        print("skipped (placeholder not filled):", ", ".join(skipped))

    key = None if args.dry_run else load_key()
    audio_dir.mkdir(parents=True, exist_ok=True)

    timeline, cursor, pcm = [], 0.0, bytearray()
    missing: list[str] = []
    for line in ready:
        clip = audio_dir / f"{line['id']}.wav"
        style = line.get("style", default_style)
        key_hash = clip_key(line, style, voice, model)
        wanted = args.only is None or line["id"] in args.only
        state = "missing" if args.dry_run else clip_state(clip, key_hash)
        if not args.dry_run:
            if state == "legacy":
                clip.with_suffix(".key").write_text(key_hash, encoding="utf-8")
                print(f"adopted existing clip {line['id']} (no hash file; check it matches the text)")
                state = "ok"
            if wanted and (args.force or state in ("missing", "stale")):
                clip.write_bytes(synthesize(line["text"], style, voice, model, key))
                clip.with_suffix(".key").write_text(key_hash, encoding="utf-8")
                print(f"synthesized {line['id']}" + (" (text changed)" if state == "stale" else ""))
                state = "ok"
            if state != "ok":
                missing.append(line["id"] + (" (stale)" if state == "stale" else ""))
        if state == "ok" and not args.dry_run:
            dur = wav_seconds(clip)
            pcm += read_pcm(clip)
        else:
            dur = estimate_seconds(line["text"])
        gap = float(line.get("pause_after", 0.4))
        pcm += b"\x00\x00" * int(RATE * gap)
        timeline.append({"id": line["id"], "scene": line["scene"], "start": round(cursor, 2),
                         "end": round(cursor + dur, 2), "text": line["text"]})
        cursor += dur + gap

    if missing:
        # A line without a usable clip would shift every later caption and leave a hole in the WAV.
        print("NOT WRITTEN: no usable clip for " + ", ".join(missing) + ". Synthesize them, then run again.")
        return 1

    OUT.mkdir(parents=True, exist_ok=True)
    cues, n = [], 1
    for item in timeline:
        for a, b, text in cues_for(item["text"], item["start"], item["end"]):
            cues.append(f"{n}\n{stamp(a)} --> {stamp(b)}\n{text}\n")
            n += 1
    suffix = "estimated" if args.dry_run else tag
    (OUT / f"captions-{suffix}.srt").write_text("\n".join(cues), encoding="utf-8")
    (OUT / f"timeline-{suffix}.json").write_text(json.dumps(timeline, indent=2), encoding="utf-8")
    if not args.dry_run:
        write_wav(OUT / f"narration-{tag}.wav", bytes(pcm))

    total = timeline[-1]["end"] if timeline else 0
    print(f"{len(timeline)} lines, narration length {int(total // 60)}:{int(total % 60):02} "
          f"({'estimated' if args.dry_run else 'measured'}); output in {OUT.relative_to(ROOT)}")
    if total > 175:
        print("WARNING: over 2:55. The video limit is 3:00, so trim lines.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
