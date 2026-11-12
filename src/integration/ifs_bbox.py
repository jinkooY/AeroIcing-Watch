"""Dateline-aware crop boxes for IFS bundles."""
from src.analysis.route_sampler import sample_route


def normalize_bbox(south, north, west, east):
    """Return (south, north, west, east) with ``east`` unwrapped to ``west < east <= west + 360``.

    A box that crosses the antimeridian is expressed with east > 180 (e.g. 140, 240).
    """
    if not (-90 <= south < north <= 90):
        raise ValueError("bbox latitudes must satisfy -90 <= south < north <= 90")
    west = ((west + 180) % 360) - 180
    span = (east - west) % 360 or 360.0
    if span >= 360:
        span = 360.0
    return float(south), float(north), float(west), float(west + span)


def route_bbox(lat1, lon1, lat2, lon2, margin_deg=5.0):
    """Smallest lat/lon box (dateline-aware) around the great circle plus a margin."""
    pts = sample_route(lat1, lon1, lat2, lon2, 100.0)
    lats = [p[1] for p in pts]
    lons = sorted(((p[2] % 360) for p in pts))
    # Largest gap between consecutive longitudes defines where the box is NOT.
    gaps = [((lons[(i + 1) % len(lons)] - lons[i]) % 360, i) for i in range(len(lons))]
    _, i = max(gaps)
    west = lons[(i + 1) % len(lons)]
    east = lons[i]
    south = max(-90.0, min(lats) - margin_deg)
    north = min(90.0, max(lats) + margin_deg)
    west -= margin_deg
    east += margin_deg
    if (east - west) % 360 < 1e-9:
        east = west + 360
    elif east < west:
        east += 360
    return normalize_bbox(south, north, west, east)
