// Draw smoke test for render.js (task 11.6): runs renderScene on each real case with a recording fake
// 2D context and checks that every element of design section 9 reaches the canvas.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as E from "../../static/cloud-dive/engine.js";
import { renderScene, describeScene } from "../../static/cloud-dive/render.js";

const casesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../static/cloud-dive/cases");
const caseFiles = readdirSync(casesDir).filter((n) => /^\d.*\.json$/.test(n));

function fakeCanvas(w, h) {
  const texts = [];
  const dashes = new Set();
  let calls = 0;
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === "measureText") return (s) => ({ width: String(s).length * 6 });
      if (k === "createPattern") return () => null;
      return (...a) => {
        calls++;
        if (k === "fillText") texts.push(String(a[0]));
        if (k === "setLineDash" && a[0].length) dashes.add(a[0].join(","));
      };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return { width: w, height: h, getContext: () => ctx, texts, dashes, calls: () => calls };
}

for (const name of caseFiles) {
  test(`renderScene draws labels, dashed base, isotherms, now line and legend: ${name}`, () => {
    const file = JSON.parse(readFileSync(path.join(casesDir, name), "utf8"));
    const c = E.loadCase(file);
    const state = E.initialState ? E.initialState(c) : null;
    assert.ok(state, "engine exposes initialState");
    const cv = fakeCanvas(1100, 520);
    renderScene(cv, { caseData: file, engineCase: c, state, message: "", prev: null, frac: 1 });
    const t = cv.texts.join("|");
    for (const s of ["now", "0 C", "Altitude (ft MSL)", "Distance along route (km)", "Observed supercooled",
      "Possible (forecast only)", "Not indicated", "Not assessed (stripes)", "Supercooled liquid", "Cloud base: statistical estimate"]) {
      assert.ok(t.includes(s), `missing text: ${s}`);
    }
    assert.ok(cv.dashes.has("7,4"), "dashed estimated base");
    assert.ok(cv.calls() > 500);
    assert.match(describeScene({ caseData: file, engineCase: c, state }), /kilometres per level/);
  });
}

test("renderScene shows the message when nothing is loaded", () => {
  const cv = fakeCanvas(800, 400);
  renderScene(cv, { caseData: null, engineCase: null, state: null, message: "Case list not available." });
  assert.ok(cv.texts.includes("Case list not available."));
});
