"""IFS cube tests on a SYNTHETIC in-memory bundle (no network, no real forecast)."""
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

from src.analysis.evidence import forecast_criterion
from src.analysis.ifs_cube import build_cube, headwind_kt, isa_pressure_hpa, sample_cell
from src.analysis.lanes import build_lanes
from src.integration.ifs_grid import FIELDS

T0 = datetime(2026, 11, 12, 18, tzinfo=timezone.utc)
T1 = T0 + timedelta(hours=3)
LEVELS = [925, 850, 700, 600, 500, 400, 300, 250]
GH_M = {925: 760, 850: 1457, 700: 3012, 600: 4206, 500: 5574, 400: 7185, 300: 9164, 250: 10363}


def synthetic_bundle(t_k=(270.0, 270.0), rh=90.0, u=0.0, v=0.0, lapse_profile=False):
    lat = np.arange(36.0, 43.0, 1.0)
    lon = np.arange(-80.0, -70.0, 1.0)
    levels_asc = LEVELS[::-1]
    data = np.zeros((2, len(levels_asc), len(lat), len(lon), len(FIELDS)))
    for ti in range(2):
        for li, p in enumerate(levels_asc):
            gh = GH_M[p]
            temp = 288.15 - 0.0065 * gh if lapse_profile else t_k[ti]
            data[ti, li, :, :, FIELDS.index("gh")] = gh
            data[ti, li, :, :, FIELDS.index("t")] = temp
            data[ti, li, :, :, FIELDS.index("r")] = rh
            data[ti, li, :, :, FIELDS.index("u")] = u
            data[ti, li, :, :, FIELDS.index("v")] = v
    meta = {"pressure_levels_hpa": LEVELS}
    axes = (np.array([T0.timestamp(), T1.timestamp()]), np.log(np.array(levels_asc, float)), lat, lon)
    return meta, axes, data


LANES = build_lanes(38.0, -77.0, 41.0, -73.0, step_km=50.0)
MID = T0 + timedelta(minutes=90)


@pytest.mark.parametrize("alt_ft,hpa,tol", [(0, 1013.25, 0.01), (18000, 506.0, 1.0), (36089, 226.3, 0.5), (40000, 187.5, 1.0)])
def test_isa_pressure_matches_standard_atmosphere_table(alt_ft, hpa, tol):
    assert isa_pressure_hpa(alt_ft) == pytest.approx(hpa, abs=tol)


def test_isa_pressure_decreases_with_altitude():
    values = [isa_pressure_hpa(a) for a in range(0, 45000, 1000)]
    assert all(a > b for a, b in zip(values, values[1:]))


def test_headwind_sign_known_winds():
    assert headwind_kt(0.0, -10.0, 0.0) == pytest.approx(19.4, abs=0.1)   # flying north into a north wind
    assert headwind_kt(10.0, 0.0, 90.0) == pytest.approx(-19.4, abs=0.1)  # flying east with a west wind
    assert headwind_kt(10.0, 0.0, 0.0) == pytest.approx(0.0, abs=0.05)    # crosswind
    assert headwind_kt(None, 1.0, 0.0) is None and headwind_kt(1.0, None, 0.0) is None


def test_cell_values_synthetic():
    status, cell = sample_cell(synthetic_bundle(rh=92.0), 39.0, -76.0, 12000, 45.0, T0)
    assert status == "ready"
    assert cell["forecast"] == {"temp_c": pytest.approx(-3.15, abs=0.01), "rh_pct": 92.0}
    assert forecast_criterion(cell["forecast"]["temp_c"], cell["forecast"]["rh_pct"]) is not None


def test_time_interpolation_is_linear_synthetic():
    _, cell = sample_cell(synthetic_bundle(t_k=(270.0, 280.0)), 39.0, -76.0, 12000, 0.0, MID)
    assert cell["forecast"]["temp_c"] == pytest.approx(275.0 - 273.15, abs=0.01)


def test_outside_time_level_and_domain_return_none_with_reason_synthetic():
    b = synthetic_bundle()
    assert sample_cell(b, 39.0, -76.0, 12000, 0.0, T1 + timedelta(hours=1)) == ("outside_time", None)
    assert sample_cell(b, 39.0, -76.0, 60000, 0.0, T0)[0] == "outside_level"
    assert sample_cell(b, 60.0, -76.0, 12000, 0.0, T0)[0] == "outside_domain"


def test_cube_shape_and_wind_synthetic():
    alts = [6000, 12000, 18000]
    cube = build_cube(synthetic_bundle(v=-10.0), LANES, alts, MID)
    assert len(cube.forecast) == 5 and len(cube.forecast[0]) == LANES.n_steps + 1
    assert len(cube.forecast[0][0]) == 3 and cube.n_unavailable() == 0
    k = 3
    expected = headwind_kt(0.0, -10.0, float(LANES.azimuth_deg[k]))
    assert cube.headwind_kt[2][k][1] == pytest.approx(expected)
    assert cube.alts_ft == (6000, 12000, 18000)


def test_cube_isotherm_heights_from_temperature_profile_synthetic():
    cube = build_cube(synthetic_bundle(lapse_profile=True), LANES, [10000], MID)
    iso = cube.isotherms[2][2]
    assert iso["zero_c_ft"] == pytest.approx(15 / 0.0065 * 3.28084, abs=150)
    assert iso["minus20_c_ft"] == pytest.approx(35 / 0.0065 * 3.28084, abs=150)


def test_cube_missing_values_stay_none_and_are_counted_synthetic():
    meta, axes, data = synthetic_bundle()
    data[:, :, :, :, FIELDS.index("t")] = np.nan
    cube = build_cube((meta, axes, data), LANES, [12000], MID)
    assert all(row[0] is None for lane in cube.forecast for row in lane)
    assert cube.reasons["missing_value"] == 5 * (LANES.n_steps + 1)
    assert all(iso["method"] == "unavailable" for lane in cube.isotherms for iso in lane)


def test_cube_outside_domain_cells_are_none_synthetic():
    far = build_lanes(48.0, -77.0, 49.0, -73.0, step_km=50.0)
    cube = build_cube(synthetic_bundle(), far, [12000], MID)
    assert all(row[0] is None for lane in cube.forecast for row in lane)
    assert cube.reasons["outside_domain"] == 5 * (far.n_steps + 1)


def test_cube_requires_timezone_aware_time():
    with pytest.raises(ValueError):
        build_cube(synthetic_bundle(), LANES, [12000], datetime(2026, 11, 12, 19))


def test_cube_is_deterministic_synthetic():
    a = build_cube(synthetic_bundle(u=3.0, v=4.0), LANES, [9000, 15000], MID)
    b = build_cube(synthetic_bundle(u=3.0, v=4.0), LANES, [9000, 15000], MID)
    assert (a.forecast, a.headwind_kt, a.isotherms) == (b.forecast, b.headwind_kt, b.isotherms)
