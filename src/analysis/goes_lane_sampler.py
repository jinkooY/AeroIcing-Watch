"""Sample a GOES CONUS scene along Cloud Dive lanes.

For each lane point the sampler finds the cloud that sits over that ground point (parallax-corrected),
reads phase, cloud-top height and cloud water at the pixel where the satellite actually sees it, and
returns a satellite record for `evidence.evaluate_cell`:

    {state, top_ft, base_ft, supercooled, ...provenance fields}

States: observed, clear, no_retrieval, quality_rejected, inconsistent_retrieval, outside_domain.
Only `observed` and `clear` carry evidence (see evidence.py). Nothing is filled in: missing values
stay None with a state. Cloud base is a statistical estimate (Noh et al. 2017) with its method kept.
"""
from __future__ import annotations

import math
from datetime import datetime

import numpy as np

from src.analysis.cloud_base import apparent_latlon, estimate_base, solar_zenith_deg
from src.analysis.lanes import Lanes
from src.integration.goes_conus import ConusScene, Layer

M_TO_FT = 3.28084
SZA_MAX_DEG = 80.0
HEIGHTS_KM = np.arange(0.25, 16.0 + 1e-9, 0.25)
ICE_DENSITY = 0.917

# Phase DQF: bit 0 set = overall degraded -> rejected. Height DQF must be 0.
# COD/CPS DQF bits: 0 not day algorithm, 2 degraded, 5 non-convergence, 6 glint.
_BIT_NOT_DAY = 1 << 0
_BIT_DEGRADED = 1 << 2
_BIT_NONCONVERGED = 1 << 5
_BIT_GLINT = 1 << 6

PHASE_SUPERCOOLED = {0: None, 1: False, 2: True, 3: False, 4: False, 5: None}
BASE_METHOD_RELABEL = {"dcoew": "goes_cod_cps"}


def _pixel(layer: Layer, projection, lat: float, lon: float):
    r, c, ok = layer.rowcol(projection, [lat], [lon])
    if not bool(ok[0]):
        return None
    return int(r[0]), int(c[0])


def _locate_cloud(scene: ConusScene, lat: float, lon: float):
    """Parallax-corrected cloud position over ground point (lat, lon).

    Returns (apparent_lat, apparent_lon, height_m, good_quality) or None when no height pixel is
    consistent with a cloud over this point. A candidate height h is consistent when the height pixel
    where a top at h appears reports a top at or above h; the highest such h is refined by
    interpolating the sign change of r(h) = HT(apparent(h)) - h.
    """
    layer = scene.layers["height"]
    sub = scene.sub_lon
    apparent = [apparent_latlon(lat, lon, float(h), sub) for h in HEIGHTS_KM]
    alat = np.array([a[0] for a in apparent])
    alon = np.array([a[1] for a in apparent])
    rows, cols, ok = layer.rowcol(scene.projection, alat, alon)
    ht_km = np.where(ok, layer.values[rows, cols].astype(float) / 1000.0, np.nan)
    good = ok & (layer.dqf[rows, cols] == 0)
    for require_good in (True, False):
        valid = np.isfinite(ht_km) & (good if require_good else True)
        resid = np.where(valid, ht_km - HEIGHTS_KM, np.nan)
        hits = np.flatnonzero(valid & (resid >= 0))
        if hits.size == 0:
            continue
        i = int(hits[-1])
        h = float(HEIGHTS_KM[i])
        if i + 1 < len(HEIGHTS_KM) and valid[i + 1] and resid[i + 1] < 0:
            r0, r1 = resid[i], resid[i + 1]
            h += float(HEIGHTS_KM[i + 1] - HEIGHTS_KM[i]) * r0 / (r0 - r1)
        alat_i, alon_i = apparent_latlon(lat, lon, h, sub)
        px = _pixel(layer, scene.projection, alat_i, alon_i)
        if px is None or not math.isfinite(float(layer.values[px])):
            px = (int(rows[i]), int(cols[i]))
            alat_i, alon_i = float(alat[i]), float(alon[i])
        return alat_i, alon_i, float(layer.values[px]), require_good
    return None


