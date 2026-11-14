// Cloud Dive scene renderer (task 8.2, layout changed in 11.4). Draws the side view (cross-section of the
// selected lane) and a text legend into one canvas. The map view lives in map.js. Pure drawing: no state of
// its own, no network.
//
// view = { caseData, engineCase, state, message, prev, frac }
//   caseData   parsed case file (or null before a case is loaded)
//   engineCase result of engine.loadCase (or null)
//   state      engine state (or null)
//   message    text to show when there is nothing to draw (loading or error)
//   prev, frac display-only smooth motion: previous { lane, step } and the share of the way (R13.10)
//
// What is drawn (design sections 3, 4 and 9):
//   cloud body       satellite cloud top, by phase (pattern + colour); base known -> body down to base,
//                    base unknown -> only a thin cap under the top (a base is never invented)
//   dashed line      estimated cloud base (statistical estimate, Noh et al. 2017; not an observation)
//   hatched band     candidate layer between the 0 C and -20 C heights under the observed cloud top
//   orange boxes     evidence level "Observed supercooled layer at planned altitude" (cell)
//   dotted shading   evidence level "Possible (forecast only)" (ECMWF temperature and humidity screen)
//   stripes          "Unknown" curtain: Not assessed cells, and whole columns without satellite data
//   wind barbs       forecast head-wind component along the route, knots
//   now line         vertical line at the aircraft's distance, labelled "now" (R13.6)
// Every colour is paired with a pattern or a text label so the picture reads in greyscale (R10.1).
// The picture shows evidence only: no cost preview and no recommended choice (R6.5).

import * as engine from "./engine.js";

const BG = "#0c1015";
const FG = "#e8edf3";
const MUTED = "#aab5c3";
const GRID = "#3a4757";
const GRID_FAINT = "#202a35";
const ORANGE = "#ffb347";

const DEFAULT_LEVELS = [
  "Not assessed",
  "Not indicated",
  "Possible (forecast only)",
  "Observed supercooled layer at planned altitude",
];

// Fill specs: kind of tile, tile line colour, background wash.
export const FILLS = {
  liquid: { kind: "hlines", color: "#bfe3ff", bg: "rgba(70,130,180,0.55)" },
  supercooled: { kind: "rings", color: "#ffffff", bg: "rgba(25,85,170,0.75)" },
  mixed: { kind: "checker", color: "#e3d6ff", bg: "rgba(120,100,170,0.6)" },
  ice: { kind: "solid", color: "rgba(228,237,247,0.78)", bg: null },
  unknownPhase: { kind: "ex", color: "#d0d0d0", bg: "rgba(90,90,90,0.55)" },
  possible: { kind: "dots", color: "#74d4ff", bg: "rgba(30,90,140,0.28)" },
  candidate: { kind: "diag", color: ORANGE, bg: "rgba(255,179,71,0.10)" },
  curtain: { kind: "vstripes", color: "#9aa3ad", bg: "rgba(20,20,26,0.40)" },
};

// Satellite phase code -> fill (codes follow src/analysis/case_builder.py PHASE_NAMES).
const PHASE_FILL = { 1: "liquid", 2: "supercooled", 3: "mixed", 4: "ice", 5: "unknownPhase" };

export const SAT_OBSERVED = 0;
const SAT_CLEAR_SKY = 1;

const finite = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// ------------------------------------------------------------------------------------------
// Patterns
// ------------------------------------------------------------------------------------------

const patternCache = new WeakMap();

function drawTile(g, kind, color) {
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = 1.5;
  g.beginPath();
  switch (kind) {
    case "hlines":
      g.moveTo(0, 3); g.lineTo(10, 3); g.moveTo(0, 8); g.lineTo(10, 8);
      g.stroke();
      break;
    case "rings":
      g.lineWidth = 1.2;
      g.arc(5, 5, 2.6, 0, Math.PI * 2);
      g.stroke();
      break;
    case "checker":
      g.fillRect(0, 0, 5, 5); g.fillRect(5, 5, 5, 5);
      break;
    case "ex":
      g.moveTo(2, 2); g.lineTo(8, 8); g.moveTo(8, 2); g.lineTo(2, 8);
      g.stroke();
      break;
    case "dots":
      g.arc(3, 3, 1.3, 0, Math.PI * 2);
      g.fill();
      break;
    case "diag":
      g.moveTo(-1, 11); g.lineTo(11, -1); g.moveTo(-1, 5); g.lineTo(5, -1); g.moveTo(5, 11); g.lineTo(11, 5);
      g.stroke();
      break;
    case "vstripes":
      g.fillRect(0, 0, 3, 10);
      break;
    default:
      break;
  }
}

