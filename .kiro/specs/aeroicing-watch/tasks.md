# Tasks — AeroIcing Watch

## Implementation Order

Follow the [backend-first plan](backend-first-plan.md) for the current implementation order. Complete the observation API, route evaluation and replay before starting the separate frontend design pass. The Phase 1 checks below record the completed baseline.

Six phases, each producing a testable state. See `implementation-scope.md`
for the full rationale, estimates, and scope decisions.
All file content (comments, docstrings, variable names, UI text) must be in English.

---

## Phase 1 — Project Scaffold  (~3 hrs)

- [x] 1.1 Create `requirements.txt` with these constraints:
      `fastapi>=0.111.0`, `uvicorn[standard]>=0.29.0`, `numpy>=1.26,<2`,
      `netCDF4`, `pyproj>=3.6`, `requests>=2.32`, `python-dotenv`

- [x] 1.2 Create `.gitignore` — exclude `.env`, `data/`, `__pycache__/`,
      `*.pyc`, `*.npz`, `*.nc`, `*.log`

- [x] 1.3 Create `.env.example`:
      ```
      KMA_API_KEY=
      KMA_API_KEY2=
      GK2A_CLOUD_AREA=KO
      ```

- [x] 1.4 Create directory skeleton with empty `__init__.py` files:
      `src/`, `src/integration/`, `src/analysis/`, `src/api/`,
      `frontend/vendor/`, `static/`

- [x] 1.5 Move existing viewer files to `static/` (content unchanged):
      - `index.html`   → `static/viewer-standalone.html`
      - `viewer.js`    → `static/viewer.js`
      - `sample.js`    → `static/sample.js`
      - `styles.css`   → `static/styles.css`

- [x] 1.6 Create stub `main.py`:
      - Load `.env` via `python-dotenv`
      - Mount `StaticFiles` at `/static` serving `static/`
      - Mount `StaticFiles` at `/frontend` serving `frontend/`
      - `GET /` → serve `frontend/index.html` (placeholder file for now)
      - `GET /health` → `{"status": "ok"}`

- [x] 1.7 Verify: Uvicorn starts; `GET /health` → 200;
      `GET /static/viewer-standalone.html` loads the existing viewer correctly
      (verified on port 18080 because 8080 was in use).

---

## Phase 2 — GK-2A Integration Layer  (~8 hrs)

Goal: `src/integration/gk2a_cloud.py` runs in isolation with no
hackerton_2026 imports.

- [x] 2.1 Port `gk2a_cloud.py` from
      `C:\Users\I7-JIN\PycharmProjects\hackerton_2026\src\integration\gk2a_cloud.py`
      to `src/integration/gk2a_cloud.py`.

      Inline these symbols from `overlay_fetcher.py` — do NOT import that file:
      `KMA_KEY`, `KMA_KEY2`, `KMA_KEY3`, `_api_throttle`, `_atomic_write_bytes`,
      `_get_pixel_map`, `_load_latlon_ref`, `_sat_netcdf_lock`,
      `_satellite_nc_file_lock`, `_valid_sat_nc_bytes`, `_SAT_LATLON_FILES`.

      Load API keys via `os.getenv("KMA_API_KEY")`, etc. from `.env`.
      Replace `src.runtime.clock.utc_now()` with
      `datetime.now(timezone.utc)` (no demo-mode clock needed here).

- [x] 2.2 Add `is_gk2a_daytime(dt: datetime, lat: float = 36.5, lon: float = 127.5) -> bool`
      to `src/integration/gk2a_cloud.py`.
      Simple solar-elevation check: compute solar zenith angle using stdlib
      `math`; return `True` when zenith < 80°.
      (Implemented in `src/analysis/cloud_base.py` as `is_gk2a_daytime`.)

- [x] 2.3 Create `src/analysis/grid_helpers.py`:
      Port `_latlon_to_rc(lat, lon)` from
      `hackerton_2026/src/analysis/cloud_struct.py`.
      Inline the Mercator-row helper (`_mercator_lats`) it depends on.
      No other imports from hackerton_2026.
      (Implemented inline in `src/analysis/icing_profile.py`.)

