# Requirements — Replay and UI

Draft for Kiro to refine. Source: `docs/Kiro_Research_Direction_Review.md`, WO-4 and WO-5. Depends on `.kiro/specs/icing-layer-fusion/` for evidence levels and the response shape. Items marked **TBD** are undecided.

## Overview

Two parts of one deliverable.

Replay: given a stored sequence of archived satellite frames for one route, show what changed between consecutive frames, using only data that was available at each decision time.

UI: a single screen for one user to inspect the route cross-section, the icing candidate layer, the evidence levels and the frame-to-frame changes.

## Persona

One persona only: a dispatcher of domestic and short-haul routes checking climb and descent icing evidence during a pre-departure briefing. The UI does not target pilots in flight, long-haul planning, or general weather browsing.

## Glossary

- **Frame**: one GK-2A CTPS observation (and matching optics frame when available), identified by its UTC observation time.
- **Case**: a stored set of frames, IFS bundles, a route and a flight profile used for replay. Cases are archived data; no live collection.
- **Decision time**: the simulated "now" for a replay step.
- **Changed segment**: a contiguous stretch of the route whose evidence level differs between two frames.
- **Data kind**: one of observed, forecast, estimated, simulated.

## Requirements

### Part A — Replay (WO-4)

#### 1. Case definition

1.1 THE SYSTEM SHALL load a case from stored files containing: route endpoints, flight profile parameters, an ordered list of frames with UTC observation times, the IFS bundle references, and per-frame availability times.

1.2 WHEN a case has fewer than two frames, THE SYSTEM SHALL report `replay_unavailable` with the reason and SHALL NOT compute changes.

1.3 THE SYSTEM SHALL store, for each frame, the original reception time when known and SHALL mark a frame whose reception time is unknown as `availability_unverified`.

1.4 Where reception times are unknown, THE SYSTEM SHALL apply an explicit simulated delivery delay per frame, SHALL label the case "simulated delivery schedule" in every response and screen that uses it, and SHALL show the delay values used. Default delay: **TBD**.

1.5 The case manifest format and storage path are **TBD** (proposal: one JSON manifest per case under a tracked directory that does not require API keys).

#### 2. Change detection

2.1 WHEN two consecutive available frames of a case are compared, THE SYSTEM SHALL evaluate both on the same route, the same flight profile and the same sample distances, so differences come from data only.

2.2 THE SYSTEM SHALL return for each pair a list of changed segments, each with `startKm`, `endKm`, `previousLevel`, `newLevel`, `evidenceFrame` (the UTC observation time of the frame that produced `newLevel`), and `previousFrame`.

2.3 THE SYSTEM SHALL merge adjacent samples with the same (`previousLevel`, `newLevel`) pair into one changed segment, using the same midpoint interval rule as `routeSummary` in the fusion spec.

2.4 WHEN a sample changes to or from `Not assessed`, THE SYSTEM SHALL report it as a changed segment with a `kind` of `coverage_change`, and SHALL NOT report it as an improvement or a deterioration.

2.5 WHEN no sample changes level between two frames, THE SYSTEM SHALL return an empty changed-segment list and an explicit `unchanged: true`.

2.6 THE SYSTEM SHALL include for each changed segment the evidence reason codes for the previous and new level and the frame observation times in UTC.

2.7 THE SYSTEM SHALL NOT compare a level change in terms of "better" or "worse", SHALL NOT rank frames, and SHALL NOT output severity or probability.

#### 3. No look-ahead

3.1 WHEN the system evaluates a replay step with decision time `T`, THE SYSTEM SHALL use only frames with observation time at or before `T` and availability time (actual or simulated) at or before `T`.

3.2 WHEN the system selects an IFS bundle for decision time `T`, THE SYSTEM SHALL choose among bundles received at or before `T`, consistent with `choose_bundle` in `src/integration/ifs_grid.py`.

3.3 THE SYSTEM SHALL NOT use any IFS valid time, frame or flight-profile value derived from a frame after `T`, including for isotherm heights and the forecast criterion.

3.4 Test fixture requirement: a case SHALL include at least one frame whose observation time is later than the first decision time, so that the absence of look-ahead can be tested.

#### 4. Missing frames

