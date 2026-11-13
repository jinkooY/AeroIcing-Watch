# Implementation Plan - Cloud Dive

## Overview

Coding tasks for the Cloud Dive entry (US routes, fuel-cost score, decision-gate
flow), in build order. Each task names the requirements it implements (`R*` in
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

- [ ] 5. Build the cost model, game core and solver (Python reference)
- [ ] 5.1 Write `src/analysis/cost_model.py`
  - OpenAP tables for E75L at 30,340 kg: flow by altitude, climb extra per
    1,000 ft (check the vertical-speed unit), TAS schedule; lazy import; parameter
    dataclass with price, anti-ice factor, speed loss, drag flow, ice exponent, ice rates
  - _Requirements: R4.1, R4.2, R4.3, R4.7_
- [ ] 5.2 Write `src/analysis/game_core.py`
  - Pure `step`, ice integer index with convex speed loss and fuel-flow drag, anti-ice
    fuel factor, cost components, lane and altitude limits, gate lookahead,
    `run_until_gate`
  - _Requirements: R4.4, R4.5, R4.6, R5.1, R5.2, R5.3, R5.4, R5.5, R6.1, R6.2, R7.1, R7.2, R7.3_
- [ ] 5.3 Write property tests CD-P6 to CD-P11 and CD-P14
  - Random action sequences over a synthetic cube
  - _Requirements: R4.6, R5.3, R5.4, R5.5, R6.4, R7.2, R7.3, R8.1_
- [ ] 5.4 Write `src/analysis/solver.py`
  - Exact dynamic programme over the same transition; Best, Best with anti-ice forced
    off, Best with anti-ice forced on, Wasteful extreme, Straight-ahead
  - _Requirements: R4.8, R8.2, R8.3_
- [ ] 5.5 Write property tests CD-P12, CD-P16 and CD-P17 and `tools/tune_params.py`
  - The tuning report prints Best, the two forced-anti-ice variants and Straight-ahead per
    case and checks balance criteria B1 to B4; levers are the altitude block, corridor
    width and the parameters, never the weather data
  - _Requirements: R4.8, R8.2, R8.3_
- [ ] 5.6 Checkpoint: run the full test suite and fix failures

- [ ] 6. Build the case exporter
- [ ] 6.1 Write `tools/check_viewer_contract.py` and tests
  - Python port of every rule in `validProfile()`; property test CD-P15
  - _Requirements: R3.4_
- [ ] 6.2 Write `tools/export_cloud_dive.py`
  - Manifest-driven: satellite lanes, IFS cube, evidence, params, references, balance
    results, embedded centre-lane viewer profile, provenance, attribution; fails on
    non-finite values, secrets, absolute paths, or a case that fails B1 to B3
  - _Requirements: R1.3, R1.4, R2.7, R3.1, R3.4, R4.2, R4.8_
- [ ] 6.3 Add manifests for the three cases and a `--simulated` mode
  - 2026-11-12 JFK-BNA 19:30 UTC (GOES-19), 2026-11-01 DEN-LAX 21 UTC (GOES-18),
    2026-11-07 BUF-PWM 19 UTC (GOES-19); simulated case labelled "Simulated"
  - _Requirements: R3.5, R3.6_
- [ ] 6.4 Write exporter tests in `tests/test_export_cloud_dive.py`
  - Fixtures in `tmp_path`; attribution present; no paths or keys in the output
  - _Requirements: R1.4, R3.4_
- [ ] 6.5 Run the real export and commit the cases
  - Collect the GOES hours and the IFS run, export, run `tune_params.py` (B4 is checked
    across the three cases), commit `static/cloud-dive/cases/`
  - _Requirements: R3.5, R4.8_

- [ ] 7. Build the JavaScript engine
- [ ] 7.1 Write `static/cloud-dive/engine.js`
  - DOM-free ES module port of `game_core`
  - _Requirements: R6.1, R6.2, R7.1, R7.2, R7.3_
- [ ] 7.2 Write the Python-JavaScript parity test (CD-P7)
  - pytest runs a Node script over random action sequences on a fixture case
  - _Requirements: R6.1, R5.4_
- [ ] 7.3 Write Node tests with `node --test`
  - Gate placement and no silent entry (CD-P14) on a real exported case
  - _Requirements: R6.2, R6.4_

- [ ] 8. Build the game UI
- [ ] 8.1 Create `static/cloud-dive/index.html`, `game.css`, `game.js`
  - Case picker from `cases/index.json`, HUD (dollar total, ice bar, anti-ice,
    altitude, lane, distance), persistent game note, error states
  - _Requirements: R9.3, R10.3_
- [ ] 8.2 Implement the cross-section renderer
  - Cloud body by phase, dashed estimated base, hatched candidate band, wind
    barbs, forecast-environment shading, "Unknown" curtain, mini top-view map;
    greyscale-safe patterns and text labels
  - _Requirements: R6.5, R10.1_
- [ ] 8.3 Implement the gate panel, controls and fast-forward
  - Lane, altitude, anti-ice, continue, pause anywhere; keyboard, pointer, touch;
    no cost preview and no recommendation
  - _Requirements: R6.1, R6.3, R6.5, R7.1, R7.4, R10.2_
- [ ] 8.4 Implement the end-of-flight report
  - Components, references, share of the possible saving, kilometres per level,
    browser-only personal best, share text without severity words
  - _Requirements: R8.1, R8.2, R8.3, R8.4, R8.5_
- [ ] 8.5 Add four "Why?" cards
  - Supercooled water, why a satellite sees only cloud tops, why the base is an
    estimate, why anti-ice costs fuel; no operational advice
  - _Requirements: R9.4_
- [ ] 8.6 Write `tests/test_wording.py` and a hook that runs it on save under `static/cloud-dive/`
  - Scan UI files and case files for the terms in R9.1
  - _Requirements: R9.1, R9.2_
- [ ] 8.7 Checkpoint: pytest, `node --check` and `node --test` all pass

- [ ] 9. Publish the site and keep the dispatcher view working
- [ ] 9.1 Change `.github/workflows/route-demo-pages.yml` to publish the game
  - Root from `static/cloud-dive/`, viewer at `/viewer/`; remove the route demo
    from the published site; check that paths resolve in a signed-out browser
  - _Requirements: R10.3, R10.4_
- [ ] 9.2 Apply decision D1 (replace) to the dispatcher view
  - Evidence levels and kilometres per level instead of the risk badge and
    altitude suggestions
  - _Requirements: R11.2, R9.1_
- [ ] 9.3 Write API compatibility tests
  - Every existing `/api/icing/*` field keeps its type; `validProfile()` rules pass
  - _Requirements: R11.1_
- [ ] 9.4 Final checkpoint: full test suite, wording test and Node checks pass

## Notes

- F1 to F6 are approved (`requirements.md` 5.6; F3 amended with the two-sided anti-ice penalty and the balance criteria).
- Task 6.5 and the real data runs need network access; the rest runs offline.
- Parameter values (price, anti-ice factor, drag, ice rates) are illustrative; tune
  them only through `tools/tune_params.py` and record changes in the usage log.
- Add one row to `docs/kiro-usage-log.md` per completed task.
- Decision D1 is settled (replace), so task 9.2 is not conditional.

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
    { "wave": 13, "tasks": ["9.2", "9.3", "9.4"] }
  ]
}
```