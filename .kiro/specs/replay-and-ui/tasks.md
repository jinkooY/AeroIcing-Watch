# Tasks — Replay and UI

Requirement numbers refer to `requirements.md` in this folder. Property labels R1 to R11 refer to `design.md`, section 3. Depends on the `icing-layer-fusion` spec being implemented at least through its Phase 6. All file content must be in English. Do not mark a task done until its tests pass.

## Phase 0 — Decisions and data

- [ ] 0.1 Resolve the open decisions at the end of `requirements.md` and record the answers there. (Reqs 1.4, 1.5, 9.5, 10.5, 11.5)
- [ ] 0.2 Collect frames for at least two cold-air cases (mid to late November): CTPS, DCOEW where daytime, GK-2A ICING product if obtainable, IFS at the same times, with reception times recorded. Dates, number of frames and ICING availability: TBD. (Reqs 7.3, 7.4)
- [ ] 0.3 Capture the SIGWX or AIRMET image for each case with source and time, if obtainable. TBD. (Req 7.4)
- [ ] 0.4 If no real case exists by 25 November, prepare the September frame plus a labelled simulated second frame. Decision: TBD. (Req 7.3)

## Phase 1 — Case files and replay core

- [ ] 1.1 Define the case manifest and write a loader that validates it. (Reqs 1.1, 1.2, 1.3, 1.5)
- [ ] 1.2 Implement the simulated delivery schedule and its labelling. (Req 1.4)
- [ ] 1.3 Implement `evaluate_at(case, T)` with the eligibility filter and IFS bundle choice by receipt time. (Reqs 3.1, 3.2, 3.3)
- [ ] 1.4 Property test R1 with sentinel values in frames and bundles after `T`. (Reqs 3.1 to 3.4)
- [ ] 1.5 Implement frame statuses and the skipped-frame logic. (Reqs 4.1 to 4.4)
- [ ] 1.6 Unit tests: missing frame, corrupt frame, stale frame, all later frames missing, fewer than two frames. (Reqs 1.2, 4.1 to 4.4)
- [ ] 1.7 Property test R8. (Reqs 4.2, 4.3)

## Phase 2 — Change detection

- [ ] 2.1 Implement `compare(profileA, profileB)` with merging, `coverage_change`, `unchanged`, reasons and frame times. (Reqs 2.1 to 2.6)
- [ ] 2.2 Property tests R3, R4, R5, R6, R7. (Reqs 2.2, 2.3, 2.4, 2.5)
- [ ] 2.3 Test that the output has no better/worse ordering, ranking, fuel or altitude fields. Property test R9. (Reqs 2.7, 5.1 to 5.3)
- [ ] 2.4 Property tests R2 for determinism and no duplicates. (Reqs 6.1, 6.2)

## Phase 3 — Replay API and fixtures

- [ ] 3.1 Add the replay endpoints. Names TBD. (Req 1.1, 2.2)
- [ ] 3.2 Build the fixture case with a level change and the fixture case with a missing frame. (Reqs 7.1, 7.2)
- [ ] 3.3 Integration tests against both fixtures through the endpoints. (Reqs 7.1, 7.2)
- [ ] 3.4 Property test R10 on every frame profile returned. (Req 8.5)

## Phase 4 — Page structure and states

- [ ] 4.1 Build the page layout from `design.md` section 2.1 on `frontend/index.html`, reusing `static/viewer.js` and `static/styles.css`. (Reqs 8.1, 8.5)
- [ ] 4.2 Draw the candidate layer band, 0 °C and −20 °C lines and flight profile line from the additive fields. (Req 8.2)
- [ ] 4.3 Evidence panel and route summary panel. No single route badge. (Reqs 8.3, 8.4)
- [ ] 4.4 Implement empty, out-of-domain (partial and whole), no-data, error and loading states. (Reqs 12.1 to 12.5, 8.6)
- [ ] 4.5 Check that the bundled sample still loads with no server. (Req 8.6)

## Phase 5 — Data-kind encoding, wording, accessibility

- [ ] 5.1 Implement the data-kind patterns, text tags, legend and Simulated banner. (Reqs 9.1 to 9.5)
- [ ] 5.2 Move fixed strings to one constants block; add a test that scans the UI source and API text for banned phrases. (Reqs 10.1, 10.2, 10.3; property R9)
- [ ] 5.3 Disclaimer and attribution footer. (Reqs 10.4, 10.5)
- [ ] 5.4 Keyboard operation, focus indicators, ARIA live region, frame buttons and arrow keys. (Reqs 11.1 to 11.4)
- [ ] 5.5 Contrast check for body text. (Req 11.5)
- [ ] 5.6 Greyscale screenshot review of all data-kind and evidence-level patterns. Property R11 label check. (Reqs 9.1, 9.5)

## Phase 6 — Replay display

- [ ] 6.1 Frame control with markers, gap marks, decision time and delivery-schedule label. (Reqs 12.6, 13.3, 4.1)
- [ ] 6.2 Highlight changed segments on the chart and list them in the "What changed" panel; no-change text. (Reqs 13.1, 13.2)

## Phase 7 — Acceptance

- [ ] 7.1 Keyboard-only run of the full scenario; record any step that needs a mouse. (Reqs 11.1, 14.1)
- [ ] 7.2 First-time-user run of the 30-second scenario with at least one person who has not seen the app; record time and result. Number of testers: TBD. (Reqs 14.1, 14.2)
- [ ] 7.3 Update the README with the replay endpoints and the UI states. (Req 1.5)
