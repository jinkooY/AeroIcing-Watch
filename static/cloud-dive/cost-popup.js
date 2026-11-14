// Cost pop-up "+$N this segment" (task 16.7, R18.5, R6.5, CD-P32). Pure and DOM-free.
// N is the cost actually incurred between two stops: the sum of the component changes (base, anti-ice, ice,
// climb, detour; plus the diversion charge once the flight has diverted) from the earlier stop state to the
// later one. Both arguments are states that already happened, so there is no way to ask for the cost of a
// choice that has not been flown: no cost preview (R6.5). Nothing here changes engine state.

import { COMPONENTS } from "./engine.js";

export const POPUP_MS = 4000; // "a few seconds"

const finite = (v) => typeof v === "number" && Number.isFinite(v);

function diversionUsd(c, st) {
  return st && st.status === "diverted" && c && c.params && finite(c.params.diversionUsd) ? c.params.diversionUsd : 0;
}

// c: engine case. prev: engine state at the previous stop (null means the start of the flight, all zero).
// cur: engine state at this stop. Returns the dollars incurred in between, never negative.
export function segmentCostUsd(c, prev, cur) {
  if (!cur || !Array.isArray(cur.cost)) return 0;
  let sum = 0;
  COMPONENTS.forEach((_, i) => {
    const before = prev && Array.isArray(prev.cost) && finite(prev.cost[i]) ? prev.cost[i] : 0;
    const now = finite(cur.cost[i]) ? cur.cost[i] : 0;
    sum += now - before;
  });
  sum += diversionUsd(c, cur) - diversionUsd(c, prev);
  return Math.max(sum, 0);
}

export function popupText(usd) {
  const n = finite(usd) ? Math.max(Math.round(usd), 0) : 0;
  return `+$${n.toLocaleString("en-US")} this segment`;
}

// Decides the pop-up for a stop. stopped: the flight is at a gate, paused, ended, or has just made one single
// step (anything but fast-forward). Returns { usd, text } or null. Shown only when the flight moved on since
// the previous stop, so changing a target at a gate (a choice) never shows or changes a number.
export function popupFor(c, prev, cur, stopped) {
  if (!stopped || !cur) return null;
  if (prev && !(cur.step > prev.step)) return null;
  const usd = segmentCostUsd(c, prev, cur);
  return usd > 0 ? { usd, text: popupText(usd) } : null;
}
