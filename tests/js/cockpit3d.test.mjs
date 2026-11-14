// Task 15.2: DOM-free parts of the 3D cockpit view (geometry, budget, camera, WebGL test).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as S from "../../static/cloud-dive/scene.js";
import * as G from "../../static/cloud-dive/cockpit-geometry.js";
import { webglAvailable } from "../../static/cloud-dive/webgl-test.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const casesDir = path.resolve(here, "../../static/cloud-dive/cases");
const names = readdirSync(casesDir).filter((n) => /^\d.*\.json$/.test(n));
const load = (n) => JSON.parse(readFileSync(path.join(casesDir, n), "utf8"));
const finiteAll = (v) => {
  if (typeof v === "number") return Number.isFinite(v);
  if (ArrayBuffer.isView(v)) return Array.from(v).every(Number.isFinite);
  if (Array.isArray(v)) return v.every(finiteAll);
  if (v && typeof v === "object") return Object.values(v).every(finiteAll);
  return true;
};

// Synthetic scene (hand built, not from a case file).
const synthetic = (over = {}) => ({
  camera: { pos: [0, 30, 0], yawDeg: 0, pitchDeg: 0, rollDeg: 0, fovDeg: 75 },
  ground: { y: 0 },
  lanes: [-1, 0, 1].map((k, i) => ({ index: i, zKm: k * 7.5, isCurrent: k === 0, isTarget: false })),
  airports: [
    { icao: "AAAA", role: "departure", xKm: -30, zKm: 0 },
    { icao: "", role: "topOfClimb", xKm: 0, zKm: 0, label: S.STRINGS.topOfClimb },
    { icao: "BBBB", role: "arrival", xKm: 300, zKm: 0 },
  ],
  cloudAlpha: 1,
  clouds: [
    { lane: 1, step: 0, x0Km: 0, x1Km: 10, zKm: 0, halfWidthKm: 3.75, topFt: 20000, baseFt: 15000, bottomFt: 15000, baseEstimated: false },
    { lane: 1, step: 1, x0Km: 10, x1Km: 20, zKm: 0, halfWidthKm: 3.75, topFt: 21000, baseFt: null, bottomFt: 20650, baseEstimated: true },
  ],
  evidence: [
    { lane: 1, step0: 0, step1: 0, levelIndex: 3, level: S.STRINGS.levels[3], x0Km: 0, x1Km: 10, zKm: 0, halfWidthKm: 3.75, loFt: 30000, hiFt: 32000 },
    { lane: 1, step0: 0, step1: 0, levelIndex: 2, level: S.STRINGS.levels[2], x0Km: 0, x1Km: 10, zKm: 0, halfWidthKm: 3.75, loFt: 32000, hiFt: 34000 },
    { lane: 1, step0: 0, step1: 0, levelIndex: 0, level: S.STRINGS.levels[0], x0Km: 0, x1Km: 10, zKm: 0, halfWidthKm: 3.75, loFt: 34000, hiFt: 36000 },
    { lane: 1, step0: 0, step1: 0, levelIndex: 1, level: S.STRINGS.levels[1], x0Km: 0, x1Km: 10, zKm: 0, halfWidthKm: 3.75, loFt: 36000, hiFt: 38000 },
  ],
  ...over,
});

test("webglAvailable reports false without a document and with a failing context (synthetic doubles)", () => {
  assert.equal(webglAvailable(null), false);
  assert.equal(webglAvailable({ createElement: () => ({ getContext: () => null }) }), false);
  assert.equal(webglAvailable({ createElement: () => { throw new Error("boom"); } }), false);
  assert.equal(webglAvailable({ createElement: () => ({ getContext: (k) => (k === "webgl" ? {} : null) }) }), true);
});

test("appendBox: 12 triangles, finite, indices in range, taper insets the top only", () => {
  const d = G.createMeshData();
  G.appendBox(d, { x0: 0, x1: 10, y0: 0, y1: 4, z0: -2, z1: 2, taper: 0.2, alphaBottom: 0, alphaTop: 0.5 });
  assert.equal(G.triangleCount(d), 12);
  assert.equal(d.positions.length / 3, 24);
  assert.equal(d.colors.length / 4, 24);
  assert.equal(d.uvs.length / 2, 24);
  assert.ok(d.indices.every((i) => i >= 0 && i < 24));
  assert.ok(finiteAll(d.positions) && finiteAll(d.colors) && finiteAll(d.uvs));
  const xs = (y) => d.positions.filter((_, i) => i % 3 === 0 && d.positions[i + 1] === y);
  assert.deepEqual([Math.min(...xs(0)), Math.max(...xs(0))], [0, 10]);
  assert.deepEqual([Math.min(...xs(4)), Math.max(...xs(4))], [1, 9]);
  const alphas = d.colors.filter((_, i) => i % 4 === 3);
  assert.ok(alphas.includes(0) && alphas.includes(0.5));
});

