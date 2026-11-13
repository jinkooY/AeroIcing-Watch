// Cloud Dive game engine: DOM-free ES module, a line-by-line port of src/analysis/game_core.py.
// Deterministic: no clock, no randomness, no network. States are plain objects and are never mutated.
// Ice index: integer 0..100, only raised while anti-ice is off; at 100 the flight is a forced
// diversion (not ranked). All dollar values are illustrative game values, not weather statements.

export const NOT_ASSESSED = 0;
export const NOT_INDICATED = 1;
export const POSSIBLE = 2;
export const OBSERVED = 3;
export const N_LEVELS = 4;
export const ICE_MAX = 100;
export const ENTRY_LOOKAHEAD = 3;
export const EXIT_LOOKAHEAD = 5; // cells that must be free of Possible/Observed for an exit gate
export const MERGE_GAP = 5; // steps; entry gates within this gap after an icing cell merge (anti-ice on)
export const ICE_GATE = 50; // ice index of the ice gate (task 10.5)
export const COMPONENTS = ["base", "antiIce", "ice", "climb", "detour"];

const KM_PER_NM = 1.852;

export function roundHalfUp(x) {
  return Math.floor(x + 0.5);
}

const nan = (v) => (v === null || v === undefined ? NaN : v);

// Integer ice gain for one cell with anti-ice off (same rule as compute_ice_gain).
export function iceGainFor(level, tempC, lwp, params) {
  const t = nan(tempC);
  const tempFactor = Number.isNaN(t) ? 0.5 : Math.max(0.0, 1.0 - Math.abs(t + 10.0) / 10.0);
  const w = nan(lwp);
  const water = Number.isNaN(w) || level !== OBSERVED ? 1.0 : Math.min(1.5, 0.5 + w / 100.0);
  const rate = level === OBSERVED ? 1.0 : level === POSSIBLE ? params.possibleRateFactor : 0.0;
  return roundHalfUp(params.baseGain * tempFactor * water * rate);
}

function table(byAlt, alts) {
  return alts.map((a) => Number(byAlt[String(a)]));
}

// Build a case from a parsed case file (schemaVersion 2). Arrays stay flat, row-major [lane][step][alt].
export function loadCase(file) {
  const alts = file.grid.altitudesFt.map(Number);
  const lanes = file.grid.lanesKm.map(Number);
  const p = file.params;
  const params = {
    fuelUsdPerKg: p.fuelUsdPerKg, antiIceFactor: p.antiIceFactor, speedLossAtFull: p.speedLossAtFull,
    dragFlowAtFull: p.dragFlowAtFull, iceExponent: p.iceExponent, diversionUsd: p.diversionUsd,
    baseGain: p.baseGain, possibleRateFactor: p.possibleRateFactor, minGroundSpeedKt: p.minGroundSpeedKt,
  };
  const stepKm = Number(file.grid.stepKm);
  const distanceKm = Number(file.distanceKm);
  const nSteps = Math.ceil(distanceKm / stepKm - 1e-9);
  const expected = [lanes.length, nSteps + 1, alts.length];
  for (const name of ["evidence", "headwindKt", "iceGain"]) {
    const shape = file[name].shape;
    if (shape.length !== 3 || shape.some((n, i) => n !== expected[i]) ||
        file[name].data.length !== expected[0] * expected[1] * expected[2]) {
      throw new Error(`${name} must have shape [${expected}]`);
    }
  }
  const startAlt = alts.indexOf(Number(file.start.altFt));
  if (startAlt < 0) throw new Error("start altitude is not in the altitude block");
  return {
    stepKm, distanceKm, lanesKm: lanes, altsFt: alts, params,
    nLanes: lanes.length, nAlts: alts.length, nSteps,
    evidence: Uint8Array.from(file.evidence.data),
    headwindKt: Float64Array.from(file.headwindKt.data),
    iceGain: Int32Array.from(file.iceGain.data),
    tas: table(p.tasKtByAlt, alts), flow: table(p.flowKgHByAlt, alts),
    climb: table(p.climbExtraKgPer1000Ft, alts),
    startLane: Number(file.start.lane), startAlt,
  };
}

const cell = (c, lane, s, alt) => (lane * (c.nSteps + 1) + s) * c.nAlts + alt;
export const levelAt = (c, lane, s, alt) => c.evidence[cell(c, lane, s, alt)];

export function segmentKm(c, s) {
  return Math.min(c.stepKm, c.distanceKm - s * c.stepKm);
}

