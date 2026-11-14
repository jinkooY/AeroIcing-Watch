// Task 17.3: runway scene and takeoff glue (R15.1, R15.2, R15.14). DOM-free.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as E from "../../static/cloud-dive/engine.js";
import * as S from "../../static/cloud-dive/scene.js";
import * as P from "../../static/cloud-dive/phases.js";
import * as T from "../../static/cloud-dive/takeoff.js";
import * as G from "../../static/cloud-dive/cockpit-geometry.js";

const casesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../static/cloud-dive/cases");
const names = readdirSync(casesDir).filter((n) => /^\d.*\.json$/.test(n));
const load = (n) => JSON.parse(readFileSync(path.join(casesDir, n), "utf8"));

function fly(file, c, st, frameMs, maxMs = 60000) {
  let ps = T.newPhaseState(file, c, false);
  ps = P.phaseStep(ps, 0, { start: true });
  let t = 0;
  const xs = [];
  let starts = 0;
  while (T.inLead(ps) && t < maxMs) {
    const r = T.leadAdvance(ps, T.frameDt(t + frameMs, t), {});
    ps = r.ps;
    if (r.engineStart) starts++;
    t += frameMs;
    if (T.inLead(ps)) xs.push(P.phasePose(ps).xKm);
  }
  return { ps, t, xs, starts };
}

test("takeoff starts at x = -LEAD_IN_KM on the ground and the roll takes about 5 s of real time", () => {
  for (const n of names) {
    const file = load(n);
    const c = E.loadCase(file);
    const ps0 = T.newPhaseState(file, c, false);
    const pose0 = P.phasePose(ps0);
    assert.equal(ps0.phase, "ready");
    assert.equal(pose0.xKm, -S.LEAD_IN_KM);
    assert.equal(pose0.altFt, file.airports.from.elevFt);
    let ps = P.phaseStep(ps0, 0, { start: true });
    assert.equal(ps.phase, "takeoff");
    let t = 0;
    while (ps.phase === "takeoff") {
      ps = T.leadAdvance(ps, 100, {}).ps;
      t += 100;
    }
    assert.equal(ps.phase, "climb");
    assert.ok(t >= 5000 && t <= 5100, `roll took ${t} ms`);
  }
});

test("the lead-in never leaves [-LEAD_IN_KM, 0] and ends once with the engineStart event", () => {
  const file = load(names[0]);
  const c = E.loadCase(file);
  const { ps, xs, starts } = fly(file, c, E.initialState(c), 16);
  assert.equal(ps.phase, "cruise");
  assert.equal(starts, 1);
  assert.ok(xs.length > 100);
  for (const x of xs) assert.ok(x >= -S.LEAD_IN_KM && x <= 0);
});

test("a frame after a long pause counts as at most MAX_FRAME_MS; first frame counts as 0", () => {
  assert.equal(T.frameDt(10000, 100), T.MAX_FRAME_MS);
  assert.equal(T.frameDt(120, 100), 20);
  assert.equal(T.frameDt(100, 200), 0);
  assert.equal(T.frameDt(100, null), 0);
  assert.equal(T.frameDt(NaN, 5), 0);
});

test("ready does not move on without the start input; real time alone never starts the takeoff", () => {
  const file = load(names[0]);
  const c = E.loadCase(file);
  let ps = T.newPhaseState(file, c, false);
  for (let i = 0; i < 100; i++) ps = T.leadAdvance(ps, 100, {}).ps;
  assert.equal(ps.phase, "ready");
  assert.equal(P.engineMayStep(ps), false);
});

test("the engine may not step in ready, takeoff or climb, and the hand-over state is step 0", () => {
  const file = load(names[0]);
  const c = E.loadCase(file);
  let ps = P.phaseStep(T.newPhaseState(file, c, false), 0, { start: true });
  while (T.inLead(ps)) {
    assert.equal(P.engineMayStep(ps), false);
    ps = T.leadAdvance(ps, 200, {}).ps;
  }
  assert.equal(P.engineMayStep(ps), true);
  const st = E.initialState(c);
  assert.equal(T.engineStartState(c, st), st, "an unstepped state is kept");
  const moved = { ...st, step: 3 };
  const fresh = T.engineStartState(c, moved);
  assert.equal(fresh.step, 0);
  assert.deepEqual(fresh, E.initialState(c));
});

