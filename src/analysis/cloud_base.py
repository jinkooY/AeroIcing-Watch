"""WeatherPath cloud-top parallax and Noh cloud-base estimation.

Adapted from WeatherPath satellite_cross_section.py and gk2a_cloud.py.
"""

import math
from datetime import datetime, timezone

import numpy as np

_KM_TO_FT = 3280.84

# Geostationary parallax: GK-2A sub-satellite point and orbit radius.
_GK2A_SUB_LON = 128.2
_EARTH_R_KM = 6378.137
_ORBIT_R_KM = 42164.0

# Noh et al. 2017 Table 1: (CTH bin lower km, CWP threshold g m-2,
# (a, b) below threshold, (a, b) at/above threshold); CGT km, CWP kg m-2.
_NOH_TABLE_1 = (
    (0, 71, (2.2581, 0.4056), (0.9970, 0.5170)),
    (2, 114, (6.1098, 0.6648), (0.9130, 1.3570)),
    (4, 110, (11.5574, 1.2253), (1.3792, 2.5866)),
    (6, 123, (14.5382, 1.7057), (1.6871, 3.6228)),
    (8, 131, (9.0986, 2.1425), (2.4595, 3.8696)),
    (10, 127, (13.5772, 1.8655), (4.8309, 3.5314)),
    (12, 115, (16.0793, 1.6497), (5.0517, 3.9861)),
    (14, 116, (14.6030, 2.0001), (6.0644, 4.0330)),
    (16, 99, (9.2658, 2.2964), (6.6043, 3.2644)),
)
# Noh et al. 2017 Table 2: cirrus extinction (km-1) by CTT upper bound (K).
_CIRRUS_EXTINCTION = ((200.0, 0.13), (220.0, 0.25), (240.0, 0.39), (260.0, 0.55), (math.inf, 0.67))
_CIRRUS_MIN_CTH_KM = 5.0
# DCOEW_DQF: 0 valid, 1 twilight-degraded but valid, 6 valid in sunglint.
_DCOEW_VALID_DQF = (0.0, 1.0, 6.0)

# Night CWP.  11 µm emissivity e → vertical IR absorption optical depth
# −μ·ln(1−e), visible COT ≈ 2× that, CWP = 2/3·ρ·COT·r_e.  Emissivity
# saturates for thick cloud; those fall back to the median DCOEW CWP.
_EMISSIVITY_SATURATION = 0.95
_VIEW_ZENITH_COS = math.cos(math.radians(43.5))   # GK-2A over the peninsula
_RE_WATER_UM = 10.0
_RE_ICE_UM = 30.0
_RHO_ICE = 0.917
# Median DCOEW CWP (g m-2) by (CTH 2 km bin, phase 1 water / 2 ice / 0 any),
# from ten 2026-07/08 daytime GK-2A scenes over the RKSW domain (ceilometer-
# verified exploration, 2026-10-29).  Provisional; re-derive from the DCOEW
# cache once a season of daytime fields has accumulated.
_NIGHT_MEDIAN_CWP = {
    (0, 0): 40.3, (0, 1): 40.3,
    (1, 0): 101.3, (1, 1): 101.4, (1, 2): 17.4,
    (2, 0): 106.5, (2, 1): 170.6, (2, 2): 19.9,
    (3, 0): 42.3, (3, 1): 255.5, (3, 2): 30.2,
    (4, 0): 69.6, (4, 1): 279.6, (4, 2): 67.7,
    (5, 0): 104.6, (5, 2): 104.6,
    (6, 0): 115.2, (6, 2): 115.2,
    (7, 0): 501.2, (7, 2): 501.2,
}

