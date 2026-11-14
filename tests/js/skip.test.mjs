// Task 17.6: Skip and reduced motion (R15.11, R15.12). DOM-free.
// Run: node --test "tests/js/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as E from "../../static/cloud-dive/engine.js";
import * as P from "../../static/cloud-dive/phases.js";
import * as T from "../../static/cloud-dive/takeoff.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => readFileSync(path.join(root, p), "utf8");
const data = JSON.parse(read("static/cloud-dive/cases/20261101-kden-klax-2100z.json"));
const c = E.loadCase(data);

test("skippable only in takeoff, climb, arrival and diversion (Space stays Continue/Pause elsewhere)", () => {
  for (const ph of ["takeoff", "climb", "arrival", "diversion"]) assert.equal(T.skippable({ phase: ph }), true, ph);
  for (const ph of ["ready", "cruise", "gate", "report"]) {
    const ps = { ...T.newPhaseState(data, c, false), phase: ph, engineStarted: true };
    assert.equal(T.skippable(ps), false, ph);
    assert.equal(T.skipCinematic(ps), ps, ph);
  }
  assert.equal(T.skippable(null), false);
});

test("skip during takeoff or climb hands over to engine step 0 with the normal initial state", () => {
  for (const mid of ["takeoff", "climb"]) {
    let ps = P.phaseStep(T.newPhaseState(data, c, false), 0, { start: true });
    if (mid === "climb") ps = P.phaseStep(ps, 5200, {});
    assert.equal(ps.phase, mid);
    const r = T.leadAdvance(ps, 16, { skip: true });
    assert.equal(r.ps.phase, "cruise");
    assert.equal(r.engineStart, true);
    const init = E.initialState(c);
    const st = T.engineStartState(c, init);
    assert.equal(st.step, 0);
    assert.deepEqual(st, E.initialState(c));
    assert.equal(E.totalUsd(c, st), E.totalUsd(c, E.initialState(c)));
  }
});

test("skip changes only the phase", () => {
  const strip = ({ phase, tMs, event, engineStarted, ...rest }) => rest;
  for (const phase of ["takeoff", "climb", "arrival", "diversion"]) {
    const base = { ...T.newPhaseState(data, c, false), phase, tMs: 900, endAltFt: 21000, endLaneFrac: 2 };
    assert.deepEqual(strip(T.skipCinematic(base)), strip(base), phase);
  }
});

test("reduced motion: takeoff and climb each last at most 2 s", () => {
  let ps = P.phaseStep(T.newPhaseState(data, c, true), 0, { start: true });
  let t = 0;
  let takeoffMs = 0;
  while ((ps.phase === "takeoff" || ps.phase === "climb") && t < 20000) {
    if (ps.phase === "takeoff") takeoffMs = t + 16;
    ps = P.phaseStep(ps, 16, {});
    t += 16;
  }
  assert.equal(ps.phase, "cruise");
  assert.ok(takeoffMs <= 2020);
  assert.ok(t <= 4050);
});

test("changing the media query during play keeps progress and shortens the rest to 2 s", () => {
  let ps = P.phaseStep(T.newPhaseState(data, c, false), 0, { start: true });
  ps = P.phaseStep(ps, 2500, {});
  const before = P.phasePose(ps).progress;
  const red = T.setReducedMotion(ps, true);
  assert.equal(red.reduced, true);
  assert.ok(Math.abs(P.phasePose(red).progress - before) < 1e-3);
  assert.ok(P.phaseDurationMs(red) <= 2000);
  const back = T.setReducedMotion(red, false);
  assert.ok(Math.abs(P.phasePose(back).progress - before) < 1e-3);
  assert.equal(T.setReducedMotion(ps, false), ps);
  assert.equal(T.setReducedMotion(null, true), null);
});

test("game.js wires the skip button, the media query listener and keeps Space for gates", () => {
  const src = read("static/cloud-dive/game.js");
  assert.match(src, /cinematicRunning/);
  assert.match(src, /addEventListener\("change", onReducedMotionChange\)/);
  assert.match(src, /skip \? \{ skip: true \} : \{\}/);
  assert.match(src, /gameKeysAllowed\(e\) && !leadActive\(\) && !endingRunning\(\)/);
  assert.match(read("static/cloud-dive/cockpit.css"), /\.takeoff-btn \{ min-height: 44px; min-width: 44px/);
  assert.match(read("static/cloud-dive/index.html"), /id="skip-btn"[^>]*aria-keyshortcuts="Space"/);
});
