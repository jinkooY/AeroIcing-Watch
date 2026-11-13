# Requirements - Cloud Dive

Active spec for the Kiroween 2026 submission (revision 2026-11-13: US routes,
fuel-cost score, decision-gate flow). Supersedes `../aeroicing-watch/`, which
stays as the completed baseline. Deadline: 2026-12-04 2:00 pm Pacific
(2026-12-05 07:00 KST). Section 5 is the decision log; section 6 is the
official rules digest. Where sections 1-4 and section 5 differ, section 5 wins
only for rows marked "Superseded". Revision b (3D cockpit game): decision G1 in
section 5.7, requirements R15 to R21.

## 1. Pitch

**Fly a real icing day and spend the least fuel.** The player flies a regional
jet along a real US route on a real day (GOES satellite clouds, ECMWF winds).
Cruise runs fast until a cloud is ahead; then the game stops and the player
decides: stay on course, move to another lane, climb or descend, and turn
anti-ice on or off. Every choice has a dollar price: longer path, climb, anti-ice
fuel, ice drag, or a forced diversion. The score is the total fuel cost in
dollars; lower wins.

From revision b the game is played in 3D from a regional-jet cockpit: the player
takes off, climbs to the case's cruise level, and flies the route in first person.
In front of each cloud the game pauses and the player chooses: fly through, climb
over, descend, go left or right, and anti-ice on or off. It is casual and readable,
not a flight simulator. The 3D view is a new renderer over the same case and the
same engine state; the 2D screens stay as the fallback and as an inset at gates.

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
- **Map view**: the top-down view of the flight: an overview of the whole route and a
  follow view around the aircraft, over the case's satellite image and state lines.
- **Side view**: the cross-section (altitude against distance) of the selected lane.
- **Cruise level**: the game's name for the case start altitude, inside the altitude
  block. It is below airline cruise level and is not an ATC assignment.
- **Departure climb**: the automatic, unscored climb from the departure runway to the
  cruise level. Same illustrative cost for every player; outside the engine.
- **Flight phase**: one of ready, takeoff, climb, cruise, gate, arrival, diversion, report.
- **Cockpit view**: the 3D first-person view (WebGL). **2D view**: the map view and side
  view of R13 and R14.
- **Scene description**: plain data built by a pure function from the case, the engine
  state and the phase; the WebGL layer only draws it.

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
2.4 WHEN the satellite state is not `clear`, the cell is not Observed, the altitude is not
above an observed cloud top, and the ECMWF temperature is between -25 and 0 C and the
relative humidity is at least 85 percent, THE SYSTEM SHALL set `Possible (forecast only)` and
SHALL NOT label it observed.
2.5 WHEN satellite and forecast evidence are both missing for a cell, THE
SYSTEM SHALL set `Not assessed`, never `Not indicated`.
2.6 THE SYSTEM SHALL estimate the 0 C and -20 C heights from the ECMWF
temperature profile where available, otherwise from the cloud-top temperature
with a fixed lapse rate, and SHALL record which method was used.
2.7 THE SYSTEM SHALL echo the rule name, version and every threshold in each
case file.
2.8 THE EVIDENCE PATH SHALL use no language model, random number or network call.
2.9 WHEN the satellite state is `clear`, or an observed cloud top is below the altitude, THE
SYSTEM SHALL set `Not indicated` whatever the forecast says.

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
cruise fuel, climb, detour, anti-ice, ice drag, diversion and, when the departure
phase is on (R15), departure climb.
4.7 THE FUEL PRICE, ANTI-ICE FACTOR, DRAG FACTOR, ICE RATES AND DIVERSION COST SHALL be labelled
illustrative and uncalibrated wherever shown.
4.8 EACH CASE FILE SHALL carry balance results from the solver, and THE EXPORTER SHALL
refuse a case that fails any of: B1 Best is at least 3 percent cheaper than Straight-ahead;
B2 Best with anti-ice never used is at least 3 percent costlier than Best, or does not
complete; B3 Best with anti-ice always on is at least 3 percent costlier than Best; B4 Best
uses anti-ice for at least 20 km on at least two of the three cases. Neither never using
anti-ice nor always using it can therefore win; B5 the diversion cost is higher than the
Straight-ahead cost of the case, so a diverted flight always costs more than Straight-ahead.

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
6.2 THE GAME SHALL place a gate at a step boundary when any of these holds:
(a) entry: a simulation of the next three steps (30 km) with the current targets
enters an `Observed` or `Possible` cell from a cell that is neither;
(b) exit: anti-ice is on, the cell just flown was `Observed` or `Possible`, and a
simulation of the next five steps (50 km) with the current targets contains no such cell;
(c) ice: the ice index is 50 or more for the first time in the flight.
6.3 THE GAME SHALL let the player pause at any step.
6.4 FOR any sequence of player actions, THE GAME SHALL NOT enter an `Observed`
cell with anti-ice off unless a gate or a pause occurred at least one step earlier.
6.5 AT a gate, THE GAME SHALL show the cross-section ahead, the five lanes and
the ECMWF wind and icing background, and SHALL NOT show cost previews or a
recommended choice.
6.6 WHILE anti-ice is on, THE GAME SHALL NOT place an entry gate when an `Observed` or
`Possible` cell was flown in the previous five segments (a gap under 50 km is the same
cloud). An entry gate that is skipped this way SHALL NOT count as announced.
6.7 WHEN several gate reasons hold at one boundary, THE GAME SHALL place one gate that
names each reason.