test("appendBox: outward winding (every face normal points away from the box centre)", () => {
  const d = G.createMeshData();
  G.appendBox(d, { x0: -1, x1: 1, y0: -2, y1: 2, z0: -3, z1: 3 });
  const P = (i) => d.positions.slice(i * 3, i * 3 + 3);
  for (let t = 0; t < d.indices.length; t += 3) {
    const [a, b, c] = [P(d.indices[t]), P(d.indices[t + 1]), P(d.indices[t + 2])];
    const u = b.map((v, k) => v - a[k]);
    const w = c.map((v, k) => v - a[k]);
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const dot = n[0] * a[0] + n[1] * a[1] + n[2] * a[2]; // centre is the origin
    assert.ok(dot > 0, `triangle ${t / 3}`);
  }
});

test("textures: pattern differs by level, not by hue alone (R16.7)", () => {
  const st = G.stippleData(32), ha = G.hatchData(32), so = G.softData(32);
  assert.equal(st.length, 32 * 32 * 4);
  const alphaSet = (t) => new Set(Array.from(t).filter((_, i) => i % 4 === 3));
  assert.ok(alphaSet(st).size === 2 && alphaSet(ha).size === 2);
  const cover = (t) => Array.from(t).filter((_, i) => i % 4 === 3 && t[i] > 0).length / (32 * 32);
  assert.ok(cover(ha) < 0.2, "hatch is sparse"); // line hatch, mostly transparent
  assert.equal(cover(st), 1); // haze everywhere, dots stronger
  assert.ok(so[(16 * 32 + 16) * 4 + 3] > 240 && so[3] < 10, "soft: strong centre, transparent corner");
  assert.deepEqual(Array.from(G.hatchData(32)), Array.from(ha)); // deterministic
});

test("evidence boxes: four levels, Not indicated draws nothing, unknown level is Not assessed", () => {
  const boxes = G.evidenceBoxes(synthetic());
  assert.deepEqual(boxes.map((b) => b.level).sort(), [0, 2, 3]);
  const by = (lv) => boxes.find((b) => b.level === lv);
  assert.ok(by(3).color[0] > by(3).color[2], "Observed is orange");
  assert.ok(by(2).color[2] > by(2).color[0], "Possible is blue");
  assert.equal(by(3).tile, 0); // solid glow
  assert.ok(by(2).tile > 0 && by(0).tile > 0); // textured patterns
  assert.equal(G.levelIndexOf({ level: "something else" }), G.LEVEL_NOT_ASSESSED);
  assert.equal(G.levelIndexOf({ level: S.STRINGS.levels[1] }), G.LEVEL_NOT_INDICATED);
});

test("cloud boxes: soft volumes, estimated base fades to zero alpha, bounds follow display scale", () => {
  const boxes = G.cloudBoxes(synthetic());
  assert.equal(boxes.length, 2);
  assert.ok(boxes[0].alphaBottom > 0 && boxes[1].alphaBottom === 0);
  assert.equal(boxes[1].baseEstimated, true);
  assert.equal(boxes[0].y1, S.ftToDisplayKm(20000));
  assert.equal(boxes[0].y0, S.ftToDisplayKm(15000));
  assert.ok(boxes.every((b) => b.taper > 0 && b.x1 > b.x0));
  assert.equal(G.cloudBoxes(synthetic({ clouds: [{ x0Km: 5, x1Km: 5, zKm: 0, halfWidthKm: 1, topFt: 1, baseFt: 0 }] })).length, 0);
});

