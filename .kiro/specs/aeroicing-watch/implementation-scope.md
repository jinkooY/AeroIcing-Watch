# AeroIcing Watch — Implementation Scope & Delivery Plan

## 1. What This Document Is

This document defines:
- What data we extract and how
- What we deliver to airlines (outputs, formats, UI screens)
- What the airline can do with it (scope boundary)
- Whether route optimization is in scope, and to what degree
- Estimates for each piece of work
- A prioritized build order for the hackathon deadline

---

## 2. The Core Problem Being Solved

```
Dispatcher opens a route (e.g., ICN → NRT):
  "Is there icing along this segment right now?
   At what altitudes?  Should I change FL?"

Today: Dispatcher consults a separate satellite viewer,
       manually cross-references cloud height charts,
       and makes a judgment call.

AeroIcing Watch answer: One API call → one chart showing
  the cloud vertical profile along the exact route,
  with icing risk per segment, per altitude band.
```

---

## 3. Data Pipeline — How We Extract Icing Information

### 3.1 Source Data

| Source | Product | What it gives us | Cadence | Coverage |
|---|---|---|---|---|
| GK-2A CTPS L2 | Cloud Top Properties (NMSC) | Cloud top height (CTH ft), cloud top temperature (CTT K), cloud phase (liquid / ice / uncertain), supercooled flag (CP_FLAG) | Every 10 min | Lat 32–44.5°N, Lon 122–134.5°E (KO domain) |
| GK-2A DCOEW L2 | Cloud Optical/Water Path (daytime only) | LWP + IWP (cloud water path, g m-2), COT (optical thickness) | Every 10 min (daytime) | Same KO domain |

**GK-2A does not give us cloud base directly.** It only sees the top of the
uppermost cloud layer. Cloud base must be estimated.

### 3.2 Cloud Base Estimation

We adopt the pipeline already implemented in
`hackerton_2026/src/analysis/satellite_cross_section.py` (Noh et al., 2017,
Journal of Atmospheric and Oceanic Technology 34:585):

```
Daytime (solar zenith < 80°):
  DCOEW valid DQF → CWP = LWP + IWP
    COT < 1 AND CTH ≥ 5 km  → cirrus extinction method
    Deep convection (CWP ≥ 1000-1200 g m-2) → base UNKNOWN
    Otherwise → Noh Table 1 regression: CGT = a·CWP + b (per 2 km CTH bin)
    Cloud base = CTH - CGT, clamped to [terrain, top]

Night:
  11 µm emissivity (emis11) → CWP proxy if emis < 0.95 saturation threshold
  Else → median CWP look-up table (from EarthCARE CPR validation, 83 k profiles)
  Apply Noh regression with night CWP
  For EarthCARE-validated thick cloud bins → use direct thickness table
```

This is the best available method without NWP (numerical weather prediction).

### 3.3 Icing Risk Assessment (Deterministic)

Applied per sample point, produces a 4-level rating:

```
HIGH     : CTPS CP_FLAG supercooled == 1   AND  alt_ft ∈ [baseFt, topFt]
MODERATE : phase == liquid  AND  CTT < 273.15 K  AND  alt_ft ∈ [baseFt, topFt]
LOW      : alt_ft ∈ [baseFt, topFt],  no supercooled conditions
NONE     : no cloud at sample point, or alt_ft outside cloud layer
```

Overall route risk = highest individual sample risk.

**What "HIGH" means operationally:**
The GK-2A CP_FLAG supercooled is a direct satellite retrieval (not modelled).
It indicates the cloud contains supercooled liquid water droplets — the
primary cause of structural icing on airframe and engines.

**Disclaimer embedded in every API response:**
> "This product is a dispatcher review aid based on satellite observations.
> It does not replace AIRMETs, SIGMETs, pilot reports, or flight dispatch
> authority. The satellite observes the topmost cloud layer only."

---

## 4. What We Deliver to Airlines

### 4.1 Deliverable Summary