### R7 Player actions and limits

7.1 THE PLAYER SHALL set a target lane (five lanes), a target altitude (within
the altitude block) and the anti-ice switch.
7.2 THE AIRCRAFT SHALL move at most one lane and at most 1,000 ft per step toward
the targets.
7.3 THE AIRCRAFT SHALL stay inside the corridor and the altitude block.
7.4 THE PLAYER SHALL be able to play with keyboard, pointer and touch.

### R8 Report, references and local best

8.1 AT the end of a flight, THE GAME SHALL show total cost and components (including
the departure climb, R15.5), the ice-index peak, minutes with anti-ice on, and
kilometres per evidence level (their sum equals the distance flown).
8.2 AFTER the flight, THE GAME SHALL show the Best, Straight-ahead and Wasteful
extreme costs for the same case, computed by the solver, and the share of the
possible saving the player achieved, measured from Straight-ahead (0 percent) to Best
(100 percent): (Straight-ahead - player) / (Straight-ahead - Best) x 100, at most 100,
negative (not clamped) when the player's cost is above Straight-ahead, and shown only for
ranked flights.
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
### R13 Map view

13.1 EVERY 2D flight screen SHALL show the map view and the side view together (the cockpit
view meets this through R16.5 and R17.5). The map shows
the aircraft at its current lane and step, the route, the five lanes, the flown track,
the airports, and state and coast lines.
13.2 THE MAP SHALL have a follow view centred on the aircraft, about 200 km across and
north-up, in which the lanes are drawn at true spacing, and an overview of the whole route
as an inset in the follow view.
13.3 THE MAP SHALL show the case's GOES satellite image as background. It SHALL be
labelled "Satellite image for context" with satellite, product and scan time (UTC), and
drawn without smoothing so that one satellite pixel stays visible as one pixel.
13.4 THE MAP SHALL state that the image is the single scan of the case (the weather
does not change during the flight). It SHALL also state that the image is not
parallax-corrected while the lane evidence is, with the largest parallax shift of the
case in kilometres.
13.5 IN the follow view, THE MAP SHALL draw the evidence level of each lane cell ahead
at the aircraft's current altitude, with the same patterns and labels as the side view,
including `Not assessed`.
13.6 THE MAP SHALL mark the lane shown in the side view, and THE SIDE VIEW SHALL mark
the aircraft's current distance with a vertical line.
13.7 WHEN the image or the basemap is missing, THE MAP SHALL still draw the lanes, the
aircraft and the evidence, and SHALL say "Satellite image not available".
13.8 THE MAP SHALL NOT load map tiles or any network resource. The image and the basemap
are static files of the site.
13.9 THE MAP SHALL have a text alternative: lane, distance, altitude and the evidence
levels of the next three cells.
13.10 DURING fast-forward, THE MAP SHALL move the aircraft smoothly between steps. This
is display only; the engine state changes per step as before.

### R14 One-screen layout

