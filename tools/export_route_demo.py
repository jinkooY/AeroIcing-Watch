"""Export the public route demo from two saved IFS route evaluations."""

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path


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


def export_route(route_id, label, waypoint_labels, request, response):
    if utc(request["departure_at"]) != utc(response["departure"]) or utc(
        request["decision_at"]
    ) != utc(response["decision_at"]):
        raise ValueError(f"Request and result times differ for {route_id}")

    segments = []
    travelled_km = 0.0
    for segment in response["segments"]:
        length_km = segment["distance_km"]
        public_segment = {field: segment.get(field) for field in SEGMENT_FIELDS}
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

    return {
        "schema_version": 1,
        "title": "Incheon to Tokyo Haneda",
        "data_kind": "archived_forecast",
        **contexts[0],
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
