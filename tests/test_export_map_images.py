"""Map image exporter tests on SYNTHETIC ABI grids (no network, files only in tmp_path)."""
import io
import json
from datetime import datetime, timezone

import numpy as np
import pytest
from PIL import Image

from src.integration import goes_conus as gc
from tests.goes_synthetic import CENTER, PROJ, PX2, _grid, synthetic_scene
from tools import export_map_images as emi

SCAN = datetime(2026, 11, 12, 19, 31, tzinfo=timezone.utc)


def synthetic_ir(n=400, temp=None):
    """Band 13 layer on a 2 km grid; brightness temperature is a smooth function of longitude."""
    cx, cy = gc.lonlat_to_scan(PROJ, CENTER[0], CENTER[1])
    x, y = _grid(n, PX2, cx[0], cy[0])
    xx, yy = np.meshgrid(x, y)
    lat, lon = gc.scan_to_lonlat(PROJ, xx.ravel(), yy.ravel())
    lat, lon = lat.reshape(xx.shape), lon.reshape(xx.shape)
    values = (temp(lat, lon) if temp else 250.0 + (lon + 75.0) * 10.0).astype(np.float32)
    return gc.Layer("ir", "ABI-L2-CMIPC", "CMI", 2.0, "K", x, y, values, np.zeros(values.shape, np.uint8))


def lanes(a=(39.8, -75.6), b=(40.2, -74.4), n_lanes=3, n=20):
    lat = np.linspace(a[0], b[0], n)
    lon = np.linspace(a[1], b[1], n)
    return [[round(float(la + k * 0.05), 4), round(float(lo), 4)] for k in range(n_lanes) for la, lo in zip(lat, lon)]


def case(lanes_latlon=None, parallax=(2.3, None, 6.9, 4.1), case_id="t-synthetic"):
    return {"id": case_id, "title": "x", "lanesLatLon": {"shape": [3, 20, 2], "data": lanes_latlon or lanes()},
            "satellite": {"shape": [3, 4], "parallaxKm": list(parallax)}, "references": {"best": {"costUsd": 1.0}}}


def png(data):
    return Image.open(io.BytesIO(data))


# -- band selection and decoding ------------------------------------------------------------------

def test_band13_selection_by_file_name_synthetic():
    names = [f"noaa-goes19/ABI-L2-CMIPC/2026/311/19/OR_ABI-L2-CMIPC-M6C{c:02d}_G19_s20263111901182_e20263111903568_c20263111904063.nc"
             for c in (1, 13, 14)]
    names.append("noaa-goes19/ABI-L2-CMIPC/2026/311/19/OR_ABI-L2-CMIPC-M3C13_G19_s20263111911182_e20263111913568_c20263111914063.nc")
    names.append("noaa-goes19/ABI-L2-CMIPC/2026/311/19/OR_ABI-L2-CMIPC-M6C13_G19_s20263111906182_e20263111908568_c20263111909053.nc")
    picked = gc.band_filter(names)
    assert len(picked) == 3 and all("C13_G19_" in n for n in picked)
    assert not gc.band_filter([n for n in names if "C13" not in n])
    assert gc.BAND13["channel"] == 13 and gc.BAND13["product"] == "ABI-L2-CMIPC"
    assert gc.choose_nearest(picked, datetime(2026, 11, 7, 19, 6, tzinfo=timezone.utc)) == picked[2]


def test_decode_band13_scales_and_masks_synthetic():
    import netCDF4 as nc4

    ds = nc4.Dataset("mem.nc", mode="w", memory=100000)
    ds.createDimension("y", 3)
    ds.createDimension("x", 4)
    ds.time_coverage_start = "2026-11-12T19:31:18.2Z"
    for name, vals in (("x", np.arange(4) * 5.6e-5), ("y", -np.arange(3) * 5.6e-5)):
        v = ds.createVariable(name, "f8", (name,))
        v[:] = vals
    cmi = ds.createVariable("CMI", "u2", ("y", "x"), fill_value=65535)
    cmi.set_auto_maskandscale(False)
    cmi.scale_factor = np.float32(0.05)
    cmi.add_offset = np.float32(180.0)
    cmi.valid_range = np.array([0, 4094], dtype="u2")
    raw = np.array([[0, 1000, 2600, 65535], [4094, 2000, 2000, 2000], [1000, 1000, 1000, 1000]], dtype="u2")
    cmi[:] = raw
    dqf = ds.createVariable("DQF", "u1", ("y", "x"))
    dqf.set_auto_maskandscale(False)
    d = np.zeros((3, 4), np.uint8)
    d[2, 3] = 3
    dqf[:] = d
    p = ds.createVariable("goes_imager_projection", "i4", ())
    p.longitude_of_projection_origin = -75.0
    p.perspective_point_height = 35786023.0
    p.semi_major_axis = 6378137.0
    p.semi_minor_axis = 6356752.31414
    p.sweep_angle_axis = "x"
    blob = bytes(ds.close())
    layer, proj, start = gc.decode_band13(blob)
    assert proj == PROJ and start == datetime(2026, 11, 12, 19, 31, 18, 200000, tzinfo=timezone.utc)
    assert layer.values[0, 0] == pytest.approx(180.0) and layer.values[0, 2] == pytest.approx(310.0)
    assert np.isnan(layer.values[0, 3]) and np.isnan(layer.values[2, 3])  # fill value and DQF 3
    assert layer.values[1, 0] == pytest.approx(384.7, abs=0.1) or np.isnan(layer.values[1, 0])


