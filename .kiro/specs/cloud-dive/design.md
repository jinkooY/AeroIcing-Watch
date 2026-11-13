# Design - Cloud Dive (revision 2026-11-13)

Requirement ids (R*) refer to `requirements.md`. Properties (CD-P*) in section 10
are the contract for property-based tests. Parameter values are illustrative
and uncalibrated; they are stored in each case file (R4.7).

## 1. Architecture

```
GOES-18/19 CONUS (AWS S3, anonymous)        ECMWF IFS 0p25 (AWS mirror)
  ACTPC phase 2 km, ACHAC height 10 km,       gh, t, r, u, v at 925..250 hPa
  CODC optical depth 2 km, CPSC size 2 km     cropped to the route box
              |                                          |
   src/integration/goes_conus.py              tools/collect_ifs.py (levels extended)
              |                                          |
   src/analysis/lanes.py  -- 5 lanes x 10 km steps, parallax-corrected --+
              |                                          |
   src/analysis/cloud_base.py (Noh)               src/analysis/ifs_cube.py
              +------------------+-----------------------+
                                 v
                  src/analysis/evidence.py   (rule v2, four levels)
                                 v
   src/analysis/cost_model.py (OpenAP tables, build time only)
   src/analysis/game_core.py  (pure step, ice, gates)  <-> static/cloud-dive/engine.js
   src/analysis/solver.py     (exact DP: Best, Straight-ahead, Wasteful extreme)
                                 v
                  tools/export_cloud_dive.py
                                 v
        static/cloud-dive/cases/<id>.json + cases/index.json  (committed)
                                 v
   GitHub Pages root = static/cloud-dive/   (game)     /viewer/ = standalone viewer
```

No backend on the public site (R10.3). FastAPI and `/api/icing/*` stay for the
dispatcher view (R11).

## 2. Modules

| Path | Status | Responsibility |
|---|---|---|
| `src/integration/goes_conus.py` | new | Anonymous S3 read of ACTPC, ACHAC, CODC, CPSC for one hour; keeps native arrays and projection; local cache under git-ignored `data/` |
| `src/analysis/lanes.py` | new | Great-circle route, five lanes, 10 km steps (pyproj Geod); lane offsets by forward azimuth +/- 90 degrees |
| `src/analysis/cloud_base.py` | existing (WeatherPath) | Noh base, parallax, solar zenith; night path legacy |
| `src/analysis/ifs_cube.py` | new | ISA altitude to pressure, IFS sampling at (lane, step, altitude), head-wind component, ECMWF isotherm heights |
| `src/analysis/evidence.py` | new | Rule v2 and route summary |
| `src/analysis/cost_model.py` | new | OpenAP fuel tables and parameters (lazy import; build time only) |
| `src/analysis/game_core.py` | new | Pure `step`, ice, cost components, gate lookahead; no I/O |
| `src/analysis/solver.py` | new | Exact dynamic programme over the same transition function |
| `tools/export_cloud_dive.py` | new | Manifest-driven export, validation, secrets scan |
| `tools/check_viewer_contract.py` | new | Python port of `validProfile()` |
| `tools/tune_params.py` | new | Reports Best vs Straight-ahead spread per case |
| `static/cloud-dive/engine.js` | new | DOM-free ES module port of `game_core` |
| `static/cloud-dive/index.html, game.js, game.css` | new | Rendering, input, HUD, gate panel, report |
| `static/cloud-dive/scene.js` | new (revision b) | Pure `buildScene(file, engineState, phasePose, opts)` to a scene description (section 14); no DOM, no clock, no random |
| `static/cloud-dive/phases.js` | new (revision b, required) | Pure phase machine and cinematic poses; `withDeparture` |
| `static/cloud-dive/cockpit3d.js`, `panel.js`, `cockpit.css` | new (revision b) | WebGL drawing of the scene description; HTML overlay for instruments and controls |
| `static/cloud-dive/hotseat.js` | new (revision b, required) | Pure hot-seat session and results table |
| `static/cloud-dive/vendor/` | new (revision b) | Vendored 3D library at an exact version (task 15.1) |
| `.github/workflows/route-demo-pages.yml` | changed | Publish `static/cloud-dive/` at the root and the viewer at `/viewer/` |
| `src/analysis/icing_profile.py`, `src/api/*` | existing | Dispatcher view; unchanged API (R11.1) |

## 3. Data

### 3.1 Geometry
Lanes at -30, -15, 0, 15, 30 km. Step 10 km (about one minute at 330 kt). A case
has N steps (JFK-BNA about 123). Altitude levels every 1,000 ft inside the block
(for example 6,000 to 24,000 ft). Lane 0 is the great circle between the airports.

### 3.2 Satellite (per lane and step)
Native arrays are sampled by nearest pixel after parallax correction
(`apparent_latlon`, sub-satellite longitude of the chosen satellite). The cloud
over a ground point is found by a candidate-height ray search: for heights 0.25
to 16 km (step 0.25) the point appears at `apparent(h)`; take the highest `h`
whose height pixel there reports a top at or above `h`, refine by interpolating
the sign change, and read all layers at that apparent location. A first pass
uses good-quality heights only; a second pass with any finite height gives
`quality_rejected`. (A three-iteration search from the ground pixel was
rejected: it misses clouds displaced over a clear ground pixel.) Resolutions: phase, optical depth, particle size 2 km; cloud-top
height 10 km. The cloud-top height is geopotential height (standard name
`geopotential_height_at_cloud_top`), taken as height above sea level.
Phase code 2 (`super_cooled_liquid_water`) is the supercooled flag; code 3 (mixed)
is kept as `mixed`, not supercooled. Cloud water: `LWP = 2/3 * COD * re` in
g m-2 with re in micrometres (ice: times 0.917). Base: `noh_cloud_base_km` with
that cloud water; null where the method gives none; method `goes_cod_cps` when
cloud water was used. States: `observed`, `clear`, `no_retrieval` (fill or
cloud without height), `quality_rejected`, `inconsistent_retrieval` (clear phase
with a cloud height), `outside_domain`. Quality policy from inspecting real
scans: phase DQF bit 0 set (overall degraded) or height DQF not 0 gives
`quality_rejected`. COD/CPS DQF is a 10-bit mask in which about 89 percent of
supercooled pixels carry the "degraded" bit and about 86 percent the
"non-convergence" bit, so those pixels are NOT rejected; they are used and
labelled `cloud_water_quality` (good or degraded) and
`cloud_water_nonconverged`. Cloud water is dropped (base falls back to the
statistical median, never to a measurement) when a value is not finite, DQF bit
0 (not day algorithm) or bit 6 (glint) is set, or solar zenith is 80 degrees or
more.