# Night, emissivity-saturated ("median") columns, verified against EarthCARE
# CPR CLP vCb cloud base (lowest particle type 1-4 bin of the top layer;
# precipitation types 5-9 excluded): 83,255 profiles, 410 passes, 2024-10 ~
# 2026-10, tools/sat_cbh/thick_table.py --min-pass-gain 0.10 --emit.
# Effective thickness = GK-2A top − CPR cloud base (ft): median, p25, p75,
# passes.  Only cells whose leave-one-pass-out MAE beat the median-CWP base by
# ≥ 10 % (rows and pass average) are listed: mid-level water 4–6 / 6–8 / 8–10
# km tops (−32 / −46 / −12 %).  Other cells keep the median-CWP base.
_NIGHT_THICK_FT = {  # (CTH 2 km bin, phase)
    (2, 1): (3710, 330, 7710, 187),
    (3, 1): (6040, 3440, 9740, 81),
    (4, 1): (10600, 6300, 14440, 15),
}

def _is_finite(value) -> bool:
    return value is not None and np.isfinite(value)


def deep_convection(cth_km: float, cwp_gm2: float) -> bool:
    """Optically thick deep convection per Noh et al. (2017) §4c."""
    threshold = float(np.interp(cth_km, [6.5, 7.5], [1000.0, 1200.0]))
    return cwp_gm2 >= threshold


