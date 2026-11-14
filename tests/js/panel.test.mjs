// Task 15.3: DOM-free helpers of the cockpit panel (panel.js).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as E from "../../static/cloud-dive/engine.js";
import * as S from "../../static/cloud-dive/scene.js";
import * as P from "../../static/cloud-dive/panel.js";

const casesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../static/cloud-dive/cases");
const names = readdirSync(casesDir).filter((n) => /^\d.*\.json$/.test(n));
const load = (n) => JSON.parse(readFileSync(path.join(casesDir, n), "utf8"));

test("ice gauge carries the exact label and clamps the value", () => {
  const g = P.iceGauge({ ice: 42.4, iceLabel: S.STRINGS.iceIndexLabel });
  assert.equal(g.label, "Ice index (game model)");
  assert.equal(g.text, "Ice index (game model): 42 of 100");
  assert.equal(P.iceGauge({ ice: 500 }).frac, 1);
  assert.equal(P.iceGauge({ ice: -3 }).frac, 0);
  assert.equal(P.iceGauge({ ice: NaN }).value, 0);
});

test("formatting helpers", () => {
  assert.equal(P.formatUsd(1234.6), "$1,235");
  assert.equal(P.formatUsd(NaN), "$0");
  assert.equal(P.formatFeet(31000), "31,000");
  assert.equal(P.antiIceView(true).lamp, "Wing-heat lamp on");
  assert.equal(P.antiIceView(false).ariaChecked, "false");
});

test("altitude tape ticks sit on 1,000 ft multiples around the aircraft", () => {
  const t = P.altitudeTape(31250);
  assert.ok(t.ticks.length >= 8);
  assert.ok(t.ticks.every((k) => k.ft % 1000 === 0 && k.frac >= 0 && k.frac <= 1));
  assert.equal(t.readout, "31,250");
  assert.equal(P.altitudeTape(30000).ticks.find((k) => k.ft === 30000).frac, 0.5);
});

test("legend strip: four exact level names with distinct pattern words", () => {
  const expected = ["Not assessed", "Not indicated", "Possible (forecast only)", "Observed supercooled layer at planned altitude"];
  const items = P.legendItems(expected);
  assert.deepEqual(items.map((i) => i.name), expected);
  assert.equal(new Set(items.map((i) => i.pattern)).size, 4);
  assert.equal(P.levelPattern(E.NOT_INDICATED).fill, null);
});

test("source line has the UTC time; announcements are throttled", () => {
  const file = { sources: { satellite: { satellite: "GOES-16", scanStartUtc: "2026-01-05T14:30:00Z" }, forecast: { name: "ECMWF IFS", runUtc: "2026-01-05T12:00:00Z" } } };
  assert.equal(P.sourceLine(file), "Source: GOES-16 2026-01-05 14:30 UTC, ECMWF IFS run 2026-01-05 12:00 UTC");
  assert.match(P.sourceLine({}), /not stated/);
  assert.equal(P.announceDue(1000, 2000), false);
  assert.equal(P.announceDue(1000, 2500), true);
  assert.equal(P.announceDue(NaN, 0), true);
});

for (const n of names) {
  test(`panel map ${n}: cells ahead equal engine.levelAt at current altitude, state not changed`, () => {
    const f = load(n);
    const c = E.loadCase(f);
    const st = Object.freeze({ ...E.initialState(c), step: 3 });
    const cells = P.panelMapCells(c, st);
    assert.ok(cells.length > 0 && cells.length <= P.MAP_AHEAD_STEPS * c.nLanes);
    for (const x of cells) assert.equal(x.level, E.levelAt(c, x.lane, x.step, st.alt));
    const g = P.panelMapLayout(c, st, 400, 120);
    assert.ok(g.stepX(st.step) >= g.pad && g.laneCentre(c.nLanes - 1) <= 120);
    // scene panel values feed the same text
    const sc = S.buildScene(f, st, { phase: "cruise" }, {});
    assert.equal(sc.panel.iceLabel, "Ice index (game model)");
    assert.equal(sc.panel.legend.length, 4);
    assert.match(sc.panel.textLine, /head-wind|tail-wind/);
  });
}
