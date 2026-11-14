# AeroIcing Watch

## Kiroween route comparison demo

Compare two illustrative Incheon–Haneda routes using an archived ECMWF IFS forecast and OpenAP cruise fuel estimates. Select a segment to see the weather behind its time and fuel estimate. The fixed scenario uses the same aircraft, departure time, cruise level and initial mass for both routes.

[Open the public demo](https://jinkooy.github.io/AeroIcing-Watch/)

From the repository root, run `python -m http.server 8080 --bind 127.0.0.1 --protocol HTTP/1.1 --directory static/route-demo` and open [localhost:8080](http://localhost:8080/). The demo needs a static HTTP server and a browser. It uses bundled results with no API key, live weather feed or Python packages required. See the [submission notes](docs/AeroIcing_Watch_Submission_Package.md) for reproduction and deployment.

The **3D Replay** link next to the segment controls opens `replay.html`, which flies the selected route through the same archived segments. Both pages share the URL hash `#route=<direct|via>&segment=<0-based index>`, so a link such as `index.html#route=via&segment=20` opens the via route at segment 21 and the replay's 2D link returns to the same segment.

`static/route-demo/scenario.json` uses schema version 2. In addition to the segment midpoints shown in the comparison, each route has a `replay.track` list of exact segment boundaries (segment *i* runs from `track[i]` to `track[i+1]`, with the via waypoint as an exact vertex); the 2D map draws its route lines from this track. Regenerate the file from two archived IFS route evaluations with `python tools/export_route_demo.py <archive-dir>`. The exporter re-derives the segment midpoints and ETAs and refuses to write if they disagree with the archived evaluator output. Run the checks with `python -m pytest tests`.

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
| `at` | ISO UTC string | — | Specific observation frame (GK-2A KO routes) or reference time (global routes); defaults to latest |
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
| `NONE` | Verified clear sky, or altitude outside the observed layer |
| `null` | Not assessed (outside coverage, no retrieval, rejected, source unavailable) |

---

**Global routes.** If any sample lies in a non-GK-2A domain, each sample is read from the best usable source (closest to its sub-satellite point among sources with a frame < 1 h old). Additive fields: `satelliteSources` (array), `polarGap`, `notices`, `domain: "GLOBAL"`, and per sample `satelliteSource` (`gk2a`/`G18`/`G19`/`G16`/`msg`/`null`), `domainEdge`, `observedAt`. `retrievalState` is one of `observed`, `clear`, `no_retrieval`, `quality_rejected`, `inconsistent_retrieval`, `outside_domain`, `source_unavailable`. Unassessed samples have `icingLevel: null`; the route `icingRisk` is the maximum over assessed samples (`null` if none) and altitude suggestions are withheld whenever any sample is unassessed. With an empty cache the illustrative sample is returned (`dataKind: "simulated"`).

---

### `GET /api/icing/sources`

Per-satellite cache status used by the router.

```json
{"sources": [{"source": "G18", "has_cache": true, "age_min": 14.0, "stale": false, "sub_lon": -137.0}], "polar_limit_deg": 70}
```

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
- **Coverage = GK-2A + GOES-West/East + Himawari-9 + Meteosat, when their caches are populated.** GK-2A defaults to the KO domain (Lat 32–44.5°N, Lon 122–134.5°E); `GK2A_CLOUD_AREA=EA|FD` (and `GK2A_CLOUD_BOUNDS`/`GK2A_CLOUD_SHAPE`) select a wider projected cache, but what KMA APIHub delivers beyond KO is **unverified**. GOES-18 (West) and GOES-19 (East) cover the Americas and the East Pacific; Himawari-9 (140.7°E, lon 85°E–155°W) closes the western Pacific/Japan gap that GK-2A-KO and GOES-18 leave on US–Japan routes. Samples with no covering source return `retrievalState: "outside_domain"`; covered samples without a fresh frame return `"source_unavailable"`. Both have `icingLevel: null` ("not assessed", never "no icing").
- **Himawari frames are large** — one scan is ≈0.9 GB to download (`python tools/collect_himawari.py`); only `AHI-CHGT` height/temperature and `AHI-CPHS` phase are used. Phase is taken from the product, never inferred.
- **View-angle quality** — samples seen at a satellite view zenith angle ≥ 60° carry `domainEdge: true`, `viewZenithDeg` and a `qualityNote`; parallax and retrieval quality degrade there (the UI marks them "low-quality view").
- **IFS trans-Pacific bundles** — `tools/collect_ifs.py --route LAT1 LON1 LAT2 LON2` (or `--bbox S N W E`, E may exceed 180) crops across the antimeridian; the bundle longitude axis is stored unwrapped and sampled modulo 360.
- **Polar gap** — nothing above 70°N/S is assessed (`outside_domain`, response `polarGap: true`, `notices: ["polar_gap"]`).
- **GOES-16 is archive-only** — NOAA's `noaa-goes16` bucket stops in April 2025; GOES-19 is the current GOES-East.
- **Meteosat needs EUMETSAT credentials and is unverified** — set `EUMETSAT_CLIENT_ID` / `EUMETSAT_CLIENT_SECRET` (and optionally `EUMETSAT_CTTH_COLLECTION`). Without them the source is skipped gracefully. The download/decode path has not been run against the live Data Store.
- **Cache collectors** — GK-2A frames come from an external collector. GOES frames: `python tools/collect_goes.py G18 G19` (anonymous S3, needs `s3fs`). Cross-section requests never download.
- **Limb/seam quality** — GOES/Meteosat samples more than 65° of longitude from the sub-satellite point carry `domainEdge: true`; parallax and retrieval quality degrade there.
- **GOES lacks GK-2A extras** — no optical-quality/DCOEW data and no emissivity, so cloud base uses the night-path estimate (Noh et al. 2017, derived from East Asian cases; provisional elsewhere).
- **A stale (archived) observation never yields "NONE"** — the route `icingRisk` is `null` with `assessmentState: "stale_observation"`.
- **Cloud base is estimated** — `baseFt` is derived from Noh et al. (2017) statistics, not directly observed.
- **Stale cache fallback** — frames older than 30 minutes fall back to illustrative sample data for the default (no `at=`) query.

---

## What's Next

- Real-time GK-2A download worker integrated into this repo
- Multi-waypoint route input
- Time-window analysis (will the icing clear in 30 minutes?)
- KIM / ECMWF NWP icing probability overlay
- PIREP ingestion for corroboration

## Cloud Dive (the Kiroween 2026 entry)

Cloud Dive is a fuel-cost game on real US icing days. A regional jet flies a real route using
GOES satellite cloud data and an ECMWF forecast. Cruise fast-forwards to a cloud. At each gate
the player picks lane, altitude and anti-ice, each with a dollar price. The score is the total
fuel cost in the game model, lower is better. It is a game model, not a flight procedure and not
an icing severity.

Open `static/cloud-dive/index.html` through any static server, for example
`python -m http.server 8080 --directory static/cloud-dive`. No build step and no API key.

Features:

- Three real cases: KJFK-KBNA (2026-11-12), KDEN-KLAX (2026-11-01), KBUF-KPWM (2026-11-07).
- 3D cockpit view (three.js 0.160.1, vendored) with a panel: fuel counter, ice index (game
  model), anti-ice switch and lamp, altitude tape, panel map, text line with the head-wind
  number. Frost on the windshield, airframe shake, and wind streaks. Shake is off under
  reduced motion.
- Takeoff on a runway, an automatic climb to the game's altitude block, then cruise. Arrival and
  diversion cinematics, then the report. Skip button and Space skip cinematics. A fixed
  illustrative Departure climb cost is added to every flight.
- Chase view (key C) with a generic aircraft model built from primitives.
- Hot-seat for 2 to 4 players on one device with a results table. Nothing is uploaded and there
  is no online ranking.
- 2D side view and map view with the satellite image (key V switches the view). It is also the
  fallback when WebGL is not available.
- Evidence levels (Observed, Possible, Not indicated, Not assessed) and a labelled ice index.
  Best and Straight-ahead baselines appear only after play.
- The same evidence engine feeds the dispatcher cross-section view and API above.

Limits:

- The ground is flat at the departure airport elevation and terrain is not drawn. The game uses no
  terrain data. For KDEN-KLAX, the Why card says so and the altitude block is unchanged.
- Cruise level is the game's altitude block, below airline cruise level, not an ATC assignment.
  Lane spacing and vertical scale are exaggerated in the 3D view (Why cards explain).
- Satellite sees cloud tops only. Cloud base is an estimate.

Measured on this laptop only (Edge 157, Intel UHD 770, 60 Hz display, headless runs recorded in
[`docs/screens/15.6-perf.json`](docs/screens/15.6-perf.json) and
`docs/screens/19.2-chase-*.json`): the cockpit view ran at about 60 frames per second at
1280x720, 1366x768 and 390x844, and 58.7 at 1920x1080. The chase view ran at about 60 (hardware GL and
software GL, both in `19.2-chase-*.json`). 60 is the display refresh cap, so these are not a measure of headroom.
Other devices were not measured.

Not verified: the game was not checked by a human on a phone or in a non-Edge browser. The
390x844 and 800x1000 layouts were checked by a headless Edge script only; they scroll by design.
The MCP browser check of the cockpit on a narrow viewport (checklist C11) is not done yet.

Third-party code and data: [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). Origin of every
file, by tool: [`docs/Preexisting_Work_Disclosure.md`](docs/Preexisting_Work_Disclosure.md).

## Legacy components (outside the Kiroween 2026 entry)

The entry is the US-origin Cloud Dive game and its evidence engine (see
`.kiro/specs/cloud-dive/`). These parts stay in the repository and in git
history but are not part of the entry and are not described in the write-up:

- GK-2A reader and WeatherPath import: `src/integration/gk2a_cloud.py`,
  `tools/import_weatherpath_ctps.py`.
- Meteosat and Himawari sources: `src/integration/meteosat_cloud.py`,
  `src/integration/himawari_cloud.py`, `tools/collect_himawari.py`.
- Fuel route review (OpenAP) and flight lookup: `src/api/route_review.py`,
  `src/analysis/route_weather.py`, `src/analysis/aircraft_performance.py`,
  `src/integration/flight_lookup.py`, `tools/validate_ifs_icing.py`.
- Incheon-Haneda route comparison demo: `static/route-demo/`,
  `tools/export_route_demo.py`, `.github/workflows/route-demo-pages.yml`.
- Night cloud-water path in `src/analysis/cloud_base.py` (cases are daytime only).

Origin of every file (WeatherPath, Kiro, Claude, Codex) is listed in
[`docs/Preexisting_Work_Disclosure.md`](docs/Preexisting_Work_Disclosure.md).
Code copied or adapted from the author's earlier WeatherPath project is
released under this repository's Apache-2.0 licence.
