// Gate plan for the submission video (C15). Plays fixed plans through the game engine and prints every gate,
// so the storyboard uses computed positions and costs. It imports only engine.js (no screen code) and calls
// no network. Run from the repository root:
//   node tools/video/gate_plan.mjs [path/to/case.json]
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as E from "../../static/cloud-dive/engine.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const JSON_MODE = process.argv.includes("--json");
const realLog = console.log;
if (JSON_MODE) console.log = () => {}; // --json prints one JSON document and nothing else
const file = process.argv.slice(2).find((a) => !a.startsWith("--")) || path.join(root, "static/cloud-dive/cases/20261112-kjfk-kbna-1930z.json");
const raw = JSON.parse(readFileSync(file, "utf8"));
const c = E.loadCase(raw);
const departure = Number(raw.params.departureClimbUsd);
const NAMES = ["Not assessed", "Not indicated", "Possible", "Observed"];
const short = (l) => (l == null ? "-" : NAMES[l]);
const usd = (x) => "$" + Math.round(x).toLocaleString("en-US");
const kmOf = (s) => s.step * c.stepKm;
const total = (s) => E.totalUsd(c, s) + departure;

function row(n, s, reasons) {
  const ahead = E.lookaheadLevels(c, s).map(short).join(", ");
  console.log(
    `${String(n).padStart(2)}  km ${String(kmOf(s)).padStart(4)}  ${reasons.join("+").padEnd(11)} here=${short(s.prevLevel).padEnd(13)} ` +
      `ahead=[${ahead}]  alt=${c.altsFt[s.alt]} lane=${s.lane + 1} antiIce=${s.antiIce ? "On " : "Off"} cost=${usd(total(s))} ice=${s.ice}`
  );
}

// Plan 1: the demo flight. Gate at 0 km: climb to the top of the block and anti-ice on. After that:
// entry or ice-ahead -> anti-ice on, exit -> anti-ice off. Lane never changes.
const gateList = [];
function demo() {
  console.log("\n== Demo plan: climb to the top, anti-ice on in front of cloud, off after leaving ==");
  let s = E.initialState(c);
  let n = 0;
  for (;;) {
    const r = E.runUntilGate(c, s);
    s = r.state;
    if (r.reasons[0] === "arrived" || r.reasons[0] === "diverted") {
      console.log(`END ${r.reasons[0]} at km ${kmOf(s)}  total ${usd(total(s))}  icePeak=${s.ice}  gates=${n}  game flight time ${Math.round(s.minutes)} min, anti-ice ${Math.round(s.minutesAntiIce)} min`);
      return { s, n };
    }
    n += 1;
    row(n, s, r.reasons);
    gateList.push({ n, km: kmOf(s), reasons: r.reasons, costUsd: Math.round(total(s) * 100) / 100 });
    if (n === 1) s = E.setTargets(c, s, null, c.nAlts - 1, true);
    else if (r.reasons.includes("exit")) s = E.setTargets(c, s, null, null, false);
    else if (r.reasons.includes("entry")) s = E.setTargets(c, s, null, null, true);
    if (n > 200) throw new Error("too many gates");
  }
}

// Plan 2: the reference Best policy, for comparison.
function best() {
  const s = E.flyPolicy(c, raw.references.best.policy);
  console.log(`\n== references.best.policy: total with departure ${usd(total(s))} (file: ${usd(raw.references.best.costUsd + departure)}), anti-ice ${Math.round(s.antiIceKm)} km`);
  return s;
}

// Plan 3: the failure take. Anti-ice off, Continue at every gate. Stops at the ice gate, then shows what follows.
function failure() {
  console.log("\n== Failure take: anti-ice off, Continue at every gate ==");
  let s = E.initialState(c);
  let n = 0;
  for (;;) {
    const r = E.runUntilGate(c, s);
    s = r.state;
    if (r.reasons[0] === "arrived" || r.reasons[0] === "diverted") {
      console.log(`END ${r.reasons[0]} at km ${kmOf(s)}  total ${usd(total(s))}  icePeak=${s.ice}`);
      return;
    }
    n += 1;
    row(n, s, r.reasons);
    if (r.reasons.includes("ice")) console.log("   ^ ice gate (ice index 50). The video take can stop here; continuing with anti-ice off goes on:");
  }
}

// Plan 4: anti-ice on at the top, never off.
function always() {
  let s = E.setTargets(c, E.initialState(c), null, c.nAlts - 1, true);
  s = E.runUntilGate(c, s, { checkStart: false });
  let state = s.state;
  while (!["arrived", "diverted"].includes(state.status)) state = E.step(c, state);
  console.log(`\n== Climb to the top, anti-ice always on (flown without gates): ${usd(total(state))}`);
}

console.log(`case ${raw.id}  ${c.nLanes} lanes x ${c.nSteps + 1} steps x ${c.nAlts} altitudes, departure climb ${departure}`);
const ref = raw.references;
console.log(
  `report values (with departure): Best ${usd(ref.best.costUsd + departure)}, Straight-ahead ${usd(ref.straight_ahead.costUsd + departure)}, ` +
    `Wasteful ${usd(ref.wasteful.costUsd + departure)}, always anti-ice ${usd(ref.best_always_anti_ice.costUsd + departure)}, no anti-ice ${usd(ref.best_no_anti_ice.costUsd + departure)}`
);
const d = demo();
const b = best();
console.log(`\nDemo plan minus Best: ${usd(total(d.s) - total(b))} (${(total(d.s) - total(b)).toFixed(2)} dollars unrounded)`);
console.log(`Demo plan minus Straight-ahead: ${(total(d.s) - (ref.straight_ahead.costUsd + departure)).toFixed(2)} dollars`);
failure();
always();

// Where Observed cells sit on the centre lane at the top level, for the storyboard.
const lane = c.startLane, top = c.nAlts - 1;
const obs = [];
for (let s = 0; s <= c.nSteps; s++) if (E.levelAt(c, lane, s, top) === E.OBSERVED) obs.push(s * c.stepKm);
console.log(`\nObserved cells on the centre lane at ${c.altsFt[top]} ft (km): ${obs.join(" ")}`);
const obs9 = [];
for (let s = 0; s <= c.nSteps; s++) if (E.levelAt(c, lane, s, c.startAlt) === E.OBSERVED) obs9.push(s * c.stepKm);
console.log(`Observed cells on the centre lane at the start altitude ${c.altsFt[c.startAlt]} ft (km): ${obs9.join(" ")}`);
if (JSON_MODE) {
  realLog(JSON.stringify({ case: raw.id, gates: gateList, demoTotalUsd: Math.round(total(d.s) * 100) / 100,
    bestUsd: Math.round(total(b) * 100) / 100 }));
}