function tileSize(kind) {
  return kind === "dots" ? 6 : kind === "vstripes" ? 7 : 10;
}

function getPattern(ctx, spec) {
  if (spec.kind === "solid" || typeof document === "undefined") return null;
  let cache = patternCache.get(ctx);
  if (!cache) {
    cache = new Map();
    patternCache.set(ctx, cache);
  }
  const key = `${spec.kind}|${spec.color}`;
  if (cache.has(key)) return cache.get(key);
  const size = tileSize(spec.kind);
  const tile = document.createElement("canvas");
  tile.width = size;
  tile.height = size;
  const g = tile.getContext("2d");
  let pattern = null;
  if (g) {
    // The tile code draws on a 10 px grid; scale small tiles so one repeat fits.
    drawTile(g, spec.kind, spec.color);
    pattern = ctx.createPattern(tile, "repeat");
  }
  cache.set(key, pattern);
  return pattern;
}

export function fillSpec(ctx, spec, x, y, w, h) {
  if (w <= 0 || h <= 0) return;
  if (spec.bg) {
    ctx.fillStyle = spec.bg;
    ctx.fillRect(x, y, w, h);
  }
  if (spec.kind === "solid") {
    ctx.fillStyle = spec.color;
    ctx.fillRect(x, y, w, h);
    return;
  }
  const pattern = getPattern(ctx, spec);
  ctx.fillStyle = pattern || spec.color;
  ctx.fillRect(x, y, w, h);
}

// ------------------------------------------------------------------------------------------
// Small helpers
// ------------------------------------------------------------------------------------------

export function levelNames(caseData) {
  const l = caseData && caseData.rule && caseData.rule.levels;
  return Array.isArray(l) && l.length === 4 ? l : DEFAULT_LEVELS;
}

// Which "Not assessed" runs (pixel [x0, x1] pairs, left to right) get a text label. The long label needs
// longW + pad of width, the short "N/A" shortW + pad; narrower runs get none. A label that would come within
// `gap` px of the previous one is dropped. Returns [{ cx, label }]. DOM-free.
export function planCurtainLabels(runs, longW, shortW, pad = 12, gap = 6) {
  const out = [];
  let lastRight = -Infinity;
  for (const [x0, x1] of runs) {
    const width = x1 - x0;
    const label = width >= longW + pad ? "Not assessed" : width >= shortW + pad ? "N/A" : null;
    if (!label) continue;
    const cx = (x0 + x1) / 2;
    const half = ((label === "Not assessed" ? longW : shortW) + 10) / 2;
    if (cx - half < lastRight + gap) continue;
    out.push({ cx, label });
    lastRight = cx + half;
  }
  return out;
}

