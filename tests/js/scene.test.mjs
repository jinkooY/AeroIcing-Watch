// Task 14.1: scene description basics (frame, constants, schema, determinism, frozen inputs).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as E from "../../static/cloud-dive/engine.js";
import * as S from "../../static/cloud-dive/scene.js";

const casesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../static/cloud-dive/cases");
const names = readdirSync(casesDir).filter((n) => /^\d.*\.json$/.test(n));
const deepFreeze = (o) => {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
};
const load = (n) => JSON.parse(readFileSync(path.join(casesDir, n), "utf8"));
const finiteAll = (v) => {
  if (typeof v === "number") return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(finiteAll);
  if (v && typeof v === "object") return Object.values(v).every(finiteAll);
  return true;
};

test("constants are exported with the design starting values", () => {
  assert.equal(S.VEX, 3);
  assert.equal(S.LATK, 0.5);
  assert.equal(S.LEAD_IN_KM, 30);
  assert.equal(S.CLOUD_FADE_S, 1.5);
  assert.equal(S.MAX_CLOUD_VOLUMES, 160);
  assert.equal(S.MAX_EVIDENCE_BANDS, 240);
  assert.equal(S.MAX_TRIANGLES, 40000);
  assert.equal(S.VIEW_KM, 80);
  assert.equal(S.SHAKE_MAX_DEG, 0.4);
});

for (const n of names) {
  test(`CD-P23 ${n}: lanes z equals true z x LATK, airports, finite numbers, frozen inputs, deterministic`, () => {
    const file = deepFreeze(load(n));
    const c = E.loadCase(file);
    const state = deepFreeze(E.initialState(c));
    const pose = deepFreeze({ phase: "cruise", frac: 0.5 });
    const a = S.buildScene(file, state, pose, { departureElevFt: 13 });
    const b = S.buildScene(file, state, pose, { departureElevFt: 13 });
    assert.deepEqual(a, b);
    assert.equal(a.schemaVersion, 1);
    assert.ok(finiteAll(a));
    assert.equal(a.lanes.length, c.nLanes);
    a.lanes.forEach((l, i) => assert.ok(Math.abs(l.zKm - c.lanesKm[i] * S.LATK) < 1e-6));
    assert.equal(a.lanes.filter((l) => l.isCurrent).length, 1);
    const top = a.airports.find((x) => x.role === "topOfClimb");
    assert.equal(top.xKm, 0);
    assert.equal(top.label, "Top of climb");
    assert.equal(a.airports.find((x) => x.role === "departure").xKm, -S.LEAD_IN_KM);
    assert.equal(a.airports.find((x) => x.role === "arrival").xKm, c.distanceKm);
    assert.equal(a.ground.elevFt, 13);
    // engine distances stay true: the engine case is not scaled
    assert.equal(c.lanesKm.length, c.nLanes);
    assert.equal(c.stepKm, file.grid.stepKm);
    // altitude is exaggerated by VEX
    assert.ok(Math.abs(a.camera.pos[1] - (file.start.altFt / S.FT_PER_KM) * S.VEX) < 1e-5);
  });
}

test("cloudAlpha: 0 before the fade, ramps over the last 1.5 s of the climb, 1 afterwards", () => {
  assert.equal(S.cloudAlphaFor("ready", {}), 0);
  assert.equal(S.cloudAlphaFor("takeoff", {}), 0);
  assert.equal(S.cloudAlphaFor("climb", { climbRemainingS: 6 }), 0);
  assert.equal(S.cloudAlphaFor("climb", { climbRemainingS: 1.5 }), 0);
  assert.equal(S.cloudAlphaFor("climb", { climbRemainingS: 0.75 }), 0.5);
  assert.equal(S.cloudAlphaFor("climb", { climbRemainingS: 0 }), 1);
  assert.equal(S.cloudAlphaFor("climb", {}), 0);
  assert.equal(S.cloudAlphaFor("cruise", {}), 1);
});

