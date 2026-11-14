// Task 17.2: phase machine (design 14.6). CD-P30. Seeded random input sequences, no external library.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as E from "../../static/cloud-dive/engine.js";
import * as S from "../../static/cloud-dive/scene.js";
import * as P from "../../static/cloud-dive/phases.js";

const casesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../static/cloud-dive/cases");
const names = readdirSync(casesDir).filter((n) => /^\d.*\.json$/.test(n));
const load = (n) => JSON.parse(readFileSync(path.join(casesDir, n), "utf8"));

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
const finiteAll = (o) => Object.values(o).every((v) => (typeof v === "number" ? Number.isFinite(v) : true));
const opts = (over) => ({ departureElevFt: 5431, startAltFt: 28000, arrivalElevFt: 125, ...over });

function randomInput(r) {
  const inp = {};
  if (r() < 0.2) inp.start = true;
  if (r() < 0.1) inp.skip = true;
  if (r() < 0.3) inp.gate = r() < 0.5;
  if (r() < 0.03) inp.arrived = true;
  if (r() < 0.02) inp.diverted = true;
  if (r() < 0.5) { inp.altFt = 20000 + Math.floor(r() * 10000); inp.laneFrac = r() * 4; }
  return inp;
}

test("durations: takeoff 5 s, climb 10 to 15 s, arrival 10 s, diversion 4 s, reduced motion at most 2 s", () => {
  const at = (phase, o) => P.phaseDurationMs({ ...P.createPhaseState(opts(o)), phase });
  assert.equal(at("takeoff"), 5000);
  assert.equal(at("climb"), 12000);
  assert.equal(at("climb", { climbMs: 1 }), 10000);
  assert.equal(at("climb", { climbMs: 99999 }), 15000);
  assert.equal(at("arrival"), 10000);
  assert.equal(at("diversion"), 4000);
  for (const ph of ["takeoff", "climb", "arrival", "diversion"]) assert.ok(at(ph, { reducedMotion: true }) <= 2000);
});

test("CD-P30 happy path: ready waits, start, takeoff, climb, cruise with engineStart once, gate, arrival, report", () => {
  let s = P.createPhaseState(opts());
  s = P.phaseStep(s, 10000, {});
  assert.equal(s.phase, "ready");
  s = P.phaseStep(s, 0, { start: true });
  assert.equal(s.phase, "takeoff");
  s = P.phaseStep(s, 4999, {});
  assert.equal(s.phase, "takeoff");
  s = P.phaseStep(s, 1, {});
  assert.equal(s.phase, "climb");
  s = P.phaseStep(s, 11999, {});
  assert.equal(s.phase, "climb");
  assert.equal(s.event, null);
  s = P.phaseStep(s, 1, {});
  assert.equal(s.phase, "cruise");
  assert.equal(s.event, "engineStart");
  s = P.phaseStep(s, 16, {});
  assert.equal(s.event, null);
  s = P.phaseStep(s, 16, { gate: true });
  assert.equal(s.phase, "gate");
  s = P.phaseStep(s, 16, { gate: false });
  assert.equal(s.phase, "cruise");
  assert.equal(s.event, null, "engineStart only once");
  s = P.phaseStep(s, 16, { arrived: true, altFt: 27000 });
  assert.equal(s.phase, "arrival");
  s = P.phaseStep(s, 10000, {});
  assert.equal(s.phase, "report");
  const d = P.phaseStep({ ...P.createPhaseState(opts()), phase: "gate", engineStarted: true }, 0, { diverted: true });
  assert.equal(d.phase, "diversion");
  assert.equal(P.phaseStep(d, 4000, {}).phase, "report");
});

test("big time step carries over takeoff into climb; cinematics off opens the report at the end", () => {
  let s = P.phaseStep(P.createPhaseState(opts()), 0, { start: true });
  s = P.phaseStep(s, 5000 + 3000, {});
  assert.equal(s.phase, "climb");
  assert.equal(s.tMs, 3000);
  const c = P.createPhaseState(opts({ cinematics: false }));
  const e = P.phaseStep({ ...c, phase: "cruise", engineStarted: true }, 0, { arrived: true });
  assert.equal(e.phase, "report");
});

test("CD-P30 random input sequences: only allowed transitions, engine steps only in cruise and gate, one engineStart", () => {
  for (let seed = 1; seed <= 60; seed++) {
    const r = rng(seed);
    let s = P.createPhaseState(opts({ reducedMotion: seed % 3 === 0, cinematics: seed % 5 !== 0 }));
    let starts = 0;
    for (let i = 0; i < 600; i++) {
      const prev = s;
      const inp = randomInput(r);
      const frozen = JSON.stringify(prev);
      s = P.phaseStep(prev, Math.floor(r() * 3000) - 200, inp);
      assert.equal(JSON.stringify(prev), frozen, "input state is not changed");
      if (s.phase !== prev.phase) assert.ok(P.TRANSITIONS[prev.phase].includes(s.phase), `${prev.phase} -> ${s.phase}`);
      if (s.event === "engineStart") { starts += 1; assert.equal(s.phase, "cruise"); assert.ok(prev.phase === "climb" || prev.phase === "takeoff"); }
      assert.equal(P.engineMayStep(s), s.phase === "cruise" || s.phase === "gate");
      if (s.phase === "ready" || s.phase === "takeoff" || s.phase === "climb") assert.equal(s.engineStarted, false);
      assert.ok(finiteAll(P.phasePose(s)));
    }
    assert.ok(starts <= 1);
  }
});

