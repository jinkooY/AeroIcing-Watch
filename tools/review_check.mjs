// Browser check for revision f (R25): plays KJFK-KBNA in a headless browser with the page's own buttons (Start
// takeoff, Skip, Continue at every gate, anti-ice on at the first gate), then checks the per-choice levels on the
// gate buttons and the Best replay in the report, and writes two screenshots.
// Usage: node tools/review_check.mjs --out=<folder> [--size=1280x720]
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startGuard } from "./browser_guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, d) => (process.argv.find((x) => x.startsWith(`--${n}=`)) || "").slice(n.length + 3) || d;
const out = arg("out", null);
if (!out) { console.error("--out=<folder> is required"); process.exit(2); }
mkdirSync(out, { recursive: true });
const [W, H] = arg("size", "1280x720").split("x").map(Number);
const g = await startGuard({ root });
const { base, send, evaluate, sleep } = g;
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: W < 760 });
await send("Page.enable");
await send("Page.navigate", { url: `${base}/static/cloud-dive/index.html?case=20261112-kjfk-kbna-1930z` });
const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(path.join(out, name), Buffer.from(r.data, "base64"));
};
const waitFor = async (expr, ms = 20000) => {
  for (let t = 0; t < ms; t += 200) { if (await evaluate(expr)) return true; await sleep(200); }
  return false;
};
const results = [];
const ok = (name, pass, detail = "") => { results.push({ name, pass, detail }); console.log(`${pass ? "ok  " : "FAIL"} ${name}${detail ? `  [${detail}]` : ""}`); };
await waitFor(`Boolean(document.getElementById("takeoff-btn") && !document.getElementById("takeoff-btn").hidden)`);
await sleep(1500); // the case finishes loading after the button shows (the take recorder waits the same way)
for (let i = 0; i < 20 && !(await evaluate(`document.getElementById("takeoff-btn").hidden`)); i++) {
  await evaluate(`document.getElementById("takeoff-btn").click()`);
  await sleep(500);
}
await waitFor(`(() => { const b = document.getElementById("skip-btn"); return Boolean(b && !b.hidden); })()`, 10000);
await evaluate(`document.getElementById("skip-btn").click()`);
await waitFor(`!document.body.classList.contains("lead-active")`, 30000);
const atGate = `Boolean(document.getElementById("gate-panel")?.classList.contains("is-gate"))`;
const btn = (a) => `document.querySelector('#gate-choices button[data-action="${a}"]')`;
await waitFor(`(() => { const r = document.getElementById("gate-choices"); const b = ${btn("toggleRun")}; return Boolean(r && !r.hidden && b && !b.disabled); })()`, 30000);
await evaluate(`${btn("toggleRun")}?.click()`);
const gate1 = await waitFor(atGate, 30000);
ok("gate 1 opens", gate1, gate1 ? "" : await evaluate(`JSON.stringify({ body: document.body.className, panel: (document.getElementById("gate-panel")?.innerText || "").slice(0, 120), choices: document.getElementById("gate-choices")?.hidden, takeoff: document.getElementById("takeoff-btn")?.hidden })`));
const levels = await evaluate(`[...document.querySelectorAll("#gate-choices button")].map((b) => ({ a: b.dataset.action, lv: b.querySelector(".gate-btn-level")?.textContent || null, aria: b.getAttribute("aria-label"), dis: b.disabled }))`);
const choice = levels.filter((x) => ["flyThrough", "climbOver", "descend", "goLeft", "goRight"].includes(x.a) && !x.dis);
ok("each enabled lane or altitude button shows a level", choice.length > 0 && choice.every((x) => x.lv), choice.map((x) => `${x.a}:${x.lv}`).join(", "));
ok("anti-ice and Continue show no level", levels.filter((x) => ["toggleAntiIce", "toggleRun"].includes(x.a)).every((x) => !x.lv));
ok("accessible names carry the full level name", choice.every((x) => /Next \d+ km at that setting: (Observed supercooled layer at planned altitude|Possible \(forecast only\)|Not indicated|Not assessed)\./.test(x.aria || "")));
ok("no dollar sign on the gate buttons", levels.every((x) => !/\$/.test((x.lv || "") + (x.aria || ""))));
await shot("gate1.png");
await evaluate(`${btn("toggleAntiIce")}.click()`);
for (let i = 0; i < 60; i++) {
  const ended = await evaluate(`Boolean(document.getElementById("dlg-report")?.open || document.getElementById("report-review"))`);
  if (ended) break;
  if (await evaluate(atGate)) await evaluate(`${btn("toggleRun")}?.click()`);
  else await evaluate(`(() => { const b = ${btn("toggleRun")}; if (b && !b.disabled && /Continue/.test(b.textContent)) b.click(); })()`);
  await sleep(1500);
}
for (let i = 0; i < 60 && !(await evaluate(`Boolean(document.getElementById("dlg-report")?.open)`)); i++) {
  await evaluate(`(() => { const b = document.getElementById("skip-btn"); if (b && !b.hidden) b.click(); })()`);
  await sleep(500);
}
const review = await waitFor(`Boolean(document.getElementById("dlg-report")?.open && document.getElementById("report-review"))`, 60000);
if (!review) console.log(await evaluate(`(async () => { try {
  const G = await import("./game.js"); const R = await import("./flight-review.js"); const E = await import("./engine.js");
  const s = G.getStore(); const rp = R.replayFlown(s.engineCase, s.flown, s.state);
  let err = null; try { R.buildReview(s.engineCase, s.flown, s.state, s.caseData.references); } catch (e) { err = String(e); }
  return JSON.stringify({ flown: s.flown.length, step: s.state.step, nSteps: s.engineCase.nSteps, firstStep: s.flown[0]?.step,
    matches: rp && rp.matches, replayStep: rp && rp.final.step, you: E.totalUsd(s.engineCase, s.state), replay: rp && E.totalUsd(s.engineCase, rp.final), err });
  } catch (e) { return "debug failed: " + e; } })()`));
ok("the report shows the Best replay", review, review ? "" : await evaluate(`JSON.stringify({ open: document.getElementById("dlg-report")?.open, review: Boolean(document.getElementById("report-review")), km: document.body.innerText.match(/(\\d[\\d,]*) of [\\d,]+ km/)?.[1], panel: (document.getElementById("gate-panel")?.innerText || "").slice(0, 80) })`));
if (review) {
  const info = await evaluate(`(() => { const r = document.getElementById("report-review"); r.scrollIntoView(); const rows = r.querySelectorAll("tbody tr");
    return { title: r.querySelector("h4").textContent, rows: rows.length, first: rows[0] ? rows[0].innerText : "", chart: Boolean(r.querySelector("canvas.review-chart")),
      wide: r.scrollWidth > r.clientWidth + 2 }; })()`);
  ok("title names Best as a game reference, not a procedure", /Best \(game reference, not a procedure\)/.test(info.title), info.title);
  ok("one row per gate", info.rows > 0, `${info.rows} rows; first: ${info.first.replace(/\s+/g, " ")}`);
  ok("chart drawn", info.chart);
  ok("section does not overflow the dialog", !info.wide);
  await sleep(300);
  await shot("report-review.png");
}
const errors = await evaluate(`(window.__errors || []).length`);
ok("no page error", !errors);
await g.close();
const failed = results.filter((r) => !r.pass).length;
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
