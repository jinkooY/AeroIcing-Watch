// Task 16.2: CD-P28 shake clause (R18.2, R15.12). Task 16.5 adds the frost and lamp clauses.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as E from "../../static/cloud-dive/engine.js";
import * as S from "../../static/cloud-dive/scene.js";
import * as G from "../../static/cloud-dive/cockpit-geometry.js";
import { shakeOffsetDeg, windStreakSegments } from "../../static/cloud-dive/cockpit-geometry.js";

const casesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../static/cloud-dive/cases");
const names = readdirSync(casesDir).filter((n) => /^\d.*\.json$/.test(n));
const load = (n) => JSON.parse(readFileSync(path.join(casesDir, n), "utf8"));

test("CD-P28 shake clause: zero unless anti-ice off, cell Observed/Possible, ice > 0 and reduced motion off", () => {
  const file = load(names[0]);
  const c = E.loadCase(file);
  for (const level of [E.NOT_ASSESSED, E.NOT_INDICATED, E.POSSIBLE, E.OBSERVED]) {
    for (const antiIce of [false, true]) {
      for (const ice of [0, 1, 50, 100]) {
        for (const reducedMotion of [false, true]) {
          const st = { ...E.initialState(c), ice, antiIce, step: 2, prevLevel: level };
          const sh = S.buildScene(file, st, { phase: "cruise" }, { reducedMotion }).effects.shakeDeg;
          const on = !antiIce && (level === E.POSSIBLE || level === E.OBSERVED) && ice > 0 && !reducedMotion;
          if (on) assert.ok(sh > 0 && sh <= S.SHAKE_MAX_DEG);
          else assert.equal(sh, 0);
        }
      }
    }
  }
});

test("shake offset is deterministic, capped at SHAKE_MAX_DEG, and zero under reduced motion", () => {
  for (const t of [0, 13, 250, 1234.5, 98765]) {
    const a = shakeOffsetDeg(S.SHAKE_MAX_DEG, t, false);
    assert.deepEqual(a, shakeOffsetDeg(S.SHAKE_MAX_DEG, t, false));
    for (const v of Object.values(a)) assert.ok(Math.abs(v) <= S.SHAKE_MAX_DEG + 1e-12);
    assert.deepEqual(shakeOffsetDeg(S.SHAKE_MAX_DEG, t, true), { pitchDeg: 0, yawDeg: 0, rollDeg: 0 });
    assert.deepEqual(shakeOffsetDeg(0, t, false), { pitchDeg: 0, yawDeg: 0, rollDeg: 0 });
    // an amplitude above the cap is clamped
    for (const v of Object.values(shakeOffsetDeg(5, t, false))) assert.ok(Math.abs(v) <= S.SHAKE_MAX_DEG + 1e-12);
  }
});

// Task 16.4: wind streaks (R16.9).
test("streak cap: at most 12 segments for any count, deterministic, none without wind or in takeoff", () => {
  const file = load(names[0]);
  for (const count of [-3, 0, 1, 7, 12, 13, 500, NaN]) {
    const sc = { effects: { windStreaks: count } };
    const a = windStreakSegments(sc, 1.78, 60, 1234, false);
    assert.ok(a.length <= 12 && a.length <= Math.max(0, Math.floor(count) || 0));
    assert.deepEqual(a, windStreakSegments(sc, 1.78, 60, 1234, false));
    for (const s of a) for (const v of Object.values(s)) assert.ok(Number.isFinite(v));
  }
  assert.equal(windStreakSegments({ effects: { windStreaks: 99 } }, 1.78, 60, 0, true).length, 12);
  assert.deepEqual(
    windStreakSegments({ effects: { windStreaks: 5 } }, 1.78, 60, 0, true),
    windStreakSegments({ effects: { windStreaks: 5 } }, 1.78, 60, 9999, true),
  );
  assert.deepEqual(windStreakSegments(null, 1.78), []);
  const c = E.loadCase(file);
  const take = S.buildScene(file, E.initialState(c), { phase: "takeoff" }, {});
  assert.equal(take.effects.windStreaks, 0);
  assert.equal(windStreakSegments(take, 1.78).length, 0);
});

