// CD-P21 (map registration) and CD-P22 (map evidence = side-view level), task 11.3.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as E from "../../static/cloud-dive/engine.js";
import {
  mapProject, mapUnproject, mapEvidenceCells, syntheticMap, resolveMap, drawFollowView, drawOverview, NO_IMAGE_TEXT,
} from "../../static/cloud-dive/map.js";

const casesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../static/cloud-dive/cases");
const caseFiles = readdirSync(casesDir).filter((n) => n.endsWith(".json") && n !== "index.json" && n !== "basemap.json");

const lanePoint = (file, c, l, s) => file.lanesLatLon.data[l * (c.nSteps + 1) + s];

for (const name of caseFiles) {
  const file = JSON.parse(readFileSync(path.join(casesDir, name), "utf8"));
  const c = E.loadCase(file);
  // Real cases may not carry `map` yet (task 11.5): use the same rule as the exporter.
  const map = resolveMap(file, c);

  test(`CD-P21 real case ${name}: project/unproject within half a pixel, lanes inside the extent`, () => {
    assert.ok(map);
    for (let l = 0; l < c.nLanes; l++) {
      for (let s = 0; s <= c.nSteps; s++) {
        const [lat, lon] = lanePoint(file, c, l, s);
        const [xp, yp] = mapProject(map, lat, lon);
        assert.ok(xp >= 0 && xp <= map.width && yp >= 0 && yp <= map.height, `outside extent at ${l},${s}`);
        const [lat2, lon2] = mapUnproject(map, xp, yp);
        const [xp2, yp2] = mapProject(map, lat2, lon2);
        assert.ok(Math.abs(xp2 - xp) < 0.5 && Math.abs(yp2 - yp) < 0.5);
        assert.ok(Math.abs(lat2 - lat) < 1e-9 && Math.abs(lon2 - lon) < 1e-9);
      }
    }
  });

  test(`CD-P22 real case ${name}: map evidence equals the side-view level`, () => {
    for (const alt of [0, Math.floor(c.nAlts / 2), c.nAlts - 1]) {
      for (const step of [0, Math.floor(c.nSteps / 2)]) {
        const state = { ...E.initialState(c), step, alt };
        const cells = mapEvidenceCells(file, c, state, 12);
        assert.equal(cells.length, c.nLanes * Math.min(12, c.nSteps - step));
        for (const cell of cells) {
          assert.equal(cell.level, E.levelAt(c, cell.lane, cell.step, alt));
          assert.ok(cell.level >= 0 && cell.level < E.N_LEVELS);
        }
      }
    }
  });
}

test("CD-P21 map rule matches the Python exporter on a synthetic point", () => {
  const map = { lat0: 40, lon0: -100, xMinKm: -50, yMaxKm: 60, pxKm: 2 };
  const [x, y] = mapProject(map, 40.5, -99);
  const expX = (1 * Math.cos((40 * Math.PI) / 180) * 111.32 + 50) / 2;
  const expY = (60 - 0.5 * 110.57) / 2;
  assert.ok(Math.abs(x - expX) < 1e-9 && Math.abs(y - expY) < 1e-9);
});

test("synthetic map is built when the case has no map field and stops at no positions", () => {
  const c = { nLanes: 1, nSteps: 1 };
  const file = { lanesLatLon: { data: [[40, -100], [41, -99]] } };
  const m = syntheticMap(file, c);
  assert.equal(m.projection, "equirect-local-v1");
  assert.equal(m.pxKm, 2);
  assert.equal(syntheticMap({}, c), null);
});

// Fake 2D context recording calls and text.
function fakeCtx() {
  const calls = [];
  const texts = [];
  const ctx = new Proxy({}, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === "measureText") return () => ({ width: 10 });
      if (prop === "fillText") return (t) => { texts.push(String(t)); calls.push(["fillText", t]); };
      return (...args) => { calls.push([String(prop), ...args]); };
    },
    set(target, prop, value) { target[prop] = value; return true; },
  });
  return { ctx, calls, texts };
}

test("synthetic fallback: no image and no basemap still draws lanes, aircraft, evidence and the notice", () => {
  const file = JSON.parse(readFileSync(path.join(casesDir, caseFiles[0]), "utf8"));
  const c = E.loadCase(file);
  const state = { ...E.initialState(c), step: 5 };
  const view = { caseData: file, engineCase: c, state, images: {}, basemap: null, followKm: 200, imageKind: "ir", frac: 0 };
  for (const draw of [drawFollowView, drawOverview]) {
    const { ctx, calls, texts } = fakeCtx();
    draw(ctx, view, { x: 0, y: 0, w: 400, h: 300 });
    assert.ok(texts.includes(NO_IMAGE_TEXT), "notice shown");
    assert.ok(calls.some((c2) => c2[0] === "stroke"), "lines drawn");
    assert.ok(!calls.some((c2) => c2[0] === "drawImage"), "no image drawn");
  }
  const { ctx, calls } = fakeCtx();
  drawFollowView(ctx, view, { x: 0, y: 0, w: 400, h: 300 });
  assert.ok(calls.some((c2) => c2[0] === "fill"), "aircraft icon filled");
});

