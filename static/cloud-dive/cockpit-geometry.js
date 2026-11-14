// Geometry helpers of the 3D cockpit view (design 14.4, 14.5, 14.7, 14.9, 14.11, task 15.2).
// Pure and DOM-free: plain arrays in, plain arrays out, so Node tests can check them. cockpit3d.js turns
// the result into three.js buffers. Nothing here reads or changes the case file or the engine state; the
// only input is the scene description from scene.js buildScene.
// Units: display kilometres (x along track, y up, z right). Heights already carry VEX, lanes carry LATK.

import {
  STRINGS, VIEW_KM, MAX_TRIANGLES, DEFAULT_FOV_DEG, ftToDisplayKm, SHAKE_MAX_DEG,
} from "./scene.js";

// ---- Tuning (task 15.2). VEX, LATK and DEFAULT_FOV_DEG stay in scene.js; the eye height lives here. ----
// The lane sheets are drawn EYE_HEIGHT_KM below the eye. A sheet at exactly eye level would be edge-on and
// collapse into the horizon line, so the eye sits above it and the sheets read as lanes on the way ahead.
export const EYE_HEIGHT_KM = 0.8;
export const GUIDE_HALF_WIDTH_KM = 0.25; // half width of one lane sheet
export const MIN_HFOV_DEG = 70; // narrow (phone) screens widen the vertical field of view up to MAX_VFOV_DEG
export const MAX_VFOV_DEG = 100;
export const MAX_BASE_LABELS = 4; // "estimated" labels drawn at once

export const MARKER_HEIGHT_KM = 3; // beacon pole of an airport marker (display icon, not a measurement)
export const TOP_OF_CLIMB_HEIGHT_KM = 10;
export const RUNWAY_HALF_LENGTH_KM = 2;
export const BOX_TRIANGLES = 12;
export const SKY_SEGMENTS = [16, 8]; // sky dome width and height segments
export const SKY_TRIANGLES = SKY_SEGMENTS[0] * (2 * SKY_SEGMENTS[1] - 2);
export const GROUND_TRIANGLES = 2;
export const LABEL_TRIANGLES = 2;

const num = (v, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const rad = (d) => (d * Math.PI) / 180;

// ---- Mesh data ------------------------------------------------------------------------------------
export function createMeshData() {
  return { positions: [], colors: [], uvs: [], indices: [] };
}
export const triangleCount = (data) => data.indices.length / 3;

// Corner indices (x, y, z each 0 or 1) of the six faces, outward winding.
const FACES = [
  { axis: "x", shade: 0.75, v: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] }, // +x
  { axis: "x", shade: 0.75, v: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] }, // -x
  { axis: "y", shade: 1.0, v: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] }, // +y (top)
  { axis: "y", shade: 0.55, v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] }, // -y (bottom)
  { axis: "z", shade: 0.85, v: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] }, // +z
  { axis: "z", shade: 0.85, v: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] }, // -z
];
const UNIT_UV = [[0, 0], [1, 0], [1, 1], [0, 1]];