test("camera stays at x in [-LEAD_IN_KM, 0] before cruise, even for an out-of-range pose", () => {
  const file = load(names[0]);
  for (const [phase, xKm] of [["ready", 5], ["takeoff", -99], ["climb", 12], ["climb", -10]]) {
    const s = S.buildScene(file, null, { phase, xKm }, {});
    assert.ok(s.camera.pos[0] >= -S.LEAD_IN_KM && s.camera.pos[0] <= 0, `${phase} ${xKm}`);
    assert.equal(s.cloudAlpha <= 1 && s.cloudAlpha >= 0, true);
  }
  assert.equal(S.buildScene(file, null, { phase: "ready" }, {}).camera.pos[0], -S.LEAD_IN_KM);
});

test("string table has the display-scale text and the ground note", () => {
  assert.match(S.STRINGS.displayScale, /display only/i);
  assert.match(S.STRINGS.groundNote, /Flat ground/);
  assert.equal(S.STRINGS.topOfClimb, "Top of climb");
});

// ---- Task 14.2: cloud volumes (CD-P24, CD-P26; R16.6, R19.3, R15.15) ----

const SAT_FIELDS = ["state", "topFt", "baseFt"];
// Synthetic satellite group (labelled synthetic): per-field arrays, or the {shape,data} wrapper per field.
function synthFile(base, cellFn, wrapped) {
  const file = structuredClone(base);
  const c = E.loadCase(file);
  const n = c.nLanes * (c.nSteps + 1);
  const sat = { shape: [c.nLanes, c.nSteps + 1] };
  for (const f of SAT_FIELDS) sat[f] = new Array(n).fill(null);
  for (let lane = 0; lane < c.nLanes; lane++) {
    for (let s = 0; s <= c.nSteps; s++) {
      const v = cellFn(lane, s);
      SAT_FIELDS.forEach((f, k) => { sat[f][lane * (c.nSteps + 1) + s] = v[k]; });
    }
  }
  if (wrapped) for (const f of SAT_FIELDS) sat[f] = { shape: sat.shape, data: sat[f] };
  file.satellite = sat;
  return file;
}
const sceneAt = (file, step) => {
  const c = E.loadCase(file);
  return S.buildScene(file, { ...E.initialState(c), step }, { phase: "cruise" }, {});
};
const satAt = (file, c, lane, s, f) => {
  const g = file.satellite[f];
  return (Array.isArray(g) ? g : g.data)[lane * (c.nSteps + 1) + s];
};

for (const n of names) {
  test(`CD-P24 ${n}: clouds lie on observed finite-top cells, none on clear, within caps, x >= 0, deterministic`, () => {
    const file = deepFreeze(load(n));
    const c = E.loadCase(file);
    const stepsToCheck = [0, 1, Math.floor(c.nSteps / 2), c.nSteps - 1];
    let total = 0;
    for (const step of stepsToCheck) {
      const sc = sceneAt(file, step);
      assert.deepEqual(sc.clouds, sceneAt(file, step).clouds);
      assert.ok(sc.clouds.length <= S.MAX_CLOUD_VOLUMES);
      assert.ok(finiteAll(sc.clouds.map((v) => ({ ...v, baseFt: v.baseFt === null ? 0 : v.baseFt }))));
      for (const v of sc.clouds) {
        total += 1;
        assert.ok(v.x0Km >= 0 && v.x1Km >= v.x0Km && v.x1Km <= c.distanceKm + 1e-6);
        assert.equal(satAt(file, c, v.lane, v.step, "state"), 0, "observed only");
        assert.equal(satAt(file, c, v.lane, v.step, "topFt"), v.topFt);
        const b = satAt(file, c, v.lane, v.step, "baseFt");
        assert.equal(v.baseEstimated, !(typeof b === "number" && Number.isFinite(b) && b <= v.topFt));
        if (v.baseEstimated) { assert.equal(v.baseFt, null); assert.equal(v.faded, true); assert.ok(v.bottomFt < v.topFt); }
        else assert.equal(v.baseFt, b);
        assert.ok(Math.abs(v.zKm - c.lanesKm[v.lane] * S.LATK) < 1e-6);
      }
    }
    assert.ok(total >= 0);
  });
}