function wrapText(ctx, text, maxWidth) {
  const words = String(text).split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(test).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function niceStep(totalKm, maxTicks) {
  for (const s of [10, 20, 25, 50, 100, 200, 250, 500, 1000]) {
    if (totalKm / s <= maxTicks) return s;
  }
  return 1000;
}

export function satIndex(c, lane, s) {
  return lane * (c.nSteps + 1) + s;
}

// Value at flat index idx. Two shapes exist in case files: {shape, data} (field omitted) and a
// group object whose fields are plain arrays sharing one `shape` (satellite, isotherms).
export function column(group, field, idx) {
  if (!group) return undefined;
  const arr = field === undefined || field === null ? group : group[field];
  if (Array.isArray(arr)) return arr[idx];
  return arr && Array.isArray(arr.data) ? arr.data[idx] : undefined;
}

// Steps of one lane whose satellite state is neither observed nor clear (the "Not assessed"
// curtain). DOM-free so tests can run it. Without a satellite group no column is flagged here.
export function curtainColumns(file, c, lane) {
  const sat = file && file.satellite;
  const out = [];
  if (!sat) return out;
  for (let s = 0; s < c.nSteps; s++) {
    const st = column(sat, "state", satIndex(c, lane, s));
    if (st !== SAT_OBSERVED && st !== SAT_CLEAR_SKY) out.push(s);
  }
  return out;
}

// [lat, lon] of lane at step, for flat or nested lanesLatLon data. Null when missing.
export function latLon(file, c, lane, s) {
  const ll = file && file.lanesLatLon;
  if (!ll || !Array.isArray(ll.data)) return null;
  const first = ll.data[0];
  let pair;
  if (Array.isArray(first) && Array.isArray(first[0])) pair = ll.data[lane] && ll.data[lane][s];
  else pair = ll.data[satIndex(c, lane, s)];
  if (!Array.isArray(pair) || finite(pair[0]) === null || finite(pair[1]) === null) return null;
  return pair;
}

// ------------------------------------------------------------------------------------------
// Wind barb: staff points to where the wind comes from along the route (right = head wind).
// ------------------------------------------------------------------------------------------

function barbPath(ctx, x, y, kt) {
  const speed = Math.abs(kt);
  ctx.beginPath();
  if (speed < 2.5) {
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    return;
  }
  const dir = kt >= 0 ? 1 : -1;
  const len = 20;
  const tip = x + dir * len;
  ctx.moveTo(x, y);
  ctx.lineTo(tip, y);
  let rest = Math.round(speed / 5) * 5;
  let px = tip;
  while (rest >= 50) {
    ctx.moveTo(px, y); ctx.lineTo(px - dir * 5, y - 8); ctx.lineTo(px - dir * 5, y);
    px -= dir * 6;
    rest -= 50;
  }
  while (rest >= 10) {
    ctx.moveTo(px, y); ctx.lineTo(px - dir * 3, y - 8);
    px -= dir * 4;
    rest -= 10;
  }
  if (rest >= 5) {
    if (px === tip) px -= dir * 4;
    ctx.moveTo(px, y); ctx.lineTo(px - dir * 2, y - 4);
  }
}

function drawBarb(ctx, x, y, kt) {
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(12,16,21,0.9)";
  ctx.lineWidth = 3.4;
  barbPath(ctx, x, y, kt);
  ctx.stroke();
  ctx.strokeStyle = "#f3f6fa";
  ctx.lineWidth = 1.2;
  barbPath(ctx, x, y, kt);
  ctx.stroke();
}

// ------------------------------------------------------------------------------------------
// Side view (cross-section)
// ------------------------------------------------------------------------------------------

function drawCrossSection(ctx, view, box) {
  const { caseData: file, engineCase: c, state } = view;
  const { x: px, y: py, w: pw, h: ph } = box;
  const lane = state.lane;
  const alts = c.altsFt;
  const half = alts.length > 1 ? (alts[1] - alts[0]) / 2 : 500;
  const yMin = alts[0] - half;
  const yMax = alts[alts.length - 1] + half;
  const xOf = (km) => px + (km / c.distanceKm) * pw;
  const yOf = (ft) => py + ph - ((ft - yMin) / (yMax - yMin)) * ph;
  const sat = file && file.satellite;
  const iso = file && file.isotherms;
  const levels = levelNames(file);

  // Frame and altitude grid.
  ctx.fillStyle = "#10161d";
  ctx.fillRect(px, py, pw, ph);
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const labelEvery = alts.length > 12 ? 2 : 1;
  alts.forEach((a, i) => {
    ctx.strokeStyle = GRID_FAINT;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, yOf(a));
    ctx.lineTo(px + pw, yOf(a));
    ctx.stroke();
    if (i % labelEvery === 0) {
      ctx.fillStyle = MUTED;
      ctx.fillText(a.toLocaleString("en-US"), px - 6, yOf(a));
    }
  });
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const tickKm = niceStep(c.distanceKm, 9);
  for (let km = 0; km <= c.distanceKm + 1e-6; km += tickKm) {
    ctx.strokeStyle = GRID;
    ctx.beginPath();
    ctx.moveTo(xOf(km), py + ph);
    ctx.lineTo(xOf(km), py + ph + 4);
    ctx.stroke();
    ctx.fillStyle = MUTED;
    ctx.fillText(String(km), xOf(km), py + ph + 17);
  }
  ctx.fillText("Distance along route (km)", px + pw / 2, py + ph + 34);
  ctx.save();
  ctx.translate(14, py + ph / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("Altitude (ft MSL)", 0, 0);
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.rect(px, py, pw, ph);
  ctx.clip();

  const cellX = (s) => {
    const x0 = xOf(s * c.stepKm);
    const x1 = xOf(Math.min((s + 1) * c.stepKm, c.distanceKm));
    return [x0, Math.max(x1 - x0, 0.5)];
  };

  // 1. Forecast-environment shading: Possible (forecast only) cells.
  for (let s = 0; s < c.nSteps; s++) {
    const [x0, w] = cellX(s);
    for (let a = 0; a < c.nAlts; a++) {
      if (engine.levelAt(c, lane, s, a) === engine.POSSIBLE) {
        fillSpec(ctx, FILLS.possible, x0, yOf(alts[a] + half), w, yOf(alts[a] - half) - yOf(alts[a] + half));
      }
    }
  }

  // 2. Cloud body by phase (satellite cloud top). Base unknown: thin cap only.
  const CAP_FT = 350;
  for (let s = 0; s < c.nSteps && sat; s++) {
    const i = satIndex(c, lane, s);
    if (column(sat, "state", i) !== SAT_OBSERVED) continue;
    const top = finite(column(sat, "topFt", i));
    if (top === null) continue;
    const base = finite(column(sat, "baseFt", i));
    const code = column(sat, "phaseCode", i);
    const spec = FILLS[PHASE_FILL[code]];
    if (!spec) continue;
    const [x0, w] = cellX(s);
    const lo = base !== null ? Math.max(Math.min(base, top), yMin) : top - CAP_FT;
    fillSpec(ctx, spec, x0, yOf(top), w, yOf(lo) - yOf(top));
  }

  // 3. Candidate band: base known, between the 0 C and -20 C heights, under a supercooled top.
  for (let s = 0; s < c.nSteps && sat && iso; s++) {
    const i = satIndex(c, lane, s);
    if (column(sat, "state", i) !== SAT_OBSERVED || !column(sat, "supercooled", i)) continue;
    const top = finite(column(sat, "topFt", i));
    const base = finite(column(sat, "baseFt", i));
    const zero = finite(column(iso, "zeroCFt", i));
    const m20 = finite(column(iso, "minus20CFt", i));
    if (top === null || base === null || zero === null || m20 === null) continue;
    const lo = Math.max(base, zero);
    const hi = Math.min(top, m20);
    if (hi <= lo) continue;
    const [x0, w] = cellX(s);
    fillSpec(ctx, FILLS.candidate, x0, yOf(hi), w, yOf(lo) - yOf(hi));
  }

  // 4. Isotherm heights (forecast model), thin dotted lines.
  if (iso) {
    for (const [name, label] of [["zeroCFt", "0 C"], ["minus20CFt", "-20 C"]]) {
      ctx.strokeStyle = "rgba(190,200,212,0.75)";
      ctx.lineWidth = 1;
      ctx.setLineDash([1, 3]);
      ctx.beginPath();
      let pen = false;
      for (let s = 0; s <= c.nSteps; s++) {
        const v = finite(column(iso, name, satIndex(c, lane, s)));
        if (v === null) { pen = false; continue; }
        const x = xOf(Math.min(s * c.stepKm, c.distanceKm));
        if (pen) ctx.lineTo(x, yOf(v)); else ctx.moveTo(x, yOf(v));
        pen = true;
      }
      ctx.stroke();
      ctx.setLineDash([]);
      const last = finite(column(iso, name, satIndex(c, lane, c.nSteps)));
      if (last !== null && yOf(last) > py && yOf(last) < py + ph) {
        ctx.fillStyle = MUTED;
        ctx.textAlign = "right";
        ctx.textBaseline = "bottom";
        ctx.fillText(label, px + pw - 4, yOf(last) - 2);
      }
    }
  }

  // 5. Estimated cloud base (dashed) and observed cloud top (solid edge).
  if (sat) {
    for (const [name, dash, width, colour] of [["baseFt", [7, 4], 2, "#ffffff"], ["topFt", [], 1.5, "#dfe7ef"]]) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      ctx.beginPath();
      let pen = false;
      for (let s = 0; s < c.nSteps; s++) {
        const i = satIndex(c, lane, s);
        const v = column(sat, "state", i) === SAT_OBSERVED ? finite(column(sat, name, i)) : null;
        const [x0, w] = cellX(s);
        if (v === null) { pen = false; continue; }
        if (pen) ctx.lineTo(x0, yOf(v)); else ctx.moveTo(x0, yOf(v));
        ctx.lineTo(x0 + w, yOf(v));
        pen = true;
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // 6. Observed supercooled layer cells: solid orange boxes.
  ctx.strokeStyle = ORANGE;
  ctx.lineWidth = 2;
  for (let s = 0; s < c.nSteps; s++) {
    const [x0, w] = cellX(s);
    for (let a = 0; a < c.nAlts; a++) {
      if (engine.levelAt(c, lane, s, a) === engine.OBSERVED) {
        const yTop = yOf(alts[a] + half);
        ctx.strokeRect(x0 + 0.5, yTop + 0.5, Math.max(w - 1, 1), yOf(alts[a] - half) - yTop - 1);
      }
    }
  }

  // 7. Not assessed cells and the "Unknown" curtain (columns without usable satellite data).
  for (let s = 0; s < c.nSteps; s++) {
    const [x0, w] = cellX(s);
    for (let a = 0; a < c.nAlts; a++) {
      if (engine.levelAt(c, lane, s, a) === engine.NOT_ASSESSED) {
        fillSpec(ctx, FILLS.curtain, x0, yOf(alts[a] + half), w, yOf(alts[a] - half) - yOf(alts[a] + half));
      }
    }
  }
  const curtainRuns = [];
  if (sat) {
    const missingSet = new Set(curtainColumns(file, c, lane));
    let start = -1;
    for (let s = 0; s <= c.nSteps; s++) {
      const missing = missingSet.has(s);
      if (missing && start < 0) start = s;
      if (!missing && start >= 0) { curtainRuns.push([start, s]); start = -1; }
    }
  }
  const pixelRuns = [];
  for (const [a0, a1] of curtainRuns) {
    const x0 = cellX(a0)[0];
    const x1 = cellX(a1 - 1)[0] + cellX(a1 - 1)[1];
    fillSpec(ctx, FILLS.curtain, x0, py, x1 - x0, ph);
    ctx.strokeStyle = "#9aa3ad";
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, py + 0.5, x1 - x0 - 1, ph - 1);
    pixelRuns.push([x0, x1]);
  }
  // Labels only where a run is wide enough and never over another label (R10.1). The stripes and the
  // legend still say "Not assessed" for the runs left without a label.
  ctx.font = "bold 13px system-ui, sans-serif";
  const plan = planCurtainLabels(pixelRuns, ctx.measureText("Not assessed").width, ctx.measureText("N/A").width);
  for (const { cx, label } of plan) {
    const tw = ctx.measureText(label).width + 10;
    ctx.fillStyle = "rgba(12,16,21,0.9)";
    ctx.fillRect(cx - tw / 2, py + 6, tw, 18);
    ctx.fillStyle = FG;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, cx, py + 15);
  }
  ctx.font = "12px system-ui, sans-serif";

  // 8. Wind barbs: forecast head-wind component, knots.
  const stepStride = Math.max(1, Math.round(70 / ((pw / c.distanceKm) * c.stepKm)));
  const altStride = Math.max(1, Math.ceil(26 / ((ph / (yMax - yMin)) * (alts.length > 1 ? alts[1] - alts[0] : 1000))));
  for (let s = Math.floor(stepStride / 2); s < c.nSteps; s += stepStride) {
    const [x0, w] = cellX(s);
    for (let a = 0; a < c.nAlts; a += altStride) {
      const kt = c.headwindKt[(lane * (c.nSteps + 1) + s) * c.nAlts + a];
      if (Number.isFinite(kt)) drawBarb(ctx, x0 + w / 2 - 6, yOf(alts[a]), kt);
    }
  }

  // 9. Aircraft: triangle at the distance flown and the current altitude, with the "now" line.
  // Display-only smooth motion: between the previous and the current step position (R13.10).
  const prev = view.prev;
  const frac = Math.min(Math.max(Number(view.frac) || 0, 0), 1);
  const stepF = prev && frac < 1 ? prev.step + (state.step - prev.step) * frac : state.step;
  const ax = xOf(Math.min(stepF * c.stepKm, c.distanceKm));
  const ay = yOf(alts[state.alt]);
  // "Now" line: the aircraft's distance, solid with a text label (R13.6).
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(ax, py);
  ctx.lineTo(ax, py + ph);
  ctx.stroke();
  ctx.font = "bold 12px system-ui, sans-serif";
  const nowW = ctx.measureText("now").width + 8;
  const nowX = Math.min(Math.max(ax - nowW / 2, px), px + pw - nowW);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(nowX, py + ph - 20, nowW, 16);
  ctx.fillStyle = "#000000";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("now", nowX + nowW / 2, py + ph - 12);
  ctx.font = "12px system-ui, sans-serif";
  ctx.beginPath();
  ctx.moveTo(ax + 10, ay);
  ctx.lineTo(ax - 7, ay - 7);
  ctx.lineTo(ax - 7, ay + 7);
  ctx.closePath();
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 2;
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.strokeRect(px, py, pw, ph);

  // Title line.
  const kind = file && file.dataKind === "simulated" ? "Simulated" : "Observation";
  ctx.font = "bold 13px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = FG;
  const laneKm = c.lanesKm[lane];
  const laneName = laneKm === 0 ? "centre" : `${laneKm > 0 ? "+" : "-"}${Math.abs(laneKm)} km`;
  ctx.fillText(`Side view: altitude along lane ${lane + 1} of ${c.nLanes} (${laneName})  |  ${kind}`, px, py - 9);
  ctx.font = "12px system-ui, sans-serif";
  return levels;
}

// ------------------------------------------------------------------------------------------
// Legend: every pattern has a text label and says which kind of data it shows.
// ------------------------------------------------------------------------------------------

function legendSwatch(ctx, type, x, y, w, h) {
  ctx.fillStyle = "#10161d";
  ctx.fillRect(x, y, w, h);
  switch (type) {
    case "dashed":
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2; ctx.setLineDash([6, 3]);
      ctx.beginPath(); ctx.moveTo(x, y + h / 2); ctx.lineTo(x + w, y + h / 2); ctx.stroke(); ctx.setLineDash([]);
      return;
    case "dotted":
      ctx.strokeStyle = "rgba(190,200,212,0.9)"; ctx.lineWidth = 1; ctx.setLineDash([1, 3]);
      ctx.beginPath(); ctx.moveTo(x, y + h / 2); ctx.lineTo(x + w, y + h / 2); ctx.stroke(); ctx.setLineDash([]);
      return;
    case "barb":
      drawBarb(ctx, x + 3, y + h / 2 + 3, 25);
      return;
    case "observed":
      fillSpec(ctx, FILLS.candidate, x, y, w, h);
      ctx.strokeStyle = ORANGE; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
      return;
    case "plain":
      ctx.strokeStyle = GRID; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      return;
    default:
      fillSpec(ctx, FILLS[type], x, y, w, h);
      ctx.strokeStyle = GRID; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }
}

function drawLegend(ctx, x, y, w, levels) {
  const sw = 26;
  const sh = 11;
  const textX = x + sw + 8;
  const textW = w - sw - 8;
  let cy = y;
  const header = (text) => {
    ctx.font = "bold 12px system-ui, sans-serif";
    ctx.fillStyle = FG;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(text, x, cy + 10);
    cy += 17;
  };
  const row = (type, text) => {
    ctx.font = "11px system-ui, sans-serif";
    const lines = wrapText(ctx, text, textW);
    legendSwatch(ctx, type, x, cy, sw, sh);
    ctx.fillStyle = MUTED;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    lines.forEach((ln, i) => ctx.fillText(ln, textX, cy + 10 + i * 13));
    cy += Math.max(sh + 4, lines.length * 13 + 3);
  };

  header("Satellite observation: cloud top");
  row("liquid", "Liquid");
  row("supercooled", "Supercooled liquid");
  row("mixed", "Mixed");
  row("ice", "Ice");
  row("unknownPhase", "Phase unknown");
  row("dashed", "Cloud base: statistical estimate, not an observation");
  row("candidate", "Candidate band: 0 C to -20 C heights, base known");
  cy += 3;
  header("Forecast model (ECMWF)");
  row("barb", "Head wind, knots (staff right: head wind)");
  row("dotted", "0 C and -20 C heights");
  cy += 3;
  header("Evidence level");
  row("observed", levels[3]);
  row("possible", levels[2]);
  row("plain", `${levels[1]} (no fill)`);
  row("curtain", `${levels[0]} (stripes)`);
  cy += 2;
  ctx.font = "11px system-ui, sans-serif";
  ctx.fillStyle = MUTED;
  const note = wrapText(ctx, "A satellite sees cloud tops only. Cloud under a higher cloud is not visible.", w);
  note.forEach((ln, i) => ctx.fillText(ln, x, cy + 10 + i * 13));
}

// Draws the side-view legend on its own small canvas (the Legend dialog, task 12.3). The canvas CSS size is
// LEGEND_SIZE; the backing store is scaled by the device pixel ratio.
export const LEGEND_SIZE = { w: 290, h: 400 };

export function drawLegendCanvas(canvas, caseData) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? Math.min(devicePixelRatio, 3) : 1;
  canvas.width = Math.round(LEGEND_SIZE.w * dpr);
  canvas.height = Math.round(LEGEND_SIZE.h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.setLineDash([]);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, LEGEND_SIZE.w, LEGEND_SIZE.h);
  drawLegend(ctx, 10, 8, LEGEND_SIZE.w - 20, levelNames(caseData));
}

