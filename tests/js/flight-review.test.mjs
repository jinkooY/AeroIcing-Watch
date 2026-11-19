// Revision f (R25): evidence per choice at a gate, and the Best replay in the report. Real case files.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as E from "../../static/cloud-dive/engine.js";
import * as G from "../../static/cloud-dive/gate-controls.js";
import * as S from "../../static/cloud-dive/scene.js";
import * as R from "../../static/cloud-dive/flight-review.js";
import { levelNames } from "../../static/cloud-dive/render.js";
import { createController } from "../../static/cloud-dive/controller.js";

const casesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../static/cloud-dive/cases");
const caseFiles = readdirSync(casesDir).filter((f) => /^\d{8}-.*\.json$/.test(f));
const load = (f) => JSON.parse(readFileSync(path.join(casesDir, f), "utf8"));

test("R25.5 the replayed Best policy costs exactly the stored Best cost, on every case", () => {
  assert.ok(caseFiles.length >= 3);
  for (const f of caseFiles) {
    const file = load(f);
    const c = E.loadCase(file);
    const best = R.replayBest(c, file.references);
    assert.ok(best, f);
    assert.equal(best.final.status, "arrived", f);
    assert.ok(Math.abs(E.totalUsd(c, best.final) - file.references.best.costUsd) < 1e-6, f);
    assert.equal(best.rows.length, c.nSteps, f);
  }
});

// Flies a flight through the real controller with a fake clock, the way the game does, changing settings at gates
// by a fixed script, while the recorder runs on every committed state. Returns the recorder output and final state.
function flyWithController(c, choose) {
  let st = E.initialState(c);
  let flown = [];
  const queue = [];
  const ctl = createController({
    getCase: () => c,
    getState: () => st,
    setState: (next) => { flown = R.recordFlight(flown, st, next); st = next; },
    schedule: (fn) => { queue.push(fn); return queue.length; },
    cancel: () => {},
    tickMs: 0,
  });
  let gates = 0;
  ctl.run();
  for (let i = 0; i < 100000 && queue.length; i++) {
    queue.shift()();
    if (ctl.getMode() === "gate") {
      choose(ctl, gates++, st);
      ctl.run();
    }
  }
  return { flown, st, gates };
}

test("R25.4 the recorder and the replay reproduce a controller flight: same final state, same gates", () => {
  for (const f of caseFiles) {
    const file = load(f);
    const c = E.loadCase(file);
    const script = (ctl, n) => {
      if (n % 3 === 0) ctl.moveAlt(1);
      if (n % 3 === 1) ctl.toggleAntiIce();
      if (n % 3 === 2) ctl.moveLane(n % 2 ? 1 : -1);
    };
    const run = flyWithController(c, script);
    assert.notEqual(run.st.status, "flying", f);
    const replay = R.replayFlown(c, run.flown, run.st);
    assert.ok(replay.matches, `${f}: replay ends in the flight's final state`);
    assert.equal(replay.gates.length, run.gates, `${f}: same number of gates`);
    const review = R.buildReview(c, run.flown, run.st, file.references);
    assert.ok(review, f);
    assert.equal(review.gates.length, run.gates);
    // the gate costs of the player add up to the flight's engine cost
    const sum = review.gates.reduce((a, g) => a + g.youUsd, 0);
    const before = review.gates.length && review.gates[0].step > 0 ? replay.rows[review.gates[0].step - 1].totalUsd : 0;
    assert.ok(Math.abs(sum + before - E.totalUsd(c, run.st)) < 0.01, `${f}: gate costs add up`);
  }
});

test("R25.4 a review needs a matching replay: a broken record gives no review", () => {
  const file = load(caseFiles[0]);
  const c = E.loadCase(file);
  const run = flyWithController(c, () => {});
  const broken = run.flown.map((x, i) => (i === 5 ? { ...x, antiIce: !x.antiIce } : x));
  assert.equal(R.buildReview(c, broken, run.st, file.references), null);
  assert.equal(R.buildReview(c, [], run.st, file.references), null);
});

test("R25.4 the recorder starts a new list for a new flight and ignores a state that did not step", () => {
  const c = E.loadCase(load(caseFiles[0]));
  const s0 = E.initialState(c);
  const s1 = E.step(c, s0);
  let f = R.recordFlight([], s0, s1);
  assert.equal(f.length, 1);
  assert.equal(R.recordFlight(f, s1, E.setTargets(c, s1, null, null, true)), f);
  assert.deepEqual(R.recordFlight(f, s1, E.initialState(c)), []);
  assert.equal(R.recordFlight([{ step: 9 }], s0, s1).length, 1);
});

