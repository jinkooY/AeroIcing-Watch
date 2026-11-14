// Scene description of the cockpit view (design 14.1 to 14.3, revision b).
// Pure and DOM-free: buildScene(file, state, pose, opts) returns plain JSON that cockpit3d.js draws and
// panel.js reads. No clock, no random, no DOM. The case file, the engine state and the pose are never
// changed (inputs may be deep frozen). Only the scene is scaled (VEX, LATK); engine distances stay true.
// All text comes from the one table STRINGS, which tests/test_wording.py scans (R9.1).
// Clouds are built here (14.2); evidence, effects and the text line are filled by tasks 14.3 and 14.4.

import * as engine from "./engine.js";
import { departureUsd, DEPARTURE_LABEL } from "./departure.js";
import { column, satIndex, SAT_OBSERVED } from "./render.js";

export const SCHEMA_VERSION = 1;

// Display constants (design 14.2). Tuned together in task 15.2; LATK may go down to 0.2.
export const VEX = 3; // vertical exaggeration
export const LATK = 0.5; // lateral compression of lane spacing (1 = true spacing)
export const LEAD_IN_KM = 30; // climb lead-in: runway at x = -LEAD_IN_KM, "Top of climb" at x = 0 (R15.14)
export const CLOUD_FADE_S = 1.5; // cloud fade-in over the last seconds of the climb (R15.15)
export const MAX_CLOUD_VOLUMES = 160; // caps of design 14.9, tuned in task 15.6
export const MAX_EVIDENCE_BANDS = 240;
export const MAX_TRIANGLES = 40000;
export const VIEW_KM = 80; // view distance ahead
export const SHAKE_MAX_DEG = 0.4;

// Cloud volumes (design 14.4). Fixed values: no noise, no random, no per-cell variation.
export const BEHIND_STEPS = 2; // window starts this many steps behind the aircraft
export const FAR_STEPS = 12; // cells beyond this many steps ahead may be merged
export const MERGE_TOL_FT = 500; // merge tolerance on top and base
export const MERGE_TOL_RAISED_FT = 1000; // used when the cap is still exceeded
export const THIN_CAP_FT = 350; // thin faded cap under the top when the base is null (as the 2D view)
const DEFAULT_LANE_WIDTH_KM = 15;

export const FT_PER_KM = 3280.8399;
export const DEFAULT_FOV_DEG = 75;

export const PHASES = ["ready", "takeoff", "climb", "cruise", "gate", "arrival", "diversion", "report"];
export const ARRIVAL_ROLL_KM = 1.8; // display roll along the arrival runway (half length is 2 km)
const LEAD_PHASES = new Set(["ready", "takeoff", "climb"]);

// One string table (R9.1, R16.12, R15.14, R16.4). Evidence level names come from the case file.
export const STRINGS = Object.freeze({
  topOfClimb: "Top of climb",
  baseEstimated: "estimated",
  // Fallback level names, indexed by engine level (the case file's rule.levels is used first).
  levels: Object.freeze([
    "Not assessed",
    "Not indicated",
    "Possible (forecast only)",
    "Observed supercooled layer at planned altitude",
  ]),
  // Panel phase text while the engine does not run (R15.6).
  belowBlock: "Not assessed (below the game's altitude block)",
  departureClimb: "Not assessed (departure climb)",
  noCellAhead: "No cell ahead (end of route)",
  iceIndexLabel: "Ice index (game model)",
  textNa: "not stated",
  groundNote: "Flat ground at the departure airport elevation. Terrain is not drawn.",
  displayScale:
    `Display scale: heights are drawn ${VEX} times taller and lane spacing ${LATK} times as wide. ` +
    "This is for display only. The game uses true distances and altitudes.",
  leadIn:
    `The runway is drawn ${LEAD_IN_KM} km before the route start. This lead-in is a display convention. ` +
    "The route length and the flown distance are unchanged.",
});

