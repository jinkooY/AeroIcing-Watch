"""Exporter tests: simulated build in tmp_path, output checks, and the committed real cases."""
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pytest

from src.analysis import case_builder as cb
from src.analysis.case_io import case_from_dict
from src.analysis.evidence import LEVELS
from src.analysis.solver import Reference, solve_references
from tools import check_viewer_contract as contract
from tools import export_cloud_dive as export
from tools import tune_params

ROOT = Path(__file__).resolve().parents[1]
CASES = ROOT / "static" / "cloud-dive" / "cases"
MANIFESTS = ROOT / "tools" / "cloud_dive_cases"
AIRPORTS = json.loads((ROOT / "airports.json").read_text(encoding="utf-8"))

MANIFEST = {
    "id": "t-kbuf-kpwm", "title": "Test route", "from": "KBUF", "to": "KPWM", "satellite": "G19",
    "observedUtc": "2026-11-07T19:00:00Z", "forecastRun": "2026110700",
    "altitudes": {"minFt": 6000, "maxFt": 12000, "startFt": 9000},
}


def sim_manifest(**over):
    return cb.load_manifest({**MANIFEST, "satellite": "simulated", "forecastRun": None, **over})


def committed():
    return sorted(p for p in CASES.glob("2026*.json"))


# -- manifest -------------------------------------------------------------------------------------

def test_manifest_validation():
    m = cb.load_manifest(MANIFEST)
    assert m.alts_ft == (6000, 7000, 8000, 9000, 10000, 11000, 12000) and m.start_lane == 2
    assert m.forecast_run == datetime(2026, 11, 7, 0, tzinfo=timezone.utc) and m.observed_utc.tzinfo is not None
    with pytest.raises(ValueError):
        cb.load_manifest({**MANIFEST, "altitudes": {"minFt": 6000, "maxFt": 12000, "startFt": 9500}})
    with pytest.raises(ValueError):
        cb.load_manifest({**MANIFEST, "lanesKm": [-30, -15, 15, 30]})


def test_every_committed_manifest_loads_and_names_known_airports():
    files = sorted(MANIFESTS.glob("*.json"))
    assert len(files) == 3
    for p in files:
        m = cb.load_manifest(json.loads(p.read_text(encoding="utf-8")))
        assert m.origin in AIRPORTS and m.destination in AIRPORTS and p.stem == m.id
        assert m.observed_utc.hour in (19, 21)


def test_override_keys_are_checked():
    from src.analysis.cost_model import Params
    from tests.game_synthetic import synthetic_params

    p = synthetic_params()
    assert export.apply_overrides(p, {"baseGain": 9}).base_gain == 9.0
    with pytest.raises(ValueError):
        export.apply_overrides(p, {"nonsense": 1})
    with pytest.raises(ValueError):
        export.apply_overrides(p, {"aircraft": 1})
    assert isinstance(export.apply_overrides(p, {}), Params)


# -- output checks --------------------------------------------------------------------------------

@pytest.mark.parametrize("text", [
    "C:\\Users\\someone\\x", "path C:/data/x", "/Users/name/file", "/home/name/file", "KMA_API_KEY=abc",
    "api_key: 123", "Bearer abcdef", "-----BEGIN PRIVATE KEY", "AKIAABCDEFGHIJKLMNOP", "see .env file",
])
def test_leak_findings_flag_paths_and_secrets_synthetic(text):
    assert cb.leak_findings(text)


@pytest.mark.parametrize("text", [
    "https://noaa-goes19.s3.amazonaws.com/ABI-L2-ACTPC", "OR_ABI-L2-ACTPC-M6_G19_s20263161931173_e1_c1.nc",
    "ECMWF Open Data, CC BY 4.0", "Best, Straight-ahead and Wasteful extreme",
])
def test_leak_findings_leave_normal_text_alone_synthetic(text):
    assert cb.leak_findings(text) == []


def test_dumps_strict_rejects_nan_infinity_and_leaks_synthetic():
    for bad in (float("nan"), float("inf")):
        with pytest.raises(ValueError):
            cb.dumps_strict({"x": bad})
    with pytest.raises(ValueError, match="leak"):
        cb.dumps_strict({"x": "C:\\Users\\a"})
    assert json.loads(cb.dumps_strict({"x": 1.5})) == {"x": 1.5}


def test_refusal_reasons_synthetic():
    ok = Reference("best", True, 100.0)
    refs = {"best": ok}
    assert cb.refusal_reasons({"B1": True, "B2": True, "B3": True, "B5": True}, refs) == []
    assert cb.refusal_reasons({"B1": False, "B2": True, "B3": False, "B5": False}, refs) == ["B1 failed", "B3 failed", "B5 failed"]
    assert "Best does not complete" in cb.refusal_reasons({"B1": True, "B2": True, "B3": True, "B5": True}, {"best": Reference("best", False, None)})


# -- simulated end to end -------------------------------------------------------------------------

@pytest.fixture(scope="module")
def simulated_case():
    m = sim_manifest(id="simulated-test")
    case_file, refs, flags = export.build_one(m, AIRPORTS, ROOT / "data" / "ifs")
    return m, case_file, refs, flags


