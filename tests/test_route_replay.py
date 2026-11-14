"""Contract tests for the 3D replay data exported into the public route demo."""

from datetime import datetime
import json
from pathlib import Path

import pytest

from src.analysis.route_sampler import split_legs
from src.analysis.route_weather import legs_for

SCENARIO = Path(__file__).resolve().parents[1] / "static" / "route-demo" / "scenario.json"


def parse(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


@pytest.fixture(scope="module")
def scenario():
    return json.loads(SCENARIO.read_text(encoding="utf-8"))


def test_split_legs_share_boundaries_and_hit_waypoints():
    points = [(37.4602, 126.4407), (34.8, 133.0), (35.55, 139.78)]
    legs = split_legs(points)
    assert legs[0][0] == points[0] and legs[-1][2] == points[-1]
    for previous, current in zip(legs, legs[1:]):
        assert previous[2] == current[0]
    assert points[1] in [leg[2] for leg in legs]
    assert [(mid[0], mid[1]) for _, mid, *_ in legs] == [leg[:2] for leg in legs_for(points)]


def test_scenario_declares_replay_contract(scenario):
    assert scenario["schema_version"] == 2
    replay = scenario["replay"]
    assert replay["version"] == 1
    assert replay["pressure_altitude_ft"] == scenario["assumptions"]["altitude_ft_pressure"]
    assert replay["display_height_m"] > 0 and replay["height_reference"]


@pytest.mark.parametrize("route_index", [0, 1])
def test_route_track_matches_segments(scenario, route_index):
    route = scenario["routes"][route_index]
    replay, segments = route["replay"], route["segments"]
    track = replay["track"]
    assert len(track) == len(segments) + 1
    assert [point["waypoint"] for point in track if point["waypoint"]] == [
        waypoint["label"] for waypoint in route["waypoints"]
    ]
    assert track[0]["time"] == replay["start_at"] == scenario["departure_at"]
    assert track[-1]["time"] == replay["end_at"]
    assert replay["status"] == "complete" and replay["stopped_segment_index"] is None
    assert track[-1]["distance_km"] == pytest.approx(route["distance_km"])

    times = [parse(point["time"]) for point in track]
    assert times == sorted(times)
    assert (times[-1] - times[0]).total_seconds() == pytest.approx(route["total_time_s"], abs=1e-3)
    for index, segment in enumerate(segments):
        assert segment["id"] == f"{route['id']}-{index + 1:03d}" and segment["index"] == index
        start, end = times[index], times[index + 1]
        assert (end - start).total_seconds() == pytest.approx(segment["duration_s"], abs=1e-3)
        midpoint = start + (end - start) / 2
        assert abs((parse(segment["eta"]) - midpoint).total_seconds()) < 1.0
        assert track[index]["distance_km"] < segment["cumulative_distance_km"] < track[index + 1]["distance_km"]