test("labels: airport codes, Top of climb, and 'estimated' on the nearest estimated bases only", () => {
  const sc = synthetic();
  const labels = G.pickLabels(sc);
  const texts = labels.map((l) => l.text);
  assert.ok(texts.includes("AAAA") && texts.includes("BBBB") && texts.includes("Top of climb"));
  assert.ok(texts.includes(`base ${S.STRINGS.baseEstimated}`));
  assert.equal(labels.filter((l) => l.kind === "base").length, 1); // only the cloud with a null base
  const many = synthetic({
    clouds: Array.from({ length: 10 }, (_, i) => ({ lane: 1, step: i, x0Km: i * 10, x1Km: i * 10 + 10, zKm: 0, halfWidthKm: 3, topFt: 20000, baseFt: null, bottomFt: 19650, baseEstimated: true })),
  });
  assert.equal(G.pickLabels(many).filter((l) => l.kind === "base").length, G.MAX_BASE_LABELS);
  // 21.7: the base label sits at the far end and lane edge of its volume, width 4.5, never at the centre.
  const b = G.pickLabels(many).find((l) => l.kind === "base");
  const cl = many.clouds.find((c) => c.x1Km === b.x);
  assert.ok(cl, "label x is the far end of a volume");
  assert.equal(b.z, cl.zKm + cl.halfWidthKm);
  assert.equal(b.width, 4.5);
  assert.notEqual(b.x, (cl.x0Km + cl.x1Km) / 2);
});

test("lane sheets, airport markers and the frame are finite and non-empty", () => {
  const sc = synthetic();
  assert.equal(G.guideBoxes(sc).length, 3);
  const g = G.guideBoxes(sc);
  assert.ok(g[1].alpha > g[0].alpha, "current lane is stronger");
  assert.ok(G.airportBoxes(sc).length >= 7);
  for (const aspect of [0.46, 1, 1.78]) {
    const boxes = G.cockpitBoxes(aspect, 75);
    assert.ok(boxes.length >= 8 && finiteAll(boxes));
    assert.ok(boxes.every((b) => b.x1 > b.x0 && b.y1 > b.y0 && b.z1 > b.z0 && b.z1 < 0));
  }
  assert.ok(G.openingFraction() > 0.5, "windshield opening is more than half of the screen");
});

test("tuning: adjacent lanes stay inside the horizontal view from the eye (VEX, LATK, FOV together)", () => {
  const aspect = 16 / 9;
  const vfov = G.fovForAspect(aspect, S.DEFAULT_FOV_DEG);
  const half = G.hfovDeg(vfov, aspect) / 2;
  const spacing = 15 * S.LATK; // true lane spacing 15 km
  // The next lane over is visible at 8 km ahead and beyond; the one after it at 16 km ahead.
  assert.ok(G.bearingDeg(spacing, 8) < half);
  assert.ok(G.bearingDeg(2 * spacing, 16) < half);
  // It is still clearly apart from the centre line at the end of the view distance (at least 3 degrees).
  assert.ok(G.bearingDeg(spacing, S.VIEW_KM) > 3);
  assert.ok(S.LATK >= 0.2 && S.LATK <= 1);
  assert.ok(G.EYE_HEIGHT_KM > 0 && G.EYE_HEIGHT_KM < 5);
  // Phones: the field widens but stays capped.
  assert.ok(G.fovForAspect(390 / 844) > S.DEFAULT_FOV_DEG && G.fovForAspect(390 / 844) <= G.MAX_VFOV_DEG);
  assert.equal(G.fovForAspect(16 / 9), S.DEFAULT_FOV_DEG);
});

test("camera orientation: looks along +x with z to the right; yaw turns toward +z", () => {
  const e0 = G.cameraEuler({});
  assert.ok(Math.abs(e0.y + Math.PI / 2) < 1e-12 && e0.x === 0 && e0.z === 0);
  assert.deepEqual(G.lookDirection({}).map((v) => Math.round(v * 1e9) / 1e9), [1, 0, 0]);
  const d = G.lookDirection({ yawDeg: 90 });
  assert.ok(Math.abs(d[2] - 1) < 1e-12);
  // three.js YXZ camera looks along -z rotated by y: (-sin y, -cos y) in (x, z) must equal the look direction.
  for (const yaw of [-30, 0, 45, 90]) {
    const ey = G.cameraEuler({ yawDeg: yaw }).y;
    const dir = G.lookDirection({ yawDeg: yaw });
    assert.ok(Math.abs(-Math.sin(ey) - dir[0]) < 1e-12 && Math.abs(-Math.cos(ey) - dir[2]) < 1e-12);
  }
  assert.ok(G.cameraEuler({ pitchDeg: 8 }).x > 0 && G.cameraEuler({ rollDeg: 10 }).z < 0);
});

