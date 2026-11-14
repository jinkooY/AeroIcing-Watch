// Headless layout and frame-rate check for the Cloud Dive page (tasks 12.4 and 15.6). The cockpit view is the default flight view. Node built-ins plus an installed Edge or Chrome only.
// Serves the repo root on a random local port, opens static/cloud-dive/index.html?case=<id>&layoutcheck=1 at
// each viewport size, reads body.dataset.fits at the start of the flight and again at the first gate, and
// saves screenshots as docs/screens/15.6-<case>-<WxH>-<start|gate>.png, checks that every control is reachable (needed
// when a narrow or portrait screen stacks and scrolls, R14.6), and measures the frame rate with ?perf=1 while the flight
// runs. Frame rates are recorded as measured, with the browser and the WebGL renderer string (hardware or software GL).
// Results are also written to docs/screens/15.6-perf.json.
// Usage: node tools/layout_check.mjs [--only=<case id part>] [--sizes=1280x720,390x844] [--out=docs/screens] [--gpu=hw|sw]
//   --gpu=sw adds --disable-gpu (software GL); the default lets the browser choose.
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
const only = arg("only", "");
const sizesArg = arg("sizes", "");
const gpu = arg("gpu", "hw");

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
  const rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = path.join(root, rel);
  if (!file.startsWith(root) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
  try {
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(readFileSync(file));
  } catch { res.writeHead(500); res.end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const index = JSON.parse(readFileSync(path.join(root, "static/cloud-dive/cases/index.json"), "utf8"));
const caseIds = index.cases.map((c) => c.id).filter((id) => id.includes(only));

const profile = mkdtempSync(path.join(tmpdir(), "cdlayout-"));
const port = 9300 + Math.floor(Math.random() * 500);
const proc = spawn(browserPath, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--headless=new",
  "--no-first-run", ...(gpu === "sw" ? ["--disable-gpu"] : ["--ignore-gpu-blocklist"]), "--hide-scrollbars", "about:blank"], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* browser still starting */ }
    await sleep(250);
  }
  throw new Error("browser did not start");
}
const ws = new WebSocket(await connect());
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let nextId = 1;
const waiting = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  waiting.set(id, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return r.result.value;
};
async function waitFor(expression, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await evaluate(expression)) return true;
    await sleep(150);
  }
  return false;
}
async function shot(name) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(path.join(outDir, name), Buffer.from(r.data, "base64"));
}

