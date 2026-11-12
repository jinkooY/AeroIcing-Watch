# AeroIcing Watch

## Kiroween route comparison demo

Compare two illustrative Incheon–Haneda routes using an archived ECMWF IFS forecast and OpenAP cruise fuel estimates. Select a segment to see the weather behind its time and fuel estimate. The fixed scenario uses the same aircraft, departure time, cruise level and initial mass for both routes.

[Open the public demo](https://jinkooy.github.io/AeroIcing-Watch/)

From the repository root, run `python -m http.server 8080 --bind 127.0.0.1 --protocol HTTP/1.1 --directory static/route-demo` and open [localhost:8080](http://localhost:8080/). The demo needs a static HTTP server and a browser. It uses bundled results with no API key, live weather feed or Python packages required. See the [submission notes](docs/AeroIcing_Watch_Submission_Package.md) for reproduction and deployment.

The rest of this README documents the FastAPI development application and its separate satellite cross-section workflow.

**Kiro Hackathon 2026** — Satellite-based icing risk cross-section for airline dispatchers and flight crews.

AeroIcing Watch uses **GK-2A geostationary satellite Level-2 CTPS observations** to show the cloud vertical structure — top height, estimated base, phase, and supercooled flag — along any A–B flight segment, with a deterministic icing risk rating per sample.

---

## Architecture

```
Browser
  │  Route form submit
  ▼
frontend/app.js  ──→  GET /api/icing/cross-section?from_lat=…&alt_ft=…
                                │
                        main.py (FastAPI)
                                │
                   src/api/icing.py  ──→  src/analysis/icing_profile.py
                                                   │
                              ┌────────────────────┤
                              │                    │
                 route_sampler.py          cloud_base.py
                 (great-circle pts)   (Noh 2017 base est.)
                              │                    │
                   src/integration/gk2a_cloud.py
                   (read projected CTPS npz cache)
                              │
                   data/overlay/gk2a_l2/FIELD/KO/
                   (populated by external collector)
```

Additional route evaluation against ECMWF IFS forecasts is available at `POST /api/route-review/evaluate`.

---

## Quick Start

```bash
# 1. Clone
git clone https://github.com/jinkooY/AeroIcing-Watch.git
cd AeroIcing-Watch

# 2. Install (reuse WeatherPath env or create a new one)
pip install -r requirements.txt

# 3. Configure
cp .env.example .env
# Edit .env — set KMA_API_KEY if you have a KMA APIHub key

# 4. Run
uvicorn main:app --host 0.0.0.0 --port 8080 --reload

# 5. Open
# http://localhost:8080
```

**No satellite cache?** The app shows illustrative sample data automatically. The standalone viewer at `/static/viewer-standalone.html` works without any backend.

---

## API Reference

### `GET /api/icing/cross-section`

Returns a viewer.js-compatible cloud profile with icing risk assessment.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `from_lat` | float | ✓ | Departure latitude (−90 to 90) |
| `from_lon` | float | ✓ | Departure longitude (−180 to 180) |
| `to_lat` | float | ✓ | Destination latitude |
| `to_lon` | float | ✓ | Destination longitude |
| `alt_ft` | int | ✓ | Planned cruise altitude ft (0–60 000) |
| `at` | ISO UTC string | — | Specific observation frame; defaults to latest |
| `spacing_km` | float | — | Sample interval km (5–100, default 15) |

**Response fields (additive on top of viewer.js profile contract):**

```json
{
  "title": "GK-2A cloud cross-section",
  "dataKind": "observation",
  "observedAt": "2026-11-11T03:00:00Z",
  "icingRisk": "MODERATE",
  "assessmentState": "assessed",
  "flightAlt_ft": 35000,
  "altitudeSuggestions": [
    {"band": "above", "alt_ft": 40000, "note": "...", "confidence": "satellite_observation"},
    {"band": "below", "alt_ft": 8000,  "note": "...", "confidence": "estimated_base"}
  ],
  "disclaimer": "...",
  "samples": [
    {
      "distanceKm": 0.0,
      "topFt": 29921, "baseFt": 20980,
      "phase": "ice", "supercooled": false,
      "icingExposure": false, "icingLevel": "NONE",
      "cloudTopTemperatureC": -29.9
    }
  ]
}
```

**Icing risk rules (deterministic — no LLM):**

| Level | Condition |
|---|---|
| `HIGH` | `supercooled == true` AND planned altitude within `[baseFt, topFt]` |
| `MODERATE` | `phase == "liquid"` AND cloud top temp < 273.15 K AND within layer |
| `LOW` | Planned altitude within cloud layer, no supercooled conditions |
| `NONE` | No cloud, or altitude outside layer |

---

### `GET /api/icing/frames`

Lists cached GK-2A observation timestamps.

```json
{"frames": [{"ts": "2026-11-11T03:00:00Z", "age_min": 4.2, "stale": false}], "count": 1}
```

---

### `GET /api/icing/status`

GK-2A collection health.

```json
{"source": "GK2A_L2_CTPS", "domain": "KO", "latest_field": {"ts": "...", "age_min": 4.2}, "status": {"stage": "ready"}}
```

---

### `POST /api/route-review/evaluate`

Evaluates a route against a local ECMWF IFS forecast bundle. Returns per-segment weather, fuel estimate (OpenAP), and a CTPS satellite observation overlay when a recent frame is available.

See `/docs` for the full Pydantic schema.

---

## Data Attribution

- **GK-2A CTPS L2** — Korea Meteorological Administration (KMA) National Meteorological Satellite Center (NMSC). Cloud top height, temperature, phase, supercooled flag.
- **Cloud base estimation** — Noh, Y.-J., et al. (2017): Statistical retrieval of thin cloud vertical structure from geostationary satellite imagery. *J. Atmos. Ocean. Technol.* **34**, 585–598. [https://doi.org/10.1175/JTECH-D-16-0066.1](https://doi.org/10.1175/JTECH-D-16-0066.1)
- **GK-2A KO domain coverage** — Lat 32–44.5°N, Lon 122–134.5°E (Korean peninsula and surrounding seas).

---

## Operational Disclaimer

This product is a dispatcher review aid based on satellite observations. It does not replace AIRMETs, SIGMETs, PIREPs, NOTAMs, or flight dispatch authority. The satellite observes the **topmost cloud layer only** — lower layers under thick cloud are not represented. Always consult official aviation weather products before flight.

---

## Known Limitations

- **Single cloud layer** — passive imager physical constraint; layers below optically thick cloud are not visible.
- **KO domain only** — coverage limited to Lat 32–44.5°N, Lon 122–134.5°E. Segments outside the domain return `retrievalState: "outside_domain"` per sample.
- **No real-time download worker** — the satellite cache is populated by an external collector process (from the WeatherPath project). The app is read-only.
- **Cloud base is estimated** — `baseFt` is derived from Noh et al. (2017) statistics, not directly observed.
- **Stale cache fallback** — frames older than 30 minutes fall back to illustrative sample data for the default (no `at=`) query.

---

## What's Next

- Real-time GK-2A download worker integrated into this repo
- Multi-waypoint route input
- Time-window analysis (will the icing clear in 30 minutes?)
- KIM / ECMWF NWP icing probability overlay
- PIREP ingestion for corroboration
