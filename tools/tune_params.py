"""Report the Cloud Dive balance per case and try parameter values (the only way to change them).

    python tools/tune_params.py [--cases static/cloud-dive/cases] [--set antiIceFactor=1.1 ...] [--json] [--write]

For every case file it prints Best, Best without anti-ice, Best with anti-ice always on,
Straight-ahead and the Wasteful extreme (all game references, illustrative dollars), then the
balance criteria B1 to B3 and B5 (diversion cost above Straight-ahead) per case and B4 over all
cases (requirement R4.8).

`--write` stores the overridden parameters and the new balance flags in the case files (only the
`params` and `balance` values, text-patched so the file format is unchanged). It refuses to write when
the change would alter the stored ice gain or the stored references (re-run the exporter then), and it
never touches satellite, forecast, evidence or other weather arrays.

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
CAMEL = {v: k for k, v in KEYS.items()}


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
    flags = balance(refs, case.params)
    return {"id": case_dict["id"], "refs": refs, "balance": flags, "case": case}


def b4(results) -> bool:
    return sum(1 for r in results if r["balance"]["antiIceKmInBest"] >= B4_MIN_KM) >= B4_MIN_CASES


def fmt(ref) -> str:
    return f"${ref.cost_usd:8.0f}" if ref.cost_usd is not None else "  no finish"


def report(results) -> str:
    lines = ["case                          best  noAntiIce  alwaysAI  straight  wasteful  saving%  B1 B2 B3 B5  AI km"]
    for r in results:
        refs, flags = r["refs"], r["balance"]
        saving = 100.0 * (1 - refs["best"].cost_usd / refs["straight_ahead"].cost_usd) if refs["best"].cost_usd else float("nan")
        lines.append(
            f"{r['id'][:28]:28} {fmt(refs['best'])} {fmt(refs['best_no_anti_ice'])} {fmt(refs['best_always_anti_ice'])} "
            f"{fmt(refs['straight_ahead'])} {fmt(refs['wasteful'])} {saving:7.1f}  "
            f"{'ok' if flags['B1'] else '--'} {'ok' if flags['B2'] else '--'} {'ok' if flags['B3'] else '--'} {'ok' if flags['B5'] else '--'}  "
            f"{flags['antiIceKmInBest']:6.0f}"
        )
    lines.append(f"B4 (anti-ice >= {B4_MIN_KM:.0f} km in Best on >= {B4_MIN_CASES} cases): {'ok' if b4(results) else 'FAIL'}")
    return "\n".join(lines)


def all_pass(results) -> bool:
    return b4(results) and all(all(r["balance"][k] for k in ("B1", "B2", "B3", "B5")) for r in results)


def _patch_value(text: str, key: str, new_value) -> str:
    """Replace the JSON value of the first top-level-looking `"key":` in `text`, keeping all other bytes."""
    marker = f'"{key}":'
    start = text.index(marker) + len(marker)
    _, end = json.JSONDecoder().raw_decode(text, start)
    dumped = json.dumps(new_value, allow_nan=False, separators=(",", ":"), ensure_ascii=False)
    return text[:start] + dumped + text[end:]


def rewrite_case_text(text: str, result: dict, overrides: dict) -> str:
    """The case file text with `params` and `balance` updated; raises ValueError if anything else would change."""
    old = json.loads(text)
    params = dict(old["params"])
    for attr, value in overrides.items():
        params[CAMEL[attr]] = value
    new_text = _patch_value(_patch_value(text, "params", params), "balance", result["balance"])
    new = json.loads(new_text)
    if {k: v for k, v in new.items() if k not in ("params", "balance")} != {k: v for k, v in old.items() if k not in ("params", "balance")}:
        raise ValueError("rewrite would change more than params and balance")
    case = result["case"]
    if not (case.ice_gain == case_from_dict(old).ice_gain).all():
        raise ValueError("these parameters change the stored ice gain; re-run the exporter instead of --write")
    for name, ref in result["refs"].items():
        stored = old["references"][name]
        if stored["completed"] != ref.completed or (ref.cost_usd is not None and abs(stored["costUsd"] - ref.cost_usd) > 1e-6):
            raise ValueError(f"reference {name} would change; re-run the exporter instead of --write")
    return new_text


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cases", type=Path, default=ROOT / "static" / "cloud-dive" / "cases")
    ap.add_argument("--set", action="append", metavar="KEY=VALUE", help=f"parameter override; keys: {', '.join(KEYS)}")
    ap.add_argument("--write", action="store_true", help="store parameters and balance in the case files (weather data untouched)")
    ap.add_argument("--json", action="store_true", help="print machine-readable results")
    args = ap.parse_args()
    overrides = parse_overrides(args.set)
    files = sorted(p for p in args.cases.glob("*.json") if p.name not in ("index.json", "basemap.json"))
    if not files:
        print(f"no case files in {args.cases}")
        return 2
    texts = {p: p.read_bytes().decode("utf-8") for p in files}
    results = [evaluate(json.loads(texts[p]), overrides) for p in files]
    if args.json:
        print(json.dumps([{"id": r["id"], "balance": r["balance"],
                           "refs": {k: v.to_dict() for k, v in r["refs"].items()}} for r in results], indent=1))
    else:
        print(report(results))
        print("defaults:", {k: v for k, v in DEFAULTS.items()}, "overrides:", overrides or "none")
    if args.write:
        if not all_pass(results):
            print("not writing: balance criteria B1 to B5 do not all pass")
            return 1
        new_texts = {p: rewrite_case_text(texts[p], r, overrides) for p, r in zip(files, results)}
        for p, new_text in new_texts.items():
            p.write_bytes(new_text.encode("utf-8"))
        print(f"wrote params and balance to {len(new_texts)} case files")
    return 0 if all_pass(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
