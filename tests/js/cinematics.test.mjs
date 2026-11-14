// Task 17.5: arrival and diversion cinematics, then the report (R15.9, R15.10). DOM-free.
// Run: node --test "tests/js/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as E from "../../static/cloud-dive/engine.js";
import * as S from "../../static/cloud-dive/scene.js";
import * as P from "../../static/cloud-dive/phases.js";
import * as T from "../../static/cloud-dive/takeoff.js";
import * as R from "../../static/cloud-dive/report.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const data = JSON.parse(readFileSync(path.join(root, "static/cloud-dive/cases/20261101-kden-klax-2100z.json"), "utf8"));
const c = E.loadCase(data);
const arrivedState = () => E.flyPolicy(c, data.references.best.policy);
const divertedState = () => E.flyPolicy(c, Array.from({ length: c.nSteps }, () => [c.startLane, c.startAlt, false]));
const deepFreeze = (o) => { Object.values(o).forEach((v) => v && typeof v === "object" && deepFreeze(v)); return Object.freeze(o); };

// Frame loop as game.js runs it: ending input once, then 16 ms frames until the report phase.
function play(st, reduced, skipAtMs = null) {
  let ps = T.newPhaseState(data, c, reduced);
  ps = { ...ps, phase: "cruise", engineStarted: true };
  ps = P.phaseStep(ps, 0, T.endingInput(c, st));
  const first = ps.phase;
  let t = 0;
  while (T.inEnding(ps) && t < 30000) {
    const skip = skipAtMs !== null && t >= skipAtMs;
    ps = P.phaseStep(ps, 16, skip ? { skip: true } : {});
    t += 16;
  }
  return { first, last: ps.phase, ms: t };
}

test("arrival cinematic lasts about 10 s and diversion about 4 s, then the report phase", () => {
  const a = play(arrivedState(), false);
  assert.equal(a.first, "arrival");
  assert.equal(a.last, "report");
  assert.ok(a.ms >= 10000 && a.ms <= 10020, String(a.ms));
  const d = play(divertedState(), false);
  assert.equal(d.first, "diversion");
  assert.equal(d.last, "report");
  assert.ok(d.ms >= 4000 && d.ms <= 4020, String(d.ms));
});

test("reduced motion: each cinematic takes at most 2 s", () => {
  assert.ok(play(arrivedState(), true).ms <= 2020);
  assert.ok(play(divertedState(), true).ms <= 2020);
});

test("skip ends the cinematic early and changes no value except the phase", () => {
  const skipped = play(arrivedState(), false, 1000);
  assert.equal(skipped.last, "report");
  assert.ok(skipped.ms <= 1040);
  for (const st of [arrivedState(), divertedState()]) {
    const base = P.phaseStep({ ...P.createPhaseState({ arrivalElevFt: 125 }), phase: "cruise", engineStarted: true }, 0, T.endingInput(c, st));
    const mid = P.phaseStep(base, 700, {});
    const skip = P.phaseStep(mid, 0, { skip: true });
    const strip = ({ phase, tMs, event, ...rest }) => rest;
    assert.equal(skip.phase, "report");
    assert.deepEqual(strip(skip), strip(mid));
    assert.deepEqual(T.finishEnding(mid).phase, "report");
  }
  assert.equal(T.finishEnding({ phase: "cruise" }).phase, "cruise");
});

test("cinematics never change the engine state or the case, and the report is available after", () => {
  const st = deepFreeze(arrivedState());
  const file = deepFreeze(JSON.parse(JSON.stringify(data)));
  const before = JSON.stringify(st);
  let ps = P.phaseStep({ ...P.createPhaseState({ arrivalElevFt: 125 }), phase: "gate", engineStarted: true }, 0, T.endingInput(c, st));
  while (T.inEnding(ps)) {
    S.buildScene(file, st, P.phasePose(ps), T.sceneOptions(file, c, { mode: "cockpit" }));
    ps = P.phaseStep(ps, 500, {});
  }
  assert.equal(ps.phase, "report");
  assert.equal(JSON.stringify(st), before);
  const rep = R.buildReport(c, st, data.references, data.params);
  assert.equal(rep.ranked, true);
  assert.equal(R.buildReport(c, divertedState(), data.references, data.params).ranked, false); // "not ranked" (R5.6)
});

test("arrival scene: flat ground at the arrival airport elevation, runway there, game note and source line kept", () => {
  const st = arrivedState();
  const ps = { ...P.createPhaseState({ arrivalElevFt: 125, startAltFt: 28000 }), phase: "arrival", tMs: 5000, endAltFt: 28000, endLaneFrac: st.lane };
  const scene = S.buildScene(data, st, P.phasePose(ps), T.sceneOptions(data, c, { mode: "cockpit", arrivalElevFt: 125, departureElevFt: 5431 }));
  assert.equal(scene.phase, "arrival");
  assert.equal(scene.ground.elevFt, 125);
  assert.equal(scene.ground.y, S.ftToDisplayKm(125));
  const arr = scene.airports.find((a) => a.role === "arrival");
  assert.ok(scene.camera.pos[0] >= arr.xKm && scene.camera.pos[0] <= arr.xKm + S.ARRIVAL_ROLL_KM + 1e-9);
  assert.ok(scene.camera.pos[1] >= scene.ground.y);
  assert.ok(scene.notes.ground && scene.panel.textLine.length > 0);
  const dep = S.buildScene(data, st, { phase: "diversion", endAltFt: 20000 }, { departureElevFt: 5431, arrivalElevFt: 125 });
  assert.equal(dep.ground.elevFt, 5431);
});

test("game.js holds the report until the cinematic ends and 2D opens it directly", () => {
  const src = readFileSync(path.join(root, "static/cloud-dive/game.js"), "utf8");
  assert.match(src, /if \(endingRunning\(\)\) return;/);
  assert.match(src, /if \(!isCockpitView\(\)\) next = finishEnding\(next\)/);
  assert.match(src, /maybeOpenReport\(s\);\s*return false;/);
  assert.match(src, /isSkipKey/);
  assert.match(readFileSync(path.join(root, "static/cloud-dive/index.html"), "utf8"), /id="skip-btn"/);
});
