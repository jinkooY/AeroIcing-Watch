// Capture spike for the submission video: can the game be recorded from a real (headed, kiosk) browser window at
// 1920x1080 and 60 fps on this machine? Opens the case, starts the takeoff, captures N seconds with ffmpeg and prints
// the frame count, the average fps and the brightness of three frames (a black or frozen capture shows up here).
// Usage (repository root):  node tools/video/capture_spike.mjs [--source=ddagrab|gfxcapture] [--seconds=10] [--timeout=120]
// Output: data/video/spike/<source>.mp4 (git-ignored). The browser window covers the screen for the length of the run.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startGuard } from "../browser_guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (name, dflt) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : dflt;
};
const source = arg("source", "ddagrab");
const seconds = Number(arg("seconds", "20"));
const encoder = arg("encoder", "nvenc"); // nvenc keeps up with 1080p60 in real time; x264 may drop frames while the game also loads the CPU

function findTool(name) {
  const where = spawnSync("where", [name], { encoding: "utf8" });
  if (where.status === 0) return where.stdout.split(/\r?\n/)[0];
  const base = path.join(homedir(), "AppData/Local/Microsoft/WinGet/Packages");
  const ps = `(Get-ChildItem '${base}' -Recurse -Filter ${name}.exe -ErrorAction SilentlyContinue | Select-Object -First 1).FullName`;
  const r = spawnSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8" });
  const p = r.stdout.trim();
  if (!p) throw new Error(`${name} not found; install it with: winget install --id Gyan.FFmpeg -e`);
  return p;
}
const ffmpeg = findTool("ffmpeg");
const ffprobe = findTool("ffprobe");
const outDir = path.join(root, "data/video/spike");
mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `${source}-${encoder}.mp4`);

const title = "CloudDiveSpike";
const input = source === "gfxcapture"
  ? `gfxcapture=window_title=${title}:max_framerate=60,hwdownload,format=bgra`
  : "ddagrab=output_idx=0:framerate=60:draw_mouse=0,hwdownload,format=bgra";

const g = await startGuard({ root, headed: true });
const { base, send, evaluate, sleep } = g;
try {
  await send("Page.enable"); await send("Runtime.enable");
  await send("Page.navigate", { url: `${base}/static/cloud-dive/index.html?case=20261112-kjfk-kbna-1930z` });
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    if (await evaluate(`(() => { const t = document.getElementById("takeoff-btn"); return !!t && !t.hidden; })()`)) break;
    await sleep(200);
  }
  await evaluate(`document.title = ${JSON.stringify(title)}`);
  await sleep(1500);
  console.log("window", await evaluate(`innerWidth + "x" + innerHeight + " dpr " + devicePixelRatio`));

  const args = ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", input, "-t", String(seconds),
    ...(encoder === "x264" ? ["-c:v", "libx264", "-crf", "14", "-preset", "veryfast"] : ["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "constqp", "-qp", "16"]),
    "-fps_mode", "cfr", "-r", "60", "-pix_fmt", "yuv420p", out];
  const rec = spawn(ffmpeg, args, { stdio: ["pipe", "inherit", "inherit"] });
  const started = Date.now();
  const done = new Promise((r) => rec.on("close", r));
  await sleep(1000);
  await evaluate(`document.getElementById("takeoff-btn").click()`);
  // Skip the cinematic when its button shows, then wait for the first gate and press Continue so the game runs while we record.
  const gateOpen = () => evaluate(`Boolean(document.getElementById("gate-panel")?.classList.contains("is-gate"))`);
  let gateAt = null;
  while (Date.now() - started < (seconds - 6) * 1000) {
    await evaluate(`(() => { const s = document.getElementById("skip-btn"); if (s && !s.hidden) s.click(); })()`);
    if (await gateOpen()) { gateAt = (Date.now() - started) / 1000; break; }
    await sleep(250);
  }
  console.log("first gate at", gateAt, "s after the start of the capture");
  await sleep(1500);
  const clickAt = (Date.now() - started) / 1000;
  await evaluate(`(() => { const b = [...document.querySelectorAll("#gate-choices button")].find((x) => /continue/i.test(x.textContent)); if (b) b.click(); })()`);
  console.log("pressed Continue at", clickAt.toFixed(1), "s");
  const code = await done;
  console.log("ffmpeg exit", code);
} finally {
  await g.close();
}

if (!existsSync(out)) { console.error("no capture file"); process.exit(1); }
const probe = spawnSync(ffprobe, ["-v", "error", "-count_frames", "-select_streams", "v:0",
  "-show_entries", "stream=nb_read_frames,r_frame_rate,width,height:format=duration", "-of", "default=nw=1", out], { encoding: "utf8" });
console.log(probe.stdout.trim());
const frames = Number((probe.stdout.match(/nb_read_frames=(\d+)/) || [])[1]);
const dur = Number((probe.stdout.match(/duration=([\d.]+)/) || [])[1]);
if (frames && dur) console.log(`average fps: ${(frames / dur).toFixed(1)}`);
for (const t of [1, Math.floor(seconds / 2), seconds - 1]) {
  const png = path.join(outDir, `${source}-${encoder}-${t}s.png`);
  spawnSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-ss", String(t), "-i", out, "-frames:v", "1", png]);
  const stats = spawnSync(ffmpeg, ["-hide_banner", "-i", png, "-vf", "signalstats,metadata=print:key=lavfi.signalstats.YAVG", "-f", "null", "-"], { encoding: "utf8" });
  const y = (stats.stderr.match(/YAVG=([\d.]+)/) || [])[1];
  console.log(`frame at ${t}s: average luma ${y} (0 = black, 255 = white)`);
}
// Motion check: after Continue the game fast-forwards, so almost every frame should be new. mpdecimate drops near-duplicates.
const startSeg = Math.min(seconds - 4, 8);
const seg = spawnSync(ffmpeg, ["-hide_banner", "-ss", String(startSeg), "-i", out, "-vf", "mpdecimate=hi=64:lo=32:frac=0.1,showinfo", "-f", "null", "-"], { encoding: "utf8" });
const kept = (seg.stderr.match(/n:\s*\d+/g) || []).length;
const segFrames = Math.round((seconds - startSeg) * 60);
console.log(`unique frames from ${startSeg}s: ${kept} of about ${segFrames} (${((100 * kept) / segFrames).toFixed(0)} percent); about 100 percent means no dropped frames while moving`);