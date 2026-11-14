// Cloud Dive controls and gate panel (task 8.3). Fills #controls.
// Evidence only: no cost preview and no recommended choice (R6.5, R9.4).
// Keyboard: arrow left/right = target lane, arrow up/down = target altitude, A = anti-ice,
// Space = continue or pause. Buttons are at least 44 px high for pointer and touch.

import { createController } from "./controller.js";
import { keyAction, dispatchAction, GATE_LABELS } from "./gate-controls.js";

// The one label of the button that starts or resumes the flight; the status text names the same constant.
const goLabel = GATE_LABELS.continue;

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "text") node.textContent = v;
    else if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  for (const ch of children) node.append(ch);
  return node;
}

// deps: { root, getStore, subscribe, setState, formatFt, formatLane }
export function initControls(deps) {
  const { root, getStore, subscribe, setState, formatFt } = deps;
  // Task 12.3: while a dialog is open the game keys must not act on the flight. game.js passes a check
  // built on routeKey; without one every key is allowed (older callers and tests).
  const gameKeysAllowed = deps.gameKeysAllowed || (() => true);

  const controller = createController({
    getCase: () => getStore().engineCase,
    getState: () => getStore().state,
    setState,
    onChange: () => render(getStore()),
  });

  // ---- static DOM ----
  const live = el("p", { id: "gate-live", class: "gate-live sr-only", role: "status", "aria-live": "polite", "aria-atomic": "true" });
  // Fixed-height status area (task 12.2): always present, so a gate never moves the layout. It shows the
  // gate text at a gate and the flight status otherwise; overflow scrolls inside (tabindex for keyboard).
  const gatePanel = el("div", { id: "gate-panel", class: "gate-panel", role: "group", tabindex: "0" });
  const gateTitle = el("h3", { id: "gate-title", tabindex: "-1", text: "Decision gate" });
  const gateText = el("p", { id: "gate-text" });
  gatePanel.append(gateTitle, gateText);
  gatePanel.setAttribute("aria-labelledby", "gate-title");

  const laneButtons = [];
  const laneGroup = el("div", { class: "ctl-buttons", role: "group", "aria-label": "Target lane" });
  const laneNote = el("p", { class: "ctl-note", id: "ctl-lane-note" });

  const altDown = el("button", { type: "button", id: "ctl-alt-down", text: "Lower" });
  const altUp = el("button", { type: "button", id: "ctl-alt-up", text: "Higher" });
  const altValue = el("output", { id: "ctl-alt-value", class: "ctl-value", "aria-live": "off" });
  const altGroup = el("div", { class: "ctl-buttons", role: "group", "aria-label": "Target altitude" },
    [altDown, altValue, altUp]);

  const aiBtn = el("button", { type: "button", id: "ctl-anti-ice", class: "ctl-toggle", "aria-pressed": "false" });
  const goBtn = el("button", { type: "button", id: "ctl-go", class: "ctl-go" });

  const laneField = el("fieldset", { class: "ctl-field" }, [el("legend", { text: "Lane (dot = aircraft)" }), laneGroup, laneNote]);
  const altField = el("fieldset", { class: "ctl-field" }, [el("legend", { text: "Altitude" }), altGroup]);
  const aiField = el("fieldset", { class: "ctl-field" }, [el("legend", { text: "Anti-ice" }), aiBtn]);
  const goField = el("div", { class: "ctl-field ctl-go-field" }, [goBtn]);
  const keys = el("p", { class: "small ctl-keys", text: "Keys: left and right arrows set the lane, up and down arrows set the altitude, A switches anti-ice, M switches the map image between IR and phase, L opens or closes this legend, Escape closes any dialog, Space continues or pauses. The aircraft moves at most one lane and 1,000 ft per step toward the targets." });

  const row = el("div", { class: "ctl-row" }, [laneField, altField, aiField, goField]);
  root.replaceChildren(live, gatePanel, row, keys);

  altDown.addEventListener("click", () => controller.moveAlt(-1));
  altUp.addEventListener("click", () => controller.moveAlt(1));
  aiBtn.addEventListener("click", () => controller.toggleAntiIce());
  goBtn.addEventListener("click", () => controller.toggle());

  function ensureLaneButtons(c) {
    if (laneButtons.length === c.nLanes) return;
    laneGroup.replaceChildren();
    laneButtons.length = 0;
    for (let i = 0; i < c.nLanes; i++) {
      const b = el("button", { type: "button", class: "ctl-lane" });
      b.addEventListener("click", () => controller.setLane(i));
      laneButtons.push(b);
      laneGroup.append(b);
    }
  }

  function offsetText(c, i) {
    const km = c.lanesKm[i];
    return km === 0 ? "centre" : `${km > 0 ? "+" : "-"}${Math.abs(km)} km`;
  }

  // One sentence per reason that holds at the boundary (design sections 7 and 9). No costs, no advice.
  function reasonText(c, st, why) {
    if (why === "ice") return "Ice index (game model) reached 50 of 100.";
    if (why === "exit") {
      return "The aircraft is outside Possible and Observed cells with anti-ice on, and none follow within the next 5 segments.";
    }
    const idx = st.announcedEntry;
    const km = idx == null ? null : Math.max(0, (idx - st.step) * c.stepKm);
    const where = km === null ? "ahead" : km === 0 ? "at the next segment" : `in about ${Math.round(km)} km`;
    return `Cells at the Possible (forecast only) or Observed supercooled layer level begin ${where} on the current targets.`;
  }

  function gateMessage(c, st, reasons) {
    return `${reasons.map((why) => reasonText(c, st, why)).join(" ")} Set lane, altitude and anti-ice, then continue.`;
  }

  function gateHeading(reasons) {
    if (reasons.length > 1) return "Decision gate: several reasons";
    if (reasons[0] === "ice") return "Decision gate: ice index";
    return reasons[0] === "exit" ? "Decision gate: left the cells" : "Decision gate: cloud evidence ahead";
  }
  let lastAnnounced = "";

  function render(s) {
    const c = s.engineCase;
    const st = s.state;
    if (!c || !st) {
      root.hidden = true;
      return;
    }
    root.hidden = false;
    ensureLaneButtons(c);
    const mode = controller.getMode();
    const why = controller.getReason();
    const reasons = controller.getReasons();
    const active = st.status === "flying";

    laneButtons.forEach((b, i) => {
      const target = i === st.targetLane;
      const here = i === st.lane;
      b.textContent = `${i + 1}${here ? " \u2022" : ""}`;
      b.append(el("span", { class: "ctl-sub", text: c.lanesKm[i] === 0 ? "0 km" : offsetText(c, i) }));
      b.setAttribute("aria-pressed", String(target));
      b.setAttribute("aria-label",
        `Lane ${i + 1} of ${c.nLanes}, ${offsetText(c, i)}${here ? ", aircraft is here" : ""}${target ? ", target" : ""}`);
      b.classList.toggle("is-here", here);
      b.disabled = !active;
    });
    laneNote.textContent = `Target lane ${st.targetLane + 1}, aircraft in lane ${st.lane + 1}.`;

    altValue.textContent = `Target ${formatFt(c.altsFt[st.targetAlt])} (aircraft ${formatFt(c.altsFt[st.alt])})`;
    altDown.disabled = !active || st.targetAlt <= 0;
    altUp.disabled = !active || st.targetAlt >= c.nAlts - 1;
    altDown.setAttribute("aria-label", "Lower target altitude by 1,000 ft");
    altUp.setAttribute("aria-label", "Raise target altitude by 1,000 ft");

    aiBtn.textContent = st.antiIce ? "Anti-ice: On" : "Anti-ice: Off";
    aiBtn.setAttribute("aria-pressed", String(st.antiIce));
    aiBtn.setAttribute("aria-label", `Anti-ice switch, currently ${st.antiIce ? "on" : "off"}`);
    aiBtn.disabled = !active;

    goBtn.textContent = mode === "running" ? GATE_LABELS.pause : goLabel;
    goBtn.disabled = !active;

    const km = Math.round(st.step * c.stepKm);
    let message;
    if (mode === "gate") message = gateMessage(c, st, reasons);
    else if (mode === "ended" || !active) {
      message = st.status === "diverted" ? "Flight ended: forced diversion (not ranked)." : "Flight ended: arrived.";
    } else if (mode === "running") message = "Fast-forwarding. Press Pause to stop between steps.";
    else message = st.step === 0 ? `Ready at the start. Set the targets, then press ${goLabel}.` : `Paused at ${km} km.`;

    gatePanel.classList.toggle("is-gate", mode === "gate");
    gateTitle.textContent = mode === "gate" ? gateHeading(reasons.length ? reasons : [why]) : "Flight status";
    gateText.textContent = message;

    // Live region: announce only when the situation changes, not on every step.
    const key = `${mode}|${reasons.join("+") || why}|${mode === "gate" || mode === "ended" ? st.step : ""}`;
    if (key !== lastAnnounced) {
      lastAnnounced = key;
      live.textContent = mode === "gate" ? `Decision gate at ${km} km. ${message}` : message;
      if (mode === "gate") gateTitle.focus({ preventScroll: false });
    }
  }

  // ---- keyboard ----
  function inFlight() {
    const s = getStore();
    return Boolean(s.engineCase && s.state) && !root.hidden;
  }

  function typing(t) {
    return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
  }

  function outsideButton(t) {
    return t && t.tagName === "BUTTON" && !root.contains(t);
  }

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || !inFlight()) return;
    if (!gameKeysAllowed(e)) return;
    if (typing(e.target) || outsideButton(e.target)) return;
    const action = keyAction(e.key);
    if (!action) return;
    if (!(action === "toggleRun" && e.repeat)) dispatchAction(controller, () => getStore().state, action);
    e.preventDefault();
  });
  // A focused button would also click on Space key-up; the keydown already handled it.
  document.addEventListener("keyup", (e) => {
    if ((e.key === " " || e.key === "Spacebar") && inFlight() && gameKeysAllowed(e) && !typing(e.target) && !outsideButton(e.target)) {
      e.preventDefault();
    }
  });

  subscribe((s) => {
    controller.sync();
    render(s);
  });
  return controller;
}
