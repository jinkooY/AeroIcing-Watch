# Implementation Plan - Cloud Dive

## Overview

Coding tasks for the Cloud Dive entry, in build order. Each task names the
requirements it implements (`R*` in `requirements.md`) and, where relevant,
the correctness properties it tests (`CD-P*` in `design.md` section 8).

Non-coding work (rules check, decisions D1-D5, disclosure text, real frame
collection, video, write-up, bonuses, Devpost form) is tracked in
[`submission-checklist.md`](submission-checklist.md).

## Tasks
- [ ] 1. Set up guardrails and automation
- [ ] 1.1 Import and adapt the science guardrails steering file
  - Copy `.kiro/steering/science-guardrails.md` from
    `origin/claude/kiro-research-direction-review-b971c3` (that file only)
  - Set `fileMatchPattern` to cover `src/analysis/**`,
    `tools/export_cloud_dive.py` and `static/cloud-dive/**`
  - Limit the evidence levels to the three rule-v1 levels and note that
    `Possible (forecast only)` is reserved for the fusion rule
  - _Requirements: R2.1, R7.1, R7.2_
- [ ] 1.2 Add a command hook that runs `pytest -q` when a `*.py` file is saved
  - Create it through the Kiro Hook UI, not by editing JSON by hand
  - _Requirements: R2.8, R3.2_
- [ ] 1.3 Add a command hook that runs `node --check` on the saved `*.js` file
  - _Requirements: R8.3_
- [ ] 1.4 Add a PreToolUse hook that blocks writes to `.env` and `data/` (exit 2)
  - _Requirements: R1.4_
- [x] 1.5 Point the session-start and progress hooks at this plan
  - _Requirements: R9.2_

- [ ] 2. Implement evidence rule v1 in `src/analysis/evidence.py`
- [ ] 2.1 Add `hypothesis` to `requirements.txt` and create the module skeleton
  - Constants: rule name `cloud-dive-evidence-v1`, version 1,
    `LAPSE_C_PER_KFT = 1.98`, the three level strings, reason codes
  - `rule_metadata()` returns the values echoed into every case
  - _Requirements: R2.1, R2.7_
- [ ] 2.2 Implement `isotherms(top_ft, ctt_c)` and `candidate_layer(base_ft, top_ft, zero_c_ft, minus20_c_ft)`
  - Formulas exactly as in design section 3; return `None` for any null input
  - Record `isothermMethod = "cloud_top_lapse_rate_estimate"`
  - _Requirements: R2.6_
- [ ] 2.3 Implement `evaluate(sample, planned_alt_ft)`
  - Apply rule rows 1-7 in order, first match wins
  - Return level, reason code, isotherms and candidate layer
  - No randomness, clock, network or model call in this path
  - _Requirements: R2.2, R2.3, R2.4, R2.5, R2.8_
- [ ] 2.4 Implement `route_summary(samples)`
  - Midpoint interval per sample (first from 0, last to the end)
  - All three level keys present, each with `km` and merged `[startKm, endKm]` segments
  - _Requirements: R4.5, R5.2_
- [ ] 2.5 Write unit tests in `tests/test_evidence.py`
  - One test per rule row with fixed synthetic numbers, named `synthetic`
  - Isotherm arithmetic and an empty candidate layer
  - Summary on a three-sample route
  - _Requirements: R2.1, R2.2, R2.3, R2.4, R2.5, R2.6_
- [ ] 2.6 Write property tests CD-P1 to CD-P5 in `tests/test_evidence_properties.py`
  - Hypothesis strategies for samples (all retrieval states, nulls,
    temperatures from -80 to +30 C) and planned altitudes 0-45 000 ft
  - Record any counterexample Hypothesis finds in the usage log
  - _Requirements: R2.2, R2.4, R2.5, R2.6, R5.2_
- [ ] 2.7 Checkpoint: run the full test suite and fix failures

