# Implementation Plan - Cloud Dive

## Overview

Coding tasks for the Cloud Dive entry (US routes, fuel-cost score, decision-gate
flow, and from revision b the 3D cockpit view, groups 13 to 20), in build order. Each task names the requirements it implements (`R*` in
`requirements.md`) and, where relevant, the correctness properties it tests
(`CD-P*` in `design.md` section 10).

Non-coding work (rules, decisions, disclosure, real data collection runs, video,
write-up, bonuses, Devpost form) is in
[`submission-checklist.md`](submission-checklist.md). All coding is done in Kiro
(decision P8).

## Tasks

- [x] 1. Set up guardrails and automation
- [x] 1.1 Import and amend the science guardrails steering file
  - Copy `.kiro/steering/science-guardrails.md` from
    `origin/claude/kiro-research-direction-review-b971c3` (that file only)
  - Set `fileMatchPattern` for `src/analysis/**`, `tools/export_cloud_dive.py`,
    `static/cloud-dive/**`
  - Amend: the four evidence levels are used; a labelled numeric ice index and
    dollar costs are allowed as game values; the index is never a risk label;
    reference results appear only after play
  - _Requirements: R2.1, R9.1, R9.2, R9.4_
- [x] 1.2 Add a command hook that runs `pytest -q` when a `*.py` file is saved
  - Create it with the Kiro Hook UI, not by hand-editing JSON
  - _Requirements: R2.8_
- [x] 1.3 Add a command hook that runs `node --check` on a saved `*.js` file
  - _Requirements: R10.3_
- [x] 1.4 Add a PreToolUse hook that blocks writes to `.env` and `data/` (exit 2)
  - _Requirements: R1.4_
- [x] 1.5 Point the session-start and progress hooks at this plan
  - _Requirements: R12.2_

- [x] 2. Implement evidence rule v2 in `src/analysis/evidence.py`
- [x] 2.1 Add `hypothesis` to `requirements.txt` and create the module skeleton
  - Constants: rule name `cloud-dive-evidence-v2`, version 2, the four level
    strings, reason codes; `rule_metadata()` echoes every threshold
  - _Requirements: R2.1, R2.7_
- [x] 2.2 Implement isotherm heights and the candidate layer
  - `isotherm_heights_from_profile(levels)` from IFS temperature against height
  - `isotherm_heights_from_cloud_top(top_ft, ctt_c)` with lapse 1.98 C per 1,000 ft
  - `candidate_layer(base, top, zero_c, minus20_c)`; record the method
  - _Requirements: R2.6_
- [x] 2.3 Implement `evaluate_cell(satellite, forecast, alt_ft, isotherms)`
  - Rows 1-9 of design section 4, first match wins; returns level and reason
  - No randomness, clock, network or model call
  - _Requirements: R2.2, R2.3, R2.4, R2.5, R2.8_
- [x] 2.4 Implement `route_summary(cells, step_km)`
  - Kilometres per level, all four keys present
  - _Requirements: R8.1_
- [x] 2.5 Write unit tests in `tests/test_evidence.py`
  - One test per rule row with fixed synthetic numbers (name contains `synthetic`)
  - _Requirements: R2.2, R2.3, R2.4, R2.5, R2.6_
- [x] 2.6 Write property tests CD-P1 to CD-P5 in `tests/test_evidence_properties.py`
  - Strategies cover all retrieval states, nulls, temperatures -80 to +30 C,
    altitudes 0-45,000 ft; log any counterexample in `docs/kiro-usage-log.md`
  - _Requirements: R2.3, R2.5, R2.6, R8.1_
- [x] 2.7 Checkpoint: run the full test suite and fix failures

- [x] 3. Build the GOES CONUS lane sampler
- [x] 3.1 Write `src/integration/goes_conus.py`
  - Anonymous S3 read of ACTPC, ACHAC, CODC, CPSC for one satellite and hour;
    keep native arrays and projection; cache under git-ignored `data/`
  - _Requirements: R3.1_
- [x] 3.2 Write `src/analysis/lanes.py` and its tests
  - Great circle, five lanes at -30, -15, 0, 15, 30 km, 10 km steps (pyproj
    Geod); property test CD-P13 (starts at 0, strictly increasing, lanes parallel)
  - _Requirements: R3.1_
- [x] 3.3 Implement parallax-corrected pixel lookup
  - Use `apparent_latlon` with the chosen satellite's sub-satellite longitude,
    three iterations; test on a synthetic cloud at a known height
  - _Requirements: R3.2_
- [x] 3.4 Implement cloud water and base per sample
  - `LWP = 2/3 * COD * re` (ice factor 0.917), Noh base via `cloud_base`, null
    where the method gives none; DQF and solar-zenith gate set `quality_rejected`
  - _Requirements: R3.3_
- [x] 3.5 Write sampler tests
  - Synthetic arrays plus one small real fixture (under 200 KB) from a GOES hour
  - _Requirements: R3.2, R3.3_

- [x] 4. Build the ECMWF background
- [x] 4.1 Extend `tools/collect_ifs.py` levels to 925, 850, 700, 600, 500, 400, 300, 250 hPa
  - Keep the message-count check; support `--source aws`; add a test with a
    synthetic index that rejects a missing level
  - _Requirements: R3.1_
