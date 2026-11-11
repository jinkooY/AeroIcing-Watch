# Tasks — AeroIcing Watch

## Implementation Order

Six phases, each producing a testable state. See `implementation-scope.md`
for the full rationale, estimates, and scope decisions.
All file content (comments, docstrings, variable names, UI text) must be in English.

---

## Phase 1 — Project Scaffold  (~3 hrs)

- [ ] 1.1 Create `requirements.txt` with pinned versions:
      `fastapi>=0.111.0`, `uvicorn[standard]>=0.29.0`, `numpy>=1.26,<2`,
      `netCDF4`, `pyproj>=3.6`, `requests>=2.32`, `python-dotenv`

- [ ] 1.2 Create `.gitignore` — exclude `.env`, `data/`, `__pycache__/`,
      `*.pyc`, `*.npz`, `*.nc`, `*.log`

- [ ] 1.3 Create `.env.example`:
      ```
      KMA_API_KEY=
      KMA_API_KEY2=
      GK2A_CLOUD_AREA=KO
      ```

- [ ] 1.4 Create directory skeleton with empty `__init__.py` files:
      `src/`, `src/integration/`, `src/analysis/`, `src/api/`,
      `frontend/vendor/`, `static/`

- [ ] 1.5 Move existing viewer files to `static/` (content unchanged):
      - `index.html`   → `static/viewer-standalone.html`
      - `viewer.js`    → `static/viewer.js`
      - `sample.js`    → `static/sample.js`
      - `styles.css`   → `static/styles.css`

- [ ] 1.6 Create stub `main.py`:
      - Load `.env` via `python-dotenv`
      - Mount `StaticFiles` at `/static` serving `static/`
      - Mount `StaticFiles` at `/frontend` serving `frontend/`
      - `GET /` → serve `frontend/index.html` (placeholder file for now)
      - `GET /health` → `{"status": "ok"}`

- [ ] 1.7 Verify: `uvicorn main:app --port 8080` starts; `GET /health` → 200;
      `GET /static/viewer-standalone.html` loads the existing viewer correctly

---

## Phase 2 — GK-2A Integration Layer  (~8 hrs)

Goal: `src/integration/gk2a_cloud.py` runs in isolation with no
hackerton_2026 imports.

- [ ] 2.1 Port `gk2a_cloud.py` from
      `C:\Users\I7-JIN\PycharmProjects\hackerton_2026\src\integration\gk2a_cloud.py`
      to `src/integration/gk2a_cloud.py`.

      Inline these symbols from `overlay_fetcher.py` — do NOT import that file:
      `KMA_KEY`, `KMA_KEY2`, `KMA_KEY3`, `_api_throttle`, `_atomic_write_bytes`,
      `_get_pixel_map`, `_load_latlon_ref`, `_sat_netcdf_lock`,
      `_satellite_nc_file_lock`, `_valid_sat_nc_bytes`, `_SAT_LATLON_FILES`.

      Load API keys via `os.getenv("KMA_API_KEY")`, etc. from `.env`.
      Replace `src.runtime.clock.utc_now()` with
      `datetime.now(timezone.utc)` (no demo-mode clock needed here).

- [ ] 2.2 Add `is_gk2a_daytime(dt: datetime, lat: float = 36.5, lon: float = 127.5) -> bool`
      to `src/integration/gk2a_cloud.py`.
      Simple solar-elevation check: compute solar zenith angle using stdlib
      `math`; return `True` when zenith < 80°.

- [ ] 2.3 Create `src/analysis/grid_helpers.py`:
      Port `_latlon_to_rc(lat, lon)` from
      `hackerton_2026/src/analysis/cloud_struct.py`.
      Inline the Mercator-row helper (`_mercator_lats`) it depends on.
      No other imports from hackerton_2026.

- [ ] 2.4 Create `src/analysis/cloud_base.py`:
      Port from `hackerton_2026/src/analysis/satellite_cross_section.py`:
      - `_NOH_TABLE_1`, `_CIRRUS_EXTINCTION` constants
      - `_NIGHT_MEDIAN_CWP`, `_NIGHT_THICK_FT`, `_NIGHT_PRECIP_PROB` tables
      - `deep_convection(cth_km, cwp_gm2) -> bool`
      - `noh_cloud_base_km(cth_km, cwp_gm2, cot, ctt_k) -> tuple[float|None, str]`
      - `night_cloud_water_gm2(cth_km, phase_code, emis11) -> tuple[float|None, str]`
      - `apparent_latlon(lat, lon, height_km) -> tuple[float, float]`
      - `_pixel_for(field, lat, lon) -> tuple[int,int]|None`
      Imports only: `math`, `numpy`, `src.analysis.grid_helpers`

- [ ] 2.5 Verify import chain:
      `from src.integration.gk2a_cloud import cloud_l2_runtime_status`
      runs without error in a Python REPL (no data files required).

---

## Phase 3 — Route Sampler + Icing Engine  (~6 hrs)

