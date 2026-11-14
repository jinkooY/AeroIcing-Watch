// Cloud Dive flight phases (task 17.2, design 14.6, R15.1 to R15.15).
// Pure and DOM-free: no clock, no random. phaseStep(ps, dtMs, input) returns a new phase state and never
// changes its arguments; phasePose(ps) returns the pose that scene.js buildScene reads.
//
//   ready -> takeoff (5 s) -> climb (10-15 s) -> cruise <-> gate -> arrival (10 s) -> report
//                                                       \-> diversion (4 s) -> report
//
// The phase state holds no engine value and no case value. The engine steps only in cruise and gate
// (engineMayStep); when the climb ends the state carries event "engineStart" once, and the caller then
// creates the engine's existing initial state (step 0, R15.7). Skipping a cinematic only moves the phase
// forward; every other field stays as it was (R15.11, R15.13).
import { LEAD_IN_KM } from "./scene.js";

export const TAKEOFF_MS = 5000; // R15.2
export const CLIMB_MS_MIN = 10000; // R15.3
export const CLIMB_MS_MAX = 15000;
export const CLIMB_MS_DEFAULT = 12000;
export const ARRIVAL_MS = 10000; // R15.9
export const DIVERSION_MS = 4000; // R15.10
export const REDUCED_MAX_MS = 2000; // R15.12
export const TAKEOFF_ROLL_KM = 1.5; // display run along the runway before lift-off
export const CLIMB_PITCH_DEG = 8; // design 14.7
export const ARRIVAL_PITCH_DEG = -3;
export const DIVERSION_BANK_DEG = 25;
export const DIVERSION_TURN_DEG = 40;

export const PHASE_NAMES = ["ready", "takeoff", "climb", "cruise", "gate", "arrival", "diversion", "report"];

// Allowed transitions (design 14.6). The test checks every step against this table.
export const TRANSITIONS = Object.freeze({
  ready: ["takeoff"],
  takeoff: ["climb", "cruise"], // cruise only through skip
  climb: ["cruise"],
  cruise: ["gate", "arrival", "diversion", "report"],
  gate: ["cruise", "arrival", "diversion", "report"],
  arrival: ["report"],
  diversion: ["report"],
  report: [],
});

const finite = (v) => typeof v === "number" && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round6 = (v) => Math.round(v * 1e6) / 1e6;
const smooth = (p) => p * p * (3 - 2 * p);
const num = (v, d = 0) => (finite(v) ? v : d);

// opts: { reducedMotion, cinematics, departureElevFt, startAltFt, arrivalElevFt, climbMs }.
// cinematics false (arrival cinematic cut, G2) opens the report at once at the end of the flight.
export function createPhaseState(opts) {
  const o = opts || {};
  return {
    phase: "ready",
    tMs: 0,
    reduced: o.reducedMotion === true,
    cinematics: o.cinematics !== false,
    climbMs: clamp(num(o.climbMs, CLIMB_MS_DEFAULT), CLIMB_MS_MIN, CLIMB_MS_MAX),
    departureElevFt: num(o.departureElevFt),
    startAltFt: num(o.startAltFt),
    arrivalElevFt: num(o.arrivalElevFt),
    endAltFt: null, // aircraft altitude when the flight ended (from input.altFt), for the arrival pose
    endLaneFrac: null,
    engineStarted: false,
    event: null,
  };
}

// Duration of the phase in ms (0 for phases that wait for input). Reduced motion: at most 2 s.
export function phaseDurationMs(ps) {
  const base = ps.phase === "takeoff" ? TAKEOFF_MS : ps.phase === "climb" ? ps.climbMs
    : ps.phase === "arrival" ? ARRIVAL_MS : ps.phase === "diversion" ? DIVERSION_MS : 0;
  return ps.reduced ? Math.min(base, REDUCED_MAX_MS) : base;
}

export const engineMayStep = (ps) => ps.phase === "cruise" || ps.phase === "gate";
export const isCinematic = (ps) => ["takeoff", "climb", "arrival", "diversion"].includes(ps.phase);

function enter(ps, phase, extra) {
  return { ...ps, ...extra, phase, tMs: 0, event: phase === "cruise" && !ps.engineStarted ? "engineStart" : null,
    engineStarted: ps.engineStarted || phase === "cruise" };
}

// The end of the flight: arrival or diversion, then the report. Only from cruise or gate.
function endFlight(ps, input) {
  const kind = input.arrived ? "arrival" : input.diverted ? "diversion" : null;
  if (!kind) return null;
  const extra = { endAltFt: finite(input.altFt) ? input.altFt : null, endLaneFrac: finite(input.laneFrac) ? input.laneFrac : null };
  return enter(ps, ps.cinematics ? kind : "report", extra);
}

