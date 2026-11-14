# Cloud Dive revisions b and c: 3D cockpit, phases, hot-seat, visual polish, browser guard

Range reviewed: `git diff f78ee61..bacaf3b` (134 files; 10,498 insertions). Spec: `.kiro/specs/cloud-dive/` R15 to R22, design sections 14 and 15.

The change adds a three.js cockpit and chase view, a phase machine (ready, takeoff, climb, cruise, gate, arrival, diversion, report), display effects, a Departure climb constant, a cost pop-up, sky gates, hot-seat play and a report headline. Group 21 polishes the visuals and adds `tools/browser_guard.mjs` for the headless-browser check scripts. The engine, cost model, solver and case data are unchanged apart from three constants in the case files, and the layering holds: the 3D code reads state and never writes it. `node --test tests/js/*.test.mjs` passes (238 tests) and pytest passes (286 tests). I did not start a browser.

Watch for: (1) `browser_guard.mjs` cleans up on exit, error, timeout and Ctrl+C, but not when the console window is closed or the node process is killed from outside, and its debugging port can collide with a foreign browser (confirmed by reading). (2) Several "game.js wiring" tests are regex matches on source text, so the lead-in, skip and report-timing claims have no behavioral test (confirmed). (3) One stale-flag path can skip the next takeoff (likely).

**Verdict**: NEEDS_CHANGES

## High-level view

Engine, cost and data invariants hold. `engine.js`, `game_core.py`, `cost_model.py` and `solver.py` have no diff in the range. The three case files differ only in `params.departureClimbUsd`, `params.departureClimbNote` and `airports`. The Departure climb is added at the same points everywhere I traced: HUD, cockpit counter, report total and component row, references, hot-seat table and the personal best under the `cloud-dive:best:v2:` key. Hot-seat flights skip the personal best on purpose.

The 3D layer, effects and phases are display-only. `buildScene`, `buildEffects`, the fuel counter and the cost pop-up take states by value and do not write them. The pop-up is computed from two stop states that already happened, so it cannot preview a choice. The sky gates carry only an evidence label per lane. No new user-facing string breaks the R9.1 word list, and no recommendation wording appears.

The phase wiring in `game.js` is mostly sound. Skip, reduced motion, the 2D fallback and the report timing are consistent. The remaining defects are narrow: one stale skip flag, a hot-seat session that is dropped without a prompt, and tests that check source text instead of behavior.

The browser guard is a clear improvement over ad hoc spawning and never targets the user's own Edge, because every kill is keyed to the `cloud-dive-edge-<pid>-<time>` profile name in the process command line. Its gaps are the paths where node itself dies without running handlers, the random debugging port, and the absence of any test.

<details>
<summary>Issues (12)</summary>