- [ ] 3.1 Create `src/analysis/route_sampler.py`:

      ```python
      def sample_route(
          lat1: float, lon1: float,
          lat2: float, lon2: float,
          *,
          spacing_km: float = 15.0,
          min_samples: int = 10,
          max_samples: int = 200,
      ) -> list[dict]:
          """Great-circle sample points from A to B.
          Returns list of {"lat", "lon", "distance_km"}.
          First point is always distance_km == 0.0.
          Uses stdlib math only (Haversine + spherical interpolation).
          """
      ```

      Also add `route_length_km(lat1, lon1, lat2, lon2) -> float`.

- [ ] 3.2 Create `data/airports.json` — static ICAO → lat/lon table:
      Korean civil airports: RKSI, RKSS, RKPK, RKPC, RKJJ, RKTN, RKTU,
      RKNW, RKTH, RKJK, RKSG, RKTP, RKTY, RKTJ, RKTL, RKTF, RKNN
      Japanese airports: RJTT, RJAA, RJOO, RJBB, RJFF, RJCC, RJNS
      Chinese airports: ZBAA, ZSPD, ZGGG
      Others: VHHH, RCTP
      Format: `{"RKSI": {"name": "Incheon Intl", "lat": 37.4602, "lon": 126.4407, "elev_ft": 23}}`

- [ ] 3.3 Create `src/analysis/icing_profile.py`:

      **Internal helpers:**
      - `_to_viewer_phase(phase_code: int|None) -> str|None`
        NMSC CP codes → viewer.js strings: 1→"liquid", 2→"ice", 6→"unknown", else→None
      - `_assess_icing(top_ft, base_ft, phase_code, supercooled, ctt_k, alt_ft) -> str`
        Returns "HIGH" | "MODERATE" | "LOW" | "NONE" per deterministic rules
      - `_find_altitude_suggestions(samples: list[dict], top_fl: int = 450) -> list[dict]`
        Scan for icing-free bands above and below the cloud layers
      - `_fallback_profile(lat1, lon1, lat2, lon2) -> dict`
        Returns viewer.js-compatible simulated profile with notice in `source`

      **Public API:**
      - `build_icing_profile(lat1, lon1, lat2, lon2, alt_ft, *, at, spacing_km) -> dict`
        Main function. Steps:
        1. `sample_route()` → sample points
        2. `latest_gk2a_cloud_field(at, allow_download=False)` → field or None
        3. If None → return `_fallback_profile()`
        4. For each point: `_pixel_for()`, read field values, `noh_cloud_base_km()`,
           `_assess_icing()`, assemble sample dict
        5. Assemble full profile dict with `icingRisk`, `altitudeSuggestions`,
           `disclaimer`, `routeLengthKm`
        6. Validate result passes viewer.js contract rules before returning

- [ ] 3.4 End-to-end engine check (no satellite cache):
      Call `build_icing_profile(37.4602, 126.4407, 35.5494, 139.7798, 35000)`.
      Confirm: `dataKind == "simulated"`, result passes `validProfile()` rules,
      `icingRisk` field present.

---

## Phase 4 — API Router  (~4 hrs)

- [ ] 4.1 Create `src/api/icing.py` with three endpoints:

      **`GET /api/icing/cross-section`**
      - Query params with FastAPI `Query()`: `from_lat`, `from_lon`, `to_lat`,
        `to_lon` (float, required), `alt_ft` (int, required, 0–60000),
        `at` (str, optional), `spacing_km` (float, 5–100, default 15)
      - Validate ICAO code inputs if provided (resolve via airports.json)
      - Call `build_icing_profile()` → return as `JSONResponse`
      - HTTP 422 on invalid params; HTTP 200 always when params valid
        (cache miss returns simulated profile, not 404)

      **`GET /api/icing/frames`**
      - Query param: `hours` (int, 1–72, default 24)
      - Call `cached_gk2a_cloud_field_times(now-hours, now)` from gk2a_cloud
      - Return `{"frames": [...], "count": N, "domain": "KO", "coverage": {...}}`
      - Return empty list (not 500) when no cache

      **`GET /api/icing/status`**
      - Wrap `cloud_l2_runtime_status()` — always HTTP 200
      - Add `{"api_keys_configured": bool}` field

- [ ] 4.2 Register router in `main.py`:
      `app.include_router(icing_router, prefix="/api/icing")`

- [ ] 4.3 Verify with curl:
      ```
      curl "http://localhost:8080/api/icing/cross-section?from_lat=37.46&from_lon=126.44&to_lat=35.55&to_lon=139.78&alt_ft=35000"
      # → HTTP 200, valid JSON with icingRisk field

      curl "http://localhost:8080/api/icing/cross-section?from_lat=999"
      # → HTTP 422

      curl "http://localhost:8080/api/icing/frames"
      # → HTTP 200, {"frames":[],"count":0,...}

      curl "http://localhost:8080/api/icing/status"
      # → HTTP 200
      ```

---

## Phase 5 — Frontend  (~7 hrs)

