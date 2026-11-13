// Node tests for static/cloud-dive/engine.js on REAL exported cases (R6.2, R6.4, CD-P14).
// Run: node --test tests/js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as E from "../../static/cloud-dive/engine.js";

const casesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../static/cloud-dive/cases");
const caseFiles = readdirSync(casesDir).filter((f) => f.endsWith(".json") && f !== "index.json" && f !== "basemap.json").sort();
assert.ok(caseFiles.length > 0, "no exported cases found");
const load = (f) => E.loadCase(JSON.parse(readFileSync(path.join(casesDir, f), "utf8")));
const DEN_LAX = "20261101-kden-klax-2100z.json";
const icing = (l) => l === E.POSSIBLE || l === E.OBSERVED;

// Small seeded PRNG (mulberry32), so the random policies are reproducible.
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("gate placement: straight-ahead flight stops at an entry gate within 2 segments before the cloud", () => {
  const c = load(DEN_LAX);
  const start = E.initialState(c);
  const { state, reasons: reason } = E.runUntilGate(c, start);
  assert.deepEqual(reason, ["entry"]);
  const entry = E.entryIndex(c, state);
  assert.notEqual(entry, null);
  assert.ok(entry - 2 <= state.step && state.step <= entry, `stop ${state.step}, entry ${entry}`);
  assert.ok(icing(E.levelAt(c, state.lane, entry, state.alt)), "predicted entry cell must be Possible/Observed");
  assert.equal(state.announcedEntry, entry);
  assert.equal(state.status, "flying");
  // the gate is not re-announced for the same entry cell
  assert.equal(E.gateReason(c, state), null);
});

test("exit gate: with anti-ice on, the first step outside the cloud stops with reason exit", () => {
  const c = load(DEN_LAX);
  let { state, reasons: reason } = E.runUntilGate(c, E.initialState(c));
  assert.deepEqual(reason, ["entry"]);
  state = E.setTargets(c, state, null, null, true);
  let exit = null;
  for (let i = 0; i < 200 && state.status === "flying"; i++) {
    const r = E.runUntilGate(c, state);
    state = r.state;
    if (r.reasons.includes("exit")) { exit = state; break; }
  }
  assert.ok(exit, "expected an exit gate after the first cloud");
  assert.equal(exit.antiIce, true);
  assert.ok(icing(exit.prevLevel), "the exit gate fires at the last cell of the cluster");
  assert.ok(!E.lookaheadLevels(c, exit, E.EXIT_LOOKAHEAD).some(icing));
  assert.equal(exit.ice, 0, "anti-ice on never raises the ice index");
  assert.equal(E.gateReasons(c, { ...exit, antiIce: false }).includes("exit"), false, "exit needs anti-ice on");
});

test("continuing from a gate flies at least one segment", () => {
  const c = load(DEN_LAX);
  let { state } = E.runUntilGate(c, E.initialState(c));
  for (let i = 0; i < 20 && state.status === "flying"; i++) {
    const before = state.step;
    const r = E.runUntilGate(c, state);
    assert.ok(r.state.step >= before + 1, `no progress at step ${before}`);
    state = r.state;
  }
  // also at the start of the flight when the start check is skipped
  const s0 = E.runUntilGate(c, E.initialState(c), { checkStart: false });
  assert.ok(s0.state.step >= 1);
});

test("CD-P14: random gate-driven policies never enter an Observed cell silently (seeded, all real cases)", () => {
  let entriesChecked = 0;
  for (const file of caseFiles) {
    const c = load(file);
    for (let seed = 1; seed <= 40; seed++) {
      const rnd = prng(seed * 7919 + file.length);
      let state = E.initialState(c);
      const stops = [0];
      let guard = 0;
      while (state.status === "flying") {
        assert.ok(++guard < 500, "run did not terminate");
        const lane = Math.floor(rnd() * c.nLanes);
        const alt = Math.floor(rnd() * c.nAlts);
        const ai = rnd() < 0.5;
        const before = E.setTargets(c, state, lane, alt, ai);
        const r = E.runUntilGate(c, before, { checkStart: before.step === 0 });
        state = r.state;
        if (r.reasons.includes("entry") || r.reasons.includes("exit")) stops.push(state.step);
        let replay = before;
        while (replay.step < state.step) {
          const next = E.step(c, replay);
          if (next.prevLevel === E.OBSERVED && !icing(replay.prevLevel) && !replay.antiIce) {
            const entry = replay.step;
            entriesChecked++;
            assert.ok([...stops, before.step].some((g) => entry - 2 <= g && g <= entry),
              `${file} seed ${seed}: silent entry at ${entry}, stops ${stops}`);
          }
          replay = next;
        }
      }
    }
  }
  assert.ok(entriesChecked > 0, "the random policies never entered an Observed cell; test is vacuous");
});