14.1 WHILE a flight is shown in a viewport of at least 1280 x 720 CSS pixels, THE FLIGHT
SCREEN (2D view or cockpit view) SHALL fit the viewport without page scrolling. The screen holds the HUD, the map
view, the side view, the gate panel, the controls and the game note (R9.3).
14.2 THE FOUR evidence-level patterns with their text labels and the R13.3 image label
SHALL stay visible on the flight screen. The full legend SHALL open from a "Legend"
button and the key L.
14.3 THE END-OF-FLIGHT REPORT SHALL open as a dialog over the flight screen when the
flight ends. THE "Why?" cards and the data sources SHALL open as dialogs from buttons.
A one-line source attribution SHALL stay visible.
14.4 Dialogs SHALL move focus in, close with Escape and a close button, and return focus
to the control that opened them.
14.5 Canvases SHALL be drawn at their displayed size times the device pixel ratio.
Canvas text SHALL be at least 11 CSS pixels.
14.6 Below 1280 CSS pixels of width, or in portrait orientation, THE LAYOUT MAY stack
and scroll, and every element of 14.1 SHALL stay reachable.

### R15 Flight phases

15.1 WHEN a case is opened in the cockpit view, THE GAME SHALL show the cockpit on the
runway of the departure airport and SHALL start the takeoff on one button press or key
press.
15.2 THE TAKEOFF ROLL AND LIFT-OFF SHALL take about 5 s.
15.3 AFTER lift-off, THE GAME SHALL climb the aircraft on the centre lane to the case
start altitude in about 10 to 15 s of accelerated time, without player input, along a
lead-in of `LEAD_IN_KM` kilometres (15.14).
15.4 THE GAME SHALL call the start altitude "cruise level" and SHALL say in the "Why?"
cards that it is the game's altitude block, below airline cruise level.
15.5 THE DEPARTURE CLIMB SHALL cost the same illustrative amount (case parameter
`departureClimbUsd`) for every player and every flight, SHALL appear as its own cost
component "Departure climb" in the running total and in the report, and SHALL be labelled
illustrative (R4.7). THE SOLVER REFERENCES (Best, Straight-ahead, Wasteful extreme) SHALL
include the same constant, so they stay comparable with the player's total.
15.6 THE ENGINE SHALL NOT step during takeoff and climb, and the ice index SHALL stay 0.
WHILE the aircraft is below the altitude block, THE PANEL SHALL read "Not assessed (below
the game's altitude block)"; WHILE it climbs inside the block, it SHALL read "Not assessed
(departure climb)".
15.7 WHEN the climb ends, THE GAME SHALL start the engine at step 0 with its existing
initial state (centre lane, start altitude).
15.8 WHILE cruising, THE GAME SHALL fast-forward as in R6.1. WHEN a gate is reached, THE
CAMERA SHALL slow to a stop with the cloud ahead in view within 1.5 s.
15.9 WHERE the arrival cinematic is built (cuttable, G2), WHEN the engine reports arrival,
THE GAME SHALL play an automatic, unscored descent and landing cinematic of about 10 s,
then open the report (R14.3). Without it, the report opens at arrival.
15.10 WHERE the arrival cinematic is built, WHEN the flight ends in a diversion, THE GAME
SHALL play a turn-away cinematic of about 4 s, then open the report, marked "not ranked"
(R5.6). Without it, the report opens at the diversion.
15.11 THE PLAYER SHALL be able to skip a cinematic with a button or Space. Skipping SHALL
NOT change any value.
15.12 WHERE the browser asks for reduced motion, THE GAME SHALL shorten each cinematic to
at most 2 s and SHALL NOT shake the view.
15.13 THE PHASES AND THE CINEMATICS SHALL NOT change the case or the engine state, except
that the engine starts at step 0 (15.7).
15.14 THE RUNWAY SHALL be at x = -`LEAD_IN_KM` km on the track and the case route starts at
x = 0, which the game marks "Top of climb". The lead-in is a display convention: the case
route length and the engine distance are unchanged, and the departure airport is drawn L km
before the route start. The "Why?" text SHALL say so.
15.15 DURING takeoff and climb, THE VIEW SHALL draw no evidence and SHALL fade the clouds out,
and SHALL fade them in during the last 1.5 s of the climb, so the aircraft never appears to
fly through evidence without the engine running (and so without frost). No cloud volume
SHALL start before x = 0, and the camera SHALL stay at x <= 0 until the climb ends.

### R16 Cockpit view