### 3.3 Forecast (per lane, step and altitude)
IFS run chosen before the case hour (for 2026-11-12: 00 UTC run, +18 and +21 h,
linear in time). Altitude to pressure with ISA; sampling by `ifs_grid.sample`
(log-pressure, bilinear). Head-wind component `hw = -(u*sin(az) + v*cos(az))`
converted to knots, positive when the wind is against the flight. Levels
925, 850, 700, 600, 500, 400, 300, 250 hPa (all verified present for gh, t, r, u,
v in the 2026-11-12 00 UTC +21 h index).

### 3.4 Case file
```json
{
  "schemaVersion": 2, "id": "20261112-kjfk-kbna-1930z", "title": "...",
  "dataKind": "observation", "route": {"from": "KJFK", "to": "KBNA", "lengthKm": 1232},
  "sources": {"satellite": "GOES-19 ABI L2 ... (UTC time)", "forecast": "ECMWF IFS 0p25 run ...", "attribution": ["..."]},
  "grid": {"stepKm": 10, "lanesKm": [-30,-15,0,15,30], "altitudesFt": [6000, "..."]},
  "start": {"lane": 2, "altFt": 10000},
  "rule": {"name": "cloud-dive-evidence-v2", "version": 2, "...thresholds": 0},
  "params": {"aircraft": "E75L", "engine": "CF34-8E6", "massKg": 30340, "fuelUsdPerKg": 0.79,
             "tasKtByAlt": {}, "flowKgHByAlt": {}, "climbExtraKgPer1000Ft": {},
             "antiIceFactor": 1.08, "speedLossAtFull": 0.12, "dragFlowAtFull": 0.20, "iceExponent": 1.5, "diversionUsd": 5000,
             "iceRates": {}, "possibleRateFactor": 0.25},
  "lanesLatLon": [[[0,0]]],
  "evidence": "uint8 array [lane][step][alt]  (0 Not assessed, 1 Not indicated, 2 Possible, 3 Observed)",
  "headwindKt": "int16 array [lane][step][alt]", "temperatureC": "float array [lane][step][alt]",
  "satellite": [{"lane": 0, "step": 0, "topFt": 0, "baseFt": 0, "phase": "liquid", "supercooled": true, "retrieval": "observed"}],
  "references": {"best": {}, "bestNoAntiIce": {}, "bestAlwaysAntiIce": {}, "straightAhead": {}, "wasteful": {}},
  "balance": {"B1": true, "B2": true, "B3": true, "B5": true, "antiIceKmInBest": 0},
  "viewerProfile": {"title": "...", "samples": []}
}
```
Revision b adds two fields, written by `tools/tune_params.py --write` and a small exporter
step that refuse to change anything else (same guard as the map exporter):
`params.departureClimbUsd` (illustrative; formula recorded in `params.departureClimbNote`)
and `airports: {from: {icao, elevFt}, to: {icao, elevFt}}` (elevations are `elev_ft` from the repository's
`airports.json`, which `tools/build_airports.py` builds from the OurAirports CSV; the source and licence are checked and
recorded in `THIRD_PARTY_NOTICES.md`, decision G12). Evidence, references, balance and `viewerProfile` stay byte-identical.
Arrays are stored flat in one of two shapes: `{shape, data}` (evidence, headwindKt, ...)
or a group object with one `shape` and one plain flat array per field (`satellite`,
`isotherms`). Every reader (engine, renderer, tests) accepts both shapes through one helper.
Expected size under 300 KB per case.

### 3.5 Map image and basemap (`tools/export_map_images.py`)
Separate from the case exporter: it writes only the `map` field and the image files, so
evidence, references and balance stay unchanged (checked by comparing the rest of the file).
- Image: ABI-L2-CMIPC band 13 (10.3 um brightness temperature) from the case satellite
  and the scan nearest the case time, greyscale with 180 K white and 310 K black
  (stated in the legend). Plus ACTPC cloud-top phase as a palette PNG; the palette
  classes differ in brightness so they stay distinct in greyscale.
- Grid: local equirectangular projection centred on the route midpoint,
  x = (lon - lon0) * cos(lat0) * 111.32 km and y = (lat - lat0) * 110.57 km. Extent:
  all lane points plus 100 km. Pixels are 2 km, sampled nearest-neighbour from the ABI
  fixed grid (pyproj geos). Missing or off-disk pixels are transparent.
- Case field: `map: {projection: "equirect-local-v1", lat0, lon0, xMinKm, yMaxKm,
  pxKm: 2, width, height, images: {ir: "<id>.ir.png", phase: "<id>.phase.png"},
  scanUtc, product, maxParallaxKm}`. Size budget: 400 KB of images per case.
- Basemap: Natural Earth 1:50m state lines and coastline (public domain), clipped to the
  union of the case extents and simplified to 1 km, in `cases/basemap.json` (under 150 KB).
  Attribution: NOAA GOES, Natural Earth.

## 4. Evidence rule v2 (per cell: lane, step, altitude)

Implemented in `src/analysis/evidence.py` (`evaluate_cell`). Inputs: satellite retrieval
state, top, base, supercooled flag; ECMWF temperature and humidity at the altitude;
isotherm heights; altitude. NaN and infinity count as missing. An observed cloud without a
top is incomplete evidence and is treated like an unusable satellite state.

