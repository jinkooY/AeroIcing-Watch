"""Cloud Dive cost parameters and OpenAP-derived fuel tables (build time only).

`Params` is the complete, JSON-serialisable parameter set stored in every case file. The game
engine, the solver and the browser read only these numbers; OpenAP (LGPL) is imported lazily by
`build_tables` and never shipped. All values are illustrative game parameters, not operational
fuel data: the aircraft is an Embraer E175 (OpenAP `E75L`, engine CF34-8E6) at a fixed mass.

Units: altitude ft, speed kt, fuel flow kg/h, fuel kg, price USD/kg, distance km.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Mapping, Sequence

AIRCRAFT = "E75L"
ENGINE = "CF34-8E6"
MASS_KG = 30340.0  # (MTOW 38,790 + OEW 21,890) / 2, from the OpenAP aircraft file
FUEL_USD_PER_KG = 0.79  # illustrative
FT_PER_M = 3.28084
FPM_PER_MS = 196.85039

# Speed schedule used for the TAS table (a game choice, stated here so it can be criticised).
CAS_BELOW_10K_KT = 250.0
CAS_ABOVE_10K_KT = 280.0
MACH_CAP = 0.74

# Placeholder game parameters (section 5.1 of the design). Tuned only by tools/tune_params.py.
DEFAULTS = {
    "antiIceFactor": 1.08,
    "speedLossAtFull": 0.12,
    "dragFlowAtFull": 0.20,
    "iceExponent": 1.5,
    "diversionUsd": 0.0,
    "baseGain": 7.0,
    "possibleRateFactor": 0.25,
    "minGroundSpeedKt": 120.0,
}


@dataclass(frozen=True)
class Params:
    """All numbers the cost and ice rules need. Tables are keyed by altitude in feet."""

    tas_kt_by_alt: Mapping[int, float]
    flow_kg_h_by_alt: Mapping[int, float]
    climb_extra_kg_per_1000ft_by_alt: Mapping[int, float]
    aircraft: str = AIRCRAFT
    engine: str = ENGINE
    mass_kg: float = MASS_KG
    fuel_usd_per_kg: float = FUEL_USD_PER_KG
    anti_ice_factor: float = DEFAULTS["antiIceFactor"]
    speed_loss_at_full: float = DEFAULTS["speedLossAtFull"]
    drag_flow_at_full: float = DEFAULTS["dragFlowAtFull"]
    ice_exponent: float = DEFAULTS["iceExponent"]
    diversion_usd: float = DEFAULTS["diversionUsd"]
    base_gain: float = DEFAULTS["baseGain"]
    possible_rate_factor: float = DEFAULTS["possibleRateFactor"]
    min_ground_speed_kt: float = DEFAULTS["minGroundSpeedKt"]

    def to_dict(self) -> dict:
        def table(t):
            return {str(k): float(v) for k, v in sorted(t.items())}

        return {
            "aircraft": self.aircraft, "engine": self.engine, "massKg": self.mass_kg,
            "fuelUsdPerKg": self.fuel_usd_per_kg,
            "tasKtByAlt": table(self.tas_kt_by_alt), "flowKgHByAlt": table(self.flow_kg_h_by_alt),
            "climbExtraKgPer1000Ft": table(self.climb_extra_kg_per_1000ft_by_alt),
            "antiIceFactor": self.anti_ice_factor, "speedLossAtFull": self.speed_loss_at_full,
            "dragFlowAtFull": self.drag_flow_at_full, "iceExponent": self.ice_exponent,
            "diversionUsd": self.diversion_usd, "baseGain": self.base_gain,
            "possibleRateFactor": self.possible_rate_factor, "minGroundSpeedKt": self.min_ground_speed_kt,
        }

    @classmethod
    def from_dict(cls, d: Mapping) -> "Params":
        def table(t):
            return {int(k): float(v) for k, v in t.items()}

        return cls(
            tas_kt_by_alt=table(d["tasKtByAlt"]), flow_kg_h_by_alt=table(d["flowKgHByAlt"]),
            climb_extra_kg_per_1000ft_by_alt=table(d["climbExtraKgPer1000Ft"]),
            aircraft=d["aircraft"], engine=d["engine"], mass_kg=float(d["massKg"]),
            fuel_usd_per_kg=float(d["fuelUsdPerKg"]), anti_ice_factor=float(d["antiIceFactor"]),
            speed_loss_at_full=float(d["speedLossAtFull"]), drag_flow_at_full=float(d["dragFlowAtFull"]),
            ice_exponent=float(d["iceExponent"]), diversion_usd=float(d["diversionUsd"]),
            base_gain=float(d["baseGain"]), possible_rate_factor=float(d["possibleRateFactor"]),
            min_ground_speed_kt=float(d["minGroundSpeedKt"]),
        )

    def replace(self, **changes) -> "Params":
        from dataclasses import replace as _replace

        return _replace(self, **changes)


# ---------------------------------------------------------------------------------------------
# ISA and speed schedule (pure; no OpenAP)
# ---------------------------------------------------------------------------------------------

def isa_temperature_k(alt_ft: float) -> float:
    if alt_ft > 36089:
        raise ValueError("speed schedule is defined below the tropopause (36,089 ft)")
    return 288.15 - 0.0019812 * alt_ft


def _isa_pressure_hpa(alt_ft: float) -> float:
    return 1013.25 * (1.0 - 6.8755856e-6 * alt_ft) ** 5.2558797


def cas_to_tas_kt(cas_kt: float, alt_ft: float) -> tuple[float, float]:
    """(TAS kt, Mach) from calibrated airspeed (compressible flow, ISA)."""
    a0 = 661.4786
    p = _isa_pressure_hpa(alt_ft)
    qc = 1013.25 * ((1.0 + 0.2 * (cas_kt / a0) ** 2) ** 3.5 - 1.0)
    mach = math.sqrt(5.0 * (((qc / p) + 1.0) ** (2.0 / 7.0) - 1.0))
    return mach * 38.9678 * math.sqrt(isa_temperature_k(alt_ft)), mach


def tas_schedule_kt(alt_ft: float) -> float:
    """Cruise TAS: CAS 250 kt below 10,000 ft, CAS 280 kt above, capped at Mach 0.74."""
    cas = CAS_BELOW_10K_KT if alt_ft < 10000 else CAS_ABOVE_10K_KT
    tas, mach = cas_to_tas_kt(cas, alt_ft)
    if mach > MACH_CAP:
        tas = MACH_CAP * 38.9678 * math.sqrt(isa_temperature_k(alt_ft))
    return tas


# ---------------------------------------------------------------------------------------------
# OpenAP tables (build time only)
# ---------------------------------------------------------------------------------------------

def build_tables(alts_ft: Sequence[int], mass_kg: float = MASS_KG) -> dict:
    """Fuel-flow, TAS and climb-extra tables from OpenAP for the given altitude levels.

    OpenAP units (checked in its source): `FuelFlow.enroute(mass kg, tas kt, alt ft, vs ft/min)`
    returns kg/s. WRAP vertical rates are in m/s and are converted here to ft/min.
    """
    import warnings

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        from openap import WRAP, FuelFlow

        fuel = FuelFlow(AIRCRAFT)
        vs_ms = float(WRAP(AIRCRAFT).climb_vs_concas()["default"])
    vs_fpm = vs_ms * FPM_PER_MS
    tas, flow, climb = {}, {}, {}
    for alt in alts_ft:
        alt = int(alt)
        tas[alt] = tas_schedule_kt(alt)
        flow[alt] = float(fuel.enroute(mass_kg, tas[alt], alt, vs=0)) * 3600.0
        mid = alt - 500  # a 1,000 ft climb ending at this level
        tas_mid = tas_schedule_kt(max(mid, 0))
        level = float(fuel.enroute(mass_kg, tas_mid, mid, vs=0))
        climbing = float(fuel.enroute(mass_kg, tas_mid, mid, vs=vs_fpm))
        minutes = 1000.0 / vs_fpm
        climb[alt] = max(0.0, (climbing - level) * minutes * 60.0)
    return {"tas": tas, "flow": flow, "climb": climb, "climbRateFtMin": vs_fpm}


def default_params(alts_ft: Sequence[int], mass_kg: float = MASS_KG, **overrides) -> Params:
    """Params for an altitude block with OpenAP tables and the placeholder game parameters."""
    tables = build_tables(alts_ft, mass_kg)
    base = Params(
        tas_kt_by_alt=tables["tas"], flow_kg_h_by_alt=tables["flow"],
        climb_extra_kg_per_1000ft_by_alt=tables["climb"], mass_kg=mass_kg,
    )
    return base.replace(**overrides) if overrides else base
