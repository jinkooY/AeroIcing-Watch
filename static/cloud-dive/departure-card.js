// Departure climb status card for the 2D view (task 17.7, R19.1, R15.5). DOM-free text helper.
// The 2D view has no runway scene, so before the flight starts it shows the unscored departure climb as a
// compact card: the illustrative dollar cost, the airports and the cruise level. Display only; no value
// is changed. Wording follows R9.1 (no banned words) and R9.4 (no advice).

import { DEPARTURE_LABEL, departureUsd } from "./departure.js";

const finite = (v) => typeof v === "number" && Number.isFinite(v);
const fmtInt = (n) => Math.round(n).toLocaleString("en-US");

export const CARD_NOTE =
  "Illustrative game value, the same for every flight on this case. It is added to the total and to the " +
  "references. The cruise level is the game's altitude block, below airline cruise level, and is not an " +
  "ATC assignment.";

export const formatCardUsd = (usd) => `$${(Math.round(usd * 100) / 100).toFixed(2)}`;

// Start altitude in feet MSL from the engine case (altsFt[startAlt]); null when unknown.
export function startAltitudeFt(engineCase) {
  const c = engineCase;
  if (!c || !Array.isArray(c.altsFt) || !finite(c.startAlt)) return null;
  const v = c.altsFt[c.startAlt];
  return finite(v) ? v : null;
}

// The card is shown in the 2D view, with a departure constant, before the engine's first step.
export function cardApplies({ view, state, params }) {
  return view === "2d" && Boolean(state) && state.step === 0 && state.status === "flying" && departureUsd(params) > 0;
}

// Returns { title, cost, route, level, note } (plain strings) for the card.
export function departureCardText(caseData, engineCase) {
  const params = caseData && caseData.params;
  const air = caseData && caseData.airports ? caseData.airports : {};
  const from = air.from && air.from.icao ? air.from.icao : null;
  const to = air.to && air.to.icao ? air.to.icao : null;
  const alt = startAltitudeFt(engineCase);
  return {
    title: DEPARTURE_LABEL,
    cost: `${formatCardUsd(departureUsd(params))} (illustrative)`,
    route: from && to ? `${from} to ${to}` : "Departure and arrival airports not listed",
    level: alt === null ? "Cruise level not listed" : `Cruise level ${fmtInt(alt)} ft (game altitude block)`,
    note: CARD_NOTE,
  };
}
