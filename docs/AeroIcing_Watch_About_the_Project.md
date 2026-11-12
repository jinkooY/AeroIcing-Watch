### Inspiration

Airline dispatchers reviewing possible icing along a proposed flight segment face a gap: satellite viewers show *where* clouds are, but not *how they sit vertically* along the exact route. AeroIcing Watch closes that gap by turning GK-2A geostationary satellite Level-2 observations into a vertical cross-section tied to the actual segment.

### What It Does

AeroIcing Watch is a full-stack web application that delivers a satellite-derived cloud vertical cross-section and icing risk rating for any A–B flight segment.

**Inputs:** Departure and destination (ICAO code or lat/lon), planned cruise altitude, and an optional observation timestamp.

**Outputs:**
- An interactive Canvas chart showing cloud top, estimated base, phase (liquid/ice/unknown), and supercooled cues along the route
- A deterministic icing risk badge (HIGH / MODERATE / LOW / NONE) based on direct satellite retrievals — no model, no LLM
- Altitude suggestions: icing-free bands above and below the observed cloud layer
- A REST API for dispatch system integration

**Offline mode:** When no satellite cache is available the app shows illustrative sample data so the UI can be demonstrated without live data.

### How We Built It

**Backend:** FastAPI (Python) with three satellite endpoints (`/api/icing/cross-section`, `/api/icing/frames`, `/api/icing/status`) and an ECMWF IFS route evaluation endpoint (`/api/route-review/evaluate`).

**Satellite pipeline:**
1. Read projected GK-2A CTPS Level-2 NumPy cache (`cth_ft`, `ctt_k`, `phase`, `supercooled`, `emis11`)
2. Sample the great-circle route at ~15 km intervals (pyproj WGS84 geodesic)
3. Apply GK-2A parallax correction (geostationary geometry, 3-iteration Newton loop)
4. Estimate cloud base using the Noh et al. (2017) statistical cloud geometric thickness method — daytime uses DCOEW cloud water path; night-time uses 11 µm emissivity or median look-up tables
5. Apply deterministic icing rules (HIGH/MODERATE/LOW/NONE)
6. Return a viewer.js-compatible JSON profile with extended fields

**Frontend:** Vanilla HTML + CSS + JS + Canvas (no framework, no build step). The existing `viewer.js` Canvas engine is reused unchanged; `app.js` adds the route input form, risk badge, altitude suggestion cards, and a planned-altitude line in the chart. Built with Kiro IDE.

### Challenges We Faced

The GK-2A satellite observes only the topmost cloud layer. Cloud base cannot be directly retrieved from a passive imager; we adapted the Noh et al. (2017) regression to estimate it from cloud water path. Night-time retrievals require an emissivity-based proxy or look-up table because the DCOEW optical-property product is unavailable in darkness.

Parallax displacement — the apparent shift of a high cloud top from its true ground position as seen from the geostationary orbit — required a 3-iteration correction loop to correctly associate each cross-section sample with the right satellite grid cell.

### Accomplishments

- End-to-end pipeline from raw CTPS Level-2 cache to icing-risk-annotated viewer profile
- Deterministic icing assessment with no LLM or NWP involvement
- Altitude suggestions (icing-free band advisory) derived purely from satellite observations
- Full fallback to illustrative data when no cache is present — the app never shows a blank screen
- ICAO-code lookup for 32 airports across Korea, Japan, China, and Southeast Asia
- Additional ECMWF IFS route evaluation endpoint with per-segment weather and fuel estimate

### What We Learned

Supercooled liquid water detected by GK-2A CP_FLAG is the most operationally significant icing indicator available from passive satellite imagery. Combining it with cloud top temperature and phase gives a three-tier risk signal (HIGH/MODERATE/LOW) that is more informative than a single icing probability.

Cloud base estimation uncertainty is the biggest source of error in the icing exposure assessment. The Noh et al. regression carries ±1–2 km uncertainty; we surface the estimation method on every sample so dispatchers know when a base is well-constrained (DCOEW day) versus loosely estimated (night/emissivity-saturated).

### What's Next

- Integrated real-time GK-2A download worker
- Multi-waypoint route input
- Time-window analysis (icing forecast for departure + transit windows)
- KIM / ECMWF NWP icing probability overlay for comparison
- PIREP ingestion for pilot-report corroboration
- Lateral route deviation advisory (find a path around icing cells)