test("draw plan: within MAX_TRIANGLES for the default caps, and the budget drops in priority order", () => {
  const plan = G.buildDrawPlan(synthetic());
  assert.ok(plan.triangles <= S.MAX_TRIANGLES);
  assert.equal(plan.clouds.length, 2);
  assert.equal(plan.observed.length + plan.possible.length + plan.notAssessed.length, 3);
  assert.deepEqual(plan.dropped, { cloud: 0, observed: 0, possible: 0, notAssessed: 0 });

  // Full caps: 160 clouds and 240 bands of one level each (synthetic).
  const lv = [3, 2, 0];
  const full = synthetic({
    clouds: Array.from({ length: S.MAX_CLOUD_VOLUMES }, (_, i) => ({ x0Km: i, x1Km: i + 1, zKm: 0, halfWidthKm: 3, topFt: 20000, baseFt: 15000, bottomFt: 15000 })),
    evidence: Array.from({ length: S.MAX_EVIDENCE_BANDS }, (_, i) => ({ levelIndex: lv[i % 3], x0Km: i, x1Km: i + 1, zKm: 0, halfWidthKm: 3, loFt: 30000, hiFt: 31000 })),
  });
  const pf = G.buildDrawPlan(full);
  assert.ok(pf.triangles <= S.MAX_TRIANGLES, `${pf.triangles}`);
  assert.equal(pf.dropped.cloud + pf.dropped.observed + pf.dropped.possible + pf.dropped.notAssessed, 0);

  const tight = G.buildDrawPlan(full, { maxTriangles: pf.fixedTriangles + 12 * 200 });
  assert.ok(tight.triangles <= pf.fixedTriangles + 12 * 200);
  assert.equal(tight.dropped.notAssessed, 80, "Not assessed goes first");
  assert.equal(tight.dropped.possible, 80, "Possible goes second");
  assert.equal(tight.dropped.cloud, 40, "clouds go before Observed bands");
  assert.equal(tight.dropped.observed, 0, "Observed is dropped last");
  const tighter = G.buildDrawPlan(full, { maxTriangles: pf.fixedTriangles + 12 * 100 });
  assert.equal(tighter.observed.length, 80, "all Observed bands kept while clouds can still go");
  assert.ok(tighter.dropped.cloud > 0);
});

test("draw plan on the real cases (via buildScene): finite, under budget, Observed bands match the scene", () => {
  for (const n of names) {
    const file = load(n);
    const sc = S.buildScene(file, null, { phase: "cruise" }, { departureElevFt: 0, arrivalElevFt: 0 });
    const plan = G.buildDrawPlan(sc);
    assert.ok(plan.triangles <= S.MAX_TRIANGLES, n);
    assert.ok(finiteAll(plan.clouds) && finiteAll(plan.observed) && finiteAll(plan.possible) && finiteAll(plan.notAssessed), n);
    const obs = sc.evidence.filter((b) => G.levelIndexOf(b) === G.LEVEL_OBSERVED).length;
    assert.equal(plan.observed.length, obs, n);
    assert.equal(plan.clouds.length, sc.clouds.filter((c) => c.x1Km - c.x0Km > 1e-6).length, n);
  }
});

test("CD-P34 evidence box alpha is scaled by weight and geometryKey mixes it (synthetic)", () => {
  const a = synthetic();
  const full = G.evidenceBoxes(a);
  const faint = G.evidenceBoxes({ ...a, evidence: a.evidence.map((b) => ({ ...b, weight: 0.25 })) });
  assert.equal(full.length, faint.length);
  full.forEach((b, i) => {
    assert.ok(Math.abs(faint[i].alpha - b.alpha * 0.25) < 1e-12);
    assert.equal(faint[i].level, b.level);
    assert.equal(faint[i].y0, b.y0);
  });
  assert.notEqual(G.geometryKey({ ...a, evidence: a.evidence.map((b) => ({ ...b, weight: 1 })) }),
    G.geometryKey({ ...a, evidence: a.evidence.map((b) => ({ ...b, weight: 0.25 })) }));
});

test("geometryKey: stable for equal scenes, changes with geometry, ignores camera and cloudAlpha", () => {
  const a = synthetic();
  assert.equal(G.geometryKey(a), G.geometryKey(synthetic()));
  assert.equal(G.geometryKey(a), G.geometryKey(synthetic({ cloudAlpha: 0.3, camera: { ...a.camera, pos: [5, 31, 0] } })));
  const moved = synthetic({ clouds: [{ ...a.clouds[0], topFt: 21000 }, a.clouds[1]] });
  assert.notEqual(G.geometryKey(a), G.geometryKey(moved));
  const lane = synthetic({ lanes: a.lanes.map((l, i) => ({ ...l, isCurrent: i === 0 })) });
  assert.notEqual(G.geometryKey(a), G.geometryKey(lane));
});

