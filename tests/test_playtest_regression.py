"""R21 regression on the three committed real cases (task 13.1): gate counts and the ice gate.

**Validates: Requirements 21.3, 21.4, 21.5**
"""
import json
from pathlib import Path

import pytest

from src.analysis import game_core as gc
from src.analysis.case_io import case_from_dict

CASES = Path(__file__).resolve().parent.parent / "static" / "cloud-dive" / "cases"
NAMES = ["20261101-kden-klax-2100z", "20261107-kbuf-kpwm-1900z", "20261112-kjfk-kbna-1930z"]


def fly(name, anti_ice):
    """Fly with fixed targets; return (final state, gate reasons of every stop while flying)."""
    case = case_from_dict(json.loads((CASES / f"{name}.json").read_text(encoding="utf-8")))
    state, stops, first = gc.initial_state(case, anti_ice=anti_ice), [], True
    while state.status == "flying":
        state, reasons = gc.run_until_gate(case, state, check_start=first)
        first = False
        if reasons and state.status == "flying":
            stops.append(reasons)
        assert len(stops) < 200
    return case, state, stops


@pytest.mark.parametrize("name", NAMES)
def test_diversion_cost_is_non_zero_real_case(name):
    data = json.loads((CASES / f"{name}.json").read_text(encoding="utf-8"))
    assert data["params"]["diversionUsd"] == 5000.0


@pytest.mark.parametrize("name,expected", [(NAMES[0], 8), (NAMES[1], 2), (NAMES[2], 10)])
def test_always_on_gate_counts_real_case(name, expected):
    _, state, stops = fly(name, True)
    assert state.status == "arrived" and len(stops) == expected
    assert all("ice" not in r for r in stops)
    if name == NAMES[2]:
        assert len(stops) < 17  # the playtest build showed 17


@pytest.mark.parametrize("name", NAMES)
def test_straight_flight_has_exactly_one_ice_gate_real_case(name):
    _, state, stops = fly(name, False)
    assert sum("ice" in r for r in stops) == 1 and state.ice_gate_done
