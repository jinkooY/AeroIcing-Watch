// Automatic take recorder for the submission video (task 23.2). Opens the game in a visible fullscreen kiosk window
// (browser_guard headed mode, laid out at 1920x1080 CSS pixels on any 16:9 screen), records that window only (ffmpeg gfxcapture, NVENC), and plays
// the takes of tools/video/takes.json with the page's own buttons:
//   T1 start    case list, open the case, the ready screen with the map
//   T2 demo     the demo plan of tools/video/gate_plan.mjs from Start takeoff to the report; at gate 5 (first Observed gate)
//               also the 2D view, the image kind switch and Go left then cancel (T4 and scene n4); then the report, scrolled
//   T3 failure  anti-ice off, Continue at every gate, stops at the ice gate (ice index 50)
// Each take writes data/video/takes/<id>.mp4 and <id>.markers.json: events with the time in the take (seconds) and the
// screen rectangles of the parts the edit zooms on. No game code is changed; only buttons a player can press are used.
// The window covers the screen while it runs (about 4 minutes). Other windows are not recorded, but keyboard or mouse use can disturb the takes.
// Usage (repository root): node tools/video/record_takes.mjs [--only=T1,T2,T3] [--timeout=900] [--encoder=nvenc|x264]
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startGuard } from "../browser_guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (name, dflt) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : dflt;
};
if (!process.argv.some((x) => x.startsWith("--timeout="))) process.argv.push("--timeout=900");
const cfg = JSON.parse(readFileSync(path.join(root, "tools/video/takes.json"), "utf8"));
const only = arg("only", "") ? arg("only", "").split(",") : null;
const encoder = arg("encoder", "nvenc");
const outDir = path.join(root, "data/video/takes");
mkdirSync(outDir, { recursive: true });

function findTool(name) {
  const where = spawnSync("where", [name], { encoding: "utf8" });
  if (where.status === 0) return where.stdout.split(/\r?\n/)[0];
  const base = path.join(homedir(), "AppData/Local/Microsoft/WinGet/Packages");
  const ps = `(Get-ChildItem '${base}' -Recurse -Filter ${name}.exe -ErrorAction SilentlyContinue | Select-Object -First 1).FullName`;
  const p = spawnSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8" }).stdout.trim();
  if (!p) throw new Error(`${name} not found; install it with: winget install --id Gyan.FFmpeg -e`);
  return p;
}
const ffmpeg = findTool("ffmpeg");
const ffprobe = findTool("ffprobe");
const plan = JSON.parse(spawnSync("node", [path.join(root, "tools/video/gate_plan.mjs"), "--json"], { encoding: "utf8" }).stdout.trim().split(/\r?\n/).pop());
const byKm = new Map(plan.gates.map((g) => [g.km, g]));

// The page is always laid out at 1920x1080 CSS pixels. On a larger screen (a 4K panel gives a 3840-wide kiosk window
// at device scale 1, with tiny text) the browser is started again with device scale = window width / 1920, so the
// layout matches the 1080p takes and the capture is sharper. (A DevTools viewport override does not work here: the
// headed window then draws the page into one corner.) Marker rectangles stay in CSS pixels; `scale` in each markers
// file maps them to take pixels (tools/video/make_final.py).
const CSS_W = 1920, CSS_H = 1080;
let g = await startGuard({ root, headed: true });
let win = await g.evaluate(`({ w: innerWidth, h: innerHeight })`);
const scale = Number((win.w / CSS_W).toFixed(4));
if (Math.abs(win.h / CSS_H - scale) > 0.01) throw new Error(`the kiosk window is ${win.w}x${win.h}, not 16:9; use a 16:9 screen`);
if (scale !== 1) {
  await g.close();
  await new Promise((r) => setTimeout(r, 3000)); // let the first browser exit before the second starts
  g = await startGuard({ root, headed: true, deviceScale: scale });
  win = await g.evaluate(`({ w: innerWidth, h: innerHeight })`);
  if (Math.abs(win.w - CSS_W) > 2 || Math.abs(win.h - CSS_H) > 2) throw new Error(`device scale ${scale} gave a ${win.w}x${win.h} viewport, not ${CSS_W}x${CSS_H}`);
  console.log(`screen ${Math.round(CSS_W * scale)} px wide: browser at device scale ${scale}, viewport ${win.w}x${win.h}`);
}
const { base, send, evaluate, sleep } = g;