// Adds one box (24 vertices, 12 triangles).
// b: { x0,x1,y0,y1,z0,z1, color:[r,g,b], alpha, alphaTop, alphaBottom, taper (0..0.45 inset of the top face),
//      tile (km per texture repeat; 0 = one texture over each face), shade (false = flat colour) }
export function appendBox(data, b) {
  const x0 = num(b.x0), x1 = Math.max(num(b.x1), x0);
  const y0 = num(b.y0), y1 = Math.max(num(b.y1), y0);
  const z0 = num(b.z0), z1 = Math.max(num(b.z1), z0);
  const taper = clamp(num(b.taper), 0, 0.45);
  const tx = ((x1 - x0) / 2) * taper;
  const tz = ((z1 - z0) / 2) * taper;
  const col = Array.isArray(b.color) ? b.color : [1, 1, 1];
  const aTop = num(b.alphaTop, num(b.alpha, 1));
  const aBot = num(b.alphaBottom, num(b.alpha, 1));
  const tile = num(b.tile) > 0 ? b.tile : 0;
  const shaded = b.shade !== false;
  const corner = ([ix, iy, iz]) => [
    ix ? (iy ? x1 - tx : x1) : (iy ? x0 + tx : x0),
    iy ? y1 : y0,
    iz ? (iy ? z1 - tz : z1) : (iy ? z0 + tz : z0),
  ];
  for (const f of FACES) {
    const base = data.positions.length / 3;
    f.v.forEach((c, k) => {
      const p = corner(c);
      data.positions.push(p[0], p[1], p[2]);
      const s = shaded ? f.shade : 1;
      data.colors.push(clamp(col[0] * s, 0, 1), clamp(col[1] * s, 0, 1), clamp(col[2] * s, 0, 1), c[1] ? aTop : aBot);
      if (tile) {
        const uv = f.axis === "x" ? [p[2], p[1]] : f.axis === "z" ? [p[0], p[1]] : [p[0], p[2]];
        data.uvs.push(uv[0] / tile, uv[1] / tile);
      } else {
        data.uvs.push(UNIT_UV[k][0], UNIT_UV[k][1]);
      }
    });
    data.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

export function meshFromBoxes(boxes) {
  const d = createMeshData();
  for (const b of boxes) appendBox(d, b);
  return d;
}

// ---- Generated textures (RGBA bytes, no canvas, no file asset; R16.7 pattern, not hue alone) -----------
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
function rgba(size, alphaAt) {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      out[i] = out[i + 1] = out[i + 2] = 255;
      out[i + 3] = clamp(Math.round(alphaAt(x, y)), 0, 255);
    }
  }
  return out;
}
// Possible: faint haze with a regular dot grid (stippled).
export const stippleData = (size = 32) =>
  rgba(size, (x, y) => ((x % 8 === 3 || x % 8 === 4) && (y % 8 === 3 || y % 8 === 4) ? 190 : 55));
// Not assessed: sparse diagonal line hatch, nothing between the lines.
export const hatchData = (size = 32) => rgba(size, (x, y) => ((x + y) % 16 < 2 ? 210 : 0));
// Clouds: soft edge, strongest at the face centre.
export const softData = (size = 32) =>
  rgba(size, (x, y) => {
    const u = ((x + 0.5) / size) * 2 - 1;
    const v = ((y + 0.5) / size) * 2 - 1;
    return 255 * (1 - smooth(0.45, 1, Math.max(Math.abs(u), Math.abs(v))));
  });