16.1 THE COCKPIT VIEW SHALL show a first-person camera from a generic regional-jet
cockpit: a stylised windshield frame and a simple low-poly panel. It SHALL NOT show a real
manufacturer cockpit, logo, livery or registration.
16.2 THE PANEL SHALL show, large: the dollar fuel counter, the ice gauge (0 to 100,
labelled "Ice index (game model)"), the anti-ice switch with a lamp, an altitude tape and
a small top-view map with the five lanes. Everything else SHALL be in one small text line.
16.3 Every instrument value SHALL come from the engine state. The fuel counter MAY be
interpolated between steps for display only (R13.10).
16.4 OUTSIDE, THE VIEW SHALL show a stylised sky, a flat stylised ground, the five lanes as
faint guide lines or "sky gates" ahead, and markers for the departure and arrival airports.
The ground SHALL be flat at the airport elevation; no terrain data is used. THE GAME SHALL
state this limit in a "Why?" card (for example, the Rocky Mountains on the Denver case are
not drawn).
16.5 THE PANEL MAP SHALL show the five lanes, the aircraft, the flown track and the
evidence level of the cells ahead at the current altitude with the patterns and labels of
R13.5. The satellite image of R13.3 stays in the 2D view, which opens with a "2D view"
button and the key V.
16.6 CLOUDS SHALL be stylised soft volumes from the satellite cloud top down to the
estimated base, by lane and step. The base SHALL be faded and labelled "estimated". THE
VIEW SHALL draw no cloud where the satellite reports clear, and SHALL NOT draw internal
structure that is not in the data (no noise textures, no random variation).
16.7 EVIDENCE INSIDE the view SHALL be drawn as: `Observed` cells glow orange; `Possible`
cells are a faint blue haze; `Not indicated` draws nothing; `Not assessed` is a sparse grey
hatch.
16.8 THE PANEL SHALL keep a text label for each of the four levels (a legend strip with the
exact level names, and the level of the cell here and the cell ahead in the text line), so
that play works in greyscale (R10.1). The four drawings SHALL also differ by pattern, not
by hue alone.
16.9 WHERE wind streaks are built (cuttable, G2), WIND SHALL be shown as at most 12 streaks
and a head-wind number in knots, not as a barb per cell. The head-wind number stays in the
text line in any case.
16.12 THE VIEW SHALL use two display scales, a vertical exaggeration and a lateral
compression of lane spacing (design 14.2). They are display only and SHALL be explained in
the display-scale "Why?" text. The engine uses true distances.
16.10 EVERY cockpit screen, including during cinematics, SHALL show the game note (R9.3) and
a one-line source attribution with the observation or run time in UTC (R1.3).
16.11 WHERE the chase view is built (cuttable, G2), THE KEY C SHALL toggle an outside chase camera behind a
generic aircraft model (no livery). Instruments and gate controls SHALL stay usable.

### R17 Gate choices in the cockpit view

17.1 AT a gate, THE GAME SHALL show the cloud ahead, the lanes and the gate reasons (R6.7),
and these controls on the panel: "Fly through", "Climb over", "Descend", "Go left",
"Go right", the anti-ice switch and "Continue".
17.2 THE CONTROLS SHALL map to the existing actions of R7: "Fly through" sets the targets to
the current lane and altitude; each press of "Climb over" or "Descend" moves the target
altitude by 1,000 ft within the altitude block; each press of "Go left" or "Go right" moves
the target lane by one lane (left is toward the lower lane index) within the corridor. The
aircraft follows R7.2.
17.3 THE GATE SHALL NOT show a cost preview or a recommended choice (R6.5, R9.4). Button
labels and all text SHALL follow R9.1 (for example "lamp", not a banned word).
17.4 KEYBOARD: arrow left and right set the lane, arrow up and down set the altitude, A
toggles anti-ice, Space continues or pauses. Pointer and touch buttons of at least 44 x 44
CSS pixels do the same (R7.4, R10.2).
17.5 AT a gate, THE COCKPIT VIEW SHALL show the 2D side view of the selected lane as a small
inset, so the cross-section ahead of R6.5 stays visible.
17.6 THE PLAYER SHALL be able to pause at any step (R6.3) with Space or a Pause button.

### R18 Feedback in the cockpit view

