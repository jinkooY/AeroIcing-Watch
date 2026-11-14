"""Export the public route demo from two saved IFS route evaluations."""

import argparse
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.analysis.route_sampler import split_legs  # noqa: E402


OUTPUT = Path(__file__).resolve().parents[1] / "static" / "route-demo" / "scenario.json"
SOURCE_URL = "https://www.ecmwf.int/en/forecasts/datasets/open-data"
ASSUMPTIONS = (
    "aircraft", "engine", "initial_mass_kg", "altitude_ft_pressure", "tas_kt",
    "model", "version", "phase", "pressure_hpa",
)
SEGMENT_FIELDS = (
    "latitude", "longitude", "distance_km", "state", "icing_environment",
    "temperature_c", "wind_speed_kt", "wind_from_deg", "ground_speed_kt",
    "duration_s", "fuel_kg",
)
SCHEMA_VERSION = 2
REPLAY_VERSION = 1
FEET_TO_M = 0.3048
# Exported midpoints must reproduce the archived evaluation; ETAs may differ by the
# evaluator's 0.1 s convergence tolerance.
MIDPOINT_TOLERANCE_DEG = 1e-7
ETA_TOLERANCE_S = 1.0
ROUTES = (
    ("direct", "Direct candidate", ("RKSI", "RJTT")),
    ("via", "Waypoint candidate", ("RKSI", "34.8°N, 133.0°E", "RJTT")),
)


def utc(value):
    timestamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if timestamp.utcoffset() is None:
        raise ValueError("Expected a timestamp with a UTC offset")
    return timestamp.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def shared_context(response):
    forecast = response["forecast"]
    initialized_at = utc(forecast["initialized_at"])
    return {
        "departure_at": utc(response["departure"]),
        "decision_at": utc(response["decision_at"]),
        "assumptions": {field: response["assumptions"][field] for field in ASSUMPTIONS},
        "forecast": {
            "source": forecast["source"],
            "product": forecast["product"],
            "resolution_deg": forecast["resolution_deg"],
            "initialized_at": initialized_at,
            "available_at": utc(forecast["received_at"]),
            "valid_times": [utc(value) for value in forecast["valid_times"]],
            "attribution": "This service is based on data and products of the European "
            "Centre for Medium-Range Weather Forecasts (ECMWF). "
            "AeroIcing Watch interpolated the forecast and computed the route estimates.",
            "copyright": f"© {initialized_at[:4]} ECMWF",
            "disclaimer": "ECMWF accepts no liability for data errors, omissions, "
            "availability, or losses or damage from use.",
            "source_url": SOURCE_URL,
            "license_url": "https://creativecommons.org/licenses/by/4.0/",
            "terms_url": "https://apps.ecmwf.int/datasets/licences/general/",
        },
    }


def isoformat(timestamp):
    return timestamp.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def build_replay(route_id, waypoint_labels, request, response):
    """Rebuild segment boundaries and boundary times from the evaluator's leg split."""
    points = [(point["lat"], point["lon"]) for point in request["waypoints"]]
    legs = split_legs(points)
    segments = response["segments"]
    if len(legs) != response["segment_count"] or len(segments) > len(legs):
        raise ValueError(f"Segment count mismatch for {route_id}")

    waypoint_at = {}
    for point, name in zip(points, waypoint_labels, strict=True):
        waypoint_at[point] = name

    departure = datetime.fromisoformat(response["departure"].replace("Z", "+00:00"))
    now = departure
    travelled_m = 0.0
    times = [departure]
    stopped_index = None
    for index, ((_, mid, _, _, metres), segment) in enumerate(zip(legs, segments)):
        if abs(mid[0] - segment["latitude"]) > MIDPOINT_TOLERANCE_DEG or abs(
            mid[1] - segment["longitude"]
        ) > MIDPOINT_TOLERANCE_DEG:
            raise ValueError(f"Segment {index} midpoint of {route_id} differs from the evaluator")
        duration = segment.get("duration_s")
        if duration is None:
            stopped_index = index
            break
        eta = datetime.fromisoformat(segment["eta"].replace("Z", "+00:00"))
        expected = now + timedelta(seconds=duration / 2)
        if abs((eta - expected).total_seconds()) > ETA_TOLERANCE_S:
            raise ValueError(f"Segment {index} midpoint ETA of {route_id} is inconsistent")
        now += timedelta(seconds=duration)
        times.append(now)
    if stopped_index is None and len(segments) < len(legs):
        stopped_index = len(segments)

    track = []
    for index in range(len(legs) + 1):
        point = legs[0][0] if index == 0 else legs[index - 1][2]
        track.append({
            "latitude": point[0],
            "longitude": point[1],
            "distance_km": travelled_m / 1000,
            "time": isoformat(times[index]) if index < len(times) else None,
            "waypoint": waypoint_at.get(point),
        })
        if index < len(legs):
            travelled_m += legs[index][4]

    if [item["waypoint"] for item in track if item["waypoint"]] != list(waypoint_labels):
        raise ValueError(f"Waypoints of {route_id} do not fall on segment boundaries")

    complete = stopped_index is None
    if complete and response["total_time_s"] is not None and abs(
        (now - departure).total_seconds() - response["total_time_s"]
    ) > 1e-3:
        raise ValueError(f"Boundary times of {route_id} do not sum to the route total")
    return {
        "track": track,
        "start_at": isoformat(departure),
        "end_at": isoformat(now),
        "status": "complete" if complete else "truncated",
        "stopped_segment_index": stopped_index,
        "stopped_reason": None if complete else (
            segments[stopped_index]["state"] if stopped_index < len(segments) else "not_evaluated"
        ),
    }


