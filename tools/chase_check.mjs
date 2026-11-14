// Headless check of the chase view (task 19.2, R16.11, R19.3). Node built-ins plus an installed Edge or Chrome only.
// Opens the first case at 1280x720, starts the flight, presses key C and the #chase-toggle button, and checks: no console
// errors, the 3D canvas is drawn (not blank), the panel and gate controls stay reachable, the layout fits, and the frame
// rate with ?perf=1 in chase view (recorded as measured, with browser and WebGL renderer). Screenshots go to
// docs/screens/19.2-*.png; results to docs/screens/19.2-chase.json.
// Usage: node tools/chase_check.mjs [--gpu=hw|sw] [--case=<id part>] [--out=docs/screens]
import http from "node:http";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, dflt) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : dflt;
};
const outDir = path.resolve(root, arg("out", "docs/screens"));
const gpu = arg("gpu", "hw");
const only = arg("case", "");
const BROWSERS = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
];
const browserPath = BROWSERS.find((p) => existsSync(p));
if (!browserPath) throw new Error("No Edge or Chrome found");

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!file.startsWith(root) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const index = JSON.parse(readFileSync(path.join(root, "static/cloud-dive/cases/index.json"), "utf8"));
const caseId = index.cases.map((c) => c.id).find((id) => id.includes(only));

const profile = mkdtempSync(path.join(tmpdir(), "cdchase-"));
const port = 9800 + Math.floor(Math.random() * 150);
const proc = spawn(browserPath, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--headless=new", "--no-first-run",
  ...(gpu === "sw" ? ["--disable-gpu"] : ["--ignore-gpu-blocklist"]), "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* starting */ }
    await sleep(250);
  }
  throw new Error("browser did not start");
}
const ws = new WebSocket(await connect());
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let nextId = 1;
const waiting = new Map();
const problems = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") problems.push("exception: " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") problems.push("console.error: " + m.params.args.map((a) => a.value ?? a.description).join(" "));
  if (m.method === "Log.entryAdded" && m.params.entry.level === "error" && !/favicon\.ico/.test(m.params.entry.url || "")) problems.push("log: " + m.params.entry.text + " " + (m.params.entry.url || ""));
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  waiting.set(id, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
async function waitFor(expression, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await evaluate(expression)) return true; await sleep(150); }
  return false;
}
async function shot(name) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(path.join(outDir, name), Buffer.from(r.data, "base64"));
  return r.data;
}
// Share of distinct colours in the canvas rectangle of a screenshot: a blank canvas is one flat colour.
const canvasStats = (b64) => evaluate(`(async () => {
  const img = new Image(); img.src = "data:image/png;base64,${b64}"; await img.decode();
  const r = document.getElementById("cockpit-canvas").getBoundingClientRect();
  const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(r.width)); c.height = Math.max(1, Math.round(r.height));
  const g = c.getContext("2d"); g.drawImage(img, r.left, r.top, r.width, r.height, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height).data; const seen = new Set();
  for (let i = 0; i < d.length; i += 16) seen.add((d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | (d[i + 2] >> 3));
  return { w: c.width, h: c.height, colours: seen.size };
})()`);
const key = (k) => Promise.all(["keyDown", "keyUp"].map((type) => send("Input.dispatchKeyEvent", { type, key: k, code: "Key" + k.toUpperCase(), text: type === "keyDown" ? k : undefined })));
const UNREACHABLE = `(() => { let lost = 0;
  for (const n of document.querySelectorAll("button, input, select, a[href]")) {
    const r = n.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0) || n.offsetParent === null || n.closest("dialog:not([open])") || n.closest("[hidden]")) continue;
    let clipped = false;
    for (let a = n.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowY === "hidden" || cs.overflowY === "clip") { const ar = a.getBoundingClientRect(); if (r.bottom > ar.bottom + 1 || r.top < ar.top - 1) { clipped = true; break; } }
    }
    if (clipped || r.bottom > innerHeight + 1 || r.right > innerWidth + 1) lost++;
  } return lost; })()`;

