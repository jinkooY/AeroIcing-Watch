// Node tests for static/cloud-dive/report.js on a REAL exported case (task 8.4).
// Run: node --test "tests/js/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as E from "../../static/cloud-dive/engine.js";
import * as R from "../../static/cloud-dive/report.js";
import { referenceWithDeparture, withDeparture } from "../../static/cloud-dive/departure.js";

const casesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../static/cloud-dive/cases");
const data = JSON.parse(readFileSync(path.join(casesDir, "20261101-kden-klax-2100z.json"), "utf8"));
const c = E.loadCase(data);

const BANNED = /\b(no icing|ice-free|safe|clear of ice|light|moderate|severe|likely|unlikely)\b/i;
const NO_CLAIMS = /leaderboard|airline|world|global|top \d+|ranked #|rank \d/i;

const arrived = (key = "best") => E.flyPolicy(c, data.references[key].policy);
const diverted = () => {
  // Straight ahead with anti-ice off: the ice index reaches 100 on this case.
  const actions = Array.from({ length: c.nSteps }, () => [c.startLane, c.startAlt, false]);
  return E.flyPolicy(c, actions);
};

function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
}

test("report is null while the flight is on", () => {
  assert.equal(R.buildReport(c, E.initialState(c), data.references, data.params), null);
});

test("arrived flight replaying Best matches the stored Best and reaches 100 percent of the saving", () => {
  const st = arrived("best");
  assert.equal(st.status, "arrived");
  const rep = R.buildReport(c, st, data.references, data.params);
  assert.equal(rep.ranked, true);
  assert.ok(Math.abs(rep.totalUsd - (data.references.best.costUsd + data.params.departureClimbUsd)) < 1e-6 * rep.totalUsd);
  assert.ok(Math.abs(rep.savingSharePercent - 100) < 1e-6);
  assert.equal(rep.costUpToDiversionUsd, null);
});

test("components sum to the total and include all seven labels, Departure climb among them", () => {
  const rep = R.buildReport(c, arrived("straight_ahead"), data.references, data.params);
  assert.deepEqual(rep.components.map((x) => x.key), ["base", "climb", "departure", "detour", "antiIce", "ice", "diversion"]);
  assert.equal(rep.components.find((x) => x.key === "departure").label, "Departure climb");
  assert.equal(rep.components.find((x) => x.key === "departure").usd, data.params.departureClimbUsd);
  const sum = rep.components.reduce((a, x) => a + x.usd, 0);
  assert.ok(Math.abs(sum - rep.totalUsd) < 1e-6);
  for (const x of rep.components) assert.ok(x.usd >= 0);
});

test("kilometres per level list all four levels and sum to the distance flown", () => {
  for (const st of [arrived("wasteful"), diverted()]) {
    const rep = R.buildReport(c, st, data.references, data.params);
    assert.equal(rep.kmPerLevel.length, 4);
    assert.deepEqual(rep.kmPerLevel.map((x) => x.label), R.LEVEL_LABELS);
    const sum = rep.kmPerLevel.reduce((a, x) => a + x.km, 0);
    assert.ok(Math.abs(sum - rep.distanceKm) < 0.001);
  }
});

test("Straight-ahead replay shares 0 percent and minutes with anti-ice are reported", () => {
  const rep = R.buildReport(c, arrived("straight_ahead"), data.references, data.params);
  assert.ok(Math.abs(rep.savingSharePercent) < 1e-6);
  assert.ok(rep.minutesAntiIce >= 0);
  assert.equal(rep.references.best, data.references.best.costUsd + data.params.departureClimbUsd);
  assert.ok(rep.references.wasteful > rep.references.best);
});

test("diverted flight is not ranked: cost up to diversion plus diversion cost, no share", () => {
  const st = diverted();
  assert.equal(st.status, "diverted");
  const rep = R.buildReport(c, st, data.references, data.params);
  assert.equal(rep.ranked, false);
  assert.equal(rep.savingSharePercent, null);
  assert.equal(rep.diversionUsd, c.params.diversionUsd);
  assert.ok(Math.abs(rep.costUpToDiversionUsd + rep.diversionUsd + rep.departureUsd - rep.totalUsd) < 1e-9);
  assert.equal(rep.departureUsd, data.params.departureClimbUsd);
  assert.equal(rep.icePeak, 100);
  assert.match(R.shareText(rep, "Case"), /not ranked/);
});

test("savingSharePercent runs from Straight-ahead (0) to Best (100), goes negative, caps at 100, null for bad inputs", () => {
  assert.equal(R.savingSharePercent(150, 100, 200), 50);
  assert.equal(R.savingSharePercent(200, 100, 200), 0);
  assert.equal(R.savingSharePercent(250, 100, 200), -50);
  assert.equal(R.savingSharePercent(90, 100, 200), 100);
  // Synthetic: KBUF-KPWM-like case, always-on cost 1809 above Straight-ahead 1808, Best below both.
  assert.ok(R.savingSharePercent(1809, 1700, 1808) < 0);
  assert.equal(R.savingSharePercent(1809, 1808, 1808), null);
  assert.equal(R.savingSharePercent(1700, 1808, 1808), null);
  assert.equal(R.savingSharePercent(150, null, 200), null);
  assert.equal(R.savingSharePercent(150, 200, 200), null);
  assert.equal(R.savingSharePercent(NaN, 100, 200), null);
});