def _record(state: str, **extra) -> dict:
    rec = {
        "state": state, "top_ft": None, "base_ft": None, "supercooled": None, "phase_code": None,
        "base_method": None, "cloud_water_quality": None, "cloud_water_nonconverged": None,
        "parallax_km": None, "lwp_gm2": None,
    }
    rec.update(extra)
    return rec


def _cloud_water(scene: ConusScene, lat: float, lon: float, phase: int, sza: float):
    """(lwp, iwp, quality, nonconverged) in g m-2 or (None, None, None, None)."""
    cod, cps = scene.layers["cod"], scene.layers["cps"]
    pc, ps = _pixel(cod, scene.projection, lat, lon), _pixel(cps, scene.projection, lat, lon)
    if pc is None or ps is None or sza >= SZA_MAX_DEG:
        return None, None, None, None
    tau, re_um = float(cod.values[pc]), float(cps.values[ps])
    dqf = int(cod.dqf[pc]) | int(cps.dqf[ps])
    if not (math.isfinite(tau) and math.isfinite(re_um)) or dqf & (_BIT_NOT_DAY | _BIT_GLINT):
        return None, None, None, None
    water = 2.0 / 3.0 * tau * re_um
    quality = "degraded" if dqf & _BIT_DEGRADED else "good"
    nonconv = bool(dqf & _BIT_NONCONVERGED)
    if phase == 4:
        return None, water * ICE_DENSITY, quality, nonconv
    return water, None, quality, nonconv


def sample_point(scene: ConusScene, lat: float, lon: float) -> dict:
    """Satellite record for one ground point."""
    phase_layer = scene.layers["phase"]
    if _pixel(phase_layer, scene.projection, lat, lon) is None:
        return _record("outside_domain")

    located = _locate_cloud(scene, lat, lon)
    if located is None:
        alat, alon, height_m, good = lat, lon, None, True
    else:
        alat, alon, height_m, good = located
    px = _pixel(phase_layer, scene.projection, alat, alon)
    if px is None:
        return _record("outside_domain")
    code = int(phase_layer.values[px])
    pdqf = int(phase_layer.dqf[px])

    if code == 255:
        return _record("no_retrieval")
    if code not in PHASE_SUPERCOOLED:
        return _record("no_retrieval")
    if code != 0 and pdqf & 1:
        return _record("quality_rejected", phase_code=code)
    if code == 0:
        return _record("inconsistent_retrieval", phase_code=0) if height_m is not None and good else _record("clear", phase_code=0)
    if height_m is None:
        return _record("no_retrieval", phase_code=code)
    if not good:
        return _record("quality_rejected", phase_code=code)

    parallax_km = float(math.hypot((alat - lat) * 111.2, (alon - lon) * 111.2 * math.cos(math.radians(lat))))
    top_ft = height_m * M_TO_FT
    sza = solar_zenith_deg(scene.start, alat, alon)
    lwp, iwp, quality, nonconv = _cloud_water(scene, alat, alon, code, sza)
    cot = None
    base_ft, method = estimate_base(
        top_ft, code, None, None, lwp is not None or iwp is not None, 0.0, lwp, iwp, cot
    )
    method = BASE_METHOD_RELABEL.get(method, method)
    return _record(
        "observed", top_ft=round(top_ft), base_ft=base_ft, supercooled=PHASE_SUPERCOOLED[code],
        phase_code=code, base_method=method, cloud_water_quality=quality,
        cloud_water_nonconverged=nonconv, parallax_km=round(parallax_km, 1),
        lwp_gm2=None if lwp is None else round(lwp, 1),
    )


def sample_lanes(scene: ConusScene, lanes: Lanes) -> list[list[dict]]:
    """`[lane][step]` satellite records for every lane point."""
    return [
        [sample_point(scene, float(lanes.lat[i][k]), float(lanes.lon[i][k])) for k in range(lanes.n_steps + 1)]
        for i in range(lanes.n_lanes)
    ]


def provenance(scene: ConusScene) -> dict:
    return {
        **scene.provenance(),
        "method": "goes-conus-lane-sampler-v1",
        "cloudBase": "Noh et al. 2017 statistical estimate (not an observation)",
    }
