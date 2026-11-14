// Cloud Dive hot-seat (task 18.1): DOM-free ES module. 2 to 4 players fly the same case in turn on one
// device. The session lives in memory only: this file never touches storage or the network
// (R20.3, R8.4, R8.5). Totals include the departure climb constant (departure.js). Best and
// Straight-ahead are returned only after the last flight in the table, and per player only after
// that player's own flight (R20.2, R20.4, R8.2). Dollar values are illustrative game values.
// Requirements: R20.1, R20.2, R20.3, R20.4.

import { referenceCosts, savingSharePercent, formatUsdWhole } from "./report.js";
import { withDeparture, departureUsd } from "./departure.js";

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
export const MAX_NAME_LENGTH = 20;
export const NOT_RANKED = "not ranked";
export const WAITING = "waiting";

const finite = (v) => typeof v === "number" && Number.isFinite(v);

export function defaultName(index) {
  return `Player ${index + 1}`;
}

// Text only: markup characters and control characters are removed, spaces collapsed, length capped.
// An empty result falls back to the default name for that seat.
export function sanitizeName(raw, index) {
  let s = typeof raw === "string" ? raw : "";
  s = s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").replace(/[<>&"'`\\]/g, "");
  s = s.replace(/\s+/g, " ").trim();
  s = Array.from(s).slice(0, MAX_NAME_LENGTH).join("").trim();
  return s || defaultName(index);
}

// Start a session. `names` is an array (extra names beyond 4 are ignored); `count` is used when fewer
// names are given. The player count is clamped to 2..4.
export function start(names, count) {
  const given = Array.isArray(names) ? names : [];
  let n = Number.isInteger(count) ? count : given.length;
  n = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, n));
  const players = [];
  for (let i = 0; i < n; i += 1) players.push({ name: sanitizeName(given[i], i), result: null });
  return { players, current: 0 };
}

// Result of one finished flight from the engine summary (engine total, without the departure climb) and
// the case `params`. Totals shown to players include the constant (R20.2).
export function resultFromEngine(summary, params) {
  if (!summary || !finite(summary.totalUsd)) return null;
  return { ranked: Boolean(summary.ranked), totalUsd: withDeparture(summary.totalUsd, params) };
}

export function isComplete(session) {
  return session.players.every((p) => p.result !== null);
}

export function currentPlayer(session) {
  return isComplete(session) ? null : session.players[session.current];
}

// Record the current player's finished flight. `result` = { ranked, totalUsd } (departure included).
// Returns a new session; the input is not changed. A missing or bad result, or a finished session,
// leaves the session as it was.
export function finish(session, result) {
  if (isComplete(session) || !result || !finite(result.totalUsd)) return session;
  const players = session.players.map((p, i) => (i === session.current
    ? { name: p.name, result: { ranked: Boolean(result.ranked), totalUsd: result.totalUsd } }
    : p));
  return { players, current: session.current };
}

// Hand over to the next player who has not flown yet, in turn order. Only moves after the current
// player has finished; stays put when everyone has flown.
export function next(session) {
  if (session.players[session.current].result === null || isComplete(session)) return session;
  const n = session.players.length;
  for (let k = 1; k <= n; k += 1) {
    const i = (session.current + k) % n;
    if (session.players[i].result === null) return { players: session.players, current: i };
  }
  return session;
}

// A player sees the references only after their own flight (R20.4, R8.2).
export function referencesVisibleTo(session, playerIndex) {
  const p = session.players[playerIndex];
  return Boolean(p && p.result !== null);
}