# -- grid, registration, transparency --------------------------------------------------------------

def test_grid_covers_lanes_plus_100_km_synthetic():
    ll = lanes()
    g = emi.make_grid(ll)
    assert g["projection"] == "equirect-local-v1" and g["pxKm"] == 2
    x, y = emi.to_km(g["lat0"], g["lon0"], [p[0] for p in ll], [p[1] for p in ll])
    assert g["xMinKm"] <= x.min() - 100 and g["xMinKm"] + g["width"] * 2 >= x.max() + 100
    assert g["yMaxKm"] >= y.max() + 100 and g["yMaxKm"] - g["height"] * 2 <= y.min() - 100
    lat, lon = emi.from_km(g["lat0"], g["lon0"], x, y)
    assert np.allclose(lat, [p[0] for p in ll]) and np.allclose(lon, [p[1] for p in ll])


def test_ir_registration_and_greyscale_synthetic():
    g = emi.make_grid(lanes())
    im = png(emi.ir_png(synthetic_ir(), PROJ, g))
    assert im.mode == "LA" and im.size == (g["width"], g["height"])
    arr = np.asarray(im)
    lat, lon = emi.pixel_centres(g)
    expected_k = 250.0 + (lon + 75.0) * 10.0
    expected_grey = np.clip((310.0 - expected_k) / 130.0, 0, 1) * 255
    inside = arr[..., 1] == 255
    assert inside.mean() > 0.5
    # nearest neighbour on a 2 km grid moves the sample by under 1.5 km (0.15 K, 0.3 grey level)
    assert np.abs(arr[..., 0].astype(float) - expected_grey)[inside].max() <= 2.0
    # 180 K is white and 310 K is black
    two = synthetic_ir(temp=lambda la, lo: np.where(lo > -75.0, 180.0, 310.0))
    a2 = np.asarray(png(emi.ir_png(two, PROJ, g)))
    assert a2[..., 0][(a2[..., 1] == 255) & (lon > -74.9)].min() == 255
    assert a2[..., 0][(a2[..., 1] == 255) & (lon < -75.1)].max() == 0


def test_missing_and_outside_pixels_are_transparent_synthetic():
    g = emi.make_grid(lanes())
    layer = synthetic_ir(n=120)  # 240 km square: the 100 km padding falls outside it
    layer.values[:, :60] = np.nan  # west half missing
    a = np.asarray(png(emi.ir_png(layer, PROJ, g)))
    lat, lon = emi.pixel_centres(g)
    assert a[0, 0, 1] == 0 and a[-1, -1, 1] == 0
    assert a[..., 1].max() == 255 and set(np.unique(a[..., 1])) == {0, 255}
    assert (a[..., 1][lon < -75.3] == 0).all()
    # off-disk (far side of the Earth) is transparent too
    far = emi.make_grid([[40.0, 105.0], [41.0, 106.0]])
    assert (np.asarray(png(emi.ir_png(synthetic_ir(), PROJ, far)))[..., 1] == 0).all()


def test_phase_palette_distinct_in_greyscale_synthetic():
    ys = [emi.brightness(c) for _, c in emi.PHASE_COLOURS.values()]
    assert min(abs(a - b) for i, a in enumerate(ys) for b in ys[i + 1:]) >= 25
    g = emi.make_grid(lanes())
    scene = synthetic_scene(phase=2, n2=120)
    scene.layers["phase"].values[:, :60] = 4
    scene.layers["phase"].values[:5, :] = 255  # fill value
    im = png(emi.phase_png(scene.layers["phase"], scene.projection, g))
    assert im.mode == "P" and im.size == (g["width"], g["height"])
    rgba = np.asarray(im.convert("RGBA"))
    seen = {tuple(p) for p in rgba.reshape(-1, 4) if p[3] == 255}
    assert (200, 0, 0, 255) in seen and (200, 225, 255, 255) in seen  # supercooled and ice
    assert rgba[0, 0, 3] == 0 and (rgba[..., 3] == 0).any()