for (const wrapped of [false, true]) {
  const shape = wrapped ? "{shape,data}" : "plain arrays";
  test(`CD-P24 synthetic satellite, ${shape}: clear, not-assessed and null-top cells give no cloud; null base is estimated`, () => {
    const base = load(names[0]);
    // lane 0: observed with base; lane 1: observed, null base; lane 2: clear; lane 3: not assessed; lane 4: observed, null top
    const file = synthFile(base, (lane) => [[0, 20000, 15000], [0, 22000, null], [1, null, null], [2, 18000, 9000], [0, null, null]][lane], wrapped);
    const sc = sceneAt(file, 0);
    const byLane = (l) => sc.clouds.filter((v) => v.lane === l);
    assert.ok(byLane(0).length > 0);
    assert.ok(byLane(0).every((v) => v.baseFt === 15000 && v.topFt === 20000 && !v.baseEstimated));
    assert.ok(byLane(1).length > 0);
    assert.ok(byLane(1).every((v) => v.baseFt === null && v.baseEstimated && v.faded && v.bottomFt === 22000 - S.THIN_CAP_FT));
    for (const l of [2, 3, 4]) assert.equal(byLane(l).length, 0);
    assert.equal(S.STRINGS.baseEstimated, "estimated");
    // the window starts at step 0 and no volume starts before x = 0
    assert.ok(sc.clouds.every((v) => v.x0Km >= 0));
  });
}

test("CD-P24 synthetic: a base above the top is treated as unknown, never kept", () => {
  const file = synthFile(load(names[0]), () => [0, 15000, 16000], false);
  const sc = sceneAt(file, 0);
  assert.ok(sc.clouds.length > 0);
  assert.ok(sc.clouds.every((v) => v.baseFt === null && v.baseEstimated));
});

test("CD-P24 synthetic: far cells merge within 500 ft, near cells never merge, different bases never merge", () => {
  const c0 = E.loadCase(load(names[0]));
  // top wobbles by 300 ft (within tolerance); base null everywhere
  const file = synthFile(load(names[0]), (lane, s) => [0, 20000 + (s % 2) * 300, null], false);
  const c = E.loadCase(file);
  const lanes = S.buildScene(file, null, { phase: "cruise" }, {}).lanes;
  const v = S.buildClouds(file, c, 0, lanes, 200);
  const lane0 = v.filter((x) => x.lane === 0);
  const near = lane0.filter((x) => x.step <= S.FAR_STEPS);
  assert.ok(near.every((x) => x.step === x.step1), "near cells stay single");
  const far = lane0.filter((x) => x.step > S.FAR_STEPS);
  assert.equal(far.length, 1, "far cells merged into one volume");
  assert.ok(far[0].step1 > far[0].step);
  assert.equal(far[0].x0Km, far[0].step * c0.stepKm);
  // a 700 ft step is over the tolerance: no merge
  const file2 = synthFile(load(names[0]), (lane, s) => [0, 20000 + (s % 2) * 700, null], false);
  const v2 = S.buildClouds(file2, c, 0, lanes, 200).filter((x) => x.lane === 0 && x.step > S.FAR_STEPS);
  assert.ok(v2.every((x) => x.step === x.step1));
});

test("CD-P26 synthetic: cap binds, volumes never exceed MAX_CLOUD_VOLUMES, tolerance is raised before the window shrinks", () => {
  const file = synthFile(load(names[0]), (lane, s) => [0, 20000 + (s % 2) * 800, null], false);
  const c = E.loadCase(file);
  const lanes = S.buildScene(file, null, { phase: "cruise" }, {}).lanes;
  const v = S.buildClouds(file, c, 0, lanes, 1400); // 5 lanes x 140 steps unmerged would be 700
  assert.ok(v.length <= S.MAX_CLOUD_VOLUMES);
  assert.ok(v.length > 0);
  // 800 ft wobble fits the raised tolerance (1,000 ft) only: far cells merged
  assert.ok(v.some((x) => x.step1 > x.step));
  // determinism
  assert.deepEqual(v, S.buildClouds(file, c, 0, lanes, 1400));
});

