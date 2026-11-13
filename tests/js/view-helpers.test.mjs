// Task 11.4: DOM-free helpers of the map layout (track, smooth motion, text alternative, image names).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as E from "../../static/cloud-dive/engine.js";
import { updateTrack, motionFrac, describeMap, imageNames, computeCanvasSize, MAX_CANVAS_PX, routeKey, firstFocusable } from "../../static/cloud-dive/view-helpers.js";

const casesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../static/cloud-dive/cases");
const caseName = readdirSync(casesDir).find((n) => n.endsWith(".json") && n !== "index.json" && n !== "basemap.json");
const file = JSON.parse(readFileSync(path.join(casesDir, caseName), "utf8"));
const c = E.loadCase(file);

test("updateTrack: appends per step, keeps the array when unchanged, restarts on a new flight", () => {
  let t = updateTrack([], { lane: 2, step: 0 });
  assert.deepEqual(t, [{ lane: 2, step: 0 }]);
  const same = updateTrack(t, { lane: 2, step: 0 });
  assert.equal(same, t);
  t = updateTrack(t, { lane: 2, step: 1 });
  t = updateTrack(t, { lane: 3, step: 2 });
  assert.deepEqual(t.map((p) => p.lane), [2, 2, 3]);
  assert.deepEqual(updateTrack(t, { lane: 1, step: 0 }), [{ lane: 1, step: 0 }]);
});

test("motionFrac: linear over tickMs, clamped, and a jump under reduced motion", () => {
  assert.equal(motionFrac(0, 200, false), 0);
  assert.equal(motionFrac(100, 200, false), 0.5);
  assert.equal(motionFrac(500, 200, false), 1);
  assert.equal(motionFrac(-5, 200, false), 0);
  assert.equal(motionFrac(50, 200, true), 1);
  assert.equal(motionFrac(50, 0, false), 1);
});

test("describeMap: lane, distance, altitude and the next three evidence levels", () => {
  const state = { ...E.initialState(c), step: 4, lane: 1, alt: 2 };
  const text = describeMap(file, c, state);
  assert.match(text, /lane 2 of /);
  assert.ok(text.includes(`${Math.round(E.stateDistanceKm(state))} of ${Math.round(c.distanceKm)} km`));
  assert.ok(text.includes(Math.round(c.altsFt[2]).toLocaleString("en-US")));
  for (let i = 0; i < 3; i++) {
    const name = file.rule.levels[E.levelAt(c, 1, 4 + i, 2)];
    assert.ok(text.includes(`${i + 1}: ${name}`), `missing cell ${i + 1}`);
  }
  assert.doesNotMatch(text, /\b(safe|risk|severe|moderate|likely|recommend)/i);
});

test("describeMap: near the end fewer cells are named, at the end none remain", () => {
  const nearEnd = describeMap(file, c, { ...E.initialState(c), step: c.nSteps - 1 });
  assert.match(nearEnd, /next 1 segment /);
  const end = describeMap(file, c, { ...E.initialState(c), step: c.nSteps });
  assert.match(end, /No segments remain/);
  assert.equal(describeMap(file, null, null), "");
});

test("imageNames accepts plain png names only (own static files, R13.8)", () => {
  assert.deepEqual(imageNames({ map: { images: { ir: "a.ir.png", phase: "a.phase.png" } } }), { ir: "a.ir.png", phase: "a.phase.png" });
  assert.deepEqual(imageNames({ map: { images: { ir: "https://x.test/a.png", phase: "../a.png" } } }), {});
  assert.deepEqual(imageNames({}), {});
});

test("computeCanvasSize: multiplies the CSS box by the device pixel ratio and rounds to integers", () => {
  assert.deepEqual(computeCanvasSize(800, 400, 2), { width: 1600, height: 800, scale: 2, cssW: 800, cssH: 400 });
  const r = computeCanvasSize(333.4, 100.6, 1.5);
  assert.equal(r.width, 500);
  assert.equal(r.height, 152);
  assert.equal(r.cssW, 333);
  assert.equal(r.cssH, 101);
});

test("computeCanvasSize: clamps zero, negative and non-finite sizes and ratios", () => {
  assert.deepEqual(computeCanvasSize(0, -5, 1), { width: 1, height: 1, scale: 1, cssW: 1, cssH: 1 });
  assert.equal(computeCanvasSize(NaN, Infinity, NaN).scale, 1);
  assert.equal(computeCanvasSize(100, 100, 0.5).scale, 1);
  assert.equal(computeCanvasSize(100, 100, 9).scale, 4);
  assert.equal(computeCanvasSize(5000, 5000, 4).width, MAX_CANVAS_PX);
});

// Task 12.3: key routing with dialogs.
test("routeKey: with no dialog open game keys go to the game and L opens Legend", () => {
  for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "a", "A", " ", "m", "M"]) {
    assert.equal(routeKey({ key }, null), "game", key);
  }
  assert.equal(routeKey({ key: "l" }, null), "toggle-legend");
  assert.equal(routeKey({ key: "L" }, undefined), "toggle-legend");
});

test("routeKey: while any dialog is open no key reaches the game", () => {
  for (const dlg of ["report", "why", "sources", "legend"]) {
    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "a", "A", " ", "m", "M", "Escape", "Tab"]) {
      assert.equal(routeKey({ key }, dlg), "dialog", `${dlg} ${key}`);
    }
  }
});

test("routeKey: L closes Legend but is ignored by the other dialogs", () => {
  assert.equal(routeKey({ key: "l" }, "legend"), "toggle-legend");
  for (const dlg of ["report", "why", "sources"]) assert.equal(routeKey({ key: "l" }, dlg), "dialog");
});

test("routeKey: modified or handled keys are ignored", () => {
  assert.equal(routeKey({ key: "l", ctrlKey: true }, null), "ignore");
  assert.equal(routeKey({ key: "a", altKey: true }, null), "ignore");
  assert.equal(routeKey({ key: "a", metaKey: true }, "report"), "ignore");
  assert.equal(routeKey({ key: "a", defaultPrevented: true }, null), "ignore");
  assert.equal(routeKey(null, null), "ignore");
});

test("firstFocusable: skips null, hidden and disabled candidates", () => {
  const go = { disabled: true };
  const back = { hidden: false, disabled: false };
  assert.equal(firstFocusable([null, { hidden: true }, go, back]), back);
  assert.equal(firstFocusable([go, null]), null);
});
