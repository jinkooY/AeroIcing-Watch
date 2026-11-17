# Cloud Dive video - storyboard (screens first, voice later)

Narration lines: `docs/video/script.json` (Korean review copy: `script-ko.md`). Voice is not recorded yet; the
times below come from the dry-run estimate (about 2:43 plus about 7 s for line r2, so about 2:50). They move
when the real voice clips exist; keep the shot order and re-time the cuts.

Replaces `shot-list.md`. All gate positions, costs and gate counts below are computed by
`node tools/video/gate_plan.mjs`, which uses only `static/cloud-dive/engine.js` and the case file. Re-run it before
recording, and again if the case file or the parameters change.

## 1. What the case really contains (KJFK-KBNA, 2026-11-12 19:30 UTC)

Read from `static/cloud-dive/cases/20261112-kjfk-kbna-1930z.json`.

- Route 1,232 km, 5 lanes (-30, -15, 0, +15, +30 km), 125 steps of 10 km, 7 altitude levels (6,000 to 12,000 ft). That is
  4,375 evidence cells in a 124 KB file. The game starts on lane 3 at 9,000 ft.
- Gate 1 is at 0 km and shows **Possible (forecast only)** on all five lanes (`docs/screens/21.10-gate.png`).
- Observed cells on the centre lane at 12,000 ft (km): 30, 390, 520 to 590, 690 to 720, 820 and 830, 930 to 960, 1020,
  1070 and 1080, 1140. The cell at 30 km is a single Observed cell inside the first block of Possible cells (0 to
  130 km). The game does not stop there (no entry gate inside a block that is already icing), so in the cockpit the
  orange box at 30 km is flown through without a pause. It is visible in the gate 1 mini-map and side view.
- Between about 130 and 380 km the cruise level is Not indicated.
- Reference flights as the report shows them (departure climb $88.48 added, rounded to whole dollars):

| Reference | Calculation | Report value |
|---|---|---|
| Best | 3,185.99 + 88.48 | **$3,274** |
| Straight-ahead | 3,413.68 + 88.48 | **$3,502** |
| Wasteful extreme | 13,444.61 + 88.48 | **$13,533** |
| Climb to 12,000 ft, anti-ice always on | 3,352.40 + 88.48 | $3,441 |
| No anti-ice (low, lane 1) | 3,473.68 + 88.48 | $3,562 |

  Best beats Straight-ahead by $228 (about 6.5 percent). The gap is small; do not oversell it.
  The message is "the right choice at each gate", not a large saving.
- What Best does: climb to 12,000 ft in the first 20 km, stay on lane 3, use anti-ice only in front of Possible or
  Observed cells (400 km in total, 41 minutes). No detour.

## 2. Takes to record (8 clips)

Recording setup: Edge or Chrome, window 1920x1080, browser zoom 110 to 125 percent so the HUD is readable on a phone,
cockpit view, OBS 60 fps. Keep the bottom game note and the source line in frame. Hide the bookmarks bar.
Start the game with `python -m http.server 8080 --directory static/cloud-dive` and open `index.html?case=20261112-kjfk-kbna-1930z`.
Record after the feature freeze (2026-11-28), on the final build.

| Take | What to do | Length to record | Used for |
|---|---|---|---|
| T1 Start | Case list, hover KJFK-KBNA, open it. Ready screen ("Ready on the runway at KJFK"), then map view (V) and back | 20 s | Problem scene |
| T2 Demo flight | One clean run, section 3, from "Start takeoff" to the report | the whole flight | Main scene, report |
| T3 Failure | Fly through with anti-ice off and press Continue at every gate. The game stops at the ice gate (ice index 50, about 150 km). **Stop the take there.** Frost, shake and the dollar counter jump are all visible by then | 30 s | Hook, line g5 |
| T4 Satellite | At the Observed gate (about 500 km) press V (2D view): side view with the orange Observed patches. Press M on the map to switch the satellite image | 20 s | Evidence scene |
| T5 Report | Report dialog: headline, three references, component table, scroll slowly | 30 s | Report scene |
| T6 Diagram | The data-flow graphic (section 5), exported as a still and a build-up animation | n/a | Real-data scene |
| T7 Kiro | Kiro IDE screens (section 6) | 60 s | Kiro scene |
| T8 Close | README section "Cloud Dive (the Kiroween 2026 entry)", its "Limits:" list (about line 240), the game note, the end card | 20 s | Close |

