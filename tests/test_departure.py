"""Task 17.1: departure climb constant, airport elevations, exporter guard, property CD-P29.

Property tests use SYNTHETIC cases; the file checks read the three real case files.
"""
import json
import math
from pathlib import Path

import pytest
from hypothesis import given, settings, strategies as st

from src.analysis.case_builder import dumps_strict
from src.analysis.departure import (
    departure_climb_kg, departure_climb_usd, departure_usd, references_with_departure, saving_share_percent,
    with_departure,
)
from src.analysis.game_core import initial_state, set_targets, step
from src.analysis.solver import balance, solve_references
from tests.game_synthetic import synthetic_case
from tools.export_departure import DepartureExportError, rewrite_case_text

ROOT = Path(__file__).resolve().parents[1]
CASES = sorted((ROOT / "static" / "cloud-dive" / "cases").glob("2026*.json"))
AIRPORTS = json.loads((ROOT / "airports.json").read_text(encoding="utf-8"))
PROP = settings(max_examples=60, deadline=None)

action = st.tuples(st.integers(-1, 5), st.integers(-1, 8), st.booleans())
constants = st.floats(0.0, 500.0, allow_nan=False)


# -- formula ----------------------------------------------------------------------------------------

def test_departure_climb_kg_bands_and_first_entry_below_block_synthetic():
    table = {"10000": 10.0, "11000": 8.0, "12000": 6.0}
    # 8,500 ft to 12,000 ft: bands end at 9,500 (first entry 10), 10,500 (11,000 level: 8), 11,500 (12,000: 6),
    # then 12,000 (12,000: 6) in proportion 0.5.
    assert departure_climb_kg(table, 8500, 12000) == pytest.approx(10 + 8 + 6 + 6 * 0.5)
    assert departure_climb_kg(table, 12000, 12000) == 0.0
    assert departure_climb_kg(table, 13000, 12000) == 0.0
    assert departure_climb_usd(table, 8500, 12000, 0.5) == 13.5  # 27 kg x 0.5 USD/kg


def test_departure_usd_reads_params_and_defaults_to_zero():
    assert departure_usd({"departureClimbUsd": 12.5}) == 12.5
    assert departure_usd({}) == 0.0
    assert departure_usd(None) == 0.0
    assert departure_usd({"departureClimbUsd": float("nan")}) == 0.0


# -- CD-P29 -----------------------------------------------------------------------------------------

@PROP
@given(seed=st.integers(0, 10_000), acts=st.lists(action, min_size=1, max_size=30), constant=constants)
def test_cd_p29_constant_is_added_once_and_the_engine_is_unchanged(seed, acts, constant):
    """**Validates: Requirements 15.5**"""
    case = synthetic_case(seed, n_steps=24, cloud=0.6, last_km=7.0)
    base = initial_state(case)
    other = initial_state(case)
    components = []
    for lane, alt, ai in acts:
        if base.status != "flying":
            break
        base = step(case, set_targets(case, base, lane, alt, ai))
        other = step(case, set_targets(case, other, lane, alt, ai))
        engine_total = base.total_usd(case)
        shown = with_departure(engine_total, constant)
        assert shown == pytest.approx(engine_total + constant)
        components.append(constant)
        assert other.cost == base.cost and other.ice == base.ice  # engine state does not depend on the constant
        if base.status == "diverted":
            up_to = sum(base.cost)
            assert shown == pytest.approx(up_to + case.params.diversion_usd + constant)
    assert len(set(components)) <= 1  # the departure component is the same number whatever was flown


@PROP
@given(seed=st.integers(0, 3_000), constant=constants)
def test_cd_p29_balance_and_saving_share_are_unchanged_by_the_constant(seed, constant):
    """**Validates: Requirements 15.5**"""
    case = synthetic_case(seed, n_steps=16, cloud=0.6, last_km=7.0)
    refs = solve_references(case)
    flags = balance(refs, case.params)
    assert flags == balance(solve_references(case), case.params)  # B1 to B5 read engine totals only
    shown = references_with_departure({k: v.to_dict() for k, v in refs.items()}, constant)
    best, straight, wasteful = (refs["best"].cost_usd, refs["straight_ahead"].cost_usd, refs["wasteful"].cost_usd)
    if None in (best, straight, wasteful):
        return
    assert shown["best"] == pytest.approx(best + constant)
    player = (best + straight) / 2
    a = saving_share_percent(player, best, straight)
    b = saving_share_percent(player + constant, shown["best"], shown["straight_ahead"])
    assert (a is None and b is None) or a == pytest.approx(b, abs=1e-6)


# -- case files -------------------------------------------------------------------------------------

@pytest.mark.parametrize("path", CASES, ids=lambda p: p.name)
def test_case_files_carry_the_constant_note_and_elevations(path):
    data = json.loads(path.read_text(encoding="utf-8"))
    p = data["params"]
    assert isinstance(p["departureClimbUsd"], float) and 0 < p["departureClimbUsd"] < 500
    assert "Illustrative" in p["departureClimbNote"] and "OpenAP" in p["departureClimbNote"]
    for end in ("from", "to"):
        icao = data["route"][end]
        assert data["airports"][end] == {"icao": icao, "elevFt": AIRPORTS[icao]["elev_ft"]}
    recomputed = departure_climb_usd(p["climbExtraKgPer1000Ft"], data["airports"]["from"]["elevFt"],
                                     data["start"]["altFt"], p["fuelUsdPerKg"])
    assert recomputed == p["departureClimbUsd"]
    assert path.read_bytes().decode("utf-8") == dumps_strict(data) + "\r\n"


@pytest.mark.parametrize("path", CASES, ids=lambda p: p.name)
def test_exporter_is_idempotent_and_changes_only_params_departure_and_airports(path):
    text = path.read_bytes().decode("utf-8")
    assert rewrite_case_text(text, AIRPORTS) == text
    old = json.loads(text)
    stripped = json.loads(text)
    for k in ("departureClimbUsd", "departureClimbNote"):
        del stripped["params"][k]
    del stripped["airports"]
    text2 = dumps_strict(stripped) + "\r\n"
    again = json.loads(rewrite_case_text(text2, AIRPORTS))
    assert again == old
    for key in ("evidence", "references", "balance", "viewerProfile"):
        assert dumps_strict(again[key]) == dumps_strict(old[key])


def test_exporter_refuses_a_file_outside_its_format_and_a_missing_elevation_synthetic():
    path = CASES[0]
    text = path.read_bytes().decode("utf-8")
    with pytest.raises(DepartureExportError):
        rewrite_case_text(text.replace('"schemaVersion":2', '"schemaVersion": 2', 1), AIRPORTS)
    with pytest.raises(DepartureExportError):
        rewrite_case_text(text, {})


def test_balance_in_case_files_matches_engine_totals():
    """B1 to B5 stored in the files still hold for the engine references (no constant in them)."""
    for path in CASES:
        data = json.loads(path.read_text(encoding="utf-8"))
        assert all(data["balance"][k] for k in ("B1", "B2", "B3", "B5"))
        assert math.isfinite(data["references"]["best"]["costUsd"])