- [x] 4.2 Write `src/analysis/ifs_cube.py`
  - ISA altitude to pressure; sample T, RH, u, v at (lane, step, altitude) with
    `ifs_grid.sample`; head-wind component in knots, positive against the flight
  - _Requirements: R4.1, R2.4_
- [x] 4.3 Implement the forecast icing screen
  - Criterion T in [-25, 0] C and RH >= 85 percent, rule id `ifs-temperature-rh-v1`
  - _Requirements: R2.4_
- [x] 4.4 Write tests
  - Head-wind sign on a known wind; missing data returns None; time interpolation
  - _Requirements: R2.5, R4.1_

- [x] 5. Build the cost model, game core and solver (Python reference)
- [x] 5.1 Write `src/analysis/cost_model.py`
  - OpenAP tables for E75L at 30,340 kg: flow by altitude, climb extra per
    1,000 ft (check the vertical-speed unit), TAS schedule; lazy import; parameter
    dataclass with price, anti-ice factor, speed loss, drag flow, ice exponent, ice rates
  - _Requirements: R4.1, R4.2, R4.3, R4.7_
- [x] 5.2 Write `src/analysis/game_core.py`
  - Pure `step`, ice integer index with convex speed loss and fuel-flow drag, anti-ice
    fuel factor, cost components, lane and altitude limits, gate lookahead,
    `run_until_gate`
  - _Requirements: R4.4, R4.5, R4.6, R5.1, R5.2, R5.3, R5.4, R5.5, R6.1, R6.2, R7.1, R7.2, R7.3_
- [x] 5.3 Write property tests CD-P6 to CD-P11 and CD-P14
  - Random action sequences over a synthetic cube
  - _Requirements: R4.6, R5.3, R5.4, R5.5, R6.4, R7.2, R7.3, R8.1_
- [x] 5.4 Write `src/analysis/solver.py`
  - Exact dynamic programme over the same transition; Best, Best with anti-ice forced
    off, Best with anti-ice forced on, Wasteful extreme, Straight-ahead
  - _Requirements: R4.8, R8.2, R8.3_
- [x] 5.5 Write property tests CD-P12, CD-P16 and CD-P17 and `tools/tune_params.py`
  - The tuning report prints Best, the two forced-anti-ice variants and Straight-ahead per
    case and checks balance criteria B1 to B5; levers are the altitude block, corridor
    width and the parameters, never the weather data
  - _Requirements: R4.8, R8.2, R8.3_
- [x] 5.6 Checkpoint: run the full test suite and fix failures

- [x] 6. Build the case exporter
- [x] 6.1 Write `tools/check_viewer_contract.py` and tests
  - Python port of every rule in `validProfile()`; property test CD-P15
  - _Requirements: R3.4_
- [x] 6.2 Write `tools/export_cloud_dive.py`
  - Manifest-driven: satellite lanes, IFS cube, evidence, params, references, balance
    results, embedded centre-lane viewer profile, provenance, attribution; fails on
    non-finite values, secrets, absolute paths, or a case that fails B1 to B3
  - _Requirements: R1.3, R1.4, R2.7, R3.1, R3.4, R4.2, R4.8_
- [x] 6.3 Add manifests for the three cases and a `--simulated` mode
  - 2026-11-12 JFK-BNA 19:30 UTC (GOES-19), 2026-11-01 DEN-LAX 21 UTC (GOES-18),
    2026-11-07 BUF-PWM 19 UTC (GOES-19); simulated case labelled "Simulated"
  - _Requirements: R3.5, R3.6_
- [x] 6.4 Write exporter tests in `tests/test_export_cloud_dive.py`
  - Fixtures in `tmp_path`; attribution present; no paths or keys in the output
  - _Requirements: R1.4, R3.4_
- [x] 6.5 Run the real export and commit the cases
  - Collect the GOES hours and the IFS run, export, run `tune_params.py` (B4 is checked
    across the three cases), commit `static/cloud-dive/cases/`
  - _Requirements: R3.5, R4.8_

- [x] 7. Build the JavaScript engine
- [x] 7.1 Write `static/cloud-dive/engine.js`
  - DOM-free ES module port of `game_core`
  - _Requirements: R6.1, R6.2, R7.1, R7.2, R7.3_
- [x] 7.2 Write the Python-JavaScript parity test (CD-P7)
  - pytest runs a Node script over random action sequences on a fixture case
  - _Requirements: R6.1, R5.4_
- [x] 7.3 Write Node tests with `node --test`
  - Gate placement and no silent entry (CD-P14) on a real exported case
  - _Requirements: R6.2, R6.4_

- [x] 8. Build the game UI
- [x] 8.1 Create `static/cloud-dive/index.html`, `game.css`, `game.js`
  - Case picker from `cases/index.json`, HUD (dollar total, ice bar, anti-ice,
    altitude, lane, distance), persistent game note, error states
  - _Requirements: R9.3, R10.3_
- [x] 8.2 Implement the cross-section renderer
  - Cloud body by phase, dashed estimated base, hatched candidate band, wind
    barbs, forecast-environment shading, "Unknown" curtain, mini top-view map;
    greyscale-safe patterns and text labels
  - _Requirements: R6.5, R10.1_