// ---- Task 14.3: evidence bands (CD-P25, CD-P26; R16.7, R16.8, R15.15) ----

const coveredLevel = (c, band, s, a) => {
  // does the band's altitude interval contain altitude index a?
  return band.step0 <= s && s <= band.step1 && c.altsFt[a] > band.loFt && c.altsFt[a] < band.hiFt;
};

for (const n of names) {
  test(`CD-P25 ${n}: evidence bands carry the engine level, no Not indicated, every Observed cell in view is covered`, () => {
    const file = deepFreeze(load(n));
    const c = E.loadCase(file);
    for (const step of [0, Math.floor(c.nSteps / 2), c.nSteps - 1]) {
      const state = { ...E.initialState(c), step };
      const sc = S.buildScene(file, state, { phase: "cruise" }, {});
      assert.deepEqual(sc.evidence, S.buildScene(file, state, { phase: "cruise" }, {}).evidence);
      assert.ok(sc.evidence.length <= S.MAX_EVIDENCE_BANDS);
      assert.ok(finiteAll(sc.evidence));
      const altFt = c.altsFt[state.alt];
      for (const b of sc.evidence) {
        assert.notEqual(b.levelIndex, E.NOT_INDICATED);
        assert.equal(b.level, file.rule.levels[b.levelIndex]);
        assert.ok(b.x0Km >= 0);
        assert.ok(b.weight === 1 || b.weight === S.FAR_EVIDENCE_WEIGHT);
        for (let s = b.step0; s <= b.step1; s++)
          for (let a = 0; a < c.nAlts; a++)
            if (coveredLevel(c, b, s, a)) {
              assert.equal(E.levelAt(c, b.lane, s, a), b.levelIndex);
              if (b.levelIndex === E.NOT_ASSESSED) assert.ok(Math.abs(c.altsFt[a] - altFt) <= S.NA_NEAR_FT);
            }
      }
      const s0 = Math.max(0, step - S.BEHIND_STEPS);
      const s1 = Math.min(c.nSteps - 1, step + Math.ceil(S.VIEW_KM / c.stepKm));
      for (let lane = 0; lane < c.nLanes; lane++)
        for (let s = s0; s <= s1; s++)
          for (let a = 0; a < c.nAlts; a++)
            if (E.levelAt(c, lane, s, a) === E.OBSERVED)
              assert.ok(sc.evidence.some((b) => b.lane === lane && coveredLevel(c, b, s, a)), `observed ${lane},${s},${a}`);
    }
  });
}

test("evidence is empty in ready, takeoff and climb, and drawn in cruise (R15.15)", () => {
  const file = load(names[0]);
  const c = E.loadCase(file);
  const base = E.initialState(c);
  for (const phase of ["ready", "takeoff", "climb"]) assert.deepEqual(S.buildScene(file, base, { phase }, {}).evidence, []);
  const any = names.some((n) => S.buildScene(load(n), null, { phase: "cruise" }, {}).evidence.length > 0);
  assert.ok(any, "at least one real case has evidence in view");
});

// Synthetic evidence grid (labelled synthetic): levelFn(lane, s, a) -> engine level.
function synthEvidence(base, levelFn) {
  const file = structuredClone(base);
  const c = E.loadCase(file);
  const data = file.evidence.data;
  for (let lane = 0; lane < c.nLanes; lane++)
    for (let s = 0; s <= c.nSteps; s++)
      for (let a = 0; a < c.nAlts; a++) data[(lane * (c.nSteps + 1) + s) * c.nAlts + a] = levelFn(lane, s, a);
  return { file, c: E.loadCase(file) };
}

