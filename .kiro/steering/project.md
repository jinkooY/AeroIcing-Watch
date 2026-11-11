---
inclusion: always
---

# AeroIcing Watch — Project Steering

## Overview

Kiro Hackathon 2026 entry. Uses GK-2A geostationary satellite Level-2 CTPS data
to deliver a vertical icing-risk cross-section along any A–B flight segment
to airline dispatchers and pilots.

## Tech Stack

- **Backend:** FastAPI (Python 3.11+), uvicorn
- **Frontend:** Vanilla HTML + CSS + JS + Canvas (no build tools)
- **Satellite data:** GK-2A CTPS L2 via KMA APIHub
- **Data processing:** numpy, netCDF4, pyproj
- **Reuse source:** `C:\Users\I7-JIN\PycharmProjects\hackerton_2026`

## Target Directory Layout

```
aeroicing-watch/
├── main.py                       # FastAPI app entry point
├── requirements.txt
├── .env                          # KMA_API_KEY — never commit
├── .gitignore
│
├── src/
│   ├── __init__.py
│   ├── integration/
│   │   ├── __init__.py
│   │   └── gk2a_cloud.py         # Ported from hackerton_2026, deps trimmed
│   ├── analysis/
│   │   ├── __init__.py
│   │   ├── route_sampler.py      # Great-circle A→B → evenly-spaced samples
│   │   └── icing_profile.py      # Satellite field → icing profile JSON
│   └── api/
│       ├── __init__.py
│       └── icing.py              # /api/icing/* router
│
├── frontend/
│   ├── index.html                # Main page: route input + viewer
│   ├── app.js                    # Route input UI + API wiring
│   └── vendor/
│       └── leaflet/              # Copied from hackerton_2026
│
├── static/
│   └── (viewer.js, sample.js, styles.css — existing files, kept as-is)
│
└── data/
    └── overlay/gk2a_l2/          # Satellite cache — git-ignored
```

## Absolute Rules

1. Never commit `.env`. API keys live in environment variables only.
2. Never commit `data/`. Satellite cache stays local.
3. **No LLM in icing decisions.** The server computes deterministic values only.
4. The `viewer.js` JSON contract (profile schema) must not change. The backend
   converts satellite data into that exact shape.
5. Frontend must run without a build step (vanilla JS).
6. When no satellite cache exists, fall back to `sample.js` synthetic data —
   never show a blank screen.

## Icing Decision Rules (Deterministic)

```
HIGH     : supercooled == true  AND  flight altitude within [baseFt, topFt]
MODERATE : phase == "liquid"  AND  CTT < 273.15 K  AND  within layer
LOW      : within layer, no supercooled conditions
NONE     : no cloud  OR  flight altitude outside layer
```

## Reuse Map

| hackerton_2026 module | Purpose | Action |
|---|---|---|
| `src/integration/gk2a_cloud.py` | GK-2A fetch · projection · cache | Port, inline overlay_fetcher deps |
| `src/analysis/satellite_cross_section.py` | Noh et al. base estimation, parallax | Extract core logic |
| `src/analysis/cloud_struct.py` | Grid coordinate helper `_latlon_to_rc` | Extract function |
| `src/analysis/aviation_rules.py` | Flight category thresholds | Copy as-is |
| `src/analysis/mission_trajectory.py` | Great-circle sampling reference | Adapt |

## Dev Commands

```powershell
# Reuse existing conda env from hackerton_2026
# C:\Users\I7-JIN\miniconda3\envs\WeatherPath\python.exe

# Local server
uvicorn main:app --host 0.0.0.0 --port 8080 --reload

# Syntax check
node --check frontend/app.js
```
