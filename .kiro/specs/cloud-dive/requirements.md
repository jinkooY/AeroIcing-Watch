# Requirements - Cloud Dive

Active spec for the Kiroween 2026 submission (revision 2026-11-13: US routes,
fuel-cost score, decision-gate flow). Supersedes `../aeroicing-watch/`, which
stays as the completed baseline. Deadline: 2026-12-04 2:00 pm Pacific
(2026-12-05 07:00 KST). Section 5 is the decision log; section 6 is the
official rules digest. Where sections 1-4 and section 5 differ, section 5 wins
only for rows marked "Superseded".

## 1. Pitch

**Fly a real icing day and spend the least fuel.** The player flies a regional
jet along a real US route on a real day (GOES satellite clouds, ECMWF winds).
Cruise runs fast until a cloud is ahead; then the game stops and the player
decides: stay on course, move to another lane, climb or descend, and turn
anti-ice on or off. Every choice has a dollar price: longer path, climb, anti-ice
fuel, ice drag, or a forced diversion. The score is the total fuel cost in
dollars; lower wins.

The same evidence engine feeds the existing dispatcher cross-section view and
API (repository only, not the public site).

## 2. Personas

| Id | Persona | Goal | Surface |
|---|---|---|---|
| PU | Curious public, student pilot, flight-sim player | Go inside a real cloud and learn why icing decisions cost money | Cloud Dive game (public, static) |
| PD | Airline dispatcher | Review satellite and forecast evidence along a segment | Existing cross-section view and API (local) |

## 3. Glossary

- **Case**: a pre-computed, static snapshot of one US route at one date and
  hour, with provenance, the cube and the reference results.
- **Lane**: one of five parallel tracks, 15 km apart, at -30, -15, 0, +15 and +30 km
  from the great-circle route. The corridor is illustrative, not an airway.
- **Step**: 10 km along track. Samples, gates and costs use steps.
- **Altitude block**: the case's allowed altitude range (for example 6,000 to
  24,000 ft), in 1,000 ft levels. Illustrative, not an ATC assignment.
- **Cube**: for each lane, step and altitude level: evidence level, head-wind
  component, temperature; plus per lane and step the satellite cloud fields.
- **Evidence level**: exactly one of `Observed supercooled layer at planned
  altitude`, `Possible (forecast only)`, `Not indicated`, `Not assessed`.
- **Candidate layer**: the altitude band inside the cloud between the 0 C and
  -20 C heights, limited by the estimated base and the observed top.
- **Ice index**: an integer 0 to 100, a game state. It is not an airframe
  icing model and not a severity.
- **Anti-ice**: a switch the player turns on or off. While on it adds fuel
  flow and stops ice from building.
- **Gate**: an automatic pause in front of a cloud or after leaving one with
  anti-ice on. The player may also pause at any step.
- **References**: three costs for the same case, computed by the solver, shown
  only after play: Best, Straight-ahead, Wasteful extreme.

## 4. Requirements (EARS)

### R1 Eligibility and provenance

1.1 THE SUBMISSION SHALL include an English pre-existing work disclosure that
lists the origin (WeatherPath, Kiro, Claude, Codex) of every tracked file.
1.2 THE REPOSITORY SHALL include a third-party notice covering ECMWF Open Data
(CC BY 4.0), NOAA GOES-R (public), Iowa Environmental Mesonet PIREP data, Noh et
al. (2017) and OpenAP (LGPL-3.0, build-time only).
1.3 WHEN a screen shows satellite or forecast data, THE SYSTEM SHALL show the
source, the observation or run time in UTC, and the attribution line.
1.4 THE PUBLIC SITE SHALL contain only derived case files, never raw satellite
or forecast files, API keys or local paths.
1.5 THE PUBLIC SITE SHALL NOT load OpenAP; fuel tables are computed at build time.

### R2 Evidence rule v2

