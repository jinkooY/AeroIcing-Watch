// Task 21.3: sky gates (design 15.2, R22.4, R22.11, R6.5, R2.5). CD-P33 and the gate clauses of CD-P23, CD-P25, CD-P26.
// Seeded generator (no extra library). Real exported cases; synthetic grids are labelled synthetic.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as E from "../../static/cloud-dive/engine.js";
import * as S from "../../static/cloud-dive/scene.js";
import * as G from "../../static/cloud-dive/cockpit-geometry.js";

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
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const RANK = { [E.OBSERVED]: 4, [E.POSSIBLE]: 3, [E.NOT_ASSESSED]: 2, [E.NOT_INDICATED]: 1 };
const worstOf = (levels) => levels.reduce((w, l) => (RANK[l] > RANK[w] ? l : w));
const gateScene = (file, st) => S.buildScene(file, st, { phase: "gate" }, {});

test("CD-P33 real cases: gate phase gives five gates in lane order, level = worst of the next three cells, exact label, evidence only (150+ draws)", () => {
  let draws = 0;
  for (const n of names) {
    const file = deepFreeze(load(n));
    const c = E.loadCase(file);
    const r = rng(33);
    for (let i = 0; i < 40; i++) {
      const step = Math.floor(r() * (c.nSteps + 1));
      const targetAlt = Math.floor(r() * c.nAlts);
      const st = { ...E.initialState(c), step, targetAlt };
      const sc = gateScene(file, st);
      draws += 1;
      assert.equal(sc.gates.length, 5);
      assert.ok(finiteAll(sc.gates));
      sc.gates.forEach((g, lane) => {
        assert.equal(g.lane, lane);
        assert.equal(g.zKm, sc.lanes[lane].zKm);
        assert.equal(g.altFt, c.altsFt[targetAlt]);
        assert.equal(g.yKm, S.ftToDisplayKm(c.altsFt[targetAlt]));
        const cells = [];
        for (let s = step; s < step + 3 && s <= c.nSteps - 1; s++) cells.push(E.levelAt(c, lane, s, targetAlt));
        const want = cells.length ? worstOf(cells) : E.NOT_ASSESSED;
        assert.equal(g.levelIndex, want);
        assert.equal(g.label, S.levelName(file, want));
        assert.equal(g.level, g.label);
        // evidence only (R6.5, R9.4): no cost, no recommendation, no ranking
        for (const k of Object.keys(g)) assert.ok(!/usd|cost|price|recommend|best|rank|score/i.test(k), k);
      });
      // deterministic and pure
      assert.deepEqual(gateScene(file, st).gates, sc.gates);
      for (const phase of ["ready", "takeoff", "climb", "cruise", "arrival", "diversion", "report"]) {
        assert.deepEqual(S.buildScene(file, st, { phase }, {}).gates, []);
      }
    }
  }
  assert.ok(draws >= 100);
});

test("CD-P33 gates leave the engine, cost, evidence and clouds unchanged (R22.11)", () => {
  const file = load(names[0]);
  const c = E.loadCase(file);
  const st = { ...E.initialState(c), step: 3 };
  const cruise = S.buildScene(file, st, { phase: "cruise" }, {});
  const gate = S.buildScene(file, st, { phase: "gate" }, {});
  const strip = (s) => { const { gates, phase, ...rest } = s; return rest; };
  assert.deepEqual(strip(gate), strip(cruise));
  assert.equal(gate.panel.gate, null);
});

// Synthetic grid (labelled synthetic): levelFn(lane, s, a) -> engine level.
function synth(base, levelFn) {
  const file = structuredClone(base);
  const c = E.loadCase(file);
  const data = file.evidence.data;
  for (let lane = 0; lane < c.nLanes; lane++)
    for (let s = 0; s <= c.nSteps; s++)
      for (let a = 0; a < c.nAlts; a++) data[(lane * (c.nSteps + 1) + s) * c.nAlts + a] = levelFn(lane, s, a);
  return { file, c: E.loadCase(file) };
}