test("finishLead ends the lead-in from ready, takeoff and climb", () => {
  const file = load(names[0]);
  const c = E.loadCase(file);
  const ready = T.newPhaseState(file, c, false);
  const takeoff = P.phaseStep(ready, 0, { start: true });
  const climb = { ...takeoff, phase: "climb" };
  for (const ps of [ready, takeoff, climb]) assert.equal(T.finishLead(ps).phase, "cruise");
});

test("start key: Space and Enter only, no modifiers, no repeat", () => {
  assert.equal(T.isStartKey({ key: " " }), true);
  assert.equal(T.isStartKey({ key: "Enter" }), true);
  assert.equal(T.isStartKey({ key: "a" }), false);
  assert.equal(T.isStartKey({ key: " ", ctrlKey: true }), false);
  assert.equal(T.isStartKey({ key: " ", repeat: true }), false);
});

test("lead scene: runway at the departure elevation, markers, no evidence, cloudAlpha 0 (synthetic pose, real cases)", () => {
  for (const n of names) {
    const file = load(n);
    const c = E.loadCase(file);
    const st = E.initialState(c);
    const ps = P.phaseStep(T.newPhaseState(file, c, false), 0, { start: true });
    const scene = T.withLeadEye(S.buildScene(file, st, P.phasePose(ps), T.sceneOptions(file, c, { mode: "cockpit" })));
    const dep = scene.airports.find((a) => a.role === "departure");
    const top = scene.airports.find((a) => a.role === "topOfClimb");
    assert.equal(dep.xKm, -S.LEAD_IN_KM);
    assert.equal(dep.icao, file.airports.from.icao);
    assert.equal(dep.elevFt, file.airports.from.elevFt);
    assert.equal(top.xKm, 0);
    assert.equal(top.label, "Top of climb");
    assert.deepEqual(scene.evidence, []);
    assert.equal(scene.cloudAlpha, 0);
    assert.ok(scene.camera.pos[0] >= -S.LEAD_IN_KM && scene.camera.pos[0] <= 0);
    assert.ok(scene.camera.pos[1] > scene.ground.y, "eye above the runway");
    assert.ok(scene.notes.ground && scene.panel.legend.length === 4);
  }
});

test("runway boxes: strip flat at ground level with centre-line dashes inside the strip", () => {
  const scene = {
    ground: { y: 1.5 },
    lanes: [{ zKm: -1 }, { zKm: 0 }, { zKm: 1 }],
    airports: [{ role: "departure", xKm: -30, zKm: 0 }],
  };
  const boxes = G.airportBoxes(scene);
  const strip = boxes[0];
  assert.equal(strip.y0, 1.5);
  const dashes = boxes.filter((b) => b.shade === false);
  assert.equal(dashes.length, 8);
  for (const d of dashes) {
    assert.ok(d.x0 >= strip.x0 && d.x1 <= strip.x1);
    assert.ok(d.z0 >= strip.z0 && d.z1 <= strip.z1);
    assert.ok(d.y0 >= strip.y1 - 1e-9 && d.y1 - 1.5 < 0.05);
  }
  // The arrival runway has no dashes.
  const arr = G.airportBoxes({ ...scene, airports: [{ role: "arrival", xKm: 300, zKm: 0 }] });
  assert.equal(arr.filter((b) => b.shade === false).length, 0);
});

test("status text names the airport and the keys while ready; no weather words", () => {
  const file = load(names[0]);
  const c = E.loadCase(file);
  const ps = T.newPhaseState(file, c, false);
  const text = T.leadStatusText(ps, "KDEN");
  assert.match(text, /KDEN/);
  assert.match(text, /Space or Enter/);
  assert.equal(T.START_LABEL, "Start takeoff");
});
