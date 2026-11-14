// Node tests for static/cloud-dive/gate-controls.js on a REAL exported case (task 15.4).
// CD-P27: any sequence of panel actions gives the same engine targets and the same flight as the matching
// 2D actions; targets stay inside the corridor and the block. Run: node --test tests/js/gate-controls.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as E from "../../static/cloud-dive/engine.js";
import { createController } from "../../static/cloud-dive/controller.js";
import * as G from "../../static/cloud-dive/gate-controls.js";

const casesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../static/cloud-dive/cases");
const c = E.loadCase(JSON.parse(readFileSync(path.join(casesDir, "20261101-kden-klax-2100z.json"), "utf8")));

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rig() {
  let state = E.initialState(c);
  const ctl = createController({
    getCase: () => c, getState: () => state, setState: (s) => { state = s; },
    schedule: () => 0, cancel: () => {},
  });
  return { ctl, get state() { return state; } };
}

// The matching 2D action: what controls.js did before this task (moveLane, moveAlt, setLane/setAlt, toggle).
function twoD(ctl, st, action) {
  switch (action) {
    case "flyThrough": ctl.setLane(st.lane); ctl.setAlt(st.alt); break;
    case "climbOver": ctl.moveAlt(1); break;
    case "descend": ctl.moveAlt(-1); break;
    case "goLeft": ctl.moveLane(-1); break;
    case "goRight": ctl.moveLane(1); break;
    case "toggleAntiIce": ctl.toggleAntiIce(); break;
  }
}

test("CD-P27 panel actions equal the matching 2D actions and stay inside the corridor and block", () => {
  const rnd = mulberry32(27);
  for (let trial = 0; trial < 60; trial++) {
    const panel = rig();
    const flat = rig();
    let pure = E.initialState(c);
    const len = 1 + Math.floor(rnd() * 25);
    for (let i = 0; i < len; i++) {
      const action = G.ACTIONS[Math.floor(rnd() * G.ACTIONS.length)];
      G.dispatchAction(panel.ctl, () => panel.state, action);
      twoD(flat.ctl, flat.state, action);
      pure = G.applyGateAction(c, pure, action);
      for (const s of [panel.state, flat.state, pure]) {
        assert.ok(s.targetLane >= 0 && s.targetLane <= c.nLanes - 1);
        assert.ok(s.targetAlt >= 0 && s.targetAlt <= c.nAlts - 1);
      }
      assert.deepEqual(panel.state, flat.state);
      assert.deepEqual(panel.state, pure);
    }
    // same targets give the same flight
    let a = panel.state, b = flat.state;
    for (let k = 0; k < 6 && a.status === "flying"; k++) { a = E.step(c, a); b = E.step(c, b); }
    assert.deepEqual(a, b);
  }
});

test("Fly through sets the targets to the current lane and altitude; arrows move one lane or 1,000 ft", () => {
  let st = E.setTargets(c, E.initialState(c), 0, c.nAlts - 1, null);
  st = G.applyGateAction(c, st, "flyThrough");
  assert.equal(st.targetLane, st.lane);
  assert.equal(st.targetAlt, st.alt);
  const up = G.applyGateAction(c, st, "climbOver");
  assert.equal(up.targetAlt, Math.min(st.alt + 1, c.nAlts - 1));
  if (c.nAlts > 1) assert.equal(c.altsFt[1] - c.altsFt[0], 1000);
  const right = G.applyGateAction(c, st, "goRight");
  assert.equal(right.targetLane, Math.min(st.lane + 1, c.nLanes - 1));
  const left = G.applyGateAction(c, st, "goLeft");
  assert.equal(left.targetLane, Math.max(st.lane - 1, 0), "left is toward the lower lane index");
});

test("keys, labels and touch size follow R17", () => {
  assert.equal(G.keyAction("ArrowLeft"), "goLeft");
  assert.equal(G.keyAction("ArrowRight"), "goRight");
  assert.equal(G.keyAction("ArrowUp"), "climbOver");
  assert.equal(G.keyAction("ArrowDown"), "descend");
  assert.equal(G.keyAction("a"), "toggleAntiIce");
  assert.equal(G.keyAction("A"), "toggleAntiIce");
  assert.equal(G.keyAction(" "), "toggleRun");
  assert.equal(G.keyAction("x"), null);
  assert.equal(G.TOUCH_MIN_PX, 44);
  const st = E.initialState(c);
  const labels = G.gateButtons(c, st, "gate").map((b) => b.label);
  assert.deepEqual(labels, ["Fly through", "Climb over", "Descend", "Go left", "Go right", "Anti-ice", "Continue"]);
  assert.equal(G.gateButtons(c, st, "running").at(-1).label, "Pause");
});

test("gate inset shows only at a gate, on the selected lane, and leaves the engine state alone; no cost fields", () => {
  const st = E.setTargets(c, E.initialState(c), c.nLanes - 1, null, null);
  const v = G.insetView({ caseData: {}, engineCase: c, state: st });
  assert.equal(v.state.lane, st.targetLane);
  assert.equal(st.lane, E.initialState(c).lane);
  assert.equal(G.insetVisible("gate"), true);
  assert.equal(G.insetVisible("running"), false);
  for (const b of G.gateButtons(c, st, "gate")) {
    assert.deepEqual(Object.keys(b).sort(), ["action", "disabled", "label"], "no cost or recommendation field");
  }
});