test("CD-P33 synthetic: the four levels, one per lane, and the worst-of-three order", () => {
  const order = [E.OBSERVED, E.POSSIBLE, E.NOT_ASSESSED, E.NOT_INDICATED, E.NOT_INDICATED];
  const { file, c } = synth(load(names[0]), (lane) => order[lane]);
  const g = gateScene(file, { ...E.initialState(c), step: 2, targetAlt: 0 }).gates;
  assert.deepEqual(g.map((x) => x.levelIndex), order);
  // mixed cells in lane 0: clear, clear, Possible -> Possible; clear + Not assessed -> Not assessed
  const mixed = synth(load(names[0]), (lane, s) => (lane === 0 ? (s === 4 ? E.POSSIBLE : E.NOT_INDICATED) : lane === 1 ? (s === 3 ? E.NOT_ASSESSED : E.NOT_INDICATED) : E.NOT_INDICATED));
  const gm = gateScene(mixed.file, { ...E.initialState(mixed.c), step: 2, targetAlt: 0 }).gates;
  assert.equal(gm[0].levelIndex, E.POSSIBLE);
  assert.equal(gm[1].levelIndex, E.NOT_ASSESSED);
  assert.equal(gm[2].levelIndex, E.NOT_INDICATED);
});

test("CD-P33 synthetic: no cell left gives Not assessed, never Not indicated", () => {
  const { file, c } = synth(load(names[0]), () => E.NOT_INDICATED);
  const g = gateScene(file, { ...E.initialState(c), step: c.nSteps, targetAlt: 0 }).gates;
  assert.equal(g.length, 5);
  for (const x of g) {
    assert.equal(x.levelIndex, E.NOT_ASSESSED);
    assert.equal(x.label, S.levelName(file, E.NOT_ASSESSED));
  }
  // only the last cell remains: its level counts, the cells past the end do not
  const last = gateScene(file, { ...E.initialState(c), step: c.nSteps - 1, targetAlt: 0 }).gates;
  for (const x of last) assert.equal(x.levelIndex, E.NOT_INDICATED);
});

test("CD-P25 gate level agrees with levelAt on every real case, step and altitude", () => {
  for (const n of names) {
    const file = load(n);
    const c = E.loadCase(file);
    for (let step = 0; step < c.nSteps; step += Math.max(1, Math.floor(c.nSteps / 7))) {
      for (let a = 0; a < c.nAlts; a += 2) {
        const gates = S.buildGates(file, c, { ...E.initialState(c), step, targetAlt: a }, gateScene(file, E.initialState(c)).lanes, "gate");
        gates.forEach((g) => assert.equal(g.levelIndex, S.gateLevel(c, g.lane, step, a)));
        gates.forEach((g) => assert.ok(g.levelIndex >= 0 && g.levelIndex <= 3));
      }
    }
  }
});

test("gateBoxes: outline for every level, fill only when the level is not Not indicated, 108 or 96 triangles per gate", () => {
  const order = [E.OBSERVED, E.POSSIBLE, E.NOT_ASSESSED, E.NOT_INDICATED, E.NOT_INDICATED];
  const { file, c } = synth(load(names[0]), (lane) => order[lane]);
  const sc = gateScene(file, { ...E.initialState(c), step: 2, targetAlt: 0 });
  const boxes = G.gateBoxes(sc);
  for (const g of sc.gates) {
    const mine = boxes.filter((b) => b.lane === g.lane);
    assert.equal(mine.filter((b) => b.part === "outline").length, 4);
    assert.equal(mine.filter((b) => b.part === "edge").length, 4);
    assert.equal(mine.filter((b) => b.part === "fill").length, g.levelIndex === E.NOT_INDICATED ? 0 : 1);
  }
  assert.equal(boxes.length, 8 * 5 + 3);
  assert.equal(G.gateBoxes({ ...sc, gates: [] }).length, 0);
  assert.equal(G.gateBoxes(S.buildScene(file, E.initialState(c), { phase: "cruise" }, {})).length, 0);
  assert.ok(finiteAll(boxes));
});

test("CD-P26 gates <= 5, one label per gate with the exact level name, gates survive a tight triangle budget", () => {
  for (const n of names) {
    const file = load(n);
    const c = E.loadCase(file);
    const st = { ...E.initialState(c), step: Math.floor(c.nSteps / 3), targetAlt: Math.floor(c.nAlts / 2) };
    const sc = gateScene(file, st);
    const plan = G.buildDrawPlan(sc, { maxTriangles: 2000 });
    assert.ok(sc.gates.length <= 5);
    const lines = plan.labels.filter((l) => l.kind === "gate");
    assert.deepEqual(lines.map((l) => l.text), sc.gates.map((g) => g.label));
    assert.equal(plan.gates.length, G.gateBoxes(sc).length);
    const full = G.buildDrawPlan(sc);
    assert.equal(full.gates.length, plan.gates.length);
    assert.ok(G.buildDrawPlan(S.buildScene(file, st, { phase: "cruise" }, {})).labels.every((l) => l.kind !== "gate"));
  }
});

