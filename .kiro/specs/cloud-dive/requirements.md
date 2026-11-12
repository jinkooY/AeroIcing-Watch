# Requirements — Cloud Dive

Active spec for the Kiroween 2026 submission. Supersedes the plan in
`../aeroicing-watch/` (that spec is the completed baseline and stays as is).
Deadline: 2026-12-04 (time of day to be confirmed in the official rules).

## 1. Pitch

**"Who gets iced the most?"** Fly a small aircraft through a real satellite
cross-section of today's clouds. Pilots learn to plan around icing clouds;
Cloud Dive lets anyone go inside one and see what a geostationary satellite
actually knows about it — and what it cannot know.

The same evidence engine also serves the existing dispatcher cross-section
view. One data pipeline, two audiences.

## 2. Personas

| Id | Persona | Goal | Surface |
|---|---|---|---|
| PU | Curious public, student pilot, flight-sim player | Explore the inside of a real cloud, understand why some clouds ice | Cloud Dive game (public, static) |
| PD | Airline dispatcher (existing) | Review satellite evidence along a planned segment | Existing cross-section view and API |

This persona list replaces the single-persona rule in the unmerged draft
`replay-and-ui/requirements.md`. The science guardrails apply to both
personas without exception.

## 3. Glossary

- **Case**: a pre-computed, static snapshot of one route at one satellite
  observation time, with samples, provenance and attribution.
- **Evidence level**: exactly one of `Observed supercooled layer at planned
  altitude`, `Not indicated`, `Not assessed`. (`Possible (forecast only)` is
  reserved for the IFS-based rule in `icing-layer-fusion` and is not produced
  by rule v1.)
- **Candidate layer**: the altitude band inside the cloud between the 0 °C and
  −20 °C estimates, limited by the estimated base and the observed top.
- **Dive**: one play session along one case.
- **Ice meter**: the game's visual build-up. It is a game rule driven only by
  kilometres flown at the `Observed` evidence level. It is not an airframe
  icing model.

## 4. Requirements (EARS)

### R1 Eligibility and provenance (P0)

1.1 THE SUBMISSION SHALL include an English pre-existing work disclosure that
lists every component ported or adapted from WeatherPath (`hackerton_2026`).
1.2 THE REPOSITORY SHALL include a third-party notice covering OpenAP
(LGPL-3.0), KMA/NMSC (KOGL Type 1), NOAA GOES/Himawari (public), and ECMWF
Open Data (CC BY 4.0).
1.3 WHEN any case or screen shows satellite-derived data, THE SYSTEM SHALL show
the data source, observation time (UTC) and attribution line.
1.4 THE PUBLIC DEMO SHALL publish only derived case JSON, never raw satellite
files or API keys.

### R2 Evidence rule v1 (satellite only)

2.1 THE SYSTEM SHALL compute, for every sample and planned altitude, exactly
one evidence level using rule `cloud-dive-evidence-v1`.
2.2 WHEN `retrievalState` is not `observed` or `clear`, THE SYSTEM SHALL set
`Not assessed` and SHALL keep the reason code.
2.3 WHEN `retrievalState` is `clear`, THE SYSTEM SHALL set `Not indicated`.
2.4 WHEN the sample is observed, the supercooled flag is `true`, and the
planned altitude is inside the candidate layer, THE SYSTEM SHALL set
`Observed supercooled layer at planned altitude`.
2.5 WHEN the supercooled flag is `null` or the cloud base is unknown, THE
SYSTEM SHALL set `Not assessed`, never `Not indicated`.
2.6 THE SYSTEM SHALL estimate the 0 °C and −20 °C heights from the cloud-top
temperature with a fixed lapse rate, SHALL record `isothermMethod:
"cloud_top_lapse_rate_estimate"`, and SHALL label both heights as estimated.
2.7 THE SYSTEM SHALL echo the rule name, version and threshold values in every
case file.
2.8 THE SYSTEM SHALL use no language model, random number or network call in
the evidence path.

### R3 Static case export