def test_simulated_case_is_labelled_and_valid_synthetic(simulated_case):
    m, case_file, refs, flags = simulated_case
    assert case_file["dataKind"] == "simulated" and case_file["title"].startswith("Simulated")
    assert "Simulated" in case_file["sources"]["satellite"]["name"]
    assert case_file["viewerProfile"]["dataKind"] == "simulated"
    assert contract.valid_profile(case_file["viewerProfile"])
    text = cb.dumps_strict(case_file)
    assert "NaN" not in text and cb.leak_findings(text) == []


def test_simulated_case_round_trips_and_resolves_to_the_same_references_synthetic(simulated_case):
    _, case_file, refs, _ = simulated_case
    case = case_from_dict(json.loads(cb.dumps_strict(case_file)))
    again = solve_references(case)
    for name in refs:
        assert again[name].cost_usd == pytest.approx(refs[name].cost_usd, rel=1e-9)


def test_simulated_case_arrays_are_consistent_synthetic(simulated_case):
    _, case_file, _, _ = simulated_case
    L, S, A = case_file["evidence"]["shape"]
    assert (L, S) == (5, case_file["lanesLatLon"]["shape"][1]) and A == 7
    for key in ("evidence", "headwindKt", "temperatureC", "iceGain"):
        assert len(case_file[key]["data"]) == L * S * A
    assert set(case_file["evidence"]["data"]) <= {0, 1, 2, 3}
    assert len(case_file["satellite"]["state"]) == L * S
    assert case_file["rule"]["name"] == "cloud-dive-evidence-v2" and case_file["rule"]["levels"] == list(LEVELS)


def test_viewer_profile_distances_start_at_zero_and_end_at_the_route_length_synthetic(simulated_case):
    _, case_file, _, _ = simulated_case
    s = case_file["viewerProfile"]["samples"]
    assert s[0]["distanceKm"] == 0 and s[-1]["distanceKm"] == pytest.approx(case_file["route"]["lengthKm"], abs=0.06)
    assert all(a["distanceKm"] < b["distanceKm"] for a, b in zip(s, s[1:]))


def test_index_lists_written_cases_synthetic(tmp_path, simulated_case):
    _, case_file, _, _ = simulated_case
    (tmp_path / "a.json").write_text(cb.dumps_strict(case_file), encoding="utf-8")
    export.write_index(tmp_path)
    idx = json.loads((tmp_path / "index.json").read_text(encoding="utf-8"))
    assert [c["id"] for c in idx["cases"]] == ["simulated-test"] and idx["cases"][0]["file"] == "a.json"


# -- committed real cases ------------------------------------------------------------------------

def test_three_real_cases_are_committed():
    names = {p.stem for p in committed()}
    assert names == {"20261112-kjfk-kbna-1930z", "20261101-kden-klax-2100z", "20261107-kbuf-kpwm-1900z"}
    idx = json.loads((CASES / "index.json").read_text(encoding="utf-8"))
    assert {c["id"] for c in idx["cases"]} == names


@pytest.mark.parametrize("path", committed(), ids=lambda p: p.stem)
def test_committed_case_is_clean_attributed_and_valid(path):
    text = path.read_text(encoding="utf-8")
    assert cb.leak_findings(text) == [] and "NaN" not in text and "Infinity" not in text
    d = json.loads(text)
    assert d["dataKind"] == "observation" and d["schemaVersion"] == 2
    attribution = " ".join(d["sources"]["attribution"])
    assert "NOAA" in attribution and "ECMWF" in attribution and "OpenAP" in attribution and "Noh" in attribution
    assert d["sources"]["satellite"]["scanStartUtc"].endswith("Z") and d["sources"]["forecast"]["runUtc"]
    assert contract.valid_profile(d["viewerProfile"]) and d["viewerProfile"]["observedAt"].endswith("Z")
    assert d["balance"]["B1"] and d["balance"]["B2"] and d["balance"]["B3"] and d["balance"]["B5"]
    assert d["params"]["aircraft"] == "E75L" and d["params"]["massKg"] == 30340
    assert path.stat().st_size < 300 * 1024
    assert d["labels"]["gameModel"].startswith("Game model")


@pytest.mark.parametrize("path", committed(), ids=lambda p: p.stem)
def test_committed_case_references_reproduce_exactly(path):
    d = json.loads(path.read_text(encoding="utf-8"))
    refs = solve_references(case_from_dict(d))
    for name, stored in d["references"].items():
        assert refs[name].cost_usd == pytest.approx(stored["costUsd"], rel=1e-9), name


def test_b4_holds_across_the_committed_cases():
    results = [{"balance": json.loads(p.read_text(encoding="utf-8"))["balance"]} for p in committed()]
    assert tune_params.b4(results)


def test_committed_evidence_never_turns_not_assessed_into_not_indicated():
    for p in committed():
        d = json.loads(p.read_text(encoding="utf-8"))
        reasons = d["evidenceReasons"]
        assert "cloud_base_unknown" in reasons or sum(reasons.values()) > 0
        assert d["evidence"]["data"].count(0) == reasons.get("cloud_base_unknown", 0) + sum(
            v for k, v in reasons.items() if k not in (
                "cloud_base_unknown", "above_cloud_top", "forecast_criterion_met", "forecast_criterion_not_met",
                "inside_candidate_layer", "no_supercooled_signal_forecast_dry", "satellite_clear", "no_supercooled_signal"))