// Frost (R18.1): generated, no image file, no random number. Alpha is strong at the border of the windshield
// opening and fades to nothing toward the centre; a fixed integer hash breaks it into crystal-like specks.
// The material opacity (frostOpacity) scales the whole texture, so the centre of the view stays readable.
const hash2 = (x, y) => {
  let h = (Math.imul(x + 374761393, 668265263) ^ Math.imul(y + 1442695041, 2246822519)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};
export const frostData = (size = 64) =>
  rgba(size, (x, y) => {
    const u = ((x + 0.5) / size) * 2 - 1;
    const v = ((y + 0.5) / size) * 2 - 1;
    const edge = smooth(0.35, 1, Math.max(Math.abs(u), Math.abs(v)));
    const speck = 0.55 + 0.45 * hash2(x >> 1, y >> 1);
    return 255 * edge * speck;
  });

// Frost opacity 0..1 from the scene description only: ice / 100 (scene.effects.frost). Zero when absent.
export function frostOpacity(scene) {
  const f = scene && scene.effects ? scene.effects.frost : 0;
  return clamp(num(f), 0, 1);
}

// Windshield opening in camera space at z = -1 (same frame as cockpitBoxes): frost never covers the panel.
export function frostRect(aspect, fovDeg = DEFAULT_FOV_DEG) {
  const h = Math.tan(rad(fovDeg) / 2);
  const w = h * clamp(num(aspect, 1.78), 0.2, 5);
  return { x0: -w, x1: w, y0: h * (FRAME.panelTop + FRAME.glareHeight), y1: h, z: -0.88 };
}

// Wind streaks (task 16.4, R16.9): at most MAX_STREAKS short radial lines in the windshield opening, in camera
// space at z = rect.z. Count comes from scene.effects.windStreaks (already capped at 12 by scene.js and again
// here). Deterministic: angle and radius come from the streak index and the frame time only, no random number.
// Reduced motion freezes them. Display only; the head-wind number stays in the text line.
export const MAX_STREAKS = 12;
export function windStreakSegments(scene, aspect, fovDeg = DEFAULT_FOV_DEG, nowMs = 0, reducedMotion = false) {
  const raw = scene && scene.effects ? Math.floor(num(scene.effects.windStreaks)) : 0;
  const n = clamp(raw, 0, MAX_STREAKS);
  if (n === 0) return [];
  const r = frostRect(aspect, fovDeg);
  const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
  const hx = (r.x1 - r.x0) / 2, hy = (r.y1 - r.y0) / 2;
  const t = reducedMotion ? 0 : num(nowMs) / 2000;
  const out = [];
  for (let i = 0; i < n; i++) {
    const ang = (i * 2.399963229728653) % (2 * Math.PI); // golden angle spreads the streaks evenly
    const p = (((i * 0.381966) % 1) + t) % 1; // 0 at the centre, 1 at the edge
    const a = 0.25 + 0.7 * p, b = Math.min(a + 0.08 + 0.1 * p, 1);
    const dx = Math.cos(ang), dy = Math.sin(ang);
    out.push({ x0: cx + dx * hx * a, y0: cy + dy * hy * a, x1: cx + dx * hx * b, y1: cy + dy * hy * b, z: r.z });
  }
  return out;
}

// ---- Evidence levels (design 14.5) ---------------------------------------------------------------------
export const LEVEL_NOT_ASSESSED = 0;
export const LEVEL_NOT_INDICATED = 1;
export const LEVEL_POSSIBLE = 2;
export const LEVEL_OBSERVED = 3;

// An unrecognised level is treated as Not assessed, never as Not indicated (guardrails).
export function levelIndexOf(band) {
  if (band && Number.isInteger(band.levelIndex) && band.levelIndex >= 0 && band.levelIndex <= 3) return band.levelIndex;
  const i = STRINGS.levels.indexOf(band && band.level);
  return i >= 0 ? i : LEVEL_NOT_ASSESSED;
}

// Colours and alphas of the four drawings: solid glow, stippled haze, line hatch, nothing.
export const EVIDENCE_STYLE = Object.freeze({
  [LEVEL_OBSERVED]: { name: "observed", color: [1.0, 0.55, 0.12], alpha: 0.38 },
  [LEVEL_POSSIBLE]: { name: "possible", color: [0.42, 0.65, 1.0], alpha: 0.32, tile: 2.5 },
  [LEVEL_NOT_ASSESSED]: { name: "notAssessed", color: [0.62, 0.62, 0.62], alpha: 0.7, tile: 2.5 },
});
const INFLATE = 0.02;

export function cloudBoxes(scene) {
  const out = [];
  for (const c of (scene && scene.clouds) || []) {
    const x0 = num(c.x0Km), x1 = num(c.x1Km);
    if (x1 - x0 <= 1e-6) continue;
    const bottom = num(c.bottomFt, num(c.baseFt, num(c.topFt)));
    out.push({
      x0, x1, y0: ftToDisplayKm(bottom), y1: ftToDisplayKm(c.topFt),
      z0: num(c.zKm) - num(c.halfWidthKm), z1: num(c.zKm) + num(c.halfWidthKm),
      color: [0.94, 0.96, 0.99], taper: 0.18, alphaTop: 0.6,
      alphaBottom: c.baseEstimated ? 0 : 0.35, // an estimated base fades out
      shade: true, baseEstimated: Boolean(c.baseEstimated),
    });
  }
  return out;
}

// Returns boxes with a `level` index. Not indicated makes nothing.
export function evidenceBoxes(scene) {
  const out = [];
  for (const b of (scene && scene.evidence) || []) {
    const level = levelIndexOf(b);
    if (level === LEVEL_NOT_INDICATED) continue;
    const st = EVIDENCE_STYLE[level];
    const x0 = num(b.x0Km), x1 = num(b.x1Km);
    if (x1 - x0 <= 1e-6) continue;
    const hw = num(b.halfWidthKm) * (1 + INFLATE);
    out.push({
      x0, x1, y0: ftToDisplayKm(b.loFt), y1: ftToDisplayKm(b.hiFt),
      z0: num(b.zKm) - hw, z1: num(b.zKm) + hw,
      color: st.color, alpha: st.alpha, tile: st.tile || 0, shade: false, level,
    });
  }
  return out;
}

// ---- Lane sheets, airport markers, labels --------------------------------------------------------------
// Sheets are built relative to the eye: the renderer places the group at the camera x and EYE_HEIGHT_KM below it.
export function guideBoxes(scene, viewKm = VIEW_KM) {
  const out = [];
  for (const l of (scene && scene.lanes) || []) {
    const a = l.isCurrent ? 0.55 : l.isTarget ? 0.45 : 0.22;
    const c = l.isTarget && !l.isCurrent ? [1, 0.85, 0.4] : [0.85, 0.95, 1];
    out.push({
      x0: -0.5, x1: viewKm, y0: 0, y1: 0.02,
      z0: num(l.zKm) - GUIDE_HALF_WIDTH_KM, z1: num(l.zKm) + GUIDE_HALF_WIDTH_KM,
      color: c, alpha: a, shade: false,
    });
  }
  return out;
}

// Centre-line dashes of the departure runway (task 17.3): flat boxes on the strip, at the airport elevation.
export const RUNWAY_DASH_KM = 0.2;
export const RUNWAY_DASH_PITCH_KM = 0.5;
export function runwayDashes(x, z, g) {
  const out = [];
  const n = Math.floor((2 * RUNWAY_HALF_LENGTH_KM - RUNWAY_DASH_KM) / RUNWAY_DASH_PITCH_KM) + 1;
  const start = x - RUNWAY_HALF_LENGTH_KM + RUNWAY_DASH_PITCH_KM / 2;
  for (let i = 0; i < n; i++) {
    const x0 = start + i * RUNWAY_DASH_PITCH_KM - RUNWAY_DASH_KM / 2;
    if (x0 + RUNWAY_DASH_KM > x + RUNWAY_HALF_LENGTH_KM) break;
    out.push({ x0, x1: x0 + RUNWAY_DASH_KM, y0: g + 0.02, y1: g + 0.025, z0: z - 0.02, z1: z + 0.02,
      color: [0.95, 0.95, 0.9], shade: false });
  }
  return out;
}

export function airportBoxes(scene) {
  const out = [];
  const g = num(scene && scene.ground && scene.ground.y);
  const lanes = (scene && scene.lanes) || [];
  const zs = lanes.map((l) => num(l.zKm));
  const zMin = zs.length ? Math.min(...zs) : -1;
  const zMax = zs.length ? Math.max(...zs) : 1;
  for (const a of (scene && scene.airports) || []) {
    const x = num(a.xKm), z = num(a.zKm);
    if (a.role === "topOfClimb") {
      const post = { y0: g, y1: g + TOP_OF_CLIMB_HEIGHT_KM, color: [0.88, 0.88, 1], shade: true };
      out.push({ ...post, x0: x - 0.05, x1: x + 0.05, z0: zMin - 0.55, z1: zMin - 0.45 });
      out.push({ ...post, x0: x - 0.05, x1: x + 0.05, z0: zMax + 0.45, z1: zMax + 0.55 });
      out.push({ x0: x - 0.05, x1: x + 0.05, y0: g + TOP_OF_CLIMB_HEIGHT_KM - 0.15, y1: g + TOP_OF_CLIMB_HEIGHT_KM,
        z0: zMin - 0.55, z1: zMax + 0.55, color: [0.88, 0.88, 1], shade: true });
      continue;
    }
    const dep = a.role === "departure";
    const tint = dep ? [0.35, 0.8, 0.9] : [0.7, 0.55, 0.95];
    out.push({ x0: x - RUNWAY_HALF_LENGTH_KM, x1: x + RUNWAY_HALF_LENGTH_KM, y0: g, y1: g + 0.02,
      z0: z - 0.12, z1: z + 0.12, color: [0.2, 0.2, 0.22], shade: true });
    if (dep) out.push(...runwayDashes(x, z, g));
    out.push({ x0: x - 0.1, x1: x + 0.1, y0: g, y1: g + 0.5, z0: z + 0.55, z1: z + 0.75, color: [0.6, 0.6, 0.64], shade: true });
    out.push({ x0: x - 0.05, x1: x + 0.05, y0: g, y1: g + MARKER_HEIGHT_KM, z0: z - 0.7, z1: z - 0.6, color: tint, shade: true });
  }
  return out;
}

// Labels: airport codes, "Top of climb", and "base estimated" on the nearest estimated cloud bases.
export function pickLabels(scene, maxBase = MAX_BASE_LABELS) {
  const out = [];
  const g = num(scene && scene.ground && scene.ground.y);
  for (const a of (scene && scene.airports) || []) {
    const text = a.role === "topOfClimb" ? a.label : a.icao;
    if (!text) continue;
    out.push({ text: String(text), x: num(a.xKm), y: g + MARKER_HEIGHT_KM + 0.8, z: num(a.zKm), width: 5, kind: "airport" });
  }
  const camX = num(scene && scene.camera && scene.camera.pos && scene.camera.pos[0]);
  const est = ((scene && scene.clouds) || []).filter((c) => c.baseEstimated && num(c.x1Km) - num(c.x0Km) > 1e-6);
  est.sort((p, q) => Math.abs((p.x0Km + p.x1Km) / 2 - camX) - Math.abs((q.x0Km + q.x1Km) / 2 - camX) ||
    p.lane - q.lane || p.x0Km - q.x0Km);
  for (const c of est.slice(0, Math.max(0, maxBase))) {
    out.push({
      text: `base ${STRINGS.baseEstimated}`, x: (num(c.x0Km) + num(c.x1Km)) / 2,
      y: ftToDisplayKm(num(c.bottomFt, num(c.topFt))) - 0.4, z: num(c.zKm), width: 6, kind: "base",
    });
  }
  return out;
}

// ---- Cockpit frame and panel (camera space, plane at z = -1; no manufacturer shape, mark or livery) -------
export const FRAME = Object.freeze({ pillar: 0.07, topRail: 0.08, panelTop: -0.52, glareHeight: 0.07 });

// Fraction of the screen that is windshield opening, from the frame constants.
export function openingFraction(f = FRAME) {
  const w = 1 - f.pillar;
  const h = ((1 - f.topRail) - (f.panelTop + f.glareHeight)) / 2;
  return w * h;
}

export function cockpitBoxes(aspect, fovDeg = DEFAULT_FOV_DEG) {
  const h = Math.tan(rad(fovDeg) / 2);
  const w = h * clamp(num(aspect, 1.78), 0.2, 5);
  const F = FRAME;
  const yTop = h * F.panelTop;
  const dark = [0.16, 0.17, 0.2], mid = [0.28, 0.3, 0.34], edge = [0.22, 0.23, 0.27], screen = [0.05, 0.07, 0.09];
  const out = [];
  out.push({ x0: -w * 1.3, x1: w * 1.3, y0: -h * 1.3, y1: yTop, z0: -1.0, z1: -0.97, color: dark });
  out.push({ x0: -w * 1.3, x1: w * 1.3, y0: yTop, y1: yTop + h * F.glareHeight, z0: -1.0, z1: -0.8, color: mid, taper: 0.02 });
  [-0.45, 0, 0.45].forEach((cx) => {
    const bx0 = w * (cx - 0.16), bx1 = w * (cx + 0.16);
    const by0 = h * -0.96, by1 = h * -0.66;
    out.push({ x0: bx0, x1: bx1, y0: by0, y1: by1, z0: -0.97, z1: -0.95, color: edge });
    out.push({ x0: bx0 + w * 0.02, x1: bx1 - w * 0.02, y0: by0 + h * 0.03, y1: by1 - h * 0.03, z0: -0.95, z1: -0.94, color: screen });
  });
  out.push({ x0: -w * 1.3, x1: -w * (1 - F.pillar), y0: -h * 1.3, y1: h * 1.3, z0: -1.0, z1: -0.9, color: edge, taper: 0.1 });
  out.push({ x0: w * (1 - F.pillar), x1: w * 1.3, y0: -h * 1.3, y1: h * 1.3, z0: -1.0, z1: -0.9, color: edge, taper: 0.1 });
  out.push({ x0: -w * 1.3, x1: w * 1.3, y0: h * (1 - F.topRail), y1: h * 1.3, z0: -1.0, z1: -0.9, color: dark });
  return out;
}

// ---- Camera ---------------------------------------------------------------------------------------------
// Vertical field of view for a screen aspect: the base value, widened on narrow screens so the lanes stay in view.
export function fovForAspect(aspect, baseDeg = DEFAULT_FOV_DEG) {
  const a = clamp(num(aspect, 1.78), 0.2, 5);
  const need = 2 * Math.atan(Math.tan(rad(MIN_HFOV_DEG) / 2) / a) * (180 / Math.PI);
  return Math.min(Math.max(num(baseDeg, DEFAULT_FOV_DEG), need), MAX_VFOV_DEG);
}
export const hfovDeg = (vfov, aspect) => 2 * Math.atan(Math.tan(rad(vfov) / 2) * aspect) * (180 / Math.PI);
// Bearing (deg) from the track of a point `lateralKm` to the side and `forwardKm` ahead.
export const bearingDeg = (lateralKm, forwardKm) => (Math.atan2(lateralKm, forwardKm) * 180) / Math.PI;

// Euler angles (radians, order YXZ) for a camera that looks along +x with z to the right.
export function cameraEuler(cam) {
  const c = cam || {};
  return { x: rad(num(c.pitchDeg)), y: -Math.PI / 2 - rad(num(c.yawDeg)), z: -rad(num(c.rollDeg)) };
}
// Airframe shake (task 16.2, R18.2): small deterministic jitter in degrees, a function of the frame time only.
// amplitudeDeg is scene.effects.shake (shakeDeg); 0 under reduced motion; never above SHAKE_MAX_DEG.
// Display only: added to the camera in the renderer, never to the scene or the engine state.
export function shakeOffsetDeg(amplitudeDeg, nowMs, reducedMotion) {
  const a = Math.min(Math.max(num(amplitudeDeg), 0), SHAKE_MAX_DEG);
  const t = num(nowMs) / 1000;
  if (reducedMotion || !(a > 0)) return { pitchDeg: 0, yawDeg: 0, rollDeg: 0 };
  return {
    pitchDeg: a * Math.sin(2 * Math.PI * 17 * t),
    yawDeg: a * 0.5 * Math.sin(2 * Math.PI * 11 * t + 1.3),
    rollDeg: a * Math.sin(2 * Math.PI * 7 * t + 0.6),
  };
}
// Unit look direction in world axes for the same angles (x along track, z right); used to test cameraEuler.
export function lookDirection(cam) {
  const c = cam || {};
  const yaw = rad(num(c.yawDeg)), pitch = rad(num(c.pitchDeg));
  return [Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw)];
}

