// Display-only fuel counter interpolation (task 16.3, R18.3, R13.10, R4.4). Pure and DOM-free.
// The engine's total after a step is the truth. Between two steps the shown value moves from the previous
// total to the current one by the motion share frac, so the counter runs faster when the per-step cost is
// higher (anti-ice on). It ends exactly on the engine total when frac reaches 1 or when the flight stops,
// and never shows a value beyond the engine total. Nothing here reads or writes engine state.

const finite = (v) => typeof v === "number" && Number.isFinite(v);

// prevUsd: engine total before the last step (null or non-finite means no earlier total).
// curUsd: engine total now. frac: share of the way in [0, 1]. stopped: gate, pause or end (show curUsd exactly).
// Same counter with the Departure climb constant added to both totals (task 17.4, R15.5). It ends exactly on
// engine total + departureUsd (the same sum withDeparture gives), so the counter equals the report total.
export function fuelDisplayWithDepartureUsd(prevUsd, curUsd, frac, stopped, depUsd) {
  const d = finite(depUsd) ? depUsd : 0;
  return fuelDisplayUsd(finite(prevUsd) ? prevUsd + d : prevUsd, finite(curUsd) ? curUsd + d : curUsd, frac, stopped);
}

export function fuelDisplayUsd(prevUsd, curUsd, frac, stopped = false) {
  if (!finite(curUsd)) return 0;
  if (stopped || !finite(prevUsd) || !finite(frac) || frac >= 1) return curUsd;
  const f = Math.max(frac, 0);
  const v = prevUsd + (curUsd - prevUsd) * f;
  const lo = Math.min(prevUsd, curUsd);
  const hi = Math.max(prevUsd, curUsd);
  // Costs only grow, so the value stays between the two totals and never passes the current one.
  return curUsd >= prevUsd ? Math.min(Math.max(v, lo), curUsd) : Math.max(Math.min(v, hi), curUsd);
}
