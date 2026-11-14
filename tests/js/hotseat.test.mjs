// Task 18.1: hot-seat session and results table (R20.1 to R20.4). DOM-free.
// CD-P31 (property): one row per player, ranked flights ordered by total, diverted flights "not ranked",
// nothing written to storage. Uses a seeded generator (no extra library).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as H from "../../static/cloud-dive/hotseat.js";

const src = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),
  "../../static/cloud-dive/hotseat.js"), "utf8");
const BANNED = /no icing|ice-free|\bsafe\b|clear of ice|\blight\b|\bmoderate\b|\bsevere\b|\blikely\b|\bunlikely\b/i;

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const refs = { best: { costUsd: 1000, completed: true }, straight_ahead: { costUsd: 2000, completed: true } };
const params = { departureClimbUsd: 50 };

function playAll(n, results) {
  let s = H.start([], n);
  for (let i = 0; i < n; i += 1) {
    s = H.finish(s, results[i]);
    s = H.next(s);
  }
  return s;
}

test("CD-P31 property: table shape, ordering, not ranked, no storage (seeded random)", () => {
  const stored = [];
  globalThis.localStorage = { setItem: (...a) => stored.push(a), getItem: () => null };
  try {
    const r = rng(31);
    for (let t = 0; t < 300; t += 1) {
      const n = 2 + Math.floor(r() * 3);
      const results = Array.from({ length: n }, () => ({
        ranked: r() > 0.3, totalUsd: Math.round(1000 + r() * 6) * 100,
      }));
      const s = playAll(n, results);
      assert.ok(H.isComplete(s));
      const tb = H.table(s, refs, params);
      assert.equal(tb.rows.length, n);
      assert.deepEqual(tb.rows.map((x) => x.seat).sort(), [...Array(n).keys()]);
      const ranked = tb.rows.filter((x) => x.ranked);
      for (let i = 1; i < ranked.length; i += 1) {
        assert.ok(ranked[i - 1].totalUsd <= ranked[i].totalUsd);
        if (ranked[i - 1].totalUsd === ranked[i].totalUsd) {
          assert.equal(ranked[i].rank, ranked[i - 1].rank);
          assert.ok(ranked[i - 1].seat < ranked[i].seat);
        }
      }
      // ranked rows come first; diverted rows say "not ranked" and have no rank
      const firstUnranked = tb.rows.findIndex((x) => !x.ranked);
      if (firstUnranked >= 0) assert.ok(tb.rows.slice(firstUnranked).every((x) => !x.ranked));
      for (const row of tb.rows.filter((x) => !x.ranked)) {
        assert.equal(row.status, "not ranked");
        assert.equal(row.rank, null);
      }
      assert.deepEqual(tb.references.map((x) => x.totalUsd), [1050, 2050]);
      // deterministic
      assert.deepEqual(H.table(s, refs, params), tb);
    }
  } finally {
    delete globalThis.localStorage;
  }
  assert.equal(stored.length, 0);
});

