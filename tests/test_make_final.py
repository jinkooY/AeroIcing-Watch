"""Tests for tools/video/make_final.py planning code (task 23.3). No ffmpeg, no take files: synthetic markers only."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools" / "video"))
import make_final as mf  # noqa: E402

MARKERS = [  # synthetic markers in the shape record_takes.mjs writes
    {"t": 1.0, "event": "takeoff click", "#hud": {"x": 0, "y": 0, "w": 1920, "h": 60}},
    {"t": 2.0, "event": "gate 1", "km": 0, "rects": {"#gate-panel": {"x": 1500, "y": 40, "w": 400, "h": 120},
                                                     "#hud-alt": {"x": 1300, "y": 0, "w": 100, "h": 50}}},
    {"t": 5.0, "event": "climb", "#hud-alt": {"x": 1310, "y": 0, "w": 110, "h": 50}},
    {"t": 9.0, "event": "gate 5", "rects": {"#gate-panel": {"x": 1500, "y": 60, "w": 400, "h": 140}}},
]


def test_synthetic_resolve_time_numbers_and_markers():
    assert mf.resolve_time(3, MARKERS) == 3.0
    assert mf.resolve_time("4.5", MARKERS) == 4.5
    assert mf.resolve_time("gate 1", MARKERS) == 2.0
    assert mf.resolve_time("gate 1+0.5", MARKERS) == pytest.approx(2.5)
    assert mf.resolve_time("gate 5-1.25", MARKERS) == pytest.approx(7.75)
    with pytest.raises(KeyError):
        mf.resolve_time("gate 9", MARKERS)


def test_synthetic_marker_rect_takes_latest_at_or_before():
    assert mf.marker_rect("#gate-panel", MARKERS, 3.0) == [1500, 40, 400, 120]
    assert mf.marker_rect("#gate-panel", MARKERS, 9.5) == [1500, 60, 400, 140]
    assert mf.marker_rect("#hud-alt", MARKERS, 6.0) == [1310, 0, 110, 50]  # top-level rect form
    assert mf.marker_rect("#hud-alt", MARKERS, 0.0) == [1300, 0, 100, 50]  # before any marker: the first one
    assert mf.marker_rect("#missing", MARKERS, 5.0) is None


def test_synthetic_zoom_rect_union_and_explicit():
    assert mf.zoom_rect([10, 20, 30, 40], MARKERS, 0) == [10.0, 20.0, 30.0, 40.0]
    assert mf.zoom_rect(["#hud-alt", "#gate-panel"], MARKERS, 3.0) == [1300, 0, 600, 160]
    assert mf.zoom_rect("#missing", MARKERS, 3.0) is None


@pytest.mark.parametrize("rect", [[0, 0, 10, 10], [1900, 1070, 20, 10], [800, 500, 300, 40], [0, 0, 1920, 1080], [100, 900, 1800, 100]])
def test_synthetic_zoom_crop_is_16_9_inside_frame_and_covers_rect(rect):
    x, y, w, h = mf.zoom_crop(rect, pad=20)
    assert x >= 0 and y >= 0 and x + w <= mf.W and y + h <= mf.H
    assert w % 2 == 0 and h % 2 == 0
    assert abs(w / h - 16 / 9) < 0.01
    rx, ry, rw, rh = rect
    if rw + 40 <= mf.W and rh + 40 <= mf.H:
        assert x <= rx and y <= ry and x + w >= rx + rw and y + h >= ry + rh


def test_synthetic_slots_run_to_next_start_and_add_tail():
    tl = [{"id": "a", "start": 0.0, "end": 2.0}, {"id": "b", "start": 2.5, "end": 4.0}]
    assert mf.slots(tl, tail=1.0) == {"a": (0.0, 2.5), "b": (2.5, 2.5)}


def test_synthetic_plan_line_fills_slot_and_ramps_speed():
    shots = [{"take": "T", "from": "gate 1", "to": "gate 5", "dur": 1.0}, {"still": "x.png"}]
    pieces = mf.plan_line("n3", 4.0, shots, lambda take: MARKERS)
    assert [p.dur for p in pieces] == [1.0, 3.0]
    assert pieces[0].span == pytest.approx(7.0) and pieces[0].speed == pytest.approx(7.0)
    assert sum(p.dur for p in pieces) == pytest.approx(4.0)


def test_synthetic_plan_line_rejects_overfull_and_two_free_shots():
    with pytest.raises(ValueError):
        mf.plan_line("x", 2.0, [{"still": "a", "dur": 3.0}], lambda t: MARKERS)
    with pytest.raises(ValueError):
        mf.plan_line("x", 2.0, [{"still": "a"}, {"still": "b"}], lambda t: MARKERS)
    with pytest.raises(ValueError):
        mf.plan_line("x", 2.0, [{"take": "T", "from": "gate 5", "to": "gate 1"}], lambda t: MARKERS)


def test_synthetic_esc_text_keeps_drawtext_safe():
    out = mf.esc_text("Ice: 50% it's, done")
    assert "\\:" in out and "\\%" in out and "\\," in out and "'" not in out


def test_synthetic_text_filter_times_and_position():
    f = mf.text_filter({"text": "GATE", "at": 0.5, "dur": 2, "pos": "top-right", "color": "orange"})
    assert "between(t,0.50,2.50)" in f and "x=w-tw-64" in f and "0xFFB454" in f


def test_synthetic_freezes_lists_only_long_ones():
    log = ("lavfi.freezedetect.freeze_start: 10.5\nlavfi.freezedetect.freeze_duration: 1.5\n"
           "lavfi.freezedetect.freeze_start: 40\nlavfi.freezedetect.freeze_duration: 3.25\n")
    assert mf.freezes(log, allowed=2.0) == [(40.0, 3.25)]


def test_synthetic_srt_from_timeline():
    tl = [{"id": "a", "start": 0.0, "end": 1.5, "text": "Hello there."}]
    srt = mf.srt_from_timeline(tl, lambda text, a, b: [(a, b, text)])
    assert srt.startswith("1\n00:00:00,000 --> 00:00:01,500\nHello there.")


def test_edl_covers_every_script_line_and_keeps_caption_rule():
    edl = json.loads((ROOT / "docs/video/edl.json").read_text(encoding="utf-8"))
    script = json.loads((ROOT / "docs/video/script.json").read_text(encoding="utf-8"))
    ids = [l["id"] for l in script["lines"]]
    assert set(ids) <= set(edl["lines"]), set(ids) - set(edl["lines"])
    # every Blender cloud shot carries the illustration caption (storyboard section 9)
    for shots in edl["lines"].values():
        for s in shots:
            if "blender" in str(s.get("clip", "")):
                assert s.get("caption") == "Illustration from satellite cloud-top data"
    # no science-guardrail words in the on-screen text
    banned = ("predict", "validated", "certified", "safe", "severe", "moderate", "ice-free")
    for shots in edl["lines"].values():
        for s in shots:
            for t in s.get("text", []) + ([{"text": s["card"]}] if "card" in s else []):
                assert not any(b in t["text"].lower() for b in banned), t["text"]


def test_synthetic_push_only_on_real_speed_takes_unless_set():
    take = mf.Piece("g1", "take", "T2", 0, 5, 5, {})
    ramp = mf.Piece("n3", "take", "T2", 0, 12, 1.2, {})
    still = mf.Piece("d1", "still", "x.png", 0, 5, 5, {})
    forced = mf.Piece("d1", "still", "x.png", 0, 5, 5, {"push": 0.02})
    off = mf.Piece("g1", "take", "T2", 0, 5, 5, {"push": 0})
    assert mf.push_amount(take, 0.05) == 0.05
    assert mf.push_amount(ramp, 0.05) == 0.0
    assert mf.push_amount(still, 0.05) == 0.0
    assert mf.push_amount(forced, 0.05) == 0.02
    assert mf.push_amount(off, 0.05) == 0.0