// Task 16.5: CD-P28 frost and wing-heat lamp, and "effects change no engine value" (R18.1 to R18.4).
import { fuelDisplayUsd } from "../../static/cloud-dive/fuel-counter.js";

// Seeded generator (mulberry32) so every run is the same.
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

const deepFreeze = (o) => {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
};

// Real cases plus synthetic evidence cases (labelled synthetic): levels come from the seeded generator.
function allCases() {
  const out = names.map((n) => ({ label: n, file: load(n) }));
  for (const seed of [1, 2, 3]) {
    const r = rng(seed * 101);
    const file = structuredClone(load(names[0]));
    const data = file.evidence.data;
    for (let i = 0; i < data.length; i++) data[i] = Math.floor(r() * 4);
    out.push({ label: `synthetic-${seed}`, file });
  }
  return out;
}

test("CD-P28 frost = ice/100 and never decreases; lamp equals anti-ice; effects and counter change no engine value (real and synthetic cases, seeded actions)", () => {
  for (const { label, file } of allCases()) {
    const c = E.loadCase(file);
    for (const seed of [11, 22, 33, 44]) {
      const r = rng(seed);
      let st = E.initialState(c, r() < 0.5);
      let prevFrost = -1;
      let prevDrawn = -1;
      let prevTotal = null;
      for (let guard = 0; guard < c.nSteps + 5; guard++) {
        const phase = { phase: "cruise" };
        const before = structuredClone(st);
        const totalBefore = E.totalUsd(c, st);
        deepFreeze(st);
        for (const reducedMotion of [false, true]) {
          const eff = S.buildScene(file, st, phase, { reducedMotion }).effects;
          assert.ok(Math.abs(eff.frost - st.ice / E.ICE_MAX) <= 1e-6, `${label} frost`);
          assert.ok(eff.frost >= 0 && eff.frost <= 1);
          assert.ok(eff.frost >= prevFrost - 1e-12, `${label} frost receded`);
          const drawn = G.frostOpacity({ effects: eff });
          assert.ok(Math.abs(drawn - Math.min(1, 2 * eff.frost)) <= 1e-12, `${label} drawn frost curve`);
          assert.ok(drawn >= prevDrawn - 1e-12, `${label} drawn frost receded`);
          prevDrawn = drawn;
          assert.equal(eff.wingLamp, st.antiIce, `${label} lamp`);
        }
        prevFrost = st.ice / E.ICE_MAX;
        for (const f of [0, 0.3, 1]) fuelDisplayUsd(prevTotal, totalBefore, f, false);
        fuelDisplayUsd(prevTotal, totalBefore, 0.5, true);
        assert.deepEqual(st, before, `${label} state changed by effects`);
        assert.equal(E.totalUsd(c, st), totalBefore);
        prevTotal = totalBefore;
        if (st.status !== "flying") break;
        const next = E.setTargets(
          c, st,
          Math.floor(r() * c.nLanes), Math.floor(r() * c.nAlts), r() < 0.3 ? !st.antiIce : null,
        );
        st = E.step(c, next);
        assert.ok(st.ice >= before.ice, `${label} ice decreased`);
      }
    }
  }
});

test("CD-P28 lamp follows the switch for both values in every phase", () => {
  const file = load(names[0]);
  const c = E.loadCase(file);
  for (const ph of ["ready", "takeoff", "climb", "cruise", "gate"]) {
    for (const antiIce of [false, true]) {
      const sc = S.buildScene(file, E.initialState(c, antiIce), { phase: ph }, {});
      assert.equal(sc.effects.wingLamp, antiIce);
    }
  }
});