| # | Deliverable | Format | Who uses it |
|---|---|---|---|
| D1 | Route Icing Cross-Section Chart | Web UI (Canvas) | Dispatcher / Pilot |
| D2 | Icing Risk Summary Badge | Web UI text label | Dispatcher |
| D3 | Per-Sample Readout | Web UI data panel | Dispatcher |
| D4 | Cross-Section API | JSON (REST) | Dispatch system integration |
| D5 | Available Frames List | JSON (REST) | Dispatch system / UI |
| D6 | Collection Status | JSON (REST) | Operations / monitoring |
| D7 | Standalone Offline Viewer | Static HTML file | Demo / no-internet use |

### 4.2 D1 — Route Icing Cross-Section Chart

The main output. A Canvas-rendered vertical cross-section showing:

```
Y axis : altitude ft MSL  (auto-scaled to fit cloud layers)
X axis : distance km from A to B

Rendered layers per sample:
  ┌─────────────────────────────────────────┐  ← cloud top (CTH)
  │  Phase colour fill (liquid/ice/unknown) │  ← 72% opacity if base known
  │  Orange 3px band if supercooled         │
  └─────────────────────────────────────────┘  ← estimated cloud base
  ▓▓▓▓▓  dark strip = missing data (topFt null)

Blue dashed cursor line = selected sample
Horizontal line = planned flight altitude (new element, additive)
```

The existing `viewer.js` Canvas engine renders all of this. We extend it only
to draw the planned altitude line — no other changes to `viewer.js`.

### 4.3 D2 — Icing Risk Summary Badge

A single coloured tag displayed above the chart:

| Rating | Colour | Text |
|---|---|---|
| HIGH | `#ff6b6b` (red) | ⚠ HIGH icing risk |
| MODERATE | `#ffa94d` (amber) | ⚡ MODERATE icing risk |
| LOW | `#69db7c` (green) | LOW icing risk |
| NONE | `#a9bdd1` (muted) | No icing detected |
| SIMULATED | `#ffd394` (yellow) | Simulated data |

Colour is never the sole indicator — text label is always present (accessibility).

### 4.4 D3 — Per-Sample Readout

The existing `viewer.js` readout panel (keyboard/click accessible) already
shows per-sample values. We extend it with two new fields:

| Existing field | New field |
|---|---|
| Cloud top (ft MSL) | — |
| Estimated base (ft MSL) | — |
| Phase | Cloud top temperature (°C) |
| Supercooled cue | Icing exposure at FL (YES / NO) |

### 4.5 D4 — Cross-Section API

`GET /api/icing/cross-section`

The machine-readable form of D1/D2/D3. Dispatch systems can call this and
render results in their own UI or feed it into their data warehouse.

**Complete request parameters:**

| Parameter | Type | Required | Range | Description |
|---|---|---|---|---|
| `from_lat` | float | ✓ | −90 to 90 | Departure latitude |
| `from_lon` | float | ✓ | −180 to 180 | Departure longitude |
| `to_lat` | float | ✓ | −90 to 90 | Destination latitude |
| `to_lon` | float | ✓ | −180 to 180 | Destination longitude |
| `alt_ft` | int | ✓ | 0–60 000 | Planned cruise altitude ft |
| `at` | str | — | ISO UTC | Specific observation time; defaults to latest available frame |
| `spacing_km` | float | — | 5–100 | Sample interval (default 15 km) |

**Complete response (viewer.js compatible + extensions):**

```json
{
  "title": "ICN → NRT · FL350 · 2026-11-11T03:00Z",
  "dataKind": "observation",
  "source": "GK-2A CTPS L2 (NMSC) · KO domain · Noh et al. 2017 base est.",
  "observedAt": "2026-11-11T03:00:00Z",
  "icingRisk": "MODERATE",
  "flightAlt_ft": 35000,
  "routeLengthKm": 1215.4,
  "domain": "KO",
  "disclaimer": "Dispatcher review aid only. Does not replace AIRMETs/SIGMETs/PIREPs.",
  "samples": [
    {
      "distanceKm": 0.0,
      "topFt": 28000,
      "baseFt": 22000,
      "phase": "ice",
      "supercooled": false,
      "topTempC": -48.2,
      "icingExposure": false,
      "icingLevel": "NONE"
    },
    {
      "distanceKm": 15.0,
      "topFt": 19500,
      "baseFt": 14000,
      "phase": "liquid",
      "supercooled": true,
      "topTempC": -6.1,
      "icingExposure": true,
      "icingLevel": "HIGH"
    }
  ]
}
```

