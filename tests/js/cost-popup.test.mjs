// Task 16.7: cost pop-up helper and property CD-P32 (R18.5, R6.5).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as E from "../../static/cloud-dive/engine.js";
import { segmentCostUsd, popupText, popupFor } from "../../static/cloud-dive/cost-popup.js";

const casesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../static/cloud-dive/cases");
const names = readdirSync(casesDir).filter((n) => /^\d.*\.json$/.test(n));
const file = JSON.parse(readFileSync(path.join(casesDir, names[0]), "utf8"));
const c = E.loadCase(file);

// Small deterministic generator (no library needed).
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

test("text is '+$N this segment' with a rounded whole number", () => {
  assert.equal(popupText(12.4), "+$12 this segment");
  assert.equal(popupText(1234.6), "+$1,235 this segment");
  assert.equal(popupText(NaN), "+$0 this segment");
});

test("CD-P32: N is the component sum between stops, never negative, no preview at a gate (real case)", () => {
  const rand = rng(32);
  for (let run = 0; run < 25; run++) {
    let st = E.initialState(c);
    let stop = null;
    let guard = 0;
    while (st.status === "flying" && guard++ < 400) {
      // random choices between steps
      if (rand() < 0.4) st = E.setTargets(c, st, Math.floor(rand() * c.nLanes), Math.floor(rand() * c.altsFt.length), rand() < 0.5);
      const before = st;
      const frozen = JSON.stringify(st);
      st = E.step(c, st);
      const burst = rand() < 0.5; // stop here or keep running
      if (!burst && st.status === "flying") continue;
      const n = segmentCostUsd(c, stop, st);
      assert.ok(n >= 0);
      const expected = E.totalUsd(c, st) - E.totalUsd(c, stop || E.initialState(c));
      assert.ok(Math.abs(n - expected) < 1e-6, `${n} vs ${expected}`);
      assert.ok(n >= 0 && Number.isFinite(n));
      const pop = popupFor(c, stop, st, true);
      if (pop) assert.equal(pop.usd, n);
      assert.equal(popupFor(c, stop, st, false), null); // fast-forward shows nothing
      // A choice at the gate changes no number: the pop-up depends only on the two stops that happened.
      const edited = E.setTargets(c, st, 0, 0, !st.antiIce);
      const again = popupFor(c, stop, edited, true);
      assert.equal(again ? again.usd : 0, pop ? pop.usd : 0);
      assert.equal(popupFor(c, edited, st, true), null); // nothing new has been flown since this stop
      assert.equal(JSON.stringify(before), frozen); // inputs untouched
      stop = st;
    }
  }
});

test("no pop-up when the flight did not advance, or when nothing was spent", () => {
  const s0 = E.initialState(c);
  assert.equal(popupFor(c, null, s0, true), null);
  assert.equal(popupFor(c, s0, s0, true), null);
  assert.equal(popupFor(c, null, null, true), null);
});

test("diverted flight counts the diversion charge once", () => {
  const prev = { ...E.initialState(c), step: 3 };
  const cur = { ...prev, step: 4, status: "diverted" };
  assert.equal(segmentCostUsd(c, prev, cur), c.params.diversionUsd);
});