| # | Condition (first match wins) | Level | reason |
|---|---|---|---|
| 1 | satellite `clear` | Not indicated | `satellite_clear` |
| 2 | satellite `observed`, top known, altitude above the top | Not indicated | `above_cloud_top` |
| 3 | satellite `observed`, supercooled, top known, an isotherm height missing | Not assessed | `isotherm_unavailable` |
| 4 | as 3, base known, altitude in [max(base, zeroC), min(top, minus20C)] | Observed supercooled layer at planned altitude | `inside_candidate_layer` |
| 5 | as 3, base unknown, altitude in [zeroC, min(top, minus20C)] | Not assessed | `cloud_base_unknown` |
| 6 | forecast available and T in [-25, 0] C and RH >= 85 percent | Possible (forecast only) | `forecast_criterion_met` |
| 7 | forecast available, criterion not met | Not indicated | `forecast_criterion_not_met` (satellite observed) or `no_supercooled_signal_forecast_dry` |
| 8 | forecast missing, satellite `observed`, supercooled false | Not indicated | `no_supercooled_signal` |
| 9 | otherwise | Not assessed | `satellite_unavailable`, the retrieval state, or `forecast_unavailable` |

Why this order:
- Row 1 comes before the forecast: a clear-sky pixel has no cloud, so a humid forecast must
  not produce `Possible`.
- Row 2 needs no isotherms: nothing is above the highest observed cloud top.
- Row 3 stops a satellite-supercooled cell with unknown isotherms from falling through to
  the forecast rows and ending as `Not indicated`.
- Rows 6 and 7 apply when the altitude is below the observed base or outside the candidate
  layer: the satellite sees only the top layer, so the forecast has the say there.
- Row 8 is a limited negative signal; the reason code keeps that nuance. `Not indicated`
  means "no indication", not "no icing".
- The rule never returns `Possible` when the cell qualifies as Observed.

Isotherms: from the IFS temperature profile when levels 925 to 250 hPa are present
(`isotherm_heights_from_profile`: lowest freezing crossing, then the lowest -20 C crossing
above it; extrapolated with the lapse rate when the profile does not reach them, method
`ifs_profile_extrapolated`); otherwise from the cloud-top temperature and a lapse rate of
1.98 C per 1,000 ft (`cloud_top_lapse_rate_estimate`). The method is stored. The -20 C
height is never below the 0 C height; this is checked by property CD-P4 and by 200,000
random profiles.
## 5. Cost model

Per step of length d (10 km, plus the extra path of a lane change) at altitude
level a, lane l and step s, with ice index `ice` (0-100) and anti-ice switch `AI`:

```
iceTerm  = (ice / 100) ^ 1.5                              # convex: late ice hurts most
TAS      = tasKtByAlt[a] * (1 - speedLossAtFull * iceTerm)
GS       = max(TAS - headwindKt[l][s][a], 120)            # knots
hours    = d / (GS * 1.852)
flow     = flowKgHByAlt[a] * (AI ? antiIceFactor : 1) * (1 + dragFlowAtFull * iceTerm)
cruise   = flow * hours * fuelUsdPerKg
climb    = climbExtraKgPer1000Ft[a] * (1000 ft climbed this step) * fuelUsdPerKg
detour   = flow * (extra path hours) * fuelUsdPerKg       # hypot(10, 15) - 10 = 8.0 km per lane change
```
Descending costs no extra and earns no credit. A diversion adds `diversionUsd`
(illustrative, $5,000, set with `tools/tune_params.py --write` so that B5 holds) and ends
the flight (not ranked).

### 5.1 Penalty table (both anti-ice choices cost something)

| Choice | What it costs | Stops when |
|---|---|---|
| Anti-ice on | `antiIceFactor` on fuel flow, every step it is on, also in clear air (bleed air) | switched off |
| Anti-ice off, in Observed cell | ice index rises; speed falls by up to `speedLossAtFull` and fuel flow rises by up to `dragFlowAtFull` for the **rest of the flight** (the index never decreases) | never; at index 100 the flight diverts |
| Anti-ice off, in Possible cell | the same, at `possibleRateFactor` of the rate | never |
| Lane change | 8 km of extra path per lane | - |
| Climb | extra fuel per 1,000 ft | - |

Initial placeholder values, all tunable and labelled illustrative:
`antiIceFactor` 1.08, `speedLossAtFull` 0.12, `dragFlowAtFull` 0.20, exponent 1.5,
`possibleRateFactor` 0.25, `baseGain` 7. They are chosen only through
`tools/tune_params.py` so that the balance criteria below hold.

### 5.2 Balance criteria (R4.8), computed by the solver per case

- B1: Best <= 0.97 x Straight-ahead.
- B2: Best with anti-ice forced off is at least 3 percent costlier than Best, or does not complete.
- B3: Best with anti-ice forced on is at least 3 percent costlier than Best.
- B4: Best uses anti-ice for at least 20 km on at least two of the three cases.
- B5: `diversionUsd` > Straight-ahead cost of the case (every diverted flight costs more
  than Straight-ahead, because the cost up to the diversion is non-negative).

If a case fails, the allowed levers are the altitude block and the corridor
width in the manifest, then the parameters in 5.1; the weather data are never
edited. Results are stored in the case file; the exporter refuses a failing case.

Result of the first real export (2026-11-13). With the placeholder parameters and a block up to
24,000 ft, the Best flight never used anti-ice (B2 and B4 failed on all three cases): the observed
supercooled bands lie at 7,000 to 13,000 ft, climbing over them costs about $8 per 1,000 ft and
saves fuel per kilometre, so everyone climbs. The levers of this section were then used, and only
these: the altitude block (6,000 to 12,000 ft for JFK-BNA and BUF-PWM, 10,000 to 20,000 ft for
DEN-LAX, so the −20 C level stays out of reach and the player must choose between lane, altitude and
anti-ice) and four parameters (baseGain 20, speedLossAtFull 0.25, dragFlowAtFull 0.5,
possibleRateFactor 0.6; antiIceFactor stays 1.08). The weather data were not touched. Result:
Best is 5 to 8 percent cheaper than Straight-ahead, Best without anti-ice is 4 to 12 percent
costlier, Best with anti-ice always on is 5 to 8 percent costlier, and Best uses anti-ice for 200 to
490 km. The low ceiling is a game setting and is stated in the game note.

