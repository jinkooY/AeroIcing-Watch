// Cloud Dive flight review (revision f, R25.3 to R25.5). DOM-free so Node tests can run it.
// After the flight, the player's path and the Best game reference are put side by side: one row per flown segment
// and the gates of the flight. The Best path is the stored `references.best.policy` replayed by the game engine,
// so nothing is solved here (R25.5). Shown only after the flight, labelled a game reference, not a procedure
// (guardrail rule 4). The engine and the case files are not changed (R25.7).

import * as engine from "./engine.js";

export const BEST_LABEL = "Best (game reference, not a procedure)";

// Recorder of the flown segments, kept beside the engine state (the engine state is not changed).
// One entry per engine step: the lane and altitude after the segment, and the anti-ice setting used on it.
// A new flight (step 0, or a step that went backwards) starts a new list; the same array is returned when
// nothing was flown.
export function recordFlight(flown, prev, next) {
  const list = Array.isArray(flown) ? flown : [];
  if (!next) return [];
  if (!prev || next.step < prev.step || next.step === 0) return next.step === 0 ? [] : list;
  if (next.step !== prev.step + 1) return list;
  const base = prev.step === 0 ? [] : list;
  return [...base, { step: prev.step, lane: next.lane, alt: next.alt, antiIce: Boolean(prev.antiIce) }];
}

// The gate announcement of the flight controller (controller.js enterGate): the same fields, the same rule.
function announce(c, st, reasons) {
  let out = st;
  if (reasons.includes("ice")) out = { ...out, iceGateDone: true };
  if (reasons.includes("entry")) out = { ...out, announcedEntry: engine.entryIndex(c, st) };
  return out;
}

// Flies per-segment targets [[lane, alt, antiIce], ...] with the engine, announcing gates the way the controller
// does. Returns { rows, gates, final }: rows[s] = { step, lane, alt, antiIce, level, totalUsd } after segment s,
// gates = [{ step, reasons }] in order. Stops at the end of the flight.
export function flyTargets(c, targets) {
  let st = engine.initialState(c);
  const rows = [];
  const gates = [];
  const check = () => {
    const reasons = engine.gateReasons(c, st);
    if (reasons.length) {
      gates.push({ step: st.step, reasons });
      st = announce(c, st, reasons);
    }
  };
  check();
  for (let s = 0; s < targets.length && st.status === "flying"; s++) {
    const [lane, alt, ai] = targets[s];
    st = engine.step(c, engine.setTargets(c, st, lane, alt, Boolean(ai)));
    rows.push({ step: s, lane: st.lane, alt: st.alt, antiIce: Boolean(ai), level: st.events[0].level,
      totalUsd: engine.totalUsd(c, st) });
    if (st.status === "flying") check();
  }
  return { rows, gates, final: st };
}

// The player's flight replayed from the recorded segments. Each recorded lane and altitude is one move or none
// from the one before, so setting it as the target gives the same segment. `matches` is false when the replay
// does not end in the player's final state (then the review is not shown).
export function replayFlown(c, flown, finalState) {
  if (!c || !Array.isArray(flown) || !flown.length) return null;
  const out = flyTargets(c, flown.map((f) => [f.lane, f.alt, f.antiIce]));
  const matches = Boolean(finalState) && out.final.step === finalState.step && out.final.status === finalState.status &&
    Math.abs(engine.totalUsd(c, out.final) - engine.totalUsd(c, finalState)) < 0.01;
  return { ...out, matches };
}

// The Best game reference replayed from the case file. Null when the case has no completed Best policy.
export function replayBest(c, references) {
  const b = references && references.best;
  if (!c || !b || b.completed === false || !Array.isArray(b.policy) || !b.policy.length) return null;
  return flyTargets(c, b.policy);
}

const altFt = (c, i) => c.altsFt[i];
const settings = (c, row) => row ? { lane: row.lane + 1, altFt: altFt(c, row.alt), antiIce: row.antiIce } : null;
const costAt = (rows, s) => (s < 0 ? 0 : rows[Math.min(s, rows.length - 1)].totalUsd);

// The review model (R25.3, R25.4): chart series over distance and one row per gate of the player's flight.
// Gate row: the settings flown on the segment after the gate (player and Best), and the cost of each from that
// gate to the next gate (or to the end). Costs are engine game values (illustrative, without the departure climb).
// Returns null when either replay is missing or the player's replay does not match the flight.
export function buildReview(c, flown, finalState, references) {
  const you = replayFlown(c, flown, finalState);
  const best = replayBest(c, references);
  if (!you || !you.matches || !best) return null;
  const cum = [0];
  for (let s = 0; s < c.nSteps; s++) cum.push(cum[s] + engine.segmentKm(c, s));
  const kmAt = (s) => cum[Math.max(0, Math.min(s, c.nSteps))];
  const series = (rows) => rows.map((r) => ({ km: kmAt(r.step + 1), lane: r.lane + 1, altFt: altFt(c, r.alt),
    antiIce: r.antiIce }));
  const gates = you.gates.map((g, i) => {
    const from = g.step;
    const to = i + 1 < you.gates.length ? you.gates[i + 1].step : you.rows.length;
    const youCost = costAt(you.rows, to - 1) - costAt(you.rows, from - 1);
    const bestCost = costAt(best.rows, to - 1) - costAt(best.rows, from - 1);
    return {
      n: i + 1, step: from, km: kmAt(from), reasons: g.reasons,
      you: settings(c, you.rows[from]), best: settings(c, best.rows[Math.min(from, best.rows.length - 1)]),
      youUsd: youCost, bestUsd: bestCost, toKm: kmAt(to),
    };
  });
  return {
    you: series(you.rows), best: series(best.rows), gates,
    youUsd: engine.totalUsd(c, you.final), bestUsd: engine.totalUsd(c, best.final),
    altsFt: c.altsFt.slice(), nLanes: c.nLanes, totalKm: kmAt(c.nSteps),
  };
}

// Settings in words for the gate list: "lane 3, 12,000 ft, anti-ice on".
export function settingsText(s) {
  if (!s) return "Not available";
  return `lane ${s.lane}, ${Math.round(s.altFt).toLocaleString("en-US")} ft, anti-ice ${s.antiIce ? "on" : "off"}`;
}
