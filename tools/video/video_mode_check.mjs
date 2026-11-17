// Check of the capture mode `?video=1` (task 22.5, R23.6) at 1920x1080 in the headless browser.
// With the parameter: body[data-video="1"], HUD values at least 26 px, fuel value at least 26 px, the text line at least 18 px,
// the shortcut row hidden, the pointer hidden, the game note, the source line and the level strip still visible, no overflow
// (`data-fits="yes"`), no console error. Without it: no data-video and the usual sizes, the shortcut row shown.
// Usage: node tools/video/video_mode_check.mjs [--timeout=120]     (exit code 1 on any failure)
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startGuard } from "../browser_guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const problems = [];
const onMessage = (m) => {
  if (m.method === "Runtime.exceptionThrown") problems.push("exception: " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") problems.push("console.error: " + m.params.args.map((a) => a.value ?? a.description).join(" "));
};
const g = await startGuard({ root, onMessage });
const { base, send, evaluate, sleep } = g;
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); };

async function run(label, query) {
  await send("Page.navigate", { url: `${base}/static/cloud-dive/index.html?case=20261112-kjfk-kbna-1930z&layoutcheck=1${query}` });
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
  await evaluate(`(() => { const b = [...document.querySelectorAll("#gate-choices button")].find((x) => /^continue$/i.test(x.textContent.trim())); if (b) b.click(); })()`);
  for (let i = 0; i < 40 && !(await evaluate(`Boolean(document.getElementById("gate-panel")?.classList.contains("is-gate"))`)); i++) await sleep(150);
  await sleep(600);
  return evaluate(`(() => {
    const px = (sel) => { const e = document.querySelector(sel); return e ? parseFloat(getComputedStyle(e).fontSize) : -1; };
    const shown = (sel) => { const e = document.querySelector(sel); if (!e) return false; const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden"; };
    const text = document.body.innerText;
    return {
      video: document.body.dataset.video || "",
      fits: document.body.dataset.fits || "",
      hud: px(".hud dd"), fuel: px(".cp-fuel-value"), textLine: px(".cp-text-line"),
      shortcuts: shown(".bottom-buttons"),
      note: /Game model\\. Not a flight procedure, not an icing severity\\./.test(text),
      source: /Source: GOES-19/.test(text),
      levels: /Not assessed/.test(text) && /Not indicated/.test(text) && /Possible \\(forecast only\\)/.test(text) && /Observed supercooled layer at planned altitude/.test(text),
      textLineShown: shown(".cp-text-line"),
      cursor: getComputedStyle(document.body).cursor,
    };
  })()`);
}

try {
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  const plain = await run("plain", "");
  check("without ?video=1: no data-video", plain.video === "", plain.video);
  check("without ?video=1: HUD values keep the usual size (under 20 px)", plain.hud > 0 && plain.hud < 20, String(plain.hud));
  check("without ?video=1: shortcut row shown", plain.shortcuts === true);
  check("without ?video=1: the pointer is not hidden", plain.cursor !== "none", plain.cursor);
  const v = await run("video", "&video=1");
  check("with ?video=1: data-video is 1", v.video === "1", v.video);
  check("HUD values at least 26 px", v.hud >= 26, String(v.hud));
  check("fuel value at least 26 px", v.fuel >= 26, String(v.fuel));
  check("text line at least 18 px and shown", v.textLine >= 18 && v.textLineShown, String(v.textLine));
  check("shortcut row hidden", v.shortcuts === false);
  check("pointer hidden", v.cursor === "none", v.cursor);
  check("game note visible", v.note);
  check("source line visible", v.source);
  check("four level names visible", v.levels);
  check("no overflow (data-fits yes)", v.fits === "yes", v.fits);
  check("no console error or exception", problems.length === 0, problems.slice(0, 3).join(" | "));
} finally {
  await g.close();
}
let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`${r.ok ? "ok  " : "FAIL"} ${r.name}${r.detail ? "  [" + r.detail + "]" : ""}`);
}
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
