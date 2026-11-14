// Cockpit panel overlay (task 15.3, design 14.8). Reads scene.panel and scene.effects from scene.js and the
// engine state; it never changes the engine state. The anti-ice switch only calls deps.onAntiIce(next); the
// controller (task 15.4) applies it. The helpers before createPanel are DOM-free so Node tests can run them.
// Real text, focusable controls, and every evidence level has a pattern word as well as a drawing (R10.1).
// Evidence only: no cost preview and no recommended choice (R6.5).

import * as engine from "./engine.js";
import { FILLS, fillSpec, levelNames } from "./render.js";
import { fitCanvas } from "./view-helpers.js";
import { POPUP_MS } from "./cost-popup.js";

export const GAME_NOTE =
  "Game model. Not a flight procedure, not an icing severity. " +
  "Evidence from satellite cloud tops and an ECMWF forecast.";
export const ANNOUNCE_MS = 1500; // assistive-technology text updates at most this often (design 14.8)
export const MAP_AHEAD_STEPS = 8;
export const MAP_BEHIND_STEPS = 2;
export const TAPE_RANGE_FT = 4000; // altitude tape shows this much above and below the aircraft
export const TAPE_TICK_FT = 1000;

const TEXT = Object.freeze({
  fuel: "Fuel cost so far (illustrative)",
  fuelWithDeparture: "Fuel cost so far (illustrative), including Departure climb",
  iceHelp: "Game value from 0 to 100. Not a weather statement.",
  antiIce: "Anti-ice",
  lampOn: "Wing-heat lamp on",
  lampOff: "Wing-heat lamp off",
  altitude: "Altitude (ft)",
  map: "Panel map",
  legend: "Evidence legend",
  source: "Source",
  noSource: "not stated",
  mapNoCell: "No cell ahead (end of route)",
});

// Pattern word for each engine level, matching FILLS used by the 2D views (R13.5). Not indicated has no fill.
const PATTERN = Object.freeze([
  { fill: "curtain", word: "vertical stripes" }, // Not assessed
  { fill: null, word: "plain" }, // Not indicated
  { fill: "possible", word: "dots" }, // Possible
  { fill: "candidate", word: "diagonal lines" }, // Observed
]);

export function levelPattern(level) {
  return PATTERN[level] || PATTERN[engine.NOT_ASSESSED];
}

export function formatUsd(v) {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0;
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US")}`;
}

export function formatFeet(v) {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0;
  return n.toLocaleString("en-US");
}

// Ice gauge: fraction 0..1 of the game ice index. The text always carries the exact label and the number.
export function iceGauge(panel) {
  const raw = panel && typeof panel.ice === "number" && Number.isFinite(panel.ice) ? panel.ice : 0;
  const ice = Math.min(Math.max(raw, 0), engine.ICE_MAX);
  const label = (panel && panel.iceLabel) || "Ice index (game model)";
  return { frac: ice / engine.ICE_MAX, value: Math.round(ice), label, text: `${label}: ${Math.round(ice)} of ${engine.ICE_MAX}` };
}

export function antiIceView(antiIce) {
  const on = Boolean(antiIce);
  return { on, ariaChecked: on ? "true" : "false", lamp: on ? TEXT.lampOn : TEXT.lampOff, state: on ? "on" : "off" };
}

// Altitude tape: tick marks inside [alt - range, alt + range]. frac 0 is the bottom, 1 the top; the aircraft
// is at 0.5. Ticks are multiples of TAPE_TICK_FT.
export function altitudeTape(altFt, rangeFt = TAPE_RANGE_FT, tickFt = TAPE_TICK_FT) {
  const alt = typeof altFt === "number" && Number.isFinite(altFt) ? altFt : 0;
  const ticks = [];
  const first = Math.ceil((alt - rangeFt) / tickFt) * tickFt;
  for (let ft = first; ft <= alt + rangeFt; ft += tickFt) {
    ticks.push({ ft, frac: (ft - (alt - rangeFt)) / (2 * rangeFt) });
  }
  return { altFt: alt, readout: formatFeet(alt), ticks };
}

// Legend strip: the four exact level names in engine order, each with its pattern word (R16.8, R10.1).
export function legendItems(names) {
  const list = Array.isArray(names) && names.length === 4 ? names : [0, 1, 2, 3].map(() => "");
  return list.map((name, level) => ({ level, name, pattern: levelPattern(level).word }));
}

// Text of one cell for the panel map's text alternative: name plus pattern word.
export function cellLabel(names, level) {
  return `${names[level]} (${levelPattern(level).word})`;
}

