// Cloud Dive departure climb constant (task 17.1): DOM-free ES module, twin of src/analysis/departure.py.
// The constant is read from the case file (`params.departureClimbUsd`); it is an illustrative game value
// that is the same for every flight on a case. The engine, the solver and the balance criteria never see
// it: it is added only to displayed totals and references. phases.js can import this file.

export const DEPARTURE_LABEL = "Departure climb";

const finite = (v) => typeof v === "number" && Number.isFinite(v);

// The constant of a case `params` object; 0 when absent (older case files).
export function departureUsd(params) {
  const v = params && params.departureClimbUsd;
  return finite(v) ? v : 0;
}

// Displayed total = engine total + constant. A diverted total is the cost up to the diversion plus the
// diversion cost (both in the engine total) plus the constant.
export function withDeparture(engineTotalUsd, params) {
  return engineTotalUsd + departureUsd(params);
}

// Reference costs as displayed: a number gets the constant added, null stays null.
export function referenceWithDeparture(costUsd, params) {
  return finite(costUsd) ? costUsd + departureUsd(params) : null;
}