test("R25.1 each enabled lane or altitude button names the gateLevel at the settings it would set", () => {
  const file = load("20261112-kjfk-kbna-1930z.json");
  const c = E.loadCase(file);
  for (let step = 0; step < c.nSteps; step += 9) {
    for (let lane = 0; lane < c.nLanes; lane++) {
      for (let alt = 0; alt < c.nAlts; alt += 2) {
        const st = E.setTargets(c, { ...E.initialState(c), step }, lane, alt, null);
        const lv = G.choiceLevels(c, st, "gate");
        for (const b of G.gateButtons(c, st, "gate")) {
          if (!G.CHOICE_ACTIONS.includes(b.action)) { assert.equal(lv[b.action], undefined); continue; }
          if (b.disabled) { assert.equal(lv[b.action], undefined, `${b.action} disabled`); continue; }
          const next = G.applyGateAction(c, st, b.action);
          assert.equal(lv[b.action], S.gateLevel(c, next.targetLane, step, next.targetAlt));
        }
      }
    }
  }
});

test("R25.2 the per-choice levels carry no cost, order or preference; the accessible name has the full level name", () => {
  const file = load("20261112-kjfk-kbna-1930z.json");
  const c = E.loadCase(file);
  const st = E.initialState(c);
  const lv = G.choiceLevels(c, st, "gate");
  for (const v of Object.values(lv)) assert.ok(Number.isInteger(v) && v >= 0 && v <= 3);
  const names = levelNames(file);
  for (let level = 0; level < 4; level++) {
    const a = G.choiceAriaLabel("Climb over", level, names, 30);
    assert.equal(a, `Climb over. Next 30 km at that setting: ${names[level]}.`);
    assert.doesNotMatch(a, /\$|best|better|recommend|safe|cheap/i);
  }
  assert.equal(G.choiceAriaLabel("Anti-ice", undefined, names, 30), "Anti-ice");
  assert.deepEqual(G.LEVEL_SHORT, ["Not assessed", "Not indicated", "Possible (forecast)", "Observed (satellite)"]);
  // each short name keeps the start of the case file's level name (Possible ... forecast only; Observed ...)
  for (let level = 0; level < 4; level++) assert.ok(names[level].startsWith(G.LEVEL_SHORT[level].split(" (")[0]), names[level]);
});

test("R25.3 the chart draws inside its canvas, on every case (fake 2D context)", async () => {
  const { drawReview } = await import("../../static/cloud-dive/report-view.js");
  for (const f of caseFiles) {
    const file = load(f);
    const c = E.loadCase(file);
    const run = flyWithController(c, (ctl, n) => { if (n === 0) ctl.toggleAntiIce(); });
    const review = R.buildReview(c, run.flown, run.st, file.references);
    const w = 640, h = 300;
    const ys = [];
    const xs = [];
    const ctx = new Proxy({}, {
      get: (_t, k) => {
        if (k === "fillRect") return (x, y, rw, rh) => { xs.push(x, x + rw); ys.push(y, y + rh); };
        if (k === "fillText") return (_s, x, y) => { xs.push(x); ys.push(y); };
        if (k === "moveTo" || k === "lineTo") return (x, y) => { xs.push(x); ys.push(y); };
        return typeof k === "string" && /^(set|clear|begin|stroke|scale)/.test(k) ? () => {} : undefined;
      },
      set: () => true,
    });
    drawReview(ctx, review, w, h);
    assert.ok(ys.every((y) => Number.isFinite(y) && y >= 0 && y <= h), `${f}: y inside 0..${h}`);
    assert.ok(xs.every((x) => Number.isFinite(x) && x >= 0 && x <= w), `${f}: x inside 0..${w}`);
  }
});

test("R25.3 the review label says game reference, not a procedure", () => {
  assert.equal(R.BEST_LABEL, "Best (game reference, not a procedure)");
  assert.equal(R.settingsText({ lane: 3, altFt: 12000, antiIce: true }), "lane 3, 12,000 ft, anti-ice on");
  assert.equal(R.settingsText(null), "Not available");
});