test("geometryKey changes when a gate level changes and not otherwise", () => {
  const a = synth(load(names[0]), () => E.NOT_INDICATED);
  const b = synth(load(names[0]), (lane) => (lane === 0 ? E.OBSERVED : E.NOT_INDICATED));
  const st = (c) => ({ ...E.initialState(c), step: 2, targetAlt: 0 });
  const ka = G.geometryKey(gateScene(a.file, st(a.c)));
  assert.equal(ka, G.geometryKey(gateScene(a.file, st(a.c))));
  assert.notEqual(ka, G.geometryKey(gateScene(b.file, st(b.c))));
});

test("gate fill textures: Observed diagonal, Not assessed vertical stripes, distinct from the evidence hatch", () => {
  const d = G.diagonalData(32), s = G.stripeData(32), h = G.hatchData(32);
  assert.equal(d.length, 32 * 32 * 4);
  assert.notDeepEqual(d, s);
  assert.notDeepEqual(s, h);
  // stripes: every row is identical (vertical lines)
  for (let y = 1; y < 32; y++) for (let x = 0; x < 32; x++) assert.equal(s[(y * 32 + x) * 4 + 3], s[x * 4 + 3]);
});
test("R22.4 gate outlines: opaque, dark edge under a coloured line, thicker than before; Possible fill opaque dots", () => {
  const order = [E.OBSERVED, E.POSSIBLE, E.NOT_ASSESSED, E.NOT_INDICATED, E.NOT_INDICATED];
  const { file, c } = synth(load(names[0]), (lane) => order[lane]);
  const sc = gateScene(file, { ...E.initialState(c), step: 2, targetAlt: 0 });
  const boxes = G.gateBoxes(sc);
  assert.ok(G.GATE_EDGE_KM >= 0.2 && G.GATE_BAR_KM > 0.08);
  for (const b of boxes.filter((x) => x.part !== "fill")) assert.equal(b.alpha, 1);
  for (const b of boxes.filter((x) => x.part === "edge")) assert.ok(Math.max(...b.color) < 0.2, "edge is dark");
  for (const g of sc.gates) {
    const mine = boxes.filter((b) => b.lane === g.lane);
    const edge = mine.find((b) => b.part === "edge"), line = mine.find((b) => b.part === "outline");
    assert.ok(line.x0 < edge.x0, "coloured line is drawn in front of the edge");
    assert.ok(Math.max(...line.color) > Math.max(...edge.color));
  }
  for (const b of boxes.filter((x) => x.part === "edge")) assert.deepEqual(b.color, [0, 0, 0]);
  // Saturated line colours: one channel at least 0.7 above another, so the line does not match the pale sky.
  for (const lv of [E.OBSERVED, E.POSSIBLE]) { const col = G.GATE_COLOR[lv]; assert.ok(Math.max(...col) - Math.min(...col) >= 0.7); }
  assert.ok(G.GATE_FILL_TILE_KM >= 1.5, "fill pattern repeats are several pixels wide at the gate distance");
  const poss = boxes.find((b) => b.part === "fill" && b.level === E.POSSIBLE);
  assert.equal(poss.alpha, 1);
  const px = G.gateDotData(32);
  const alphas = new Set(); for (let i = 3; i < px.length; i += 4) alphas.add(px[i]);
  assert.ok(alphas.has(255) && Math.max(...[...alphas].filter((a) => a !== 255)) < 80, "dots opaque on a faint haze");
});
test("R22.4 gate label sits wholly above the frame top; R22.10 base labels are hidden while gates are shown", () => {
  const { file, c } = synth(load(names[0]), () => E.POSSIBLE);
  const sc = gateScene(file, { ...E.initialState(c), step: 2, targetAlt: 0 });
  const labels = G.pickLabels(sc).filter((l) => l.kind === "gate");
  assert.equal(labels.length, sc.gates.length);
  sc.gates.forEach((g, i) => {
    const bottom = labels[i].y - labels[i].width / 8; // sprite height is width / 4
    assert.ok(bottom >= g.yKm + g.halfHeightKm + G.GATE_LABEL_GAP_KM - 1e-9);
  });
  const withCloud = { ...sc, clouds: [{ lane: 1, step: 0, x0Km: 0, x1Km: 10, zKm: 0, halfWidthKm: 3, topFt: 20000, baseFt: null, bottomFt: 19650, baseEstimated: true }] };
  assert.equal(G.pickLabels(withCloud).filter((l) => l.kind === "base").length, 0);
  assert.equal(G.pickLabels({ ...withCloud, gates: [] }).filter((l) => l.kind === "base").length, 1);
});