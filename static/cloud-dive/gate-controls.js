// Gate choices for the cockpit view (task 15.4, R17). DOM-free: maps the panel actions and keys to the
// existing flight controller (controller.js), which calls engine.setTargets. Nothing here computes or
// shows a cost and nothing picks a choice for the player (R6.5, R9.4, R17.3).

import * as engine from "./engine.js";
import { gateLevel, GATE_LOOKAHEAD_CELLS } from "./scene.js";

export const TOUCH_MIN_PX = 44; // R17.4, R10.2
export const ALT_STEP = 1; // altitude index step = 1,000 ft within the block (R17.2)

// Button labels (R17.1, design 14.14). Wording follows R9.1.
export const GATE_LABELS = Object.freeze({
  flyThrough: "Fly through",
  climbOver: "Climb over",
  descend: "Descend",
  goLeft: "Go left",
  goRight: "Go right",
  antiIce: "Anti-ice",
  continue: "Continue",
  pause: "Pause",
});

export const ACTIONS = Object.freeze(["flyThrough", "climbOver", "descend", "goLeft", "goRight", "toggleAntiIce"]);

// Keyboard (R17.4, R17.6). Returns an action name, "toggleRun" (Space) or null.
export function keyAction(key) {
  switch (key) {
    case "ArrowLeft": return "goLeft";
    case "ArrowRight": return "goRight";
    case "ArrowUp": return "climbOver";
    case "ArrowDown": return "descend";
    case "a": case "A": return "toggleAntiIce";
    case " ": case "Spacebar": return "toggleRun";
    default: return null;
  }
}

// Pure state transition of a panel action; the engine clamps to the corridor and the block (R17.2).
export function applyGateAction(c, state, action) {
  switch (action) {
    case "flyThrough": return engine.setTargets(c, state, state.lane, state.alt, null);
    case "climbOver": return engine.setTargets(c, state, null, state.targetAlt + ALT_STEP, null);
    case "descend": return engine.setTargets(c, state, null, state.targetAlt - ALT_STEP, null);
    case "goLeft": return engine.setTargets(c, state, state.targetLane - 1, null, null);
    case "goRight": return engine.setTargets(c, state, state.targetLane + 1, null, null);
    case "toggleAntiIce": return engine.setTargets(c, state, null, null, !state.antiIce);
    default: return state;
  }
}

// Same actions through the flight controller, exactly like the 2D controls (CD-P27).
export function dispatchAction(controller, getState, action) {
  switch (action) {
    case "flyThrough": {
      const st = getState();
      if (!st) return;
      controller.setLane(st.lane);
      controller.setAlt(st.alt);
      return;
    }
    case "climbOver": return controller.moveAlt(ALT_STEP);
    case "descend": return controller.moveAlt(-ALT_STEP);
    case "goLeft": return controller.moveLane(-1);
    case "goRight": return controller.moveLane(1);
    case "toggleAntiIce": return controller.toggleAntiIce();
    case "toggleRun": return controller.toggle();
    default: return undefined;
  }
}

// Panel description: label, action and disabled flag per button. No cost, no recommendation.
export function gateButtons(c, state, mode) {
  const active = Boolean(c && state) && state.status === "flying";
  const at = (a) => (!active ? true
    : a === "climbOver" ? state.targetAlt >= c.nAlts - 1
    : a === "descend" ? state.targetAlt <= 0
    : a === "goLeft" ? state.targetLane <= 0
    : a === "goRight" ? state.targetLane >= c.nLanes - 1
    : false);
  const list = [
    { action: "flyThrough", label: GATE_LABELS.flyThrough },
    { action: "climbOver", label: GATE_LABELS.climbOver },
    { action: "descend", label: GATE_LABELS.descend },
    { action: "goLeft", label: GATE_LABELS.goLeft },
    { action: "goRight", label: GATE_LABELS.goRight },
    { action: "toggleAntiIce", label: GATE_LABELS.antiIce },
  ].map((b) => ({ ...b, disabled: at(b.action) }));
  list.push({ action: "toggleRun", label: mode === "running" ? GATE_LABELS.pause : GATE_LABELS.continue, disabled: !active });
  return list;
}

