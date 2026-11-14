// Task 15.5: DOM-free logic of the cruise camera, the view mode choice and the Why cards.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as engine from "../../static/cloud-dive/engine.js";
import * as S from "../../static/cloud-dive/scene.js";
import {
  createCruiseCamera, positionKm, eyePosition, FOLLOW_TAU_MS, STOP_EASE_MS, SETTLE_KM,
} from "../../static/cloud-dive/cruise-camera.js";
import { chooseView, buttonLabel, viewKeyApplies, VIEW_NOTICE } from "../../static/cloud-dive/view-mode.js";
import { WHY_CARDS } from "../../static/cloud-dive/why.js";
import { motionFrac } from "../../static/cloud-dive/view-helpers.js";
import { TICK_MS } from "../../static/cloud-dive/controller.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const casesDir = path.resolve(here, "../../static/cloud-dive/cases");
const names = readdirSync(casesDir).filter((n) => /^\d.*\.json$/.test(n));
const loadCase = (n) => engine.loadCase(JSON.parse(readFileSync(path.join(casesDir, n), "utf8")));

// Synthetic route (hand built): 10 km steps, 100 km long.
const syn = { stepKm: 10, distanceKm: 100, lanesKm: [-30, -15, 0, 15, 30] };

test("positionKm blends from the previous to the current step and stays on the route", () => {
  assert.equal(positionKm(syn, 3, 4, 0), 30);
  assert.equal(positionKm(syn, 3, 4, 0.5), 35);
  assert.equal(positionKm(syn, 3, 4, 1), 40);
  assert.equal(positionKm(syn, null, 4, 0.3), 40);
  assert.equal(positionKm(syn, 9, 10, 1), 100);
  assert.equal(positionKm(syn, 9, 15, 1), 100);
  assert.equal(positionKm(syn, 3, 4, NaN), 40);
});

test("camera follows the target while running, with a lag that stays behind the aircraft", () => {
  const cam = createCruiseCamera();
  let t = 0;
  let target = 0;
  let x = cam.update({ nowMs: t, targetKm: target, running: true });
  assert.equal(x, 0);
  for (let i = 0; i < 300; i++) {
    t += 16;
    target += (10 / TICK_MS) * 16; // 50 km/s
    const prev = x;
    x = cam.update({ nowMs: t, targetKm: target, running: true });
    assert.ok(x >= prev, "never moves backwards");
    assert.ok(x <= target, "never ahead of the aircraft");
  }
  const lag = target - x;
  assert.ok(lag > 0 && lag < 50 * (FOLLOW_TAU_MS / 1000) * 1.2, `steady lag ${lag}`);
});

test("camera comes to rest at the aircraft position within 1.5 s of a stop (R15.8)", () => {
  const cam = createCruiseCamera();
  let t = 0;
  let target = 0;
  cam.update({ nowMs: t, targetKm: 0, running: true });
  for (let i = 0; i < 200; i++) {
    t += 16;
    target += 0.8;
    cam.update({ nowMs: t, targetKm: target, running: true });
  }
  const stopAt = t;
  assert.equal(cam.settled(target), false);
  let x = cam.x;
  let settledAt = null;
  for (let ms = 16; ms <= STOP_EASE_MS + 100; ms += 16) {
    const prev = x;
    x = cam.update({ nowMs: stopAt + ms, targetKm: target, running: false });
    assert.ok(x >= prev && x <= target);
    if (settledAt === null && target - x < SETTLE_KM) settledAt = ms;
  }
  assert.ok(settledAt !== null && settledAt <= STOP_EASE_MS, `settled at ${settledAt} ms`);
  assert.equal(x, target);
  assert.equal(cam.settled(target), true);
});

test("camera slows down smoothly: speed after the stop is lower than at the stop and decreases", () => {
  const cam = createCruiseCamera();
  let t = 0;
  let target = 0;
  cam.update({ nowMs: t, targetKm: 0, running: true });
  for (let i = 0; i < 100; i++) {
    t += 16;
    target += 0.8;
    cam.update({ nowMs: t, targetKm: target, running: true });
  }
  const speeds = [];
  let x = cam.x;
  for (let i = 0; i < 40; i++) {
    t += 16;
    const nx = cam.update({ nowMs: t, targetKm: target, running: false });
    speeds.push(nx - x);
    x = nx;
  }
  for (let i = 1; i < speeds.length; i++) assert.ok(speeds[i] <= speeds[i - 1] + 1e-9, "speed does not grow");
  assert.ok(speeds[0] < 0.8, "slower than the running speed from the first frame");
});

test("snap, reset and a target behind the eye put the eye at the target", () => {
  const cam = createCruiseCamera();
  assert.equal(cam.update({ nowMs: 0, targetKm: 50, running: true }), 50);
  assert.equal(cam.update({ nowMs: 16, targetKm: 80, running: true, snap: true }), 80);
  assert.equal(cam.update({ nowMs: 32, targetKm: 0, running: false }), 0); // new flight
  cam.reset();
  assert.equal(cam.x, null);
  assert.equal(cam.update({ nowMs: 0, targetKm: 20, running: false }), 20);
  assert.equal(cam.update({ nowMs: 10, targetKm: NaN, running: true }), 20);
});

