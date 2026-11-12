"""Match archived route cues against explicit icing and no-icing labels."""

import argparse
import csv
import json
import math
from datetime import datetime
from pathlib import Path

from pyproj import Geod

GEOD = Geod(ellps="WGS84")
SCREEN = {"possible_environment", "criterion_not_met"}


def _timestamp(value: str) -> float:
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.utcoffset() is None:
        raise ValueError("A UTC offset is required")
    return dt.timestamp()


def metrics(profiles, reports, *, radius_km, minutes, altitude_ft, label_kind):
    points = [
        (segment, float(profile["assumptions"]["altitude_ft_pressure"]), _timestamp(segment["eta"]))
        for profile in profiles for segment in profile["segments"]
        if segment.get("icing_environment") in SCREEN
    ]
    counts = dict(tp=0, fp=0, fn=0, tn=0)
    seen = set()
    explicit = 0
    for row in reports:
        label = row["label"].strip()
        if label not in {"icing", "no_icing", "unknown", ""}:
            raise ValueError(f"Unsupported label {label!r}")
        if label in {"unknown", ""}:
            continue
        key = row["id"].strip()
        if not key or key in seen:
            raise ValueError("Each explicit report must have a unique nonempty id")
        seen.add(key)
        explicit += 1
        lat, lon, altitude = (float(row[k]) for k in ("lat", "lon", "alt_ft"))
        if not (-90 <= lat <= 90 and -180 <= lon <= 180 and math.isfinite(altitude)):
            raise ValueError("Invalid report position")
        at = _timestamp(row["observed_at"])
        candidates = []
        for segment, level, timestamp in points:
            age = abs(at - timestamp) / 60
            vertical = abs(altitude - level)
            if age > minutes or vertical > altitude_ft:
                continue
            _, _, distance = GEOD.inv(lon, lat, segment["longitude"], segment["latitude"])
            distance /= 1000
            if distance <= radius_km:
                score = (age / minutes) ** 2 + (vertical / altitude_ft) ** 2 + (distance / radius_km) ** 2
                candidates.append((score, segment["icing_environment"]))
        if candidates:
            predicted = min(candidates, key=lambda item: item[0])[1] == "possible_environment"
            observed = label == "icing"
            counts[{(True, True): "tp", (True, False): "fp",
                    (False, True): "fn", (False, False): "tn"}[predicted, observed]] += 1
    tp, fp, fn, tn = (counts[k] for k in ("tp", "fp", "fn", "tn"))
    matched = sum(counts.values())
    total_segments = sum(profile.get("segment_count", len(profile["segments"])) for profile in profiles)
    return {
        "label_kind": label_kind,
        "interpretation": {
            "independent": "independent_report_validation",
            "diagnostic": "agreement_only",
            "synthetic": "verification_fixture",
        }[label_kind],
        "state": "evaluated" if matched else "unevaluated",
        "explicit_reports": explicit, "matched_reports": matched,
        "assessed_segments": len(points), "planned_segments": total_segments,
        "segment_coverage": len(points) / total_segments if total_segments else None,
        "report_coverage": matched / explicit if explicit else None,
        "confusion_counts": counts,
        "probability_of_detection": tp / (tp + fn) if tp + fn else None,
        "false_alarm_ratio": fp / (tp + fp) if tp + fp else None,
        "false_positive_rate": fp / (fp + tn) if fp + tn else None,
        "tolerances": dict(radius_km=radius_km, minutes=minutes, altitude_ft=altitude_ft),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("profiles", type=Path, nargs="+", help="Saved route evaluation JSON responses.")
    parser.add_argument("--reports", required=True, type=Path)
    parser.add_argument("--label-kind", required=True, choices=("independent", "diagnostic", "synthetic"))
    parser.add_argument("--radius-km", type=float, default=25)
    parser.add_argument("--minutes", type=float, default=15)
    parser.add_argument("--altitude-ft", type=float, default=1000)
    args = parser.parse_args()
    if not all(math.isfinite(x) and x > 0 for x in (args.radius_km, args.minutes, args.altitude_ft)):
        parser.error("Matching tolerances must be positive and finite")
    profiles = [json.loads(path.read_text(encoding="utf-8")) for path in args.profiles]
    with args.reports.open(encoding="utf-8-sig", newline="") as handle:
        result = metrics(profiles, csv.DictReader(handle), radius_km=args.radius_km,
                         minutes=args.minutes, altitude_ft=args.altitude_ft, label_kind=args.label_kind)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
