"""Aircraft and engine choices available to the installed OpenAP model."""

from functools import lru_cache
from importlib.metadata import version

LEGACY_AIRCRAFT = "A320"
LEGACY_ENGINE = "CFM56-5B4"


@lru_cache(maxsize=1)
def catalog() -> dict:
    from openap import FuelFlow, prop

    result = {}
    for code in prop.available_aircraft():
        spec = prop.aircraft(code)
        default = spec["engine"]["default"].upper()
        engines = list(dict.fromkeys(
            engine.upper() for engine in [default, *prop.aircraft_engine_options(code)]
        ))
        supported = []
        for engine in engines:
            try:
                # A property entry alone can lack a usable drag or fuel model.
                FuelFlow(code, eng=engine)
            except ValueError:
                continue
            supported.append(engine)
        if default in supported:
            result[code.upper()] = {
                "aircraft": code.upper(),
                "engines": supported,
                "default_engine": default,
                "min_mass_kg": spec["limits"]["OEW"],
                "max_mass_kg": spec["limits"]["MTOW"],
            }
    return result


def performance_model(aircraft: str | None, engine: str | None, mass_kg: float | None):
    from openap import FuelFlow

    code = aircraft.strip().upper() if aircraft is not None else LEGACY_AIRCRAFT
    spec = catalog().get(code)
    if spec is None:
        raise ValueError(f"Unsupported OpenAP aircraft: {code!r}")

    if engine is not None:
        selected, engine_source = engine.strip().upper(), "user_selected"
    elif aircraft is None:
        selected, engine_source = LEGACY_ENGINE, "legacy_demo_default"
    else:
        selected, engine_source = spec["default_engine"], "openap_aircraft_default"
    if selected not in spec["engines"]:
        raise ValueError(f"Engine {selected!r} is unsupported for {code}. Options: {', '.join(spec['engines'])}")

    mass_source = "user_supplied"
    if mass_kg is None:
        if code != LEGACY_AIRCRAFT:
            raise ValueError(f"Supply mass_kg for {code}")
        mass_kg, mass_source = 62000, "legacy_demo_default"
    low, high = spec["min_mass_kg"], spec["max_mass_kg"]
    if not low <= mass_kg <= high:
        raise ValueError(f"Mass for {code} must be between {low} and {high} kg in the OpenAP model")
    model = FuelFlow(code, eng=selected)
    return model, {
        "aircraft": model.ac.upper(), "engine": model.engine_type, "engine_source": engine_source,
        "model": "OpenAP", "version": version("openap"), "initial_mass_kg": mass_kg,
        "mass_source": mass_source, "min_mass_kg": low, "max_mass_kg": high,
    }
