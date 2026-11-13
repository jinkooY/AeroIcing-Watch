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

## 5. Decision log (2026-11-13)

Sections 1-4 above predate these decisions. Where they conflict, this log
wins; section 4 and `design.md` are rewritten after the three items marked
"Pending".

### 5.1 Decided by the owner

| Id | Decision |
|---|---|
| D4 | Category: **Frankenstein**. |
| P1 | Game cases are presets: a fixed date, US departure and arrival airports, daytime only. Dates and routes are chosen from PIREP icing clusters. Candidates: 2026-11-02 Colorado front range, 2026-11-01 Ohio and Great Lakes, 2026-11-07 New York area. |
| P2 | Background layers come from ECMWF IFS: forecast icing environment and wind. Satellite evidence is extracted along the route in the manner of the CIRA cloud cross-section (GOES-West and GOES-East). Cases are archived, not real time. |
| P3 | Player controls: altitude, plus left, right, up and down avoidance inside a corridor around the great-circle route, chosen before entering a cloud. |
| P4 | Two score types per case: lowest and highest ice build-up. |
| P5 | Score is an accumulated ice build-up that reflects severity (see D1/D2 conditions). |
| P6 | Video: recorded after the system is complete, English AI voice narration. |
| P7 | Student and startup bonuses do not apply. |
| P8 | All remaining coding is done in Kiro only. Code that came from other tools is labelled "Codex" or "Claude" in the disclosure. |
| P9 | The WeatherPath-derived code is re-inventoried in `docs/Preexisting_Work_Disclosure.md`. |

### 5.2 Kiro judgements (owner may veto)

| Id | Judgement |
|---|---|
| J1 (D1, D2) | **Ice build-up index (game model).** A transparent, deterministic, uncalibrated index in game units, computed per kilometre flown at the `Observed supercooled layer` level from: supercooled-layer membership (satellite), temperature band (ECMWF), and cloud water proxy (GOES cloud optical depth and particle size, daytime). It is labelled "Game model. Not a severity forecast." The words light, moderate, severe, likely and unlikely stay banned. The dispatcher view does not show the index. `science-guardrails.md` is amended to allow a labelled numeric game index and to forbid reuse of it as a risk label. Reason: the data has no liquid water content or droplet size at flight level, so a real severity cannot be supported. |
| J2 (GOES resolution) | Use native CONUS arrays, not the shared 500x620 grid (about 25-30 km per cell). Phase, cloud optical depth and particle size are 2 km (ACTPC, CODC, CPSC, verified on 2026-11-13). Cloud-top height is 10 km (ACHAC, 300x500). Lane spacing 15 km (5 lanes, plus or minus 30 km), along-track step 10 km. Height is shown at 10 km resolution and is labelled so. Parallax at 10 km cloud height is about 15 km at these latitudes (estimate), so the correction is tested. No claim finer than one satellite pixel. |
| J3 (D3) | Leaderboard ranks presets by lowest and highest score, shows both, and never ranks airlines. Best and worst reference scores are shown only after play. |
| J4 | Wording: "supercooled cloud-top observation", never "icing confirmed". PIREP icing reports are used to choose and label cases and are shown as reports, not as validation. |

### 5.3 Pending

| Id | Question | Kiro recommendation |
|---|---|---|
| W1 | Confirm J1 (index in game units, guardrail amended). | Confirm. |
| W2 | The Incheon-Haneda route comparison with fuel (`/route-demo/`) needs US rework. Rework, or retire from the submission? | Retire it from the submission scope, keep it in git history, and drop OpenAP and the fuel model. The US game already carries the ECMWF wind and icing background. This removes a licence item and about a week of rework. |
| W3 | Run the case check now: for each candidate, fetch the GOES CONUS frames, confirm that supercooled pixels lie on a feasible route at the PIREP times, and pick the airport pair. | Yes. |

## 6. Official rules digest (read in full on 2026-11-13)

| Rule | Value or text | Consequence |
|---|---|---|
| Submission period | Oct 30 - Dec 4 2026, 2:00 pm Pacific (22:00 UTC; Dec 5 07:00 KST) | Submit by Dec 3 (KST evening). No extensions. |
| Credits | Request form due Tue Dec 1 12:00 pm PT (Dec 2 05:00 KST); redeem by Dec 4 | Owner action. |
| New projects only | Newly created during the period; pre-existing code or work must be disclosed | First commit is 2026-11-11 23:13, inside the period. WeatherPath-derived code is disclosed (P9). |
| Stage One | Pass/fail: fits the theme, reasonably applies Kiro. "Insufficient use of Kiro will result in disqualification" | Keep real Kiro work visible (P8). |
| Judging | Five criteria at 20 percent each: Potential Impact, Technological Implementation, Design, Innovation/Idea, Presentation | Plan maps tasks to criteria. |
| Video | Under 3 minutes, public on YouTube, shows the project working on its device, no third-party trademarks or copyrighted music | No CIRA, NOAA or other logos on screen. Use a voice service whose terms allow public use. |
| Repository | Public GitHub, open source licence visible in the About section, `/.kiro` at root and not git-ignored, all source and instructions | Verified today: Apache-2.0 file present, `.kiro` tracked and not ignored. |
| Access | Working app link, free, available until the judging period ends (Jan 29 2027) | The Pages site must stay up through Jan 29 2027. |
| Language | All materials in English | Already the case. |
| Third-party data | Entrant must be authorised under the data terms | ECMWF Open Data (CC BY 4.0), NOAA GOES (public), IEM/NWS PIREP; record in `THIRD_PARTY_NOTICES.md`. |
| Write-up | Kiro IDE, CLI, Web, Crew: how did they differ. Custom agents. Hooks. Specs. Steering. MCP. PBT. Powers | Two items were missing from the earlier plan: surfaces and custom agents. Added to the checklist. |
| Bonus: blog | Public post on a third-party platform, published in the period, must say it is written as part of the Kiroween 2026 hackathon | Optional. |
| Bonus: social | Post starting with `#KiroweenHackathon26`, favourite thing about Kiro and how it changed your approach, link in the form | Optional. |
| Bonus: Kiro Crew app | Separate GitHub repo for a Kiro Crew app, newly created in the period | Optional, after core work. |