// Dollar components of segment s flown in cell (laneTo, s, altTo) after moving from (laneFrom, altFrom).
// `ice` is the index before the segment.
export function costComponents(c, s, laneFrom, laneTo, altFrom, altTo, antiIce, ice) {
  const p = c.params;
  const tas0 = c.tas[altTo];
  const flow0 = c.flow[altTo];
  const hw = c.headwindKt[cell(c, laneTo, s, altTo)];
  const d = segmentKm(c, s);
  const iceTerm = Math.pow(ice / ICE_MAX, p.iceExponent);
  const aiFactor = antiIce ? p.antiIceFactor : 1.0;

  const gs0 = Math.max(tas0 - hw, p.minGroundSpeedKt);
  const hours0 = d / (gs0 * KM_PER_NM);
  const c0 = flow0 * hours0 * p.fuelUsdPerKg;
  const c1 = flow0 * aiFactor * hours0 * p.fuelUsdPerKg;

  const tas = tas0 * (1.0 - p.speedLossAtFull * iceTerm);
  const gs = Math.max(tas - hw, p.minGroundSpeedKt);
  const hours = d / (gs * KM_PER_NM);
  const flow = flow0 * aiFactor * (1.0 + p.dragFlowAtFull * iceTerm);
  const c2 = flow * hours * p.fuelUsdPerKg;

  const lateral = Math.abs(c.lanesKm[laneTo] - c.lanesKm[laneFrom]);
  const extraKm = lateral > 0 ? Math.hypot(c.stepKm, lateral) - c.stepKm : 0.0;
  const detour = flow * (extraKm / (gs * KM_PER_NM)) * p.fuelUsdPerKg;
  const climbed = altTo > altFrom ? 1.0 : 0.0; // one level per segment
  const climb = c.climb[altTo] * climbed * p.fuelUsdPerKg;
  return { base: c0, antiIce: c1 - c0, ice: Math.max(c2 - c1, 0.0), climb, detour, hours };
}

export function initialState(c, antiIce = false) {
  return {
    step: 0, lane: c.startLane, alt: c.startAlt, targetLane: c.startLane, targetAlt: c.startAlt,
    antiIce: Boolean(antiIce), ice: 0, cost: [0, 0, 0, 0, 0], kmPerLevel: [0, 0, 0, 0],
    antiIceKm: 0.0, minutes: 0.0, minutesAntiIce: 0.0, prevLevel: null, prev2Level: null,
    lastIcingStep: null, announcedEntry: null, iceGateDone: false, status: "flying", events: [],
  };
}

export function totalUsd(c, state) {
  const extra = state.status === "diverted" ? c.params.diversionUsd : 0.0;
  return state.cost.reduce((a, b) => a + b, 0) + extra;
}

export const stateDistanceKm = (state) => state.kmPerLevel.reduce((a, b) => a + b, 0);

const sign = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);
const toward = (cur, target) => cur + sign(target - cur);
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// Player action: new target lane/altitude (clamped to the corridor/block) and anti-ice switch.
// Pass null or undefined to keep a value.
export function setTargets(c, state, lane = null, alt = null, antiIce = null) {
  return {
    ...state,
    targetLane: lane == null ? state.targetLane : clamp(Math.trunc(lane), 0, c.nLanes - 1),
    targetAlt: alt == null ? state.targetAlt : clamp(Math.trunc(alt), 0, c.nAlts - 1),
    antiIce: antiIce == null ? state.antiIce : Boolean(antiIce),
  };
}

// Fly one segment.
export function step(c, state) {
  if (state.status !== "flying") return state;
  const s = state.step;
  const lane = toward(state.lane, state.targetLane);
  const alt = toward(state.alt, state.targetAlt);
  const level = levelAt(c, lane, s, alt);
  const comp = costComponents(c, s, state.lane, lane, state.alt, alt, state.antiIce, state.ice);
  const gain = state.antiIce ? 0 : c.iceGain[cell(c, lane, s, alt)];
  const ice = Math.min(ICE_MAX, state.ice + gain);
  const d = segmentKm(c, s);
  const hours = comp.hours;
  const km = state.kmPerLevel.slice();
  km[level] += d;
  const status = ice >= ICE_MAX ? "diverted" : s + 1 >= c.nSteps ? "arrived" : "flying";
  return {
    ...state, step: s + 1, lane, alt, ice,
    cost: COMPONENTS.map((name, i) => state.cost[i] + comp[name]),
    kmPerLevel: km, antiIceKm: state.antiIceKm + (state.antiIce ? d : 0.0),
    minutes: state.minutes + hours * 60.0,
    minutesAntiIce: state.minutesAntiIce + (state.antiIce ? hours * 60.0 : 0.0),
    prev2Level: state.prevLevel, prevLevel: level, status,
    lastIcingStep: isIcingLevel(level) ? s : state.lastIcingStep,
    events: [{ step: s, lane, alt, level, iceGain: gain, iceAfter: ice }],
  };
}