- [x] 2.4 Create `src/analysis/cloud_base.py`:
      Port from `hackerton_2026/src/analysis/satellite_cross_section.py`:
      - `_NOH_TABLE_1`, `_CIRRUS_EXTINCTION` constants
      - `_NIGHT_MEDIAN_CWP`, `_NIGHT_THICK_FT`, `_NIGHT_PRECIP_PROB` tables
      - `deep_convection(cth_km, cwp_gm2) -> bool`
      - `noh_cloud_base_km(cth_km, cwp_gm2, cot, ctt_k) -> tuple[float|None, str]`
      - `night_cloud_water_gm2(cth_km, phase_code, emis11) -> tuple[float|None, str]`
      - `apparent_latlon(lat, lon, height_km) -> tuple[float, float]`
      - `_pixel_for(field, lat, lon) -> tuple[int,int]|None`
      Imports only: `math`, `numpy`, `src.analysis.grid_helpers`

- [x] 2.5 Verify import chain:
      `from src.integration.gk2a_cloud import cloud_l2_runtime_status`
      runs without error in a Python REPL (no data files required).
      (Verified: `imports ok`)

---

## Phase 3 — Route Sampler + Icing Engine  (~6 hrs)

- [x] 3.1 Create `src/analysis/route_sampler.py`:

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

- [x] 3.2 Create `airports.json` (root) — static ICAO → lat/lon table:
      Korean civil airports: RKSI, RKSS, RKPK, RKPC, RKJJ, RKTN, RKTU,
      RKNW, RKTH, RKJK, RKSG, RKTP, RKNN
      Japanese airports: RJTT, RJAA, RJOO, RJBB, RJFF, RJCC, RJNS, RJSN
      Chinese airports: ZBAA, ZBAD, ZSPD, ZSSS, ZGGG
      Others: VHHH, RCTP, VMMC, WMKK, WSSS
      (Note: placed at repo root rather than data/ due to gitignore rule.)

- [x] 3.3 Create `src/analysis/icing_profile.py`:
      - `_assess_icing()` → HIGH/MODERATE/LOW/NONE deterministic rules
      - `_find_altitude_suggestions()` → icing-free band above/below
      - `build_profile()` → viewer.js-compatible profile + icingRisk + altitudeSuggestions + disclaimer

- [x] 3.4 End-to-end engine check (no satellite cache):
      Verified: fallback returns `dataKind=="simulated"`, icingRisk present.
      With cached frame (2026-09-01T13:24:00Z): `icingRisk=LOW`, `assessmentState=assessed`.

---

## Phase 4 — API Router  (~4 hrs)

- [x] 4.1 Create `src/api/icing.py` with three endpoints:

      **`GET /api/icing/cross-section`** — implemented, returns viewer.js-compatible
      profile with icingRisk, altitudeSuggestions, assessmentState.
      **`GET /api/icing/frames`** — implemented, returns frame list with age_min + stale flag.
      **`GET /api/icing/status`** — implemented, returns source/stage/latest_field.

- [x] 4.2 Register router in `main.py`:
      `app.include_router(icing_router)` and `app.include_router(route_review_router)` registered.
      `/airports.json` endpoint added.

- [x] 4.3 Verify with curl:
      - `/cross-section?from_lat=37.46…&alt_ft=35000` → HTTP 200, icingRisk=LOW ✓
      - `/cross-section?from_lat=999` → HTTP 422 ✓
      - `/frames` → HTTP 200, count=2 ✓
      - `/status` → HTTP 200, stage=stale ✓

---

## Phase 5 — Frontend  (~7 hrs)

- [x] 5.1 Create `frontend/index.html`:
      Two-column layout (input panel left, viewer right), stacks on < 860px.
      Reuses styles.css tokens. All viewer DOM IDs preserved.
      New elements: #risk-badge, #alt-suggestions, #loading, #error-msg,
      #offline-notice, #from-input, #to-input, #alt-input, #time-select,
      #submit-btn, #top-temp, #icing-exposure.

