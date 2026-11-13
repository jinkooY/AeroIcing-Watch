"""Report the Cloud Dive balance per case and try parameter values (the only way to change them).

    python tools/tune_params.py [--cases static/cloud-dive/cases] [--set antiIceFactor=1.1 ...] [--json]

For every case file it prints Best, Best without anti-ice, Best with anti-ice always on,
Straight-ahead and the Wasteful extreme (all game references, illustrative dollars), then the
balance criteria B1 to B3 per case and B4 over all cases (requirement R4.8).

Allowed levers: parameters (`--set`), and, in the exporter manifest, the altitude block and the
corridor width. Weather data are never edited. Record every accepted change in
docs/kiro-usage-log.md.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.analysis.case_io import case_from_dict  # noqa: E402
from src.analysis.cost_model import DEFAULTS, Params  # noqa: E402
from src.analysis.solver import balance, solve_references  # noqa: E402

KEYS = {
    "antiIceFactor": "anti_ice_factor", "speedLossAtFull": "speed_loss_at_full",
    "dragFlowAtFull": "drag_flow_at_full", "iceExponent": "ice_exponent", "diversionUsd": "diversion_usd",
    "baseGain": "base_gain", "possibleRateFactor": "possible_rate_factor", "fuelUsdPerKg": "fuel_usd_per_kg",
    "minGroundSpeedKt": "min_ground_speed_kt",
}
B4_MIN_KM = 20.0
B4_MIN_CASES = 2


def parse_overrides(items) -> dict:
    out = {}
    for item in items or []:
        key, _, value = item.partition("=")
        if key not in KEYS or not value:
            raise SystemExit(f"--set expects one of {sorted(KEYS)} as key=value, got {item!r}")
        out[KEYS[key]] = float(value)
    return out


def evaluate(case_dict: dict, overrides: dict) -> dict:
    params = Params.from_dict(case_dict["params"]).replace(**overrides) if overrides else None
    case = case_from_dict(case_dict, params=params)
    refs = solve_references(case)
    flags = balance(refs)
    return {"id": case_dict["id"], "refs": refs, "balance": flags, "case": case}


def b4(results) -> bool:
    return sum(1 for r in results if r["balance"]["antiIceKmInBest"] >= B4_MIN_KM) >= B4_MIN_CASES


def fmt(ref) -> str:
    return f"${ref.cost_usd:8.0f}" if ref.cost_usd is not None else "  no finish"


def report(results) -> str:
    lines = ["case                          best  noAntiIce  alwaysAI  straight  wasteful  saving%  B1 B2 B3  AI km"]
    for r in results:
        refs, flags = r["refs"], r["balance"]
        saving = 100.0 * (1 - refs["best"].cost_usd / refs["straight_ahead"].cost_usd) if refs["best"].cost_usd else float("nan")
        lines.append(
            f"{r['id'][:28]:28} {fmt(refs['best'])} {fmt(refs['best_no_anti_ice'])} {fmt(refs['best_always_anti_ice'])} "
            f"{fmt(refs['straight_ahead'])} {fmt(refs['wasteful'])} {saving:7.1f}  "
            f"{'ok' if flags['B1'] else '--'} {'ok' if flags['B2'] else '--'} {'ok' if flags['B3'] else '--'}  "
            f"{flags['antiIceKmInBest']:6.0f}"
        )
    lines.append(f"B4 (anti-ice >= {B4_MIN_KM:.0f} km in Best on >= {B4_MIN_CASES} cases): {'ok' if b4(results) else 'FAIL'}")
    return "\n".join(lines)


def all_pass(results) -> bool:
    return b4(results) and all(all(r["balance"][k] for k in ("B1", "B2", "B3")) for r in results)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cases", type=Path, default=ROOT / "static" / "cloud-dive" / "cases")
    ap.add_argument("--set", action="append", metavar="KEY=VALUE", help=f"parameter override; keys: {', '.join(KEYS)}")
    ap.add_argument("--json", action="store_true", help="print machine-readable results")
    args = ap.parse_args()
    overrides = parse_overrides(args.set)
    files = sorted(p for p in args.cases.glob("*.json") if p.name != "index.json")
    if not files:
        print(f"no case files in {args.cases}")
        return 2
    results = [evaluate(json.loads(p.read_text(encoding="utf-8")), overrides) for p in files]
    if args.json:
        print(json.dumps([{"id": r["id"], "balance": r["balance"],
                           "refs": {k: v.to_dict() for k, v in r["refs"].items()}} for r in results], indent=1))
    else:
        print(report(results))
        print("defaults:", {k: v for k, v in DEFAULTS.items()}, "overrides:", overrides or "none")
    return 0 if all_pass(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