T3 detail (computed): with anti-ice off the ice gate comes at 150 km with total cost $526. If you press Continue anyway,
the ice index keeps rising (gates at 190, 330 and 370 km) and the flight diverts at about 440 km (total $6,649, not ranked).
The default take stops at the ice gate. A diversion is a possible second clip but needs its own line in the script.

## 3. Demo flight (T2): the line to fly

Computed with `gate_plan.mjs`: climb to 12,000 ft and anti-ice on at gate 1, then anti-ice on at every entry gate and off
at every exit gate, lane never changed. **16 gates**, arrival at 1,240 km on the grid, total **$3,312**, ice index 0 all the
way. That is $38 above Best ($3,274) and $190 below Straight-ahead ($3,502). Game flight time 127 minutes, anti-ice 61 minutes.
The real-time length of the take is not computed; measure it in rehearsal.

| Gate | km | Reason | Cell under the aircraft | Next three cells | Cost at the gate | Action |
|---|---|---|---|---|---|---|
| 1 | 0 | entry | (start) | Possible, Possible, Possible | $88 | ArrowUp x3 (9,000 to 12,000 ft), A (anti-ice on), Continue |
| 2 | 130 | exit | Possible | Not indicated x3 | $466 | A (anti-ice off), Continue |
| 3 | 360 | entry | Not indicated | Not indicated, Not indicated, Possible | $1,045 | A (on), Continue |
| 4 | 440 | exit | Possible | Not indicated x3 | $1,263 | A (off), Continue |
| 5 | 500 | entry | Not indicated | Not indicated, Not indicated, **Observed** | $1,412 | The Observed gate for the video: hold, press V, V, then A (on), Continue |
| 6 to 16 | 600 to 1,150 | exit and entry in pairs | Observed or Not indicated | | $1,683 to $3,107 | Same pattern. Montage with a speed ramp |

Notes for the recording:

- Gate 1: the mini-map and side view show an orange cell at 30 km that is not a gate. Do not zoom on the mini-map while
  line n1 is spoken (n1 says the forecast flags possible ice; the orange cell is observed).
- Gate 5 at 500 km is the first gate with an Observed cell ahead (at 520 km). Use it for lines n3, g3 and n4.
  The gate at 360 km is a Possible gate, so it goes into the montage.
- Pressing Climb over three times adds no extra gate (the engine only gates on entry, exit and the ice index).
- Press Go left and then Fly through at gate 5 to show the choice, and cancel before Continue so no detour is charged.
- Targets for a good take: total within about $50 of Best ($3,274), ice index 0, Detour $0. If the take ends above
  Straight-ahead ($3,502), record again, because line r2 says how far above Best you finished. The demo plan gives
  about $38 above Best, so r2 will probably read "thirty-eight dollars"; confirm with the recorded report.

## 4. Scene by scene (what the viewer sees)