4.1 WHEN a frame in the case is missing, unreadable, corrupt or outside the freshness window, THE SYSTEM SHALL mark it with a `frameStatus` of `missing`, `corrupt` or `stale` and SHALL include the status in the replay response.

4.2 WHEN a frame is unavailable, THE SYSTEM SHALL NOT replace it with another frame's data and SHALL NOT interpolate between frames.

4.3 WHEN a comparison skips one or more unavailable frames, THE SYSTEM SHALL compare the two nearest available frames, SHALL report `skippedFrames` and `spanMin` for the comparison, and SHALL NOT present the result as a one-step change.

4.4 WHEN every frame after the first is unavailable, THE SYSTEM SHALL report `replay_unavailable` and show the last available frame as a static view with its observation time.

#### 5. Exclusions

5.1 THE SYSTEM SHALL NOT advance an aircraft position during replay; the whole route is evaluated at every step.

5.2 THE SYSTEM SHALL NOT re-rank routes, candidate routes or altitudes, and SHALL NOT compute fuel in the replay or the UI.

5.3 THE SYSTEM SHALL NOT suggest an altitude, route change or other operational action.

#### 6. Determinism

6.1 THE SYSTEM SHALL return identical replay output for identical case files and rule version.

6.2 Replaying the same case twice SHALL NOT create duplicate changed segments.

#### 7. Cases to be stored (WO-4)

7.1 THE SYSTEM SHALL ship at least one case that contains a level change between consecutive frames.

7.2 THE SYSTEM SHALL ship at least one case that contains a missing frame between available frames.

7.3 Real winter cases (cold-air outbreak, mid to late November) are **TBD**: no such frame has been collected as of this draft. The only archived CTPS frame referenced in the repository is 2026-09-01 13:24 UTC. If real cases are not available by 25 November, the replay SHALL use the September frame plus a clearly labelled simulated second frame, and every screen using it SHALL show "Simulated".

7.4 For each real case, THE SYSTEM SHALL store the data source, observation time and reception time per frame, and a captured SIGWX or AIRMET image with its source, if one was obtained (**TBD**).

### Part B — UI (WO-5)

#### 8. Layout

8.1 THE SYSTEM SHALL present one screen with these regions: a left panel for route, altitudes and case selection; a centre cross-section; a small map above the cross-section showing the route and the satellite domain boundary; a right panel with evidence for the selected sample; a bottom control for frames.

8.2 THE SYSTEM SHALL draw in the cross-section: the cloud layer, the icing candidate layer as a shaded band, the 0 °C and −20 °C lines, and the planned flight profile line.

8.3 THE SYSTEM SHALL show in the evidence panel, for the selected sample: evidence level and reason, data source, observation time (UTC), retrieval quality, cloud-base estimation method, isotherm method, and planned altitude and ETA.

8.4 THE SYSTEM SHALL show the route summary as kilometres and segment list per evidence level, and SHALL NOT show a single worst-case badge or risk colour for the whole route.

8.5 THE SYSTEM SHALL keep the existing `static/viewer.js` profile contract and `validProfile()` rules; additions are limited to rendering the additive fields from the fusion spec.

8.6 THE SYSTEM SHALL keep working offline with the bundled sample so that opening the app never shows a blank screen (carried over from US-3 of the base spec).

#### 9. Data-kind distinction

9.1 THE SYSTEM SHALL distinguish observed, forecast, estimated and simulated data in every region using both a visual pattern and a text label, and SHALL NOT rely on colour alone.

9.2 THE SYSTEM SHALL label: satellite cloud top and phase as observed; IFS isotherm lines and the forecast criterion as forecast; cloud base and isotherms derived from cloud-top temperature as estimated; the bundled sample and any generated second frame as simulated.

9.3 THE SYSTEM SHALL show a persistent "Simulated" text banner whenever any displayed data is simulated.

9.4 THE SYSTEM SHALL provide a legend that maps each pattern to its text label and to the four evidence levels.

9.5 The specific patterns and colours are **TBD** (design to be done with Kiro; constraint: each of the four data kinds and each of the four evidence levels must be distinguishable in greyscale).

#### 10. Wording

10.1 THE SYSTEM SHALL use the text "not indicated" and SHALL NOT use "no icing", "ice-free", "safe" or "clear of ice" anywhere in the UI, API text or documentation of the app.