mkdirSync(outDir, { recursive: true });
await send("Page.enable");
await send("Runtime.enable");
const results = [];
// R14.6: at 1280 wide or more in landscape both fits flags must be "yes". Narrower or portrait screens may stack and
// scroll vertically, but nothing may overflow sideways and every control must stay reachable.
function verdict(w, h, a, b, lostA, lostB, detail) {
  const d = JSON.parse(detail);
  if (lostA || lostB) return "FAIL";
  if (w >= 1280 && w > h) return a === "yes" && b === "yes" ? "ok" : "FAIL";
  return d.sw <= w ? "ok (scrolls)" : "FAIL";
}
const perfRows = [];
// Counts visible interactive elements a player could not reach: clipped by an overflow:hidden ancestor, or below the
// viewport when the page itself cannot scroll.
const UNREACHABLE = `(() => {
  const vis = (n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && n.offsetParent !== null; };
  const pageScrolls = ["auto", "scroll", "visible"].includes(getComputedStyle(document.documentElement).overflowY) &&
    ["auto", "scroll", "visible"].includes(getComputedStyle(document.body).overflowY);
  let lost = 0;
  for (const n of document.querySelectorAll("button, input, select, a[href], [tabindex]:not([tabindex=\\"-1\\"])")) {
    if (!vis(n) || n.closest("dialog:not([open])") || n.closest("[hidden]")) continue;
    const r = n.getBoundingClientRect();
    let clipped = false;
    for (let a = n.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowY === "hidden" || cs.overflowY === "clip") {
        const ar = a.getBoundingClientRect();
        if (r.bottom > ar.bottom + 1 || r.top < ar.top - 1) { clipped = true; break; }
      }
    }
    const outside = r.bottom > innerHeight + 1 && !pageScrolls;
    if (clipped || outside) lost++;
  }
  return lost;
})()`;
// Frame rate while the flight runs: from Start to the first gate, then on after Continue until about 300 frames or 15 s.
async function measurePerf() {
  const read = () => evaluate("window.__cdPerf ? JSON.stringify(window.__cdPerf()) : null").then((v) => (v ? JSON.parse(v) : null));
  let p = await read();
  if (!p || p.frames >= 300) return p;
  const t0 = Date.now();
  while (Date.now() - t0 < 15000 && (!p || p.frames < 300)) {
    await evaluate(`(() => { const b = [...document.querySelectorAll("#gate-choices button")].find((x) => /continue/i.test(x.textContent)); if (b) b.click(); })()`);
    await sleep(1500);
    p = await read();
  }
  return p;
}
// Every case at 1280x720; the first case at the other sizes (the matrix of task 12.4).
const matrix = [];
for (const id of caseIds) matrix.push([id, "1280x720"]);
for (const s of ["1366x768", "1920x1080", "800x1000", "390x844"]) matrix.push([caseIds[0], s]);
const wanted = sizesArg ? sizesArg.split(",") : null;
try {
  for (const [id, size] of matrix) {
    if (wanted && !wanted.includes(size)) continue;
    const [w, h] = size.split("x").map(Number);
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 });
    await send("Page.navigate", { url: `${base}/static/cloud-dive/index.html?case=${id}&layoutcheck=1&perf=1` });
    const short = id.split("-").slice(1, 3).join("-");
    const startOk = await waitFor(`document.body.dataset.fits !== undefined`);
    await sleep(1200); // map images load after the first render
    const fitsStart = await evaluate("document.body.dataset.fits");
    const viewStart = await evaluate(`document.body.classList.contains("view-cockpit") ? "cockpit" : "2d"`);
    const lostStart = await evaluate(UNREACHABLE);
    await shot(`15.6-${short}-${size}-start.png`);
    // Fly to the first gate: press Start and wait for the gate panel.
    // Task 17.3: in the cockpit view the flight opens on the runway; press Start takeoff and wait for the lead-in to end.
    await evaluate(`(() => { const t = document.getElementById("takeoff-btn"); if (t && !t.hidden) t.click(); })()`);
    await waitFor(`!document.body.classList.contains("lead-active")`, 40000);
    await sleep(500);
    await evaluate(`document.getElementById("ctl-go").click()`);
    const atGate = await waitFor(`document.getElementById("gate-panel") && document.getElementById("gate-panel").classList.contains("is-gate")`, 60000);
    await sleep(900);
    const fitsGate = await evaluate("document.body.dataset.fits");
    const lostGate = await evaluate(UNREACHABLE);
    await shot(`15.6-${short}-${size}-gate.png`); // before measurePerf() presses Continue
    const perf = await measurePerf();
    const detail = await evaluate(`JSON.stringify({ wide: [...document.querySelectorAll("body *")].filter((n) => n.offsetParent !== null && n.getBoundingClientRect().right > ${w} + 1).filter((n) => ![...n.children].some((k) => k.getBoundingClientRect().right > ${w} + 1)).slice(0, 8).map((n) => (n.id || n.className || n.tagName) + ":" + Math.round(n.getBoundingClientRect().right)), sh: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth,
      over: [...document.querySelectorAll("[data-fit-box]")].filter((n) => n.offsetParent !== null && n.scrollHeight > n.clientHeight + 1).map((n) => n.id || n.className) })`);
    results.push({ case: short, size, view: viewStart, start: startOk ? fitsStart : "timeout", gate: atGate ? fitsGate : "no gate",
      unreachable: `${lostStart}/${lostGate}`, pass: verdict(w, h, fitsStart, fitsGate, lostStart, lostGate, detail), fps: perf && perf.fps ? Math.round(perf.fps * 10) / 10 : null, detail });
    perfRows.push({ case: short, size, view: viewStart, ...perf });
  }
  // Task 17.8: the 2D view at 1280x720 with the departure climb status card (17.7) visible before the first step.
  if (!wanted || wanted.includes("1280x720-2d")) {
    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    await send("Page.navigate", { url: `${base}/static/cloud-dive/index.html?case=${caseIds[0]}&layoutcheck=1` });
    await waitFor(`document.body.dataset.fits !== undefined`);
    await sleep(1200);
    // Switch to 2D with the real button (key V does the same); a forced fallback is already 2D and hides the button.
    await evaluate(`(() => { const b = document.getElementById("view-toggle"); if (b && !b.hidden && document.body.classList.contains("view-cockpit")) b.click(); })()`);
    await waitFor(`!document.body.classList.contains("view-cockpit")`, 5000);
    await sleep(900);
    const r2d = JSON.parse(await evaluate(`JSON.stringify((() => {
      const card = document.getElementById("departure-card");
      const cr = card ? card.getBoundingClientRect() : null;
      const root = document.documentElement;
      const boxes = [...document.querySelectorAll("[data-fit-box]")].filter((n) => n.offsetParent !== null && n.scrollHeight > n.clientHeight + 1).map((n) => n.id || n.className);
      return { cardVisible: Boolean(card && !card.hidden && cr.width > 0 && cr.height > 0),
        cardInside: Boolean(cr && cr.bottom <= innerHeight && cr.right <= innerWidth),
        sh: Math.max(root.scrollHeight, document.body.scrollHeight), sw: Math.max(root.scrollWidth, document.body.scrollWidth), boxes,
        view2d: !document.body.classList.contains("view-cockpit") };
    })())`));
    const lost2d = await evaluate(UNREACHABLE);
    const fits2d = r2d.sh <= 720 && r2d.sw <= 1280 && r2d.boxes.length === 0 ? "yes" : "no";
    await shot(`17.8-${caseIds[0].split("-").slice(1, 3).join("-")}-1280x720-2d.png`);
    results.push({ case: caseIds[0].split("-").slice(1, 3).join("-"), size: "1280x720-2d", view: r2d.view2d ? "2d" : "cockpit", start: fits2d, gate: `card ${r2d.cardVisible ? "visible" : "hidden"}`,
      unreachable: `${lost2d}`, pass: fits2d === "yes" && r2d.view2d && r2d.cardVisible && r2d.cardInside && !lost2d ? "ok" : "FAIL", fps: null, detail: JSON.stringify(r2d) });
  }
} finally {
  console.table(results);
  if (results.some((r) => r.pass === "FAIL")) process.exitCode = 1;
  console.table(perfRows.map((r) => ({ case: r.case, size: r.size, view: r.view, frames: r.frames, fps: r.fps && Math.round(r.fps * 10) / 10,
    p95GapMs: r.gapP95Ms && Math.round(r.gapP95Ms * 10) / 10, cpuMeanMs: r.cpuMeanMs && Math.round(r.cpuMeanMs * 100) / 100, triangles: r.triangles, calls: r.drawCalls })));
  try {
    const gl = await evaluate(`(() => { const c = document.createElement("canvas"); const g = c.getContext("webgl2") || c.getContext("webgl");
      if (!g) return "no WebGL"; const e = g.getExtension("WEBGL_debug_renderer_info");
      return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER); })()`);
    const ver = await send("Browser.getVersion");
    writeFileSync(path.join(outDir, "15.6-perf.json"), JSON.stringify({ browser: ver.product, gpuFlag: gpu, webglRenderer: gl, measuredAt: new Date().toISOString(), results, perf: perfRows }, null, 1));
    console.log("browser:", ver.product, "| gpu mode:", gpu, "| WebGL renderer:", gl);
  } catch (e) { console.log("could not record browser info:", e.message); }
  ws.close();
  proc.kill();
  server.close();
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* profile still locked */ }
}