2.1 THE SYSTEM SHALL assign exactly one evidence level to every cube cell using
rule `cloud-dive-evidence-v2`.
2.2 WHEN the satellite retrieval state is not `observed` or `clear`, THE SYSTEM
SHALL treat the satellite evidence as missing and SHALL keep the reason code.
2.3 WHEN the sample is observed, the supercooled flag is true and the altitude
is inside the candidate layer, THE SYSTEM SHALL set `Observed supercooled layer
at planned altitude`.
2.4 WHEN the cell is not Observed and the ECMWF temperature is between -25 and 0 C
and the relative humidity is at least 85 percent, THE SYSTEM SHALL set
`Possible (forecast only)` and SHALL NOT label it observed.
2.5 WHEN satellite and forecast evidence are both missing for a cell, THE
SYSTEM SHALL set `Not assessed`, never `Not indicated`.
2.6 THE SYSTEM SHALL estimate the 0 C and -20 C heights from the ECMWF
temperature profile where available, otherwise from the cloud-top temperature
with a fixed lapse rate, and SHALL record which method was used.
2.7 THE SYSTEM SHALL echo the rule name, version and every threshold in each
case file.
2.8 THE EVIDENCE PATH SHALL use no language model, random number or network call.

### R3 Case export and the cube

3.1 THE EXPORTER SHALL build a case from GOES CONUS phase, cloud-top height,
optical depth and particle size at native resolution, and from an ECMWF IFS run,
along five lanes at 10 km steps.
3.2 THE EXPORTER SHALL apply parallax correction using the selected satellite's
sub-satellite longitude and SHALL NOT claim finer than one satellite pixel.
3.3 THE EXPORTER SHALL estimate the cloud base with the Noh et al. method from
optical depth and particle size, and SHALL keep a null base where the method
gives none.
3.4 Every exported case SHALL contain only finite numbers and SHALL pass the
`validProfile()` rules for its embedded centre-lane profile.
3.5 THE SITE SHALL ship at least three cases: 2026-11-12 JFK-BNA, 2026-11-01
DEN-LAX and 2026-11-07 BUF-PWM, each with its hour (daytime, solar zenith below
80 degrees along the route), satellite and IFS run.
3.6 WHEN a real case cannot be built by 2026-11-22, THE SITE SHALL use a case
labelled "Simulated" on every screen that shows it.

### R4 Cost model (dollars)

4.1 THE SYSTEM SHALL compute fuel cost in US dollars for every step from a fuel
flow table, the true airspeed at the altitude, the ECMWF head-wind component,
and the fuel price.
4.2 THE FUEL TABLES SHALL come from OpenAP for the E175 (E75L) at a fixed mass
and SHALL be stored in the case file with the aircraft, engine, mass and price.
4.3 THE SYSTEM SHALL charge a climb cost per 1,000 ft climbed, a lateral cost
per lane change (extra path length), and no credit for descending.
4.4 WHILE anti-ice is on, THE SYSTEM SHALL multiply fuel flow by the anti-ice
factor stored in the case file.
4.5 WHILE the ice index is above zero, THE SYSTEM SHALL lower the true airspeed and raise
fuel flow by factors that grow convexly with the index (ice drag), so that unprotected
flight in icing evidence is costly even before the index reaches 100.
4.6 THE SYSTEM SHALL show the cost as a running dollar total and as components:
cruise fuel, climb, detour, anti-ice, ice drag, diversion.
4.7 THE FUEL PRICE, ANTI-ICE FACTOR, DRAG FACTOR AND ICE RATES SHALL be labelled
illustrative and uncalibrated wherever shown.
4.8 EACH CASE FILE SHALL carry balance results from the solver, and THE EXPORTER SHALL
refuse a case that fails any of: B1 Best is at least 3 percent cheaper than Straight-ahead;
B2 Best with anti-ice never used is at least 3 percent costlier than Best, or does not
complete; B3 Best with anti-ice always on is at least 3 percent costlier than Best; B4 Best
uses anti-ice for at least 20 km on at least two of the three cases. Neither never using
anti-ice nor always using it can therefore win.

