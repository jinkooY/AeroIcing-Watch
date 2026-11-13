// Headless layout check for the Cloud Dive page (task 12.4). Node built-ins plus an installed Edge or Chrome only.
// Serves the repo root on a random local port, opens static/cloud-dive/index.html?case=<id>&layoutcheck=1 at
// each viewport size, reads body.dataset.fits at the start of the flight and again at the first gate, and
// saves screenshots as docs/screens/12.4-<case>-<WxH>-<start|gate>.png.
// Usage: node tools/layout_check.mjs [--only=<case id part>] [--sizes=1280x720,800x1000] [--out=docs/screens]
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
  "--no-first-run", "--disable-gpu", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });

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
// Every case at 1280x720; the first case at the other sizes (the matrix of task 12.4).
const matrix = [];
for (const id of caseIds) matrix.push([id, "1280x720"]);
for (const s of ["1366x768", "1920x1080", "800x1000"]) matrix.push([caseIds[0], s]);
const wanted = sizesArg ? sizesArg.split(",") : null;
try {
  for (const [id, size] of matrix) {
    if (wanted && !wanted.includes(size)) continue;
    const [w, h] = size.split("x").map(Number);
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await send("Page.navigate", { url: `${base}/static/cloud-dive/index.html?case=${id}&layoutcheck=1` });
    const short = id.split("-").slice(1, 3).join("-");
    const startOk = await waitFor(`document.body.dataset.fits !== undefined`);
    await sleep(1200); // map images load after the first render
    const fitsStart = await evaluate("document.body.dataset.fits");
    await shot(`12.4-${short}-${size}-start.png`);
    // Fly to the first gate: press Start and wait for the gate panel.
    await evaluate(`document.getElementById("ctl-go").click()`);
    const atGate = await waitFor(`document.getElementById("gate-panel") && document.getElementById("gate-panel").classList.contains("is-gate")`, 60000);
    await sleep(900);
    const fitsGate = await evaluate("document.body.dataset.fits");
    const detail = await evaluate(`JSON.stringify({ sh: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth,
      over: [...document.querySelectorAll("[data-fit-box]")].filter((n) => n.offsetParent !== null && n.scrollHeight > n.clientHeight + 1).map((n) => n.id || n.className) })`);
    await shot(`12.4-${short}-${size}-gate.png`);
    results.push({ case: short, size, start: startOk ? fitsStart : "timeout", gate: atGate ? fitsGate : "no gate", detail });
  }
} finally {
  console.table(results);
  ws.close();
  proc.kill();
  server.close();
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* profile still locked */ }
}
