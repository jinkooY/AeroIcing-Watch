// Task 17.4: automatic climb, labels, cloud fade, lead-in tuning and the counter total
// (R15.3, R15.4, R15.6, R15.7, R15.14, R15.15, R15.5). DOM-free, real cases.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as E from "../../static/cloud-dive/engine.js";
import * as S from "../../static/cloud-dive/scene.js";
import * as P from "../../static/cloud-dive/phases.js";
import * as T from "../../static/cloud-dive/takeoff.js";
import * as D from "../../static/cloud-dive/departure.js";
import * as F from "../../static/cloud-dive/fuel-counter.js";
import { WHY_CARDS } from "../../static/cloud-dive/why.js";

const casesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../static/cloud-dive/cases");
const names = readdirSync(casesDir).filter((n) => /^\d.*\.json$/.test(n));
const load = (n) => JSON.parse(readFileSync(path.join(casesDir, n), "utf8"));
const FRAME = 16;

// Flies the lead-in with fixed frames; returns per-frame samples for the climb and the measured durations.
function flyLead(file, c) {
  let ps = P.phaseStep(T.newPhaseState(file, c, false), 0, { start: true });
  const samples = [];
  let t = 0;
  let climbStart = null;
  let climbEnd = null;
  while (T.inLead(ps) && t < 60000) {
    const r = T.leadAdvance(ps, FRAME, {});
    ps = r.ps;
    t += FRAME;
    if (ps.phase === "climb" && climbStart === null) climbStart = t;
    if (r.engineStart) climbEnd = t;
    if (ps.phase === "climb") {
      const pose = P.phasePose(ps);
      const scene = S.buildScene(file, E.initialState(c), pose, T.sceneOptions(file, c, { mode: "cockpit" }));
      samples.push({ pose, scene });
    }
  }
  return { ps, samples, climbMs: climbEnd - climbStart, totalMs: climbEnd };
}

test("climb takes 10 to 15 s and the whole lead-in stays near 17 s (real cases)", () => {
  for (const n of names) {
    const file = load(n);
    const c = E.loadCase(file);
    const { climbMs, totalMs, ps } = flyLead(file, c);
    assert.equal(ps.phase, "cruise");
    assert.ok(climbMs >= 10000 && climbMs <= 15000 + FRAME, `${n}: climb ${climbMs} ms`);
    assert.ok(totalMs >= 15000 && totalMs <= 20000 + FRAME, `${n}: lead-in ${totalMs} ms`);
    console.log(`measured ${n}: climb ${climbMs} ms, takeoff+climb ${totalMs} ms`);
  }
});

test("lead-in display speed is slow enough to read: climb covers LEAD_IN_KM in 10-15 s", () => {
  const speed = (S.LEAD_IN_KM - P.TAKEOFF_ROLL_KM) / (P.CLIMB_MS_DEFAULT / 1000);
  assert.ok(S.LEAD_IN_KM >= 20 && S.LEAD_IN_KM <= 40);
  assert.ok(speed >= 1.5 && speed <= 4, `display speed ${speed} km/s`);
  // The engine distances stay true: the lead-in is outside the route.
  for (const n of names) {
    const file = load(n);
    const c = E.loadCase(file);
    assert.equal(c.distanceKm, file.distanceKm);
    assert.equal(E.initialState(c).step, 0);
  }
});

test("cloudAlpha is 0 in takeoff and in the climb until the last CLOUD_FADE_S, then rises to 1; no evidence drawn", () => {
  for (const n of names) {
    const file = load(n);
    const c = E.loadCase(file);
    const { samples } = flyLead(file, c);
    assert.ok(samples.length > 500);
    let prev = 0;
    for (const { pose, scene } of samples) {
      assert.deepEqual(scene.evidence, []);
      assert.ok(scene.camera.pos[0] >= -S.LEAD_IN_KM && scene.camera.pos[0] <= 0);
      if (pose.climbRemainingS >= S.CLOUD_FADE_S) assert.equal(scene.cloudAlpha, 0);
      assert.ok(scene.cloudAlpha >= prev, "fade never goes back");
      prev = scene.cloudAlpha;
    }
    const last = samples[samples.length - 1];
    assert.ok(last.scene.cloudAlpha > 0.9, `alpha at the end of the climb ${last.scene.cloudAlpha}`);
    assert.ok(samples.some((s) => s.scene.cloudAlpha > 0 && s.scene.cloudAlpha < 1));
    assert.equal(S.cloudAlphaFor("takeoff", { climbRemainingS: 0 }), 0);
    assert.equal(S.cloudAlphaFor("cruise", {}), 1);
  }
});

