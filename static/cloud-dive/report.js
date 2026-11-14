// Cloud Dive end-of-flight report logic (task 8.4): DOM-free ES module.
// Builds the report numbers from a finished flight, the stored reference results, and a
// browser-only personal best. Dollar values are illustrative game values, not weather statements.
// Requirements: R8.1 (components, kilometres per level), R8.2/R8.3 (references after play, share of the
// possible saving), R5.6 (diverted flights: not ranked), R8.4 (local best only), R8.5 (no ranking claims).

import * as engine from "./engine.js";
import { DEPARTURE_LABEL, departureUsd, referenceWithDeparture, withDeparture } from "./departure.js";

export const LEVEL_LABELS = [
  "Not assessed",
  "Not indicated",
  "Possible (forecast only)",
  "Observed supercooled layer at planned altitude",
];

export const COMPONENT_LABELS = [
  ["base", "Base / cruise"],
  ["climb", "Climb"],
  ["departure", DEPARTURE_LABEL],
  ["detour", "Detour"],
  ["antiIce", "Anti-ice"],
  ["ice", "Ice drag"],
  ["diversion", "Diversion"],
];

// Labels shown next to the reference costs (R8.3). Game baselines, not procedures.
export const REFERENCE_LABELS = [
  ["best", "Best", "Lowest cost the game solver found for this case."],
  ["straight_ahead", "Straight-ahead",
    "Centre lane, start altitude, anti-ice on only in Observed or Possible cells."],
  ["wasteful", "Wasteful extreme", "Highest cost of any completed flight in this case."],
];

// v2: totals include the departure climb constant (task 17.1), so v1 values are not comparable.
export const STORAGE_PREFIX = "cloud-dive:best:v2:";

const finite = (v) => typeof v === "number" && Number.isFinite(v);