18.1 WHILE the ice index is above 0, THE WINDSHIELD EDGES SHALL show frost in proportion to
the ice index. The index grows only with anti-ice off in `Observed` or `Possible` cells
(R5.1, R5.2) and never decreases (R5.4), so frost never recedes.
18.2 WHERE shake is built (cuttable, G2), WHILE anti-ice is off and the cell flown is
`Observed` or `Possible` and the ice index is above 0, THE VIEW SHALL shake slightly, with an amplitude that grows with the ice index
and a fixed upper limit.
18.3 WHILE anti-ice is on, THE WING-HEAT LAMP SHALL glow and THE FUEL COUNTER SHALL run
faster, because it follows the real per-step cost of the engine (R4.4). No other number
is shown.
18.4 THE EFFECTS SHALL only draw the engine state. They SHALL NOT change it, carry a severity
word, or be called a severity (R9.1, J1).
18.5 WHERE the cost pop-up is built (optional), WHEN the flight stops at a gate, a pause or
the end, or after a single step, THE PANEL SHALL show "+$N this segment" for a few seconds,
where N is the cost actually incurred since the previous stop (sum of the component changes).
It is shown only after the cost is incurred, never before a choice, so R6.5 holds.

### R19 Fallback, performance and static site

19.1 WHEN WebGL is unavailable or the 3D library fails to load, THE GAME SHALL open the 2D
view with a notice, play the same flight with the same costs, and show the departure climb
as a status card with its cost.
19.2 THE 2D view SHALL be available at any time (key V).
19.3 THE COCKPIT VIEW SHALL target 60 frames per second on a laptop and 30 on a phone, and
SHALL cap its geometry per lane and step (design 14.9). Measured frame rates SHALL be
recorded, not assumed.
19.4 THE 3D library SHALL be vendored in `static/cloud-dive/vendor/` at an exact version. All
models and textures SHALL be self-made or CC0, each recorded in `THIRD_PARTY_NOTICES.md`.
THE SITE SHALL load no tile service, CDN or third-party logo (R10.3, R13.8).
19.5 THE SCENE SHALL be built by a pure function from (case, engine state, phase) to a scene
description, tested in Node. THE WEBGL LAYER SHALL only draw that description and SHALL NOT
read or change the case or the engine state.
19.6 NEW CASE FIELDS SHALL be additive (`params.departureClimbUsd`, `airports`); evidence,
references, balance and the viewer profile SHALL NOT change. Airport elevations SHALL come
from `elev_ft` in the repository's `airports.json`, and their source SHALL be recorded in
`THIRD_PARTY_NOTICES.md` after it is checked.

### R20 Local multiplayer (hot-seat)

20.1 THE GAME SHALL let 2 to 4 players take turns on the same case on one device; each
player flies a full flight.
20.2 AFTER the last flight, THE GAME SHALL show a results table with each player's total
cost (including the departure climb) beside Best and Straight-ahead. A diverted flight is
shown as "not ranked".
20.3 NOTHING SHALL be uploaded and no online ranking SHALL exist (R8.4, R8.5). The table
stays in memory for the session.
20.4 A player SHALL see the references only after their own flight (R8.2).

### R21 Playtest fixes (status: implemented in tasks 10.1 to 10.5; re-verified in task 13.1)

21.1 THE 2D renderer SHALL read satellite arrays in both stored shapes, and SHALL draw the
"Not assessed" curtain only for steps whose retrieval is neither observed nor clear
(CD-P20).
21.2 THE REPORT SHALL measure the saving share from Straight-ahead (0 percent) to Best
(100 percent), negative when the player is costlier than Straight-ahead (R8.2).
21.3 `diversionUsd` SHALL be non-zero and illustrative, set with `tools/tune_params.py`,
with B1 to B5 passing (R4.8).
21.4 GATES SHALL merge when exit and entry are close together (R6.6, R6.7, CD-P14, CD-P18);
the always-on anti-ice run of KJFK-KBNA SHALL have fewer gates than the 17 seen in the
playtest.
21.5 THE GAME SHALL place a gate when the ice index first passes 50 (R6.2c, CD-P19), with
the text "Ice index (game model) reached 50 of 100".

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
### 5.7 3D cockpit game (revision b, 2026-11-13)

