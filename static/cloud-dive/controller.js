// Cloud Dive flight controller: DOM-free ES module (task 8.3).
// Drives the engine on a timer ("fast-forward") and stops at a gate, at the end of the flight, or when
// the player pauses. Pausing and target changes happen between steps only, because a step is one
// synchronous engine call. The controller never shows or computes a cost preview and never picks a
// choice for the player (R6.5, R9.4).
//
// Modes: "paused" (also the mode before the first step), "running", "gate", "ended".

import * as engine from "./engine.js";

export const TICK_MS = 200;

// deps: { getCase, getState, setState, onChange?, schedule?, cancel?, tickMs? }
//   schedule(fn, ms) -> handle, cancel(handle): default to setTimeout/clearTimeout (tests inject fakes).
export function createController(deps) {
  const { getCase, getState, setState } = deps;
  const onChange = deps.onChange || (() => {});
  const schedule = deps.schedule || ((fn, ms) => setTimeout(fn, ms));
  const cancel = deps.cancel || ((h) => clearTimeout(h));
  const tickMs = deps.tickMs ?? TICK_MS;

  let mode = "paused";
  let reason = null;      // first gate reason ('ice' | 'exit' | 'entry') or 'arrived' | 'diverted' (ended)
  let reasons = [];       // all reasons of the current gate, in order (one gate per boundary)
  let timer = null;
  let startChecked = false; // the gate check at step 0 runs once per flight
  let known = null;         // last state seen; a different state means the app replaced the flight

  function commit(next) {
    known = next;
    setState(next);
  }

  function stopTimer() {
    if (timer !== null) cancel(timer);
    timer = null;
  }

  function flying() {
    const st = getState();
    return Boolean(getCase() && st && st.status === "flying");
  }

  // Forget everything about the previous flight (new case or back to the picker).
  function reset() {
    stopTimer();
    mode = "paused";
    reason = null;
    reasons = [];
    startChecked = false;
    known = getState();
  }

  // Call before reading the controller from a store listener.
  function sync() {
    if (getState() !== known) reset();
  }

  function announced(c, st, list) {
    // a skipped entry never sets the announced entry
    let out = st;
    if (list.includes("ice")) out = { ...out, iceGateDone: true };
    if (list.includes("entry")) out = { ...out, announcedEntry: engine.entryIndex(c, st) };
    return out;
  }

  function enterGate(c, st, list) {
    mode = "gate";
    reasons = list;
    reason = list[0];
    commit(announced(c, st, list));
    onChange();
  }

  function tick() {
    timer = null;
    if (mode !== "running") return;
    const c = getCase();
    let st = getState();
    if (!c || !st || st.status !== "flying") {
      mode = "ended";
      reason = st ? st.status : null;
      onChange();
      return;
    }
    if (!startChecked && st.step === 0) {
      startChecked = true;
      const list = engine.gateReasons(c, st);
      if (list.length) return enterGate(c, st, list);
    }
    st = engine.step(c, st);
    if (st.status !== "flying") {
      mode = "ended";
      reason = st.status;
      commit(st);
      onChange();
      return;
    }
    const list = engine.gateReasons(c, st);
    if (list.length) return enterGate(c, st, list);
    commit(st);
    timer = schedule(tick, tickMs);
  }

  function run() {
    sync();
    if (!flying() || mode === "running") return;
    mode = "running";
    reason = null;
    reasons = [];
    onChange();
    timer = schedule(tick, tickMs);
  }

  function pause() {
    sync();
    if (mode !== "running") return;
    stopTimer();
    mode = "paused";
    onChange();
  }

  function toggle() {
    sync();
    if (mode === "running") pause();
    else run();
  }

  // Target edits are allowed in every mode while the flight is on; they apply from the next step.
  function edit(lane, alt, antiIce) {
    sync();
    if (!flying()) return;
    const c = getCase();
    commit(engine.setTargets(c, getState(), lane, alt, antiIce));
    onChange();
  }

  const setLane = (i) => edit(i, null, null);
  const setAlt = (i) => edit(null, i, null);
  const moveLane = (d) => { sync(); if (flying()) edit(getState().targetLane + d, null, null); };
  const moveAlt = (d) => { sync(); if (flying()) edit(null, getState().targetAlt + d, null); };
  const toggleAntiIce = () => { sync(); if (flying()) edit(null, null, !getState().antiIce); };

  return {
    getMode: () => mode,
    getReason: () => reason,
    getReasons: () => reasons.slice(),
    sync, reset, run, pause, toggle, setLane, setAlt, moveLane, moveAlt, toggleAntiIce,
  };
}