test("CD-P25 synthetic: runs merge along track, Not indicated draws nothing, Not assessed only near the aircraft", () => {
  const { file, c } = synthEvidence(load(names[0]), (lane, s, a) => (lane === 0 ? (a === 1 ? E.OBSERVED : E.NOT_INDICATED) : lane === 1 ? E.POSSIBLE : lane === 2 ? E.NOT_ASSESSED : E.NOT_INDICATED));
  const lanes = S.buildScene(file, null, { phase: "cruise" }, {}).lanes;
  const altFt = c.altsFt[0];
  const ev = S.buildEvidence(file, c, 0, lanes, altFt, 200);
  const l0 = ev.filter((b) => b.lane === 0);
  assert.equal(l0.length, 1);
  assert.equal(l0[0].levelIndex, E.OBSERVED);
  assert.equal(l0[0].step0, 0);
  assert.equal(l0[0].step1, Math.min(c.nSteps - 1, Math.ceil(200 / c.stepKm)));
  assert.equal(ev.filter((b) => b.lane === 1).length, 1);
  assert.equal(ev.filter((b) => b.lane === 1)[0].hiFt - ev.find((b) => b.lane === 1).loFt, c.nAlts * (c.altsFt[1] - c.altsFt[0]));
  for (const b of ev.filter((x) => x.lane === 2)) {
    assert.equal(b.levelIndex, E.NOT_ASSESSED);
    assert.ok(b.loFt + (c.altsFt[1] - c.altsFt[0]) / 2 - altFt <= S.NA_NEAR_FT);
  }
  assert.equal(ev.filter((b) => b.lane >= 3).length, 0);
});

test("CD-P34 synthetic: weight is 1 within 2,000 ft of the band, else 0.25; it changes no level, count, extent or label", () => {
  const { file, c } = synthEvidence(load(names[0]), (lane, s, a) => (lane === 0 && a % 4 === 0 ? E.OBSERVED : lane === 1 ? E.POSSIBLE : E.NOT_INDICATED));
  const lanes = S.buildScene(file, null, { phase: "cruise" }, {}).lanes;
  let draws = 0;
  for (const altFt of [-5000, 0, 5000, 12345, 20000, 30000, 36000, 41000, 60000]) {
    const ev = S.buildEvidence(file, c, 0, lanes, altFt, 300);
    assert.ok(ev.length > 0);
    for (const b of ev) {
      const d = altFt < b.loFt ? b.loFt - altFt : altFt > b.hiFt ? altFt - b.hiFt : 0;
      assert.equal(b.weight, d <= 2000 ? 1 : 0.25);
      draws++;
    }
  }
  assert.ok(draws >= 9);
  const a1 = S.buildEvidence(file, c, 0, lanes, 30000, 300), a2 = S.buildEvidence(file, c, 0, lanes, 30001, 300);
  const key = (ev) => ev.map((b) => [b.level, b.x0Km, b.x1Km, b.loFt, b.hiFt]);
  assert.deepEqual(key(a1), key(a2));
  assert.equal(S.evidenceWeight(10000, 12000, 14000), 1);
  assert.equal(S.evidenceWeight(10000, 12000, 14001), 0.25);
  assert.equal(S.evidenceWeight(10000, 12000, 7999), 0.25);
});

test("CD-P26 synthetic: cap binds, Observed kept first, then Possible, then Not assessed", () => {
  // alternating levels along altitude and shifted by step, so no run merges
  const { file, c } = synthEvidence(load(names[0]), (lane, s, a) => [E.OBSERVED, E.POSSIBLE, E.NOT_ASSESSED][(a + s + lane) % 3]);
  const lanes = S.buildScene(file, null, { phase: "cruise" }, {}).lanes;
  const altFt = c.altsFt[Math.floor(c.nAlts / 2)];
  const all = S.buildEvidence(file, c, 0, lanes, altFt, 1400);
  assert.ok(all.length <= S.MAX_EVIDENCE_BANDS);
  const count = (lv) => all.filter((b) => b.levelIndex === lv).length;
  assert.ok(count(E.OBSERVED) >= count(E.POSSIBLE) && count(E.POSSIBLE) >= count(E.NOT_ASSESSED));
  assert.deepEqual(all, S.buildEvidence(file, c, 0, lanes, altFt, 1400));
  // Observed is dropped last: it is fully kept when the cap leaves room for it
  const uncapped = S.buildEvidence(file, c, 0, lanes, altFt, 1400).length;
  assert.equal(all.length, S.MAX_EVIDENCE_BANDS, `cap should bind (got ${uncapped})`);
});