- [ ] 3. Build the static case exporter
- [ ] 3.1 Write `tools/check_viewer_contract.py`
  - Python port of every rule in `validProfile()` in `static/viewer.js`;
    returns a list of error strings
  - Unit tests with one valid fixture and one invalid fixture per rule
  - _Requirements: R3.2_
- [ ] 3.2 Write property tests CD-P8 and CD-P9
  - CD-P8: profiles built from generated synthetic frames pass the checker
  - CD-P9: `assert_finite(obj)` rejects NaN and infinity at any depth
  - _Requirements: R3.2, R3.3_
- [ ] 3.3 Write property test CD-P10 for `src/analysis/route_sampler.py`
  - Include routes that cross the dateline and near-polar routes
  - _Requirements: R3.1_
- [ ] 3.4 Write `tools/export_cloud_dive.py`
  - Input: a case manifest (route endpoints, flight level, frame time)
  - Call `build_global_profile`, apply `evidence.evaluate` to each sample,
    add `route_summary`, source, attribution, `observedAt` and rule metadata
  - Drop `icingRisk`, `icingLevel` and `altitudeSuggestions` from case files
  - Fail on any checker error or non-finite value; never copy raw files or keys
  - _Requirements: R1.3, R1.4, R2.7, R3.1, R3.2, R3.3_
- [ ] 3.5 Write `static/cloud-dive/cases/index.json` from the exported cases
  - Per case: id, title, `flightAlt_ft`, `observedAt`, source, km per level
  - Fail when the only case with zero observed km would ship alone
  - _Requirements: R3.4, R5.1_
- [ ] 3.6 Add a deterministic `--simulated` mode to the exporter
  - `dataKind: "simulated"`, "Simulated" in the title, and at least one
    observed supercooled stretch at the preset flight level
  - _Requirements: R3.5_
- [ ] 3.7 Write exporter tests in `tests/test_export_cloud_dive.py`
  - Fixture frames in `tmp_path`; output passes the checker
  - Attribution present; no file system paths or keys in the output
  - Simulated cases are labelled
  - _Requirements: R1.3, R1.4, R3.2, R3.5_

- [ ] 4. Build the game engine
- [ ] 4.1 Write `static/cloud-dive/engine.js` as an ES module with no DOM access
  - `evaluateAt(sample, altFt, rule)` mirrors `evidence.evaluate` rows 1-7
  - `sampleAt(caseData, distanceKm)` uses the same midpoint intervals
  - `step(state, input, dtSeconds, caseData)`: fixed game speed, bounded
    climb rate, km-per-level counters
  - _Requirements: R4.1, R4.3, R4.6_
- [ ] 4.2 Write a Python-JavaScript parity test
  - Pytest runs a Node script that evaluates fixture samples over an
    altitude grid; results must equal `evidence.evaluate`
  - _Requirements: R2.1, R4.6_
- [ ] 4.3 Write Node tests for CD-P6 and CD-P7 in `static/cloud-dive/engine.test.mjs`
  - Use `node --test` and a small seeded input generator (no npm packages)
  - Call it from pytest so the `*.py` hook covers it
  - _Requirements: R4.3, R4.5, R4.6_

- [ ] 5. Build the game UI
- [ ] 5.1 Create `static/cloud-dive/index.html`, `game.css` and `game.js`
  - Case picker from `cases/index.json`, canvas, HUD (altitude, distance,
    current evidence level as text, observed km)
  - Persistent note: "Game effect. Not an aircraft icing model. Evidence
    from satellite cloud tops only."
  - Error states from design section 9; never a blank canvas
  - _Requirements: R4.7, R8.3_
- [ ] 5.2 Implement rendering
  - Cloud body by phase, dashed "estimated base", hatched candidate band
  - `Not assessed` curtain labelled "Unknown", never drawn as sky
  - In-cloud fog; frost opacity driven only by observed km
  - Each level distinguishable in greyscale by pattern and text label
  - _Requirements: R4.2, R4.3, R4.4, R8.1_