### R5 Ice state and failure

5.1 WHILE anti-ice is off and the aircraft is in a cell with evidence level
`Observed supercooled layer at planned altitude`, THE SYSTEM SHALL raise the ice
index by an integer amount per step that depends on the temperature band and
the cloud-water proxy.
5.2 WHILE the cell is `Possible (forecast only)` and anti-ice is off, THE SYSTEM
SHALL raise the index at a lower stored rate.
5.3 WHILE anti-ice is on, THE SYSTEM SHALL NOT raise the ice index.
5.4 THE ICE INDEX SHALL NOT decrease.
5.5 WHEN the ice index reaches 100, THE SYSTEM SHALL end the flight as a forced
diversion, add the diversion cost, and mark the result as not ranked.
5.6 THE REPORT of a diverted flight SHALL show the cost up to the diversion plus the
diversion cost, marked "not ranked".

### R6 Decision-gate flow

6.1 THE GAME SHALL advance the flight in fast-forward and SHALL pause at a gate.
6.2 THE GAME SHALL place a gate when a simulation of the next three steps
(30 km) with the current targets enters an `Observed` or `Possible` cell from a
cell that is neither, and at the first step outside such cells while anti-ice is on.
6.3 THE GAME SHALL let the player pause at any step.
6.4 FOR any sequence of player actions, THE GAME SHALL NOT enter an `Observed`
cell with anti-ice off unless a gate or a pause occurred at least one step earlier.
6.5 AT a gate, THE GAME SHALL show the cross-section ahead, the five lanes and
the ECMWF wind and icing background, and SHALL NOT show cost previews or a
recommended choice.

### R7 Player actions and limits

7.1 THE PLAYER SHALL set a target lane (five lanes), a target altitude (within
the altitude block) and the anti-ice switch.
7.2 THE AIRCRAFT SHALL move at most one lane and at most 1,000 ft per step toward
the targets.
7.3 THE AIRCRAFT SHALL stay inside the corridor and the altitude block.
7.4 THE PLAYER SHALL be able to play with keyboard, pointer and touch.

### R8 Report, references and local best

8.1 AT the end of a flight, THE GAME SHALL show total cost and components, the
ice-index peak, minutes with anti-ice on, and kilometres per evidence level
(their sum equals the distance flown).
8.2 AFTER the flight, THE GAME SHALL show the Best, Straight-ahead and Wasteful
extreme costs for the same case, computed by the solver, and the share of the
possible saving the player achieved.
8.3 THE "Straight-ahead" reference SHALL be the cost of staying on the centre
lane at the start altitude with anti-ice on only while in `Observed` or
`Possible` cells, labelled as a game baseline and not as a procedure.
8.4 THE GAME SHALL store the player's best result per case in the browser
only and SHALL NOT upload it.
8.5 THE GAME SHALL never rank airlines and SHALL NOT claim a public ranking.

### R9 Wording and guardrails

9.1 No user-facing text SHALL contain "no icing", "ice-free", "safe", "clear of
ice", "light", "moderate", "severe", "likely" or "unlikely" in reference to icing.
9.2 Absence of evidence SHALL be written "Not indicated"; missing data "Not assessed".
9.3 THE GAME SHALL state on every flight screen: "Game model. Not a flight
procedure, not an icing severity. Evidence from satellite cloud tops and an
ECMWF forecast."
9.4 THE SYSTEM SHALL NOT suggest an action to the player (R6.5, R8.2 are the
only places that show reference results, after play).
9.5 PIREPs SHALL be used only to choose and label cases and SHALL be shown as
reports, never as validation.

### R10 Accessibility, offline, static

10.1 Every evidence level and data kind SHALL be distinguishable in greyscale
by pattern and text label.
10.2 THE GAME SHALL be playable by keyboard alone.
10.3 THE SITE SHALL load and play from static files with no backend.
10.4 THE SITE SHALL remain available, free and without login, until 2027-01-29.