10.2 THE SYSTEM SHALL show `Not assessed` samples with an explicit label and a distinct pattern, never with the same appearance as `Not indicated` or as empty space.

10.3 THE SYSTEM SHALL NOT display altitude suggestions, route suggestions, severity words (light, moderate, severe) or probability values.

10.4 THE SYSTEM SHALL show a disclaimer that the display is not an operational weather product and that accuracy has not been evaluated.

10.5 THE SYSTEM SHALL show in a footer: "KMA/NMSC GK-2A", "ECMWF Open Data", "Noh et al. (2017)" and the disclaimer. Exact attribution text: **TBD** (check provider terms).

#### 11. Keyboard and accessibility

11.1 THE SYSTEM SHALL allow every control to be operated by keyboard alone: route inputs, case and frame selection, sample selection along the route, legend, and the evidence panel.

11.2 THE SYSTEM SHALL keep the existing sample slider behaviour (arrow keys, `aria-valuetext` with distance) and SHALL announce the selected sample's evidence level through an ARIA live region.

11.3 THE SYSTEM SHALL provide a visible focus indicator on every focusable element.

11.4 THE SYSTEM SHALL allow stepping between frames with two named buttons (previous, next) reachable by Tab and operable by Enter or Space, and SHALL also support left and right arrow keys when the frame control has focus.

11.5 THE SYSTEM SHALL ensure text contrast of at least 4.5:1 for body text. (WCAG level to target: **TBD**.)

#### 12. States

12.1 Empty state. WHEN no route has been entered, THE SYSTEM SHALL show the bundled sample labelled "Simulated" and a one-line instruction, and SHALL NOT show a blank cross-section.

12.2 Out-of-domain state. WHEN part of the route lies outside the satellite domain (32–44.5 °N, 122–134.5 °E), THE SYSTEM SHALL show those distances as `Not assessed` with the reason "outside satellite domain", and WHEN the whole route lies outside, THE SYSTEM SHALL show a message saying so and SHALL NOT draw a cross-section that looks like clear sky.

12.3 No-data state. WHEN the frame is missing, corrupt or stale, THE SYSTEM SHALL show the reason and the frame time, and SHALL show the labelled simulated sample only when the user has not selected an archived frame explicitly.

12.4 Error state. WHEN the API request fails, THE SYSTEM SHALL show an error message with a retry control and SHALL keep the last successfully displayed profile visible and marked as previous.

12.5 Loading state. WHILE a request is in progress, THE SYSTEM SHALL show a loading indicator and keep controls reachable.

12.6 Frame-gap state: see 4.1 to 4.4; the frame control SHALL show gaps as separate marked positions.

#### 13. Replay display

13.1 WHEN the user moves to the next frame, THE SYSTEM SHALL highlight changed segments on the cross-section with a pattern and a text label, and list them in a "What changed" panel with start and end distance, previous and new level, and evidence frame time.

13.2 WHEN no change exists, THE SYSTEM SHALL state "No change in evidence level between these frames" in the panel.

13.3 THE SYSTEM SHALL show the decision time, the frame observation times, and, when applicable, the "simulated delivery schedule" label in the frame control.

#### 14. Success scenario (review section 4.3)

14.1 WHEN a first-time user opens the deployed URL without installing anything, THE SYSTEM SHALL let them within 30 seconds see a winter-case cross-section, see the descent segment where the planned altitude crosses the candidate layer, and move to the next frame and see the changed segment highlighted. (Depends on a real or labelled-simulated case: **TBD**.)

14.2 Acceptance test: one person who has not seen the app performs the scenario without explanation; record the time and result. Number of testers: **TBD**.

## Out of scope

Fuel, candidate-route comparison, flight lookup, aircraft position replay, live ingestion, AI explanation, altitude advice, mobile-first layout, user accounts.

## Open decisions (TBD)

1. Default simulated delivery delay.
2. Case manifest format and location.
3. Patterns and colours for data kinds and evidence levels.
4. Real versus simulated winter case.
5. Attribution wording and accessibility target level.
6. Whether the map uses Leaflet (vendored; the `frontend/vendor` directory is currently empty) or a static SVG.
