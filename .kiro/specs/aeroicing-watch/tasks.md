# Tasks — AeroIcing Watch

## Implementation Plan

Work proceeds in six phases. Each phase produces a testable, runnable state.
All file content must be written in English (comments, docstrings, variable
names, error messages, UI text).

---

## Phase 1 — Project Scaffold

- [ ] 1.1 Create `requirements.txt` with pinned versions:
      `fastapi`, `uvicorn[standard]`, `numpy`, `netCDF4`, `pyproj`,
      `requests`, `python-dotenv`
- [ ] 1.2 Create `.gitignore` — exclude `.env`, `data/`, `__pycache__/`,
      `*.pyc`, `*.npz`
- [ ] 1.3 Create `.env.example` documenting required environment variables
- [ ] 1.4 Create directory skeleton:
      `src/__init__.py`, `src/integration/__init__.py`,
      `src/analysis/__init__.py`, `src/api/__init__.py`,
      `frontend/vendor/` (placeholder), `static/`
- [ ] 1.5 Move existing files to `static/`:
      `viewer.js` → `static/viewer.js`,
      `sample.js` → `static/sample.js`,
      `styles.css` → `static/styles.css`,
      `index.html` → `static/viewer-standalone.html`
- [ ] 1.6 Create stub `main.py` that starts FastAPI, mounts `static/` and
      `frontend/`, and returns HTTP 200 on `GET /`
- [ ] 1.7 Verify: `uvicorn main:app --port 8080` starts without error;
      `GET /` returns 200; `static/viewer-standalone.html` loads correctly

---

## Phase 2 — GK-2A Integration Layer

- [ ] 2.1 Port `gk2a_cloud.py` from `hackerton_2026/src/integration/` to
      `src/integration/gk2a_cloud.py`
      - Inline the following symbols from `overlay_fetcher`:
        `KMA_KEY`, `KMA_KEY2`, `KMA_KEY3`, `_api_throttle`,
        `_atomic_write_bytes`, `_get_pixel_map`, `_load_latlon_ref`,
        `_sat_netcdf_lock`, `_satellite_nc_file_lock`, `_valid_sat_nc_bytes`
      - Remove all other hackerton_2026 imports
      - Load `KMA_KEY*` from `os.getenv()` via `python-dotenv`
- [ ] 2.2 Port `is_gk2a_daytime()` from `hackerton_2026` (or implement
      a simple solar-elevation check using only stdlib `math`)
- [ ] 2.3 Port the following from `hackerton_2026/src/analysis/cloud_struct.py`:
      - `_latlon_to_rc(lat, lon)` — requires a Mercator-row helper; inline it
- [ ] 2.4 Port the following from
      `hackerton_2026/src/analysis/satellite_cross_section.py`:
      - `_NOH_TABLE_1`, `_CIRRUS_EXTINCTION` constants
      - `noh_cloud_base_km()`, `night_cloud_water_gm2()`, `deep_convection()`
      - `apparent_latlon()` (GK-2A parallax correction)
      - `_pixel_for()` (parallax-corrected grid lookup)
      Place these in `src/analysis/icing_profile.py` (see Phase 3)
- [ ] 2.5 Verify: in a Python REPL, `from src.integration.gk2a_cloud import
      cloud_l2_runtime_status; print(cloud_l2_runtime_status())` runs without
      import error (data files not required for this check)

---

## Phase 3 — Route Sampler + Icing Engine

- [ ] 3.1 Write `src/analysis/route_sampler.py`
      - `sample_route(lat1, lon1, lat2, lon2, *, spacing_km, min_samples,
        max_samples) -> list[dict]`
      - Each dict: `{"lat": float, "lon": float, "distance_km": float}`
      - First point: `distance_km == 0.0`
      - Use only stdlib `math` (Haversine + spherical interpolation)
- [ ] 3.2 Write `src/analysis/icing_profile.py`
      - `_assess_icing(top_ft, base_ft, phase_code, supercooled, ctt_k,
        alt_ft) -> str`  — returns `"HIGH"`, `"MODERATE"`, `"LOW"`, `"NONE"`
      - `_to_viewer_phase(phase_code) -> str | None` — NMSC code → viewer.js string
      - `_fallback_profile(lat1, lon1, lat2, lon2) -> dict` — returns
        `dataKind: "simulated"` profile built from synthetic sample data
      - `build_icing_profile(lat1, lon1, lat2, lon2, alt_ft, *, at,
        spacing_km) -> dict` — main public function