1. **Console close or external kill leaks the browser** (medium, confirmed) — `tools/browser_guard.mjs:84-85` handles SIGINT, SIGTERM and SIGBREAK but not SIGHUP, which node raises on Windows when the console window closes. A `taskkill /F` of node runs no handler at all. Launch the browser with `--remote-debugging-pipe` (it exits when the pipe closes) or start a small detached watchdog that waits for the node PID and then kills the tree.
2. **Debugging port may belong to another browser** (medium, confirmed) — `tools/browser_guard.mjs:111,121`: the port is `9300 + random(600)` with no check that it is free and no check that the spawned process is the one answering. If a user browser listens there, the script connects to it and navigates its tab. Bind port 0 and read `DevToolsActivePort` from the profile dir, or verify the answering PID.
3. **No test for the guard** (medium, confirmed) — nothing under `tests/` covers lock takeover, stale PIDs, the timeout path, the profile-tag match or the kill filter. Add node tests that use a fake child process, and one that checks `killGuardedBrowsers` quotes and filters as intended.
4. **Stale skip flag skips the next takeoff** (low to medium, likely) — `static/cloud-dive/game.js:952-957,982,1058-1059`: `skipRequested` is cleared only by a frame that runs the lead-in or ending. If Skip is pressed and the view changes to 2D, or the phase ends, before that frame, the flag stays true and the first takeoff frame of the next flight (hot-seat or Play again) is skipped. Clear the flag in `resetCockpitFlight` and in `syncLeadToView`.
5. **Wiring claims are tested by regex on source** (medium, confirmed) — `tests/js/skip.test.mjs:79-86` and `tests/js/cinematics.test.mjs:99-106` assert that strings exist in `game.js`. "The engine does not step during the lead-in" and "the report waits for the cinematic" are not exercised. Extract the lead and ending decisions into a DOM-free module, or run `game.js` against a small DOM stub.
6. **Invariant test starts at group 21** (low, confirmed) — `tests/test_wording.py` (`GROUP21_BASE = "1565153"`) checks that engine, cost, solver and case files are unchanged only since group 21, and skips when the commit is missing. Groups 13 to 20 are unguarded; I verified them by hand against `f78ee61`. Pin the base to the commit before group 13 and fail instead of skipping in CI.
7. **Hot-seat session lost without a prompt** (low, confirmed) — `static/cloud-dive/game.js:327-330`: `backToCases` sets `store.hot = null` at any point, including mid-session, with no confirmation. A second silent loss: `openCase` returns when `store.loading` is true, which drops the session from `submitHotseat`. Ask before leaving, and re-enable the form while loading.
8. **Later hot-seat players can read Best before they fly** (low, possible) — `static/cloud-dive/report-view.js` shows the references in every report. The first player's report therefore shows the Best and Straight-ahead costs to everyone still waiting. This follows the letter of `referencesVisibleTo` (own flight only) but not its aim of keeping the references back until after each flight. Confirm the intent of R20.4; if the aim is as stated, hide the reference table in hot-seat reports until the results table.
9. **Gate label summarizes three cells** (low, possible) — `static/cloud-dive/scene.js:259-276`: each gate shows the worst of the next three cells (30 km at `stepKm` 10) but is drawn 18 km ahead. The ordering is safe (Not assessed outranks Not indicated). Check whether a reader can tell a gate label covers a 30 km window; a tooltip or Why-card line would fix it.
10. **Rounding differs between card and totals** (low, confirmed) — `static/cloud-dive/departure-card.js:15` prints the constant with cents ($74.77) while HUD, report rows and totals round to whole dollars. A displayed component list can differ from the total by $1. Use one formatter.
11. **Leftover cockpit lead box after Change case** (cosmetic, likely) — `static/cloud-dive/game.js:327-337`: `backToCases` does not call `renderLeadUi`, so `body.lead-active` can remain until the next `openCase`. The flight section is hidden, so impact is small.
12. **Wording scan has no entry for risk or probability** (low, confirmed) — `tests/test_wording.py` `BANNED_R91` omits "risk" and "probability", which the guardrails name. No current string uses them, so this is a gap in the test only.

</details>

<details>
<summary>Details</summary>

## Browser guard: what it covers and where it does not

`startGuard` takes a lock file in `%TEMP%` (atomic create, stale PID takeover), starts one browser with a unique profile directory, registers handlers, and arms a hard timeout (default 180 s, exit code 3). Cleanup is synchronous, so it runs from the `exit` event too, and it is idempotent. It kills the browser tree with `taskkill /T /F`, then sweeps by profile tag, then removes the profile and the lock, and it removes the lock only when the file holds its own PID.

```
 script ──▶ startGuard ──▶ lock ──▶ sweep old cloud-dive-edge-* ──▶ spawn browser
    │                                                                    │
    ├─ normal end / throw / rejection / SIGINT,TERM,BREAK / timeout ─▶ cleanup (tree kill, sweep, rm profile, rm lock)
    └─ console closed (SIGHUP) / taskkill /F node / power loss ───────▶ nothing runs; next run sweeps
```

Error, timeout and Ctrl+C paths do reach cleanup. A script that forgets `close()` hangs until the hard timeout, then exits 3.

User Edge safety: the kill filter requires the process name `msedge.exe` or `chrome.exe` and a command line containing `cloud-dive-edge-`, so the user's own Edge does not match. The startup sweep uses the shared prefix, which is safe only because the lock allows one run at a time across all worktrees (it is global in `%TEMP%`).

The first gap is the set of paths where node dies without handlers. Closing the console window raises SIGHUP on Windows, and nothing listens for it. An outside `taskkill /F` of node, or a tool runner that kills a timed-out job, behaves the same way. The browser stays up until the next run's sweep finds it, which happens only if someone runs a check again, and the profile directory stays on disk until then. The browser is a child of node on the same console but not in a job object, so Windows does not reap it. `--remote-debugging-pipe` makes the browser exit when node's end of the pipe closes, which covers every one of these cases without a watchdog, but it requires speaking the pipe protocol instead of a WebSocket. A detached PowerShell watchdog that waits on the node PID is the smaller change.

The second gap is the port. `port = 9300 + floor(random * 600)` is not checked. If another process, for example the user's browser started with a remote debugging port in that range, answers `/json/list` first, the guard attaches to that page and sends `Page.navigate` to it. Cleanup would not kill it, so no data is lost, but the user's tab is driven. Using port 0 and reading `DevToolsActivePort`, or comparing the answering browser's PID to `proc.pid`, removes the case.

