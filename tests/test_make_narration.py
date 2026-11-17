"""Tests for tools/video/make_narration.py. No network: synthesize() is replaced by a fake that returns silence.
Test data below is synthetic (tiny two-line scripts); the wording test reads the real docs/video/script.json."""
from __future__ import annotations

import importlib.util
import io
import json
import re
import wave
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


m = _load("make_narration", ROOT / "tools" / "video" / "make_narration.py")
wording = _load("test_wording_module", ROOT / "tests" / "test_wording.py")


def fake_wav(seconds: float = 0.5) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(m.RATE)
        w.writeframes(b"\x00\x00" * int(m.RATE * seconds))
    return buf.getvalue()


@pytest.fixture
def sandbox(tmp_path, monkeypatch):
    """A synthetic two-line script, a temp output folder and a fake synthesizer that counts calls."""
    script = {
        "model": "fake-model", "voice": "T", "default_style": "calm",
        "lines": [
            {"id": "a", "scene": "1", "pause_after": 0.5, "text": "First line here."},
            {"id": "b", "scene": "1", "pause_after": 0.25, "text": "Second line follows. It has two sentences."},
        ],
    }
    path = tmp_path / "script.json"
    path.write_text(json.dumps(script), encoding="utf-8")
    out = tmp_path / "out"
    calls: list[str] = []

    def fake_synth(text, style, voice, model, key):
        calls.append(text)
        return fake_wav(0.5)

    monkeypatch.setattr(m, "SCRIPT", path)
    monkeypatch.setattr(m, "OUT", out)
    monkeypatch.setattr(m, "ROOT", tmp_path)
    monkeypatch.setattr(m, "synthesize", fake_synth)
    monkeypatch.setattr(m, "load_key", lambda: "not-a-key")
    return {"script": script, "path": path, "out": out, "calls": calls}


# ---------------------------------------------------------------- pure helpers
def test_stamp_unit():
    assert m.stamp(0) == "00:00:00,000"
    assert m.stamp(61.5) == "00:01:01,500"
    assert m.stamp(3600.001) == "01:00:00,001"


def test_wrap_unit_never_exceeds_limit():
    text = "The label reads: observed supercooled layer at planned altitude. Seen by the satellite."
    lines = m.wrap(text)
    assert all(len(x) <= m.MAX_LINE for x in lines)
    assert " ".join(lines) == text


def test_cues_for_unit_strips_tags_merges_short_and_keeps_bounds():
    cues = m.cues_for("November twelfth. A real day. <short pause> Real clouds over the eastern United States.", 2.0, 8.0)
    assert cues[0][0] == pytest.approx(2.0)
    assert cues[-1][1] == pytest.approx(8.0)
    assert all("<" not in c[2] for c in cues)
    assert len(cues) < 3  # the two short sentences merge into one cue
    for (a1, b1, _), (a2, b2, _) in zip(cues, cues[1:]):
        assert b1 == pytest.approx(a2) and a1 < b1


# ---------------------------------------------------------------- B1 and clip cache
def test_incomplete_clips_write_no_wav_and_no_srt_synthetic(sandbox):
    code = m.main(["--only", "a"])
    out = sandbox["out"]
    assert code == 1
    assert (out / "T" / "a.wav").exists() and not (out / "T" / "b.wav").exists()
    assert not (out / "narration-T.wav").exists()
    assert not (out / "captions-T.srt").exists()


def test_complete_run_writes_joined_wav_and_aligned_srt_synthetic(sandbox):
    assert m.main([]) == 0
    out = sandbox["out"]
    with wave.open(str(out / "narration-T.wav")) as w:
        total = w.getnframes() / w.getframerate()
    assert total == pytest.approx(0.5 + 0.5 + 0.5 + 0.25)  # two clips plus both pauses
    timeline = json.loads((out / "timeline-T.json").read_text(encoding="utf-8"))
    assert timeline[1]["start"] == pytest.approx(1.0)
    srt = (out / "captions-T.srt").read_text(encoding="utf-8")
    assert "00:00:01,000 -->" in srt


def test_second_run_reuses_clips_and_changed_text_is_resynthesized_synthetic(sandbox):
    assert m.main([]) == 0
    assert len(sandbox["calls"]) == 2
    assert m.main([]) == 0
    assert len(sandbox["calls"]) == 2  # nothing new
    sandbox["script"]["lines"][0]["text"] = "First line, edited."
    sandbox["path"].write_text(json.dumps(sandbox["script"]), encoding="utf-8")
    assert m.main([]) == 0
    assert sandbox["calls"][-1] == "First line, edited."
    assert len(sandbox["calls"]) == 3


def test_legacy_clip_without_hash_is_adopted_not_resynthesized_synthetic(sandbox):
    clip_dir = sandbox["out"] / "T"
    clip_dir.mkdir(parents=True)
    (clip_dir / "a.wav").write_bytes(fake_wav(0.5))
    assert m.main([]) == 0
    assert sandbox["calls"] == ["Second line follows. It has two sentences."]


def test_placeholder_lines_are_skipped_synthetic(sandbox):
    sandbox["script"]["lines"].append({"id": "c", "scene": "2", "text": "It cost [X] dollars."})
    sandbox["path"].write_text(json.dumps(sandbox["script"]), encoding="utf-8")
    assert m.main([]) == 0
    assert all("[X]" not in t for t in sandbox["calls"])


def test_dry_run_makes_no_api_call_and_no_wav_synthetic(sandbox):
    assert m.main(["--dry-run"]) == 0
    assert sandbox["calls"] == []
    assert not list(sandbox["out"].glob("narration-*.wav"))
    assert (sandbox["out"] / "captions-estimated.srt").exists()


# ---------------------------------------------------------------- the real script
def test_real_script_has_no_banned_wording():
    script = json.loads((ROOT / "docs" / "video" / "script.json").read_text(encoding="utf-8"))
    bad = {}
    for line in script["lines"]:
        text = re.sub(r"<[^>]+>", " ", line["text"])
        hit = wording.violations(text)
        if hit:
            bad[line["id"]] = hit
    assert not bad, f"banned wording (R9.1, R9.2) in the narration: {bad}"


def test_real_script_ids_unique_and_estimated_length_fits():
    script = json.loads((ROOT / "docs" / "video" / "script.json").read_text(encoding="utf-8"))
    ids = [l["id"] for l in script["lines"]]
    assert len(ids) == len(set(ids))
    seconds = sum(m.estimate_seconds(l["text"]) + float(l.get("pause_after", 0.4)) for l in script["lines"])
    assert seconds <= 175, f"estimated {seconds:.0f} s; the video limit is 180 s"