- [ ] 5.1 Create `frontend/index.html`:
      - Layout: left panel (route input), right panel (chart viewer)
      - Stacks vertically on screens < 700px
      - Reuse `styles.css` colour tokens (`--muted`, `--border`, dark palette)
      - Load order: `static/styles.css`, `static/sample.js`, `static/viewer.js`,
        `frontend/app.js`
      - Viewer DOM IDs unchanged: `#chart`, `#sample`, `#source`, `#data-kind`,
        `#top`, `#base`, `#phase`, `#cue`, `#distance`, `#readout`,
        `#profile-title`
      - New elements: `#risk-badge`, `#alt-suggestions`, `#loading`, `#error-msg`,
        `#from-input`, `#to-input`, `#alt-input`, `#time-select`, `#submit-btn`
      - Add `#top-temp` and `#icing-exposure` rows to `#readout` dl

- [ ] 5.2 Create `frontend/app.js`:
      - On `DOMContentLoaded`: fetch `/api/icing/frames` → populate `#time-select`.
        If 0 frames: show offline notice, call `loadProfile(sampleProfile)`.
      - `resolveIcao(code)`: fetch `airports.json`, return `{lat, lon}` or null.
      - Submit handler:
        1. Parse `#from-input` / `#to-input` as ICAO or `lat,lon`
        2. Build query string
        3. Show `#loading` spinner
        4. `fetch('/api/icing/cross-section?' + params)`
        5. `loadProfile(json)` → renders chart
        6. `renderRiskBadge(json.icingRisk, json.dataKind)`
        7. `renderAltSuggestions(json.altitudeSuggestions)`
        8. Update `#top-temp` and `#icing-exposure` in sample readout
      - `renderRiskBadge(level, kind)`: set text + colour on `#risk-badge`
      - `renderAltSuggestions(list)`: fill `#alt-suggestions` with advisory cards
      - Keyboard: `Enter` in any form field submits

- [ ] 5.3 Extend `static/viewer.js` (additive only — no existing lines changed):
      - After chart draw, if `current.flightAlt_ft` is set, draw a dashed
        horizontal line at that altitude across the chart
      - Update `selectSample()` to also populate `#top-temp` and
        `#icing-exposure` if elements exist in DOM

- [ ] 5.4 Syntax check: `node --check frontend/app.js` → no errors

- [ ] 5.5 Manual browser smoke test:
      - ICN (auto-resolve) → NRT (auto-resolve), FL350 → submit
      - Chart renders, risk badge visible, sample selector keyboard-accessible
      - With no satellite cache: "Simulated data" badge shown, chart still works
      - `static/viewer-standalone.html` opens directly without server

---

## Phase 6 — Polish, Docs, Git  (~3 hrs)

- [ ] 6.1 Update `README.md` (English):
      - Project summary and hackathon context (1 paragraph)
      - Architecture diagram (ASCII, matches design.md §2)
      - Quick-start: clone → pip install → set .env → uvicorn → open browser
      - API reference: 3 endpoints, key params, response shape
      - Data attribution: GK-2A CTPS, Noh et al. 2017
      - Operational disclaimer
      - Known limitations (single layer, KO domain only, no download worker)
      - What's Next section

- [ ] 6.2 Update `docs/AeroIcing_Watch_About_the_Project.md`:
      Reflect current full-stack implementation.

- [ ] 6.3 Update `docs/AeroIcing_Watch_Submission_Package.md`:
      Update Built-With list, demo URL, video script timings.

- [ ] 6.4 Confirm `.gitignore` covers all generated/secret files.

- [ ] 6.5 Stage files explicitly and commit:
      ```
      git add main.py requirements.txt .env.example
      git add src/ frontend/ static/ data/airports.json
      git add README.md docs/
      git commit -m "feat: FastAPI backend with GK-2A satellite icing cross-section

      - GK-2A CTPS L2 cloud top / phase / supercooled pipeline
      - Noh et al. (2017) statistical cloud base estimation
      - Deterministic icing risk assessment (HIGH/MODERATE/LOW/NONE)
      - Altitude suggestions (icing-free band advisory)
      - REST API: /api/icing/cross-section, /frames, /status
      - Frontend: route input UI, risk badge, alt suggestions panel
      - Fallback to synthetic data when no satellite cache"
      ```

- [ ] 6.6 Push: `git push -u origin main`

---

## Acceptance Checklist

- [ ] `uvicorn main:app --port 8080` starts cleanly
- [ ] `GET /health` returns `{"status": "ok"}`
- [ ] `GET /api/icing/cross-section` with ICN→NRT lat/lon + FL350 → HTTP 200,
      valid viewer.js-compatible JSON with `icingRisk` field
- [ ] Response passes `validProfile()` rules (title, source, dataKind,
      observedAt, samples with all required fields)
- [ ] `GET /api/icing/frames` → HTTP 200, never 500
- [ ] `GET /api/icing/status` → HTTP 200, never 500
- [ ] Cross-section renders in browser and sample selector is keyboard-accessible
- [ ] Risk badge shows level as text (not colour only)
- [ ] With no satellite cache: "Simulated data" badge, chart still renders
- [ ] `static/viewer-standalone.html` opens directly without a backend
- [ ] No `.env`, `data/*.npz`, `data/*.nc` files in git
- [ ] All source comments, docstrings, UI text in English
