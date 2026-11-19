// Task 22.2 (revision d, R23.1 to R23.2, CD-P36; first numbered CD-P27 by mistake): cloud puffs are deterministic, lie inside their volume, respect the cap,
// and stay thin and faint for an estimated base. Hand-built scenes are labelled synthetic; the real-case test builds the
// scene from the three case files.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as E from "../../static/cloud-dive/engine.js";
import * as S from "../../static/cloud-dive/scene.js";
import * as G from "../../static/cloud-dive/cockpit-geometry.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const casesDir = path.resolve(here, "../../static/cloud-dive/cases");
const names = readdirSync(casesDir).filter((n) => /^\d.*\.json$/.test(n));
const load = (n) => JSON.parse(readFileSync(path.join(casesDir, n), "utf8"));
const deepFreeze = (o) => { Object.values(o).forEach((v) => v && typeof v === "object" && deepFreeze(v)); return Object.freeze(o); };
const EPS = 1e-9;

const cloud = (i, over = {}) => ({
  lane: 1, step: i, x0Km: i * 10, x1Km: i * 10 + 10, zKm: 0, halfWidthKm: 3.75, topFt: 14000, baseFt: 10000,
  bottomFt: 10000, baseEstimated: false, faded: false, ...over,
});
const synthSceneWith = (clouds) => deepFreeze({ clouds });

function inside(p, boxes) {
  return boxes.some((b) =>
    p.x - p.w / 2 - p.drift >= b.x0 - EPS && p.x + p.w / 2 + p.drift <= b.x1 + EPS &&
    p.z - p.w / 2 - p.drift >= b.z0 - EPS && p.z + p.w / 2 + p.drift <= b.z1 + EPS &&
    p.y - p.h / 2 >= b.y0 - EPS && p.y + p.h / 2 <= b.y1 + EPS);
}

test("puffs: same input gives the same puffs, input may be deep frozen (CD-P36, synthetic)", () => {
  const scene = synthSceneWith([cloud(0), cloud(1), cloud(2, { baseFt: null, bottomFt: 13650, baseEstimated: true })]);
  const a = G.cloudPuffs(scene);
  const b = G.cloudPuffs(scene);
  assert.ok(a.length > 0);
  assert.deepEqual(a, b);
});

test("puffs: every puff lies inside its volume and all numbers are finite (CD-P36, synthetic)", () => {
  const scene = synthSceneWith([cloud(0), cloud(1, { topFt: 30000, baseFt: 6000, bottomFt: 6000 }), cloud(2, { x1Km: 60 })]);
  const boxes = G.cloudBoxes(scene);
  const puffs = G.cloudPuffs(scene);
  for (const p of puffs) {
    assert.ok([p.x, p.y, p.z, p.w, p.h, p.shade, p.alpha, p.phase, p.drift].every(Number.isFinite));
    assert.ok(p.drift >= 0 && p.drift <= G.PUFF_DRIFT_KM + EPS && p.phase >= 0 && p.phase <= 1);
    assert.ok(p.w > 0 && p.h > 0 && p.alpha > 0 && p.alpha <= 1 && p.shade > 0 && p.shade <= 1);
    assert.ok([0, 1, 2, 3].includes(p.variant));
    assert.ok(inside(p, boxes), `puff outside its volume: ${JSON.stringify(p)}`);
  }
});

test("puffs: an estimated base gives thin faint puffs, the top is lighter than the underside (synthetic)", () => {
  const thin = G.cloudPuffs(synthSceneWith([cloud(0, { baseFt: null, bottomFt: 13650, baseEstimated: true })]));
  const solid = G.cloudPuffs(synthSceneWith([cloud(0, { topFt: 30000, baseFt: 4000, bottomFt: 4000 })]));
  assert.ok(thin.length > 0 && solid.length > 0);
  assert.ok(thin.every((p) => p.h <= p.w * 0.3 + EPS && p.alpha < 0.4));
  const low = Math.min(...solid.map((p) => p.shade)), high = Math.max(...solid.map((p) => p.shade));
  assert.ok(high > low, "tall volumes should have lighter tops");
});

test("puffs: the count stays under the cap and thinning is deterministic (synthetic)", () => {
  const many = synthSceneWith(Array.from({ length: 160 }, (_, i) => cloud(i % 40, { lane: Math.floor(i / 40), zKm: (Math.floor(i / 40) - 2) * 7.5,
    topFt: 30000, baseFt: 5000, bottomFt: 5000 })));
  const a = G.cloudPuffs(many);
  assert.ok(a.length <= G.MAX_PUFFS);
  assert.deepEqual(a, G.cloudPuffs(many));
  assert.ok(G.cloudPuffs(many, 50).length === 50);
});

test("puffs: nothing is drawn without a cloud volume, and empty or degenerate volumes give no puffs (synthetic)", () => {
  assert.deepEqual(G.cloudPuffs({}), []);
  assert.deepEqual(G.cloudPuffs({ clouds: [] }), []);
  assert.deepEqual(G.cloudPuffs(synthSceneWith([cloud(0, { x1Km: 0 })])), []);
});

