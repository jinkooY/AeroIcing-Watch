// Parity runner (CD-P7): replays action scripts on a case file with static/cloud-dive/engine.js and
// prints the full state after every operation as JSON.
// usage: node parity_runner.mjs <engine.js> <case.json> <scripts.json>
// op forms: ["set", lane|null, alt|null, antiIce|null], ["step"], ["gate"]
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const [enginePath, casePath, scriptsPath] = process.argv.slice(2);
const E = await import(pathToFileURL(path.resolve(enginePath)).href);
const c = E.loadCase(JSON.parse(readFileSync(casePath, "utf8")));
const scripts = JSON.parse(readFileSync(scriptsPath, "utf8"));

const snap = (state, reason) => ({
  reason,
  step: state.step, lane: state.lane, alt: state.alt, targetLane: state.targetLane,
  targetAlt: state.targetAlt, antiIce: state.antiIce, ice: state.ice, cost: state.cost,
  kmPerLevel: state.kmPerLevel, antiIceKm: state.antiIceKm, minutes: state.minutes,
  minutesAntiIce: state.minutesAntiIce, prevLevel: state.prevLevel, prev2Level: state.prev2Level,
  lastIcingStep: state.lastIcingStep, announcedEntry: state.announcedEntry, iceGateDone: state.iceGateDone, status: state.status, events: state.events,
  totalUsd: E.totalUsd(c, state),
});

const out = scripts.map((ops) => {
  let state = E.initialState(c);
  const trace = [];
  for (const op of ops) {
    let reason = null;
    if (op[0] === "set") state = E.setTargets(c, state, op[1], op[2], op[3]);
    else if (op[0] === "step") state = E.step(c, state);
    else if (op[0] === "gate") {
      if (state.status === "flying") {
        const r = E.runUntilGate(c, state);
        state = r.state; reason = r.reasons;
      }
    }
    trace.push(snap(state, reason));
  }
  return trace;
});
process.stdout.write(JSON.stringify(out));