| Time (est.) | Line ids | Picture | On-screen text (own graphics, no logos) | Edit |
|---|---|---|---|---|
| 0:00-0:11 | h1 h2 | T3 frost footage in the cockpit: windshield frost, shake, the dollar counter jumping. At 0:06 cut to the cockpit cruising | 0:01 "12 Nov 2026, 19:30 UTC", at 0:07 "Cloud Dive" | Slow push-in. No title card first |
| 0:11-0:23 | p1 p2 | T1: case list, then the ready screen, then the map with the satellite image and the route line (the map view opens only in flight, so p2 uses our route graphic `route-anim.mp4` from the case data) | Chips: "JFK to Nashville", "1,232 km", "5 lanes", "real satellite and forecast" | Keep the HUD chips visible. 2 s on the map |
| 0:23-0:30 | g1 | T2 step 1: click Start takeoff, skip, cut to the gate 1 stop | "GATE" tag appears on the stop | Speed ramp for the skip. Dim the background 30 percent at the stop |
| 0:31-0:39 | n1 | Gate 1: the five "Possible (forecast only)" tiles. Zoom to the label tiles only | Underline the words "Possible (forecast only)" | Two cuts, not one 8 s hold. No zoom on the mini-map (section 3 notes) |
| 0:40-0:43 | g4 | The button row: Fly through, Climb over, Descend, Go left, Go right, Anti-ice, Continue | Highlight frame around the button row | 3 s |
| 0:43-0:48 | n2 | T2 gate 1 action: Altitude chip 9,000 to 12,000, Anti-ice chip Off to On | none | Zoom on the HUD chips. Show the number before and after |
| 0:49-0:59 | n3 | 1 s speed ramp through gates 2 to 4 (game). Then the Blender shots: A, over the cloud tops at 12,000 ft (440 to 466 km, 3 s trimmed from 6 s), cut to B, into the deck at 468 to 486 km (5 s, ends in white cloud). White-out cut back to the game stopped at gate 5 (500 km), orange hatch tiles ahead | On A and B: "Illustration from satellite cloud-top data" (small, lower left). At gate 5: tag "Observed" in orange, the source line "GOES-19 (East) 2026-11-12 19:31 UTC" from the app footer | The voice line runs over A and B. Show the footer source line in frame. Files: `data/video/blender/anim/*_A_approach`, `*_B_dip` (section 9) |
| 0:59-1:06 | g3 | T4: zoom on the label "Observed supercooled layer at planned altitude", then the side view with the orange patches | Underline the label | Keep the 2D view 3 s |
| 1:07-1:14 | n4 | Press Go left (the target lane changes), then Fly through to cancel. Then Anti-ice on | none | No cost is added after cancelling |
| 1:14-1:19 | g5 | T3: anti-ice off, ice index climbs toward 50, frost grows, the counter jumps | Label "Different take: anti-ice off" in a corner | Say it on screen so it is not read as the same flight |
| 1:20-1:27 | r1 | T5: report dialog, headline then the three references | none | Hold the three reference values 2 s |
| 1:27-1:32 | n5 | The component table: Base / cruise, Climb, Departure climb, Detour, Anti-ice, Ice drag, Diversion | Underline each row as it is named | Slow scroll |
| 1:32-1:39 | r2 | The headline number of the demo flight | Large "$X above Best" | Fill X from the real take (expected about 38) |
| 1:39-2:08 | d1 d2 d3 d4 d5 | The diagram (section 5), built left to right (3 s shorter than before to make room for the Blender shots in n3). Last 3 s: the dispatcher cross-section view (repository) | Short keywords only | Each box appears on its keyword |
| 2:08-2:30 | k1 k2b k3b | T7: spec files, tasks, hooks panel, a hook run, steering | File names visible: `requirements.md`, `tasks.md`, `science-guardrails.md`, `wording-on-cloud-dive-save.json` | Section 6. Owner decision D1 may lengthen this scene |
| 2:30-2:44 | c1 | T8: the "Limits:" list of the Cloud Dive README section, then the game note in the app | "Flat ground", "Game state, not an icing model", "Illustrative costs" | Calm shot, no fast cuts |
| 2:44-2:50 | c2 | End card: Cloud Dive, the demo URL, the repository URL | URL as text (the voice does not read it) | Fade out 1 s. The URL is an owner decision (D2) |

## 5. The diagram (T6)

Draw it yourself in a presentation tool and export 1920x1080. No logos: use text names and a plain icon.

```
 GOES-19 satellite            ECMWF forecast
 cloud top, phase,            temperature, humidity,
 optical depth, size          wind
        \                        /
         v                      v
   Build step, once, offline
   evidence rule v2, parallax correction,
   cloud base estimate, fuel tables
                |
                v
   One static case file: 4,375 evidence cells, 124 KB
                |
                v
   Browser game. No server. No language model.
```