test("puffs: real cases, scenes along the route give finite puffs inside their volumes within the cap", () => {
  for (const n of names) {
    const file = load(n);
    const c = E.loadCase(file);
    for (const step of [0, Math.floor(c.nSteps / 4), Math.floor(c.nSteps / 2), c.nSteps - 3]) {
      const state = deepFreeze({ ...E.initialState(c), step });
      const scene = S.buildScene(file, state, { phase: "cruise" }, {});
      const boxes = G.cloudBoxes(scene);
      const puffs = G.cloudPuffs(scene);
      assert.ok(puffs.length <= G.MAX_PUFFS, `${n} step ${step}`);
      assert.ok(puffs.every((p) => Object.values(p).every(Number.isFinite) && inside(p, boxes)), `${n} step ${step}`);
      assert.deepEqual(puffs, G.cloudPuffs(S.buildScene(file, state, { phase: "cruise" }, {})), `${n} step ${step}`);
      if (!scene.clouds.length) assert.equal(puffs.length, 0);
    }
  }
});

test("puff atlas: size, value range, soft edge and lumpy centre (synthetic texture check)", () => {
  const size = G.PUFF_TILE * 2;
  const data = G.puffAtlasData();
  assert.equal(data.length, size * size * 4);
  assert.deepEqual(G.puffAtlasData(), data); // deterministic
  const alphaAt = (x, y) => data[(y * size + x) * 4 + 3];
  for (const [ox, oy] of [[0, 0], [G.PUFF_TILE, 0], [0, G.PUFF_TILE], [G.PUFF_TILE, G.PUFF_TILE]]) {
    assert.equal(alphaAt(ox, oy), 0, "tile corner is transparent");
    assert.ok(alphaAt(ox + G.PUFF_TILE / 2, oy + G.PUFF_TILE / 2) > 150, "tile centre is dense");
  }
  const centres = [0, 1, 2, 3].map((v) => alphaAt((v % 2) * G.PUFF_TILE + 20, Math.floor(v / 2) * G.PUFF_TILE + 24));
  assert.ok(new Set(centres).size > 1, "variants differ");
});

test("no Math.random and no clock in the cloud drawing code (R23.1)", () => {
  const src = readFileSync(path.resolve(here, "../../static/cloud-dive/cockpit-geometry.js"), "utf8");
  const start = src.indexOf("export const MAX_PUFFS");
  const end = src.indexOf("// Returns boxes with a `level` index.");
  const puffCode = src.slice(start, end);
  assert.ok(puffCode.length > 500);
  assert.ok(!/Math\.random|Date\.now|performance\.now/.test(puffCode));
});

test("no Math.random anywhere in the game code, vendor files excluded (R23.1)", () => {
  const dir = path.resolve(here, "../../static/cloud-dive");
  const files = readdirSync(dir).filter((n) => n.endsWith(".js"));
  assert.ok(files.length > 20);
  for (const n of files) assert.ok(!/Math\.random/.test(readFileSync(path.join(dir, n), "utf8")), `${n} uses Math.random`);
});

test("inside-cloud test: true only inside a volume footprint and between bottom and top (synthetic)", () => {
  const clouds = [cloud(1)]; // x 10..20, z -3.75..3.75, 10000..14000 ft
  const at = (x, ft, z) => G.insideCloud({ clouds, camera: { pos: [x, S.ftToDisplayKm(ft), z] } });
  assert.equal(at(15, 12000, 0), true);
  assert.equal(at(5, 12000, 0), false);
  assert.equal(at(15, 20000, 0), false);
  assert.equal(at(15, 12000, 6), false);
  assert.equal(G.insideCloud({ clouds }), false);
  assert.equal(G.insideCloud({}), false);
});

test("mist and ground textures: size, range, deterministic, mist tiles in x (synthetic texture check)", () => {
  const mist = G.mistData(64), ground = G.groundData(32);
  assert.equal(mist.length, 64 * 64 * 4);
  assert.equal(ground.length, 32 * 32 * 4);
  assert.deepEqual(G.mistData(64), mist);
  assert.deepEqual(G.groundData(32), ground);
  const a = (x, y) => mist[(y * 64 + x) * 4 + 3];
  let seam = 0, inner = 0;
  for (let y = 0; y < 64; y++) { seam += Math.abs(a(0, y) - a(63, y)); inner += Math.abs(a(31, y) - a(32, y)); }
  assert.ok(seam < 4 * inner + 64 * 40, "the left and right edges join about as smoothly as the middle");
  for (let i = 3; i < ground.length; i += 4) assert.equal(ground[i], 255);
  const alphas = new Set(Array.from({ length: 64 }, (_, y) => a(10, y)));
  assert.ok(alphas.size > 8, "mist has streaks");
});