// ---- Task 14.4: effects and panel data (R16.2, R16.8, R16.9, R18.1 to R18.3) ----

const stateWith = (c, over) => ({ ...E.initialState(c), ...over });
const fxOf = (file, st, pose = { phase: "cruise" }, opts = {}) => S.buildScene(file, st, pose, opts);

test("frost equals ice/100, wing lamp follows anti-ice, effects do not change the inputs", () => {
  const file = deepFreeze(load(names[0]));
  const c = E.loadCase(file);
  for (const ice of [0, 1, 37, 100]) {
    for (const antiIce of [false, true]) {
      const st = deepFreeze(stateWith(c, { ice, antiIce, step: 3 }));
      const sc = fxOf(file, st);
      assert.equal(sc.effects.frost, ice / 100);
      assert.equal(sc.effects.wingLamp, antiIce);
      assert.ok(finiteAll(sc.effects));
    }
  }
});

test("shake is zero unless anti-ice off, cell Observed/Possible, ice > 0, motion allowed; capped by SHAKE_MAX_DEG", () => {
  const file = load(names[0]);
  const c = E.loadCase(file);
  for (const level of [E.NOT_ASSESSED, E.NOT_INDICATED, E.POSSIBLE, E.OBSERVED]) {
    for (const antiIce of [false, true]) {
      for (const ice of [0, 50, 100]) {
        for (const reducedMotion of [false, true]) {
          const st = stateWith(c, { ice, antiIce, step: 2, prevLevel: level });
          const sh = fxOf(file, st, { phase: "cruise" }, { reducedMotion }).effects.shakeDeg;
          const on = !antiIce && (level === E.POSSIBLE || level === E.OBSERVED) && ice > 0 && !reducedMotion;
          if (on) {
            assert.ok(sh > 0 && sh <= S.SHAKE_MAX_DEG);
            assert.ok(Math.abs(sh - (ice / 100) * S.SHAKE_MAX_DEG) < 1e-6);
          } else assert.equal(sh, 0);
        }
      }
    }
  }
});

for (const n of names) {
  test(`${n}: head-wind from the cell, streaks <= 12, legend has the four exact names, text line has level here and ahead`, () => {
    const file = deepFreeze(load(n));
    const c = E.loadCase(file);
    for (const step of [0, Math.floor(c.nSteps / 2), c.nSteps - 1, c.nSteps]) {
      const st = deepFreeze(stateWith(c, { step }));
      const sc = fxOf(file, st);
      const hw = c.headwindKt[(st.lane * (c.nSteps + 1) + step) * c.nAlts + st.alt];
      assert.equal(sc.effects.headwindKt, Math.round(hw));
      assert.ok(sc.effects.windStreaks >= 0 && sc.effects.windStreaks <= 12);
      assert.match(sc.panel.textLine, /(head|tail)-wind \d+ kt/);
      assert.ok(sc.panel.textLine.includes(`here: ${sc.panel.levelHere}`));
      assert.ok(sc.panel.textLine.includes(`ahead: ${sc.panel.levelAhead}`));
      assert.ok(finiteAll(sc));
    }
    assert.deepEqual(sceneLegend(file), file.rule.levels);
    assert.deepEqual(fxOf(file, E.initialState(c)).panel.legend, file.rule.levels);
  });
}
const sceneLegend = (file) => S.legendNames(file);

test("legend fallback names are the four exact level names", () => {
  assert.deepEqual(S.legendNames({}), [
    "Not assessed", "Not indicated", "Possible (forecast only)", "Observed supercooled layer at planned altitude",
  ]);
});

