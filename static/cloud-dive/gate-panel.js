// Gate choice buttons and the 2D side-view inset for the cockpit view (task 15.4, R17.1, R17.2, R17.5).
// All behaviour comes from gate-controls.js and the existing flight controller; this file only builds the DOM.
// Evidence only: no cost preview and no recommended choice (R6.5, R9.4, R17.3).
// Keyboard handling stays in controls.js (it uses keyAction from gate-controls.js).

import { renderScene } from "./render.js";
import { fitCanvas } from "./view-helpers.js";
import { gateButtons, dispatchAction, insetVisible, insetView } from "./gate-controls.js";

// deps: { root, controller, getStore, subscribe }. Returns { setCockpit(on), dispose() }.
export function initGatePanel(deps) {
  const { root, controller, getStore, subscribe } = deps;
  let cockpit = false;
  let css = { w: 320, h: 180 };

  const group = document.createElement("div");
  group.className = "gate-choices";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Gate choices");
  const buttons = new Map();
  const inset = document.createElement("canvas");
  inset.className = "gate-inset";
  inset.width = 320;
  inset.height = 180;
  inset.setAttribute("role", "img");
  inset.setAttribute("aria-label", "Side view of the selected lane ahead");
  root.replaceChildren(inset, group);

  function ensureButtons(list) {
    if (buttons.size) return;
    for (const b of list) {
      const n = document.createElement("button");
      n.type = "button";
      n.className = "gate-btn";
      n.dataset.action = b.action;
      n.addEventListener("click", () => dispatchAction(controller, () => getStore().state, b.action));
      buttons.set(b.action, n);
      group.append(n);
    }
  }

  function paint() {
    const s = getStore();
    if (!s.engineCase || !s.state || !insetVisible(controller.getMode())) return;
    const ctx = inset.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, css.w, css.h);
    renderScene(inset, insetView({ caseData: s.caseData, engineCase: s.engineCase, state: s.state, message: "" }),
      { legend: false, width: css.w, height: css.h });
  }

  const stopFit = fitCanvas(inset, (w, h) => { css = { w, h }; paint(); });

  function render() {
    const s = getStore();
    const on = cockpit && Boolean(s.engineCase && s.state);
    root.hidden = !on;
    if (!on) return;
    const mode = controller.getMode();
    const list = gateButtons(s.engineCase, s.state, mode);
    ensureButtons(list);
    for (const b of list) {
      const n = buttons.get(b.action);
      n.textContent = b.label;
      n.disabled = b.disabled;
      if (b.action === "toggleAntiIce") n.setAttribute("aria-pressed", String(s.state.antiIce));
    }
    inset.hidden = !insetVisible(mode);
    paint();
  }

  subscribe(() => { controller.sync(); render(); });
  root.hidden = true;

  return {
    setCockpit(on) { cockpit = Boolean(on); render(); },
    dispose() { if (typeof stopFit === "function") stopFit(); root.replaceChildren(); },
  };
}
