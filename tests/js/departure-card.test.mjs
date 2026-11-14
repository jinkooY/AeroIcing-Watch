// Task 17.7: departure climb status card in the 2D fallback (R19.1, R15.5, R9.1, R9.3). DOM-free.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as E from "../../static/cloud-dive/engine.js";
import * as C from "../../static/cloud-dive/departure-card.js";

const casesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../static/cloud-dive/cases");
const names = readdirSync(casesDir).filter((n) => /^\d.*\.json$/.test(n));
const load = (n) => JSON.parse(readFileSync(path.join(casesDir, n), "utf8"));
const BANNED = /no icing|ice-free|\bsafe\b|clear of ice|\blight\b|\bmoderate\b|\bsevere\b|\blikely\b|\bunlikely\b/i;

test("card text shows cost, airports and cruise level for every real case", () => {
  for (const n of names) {
    const file = load(n);
    const c = E.loadCase(file);
    const t = C.departureCardText(file, c);
    assert.equal(t.title, "Departure climb");
    assert.equal(t.cost, `$${file.params.departureClimbUsd.toFixed(2)} (illustrative)`);
    assert.equal(t.route, `${file.airports.from.icao} to ${file.airports.to.icao}`);
    assert.ok(t.level.includes(C.startAltitudeFt(c).toLocaleString("en-US")), n);
    assert.ok(t.level.includes("game altitude block"));
    assert.match(t.note, /Illustrative/);
    assert.match(t.note, /altitude block/);
    for (const v of Object.values(t)) assert.doesNotMatch(v, BANNED);
  }
});

test("card text falls back when airports and altitude are missing", () => {
  const t = C.departureCardText({ params: { departureClimbUsd: 10 } }, null);
  assert.equal(t.cost, "$10.00 (illustrative)");
  assert.match(t.route, /not listed/);
  assert.match(t.level, /not listed/);
});

test("card applies only in the 2D view, at step 0, with a constant", () => {
  const p = { departureClimbUsd: 50 };
  const st = { step: 0, status: "flying" };
  assert.equal(C.cardApplies({ view: "2d", state: st, params: p }), true);
  assert.equal(C.cardApplies({ view: "cockpit", state: st, params: p }), false);
  assert.equal(C.cardApplies({ view: "2d", state: { step: 1, status: "flying" }, params: p }), false);
  assert.equal(C.cardApplies({ view: "2d", state: st, params: {} }), false);
  assert.equal(C.cardApplies({ view: "2d", state: null, params: p }), false);
});
