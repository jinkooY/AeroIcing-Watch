// Task 16.3: display-only fuel counter and wing-heat lamp (R18.3, R13.10, R4.4).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as E from "../../static/cloud-dive/engine.js";
import * as S from "../../static/cloud-dive/scene.js";
import { fuelDisplayUsd } from "../../static/cloud-dive/fuel-counter.js";

const casesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../static/cloud-dive/cases");
const names = readdirSync(casesDir).filter((n) => /^\d.*\.json$/.test(n));
const file = JSON.parse(readFileSync(path.join(casesDir, names[0]), "utf8"));

test("counter ends exactly on the engine total and never passes it", () => {
  for (const [prev, cur] of [[0, 100], [250.5, 251.75], [10, 10]]) {
    for (let i = 0; i <= 20; i++) {
      const v = fuelDisplayUsd(prev, cur, i / 20);
      assert.ok(v >= prev && v <= cur);
    }
    assert.equal(fuelDisplayUsd(prev, cur, 1), cur);
    assert.equal(fuelDisplayUsd(prev, cur, 7), cur);
    assert.equal(fuelDisplayUsd(prev, cur, 0.3, true), cur); // gate, pause, end
    assert.equal(fuelDisplayUsd(prev, cur, -2), prev);
  }
  assert.equal(fuelDisplayUsd(null, 42, 0.5), 42);
  assert.equal(fuelDisplayUsd(5, 42, NaN), 42);
});

test("counter runs faster with anti-ice on (higher per-step cost) on a real case", () => {
  const c = E.loadCase(file);
  const base = E.initialState(c);
  const rate = (antiIce) => {
    let st = E.setTargets(c, base, null, null, antiIce);
    const before = E.totalUsd(c, st);
    st = E.step(c, st);
    const after = E.totalUsd(c, st);
    return fuelDisplayUsd(before, after, 0.5) - before;
  };
  assert.ok(rate(true) > rate(false));
});

test("lamp follows the switch and effects change no engine state", () => {
  const c = E.loadCase(file);
  for (const antiIce of [false, true]) {
    const st = Object.freeze({ ...E.initialState(c), antiIce });
    const json = JSON.stringify(st);
    const scene = S.buildScene(file, st, { phase: "cruise" }, { engineCase: c });
    assert.equal(scene.effects.wingLamp, antiIce);
    assert.equal(JSON.stringify(st), json);
  }
});