// Source line with UTC time (R1.3). Same fields as the scene text line, kept separate so it stands alone.
export function fmtUtc(iso) {
  const d = typeof iso === "string" ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? `${d.toISOString().slice(0, 16).replace("T", " ")} UTC` : TEXT.noSource;
}

export function sourceLine(file) {
  const src = (file && file.sources) || {};
  const sat = src.satellite || {};
  const fc = src.forecast || {};
  const parts = [`${sat.satellite || "satellite"} ${fmtUtc(sat.scanStartUtc)}`];
  if (fc.name) parts.push(`${fc.name} run ${fmtUtc(fc.runUtc)}`);
  return `${TEXT.source}: ${parts.join(", ")}`;
}

// True when a text update for assistive technology is due.
export function announceDue(lastMs, nowMs, minMs = ANNOUNCE_MS) {
  return !Number.isFinite(lastMs) || !Number.isFinite(nowMs) || nowMs - lastMs >= minMs;
}

// Panel map geometry in CSS pixels: lanes are rows (lane 0 on top, to the left of travel), steps are columns,
// travel runs to the right. The window is MAP_BEHIND_STEPS behind and MAP_AHEAD_STEPS ahead of state.step.
export function panelMapLayout(c, state, w, h) {
  const pad = 6;
  const first = Math.max(0, state.step - MAP_BEHIND_STEPS);
  const last = Math.min(c.nSteps - 1, state.step + MAP_AHEAD_STEPS - 1);
  const cols = Math.max(1, last - first + 1);
  const stepW = Math.max(1, (w - 2 * pad) / cols);
  const rowH = Math.max(1, (h - 2 * pad) / c.nLanes);
  return {
    pad, first, last, stepW, rowH,
    stepX: (s) => pad + (s - first) * stepW,
    laneY: (lane) => pad + lane * rowH,
    laneCentre: (lane) => pad + (lane + 0.5) * rowH,
  };
}

// Evidence of the cells ahead at the current altitude, for every lane: [{lane, step, level}] (R13.5, CD-P22).
// Uses engine.levelAt only, so it agrees with the side view and the 2D map.
export function panelMapCells(c, state) {
  const out = [];
  const last = Math.min(c.nSteps, state.step + MAP_AHEAD_STEPS);
  for (let s = state.step; s < last; s++) {
    for (let lane = 0; lane < c.nLanes; lane++) out.push({ lane, step: s, level: engine.levelAt(c, lane, s, state.alt) });
  }
  return out;
}

// ------------------------------------------------------------------------------------------
// Canvas drawing (uses FILLS and fillSpec of the 2D views, so the patterns are the same)
// ------------------------------------------------------------------------------------------

export function drawPanelMap(ctx, view, w, h) {
  const { engineCase: c, state } = view;
  ctx.fillStyle = "#10161d";
  ctx.fillRect(0, 0, w, h);
  if (!c || !state) return;
  const g = panelMapLayout(c, state, w, h);
  for (const cell of panelMapCells(c, state)) {
    const p = levelPattern(cell.level);
    const x = g.stepX(cell.step);
    const y = g.laneY(cell.lane);
    if (p.fill) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, g.stepW, g.rowH);
      ctx.clip();
      fillSpec(ctx, FILLS[p.fill], x, y, g.stepW, g.rowH);
      ctx.restore();
    }
    ctx.strokeStyle = cell.level === engine.OBSERVED ? "#ffb347" : "rgba(170,181,195,0.25)";
    ctx.lineWidth = cell.level === engine.OBSERVED ? 2 : 1;
    ctx.strokeRect(x + 0.5, y + 0.5, g.stepW - 1, g.rowH - 1);
  }
  // Lane centre lines; the current lane is drawn heavier.
  for (let lane = 0; lane < c.nLanes; lane++) {
    ctx.strokeStyle = lane === state.lane ? "#ffffff" : "rgba(232,237,243,0.35)";
    ctx.lineWidth = lane === state.lane ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(g.pad, g.laneCentre(lane));
    ctx.lineTo(w - g.pad, g.laneCentre(lane));
    ctx.stroke();
  }
  // Flown track.
  const track = (view.track || []).filter((t) => t.step >= g.first);
  if (track.length) {
    ctx.strokeStyle = "#6cb4ff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    track.forEach((t, i) => {
      const x = g.stepX(t.step);
      const y = g.laneCentre(t.lane);
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
    ctx.stroke();
  }
  // Aircraft: a white triangle with a dark outline, nose to the right.
  const ax = g.stepX(state.step);
  const ay = g.laneCentre(state.lane);
  const s = Math.max(4, Math.min(g.rowH * 0.35, 9));
  ctx.beginPath();
  ctx.moveTo(ax + s, ay);
  ctx.lineTo(ax - s, ay - s * 0.8);
  ctx.lineTo(ax - s * 0.5, ay);
  ctx.lineTo(ax - s, ay + s * 0.8);
  ctx.closePath();
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 1.5;
  ctx.fill();
  ctx.stroke();
}

