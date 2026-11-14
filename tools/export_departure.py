"""Add the departure climb constant and airport elevations to the Cloud Dive case files (task 17.1).

For each committed case this adds ONLY:

  params.departureClimbUsd    illustrative departure climb cost (src/analysis/departure.py)
  params.departureClimbNote   the formula in words
  airports                    {from: {icao, elevFt}, to: {icao, elevFt}}  (`elev_ft` of airports.json)

`airports.json` is built by tools/build_airports.py from the OurAirports CSV (public domain, see
THIRD_PARTY_NOTICES.md). The tool refuses to write when any other field would change, or when the file
is not in the exporter's own format; evidence, references, balance and viewerProfile stay byte-identical.
Re-running with unchanged inputs writes the same bytes.

    python tools/export_departure.py [--cases static/cloud-dive/cases] [--airports airports.json]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.analysis.case_builder import dumps_strict  # noqa: E402
from src.analysis.departure import departure_climb_usd, departure_note  # noqa: E402

EOL = "\r\n"  # the case exporter and the map exporter write text with this line ending on Windows


class DepartureExportError(RuntimeError):
    """The export was refused; nothing was written."""


def airport_field(airports: dict, icao: str) -> dict:
    row = airports.get(icao)
    if not row or not isinstance(row.get("elev_ft"), (int, float)):
        raise DepartureExportError(f"{icao}: no elev_ft in airports.json")
    return {"icao": icao, "elevFt": int(row["elev_ft"])}


def build_fields(case: dict, airports: dict) -> tuple[dict, dict]:
    """(new params entries, airports field) for one case."""
    route = case["route"]
    frm, to = airport_field(airports, route["from"]), airport_field(airports, route["to"])
    p = case["params"]
    start_alt = float(case["start"]["altFt"])
    usd = departure_climb_usd(p["climbExtraKgPer1000Ft"], frm["elevFt"], start_alt, p["fuelUsdPerKg"])
    note = departure_note(frm["icao"], frm["elevFt"], start_alt, p["fuelUsdPerKg"], p.get("aircraft", "E75L"))
    return {"departureClimbUsd": usd, "departureClimbNote": note}, {"from": frm, "to": to}


def rewrite_case_text(text: str, airports: dict) -> str:
    """The case file text with the three additions; raises DepartureExportError on any other change."""
    old = json.loads(text)
    # Re-serialising must reproduce the file, otherwise "byte-identical elsewhere" cannot be promised.
    if not text.endswith(EOL) or text[: -len(EOL)] != dumps_strict(old):
        raise DepartureExportError("case file is not in the exporter format; nothing written")
    params_new, airports_new = build_fields(old, airports)
    new = dict(old)
    new["params"] = {**old["params"], **params_new}
    new["airports"] = airports_new
    out = dumps_strict(new) + EOL
    check = json.loads(out)
    keep = lambda d: {k: v for k, v in d.items() if k not in ("params", "airports")}  # noqa: E731
    rest = lambda p: {k: v for k, v in p.items() if k not in params_new}  # noqa: E731
    if keep(check) != keep(old) or rest(check["params"]) != rest(old["params"]):
        raise DepartureExportError("a field other than params.departure* and airports would change; nothing written")
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cases", type=Path, default=ROOT / "static" / "cloud-dive" / "cases")
    ap.add_argument("--airports", type=Path, default=ROOT / "airports.json")
    args = ap.parse_args()
    airports = json.loads(args.airports.read_text(encoding="utf-8"))
    files = sorted(args.cases.glob("2026*.json"))
    try:
        new_texts = {p: rewrite_case_text(p.read_bytes().decode("utf-8"), airports) for p in files}
    except DepartureExportError as exc:
        print("refused:", exc)
        return 1
    for p, text in new_texts.items():
        p.write_bytes(text.encode("utf-8"))
        data = json.loads(text)
        print(f"{p.name}: departureClimbUsd {data['params']['departureClimbUsd']}, "
              f"{data['airports']['from']['icao']} {data['airports']['from']['elevFt']} ft")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