test("missing references give null costs and no share, without throwing", () => {
  const rep = R.buildReport(c, arrived("best"), undefined, data.params);
  assert.deepEqual(rep.references, { best: null, straight_ahead: null, wasteful: null });
  assert.equal(rep.savingSharePercent, null);
  assert.doesNotMatch(R.shareText(rep, "Case"), /NaN|null|undefined/);
});

test("personal best: first result saves, worse is ignored, better replaces", () => {
  const store = fakeStorage();
  const good = R.buildReport(c, arrived("best"), data.references, data.params);
  const worse = R.buildReport(c, arrived("straight_ahead"), data.references, data.params);
  assert.equal(R.readPersonalBest(store, "x"), null);
  let r = R.recordPersonalBest(store, "x", worse);
  assert.deepEqual([r.isNew, r.saved, r.best], [true, true, worse.totalUsd]);
  r = R.recordPersonalBest(store, "x", R.buildReport(c, arrived("wasteful"), data.references, data.params));
  assert.deepEqual([r.isNew, r.best], [false, worse.totalUsd]);
  r = R.recordPersonalBest(store, "x", good);
  assert.deepEqual([r.isNew, r.best], [true, good.totalUsd]);
  assert.equal(R.readPersonalBest(store, "x"), good.totalUsd);
  assert.equal(R.readPersonalBest(store, "other"), null); // per case
});

test("diverted flight never becomes a personal best", () => {
  const store = fakeStorage();
  const r = R.recordPersonalBest(store, "x", R.buildReport(c, diverted(), data.references, data.params));
  assert.equal(r.saved, false);
  assert.equal(store.m.size, 0);
});

test("unavailable storage (null, throwing, corrupt value) is handled", () => {
  const rep = R.buildReport(c, arrived("best"), data.references, data.params);
  const r1 = R.recordPersonalBest(null, "x", rep);
  assert.deepEqual([r1.available, r1.saved, r1.isNew], [false, false, false]);
  const boom = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("quota"); } };
  const r2 = R.recordPersonalBest(boom, "x", rep);
  assert.deepEqual([r2.available, r2.saved], [false, false]);
  assert.equal(R.readPersonalBest(boom, "x"), null);
  const bad = { getItem: () => "not json{", setItem() {} };
  assert.equal(R.readPersonalBest(bad, "x"), null);
});

test("share text and report labels avoid R9.1 words and ranking claims", () => {
  const texts = [R.shareText(R.buildReport(c, arrived("straight_ahead"), data.references, data.params), data.title),
    R.shareText(R.buildReport(c, diverted(), data.references, data.params), data.title)];
  for (const l of [...R.LEVEL_LABELS, ...R.COMPONENT_LABELS.map((x) => x[1]),
    ...R.REFERENCE_LABELS.flat()]) texts.push(l);
  for (const t of texts) {
    assert.doesNotMatch(t, BANNED, t);
    assert.doesNotMatch(t, NO_CLAIMS, t);
  }
  assert.match(texts[0], /Game model/);
  assert.match(texts[0], /not a flight procedure/);
});

test("personal best key is v2 and an old v1 value is ignored", () => {
  assert.equal(R.STORAGE_PREFIX, "cloud-dive:best:v2:");
  const store = fakeStorage();
  store.setItem("cloud-dive:best:x", "1");
  assert.equal(R.readPersonalBest(store, "x"), null);
  R.recordPersonalBest(store, "x", R.buildReport(c, arrived("best"), data.references, data.params));
  assert.ok(store.m.has("cloud-dive:best:v2:x"));
});

test("departure constant: totals and references shift by it, the saving share does not (CD-P29, JS side)", () => {
  const d = data.params.departureClimbUsd;
  assert.ok(d > 0);
  const noConst = { ...data.params };
  delete noConst.departureClimbUsd;
  for (const key of ["best", "straight_ahead", "wasteful"]) {
    const st = arrived(key);
    const a = R.buildReport(c, st, data.references, data.params);
    const b = R.buildReport(c, st, data.references, noConst);
    assert.ok(Math.abs(a.totalUsd - b.totalUsd - d) < 1e-9);
    assert.ok(Math.abs(a.references.best - b.references.best - d) < 1e-9);
    assert.ok(Math.abs(a.savingSharePercent - b.savingSharePercent) < 1e-9);
    assert.equal(a.components.find((x) => x.key === "departure").usd, d);
    assert.equal(b.components.find((x) => x.key === "departure").usd, 0);
  }
  assert.equal(withDeparture(100, data.params), 100 + d);
  assert.equal(withDeparture(100, {}), 100);
  assert.equal(referenceWithDeparture(null, data.params), null);
});