Illustrative scale from OpenAP for the E75L at 30,340 kg: about 3.3 kg/km at
6,000 ft down to 2.2 kg/km at 30,000 ft; 1,232 km costs about $3,240 at 6,000 ft
and $2,170 at 30,000 ft at $0.79/kg. Higher is cheaper per kilometre, so the
altitude block and the wind must create the trade-off; the balance criteria check it.
## 6. Ice state

Integer index 0 to 100. Per step, without anti-ice:
`gain = round(baseGain * tempFactor(T) * waterFactor(LWP) * rateFactor)` where
`rateFactor` is 1 for Observed, `possibleRateFactor` for Possible, 0 otherwise;
`tempFactor` is a triangle on [-20, 0] C peaking at -10 C; `waterFactor =
min(1.5, 0.5 + LWP / 100)`; `baseGain` about 7 so a full Observed layer reaches
100 in about 150 km. Satellite fields are those of the lane and step; LWP is null
for Possible cells, then `waterFactor` is 1. The index never decreases (its drag lasts for the rest of the flight, section 5.1); at 100 the
flight ends (diversion). All gains are integers, so the solver is exact.

## 7. Game engine (decision gates)

State: `{step, lane, alt, targetLane, targetAlt, antiIce, ice, cost parts,
kmPerLevel, minutesAntiIce, status, lastIcingStep, iceGateDone}`. `lastIcingStep` is the
index of the last Observed or Possible cell flown (null before any); `iceGateDone` is true
after the ice gate.
`step(state, case)` performs one 10 km step: move toward the targets by at most
one lane and 1,000 ft; read the cell (lane, step, alt); update ice, cost and
`kmPerLevel`; return the new state and the events.

`gateReasons(case, state)` returns the reasons that hold at a boundary, in the order
`ice`, `exit`, `entry` (constants: ENTRY_LOOKAHEAD 3, MERGE_GAP 5 steps, ICE_GATE 50):
- `entry`: the cell just flown is neither Observed nor Possible, the 3-step lookahead
  (current targets) reaches such a cell at index e, e differs from the announced entry,
  and NOT (anti-ice on AND lastIcingStep is not null AND e - lastIcingStep - 1 < 5);
- `exit`: anti-ice on, the cell just flown is Observed or Possible, and the 5-step
  lookahead contains no such cell (fires at the edge of the cloud cluster, once);
- `ice`: ice >= 50 and not iceGateDone.
`runUntilGate` stops when the list is non-empty (one gate, all reasons), when the flight
ends (arrival or diversion), or when the player pressed pause (UI, between steps).
A skipped entry does not set the announced entry. Merging applies only with anti-ice on,
and anti-ice changes only at a gate or pause, so CD-P14 is unchanged.

Rendering at a gate: the cross-section along lane 0 and the other lanes, the ECMWF
wind barbs and forecast-environment shading, the unknown curtain; no costs ahead,
no recommended action (R6.5).

### 7.1 Implementation notes (src/analysis/game_core.py)
- Segment `s` is flown in the cell `(lane, s, alt)` reached by that segment's move, so cells
  0..N-1 are flown and cell N is display only. The last segment may be shorter than 10 km.
- Ice gain is a stored integer per cell (`iceGain`, computed once by `compute_ice_gain` with
  round-half-up), so Python and JavaScript read the same integers. The case file also keeps
  `temperatureC` and `lwpGm2` so the tuner can recompute the gain. Missing temperature uses
  factor 0.5; missing water uses factor 1. Head-wind is stored as integer knots.
- The cost uses the ice index before the segment; the gain applies after it. The climb extra is
  charged at the level reached; a lane change adds `hypot(10, lateral) - 10` km at the actual
  flow and ground speed. Cost components: base, antiIce, ice, climb, detour (+ diversion).
- Gates are checked at every segment boundary, and at the start of the flight. The call that
  continues from a gate always flies at least one segment. An entry gate is announced once per
  predicted entry cell (the player can still pause anywhere). Interpretation of R6.4: the gate or
  pause is a decision boundary at or before the boundary where the entering segment starts, and
  at most two segments before it (property CD-P14 checks `entry-2 <= stop <= entry`).
- The solver treats anti-ice as a free per-segment action (no switching cost), so the state is
  `(step, lane, altitude, ice)`; it is vectorised over lane, altitude and ice with the same
  `cost_components` function the engine calls. It is checked against brute force on tiny cases.

## 8. Reference solver

Exact dynamic programme over `(step, lane, altLevel, antiIce, ice)` with ice in
0..99 (100 is terminal) and actions `(dLane in {-1,0,1}, dAlt in {-1,0,1}, antiIce
in {0,1})` per step: 5 x 25 x 2 x 100 states, about 35 actions. The transition is
the same function as `step`. Outputs: Best (minimum cost over completed flights), Best with anti-ice forced off,
Best with anti-ice forced on, Wasteful extreme (maximum cost over completed flights),
and Straight-ahead (centre lane, start altitude, anti-ice on exactly while the cell is
Observed or Possible). The forced variants feed balance criteria B2 and B3. The solver can
pause anywhere; a player who pauses at every step can match it.

Departure climb (revision b): the solver and `game_core` do not change. The displayed
references and the player's total are `engine total + params.departureClimbUsd`, added by
`withDeparture` (Python helper for reports and tests, JavaScript in `phases.js`). Balance
B1 to B5 and CD-P12, CD-P16, CD-P17 stay on engine totals. The saving share
(SA - P) / (SA - Best) is the same with or without the constant. A diverted total is
cost up to the diversion + `diversionUsd` + the constant.

