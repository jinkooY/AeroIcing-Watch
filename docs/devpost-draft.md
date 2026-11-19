<!-- Devpost form text for Kiroween 2026 (checklist C17). Draft of 2026-11-19, written by Kiro.
     The old Devpost draft described the earlier prototype (icing risk badge, altitude suggestions, GK-2A,
     Incheon-Haneda). Replace every field with the text below; do not keep the old "What it does".
     Fill [VIDEO], [BLOG], [SOCIAL] after publishing. Re-check the 38-dollar figure on the frozen build.
     Run the wording-guardian agent on this file after any edit. -->

# Devpost submission: Cloud Dive

## Project name

Cloud Dive

## Elevator pitch (one line)

Fly a real US cloud day from satellite and forecast data, and spend the least fuel. Every label says how
much the data really knows.

## Category

Frankenstein

## Try it out

- Game: https://jinkooy.github.io/AeroIcing-Watch/ (free, no login; made for desktop browsers; on a phone it reached the
  first gate on a Samsung Galaxy S25 Ultra through BrowserStack)
- Code: https://github.com/jinkooY/AeroIcing-Watch (Apache-2.0)
- Video: [VIDEO]

## Built with

kiro, javascript, three.js, canvas, python, numpy, netcdf4, pyproj, goes-19, goes-18, ecmwf, github-pages,
hypothesis, playwright, browserstack, blender, ffmpeg, gemini-tts

## About the project

### Inspiration

Icing matters to flights, and avoiding it costs money: a longer path, a climb, or anti-ice fuel. The data
that hints at icing is public, but it is easy to say more than it supports. A geostationary satellite sees only
the top of the highest cloud. A cloud base from a statistical method is an estimate. A forecast rule is not an
observation. We wanted a game that is fun to play and honest about each of these limits.

### What it does

Cloud Dive is a fuel-cost game on real data. A regional jet flies a real route on a real day, for example New
York (KJFK) to Nashville (KBNA) on 12 November 2026 at 19:30 UTC, through cloud measured by GOES-19 and an
ECMWF forecast.

- **Cruise fast-forwards** until the route approaches a cell with *Possible (forecast only)* or *Observed
  supercooled layer at planned altitude* evidence. Then the game stops at a **gate**.
- **At a gate** you choose lane, altitude and anti-ice. Each choice shows the evidence ahead at the settings it
  would set. A choice's cost is not shown before you make it, and no choice is recommended.
- **Costs** follow stated game rules (illustrative values): every kilometre burns fuel, a climb costs climb
  fuel, a lane change makes the path longer, anti-ice costs fuel per kilometre, and flying on without it raises
  a game ice index that adds drag. At 50 the game stops at an ice gate; at 100 the flight ends in a diversion.
- **The report** itemizes the cost and compares it with three game references computed by an exact solver.
  After the flight only, it replays *Best (game reference, not a procedure)* gate by gate next to your flight.
- **Hot-seat** play lets several people fly the same day on one device.

Under the game sits a deterministic evidence engine: it reads GOES cloud-top height, phase, optical depth and
particle size, estimates the cloud base (Noh et al. 2017), corrects for parallax, and labels each route cell
with one of four levels: *Observed supercooled layer at planned altitude*, *Possible (forecast only)*,
*Not indicated*, *Not assessed*. No language model, no randomness and no network call take part in the
decision. Each case is pre-computed into one static file, so the game needs no backend. The same engine feeds a
dispatcher cross-section view in the repository.

### How we built it

- **Data build (Python, offline):** GOES-R ABI Level-2 products and ECMWF Open Data are sampled along five
  lanes of a corridor, turned into evidence cells, cost tables (OpenAP) and solver references, and written into
  one case file per day (KJFK-KBNA: 4,375 cells, 124 KB).
- **Game (vanilla JavaScript, no build step):** a pure engine checked against the Python reference (parity
  test), a 2D view, and a three.js cockpit with takeoff, climb, cruise, gates and the report.
- **Kiro:** one spec with 25 requirement groups and 36 correctness properties, steering for the science rules,
  six hooks, a custom wording agent in Kiro IDE and Kiro CLI, the Playwright MCP server and the BrowserStack
  power. Details are in "How Kiro was used".