def noh_cloud_base_km(
    cth_km: float,
    cwp_gm2: float | None,
    cot: float | None = None,
    ctt_k: float | None = None,
) -> tuple[float | None, str]:
    """Cloud base (km MSL) of the topmost layer and the branch that set it."""
    if not _is_finite(cth_km) or not _is_finite(cwp_gm2):
        return None, "unavailable"
    if _is_finite(cot) and cot < 1.0 and cth_km >= _CIRRUS_MIN_CTH_KM:
        ctt = ctt_k if _is_finite(ctt_k) else 230.0
        extinction = next(e for bound, e in _CIRRUS_EXTINCTION if ctt < bound)
        thickness = cot / extinction
        return cth_km + thickness / 2.0 - thickness, "cirrus"
    if deep_convection(cth_km, cwp_gm2):
        return None, "deep_convection"
    row = _NOH_TABLE_1[min(int(cth_km // 2), len(_NOH_TABLE_1) - 1)]
    a, b = row[2] if cwp_gm2 < row[1] else row[3]
    return cth_km - (a * cwp_gm2 / 1000.0 + b), "regression"


def night_cloud_water_gm2(
    cth_km: float,
    phase_code: int | None,
    emis11: float | None,
) -> tuple[float | None, str]:
    """Night-time CWP proxy and its source ("emissivity" or "median")."""
    ice = phase_code == 2
    if _is_finite(emis11):
        e = min(max(float(emis11), 0.0), 0.999)
        if e < _EMISSIVITY_SATURATION:
            cot = 2.0 * (-math.log(1.0 - e)) * _VIEW_ZENITH_COS
            rho, re_um = (_RHO_ICE, _RE_ICE_UM) if ice else (1.0, _RE_WATER_UM)
            return (2.0 / 3.0) * rho * cot * re_um, "emissivity"
    band = int(min(max(cth_km, 0.0) // 2, 8))
    key = 2 if ice else (1 if phase_code == 1 else 0)
    value = _NIGHT_MEDIAN_CWP.get((band, key), _NIGHT_MEDIAN_CWP.get((band, 0)))
    if value is None:
        # Bins above the sampled heights reuse the highest known bin.
        value = _NIGHT_MEDIAN_CWP[(7, 0)]
    return value, "median"


def view_zenith_deg(lat: float, lon: float, sub_lon: float | None = None) -> float:
    """Satellite view zenith angle at (lat, lon) for a geostationary satellite at sub_lon."""
    lat_r = math.radians(lat)
    dlon_r = math.radians(lon - (_GK2A_SUB_LON if sub_lon is None else sub_lon))
    cos_c = math.cos(lat_r) * math.cos(dlon_r)
    central = math.acos(max(-1.0, min(1.0, cos_c)))
    beta = math.atan2(_EARTH_R_KM * math.sin(central), _ORBIT_R_KM - _EARTH_R_KM * cos_c)
    return math.degrees(central + beta)


def apparent_latlon(
    lat: float, lon: float, height_km: float, sub_lon: float | None = None,
) -> tuple[float, float]:
    """Where a cloud top at ``height_km`` over (lat, lon) appears to a geostationary
    satellite at ``sub_lon`` (default: GK-2A)."""
    if not _is_finite(height_km) or height_km <= 0:
        return lat, lon
    lat_r = math.radians(lat)
    dlon_r = math.radians(lon - (_GK2A_SUB_LON if sub_lon is None else sub_lon))
    cos_c = math.cos(lat_r) * math.cos(dlon_r)
    central = math.acos(max(-1.0, min(1.0, cos_c)))
    beta = math.atan2(_EARTH_R_KM * math.sin(central), _ORBIT_R_KM - _EARTH_R_KM * cos_c)
    shift_km = height_km * math.tan(central + beta)
    azimuth = math.atan2(math.sin(dlon_r), math.tan(lat_r))  # away from sub-point
    return (
        lat + shift_km * math.cos(azimuth) / 111.2,
        lon + shift_km * math.sin(azimuth) / (111.2 * math.cos(lat_r)),
    )


_DAYTIME_MAX_SZA_DEG = 80.0  # NMSC DCOEW is invalid beyond SZA 80°
_DAYTIME_REF_LAT, _DAYTIME_REF_LON = 36.5, 127.5


def solar_zenith_deg(dt: datetime, lat: float, lon: float) -> float:
    """Approximate solar zenith angle (NOAA low-precision formula, ±0.5°)."""
    dt = dt.astimezone(timezone.utc)
    day = dt.timetuple().tm_yday
    hour = dt.hour + dt.minute / 60.0
    gamma = 2.0 * np.pi / 365.0 * (day - 1 + (hour - 12.0) / 24.0)
    decl = (0.006918 - 0.399912 * np.cos(gamma) + 0.070257 * np.sin(gamma)
            - 0.006758 * np.cos(2 * gamma) + 0.000907 * np.sin(2 * gamma)
            - 0.002697 * np.cos(3 * gamma) + 0.00148 * np.sin(3 * gamma))
    eqtime = 229.18 * (0.000075 + 0.001868 * np.cos(gamma) - 0.032077 * np.sin(gamma)
                       - 0.014615 * np.cos(2 * gamma) - 0.040849 * np.sin(2 * gamma))
    solar_minutes = hour * 60.0 + eqtime + 4.0 * lon
    hour_angle = np.radians(solar_minutes / 4.0 - 180.0)
    lat_r = np.radians(lat)
    cos_z = (np.sin(lat_r) * np.sin(decl)
             + np.cos(lat_r) * np.cos(decl) * np.cos(hour_angle))
    return float(np.degrees(np.arccos(np.clip(cos_z, -1.0, 1.0))))


def is_gk2a_daytime(dt: datetime) -> bool:
    return solar_zenith_deg(dt, _DAYTIME_REF_LAT, _DAYTIME_REF_LON) < _DAYTIME_MAX_SZA_DEG


def estimate_base(
    top_ft: float,
    phase: int | None,
    ctt: float | None,
    emissivity: float | None,
    daytime: bool,
    optical_quality: float | None,
    lwp: float | None,
    iwp: float | None,
    cot: float | None,
) -> tuple[int | None, str]:
    """Estimate the base of the topmost layer in ft MSL."""
    top_km = top_ft / _KM_TO_FT
    if daytime and optical_quality in _DCOEW_VALID_DQF and (lwp is not None or iwp is not None):
        cwp = (lwp or 0.0) + (iwp or 0.0)
        source = "dcoew"
    else:
        cwp, source = night_cloud_water_gm2(top_km, phase, emissivity)
        cot = None

    base_km, method = noh_cloud_base_km(top_km, cwp, cot, ctt)
    if base_km is None:
        return None, method
    if method == "regression":
        method = source
    if not daytime and method == "median":
        thickness = _NIGHT_THICK_FT.get((min(int(top_km // 2), 8), phase))
        if thickness is not None:
            return round(max(top_ft - thickness[0], -2000)), "night_thick"
    return round(max(-2000, min(base_km * _KM_TO_FT, top_ft))), method
