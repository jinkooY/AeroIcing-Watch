// Cloud Dive runway and takeoff glue (task 17.3, R15.1, R15.2, R15.14). DOM-free and clock-free: game.js passes
// the frame time in. It only decides what phases.js and scene.js are given and how a frame advances the lead-in;
// the phase machine itself stays in phases.js and no engine value is changed here.
import { createPhaseState, phaseStep, phaseDurationMs } from "./phases.js";
import * as engine from "./engine.js";

export const START_LABEL = "Start takeoff";
export const START_HINT = "Press Space or Enter, or the button, to start the takeoff.";
export const LEAD_PHASES = Object.freeze(["ready", "takeoff", "climb"]);
export const MAX_FRAME_MS = 250; // a frame after a long pause (hidden tab) counts as at most this long
export const LEAD_EYE_KM = 0.05; // display-only eye height above the runway, so the eye is not inside the ground

const finite = (v) => typeof v === "number" && Number.isFinite(v);

// True while the aircraft is still in the lead-in (the engine does not step).
export const inLead = (ps) => Boolean(ps) && LEAD_PHASES.includes(ps.phase);

function airportOf(file, which) {
  const a = file && file.airports && file.airports[which];
  return a && typeof a === "object" ? a : {};
}

// Options for createPhaseState from the case file and the engine case.
export function phaseOptions(file, c, reducedMotion) {
  const dep = airportOf(file, "from");
  const arr = airportOf(file, "to");
  return {
    reducedMotion: reducedMotion === true,
    cinematics: true,
    departureElevFt: finite(dep.elevFt) ? dep.elevFt : 0,
    startAltFt: c && Array.isArray(c.altsFt) ? c.altsFt[c.startAlt] : 0,
    arrivalElevFt: finite(arr.elevFt) ? arr.elevFt : 0,
  };
}

// Options for buildScene (airport elevations and codes), used for the lead-in and for cruise alike so the
// ground does not jump at the hand-over.
export function sceneOptions(file, c, extra) {
  const dep = airportOf(file, "from");
  const arr = airportOf(file, "to");
  const route = (file && file.route) || {};
  return {
    engineCase: c,
    departureElevFt: finite(dep.elevFt) ? dep.elevFt : 0,
    arrivalElevFt: finite(arr.elevFt) ? arr.elevFt : 0,
    departureIcao: String(dep.icao || route.from || ""),
    arrivalIcao: String(arr.icao || route.to || ""),
    ...(extra || {}),
  };
}

export const newPhaseState = (file, c, reducedMotion) => createPhaseState(phaseOptions(file, c, reducedMotion));