### 4.6 D5 — Available Frames

`GET /api/icing/frames`

```json
{
  "frames": [
    {"ts": "2026-11-11T03:00:00Z", "age_min": 4, "label": "03:00Z (4 min ago)"},
    {"ts": "2026-11-11T02:50:00Z", "age_min": 14, "label": "02:50Z (14 min ago)"}
  ],
  "count": 2,
  "domain": "KO",
  "coverage": {"lat_min": 32.0, "lat_max": 44.5, "lon_min": 122.0, "lon_max": 134.5}
}
```

### 4.7 D6 — Collection Status

`GET /api/icing/status` — wraps `cloud_l2_runtime_status()` from gk2a_cloud.py.

---

## 5. Route Planning — Scope Definition

### 5.1 What "Route" Means in This Product

AeroIcing Watch is a **review tool**, not an automated flight planner.
The dispatcher inputs the intended route; the tool shows what the satellite
sees along it. This is the same model as PIREPs, AIRMETs, and sigmets —
advisory, not prescriptive.

### 5.2 Route Input Options (Hackathon Scope)

Three input modes, in order of implementation priority:

| Mode | Input | Priority | Notes |
|---|---|---|---|
| **A. Free lat/lon** | `from_lat, from_lon, to_lat, to_lon` | P0 | Simplest; always works |
| **B. Airport lookup** | ICAO code → auto-resolve lat/lon | P1 | Built-in ICAO table (see §5.3) |
| **C. Multi-waypoint** | `[A, W1, W2, B]` list | P2 | Post-hackathon unless time allows |

Mode B and C are UI convenience — the backend always works in lat/lon.

### 5.3 Built-In Airport Database

The GK-2A KO domain covers the Korean peninsula and surrounding area.
Routes between Korea and nearby destinations (Japan, China, Southeast Asia
entry points) pass through the domain.

We build a small static ICAO → lat/lon JSON that covers:

**Korean civil airports (from public data):**
- RKSI (Incheon Intl), RKSS (Gimpo), RKPK (Gimhae/Busan), RKPC (Jeju),
  RKJJ (Gwangju), RKTN (Daegu), RKTU (Cheongju), RKNW (Yecheon),
  RKTH (Pohang), RKJK (Gunsan)

**Japanese airports (within or near KO domain western edge):**
- RJTT (Tokyo Haneda), RJAA (Tokyo Narita), RJOO (Osaka Itami),
  RJBB (Osaka Kansai), RJFF (Fukuoka), RJCC (Sapporo), RJNS (Shizuoka)

**Chinese airports (eastern fringe of KO domain):**
- ZBAA (Beijing Capital), ZSPD (Shanghai Pudong), ZGGG (Guangzhou)

**Other:**
- VHHH (Hong Kong), RCTP (Taipei Taoyuan)

This covers the top commercial routes from Korea (Incheon hub).
Routes outside the KO domain (e.g., ICN→LAX) will return columns
`state: "outside_domain"` for the out-of-coverage segment and display a
notice: "Route partially outside satellite domain."

### 5.4 Altitude Suggestion (Lightweight, In-Scope)

This is **not** automated route optimization. It is a simple advisory:

After computing the cross-section, the engine scans all samples to find
altitude bands with no icing exposure, and returns:

```json
"altitudeSuggestions": [
  {
    "band": "above",
    "alt_ft": 39000,
    "note": "No icing detected at FL390 for this route.",
    "confidence": "satellite_observation"
  },
  {
    "band": "below",
    "alt_ft": 10000,
    "note": "Below cloud bases for most of route. Confirm terrain clearance.",
    "confidence": "estimated_base"
  }
]
```

Rules:
- "above" suggestion: find the min altitude at which ALL samples are either
  `NONE` (no cloud) or `topFt < alt_ft` (above the cloud)
