# AeroIcing Watch — Devpost Submission Notes

## Elevator Pitch

AeroIcing Watch turns GK-2A geostationary satellite Level-2 cloud observations into an interactive vertical icing-risk cross-section along any flight segment — giving airline dispatchers a satellite-grounded answer to "where is the icing, at what altitude, and can I fly above or below it?"

## Sample Image Caption

GK-2A CTPS satellite-derived cloud tops, Noh et al. (2017) estimated bases, cloud phase, and supercooled cues along a selected flight segment. Icing risk badge (HIGH/MODERATE/LOW/NONE) derived from deterministic satellite rules — no NWP, no LLM.

## Key Features

- **Satellite-only icing pipeline** — GK-2A CTPS L2: cloud top height, temperature, phase, supercooled flag; cloud base from Noh et al. (2017) regression
- **Deterministic risk rating** — HIGH/MODERATE/LOW/NONE, computed server-side from direct satellite retrievals
- **Altitude suggestions** — icing-free bands above and below the observed cloud layer
- **Interactive cross-section** — keyboard-accessible Canvas chart; planned altitude line overlay
- **ICAO airport lookup** — 32 airports across Korea, Japan, China, Southeast Asia
- **REST API** — `/api/icing/cross-section` for dispatch system integration
- **IFS route evaluation** — `POST /api/route-review/evaluate` for ECMWF-based per-segment weather + fuel estimate (OpenAP)
- **Offline / fallback** — illustrative sample data when no satellite cache; standalone HTML viewer

## Built With

Python, FastAPI, uvicorn, numpy, netCDF4, pyproj, requests, python-dotenv, openap  
HTML, CSS, JavaScript, Canvas API  
GK-2A CTPS Level-2 (KMA/NMSC)  
ECMWF IFS Open Data (route review)  
Kiro IDE (AI-assisted development)

## Demo Video Script

| Time | Footage |
|---|---|
| 0:00–0:20 | Introduce the dispatcher problem: "Where is the icing, at what altitude?" |
| 0:20–0:50 | Open the app. Enter ICN → RJTT at FL350. Submit. |
| 0:50–1:30 | Show the cross-section chart: cloud top/base layers, planned altitude line, risk badge. |
| 1:30–2:00 | Click through samples — show supercooled cue, cloud top temperature, icing exposure. |
| 2:00–2:20 | Show altitude suggestions: "No icing above FL400 / below FL80." |
| 2:20–2:45 | Show simulated-data fallback (offline mode). Open standalone viewer. |
| 2:45–3:00 | Show API response (`/api/icing/cross-section`) in browser dev tools. |
| 3:00–3:30 | Explain what's next: download worker, multi-waypoint, NWP overlay. |

## Submission Checks

- [ ] Public demo URL confirmed
- [ ] Demo video uploaded (≤ 3 min)
- [ ] Kiro development evidence included (session logs / `.kiro/` directory in repo)
- [ ] All source files in English
- [ ] No API keys in git history
- [ ] Competition eligibility confirmed

## Data Attribution

- **GK-2A CTPS L2** — Korea Meteorological Administration (KMA) National Meteorological Satellite Center (NMSC)
- **Cloud base estimation** — Noh, Y.-J., et al. (2017). *J. Atmos. Ocean. Technol.* **34**, 585–598. https://doi.org/10.1175/JTECH-D-16-0066.1

## Operational Disclaimer

This product is a dispatcher review aid. It does not replace AIRMETs, SIGMETs, PIREPs, NOTAMs, or flight dispatch authority. The satellite observes the topmost cloud layer only.
