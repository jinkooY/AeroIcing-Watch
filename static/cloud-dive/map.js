// Cloud Dive map view (task 11.3, design sections 3.5 and 9.1, requirements R13).
// DOM-free ES module: projection helpers, evidence cells and drawing functions that take a 2D context.
//
// Projection "equirect-local-v1" (must match tools/export_map_images.py):
//   x = (lon - lon0) * cos(lat0) * 111.32 km,  y = (lat - lat0) * 110.57 km
//   pixel = ((x - xMinKm) / pxKm, (yMaxKm - y) / pxKm)
//
// view = { caseData, engineCase, state, images, basemap, followKm, imageKind, frac, prev, track, nAhead }
//   images     { ir, phase } drawable images (or missing)
//   basemap    parsed cases/basemap.json: { coast: [[[lat, lon], ...]], states: [...] } (or missing)
//   followKm   width of the follow view in km (default 200)
//   imageKind  "ir" (default) or "phase"
//   prev       { lane, step } previous position and frac in [0,1]: display-only smooth motion
//   track      [{ lane, step }, ...] flown cells; without it the current lane from the start is drawn
// The map shows evidence only: no cost preview and no recommended choice (R6.5).

import * as engine from "./engine.js";
import { FILLS, fillSpec, latLon, levelNames } from "./render.js";

export const PROJECTION_ID = "equirect-local-v1";
const KM_PER_DEG_LON_EQ = 111.32;
const KM_PER_DEG_LAT = 110.57;
const PX_KM = 2;
const PAD_KM = 100;
const ORANGE = "#ffb347";
const FG = "#e8edf3";
const MUTED = "#aab5c3";
const GRID = "#3a4757";
const INSET_FRAC = 0.28;
const INSET_MARGIN = 6;
export const NO_IMAGE_TEXT = "Satellite image not available";

// ------------------------------------------------------------------------------------------
// Projection helpers
// ------------------------------------------------------------------------------------------

const cosLat0 = (map) => Math.cos((map.lat0 * Math.PI) / 180);

// [x km, y km] east and north of (lat0, lon0).
export function mapToKm(map, lat, lon) {
  return [(lon - map.lon0) * cosLat0(map) * KM_PER_DEG_LON_EQ, (lat - map.lat0) * KM_PER_DEG_LAT];
}

export function mapFromKm(map, xKm, yKm) {
  return [map.lat0 + yKm / KM_PER_DEG_LAT, map.lon0 + xKm / (cosLat0(map) * KM_PER_DEG_LON_EQ)];
}

// [xPx, yPx] in the map image.
export function mapProject(map, lat, lon) {
  const [x, y] = mapToKm(map, lat, lon);
  return [(x - map.xMinKm) / map.pxKm, (map.yMaxKm - y) / map.pxKm];
}

// [lat, lon] of image pixel (xPx, yPx).
export function mapUnproject(map, xPx, yPx) {
  return mapFromKm(map, map.xMinKm + xPx * map.pxKm, map.yMaxKm - yPx * map.pxKm);
}

// Same rule as tools/export_map_images.make_grid, for a case file without a `map` field
// (synthetic extent: lanes are still drawn when the image export has not run). Null without positions.
export function syntheticMap(file, c) {
  const pts = [];
  for (let l = 0; l < c.nLanes; l++) {
    for (let s = 0; s <= c.nSteps; s++) {
      const p = latLon(file, c, l, s);
      if (p) pts.push(p);
    }
  }
  if (!pts.length) return null;
  const lats = pts.map((p) => p[0]);
  const lons = pts.map((p) => p[1]);
  const lat0 = Math.round(((Math.min(...lats) + Math.max(...lats)) / 2) * 1e4) / 1e4;
  const lon0 = Math.round(((Math.min(...lons) + Math.max(...lons)) / 2) * 1e4) / 1e4;
  const base = { lat0, lon0 };
  const kms = pts.map((p) => mapToKm(base, p[0], p[1]));
  const xs = kms.map((k) => k[0]);
  const ys = kms.map((k) => k[1]);
  const xMin = Math.floor((Math.min(...xs) - PAD_KM) / PX_KM) * PX_KM;
  const xMax = Math.ceil((Math.max(...xs) + PAD_KM) / PX_KM) * PX_KM;
  const yMin = Math.floor((Math.min(...ys) - PAD_KM) / PX_KM) * PX_KM;
  const yMax = Math.ceil((Math.max(...ys) + PAD_KM) / PX_KM) * PX_KM;
  return {
    projection: PROJECTION_ID, lat0, lon0, xMinKm: xMin, yMaxKm: yMax, pxKm: PX_KM,
    width: Math.round((xMax - xMin) / PX_KM), height: Math.round((yMax - yMin) / PX_KM),
  };
}