## 9. UI

Layout: a top-view mini map (route, lanes, aircraft), the cross-section (altitude
against distance for the selected lane) with the cloud body by phase, dashed
estimated base, hatched candidate band, wind barbs, forecast-environment shading,
the "Unknown" curtain; a HUD with the running dollar total, ice bar, anti-ice
switch, altitude, lane and distance; a gate panel (lane, altitude, anti-ice,
continue); the end-of-flight report (components, references, share of possible
saving from Straight-ahead (0 percent) to Best (100 percent), negative when costlier than Straight-ahead, kilometres per level, personal best, share text without severity words). The gate panel names every reason; the ice reason reads "Ice index (game model) reached 50 of 100" with no severity word.
Patterns plus text labels distinguish data kinds and levels (R10.1). Keyboard:
arrow keys for lane and altitude, A for anti-ice, Space to continue or pause.

### 9.1 Map view (`static/cloud-dive/map.js`, DOM-free projection helpers)
- Layout: see 9.2. The overview is an inset in the top-left corner of the follow view
  (about 28 percent of its width).
- `mapProject(map, lat, lon)` / `mapUnproject(map, xPx, yPx)` are shared by every drawing
  call and by the tests.
- Follow view: about 200 km across, north-up and centred on the aircraft. It draws the
  image (`imageSmoothingEnabled = false`), state lines, the five lanes at true spacing,
  the evidence of each cell ahead at the current altitude as lane-wide patches with the
  side-view patterns, the flown track, the aircraft icon heading along the lane, and a
  highlight on the side-view lane.
- Overview: the whole route, the aircraft dot and the follow-view box.
- Image toggle: key M and a button switch between IR (default) and cloud-top phase.
- Motion: during fast-forward the icon is interpolated between the last two step positions
  over the tick interval (display only).
- Side view: a vertical "now" line at the aircraft's distance.
- Fallbacks follow R13.7, and the legend carries the R13.3 and R13.4 texts.

### 9.2 One-screen layout (R14)
- The flight screen is a CSS grid of height 100dvh with no `max-width`:
  `grid-template-rows: auto 1fr auto` (top bar, main, bottom bar) and in the main area
  `grid-template-columns: minmax(0, 58fr) minmax(360px, 42fr)`. The left column holds the
  map. The right column holds the side view (about 55 percent of its height) above the
  gate panel and the controls.
- Top bar (about 48 px): title, case title, HUD chips (total, ice bar with number,
  anti-ice, altitude, lane, distance) and "Change case".
- Bottom bar (about 28 px): the game note, a one-line attribution, and the buttons
  Legend (L), Why?, Sources.
- Map key strip at the bottom of the map column: the four evidence patterns with labels
  and the image label (R13.3). The R13.4 notes go in the Legend dialog and in the key
  strip tooltip.
- Side view: `renderScene(canvas, view, {legend: false})` draws no side legend inside the
  canvas; that legend moves to the Legend dialog.
- Gate panel: a fixed-height area above the controls (3 lines, overflow scrolls inside),
  so a gate never moves the layout.
- Controls: a compact 2 x 2 grid (lanes, altitude, anti-ice, Start/Continue). Buttons stay
  at least 44 x 44 px.
- Canvas sizing: `fitCanvas(canvas)` uses a ResizeObserver and sets
  `width = clientWidth * devicePixelRatio`, then `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)`.
  Draw functions use CSS-pixel boxes, as now.
- Dialogs: native `<dialog>` with `showModal()`. Report, Why and Sources move into
  dialogs; the report opens when the flight ends.
- Narrow screens (R14.6): below 1280 px or in portrait, one column (map, side view,
  controls) with page scroll.
- Layout check: `?layoutcheck=1` sets `data-fits` on `<body>` to `yes` or `no`
  (`scrollHeight <= innerHeight` after the first render and at the first gate). This is
  for headless tests only and is never shown.

## 10. Correctness properties (Hypothesis and Node)

