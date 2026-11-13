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
| `.github/workflows/route-demo-pages.yml` | changed | Publish `static/cloud-dive/` at the root and the viewer at `/viewer/` |
| `src/analysis/icing_profile.py`, `src/api/*` | existing | Dispatcher view; unchanged API (R11.1) |

## 3. Data

### 3.1 Geometry
Lanes at -30, -15, 0, 15, 30 km. Step 10 km (about one minute at 330 kt). A case
has N steps (JFK-BNA about 123). Altitude levels every 1,000 ft inside the block
(for example 6,000 to 24,000 ft). Lane 0 is the great circle between the airports.

### 3.2 Satellite (per lane and step)
Native arrays are sampled by nearest pixel after parallax correction
(`apparent_latlon`, sub-satellite longitude of the chosen satellite, three
iterations). Resolutions: phase, optical depth, particle size 2 km; cloud-top
height 10 km. The cloud-top height is geopotential height (standard name
`geopotential_height_at_cloud_top`), taken as height above sea level.
Phase code 2 (`super_cooled_liquid_water`) is the supercooled flag; code 3 (mixed)
is kept as `mixed`, not supercooled. Cloud water: `LWP = 2/3 * COD * re` in
g m-2 with re in micrometres (ice: times 0.917). Base: `noh_cloud_base_km` with
that cloud water; null where the method gives none. Quality flags (DQF) not
good, or solar zenith 80 degrees or more, set the sample to `quality_rejected`.

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
             "antiIceFactor": 1.08, "speedLossAtFull": 0.12, "dragFlowAtFull": 0.20, "iceExponent": 1.5, "diversionUsd": 0,
             "iceRates": {}, "possibleRateFactor": 0.25},
  "lanesLatLon": [[[0,0]]],
  "evidence": "uint8 array [lane][step][alt]  (0 Not assessed, 1 Not indicated, 2 Possible, 3 Observed)",
  "headwindKt": "int16 array [lane][step][alt]", "temperatureC": "float array [lane][step][alt]",
  "satellite": [{"lane": 0, "step": 0, "topFt": 0, "baseFt": 0, "phase": "liquid", "supercooled": true, "retrieval": "observed"}],
  "references": {"best": {}, "bestNoAntiIce": {}, "bestAlwaysAntiIce": {}, "straightAhead": {}, "wasteful": {}},
  "balance": {"B1": true, "B2": true, "B3": true, "antiIceKmInBest": 0},
  "viewerProfile": {"title": "...", "samples": []}
}
```
Arrays are stored flat with a shape field. Expected size under 300 KB per case.

## 4. Evidence rule v2 (per cell: lane, step, altitude)

Inputs: satellite retrieval state, top, base, supercooled flag; ECMWF temperature
and humidity at the altitude; isotherm heights; altitude.

| # | Condition (first match wins) | Level | reason |
|---|---|---|---|
| 1 | satellite `observed`, supercooled true, base known, altitude in [max(base, zeroC), min(top, minus20C)] | Observed supercooled layer at planned altitude | `inside_candidate_layer` |
| 2 | satellite `observed`, supercooled true, base null, altitude in [zeroC, min(top, minus20C)] and altitude <= top | Not assessed | `cloud_base_unknown` |
| 3 | forecast criterion met (T in [-25, 0] C, RH >= 85 %) and rows 1-2 did not match | Possible (forecast only) | `forecast_criterion_met` |
| 4 | forecast available, criterion not met, and the satellite state is `observed` or `clear` | Not indicated | `forecast_criterion_not_met` or `satellite_clear` |
| 5 | forecast available, criterion not met, satellite state not usable | Not indicated | `no_supercooled_signal_forecast_dry` |
| 6 | forecast missing and satellite `clear` or supercooled false | Not indicated | `no_supercooled_signal` |
| 7 | otherwise | Not assessed | the missing-evidence reason |

Row 5 is deliberate: a dry forecast with no satellite signal is not evidence of
icing, but it is evidence of absence only as far as the forecast goes; the reason
code keeps the difference. The rule never returns `Possible` when the satellite
says Observed.

Isotherms: from the IFS temperature profile at the lane and step when 925 to 250 hPa
are present (`ifs_profile`); otherwise from cloud-top temperature and a lapse rate of
1.98 C per 1,000 ft (`cloud_top_lapse_rate_estimate`). The method is stored.

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
and ends the flight (not ranked).

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

If a case fails, the allowed levers are the altitude block and the corridor
width in the manifest, then the parameters in 5.1; the weather data are never
edited. Results are stored in the case file; the exporter refuses a failing case.

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
kmPerLevel, minutesAntiIce, status}`.

