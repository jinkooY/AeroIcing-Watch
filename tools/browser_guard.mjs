// Shared guard for the headless-browser check scripts (layout_check, chase_check, hotseat_check, shots_21).
// A run must never leave a browser behind and never open more than one:
//  1. lock file %TEMP%/cloud-dive-browser.lock holds the PID of the running script; a live holder blocks a second run,
//     a stale lock (dead PID) is taken over;
//  2. exactly one browser process and one page per run (callers navigate that page; they never open tabs or windows);
//  3. a hard total timeout (default 180 s, --timeout=<seconds>) kills browser and server and exits with code 3;
//  4. the browser process tree and the http server are closed on normal end, error, unhandledRejection,
//     SIGINT/SIGTERM/SIGBREAK and process 'exit' (taskkill /T /F as the last resort on Windows);
//  5. every browser uses a user-data-dir named %TEMP%/cloud-dive-edge-*; before launch, leftover browsers whose command
//     line contains that name are killed. The user's own Edge never matches.
// Usage: const g = await startGuard({ root, extraArgs: [...], onMessage: (m) => {...} });
//        g.base, g.send(method, params), g.evaluate(expr), g.sleep(ms), await g.close()
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const IS_WIN = process.platform === "win32";
const LOCK = path.join(tmpdir(), "cloud-dive-browser.lock");
const PROFILE_TAG = "cloud-dive-edge-";
const BROWSERS = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };

// Kills every browser process whose command line mentions a cloud-dive profile (or `tag`), as whole trees. Returns the count.
export function killGuardedBrowsers(tag = PROFILE_TAG) {
  if (!IS_WIN) {
    spawnSync("pkill", ["-f", tag], { stdio: "ignore" });
    return 0;
  }
  const ps = `$n=0; Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(msedge|chrome)\\.exe$' -and $_.CommandLine -like '*${tag}*' } | ForEach-Object { taskkill /T /F /PID $_.ProcessId 2>&1 | Out-Null; $n++ }; Write-Output $n`;
  const r = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf8", timeout: 20000, windowsHide: true });
  return Number(String(r.stdout || "0").trim().split(/\s+/).pop()) || 0;
}

function takeLock() {
  mkdirSync(path.dirname(LOCK), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try { writeFileSync(LOCK, String(process.pid), { flag: "wx" }); return; } catch (e) {
      if (e.code !== "EEXIST") throw e;
      const pid = Number(readFileSync(LOCK, "utf8").trim());
      if (pid && pid !== process.pid && alive(pid)) {
        console.error(`browser_guard: another browser script is running (PID ${pid}, lock ${LOCK}). Not starting.`);
        process.exit(4);
      }
      try { rmSync(LOCK, { force: true }); } catch { /* retry */ }
    }
  }
  throw new Error("could not take the browser lock");
}

export async function startGuard({ root, extraArgs = [], onMessage = null, serve = true } = {}) {
  const argv = process.argv.find((x) => x.startsWith("--timeout="));
  const timeoutS = argv ? Number(argv.slice(10)) || 180 : 180;
  const browserPath = BROWSERS.find((p) => existsSync(p));
  if (!browserPath) throw new Error("No Edge or Chrome found");

  takeLock();
  let proc = null, server = null, ws = null, profile = null, closed = false, timer = null;

  // Synchronous on purpose: it also runs inside process 'exit'.
  function cleanup() {
    if (closed) return;
    closed = true;
    if (timer) clearTimeout(timer);
    try { ws && ws.close(); } catch { /* ignore */ }
    try { server && (server.closeAllConnections?.(), server.close()); } catch { /* ignore */ }
    if (proc && proc.pid) {
      if (IS_WIN) spawnSync("taskkill", ["/T", "/F", "/PID", String(proc.pid)], { stdio: "ignore", windowsHide: true });
      else try { proc.kill("SIGKILL"); } catch { /* ignore */ }
    }
    if (profile) killGuardedBrowsers(path.basename(profile)); // stragglers of this run's profile only
    if (profile) { try { rmSync(profile, { recursive: true, force: true }); } catch { /* still locked, swept next run */ } }
    try { if (existsSync(LOCK) && readFileSync(LOCK, "utf8").trim() === String(process.pid)) rmSync(LOCK, { force: true }); } catch { /* ignore */ }
  }
  process.on("exit", cleanup);
  for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK"]) process.on(sig, () => { cleanup(); process.exit(130); });
  process.on("unhandledRejection", (e) => { console.error("unhandledRejection:", e); cleanup(); process.exit(1); });
  process.on("uncaughtException", (e) => { console.error("uncaughtException:", e); cleanup(); process.exit(1); });
  timer = setTimeout(() => { console.error(`browser_guard: hard timeout after ${timeoutS} s; killing browser and server.`); cleanup(); process.exit(3); }, timeoutS * 1000);

  try {
    // Leftovers of earlier runs (same unique profile tag only), then their profile dirs.
    killGuardedBrowsers();
    for (const d of readdirSync(tmpdir())) if (d.startsWith(PROFILE_TAG)) { try { rmSync(path.join(tmpdir(), d), { recursive: true, force: true }); } catch { /* locked */ } }

    let base = "";
    if (serve) {
      server = http.createServer((req, res) => {
        const file = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
        if (!file.startsWith(root) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
        try {
          res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
          res.end(readFileSync(file));
        } catch { res.writeHead(500); res.end(); }
      });
      await new Promise((r) => server.listen(0, "127.0.0.1", r));
      base = `http://127.0.0.1:${server.address().port}`;
    }

    profile = path.join(tmpdir(), `${PROFILE_TAG}${process.pid}-${Date.now()}`);
    mkdirSync(profile, { recursive: true });
    const port = 9300 + Math.floor(Math.random() * 600);
    proc = spawn(browserPath, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--headless=new",
      "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-background-networking", "--disable-sync",
      "--disable-default-apps", "--disable-component-update", "--window-size=1400,900",
      "--hide-scrollbars", ...extraArgs, "about:blank"], { stdio: "ignore", windowsHide: true });
    proc.on("error", (e) => { console.error("browser failed:", e.message); cleanup(); process.exit(1); });

    let wsUrl = null;
    for (let i = 0; i < 60 && !wsUrl; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        const page = list.find((t) => t.type === "page");
        if (page) wsUrl = page.webSocketDebuggerUrl;
      } catch { /* browser still starting */ }
      if (!wsUrl) await sleep(250);
    }
    if (!wsUrl) throw new Error("browser did not start");
    ws = new WebSocket(wsUrl);
    await new Promise((r) => ws.addEventListener("open", r, { once: true }));
    let nextId = 1;
    const waiting = new Map();
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); return; }
      if (onMessage) onMessage(m);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = nextId++;
      waiting.set(id, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)));
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
    return { base, send, evaluate, sleep, pid: proc.pid, profile, close: async () => cleanup() };
  } catch (e) {
    cleanup();
    throw e;
  }
}
