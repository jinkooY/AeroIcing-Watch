// Frame rate of the cockpit view at 1920x1080 on a chosen GPU (task 22.6). Opens KJFK-KBNA with ?perf=1, flies to gate 1,
// presses Continue until about 300 frames are counted (the page's own `window.__cdPerf`), and prints fps and frame gaps.
// The browser decides which GPU Windows gives it; --gpu=low asks for the integrated one (the one measured in task 15.6:
// Intel UHD 770), --gpu=high for the discrete one, default leaves the choice to the system. The WebGL renderer is printed.
// Usage: node tools/video/perf_check.mjs [--gpu=low|high|default] [--query=&video=1] [--size=1920x1080] [--json=<file>]
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startGuard } from "../browser_guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (name, dflt) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : dflt;
};
const gpu = arg("gpu", "default");
const [w, h] = arg("size", "1920x1080").split("x").map(Number);
const gpuArgs = gpu === "low" ? ["--force_low_power_gpu"] : gpu === "high" ? ["--force_high_performance_gpu"] : [];
const g = await startGuard({ root, extraArgs: ["--ignore-gpu-blocklist", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", ...gpuArgs] });
const { base, send, evaluate, sleep } = g;
let out = null;
try {
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${base}/static/cloud-dive/index.html?case=20261112-kjfk-kbna-1930z&perf=1${arg("query", "")}` });
  const t0 = Date.now();
  while (Date.now() - t0 < 30000 && !(await evaluate(`(() => { const t = document.getElementById("takeoff-btn"); return !!t && !t.hidden; })()`))) await sleep(200);
  await sleep(1200);
  await evaluate(`document.getElementById("takeoff-btn").click()`);
  for (let i = 0; i < 300; i++) {
    await evaluate(`(() => { const s = document.getElementById("skip-btn"); if (s && !s.hidden) s.click(); })()`);
    if (await evaluate(`/Ready at the start/.test(document.getElementById("gate-panel")?.innerText || "") && !document.body.classList.contains("lead-active")`)) break;
    await sleep(200);
  }
  await sleep(400);
  const clickContinue = () => evaluate(`(() => { const b = [...document.querySelectorAll("#gate-choices button")].find((x) => /^continue$/i.test(x.textContent.trim())); if (b) b.click(); })()`);
  await clickContinue();
  for (let i = 0; i < 40 && !(await evaluate(`Boolean(document.getElementById("gate-panel")?.classList.contains("is-gate"))`)); i++) await sleep(150);
  const read = () => evaluate("window.__cdPerf ? JSON.stringify(window.__cdPerf()) : null").then((v) => (v ? JSON.parse(v) : null));
  let p = await read();
  const t1 = Date.now();
  while (Date.now() - t1 < 20000 && (!p || p.frames < 300)) {
    await clickContinue();
    await sleep(1500);
    p = await read();
  }
  const gl = await evaluate(`(() => { const c = document.createElement("canvas"); const x = c.getContext("webgl"); const e = x && x.getExtension("WEBGL_debug_renderer_info"); return e ? x.getParameter(e.UNMASKED_RENDERER_WEBGL) : "unknown"; })()`);
  out = { gpuRequest: gpu, size: `${w}x${h}`, query: arg("query", ""), webglRenderer: gl, measuredAt: new Date().toISOString(), perf: p };
} finally {
  await g.close();
}
console.log(JSON.stringify(out, null, 2));
if (arg("json", "")) writeFileSync(path.resolve(root, arg("json", "")), JSON.stringify(out, null, 2));