// ---- recording ----------------------------------------------------------------------------------------------------
let rec = null;
const WINDOW_TITLE = "CloudDiveTake";
// The window handle of the kiosk window, found once by a temporary title. Capturing by handle keeps the capture when
// the page changes its own title (a capture by title stops then).
let hwnd = null;
async function findWindow() {
  if (hwnd) return hwnd;
  const old = await evaluate(`document.title`);
  await evaluate(`document.title = ${JSON.stringify(WINDOW_TITLE)}`);
  await sleep(400);
  const ps = `(Get-Process | Where-Object { $_.MainWindowTitle -like '${WINDOW_TITLE}*' } | Select-Object -First 1).MainWindowHandle`;
  const out = spawnSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8" }).stdout.trim();
  await evaluate(`document.title = ${JSON.stringify(old)}`);
  hwnd = Number(out) || null;
  if (!hwnd) throw new Error("the kiosk window was not found");
  return hwnd;
}
// Window capture only delivers a frame when the window changes, and ffmpeg handles "q" only between frames. A still
// screen (case list, a held gate, the end of the report) would stall the capture, so while recording one corner pixel
// changes its colour by one step every 50 ms. It is not visible and not part of the game (added by this recorder only).
const KEEPALIVE_ON = `(() => { if (window.__takeKeepalive) return; const d = document.createElement("div");
  d.id = "take-keepalive"; d.setAttribute("aria-hidden", "true");
  d.style.cssText = "position:fixed;left:0;bottom:0;width:1px;height:1px;z-index:2147483647;pointer-events:none;background:rgb(11,18,32)";
  document.documentElement.appendChild(d); let k = 0;
  window.__takeKeepalive = setInterval(() => { k ^= 1; d.style.background = k ? "rgb(12,18,32)" : "rgb(11,18,32)"; }, 50); })()`;
