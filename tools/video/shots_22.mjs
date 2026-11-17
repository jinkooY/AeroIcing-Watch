// Screenshots at 1920x1080 for group 22 (task 22.1 "before", task 22.7 "after"). Plays the demo plan of
// `gate_plan.mjs` (climb to 12,000 ft and anti-ice on at gate 1, on at entry gates, off at exit gates, lane never
// changed) with the page's own buttons, and saves: <prefix>-gate1.png (first gate), <prefix>-gate5.png (the first
// Observed gate, 500 km), <prefix>-incloud.png (inside the cloud block after gate 5) and <prefix>-report.png.
// It also prints the real time of the whole flight and the report total (the demo plan should end at about $3,312).
// No game code is changed or called beyond the page's own buttons. Headless browser through browser_guard.
// Usage: node tools/video/shots_22.mjs --prefix=22.0 [--out=docs/screens] [--timeout=300] [--query=&video=1]
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startGuard } from "../browser_guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (name, dflt) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : dflt;
};
const prefix = arg("prefix", "22.0");
const outDir = path.resolve(root, arg("out", "docs/screens"));
mkdirSync(outDir, { recursive: true });

const plan = JSON.parse(spawnSync("node", [path.join(root, "tools/video/gate_plan.mjs"), "--json"], { encoding: "utf8" }).stdout.trim().split(/\r?\n/).pop());
const byKm = new Map(plan.gates.map((g) => [g.km, g]));

const problems = [];
const onMessage = (m) => {
  if (m.method === "Runtime.exceptionThrown") problems.push("exception: " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") problems.push("console.error: " + m.params.args.map((a) => a.value ?? a.description).join(" "));
};
const guard = await startGuard({ root, onMessage, extraArgs: ["--ignore-gpu-blocklist", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"] });
const { base, send, evaluate, sleep } = guard;
const saved = {};
async function shot(name) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  const file = `${prefix}-${name}.png`;
  writeFileSync(path.join(outDir, file), Buffer.from(r.data, "base64"));
  saved[file] = true;
  console.log("saved", file);
}
const km = async () => Number(await evaluate(`(() => { const m = document.body.innerText.match(/(\\d[\\d,]*)\\s+of\\s+[\\d,]+\\s*km/); return m ? Number(m[1].replace(/,/g, "")) : -1; })()`));
const atGate = () => evaluate(`Boolean(document.getElementById("gate-panel")?.classList.contains("is-gate"))`);
const clickChoice = (re) => evaluate(`(() => { const b = [...document.querySelectorAll("#gate-choices button")].find((x) => ${re}.test(x.textContent)); if (!b) return false; b.click(); return true; })()`);
const antiIceOn = () => evaluate(`(() => { const b = [...document.querySelectorAll("#gate-choices button")].find((x) => /anti-ice/i.test(x.textContent)); return b ? b.getAttribute("aria-pressed") === "true" : null; })()`);
async function setAntiIce(want) {
  const now = await antiIceOn();
  if (now !== null && now !== want) await clickChoice("/anti-ice/i");
}

let status = "no report";
try {
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${base}/static/cloud-dive/index.html?case=20261112-kjfk-kbna-1930z${arg("query", "")}` });
  const t0 = Date.now();
  while (Date.now() - t0 < 30000 && !(await evaluate(`(() => { const t = document.getElementById("takeoff-btn"); return !!t && !t.hidden; })()`))) await sleep(200);
  await sleep(1200);
  await evaluate(`document.getElementById("takeoff-btn").click()`);
  const flightStart = Date.now();
  let handled = -1, inCloudShot = false, gate5Done = false, approachShot = false;
  // After takeoff and climb the panel reads "Ready at the start". One Continue opens gate 1 (the engine reports a gate at step 0).
  // Press it once and wait for the gate: a second press before the gate shows would fly past it.
  while (Date.now() - flightStart < 60000) {
    await evaluate(`(() => { const s = document.getElementById("skip-btn"); if (s && !s.hidden) s.click(); })()`);
    const ready = await evaluate(`/Ready at the start/.test(document.getElementById("gate-panel")?.innerText || "") && !document.body.classList.contains("lead-active")`);
    if (ready) break;
    await sleep(200);
  }
  await sleep(500);
  await clickChoice("/^continue$/i");
  for (let i = 0; i < 40 && !(await atGate()); i++) await sleep(150);
  console.log("gate 1 open:", await atGate(), "after", ((Date.now() - flightStart) / 1000).toFixed(1), "s");
  while (Date.now() - flightStart < 240000) {
    if (await evaluate(`document.getElementById("dlg-report")?.open`)) break;
    await evaluate(`(() => { const s = document.getElementById("skip-btn"); if (s && !s.hidden) s.click(); })()`);
    if (!gate5Done && !approachShot) {
      const d0 = await km();
      if (d0 >= 460 && d0 <= 497 && !(await atGate())) { await shot("approach"); approachShot = true; }
    }
    if (gate5Done && !inCloudShot) {
      const d = await km();
      if (d >= 540 && d <= 590 && !(await atGate())) { await shot("incloud"); inCloudShot = true; }
    }
    if (await atGate()) {
      const d = await km();
      const g = byKm.get(d);
      if (g && g.n !== handled) {
        handled = g.n;
        await sleep(900);
        if (g.n === 1) await shot("gate1");
        if (g.n === 5) { await shot("gate5"); gate5Done = true; }
        if (g.n === 1) {
          for (let i = 0; i < 3; i++) await clickChoice("/climb over/i");
          await setAntiIce(true);
        } else if (g.reasons.includes("exit")) await setAntiIce(false);
        else await setAntiIce(true);
        await sleep(300);
        await clickChoice("/continue/i");
      } else if (!g) {
        console.log("gate at an unplanned km:", d, "(continuing)");
        await clickChoice("/continue/i");
      }
    } else {
      // After the climb the panel says "Ready at the start" for a moment and then opens gate 1 by itself: do not press
      // Continue there. Only a pause between gates ("Paused at N km") needs Continue.
      await evaluate(`(() => { const p = document.getElementById("gate-panel"); if (!p || !/^\s*Flight status\s*Paused at/i.test(p.innerText)) return; const b = [...document.querySelectorAll("#gate-choices button")].find((x) => /^continue$/i.test(x.textContent.trim()) && !x.disabled); if (b) b.click(); })()`);
      await sleep(800);
    }
    if (arg("trace", "") && Math.round((Date.now() - flightStart) / 150) % 33 === 0) console.log("trace", Math.round((Date.now() - flightStart) / 1000), "s", await evaluate(`[document.getElementById("gate-panel")?.className, document.getElementById("gate-panel")?.innerText.slice(0, 60).replace(/\\n/g, " "), (document.body.innerText.match(/\\d+ of \\d+ km/) || [""])[0]].join(" | ")`));
    await sleep(150);
  }
  const open = await evaluate(`document.getElementById("dlg-report")?.open`);
  if (open) {
    await sleep(800);
    await shot("report");
    const text = await evaluate(`document.getElementById("dlg-report").innerText`);
    status = (text.match(/Total fuel cost:\s*\$[\d,]+/) || ["report without total"])[0];
  }
  console.log(`flight time from takeoff click to report: ${((Date.now() - flightStart) / 1000).toFixed(0)} s`);
  console.log(status, `(plan: $${Math.round(plan.demoTotalUsd).toLocaleString("en-US")})`);
} finally {
  if (problems.length) console.log("page problems:", problems.slice(0, 5));
  await guard.close();
}