- [ ] 3.3 Verify engine end-to-end with synthetic data:
      Call `build_icing_profile(37.46, 126.44, 35.55, 139.78, 35000)` with no
      satellite cache present; confirm `dataKind == "simulated"` and the
      result passes the viewer.js `validProfile` logic (port the validator to
      a Python helper for this check)

---

## Phase 4 — API Router

- [ ] 4.1 Write `src/api/icing.py`
      - `GET /api/icing/cross-section` — calls `build_icing_profile()`,
        returns profile JSON; HTTP 422 on invalid params
      - `GET /api/icing/frames` — calls `cached_gk2a_cloud_field_times()`,
        returns `{"frames": [...], "count": N}`; returns empty list when no
        cache
      - `GET /api/icing/status` — wraps `cloud_l2_runtime_status()`;
        always returns HTTP 200 (never 500 for missing config)
- [ ] 4.2 Register router in `main.py` with prefix `/api/icing`
- [ ] 4.3 Verify with curl / httpie:
      - `GET /api/icing/cross-section?from_lat=37.46&from_lon=126.44&to_lat=35.55&to_lon=139.78&alt_ft=35000`
        → HTTP 200, valid JSON
      - `GET /api/icing/cross-section?from_lat=999` → HTTP 422
      - `GET /api/icing/frames` → HTTP 200, `{"frames":[],"count":0}`
      - `GET /api/icing/status` → HTTP 200

---

## Phase 5 — Frontend

- [ ] 5.1 Write `frontend/index.html`
      - Route input form: from / to fields (ICAO or lat,lon), altitude field,
        timestamp dropdown, submit button
      - Icing risk badge element (`#risk-badge`)
      - Load `static/styles.css`, `static/sample.js`, `static/viewer.js`,
        then `frontend/app.js`
      - Cross-section section reuses existing `viewer.js` DOM IDs unchanged
- [ ] 5.2 Write `frontend/app.js`
      - On load: `GET /api/icing/frames` → populate timestamp dropdown
      - If no frames available: load synthetic profile from `sampleProfile`
        (from `sample.js`) and show offline notice
      - Submit handler: build query string → `fetch('/api/icing/cross-section')`
        → call `loadProfile(json)` → update `#risk-badge`
      - Risk badge: text label + colour (HIGH red / MODERATE amber /
        LOW green / NONE muted)
      - Display `source` and `observedAt` in existing `#source` element
- [ ] 5.3 Confirm `frontend/index.html` passes `node --check frontend/app.js`
      (syntax only)
- [ ] 5.4 Manual smoke test in browser:
      - ICN (37.4602, 126.4407) → NRT (35.7647, 140.3864) at FL350
      - Chart renders, risk badge shows, sample selector works with keyboard

---

## Phase 6 — Polish, Docs, Git

- [ ] 6.1 Update `README.md` in English:
      - Project summary and hackathon context
      - Architecture diagram (ASCII)
      - Quick-start instructions (clone → pip install → set .env → run)
      - API reference (3 endpoints, params, response shapes)
      - Data source attribution (GK-2A CTPS, Noh et al. 2017)
      - Known limitations (single layer, no download worker, KO domain only)
- [ ] 6.2 Update `docs/AeroIcing_Watch_About_the_Project.md` to reflect the
      current full-stack implementation
- [ ] 6.3 Update `docs/AeroIcing_Watch_Submission_Package.md` with final
      built-with list, demo URL placeholder, and updated video script
- [ ] 6.4 Confirm `.gitignore` covers `.env`, `data/`, `__pycache__/`,
      `*.pyc`, `*.npz`, `*.nc`
- [ ] 6.5 Stage all new files explicitly (no `git add -A`), create commit:
      `feat: add FastAPI backend with GK-2A satellite icing cross-section`
- [ ] 6.6 Push to `origin/main`:
      `git push -u origin main`

---

## Acceptance Checklist (pre-submission)

- [ ] App starts with `uvicorn main:app --port 8080`
- [ ] `GET /` serves the route input page
- [ ] `GET /api/icing/cross-section` with valid ICN→NRT params returns a
      `viewer.js`-compatible profile
- [ ] Cross-section renders in the browser and is keyboard accessible
- [ ] Icing risk badge (HIGH/MODERATE/LOW/NONE) is visible with a text label
- [ ] With no satellite cache: app shows synthetic data with "Simulated data" badge
- [ ] `static/viewer-standalone.html` opens without a backend
- [ ] No `.env`, `data/`, or `*.npz` files in git history
- [ ] All source code comments, docstrings, and UI text are in English
