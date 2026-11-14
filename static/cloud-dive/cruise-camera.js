// Cruise camera (task 15.5, design 14.7, R15.8). DOM-free so Node tests can run it.
// Display only: it reads positions from the engine state and returns where the eye is drawn. It never
// changes the engine state, the case or any score (R19.5). No clock of its own: the caller passes time.
//
// While the flight runs, the eye follows the aircraft position (motionFrac) with a short lag, so fast-forward
// reads as forward motion. When the flight stops (gate, pause or end), the lag decays and the eye comes to
// rest at the aircraft position within STOP_EASE_MS (R15.8). The eye never passes the aircraft position.

import { ftToDisplayKm, laneToDisplayKm } from "./scene.js";

export const FOLLOW_TAU_MS = 200; // time constant of the follow lag while running
export const STOP_EASE_MS = 1500; // the eye is at rest at most this long after the flight stops (R15.8)
export const SETTLE_KM = 0.02; // closer than this counts as at rest

const finite = (v) => typeof v === "number" && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// Aircraft position along the route in km: from prevStep to step by frac in [0, 1] (the share motionFrac gives).
// prevStep null means no earlier position. Never beyond the route length.
export function positionKm(c, prevStep, step, frac) {
  const at = (s) => clamp((finite(s) ? s : 0) * c.stepKm, 0, c.distanceKm);
  const to = at(step);
  const from = prevStep === null || prevStep === undefined ? to : at(prevStep);
  return from + (to - from) * clamp(finite(frac) ? frac : 1, 0, 1);
}

// Eye position in display km [x, y, z]: altitude and lane are blended between the previous and the current
// step by frac, as the 2D views do. from and to are { altFt, lane } (from may be null).
export function eyePosition(c, xKm, from, to, frac) {
  const f = clamp(finite(frac) ? frac : 1, 0, 1);
  const a = from || to;
  const altFt = a.altFt + (to.altFt - a.altFt) * f;
  const laneKm = c.lanesKm[a.lane] + (c.lanesKm[to.lane] - c.lanesKm[a.lane]) * f;
  return [xKm, ftToDisplayKm(altFt), laneToDisplayKm(laneKm)];
}

// update({ nowMs, targetKm, running, snap }) returns the eye x in km.
//   running  true while the controller fast-forwards
//   snap     true to put the eye at the target at once (reduced motion, new flight)
export function createCruiseCamera() {
  let x = null;
  let last = 0;
  let stoppedAt = null;

  function update({ nowMs, targetKm, running, snap }) {
    if (!finite(targetKm)) return x === null ? 0 : x;
    if (!finite(nowMs)) nowMs = last;
    if (x === null || snap || targetKm < x - 1e-9) {
      x = targetKm; // first frame, snap, or a new flight that starts behind the eye
      last = nowMs;
      stoppedAt = running ? null : nowMs;
      return x;
    }
    const dt = Math.max(0, nowMs - last);
    last = nowMs;
    if (running) stoppedAt = null;
    else if (stoppedAt === null) stoppedAt = nowMs;
    x += (targetKm - x) * (1 - Math.exp(-dt / FOLLOW_TAU_MS));
    if (!running && (nowMs - stoppedAt >= STOP_EASE_MS || targetKm - x < SETTLE_KM)) x = targetKm;
    if (x > targetKm) x = targetKm;
    return x;
  }

  return {
    update,
    // True when the eye is at rest at the target, so the frame loop may stop.
    settled: (targetKm) => x !== null && finite(targetKm) && targetKm - x < SETTLE_KM,
    reset() { x = null; stoppedAt = null; },
    get x() { return x; },
  };
}