// input: { start, skip, gate, arrived, diverted, altFt, laneFrac }; all optional, unknown keys ignored.
//   start     press of the takeoff button (ready only)
//   skip      finishes the running cinematic (takeoff and climb together, arrival, diversion)
//   gate      the engine is stopped at a gate (cruise and gate only)
//   arrived / diverted   the engine reports the end of the flight (cruise and gate only)
//   altFt, laneFrac      aircraft altitude and lane at that moment, kept for the arrival pose
export function phaseStep(ps, dtMs, input) {
  const inp = input || {};
  let dt = finite(dtMs) && dtMs > 0 ? dtMs : 0;
  let s = { ...ps, event: null };

  if (s.phase === "ready") {
    return inp.start === true ? enter(s, "takeoff") : s;
  }
  if (s.phase === "takeoff" || s.phase === "climb") {
    if (inp.skip === true) return enter(s, "cruise"); // end pose of the lead-in; nothing else changes
    s.tMs += dt;
    if (s.phase === "takeoff" && s.tMs >= phaseDurationMs(s)) {
      const rest = s.tMs - phaseDurationMs(s);
      s = enter(s, "climb");
      s.tMs = rest;
    }
    if (s.phase === "climb" && s.tMs >= phaseDurationMs(s)) s = enter(s, "cruise");
    return s;
  }
  if (s.phase === "cruise" || s.phase === "gate") {
    const end = endFlight(s, inp);
    if (end) return end;
    if (inp.gate === true && s.phase === "cruise") return enter(s, "gate");
    if (inp.gate === false && s.phase === "gate") return enter(s, "cruise");
    return s;
  }
  if (s.phase === "arrival" || s.phase === "diversion") {
    if (inp.skip === true) return enter(s, "report");
    s.tMs += dt;
    return s.tMs >= phaseDurationMs(s) ? enter(s, "report") : s;
  }
  return s; // report
}

// Pose for buildScene: { phase, progress, xKm, altFt, laneFrac, pitchDeg, yawDeg, rollDeg, climbRemainingS }.
// In cruise and gate only the angles and phase are given: position, altitude and lane come from the engine
// state and the motion fraction, which the caller adds. All numbers are finite.
export function phasePose(ps) {
  const dur = phaseDurationMs(ps);
  const p = dur > 0 ? clamp(ps.tMs / dur, 0, 1) : 0;
  const base = { phase: ps.phase, progress: round6(p), pitchDeg: 0, yawDeg: 0, rollDeg: 0, climbRemainingS: 0 };
  const climbS = (ps.reduced ? Math.min(ps.climbMs, REDUCED_MAX_MS) : ps.climbMs) / 1000;
  const runStart = -LEAD_IN_KM + TAKEOFF_ROLL_KM;

  switch (ps.phase) {
    case "ready":
      return { ...base, xKm: -LEAD_IN_KM, altFt: ps.departureElevFt, climbRemainingS: climbS };
    case "takeoff": {
      const lift = clamp((p - 0.7) / 0.3, 0, 1); // nose comes up in the last 30 percent
      return { ...base, xKm: round6(-LEAD_IN_KM + TAKEOFF_ROLL_KM * p * p), altFt: ps.departureElevFt,
        pitchDeg: round6(CLIMB_PITCH_DEG * smooth(lift)), climbRemainingS: climbS };
    }
    case "climb": {
      const settle = clamp((1 - p) / 0.2, 0, 1); // pitch eases to level in the last 20 percent
      return { ...base, xKm: round6(runStart + (0 - runStart) * p),
        altFt: round6(ps.departureElevFt + (ps.startAltFt - ps.departureElevFt) * p),
        pitchDeg: round6(CLIMB_PITCH_DEG * smooth(settle)), climbRemainingS: round6(Math.max(climbS * (1 - p), 0)) };
    }
    case "arrival": {
      const from = num(ps.endAltFt, ps.startAltFt);
      return { ...base, altFt: round6(from + (ps.arrivalElevFt - from) * smooth(p)),
        pitchDeg: round6(ARRIVAL_PITCH_DEG * Math.sin(Math.PI * p)), ...(ps.endLaneFrac === null ? {} : { laneFrac: ps.endLaneFrac }) };
    }
    case "diversion": {
      const bank = Math.sin(Math.PI * smooth(p));
      return { ...base, ...(ps.endAltFt === null ? {} : { altFt: ps.endAltFt }), ...(ps.endLaneFrac === null ? {} : { laneFrac: ps.endLaneFrac }),
        yawDeg: round6(DIVERSION_TURN_DEG * smooth(p)), rollDeg: round6(DIVERSION_BANK_DEG * bank) };
    }
    default: // cruise, gate, report
      return base;
  }
}
