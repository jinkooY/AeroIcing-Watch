// Cloud Dive view helpers (task 11.4). DOM-free so Node tests can run them.
// Display only: nothing here changes the engine state or any score (R13.10).

import * as engine from "./engine.js";
import { levelNames } from "./render.js";

const NEXT_CELLS = 3;

// Position list of the flight so far, one entry per step. A new flight (step 0, an empty list or a
// step that went backwards) starts a new list. The same array is returned when nothing changed.
export function updateTrack(track, state) {
  const here = { lane: state.lane, step: state.step };
  const last = track.length ? track[track.length - 1] : null;
  if (!last || state.step < last.step) return [here];
  if (state.step === last.step) return state.step === 0 && last.lane !== here.lane ? [here] : track;
  if (state.step === 0) return [here];
  return [...track, here];
}

// Share of the way from the previous step position to the current one, in [0, 1].
// Reduced motion (or no tick time) jumps straight to the new position.
export function motionFrac(elapsedMs, tickMs, reduced) {
  if (reduced || !(tickMs > 0) || !Number.isFinite(elapsedMs)) return 1;
  return Math.min(Math.max(elapsedMs / tickMs, 0), 1);
}

// Evidence levels of the next three segments on the aircraft's lane at its altitude.
export function nextCells(caseData, c, state) {
  const names = levelNames(caseData);
  const out = [];
  for (let s = state.step; s < Math.min(c.nSteps, state.step + NEXT_CELLS); s++) {
    out.push({ step: s, level: engine.levelAt(c, state.lane, s, state.alt), name: names[engine.levelAt(c, state.lane, s, state.alt)] });
  }
  return out;
}

// Text alternative of the map view (R13.9): lane, distance, altitude and the evidence of the next
// three segments. Evidence only, no advice.
export function describeMap(caseData, c, state) {
  if (!c || !state) return "";
  const flown = Math.round(Math.min(engine.stateDistanceKm(state), c.distanceKm));
  const alt = Math.round(c.altsFt[state.alt]).toLocaleString("en-US");
  const head = `Map view. Aircraft in lane ${state.lane + 1} of ${c.nLanes}, ${flown} of ${Math.round(c.distanceKm)} km, ${alt} ft.`;
  const cells = nextCells(caseData, c, state);
  if (!cells.length) return `${head} No segments remain.`;
  const ahead = cells.map((cell, i) => `${i + 1}: ${cell.name}`).join("; ");
  return `${head} Evidence in the next ${cells.length} segment${cells.length > 1 ? "s" : ""} of ${c.stepKm} km at this altitude: ${ahead}.`;
}

// Backing-store size of a canvas whose CSS box is clientW x clientH (R13.2, design 9.2). DOM-free.
// width and height are integers >= 1 and at most MAX_CANVAS_PX; scale is the clamped device pixel
// ratio (1 to 4, 1 when invalid). cssW and cssH are the integer CSS sizes that drawing code uses.
export const MAX_CANVAS_PX = 4096;

export function computeCanvasSize(clientW, clientH, dpr) {
  const d = Number.isFinite(dpr) && dpr > 0 ? Math.min(Math.max(dpr, 1), 4) : 1;
  const cssW = Math.max(1, Math.round(Number.isFinite(clientW) ? clientW : 0));
  const cssH = Math.max(1, Math.round(Number.isFinite(clientH) ? clientH : 0));
  const width = Math.min(MAX_CANVAS_PX, Math.max(1, Math.round(cssW * d)));
  const height = Math.min(MAX_CANVAS_PX, Math.max(1, Math.round(cssH * d)));
  return { width, height, scale: d, cssW, cssH };
}

// Sizes the canvas to its CSS box times devicePixelRatio and sets a CSS-pixel transform, then calls
// onResize(cssW, cssH). Watches the box with a ResizeObserver. Returns a function that stops watching.
export function fitCanvas(canvas, onResize) {
  const apply = () => {
    const dpr = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
    const size = computeCanvasSize(canvas.clientWidth, canvas.clientHeight, dpr);
    if (canvas.width !== size.width) canvas.width = size.width;
    if (canvas.height !== size.height) canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.setTransform(size.scale, 0, 0, size.scale, 0, 0);
    if (onResize) onResize(size.cssW, size.cssH);
  };
  apply();
  if (typeof ResizeObserver !== "function") return () => {};
  const ro = new ResizeObserver(apply);
  ro.observe(canvas);
  return () => ro.disconnect();
}

// Decides where a key press goes (task 12.3, design 9.2). `openDialog` is the name of the modal dialog that
// is open ("report", "why", "sources", "legend") or null/undefined. Returns:
//   "ignore"        a modified or already handled key
//   "toggle-legend" key L with no dialog open (opens Legend) or with only Legend open (closes it)
//   "dialog"        a dialog is open: the game must not act on the key (arrows, A, Space, M, L)
//   "game"          no dialog is open: the flight controls may act on the key
export function routeKey(ev, openDialog) {
  if (!ev || ev.ctrlKey || ev.metaKey || ev.altKey || ev.defaultPrevented) return "ignore";
  const isL = ev.key === "l" || ev.key === "L";
  if (openDialog) return isL && openDialog === "legend" ? "toggle-legend" : "dialog";
  return isL ? "toggle-legend" : "game";
}

// First element of candidates that can take focus (not null, not hidden, not disabled), else null.
// Used to pick where focus returns when the opener is gone, for example the disabled Continue button
// after the flight has ended.
export function firstFocusable(candidates) {
  for (const n of candidates) {
    if (n && !n.hidden && !n.disabled) return n;
  }
  return null;
}

// Only file names inside cases/ are loaded (R13.8): letters, digits, dot, dash, underscore, .png.
export const IMAGE_NAME_RE = /^[A-Za-z0-9._-]+\.png$/;

export function imageNames(caseData) {
  const im = caseData && caseData.map && caseData.map.images;
  const out = {};
  for (const kind of ["ir", "phase"]) {
    if (im && typeof im[kind] === "string" && IMAGE_NAME_RE.test(im[kind])) out[kind] = im[kind];
  }
  return out;
}