const KEEPALIVE_OFF = `(() => { clearInterval(window.__takeKeepalive); window.__takeKeepalive = null; document.getElementById("take-keepalive")?.remove(); })()`;
async function startRecording(id) {
  const h = await findWindow();
  await evaluate(KEEPALIVE_ON);
  const out = path.join(outDir, `${id}.mp4`);
  // Window capture (Windows Graphics Capture) of the game window only, found by its title. A desktop capture (ddagrab)
  // also records any window on top and the taskbar, so it must not be used for takes.
  const src = `gfxcapture=hwnd=${h}:capture_cursor=0:max_framerate=${cfg.fps},hwdownload,format=bgra`;
  const args = ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", src,
    ...(encoder === "x264" ? ["-c:v", "libx264", "-crf", "14", "-preset", "veryfast"] : ["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "constqp", "-qp", "16"]),
    "-fps_mode", "cfr", "-r", String(cfg.fps), "-pix_fmt", "yuv420p", out];
  const proc = spawn(ffmpeg, args, { stdio: ["pipe", "inherit", "inherit"] });
  rec = { id, out, proc, t0: Date.now(), markers: [], done: new Promise((r) => proc.on("close", r)) };
}
const now = () => (Date.now() - rec.t0) / 1000;
async function mark(event, extra = {}) {
  rec.markers.push({ t: Number(now().toFixed(2)), event, ...extra });
}
async function stopRecording(meta = {}) {
  rec.proc.stdin.write("q");
  // a capture that lost its window stops delivering frames and ignores "q": end it and fail the take
  const code = await Promise.race([rec.done, sleep(6000).then(() => "timeout")]);
  await evaluate(KEEPALIVE_OFF);
  if (code === "timeout") {
    spawnSync("taskkill", ["/T", "/F", "/PID", String(rec.proc.pid)], { stdio: "ignore" });
    throw new Error(`${rec.id}: the capture stopped delivering frames (ffmpeg did not end)`);
  }
  const probe = spawnSync(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", rec.out], { encoding: "utf8" });
  const duration = Number(probe.stdout.trim());
  const file = path.join(outDir, `${rec.id}.markers.json`);
  writeFileSync(file, JSON.stringify({
    take: rec.id, video: path.relative(root, rec.out).replace(/\\/g, "/"), fps: cfg.fps, durationS: duration,
    note: "t is seconds from the ffmpeg start; the first frame comes about 0.2 to 0.5 s after it, so treat t as accurate to half a second",
    scale, cssViewport: [CSS_W, CSS_H], ...meta, markers: rec.markers,
  }, null, 2));
  console.log(`${rec.id}: ${duration.toFixed(1)} s, ${rec.markers.length} markers, ffmpeg exit ${code}`);
  rec = null;
}

// ---- page helpers --------------------------------------------------------------------------------------------------
const rect = (sel) => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || !e.getClientRects().length) return null;
  const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })()`);
async function rects(...sels) {
  const out = {};
  for (const s of sels) { const r = await rect(s); if (r) out[s] = r; }
  return out;
}
const km = async () => Number(await evaluate(`(() => { const m = document.body.innerText.match(/(\\d[\\d,]*)\\s+of\\s+[\\d,]+\\s*km/); return m ? Number(m[1].replace(/,/g, "")) : -1; })()`));
const atGate = () => evaluate(`Boolean(document.getElementById("gate-panel")?.classList.contains("is-gate"))`);
const panelText = () => evaluate(`document.getElementById("gate-panel")?.innerText || ""`);
const hudTotal = () => evaluate(`document.getElementById("hud-total")?.innerText || ""`);
const click = (id) => evaluate(`(() => { const b = document.getElementById(${JSON.stringify(id)}); if (!b || b.hidden || b.disabled) return false; b.click(); return true; })()`);
const clickChoice = (re) => evaluate(`(() => { const b = [...document.querySelectorAll("#gate-choices button")].find((x) => ${re}.test(x.textContent) && !x.disabled); if (!b) return false; b.click(); return true; })()`);
const antiIceOn = () => evaluate(`(() => { const b = [...document.querySelectorAll("#gate-choices button")].find((x) => /anti-ice/i.test(x.textContent)); return b ? b.getAttribute("aria-pressed") === "true" : null; })()`);
async function setAntiIce(want) {
  const s = await antiIceOn();
  if (s !== null && s !== want) {
    await pressKey("a", "A  Anti-ice");
    await mark(want ? "anti-ice on" : "anti-ice off", await rects("#gate-path", ".cp-switch"));
  }
}
// ---- real input (revision e, R24.8) ---------------------------------------------------------------------------------
// Keys and clicks go through the browser's input pipeline (CDP Input.*), exactly as a player's would: the page sees
// trusted keydown/keyup and pointer events, buttons show their pressed state, and focus moves as usual. Each press
// writes a "key" or "click" marker, from which make_final.py draws a key chip or a click ring.
const KEYS = {
  " ": { code: "Space", vk: 32, text: " " },
  ArrowUp: { code: "ArrowUp", vk: 38 }, ArrowDown: { code: "ArrowDown", vk: 40 },
  ArrowLeft: { code: "ArrowLeft", vk: 37 }, ArrowRight: { code: "ArrowRight", vk: 39 },
  a: { code: "KeyA", vk: 65, text: "a" }, v: { code: "KeyV", vk: 86, text: "v" }, m: { code: "KeyM", vk: 77, text: "m" },
};
async function pressKey(key, label) {
  const k = KEYS[key];
  if (!k) throw new Error(`no key definition for ${key}`);
  const base = { key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk };
  await send("Input.dispatchKeyEvent", { type: k.text ? "keyDown" : "rawKeyDown", ...base, ...(k.text ? { text: k.text, unmodifiedText: k.text } : {}) });
  await sleep(70 + Math.round(Math.random() * 40)); // a key is held for about a tenth of a second
  await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  if (rec) await mark("key", { key: label });
}
// Mouse click at the centre of the first visible element matching `selector` (and `re` on its text, if given).
async function clickAt(selector, re = null, label = "") {
  const r = await evaluate(`(() => { const list = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((e) => e.getClientRects().length && !e.disabled
      && ${re ? `${re}.test(e.textContent)` : "true"}); const e = list[0]; if (!e) return null; e.scrollIntoView({ block: "nearest" });
    const b = e.getBoundingClientRect(); return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }; })()`);
  if (!r) return false;
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: r.x, y: r.y });
  await sleep(120);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: r.x, y: r.y, button: "left", clickCount: 1 });
  await sleep(80);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: r.x, y: r.y, button: "left", clickCount: 1 });
  if (rec) await mark("click", { x: r.x, y: r.y, label });
  return true;
}
async function wheel(selector, dy) {
  const r = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const b = e.getBoundingClientRect();
    return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }; })()`);
  if (r) await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: r.x, y: r.y, deltaX: 0, deltaY: dy });
}
const visible = (id) => evaluate(`(() => { const e = document.getElementById(${JSON.stringify(id)}); return !!e && !e.hidden && e.getClientRects().length > 0; })()`);
const skipCinematic = async () => {
  if (!(await visible("skip-btn"))) return false;
  await pressKey(" ", "Space  Skip");
  return true;
};
const resumeIfPaused = async () => {
  if (!(await evaluate(`/^\\s*Flight status\\s*Paused at/i.test(document.getElementById("gate-panel")?.innerText || "")`))) return false;
  await pressKey(" ", "Space  Continue");
  return true;
};

