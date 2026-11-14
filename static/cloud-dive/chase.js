// Chase view (task 19.1, R16.11, design 14.x). DOM-free helpers: key C, the outside camera and a generic
// regional-jet model built from boxes. No livery, logo or registration, and no likeness of a real type.
// In chase mode scene.camera.pos is the aircraft position (the pose position); the camera sits behind and above it.
// Display only: nothing here reads or changes the case file or the engine state.

import { MAX_TRIANGLES } from "./scene.js";
import { BOX_TRIANGLES } from "./cockpit-geometry.js";

export const MODES = Object.freeze(["cockpit", "chase"]);
export const CHASE_BACK_KM = 0.6; // camera distance behind the aircraft (display km)
export const CHASE_UP_KM = 0.18; // camera height above the aircraft
export const CHASE_FOV_DEG = 60;

export const CHASE_BUTTON = Object.freeze({ toChase: "Chase view (C)", toCockpit: "Cockpit view (C)" });
export const chaseButtonLabel = (mode) => (mode === "chase" ? CHASE_BUTTON.toCockpit : CHASE_BUTTON.toChase);

const num = (v, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const round6 = (v) => Math.round(v * 1e6) / 1e6;
const rad = (d) => (d * Math.PI) / 180;

export const normalizeMode = (m) => (m === "chase" ? "chase" : "cockpit");
export const toggleMode = (m) => (m === "chase" ? "cockpit" : "chase");

// Key C. Only when a flight is on screen in the 3D view and the game keys are allowed (caller checks the dialogs).
// C does not clash with the other keys: arrows, A, Space (gate-controls.js), L (legend), M (map), V (view), Escape.
export function chaseKeyApplies(key, { flightOn, cockpitView }) {
  return (key === "c" || key === "C") && Boolean(flightOn) && Boolean(cockpitView);
}

// Camera of the chase view from the aircraft pose camera { pos, yawDeg, pitchDeg, rollDeg, fovDeg }.
// Behind along the heading, above, and tilted down to look at the aircraft.
export function chaseCamera(cam) {
  const c = cam || {};
  const p = Array.isArray(c.pos) ? c.pos : [0, 0, 0];
  const yaw = rad(num(c.yawDeg));
  const pitch = num(c.pitchDeg);
  const back = CHASE_BACK_KM;
  const up = CHASE_UP_KM + back * Math.tan(rad(Math.max(pitch, 0)));
  return {
    pos: [
      round6(num(p[0]) - back * Math.cos(yaw)),
      round6(num(p[1]) + up),
      round6(num(p[2]) - back * Math.sin(yaw)),
    ],
    yawDeg: num(c.yawDeg),
    pitchDeg: round6(-(Math.atan2(CHASE_UP_KM, back) * 180) / Math.PI + pitch),
    rollDeg: 0, // the outside camera stays level; the airframe shake is added by the renderer
    fovDeg: CHASE_FOV_DEG,
  };
}

// Generic twin-engine regional jet: fuselage, nose, wing, two engine pods, fin and tail plane. Axis-aligned
// boxes along +x (nose ahead), centred on `pos`. Drawn at an exaggerated display scale (about 0.2 km long).
const HULL = [0.92, 0.94, 0.97];
const WING = [0.74, 0.78, 0.84];
const POD = [0.58, 0.62, 0.68];
export function aircraftBoxes(pos) {
  const p = Array.isArray(pos) ? pos : [0, 0, 0];
  const x = num(p[0]), y = num(p[1]), z = num(p[2]);
  const b = (x0, x1, y0, y1, z0, z1, color, taper = 0) =>
    ({ x0: x + x0, x1: x + x1, y0: y + y0, y1: y + y1, z0: z + z0, z1: z + z1, color, taper });
  return [
    b(-0.1, 0.07, -0.015, 0.015, -0.015, 0.015, HULL), // fuselage
    b(0.07, 0.11, -0.012, 0.012, -0.012, 0.012, HULL, 0.35), // nose
    b(-0.02, 0.04, -0.004, 0.004, -0.1, 0.1, WING), // wing
    b(0.0, 0.03, -0.014, -0.004, -0.045, -0.025, POD), // engine pod, left
    b(0.0, 0.03, -0.014, -0.004, 0.025, 0.045, POD), // engine pod, right
    b(-0.1, -0.07, 0.0, 0.05, -0.003, 0.003, WING), // fin
    b(-0.1, -0.075, 0.015, 0.02, -0.04, 0.04, WING), // tail plane
  ];
}

export const AIRCRAFT_TRIANGLES = aircraftBoxes([0, 0, 0]).length * BOX_TRIANGLES;
// Budget left for the scene when the model is drawn (the cockpit frame is not drawn in chase mode).
export const chaseBudget = (max = MAX_TRIANGLES) => Math.max(0, max - AIRCRAFT_TRIANGLES);