- "below" suggestion: find the max altitude at which ALL samples are either
  `NONE` or `baseFt > alt_ft` (below the cloud base)
- If no clean band exists within 0–60 000 ft: return empty array
- Never say "fly at FL390" — always say "no icing detected at FL390 based
  on current satellite data"
- Estimated base carries lower confidence than observed top; flag it

**This is advisory only.** The backend never selects a route or altitude.
The dispatcher makes the operational decision.

### 5.5 Route Optimization — Out of Scope (Post-Hackathon)

The following are **not** in scope for the hackathon:
- Lateral route deviation (find a path around icing cells)
- Multi-segment route scoring (compare route A vs route B)
- Time-window analysis (will the icing clear in 30 minutes?)
- NWP (KIM / ECMWF) integration for icing probability fields
- PIREP ingestion for corroboration

These are documented as "What's Next" in the submission.

---

## 6. UI Screen Map

```
GET /                       → frontend/index.html
  ┌──────────────────────────────────────────────────────┐
  │  AeroIcing Watch                        [status pill] │
  │  Review icing risk along a flight segment             │
  ├─────────────────┬────────────────────────────────────┤
  │  Route Input    │  Cross-Section Viewer              │
  │                 │                                    │
  │  From: [ICAO]   │  [Risk badge: ⚠ HIGH icing risk]  │
  │  To:   [ICAO]   │  [Source · Timestamp]             │
  │  Alt:  [FL___]  │                                    │
  │  Time: [latest▼]│  ┌──── Canvas Chart ─────────┐    │
  │                 │  │  ft MSL                    │    │
  │  [Show Section] │  │  40000 ─────────────────── │    │
  │                 │  │  30000  ████░░░████████    │    │
  │                 │  │  20000  ████████████████   │    │
  │                 │  │  - - - - [FL350 line] - -  │    │  ← planned alt
  │                 │  │  10000                     │    │
  │                 │  └──── A ─────────── B ───────┘    │
  │                 │                                    │
  │                 │  [Legend]  [Sample selector]       │
  │                 │  [Per-sample readout panel]        │
  │                 │                                    │
  │                 │  [Altitude suggestions]            │
  │                 │  ↑ FL390: No icing above this      │
  │                 │  ↓ FL100: Below clouds (check terrain)│
  └─────────────────┴────────────────────────────────────┘

GET /static/viewer-standalone.html   → offline standalone viewer (no backend)
```

---

## 7. Work Estimates

### Complexity Key
- **S** = Small (1–2 hrs)
- **M** = Medium (3–5 hrs)
- **L** = Large (6–10 hrs)

### Phase 1 — Project Scaffold

| Task | Size | Notes |
|---|---|---|
| requirements.txt, .gitignore, .env.example | S | Straightforward |
| Directory skeleton + __init__ files | S | Straightforward |
| Move existing files to static/ | S | No content change |
| Stub main.py (FastAPI, static mount, GET /) | S | Copy hackerton pattern |
| **Phase 1 total** | **~3 hrs** | |

### Phase 2 — GK-2A Integration Layer

| Task | Size | Notes |
|---|---|---|
| Port gk2a_cloud.py + inline overlay_fetcher deps | M | ~700 lines, mostly copy; need to audit all imports |
| Port _latlon_to_rc + Mercator row helper | S | ~15 lines |
| Port parallax correction (apparent_latlon) | S | ~20 lines |
| Port Noh base estimation pipeline | M | ~200 lines, 5 branches |
| Port night_cloud_water_gm2 | S | ~30 lines |
| is_gk2a_daytime() | S | Simple solar-angle check |
| **Phase 2 total** | **~8 hrs** | Largest risk: import chain cleanup |

### Phase 3 — Route Sampler + Icing Engine