// Space or Enter without modifiers and without key repeat starts the takeoff.
export function isStartKey(e) {
  if (!e || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return false;
  return e.key === " " || e.key === "Spacebar" || e.key === "Enter";
}

// Real elapsed time between two frames in ms, never negative and never above MAX_FRAME_MS. null means no
// earlier frame (the first frame of a phase counts as 0 ms).
export function frameDt(nowMs, lastMs) {
  if (!finite(nowMs) || !finite(lastMs)) return 0;
  return Math.min(Math.max(nowMs - lastMs, 0), MAX_FRAME_MS);
}

// Advances the lead-in by one frame. Returns { ps, engineStart }; engineStart is true on the one step where the
// phase machine hands over to cruise (event "engineStart"). Nothing else is returned or changed.
export function leadAdvance(ps, dtMs, input) {
  const next = phaseStep(ps, dtMs, input || {});
  return { ps: next, engineStart: next.event === "engineStart" };
}

// The engine state to fly from at the hand-over: the state at step 0 as it is when nothing has stepped, else the
// engine's own initial state (step 0, R15.7). The engine never steps during the lead-in, so the first case is normal.
export function engineStartState(c, st) {
  if (st && st.step === 0 && st.status === "flying") return st;
  return engine.initialState(c);
}

// Finishes the lead-in at once (2D view, or a flight already started): start if needed, then skip.
export function finishLead(ps) {
  let s = ps;
  if (s.phase === "ready") s = phaseStep(s, 0, { start: true });
  if (s.phase === "takeoff" || s.phase === "climb") s = phaseStep(s, 0, { skip: true });
  return s;
}

// Raises the eye a little above the runway for the lead-in. Returns a new scene; the input is not changed.
export function withLeadEye(scene) {
  if (!scene || !scene.camera || !Array.isArray(scene.camera.pos)) return scene;
  const [x, y, z] = scene.camera.pos;
  return { ...scene, camera: { ...scene.camera, pos: [x, y + LEAD_EYE_KM, z] } };
}

// Spoken and shown status for the lead-in. No numbers from the weather, no advice.
export function leadStatusText(ps, icao) {
  const where = icao ? ` at ${icao}` : "";
  if (!ps) return "";
  if (ps.phase === "ready") return `Ready on the runway${where}. ${START_HINT}`;
  if (ps.phase === "takeoff") return "Taking off.";
  if (ps.phase === "climb") return "Climbing to the start of the route.";
  return "";
}

// ---- Arrival and diversion cinematics (task 17.5, R15.9, R15.10) ----
// The cinematic only reads the finished engine state; it never changes it.
export const SKIP_LABEL = "Skip";
export const ENDING_PHASES = Object.freeze(["arrival", "diversion"]);

// True while the arrival or diversion cinematic runs.
export const inEnding = (ps) => Boolean(ps) && ENDING_PHASES.includes(ps.phase);

// Input for phaseStep when the engine reports the end of the flight (status arrived or diverted).
export function endingInput(c, st) {
  const alt = c && Array.isArray(c.altsFt) && st ? c.altsFt[st.alt] : null;
  return {
    arrived: Boolean(st) && st.status === "arrived",
    diverted: Boolean(st) && st.status === "diverted",
    altFt: finite(alt) ? alt : null,
    laneFrac: st && finite(st.lane) ? st.lane : null,
  };
}

// Ends a running arrival or diversion cinematic at once (2D view, Skip). Only the phase moves on.
export function finishEnding(ps) {
  return inEnding(ps) ? phaseStep(ps, 0, { skip: true }) : ps;
}

// ---- Skip and reduced motion (task 17.6, R15.11, R15.12) ----
// True while a cinematic can be skipped: takeoff roll, climb, arrival, diversion. Not in ready, cruise, gate, report.
export const skippable = (ps) => Boolean(ps) && ["takeoff", "climb", "arrival", "diversion"].includes(ps.phase);

// Skips the running cinematic at once. Only the phase moves on; any other phase is returned unchanged.
export const skipCinematic = (ps) => (skippable(ps) ? phaseStep(ps, 0, { skip: true }) : ps);

// Follows a change of the reduced-motion setting during play. The progress of the running phase stays the
// same, so the picture does not jump; the remaining time shrinks to fit the 2 s limit, or grows back. No value changes.
export function setReducedMotion(ps, reduced) {
  if (!ps) return ps;
  const flag = reduced === true;
  if (ps.reduced === flag) return ps;
  const before = phaseDurationMs(ps);
  const next = { ...ps, reduced: flag };
  const after = phaseDurationMs(next);
  if (before > 0 && after > 0) next.tMs = ps.tMs * (after / before);
  return next;
}

// Space without modifiers and without key repeat skips a cinematic.
export function isSkipKey(e) {
  if (!e || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return false;
  return e.key === " " || e.key === "Spacebar";
}

// Status text for the cinematics. No weather numbers, no advice.
export function endingStatusText(ps, icao) {
  if (!ps) return "";
  const where = icao ? ` at ${icao}` : "";
  if (ps.phase === "arrival") return `Descending and landing${where}. This is not scored. The report opens next.`;
  if (ps.phase === "diversion") return "Turning away: the ice index reached 100 and the flight ends in a diversion (not ranked). The report opens next.";
  return "";
}
