"""Basemap builder tests on SYNTHETIC polylines (no network, files only in tmp_path)."""
import json
import math

import numpy as np
import pytest

from tools import build_basemap as bb
from tools import export_map_images as emi

LANES = [[40.0, -100.0], [40.0, -98.0]]


def _grid():
    return emi.make_grid(LANES)


def _geojson(*lines):
    return {"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": {"type": "LineString", "coordinates": [[lo, la] for la, lo in ln]}}
        for ln in lines]}


def test_synthetic_clipping_drops_outside_and_cuts_at_the_box():
    box = (0.0, 0.0, 10.0, 10.0)
    xy = np.array([[-5.0, 5.0], [15.0, 5.0]])
    (part,) = bb.clip_polyline(xy, box)
    assert part[0].tolist() == [0.0, 5.0] and part[-1].tolist() == [10.0, 5.0]
    assert bb.clip_polyline(np.array([[-5.0, 20.0], [15.0, 20.0]]), box) == []


def test_synthetic_clipping_splits_a_line_that_leaves_and_returns():
    box = (0.0, 0.0, 10.0, 10.0)
    xy = np.array([[1.0, 5.0], [20.0, 5.0], [20.0, 8.0], [5.0, 8.0]])
    assert len(bb.clip_polyline(xy, box)) == 2


def test_synthetic_simplification_stays_within_tolerance_and_drops_points():
    x = np.linspace(0, 100, 201)
    y = 0.2 * np.sin(x)  # wiggle below 1 km
    xy = np.column_stack([x, y])
    s = bb.simplify(xy, 1.0)
    assert len(s) < 10
    for p in xy:  # distance to the simplified polyline
        d = min(np.hypot(*(p - (a + np.clip((p - a) @ (b - a) / ((b - a) @ (b - a)), 0, 1) * (b - a))))
                for a, b in zip(s[:-1], s[1:]))
        assert d <= 1.0 + 1e-9
    big = np.array([[0, 0], [5, 4], [10, 0.0]])
    assert len(bb.simplify(big, 1.0)) == 3  # a real corner is kept


def test_synthetic_lines_are_clipped_to_the_case_extent_and_finite():
    g = _grid()
    inside = [(40.0, -101.0), (40.0, -97.0)]
    far = [(10.0, -50.0), (11.0, -49.0)]
    out = bb.process_lines([inside, far], [g])
    assert len(out) == 1
    for la, lo in out[0]:
        assert math.isfinite(la) and math.isfinite(lo)
        assert 38.0 < la < 42.0 and -102.5 < lo < -95.5
        assert round(la, bb.DECIMALS) == la


def test_synthetic_build_has_attribution_source_and_budget(tmp_path):
    doc = bb.build_basemap(_geojson([(40.0, -101.0), (40.2, -97.0)]), _geojson([(39.5, -99.0), (40.5, -99.0)]),
                           [_grid()])
    assert doc["attribution"] == "Made with Natural Earth"
    assert doc["source"]["url"].startswith("https://") and doc["source"]["version"]
    assert doc["coast"] and doc["states"]
    json.loads(bb.dumps(doc))  # strict JSON, no NaN
    assert len(bb.dumps(doc).encode()) < bb.BUDGET_BYTES


def test_synthetic_oversize_basemap_is_refused():
    rng = np.random.default_rng(1)
    lines = [[(40.0 + float(a), -100.0), (40.0 + float(a), -99.0)] for a in rng.uniform(-0.5, 0.5, 12000)]
    with pytest.raises(bb.BasemapError):
        bb.build_basemap(_geojson(*lines), _geojson(), [_grid()])


def test_synthetic_local_path_is_used_without_download(tmp_path):
    p = tmp_path / "x.geojson"
    p.write_text(json.dumps(_geojson([(40.0, -100.0), (40.1, -99.0)])), encoding="utf-8")
    assert bb.load_source("coast", p)["type"] == "FeatureCollection"