test("synthetic image draws without smoothing", () => {
  const file = JSON.parse(readFileSync(path.join(casesDir, caseFiles[0]), "utf8"));
  const c = E.loadCase(file);
  const { ctx, calls } = fakeCtx();
  const view = { caseData: file, engineCase: c, state: E.initialState(c), images: { ir: {} }, basemap: { coast: [[[40, -80], [41, -79]]], states: [] } };
  drawFollowView(ctx, view, { x: 0, y: 0, w: 400, h: 300 });
  assert.equal(ctx.imageSmoothingEnabled, false);
  assert.ok(calls.some((c2) => c2[0] === "drawImage"));
});

// ---- task 12.4: aircraft heading, label placement ----
import { laneHeading, aircraftPolygon, clampLabelX } from "../../static/cloud-dive/map.js";
import { planCurtainLabels } from "../../static/cloud-dive/render.js";

test("synthetic lane going south-west: heading points south-west and the icon nose is lower-left on screen", () => {
  const c = { nLanes: 1, nSteps: 2, stepKm: 10, lanesKm: [0] };
  const file = { lanesLatLon: { data: [[40, -100], [39.9, -100.12], [39.8, -100.24]] } };
  const map = syntheticMap(file, c);
  const h = laneHeading(map, file, c, 0, 0);
  assert.ok(Math.cos(h) < 0 && Math.sin(h) < 0, `heading ${h}`);
  const poly = aircraftPolygon(100, 100, h, 20);
  const nose = poly[0];
  assert.ok(nose[0] < 100 && nose[1] > 100, "nose lower-left of the icon centre (screen y down)");
  // The nose is the point farthest along the heading; every other point is closer.
  const along = (p) => (p[0] - 100) * Math.cos(h) + (100 - p[1]) * Math.sin(h);
  for (const p of poly.slice(1)) assert.ok(along(p) < along(nose));
  // Last step uses the last segment.
  assert.equal(laneHeading(map, file, c, 0, 2), laneHeading(map, file, c, 0, 1));
});

for (const [heading, dx, dy] of [[0, 1, 0], [Math.PI / 2, 0, -1], [Math.PI, -1, 0], [-Math.PI / 2, 0, 1]]) {
  test(`aircraft icon nose follows heading ${heading.toFixed(2)} rad (north up)`, () => {
    const nose = aircraftPolygon(0, 0, heading, 10)[0];
    assert.ok(Math.abs(nose[0] - 10 * dx) < 1e-9 && Math.abs(nose[1] - 10 * dy) < 1e-9);
  });
}

test("real cases: icon heading at the start points along the lane toward increasing step", () => {
  for (const name of caseFiles) {
    const file = JSON.parse(readFileSync(path.join(casesDir, name), "utf8"));
    const c = E.loadCase(file);
    const map = resolveMap(file, c);
    for (let l = 0; l < c.nLanes; l++) {
      const h = laneHeading(map, file, c, l, 0);
      const a = mapProject(map, ...file.lanesLatLon.data[l * (c.nSteps + 1)]);
      const b = mapProject(map, ...file.lanesLatLon.data[l * (c.nSteps + 1) + 1]);
      // Screen direction of the segment (y down) vs the nose direction of the icon.
      const nose = aircraftPolygon(a[0], a[1], h, 5)[0];
      const dot = (nose[0] - a[0]) * (b[0] - a[0]) + (nose[1] - a[1]) * (b[1] - a[1]);
      assert.ok(dot > 0, `${name} lane ${l}`);
    }
  }
});

test("clampLabelX keeps a label inside the inset", () => {
  assert.equal(clampLabelX(-4, 30, 3, 200), 3);
  assert.equal(clampLabelX(190, 30, 3, 200), 170);
  assert.equal(clampLabelX(50, 30, 3, 200), 50);
});

test("planCurtainLabels: no label on narrow runs, none overlapping, wide runs get the long label", () => {
  const runs = [[0, 10], [14, 60], [70, 300], [310, 320]];
  const plan = planCurtainLabels(runs, 80, 24);
  assert.deepEqual(plan.map((p) => p.label), ["N/A", "Not assessed"]);
  for (let i = 1; i < plan.length; i++) {
    const w = (p) => ((p.label === "Not assessed" ? 80 : 24) + 10) / 2;
    assert.ok(plan[i].cx - w(plan[i]) >= plan[i - 1].cx + w(plan[i - 1]) + 6 - 1e-9);
  }
  assert.deepEqual(planCurtainLabels([[0, 5]], 80, 24), []);
});

import { outsideLabelSpot } from "../../static/cloud-dive/map.js";

test("outsideLabelSpot: no image gives the box centre", () => {
  const s = outsideLabelSpot({ x: 0, y: 0, w: 400, h: 200 }, null, 120);
  assert.deepEqual(s, { x: 200, y: 100 });
});

test("outsideLabelSpot: uses the largest uncovered strip, inside the box", () => {
  const box = { x: 0, y: 0, w: 400, h: 200 };
  const s = outsideLabelSpot(box, { x0: 150, y0: -50, x1: 1000, y1: 500 }, 120);
  assert.deepEqual(s, { x: 75, y: 100 }); // left strip 150 wide
});

test("outsideLabelSpot: strip too small gives null (hatch only)", () => {
  const box = { x: 0, y: 0, w: 400, h: 200 };
  assert.equal(outsideLabelSpot(box, { x0: 60, y0: -5, x1: 390, y1: 205 }, 120), null);
  assert.equal(outsideLabelSpot(box, { x0: 0, y0: 0, x1: 400, y1: 200 }, 120), null);
});
