<!-- Draft for dev.to (C18). Publish before 2026-12-04 14:00 PT. Suggested tags: kiro, hackathon, gamedev, weather.
     Replace [VIDEO] after the YouTube upload. Re-check the 38-dollar figure on the frozen build (task 23.4).
     Run wording-guardian (IDE or CLI) on this file again after any edit. -->

# Cloud Dive: flying a real cloud day with Kiro specs, hooks and a wording guardian

*This post is written as part of the Kiroween 2026 hackathon.*

On 12 November 2026, GOES-19 showed cloud tops with a supercooled flag along the route from New York (KJFK)
to Nashville (KBNA). Cloud Dive lets you fly a regional jet through that day, using the real GOES satellite
cloud data and the real ECMWF forecast for it. Your score is the fuel cost in the game model. Lower wins.

Play it free in the browser: https://jinkooy.github.io/AeroIcing-Watch/ · Code: https://github.com/jinkooY/AeroIcing-Watch · Video: [VIDEO]

## The game in one minute

Cruise runs fast-forward until the route approaches a cell where the data shows *Possible (forecast only)* or
*Observed supercooled layer at planned altitude*. Then the game stops at a **gate**. You choose a lane, an
altitude and anti-ice, and continue. A detour costs distance, a climb costs climb fuel, anti-ice costs fuel per
kilometre, and flying on without it raises a game *ice index* that adds drag. Every price is an illustrative
game value, and the gate never tells you what a choice will cost or which one is best. You find out in the
report, which compares your total with three game references that are stored with the case and shown only
after the flight.

The game sits on top of a deterministic evidence engine. It reads GOES cloud-top height, phase, optical depth
and particle size, estimates the cloud base with a published statistical method (Noh et al. 2017), corrects for
parallax and labels each route cell with one of four levels: *Observed supercooled layer at planned altitude*,
*Possible (forecast only)*, *Not indicated* or *Not assessed*. No language model, no randomness and no network
call take part in that decision. Each case is pre-computed into static files, so the game needs no backend.

## Why the wording mattered as much as the code

A weather game can easily say more than its data supports. A passive satellite sees only the top of the
highest cloud. A cloud base from a statistical method is an estimate. A forecast rule is not an observation.
So the first task of the Cloud Dive spec was not code but a **steering file**: I imported the science
guardrails from my research notes and amended them for the game. `science-guardrails.md` holds the four level
names, the words the project may never use about the atmosphere, and the rule that "Not assessed" must never
turn into "Not indicated". Kiro loads it whenever a file under `static/cloud-dive/` or `src/analysis/` is in
context, so every generated string starts from the same rules.

## Specs: how the project was structured

Cloud Dive is one spec (`.kiro/specs/cloud-dive/`): requirements, a design with numbered correctness
properties, and 127 tasks in 24 groups (126 done; the final recording waits for the feature freeze). The spec
went through five revisions (a to e), driven by playtests and reviews.

Stating properties in the design found problems before any test ran. Turning the evidence table into code
exposed three gaps in my own rules:

- a humid forecast could mark a clear-sky pixel *Possible*;
- a cell above the cloud top became *Not assessed* only because isotherms were missing;
- a satellite-supercooled cell with missing isotherms could fall through to a forecast row and end as
  *Not indicated*.

All three were fixed in the spec. Compared with my first vibe-coded days on this repository, when a quick
smoke test found 5 of 27 checks failing, the spec gave each change a requirement to point at and a property
to break.

Property tests (Hypothesis in Python) and seeded random tests (`node --test` in JavaScript) cover containment,
ordering, determinism and Python-JavaScript parity on two of the three real cases. One property did find a
real counterexample. The video caption splitter wrapped at 42 characters, but nothing capped the lines at two.
Hypothesis shrank a failing input to a one-letter sentence followed by a long one; the merge rule joined them,
giving three lines. The real script failed the same way.

## Hooks: checks set up once

Six hooks are configured in `.kiro/hooks/`:

- a wording test on each save under `static/cloud-dive/` (banned terms, level names, the game note);
- `node --check` on JavaScript saves and `pytest` on Python saves;
- a guard that stops the agent from writing to `.env` or the `data/` cache;
- a session-start status, and a task-progress report whenever `tasks.md` is saved.

The progress hook kept me honest. Every completed task needs a row in `docs/kiro-usage-log.md`, and the
hook reminds me each time.

## A custom agent, in the IDE and the CLI

`wording-guardian` is a read-only custom agent. It reviews prose that the wording test does not scan (the
video script, the README, this post) against the steering file. Its first review, of the video script, the edit list and the README, failed
with 14 findings. A later review caught a script line I had written myself, "when evidence of icing is
ahead", which presents forecast-only cells as icing evidence. The line now says "Possible or Observed
evidence".

I also ran it headless from **Kiro CLI** (`kiro-cli chat --no-interactive --agent wording-guardian-cli
--trust-tools=fs_read`). The difference was instructive: the CLI did not load the IDE's Markdown agent and
needed a JSON agent file, which `kiro-cli agent upgrade` converted to a format both engines read. After that,
the review became a scriptable, read-only step (63 and 140 seconds in my two runs). Its review of the first draft of this
post failed with four factual errors about my own repository, which I fixed before publishing.

## MCP and a power: testing on screens I don't own

Two extensions found layout bugs that desktop tests missed:

- **Playwright MCP** at 390 x 844 showed that the gate buttons sat below the fold on a phone. That led to a
  phone layout and one automatic scroll per gate.
- The **BrowserStack power** drove Chrome on a real Samsung Galaxy S25 Ultra. Its viewport is 697 CSS pixels
  tall, and after the climb the Continue button sat 6 pixels below the fold. The fix was small, and a second
  device session confirmed it.

## Recording the video with real input

The demo video uses takes recorded by a script that presses real keys and clicks real buttons through the
browser's DevTools protocol, at a human pace. Doing it this way found a game bug: after a mouse click on a gate
button, the keyboard stopped working. It also found that my new 4K monitor laid the page out 3,840 pixels wide.
The recorder now starts the browser at device scale 2, so the layout is always 1920 x 1080.

## Limits

Game model. Not a flight procedure, not an icing severity. The ground is flat. The ice index is a game state,
not an icing model. Costs are illustrative. The frame rate was measured on one desktop PC. Cloud Dive reuses code
from my earlier WeatherPath project; every file's origin is listed in `docs/Preexisting_Work_Disclosure.md`.

## What changed in how I work

The steering file and the hooks moved the science rules out of my head and into checks that are set to run
on every save. The spec made later changes requirements first. The custom agent reviews the text that tests
can't read. I spent less time re-checking my own wording and more time on the game.

Try to beat my demo flight: it finished 38 game dollars (illustrative) above Best.