### R11 Dispatcher view and API (existing features)

11.1 THE SYSTEM SHALL keep `/api/icing/*`, the `validProfile()` contract and the
standalone viewer working.
11.2 THE DISPATCHER VIEW SHALL show evidence levels and kilometres per level instead of
the legacy risk badge and altitude suggestions (decision D1, replace).

### R12 Submission package

12.1 THE VIDEO SHALL be under 3 minutes, in English with AI voice narration,
public on YouTube, show the app running, and contain no third-party logo or music.
12.2 THE WRITE-UP SHALL answer each Kiro question in the rules (surfaces, custom
agents, hooks, specs, steering, MCP, property-based testing, powers) using only
entries in `docs/kiro-usage-log.md`.
12.3 THE WRITE-UP SHALL state which code came from Codex, Claude and WeatherPath.
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
| P4 | (Superseded by F1.) Two score types per case. |
| P5 | (Superseded by F1.) The ice build-up index stays as the hazard state; the score is fuel cost in dollars. |
| P6 | Video: recorded after the system is complete, English AI voice narration. |
| P7 | Student and startup bonuses do not apply. |
| P8 | All remaining coding is done in Kiro only. Code that came from other tools is labelled "Codex" or "Claude" in the disclosure. |
| P9 | The WeatherPath-derived code is re-inventoried in `docs/Preexisting_Work_Disclosure.md`. |
| P10 | The owner releases the copied and adapted WeatherPath code under Apache-2.0 (confirmed 2026-11-13). |
| P11 | Legacy components are marked in the README and the disclosure; nothing is deleted. Files are attributed to Kiro, Claude or Codex in the disclosure; files git cannot attribute are listed for the owner to resolve. |
| P12 | **D1 decided (2026-11-13): replace.** The dispatcher view shows evidence levels and kilometres per level instead of the risk badge and the altitude suggestions. The API fields stay for compatibility. |
| P13 | **Attribution decided (2026-11-13):** every file git cannot attribute was written by Claude (owner statement). LICENSE and the one-line README.md of the initial commit come from repository creation. |

### 5.2 Kiro judgements (owner may veto)

| Id | Judgement |
|---|---|
| J1 (D1, D2) | **Ice build-up index (game model; hazard state, no longer the score, see F1).** A transparent, deterministic, uncalibrated index in game units, computed per kilometre flown at the `Observed supercooled layer` level from: supercooled-layer membership (satellite), temperature band (ECMWF), and cloud water proxy (GOES cloud optical depth and particle size, daytime). It is labelled "Game model. Not a severity forecast." The words light, moderate, severe, likely and unlikely stay banned. The dispatcher view does not show the index. `science-guardrails.md` is amended to allow a labelled numeric game index and to forbid reuse of it as a risk label. Reason: the data has no liquid water content or droplet size at flight level, so a real severity cannot be supported. |
| J2 (GOES resolution) | Use native CONUS arrays, not the shared 500x620 grid (about 25-30 km per cell). Phase, cloud optical depth and particle size are 2 km (ACTPC, CODC, CPSC, verified on 2026-11-13). Cloud-top height is 10 km (ACHAC, 300x500). Lane spacing 15 km (5 lanes, plus or minus 30 km), along-track step 10 km. Height is shown at 10 km resolution and is labelled so. Parallax at 10 km cloud height is about 15 km at these latitudes (estimate), so the correction is tested. No claim finer than one satellite pixel. |
| J3 (D3) | (Superseded by F4.) Never rank airlines; reference scores are shown only after play. |
| J4 | Wording: "supercooled cloud-top observation", never "icing confirmed". PIREP icing reports are used to choose and label cases and are shown as reports, not as validation. |

### 5.3 Resolved on 2026-11-13

