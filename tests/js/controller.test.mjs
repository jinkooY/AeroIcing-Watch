// Node tests for static/cloud-dive/controller.js on a REAL exported case (task 8.3).
// Run: node --test tests/js/controller.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as E from "../../static/cloud-dive/engine.js";
import { createController } from "../../static/cloud-dive/controller.js";

const casesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../static/cloud-dive/cases");
const loadCase = () => E.loadCase(JSON.parse(readFileSync(path.join(casesDir, "20261101-kden-klax-2100z.json"), "utf8")));

// Manual scheduler: one pending callback at a time; fire() runs it.
function harness() {
  const c = loadCase();
  let state = E.initialState(c);
  let pending = null;
  const modes = [];
  const ctl = createController({
    getCase: () => c,
    getState: () => state,
    setState: (s) => { state = s; },
    onChange: () => modes.push(ctl.getMode()),
    schedule: (fn) => { pending = fn; return fn; },
    cancel: (h) => { if (pending === h) pending = null; },
  });
  const fire = () => { const fn = pending; pending = null; if (fn) fn(); return Boolean(fn); };
  return { c, ctl, fire, get state() { return state; }, set state(s) { state = s; }, get pending() { return pending; }, modes };
}

test("fast-forward flies one step per tick and stops at the same entry gate as runUntilGate", () => {
  const h = harness();
  const expected = E.runUntilGate(h.c, E.initialState(h.c));
  h.ctl.run();
  assert.equal(h.ctl.getMode(), "running");
  let guard = 0;
  while (h.ctl.getMode() === "running" && guard++ < 1000) h.fire();
  assert.equal(h.ctl.getMode(), "gate");
  assert.equal(h.ctl.getReason(), expected.reasons[0]);
  assert.deepEqual(h.ctl.getReasons(), expected.reasons);
  assert.deepEqual(h.state, expected.state);
  assert.equal(h.pending, null, "no timer while stopped at a gate");
});

test("pause stops between steps and continue resumes without losing a step", () => {
  const h = harness();
  h.ctl.run();
  h.fire(); h.fire();
  const stepAtPause = h.state.step;
  h.ctl.pause();
  assert.equal(h.ctl.getMode(), "paused");
  assert.equal(h.fire(), false, "pending tick was cancelled");
  assert.equal(h.state.step, stepAtPause);
  h.ctl.run();
  h.fire();
  assert.equal(h.state.step, stepAtPause + 1);
});

test("continue from a gate always flies at least one segment and does not repeat the gate", () => {
  const h = harness();
  h.ctl.run();
  while (h.ctl.getMode() === "running") h.fire();
  const gateStep = h.state.step;
  h.ctl.run();
  h.fire();
  assert.ok(h.state.step > gateStep);
});

test("target edits clamp, apply from the next step, and never move the aircraft by themselves", () => {
  const h = harness();
  const before = h.state;
  h.ctl.moveLane(-99);
  h.ctl.moveAlt(99);
  h.ctl.toggleAntiIce();
  assert.equal(h.state.targetLane, 0);
  assert.equal(h.state.targetAlt, h.c.nAlts - 1);
  assert.equal(h.state.antiIce, true);
  assert.equal(h.state.lane, before.lane);
  assert.equal(h.state.step, 0);
  h.ctl.run();
  h.fire();
  assert.ok(Math.abs(h.state.lane - before.lane) <= 1 && Math.abs(h.state.alt - before.alt) <= 1);
});

test("a replaced flight resets the controller to paused", () => {
  const h = harness();
  h.ctl.run();
  h.fire();
  h.state = E.initialState(h.c); // the app opens a new flight
  h.ctl.sync();
  assert.equal(h.ctl.getMode(), "paused");
  assert.equal(h.pending, null);
});

test("anti-ice on from the start flies to arrival or exit gate and ends in 'ended' with a status reason", () => {
  const h = harness();
  h.ctl.toggleAntiIce();
  let guard = 0;
  for (;;) {
    h.ctl.run();
    while (h.ctl.getMode() === "running" && guard++ < 5000) h.fire();
    if (h.ctl.getMode() !== "gate") break;
  }
  assert.equal(h.ctl.getMode(), "ended");
  assert.equal(h.ctl.getReason(), "arrived");
  assert.equal(h.state.status, "arrived");
});