mkdirSync(outDir, { recursive: true });
await send("Page.enable"); await send("Runtime.enable"); await send("Log.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
const checks = {};
let ok = true;
const check = (name, pass, info = "") => { checks[name] = { pass: Boolean(pass), info }; if (!pass) ok = false; };
let perf = null, gl = "?", ver = {};
try {
  await send("Page.navigate", { url: `${base}/static/cloud-dive/index.html?case=${caseId}&layoutcheck=1&perf=1` });
  await waitFor(`document.body.dataset.fits !== undefined`);
  await sleep(1200);
  check("cockpit view active", await evaluate(`document.body.classList.contains("view-cockpit")`));
  check("chase button visible", await evaluate(`(() => { const b = document.getElementById("chase-toggle"); return b && !b.hidden && b.offsetParent !== null; })()`));
  await evaluate(`(() => { const t = document.getElementById("takeoff-btn"); if (t && !t.hidden) t.click(); })()`);
  await waitFor(`!document.body.classList.contains("lead-active")`, 40000);
  await sleep(500);
  // Key C -> chase
  await key("c");
  await sleep(600);
  const viaKey = await evaluate(`document.getElementById("chase-toggle").getAttribute("aria-pressed")`);
  check("key C switches to chase", viaKey === "true", viaKey);
  // Button -> cockpit, button -> chase
  await evaluate(`document.getElementById("chase-toggle").click()`);
  await sleep(400);
  check("button switches back to cockpit", (await evaluate(`document.getElementById("chase-toggle").getAttribute("aria-pressed")`)) === "false");
  await evaluate(`document.getElementById("chase-toggle").click()`);
  await sleep(400);
  check("button switches to chase", (await evaluate(`document.getElementById("chase-toggle").getAttribute("aria-pressed")`)) === "true");
  check("button label", (await evaluate(`document.getElementById("chase-toggle").textContent`)) === "Cockpit view (C)");

  await evaluate(`document.getElementById("ctl-go").click()`);
  await sleep(2500); // flying, chase camera on
  const s1 = await canvasStats(await shot("19.2-chase-1280x720-flying.png"));
  check("3D canvas not blank (flying)", s1.colours >= 8, JSON.stringify(s1));
  const atGate = await waitFor(`document.getElementById("gate-panel") && document.getElementById("gate-panel").classList.contains("is-gate")`, 60000);
  check("reaches a gate in chase view", atGate);
  await sleep(900);
  const s2 = await canvasStats(await shot("19.2-chase-1280x720-gate.png"));
  check("3D canvas not blank (gate)", s2.colours >= 8, JSON.stringify(s2));
  check("layout fits at 1280x720", (await evaluate(`document.body.dataset.fits`)) === "yes", await evaluate(`document.body.dataset.fits`));
  const lost = await evaluate(UNREACHABLE);
  check("panel and gate controls reachable", lost === 0, `unreachable: ${lost}`);
  const choices = await evaluate(`document.querySelectorAll("#gate-choices button").length`);
  check("gate choice buttons present", choices > 0, String(choices));
  // Gate controls still work: Continue advances the flight, and the camera mode stays chase.
  const f0 = (await evaluate(`window.__cdPerf().frames`)) || 0;
  const t0 = Date.now();
  let p = null;
  while (Date.now() - t0 < 20000) {
    await evaluate(`(() => { const b = [...document.querySelectorAll("#gate-choices button")].find((x) => /continue/i.test(x.textContent)); if (b) b.click(); })()`);
    await sleep(1500);
    p = JSON.parse(await evaluate(`JSON.stringify(window.__cdPerf())`));
    if (p && p.frames >= 300) break;
  }
  perf = p;
  check("flight continues after Continue", perf && perf.frames > f0, `${f0} -> ${perf && perf.frames}`);
  check("still chase after gate", (await evaluate(`document.getElementById("chase-toggle").getAttribute("aria-pressed")`)) === "true");
  await shot("19.2-chase-1280x720-after.png");
  check("no console errors", problems.length === 0, problems.slice(0, 5).join(" | "));
} finally {
  try {
    gl = await evaluate(`(() => { const c = document.createElement("canvas"); const g = c.getContext("webgl2") || c.getContext("webgl");
      if (!g) return "no WebGL"; const e = g.getExtension("WEBGL_debug_renderer_info"); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER); })()`);
    ver = await send("Browser.getVersion");
  } catch { /* ignore */ }
  const out = { browser: ver.product, gpuMode: gpu, webglRenderer: gl, measuredAt: new Date().toISOString(), case: caseId, checks, perf, problems };
  writeFileSync(path.join(outDir, `19.2-chase-${gpu}.json`), JSON.stringify(out, null, 1));
  console.table(Object.entries(checks).map(([k, v]) => ({ check: k, pass: v.pass ? "ok" : "FAIL", info: v.info })));
  if (perf) console.log("chase fps:", perf.fps && perf.fps.toFixed(1), "frames:", perf.frames, "p95 gap ms:", perf.gapP95Ms && perf.gapP95Ms.toFixed(1), "triangles:", perf.triangles, "calls:", perf.drawCalls);
  console.log("browser:", ver.product, "| gpu mode:", gpu, "| WebGL renderer:", gl);
  if (!ok) process.exitCode = 1;
  ws.close(); proc.kill(); server.close();
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* locked */ }
}