| Id | Property | Requirement |
|---|---|---|
| CD-P1 | Not assessed is sticky: with satellite and forecast both missing for a cell, the level is `Not assessed` for every altitude | R2.5 |
| CD-P2 | Observed implies evidence: `Observed` => satellite observed, supercooled true, altitude in [max(base, zeroC), min(top, minus20C)] | R2.3 |
| CD-P3 | Layer containment: when a candidate layer exists, base <= lower <= upper <= top | R2.6 |
| CD-P4 | Isotherm ordering: minus20C height >= zeroC height | R2.6 |
| CD-P5 | Summary conservation: km per level sums to the distance, within 0.001 km | R8.1 |
| CD-P6 | Cost components are non-negative and sum to the total | R4.6 |
| CD-P7 | Determinism: same case and same actions give equal state in Python and in JavaScript | R6, R2.8 |
| CD-P8 | Anti-ice and ice: turning anti-ice on never raises the ice index and never lowers fuel flow; a higher ice index never lowers the cost of a step and never raises the speed | R5.3, R4.4, R4.5 |
| CD-P9 | Ice index never decreases; flight ends at 100 | R5.4, R5.5 |
| CD-P10 | Bounds: lane in 0..4, altitude inside the block, at most one lane and 1,000 ft per step | R7.2, R7.3 |
| CD-P11 | Distance conservation: kilometres per level sum to the distance flown | R8.1 |
| CD-P12 | Solver bounds: Best <= cost of any random completed policy <= Wasteful | R8.2 |
| CD-P13 | Lane sampling: distances start at 0, strictly increase, lanes are parallel within 0.5 km | R3.1 |
| CD-P14 | No silent entry: for any policy, entering an Observed cell with anti-ice off is preceded by a gate or pause at least one step earlier | R6.4 |
| CD-P15 | Case finiteness and viewer validity | R3.4 |
| CD-P16 | Straight-ahead reference equals the cost of the matching fixed policy | R8.3 |
| CD-P17 | Restricted solvers: Best <= Best with anti-ice forced off, and Best <= Best with anti-ice forced on (or the restricted flight does not complete) | R4.8 |
| CD-P18 | Gate merging: with anti-ice on, no entry gate occurs within 5 segments after an Observed or Possible cell; with unchanged targets, an exit gate is followed by at least 5 cells that are neither | R6.2, R6.6 |
| CD-P19 | Ice gate: a flight that reaches ice index 50 and is still flying has exactly one ice gate, at the first boundary with index >= 50; otherwise none | R6.2 |
| CD-P20 | Renderer columns: per lane, the number of "Not assessed" curtain columns equals the number of steps whose satellite state is neither observed nor clear, for both array shapes | R10.1, R2.5 |
| CD-P21 | Map registration: for every lane and step, project then unproject returns the point within half a pixel, and every lane point lies inside the image extent | R13.1, R13.2 |
| CD-P22 | Map and side view agree: the evidence drawn for a lane cell on the map equals the level of the side-view column for that lane, step and altitude | R13.5 |
| CD-P23 | Scene purity: same (case, engine state, phase pose, options) gives a deep-equal scene; deep-frozen inputs are not mutated; the scene holds only finite numbers | R19.5 |
| CD-P24 | Cloud truth: every cloud volume lies on a lane and step whose retrieval is `observed` with a finite top; none where `clear`; top and base equal the case numbers within the merge tolerance; a null base gives a faded, "estimated" volume | R16.6 |
| CD-P25 | Evidence mapping: every evidence band has the level the engine reports (`levelAt`) for each cell it covers; `Not indicated` produces no band; every Observed cell in the view window is covered by a band | R16.7, R16.8 |
| CD-P26 | Budgets: for every case, step and altitude, volumes <= `MAX_CLOUD_VOLUMES`, bands <= `MAX_EVIDENCE_BANDS`, estimated triangles <= `MAX_TRIANGLES` | R19.3 |
| CD-P27 | Gate-choice equivalence: any sequence of panel actions gives the same engine targets and the same flight as the matching 2D actions; targets stay inside the corridor and the block | R17.2, R7.2 |
| CD-P28 | Effects: frost = ice / 100 and never decreases over a flight; shake is 0 unless anti-ice is off, the cell is Observed or Possible, ice > 0 and reduced motion is off; the wing-heat lamp equals the anti-ice switch | R18.1, R18.2, R18.3, R15.12 |
| CD-P29 | Departure constant: for any action sequence the departure climb component is the same number; displayed total = engine total + constant; engine state and balance B1 to B5 are unchanged by it | R15.5 |
| CD-P30 | Phase machine: only the transitions of section 14.6 occur; the engine steps only in cruise and gate; the engine state at the start of cruise is the initial state; skipping a cinematic changes no value; in takeoff and climb the camera x is in [-`LEAD_IN_KM`, 0], no volume has x0 < 0, no evidence band is drawn and `cloudAlpha` is 1 only after the fade | R15.6, R15.7, R15.11, R15.13, R15.15 |
| CD-P31 | Hot-seat: the table has one row per player, ranked flights ordered by total, diverted flights marked "not ranked", nothing written to storage except the per-case local best | R20.2, R20.3 |
| CD-P32 | Cost pop-up: N equals the sum of the component differences between two consecutive stops, is never negative, and is not shown before any choice at a gate | R18.5, R6.5 |

Unit tests cover every rule row, the cost formulas with fixed numbers, and the
parallax correction on a synthetic cloud. A wording test scans `static/cloud-dive/**`
and case files for the R9.1 terms.

## 11. Error handling

- Missing or unreadable case file: show the case list with the entry disabled
  and the reason; never a blank canvas.
- Case with no Observed cell on the straight path: the game still plays and the
  report says so.
- Export fails on any non-finite value, secret, absolute path or missing source.

## 12. Risks and cuts (about 21 days left on 2026-11-13)

| Risk | Mitigation |
|---|---|
| Too much to build | Order: evidence, cube export, Python core, JS port, UI. Required: groups 13 to 16 (except 16.2, 16.4, 16.7), 17.1 to 17.4, 17.6 to 17.8 and 18. Cuttable, first to go first: chase view (19), wind streaks (16.4), shake (16.2), arrival and diversion cinematics (17.5); optional cost pop-up (16.7); then third case, Wasteful extreme, share text. Each group ends shippable; feature freeze 2026-11-28 (approved, G9) |
| 3D scope grows past the schedule | The scene description is built and tested first (group 14); the cockpit cruise view (15) already ships a playable 3D game; the 2D view stays as the fallback |
| Frame rate on a laptop or phone | Geometry caps per lane and step (14.9), pixel-ratio cap, adaptive view distance, merged geometry; `?perf=1` overlay; measured in task 15.6, never assumed |
| 3D view invents data or reads as severity | Volumes only where the satellite reports a top; no noise or random; base faded and "estimated"; effects only draw the engine state (CD-P24, CD-P25, CD-P28); wording test on scene strings |
| Vendored library breaks the wording test or the licence list | Exact pinned version, MIT licence and file hash recorded in `THIRD_PARTY_NOTICES.md`; the wording test skips `vendor/` and scans scene strings (G7) |
| Motion discomfort | Small shake with a fixed limit; none under reduced motion; shorter cinematics; Skip |
| Flat ground misleads on Denver | Stated in a "Why?" card and the README; no terrain claim (G10); the video uses KJFK-KBNA (G11) |
| WebGL unavailable (old phones, locked browsers) | 2D view fallback with the same flight and costs (R19.1) |
| Trivial game (always climb, never use anti-ice, or always use it) | Altitude block, ECMWF head-winds, climb cost and the two-sided anti-ice penalty; balance criteria B1 to B5 (section 5.2) are enforced by the exporter |
| GOES height is 10 km resolution | Label it; lanes are 15 km apart; no claim finer than a pixel |
| Anti-ice penalty has no source | Stored as a labelled game parameter |
| OpenAP licence | Build-time only, never shipped; notice in `THIRD_PARTY_NOTICES.md` |
| 21 UTC low sun in the east | Use 19-20 UTC and the solar-zenith check |