// Results table. One row per player. Order: ranked flights by total (ascending), ties in turn order and
// sharing a rank (1, 1, 3); then diverted flights ("not ranked") in turn order; then players who have not
// flown yet. `references` are the stored reference results and `params` the case params. The reference
// rows (Best, Straight-ahead, departure included) are non-null only when every player has flown.
export function table(session, references, params) {
  const complete = isComplete(session);
  const refs = complete ? referenceCosts(references, params) : { best: null, straight_ahead: null };
  const entries = session.players.map((p, seat) => ({ p, seat }));
  const group = (e) => (e.p.result === null ? 2 : (e.p.result.ranked ? 0 : 1));
  entries.sort((a, b) => group(a) - group(b)
    || (group(a) === 0 ? a.p.result.totalUsd - b.p.result.totalUsd : 0)
    || a.seat - b.seat);
  let rank = 0;
  let prev = null;
  const rows = entries.map((e, pos) => {
    const r = e.p.result;
    if (r === null) {
      return { seat: e.seat, name: e.p.name, totalUsd: null, ranked: false, rank: null, status: WAITING, savingSharePercent: null };
    }
    if (!r.ranked) {
      return { seat: e.seat, name: e.p.name, totalUsd: r.totalUsd, ranked: false, rank: null, status: NOT_RANKED, savingSharePercent: null };
    }
    if (prev === null || r.totalUsd !== prev) rank = pos + 1;
    prev = r.totalUsd;
    return {
      seat: e.seat, name: e.p.name, totalUsd: r.totalUsd, ranked: true, rank, status: "ranked",
      savingSharePercent: complete ? savingSharePercent(r.totalUsd, refs.best, refs.straight_ahead) : null,
    };
  });
  return {
    complete,
    rows,
    references: [
      { key: "best", label: "Best", totalUsd: refs.best },
      { key: "straight_ahead", label: "Straight-ahead", totalUsd: refs.straight_ahead },
    ],
  };
}

// ---- Dialog helpers (task 18.2). DOM-free so they can be tested. ----

// Names typed in the setup dialog, one per seat. Only the first `count` entries are used.
export function setupNames(rawNames, count) {
  const n = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, Number.isInteger(count) ? count : MIN_PLAYERS));
  const raw = Array.isArray(rawNames) ? rawNames : [];
  return Array.from({ length: n }, (_, i) => sanitizeName(raw[i], i));
}

// True when a hand-over is due: the current player has flown and someone has not.
export function handOverDue(session) {
  return Boolean(session) && session.players[session.current].result !== null && !isComplete(session);
}

// The player the device goes to next, or null when everyone has flown.
export function nextPlayer(session) {
  return handOverDue(session) ? next(session).players[next(session).current] : null;
}

// Text of the hand-over dialog (R20.1). Names are shown as text only.
export function handOverText(session) {
  const p = nextPlayer(session);
  return p ? `Hand the device to ${p.name}` : "";
}

// Same players, same order, nothing flown yet (Play again, R20.1).
export function playAgain(session) {
  return { players: session.players.map((p) => ({ name: p.name, result: null })), current: 0 };
}

// True when the results table is due: every player has flown.
export function resultsDue(session) {
  return Boolean(session) && isComplete(session);
}

// ---- Results dialog text (task 18.3). DOM-free so it can be tested. ----

export const RESULTS_HEADERS = ["Player", "Total fuel cost (with departure climb)", "Rank", "Saving share"];
export const RESULTS_NOTE = "Best and Straight-ahead are game baselines, not flight procedures.";
export const RESULTS_GAME_NOTE = "Game model with illustrative dollar values, not an icing severity. " +
  "Results stay on this device: nothing is uploaded and there is no online or airline ranking.";

const NOT_AVAILABLE = "Not available";

// Rows of text for the results table. Rows: one per player, then Best and Straight-ahead. Every cell is a
// string; names are text only. Rank and status are words as well as numbers, so nothing relies on colour.
export function resultsRows(session, references, params) {
  const t = table(session, references, params);
  const players = t.rows.map((r) => [
    r.name,
    r.totalUsd === null ? NOT_AVAILABLE : formatUsdWhole(r.totalUsd),
    r.rank !== null ? String(r.rank) : r.status,
    r.savingSharePercent === null ? NOT_AVAILABLE : `${Math.round(r.savingSharePercent)} percent`,
  ]);
  const baselines = t.references.map((r) => [
    `${r.label} (game baseline)`,
    r.totalUsd === null ? NOT_AVAILABLE : formatUsdWhole(r.totalUsd),
    "reference",
    "not applicable",
  ]);
  return {
    complete: t.complete,
    headers: RESULTS_HEADERS,
    rows: [...players, ...baselines],
    departureLine: `Every total and baseline includes the departure climb of ${formatUsdWhole(departureUsd(params))}.`,
    notes: [RESULTS_NOTE, RESULTS_GAME_NOTE],
  };
}
