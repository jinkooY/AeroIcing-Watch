"""Python port of `validProfile()` in static/viewer.js (the viewer JSON contract).

    python tools/check_viewer_contract.py profile.json [case.json ...]

A path to a Cloud Dive case file is checked through its `viewerProfile`. Exit code 1 on any error.
The rules are copied rule for rule; `tests/test_viewer_contract.py` runs the original JavaScript
against this port on the same inputs (when Node is installed).
"""
from __future__ import annotations

import json
import math
import re
import sys
from datetime import datetime
from pathlib import Path

_UTC = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$")
PHASES = ("liquid", "ice", "unknown")


def _finite(v) -> bool:
    """JavaScript `Number.isFinite`: true only for real, finite numbers (not booleans, strings, null)."""
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _is_string(v) -> bool:
    return isinstance(v, str)


def _parses_as_utc(text: str) -> bool:
    try:
        datetime.strptime(text[:19], "%Y-%m-%dT%H:%M:%S")
        return True
    except ValueError:
        return False


def _altitude(v) -> bool:
    return v is None or (_finite(v) and -2000 <= v <= 100000)


def profile_errors(profile) -> list[str]:
    """All violations of the viewer contract (empty list means valid). The viewer stops at the first."""
    if not isinstance(profile, dict):
        return ["Provide a title, source, and a dataKind of simulated or observation."]
    errors: list[str] = []
    title, source = profile.get("title"), profile.get("source")
    if (not _is_string(title) or not title.strip() or not _is_string(source) or not source.strip()
            or profile.get("dataKind") not in ("simulated", "observation")):
        return ["Provide a title, source, and a dataKind of simulated or observation."]
    observed = profile.get("observedAt")
    utc = _is_string(observed) and bool(_UTC.match(observed)) and _parses_as_utc(observed)
    if (observed is not None and not utc) or (profile["dataKind"] == "observation" and not utc):
        return ["Observations require an ISO 8601 UTC timestamp."]
    samples = profile.get("samples")
    if not isinstance(samples, list) or len(samples) < 2 or len(samples) > 2000:
        return ["Provide between 2 and 2,000 samples."]
    previous = -1
    for index, point in enumerate(samples):
        if (not isinstance(point, dict) or not _finite(point.get("distanceKm")) or point["distanceKm"] < 0
                or point["distanceKm"] > 50000 or point["distanceKm"] <= previous
                or (index == 0 and point["distanceKm"] != 0)):
            errors.append("Distances must start at zero, increase strictly, and stay within 50,000 km.")
            return errors
        top, base = point.get("topFt"), point.get("baseFt")
        phase, supercooled = point.get("phase"), point.get("supercooled")
        if (not _altitude(top) or not _altitude(base) or (base is not None and (top is None or base > top))
                or (phase is not None and phase not in PHASES)
                or not (supercooled is True or supercooled is False or supercooled is None)
                or (top is None and (phase is not None or supercooled is not None))):
            errors.append(f"Invalid cloud fields at sample {index + 1}.")
            return errors
        previous = point["distanceKm"]
    return errors


def valid_profile(profile) -> bool:
    return not profile_errors(profile)


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    status = 0
    for name in argv:
        data = json.loads(Path(name).read_text(encoding="utf-8"))
        profile = data.get("viewerProfile", data) if isinstance(data, dict) else data
        errors = profile_errors(profile)
        print(("OK    " if not errors else "FAIL  ") + name + ("" if not errors else " - " + errors[0]))
        status |= bool(errors)
    return status


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