// The case's own map field when present and in the known projection, else the synthetic extent.
export function resolveMap(file, c) {
  const m = file && file.map;
  if (m && m.projection === PROJECTION_ID && [m.lat0, m.lon0, m.xMinKm, m.yMaxKm, m.pxKm].every(Number.isFinite)) return m;
  return syntheticMap(file, c);
}

// ------------------------------------------------------------------------------------------
// Evidence cells (the same levels as the side view, engine.levelAt at the current altitude)
// ------------------------------------------------------------------------------------------

// [{lane, step, level}] for every lane and the cells state.step .. state.step + nAhead - 1.
export function mapEvidenceCells(caseData, c, state, nAhead) {
  const out = [];
  const last = Math.min(c.nSteps, state.step + Math.max(0, nAhead));
  for (let s = state.step; s < last; s++) {
    for (let lane = 0; lane < c.nLanes; lane++) {
      out.push({ lane, step: s, level: engine.levelAt(c, lane, s, state.alt) });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------
// Geometry helpers
// ------------------------------------------------------------------------------------------

function lanePointKm(map, file, c, lane, s) {
  const p = latLon(file, c, lane, Math.min(Math.max(s, 0), c.nSteps));
  return p ? mapToKm(map, p[0], p[1]) : null;
}

// Aircraft position in km and heading (radians, 0 = east, counter-clockwise) with display interpolation.
function aircraftKm(map, file, c, view) {
  const { state } = view;
  const cur = lanePointKm(map, file, c, state.lane, state.step);
  if (!cur) return null;
  let pos = cur;
  const prev = view.prev;
  const frac = Math.min(Math.max(Number(view.frac) || 0, 0), 1);
  if (prev && frac < 1) {
    const before = lanePointKm(map, file, c, prev.lane, prev.step);
    if (before) pos = [before[0] + (cur[0] - before[0]) * frac, before[1] + (cur[1] - before[1]) * frac];
  }
  return { pos, heading: laneHeading(map, file, c, state.lane, state.step) ?? 0 };
}

// Heading (radians, 0 = east, counter-clockwise, north up) along `lane` toward increasing step: the bearing
// from step s to s+1, with s clamped to the last segment (R13.2). Null without positions.
export function laneHeading(map, file, c, lane, step) {
  const s = Math.min(Math.max(step, 0), c.nSteps - 1);
  const a = lanePointKm(map, file, c, lane, s);
  const b = lanePointKm(map, file, c, lane, s + 1);
  return a && b ? Math.atan2(b[1] - a[1], b[0] - a[0]) : null;
}

// Outline of the aircraft icon as screen points, nose first. `heading` follows laneHeading (counter-clockwise
// from east); screen y points down. A swept-wing silhouette so the nose is unmistakable.
const PLANE = [[1, 0], [0.25, 0.17], [-0.35, 1.0], [-0.55, 0.9], [-0.3, 0.15], [-0.75, 0.12], [-0.95, 0.5], [-1.05, 0.42], [-0.95, 0]];
export function aircraftPolygon(x, y, heading, size) {
  const a = -heading;
  const to = (f, s) => [x + (Math.cos(a) * f - Math.sin(a) * s) * size, y + (Math.sin(a) * f + Math.cos(a) * s) * size];
  const right = PLANE.map(([f, s]) => to(f, s));
  const left = PLANE.slice(1, -1).reverse().map(([f, s]) => to(f, -s));
  return [...right, ...left];
}

// Left edge for a label of `width` that wants to start at `x`, kept inside [minX, maxX] (overview inset labels).
export function clampLabelX(x, width, minX, maxX) {
  return Math.max(minX, Math.min(x, maxX - width));
}

// Tile that marks the area with no satellite data: hatch plus text, so it is not read as clear sky or as data.
export const OUTSIDE_TEXT = "Outside satellite image";

// Where to draw the "Outside satellite image" text once: the centre of the largest strip of `box` that the
// image rectangle `img` ({x0,y0,x1,y1}, any order, or null for no image) leaves uncovered. The strip must fit
// the text (`textW` plus padding) and `minH`; otherwise null (no label, hatch only). DOM-free.
export function outsideLabelSpot(box, img, textW, minH = 22, pad = 8) {
  const bx1 = box.x + box.w;
  const by1 = box.y + box.h;
  let strips;
  if (!img) {
    strips = [{ x: box.x, y: box.y, w: box.w, h: box.h }];
  } else {
    const ix0 = Math.min(img.x0, img.x1), ix1 = Math.max(img.x0, img.x1);
    const iy0 = Math.min(img.y0, img.y1), iy1 = Math.max(img.y0, img.y1);
    const cl = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
    const cx0 = cl(ix0, box.x, bx1), cx1 = cl(ix1, box.x, bx1);
    const cy0 = cl(iy0, box.y, by1), cy1 = cl(iy1, box.y, by1);
    strips = [
      { x: box.x, y: box.y, w: cx0 - box.x, h: box.h }, // left
      { x: cx1, y: box.y, w: bx1 - cx1, h: box.h }, // right
      { x: box.x, y: box.y, w: box.w, h: cy0 - box.y }, // above
      { x: box.x, y: cy1, w: box.w, h: by1 - cy1 }, // below
    ];
  }
  let best = null;
  for (const s of strips) {
    if (!(s.w >= textW + 2 * pad) || !(s.h >= minH) || !Number.isFinite(s.w + s.h)) continue;
    if (!best || s.w * s.h > best.w * best.h) best = s;
  }
  return best ? { x: best.x + best.w / 2, y: best.y + best.h / 2 } : null;
}

function drawOutsideLabel(ctx, box, image, kmToScreen, map, small) {
  if (small || typeof ctx.measureText !== "function") return;
  ctx.font = "11px system-ui, sans-serif";
  const tw = ctx.measureText(OUTSIDE_TEXT).width;
  let img = null;
  if (image) {
    const [x0, y0] = kmToScreen(map.xMinKm, map.yMaxKm);
    const [x1, y1] = kmToScreen(map.xMinKm + map.width * map.pxKm, map.yMaxKm - map.height * map.pxKm);
    img = { x0, y0, x1, y1 };
  }
  const spot = outsideLabelSpot(box, img, tw);
  if (spot) drawText(ctx, OUTSIDE_TEXT, spot.x, spot.y + 4, "center", "11px system-ui, sans-serif", "#c3ccd8");
}

const outsideCache = new WeakMap();
function fillOutside(ctx, x, y, w, h) {
  ctx.fillStyle = "#10161d";
  ctx.fillRect(x, y, w, h);
  if (typeof document === "undefined") return;
  let pattern = outsideCache.get(ctx);
  if (pattern === undefined) {
    const tile = document.createElement("canvas");
    tile.width = 150;
    tile.height = 38;
    const g = tile.getContext("2d");
    pattern = null;
    if (g) {
      g.strokeStyle = "rgba(170,181,195,0.16)";
      g.lineWidth = 1;
      g.beginPath();
      for (let i = -38; i < 150; i += 10) { g.moveTo(i, 38); g.lineTo(i + 38, 0); }
      g.stroke();
      pattern = ctx.createPattern(tile, "repeat");
    }
    outsideCache.set(ctx, pattern);
  }
  if (pattern) {
    ctx.fillStyle = pattern;
    ctx.fillRect(x, y, w, h);
  }
}

function drawBasemap(ctx, map, basemap, kmToScreen) {
  if (!basemap) return false;
  ctx.lineJoin = "round";
  for (const [key, colour, width] of [["states", "rgba(210,220,232,0.45)", 0.8], ["coast", "rgba(240,244,248,0.85)", 1.2]]) {
    const lines = basemap[key];
    if (!Array.isArray(lines)) continue;
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    for (const line of lines) {
      ctx.beginPath();
      let pen = false;
      for (const p of line) {
        if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) { pen = false; continue; }
        const [xk, yk] = mapToKm(map, p[0], p[1]);
        const [x, y] = kmToScreen(xk, yk);
        if (pen) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        pen = true;
      }
      ctx.stroke();
    }
  }
  return true;
}

function drawImage(ctx, map, image, kmToScreen) {
  if (!image) return false;
  const [x0, y0] = kmToScreen(map.xMinKm, map.yMaxKm);
  const [x1, y1] = kmToScreen(map.xMinKm + map.width * map.pxKm, map.yMaxKm - map.height * map.pxKm);
  ctx.imageSmoothingEnabled = false; // one satellite pixel stays one block (R13.3)
  ctx.drawImage(image, x0, y0, x1 - x0, y1 - y0);
  return true;
}

function drawAircraft(ctx, x, y, heading, size) {
  const pts = aircraftPolygon(x, y, heading, size);
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.closePath();
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.fill();
  ctx.stroke();
}

function laneHalfWidthKm(c) {
  const d = c.lanesKm.length > 1 ? Math.abs(c.lanesKm[1] - c.lanesKm[0]) : 15;
  return d / 2;
}

// One evidence patch: the lane-wide quad of cell `step` on `lane`, filled like the side view.
function drawPatch(ctx, map, file, c, cell, kmToScreen, halfKm) {
  const a = lanePointKm(map, file, c, cell.lane, cell.step);
  const b = lanePointKm(map, file, c, cell.lane, cell.step + 1);
  if (!a || !b) return;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const nx = (-(b[1] - a[1]) / len) * halfKm;
  const ny = ((b[0] - a[0]) / len) * halfKm;
  const quad = [[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]]
    .map((q) => kmToScreen(q[0], q[1]));
  const xs = quad.map((q) => q[0]);
  const ys = quad.map((q) => q[1]);
  const spec = cell.level === engine.OBSERVED ? FILLS.candidate
    : cell.level === engine.POSSIBLE ? FILLS.possible
      : cell.level === engine.NOT_ASSESSED ? FILLS.curtain : null;
  if (!spec) return;
  const path = () => {
    ctx.beginPath();
    quad.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
    ctx.closePath();
  };
  ctx.save();
  path();
  ctx.clip();
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  fillSpec(ctx, spec, x, y, Math.max(...xs) - x, Math.max(...ys) - y);
  ctx.restore();
  if (cell.level === engine.OBSERVED) {
    path();
    ctx.strokeStyle = ORANGE;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function drawText(ctx, text, x, y, align = "left", font = "11px system-ui, sans-serif", colour = MUTED) {
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "rgba(8,12,16,0.7)"; // thin dark halo keeps the text readable over the satellite image
  ctx.strokeText(text, x, y);
  ctx.fillStyle = colour;
  ctx.fillText(text, x, y);
}

function imageFor(view) {
  const kind = view.imageKind === "phase" ? "phase" : "ir";
  return (view.images && view.images[kind]) || null;
}

// ------------------------------------------------------------------------------------------
// Follow view
// ------------------------------------------------------------------------------------------

export function drawFollowView(ctx, view, box) {
  const { caseData: file, engineCase: c, state } = view;
  const { x, y, w, h } = box;
  ctx.save();
  ctx.fillStyle = "#10161d";
  ctx.fillRect(x, y, w, h);
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  const map = c && state ? resolveMap(file, c) : null;
  const air = map ? aircraftKm(map, file, c, view) : null;
  if (!map || !air) {
    ctx.restore();
    drawText(ctx, "Map positions not available", x + 8, y + h / 2, "left", "12px system-ui, sans-serif");
    return;
  }
  const followKm = Number(view.followKm) > 0 ? Number(view.followKm) : 200;
  const scale = w / followKm; // px per km, north up
  const kmToScreen = (xk, yk) => [x + w / 2 + (xk - air.pos[0]) * scale, y + h / 2 - (yk - air.pos[1]) * scale];

  fillOutside(ctx, x, y, w, h); // shows wherever the image is absent or transparent (outside the scan sector)
  const hasImage = drawImage(ctx, map, imageFor(view), kmToScreen);
  const hasBasemap = drawBasemap(ctx, map, view.basemap, kmToScreen);
  drawOutsideLabel(ctx, box, imageFor(view), kmToScreen, map, false);

  // Evidence patches ahead at the current altitude.
  const nAhead = Number(view.nAhead) > 0 ? view.nAhead : Math.ceil((followKm * 0.75) / c.stepKm);
  const halfKm = laneHalfWidthKm(c);
  for (const cell of mapEvidenceCells(file, c, state, nAhead)) drawPatch(ctx, map, file, c, cell, kmToScreen, halfKm);

  // Lanes at true spacing; the side-view lane is the heavy one. Every lane gets a dark outline so it stays
  // visible over the bright IR image (R13.2, R13.6).
  const lanePath = (l) => {
    ctx.beginPath();
    let pen = false;
    for (let s = 0; s <= c.nSteps; s++) {
      const k = lanePointKm(map, file, c, l, s);
      if (!k) { pen = false; continue; }
      const [sx, sy] = kmToScreen(k[0], k[1]);
      if (pen) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy);
      pen = true;
    }
  };
  ctx.lineJoin = "round";
  for (const pass of ["outline", "line"]) {
    for (let l = 0; l < c.nLanes; l++) {
      const selected = l === state.lane;
      if (pass === "outline") {
        ctx.strokeStyle = "rgba(8,12,16,0.8)";
        ctx.lineWidth = selected ? 6 : 4;
        ctx.setLineDash([]);
      } else {
        ctx.strokeStyle = selected ? "#ffffff" : "#e8edf3";
        ctx.lineWidth = selected ? 3 : 1.6;
        ctx.setLineDash(selected ? [] : [7, 6]);
      }
      lanePath(l);
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);

  // Flown track.
  const track = Array.isArray(view.track) && view.track.length
    ? view.track
    : Array.from({ length: state.step + 1 }, (_, s) => ({ lane: state.lane, step: s }));
  ctx.strokeStyle = ORANGE;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  track.forEach((t, i) => {
    const k = lanePointKm(map, file, c, t.lane, t.step);
    if (!k) return;
    const [sx, sy] = kmToScreen(k[0], k[1]);
    if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
  });
  const [ax, ay] = kmToScreen(air.pos[0], air.pos[1]);
  ctx.lineTo(ax, ay);
  ctx.stroke();

  drawAircraft(ctx, ax, ay, air.heading, 11);
  ctx.restore();

  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
  drawText(ctx, "N up", x + w - 6, y + 14, "right");
  {
    // Caption on a solid plate (no stroked halo, which smeared the small text over the grey image).
    const cap = `Side view: lane ${state.lane + 1} (heavy line)`;
    ctx.font = "11px system-ui, sans-serif";
    const cw = ctx.measureText(cap).width;
    ctx.fillStyle = "rgba(8,12,16,0.82)";
    ctx.fillRect(x + 4, y + h - 21, cw + 10, 17);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = FG;
    ctx.fillText(cap, x + 9, y + h - 8);
  }
  if (!hasImage || !hasBasemap) {
    const msg = !hasImage ? NO_IMAGE_TEXT : "Basemap not available";
    drawText(ctx, msg, x + w - 6, y + h - 6, "right", "bold 12px system-ui, sans-serif", FG);
  }
  if (view.overviewInset !== false) drawOverview(ctx, view, overviewInsetBox(box));
}

// Top-left inset of the follow view: about 28 percent of its width, 2:1 (design 9.1).
export function overviewInsetBox(box) {
  const w = Math.max(1, Math.round(box.w * INSET_FRAC));
  return { x: box.x + INSET_MARGIN, y: box.y + INSET_MARGIN, w, h: Math.max(1, Math.round(w / 2)) };
}

// ------------------------------------------------------------------------------------------
// Overview
// ------------------------------------------------------------------------------------------

export function drawOverview(ctx, view, box) {
  const { caseData: file, engineCase: c, state } = view;
  const { x, y, w, h } = box;
  ctx.save();
  ctx.fillStyle = "#10161d";
  ctx.fillRect(x, y, w, h);
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  const map = c && state ? resolveMap(file, c) : null;
  const air = map ? aircraftKm(map, file, c, view) : null;
  if (!map || !air) {
    ctx.restore();
    drawText(ctx, "Map positions not available", x + 8, y + h / 2, "left", "12px system-ui, sans-serif");
    return;
  }
  // Fit the whole extent of the lane points (plus a margin) into the box.
  const centre = c.lanesKm.indexOf(0) >= 0 ? c.lanesKm.indexOf(0) : 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let l = 0; l < c.nLanes; l++) {
    for (let s = 0; s <= c.nSteps; s++) {
      const k = lanePointKm(map, file, c, l, s);
      if (!k) continue;
      minX = Math.min(minX, k[0]); maxX = Math.max(maxX, k[0]);
      minY = Math.min(minY, k[1]); maxY = Math.max(maxY, k[1]);
    }
  }
  const margin = 40;
  const scale = Math.min(w / (maxX - minX + 2 * margin), h / (maxY - minY + 2 * margin));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const kmToScreen = (xk, yk) => [x + w / 2 + (xk - cx) * scale, y + h / 2 - (yk - cy) * scale];

  fillOutside(ctx, x, y, w, h);
  const hasImage = drawImage(ctx, map, imageFor(view), kmToScreen);
  const hasBasemap = drawBasemap(ctx, map, view.basemap, kmToScreen);
  drawOutsideLabel(ctx, box, imageFor(view), kmToScreen, map, true); // inset: hatch only, no text

  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let s = 0; s <= c.nSteps; s++) {
    const k = lanePointKm(map, file, c, centre, s);
    if (!k) continue;
    const [sx, sy] = kmToScreen(k[0], k[1]);
    if (s === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
  }
  ctx.stroke();

  // Follow-view box.
  const followKm = Number(view.followKm) > 0 ? Number(view.followKm) : 200;
  const fw = followKm * scale;
  const [ax, ay] = kmToScreen(air.pos[0], air.pos[1]);
  ctx.strokeStyle = ORANGE;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(ax - fw / 2, ay - fw / 4, fw, fw / 2);

  ctx.beginPath();
  ctx.arc(ax, ay, 4, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 2;
  ctx.fill();
  ctx.stroke();

  // Airports.
  const route = (file && file.route) || {};
  const first = lanePointKm(map, file, c, centre, 0);
  const last = lanePointKm(map, file, c, centre, c.nSteps);
  for (const [k, name, align] of [[first, route.from, "left"], [last, route.to, "right"]]) {
    if (!k) continue;
    const [sx, sy] = kmToScreen(k[0], k[1]);
    ctx.fillStyle = FG;
    ctx.fillRect(sx - 3, sy - 3, 6, 6);
    if (name) {
      // Label stays inside the inset: shifted toward the inside when it would cross an edge.
      ctx.font = "bold 11px system-ui, sans-serif";
      const tw = ctx.measureText(name).width;
      const lx = clampLabelX(align === "left" ? sx + 6 : sx - 6 - tw, tw, x + 3, x + w - 3);
      const ly = Math.min(Math.max(sy - 7, y + 12), y + h - 4);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.lineJoin = "round";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(8,12,16,0.9)";
      ctx.strokeText(name, lx, ly);
      ctx.fillStyle = FG;
      ctx.fillText(name, lx, ly);
    }
  }
  ctx.restore();

  ctx.strokeStyle = "#8a97a8"; // visible border so the inset stays readable over the follow image
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, w, h);
  if (!hasImage) drawText(ctx, NO_IMAGE_TEXT, x + 4, y + h - 5);
  else if (!hasBasemap) drawText(ctx, "Basemap not available", x + 4, y + h - 5);
}

// Legend text for the satellite image (R13.3, R13.4). Null without a case map.
export function imageLegend(file) {
  const m = file && file.map;
  if (!m) return null;
  const sat = file.sources && file.sources.satellite && file.sources.satellite.satellite;
  return {
    title: "Satellite image for context",
    detail: `${sat || "GOES"}, ${m.product || ""}, scan ${m.scanUtc || "n/a"} UTC`,
    single: "This is the single scan of the case; the weather does not change during the flight.",
    parallax: `The image is not parallax-corrected; the lane evidence is. Largest parallax shift in this case: ${m.maxParallaxKm} km.`,
    levels: levelNames(file),
  };
}