| Id | Outcome |
|---|---|
| W1 | **Approved.** Ice build-up index in game units (J1). `science-guardrails.md` is amended when it is imported. |
| W2 | **Excluded.** The Incheon-Haneda fuel comparison (`/route-demo/`), OpenAP, the fuel model, flight lookup and `route_review` leave the submission scope. They stay in git history and are marked legacy in the README. |
| W3 | **Done.** Results in 5.4. |

### 5.4 Case check results (W3)

Method: GOES-19 CONUS cloud-top phase (ACTPC, 2 km) sampled every 10 km along the great circle at five lanes (-30, -15, 0, 15, 30 km), hourly 14-21 UTC; icing PIREPs (IEM archive, FL080-FL300) within 100 km of the route and 2 h of the frame. This is a screening pass: no data-quality filter, no parallax correction, GOES-East only, PIREPs are reports and not validation.

| Case | Route | Hours (UTC) | Supercooled cloud top, any lane | Lanes disagree | PIREPs (median level) | Supercooled cloud-top height |
|---|---|---|---|---|---|---|
| A 2026-11-02 | KDEN-KSLC, 629 km | 15-20 | 43-67 percent | 27-38 percent | 9-26 (FL130-180) | 10.3-19.0 kft, median 11.9 kft (17Z) |
| B 2026-11-07 | KBOS-KDTW 1017 km (alt. KBOS-KCLE 905 km) | 14-16 | 86-93 percent | 51-64 percent | 10-17 (FL107-115) | 2.4-14.6 kft, median 6.2 kft (15Z) |
| C 2026-11-01 | KORD-KCLE, 508 km | 15 | 25 percent (centre lane 6 percent) | 25 percent | 13 (FL170) | about 21 kft, thin (optical depth about 5) |

Inputs at these hours: cloud-top height, optical depth and particle size are valid on 100 percent of the supercooled samples in A, B and C (daytime), so the Noh cloud-base method can run.

Consequences for the design:
1. **Altitude range is per case**, not 10,000-35,000 ft. Supercooled cloud tops sit below airline cruise level, so the game covers regional and climb or descent altitudes (A about 8-25 kft, B about 2-20 kft). The pitch says so.
2. **Terrain floor** is needed for A (Rocky Mountains). Source and limit are not yet checked.
3. **Case C is a low-exposure contrast case only.** A stronger third case needs a scan of Nov 3-6 and 9-11.
4. Lane spacing of 15 km is justified: lanes disagree on 27-64 percent of samples, so avoidance changes the score.
5. Whether GOES cloud-top height is above mean sea level or above ground is not verified and must be checked before the height is drawn against terrain.
### 5.5 Wider case scan (2026-11-01 to 11-12, 2026-11-13)

Same screening method as 5.4, extended to 53 US hubs (584 airport pairs of 450-1500 km), hourly 14-21 UTC, GOES-19 only, icing PIREPs at FL080-FL300 within 100 km and 2 h. PIREP counts depend on traffic and reporting, so they show where icing was reported, not how much ice formed.

**Worst days** (all CONUS icing PIREPs FL080-300 that day; MOD/SEV = reports with moderate or severe icing):

| Day | Icing PIREPs | MOD/SEV | Median level | Domain share of supercooled cloud tops (mean 14-21Z) |
|---|---|---|---|---|
| 2026-11-12 | 707 | 99 | FL120 | 8.6 percent |
| 2026-11-01 | 508 | 85 | FL190 | 5.9 percent |
| 2026-11-02 | 427 | 47 | FL180 | 3.9 percent |
| 2026-11-07 | 179 | 29 | FL130 | 6.0 percent |

Mildest in the period: Nov 3-4, 8-11 (no case chosen from them).

**Strongest routes** (best hour; cloud-top heights are for supercooled samples on the centre line):