test("panel text: below the altitude block, then departure climb; the climb ends at x = 0 on the centre lane", () => {
  for (const n of names) {
    const file = load(n);
    const c = E.loadCase(file);
    const { samples } = flyLead(file, c);
    const texts = samples.map((s) => s.scene.panel.levelHere);
    for (let i = 0; i < samples.length; i++) {
      const alt = samples[i].pose.altFt;
      const want = alt < c.altsFt[0] ? "Not assessed (below the game's altitude block)" : "Not assessed (departure climb)";
      assert.equal(texts[i], want);
      assert.equal(samples[i].scene.panel.levelAhead, want);
      assert.ok(samples[i].scene.panel.textLine.startsWith(want));
    }
    // Below-block text comes first and never returns once the block is reached.
    assert.ok(texts.includes("Not assessed (below the game's altitude block)"));
    assert.ok(texts[texts.length - 1] === "Not assessed (departure climb)");
    for (let i = 1; i < texts.length; i++) {
      if (texts[i - 1] === "Not assessed (departure climb)") assert.equal(texts[i], "Not assessed (departure climb)");
    }
    // Hand-over: engine initial state at step 0 on the start lane; the top of climb is at x = 0.
    const end = samples[samples.length - 1].pose;
    assert.ok(Math.abs(end.xKm) < 0.5, `last climb frame x ${end.xKm}`);
    assert.ok(end.altFt > c.altsFt[0] - 1);
    const st = T.engineStartState(c, E.initialState(c));
    assert.equal(st.step, 0);
    assert.equal(st.lane, c.startLane);
  }
});

test("the display-scale Why card adds the lead-in", () => {
  const card = WHY_CARDS.find((x) => x.id === "why-display-scale");
  assert.ok(card.paragraphs.some((p) => p.includes(`${S.LEAD_IN_KM} km`) && /display convention/.test(p)));
});

test("counter total: engine total + Departure climb, ending exactly on the displayed total", () => {
  for (const n of names) {
    const file = load(n);
    const c = E.loadCase(file);
    const dep = D.departureUsd(file.params);
    assert.ok(dep > 0);
    // Panel total is the engine total only in the lead-in, engine total + dep from the climb's end.
    const lead = S.buildScene(file, E.initialState(c), { phase: "climb", altFt: 5000, xKm: -10 }, T.sceneOptions(file, c, {}));
    assert.equal(lead.panel.displayTotalUsd, lead.panel.totalUsd);
    const cruise = S.buildScene(file, E.initialState(c), { phase: "cruise" }, T.sceneOptions(file, c, {}));
    assert.equal(cruise.panel.departureUsd, dep);
    assert.equal(cruise.panel.departureLabel, "Departure climb");
    assert.equal(cruise.panel.displayTotalUsd, D.withDeparture(cruise.panel.totalUsd, file.params));
    // Interpolation ends exactly on the displayed total and never passes it.
    const prev = 120.5;
    const cur = 135.25;
    const shown = D.withDeparture(cur, file.params);
    assert.equal(F.fuelDisplayWithDepartureUsd(prev, cur, 1, false, dep), shown);
    assert.equal(F.fuelDisplayWithDepartureUsd(prev, cur, 0.4, true, dep), shown);
    for (const f of [0, 0.25, 0.5, 0.99]) {
      const v = F.fuelDisplayWithDepartureUsd(prev, cur, f, false, dep);
      assert.ok(v >= D.withDeparture(prev, file.params) - 1e-9 && v <= shown);
    }
    assert.equal(F.fuelDisplayWithDepartureUsd(null, cur, 0.5, false, dep), shown);
  }
});
