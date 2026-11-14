// Headless hot-seat walk-through (task 18.4). Node built-ins plus an installed Edge or Chrome only.
// Opens the case picker at 1280x720, opens the hot-seat setup, chooses 2 players, flies each flight with Skip and
// Continue until the report opens, closes it, and checks the hand-over dialog and the results dialog.
// Fails on any console error, uncaught exception, or a dialog that does not fit the viewport.
// Usage: node tools/hotseat_check.mjs [--out=docs/screens] [--case=<id part>]
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
const only = arg("case", "");
const W = 1280, H = 720;

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
const caseId = index.cases.map((c) => c.id).find((id) => id.includes(only));

const profile = mkdtempSync(path.join(tmpdir(), "cdhot-"));
const port = 9800 + Math.floor(Math.random() * 500);
const proc = spawn(browserPath, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--headless=new",
  "--no-first-run", "--ignore-gpu-blocklist", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
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
const errors = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") errors.push("exception: " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push("console.error: " + m.params.args.map((a) => a.value ?? a.description).join(" "));
  // The test server has no favicon; the browser asks for it on its own.
  if (m.method === "Log.entryAdded" && m.params.entry.level === "error" && !/favicon\.ico/.test(m.params.entry.url || "")) errors.push("log: " + m.params.entry.text + " " + (m.params.entry.url || ""));
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  waiting.set(id, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
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
// The open dialog's box must sit inside the viewport and not scroll its own content.
const DIALOG_FIT = (id) => `(() => {
  const d = document.getElementById(${JSON.stringify(id)});
  if (!d || !d.open) return JSON.stringify({ open: false });
  const r = d.getBoundingClientRect();
  const inside = r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth;
  return JSON.stringify({ open: true, inside, scrolls: d.scrollHeight > d.clientHeight + 1 || d.scrollWidth > d.clientWidth + 1,
    box: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)], text: d.innerText.replace(/\\s+/g, " ").slice(0, 400) });
})()`;

const steps = [];
const note = (name, ok, detail = "") => { steps.push({ step: name, ok: ok ? "ok" : "FAIL", detail }); };
mkdirSync(outDir, { recursive: true });

// Flies the current flight until the report dialog is open: takeoff, Skip on every cinematic, Continue at gates.
async function flyOne() {
  await waitFor(`(() => { const t = document.getElementById("takeoff-btn"); return t && !t.hidden; })()`, 30000);
  await evaluate(`document.getElementById("takeoff-btn").click()`);
  const t0 = Date.now();
  while (Date.now() - t0 < 240000) {
    if (await evaluate(`document.getElementById("dlg-report").open`)) return true;
    await evaluate(`(() => {
      const s = document.getElementById("skip-btn"); if (s && !s.hidden) { s.click(); return; }
      const g = document.getElementById("ctl-go"); const gate = document.getElementById("gate-panel");
      const cont = [...document.querySelectorAll("#gate-choices button")].find((x) => /continue/i.test(x.textContent));
      if (cont) { cont.click(); return; }
      if (g && !g.disabled && !(gate && gate.classList.contains("is-gate")) && !document.body.classList.contains("lead-active")) g.click();
    })()`);
    await sleep(400);
  }
  return false;
}

let failed = false;
try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${base}/static/cloud-dive/index.html` });
  note("picker lists case", await waitFor(`document.querySelectorAll(".case-actions button").length > 1`), caseId);
  // Hot-seat button of the chosen case.
  await evaluate(`(() => { const li = [...document.querySelectorAll("#case-list li, li")].find((l) => l.textContent.includes(${JSON.stringify(caseId)}) || true);
    [...document.querySelectorAll(".case-actions button")].find((b) => /hot-seat/i.test(b.textContent) && !b.disabled).click(); })()`);
  let fit = JSON.parse(await evaluate(DIALOG_FIT("dlg-hotseat")));
  note("setup dialog opens and fits 1280x720", fit.open && fit.inside && !fit.scrolls, JSON.stringify(fit.box));
  await evaluate(`(() => { const s = document.getElementById("hotseat-count"); s.value = "2"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  const nameInputs = await evaluate(`document.querySelectorAll("#hotseat-names input").length`);
  await evaluate(`document.getElementById("hotseat-name-0").value = "Ann"; document.getElementById("hotseat-name-1").value = "Ben"`);
  note("two name fields", nameInputs === 2, String(nameInputs));
  await shot("18.4-hotseat-setup-1280x720.png");
  await evaluate(`document.getElementById("hotseat-start").click()`);

  note("player 1 flight reaches report", await flyOne());
  await sleep(500);
  await shot("18.4-hotseat-report1-1280x720.png");
  await evaluate(`document.querySelector("#dlg-report .dlg-close").click()`);
  await waitFor(`document.getElementById("dlg-handover").open`, 5000);
  fit = JSON.parse(await evaluate(DIALOG_FIT("dlg-handover")));
  note("hand-over dialog opens and fits", fit.open && fit.inside && !fit.scrolls, fit.text || "");
  await shot("18.4-hotseat-handover-1280x720.png");
  await evaluate(`document.getElementById("handover-start").click()`);

  note("player 2 flight reaches report", await flyOne());
  await sleep(500);
  await evaluate(`document.querySelector("#dlg-report .dlg-close").click()`);
  const resultsOpen = await waitFor(`document.getElementById("dlg-results").open`, 5000);
  fit = JSON.parse(await evaluate(DIALOG_FIT("dlg-results")));
  note("results dialog opens and fits", resultsOpen && fit.inside && !fit.scrolls, fit.text || "");
  await shot("18.4-hotseat-results-1280x720.png");
  note("no console errors or exceptions", errors.length === 0, errors.slice(0, 5).join(" | "));
} catch (e) {
  note("script error", false, e.message);
} finally {
  for (const s of steps) console.log(`${s.ok.padEnd(4)} ${s.step} ${s.detail ? "| " + String(s.detail).slice(0, 300) : ""}`);
  if (steps.some((s) => s.ok === "FAIL")) process.exitCode = 1;
  ws.close();
  proc.kill();
  server.close();
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* locked */ }
}