// Revision e (R24.1, R24.2): the player's own settings in plain words, and the evidence at the target. The level
// uses the same rule as the sky gate frames (scene.gateLevel: worst of the next three cells of the target lane at the
// target altitude), so the text and the frames always agree. Settings and evidence only: no cost field and no
// recommendation (R6.5, R17.3).
export function pathSummary(c, state) {
  if (!c || !state) return null;
  return {
    laneNow: state.lane + 1,
    laneTarget: state.targetLane + 1,
    altNowFt: c.altsFt[state.alt],
    altTargetFt: c.altsFt[state.targetAlt],
    antiIce: Boolean(state.antiIce),
    aheadLevel: gateLevel(c, state.targetLane, state.step, state.targetAlt),
    aheadKm: Math.round(GATE_LOOKAHEAD_CELLS * c.stepKm),
  };
}

// Revision f (R25.1, R25.2): the evidence level of the next K km at the settings each lane or altitude button
// would set, by the same rule as R24.2 (`gateLevel`). Disabled buttons and anti-ice get no level (anti-ice does not
// change the evidence). Evidence only: no cost, no order, no preferred choice.
export const LEVEL_SHORT = Object.freeze(["Not assessed", "Not indicated", "Possible (forecast)", "Observed (satellite)"]);
export const CHOICE_ACTIONS = Object.freeze(["flyThrough", "climbOver", "descend", "goLeft", "goRight"]);
export function choiceLevels(c, state, mode) {
  const out = {};
  if (!c || !state) return out;
  const enabled = new Map(gateButtons(c, state, mode).map((b) => [b.action, !b.disabled]));
  for (const a of CHOICE_ACTIONS) {
    if (!enabled.get(a)) continue;
    const next = applyGateAction(c, state, a);
    out[a] = gateLevel(c, next.targetLane, state.step, next.targetAlt);
  }
  return out;
}
// Accessible name of a choice button: the label and the full level name (R25.1).
export function choiceAriaLabel(label, level, names, aheadKm) {
  if (level === undefined || level === null) return label;
  const name = (Array.isArray(names) && (names[level] || names[0])) || LEVEL_SHORT[level] || "Not assessed";
  return `${label}. Next ${aheadKm} km at that setting: ${name}.`;
}

const fmtFt = (v) => `${Math.round(v).toLocaleString("en-US")} ft`;
const ARROW = "\u2192";

// Two lines for the gate panel. A changed target shows as "now -> target", so a press has a visible result at once.
export function pathLines(summary, names) {
  if (!summary) return [];
  const s = summary;
  const lane = s.laneTarget === s.laneNow ? `lane ${s.laneNow}` : `lane ${s.laneNow} ${ARROW} ${s.laneTarget}`;
  const alt = s.altTargetFt === s.altNowFt ? fmtFt(s.altNowFt) : `${fmtFt(s.altNowFt)} ${ARROW} ${fmtFt(s.altTargetFt)}`;
  // an unknown level never prints an empty name: it falls back to level 0, Not assessed
  const name = (Array.isArray(names) && (names[s.aheadLevel] || names[0])) || "Not assessed";
  return [
    `Your settings: ${lane}, ${alt}, anti-ice ${s.antiIce ? "on" : "off"}.`,
    `Next ${s.aheadKm} km at the target: ${name}.`,
  ];
}

// Key line under the gate buttons (R17.4 keys, shown in words so a viewer of the video can follow them).
export const KEY_HINT = "Keys: \u2191 \u2193 altitude, \u2190 \u2192 lane, A anti-ice, Space continue.";

// The 2D side-view inset is shown at a gate only (R17.5).
export const insetVisible = (mode) => mode === "gate";

// View for renderScene: the side view of the selected (target) lane. The engine state is not changed.
export function insetView(view) {
  const st = view && view.state;
  if (!view || !view.engineCase || !st) return view;
  return { ...view, state: { ...st, lane: st.targetLane }, prev: null, frac: 1 };
}
