"""Property tests for the caption splitter `cues_for` in tools/video/make_narration.py (also used by make_final.py).

Properties (captions burned into the submission video and the YouTube SRT):
  CAP-1 timing: cues are in order, back to back, start at `start` and end at `end`.
  CAP-2 words: every spoken word appears once, in order (pause tags removed).
  CAP-3 layout: a cue has at most two lines and a line at most MAX_LINE (42) characters, unless one word alone is longer.
           42 characters and two lines is the common timed-text convention (for example the Netflix English style guide);
           the code already used the 42 but not the two-line limit.
All inputs here are synthetic text from Hypothesis.
"""
from __future__ import annotations

import sys
from pathlib import Path

from hypothesis import given, settings, strategies as st

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools" / "video"))
import make_narration as mn  # noqa: E402

word = st.text(alphabet="abcdefghijklmnopqrstuvwxyz", min_size=1, max_size=12)
sentence = st.lists(word, min_size=1, max_size=18).map(lambda ws: " ".join(ws))
end_mark = st.sampled_from([".", "!", "?", ","])
script_line = st.lists(st.tuples(sentence, end_mark), min_size=1, max_size=4).map(
    lambda parts: " ".join(s + m for s, m in parts))
with_tags = st.tuples(script_line, st.booleans()).map(lambda t: t[0].replace(" ", " <short pause> ", 1) if t[1] else t[0])
start_s = st.floats(min_value=0, max_value=170, allow_nan=False, allow_infinity=False)
dur_s = st.floats(min_value=0.8, max_value=15, allow_nan=False, allow_infinity=False)


@settings(max_examples=300, deadline=None)
@given(with_tags, start_s, dur_s)
def test_synthetic_cap1_cues_are_back_to_back_and_cover_the_line(text, start, dur):
    cues = mn.cues_for(text, start, start + dur)
    assert cues
    assert abs(cues[0][0] - start) < 1e-9
    assert abs(cues[-1][1] - (start + dur)) < 1e-6
    for (a0, b0, _), (a1, _b1, _) in zip(cues, cues[1:]):
        assert b0 > a0 and abs(b0 - a1) < 1e-9


@settings(max_examples=300, deadline=None)
@given(with_tags, start_s, dur_s)
def test_synthetic_cap2_every_word_once_in_order(text, start, dur):
    cues = mn.cues_for(text, start, start + dur)
    spoken = mn.TAG.sub("", text).split()
    shown = " ".join(c[2].replace("\n", " ") for c in cues).split()
    assert shown == spoken


@settings(max_examples=300, deadline=None)
@given(with_tags, start_s, dur_s)
def test_synthetic_cap3_at_most_two_lines_of_42_characters(text, start, dur):
    for _a, _b, caption in mn.cues_for(text, start, start + dur):
        lines = caption.split("\n")
        assert len(lines) <= 2, caption
        for line in lines:
            assert len(line) <= mn.MAX_LINE or " " not in line, line


def test_real_script_captions_meet_the_layout_rule():
    import json
    script = json.loads((ROOT / "docs/video/script.json").read_text(encoding="utf-8"))
    for line in script["lines"]:
        for _a, _b, caption in mn.cues_for(line["text"], 0.0, 8.0):
            assert len(caption.split("\n")) <= 2, (line["id"], caption)