# -- map field, budget, attribution ----------------------------------------------------------------

def test_build_map_field_budget_and_attribution_synthetic():
    scene = synthetic_scene(n2=120)
    field, images = emi.build_map(case(), synthetic_ir(), scene.layers["phase"], PROJ, SCAN)
    assert list(field) == ["projection", "lat0", "lon0", "xMinKm", "yMaxKm", "pxKm", "width", "height",
                           "images", "scanUtc", "product", "maxParallaxKm"]
    assert field["images"] == {"ir": "t-synthetic.ir.png", "phase": "t-synthetic.phase.png"}
    assert field["maxParallaxKm"] == 6.9 and field["scanUtc"] == "2026-11-12T19:31:00Z"
    assert set(images) == set(field["images"].values())
    for data in images.values():
        assert png(data).text["Source"] == "NOAA GOES"
    json.dumps(field, allow_nan=False)


def test_size_budget_long_route_synthetic():
    big = lanes(a=(36.0, -83.0), b=(41.0, -66.0), n=60)  # about 1600 km plus padding
    cx = synthetic_ir(n=900, temp=lambda la, lo: 230.0 + 20.0 * np.sin(la / 2.0) * np.cos(lo / 3.0) + (la - 38.0) * 2.0)
    scene = synthetic_scene(n2=120)
    field, images = emi.build_map(case(big), cx, cx_phase(cx), PROJ, SCAN)
    assert field["width"] * field["height"] > 300_000
    assert sum(map(len, images.values())) <= emi.BUDGET_BYTES
    del scene


def cx_phase(ir):
    return gc.Layer("phase", "ABI-L2-ACTPC", "Phase", 2.0, "1", ir.x, ir.y,
                    np.where(ir.values < 240, 4, 1).astype(np.uint8), ir.dqf)


def test_budget_refusal_synthetic(monkeypatch):
    monkeypatch.setattr(emi, "BUDGET_BYTES", 100)
    with pytest.raises(emi.MapExportError, match="budget"):
        emi.build_map(case(), synthetic_ir(), cx_phase(synthetic_ir()), PROJ, SCAN)


def test_parallax_needs_a_finite_value_synthetic():
    assert emi.max_parallax_km({"parallaxKm": [None, 1.26, 3.04, float("nan")]}) == 3.0
    with pytest.raises(emi.MapExportError):
        emi.max_parallax_km({"parallaxKm": [None, None]})


# -- writing --------------------------------------------------------------------------------------

def written_case(tmp_path):
    from src.analysis.case_builder import dumps_strict

    c = case()
    c["notes"] = "unchanged"
    p = tmp_path / "20261112-t-synthetic.json"
    p.write_text(dumps_strict(c) + "\n", encoding="utf-8")
    return p, c


def test_write_changes_only_map_synthetic(tmp_path):
    p, original = written_case(tmp_path)
    field, images = emi.build_map(original, synthetic_ir(), cx_phase(synthetic_ir()), PROJ, SCAN)
    emi.write_case_map(p, field, images)
    after = json.loads(p.read_text(encoding="utf-8"))
    assert after.pop("map") == field and after == original
    assert {f.name for f in tmp_path.iterdir()} == {p.name, "t-synthetic.ir.png", "t-synthetic.phase.png"}
    emi.write_case_map(p, field, images)  # a second run replaces the map and keeps the rest
    again = json.loads(p.read_text(encoding="utf-8"))
    assert again.pop("map") == field and again == original


def test_write_refuses_when_other_field_changes_synthetic(tmp_path, monkeypatch):
    p, original = written_case(tmp_path)
    field, images = emi.build_map(original, synthetic_ir(), cx_phase(synthetic_ir()), PROJ, SCAN)
    before = p.read_bytes()
    real = emi.dumps_strict
    monkeypatch.setattr(emi, "dumps_strict", lambda d: real({**d, "notes": "changed"}))
    with pytest.raises(emi.MapExportError, match="other than 'map'"):
        emi.write_case_map(p, field, images)
    assert p.read_bytes() == before and len(list(tmp_path.iterdir())) == 1


def test_write_never_lets_nan_reach_json_synthetic(tmp_path):
    p, original = written_case(tmp_path)
    field, images = emi.build_map(original, synthetic_ir(), cx_phase(synthetic_ir()), PROJ, SCAN)
    before = p.read_bytes()
    with pytest.raises(ValueError):
        emi.write_case_map(p, {**field, "maxParallaxKm": float("nan")}, images)
    assert p.read_bytes() == before and len(list(tmp_path.iterdir())) == 1