- [x] 8.3 Implement the gate panel, controls and fast-forward
  - Lane, altitude, anti-ice, continue, pause anywhere; keyboard, pointer, touch;
    no cost preview and no recommendation
  - _Requirements: R6.1, R6.3, R6.5, R7.1, R7.4, R10.2_
- [x] 8.4 Implement the end-of-flight report
  - Components, references, share of the possible saving, kilometres per level,
    browser-only personal best, share text without severity words
  - _Requirements: R8.1, R8.2, R8.3, R8.4, R8.5_
- [x] 8.5 Add four "Why?" cards
  - Supercooled water, why a satellite sees only cloud tops, why the base is an
    estimate, why anti-ice costs fuel; no operational advice
  - _Requirements: R9.4_
- [x] 8.6 Write `tests/test_wording.py` and a hook that runs it on save under `static/cloud-dive/`
  - Scan UI files and case files for the terms in R9.1
  - _Requirements: R9.1, R9.2_
- [x] 8.7 Checkpoint: pytest, `node --check` and `node --test` all pass

- [x] 9. Publish the site and keep the dispatcher view working
- [x] 9.1 Change `.github/workflows/route-demo-pages.yml` to publish the game
  - Root from `static/cloud-dive/`, viewer at `/viewer/`; remove the route demo
    from the published site; check that paths resolve in a signed-out browser
  - _Requirements: R10.3, R10.4_
- [x] 9.2 Apply decision D1 (replace) to the dispatcher view
  - Evidence levels and kilometres per level instead of the risk badge and
    altitude suggestions
  - _Requirements: R11.2, R9.1_
- [x] 9.3 Write API compatibility tests
  - Every existing `/api/icing/*` field keeps its type; `validProfile()` rules pass
  - _Requirements: R11.1_
- [x] 9.4 Final checkpoint: full test suite, wording test and Node checks pass

- [x] 10. Playtest fixes (2026-11-13)
- [x] 10.1 Read both array shapes in the renderer
  - One `column(group, field, idx)` helper for `{shape,data}` and group objects with a
    shared `shape`; export a DOM-free `curtainColumns(file, c, lane)`; Node test CD-P20 on
    the three real cases and a synthetic case in each shape
  - _Requirements: R2.5, R10.1_
- [x] 10.2 Measure the saving share from Straight-ahead to Best
  - `savingSharePercent(player, best, straightAhead)`, not clamped at 0, at most 100, null
    when Straight-ahead <= Best or the flight is not ranked; update the report text; Node
    tests: always-on run above Straight-ahead gives a negative share
  - _Requirements: R8.2_
- [x] 10.3 Set a non-zero diversion cost through `tools/tune_params.py`
  - Add `--write` (updates `params` and `balance` in the case files, never weather data);
    add B5 to `balance()` and to the exporter refusal; set `diversionUsd` 5000; rerun the
    tuner, keep B1 to B5 passing; log the change in `docs/kiro-usage-log.md`
  - _Requirements: R4.7, R4.8, R5.5_
- [x] 10.4 Merge gates in `game_core.py` and `engine.js`
  - `gateReasons`, `lastIcingStep`, 5-step merge gap, 5-step exit lookahead; one gate per
    boundary with all reasons; update the gate panel; property test CD-P18; CD-P14 and
    CD-P7 parity still pass; record gate counts per case before and after in the usage log
    (KJFK-KBNA always-on: fewer than the current 16)
  - _Requirements: R6.2, R6.4, R6.6, R6.7_
- [x] 10.5 Add the ice gate at index 50
  - `iceGateDone` in both engines and the parity test; gate panel text; property test CD-P19
  - _Requirements: R6.2, R9.1_
- [x] 10.6 Checkpoint: pytest, wording test, `node --check` and `node --test` pass

- [x] 11. Map view with the satellite image
- [x] 11.1 Add ABI-L2-CMIPC band 13 to `goes_conus.py` and write `tools/export_map_images.py`
  - Local equirectangular grid, 2 km nearest-neighbour, IR and phase PNGs, `map` field only,
    `maxParallaxKm` from the lane samples; refuse to write if any other field would change;
    tests on a synthetic ABI grid (registration, transparency, size budget, attribution)
  - _Requirements: R13.3, R13.4, R13.8, R1.3_
- [x] 11.2 Write `tools/build_basemap.py`
  - Natural Earth 1:50m state lines and coastline, clipped and simplified, `cases/basemap.json`
  - _Requirements: R13.1, R13.8_
- [x] 11.3 Write `static/cloud-dive/map.js`
  - Projection helpers; overview and follow view; image without smoothing; lanes, evidence
    patches, track, aircraft, side-view lane mark; fallbacks; Node tests CD-P21 and CD-P22
  - _Requirements: R13.1, R13.2, R13.5, R13.6, R13.7, R10.1_
- [x] 11.4 Change the layout and wire the map view
  - Map above the side view; "now" line on the side view; smooth motion during fast-forward;
    IR/phase toggle (key M); text alternative; legend texts of R13.3 and R13.4
  - _Requirements: R13.1, R13.3, R13.4, R13.6, R13.9, R13.10, R10.2_
