// Screenshot recorder for the visual-polish group (tasks 21.1 and 21.9). Node built-ins plus an installed Edge or Chrome only.
// Opens one case at 1280x720 in the cockpit view and saves: <prefix>-start.png (ready, before takeoff), <prefix>-gate.png
// (first gate), <prefix>-frost-<n>.png (the first time the ice index is above 0, and again at 25 and 50 when reached while
// flying, with Continue at every gate) and <prefix>-report.png (the report dialog). Writes <prefix>-shots.json with the
// ice index at each shot, the report status (ranked or diverted) and any console errors. No game code is changed or called
// beyond the page's own buttons.
// Usage: node tools/shots_21.mjs --prefix=21.0 [--case=kjfk-kbna] [--out=docs/screens]
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startGuard } from "./browser_guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, dflt) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : dflt;
};
const prefix = arg("prefix", "21.0");
const only = arg("case", "kjfk-kbna");
const outDir = path.resolve(root, arg("out", "docs/screens"));
const problems = [];
const onMessage = (m) => {
 if (m.method === "Runtime.exceptionThrown") problems.push("exception: " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
 if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") problems.push("console.error: " + m.params.args.map((a) => a.value ?? a.description).join(" "));
 if (m.method === "Log.entryAdded" && m.params.entry.level === "error" && !/favicon\.ico/.test(m.params.entry.url || "")) problems.push("log: " + m.params.entry.text);
};
const guard = await startGuard({ root, extraArgs: ["--ignore-gpu-blocklist", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--disable-features=IntensiveWakeUpThrottling"], onMessage });
const { base, send, evaluate, sleep } = guard;
const index = JSON.parse(readFileSync(path.join(root, "static/cloud-dive/cases/index.json"), "utf8"));
const caseId = index.cases.map((c) => c.id).find((id) => id.includes(only));
if (!caseId) throw new Error("no case matches " + only);
async function waitFor(expression, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await evaluate(expression)) return true; await sleep(150); }
  return false;
}
const result = { case: caseId, prefix, viewport: "1280x720", measuredAt: new Date().toISOString(), shots: {}, problems };
async function shot(name, extra = {}) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  const file = `${prefix}-${name}.png`;
  writeFileSync(path.join(outDir, file), Buffer.from(r.data, "base64"));
  result.shots[file] = { ice: await ice(), ...extra };
  console.log("saved", file, JSON.stringify(result.shots[file]));
}
const ice = async () => Number(await evaluate(`Number(document.getElementById("hud-ice-bar")?.getAttribute("aria-valuenow") ?? -1)`));

mkdirSync(outDir, { recursive: true });
try {
  await send("Page.enable"); await send("Runtime.enable"); await send("Log.enable");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${base}/static/cloud-dive/index.html?case=${caseId}` });
  await waitFor(`(() => { const t = document.getElementById("takeoff-btn"); return t && !t.hidden; })()`, 30000);
  await sleep(1500);
  result.view = (await evaluate(`document.body.classList.contains("view-cockpit")`)) ? "cockpit" : "other";
  await shot("start");

  await evaluate(`document.getElementById("takeoff-btn").click()`);
  const taken = new Set();
  let gateShot = false, antiOn = false;
  const t0 = Date.now();
  while (Date.now() - t0 < Number(arg("max", "900")) * 1000) {
    if (await evaluate(`document.getElementById("dlg-report").open`)) break;
    const atGate = await evaluate(`Boolean(document.getElementById("gate-panel")?.classList.contains("is-gate"))`);
    const level = await ice();
    for (const th of [1, 25, 50]) {
      if (level >= th && !taken.has(th)) { taken.add(th); await shot(`frost-${th === 1 ? "first" : th}`, { atGate }); }
    }
    if (atGate && !gateShot) { await sleep(900); await shot("gate"); gateShot = true; }
    // Once the ice index has passed 50, switch anti-ice on at the next gate so the flight can end ranked.
    if (atGate && taken.has(50) && !antiOn) {
      antiOn = await evaluate(`(() => { const b = [...document.querySelectorAll("#gate-choices button")].find((x) => /anti-ice/i.test(x.textContent));
        if (!b) return false; if (b.getAttribute("aria-pressed") !== "true") b.click(); return true; })()`);
      if (antiOn) { result.antiIceAtIce = level; await sleep(600); await shot("gate-antiice"); }
    }
    await evaluate(`(() => {
      const s = document.getElementById("skip-btn"); if (s && !s.hidden) { s.click(); return; }
      const g = document.getElementById("ctl-go"); const gate = document.getElementById("gate-panel");
      const cont = [...document.querySelectorAll("#gate-choices button")].find((x) => /continue/i.test(x.textContent));
      if (cont) { cont.click(); return; }
      if (g && !g.disabled && !/pause/i.test(g.textContent) && !(gate && gate.classList.contains("is-gate")) && !document.body.classList.contains("lead-active")) g.click();
    })()`);
    if (arg("trace", "") && Math.round((Date.now() - t0) / 400) % 25 === 0) console.log("trace", await evaluate(`[document.querySelector(".hud-item:last-child")?.innerText, document.getElementById("ctl-go")?.textContent, document.getElementById("gate-panel")?.className, document.getElementById("lead-status")?.textContent].join(" | ")`));
    await sleep(400);
  }
  const open = await waitFor(`document.getElementById("dlg-report").open`, 90000);
  if (open) {
    await sleep(800);
    result.reportTitle = await evaluate(`document.getElementById("report-title")?.textContent || ""`);
    result.ranked = result.reportTitle === "Flight report";
    await shot("report", { reportTitle: result.reportTitle });
  } else {
    result.reportTitle = "report did not open";
    result.stuck = await evaluate(`JSON.stringify({ gate: document.getElementById("gate-panel")?.className, status: document.getElementById("lead-status")?.textContent,
      buttons: [...document.querySelectorAll("#gate-choices button")].map((b) => b.textContent.trim() + (b.disabled ? " (off)" : "")),
      go: document.getElementById("ctl-go")?.textContent, goOff: document.getElementById("ctl-go")?.disabled, body: document.body.className })`);
    await shot("timeout");
  }
  result.gateShot = gateShot;
  result.frostShots = [...taken];
} finally {
  writeFileSync(path.join(outDir, `${prefix}-shots.json`), JSON.stringify(result, null, 1));
  if (problems.length) console.log("problems:", problems.slice(0, 5));
  console.log("report:", result.reportTitle, "| ranked:", result.ranked, "| frost thresholds reached:", result.frostShots);
  await guard.close();
}