export function drawAltitudeTape(ctx, panel, w, h) {
  ctx.fillStyle = "#10161d";
  ctx.fillRect(0, 0, w, h);
  const tape = altitudeTape(panel.altFt);
  ctx.font = "11px system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.strokeStyle = "rgba(232,237,243,0.7)";
  ctx.fillStyle = "#e8edf3";
  ctx.lineWidth = 1;
  for (const t of tape.ticks) {
    const y = h - t.frac * h;
    ctx.beginPath();
    ctx.moveTo(w - 10, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    ctx.fillText(`${Math.round(t.ft / 1000)}k`, 4, y);
  }
  // Pointer at the aircraft altitude.
  ctx.fillStyle = "#ffd84d";
  ctx.beginPath();
  ctx.moveTo(w, h / 2);
  ctx.lineTo(w - 12, h / 2 - 6);
  ctx.lineTo(w - 12, h / 2 + 6);
  ctx.closePath();
  ctx.fill();
}

// ------------------------------------------------------------------------------------------
// DOM
// ------------------------------------------------------------------------------------------

function el(tag, attrs = {}, text) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else n.setAttribute(k, v);
  }
  if (text !== undefined) n.textContent = text;
  return n;
}

// root: element that receives the overlay. deps: { onAntiIce(next), now() }.
// update(scene, view): view = { caseData, engineCase, state, track }. Returns nothing; reads only.
export function createPanel(root, deps = {}) {
  const now = deps.now || (() => (typeof performance !== "undefined" ? performance.now() : 0));
  const box = el("section", { class: "cockpit-panel", "aria-label": "Cockpit panel" });

  const fuel = el("div", { class: "cp-fuel" });
  const fuelLabel = el("span", { class: "cp-label" }, TEXT.fuel);
  fuel.append(fuelLabel);
  const fuelValue = el("output", { class: "cp-fuel-value" }, formatUsd(0));
  fuel.append(fuelValue);
  // Cost pop-up (task 16.7): "+$N this segment" for a few seconds; text comes from cost-popup.js.
  const costPop = el("span", { class: "cp-cost-pop", role: "status" });
  costPop.hidden = true;
  fuel.append(costPop);
  let costTimer = null;

  const ice = el("div", { class: "cp-ice" });
  const iceLabel = el("span", { class: "cp-label", id: "cp-ice-label" }, "Ice index (game model)");
  const iceMeter = el("meter", { class: "cp-ice-meter", min: "0", max: String(engine.ICE_MAX), value: "0", "aria-labelledby": "cp-ice-label" });
  const iceValue = el("span", { class: "cp-ice-value" }, `0 of ${engine.ICE_MAX}`);
  ice.append(iceLabel, iceMeter, iceValue, el("span", { class: "cp-help" }, TEXT.iceHelp));

  const sw = el("div", { class: "cp-switch" });
  const swBtn = el("button", { type: "button", role: "switch", "aria-checked": "false", class: "cp-antiice" }, `${TEXT.antiIce}: off`);
  const lamp = el("span", { class: "cp-lamp", "aria-hidden": "true" });
  const lampText = el("span", { class: "cp-lamp-text" }, TEXT.lampOff);
  swBtn.addEventListener("click", () => {
    if (deps.onAntiIce) deps.onAntiIce(swBtn.getAttribute("aria-checked") !== "true");
  });
  sw.append(swBtn, lamp, lampText);

  const tapeWrap = el("figure", { class: "cp-tape" });
  const tapeCanvas = el("canvas", { class: "cp-tape-canvas", "aria-hidden": "true" });
  const tapeValue = el("figcaption", { class: "cp-tape-value" }, `${TEXT.altitude}: 0`);
  tapeWrap.append(tapeCanvas, tapeValue);

  const mapWrap = el("figure", { class: "cp-map" });
  const mapCanvas = el("canvas", { class: "cp-map-canvas", role: "img", "aria-label": TEXT.map });
  const mapText = el("figcaption", { class: "cp-map-text" });
  mapWrap.append(mapCanvas, mapText);

  const legend = el("ul", { class: "cp-legend", "aria-label": TEXT.legend });
  const textLine = el("p", { class: "cp-text-line", "aria-live": "polite", "aria-atomic": "true" });
  const gameNote = el("p", { class: "cp-game-note" }, GAME_NOTE);
  const sourceEl = el("p", { class: "cp-source" });

  box.append(fuel, ice, sw, tapeWrap, mapWrap, legend, textLine, gameNote, sourceEl);
  root.append(box);

  let lastView = null;
  let lastAnnounce = NaN;
  let legendKey = "";
  const redraw = () => {
    if (!lastView) return;
    const mctx = mapCanvas.getContext("2d");
    if (mctx) drawPanelMap(mctx, lastView.map, mapCanvas.clientWidth, mapCanvas.clientHeight);
    const tctx = tapeCanvas.getContext("2d");
    if (tctx) drawAltitudeTape(tctx, lastView.panel, tapeCanvas.clientWidth, tapeCanvas.clientHeight);
  };
  const stops = [fitCanvas(mapCanvas, redraw), fitCanvas(tapeCanvas, redraw)];

  // Display-only counter value between steps (task 16.3); update() sets the exact engine total.
  function setFuel(usd) {
    fuelValue.textContent = formatUsd(usd);
  }

  function showCost(text, ms = POPUP_MS) {
    if (costTimer) clearTimeout(costTimer);
    costPop.textContent = text;
    costPop.hidden = false;
    costTimer = setTimeout(() => { costPop.hidden = true; costTimer = null; }, ms);
  }

  function hideCost() {
    if (costTimer) clearTimeout(costTimer);
    costTimer = null;
    costPop.hidden = true;
  }

  function update(scene, view) {
    const p = scene.panel;
    const shown = typeof p.displayTotalUsd === "number" ? p.displayTotalUsd : p.totalUsd;
    fuelValue.textContent = formatUsd(shown);
    // The label names the Departure climb once it is part of the total (after the climb, R15.5).
    fuelLabel.textContent = shown !== p.totalUsd ? TEXT.fuelWithDeparture : TEXT.fuel;
    const g = iceGauge(p);
    iceLabel.textContent = g.label;
    iceMeter.setAttribute("value", String(g.value));
    iceValue.textContent = `${g.value} of ${engine.ICE_MAX}`;
    const a = antiIceView(p.antiIce);
    swBtn.setAttribute("aria-checked", a.ariaChecked);
    swBtn.textContent = `${TEXT.antiIce}: ${a.state}`;
    // The lamp glows from the scene effects (R18.3).
    const l = antiIceView(scene.effects ? scene.effects.wingLamp : p.antiIce);
    lamp.className = l.on ? "cp-lamp cp-lamp-on" : "cp-lamp";
    lampText.textContent = l.lamp;
    tapeValue.textContent = `${TEXT.altitude}: ${formatFeet(p.altFt)}`;

    const key = (p.legend || []).join("|");
    if (key !== legendKey) {
      legendKey = key;
      legend.replaceChildren(...legendItems(p.legend).map((it) => {
        const li = el("li", { class: `cp-legend-item cp-level-${it.level}` });
        li.append(el("span", { class: "cp-swatch", "aria-hidden": "true" }), el("span", {}, `${it.name} (${it.pattern})`));
        return li;
      }));
    }
    sourceEl.textContent = view && view.caseData ? sourceLine(view.caseData) : "";

    if (view && view.engineCase && view.state) {
      const c = view.engineCase;
      const names = levelNames(view.caseData);
      const cells = panelMapCells(c, view.state).filter((x) => x.lane === view.state.lane).slice(0, 3);
      mapText.textContent = cells.length
        ? `Panel map. Lane ${view.state.lane + 1} of ${c.nLanes}. Next cells at this altitude: ${cells.map((x, i) => `${i + 1}: ${cellLabel(names, x.level)}`).join("; ")}.`
        : `Panel map. ${TEXT.mapNoCell}.`;
      lastView = { map: view, panel: p };
    } else {
      lastView = null;
    }
    const t = now();
    // Before cruise the "Not assessed" text must follow the climb at once (R15.6); in cruise it is throttled.
    const lead = scene.phase === "ready" || scene.phase === "takeoff" || scene.phase === "climb";
    if (announceDue(lastAnnounce, t) || (lead && textLine.textContent !== p.textLine)) {
      lastAnnounce = t;
      textLine.textContent = p.textLine;
    }
    redraw();
  }

  function dispose() {
    hideCost();
    stops.forEach((s) => s());
    box.remove();
  }

  return { update, setFuel, showCost, hideCost, dispose, element: box };
}