test("the plan does not change the scene (frozen input, synthetic)", () => {
  const deep = (o) => { if (o && typeof o === "object") { Object.values(o).forEach(deep); Object.freeze(o); } return o; };
  const sc = deep(synthetic());
  assert.doesNotThrow(() => G.buildDrawPlan(sc));
  assert.doesNotThrow(() => G.geometryKey(sc));
});

test("cockpit3d.js imports only the scene, the geometry helpers, the WebGL test and the vendored library", () => {
  const src = readFileSync(path.resolve(here, "../../static/cloud-dive/cockpit3d.js"), "utf8");
  const imports = [...src.matchAll(/^\s*(?:import|export)\b[^;]*?from\s+"([^"]+)"/gms)].map((m) => m[1]).sort();
  assert.deepEqual(imports, ["./chase.js", "./cockpit-geometry.js", "./cockpit-geometry.js", "./scene.js", "./vendor/three/three.module.min.js", "./webgl-test.js"]);
  assert.ok(!/https?:\/\//.test(src.replace(/\/\/.*$/gm, "")), "no CDN");
  assert.ok(!/engine\.js|render\.js|controller\.js/.test(src.replace(/\/\/.*$/gm, "")), "no engine or case access");
});

test("cockpit3d.js loads in Node and re-exports the WebGL test", async () => {
  const mod = await import("../../static/cloud-dive/cockpit3d.js");
  assert.equal(typeof mod.createCockpit, "function");
  assert.equal(mod.webglAvailable, webglAvailable);
  assert.equal(mod.EYE_HEIGHT_KM, G.EYE_HEIGHT_KM);
});

test("frost: opacity = min(1, 2 x effects.frost) at ice 0, 25, 50, 100 (R22.6)", () => {
  const at = (ice) => G.frostOpacity({ effects: { frost: ice / 100 } });
  assert.equal(at(0), 0);
  assert.equal(at(25), 0.5);
  assert.equal(at(50), 1);
  assert.equal(at(100), 1);
});

test("lane guides: one thin dashed strip per lane, dash texture generated (R22.7)", () => {
  const g = G.guideBoxes(synthetic());
  assert.equal(g.length, 3);
  for (const b of g) {
    assert.ok(b.z1 - b.z0 <= 0.07 && b.z1 - b.z0 > 0, "thin strip");
    assert.ok(b.tile > 0, "dash tile set");
  }
  const d = G.dashData(32);
  assert.equal(d.length, 32 * 32 * 4);
  const alphas = new Set(Array.from(d).filter((_, i) => i % 4 === 3));
  assert.deepEqual([...alphas].sort((a, b) => a - b), [0, 255]);
  assert.deepEqual(Array.from(G.dashData(32)), Array.from(d));
});

test("frost: opacity is clamped, doubled, zero when absent (R18.1)", () => {
  assert.equal(G.frostOpacity({ effects: { frost: 0.37 } }), 0.74);
  assert.equal(G.frostOpacity({ effects: { frost: 2 } }), 1);
  assert.equal(G.frostOpacity({ effects: { frost: -1 } }), 0);
  assert.equal(G.frostOpacity({ effects: { frost: NaN } }), 0);
  assert.equal(G.frostOpacity({}), 0);
  assert.equal(G.frostOpacity(null), 0);
});

test("frost: opacity never decreases as the ice index grows (synthetic, R18.1)", () => {
  let prev = -1;
  for (let ice = 0; ice <= 100; ice += 5) {
    const o = G.frostOpacity({ effects: { frost: ice / 100 } });
    assert.ok(o >= prev);
    prev = o;
  }
});

test("frost texture: generated, deterministic, edges stronger than centre (R18.1)", () => {
  const a = G.frostData(64), b = G.frostData(64);
  assert.equal(a.length, 64 * 64 * 4);
  assert.deepEqual(Array.from(a), Array.from(b));
  const alpha = (x, y) => a[(y * 64 + x) * 4 + 3];
  assert.equal(alpha(32, 32), 0);
  let edge = 0;
  for (let i = 0; i < 64; i++) edge += alpha(0, i) + alpha(63, i);
  assert.ok(edge > 0);
});

test("frost rect: covers the windshield opening, not the panel (R18.1)", () => {
  const r = G.frostRect(1.78, 60);
  const h = Math.tan((60 * Math.PI) / 360);
  assert.ok(r.y0 > -h && r.y1 === h && r.x0 < 0 && r.x1 > 0);
});