- [x] 11.5 Run the image export for the three cases and commit the images and basemap
  - _Requirements: R13.3, R3.5_
- [x] 11.6 Checkpoint: pytest, wording test, `node --check` and `node --test` pass
- [x] 12. One-screen layout
- [x] 12.1 Size canvases to their boxes
  - `fitCanvas` with ResizeObserver and devicePixelRatio; `renderScene` option
    `legend: false`; overview drawn as an inset by `drawFollowView`; Node tests on the
    DOM-free size helper; existing render and map tests still pass
  - _Requirements: R13.2, R14.5_
- [x] 12.2 Build the grid layout, top bar, bottom bar, map key strip and compact controls
  - _Requirements: R14.1, R14.2, R9.3, R10.1, R10.2_
- [x] 12.3 Move the report, Why cards, sources and full legend into dialogs
  - Report opens at the end of the flight; Escape, close button, focus return; key L
  - _Requirements: R14.2, R14.3, R14.4, R8.1_
- [x] 12.4 Check the layout in a headless browser
  - Edge or Chrome headless (whichever is installed) at 1280x720, 1366x768 and
    1920x1080, at the start of a flight and at the first gate; `?layoutcheck=1` must give
    `data-fits="yes"`; save screenshots under `docs/screens/`; also one 800x1000 run for
    the stacked layout
  - _Requirements: R14.1, R14.6_
- [x] 12.5 Checkpoint: pytest, wording test, `node --check`, `node --test` and the layout check pass

## Revision b: 3D cockpit game

Groups: (a) 13, (b) 14, (c) 15, (d) 16, (e) 17 (departure and climb), (f) 18 (hot-seat),
(g) 19 (chase view), 20 (documentation).
Build order, so that no cuttable or optional task runs before a required one: 13, 14, 15,
16.1, 16.3, 16.5, 16.6, 17 without 17.5, 18, then 16.2, 16.4, 17.5, 16.7, then 19, then 20.
The plan can stop after any checkpoint and still ship.
Required: groups 13 to 16 except 16.2, 16.4 and 16.7, and 17.1 to 17.4, 17.6 to 17.8 and 18.
Cuttable before 2026-12-04: 17.5 (arrival and diversion cinematics), 16.2 (shake), 16.4
(wind streaks) and 19 (chase view). Optional: 16.7 (cost pop-up). Cut order, first to go
first: 19, 16.4, 16.2, 17.5, 16.7 (decision G2). Feature freeze 2026-11-28 (G9). The 3D view
reads the case and the engine state and never changes them; `engine.js`, `game_core.py`, the
cost model, the solver, B1 to B5 and CD-P1 to CD-P22 stay as they are.

- [x] 13. (a) Playtest fixes on the 2D game
- [x] 13.1 Re-verify R21 on the current build (re-verify only)
  - The five fixes exist as tasks 10.1 to 10.5 (decision G3); the owner confirmed the playtest
    was on a build from before group 10. Run `pytest -q` and `node --test`; check CD-P20 in
    both array shapes, the saving share sign, `diversionUsd` 5000 with B1 to B5 passing, gate
    counts per case (KJFK-KBNA always-on was 16 before 10.4 and is 10 now; the playtest saw
    17), and one ice gate per flight. Add a test only where a gap is found, and record the gap
    list in the usage log. No new behaviour.
  - _Requirements: R21.1, R21.2, R21.3, R21.4, R21.5_
- [x] 13.2 Checkpoint: pytest, wording test, `node --check`, `node --test` pass

