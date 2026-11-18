// Revision e (R24): settings line, evidence at the target, key line, cost rules card, altitude readout.
// Real case file (KJFK-KBNA); the states are built with the engine's own setTargets.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as E from "../../static/cloud-dive/engine.js";
import * as G from "../../static/cloud-dive/gate-controls.js";
import * as S from "../../static/cloud-dive/scene.js";
import { levelNames } from "../../static/cloud-dive/render.js";
import { COST_RULES, COST_RULES_TITLE } from "../../static/cloud-dive/cost-rules.js";
import { altitudeReadout } from "../../static/cloud-dive/panel.js";

const casesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../static/cloud-dive/cases");
const file = JSON.parse(readFileSync(path.join(casesDir, "20261112-kjfk-kbna-1930z.json"), "utf8"));
const c = E.loadCase(file);
const names = levelNames(file);

test("R24.1 settings line shows now -> target only when a target differs", () => {
  const st0 = E.initialState(c);
  const [plain] = G.pathLines(G.pathSummary(c, st0), names);
  assert.ok(!plain.includes("\u2192"), plain);
  assert.match(plain, /^Your settings: lane 3, 9,000 ft, anti-ice off\.$/);
  const st1 = E.setTargets(c, st0, st0.lane - 1, st0.alt + 3, true);
  const [changed] = G.pathLines(G.pathSummary(c, st1), names);
  assert.equal(changed, "Your settings: lane 3 \u2192 2, 9,000 ft \u2192 12,000 ft, anti-ice on.");
});

test("R24.2 evidence at the target uses the sky-gate rule, for every lane and altitude at every step", () => {
  for (let step = 0; step < c.nSteps; step += 7) {
    for (let lane = 0; lane < c.nLanes; lane++) {
      for (let alt = 0; alt < c.nAlts; alt++) {
        const st = E.setTargets(c, { ...E.initialState(c), step }, lane, alt, null);
        const s = G.pathSummary(c, st);
        assert.equal(s.aheadLevel, S.gateLevel(c, lane, step, alt));
        assert.equal(G.pathLines(s, names)[1], `Next ${Math.round(S.GATE_LOOKAHEAD_CELLS * c.stepKm)} km at the target: ${names[s.aheadLevel]}.`);
      }
    }
  }
});

test("R24.2 an unknown level never prints an empty name: it falls back to Not assessed", () => {
  const s = { ...G.pathSummary(c, E.initialState(c)), aheadLevel: 99 };
  assert.match(G.pathLines(s, names)[1], /at the target: Not assessed\.$/);
  assert.match(G.pathLines(s, null)[1], /at the target: Not assessed\.$/);
});

test("R24.2 the settings summary carries settings and evidence only (no cost or recommendation field)", () => {
  const s = G.pathSummary(c, E.initialState(c));
  for (const k of Object.keys(s)) assert.ok(!/usd|cost|price|recommend|best|rank|score/i.test(k), k);
  assert.equal(G.pathSummary(null, null), null);
  assert.deepEqual(G.pathLines(null, names), []);
});

test("R24.3 key line names the four keys", () => {
  for (const k of ["\u2191", "\u2193", "\u2190", "\u2192", "A ", "Space"]) assert.ok(G.KEY_HINT.includes(k), k);
});

test("R24.4 cost rules: no dollar value, no number from the flight, no advice", () => {
  const all = [COST_RULES_TITLE, ...COST_RULES].join(" ");
  assert.ok(!all.includes("$"));
  const numbers = all.match(/\d[\d,]*/g) || [];
  assert.deepEqual([...new Set(numbers)].sort(), ["1,000", "100", "50"]);
  assert.ok(!/\b(best|better|should|recommend|avoid|cheapest|optimal)\b/i.test(all), all);
  assert.match(COST_RULES_TITLE, /game model, illustrative/);
});

test("R24.4 cost rules match the engine: anti-ice on stops the ice index, the index never goes down", () => {
  const icing = [];
  for (let lane = 0; lane < c.nLanes; lane++) {
    for (let s = 0; s < c.nSteps; s++) {
      for (let alt = 0; alt < c.nAlts; alt++) {
        const lv = E.levelAt(c, lane, s, alt);
        if (lv === E.OBSERVED || lv === E.POSSIBLE) icing.push([lane, s, alt]);
      }
    }
  }
  assert.ok(icing.length > 0);
  let on = { ...E.initialState(c, true), ice: 30 };
  let off = { ...E.initialState(c, false), ice: 30 };
  for (let i = 0; i < 40; i++) {
    const a = E.step(c, on);
    const b = E.step(c, off);
    assert.equal(a.ice, on.ice, "anti-ice on: the ice index does not rise");
    assert.ok(b.ice >= off.ice, "the ice index does not go down");
    on = a;
    off = b.status === "flying" ? b : off;
  }
});

test("R24.1 altitude readout: arrow in cruise when the target differs, never before cruise", () => {
  const st = E.setTargets(c, E.initialState(c), null, 6, null);
  const view = { engineCase: c, state: st };
  assert.equal(altitudeReadout(9000, "cruise", view), "Altitude (ft): 9,000 \u2192 12,000");
  assert.equal(altitudeReadout(9000, "gate", view), "Altitude (ft): 9,000 \u2192 12,000");
  for (const phase of ["ready", "takeoff", "climb"]) assert.equal(altitudeReadout(4500, phase, view), "Altitude (ft): 4,500");
  assert.equal(altitudeReadout(9000, "cruise", { engineCase: c, state: E.initialState(c) }), "Altitude (ft): 9,000");
});
