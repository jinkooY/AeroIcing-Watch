# Design — AeroIcing Watch

## 1. Architecture Overview

AeroIcing Watch evolves the current client-only prototype into a
**FastAPI backend + vanilla JS frontend** stack while keeping the existing
`viewer.js` chart engine untouched.

```
Browser
  │  Route form → submit
  ▼
frontend/app.js
  │  GET /api/icing/cross-section?from_lat=…&to_lat=…&alt_ft=…&at=…
  ▼
main.py  (FastAPI)
  │  Request validation → router dispatch
  ▼
src/api/icing.py              Router — validates params, calls engine
  │
  ▼
src/analysis/icing_profile.py  Engine
  │  ① route_sampler.py  → great-circle sample points (lat, lon, distKm)
  │  ② gk2a_cloud.py     → load_cached_gk2a_cloud_field(dt, area)
  │  ③ per-sample        → grid lookup + Noh base est. + icing rule
  │  ④ assemble viewer.js-compatible profile JSON
  ▼
frontend/app.js
  │  loadProfile(json)  →  viewer.js renders Canvas chart
  ▼
Browser (chart + risk badge)
```

---

## 2. Module Responsibilities

### `main.py`
- FastAPI app assembly
- Mount `static/` for `viewer.js`, `sample.js`, `styles.css`
- Mount `frontend/` for `index.html`, `app.js`, `vendor/`
- Register `/api/icing` router
- Load `.env` on startup

### `src/integration/gk2a_cloud.py`
Ported directly from `hackerton_2026/src/integration/gk2a_cloud.py`.

Trimmed dependencies — only the following overlay_fetcher symbols are inlined:
`KMA_KEY`, `KMA_KEY2`, `KMA_KEY3`, `_api_throttle`, `_atomic_write_bytes`,
`_get_pixel_map`, `_load_latlon_ref`, `_sat_netcdf_lock`,
`_satellite_nc_file_lock`, `_valid_sat_nc_bytes`.

Public API used by this project:

| Function | Purpose |
|---|---|
| `load_cached_gk2a_cloud_field(dt, area)` | Read a projected npz field without download |
| `latest_gk2a_cloud_field(dt, allow_download)` | Newest available field ≤ dt |
| `cached_gk2a_cloud_field_times(start, end)` | List cached timestamps in range |
| `cloud_l2_runtime_status()` | Collection health dict |
| `is_gk2a_daytime(dt, lat, lon)` | Day/night flag for base estimation |

### `src/analysis/route_sampler.py`
Great-circle route sampler. No external dependencies beyond `math`.

```python
def sample_route(
    lat1: float, lon1: float,
    lat2: float, lon2: float,
    *,
    spacing_km: float = 15.0,
    min_samples: int = 10,
    max_samples: int = 200,
) -> list[dict]:
    """Return list of {lat, lon, distance_km} dicts along the great circle."""
```

Logic: Haversine distance → compute N → interpolate intermediate lat/lon via
the standard spherical linear formula. First point is always `distance_km: 0`.

### `src/analysis/icing_profile.py`
Core engine. Converts a satellite field + route into a `viewer.js`-compatible
profile dict.

Key public function:

```python
def build_icing_profile(
    lat1: float, lon1: float,
    lat2: float, lon2: float,
    alt_ft: int,
    *,
    at: datetime | None = None,
    spacing_km: float = 15.0,
) -> dict:
    """
    Returns a viewer.js-compatible profile dict.
    Falls back to the synthetic SAMPLE_PROFILE when no cache exists.
    """
```

Internal steps:

1. `route_sampler.sample_route(...)` → sample point list
2. `latest_gk2a_cloud_field(at, allow_download=False)` → field dict or None
3. If field is None → return `_fallback_profile(lat1, lon1, lat2, lon2)`
4. For each sample point:
   - `_pixel_for(field, lat, lon)` (parallax-corrected grid lookup)
   - Read `cth_ft`, `ctt_k`, `phase`, `supercooled`, `emis11`
   - If daytime: attempt DCOEW CWP; else: `night_cloud_water_gm2()`
   - `noh_cloud_base_km()` → `baseFt`
   - `_assess_icing(top_ft, base_ft, phase_code, supercooled, ctt_k, alt_ft)` → risk
5. Assemble profile; set `icingRisk` = max sample risk

Icing assessment (deterministic):

```python
def _assess_icing(
    top_ft: int | None,
    base_ft: int | None,
    phase_code: int | None,
    supercooled: bool | None,
    ctt_k: float | None,
    alt_ft: int,
) -> str:
    """Return 'HIGH' | 'MODERATE' | 'LOW' | 'NONE'."""
```

Phase code → viewer.js phase string mapping:

| NMSC code | viewer.js string |
|---|---|
| 1 | `"liquid"` |
| 2 | `"ice"` |
| 6 | `"unknown"` |
| 0 / NaN | `null` |

### `src/api/icing.py`
FastAPI router mounted at `/api/icing`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/icing/cross-section` | Main profile endpoint |
| `GET` | `/api/icing/frames` | Available satellite timestamps |
| `GET` | `/api/icing/status` | GK-2A collection health |

**`GET /api/icing/cross-section` parameters:**

| Param | Type | Default | Validation |
|---|---|---|---|
| `from_lat` | float | required | −90 to 90 |
| `from_lon` | float | required | −180 to 180 |
| `to_lat` | float | required | −90 to 90 |
| `to_lon` | float | required | −180 to 180 |
| `alt_ft` | int | required | 0 to 60 000 |
| `at` | str (ISO UTC) | latest frame | optional |
| `spacing_km` | float | 15.0 | 5 to 100 |

**Response (viewer.js profile contract):**

```json
{
  "title": "ICN → NRT · FL350 · 2026-11-11T03:00Z",
  "dataKind": "observation",
  "source": "GK-2A CTPS L2 (NMSC) · KO domain",
  "observedAt": "2026-11-11T03:00:00Z",
  "icingRisk": "MODERATE",
  "flightAlt_ft": 35000,
  "samples": [
    {
      "distanceKm": 0,
      "topFt": 28000,
      "baseFt": 22000,
      "phase": "ice",
      "supercooled": false,
      "icingExposure": false
    }
  ]
}
```

`icingExposure: true` = planned altitude is within the cloud layer AND an
icing condition applies.

**`GET /api/icing/frames` response:**

```json
{
  "frames": [
    {"ts": "2026-11-11T03:00:00Z", "age_min": 4},
    {"ts": "2026-11-11T02:50:00Z", "age_min": 14}
  ],
  "count": 2
}
```

**`GET /api/icing/status` response:**

```json
{
  "source": "GK2A_L2_CTPS",
  "configured_slots": [{"slot": 1, "endpoint": "public"}],
  "latest_field": {"ts": "202611110300", "bytes": 1234567},
  "status": {"stage": "raw_downloaded", "updated_utc": "…"}
}
```

---

## 3. Frontend Design

### `frontend/index.html`
Single-page layout: route input panel on the left, full-width cross-section
viewer on the right (stacks vertically on narrow screens).

Reuses `styles.css` colour tokens. Adds a risk badge element and a timestamp
dropdown.

### `frontend/app.js`
Responsibilities:
1. Populate timestamp dropdown from `GET /api/icing/frames`
2. Submit handler → build query params → `fetch('/api/icing/cross-section')`
3. On response → call existing `loadProfile(json)` from `viewer.js`
4. Display `icingRisk` badge with colour and text label
5. Display source/timestamp in existing `#source` element

Risk badge colour mapping (text label is always present):

| Level | Colour |
|---|---|
| HIGH | `#ff6b6b` |
| MODERATE | `#ffa94d` |
| LOW | `#69db7c` |
| NONE | `#a9bdd1` |

### Leaflet map (optional for hackathon scope)
A small map showing the A–B route line and sample dots aids spatial awareness.
Can be added after the core viewer is working. Uses `frontend/vendor/leaflet/`.

---

## 4. Data Flow — Satellite Cache

The backend **never downloads** satellite data at request time. Downloads
happen in a separate worker process (future work). For the hackathon, the
cache is populated manually or via the hackerton_2026 worker.

```
hackerton_2026 worker  →  data/overlay/gk2a_l2/FIELD/KO/YYYYMMDD/YYYYMMDDHHMM.npz
                                                  ↑
aeroicing-watch backend reads from same path (symlink or copy)
```

Cache miss behaviour: `build_icing_profile()` returns the synthetic fallback
profile (`dataKind: "simulated"`) with a notice embedded in `source`.

---

## 5. File Movement — Existing Assets

Current root-level files move to `static/` to keep the root clean, but their
content and the `viewer.js` JSON contract remain unchanged.

| Current path | New path |
|---|---|
| `index.html` | `static/viewer-standalone.html` (kept for offline use) |
| `viewer.js` | `static/viewer.js` |
| `sample.js` | `static/sample.js` |
| `styles.css` | `static/styles.css` |

The new `frontend/index.html` is the app entry point served by FastAPI.

---

## 6. Configuration (`.env`)

```
KMA_API_KEY=<public APIHub key>
KMA_API_KEY2=<private APIHub key — optional>
GK2A_CLOUD_AREA=KO
```

---

## 7. What This Design Deliberately Excludes

- No real-time satellite download worker (hackathon scope)
- No authentication (public demo)
- No LLM or NWP (KIM / ECMWF) inputs — satellite only
- No separate worker process — single uvicorn instance
- No database — filesystem cache only