- [x] 14. (b) Scene description and tests
- [x] 14.1 Create `static/cloud-dive/scene.js` with the frame, constants and schema
  - DOM-free ES module; named constants `VEX`, `LATK`, `LEAD_IN_KM`, `CLOUD_FADE_S`,
    `MAX_CLOUD_VOLUMES`, `MAX_EVIDENCE_BANDS`, `MAX_TRIANGLES`, `VIEW_KM`, `SHAKE_MAX_DEG`;
    `buildScene(file, state, pose, opts)` returns camera, lanes, airports (with the "Top of
    climb" marker), ground, sky and `cloudAlpha`; one string table; no clock, no random; only
    the scene is scaled, engine distances stay true
  - _Requirements: R19.5, R16.4, R16.10, R16.12, R15.14_
- [x] 14.2 Build cloud volumes with merging and caps
  - From the satellite group through the shared array helper (both shapes); fixed merge
    tolerance; no volume starts before x = 0; Observed evidence never dropped
  - _Requirements: R16.6, R19.3, R15.15_
- [x] 14.3 Build evidence bands
  - Four-level mapping through `engine.levelAt`; runs merged along track; priority Observed,
    Possible, Not assessed when the cap binds
  - _Requirements: R16.7, R16.8_
- [x] 14.4 Build effects and panel data
  - Frost, shake amplitude, wing lamp, at most 12 wind streaks, head-wind, text line, level
    here and ahead, legend strip names
  - _Requirements: R16.2, R16.9, R18.1, R18.2, R18.3_
- [x] 14.5 Write Node tests CD-P23 to CD-P26 and extend the wording test
  - Real cases (three) and synthetic cases in both array shapes; deep-frozen inputs; scene z
    equals true z x `LATK`; `tests/test_wording.py` scans scene and panel strings and skips
    `static/cloud-dive/vendor/`
  - _Requirements: R19.5, R16.6, R16.7, R16.12, R9.1_
- [x] 14.6 Checkpoint: pytest, wording test, `node --check`, `node --test` pass

- [x] 15. (c) Cockpit cruise view with gates
- [x] 15.1 Vendor the 3D library
  - Choose and verify an exact release of three.js (version exists, MIT licence), copy one
    module file to `static/cloud-dive/vendor/three/`, record version, licence and SHA-256 in
    `THIRD_PARTY_NOTICES.md` (create it if missing, see C4); no CDN; check the Pages workflow
    publishes the folder
  - _Requirements: R19.4, R1.2_
- [x] 15.2 Write `cockpit3d.js`
  - Draws a scene description only: sky, flat ground, lane guides, airport markers, cloud
    volumes, evidence bands, windshield frame and low-poly panel built from primitives;
    WebGL context test; tune `VEX`, `LATK`, field of view and eye height together; `LATK` may go down
    to 0.2 if the side lanes are not readable from the cockpit
  - _Requirements: R16.1, R16.4, R16.6, R16.7, R16.12, R19.5_
- [x] 15.3 Write the panel overlay `panel.js` and `cockpit.css`
  - Fuel counter, ice gauge ("Ice index (game model)"), anti-ice switch with lamp, altitude
    tape, panel map, legend strip, text line (with the head-wind number), game note, source
    line; real text, focusable controls, greyscale labels
  - _Requirements: R16.2, R16.3, R16.5, R16.8, R16.10, R9.3, R1.3, R10.1_
- [x] 15.4 Map gate choices to the controller and add the gate inset
  - "Fly through", "Climb over", "Descend", "Go left", "Go right", anti-ice, Continue,
    Pause; arrows, A, Space; 44 px touch buttons; 2D side-view inset at gates; no cost preview
    and no recommendation; property test CD-P27
  - _Requirements: R17.1, R17.2, R17.3, R17.4, R17.5, R17.6, R6.5_
- [x] 15.5 Cruise camera, fast-forward, gate stop, 2D toggle, fallback and Why cards
  - Camera follows `motionFrac`, eases to a stop at a gate within 1.5 s; key V and button
    open the 2D view; fallback when WebGL or the import fails; "Why?" cards for cruise level
    (below airline cruise), the flat-ground limit, and the display scales (vertical
    exaggeration and lateral compression of lane spacing)
  - _Requirements: R15.4, R15.8, R16.4, R16.12, R19.1, R19.2_
- [x] 15.6 Check layout and frame rate in a headless browser
  - Extend `tools/layout_check.mjs` for the cockpit view at 1280x720, 1366x768, 1920x1080 and
    one phone size (390x844); `data-fits`; screenshots under `docs/screens/`; frame rate with
    `?perf=1` on this laptop, recorded as measured; tune the caps of design 14.9
  - _Requirements: R14.1, R14.6, R19.3_
- [x] 15.7 Checkpoint (shippable: a playable 3D cruise game): pytest, wording test,
  `node --check`, `node --test`, layout check pass

- [x] 16. (d) Feedback effects (16.1 and 16.3 required; 16.2 and 16.4 cuttable; 16.7 optional)
- [x] 16.1 Frost on the windshield edges
  - Opacity = ice / 100 from the scene description; generated texture
  - _Requirements: R18.1_
- [x] 16.2 Airframe shake with reduced-motion handling (cuttable; built after group 18)
  - Amplitude from the scene; none under `prefers-reduced-motion`; add the shake clause of
    CD-P28 (zero unless anti-ice is off, the cell is Observed or Possible, ice > 0 and reduced
    motion is off); run all suites
  - _Requirements: R18.2, R15.12_
- [x] 16.3 Wing-heat lamp and fuel-counter rate
  - Lamp from the switch; counter interpolates the engine's per-step cost
  - _Requirements: R18.3_
- [x] 16.4 Wind streaks (cuttable; built after group 18)
  - At most 12 streaks; the head-wind number already stays in the text line (15.3); add a test
    for the streak cap; run all suites
  - _Requirements: R16.9_
- [x] 16.5 Write property test CD-P28 for frost and the wing-heat lamp, and a check that the effects change no engine value
  - Covers 16.1 and 16.3 only; the shake clause is added in 16.2 and the streak cap test in
    16.4, so 16.5 and 16.6 do not depend on them
  - _Requirements: R18.1, R18.2, R18.3, R18.4_
- [x] 16.6 Checkpoint (shippable): all test suites and the layout check pass
- [x] 16.7 Cost pop-up "+$N this segment" (optional; built after 16.2, 16.4 and 17.5)
  - Shown at a gate, a pause, after a single step and at the end, from the component
    differences between two stops; never before a choice; property test CD-P32
  - _Requirements: R18.5, R6.5_

- [x] 17. (e) Departure and climb (17.1 to 17.4, 17.6 to 17.8 required; 17.5 cuttable)
- [x] 17.1 Add the departure climb constant and airport elevations
  - `tools/tune_params.py --write` (or a small exporter step) adds `params.departureClimbUsd`,
    `params.departureClimbNote` and `airports` only, and refuses to change anything else;
    elevations are `elev_ft` from `airports.json`; check the source of `airports.json` (the
    OurAirports CSV used by `tools/build_airports.py`) and its licence, then record it in
    `THIRD_PARTY_NOTICES.md`; `withDeparture` in Python and JavaScript; references and the
    report show "Departure climb"; B1 to B5 stay on engine totals; local best key `v2`;
    property test CD-P29
  - _Requirements: R15.5, R4.6, R8.1, R8.2, R19.6_
- [x] 17.2 Write `phases.js`
  - Pure `phaseStep`, `phasePose`; transitions of design 14.6; durations 5 s, 10 to 15 s, 10 s,
    4 s; camera x in [-`LEAD_IN_KM`, 0] before cruise; property test CD-P30
  - _Requirements: R15.1, R15.2, R15.3, R15.6, R15.7, R15.13, R15.14_
- [x] 17.3 Runway scene and takeoff
  - Runway at x = -`LEAD_IN_KM`, departure airport marker, "Top of climb" marker at x = 0, one
    button or key to start, about 5 s roll and lift-off
  - _Requirements: R15.1, R15.2, R15.14_
- [x] 17.4 Automatic climb with the labels, cloud fade and lead-in tuning
  - About 10 to 15 s from the runway to x = 0 on the centre lane; tune `LEAD_IN_KM` and the
    display speed; no evidence drawn and `cloudAlpha` 0 in takeoff and climb, fade-in over the
    last 1.5 s; panel reads "Not assessed (below the game's altitude block)" or "Not assessed
    (departure climb)"; hand-over to step 0 at the "Top of climb"; the display-scale Why text
    adds the lead-in
  - _Requirements: R15.3, R15.4, R15.6, R15.7, R15.14, R15.15_
- [x] 17.5 Arrival and diversion cinematics, then the report (cuttable; built after group 18)
  - Uses the skip and reduced-motion handling of 17.6; about 10 s descent and landing; about 4 s turn-away; report opens after; unscored. If cut,
    the report opens directly at arrival or diversion
  - _Requirements: R15.9, R15.10_
- [x] 17.6 Skip and reduced motion
  - Skip button and Space; each cinematic at most 2 s under reduced motion
  - _Requirements: R15.11, R15.12_
- [x] 17.7 Show the departure climb as a status card in the 2D fallback
  - _Requirements: R19.1, R15.5_
- [x] 17.8 Checkpoint (shippable): all test suites and the layout check pass

- [x] 18. (f) Hot-seat (required)
- [x] 18.1 Write `static/cloud-dive/hotseat.js` and property test CD-P31
  - _Requirements: R20.1, R20.2, R20.3_
- [x] 18.2 Setup dialog and hand-over dialog between flights
  - _Requirements: R20.1, R20.4_
- [x] 18.3 Results table dialog with Best and Straight-ahead
  - _Requirements: R20.2, R20.3, R8.5_
- [x] 18.4 Checkpoint: all test suites and the layout check pass

- [x] 19. (g) Chase view (cuttable before 2026-12-04; first to be cut)
- [x] 19.1 Add the chase camera (key C) and a generic aircraft model built from primitives
  - No livery, logo or registration; instruments and gate controls stay usable
  - _Requirements: R16.11, R16.1_
- [x] 19.2 Test and check: scene mode field, wording scan, frame rate in chase view
  - _Requirements: R16.11, R19.3_
- [x] 19.3 Checkpoint: all test suites pass

- [x] 20. Documentation for revision b
- [x] 20.1 Update README, the disclosure, `THIRD_PARTY_NOTICES.md` and the submission checklist
  - New files attributed to Kiro; three.js row and the `airports.json` source row; flat-ground
    limit; the video (C15) uses KJFK-KBNA with the cockpit; KDEN-KLAX keeps the flat-ground card
    and its block is not changed; the MCP browser check (C11) covers the cockpit on a narrow
    viewport
  - _Requirements: R1.1, R1.2, R12.2, R16.4_
- [x] 20.2 Final checkpoint: full test suites, wording test, layout check, Pages path check

- [x] 21. (h) Visual polish (revision c)
- [x] 21.1 Record the "before" screenshots (before any code change)
  - Headless Chrome at 1280x720, KJFK-KBNA 2026-11-12, cockpit view: start (ready), first gate
    and report; save as `docs/screens/21.0-start.png`, `21.0-gate.png`, `21.0-report.png`
  - Take them from the current build, before any other task in this group changes code; add a
    row to `docs/kiro-usage-log.md`
  - _Requirements: R22.1, R22.4, R22.8_
- [x] 21.2 Slim overlay panel, large windshield and bottom-bar texts (design 15.1)
  - `cockpit.css` and `panel.js`: canvas fills the cockpit view; `#cockpit-panel` becomes a one-row
    overlay (fuel, "Ice index (game model)" meter with number, anti-ice switch with lamp, altitude
    readout); compact level strip at the top with exact names, pattern word in `title` and `aria-label`;
    panel map as a corner inset; `FRAME.panelTop` in `cockpit-geometry.js` raised towards -0.72
  - Remove `.cp-game-note`, `.cp-source` and their nodes; `buildEffects` stops appending the source
    text to `textLine`; the game note and the source line appear once, in the bottom bar
  - `?layoutcheck=1` in `game.js` also sets `data-windshield` (frame opening height over `innerHeight`);
    extend `tools/layout_check.mjs` to require `data-fits="yes"` and `data-windshield` of at least 0.6 at
    1280x720; a DOM check that the note and source texts occur once; add a row to `docs/kiro-usage-log.md`
  - _Requirements: R22.1, R22.2, R22.3_
- [x] 21.3 Sky gates (design 15.2)
  - `scene.js`: `buildGates` and `gates[]` (empty outside the gate phase, five entries in the gate phase;
    level is the worst of the next three cells at the target altitude, Not assessed when no cell remains;
    label is the exact level name; no cost field, no recommendation)
  - `cockpit-geometry.js` `gateBoxes` and `cockpit3d.js` `gates` slot: outline for every level, fills by
    pattern (orange diagonal lines, blue dots, grey stripes, none), one text label per gate; gates counted in
    `MAX_TRIANGLES` and dropped last
  - Open check from design 15.2: confirm in `phases.js` and the controller whether a pause enters the
    `gate` phase, and record the answer in the usage log; if it does not, document that no frames are shown at a pause
  - Node tests (`fast-check`, 100 iterations or more): CD-P33; extend CD-P23 (purity with `gates`),
    CD-P25 (gate level agrees with `levelAt`) and CD-P26 (gates <= 5); example tests for the four levels and
    the no-cell case; add a row to `docs/kiro-usage-log.md`
  - _Requirements: R22.4, R22.11, R6.5, R2.5_
- [x] 21.4 Evidence emphasis near the aircraft altitude (design 15.3)
  - `buildEvidence` adds `weight` (1 within 2,000 ft of the band interval, else 0.25); `evidenceBoxes`
    multiplies alpha by it; `geometryKey` mixes the weight; levels, counts, extents and labels unchanged
  - Node test CD-P34; extend CD-P25 (the weight never changes level, count or extent); add a row to
    `docs/kiro-usage-log.md`
  - _Requirements: R22.5, R22.11_
- [x] 21.5 Stronger frost curve and thin dashed lane guides (design 15.4)
  - `frostOpacity(scene)` returns min(1, 2 x frost) (0.5 at ice 25, 1.0 from ice 50); `effects.frost`
    stays ice / 100
  - `guideBoxes` draws one thin strip per lane (`GUIDE_HALF_WIDTH_KM` about 0.03) with a generated dash
    texture (`dashData`); keep the current and target lane emphasis
  - Update CD-P28 (curve values, non-decreasing in ice, never decreases over a flight) and add example tests
    for `frostOpacity` at ice 0, 25, 50, 100 and for `guideBoxes`; add a row to `docs/kiro-usage-log.md`
  - _Requirements: R22.6, R22.7, R18.1_
- [x] 21.6 Report headline with the dollar gaps (design 15.5)
  - `report.js` `reportHeadline(report)` (pure): "$N more than Straight-ahead", "$N less than
    Straight-ahead", "The same as Straight-ahead", "$N above Best"; null entry for a missing reference
  - `report-view.js` leads with `.report-lead` (Straight-ahead line, then Best line), then the saving share
    percentage unchanged; diverted flights keep the not-ranked text and show no headline
  - Node test CD-P35 and examples for a cheaper, a dearer and an equal flight and a missing reference; add a
    row to `docs/kiro-usage-log.md`
  - _Requirements: R22.8, R8.2_
- [x] 21.7 Post-climb status text and "base estimated" label (design 15.6)
  - `controls.js` builds `goLabel` once and the status message from it; `takeoff.js` `leadStatusText` gets a
    cruise reading "At the top of climb. Press Continue to fly the route." built from the same label constant
  - `pickLabels` moves the `base` label to the far end and lane edge of its volume at the base height, width 4.5,
    never at the centre of the view; example tests for the label position and the status text; add a row to
    `docs/kiro-usage-log.md`
  - _Requirements: R22.9, R22.10_
- [x] 21.8 Wording test, unchanged-engine check and scene purity
  - Extend `tests/test_wording.py` to scan the new strings (headline, status, gate labels, legend strip, label text)
    for the terms of R9.1
  - Check that `git diff` of `static/cloud-dive/engine.js`, `src/analysis/game_core.py`,
    `src/analysis/cost_model.py` and `static/cloud-dive/cases/` is empty relative to the commit before group 21
    (a test or script that fails on any difference)
  - Re-run CD-P23 on the three real cases and synthetic cases in both array shapes with deep-frozen inputs; add a
    row to `docs/kiro-usage-log.md`
  - _Requirements: R22.11, R9.1, R22.4_
- [x] 21.9 Checkpoint: "after" screenshots and full test run
  - Record `docs/screens/21.9-start.png`, `21.9-gate.png`, `21.9-frost-25.png`, `21.9-frost-50.png` and
    `21.9-report.png` at 1280x720 for KJFK-KBNA, same method as 21.1
  - Run `pytest -q` with `C:\Users\I7-JIN\miniconda3\envs\WeatherPath\python.exe`, the wording test,
    `node --check` on every changed `*.js` file, `node --test tests/js/*.test.mjs` and `tools/layout_check.mjs`
    (`data-fits="yes"`, `data-windshield` at least 0.6); fix failures; add a row to `docs/kiro-usage-log.md`
  - _Requirements: R22.1, R22.3, R22.4, R22.6, R22.8, R22.11_

## Notes

- F1 to F6 are approved (`requirements.md` 5.6; F3 amended with the two-sided anti-ice penalty and the balance criteria).
- Task 6.5 and the real data runs need network access; the rest runs offline.
- Parameter values (price, anti-ice factor, drag, ice rates) are illustrative; tune
  them only through `tools/tune_params.py` and record changes in the usage log.
- Add one row to `docs/kiro-usage-log.md` per completed task.
- Decision D1 is settled (replace), so task 9.2 is not conditional.
- Revision b (decisions G1 to G14): groups 13 to 20. Cuttable: 17.5, 16.2, 16.4, 19; optional: 16.7.
  Required: the rest, including 17.1 to 17.4 (departure constant, phases, runway, climb) and 18.
  If 17.5 is cut, the report opens directly at arrival or diversion.
- Revision c (decision G15): group 21, presentation only. Engine, cost model, case files and evidence
  values stay unchanged (R22.11). Task 21.1 must run before any other task of the group changes code.
- Frame rates are measured in task 15.6 and 18.2 and recorded as measured, not as targets met.
- Open items from the 2026-11-14 review are listed in [docs/pending-items.md](../../../docs/pending-items.md). They are not tasks yet and wait for the owner's instruction.

## Task Dependency Graph

Tasks in the same wave can run in parallel. Each wave depends on the waves before it.

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1.1", "1.2", "1.3", "1.4", "1.5"] },
    { "wave": 2, "tasks": ["2.1", "3.1", "4.1", "5.1"] },
    { "wave": 3, "tasks": ["2.2", "3.2", "4.2", "6.1"] },
    { "wave": 4, "tasks": ["2.3", "3.3", "4.3"] },
    { "wave": 5, "tasks": ["2.4", "2.5", "3.4", "4.4", "5.2"] },
    { "wave": 6, "tasks": ["2.6", "3.5", "5.3", "5.4"] },
    { "wave": 7, "tasks": ["2.7", "5.5", "5.6", "6.2"] },
    { "wave": 8, "tasks": ["6.3", "6.4", "7.1"] },
    { "wave": 9, "tasks": ["6.5", "7.2", "7.3", "8.1"] },
    { "wave": 10, "tasks": ["8.2", "8.3"] },
    { "wave": 11, "tasks": ["8.4", "8.5", "8.6"] },
    { "wave": 12, "tasks": ["8.7", "9.1"] },
    { "wave": 13, "tasks": ["9.2", "9.3", "9.4"] },
    { "wave": 14, "tasks": ["10.1", "10.2", "10.3"] },
    { "wave": 15, "tasks": ["10.4", "10.5", "10.6"] },
    { "wave": 16, "tasks": ["11.1", "11.2", "11.3"] },
    { "wave": 17, "tasks": ["11.4", "11.5", "11.6"] },
    { "wave": 18, "tasks": ["12.1", "12.2", "12.3"] },
    { "wave": 19, "tasks": ["12.4", "12.5"] },
    { "wave": 20, "tasks": ["13.1", "14.1", "15.1"] },
    { "wave": 21, "tasks": ["13.2", "14.2", "14.3", "14.4"] },
    { "wave": 22, "tasks": ["14.5", "14.6"] },
    { "wave": 23, "tasks": ["15.2", "15.3"] },
    { "wave": 24, "tasks": ["15.4", "15.5"] },
    { "wave": 25, "tasks": ["15.6", "15.7"] },
    { "wave": 26, "tasks": ["16.1", "16.3"] },
    { "wave": 27, "tasks": ["16.5", "16.6"] },
    { "wave": 28, "tasks": ["17.1", "17.2"] },
    { "wave": 29, "tasks": ["17.3", "17.4"] },
    { "wave": 30, "tasks": ["17.6", "17.7"] },
    { "wave": 31, "tasks": ["17.8", "18.1"] },
    { "wave": 32, "tasks": ["18.2", "18.3"] },
    { "wave": 33, "tasks": ["18.4"] },
    { "wave": 34, "tasks": ["16.2", "16.4", "17.5"] },
    { "wave": 35, "tasks": ["16.7"] },
    { "wave": 36, "tasks": ["19.1"] },
    { "wave": 37, "tasks": ["19.2", "19.3"] },
    { "wave": 38, "tasks": ["20.1", "20.2"] },
    { "wave": 39, "tasks": ["21.1"] },
    { "wave": 40, "tasks": ["21.2"] },
    { "wave": 41, "tasks": ["21.3"] },
    { "wave": 42, "tasks": ["21.4"] },
    { "wave": 43, "tasks": ["21.5", "21.6"] },
    { "wave": 44, "tasks": ["21.7"] },
    { "wave": 45, "tasks": ["21.8"] },
    { "wave": 46, "tasks": ["21.9"] }
  ]
}
```