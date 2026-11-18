// Gate choice buttons and the 2D side-view inset for the cockpit view (task 15.4, R17.1, R17.2, R17.5).
// All behaviour comes from gate-controls.js and the existing flight controller; this file only builds the DOM.
// Evidence only: no cost preview and no recommended choice (R6.5, R9.4, R17.3).
// Keyboard handling stays in controls.js (it uses keyAction from gate-controls.js).

import { renderScene } from "./render.js";
import { fitCanvas } from "./view-helpers.js";
import { gateButtons, dispatchAction, insetVisible, insetView, KEY_HINT } from "./gate-controls.js";
import { COST_RULES_TITLE, COST_RULES } from "./cost-rules.js";

// deps: { root, controller, getStore, subscribe }. Returns { setCockpit(on), dispose() }.
export function initGatePanel(deps) {
  const { root, controller, getStore, subscribe } = deps;
  let cockpit = false;
  let lastMode = "";
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
  // Revision e (R24.3, R24.4): the keys in words, and the rules of the cost model in a card the player opens.
  const keysHint = document.createElement("p");
  keysHint.className = "gate-keys";
  keysHint.textContent = KEY_HINT;
  const rules = document.createElement("details");
  rules.className = "cost-rules";
  rules.id = "cost-rules";
  const rulesTitle = document.createElement("summary");
  rulesTitle.textContent = COST_RULES_TITLE;
  const rulesList = document.createElement("ul");
  for (const r of COST_RULES) {
    const li = document.createElement("li");
    li.textContent = r;
    rulesList.append(li);
  }
  rules.append(rulesTitle, rulesList);
  root.replaceChildren(inset, group, keysHint, rules);

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
    // Revision e (R24.7): on a narrow screen the buttons and the settings line can sit below the fold when a gate
    // opens; scroll the page (only the page) once per gate so both show. No effect when they are already visible,
    // as on a desktop screen.
    if (mode === "gate" && lastMode !== "gate") reveal();
    lastMode = mode;
  }
  // Scrolls the page (only the page) just enough that Continue and the settings line show. Runs once when a gate
  // opens, and once when the panel appears at the end of the climb (the player then presses Continue to start;
  // on a Galaxy S25 Ultra, 697 px tall in Chrome, Continue sat 6 px below the fold there). No effect when both
  // are already visible, as on a desktop screen.
  function reveal() {
    if (typeof requestAnimationFrame !== "function") return;
    requestAnimationFrame(() => {
      if (typeof innerHeight !== "number" || typeof scrollBy !== "function") return;
      const parts = [buttons.get("toggleRun"), document.getElementById("gate-path")].filter((e) => e && e.getClientRects().length);
      if (!parts.length) return;
      const bottom = Math.max(...parts.map((e) => e.getBoundingClientRect().bottom));
      if (bottom > innerHeight) scrollBy(0, Math.ceil(bottom - innerHeight + 8));
    });
  }

  subscribe(() => { controller.sync(); render(); });
  root.hidden = true;

  return {
    setCockpit(on) {
      const was = cockpit;
      cockpit = Boolean(on);
      render();
      if (cockpit && !was) reveal(); // the end of the climb: Continue starts the flight
    },
    dispose() { if (typeof stopFit === "function") stopFit(); root.replaceChildren(); },
  };
}