| Task | Size | Notes |
|---|---|---|
| route_sampler.py (great-circle, Haversine) | S | stdlib math only |
| Airport ICAO table JSON | S | ~30 airports, copy from public data |
| icing_profile.py core: _assess_icing, _to_viewer_phase | S | Pure logic |
| icing_profile.py: build_icing_profile() (main function) | M | Integrates sampler + GK-2A + assessment |
| Altitude suggestions logic | M | Scan samples, two-band search |
| Fallback synthetic profile | S | Wrap existing sample.js data |
| **Phase 3 total** | **~6 hrs** | |

### Phase 4 — API Router

| Task | Size | Notes |
|---|---|---|
| icing.py: /cross-section endpoint + validation | M | Query param validation, 422 handling |
| icing.py: /frames endpoint | S | Thin wrapper on cached_gk2a_cloud_field_times |
| icing.py: /status endpoint | S | Thin wrapper on cloud_l2_runtime_status |
| Register router in main.py + CORS | S | 5 lines |
| **Phase 4 total** | **~4 hrs** | |

### Phase 5 — Frontend

| Task | Size | Notes |
|---|---|---|
| frontend/index.html layout (input + viewer) | M | Extend existing styles.css tokens |
| ICAO code → lat/lon resolution in browser | S | JSON table lookup |
| app.js: frame dropdown + submit handler | M | fetch + loadProfile wiring |
| app.js: risk badge rendering | S | Colour + text |
| Planned altitude line in viewer.js | S | 10 lines additional Canvas draw |
| Altitude suggestions panel | S | Simple text cards below chart |
| Offline fallback notice | S | Show banner when dataKind=simulated |
| **Phase 5 total** | **~7 hrs** | |

### Phase 6 — Polish, Docs, Git

| Task | Size | Notes |
|---|---|---|
| README.md update (English, full-stack) | M | Hackathon judges read this |
| docs/ submission package update | S | |
| Final git commit + push | S | |
| **Phase 6 total** | **~3 hrs** | |

### Total Estimate: ~31 hours

Realistic hackathon schedule (2-day sprint):
- Day 1: Phase 1–3 (scaffold + data pipeline, ~17 hrs)
- Day 2: Phase 4–6 (API + UI + docs, ~14 hrs)

---

## 8. Build Order (Prioritized for Deadline Risk)

The highest-risk item is the GK-2A port (Phase 2). If satellite data is
unavailable at demo time, the synthetic fallback must be seamless.

```
Priority 1 (must-have):
  Phase 1 → Phase 2 (GK-2A port) → Phase 3 (engine) → Phase 4 (API)
  → cross-section API works end-to-end with both real and simulated data

Priority 2 (should-have):
  Phase 5 (frontend) → working browser demo with risk badge

Priority 3 (nice-to-have):
  Altitude suggestions UI
  Leaflet map showing A–B route line
  Phase 6 polish
```

If time runs short, the demo can run with the Phase 4 API + existing
`static/viewer-standalone.html` loading a pre-generated JSON file.
That demonstrates the full pipeline without the interactive UI.

---

## 9. What We Are NOT Building (Explicit Exclusions)

| Item | Reason |
|---|---|
| Real-time GK-2A download worker | Out of hackathon scope; cache populated manually |
| KIM / ECMWF NWP integration | Not needed; satellite-only is the thesis |
| Multi-layer cloud (below top layer) | Passive imager physical limitation |
| Turbulence, thunderstorm, wind | Different product; different data source |
| User accounts / authentication | Public demo |
| Mobile native app | Web only |
| Automated route re-routing | Advisory only; dispatcher decides |
| PIREP ingestion | Future work |
| Automatic data refresh | Manual cache / manual push |

---

## 10. Data Attribution & Limitations (Required in UI + Docs)

Every response and the UI footer must include:

```
Data source: Korea Meteorological Administration (KMA) GK-2A
Satellite Level-2 Cloud Top Property Estimation System (CTPS).
Cloud base estimates use the method of Noh et al. (2017),
J. Atmos. Ocean. Technol. 34, 585–598.
GK-2A observes the topmost cloud layer only. Lower layers under
thick cloud cannot be seen by passive satellite imagery.
This product is a planning aid and does not constitute an official
aviation weather product. Always consult AIRMETs, SIGMETs, and
NOTAMs through official channels before flight.
```
