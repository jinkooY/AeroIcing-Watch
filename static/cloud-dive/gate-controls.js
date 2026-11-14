// Gate choices for the cockpit view (task 15.4, R17). DOM-free: maps the panel actions and keys to the
// existing flight controller (controller.js), which calls engine.setTargets. Nothing here computes or
// shows a cost and nothing picks a choice for the player (R6.5, R9.4, R17.3).

import * as engine from "./engine.js";

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

// The 2D side-view inset is shown at a gate only (R17.5).
export const insetVisible = (mode) => mode === "gate";

// View for renderScene: the side view of the selected (target) lane. The engine state is not changed.
export function insetView(view) {
  const st = view && view.state;
  if (!view || !view.engineCase || !st) return view;
  return { ...view, state: { ...st, lane: st.targetLane }, prev: null, frac: 1 };
}