`step(state, case)` performs one 10 km step: move toward the targets by at most
one lane and 1,000 ft; read the cell (lane, step, alt); update ice, cost and
`kmPerLevel`; return the new state and the events.

`runUntilGate(state, case)` repeats `step` and stops when:
- a lookahead of three steps (simulated with the current targets, anti-ice and
  positions) enters an Observed or Possible cell from a cell that is neither;
- the flight is in a cell that is neither Observed nor Possible with anti-ice on,
  and the previous cell was Observed or Possible (exit gate);
- the flight ends (arrival or diversion);
- the player pressed pause (handled by the UI between steps).

Rendering at a gate: the cross-section along lane 0 and the other lanes, the ECMWF
wind barbs and forecast-environment shading, the unknown curtain; no costs ahead,
no recommended action (R6.5).

## 8. Reference solver

Exact dynamic programme over `(step, lane, altLevel, antiIce, ice)` with ice in
0..99 (100 is terminal) and actions `(dLane in {-1,0,1}, dAlt in {-1,0,1}, antiIce
in {0,1})` per step: 5 x 25 x 2 x 100 states, about 35 actions. The transition is
the same function as `step`. Outputs: Best (minimum cost over completed flights), Best with anti-ice forced off,
Best with anti-ice forced on, Wasteful extreme (maximum cost over completed flights),
and Straight-ahead (centre lane, start altitude, anti-ice on exactly while the cell is
Observed or Possible). The forced variants feed balance criteria B2 and B3. The solver can
pause anywhere; a player who pauses at every step can match it.

## 9. UI

Layout: a top-view mini map (route, lanes, aircraft), the cross-section (altitude
against distance for the selected lane) with the cloud body by phase, dashed
estimated base, hatched candidate band, wind barbs, forecast-environment shading,
the "Unknown" curtain; a HUD with the running dollar total, ice bar, anti-ice
switch, altitude, lane and distance; a gate panel (lane, altitude, anti-ice,
continue); the end-of-flight report (components, references, share of possible
saving, kilometres per level, personal best, share text without severity words).
Patterns plus text labels distinguish data kinds and levels (R10.1). Keyboard:
arrow keys for lane and altitude, A for anti-ice, Space to continue or pause.

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

Unit tests cover every rule row, the cost formulas with fixed numbers, and the
parallax correction on a synthetic cloud. A wording test scans `static/cloud-dive/**`
and case files for the R9.1 terms.

## 11. Error handling

- Missing or unreadable case file: show the case list with the entry disabled
  and the reason; never a blank canvas.
- Case with no Observed cell on the straight path: the game still plays and the
  report says so.
- Export fails on any non-finite value, secret, absolute path or missing source.

## 12. Risks and cuts (about 20 days left)

| Risk | Mitigation |
|---|---|
| Too much to build | Order: evidence, cube export, Python core, JS port, UI. Cut order: third case, Wasteful extreme, share text |
| Trivial game (always climb, never use anti-ice, or always use it) | Altitude block, ECMWF head-winds, climb cost and the two-sided anti-ice penalty; balance criteria B1 to B4 (section 5.2) are enforced by the exporter |
| GOES height is 10 km resolution | Label it; lanes are 15 km apart; no claim finer than a pixel |
| Anti-ice penalty has no source | Stored as a labelled game parameter |
| OpenAP licence | Build-time only, never shipped; notice in `THIRD_PARTY_NOTICES.md` |
| 21 UTC low sun in the east | Use 19-20 UTC and the solar-zenith check |

## 13. Out of scope

3D flight, real icing physics, live data, accounts, an online leaderboard, advice
on real operations, the Incheon-Haneda demo, Meteosat, Himawari, GK-2A.