test("camera at rest stays at the target (paused at the start)", () => {
  const cam = createCruiseCamera();
  cam.update({ nowMs: 0, targetKm: 0, running: false });
  for (let ms = 16; ms < 2000; ms += 16) assert.equal(cam.update({ nowMs: ms, targetKm: 0, running: false }), 0);
  assert.equal(cam.settled(0), true);
});

test("motionFrac drives the target: reduced motion jumps to the current step", () => {
  assert.equal(positionKm(syn, 3, 4, motionFrac(0, TICK_MS, true)), 40);
  assert.equal(positionKm(syn, 3, 4, motionFrac(TICK_MS / 2, TICK_MS, false)), 35);
});

test("eyePosition blends altitude and lane, applies the display scales, and agrees with scene.js at frac 1", () => {
  const from = { altFt: 10000, lane: 1 };
  const to = { altFt: 11000, lane: 2 };
  const [x, y, z] = eyePosition(syn, 42, from, to, 0.5);
  assert.equal(x, 42);
  assert.ok(Math.abs(y - S.ftToDisplayKm(10500)) < 1e-9);
  assert.ok(Math.abs(z - S.laneToDisplayKm(-7.5)) < 1e-9);
  assert.deepEqual(eyePosition(syn, 0, null, to, 0.2), [0, S.ftToDisplayKm(11000), S.laneToDisplayKm(0)]);
  for (const n of names) {
    const c = loadCase(n);
    const st = engine.initialState(c);
    const scene = S.buildScene(JSON.parse(readFileSync(path.join(casesDir, n), "utf8")), st, { phase: "cruise", frac: 0 }, { engineCase: c });
    const pos = eyePosition(c, st.step * c.stepKm, null, { altFt: c.altsFt[st.alt], lane: st.lane }, 1);
    assert.deepEqual(pos, scene.camera.pos, `${n}: eye at engine step 0 equals the scene camera`);
  }
});

test("chooseView: cockpit is the default once the 3D layer is ready, the 2D view is the fallback with a notice", () => {
  assert.deepEqual(chooseView({ status: "ready", wants2d: false }), { view: "cockpit", notice: null, canToggle: true });
  assert.deepEqual(chooseView({ status: "ready", wants2d: true }), { view: "2d", notice: null, canToggle: true });
  const noGl = chooseView({ status: "failed", reason: "no-webgl", wants2d: false });
  assert.equal(noGl.view, "2d");
  assert.equal(noGl.notice, VIEW_NOTICE["no-webgl"]);
  assert.equal(noGl.canToggle, false);
  const lost = chooseView({ status: "failed", reason: "load-failed", wants2d: false });
  assert.equal(lost.view, "2d");
  assert.equal(lost.notice, VIEW_NOTICE["load-failed"]);
  assert.equal(chooseView({ status: "failed", reason: "other" }).notice, VIEW_NOTICE["load-failed"]);
  for (const status of ["idle", "loading"]) {
    assert.deepEqual(chooseView({ status, wants2d: false }), { view: "2d", notice: null, canToggle: false });
  }
  for (const text of Object.values(VIEW_NOTICE)) assert.match(text, /same flight with the same costs/);
});

test("view button label names the other view; key V needs a flight and a ready 3D layer", () => {
  assert.match(buttonLabel("cockpit"), /^2D view/);
  assert.match(buttonLabel("2d"), /^Cockpit view/);
  assert.equal(viewKeyApplies("v", { flightOn: true, canToggle: true }), true);
  assert.equal(viewKeyApplies("V", { flightOn: true, canToggle: true }), true);
  assert.equal(viewKeyApplies("v", { flightOn: false, canToggle: true }), false);
  assert.equal(viewKeyApplies("v", { flightOn: true, canToggle: false }), false);
  assert.equal(viewKeyApplies("m", { flightOn: true, canToggle: true }), false);
});

test("Why cards: cruise level, flat ground and display scales are present and say what the requirements ask", () => {
  const byId = Object.fromEntries(WHY_CARDS.map((c) => [c.id, c.paragraphs.join(" ")]));
  assert.match(byId["why-cruise-level"], /cruise level/);
  assert.match(byId["why-cruise-level"], /altitude block/);
  assert.match(byId["why-cruise-level"], /below airline cruise level/);
  assert.match(byId["why-flat-ground"], /flat ground/);
  assert.match(byId["why-flat-ground"], /Rocky Mountains/);
  assert.match(byId["why-flat-ground"], /Denver/);
  const scale = byId["why-display-scale"];
  assert.ok(scale.includes(`${S.VEX} times taller`));
  assert.ok(scale.includes(`${S.LATK} times as wide`));
  assert.ok(scale.includes(`${S.LEAD_IN_KM} km`));
  assert.equal(new Set(WHY_CARDS.map((c) => c.id)).size, WHY_CARDS.length);
});