## 13. Out of scope

3D realism (terrain and obstacles, real aircraft or cockpit models, liveries, flight dynamics, sound, VR; the 3D cockpit view itself is section 14), online multiplayer, map tiles, animated satellite loops, real icing physics, live data, accounts, an online leaderboard, advice
on real operations, the Incheon-Haneda demo, Meteosat, Himawari, GK-2A.

## 14. 3D cockpit renderer (revision b)

### 14.1 Principles and data flow
The renderer is read-only. Nothing in it changes the case file, `engine.js` or the cost
model.
```
case file + engine state (controller.js) + phase pose (phases.js)
        |  buildScene()  pure, tested in Node          (scene.js)
        v
scene description (plain JSON)
   |-> cockpit3d.js   draws sky, ground, lanes, clouds, evidence, frost (three.js)
   |-> panel.js       HTML overlay: instruments, text line, controls, legend strip
```
Gates, actions and costs go through the existing controller, so the 2D and the 3D view play
the same flight (CD-P27).

### 14.2 Coordinates and scale
World x = along-track km, z = lateral display km (positive to the right of travel, as in
`lanes.py`), y = altitude. The case route starts at x = 0 ("Top of climb") and the runway is
at x = -`LEAD_IN_KM` (section 14.6). Three display constants, all in `scene.js` and listed in
the display-scale "Why?" text (R16.12):
- `VEX`, vertical exaggeration (starting value 3), so a cloud a few thousand feet thick is
  visible next to 15 km lane spacing;
- `LATK`, lateral compression of lane spacing (starting value 0.5; 1 = true spacing; may go down to 0.2 in task 15.2 if the side lanes are not readable from the cockpit): lane
  guides, cloud footprints and the camera z are all multiplied by it, so the lanes stay in
  view in front of the windshield, as the 2D map widens its lanes to be readable;
- `LEAD_IN_KM`, the climb lead-in (starting value 30, tuned in 17.4).
Field of view, eye height, `VEX` and `LATK` are tuned in task 15.2. The engine always uses true
distances (15 km lanes, 10 km steps); only the scene is scaled (CD-P23 checks this).

### 14.3 Scene description
```json
{
  "schemaVersion": 1, "phase": "cruise", "mode": "cockpit",
  "camera": {"pos": [0,0,0], "yawDeg": 0, "pitchDeg": 0, "rollDeg": 0, "fovDeg": 75},
  "sky": {}, "ground": {"y": 0, "elevFt": 0},
  "lanes": [{"index": 0, "zKm": -30, "isCurrent": false, "isTarget": false}],
  "airports": [{"icao": "KJFK", "role": "departure", "xKm": -30, "zKm": 0},
               {"icao": "", "role": "topOfClimb", "xKm": 0, "zKm": 0}],
  "cloudAlpha": 1,
  "clouds": [{"lane": 0, "step": 0, "x0Km": 0, "x1Km": 10, "zKm": -30, "halfWidthKm": 7.5,
              "topFt": 0, "baseFt": null, "baseEstimated": true}],
  "evidence": [{"lane": 0, "step0": 0, "step1": 0, "level": "Observed supercooled layer at planned altitude",
                "loFt": 0, "hiFt": 0}],
  "effects": {"frost": 0, "shakeDeg": 0, "wingLamp": false, "windStreaks": 0, "headwindKt": 0},
  "panel": {"totalUsd": 0, "components": {}, "ice": 0, "antiIce": false, "altFt": 0, "lane": 2,
            "distanceKm": 0, "levelHere": "", "levelAhead": "", "textLine": "", "gate": null}
}
```
All numbers finite; the function uses no clock, no random and no DOM; strings come from one
table that the wording test scans (CD-P23).

### 14.4 Clouds
One volume per (lane, step) with retrieval `observed` and a finite top: footprint 10 km along
by 15 km across, from `topFt` down to `baseFt`. A null base gives a thin faded volume below the
top, as the 2D view draws a thin cap. The base edge fades and is labelled "estimated". Shading
is a fixed soft-edge gradient: no noise, no random, no per-cell variation. Window: 2 steps
behind to the view distance ahead; no volume starts before x = 0. `cloudAlpha` is 0 during
takeoff, 0 to 1 over the last 1.5 s of the climb, and 1 afterwards. Beyond 12 steps ahead, neighbouring cells of one lane are
merged when top and base differ by at most the merge tolerance (500 ft, raised to 1,000 ft if
the cap is exceeded); the window shrinks last. Observed evidence is never dropped to meet the
cap (CD-P24, CD-P26).

### 14.5 Evidence
Bands are runs of cells of one lane with the same level and the same altitude interval,
merged along track. `Observed` (orange glow) and `Possible` (blue haze) bands cover the whole
block inside the window. `Not assessed` (sparse grey hatch) is drawn only within 2,000 ft of
the aircraft altitude, like the 2D curtain. `Not indicated` makes no band. Priority when the
cap binds: Observed, Possible, Not assessed. The four drawings differ by pattern (solid glow,
stippled haze, line hatch, nothing) and each has a text label on the panel (CD-P25, R16.8).

