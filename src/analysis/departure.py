"""Departure climb constant of the Cloud Dive game (design.md sections 3.4 and 8, revision b).

The constant is the extra fuel of the climb from the departure airport elevation to the start
altitude, priced with the case fuel price. It is the same number for every flight on a case, so it
never changes the engine, the solver, the balance criteria B1 to B5 or the saving share. It is an
illustrative game value (R4.7), not operational fuel data.

`with_departure` adds it to an engine total. The JavaScript twin is `static/cloud-dive/departure.js`.
"""
from __future__ import annotations

import math
from typing import Mapping

BAND_FT = 1000.0
LABEL = "Departure climb"


def departure_climb_kg(climb_kg_per_1000ft: Mapping, elev_ft: float, start_alt_ft: float) -> float:
    """Extra climb fuel in kg from `elev_ft` to `start_alt_ft`.

    The climb is cut into 1,000 ft bands upward from the elevation (the last band may be shorter and
    counts in proportion). A band uses the table entry of the lowest block level at or above the band
    top; below the block that is the first table entry. The table is `{altitude ft: kg per 1,000 ft}`.
    """
    table = sorted((int(k), float(v)) for k, v in climb_kg_per_1000ft.items())
    if not table:
        raise ValueError("climb table is empty")
    if start_alt_ft <= elev_ft:
        return 0.0
    total, bottom = 0.0, float(elev_ft)
    while bottom < start_alt_ft - 1e-9:
        top = min(bottom + BAND_FT, float(start_alt_ft))
        value = next((v for k, v in table if k >= top - 1e-9), table[-1][1])
        total += value * (top - bottom) / BAND_FT
        bottom = top
    return total


def departure_climb_usd(climb_kg_per_1000ft: Mapping, elev_ft: float, start_alt_ft: float,
                        fuel_usd_per_kg: float) -> float:
    """Departure climb constant in US dollars, rounded to cents (illustrative)."""
    usd = departure_climb_kg(climb_kg_per_1000ft, elev_ft, start_alt_ft) * float(fuel_usd_per_kg)
    return round(usd, 2)


def departure_note(from_icao: str, elev_ft: float, start_alt_ft: float, fuel_usd_per_kg: float,
                   aircraft: str = "E75L") -> str:
    """The formula in words, stored next to the constant (`params.departureClimbNote`)."""
    return (
        f"Illustrative game value. Extra OpenAP {aircraft} climb fuel (params.climbExtraKgPer1000Ft) for 1,000 ft "
        f"bands from the {from_icao} elevation ({elev_ft:g} ft) to the start altitude ({start_alt_ft:g} ft), "
        f"each band at the first block level at or above its top (first table entry below the block), "
        f"the last band in proportion, times the fuel price ({fuel_usd_per_kg:g} USD/kg). "
        f"The same number is added to every flight and every game reference."
    )


def departure_usd(params: Mapping | None) -> float:
    """The constant of a case `params` mapping; 0 when absent (older case files)."""
    v = (params or {}).get("departureClimbUsd")
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) else 0.0


def with_departure(engine_total_usd: float, constant_usd: float) -> float:
    """Displayed total = engine total + departure climb constant. A diverted total is the cost up to
    the diversion + `diversionUsd` (both already in the engine total) + the constant."""
    return float(engine_total_usd) + float(constant_usd)


def references_with_departure(references: Mapping, constant_usd: float) -> dict:
    """Reference costs as displayed: completed references get the constant added; others stay None."""
    out = {}
    for name, ref in references.items():
        cost = ref.get("costUsd") if isinstance(ref, Mapping) else None
        done = isinstance(ref, Mapping) and ref.get("completed", True) is not False
        out[name] = with_departure(cost, constant_usd) if done and isinstance(cost, (int, float)) else None
    return out


def saving_share_percent(player_usd, best_usd, straight_usd):
    """(Straight-ahead - player) / (Straight-ahead - Best) x 100, capped at 100; None for an empty range.
    Adding the same constant to all three values leaves it unchanged."""
    vals = (player_usd, best_usd, straight_usd)
    if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in vals):
        return None
    rng = straight_usd - best_usd
    if not rng > 0:
        return None
    return min(100.0, (straight_usd - player_usd) / rng * 100.0)
