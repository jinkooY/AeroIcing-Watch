// CD-P20: renderer curtain columns, both array shapes (task 10.1).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as E from "../../static/cloud-dive/engine.js";
import { curtainColumns } from "../../static/cloud-dive/render.js";

const casesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../static/cloud-dive/cases");
const caseFiles = readdirSync(casesDir).filter((n) => n.endsWith(".json") && n !== "index.json" && n !== "basemap.json");

// Independent count straight from the raw arrays: group object (flat array) or {shape,data}.
function rawStates(sat) {
  return Array.isArray(sat.state) ? sat.state : sat.state.data;
}

for (const name of caseFiles) {
  test(`CD-P20 real case ${name}: curtain columns = steps with state not observed/clear`, () => {
    const file = JSON.parse(readFileSync(path.join(casesDir, name), "utf8"));
    const c = E.loadCase(file);
    const st = rawStates(file.satellite);
    let anyMissing = false;
    for (let lane = 0; lane < c.nLanes; lane++) {
      let expected = 0;
      for (let s = 0; s < c.nSteps; s++) {
        const v = st[lane * (c.nSteps + 1) + s];
        if (v !== 0 && v !== 1) expected++;
      }
      const got = curtainColumns(file, c, lane);
      assert.equal(got.length, expected);
      if (expected) anyMissing = true;
    }
    assert.ok(Array.isArray(file.satellite.state), "real cases use the group-object shape");
    void anyMissing;
  });
}

// States per lane (nSteps = 3, so 4 entries per lane): 0 observed, 1 clear, 2/3 not usable.
const synthC = { nSteps: 3, nLanes: 2 };
const synthState = [0, 2, 1, 3, 3, 3, 0, 1];

test("CD-P20 synthetic group-object shape (flat arrays)", () => {
  const file = { satellite: { shape: [2, 4], state: synthState } };
  assert.deepEqual(curtainColumns(file, synthC, 0), [1]);
  assert.deepEqual(curtainColumns(file, synthC, 1), [0, 1]);
});

test("CD-P20 synthetic {shape,data} shape", () => {
  const file = { satellite: { state: { shape: [2, 4], data: synthState } } };
  assert.deepEqual(curtainColumns(file, synthC, 0), [1]);
  assert.deepEqual(curtainColumns(file, synthC, 1), [0, 1]);
});

test("CD-P20 synthetic file without satellite flags no columns here", () => {
  assert.deepEqual(curtainColumns({}, synthC, 0), []);
});