test("2 to 4 players, default names, sanitized names", () => {
  assert.deepEqual(H.start([], 1).players.map((p) => p.name), ["Player 1", "Player 2"]);
  assert.equal(H.start([], 9).players.length, 4);
  assert.deepEqual(H.start(["", "  "], 3).players.map((p) => p.name), ["Player 1", "Player 2", "Player 3"]);
  const nm = H.sanitizeName("<b>Ann</b>\n  \"x\" & " + "z".repeat(50), 0);
  assert.doesNotMatch(nm, /[<>&"\n]/);
  assert.ok(nm.length <= H.MAX_NAME_LENGTH);
  assert.equal(H.sanitizeName(42, 2), "Player 3");
});

test("turns: finish then next hands over in order; table references hidden until the last flight", () => {
  let s = H.start(["A", "B", "C"]);
  assert.equal(H.currentPlayer(s).name, "A");
  assert.equal(H.next(s).current, 0, "no hand-over before the flight is finished");
  s = H.finish(s, { ranked: true, totalUsd: 1500 });
  assert.ok(H.referencesVisibleTo(s, 0));
  assert.ok(!H.referencesVisibleTo(s, 1));
  s = H.next(s);
  assert.equal(s.current, 1);
  let tb = H.table(s, refs, params);
  assert.equal(tb.complete, false);
  assert.ok(tb.references.every((x) => x.totalUsd === null));
  assert.equal(tb.rows.at(-1).status, "waiting");
  s = H.finish(s, { ranked: false, totalUsd: 3000 });
  s = H.finish(H.next(s), { ranked: true, totalUsd: 1500 });
  tb = H.table(s, refs, params);
  assert.equal(tb.complete, true);
  assert.deepEqual(tb.rows.map((x) => x.name), ["A", "C", "B"]);
  assert.deepEqual(tb.rows.map((x) => x.rank), [1, 1, null]);
  assert.equal(H.currentPlayer(s), null);
});

test("finish does not change its input; engine summary result adds the departure climb", () => {
  const s = H.start(["A", "B"]);
  const s2 = H.finish(s, { ranked: true, totalUsd: 10 });
  assert.equal(s.players[0].result, null);
  assert.equal(s2.players[0].result.totalUsd, 10);
  assert.deepEqual(H.resultFromEngine({ ranked: false, totalUsd: 100 }, params), { ranked: false, totalUsd: 150 });
  assert.equal(H.resultFromEngine(null, params), null);
  assert.equal(H.finish(s, { ranked: true, totalUsd: NaN }), s);
});

test("saving share per ranked row after the last flight; source has no storage or network use", () => {
  const s = playAll(2, [{ ranked: true, totalUsd: 1050 }, { ranked: true, totalUsd: 2050 }]);
  const tb = H.table(s, refs, params);
  assert.equal(tb.rows[0].savingSharePercent, 100);
  assert.equal(tb.rows[1].savingSharePercent, 0);
  assert.doesNotMatch(src, /localStorage|sessionStorage|fetch\(|XMLHttpRequest|indexedDB|document\./);
});

test("hotseat.js user-facing strings avoid banned words", () => {
  const strings = [...src.matchAll(/"([^"\n]*)"|`([^`\n]*)`/g)].map((m) => m[1] ?? m[2]);
  assert.ok(strings.includes("not ranked") && strings.includes("Best") && strings.includes("Straight-ahead"));
  for (const t of strings) assert.doesNotMatch(t, BANNED);
});

test("18.2 setupNames clamps the count and sanitises names", () => {
  assert.deepEqual(H.setupNames(["Ann", "<b>Bo</b>"], 1), ["Ann", "bBo/b"]);
  assert.equal(H.setupNames([], 9).length, 4);
  assert.deepEqual(H.setupNames(["", "  "], 3), ["Player 1", "Player 2", "Player 3"]);
});

test("18.2 hand-over text names the next player only when a hand-over is due", () => {
  let s = H.start(["Ann", "Bo", "Cy"], 3);
  assert.equal(H.handOverDue(s), false);
  assert.equal(H.handOverText(s), "");
  s = H.finish(s, { ranked: true, totalUsd: 100 });
  assert.equal(H.handOverText(s), "Hand the device to Bo");
  s = H.next(H.finish(H.next(s), { ranked: false, totalUsd: 200 }));
  assert.equal(H.handOverText(s), "");
  s = H.finish(s, { ranked: true, totalUsd: 300 });
  assert.equal(H.handOverDue(s), false);
  assert.equal(H.handOverText(s), "");
});

test("18.2 references are visible to a player only after their own flight (R20.4)", () => {
  let s = H.start([], 2);
  assert.equal(H.referencesVisibleTo(s, 0), false);
  s = H.next(H.finish(s, { ranked: true, totalUsd: 1 }));
  assert.equal(H.referencesVisibleTo(s, 0), true);
  assert.equal(H.referencesVisibleTo(s, 1), false);
});

// Task 18.3: results dialog text (R20.2, R20.3, R8.3, R8.5)
test("resultsRows: players, then Best and Straight-ahead with the departure constant (synthetic)", () => {
  let s = H.start(["Ann", "Bo", "Cy"], 3);
  const res = [{ ranked: true, totalUsd: 1500 }, { ranked: false, totalUsd: 900 }, { ranked: true, totalUsd: 1200 }];
  for (const r of res) { s = H.finish(s, r); s = H.next(s); }
  const v = H.resultsRows(s, refs, params);
  assert.equal(v.complete, true);
  assert.deepEqual(v.rows.map((r) => r[0]), ["Cy", "Ann", "Bo", "Best (game baseline)", "Straight-ahead (game baseline)"]);
  assert.deepEqual(v.rows[0], ["Cy", "$1,200", "1", v.rows[0][3]]);
  assert.equal(v.rows[2][2], "not ranked");
  assert.equal(v.rows[2][3], "Not available");
  assert.equal(v.rows[3][1], "$1,050");
  assert.equal(v.rows[4][1], "$2,050");
  assert.match(v.departureLine, /\$50/);
  assert.ok(v.rows.every((r) => r.length === v.headers.length && r.every((c) => typeof c === "string")));
  assert.match(v.notes.join(" "), /game baselines, not flight procedures/);
  assert.match(v.notes.join(" "), /nothing is uploaded/);
  assert.ok(!BANNED.test([...v.notes, v.departureLine, ...v.headers].join(" ")));
});

test("resultsDue and playAgain keep players and clear results", () => {
  let s = H.start(["A", "B"], 2);
  assert.equal(H.resultsDue(s), false);
  s = H.finish(s, { ranked: true, totalUsd: 1 }); s = H.next(s);
  s = H.finish(s, { ranked: true, totalUsd: 2 });
  assert.equal(H.resultsDue(s), true);
  const a = H.playAgain(s);
  assert.deepEqual(a.players.map((p) => p.name), ["A", "B"]);
  assert.equal(a.current, 0);
  assert.equal(H.resultsDue(a), false);
  assert.equal(s.players[0].result.totalUsd, 1);
});

