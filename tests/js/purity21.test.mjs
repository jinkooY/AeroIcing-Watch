// Task 21.8: CD-P23 scene purity with gates and band weights (R22.4, R22.5, R22.11).
// Real cases and synthetic cases in both satellite array shapes, all inputs deep-frozen.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as E from "../../static/cloud-dive/engine.js";
import * as S from "../../static/cloud-dive/scene.js";

const casesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../static/cloud-dive/cases");
const names = readdirSync(casesDir).filter((n) => /^\d.*\.json$/.test(n));
const load = (n) => JSON.parse(readFileSync(path.join(casesDir, n), "utf8"));
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
const SAT = ["state", "topFt", "baseFt"];

// Synthetic (labelled synthetic): mixed levels per lane, satellite arrays plain or wrapped as {shape, data}.
function synthetic(base, wrapped) {
  const file = structuredClone(base);
  const c = E.loadCase(file);
  const lv = [E.OBSERVED, E.POSSIBLE, E.NOT_ASSESSED, E.NOT_INDICATED, E.OBSERVED];
  const data = file.evidence.data;
  for (let lane = 0; lane < c.nLanes; lane++)
    for (let s = 0; s <= c.nSteps; s++)
      for (let a = 0; a < c.nAlts; a++) data[(lane * (c.nSteps + 1) + s) * c.nAlts + a] = lv[(lane + (a >> 2)) % 5];
  const n = c.nLanes * (c.nSteps + 1);
  const sat = { shape: [c.nLanes, c.nSteps + 1] };
  for (const f of SAT) sat[f] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (i % 3 === 2) continue;
    sat.state[i] = 0; sat.topFt[i] = 20000 + (i % 4) * 500; sat.baseFt[i] = i % 5 === 0 ? null : 14000;
  }
  if (wrapped) for (const f of SAT) sat[f] = { shape: sat.shape, data: sat[f] };
  file.satellite = sat;
  return file;
}

function checkPure(label, raw) {
  const file = deepFreeze(raw);
  const c = E.loadCase(file);
  const before = JSON.stringify(file);
  for (const phase of ["cruise", "gate"]) {
    for (const step of [0, 3, Math.max(0, c.nSteps - 1), c.nSteps]) {
      for (const targetAlt of [0, Math.floor(c.nAlts / 2), c.nAlts - 1]) {
        const st = deepFreeze({ ...E.initialState(c), step, targetAlt });
        const pose = deepFreeze({ phase });
        const opts = deepFreeze({ departureElevFt: 100, arrivalElevFt: 50 });
        const a = S.buildScene(file, st, pose, opts);
        const b = S.buildScene(file, st, pose, opts);
        const tag = `${label} ${phase} step ${step} alt ${targetAlt}`;
        assert.deepEqual(a, b, tag);
        assert.ok(finiteAll(a.gates) && finiteAll(a.evidence) && finiteAll(a.lanes) && finiteAll(a.effects), tag);
        assert.equal(a.gates.length, phase === "gate" ? 5 : 0, tag);
        a.lanes.forEach((l, i) => assert.ok(Math.abs(l.zKm - c.lanesKm[i] * S.LATK) < 1e-6, tag));
        a.gates.forEach((g, i) => assert.ok(Math.abs(g.zKm - c.lanesKm[i] * S.LATK) < 1e-6, tag));
        a.evidence.forEach((e) => assert.ok(e.weight === 1 || e.weight === S.FAR_EVIDENCE_WEIGHT, tag));
      }
    }
  }
  assert.equal(JSON.stringify(file), before, `${label} inputs not mutated`);
}

for (const n of names) test(`CD-P23 gates and weights, real case ${n}, frozen inputs`, () => checkPure(n, load(n)));

test("CD-P23 gates and weights, synthetic, plain and wrapped satellite arrays, frozen inputs", () => {
  for (const [shape, wrapped] of [["plain", false], ["wrapped", true]]) checkPure(`synthetic ${shape}`, synthetic(load(names[0]), wrapped));
});