Smaller points: the lock check has a narrow race where an empty lock file (created, not yet written) reads as PID 0 and is treated as stale; the file server's `startsWith(root)` check has no trailing separator, which is harmless for a loopback server rooted at the repo; no `close` handler on the socket means a browser crash is only noticed at the hard timeout.

## Departure climb: where the constant is applied

The constant is read from `params.departureClimbUsd` through `departure.js` and added at: HUD (`game.js:349-351`, off during the runway lead-in), the cockpit counter (`fuelDisplayWithDepartureUsd` in `cockpitFrame` and `endingFrame`; the lead-in frame uses the engine-only counter by design), `scene.panel.displayTotalUsd` (`scene.js:449`, zero in ready, takeoff and climb), `buildReport` (total, component row, references, diverted text and share text), `hotseat.resultFromEngine`, `hotseat.table` (references and saving share), and the personal best, which stores the report total under the v2 key. The saving share is unchanged because the same constant is added to the player, Best and Straight-ahead values. Python and JS twins are separate implementations of trivial arithmetic; `test_departure.py` checks the Python side and the JS tests check the JS side, but nothing runs both on one input (low risk).

The cost pop-up (`cost-popup.js`) excludes the constant by design: it reports the cost between stops from the engine's component arrays. That matches R18.5 and the spec text.

## Phase wiring in `game.js`

The scene phase "gate" comes from the controller mode (`atDecisionGate`), not from `phases.js`; the phase machine's gate and cruise transitions are exercised only by its own tests and by `endingInput`. That is workable, but it means the property "engine steps only in cruise and gate" is enforced by `gameKeysAllowed(e) && !leadActive() && !endingRunning()` on keys and by hiding `#controls` and the gate buttons through CSS and `setCockpit`, not by `engineMayStep`. A future control that bypasses those would step the engine during the lead-in with no test failing (see issue 5).

The stale flag in issue 4 is the one defect found in skip, reduced motion and the 2D fallback.

## Hot-seat turn flow

Results are recorded when the report opens, after the cinematic. If `resultFromEngine` returned null the session would stall without a message; the engine always provides a finite total, so this is theoretical. Issues 7 and 8 are the findings here.

## Test gaps against claimed properties

CD-P23 purity (`purity21.test.mjs`) freezes inputs only for the cruise and gate phases; the other phases are covered by one case in `cinematics.test.mjs:68`. CD-P28 states that effects and the counter change no engine value, but the counter functions are pure and their results are discarded, so the `deepEqual` after them cannot fail for that reason. The fuel counter's real properties (ends on the engine total, never passes it) sit in `fuel-counter.test.mjs`. CD-P32 tests the pop-up function only; I did not find a test that the panel and the gate scene objects carry no cost field. Not tested: HUD total versus report total in one flight; the browser-guard behaviors in issues 1 to 3; the groups 13 to 20 data invariant (issue 6).

</details>

<details>
<summary>File map</summary>

Full diff: `git diff f78ee61..bacaf3b`.

- `tools/browser_guard.mjs`: lock, single browser, timeout and cleanup for headless checks.
- `tools/layout_check.mjs`, `chase_check.mjs`, `hotseat_check.mjs`, `shots_21.mjs`: use the guard.
- `static/cloud-dive/game.js`: view, phase, skip, hot-seat and report wiring.
- `static/cloud-dive/phases.js`, `takeoff.js`: phase machine and lead-in or ending glue.
- `static/cloud-dive/departure.js`, `src/analysis/departure.py`, `tools/export_departure.py`: constant and exporter.
- `static/cloud-dive/report.js`, `report-view.js`, `hotseat.js`: totals, references, headline, personal best v2, results table.
- `static/cloud-dive/scene.js`, `cockpit-geometry.js`, `cockpit3d.js`, `chase.js`, `cruise-camera.js`, `panel.js`: scene description and drawing.
- `static/cloud-dive/gate-controls.js`, `gate-panel.js`, `cost-popup.js`, `fuel-counter.js`, `departure-card.js`: gate choices, pop-up, counter, 2D card.
- `static/cloud-dive/cases/*.json`: three Departure constants and airport elevations.
- `tests/js/*`, `tests/test_departure.py`, `tests/test_wording.py`, `tests/test_playtest_regression.py`: new and extended tests.
- `docs/screens/*`, `static/cloud-dive/vendor/three/*`: screenshots and the vendored three.js build.

</details>