def export_route(route_id, label, waypoint_labels, request, response):
    if utc(request["departure_at"]) != utc(response["departure"]) or utc(
        request["decision_at"]
    ) != utc(response["decision_at"]):
        raise ValueError(f"Request and result times differ for {route_id}")

    segments = []
    travelled_km = 0.0
    for index, segment in enumerate(response["segments"]):
        length_km = segment["distance_km"]
        public_segment = {"id": f"{route_id}-{index + 1:03d}", "index": index}
        public_segment.update({field: segment.get(field) for field in SEGMENT_FIELDS})
        public_segment.update(
            cumulative_distance_km=travelled_km + length_km / 2,
            eta=utc(segment["eta"]),
            rh_percent=segment.get("r"),
        )
        segments.append(public_segment)
        travelled_km += length_km

    icing = response["icing"]
    return {
        "id": route_id,
        "label": label,
        "waypoints": [
            {"latitude": point["lat"], "longitude": point["lon"], "label": name}
            for point, name in zip(request["waypoints"], waypoint_labels, strict=True)
        ],
        "state": response["state"],
        "distance_km": response["distance_km"],
        "total_time_s": response["total_time_s"],
        "estimated_fuel_kg": response["estimated_fuel_kg"],
        "icing": {
            field: icing[field] for field in (
                "rule", "thresholds", "assessed_segments", "possible_segments",
                "planned_segments", "accuracy",
            )
        },
        "ctps_observation": {"state": response["ctps_observation"]["state"]},
        "segments": segments,
        "replay": build_replay(route_id, waypoint_labels, request, response),
    }


def export_scenario(input_directory):
    contexts, routes = [], []
    for route_id, label, waypoint_labels in ROUTES:
        prefix = f"rksi-rjtt-{route_id}"
        request = read_json(input_directory / f"{prefix}-request.json")
        response = read_json(input_directory / f"{prefix}.json")
        contexts.append(shared_context(response))
        routes.append(export_route(route_id, label, waypoint_labels, request, response))

    if contexts[0] != contexts[1]:
        raise ValueError("The demo routes must share the same forecast and assumptions")

    altitude_ft = contexts[0]["assumptions"]["altitude_ft_pressure"]
    return {
        "schema_version": SCHEMA_VERSION,
        "title": "Incheon to Tokyo Haneda",
        "data_kind": "archived_forecast",
        **contexts[0],
        "replay": {
            "version": REPLAY_VERSION,
            "coordinate_system": "WGS84 latitude/longitude in degrees",
            "time_basis": "UTC. Track times are segment boundaries from departure plus evaluated "
            "segment durations. Segment eta values are midpoint times.",
            "phase": "level_cruise_only",
            "pressure_altitude_ft": altitude_ft,
            "display_height_m": round(altitude_ft * FEET_TO_M, 1),
            "height_reference": "Display only: pressure altitude converted to metres above the "
            "WGS84 ellipsoid without temperature or geoid correction",
            "interpolation": "Constant groundspeed along the geodesic between adjacent track points",
        },
        "routes": routes,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_directory", type=Path, help="Saved RKSI–RJTT requests and responses")
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()

    scenario = export_scenario(args.input_directory)
    content = json.dumps(scenario, indent=2, ensure_ascii=False, allow_nan=False)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(content + "\n", encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