test("synthetic: streak count is capped at 12 and level here/ahead come from the engine levels", () => {
  const { file, c } = synthEvidence(load(names[0]), (lane, s) => (s < 4 ? E.NOT_INDICATED : E.OBSERVED));
  file.headwindKt.data.fill(500);
  const st = stateWith(E.loadCase(file), { step: 3, prevLevel: E.NOT_INDICATED });
  const sc = fxOf(file, st);
  assert.equal(sc.effects.windStreaks, 12);
  assert.equal(sc.panel.levelHere, "Not indicated");
  assert.equal(sc.panel.levelAhead, file.rule.levels[E.OBSERVED]);
  const file2 = structuredClone(file); // the engine case is cached per file object
  file2.headwindKt.data.fill(-20);
  assert.match(fxOf(file2, st).panel.textLine, /tail-wind 20 kt/);
  assert.equal(c.nLanes, 5);
});

test("panel phase text: below the block and departure climb (R15.6), engine effects stay zero", () => {
  const file = load(names[0]);
  const c = E.loadCase(file);
  const lo = c.altsFt[0];
  const below = fxOf(file, null, { phase: "climb", altFt: lo - 3000 });
  assert.equal(below.panel.levelHere, "Not assessed (below the game's altitude block)");
  const inside = fxOf(file, null, { phase: "climb", altFt: lo + 1000 });
  assert.equal(inside.panel.levelHere, "Not assessed (departure climb)");
  assert.equal(inside.panel.levelAhead, "Not assessed (departure climb)");
  assert.equal(fxOf(file, null, { phase: "ready" }, { departureElevFt: 13 }).panel.levelHere, S.STRINGS.belowBlock);
  assert.equal(fxOf(file, null, { phase: "takeoff" }, { departureElevFt: 13 }).panel.levelHere, S.STRINGS.belowBlock);
  for (const sc of [below, inside]) {
    assert.deepEqual(sc.effects, { frost: 0, shakeDeg: 0, wingLamp: false, windStreaks: 0, headwindKt: 0 });
    assert.equal(sc.panel.ice, 0);
  }
  // cruise never shows the phase text
  assert.ok(!fxOf(file, null, { phase: "cruise" }).panel.levelHere.startsWith("Not assessed ("));
});

