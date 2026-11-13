"""Case file round trip, tuning report and cost tables on SYNTHETIC cases (OpenAP test is skipped without it)."""
import json
import math

import numpy as np
import pytest

from src.analysis import cost_model
from src.analysis.case_io import case_from_dict, game_block
from src.analysis.cost_model import Params
from src.analysis.solver import solve_references
from tests.game_synthetic import ALTS, synthetic_case, synthetic_params
from tools import tune_params


def synthetic_file(seed=4, **kw):
    case = synthetic_case(seed, n_steps=20, cloud=0.8, **kw)
    temp = np.full(case.evidence.shape, -8.0)
    temp[0, 0, 0] = np.nan
    lwp = np.full(case.evidence.shape[:2], 40.0)
    lwp[1, 1] = np.nan
    block = game_block(case, temp, lwp)
    block["id"] = f"synthetic-{seed}"
    return case, block


def test_case_round_trip_through_json_synthetic():
    case, block = synthetic_file()
    back = case_from_dict(json.loads(json.dumps(block)))
    assert np.array_equal(back.evidence, case.evidence)
    assert np.array_equal(back.ice_gain, case.ice_gain)
    assert np.array_equal(back.headwind_kt, np.rint(case.headwind_kt))
    assert back.params == case.params and back.start_alt == case.start_alt and back.n_steps == case.n_steps


def test_case_json_has_no_nan_or_infinity_synthetic():
    _, block = synthetic_file()
    text = json.dumps(block, allow_nan=False)
    assert "NaN" not in text and "Infinity" not in text


def test_recomputed_gain_with_other_parameters_synthetic():
    _, block = synthetic_file()
    stronger = case_from_dict(block, params=Params.from_dict(block["params"]).replace(base_gain=14.0))
    weaker = case_from_dict(block, params=Params.from_dict(block["params"]).replace(base_gain=3.0))
    assert stronger.ice_gain.sum() > weaker.ice_gain.sum()


def test_tune_report_and_overrides_synthetic():
    _, block = synthetic_file(5)
    base = tune_params.evaluate(block, {})
    assert base["refs"]["best"].completed
    text = tune_params.report([base])
    assert "synthetic-5" in text and "B4" in text
    over = tune_params.evaluate(block, tune_params.parse_overrides(["antiIceFactor=1.5"]))
    assert over["refs"]["best_always_anti_ice"].cost_usd > base["refs"]["best_always_anti_ice"].cost_usd


def test_parse_overrides_rejects_unknown_keys():
    with pytest.raises(SystemExit):
        tune_params.parse_overrides(["nonsense=1"])


def test_b4_counts_cases_with_enough_anti_ice_km_synthetic():
    mk = lambda km: {"balance": {"antiIceKmInBest": km}}  # noqa: E731
    assert tune_params.b4([mk(25.0), mk(30.0), mk(0.0)]) is True
    assert tune_params.b4([mk(25.0), mk(5.0), mk(0.0)]) is False


# -- cost model -----------------------------------------------------------------------------------

def test_params_dict_round_trip():
    p = synthetic_params()
    assert Params.from_dict(json.loads(json.dumps(p.to_dict()))) == p


def test_speed_schedule_values():
    tas, mach = cost_model.cas_to_tas_kt(250.0, 0.0)
    assert tas == pytest.approx(250.0, abs=0.5) and mach == pytest.approx(0.378, abs=0.003)
    assert cost_model.tas_schedule_kt(24000) > cost_model.tas_schedule_kt(12000) > cost_model.tas_schedule_kt(6000)
    assert cost_model.cas_to_tas_kt(280.0, 30000)[1] > 0.7
    assert cost_model.tas_schedule_kt(30000) / (38.9678 * math.sqrt(cost_model.isa_temperature_k(30000))) == pytest.approx(0.74)


def test_openap_tables_for_the_e175():
    pytest.importorskip("openap")
    alts = list(range(6000, 25000, 3000))
    t = cost_model.build_tables(alts)
    per_km = {a: t["flow"][a] / (t["tas"][a] * 1.852) for a in alts}
    assert 3.0 < per_km[6000] < 3.7  # about 3.3 kg/km at 6,000 ft
    assert per_km[24000] < per_km[6000]  # higher is cheaper per kilometre
    assert all(5.0 < t["climb"][a] < 30.0 for a in alts)
    assert 1500 < t["climbRateFtMin"] < 2100  # WRAP climb rate 8.9 m/s converted to ft/min