Reveal order: the two inputs (line d2), the build step (d2), "no language model, no randomness" (d3), the case file
and the browser (d4), the dispatcher view (d5). Use the cell count and file size only if they still match the
exported case when you record (they are from today's file).

Build the diagram stages with `powershell -File tools/video/render_diagram.ps1` (source: `docs/video/assets/diagram.html`, output in
`data/video/assets/`). Check pacing without a voice: `python tools/video/make_narration.py --dry-run`, then
`python tools/video/make_animatic.py` writes `data/video/animatic-estimated.mp4` (silent, old stills, placeholder cards for the
Kiro and closing footage). After the real narration exists, run it with `--voice <name>` for the measured timeline.

Route and satellite graphics come from the case file itself: `python tools/video/make_route_graphics.py` writes, in
`data/video/assets/`, `route-sat.png` (IR image, state lines, five lanes, route, airports), `route-phase.png` (cloud-top phase
with its colour key), `route-evidence.png` (centre lane coloured by evidence level at 12,000 ft, gates 1 to 16 numbered, gate 5
marked) and `route-anim.mp4` (8 s: the route is flown, gates appear as they are reached). Gate numbers and positions come
from `node tools/video/gate_plan.mjs --json`. Use `route-sat.png` for the problem scene (line p2), `route-evidence.png` for gate 5
(line n3) and `route-phase.png` as an optional cut in the real-data scene (d2). The images carry the attribution line as text and
no logos.

## 6. Kiro scene (T7): only what is true today

Say only what `docs/kiro-usage-log.md` supports. The log has no real counterexample (the property tests passed on
their first run, and the gaps were found while stating the properties), so line k2b says "exposed gaps in our own
rules", not "found a counterexample". Show:

1. `.kiro/specs/cloud-dive/requirements.md`: scroll 2 s over the EARS lines (R2 evidence rule).
2. `tasks.md`: the checked list (111 of 111 coding subtasks).
3. The Kiro hooks panel: the six hooks in `.kiro/hooks/`.
4. A real hook run: save a file under `static/cloud-dive/` and let `wording-on-cloud-dive-save` run `tests/test_wording.py`; capture the passing result.
5. `.kiro/steering/science-guardrails.md` open on the banned wording list.

Not yet possible, so not in the video: a custom agent (C10), the browser MCP check (C11), a Kiro power (C12), a real
counterexample (C13). If any is done before recording, add one line and one shot for it.
Owner decision D1 (`docs/pending-items.md`) proposes a longer Kiro scene that films the hook failing on a banned word.

## 7. Script changes

First pass (2026-11-14):
- The gate order follows the data: a Possible gate first (n1), the Observed label at a later gate (n3, g3).
- The demo choice matches the solver's Best pattern: climb early, stay in lane, anti-ice only in front of cloud (n2, n4).
- The cost components moved to the report scene (n5); the HUD shows only the running total.
- Removed: the lane-shift line, the old second-gate line, and the Kiro placeholders the log cannot support.

Review 1 (2026-11-15):
- A1: n1 no longer says "Never observed", because the orange Observed cell at 30 km is visible in the gate 1 mini-map.
  The mini-map is not zoomed while n1 is spoken.
- A2: gate positions are computed (section 3). The Observed gate is gate 5 at 500 km, not 380 km. The gate at 360 km is Possible.
- A3: Best is $3,274 and the always anti-ice reference is $3,441 (both were off by $1).
- A4: g5 says "Anti-ice off, flying on?" so it is not confused with the report's Straight-ahead reference
  (centre lane, start altitude, anti-ice on in icing cells). The failure take stops at the ice gate (index 50).
- A5: c1 ends "Frame rate measured on one laptop." (C15 asks for the frame rate, not all tests).
- A6: T8 points to the Cloud Dive README section, not "Known Limitations" (that is the FastAPI app).

## 8. Open questions

1. Gate count and flight time: 16 gates, 127 game minutes (computed). The real-time length of the take is still to be measured.
2. Climb over three times at gate 1 adds no extra gate (engine rule). To be seen once in the real UI.
3. Does the cost chip show a "+$" popup after a choice (the 21.10 report shot has "+$264 this segment")? Check in rehearsal.
4. The public URL of the Cloud Dive site: owner decision D2.

## 9. Blender cloud shots (scene n3)

Rendered from the case file by `tools/video/blender/cloud_dive_clouds.py` (settings and tests in `docs/video/blender-assessment.md`).
Previews: `tools/video/blender/render_previews.ps1` (640x360, 12 fps, 6 s a shot, about 10 min a shot). The final render follows
the scenario sign-off (720p or 1080p, 24 fps).

| Shot | Route km | Camera | Look | Edit |
|---|---|---|---|---|
| A approach | 440 to 466 | 12,000 ft, lane 3, pitch -12 | Over the tops: the satellite tops here are 9,800 to 10,100 ft, below the flight level | Use 3 s of the 6 s render |
| B dip | 468 to 486 (3 km/s, about half the speed of A) | same | Enters the 14,571 ft deck at about 472 km; inside it is white-grey (fill light on from 471.5 km), no dark frames | Use 5 s, end on white, cut to the game at gate 5 |

Rules: the caption "Illustration from satellite cloud-top data" stays on both shots. No evidence level, severity word or ice
index is drawn on them. The encode uses `deflicker`, and `tools/video/blender/flicker_check.ps1` must report no dips on the
final mp4 (a frame darker than both neighbours by more than 6 of 255).
