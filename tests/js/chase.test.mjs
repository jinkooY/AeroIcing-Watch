// Task 19.1: DOM-free helpers of the chase view (key C, outside camera, generic aircraft model). R16.11, R16.1.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as engine from "../../static/cloud-dive/engine.js";
import * as S from "../../static/cloud-dive/scene.js";
import {
  chaseCamera, aircraftBoxes, AIRCRAFT_TRIANGLES, chaseBudget, chaseKeyApplies, toggleMode, normalizeMode,
  CHASE_BACK_KM, CHASE_UP_KM,
} from "../../static/cloud-dive/chase.js";
import { keyAction } from "../../static/cloud-dive/gate-controls.js";
import { routeKey } from "../../static/cloud-dive/view-helpers.js";
import { viewKeyApplies } from "../../static/cloud-dive/view-mode.js";
import { BOX_TRIANGLES } from "../../static/cloud-dive/cockpit-geometry.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const casesDir = path.resolve(here, "../../static/cloud-dive/cases");
const name = readdirSync(casesDir).filter((n) => /^\d.*\.json$/.test(n))[0];
const file = JSON.parse(readFileSync(path.join(casesDir, name), "utf8"));

test("chase camera sits behind and above the aircraft and looks down at it (real case pose)", () => {
  const c = engine.loadCase(file);
  const sc = S.buildScene(file, engine.initialState(c), { phase: "cruise" }, { mode: "chase" });
  const cam = chaseCamera(sc.camera);
  assert.ok(cam.pos[0] < sc.camera.pos[0]);
  assert.equal(cam.pos[1], Math.round((sc.camera.pos[1] + CHASE_UP_KM) * 1e6) / 1e6);
  assert.equal(cam.pos[2], sc.camera.pos[2]);
  assert.ok(cam.pitchDeg < 0);
  assert.equal(cam.rollDeg, 0);
  assert.ok(Math.abs(sc.camera.pos[0] - cam.pos[0] - CHASE_BACK_KM) < 1e-6);
});

test("chase camera follows the heading and is deterministic", () => {
  const pose = { pos: [10, 5, 2], yawDeg: 90, pitchDeg: 0, rollDeg: 5, fovDeg: 75 };
  const a = chaseCamera(pose);
  assert.deepEqual(a, chaseCamera(pose));
  assert.ok(Math.abs(a.pos[0] - 10) < 1e-6);
  assert.ok(Math.abs(a.pos[2] - (2 - CHASE_BACK_KM)) < 1e-6);
  assert.ok(Object.values(a).flat().every(Number.isFinite));
  assert.ok(chaseCamera(null).pos.every(Number.isFinite));
});

test("aircraft model: few triangles, finite, centred on the pose, no marks", () => {
  const boxes = aircraftBoxes([3, 4, 5]);
  assert.equal(AIRCRAFT_TRIANGLES, boxes.length * BOX_TRIANGLES);
  assert.ok(AIRCRAFT_TRIANGLES > 0 && AIRCRAFT_TRIANGLES <= 200);
  assert.ok(chaseBudget(S.MAX_TRIANGLES) + AIRCRAFT_TRIANGLES <= S.MAX_TRIANGLES);
  const cx = boxes.map((b) => (b.x0 + b.x1) / 2);
  assert.ok(Math.min(...cx) < 3 && Math.max(...cx) > 3 - 0.2);
  for (const b of boxes) {
    assert.ok(Object.values(b).flat().every((v) => v !== undefined && (typeof v !== "number" || Number.isFinite(v))));
    assert.ok(!("text" in b) && !("texture" in b));
  }
});

test("scene mode field: default cockpit, chase accepted, deterministic, engine state untouched", () => {
  const c = engine.loadCase(file);
  const st = Object.freeze({ ...engine.initialState(c) });
  const before = JSON.stringify(st);
  const a = S.buildScene(file, st, { phase: "cruise" }, {});
  const b = S.buildScene(file, st, { phase: "cruise" }, { mode: "chase" });
  assert.equal(a.mode, "cockpit");
  assert.equal(b.mode, "chase");
  assert.equal(S.buildScene(file, st, { phase: "cruise" }, { mode: "bogus" }).mode, "cockpit");
  assert.deepEqual(b, S.buildScene(file, st, { phase: "cruise" }, { mode: "chase" }));
  assert.deepEqual({ ...a, mode: "x" }, { ...b, mode: "x" }); // only the mode differs: effects and panel agree
  assert.equal(JSON.stringify(st), before);
  assert.equal(toggleMode("cockpit"), "chase");
  assert.equal(toggleMode("chase"), "cockpit");
  assert.equal(normalizeMode("x"), "cockpit");
});

test("key C does not clash with the existing keys", () => {
  for (const k of ["c", "C"]) {
    assert.equal(keyAction(k), null);
    assert.equal(viewKeyApplies(k, { flightOn: true, canToggle: true }), false);
    assert.equal(routeKey({ key: k }, null), "game");
    assert.ok(chaseKeyApplies(k, { flightOn: true, cockpitView: true }));
  }
  for (const k of ["l", "L", "v", "V", "m", "M", "a", "A", " ", "ArrowUp", "Escape"]) {
    assert.equal(chaseKeyApplies(k, { flightOn: true, cockpitView: true }), false, k);
  }
  assert.equal(chaseKeyApplies("c", { flightOn: false, cockpitView: true }), false);
  assert.equal(chaseKeyApplies("c", { flightOn: true, cockpitView: false }), false);
});

// Task 19.2: CD-P23 scene purity in chase mode, over every real case.
const deepFreeze = (o) => {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
};
const finiteAll = (v) => {
  if (typeof v === "number") return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(finiteAll);
  if (v && typeof v === "object") return Object.values(v).every(finiteAll);
  return true;
};
for (const n of readdirSync(casesDir).filter((x) => /^\d.*\.json$/.test(x))) {
  test(`CD-P23 chase mode ${n}: mode field, deterministic, frozen inputs, finite, only mode differs from cockpit`, () => {
    const f = deepFreeze(JSON.parse(readFileSync(path.join(casesDir, n), "utf8")));
    const c = engine.loadCase(f);
    const st = deepFreeze(engine.initialState(c));
    const pose = deepFreeze({ phase: "cruise", frac: 0.5 });
    const a = S.buildScene(f, st, pose, { departureElevFt: 13, mode: "chase" });
    const b = S.buildScene(f, st, pose, { departureElevFt: 13, mode: "chase" });
    const k = S.buildScene(f, st, pose, { departureElevFt: 13, mode: "cockpit" });
    assert.equal(a.mode, "chase");
    assert.equal(k.mode, "cockpit");
    assert.deepEqual(a, b);
    assert.ok(finiteAll(a));
    assert.deepEqual({ ...a, mode: 0 }, { ...k, mode: 0 });
  });
}