3.1 THE EXPORTER SHALL build cases from cached GK-2A, GOES-18/19 and
Himawari-9 frames by calling the existing profile builder.
3.2 Every exported case SHALL pass the `validProfile()` rules of
`static/viewer.js`.
3.3 THE EXPORTER SHALL reject any case that contains NaN or infinity.
3.4 THE PUBLIC SITE SHALL ship at least three cases, and at least one SHALL
contain an `Observed` stretch at a playable altitude. A case with zero
`Observed` km SHALL still ship as a contrast case only if at least one other
case has `Observed` km.
3.5 WHEN no suitable real frame exists by 2026-11-22, THE SITE SHALL use a
clearly labelled simulated case, and every screen showing it SHALL display
"Simulated".

### R4 Cloud Dive game

4.1 THE GAME SHALL scroll the aircraft along the case distance at a fixed game
speed and SHALL let the player change only altitude (keyboard, pointer,
touch).
4.2 WHEN the aircraft is between the estimated base and observed top of a
sample, THE GAME SHALL render an in-cloud visual and SHALL mark the base as
estimated.
4.3 WHILE the aircraft is at an `Observed` evidence level, THE GAME SHALL add
the flown distance to the observed-km counter and SHALL grow the ice visual in
proportion to that counter only.
4.4 WHILE the aircraft is at a `Not assessed` sample, THE GAME SHALL render an
"unknown" curtain and SHALL NOT render clear air.
4.5 AT the end of a dive, THE GAME SHALL report kilometres per evidence level,
whose sum equals the distance flown.
4.6 THE GAME SHALL be deterministic: the same case and the same input sequence
SHALL give the same counters.
4.7 THE GAME SHALL show a persistent note: "Game effect. Not an aircraft
icing model. Evidence from satellite cloud tops only."
4.8 THE GAME SHALL offer short "Why?" cards that explain supercooled water,
why a satellite sees only cloud tops, and why the base is an estimate. Cards
SHALL contain no operational advice.

### R5 Leaderboard: "Who gets iced the most?"

5.1 THE SITE SHALL list the shipped cases by observed-supercooled kilometres
at their preset flight level, with the source and observation time of each.
5.2 THE LIST SHALL show kilometres per evidence level, not a single
worst-case badge, and SHALL show `Not assessed` kilometres next to each entry.
5.3 THE LIST SHALL NOT rank airlines.

### R6 Dispatcher view (existing features)

6.1 THE SYSTEM SHALL keep the existing cross-section view, API endpoints and
`validProfile()` contract working.
6.2 THE HANDLING of the legacy `icingRisk` badge, altitude suggestions and the
"No icing detected" label SHALL follow decision D1.

### R7 Wording

7.1 No user-facing text SHALL contain "no icing", "ice-free", "safe", "clear
of ice", "light", "moderate", "severe", "likely" or "unlikely" in reference to
icing.
7.2 Absence of evidence SHALL be written as "Not indicated".

### R8 Accessibility and offline

8.1 Every evidence level SHALL be distinguishable in greyscale by pattern and
text label.
8.2 THE GAME SHALL be playable by keyboard alone.
8.3 THE SITE SHALL load and play from static files with no backend.

### R9 Submission package

9.1 THE VIDEO SHALL be under 3 minutes, narrated in English, and SHALL show
the project working end-to-end.
9.2 THE WRITE-UP SHALL answer each Kiro question in the official rules (hooks,
specs, steering, MCP, property-based testing, powers), using only entries in
`docs/kiro-usage-log.md`.
9.3 THE WRITE-UP SHALL state which parts were built with other AI tools.

## 5. Open decisions

| Id | Question | Recommendation | Status |
|---|---|---|---|
| D1 | Legacy `icingRisk` HIGH/MODERATE/LOW badge, altitude suggestions, "No icing detected" label: keep, or replace with evidence levels in the dispatcher view? | Replace in the UI with evidence levels and km per level; keep the API fields for backward compatibility but stop displaying them. Required to satisfy R7 and the guardrails. | Open (user) |
| D2 | Is an ice meter driven by observed km acceptable under guardrail "no numeric severity score"? | Yes, if R4.3 and R4.7 hold: it measures distance at an evidence level, not severity. | Open (user) |
| D3 | Is a leaderboard ranking cases by observed km acceptable? | Yes, because it ranks evidence distance, shows `Not assessed` km beside it, and never ranks airlines. | Open (user) |
| D4 | Category | Frankenstein (GK-2A + GOES + Himawari + Noh 2017 + a game on one pipeline). Costume Contest only if the game becomes the whole product. | Open (user) |
| D5 | Pre-existing work clause in the official rules | Read the full rules before P1 work. Blocking. | Open (user) |
