# Requirements — AeroIcing Watch

## Overview

A web application that shows a GK-2A satellite-derived vertical icing-risk
cross-section along any A–B flight segment, targeting airline dispatchers and
commercial flight crews.

---

## User Stories

### US-1  Route Icing Cross-Section
**As** an airline dispatcher  
**I want to** enter a departure point (A) and destination (B) with a planned
flight altitude  
**so that** I can see a GK-2A satellite-based cloud vertical cross-section and
icing risk rating for that segment.

**Acceptance criteria:**
- [ ] User can enter departure/destination as ICAO codes or lat/lon coordinates
- [ ] User can enter planned altitude in feet (FL entry also accepted)
- [ ] Submitting calls `GET /api/icing/cross-section` and renders the result
- [ ] Viewer uses the existing `viewer.js` Canvas-based chart unchanged
- [ ] Each sample shows cloud top / base / phase / supercooled status
- [ ] Overall icing risk badge (HIGH / MODERATE / LOW / NONE) appears in the header

### US-2  Satellite Timestamp Selection
**As** an airline dispatcher  
**I want to** pick from a list of recent satellite observation timestamps  
**so that** I can inspect the cross-section at a specific observation time.

**Acceptance criteria:**
- [ ] `GET /api/icing/frames` populates a dropdown of available timestamps
- [ ] Default selection is the most recent frame
- [ ] Changing the selection refreshes the cross-section chart

### US-3  Fallback When No Satellite Cache
**As** a dispatcher  
**I want** the app to stay functional even when no satellite data is cached  
**so that** the UI can be demonstrated offline.

**Acceptance criteria:**
- [ ] API returns `dataKind: "simulated"` profile when no cache exists
- [ ] Frontend shows a "Simulated data" badge in that case
- [ ] A clear notice explains that live satellite data is unavailable
- [ ] Opening the app always shows a cross-section — never a blank screen

### US-4  Local JSON Import
**As** a dispatcher  
**I want to** import a local JSON profile file  
**so that** I can view custom or pre-prepared profiles offline.

**Acceptance criteria:**
- [ ] The existing "Open profile JSON" button in `index.html` continues to work
- [ ] A schema-invalid file shows a human-readable error message

### US-5  Satellite Collection Status
**As** an operator  
**I want to** call `GET /api/icing/status`  
**so that** I can verify GK-2A data freshness and collection health.

**Acceptance criteria:**
- [ ] Response includes `source`, `latest_field`, and `configured_slots` fields
- [ ] When no API key is configured, response returns `configured_slots: []`
  with a clear message rather than an error

---

## Functional Requirements

### FR-1  Route Sampling
- Divide the great-circle path between two lat/lon points into equal-interval steps
- Default spacing ≈ 15 km; minimum 10 samples, maximum 200 samples
- First sample must be `distanceKm: 0`

### FR-2  Satellite Field → Icing Profile Conversion
- Use GK-2A CTPS fields: `cth_ft`, `ctt_k`, `phase`, `supercooled`, `emis11`
- Cloud base (`baseFt`) estimated via Noh et al. (2017) statistical cloud
  geometric thickness (reuse `satellite_cross_section.py` logic from hackerton_2026)
- Phase mapping: NMSC CP 1 → `"liquid"`, 2 → `"ice"`, 6 → `"unknown"`,
  0 / NaN → `null`
- Supercooled: NMSC CP_FLAG 1 → `true`, 0 → `false`, NaN → `null`

### FR-3  Icing Risk Assessment
- **Deterministic rule-based — no LLM involvement**
- `HIGH`     : `supercooled == true` AND planned altitude ∈ [baseFt, topFt]
- `MODERATE` : `phase == "liquid"` AND CTT < 273.15 K AND within layer
- `LOW`      : planned altitude within layer, no supercooled conditions
- `NONE`     : no cloud, or altitude outside layer
- Header risk = highest rating found across all samples in the cross-section

### FR-4  JSON Contract Compatibility
- Every API response must pass the existing `viewer.js` `validProfile()` validator
- Required fields: `title`, `source`, `dataKind`, `observedAt`, `samples[]`
- Each sample: `distanceKm`, `topFt`, `baseFt`, `phase`, `supercooled`
- Extended fields (additive, non-breaking): `icingRisk`, `flightAlt_ft`,
  `samples[].icingExposure`

---

## Non-Functional Requirements

### NFR-1  Response Time
- Cross-section API ≤ 2 s on satellite cache hit
- Fallback to synthetic data ≤ 500 ms

### NFR-2  Offline Operation
- Opening `index.html` directly (no backend) must work via `sample.js`
- Presentation demo must be fully functional without internet access

### NFR-3  Accessibility
- Sample selector operable by keyboard alone (existing `viewer.js` behaviour preserved)
- Icing risk level communicated via text label, not colour alone

### NFR-4  Security
- KMA API key never reaches the frontend
- Input validation: lat ∈ [−90, 90], lon ∈ [−180, 180], altitude ∈ [0, 60 000] ft

### NFR-5  Minimal Dependencies
- Python: `fastapi`, `uvicorn[standard]`, `numpy`, `netCDF4`, `pyproj`,
  `requests`, `python-dotenv`
- Frontend: vanilla JS + Leaflet (vendored); no npm, no bundler
- Must run inside the existing `WeatherPath` conda environment with no
  additional installs