async function openCase() {
  await send("Page.navigate", { url: `${base}/static/cloud-dive/index.html?case=${cfg.case}${cfg.query}` });
  const t0 = Date.now();
  while (Date.now() - t0 < 30000 && !(await evaluate(`(() => { const t = document.getElementById("takeoff-btn"); return !!t && !t.hidden; })()`))) await sleep(200);
  await sleep(1200);
}
// Takeoff, skip the cinematic, wait for "Ready at the start", one Continue opens gate 1 (see shots_22.mjs).
async function takeoffToGate1() {
  await pressKey(" ", "Space  Start takeoff");
  await mark("takeoff click", await rects("#hud"));
  const t0 = Date.now();
  let skipped = false;
  await sleep(600); // the runway roll starts before the player skips, as a person would
  while (Date.now() - t0 < 60000) {
    if (!skipped && (await skipCinematic())) { skipped = true; await mark("skip cinematic"); }
    if (/Ready at the start/.test(await panelText()) && !(await evaluate(`document.body.classList.contains("lead-active")`))) break;
    await sleep(200);
  }
  await sleep(700);
  await pressKey(" ", "Space  Continue");
  for (let i = 0; i < 40 && !(await atGate()); i++) await sleep(150);
}

// ---- takes ---------------------------------------------------------------------------------------------------------
async function takeStart(t) {
  await send("Page.navigate", { url: `${base}/static/cloud-dive/index.html?${cfg.query.replace(/^&/, "")}` });
  for (let i = 0; i < 100 && !(await evaluate(`document.querySelectorAll("#case-list button").length > 0`)); i++) await sleep(150);
  await sleep(800);
  // two recordings: the capture stops when the 3D view starts after the case opens, so the list and the ready screen
  // are separate files (T1-list, T1-ready), joined by a cut in the edit
  await startRecording(`${t.id}-list`);
  await sleep(600);
  await mark("case list", await rects("#case-list", "#picker"));
  await sleep(t.listHold * 1000);
  // The capture stops when the 3D view starts, so the take ends at the click: the marker carries the click point and
  // the edit draws the click there; the real mouse click follows at once, after the recording has closed.
  const target = await evaluate(`(() => { const li = [...document.querySelectorAll("#case-list .case-item")].find((x) => /KJFK|New York|JFK/i.test(x.innerText));
    const b = li && [...li.querySelectorAll("button")].find((x) => /fly this case/i.test(x.textContent)); if (!b) return null;
    b.id = b.id || "take-open-case"; const r = b.getBoundingClientRect(); return { id: b.id, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
  if (!target) throw new Error("T1: the KJFK-KBNA case button was not found");
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: target.x, y: target.y });
  await sleep(400);
  await mark("click", { x: target.x, y: target.y, label: "Fly this case" });
  await mark("case open click");
  await sleep(300);
  await stopRecording();
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: target.x, y: target.y, button: "left", clickCount: 1 });
  await sleep(80);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: target.x, y: target.y, button: "left", clickCount: 1 });
  for (let i = 0; i < 200 && !(await evaluate(`(() => { const t = document.getElementById("takeoff-btn"); return !!t && !t.hidden; })()`)); i++) await sleep(150);
  await sleep(1500);
  await startRecording(`${t.id}-ready`);
  await sleep(600);
  await mark("ready screen", await rects("#departure-card", "#map-section", "#game-note", ".attribution", "#hud", "#takeoff-btn"));
  await sleep(t.readyHold * 1000);
  await stopRecording();
}

async function takeDemo(t) {
  await openCase();
  await startRecording(t.id);
  await sleep(1000);
  await mark("ready screen", await rects("#takeoff-btn", "#game-note", ".attribution"));
  await takeoffToGate1();
  const t0 = Date.now();
  let handled = -1;
  while (Date.now() - t0 < 300000) {
    if (await evaluate(`document.getElementById("dlg-report")?.open`)) break;
    await skipCinematic();
    if (await atGate()) {
      const d = await km();
      const gate = byKm.get(d);
      if (gate && gate.n !== handled) {
        handled = gate.n;
        await mark(`gate ${gate.n}`, { km: d, reasons: gate.reasons, hudTotal: await hudTotal(),
          rects: await rects("#gate-panel", "#gate-path", "#gate-choices", "#cost-rules", ".gate-keys", ".cp-bar", ".cp-tape-value", ".cp-switch",
            "#hud", "#hud-lane", "#hud-ice-bar", "#lead-box", "#src-line", "#game-note", "#map-section") });
        if (gate.n === 1) {
          // a player reads the gate, opens the cost rules, closes them, then sets the climb and anti-ice
          const g1 = t.gate1;
          await sleep(g1.read * 1000);
          if (await clickAt("#cost-rules summary", null, "How costs work")) {
            await mark("cost rules open", await rects("#cost-rules", "#gate-choices"));
            await sleep(g1.cardOpen * 1000);
            await clickAt("#cost-rules summary", null, "How costs work");
            await mark("cost rules closed");
          }
          await sleep(g1.afterCard * 1000);
          for (let i = 0; i < 3; i++) {
            await pressKey("ArrowUp", "\u2191  Climb over");
            await mark("climb", await rects("#gate-path", "#gate-panel", ".cp-tape-value"));
            await sleep(t.stepPause * 1000);
          }
          await setAntiIce(true);
          await sleep(t.stepPause * 1000);
        } else if (gate.n === 5) {
          const g5 = t.gate5;
          await sleep(g5.hold * 1000);
          await pressKey("v", "V  2D view");
          await mark("2D view on", await rects("#cockpit-view", "#scene", "#map-section", "#view-notice"));
          await sleep(g5.view2d * 1000);
          await pressKey("m", "M  Image: phase");
          await mark("image kind: phase", await rects("#map-section", "#map-key"));
          await sleep(g5.imageKind * 1000);
          await pressKey("m", "M  Image: IR");
          await mark("image kind: IR");
          await sleep(700);
          await pressKey("v", "V  Cockpit view");
          await mark("2D view off");
          await sleep(900);
          await pressKey("ArrowLeft", "\u2190  Go left");
          await mark("go left", { hudTotal: await hudTotal(), rects: await rects("#hud-lane", "#gate-path", "#gate-panel") });
          await sleep(g5.goLeft * 1000);
          if (await clickAt("#gate-choices button", "/fly through/i", "Fly through")) {
            await mark("fly through (cancel)", { hudTotal: await hudTotal() });
            await sleep(g5.flyThrough * 1000);
          }
          await setAntiIce(true);
          await sleep(g5.after * 1000);
        } else {
          await sleep(t.gateHold * 1000);
          await setAntiIce(!gate.reasons.includes("exit"));
        }
        await sleep(350);
        await pressKey(" ", "Space  Continue");
        await mark(`continue ${gate.n}`);
      } else if (!gate) {
        await mark("gate at an unplanned km", { km: d });
        await pressKey(" ", "Space  Continue");
      }
    } else if (await resumeIfPaused()) {
      await mark("resume after pause");
    }
    await sleep(150);
  }
  if (!(await evaluate(`document.getElementById("dlg-report")?.open`))) throw new Error("T2: the report did not open");
  const reportText = await evaluate(`document.getElementById("dlg-report").innerText`);
  const total = (reportText.match(/Total fuel cost:\s*\$([\d,]+)/) || [])[1];
  await mark("report open", { total, rects: await rects("#dlg-report", "#report") });
  await sleep(t.reportHold * 1000);
  // slow scroll through the report (whichever of the dialog and its section scrolls)
  await mark("report scroll start");
  const steps = Math.round(t.reportScroll * 30);
  // mouse-wheel scrolling over the dialog, in small steps like a trackpad
  for (let i = 0; i < steps; i++) {
    const before = await evaluate(`[document.getElementById("dlg-report")?.scrollTop || 0, document.getElementById("report")?.scrollTop || 0].join(",")`);
    await wheel("#dlg-report", t.reportScrollPx);
    await sleep(33);
    if (i > 10 && i % 10 === 0) {
      const after = await evaluate(`[document.getElementById("dlg-report")?.scrollTop || 0, document.getElementById("report")?.scrollTop || 0].join(",")`);
      if (after === before) break; // the end of the report
    }
  }
  await mark("report scroll end");
  await sleep((t.reportEndHold ?? 1.5) * 1000);
  // revision f (R25.3, R25.4): the Best replay, scrolled to its top and held for the edit (scene r2)
  if (await evaluate(`Boolean(document.getElementById("report-review"))`)) {
    await evaluate(`document.getElementById("report-review").scrollIntoView({ block: "start", behavior: "smooth" })`);
    await sleep(900);
    await mark("best replay", { rects: await rects("#report-review", ".review-chart", "#dlg-report") });
    await sleep((t.reviewHold ?? 6) * 1000);
  }
  await stopRecording({ reportTotal: total ? Number(total.replace(/,/g, "")) : null, planTotalUsd: Math.round(plan.demoTotalUsd) });
  return total;
}

async function takeFailure(t) {
  await openCase();
  await startRecording(t.id);
  await sleep(1000);
  await takeoffToGate1();
  const t0 = Date.now();
  let lastKm = -1;
  while (Date.now() - t0 < 120000) {
    await skipCinematic();
    if (await atGate()) {
      const text = await panelText();
      const d = await km();
      if (/ice index/i.test(text.split("\n").slice(0, 3).join(" ")) || /reached 50/.test(text)) {
        await mark("ice gate", { km: d, hudTotal: await hudTotal(), rects: await rects("#gate-panel", "#hud-ice-bar", "#hud-total", "#cockpit-view") });
        await sleep(t.iceHold * 1000);
        break;
      }
      if (d !== lastKm) {
        lastKm = d;
        await mark("gate", { km: d, hudTotal: await hudTotal() });
        await sleep(t.gateHold * 1000);
        await setAntiIce(false);
        await pressKey(" ", "Space  Continue");
      }
    } else await resumeIfPaused();
    await sleep(150);
  }
  await stopRecording();
}

const results = {};
try {
  await send("Page.enable"); await send("Runtime.enable");
  for (const t of cfg.takes) {
    if (only && !only.includes(t.id)) continue;
    console.log(`recording ${t.id}: ${t.what}`);
    if (t.kind === "start") await takeStart(t);
    else if (t.kind === "demo") results.T2 = await takeDemo(t);
    else if (t.kind === "failure") await takeFailure(t);
  }
} finally {
  if (rec) { try { rec.proc.stdin.write("q"); await rec.done; } catch { /* ignore */ } }
  await g.close();
}
if (results.T2) {
  const got = Number(results.T2.replace(/,/g, "")), want = Math.round(plan.demoTotalUsd);
  console.log(`T2 report total $${results.T2} (plan $${want.toLocaleString("en-US")})`);
  if (Math.abs(got - want) > 1) { console.error("T2 total differs from the demo plan"); process.exit(2); }
}