export function formatUsdWhole(v) {
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

// Reference costs as displayed (engine cost + departure climb constant), each null when missing or not a
// completed flight. `params` is the case params object; without it the stored engine cost is returned.
export function referenceCosts(references, params) {
  const out = {};
  for (const [key] of REFERENCE_LABELS) {
    const r = references && references[key];
    out[key] = r && r.completed !== false && finite(r.costUsd) ? referenceWithDeparture(r.costUsd, params) : null;
  }
  return out;
}

// Saving share from Straight-ahead to Best: (Straight-ahead - player) / (Straight-ahead - Best) x 100.
// 0 = Straight-ahead, 100 = Best. Capped at 100, not clamped at 0 (negative = costlier than Straight-ahead).
// Null when a value is missing or Straight-ahead <= Best (empty range).
export function savingSharePercent(playerUsd, bestUsd, straightAheadUsd) {
  if (![playerUsd, bestUsd, straightAheadUsd].every(finite)) return null;
  const range = straightAheadUsd - bestUsd;
  if (!(range > 0)) return null;
  return Math.min(100, ((straightAheadUsd - playerUsd) / range) * 100);
}

// Report model for a flight that is no longer flying. Returns null while the flight is on.
export function buildReport(c, state, references, fileParams) {
  if (!c || !state || state.status === "flying") return null;
  const s = engine.summary(c, state);
  const caseParams = fileParams || c.params; // the engine keeps only the numbers it uses; the constant is in the case file
  const dep = departureUsd(caseParams);
  const refs = referenceCosts(references, caseParams);
  const ranked = s.ranked;
  const totalUsd = withDeparture(s.totalUsd, caseParams);
  const components = COMPONENT_LABELS.map(([key, label]) =>
    ({ key, label, usd: key === "departure" ? dep : s.components[key] || 0 }));
  const kmPerLevel = LEVEL_LABELS.map((label, level) => ({ level, label, km: s.kmPerLevel[level] || 0 }));
  return {
    status: s.status,
    ranked,
    totalUsd,
    // Diverted flights: cost up to the diversion + the diversion cost + the departure climb (R5.6).
    // costUpToDiversionUsd is the engine cost only; the departure climb is listed on its own.
    costUpToDiversionUsd: ranked ? null : s.totalUsd - s.components.diversion,
    diversionUsd: ranked ? null : s.components.diversion,
    departureUsd: dep,
    components,
    icePeak: s.icePeak,
    minutesAntiIce: s.minutesAntiIce,
    kmPerLevel,
    distanceKm: s.distanceKm,
    references: refs,
    savingSharePercent: ranked ? savingSharePercent(totalUsd, refs.best, refs.straight_ahead) : null,
  };
}

// Report headline (R22.8, CD-P35). Pure: only the report numbers, nothing new from the engine.
// Returns null for a diverted (not ranked) report. Each entry is null when its reference is missing.
// vsStraight.usd is the rounded absolute difference; aboveBest.usd is the rounded gap to Best, never below 0.
export function reportHeadline(report) {
  if (!report || !report.ranked || !finite(report.totalUsd)) return null;
  const refs = report.references || {};
  let vsStraight = null;
  if (finite(refs.straight_ahead)) {
    const d = report.totalUsd - refs.straight_ahead;
    const usd = Math.round(Math.abs(d));
    let text = "The same as Straight-ahead";
    if (usd > 0) text = `${formatUsdWhole(usd)} ${d > 0 ? "more" : "less"} than Straight-ahead`;
    vsStraight = { usd, text };
  }
  let aboveBest = null;
  if (finite(refs.best)) {
    const usd = Math.max(0, Math.round(report.totalUsd - refs.best));
    aboveBest = { usd, text: usd > 0 ? `${formatUsdWhole(usd)} above Best` : "The same as Best" };
  }
  return { vsStraight, aboveBest };
}

// ------------------------------------------------------------------------------------------
// Personal best (browser only, never uploaded). `storage` is a Storage-like object or null.
// Every access is wrapped, because localStorage can be missing, blocked or full.
// ------------------------------------------------------------------------------------------

export function browserStorage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function readPersonalBest(storage, caseId) {
  try {
    if (!storage) return null;
    const raw = storage.getItem(STORAGE_PREFIX + caseId);
    if (raw === null || raw === undefined) return null;
    const v = Number(JSON.parse(raw));
    return finite(v) && v >= 0 ? v : null;
  } catch {
    return null;
  }
}

// Record a ranked result. Lower is better. Returns { best, isNew, saved, available }.
// Diverted flights are not ranked and never stored.
export function recordPersonalBest(storage, caseId, report) {
  const previous = readPersonalBest(storage, caseId);
  if (!report || !report.ranked) {
    return { best: previous, isNew: false, saved: false, available: Boolean(storage) };
  }
  if (previous !== null && previous <= report.totalUsd) {
    return { best: previous, isNew: false, saved: false, available: true };
  }
  try {
    if (!storage) throw new Error("no storage");
    storage.setItem(STORAGE_PREFIX + caseId, JSON.stringify(report.totalUsd));
    return { best: report.totalUsd, isNew: true, saved: true, available: true };
  } catch {
    // Storage unavailable: show this flight's result for the session only.
    return { best: previous, isNew: false, saved: false, available: false };
  }
}

// ------------------------------------------------------------------------------------------
// Share text: plain facts about the game result. No weather statements, no airline names,
// no ranking or leaderboard claim.
// ------------------------------------------------------------------------------------------

export function shareText(report, title) {
  if (!report) return "";
  const head = `Cloud Dive: ${title}.`;
  const tail = "Game model with illustrative dollar values, not a flight procedure.";
  if (!report.ranked) {
    const upTo = formatUsdWhole(report.costUpToDiversionUsd);
    return `${head} My flight diverted (not ranked): ${upTo} up to the diversion plus ` +
      `${formatUsdWhole(report.diversionUsd)} diversion cost plus ` +
      `${formatUsdWhole(report.departureUsd)} departure climb. ${tail}`;
  }
  const parts = [`${head} My fuel cost: ${formatUsdWhole(report.totalUsd)}.`];
  if (report.references.best !== null) parts.push(`Game Best: ${formatUsdWhole(report.references.best)}.`);
  if (report.savingSharePercent !== null) {
    parts.push(`Saving share from Straight-ahead to Best: ${Math.round(report.savingSharePercent)} percent.`);
  }
  parts.push(tail);
  return parts.join(" ");
}