// ------------------------------------------------------------------------------------------
// Gates
// ------------------------------------------------------------------------------------------

const isIcingLevel = (level) => level === POSSIBLE || level === OBSERVED;

// Levels of the next n cells when the aircraft keeps the current targets and anti-ice.
export function lookaheadLevels(c, state, n = ENTRY_LOOKAHEAD) {
  let lane = state.lane;
  let alt = state.alt;
  const out = [];
  for (let i = 0; i < n; i++) {
    const s = state.step + i;
    if (s >= c.nSteps) break;
    lane = toward(lane, state.targetLane);
    alt = toward(alt, state.targetAlt);
    out.push(levelAt(c, lane, s, alt));
  }
  return out;
}

// Index of the first Possible/Observed cell within the lookahead when the aircraft is not
// already in such a cell; otherwise null.
export function entryIndex(c, state) {
  if (isIcingLevel(state.prevLevel)) return null;
  const levels = lookaheadLevels(c, state);
  for (let i = 0; i < levels.length; i++) {
    if (isIcingLevel(levels[i])) return state.step + i;
  }
  return null;
}

// Reasons that hold at a boundary, in the order ice, exit, entry (design section 7).
// The ice reason holds once, at the first boundary with index >= ICE_GATE while still flying.
export function gateReasons(c, state) {
  if (state.status !== "flying") return [];
  const reasons = [];
  if (state.ice >= ICE_GATE && !state.iceGateDone) reasons.push("ice");
  if (state.antiIce && isIcingLevel(state.prevLevel) &&
      !lookaheadLevels(c, state, EXIT_LOOKAHEAD).some(isIcingLevel)) {
    reasons.push("exit");
  }
  const e = entryIndex(c, state);
  if (e !== null && e !== state.announcedEntry) {
    const merged = state.antiIce && state.lastIcingStep !== null &&
      e - state.lastIcingStep - 1 < MERGE_GAP;
    if (!merged) reasons.push("entry");
  }
  return reasons;
}

// First reason of gateReasons, or null (for callers that need a single reason).
export function gateReason(c, state) {
  const reasons = gateReasons(c, state);
  return reasons.length ? reasons[0] : null;
}

// A skipped entry never sets the announced entry.
export function announce(c, state, reasons) {
  let out = state;
  if (reasons.includes("ice")) out = { ...out, iceGateDone: true };
  if (reasons.includes("entry")) out = { ...out, announcedEntry: entryIndex(c, state) };
  return out;
}

// Fast-forward until a gate or the end of the flight. Always flies at least one segment, except
// that a gate at the very start of a flight (step 0) is reported first.
// Returns { state, reasons }: all reasons of the gate in order (one gate per boundary), or
// ['arrived'] / ['diverted'] when the flight ended.
export function runUntilGate(c, state, { checkStart = true } = {}) {
  if (checkStart && state.step === 0 && state.status === "flying") {
    const reasons = gateReasons(c, state);
    if (reasons.length) return { state: announce(c, state, reasons), reasons };
  }
  for (;;) {
    state = step(c, state);
    if (state.status !== "flying") return { state, reasons: [state.status] };
    const reasons = gateReasons(c, state);
    if (reasons.length) return { state: announce(c, state, reasons), reasons };
  }
}
// Report numbers for a finished (or running) flight.
export function summary(c, state) {
  const components = {};
  COMPONENTS.forEach((name, i) => { components[name] = state.cost[i]; });
  components.diversion = state.status === "diverted" ? c.params.diversionUsd : 0.0;
  return {
    status: state.status, ranked: state.status === "arrived", totalUsd: totalUsd(c, state),
    components, icePeak: state.ice, minutesAntiIce: state.minutesAntiIce, antiIceKm: state.antiIceKm,
    kmPerLevel: state.kmPerLevel.slice(), distanceKm: stateDistanceKm(state),
  };
}

// Fly a fixed per-segment policy [[lane, alt, antiIce], ...] (targets set every step).
export function flyPolicy(c, actions) {
  let state = initialState(c);
  for (const [lane, alt, ai] of actions) {
    if (state.status !== "flying") break;
    state = step(c, setTargets(c, state, lane, alt, ai));
  }
  return state;
}