| Case | Route | Hour (UTC) | Supercooled, any lane | Lanes differ | PIREPs / MOD+SEV | Cloud tops (p50 / max) |
|---|---|---|---|---|---|---|
| 11-12 | KJFK-KBNA, 1232 km | 19-20 | 69-75 percent | 42-50 percent | 26-39 / 5-9 | 12.2 / 13.5 kft |
| 11-01 | KDEN-KLAX, 1387 km | 21 (west route: re-check with GOES-18) | 43 percent | 40 percent | 30 / 10 | 14.8 / 21.5 kft |
| 11-07 | KBUF-KPWM, 688 km | 19 | 81 percent | 54 percent | 26 / 8 | 11.0 / 14.1 kft |
| 11-09 | KBOS-KBWI, 594 km | 18 | 90 percent | 68 percent | 12 / 3 | not measured |

Findings:
1. **11-12 is the worst day in the period** and the best candidate for the headline case. Use 19-20 UTC: at 21 UTC the sun is too low at the New York end (solar zenith 84 degrees, project limit 80), so cloud water retrievals may degrade there.
2. **Cloud tops stay at or below about 21 kft** in every strong case, so the pitch remains regional and climb or descent altitudes.
3. **11-01 reaches the highest tops** (21 kft) with less coverage: a good case for avoiding by climbing. The western route needs GOES-West; the scan used GOES-East.
4. All strong cases have cloud-top height, optical depth and particle size on 100 percent of the supercooled samples.
5. Caveats unchanged: no data-quality filter, no parallax correction, 11-12 is a partial and very recent day, PIREPs are reports and not validation.
### 5.6 Fuel-cost scoring F1 to F6 (approved 2026-11-13, F3 amended)

| Id | Proposal | Reason |
|---|---|---|
| F1 | The **score is fuel cost in dollars** (lower wins). The ice index becomes a hazard state that drives drag and forced diversion. | Removes the severity problem: no icing severity is claimed, and dollars are intuitive. Anti-ice fuel, detour, climb and ice drag all trade off in one unit. |
| F2 | Aircraft **E175 (OpenAP E75L)**, fixed mid-range mass, fuel price **0.79 USD/kg** (about 2.4 USD per US gallon, illustrative). Fuel tables are built offline. | E75L has a usable OpenAP fuel model and fits regional altitudes. This reopens the fuel model that W2 removed, but only as a build-time table for the game. The Incheon-Haneda demo stays retired. |
| F3 | **Decision-gate flow**: fast-forward, pause in front of a cloud, decide, continue. The player can also pause anywhere. | Matches the request, keeps the demo within 60-90 s, and makes the engine testable. |
| F4 | Three references (Best, Straight-ahead, Wasteful extreme) from an exact solver, shown after play; personal best stays in the browser. No online leaderboard. | The public site is static, so there is no server to rank people. The solver gives a fair "beat the worst, chase the best" scale. |
| F5 | **Forced diversion** at ice index 100 ends the flight and is not ranked. | Stops "never turn anti-ice on" from winning. |
| F6 | Cases: 2026-11-12 JFK-BNA (headline, 19-20 UTC), 2026-11-01 DEN-LAX (GOES-West checked: coverage and cloud tops match GOES-East), 2026-11-07 BUF-PWM. | From the case scans in 5.4 and 5.5. |

**Owner answer (2026-11-13):** F1, F2, F4, F5 and F6 approved. F3 approved with an amendment: both anti-ice choices carry a penalty. Anti-ice on costs fuel flow (bleed air) for as long as it is on, even in clear air. Anti-ice off in icing evidence builds ice, which lowers speed and raises fuel flow (drag) for the rest of the flight and ends the flight at 100 (F5). Balance criteria B1 to B4 (R4.8) make sure that never using anti-ice, or always using it, cannot win. F5 is designed together with F3.

Not verified: the real anti-ice fuel penalty (no source found; the anti-ice factor is a labelled game parameter); the text of 14 CFR 121.647 about icing fuel (seen only in a search snippet of the 2024 edition; do not quote it until read); OpenAP climb input units (ft/min assumed).
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