// ------------------------------------------------------------------------------------------
// Entry points
// ------------------------------------------------------------------------------------------

// opts: { legend: true } draws the side legend panel; false uses the full width (design 9.2).
//       { width, height } drawing size in CSS pixels (default canvas.width and canvas.height).
export function renderScene(canvas, view, opts = {}) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = Number(opts.width) > 0 ? Number(opts.width) : canvas.width;
  const h = Number(opts.height) > 0 ? Number(opts.height) : canvas.height;
  const showLegend = opts.legend !== false;
  ctx.setLineDash([]);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);

  const panelW = showLegend ? 270 : 0;
  const chart = { x: 64, y: 30, w: w - panelW - 64 - 28, h: h - 30 - 46 };

  const c = view && view.engineCase;
  const state = view && view.state;
  if (!c || !state) {
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.strokeRect(chart.x, chart.y, chart.w, chart.h);
    ctx.fillStyle = FG;
    ctx.font = "16px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText((view && view.message) || "No case loaded.", w / 2, h / 2);
    return;
  }

  const levels = drawCrossSection(ctx, view, chart);
  if (showLegend) drawLegend(ctx, w - panelW - 6, 30, panelW, levels);
}

// Plain-text description of the same picture for screen readers (evidence only, no advice).
export function describeScene(view) {
  const c = view && view.engineCase;
  const state = view && view.state;
  if (!c || !state) return "";
  const names = levelNames(view.caseData);
  const km = [0, 0, 0, 0];
  for (let s = 0; s < c.nSteps; s++) km[engine.levelAt(c, state.lane, s, state.alt)] += engine.segmentKm(c, s);
  const parts = [3, 2, 1, 0].map((lv) => `${names[lv]}: ${Math.round(km[lv])} km`);
  const alt = Math.round(c.altsFt[state.alt]).toLocaleString("en-US");
  return `Side view for lane ${state.lane + 1} of ${c.nLanes} at ${alt} ft. ` +
    `Evidence along the whole route at this altitude, kilometres per level: ${parts.join("; ")}. ` +
    "A satellite sees cloud tops only; the cloud base is a statistical estimate.";
}