| Id | Decision |
|---|---|
| G1 | **Owner: evolve Cloud Dive into a casual 3D cockpit game** (R15 to R20). Reason: the 2D cross-section did not communicate the idea to players in playtests; the case cube is already 3D (lane, step, altitude), so a 3D view shows the same data. The 3D view is a new renderer over the same case and engine state. The engine rules, cost model, solver, references, balance B1 to B5 and CD-P1 to CD-P22 stay unchanged. Evidence rule v2, the science guardrails and the R9 wording stay unchanged. |
| G2 | **Owner: order of work and cuts (amended 2026-11-13).** Order: (a) fixes 13, (b) scene description 14, (c) cockpit cruise view with gates 15, (d) feedback 16, then departure and climb 17, hot-seat 18, chase view 19, documentation 20. **Required:** everything in 13 to 16 except 16.2, 16.4 and 16.7, and 17.1 to 17.4, 17.6 to 17.8 (departure constant, `phases.js`, runway, automatic climb, skip, fallback card) and 18. **Cuttable before 2026-12-04:** 17.5 (arrival and diversion cinematics), 16.2 (shake), 16.4 (wind streaks) and 19 (chase view). **Optional, after 16:** 16.7 (cost pop-up). Frost (16.1) and the wing-heat lamp (16.3) are required and come before 17. Cut order, first to go: 19, 16.4, 16.2, 17.5, 16.7. Build order: required work first (13, 14, 15, 16.1, 16.3, 16.5, 16.6, 17 without 17.5, 18), then 16.2, 16.4, 17.5, 16.7, then 19, then 20. Each group ends in a shippable state. |
| G3 | **Playtest fixes already exist.** The five fixes of R21 were implemented in tasks 10.1 to 10.5 (commit f1b382f). The owner confirmed (2026-11-13) that the playtest was on a build from before group 10, which explains the numbers (17 gates, `diversionUsd` 0, `column()` shape). Group 13 re-verifies on the current build and adds a test only where a gap is found. Gate count of KJFK-KBNA always-on is 10 now. |
| G4 | Kiro judgement (owner may veto): the departure climb is a constant added outside the engine. Balance criteria B1 to B5 stay on engine totals, because adding the same constant to both sides would shrink the 3 percent margins. The saving share of R8.2 is unchanged by the constant. Local best moves to a new storage key (`v2`); old entries are ignored. |
| G5 | **Climb geometry (owner, 2026-11-13).** The runway is at x = -L km (`LEAD_IN_KM`, the lead-in length of the climb) and x = 0 is marked "Top of climb", where the engine starts at step 0. During takeoff and climb the evidence is not drawn and clouds fade out, then fade in during the last 1.5 s of the climb, so the player never appears to fly through evidence without frost. The lead-in is a display convention; route length and engine distance are unchanged and the Why text says so (R15.14, R15.15). |
| G6 | Kiro judgement: instruments, buttons and labels are an HTML overlay on the WebGL canvas, not 3D textures, so text, focus and touch work and greyscale labels stay real text. |
| G7 | Kiro judgement: UI text says "lamp", never "light"; the wording test skips `static/cloud-dive/vendor/` (third-party code, not user-facing text) and scans scene strings instead. |
| G8 | Kiro judgement: the label "Not assessed (below the game's altitude block)" is kept for altitudes below the block; inside the block during the climb the label is "Not assessed (departure climb)", because the cube has data there but the engine does not run. |
| G9 | **Owner approved (2026-11-13):** feature freeze 2026-11-28 so the video (P6) is recorded on a finished build; Space or a Skip button skips cinematics; the local best uses a new storage key (`v2`) and old entries are ignored. |
| G10 | Terrain is not modelled. Open item from 5.4 (terrain floor, height reference above sea level or ground) stays open; the 3D view draws flat ground and says so (R16.4). For KDEN-KLAX the flat-ground "Why?" card stays and the altitude block is not changed now (see G11). |
| G11 | **Owner: the video uses KJFK-KBNA** (2026-11-12, headline case). KDEN-KLAX keeps the flat-ground card and no block change now. |
| G12 | **Owner: airport elevations come from `elev_ft` in the repository's `airports.json`** (generated by `tools/build_airports.py` from the OurAirports CSV). The source and licence are checked and recorded in `THIRD_PARTY_NOTICES.md` in task 17.1. Values in the file: KJFK 13, KBNA 599, KDEN 5431, KLAX 125, KBUF 728, KPWM 76 ft. |
| G13 | **Owner: lateral display compression.** A display constant `LATK` scales lane spacing in the cockpit view (as the 2D map widens its lanes), tuned in task 15.2 together with the vertical exaggeration `VEX` (down to 0.2 if the side lanes are not readable from the cockpit), and explained in the display-scale "Why?" text (R16.12). |
| G14 | **Owner: optional cost pop-up.** After 16, a short "+$N this segment" pop-up shows the actual cost since the previous stop. It is shown after the cost is incurred, never as a preview (R18.5, R6.5). |

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