### 14.6 Phases
```
ready -> takeoff (5 s) -> climb (10-15 s) -> cruise <-> gate -> arrival (10 s) -> report
                                                  \-> diversion (4 s) -> report
```
`phases.js` holds a pure `phaseStep(phaseState, dtMs, input)` and `phasePose(phaseState)`
(camera pose, displayed altitude, panel readout). The engine steps only in cruise and gate,
through the existing controller. At the end of the climb the controller creates the initial
engine state (step 0). The runway is at x = -`LEAD_IN_KM` and x = 0 is the "Top of climb" marker, where the engine starts at step 0 (decision G5). The
climb is a cinematic over the lead-in: the camera moves from the runway to x = 0 at a display speed chosen so
the climb lasts 10 to 15 s, the altitude tape rises from the airport elevation to the start altitude, and engine
distance stays 0 km. The lead-in is a display convention: the case route length is unchanged, so the drawn
airport-to-airport distance is `LEAD_IN_KM` longer than the route; the Why text says so. During takeoff and climb no
evidence band is drawn, clouds have `cloudAlpha` 0 and fade in over the last 1.5 s, and the camera stays at x <= 0,
so the player never appears to fly through evidence without the engine (and frost) running (R15.15). `withDeparture(total)` adds
`params.departureClimbUsd`. Under reduced motion each cinematic is at most 2 s. Skip
jumps to the end pose (CD-P29, CD-P30).

The departure climb constant is computed once at build time from the same OpenAP climb table
(extra fuel per 1,000 ft from the departure airport elevation to the start altitude, the first
table entry used below the block); the formula is recorded in `params.departureClimbNote`
and the value is labelled illustrative.

### 14.7 Camera
Cockpit: eye at the aircraft position (lane z, altitude y, step x interpolated by the same
`motionFrac` as the map), looking down track; pitch +8 degrees in the climb, small pitch
change in the arrival descent. Fast-forward is a normal forward motion at a display speed.
At a gate the speed eases to zero over at most 1.5 s (R15.8). Lane guides are faint lines at the
aircraft altitude; at a gate they become "sky gates" at the next boundary. Chase (key C,
task 19): camera behind and above a generic aircraft model drawn at an exaggerated display
scale; no livery.

### 14.8 Panel and feedback
The panel is an HTML overlay (G6): fuel counter, ice gauge with the label "Ice index (game
model)", anti-ice switch with a lamp, altitude tape, a canvas top-view map from `map.js`
helpers (lanes, track, next cells with the R13.5 patterns, no image), a legend strip with the four
level names, one small text line (lane, distance, head-wind in kt, level here and ahead, source
and UTC time), and the game note. Text updates for assistive technology at most every 1.5 s, as
the map text alternative does.

| Cue | Source | Rule |
|---|---|---|
| Frost on windshield edges | `ice` | opacity = ice / 100; never decreases |
| Shake | `ice`, `antiIce`, level of the cell flown | amplitude = ice / 100 x `SHAKE_MAX_DEG` (starting value 0.4); zero when anti-ice is on, outside Observed or Possible cells, or under reduced motion |
| Wing-heat lamp | `antiIce` | on while anti-ice is on |
| Fuel counter rate | per-step cost of the engine | interpolated; faster with anti-ice on because the engine cost is higher |
| Cost pop-up (optional, 16.7) | cost components before and after the stop | "+$N this segment" for a few seconds at a gate, pause, step or the end; N = sum of the component changes since the previous stop; never shown before a choice |
| Wind | `headwindKt` at the current cell | at most 12 streaks, speed from the number; head-wind number in the text line |

### 14.9 Performance and caps
Starting values, tuned in task 15.6: `MAX_CLOUD_VOLUMES` 160, `MAX_EVIDENCE_BANDS` 240,
`MAX_TRIANGLES` 40,000, view distance 80 km with fog, device pixel ratio at most 2 (1.5 on
touch devices), merged or instanced geometry so one draw call serves many volumes. Adaptive
step: if the mean frame time exceeds 40 ms for 2 s, drop the pixel ratio to 1 and the view
distance to 50 km. `?perf=1` shows a frame-rate overlay (never shown otherwise). Targets are
60 fps on a laptop and 30 fps on a phone; results are recorded in the usage log.

### 14.10 Fallback
`cockpit3d.js` is loaded only after a WebGL context test passes; if the test or the import
fails, `game.js` opens the 2D view with a notice (R19.1). The departure climb is a status card
with its cost. At a gate in the cockpit view the 2D side view is a small inset (R17.5); key V
and a button open the full 2D view at any time.

### 14.11 Assets and licences
One 3D library, vendored as a single module file under `static/cloud-dive/vendor/three/` at an
exact version chosen in task 15.1 (version, MIT licence text and file hash recorded in
`THIRD_PARTY_NOTICES.md`). No other library, CDN or font file. Cockpit frame, panel, aircraft
model and airport markers are built from primitive geometry in code. Textures (hatch, frost,
sky gradient) are generated on a canvas at load. If a file asset is added later, it must be
self-made or CC0 and get a row in `THIRD_PARTY_NOTICES.md` first. No logos, no airline or
manufacturer marks.

### 14.12 Terrain and airport elevation
Flat ground at the departure airport elevation, easing linearly to the arrival airport
elevation along the route. No terrain. For KDEN-KLAX the Rocky Mountains are not drawn and
the block (10,000 to 20,000 ft) was set without terrain data; the open item of 5.4 stays open
(G10). The flat-ground "Why?" card and the README say so; the block is not changed now. The video uses KJFK-KBNA
(G11). Airport elevations: KJFK 13, KBNA 599, KDEN 5431, KLAX 125, KBUF 728, KPWM 76 ft, from `airports.json` (G12).

### 14.13 Hot-seat
`hotseat.js` holds `{players: [{name, result}], current}` and pure transitions (`start`,
`finish`, `next`, `table`). The setup dialog takes 2 to 4 names (default "Player 1" to
"Player 4"). After each flight the report opens, then a hand-over dialog names the next player.
The table lists total, ranked or "not ranked", and share of the possible saving, with Best and
Straight-ahead as the last two rows. It is held in memory only (CD-P31).

### 14.14 Wording
Display-scale Why text: vertical exaggeration, lateral compression of lane spacing, and the lead-in before "Top of climb". Cost pop-up text: "+$N this segment". Button labels: "Fly through", "Climb over", "Descend", "Go left", "Go right", "Anti-ice",
"Continue", "Pause", "2D view", "Skip". Panel lamp text says "lamp". Scene strings, panel
strings and Why-card text are scanned by `tests/test_wording.py` for the terms of R9.1.