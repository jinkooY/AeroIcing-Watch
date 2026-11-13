"""Index selection of tools/collect_ifs.py with a SYNTHETIC index (no network)."""
import json
from datetime import datetime, timezone

import pytest

pytest.importorskip("eccodes")
from tools import collect_ifs  # noqa: E402

RUN = datetime(2026, 11, 12, 0, tzinfo=timezone.utc)


def _index(skip=None, duplicate=False):
    rows, offset = [], 0
    for field in collect_ifs.FIELDS:
        for level in collect_ifs.LEVELS:
            if (field, level) == skip:
                continue
            rows.append({"levtype": "pl", "param": field, "levelist": str(level), "date": "20261112",
                         "time": "0000", "step": "21", "stream": "oper", "type": "fc",
                         "_offset": offset, "_length": 100})
            offset += 100
    if duplicate:
        rows.append(dict(rows[0]))
    return "\n".join(json.dumps(r) for r in rows).encode()


def _select(monkeypatch, body):
    monkeypatch.setattr(collect_ifs, "read", lambda *a, **k: body)
    return collect_ifs.select("synthetic-url", RUN, 21)


def test_levels_cover_the_flight_band_synthetic():
    assert collect_ifs.LEVELS == (925, 850, 700, 600, 500, 400, 300, 250)
    assert list(collect_ifs.LEVELS) == sorted(collect_ifs.LEVELS, reverse=True)


def test_complete_index_selects_every_field_and_level_synthetic(monkeypatch):
    got = _select(monkeypatch, _index())
    assert len(got) == len(collect_ifs.FIELDS) * len(collect_ifs.LEVELS) == 40


@pytest.mark.parametrize("missing", [("t", 925), ("r", 600), ("v", 250)])
def test_missing_level_is_rejected_synthetic(monkeypatch, missing):
    with pytest.raises(ValueError, match="Incomplete"):
        _select(monkeypatch, _index(skip=missing))


def test_duplicate_field_is_rejected_synthetic(monkeypatch):
    with pytest.raises(ValueError, match="Duplicate"):
        _select(monkeypatch, _index(duplicate=True))