test("CD-P30 lead-in: camera x in [-LEAD_IN_KM, 0], no evidence, no cloud before x = 0, cloudAlpha 1 only after the fade", () => {
  for (const n of names) {
    const file = load(n);
    const c = E.loadCase(file);
    const init = E.initialState(c);
    for (const reduced of [false, true]) {
      let s = P.createPhaseState(opts({ reducedMotion: reduced, startAltFt: c.altsFt[c.startAlt] }));
      s = P.phaseStep(s, 0, { start: true });
      let lastX = -Infinity;
      let sawFade = false;
      for (let i = 0; i < 2000 && (s.phase === "takeoff" || s.phase === "climb"); i++) {
        const pose = P.phasePose(s);
        const sc = S.buildScene(file, null, pose, { departureElevFt: 5431 });
        const x = sc.camera.pos[0];
        assert.ok(x >= -S.LEAD_IN_KM && x <= 0, `x ${x}`);
        assert.ok(x >= lastX - 1e-9, "camera moves forward only");
        lastX = x;
        assert.deepEqual(sc.evidence, []);
        for (const v of sc.clouds) assert.ok(v.x0Km >= 0);
        if (sc.cloudAlpha > 0) sawFade = true;
        if (sc.cloudAlpha === 1) assert.equal(pose.climbRemainingS, 0);
        if (s.phase === "takeoff") assert.equal(sc.cloudAlpha, 0);
        assert.ok(finiteAll(pose));
        s = P.phaseStep(s, 100, {});
      }
      assert.equal(s.phase, "cruise");
      assert.equal(s.event, "engineStart");
      assert.ok(sawFade);
      // The last lead-in pose reaches the Top of climb at the start altitude.
      const end = P.phasePose({ ...s, phase: "climb", tMs: P.phaseDurationMs({ ...s, phase: "climb" }) });
      assert.equal(end.xKm, 0);
      assert.equal(end.altFt, c.altsFt[c.startAlt]);
      assert.equal(end.climbRemainingS, 0);
      // Hand-over: the engine's own initial state, untouched by the phases (step 0, ice 0).
      assert.deepEqual(E.initialState(c), init);
      assert.equal(init.step, 0);
      assert.equal(init.ice, 0);
    }
  }
});

test("CD-P30 skip: a skipped cinematic changes no value, only the phase moves on", () => {
  const strip = (s) => { const { phase, tMs, event, ...rest } = s; return rest; };
  for (const [phase, next] of [["takeoff", "cruise"], ["climb", "cruise"], ["arrival", "report"], ["diversion", "report"]]) {
    const base = { ...P.createPhaseState(opts()), phase, tMs: 700, endAltFt: 21000, endLaneFrac: 2 };
    const skipped = P.phaseStep(base, 0, { skip: true });
    const waited = P.phaseStep(base, 1e9, {});
    assert.equal(skipped.phase, next, phase);
    if (next === "report") assert.deepEqual(skipped.phase, waited.phase);
    const a = strip(skipped);
    const b = strip(waited);
    if (next === "report") assert.deepEqual(a, b);
    else assert.deepEqual({ ...a, engineStarted: 0 }, { ...strip(base), engineStarted: 0 });
  }
  // Skip while the engine runs does nothing.
  const run = { ...P.createPhaseState(opts()), phase: "cruise", engineStarted: true };
  assert.deepEqual(P.phaseStep(run, 0, { skip: true }), run);
  // Ending the lead-in by skip equals ending it by waiting.
  let a = P.phaseStep(P.createPhaseState(opts()), 0, { start: true });
  let b = a;
  a = P.phaseStep(a, 0, { skip: true });
  b = P.phaseStep(b, 1e9, {});
  assert.deepEqual(a, b);
});

test("pose fields match what buildScene reads: finite, climb pose reaches the start altitude, diversion keeps altitude", () => {
  const file = load(names[0]);
  const c = E.loadCase(file);
  const start = c.altsFt[c.startAlt];
  const s0 = { ...P.createPhaseState(opts({ startAltFt: start })), phase: "climb" };
  let prevAlt = -Infinity;
  for (let ms = 0; ms <= 12000; ms += 500) {
    const pose = P.phasePose({ ...s0, tMs: ms });
    for (const k of ["phase", "xKm", "altFt", "pitchDeg", "yawDeg", "rollDeg", "climbRemainingS"]) assert.ok(k in pose, k);
    assert.ok(pose.altFt >= prevAlt);
    prevAlt = pose.altFt;
  }
  const arr = P.phasePose({ ...P.createPhaseState(opts()), phase: "arrival", tMs: 10000, endAltFt: 20000 });
  assert.equal(arr.altFt, 125);
  const div = P.phasePose({ ...P.createPhaseState(opts()), phase: "diversion", tMs: 2000, endAltFt: 20000, endLaneFrac: 3 });
  assert.equal(div.altFt, 20000);
  assert.equal(div.laneFrac, 3);
  const cr = P.phasePose({ ...P.createPhaseState(opts()), phase: "cruise" });
  assert.ok(!("xKm" in cr) && !("altFt" in cr));
  const sc = S.buildScene(file, E.initialState(c), cr, {});
  assert.equal(sc.phase, "cruise");
});