- [ ] 5.3 Implement input
  - Arrow keys and W/S, pointer drag, on-screen buttons; pause and restart
  - _Requirements: R4.1, R8.2_
- [ ] 5.4 Implement the end-of-dive report
  - km per level from the engine counters (sum equals distance flown),
    case source and observation time, replay button
  - _Requirements: R1.3, R4.5_
- [ ] 5.5 Implement the "Who gets iced the most?" leaderboard
  - Sort by observed km, then fewer `Not assessed` km
  - Show all three km values on every row; no airline field
  - _Requirements: R5.1, R5.2, R5.3_
- [ ] 5.6 Add three "Why?" cards
  - Supercooled water, why a satellite sees only cloud tops, why the base is
    an estimate; no operational advice
  - _Requirements: R4.8_
- [ ] 5.7 Write `tests/test_wording.py`
  - Scan `static/cloud-dive/**` and case files for the banned terms in R7.1
  - _Requirements: R7.1, R7.2_
- [ ] 5.8 Add a command hook that runs the wording test on save under `static/cloud-dive/`
  - _Requirements: R7.1_
- [ ] 5.9 Checkpoint: pytest, `node --check` and `node --test` all pass

- [ ] 6. Publish the site and update the dispatcher view
- [ ] 6.1 Change `.github/workflows/route-demo-pages.yml` to assemble the site root
  - `/` from `static/cloud-dive/`, `/route-demo/` from `static/route-demo/`,
    `/viewer/` from the standalone viewer and its scripts
  - Fix relative paths so each part loads from its sub-path
  - _Requirements: R6.1, R8.3_
- [ ] 6.2 Apply decision D1 to the dispatcher view (only if D1 is accepted)
  - Add `evidenceLevel`, `evidenceReason` per sample and `routeSummary` to
    the cross-section response in `src/api/icing.py` (additive)
  - In `frontend/index.html` and `frontend/app.js`, replace the risk badge
    and altitude suggestions with evidence levels and km per level
  - _Requirements: R6.1, R6.2, R7.1_
- [ ] 6.3 Write API tests for the additive fields and backward compatibility
  - Every existing field keeps its type; `validProfile()` rules still pass
  - _Requirements: R6.1_
- [ ] 6.4 Final checkpoint: full test suite, wording test and Node checks pass

## Notes

- Before task 2 starts, checklist items C1 (official rules) and C2
  (decisions D1-D4) must be done. Task 6.2 runs only if D1 is accepted.
- All file content in English. A task is done only when its check passes.
- Add one row to `docs/kiro-usage-log.md` per completed task (feature used,
  what it caught, commit).
- Real case files come from checklist item C5; tasks 3.6 and 3.7 make the
  game playable with a labelled simulated case before then.

## Task Dependency Graph

Tasks in the same wave can run in parallel. Each wave depends on the waves
before it.

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1.1", "1.2", "1.3", "1.4", "1.5"] },
    { "wave": 2, "tasks": ["2.1"] },
    { "wave": 3, "tasks": ["2.2", "2.3"] },
    { "wave": 4, "tasks": ["2.4", "2.5", "2.6"] },
    { "wave": 5, "tasks": ["2.7"] },
    { "wave": 6, "tasks": ["3.1", "3.3", "4.1"] },
    { "wave": 7, "tasks": ["3.2", "3.4", "4.2", "4.3"] },
    { "wave": 8, "tasks": ["3.5", "3.6", "3.7", "5.1"] },
    { "wave": 9, "tasks": ["5.2", "5.3", "5.4", "5.5", "5.6", "5.7"] },
    { "wave": 10, "tasks": ["5.8", "5.9"] },
    { "wave": 11, "tasks": ["6.1", "6.2"] },
    { "wave": 12, "tasks": ["6.3", "6.4"] }
  ]
}
```