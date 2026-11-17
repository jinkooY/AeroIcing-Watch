// Capture pipeline check with a moving test pattern (no game): does ddagrab + NVENC deliver every new screen frame at 60 Hz?
// The page moves a bar by a fixed step on every animation frame. ddagrab runs with dup_frames=0 and the output keeps
// every delivered frame (passthrough), so the frame count over the duration is the real capture rate.
// Usage: node tools/video/capture_pattern_check.mjs [--seconds=6]
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startGuard } from "../browser_guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const seconds = Number((process.argv.find((x) => x.startsWith("--seconds=")) || "--seconds=6").slice(10));
const find = (name) => {
  const ps = `(Get-ChildItem '${path.join(homedir(), "AppData/Local/Microsoft/WinGet/Packages")}' -Recurse -Filter ${name}.exe -ErrorAction SilentlyContinue | Select-Object -First 1).FullName`;
  return spawnSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8" }).stdout.trim();
};
const ffmpeg = find("ffmpeg"), ffprobe = find("ffprobe");
const outDir = path.join(root, "data/video/spike");
mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, "pattern.mp4");
const page = `<body style="margin:0;background:#000"><div id=b style="position:absolute;top:0;width:60px;height:100%;background:#fff"></div>
<script>let x=0;function f(){x=(x+17)%1860;b.style.left=x+"px";requestAnimationFrame(f)}f()</script>`;

const g = await startGuard({ root, headed: true, serve: false });
try {
  await g.send("Page.enable");
  await g.send("Page.navigate", { url: "data:text/html," + encodeURIComponent(page) });
  await g.sleep(1500);
  const rec = spawn(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
    "ddagrab=output_idx=0:framerate=60:draw_mouse=0:dup_frames=0,hwdownload,format=bgra", "-t", String(seconds),
    "-c:v", "h264_nvenc", "-preset", "p5", "-rc", "constqp", "-qp", "16", "-fps_mode", "passthrough", "-pix_fmt", "yuv420p", out],
    { stdio: ["pipe", "inherit", "inherit"] });
  await new Promise((r) => rec.on("close", r));
} finally {
  await g.close();
}
const p = spawnSync(ffprobe, ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames:format=duration", "-of", "default=nw=1", out], { encoding: "utf8" });
const frames = Number(p.stdout.match(/nb_read_frames=(\d+)/)?.[1]);
const dur = Number(p.stdout.match(/duration=([\d.]+)/)?.[1]);
console.log(`${frames} frames in ${dur.toFixed(2)} s = ${(frames / dur).toFixed(1)} captured frames per second (a 60 Hz screen should give about 60)`);