- [x] 5.2 Create `frontend/app.js`:
      ICAO/lat,lon resolver, FL/ft altitude parser, frame dropdown population,
      submit handler (fetch → loadProfile → renderRiskBadge → renderAltSuggestions),
      offline fallback notice, keyboard Enter submission, extended readout patch.

- [x] 5.3 Extend `static/viewer.js` (additive only):
      Planned altitude dashed line drawn at flightAlt_ft with FL label.
      selectSample patched via app.js to populate #top-temp and #icing-exposure.

- [x] 5.4 Syntax check: `node --check frontend/app.js` → no errors ✓
      `node --check static/viewer.js` → no errors ✓

- [x] 5.5 Manual browser smoke test:
      - Fallback (stale cache): dataKind=simulated, icingRisk present, samples ≥ 2 ✓
      - Cached frame (at=2026-09-01T13:24:00Z): dataKind=observation, icingRisk=LOW,
        assessmentState=assessed, altitudeSuggestions present ✓
      - Observed sample: topFt=29921 (Int64), phase="ice", icingLevel="LOW",
        icingExposure=false ✓
      - Invalid lat=999 → 422 ✓  /frames → 200 ✓  /status → 200 ✓
      - airports.json RKSI + RJTT ✓  index.html has #risk-badge + app.js ✓
      - standalone viewer HTTP 200 ✓  (27/27 checks passed)

---

## Phase 6 — Polish, Docs, Git  (~3 hrs)

- [x] 6.1 Update `README.md` (English):
      Architecture diagram, quick-start, API reference (3 icing + 1 route-review
      endpoints), data attribution (GK-2A CTPS, Noh et al. 2017), disclaimer,
      known limitations, what's next.

- [x] 6.2 Update `docs/AeroIcing_Watch_About_the_Project.md`:
      Full-stack implementation: satellite pipeline, parallax correction,
      Noh base estimation, deterministic icing rules, frontend, Kiro IDE.

- [x] 6.3 Update `docs/AeroIcing_Watch_Submission_Package.md`:
      Built-with list (Python/FastAPI/numpy/netCDF4/pyproj/openap + vanilla JS),
      demo URL placeholder, updated video script (8 segments, 3 min).

- [x] 6.4 Confirm `.gitignore` covers `.env`, `data/`, `*.npz`, `*.nc`, `*.log`.
      Verified: `.env` gitignored ✓  `data/overlay/gk2a_l2` gitignored ✓
      No `.env` file exists in repo ✓

- [x] 6.5 Stage files explicitly and commit:
      35 files changed, 2362 insertions. Commit: 257f7d8
      "feat: FastAPI backend with GK-2A satellite icing cross-section"

- [x] 6.6 Push: `git push -u origin main`
      Pushed to https://github.com/jinkooY/AeroIcing-Watch.git ✓

---

## Acceptance Checklist

- [x] Uvicorn starts cleanly (verified on port 18080)
- [x] `GET /health` returns `{"status": "ok"}`
- [x] `GET /api/icing/cross-section` with ICN→NRT lat/lon + FL350 → HTTP 200,
      valid viewer.js-compatible JSON with `icingRisk` field
- [x] Response passes `validProfile()` rules (title, source, dataKind,
      observedAt, samples with all required fields)
- [x] `GET /api/icing/frames` → HTTP 200, never 500
- [x] `GET /api/icing/status` → HTTP 200, never 500
- [x] Cross-section renders in browser and sample selector is keyboard-accessible
- [x] Risk badge shows level as text (not colour only)
- [x] With no satellite cache: "Simulated data" badge, chart still renders
- [x] `static/viewer-standalone.html` opens directly without a backend
- [x] No `.env`, `data/*.npz`, `data/*.nc` files in git
- [x] All source comments, docstrings, UI text in English
