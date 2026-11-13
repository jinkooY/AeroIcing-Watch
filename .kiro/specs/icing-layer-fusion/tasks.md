# Tasks — Icing Layer Fusion

Requirement numbers refer to `requirements.md` in this folder. Property numbers (P1 to P15) refer to `design.md`, section 10. All file content must be in English. Do not mark a task done until its tests pass.

## Phase 0 — Decisions

- [ ] 0.1 Resolve the open decisions listed at the end of `requirements.md` (defaults for rates and speed, forecast thresholds, below-base handling, `assessmentState` values, rule name and version, terrain, geopotential height). Record each answer in `requirements.md`. (Reqs 1.5, 4.5, 4.6, 6.2, 6.3, 3.5)

## Phase 1 — IFS levels

- [ ] 1.1 Add 925 and 700 hPa to `LEVELS` in `tools/collect_ifs.py`. Keep the message-count check. (Req 7.1, 7.2)
- [ ] 1.2 Test: the index selector accepts a synthetic index with six levels and rejects one missing a level. (Req 7.2)
- [ ] 1.3 Test: a bundle with four levels and a bundle with six levels both load through `src/integration/ifs_grid.py` and interpolate at a mid-level pressure. (Req 7.3, 2.8)
- [ ] 1.4 Collect a new six-level bundle for the winter case run once a case date is chosen. Date and run: TBD. (Req 7.1)

## Phase 2 — Flight profile

- [ ] 2.1 Create the flight profile module: trapezoid, triangle and level shapes; per-sample planned altitude and ETA; input validation. (Req 1.1 to 1.7)
- [ ] 2.2 Unit tests with fixed numbers: trapezoid, triangle, level, route shorter than climb, equal elevations, zero-length cruise. (Req 1.1, 1.2, 1.3)
- [ ] 2.3 Property tests P8 and P9. (Req 1.4, 1.7)
- [ ] 2.4 Test that invalid inputs return HTTP 422 with the field name. (Req 1.6)

## Phase 3 — Isotherms

- [ ] 3.1 Create the isotherm module: IFS column interpolation, lapse-rate fallback, method recording. (Req 2.1 to 2.5)
- [ ] 3.2 Unit tests: isotherm between two levels; isotherm below the lowest level falls back; no IFS falls back; CTT warmer than the isotherm gives `unavailable`; method strings. (Req 2.2, 2.3, 2.5)
- [ ] 3.3 Property tests P13 and P14. (Req 2.3)
- [ ] 3.4 Record the IFS initialization, valid time, receipt time and levels used in the response `forecast` object. (Req 2.7)

## Phase 4 — Layer and evidence level

- [ ] 4.1 Create the layer module: satellite supercooled signal, candidate layer with reason codes, forecast criterion, evidence level and reason. (Req 3.1 to 3.4, 4.1 to 4.10)
- [ ] 4.2 One unit test per row of the decision table in `design.md` section 5, including each retrieval state. (Req 4.1 to 4.5)
- [ ] 4.3 Property tests P1 to P5. (Req 3.1, 3.2, 4.1, 4.2, 4.3, 4.8)
- [ ] 4.4 Property test P12 and a test that `icingRisk` is null in every response. (Req 4.9, 6.2)
- [ ] 4.5 Add `limitations` text to the response. (Req 3.5, 3.6)

## Phase 5 — Route summary

- [ ] 5.1 Create the route summary module: interval assignment, segment merging, all four keys always present. (Req 5.1 to 5.3)
- [ ] 5.2 Property test P7; unit test with a hand-computed three-segment route. (Req 5.4)
- [ ] 5.3 Test that no response field names a worst or highest level. (Req 5.5)

## Phase 6 — Integration

- [ ] 6.1 Extend `build_profile` and the cross-section endpoint with optional flight-profile query parameters and the new per-sample and top-level fields. (Req 6.1, 6.6, 6.7)
- [ ] 6.2 Pass the IFS bundle selection into the build; choose the bundle by receipt time against the decision time. (Req 2.1, 2.7)
- [ ] 6.3 Make the simulated fallback carry the new fields with `Not assessed` and `simulated_profile`. (Req 6.5)
- [ ] 6.4 Add `ruleName` and `ruleVersion` and provenance fields. (Req 6.3, 8.3)
- [ ] 6.5 Property tests P6, P10, P11, P15. Port the `validProfile()` rules to a Python checker and add a check that runs `static/viewer.js` validation in Node on a saved response. (Req 6.4, 8.1)
- [ ] 6.6 Integration tests with a synthetic frame and a synthetic IFS bundle: descent sample is `Observed`; the same route with `profile=level` at cruise altitude has no `Observed` sample; missing IFS gives fallback methods; out-of-domain samples stay `Not assessed`. (Req 1.3, 2.2, 4.1, 4.3)
- [ ] 6.7 Test that no code path in the evaluation imports a network or model client. (Req 8.2)
- [ ] 6.8 Re-run the archived frame `202609011324` through the endpoint and confirm the response is valid and unchanged in all original fields. (Req 6.1, 6.4)

## Phase 7 — Real-case check

- [ ] 7.1 With a real winter frame and a six-level IFS bundle, confirm at least one `Observed` sample in a descent segment and none at cruise only. Case: TBD. (Review WO-3 completion criterion)
- [ ] 7.2 If no suitable real case exists by the review's cutoff (25 November), record this and use the labelled synthetic case. Decision date and outcome: TBD.
- [ ] 7.3 Update the README API section with the new parameters and fields. (Req 6.1, 6.6)