### Challenges we ran into

- **Saying only what the data supports.** A word list catches "safe" or "severe", but not "evidence of icing"
  on a forecast-only cell. A custom agent now reviews the prose files the word test does not scan.
- **Gates that re-fired.** Stating a correctness property showed that a gate fired at every step while
  approaching a cloud; the spec now announces each entry once.
- **Phones.** The gate buttons sat below the fold on a phone, and on a real Galaxy S25 Ultra the Continue
  button sat 6 pixels below it after the climb. Both were found by tools, not by eye.
- **Recording the demo honestly.** The video takes are played with real key presses and clicks. That found a
  bug: after a mouse click on a gate button, the keyboard stopped working.

### Accomplishments that we're proud of

- The Best reference replays to its stored cost on every case, and the JavaScript engine matches the Python
  reference on two of the three cases over 60 random scripts each (dollars to 1e-9 relative).
- A property test found a real counterexample (a caption splitter that broke its two-line promise) before the
  final video.
- 323 Python tests and 265 Node tests pass (2026-11-19; re-run on the frozen build). The cockpit view held about
  60 frames per second, the limit of the 60 Hz display, measured on one desktop PC.

### What we learned

Put the rules where the code is. A steering file that loads with the game code, a hook set up to run the
wording test on save, and an agent that reads the prose turned "be careful with the wording" into checks that
run without anyone remembering them. Writing properties into the design found gaps before any test ran.

### What's next

More case days and routes, and an evaluation of the evidence levels against independent reports before any
claim beyond "evidence" is made.

### Limits

Game model. Not a flight procedure, not an icing severity. The ground is flat. The ice index is a game state,
not an icing model. Costs are illustrative. The corridor and lanes are illustrative, not airways. Frame rate was
measured on one desktop PC. Accuracy has not been evaluated.

## How Kiro was used

Paste [`AeroIcing_Watch_Submission_Package.md`](AeroIcing_Watch_Submission_Package.md) sections 1 to 9
(Devpost accepts Markdown). Keep section 9 ("What Kiro did not do").

## Testing instructions for judges

1. Open https://jinkooy.github.io/AeroIcing-Watch/ in a desktop browser. Tested in Microsoft Edge on Windows and
   Chrome on Android (Samsung Galaxy S25 Ultra). No login, no install.
2. Pick "JFK to Nashville, 12 Nov 2026, 19:30 UTC". Press **Start takeoff** (or Space), then **Skip** to jump past the
   climb, then **Continue**.
3. At each gate: read the evidence line under each button, change lane (left/right arrows), altitude
   (up/down) or anti-ice (A), then **Continue** (Space). "How costs work" explains the rules.
4. At the end, open the report and scroll to "Your flight and Best (game reference, not a procedure)".
5. Optional: the 2D view (V), the chase view (C), "Hot-seat (2 to 4 players)" in the case list, and the dispatcher view at
   https://jinkooy.github.io/AeroIcing-Watch/viewer/.
6. To run locally: `python -m http.server 8080 --directory static/cloud-dive`, then open
   http://localhost:8080/. Tests: `pytest -q` and `node --test tests/js/*.test.mjs`.

## Pre-existing work and third-party data

The repository was created on 2026-11-11, inside the submission period. Earlier code by the author
(WeatherPath) and code written by other AI tools (Claude, Codex) is listed per file in
https://github.com/jinkooY/AeroIcing-Watch/blob/main/docs/Preexisting_Work_Disclosure.md. Third-party data,
code and tools: https://github.com/jinkooY/AeroIcing-Watch/blob/main/THIRD_PARTY_NOTICES.md. Data: NOAA
GOES-R (NOAA Open Data), ECMWF Open Data (CC BY 4.0), Natural Earth and OurAirports (public domain).

## Bonus prizes

- Bonus Blog: [BLOG] (dev.to; states that it is written as part of the Kiroween 2026 hackathon)
- Social Blitz: [SOCIAL] (starts with #KiroweenHackathon26)
- Best Kiro Crew App: not entered
- Best Ghost of Kiroween Past: not entered
- Best Startup Project, Best Student Project: not entered