test("CD-P23 effect and panel strings carry no severity word (R9.1)", () => {
  const banned = /\b(light|moderate|severe|likely|unlikely|risk|safe|ice-free|no icing|clear of ice)\b/i;
  const file = load(names[0]);
  const c = E.loadCase(file);
  for (const phase of ["ready", "climb", "cruise"]) {
    const sc = fxOf(file, stateWith(c, { ice: 80, step: 5 }), { phase });
    for (const s of [sc.panel.levelHere, sc.panel.levelAhead, sc.panel.textLine, sc.panel.iceLabel, ...sc.panel.legend])
      assert.ok(!banned.test(s), s);
  }
  for (const v of Object.values(S.STRINGS)) if (typeof v === "string") assert.ok(!banned.test(v), v);
  assert.equal(fxOf(file, null, { phase: "cruise" }).panel.iceLabel, "Ice index (game model)");
});
// ---- Task 14.5: CD-P23 to CD-P26 across all real cases, steps, altitudes and both array shapes ----
const wrapSat = (file) => {
  const f = structuredClone(file);
  for (const k of SAT_FIELDS) f.satellite[k] = { shape: f.satellite.shape, data: f.satellite[k] };
  return f;
};
const synthCases = () => {
  const mk = (wrapped) => synthFile(load(names[0]), (lane, s) => [[0, 20000, 15000], [0, 22000, null], [1, null, null], [2, 18000, 9000], [0, null, null]][lane % 5].map((v, i) => (i === 1 && v !== null ? v + (s % 3) * 100 : v)), wrapped);
  return [["plain", mk(false)], ["wrapped", mk(true)]];
};
test("CD-P23 synthetic, both array shapes: same inputs give a deep-equal finite scene, frozen inputs untouched, z = true z x LATK", () => {
  for (const [shape, raw] of synthCases()) {
    const file = deepFreeze(raw);
    const c = E.loadCase(file);
    const state = deepFreeze({ ...E.initialState(c), step: 3 });
    const pose = deepFreeze({ phase: "cruise" });
    const opts = deepFreeze({ departureElevFt: 100, arrivalElevFt: 50 });
    const a = S.buildScene(file, state, pose, opts);
    assert.deepEqual(a, S.buildScene(file, state, pose, opts), shape);
    assert.ok(finiteAll(a.lanes) && finiteAll(a.camera) && finiteAll(a.evidence) && finiteAll(a.effects), shape);
    assert.ok(finiteAll(a.clouds.map((v) => ({ ...v, baseFt: v.baseFt === null ? 0 : v.baseFt }))), shape);
    a.lanes.forEach((l, i) => assert.ok(Math.abs(l.zKm - c.lanesKm[i] * S.LATK) < 1e-6, shape));
    a.clouds.forEach((v) => assert.ok(Math.abs(v.zKm - c.lanesKm[v.lane] * S.LATK) < 1e-6, shape));
    assert.ok(Object.isFrozen(file) && Object.isFrozen(file.satellite.topFt), shape);
  }
});
test("CD-P24 plain and wrapped satellite arrays give identical clouds", () => {
  const [[, plain], [, wrapped]] = synthCases();
  assert.deepEqual(sceneAt(plain, 0).clouds, sceneAt(wrapped, 0).clouds);
  assert.ok(sceneAt(plain, 0).clouds.length > 0);
  // real cases: wrapping the arrays changes nothing
  for (const n of names) {
    const file = load(n);
    if (!Array.isArray(file.satellite.topFt)) continue;
    assert.deepEqual(sceneAt(file, 1).clouds, sceneAt(wrapSat(file), 1).clouds, n);
  }
});
for (const n of names) {
  test(`CD-P26 ${n}: every step and altitude stays within the volume, band and triangle budgets`, () => {
    const file = deepFreeze(load(n));
    const c = E.loadCase(file);
    // Conservative triangle estimate: a box (12 triangles) per cloud volume and per evidence band.
    const TRI_PER_BOX = 12;
    for (let step = 0; step < c.nSteps; step++) {
      for (let alt = 0; alt < c.nAlts; alt++) {
        const sc = S.buildScene(file, { ...E.initialState(c), step, alt }, { phase: "cruise" }, {});
        assert.ok(sc.clouds.length <= S.MAX_CLOUD_VOLUMES, `${step},${alt} volumes`);
        assert.ok(sc.evidence.length <= S.MAX_EVIDENCE_BANDS, `${step},${alt} bands`);
        assert.ok((sc.clouds.length + sc.evidence.length) * TRI_PER_BOX <= S.MAX_TRIANGLES, `${step},${alt} triangles`);
      }
    }
  });
}
test("CD-P23 scene strings: the string table and every panel string carry no banned wording", () => {
  const banned = /\b(light|moderate|severe|likely|unlikely|risk|safe|ice-free|no icing|clear of ice|unknown|no evidence|no data|not detected|absent)\b/i;
  for (const v of Object.values(S.STRINGS)) {
    for (const s of Array.isArray(v) ? v : [v]) if (typeof s === "string") assert.ok(!banned.test(s), s);
  }
  for (const n of names) {
    const file = load(n);
    const c = E.loadCase(file);
    for (const phase of ["ready", "climb", "cruise"]) {
      const sc = S.buildScene(file, { ...E.initialState(c), ice: 60, step: 4 }, { phase }, {});
      const strs = [sc.panel.levelHere, sc.panel.levelAhead, sc.panel.textLine, sc.panel.iceLabel, ...sc.panel.legend, ...Object.values(sc.notes), ...sc.airports.map((a) => a.label || "")];
      for (const s of strs) assert.ok(!banned.test(s), `${n} ${phase}: ${s}`);
    }
  }
});
