"""Evaluate a user-supplied, fixed-flight-level route against IFS forecasts."""

from datetime import timedelta
import math

from pyproj import Geod

from src.analysis.aircraft_performance import performance_model
from src.analysis.route_sampler import split_legs
from src.integration.ifs_grid import sample

GEOD = Geod(ellps="WGS84")
KNOT_MPS = 1852 / 3600
RULE = "ifs-temperature-rh-v1"


def atmosphere(altitude_ft: float):
    height = altitude_ft * 0.3048
    temperature = 288.15 - 0.0065 * min(height, 11000)
    pressure = 1013.25 * (temperature / 288.15) ** 5.25588
    if height > 11000:
        pressure *= math.exp(-9.80665 * (height - 11000) / (287.05287 * temperature))
    return pressure, temperature


def environment(t_k: float | None, rh: float | None) -> str:
    """Uncalibrated temperature and humidity screen for research use."""
    if t_k is None or rh is None:
        return "unassessed"
    return "possible_environment" if 248.15 <= t_k <= 273.15 and rh >= 85 else "criterion_not_met"


def weather(bundle, lat, lon, pressure, at):
    status, values = sample(bundle, lat, lon, pressure, at)
    record = dict(latitude=lat, longitude=lon, eta=at.isoformat(), state=status,
                  icing_environment="unassessed")
    if values is None:
        return record
    record.update(
        values, icing_environment=environment(values["t"], values["r"]),
        temperature_c=values["t"] - 273.15 if values["t"] is not None else None,
    )
    u, v = values["u"], values["v"]
    if u is not None and v is not None:
        record["wind_speed_kt"] = math.hypot(u, v) / KNOT_MPS
        record["wind_from_deg"] = math.degrees(math.atan2(-u, -v)) % 360 if u or v else None
    if any(value is None for value in values.values()):
        record["state"] = "partial_fields"
    return record


def ground_speed(u: float, v: float, azimuth: float, tas_kt: float) -> float | None:
    heading = math.radians(azimuth)
    along = u * math.sin(heading) + v * math.cos(heading)
    cross = u * math.cos(heading) - v * math.sin(heading)
    tas = tas_kt * KNOT_MPS
    if abs(cross) >= tas:
        return None
    speed = math.sqrt(tas ** 2 - cross ** 2) + along
    return speed if speed > 0 else None


def legs_for(points):
    return [(mid[0], mid[1], azimuth, metres) for _, mid, _, azimuth, metres in split_legs(points)]


def evaluate(bundle, points, departure, altitude_ft, tas_kt, mass_kg, aircraft=None, engine=None):
    model, assumptions = performance_model(aircraft, engine, mass_kg)
    start_mass_kg = assumptions["initial_mass_kg"]
    pressure, isa_temp = atmosphere(altitude_ft)
    legs = legs_for(points)
    start = weather(bundle, *points[0], pressure, departure)
    now = departure
    mass = start_mass_kg
    segments = []
    for lat, lon, azimuth, metres in legs:
        duration = metres / (tas_kt * KNOT_MPS)
        # Fixed-point iteration at the estimated segment midpoint ETA.
        for _ in range(12):
            point = weather(bundle, lat, lon, pressure, now + timedelta(seconds=duration / 2))
            u, v, temperature = (point.get(k) for k in ("u", "v", "t"))
            if u is None or v is None or temperature is None:
                segments.append(dict(point, distance_km=metres / 1000))
                break
            speed = ground_speed(u, v, azimuth, tas_kt)
            if speed is None:
                segments.append(dict(point, state="no_forward_groundspeed", distance_km=metres / 1000))
                break
            updated = metres / speed
            if abs(duration - updated) < 0.1:
                duration = updated
                flow = float(model.enroute(mass=mass, tas=tas_kt, alt=altitude_ft,
                                           vs=0, dT=temperature - isa_temp))
                fuel = flow * duration
                if not math.isfinite(fuel) or not 0 < fuel <= mass - assumptions["min_mass_kg"]:
                    segments.append(dict(point, state="fuel_model_unavailable", distance_km=metres / 1000))
                    break
                segments.append(dict(point, ground_speed_kt=speed / KNOT_MPS,
                                     distance_km=metres / 1000, duration_s=duration,
                                     fuel_flow_kg_s=flow, fuel_kg=fuel))
                now += timedelta(seconds=duration)
                mass -= fuel
                break
            duration = updated
        else:
            segments.append(dict(point, state="eta_nonconvergent", distance_km=metres / 1000))
        if "fuel_kg" not in segments[-1]:
            break

    solved = len(segments) == len(legs) and "fuel_kg" in segments[-1]
    end = weather(bundle, *points[-1], pressure, now) if solved else None
    complete = solved and all(start.get(k) is not None and end.get(k) is not None for k in ("u", "v", "t"))
    return {
        "state": "complete" if complete else "incomplete",
        "route_kind": "illustrative_user_supplied",
        "departure": departure.isoformat(), "arrival": now.isoformat() if complete else None,
        "total_time_s": (now - departure).total_seconds() if complete else None,
        "estimated_fuel_kg": start_mass_kg - mass if complete else None,
        "distance_km": sum(leg[-1] for leg in legs) / 1000,
        "segment_count": len(legs), "segments": segments, "start": start, "end": end,
        "assumptions": dict(assumptions, phase="level_cruise_only",
                            altitude_ft_pressure=altitude_ft, pressure_hpa=pressure, tas_kt=tas_kt),
        "icing": dict(rule=RULE, evidence="IFS temperature and relative humidity",
                      thresholds={"temperature_c": [-25, 0], "rh_percent_min": 85},
                      assessed_segments=sum(s["icing_environment"] != "unassessed" for s in segments),
                      possible_segments=sum(s["icing_environment"] == "possible_environment" for s in segments),
                      planned_segments=len(legs),
                      accuracy="unevaluated", severity=None, probability=None,
                      automatic_exclusion=False),
    }