const num = (v, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const round6 = (v) => Math.round(v * 1e6) / 1e6;

// ft above mean sea level to display kilometres (vertical exaggeration applied).
export const ftToDisplayKm = (ft) => round6((num(ft) / FT_PER_KM) * VEX);
// True lateral offset in km to display kilometres.
export const laneToDisplayKm = (km) => round6(num(km) * LATK);

// The engine case is built once per case file object (deterministic cache, no clock).
const caseCache = new WeakMap();
function engineCase(file, opts) {
  if (opts && opts.engineCase) return opts.engineCase;
  let c = caseCache.get(file);
  if (!c) {
    c = engine.loadCase(file);
    caseCache.set(file, c);
  }
  return c;
}

// 0 in ready and takeoff, 0 to 1 over the last CLOUD_FADE_S seconds of the climb, 1 afterwards (R15.15).
export function cloudAlphaFor(phase, pose) {
  if (phase === "ready" || phase === "takeoff") return 0;
  if (phase !== "climb") return 1;
  const r = pose && typeof pose.climbRemainingS === "number" && Number.isFinite(pose.climbRemainingS)
    ? pose.climbRemainingS : Infinity;
  if (r >= CLOUD_FADE_S) return 0;
  return round6(clamp(1 - Math.max(r, 0) / CLOUD_FADE_S, 0, 1));
}

const finiteOrNull = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// Observed cell with a finite top -> { top, base } (base null when unknown or above the top), else null.
// Clear sky, not assessed and missing cells give no cloud; a base is never invented.
function cloudCell(sat, c, lane, s) {
  const i = satIndex(c, lane, s);
  if (column(sat, "state", i) !== SAT_OBSERVED) return null;
  const top = finiteOrNull(column(sat, "topFt", i));
  if (top === null) return null;
  const b = finiteOrNull(column(sat, "baseFt", i));
  return { top, base: b !== null && b <= top ? b : null };
}

const sameBase = (a, b, tol) =>
  (a === null && b === null) || (a !== null && b !== null && Math.abs(a - b) <= tol);

// Cloud volumes of the window [s0, s1] (steps), merging far cells of one lane within `tol`.
function volumesFor(c, lanes, halfWidthKm, cells, s0, s1, nowStep, tol) {
  const out = [];
  for (let lane = 0; lane < c.nLanes; lane++) {
    let run = null;
    const flush = () => {
      if (run) out.push(run);
      run = null;
    };
    for (let s = s0; s <= s1; s++) {
      const cell = cells[lane][s];
      if (!cell) { flush(); continue; }
      const far = s - nowStep > FAR_STEPS;
      if (run && far && run.farStart && Math.abs(cell.top - run.topFt) <= tol && sameBase(cell.base, run.baseFt, tol)) {
        run.step1 = s;
        continue;
      }
      flush();
      run = { lane, step: s, step1: s, topFt: cell.top, baseFt: cell.base, farStart: far };
    }
    flush();
  }
  return out.map((v) => {
    const x0 = Math.max(0, v.step * c.stepKm); // no volume starts before x = 0
    const x1 = Math.min(c.distanceKm, (v.step1 + 1) * c.stepKm);
    const est = v.baseFt === null;
    return {
      lane: v.lane, step: v.step, step1: v.step1,
      x0Km: round6(x0), x1Km: round6(Math.max(x1, x0)),
      zKm: lanes[v.lane].zKm, halfWidthKm,
      topFt: v.topFt, baseFt: v.baseFt,
      bottomFt: est ? v.topFt - THIN_CAP_FT : v.baseFt, // drawn bottom: the thin cap when the base is unknown
      baseEstimated: est, faded: est,
    };
  });
}

// Cloud volumes for the window around state.step (design 14.4). Both satellite array shapes are read through
// the shared render.js helper. Merge tolerance 500 ft, 1,000 ft if MAX_CLOUD_VOLUMES is exceeded, then the
// window shrinks (far end first). Cells with Observed evidence are never merged or dropped before that.
export function buildClouds(file, c, step, lanes, viewKm = VIEW_KM) {
  const sat = file && file.satellite;
  if (!sat) return [];
  const cells = [];
  for (let lane = 0; lane < c.nLanes; lane++) {
    const row = new Array(c.nSteps);
    for (let s = 0; s < c.nSteps; s++) row[s] = cloudCell(sat, c, lane, s);
    cells.push(row);
  }
  const now = clamp(Math.floor(num(step)), 0, Math.max(c.nSteps - 1, 0));
  const spacing = c.lanesKm.length > 1
    ? Math.min(...c.lanesKm.slice(1).map((v, i) => Math.abs(v - c.lanesKm[i])).filter((d) => d > 0), Infinity)
    : DEFAULT_LANE_WIDTH_KM;
  const halfWidthKm = round6((Number.isFinite(spacing) ? spacing : DEFAULT_LANE_WIDTH_KM) / 2 * LATK);
  const aheadMax = Math.ceil(viewKm / c.stepKm);
  let behind = BEHIND_STEPS;
  let ahead = aheadMax;
  let list = [];
  for (;;) {
    const s0 = Math.max(0, now - behind);
    const s1 = Math.min(c.nSteps - 1, now + ahead);
    list = volumesFor(c, lanes, halfWidthKm, cells, s0, s1, now, MERGE_TOL_FT);
    if (list.length > MAX_CLOUD_VOLUMES) list = volumesFor(c, lanes, halfWidthKm, cells, s0, s1, now, MERGE_TOL_RAISED_FT);
    if (list.length <= MAX_CLOUD_VOLUMES || (ahead === 0 && behind === 0)) break;
    if (ahead > 0) ahead = Math.max(0, ahead - Math.max(1, Math.ceil(ahead / 4)));
    else behind -= 1;
  }
  return list.slice(0, MAX_CLOUD_VOLUMES); // only reachable with more lanes than the cap
}

// Evidence bands (design 14.5). A band is a run of steps of one lane with the same level and the same altitude
// interval, merged along track. Levels come from engine.levelAt only. Not indicated makes no band. Observed and
// Possible cover the whole block inside the window; Not assessed only within NA_NEAR_FT of the aircraft altitude
// (as the 2D curtain). When MAX_EVIDENCE_BANDS binds, Observed is kept first, then Possible, then Not assessed,
// nearest steps first inside one level. Nothing is drawn in takeoff and climb (R15.15, handled in buildScene).
export const NA_NEAR_FT = 2000;
export const NEAR_EVIDENCE_FT = 2000;
export const FAR_EVIDENCE_WEIGHT = 0.25;
// Design 15.3: display emphasis only. 1 within NEAR_EVIDENCE_FT of the band interval, else FAR_EVIDENCE_WEIGHT.
export function evidenceWeight(loFt, hiFt, altFt) {
  const a = num(altFt);
  const d = a < loFt ? loFt - a : a > hiFt ? a - hiFt : 0;
  return d <= NEAR_EVIDENCE_FT ? 1 : FAR_EVIDENCE_WEIGHT;
}

export function levelName(file, level) {
  const names = file && file.rule && Array.isArray(file.rule.levels) ? file.rule.levels : null;
  return String((names && names[level]) || STRINGS.levels[level] || "");
}

export function buildEvidence(file, c, step, lanes, altFt, viewKm = VIEW_KM) {
  const now = clamp(Math.floor(num(step)), 0, Math.max(c.nSteps - 1, 0));
  const s0 = Math.max(0, now - BEHIND_STEPS);
  const s1 = Math.min(c.nSteps - 1, now + Math.ceil(viewKm / c.stepKm));
  const half = c.nAlts > 1 ? (c.altsFt[1] - c.altsFt[0]) / 2 : 500;
  const bands = [];
  for (let lane = 0; lane < c.nLanes; lane++) {
    const open = new Map(); // "level|lo|hi" -> band being extended
    for (let s = s0; s <= s1; s++) {
      const seen = new Set();
      let a = 0;
      while (a < c.nAlts) {
        const level = engine.levelAt(c, lane, s, a);
        const near = level !== engine.NOT_ASSESSED || Math.abs(c.altsFt[a] - num(altFt)) <= NA_NEAR_FT;
        if (level === engine.NOT_INDICATED || !near) { a += 1; continue; }
        let b = a;
        while (b + 1 < c.nAlts && engine.levelAt(c, lane, s, b + 1) === level &&
          (level !== engine.NOT_ASSESSED || Math.abs(c.altsFt[b + 1] - num(altFt)) <= NA_NEAR_FT)) b += 1;
        const loFt = c.altsFt[a] - half;
        const hiFt = c.altsFt[b] + half;
        const key = `${level}|${loFt}|${hiFt}`;
        seen.add(key);
        const run = open.get(key);
        if (run) run.step1 = s;
        else {
          const nb = { lane, step0: s, step1: s, levelIndex: level, level: levelName(file, level), loFt, hiFt };
          open.set(key, nb);
          bands.push(nb);
        }
        a = b + 1;
      }
      for (const key of [...open.keys()]) if (!seen.has(key)) open.delete(key);
    }
  }
  let list = bands;
  if (list.length > MAX_EVIDENCE_BANDS) {
    list = [];
    for (const lv of [engine.OBSERVED, engine.POSSIBLE, engine.NOT_ASSESSED]) {
      const group = bands.filter((b) => b.levelIndex === lv)
        .sort((p, q) => Math.abs(p.step0 - now) - Math.abs(q.step0 - now) || p.lane - q.lane || p.step0 - q.step0 || p.loFt - q.loFt);
      list = list.concat(group.slice(0, MAX_EVIDENCE_BANDS - list.length));
    }
    list.sort((p, q) => p.lane - q.lane || p.step0 - q.step0 || p.loFt - q.loFt);
  }
  return list.map((b) => ({
    ...b,
    weight: evidenceWeight(b.loFt, b.hiFt, altFt),
    x0Km: round6(Math.max(0, b.step0 * c.stepKm)),
    x1Km: round6(Math.min(c.distanceKm, (b.step1 + 1) * c.stepKm)),
    zKm: lanes[b.lane].zKm,
    halfWidthKm: round6((c.lanesKm.length > 1 ? Math.abs(c.lanesKm[1] - c.lanesKm[0]) : DEFAULT_LANE_WIDTH_KM) / 2 * LATK),
  }));
}

// Sky gates (design 15.2, R22.4, R22.11). Five frames, one per lane, at the target altitude, only in the gate phase.
// Evidence only: no cost field, no recommendation, no ranking between lanes (R6.5, R9.4). Display only.
export const GATE_AHEAD_KM = 18; // frame distance ahead of the boundary (far enough that all five frames fit in the windshield)
export const GATE_HALF_FT = 1000; // frame half height around the target altitude
export const GATE_LOOKAHEAD_CELLS = 3;
// Worst first: Observed, Possible, Not assessed, Not indicated. Not assessed outranks Not indicated, so a missing
// cell is never read as clear (guardrails).
const GATE_RANK = { [engine.OBSERVED]: 4, [engine.POSSIBLE]: 3, [engine.NOT_ASSESSED]: 2, [engine.NOT_INDICATED]: 1 };

// Worst level of the next three cells of a lane at an altitude index; Not assessed when no cell remains.
export function gateLevel(c, lane, step, altIdx) {
  const first = Math.max(0, Math.floor(num(step)));
  let worst = null;
  for (let s = first; s < first + GATE_LOOKAHEAD_CELLS && s <= c.nSteps - 1; s++) {
    const lv = engine.levelAt(c, lane, s, altIdx);
    if (worst === null || (GATE_RANK[lv] || 0) > (GATE_RANK[worst] || 0)) worst = lv;
  }
  return worst === null ? engine.NOT_ASSESSED : worst;
}

export function buildGates(file, c, st, lanes, phase) {
  if (phase !== "gate") return [];
  const altIdx = clamp(Math.floor(num(st.targetAlt, st.alt)), 0, c.nAlts - 1);
  const altFt = c.altsFt[altIdx];
  const spacing = c.lanesKm.length > 1 ? Math.abs(c.lanesKm[1] - c.lanesKm[0]) : DEFAULT_LANE_WIDTH_KM;
  const halfWidthKm = round6(spacing / 2 * LATK);
  const xKm = round6(clamp(num(st.step) * c.stepKm + GATE_AHEAD_KM, 0, Math.max(c.distanceKm, 0)));
  return lanes.map((l) => {
    const levelIndex = gateLevel(c, l.index, st.step, altIdx);
    const name = levelName(file, levelIndex);
    return {
      lane: l.index, zKm: l.zKm, xKm, altFt, yKm: ftToDisplayKm(altFt),
      halfWidthKm, halfHeightKm: ftToDisplayKm(GATE_HALF_FT),
      levelIndex, level: name, label: name, isCurrent: l.isCurrent, isTarget: l.isTarget,
    };
  });
}

// Effects and panel data (design 14.8, R16.2, R16.8, R16.9, R18.1 to R18.3). Reads the engine state only.
export const MAX_WIND_STREAKS = 12;
const KT_PER_STREAK = 5; // one streak per 5 kt of head-wind or tail-wind, at most MAX_WIND_STREAKS

// Legend strip: the four exact level names, in engine level order (R16.8).
export function legendNames(file) {
  return [0, 1, 2, 3].map((lv) => levelName(file, lv));
}

const fmtUtc = (iso) => {
  const d = typeof iso === "string" ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? `${d.toISOString().slice(0, 16).replace("T", " ")} UTC` : STRINGS.textNa;
};

function sourceText(file) {
  const src = (file && file.sources) || {};
  const sat = src.satellite || {};
  const fc = src.forecast || {};
  const parts = [];
  parts.push(`${sat.satellite || "satellite"} ${fmtUtc(sat.scanStartUtc)}`);
  if (fc.name) parts.push(`${fc.name} run ${fmtUtc(fc.runUtc)}`);
  return parts.join(", ");
}

// phaseText: the "Not assessed" reading while the engine does not run, else null.
function phaseText(c, phase, altFt) {
  if (!LEAD_PHASES.has(phase)) return null;
  return altFt < c.altsFt[0] ? STRINGS.belowBlock : STRINGS.departureClimb;
}

// Returns { effects, levelHere, levelAhead, textLine }. Nothing is written back to state.
export function buildEffects(file, c, st, phase, altFt, opts) {
  const o = opts || {};
  const ice = clamp(num(st.ice), 0, engine.ICE_MAX);
  const lead = LEAD_PHASES.has(phase);
  const step = clamp(Math.floor(num(st.step)), 0, c.nSteps);
  const cellStep = Math.min(step, c.nSteps);
  const levelNow = engine.levelAt(c, st.lane, cellStep, st.alt);
  // Level of the cell flown last (what the aircraft is in); before the first segment, the start cell.
  const hereIdx = st.prevLevel === null || st.prevLevel === undefined ? levelNow : st.prevLevel;
  const aheadList = engine.lookaheadLevels(c, st, 2);
  const aheadIdx = aheadList.length > 1 ? aheadList[1] : null;

  const phased = phaseText(c, phase, altFt);
  const levelHere = phased !== null ? phased : levelName(file, hereIdx);
  const levelAhead = phased !== null ? phased : aheadIdx === null ? STRINGS.noCellAhead : levelName(file, aheadIdx);

  const icing = hereIdx === engine.OBSERVED || hereIdx === engine.POSSIBLE;
  const shaking = !lead && !st.antiIce && icing && ice > 0 && !o.reducedMotion;
  const shakeDeg = shaking ? round6((ice / engine.ICE_MAX) * SHAKE_MAX_DEG) : 0;

  const hw = lead ? 0 : num(c.headwindKt[(st.lane * (c.nSteps + 1) + cellStep) * c.nAlts + st.alt]);
  const headwindKt = Math.round(hw);
  const windStreaks = clamp(Math.round(Math.abs(hw) / KT_PER_STREAK), 0, MAX_WIND_STREAKS);

  const effects = {
    frost: round6(ice / engine.ICE_MAX),
    shakeDeg,
    wingLamp: Boolean(st.antiIce),
    windStreaks,
    headwindKt,
  };
  const km = Math.round(num(engine.stateDistanceKm(st)));
  const wind = headwindKt >= 0 ? `head-wind ${headwindKt} kt` : `tail-wind ${-headwindKt} kt`;
  const textLine = lead
    ? `${levelHere}`
    : `Lane ${st.lane + 1} of ${c.nLanes} | ${km} km | ${wind} | here: ${levelHere} | ahead: ${levelAhead}`;
  return { effects, levelHere, levelAhead, textLine };
}

function cameraFor(c, state, pose, phase, laneZKm, altFt, opts) {
  let xKm;
  if (LEAD_PHASES.has(phase)) {
    const px = pose && Number.isFinite(pose.xKm) ? pose.xKm : phase === "ready" || phase === "takeoff" ? -LEAD_IN_KM : 0;
    xKm = clamp(px, -LEAD_IN_KM, 0); // the camera stays at x <= 0 until the climb ends
  } else if (phase === "arrival") {
    // Landing roll along the arrival runway (display only): from the route end to the far half of the strip.
    xKm = round6(c.distanceKm + ARRIVAL_ROLL_KM * clamp(num(pose && pose.progress), 0, 1));
  } else {
    const frac = clamp(num(pose && pose.frac, 1), 0, 1);
    xKm = clamp((state.step + frac) * c.stepKm, 0, c.distanceKm);
  }
  return {
    pos: [round6(xKm), ftToDisplayKm(altFt), round6(laneZKm)],
    yawDeg: num(pose && pose.yawDeg),
    pitchDeg: num(pose && pose.pitchDeg),
    rollDeg: num(pose && pose.rollDeg),
    fovDeg: num(opts && opts.fovDeg, DEFAULT_FOV_DEG),
  };
}

// file: parsed case file (schemaVersion 2). state: engine state (or null before the engine starts).
// pose: { phase, frac, xKm, altFt, laneFrac, pitchDeg, yawDeg, rollDeg, climbRemainingS } from phases.js; all optional.
// opts: { mode, fovDeg, engineCase, departureElevFt, arrivalElevFt, departureIcao, arrivalIcao }.
export function buildScene(file, state, pose, opts) {
  const c = engineCase(file, opts);
  const st = state || engine.initialState(c);
  const o = opts || {};
  const p = pose || {};
  const phase = PHASES.includes(p.phase) ? p.phase : "cruise";

  const lanes = c.lanesKm.map((km, i) => ({
    index: i,
    zKm: laneToDisplayKm(km),
    isCurrent: i === st.lane,
    isTarget: i === st.targetLane,
  }));

  // Lane position of the eye: a fractional lane index (pose.laneFrac) is interpolated between lanes.
  const li = clamp(num(p.laneFrac, st.lane), 0, c.nLanes - 1);
  const lo = Math.floor(li);
  const hi = Math.min(lo + 1, c.nLanes - 1);
  const laneZKm = laneToDisplayKm(c.lanesKm[lo] + (c.lanesKm[hi] - c.lanesKm[lo]) * (li - lo));
  const altFt = Number.isFinite(p.altFt) ? p.altFt : c.altsFt[st.alt];

  // Before cruise the altitude is the pose altitude; without one, ready and takeoff are on the ground.
  const effAlt = Number.isFinite(p.altFt) ? p.altFt : phase === "ready" || phase === "takeoff" ? num(o.departureElevFt) : altFt;
  const fx = buildEffects(file, c, st, phase, effAlt, o);

  const startZ = laneToDisplayKm(c.lanesKm[c.startLane]);
  const route = (file && file.route) || {};
  const depElev = num(o.departureElevFt);
  const arrElev = num(o.arrivalElevFt);
  const departure = num(departureUsd(file && file.params));
  const components = {};
  engine.COMPONENTS.forEach((name, i) => { components[name] = num(st.cost[i]); });

  return {
    schemaVersion: SCHEMA_VERSION,
    phase,
    mode: o.mode === "chase" ? "chase" : "cockpit",
    camera: cameraFor(c, st, p, phase, laneZKm, altFt, o),
    sky: { topColor: "#2b5d9b", horizonColor: "#bcd6ee" },
    // Flat ground at the departure elevation; in the arrival cinematic at the arrival airport elevation (R15.9).
    ground: phase === "arrival"
      ? { y: ftToDisplayKm(arrElev), elevFt: arrElev, color: "#4d6b4a", note: STRINGS.groundNote }
      : { y: ftToDisplayKm(depElev), elevFt: depElev, color: "#4d6b4a", note: STRINGS.groundNote },
    lanes,
    airports: [
      { icao: String(o.departureIcao || route.from || ""), role: "departure", xKm: -LEAD_IN_KM, zKm: startZ, elevFt: depElev },
      { icao: "", role: "topOfClimb", xKm: 0, zKm: startZ, label: STRINGS.topOfClimb },
      { icao: String(o.arrivalIcao || route.to || ""), role: "arrival", xKm: c.distanceKm, zKm: startZ, elevFt: arrElev },
    ],
    cloudAlpha: cloudAlphaFor(phase, p),
    clouds: buildClouds(file, c, st.step, lanes),
    evidence: LEAD_PHASES.has(phase) ? [] : buildEvidence(file, c, st.step, lanes, altFt),
    gates: buildGates(file, c, st, lanes, phase),
    effects: fx.effects,
    panel: {
      totalUsd: num(engine.totalUsd(c, st)),
      // Departure climb as its own cost component (R15.5, R4.6): added to the displayed total once the
      // climb has ended; engine totalUsd is unchanged. 0 for older case files.
      departureUsd: departure,
      departureLabel: DEPARTURE_LABEL,
      displayTotalUsd: num(engine.totalUsd(c, st)) + (LEAD_PHASES.has(phase) ? 0 : departure),
      components,
      ice: num(st.ice),
      antiIce: Boolean(st.antiIce),
      altFt: num(altFt),
      lane: st.lane,
      distanceKm: num(engine.stateDistanceKm(st)),
      iceLabel: STRINGS.iceIndexLabel,
      levelHere: fx.levelHere,
      levelAhead: fx.levelAhead,
      textLine: fx.textLine,
      legend: legendNames(file),
      gate: null,
    },
    notes: { displayScale: STRINGS.displayScale, leadIn: STRINGS.leadIn, ground: STRINGS.groundNote },
  };
}