// ---- Draw plan with the triangle budget (design 14.9, MAX_TRIANGLES) -----------------------------------------
// Drop order when the budget binds: Not assessed bands, Possible bands, cloud volumes, Observed bands (last),
// farthest from the camera first inside one group. With the default caps (160 + 240 boxes) nothing is dropped.
const RANK = { [LEVEL_OBSERVED]: 1, cloud: 2, [LEVEL_POSSIBLE]: 3, [LEVEL_NOT_ASSESSED]: 4 };

export function buildDrawPlan(scene, opts = {}) {
  const max = num(opts.maxTriangles, MAX_TRIANGLES);
  const camX = num(scene && scene.camera && scene.camera.pos && scene.camera.pos[0]);
  const clouds = cloudBoxes(scene);
  const evidence = evidenceBoxes(scene);
  const guides = guideBoxes(scene, opts.viewKm);
  const airports = airportBoxes(scene);
  const labels = pickLabels(scene);
  const frame = cockpitBoxes(num(opts.aspect, 1.78), opts.fovDeg);
  const fixed = (guides.length + airports.length + frame.length) * BOX_TRIANGLES +
    SKY_TRIANGLES + GROUND_TRIANGLES + labels.length * LABEL_TRIANGLES;

  const items = [
    ...clouds.map((box) => ({ box, kind: "cloud", rank: RANK.cloud })),
    ...evidence.map((box) => ({ box, kind: "evidence", rank: RANK[box.level] })),
  ].map((it) => ({ ...it, dist: Math.abs((it.box.x0 + it.box.x1) / 2 - camX) }));
  const order = items.slice().sort((p, q) => q.rank - p.rank || q.dist - p.dist);
  let total = fixed + items.length * BOX_TRIANGLES;
  const drop = new Set();
  const dropped = { cloud: 0, observed: 0, possible: 0, notAssessed: 0 };
  for (const it of order) {
    if (total <= max) break;
    drop.add(it);
    total -= BOX_TRIANGLES;
    if (it.kind === "cloud") dropped.cloud += 1;
    else dropped[EVIDENCE_STYLE[it.box.level].name] += 1;
  }
  const keep = items.filter((it) => !drop.has(it));
  const byLevel = (lv) => keep.filter((it) => it.kind === "evidence" && it.box.level === lv).map((it) => it.box);
  return {
    clouds: keep.filter((it) => it.kind === "cloud").map((it) => it.box),
    observed: byLevel(LEVEL_OBSERVED),
    possible: byLevel(LEVEL_POSSIBLE),
    notAssessed: byLevel(LEVEL_NOT_ASSESSED),
    guides, airports, labels, frame,
    triangles: total, fixedTriangles: fixed, dropped,
  };
}

// Hash of everything that decides the merged geometry. The renderer rebuilds buffers only when it changes.
export function geometryKey(scene) {
  let h = 2166136261 >>> 0;
  const mix = (v) => {
    h = (h ^ (Math.round(num(v) * 1000) | 0)) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  };
  const s = scene || {};
  const lanes = s.lanes || [], clouds = s.clouds || [], ev = s.evidence || [], ap = s.airports || [];
  mix(lanes.length); mix(clouds.length); mix(ev.length); mix(ap.length);
  mix(num(s.ground && s.ground.y));
  for (const l of lanes) { mix(l.zKm); mix(l.isCurrent ? 1 : 0); mix(l.isTarget ? 2 : 0); }
  for (const c of clouds) { mix(c.x0Km); mix(c.x1Km); mix(c.zKm); mix(c.halfWidthKm); mix(c.topFt); mix(c.bottomFt); mix(c.baseEstimated ? 1 : 0); }
  for (const b of ev) { mix(b.x0Km); mix(b.x1Km); mix(b.zKm); mix(b.halfWidthKm); mix(b.loFt); mix(b.hiFt); mix(levelIndexOf(b)); }
  for (const a of ap) { mix(a.xKm); mix(a.zKm); }
  return h.toString(16);
}
