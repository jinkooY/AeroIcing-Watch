"use strict";

const byId = (id) => document.getElementById(id);
const chart = byId("chart");
const selector = byId("sample");
const colors = { liquid: "#61b7f0", ice: "#c5d1e4", unknown: "#ab95db" };
const phaseLabels = { liquid: "Liquid", ice: "Ice", unknown: "Unknown" };
const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
let current;

function validProfile(profile) {
  if (!profile || typeof profile.title !== "string" || !profile.title.trim() ||
      typeof profile.source !== "string" || !profile.source.trim() ||
      !["simulated", "observation"].includes(profile.dataKind)) {
    throw new Error("Provide a title, source, and a dataKind of simulated or observation.");
  }
  const utcTimestamp = typeof profile.observedAt === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(profile.observedAt) &&
    Number.isFinite(Date.parse(profile.observedAt));
  if ((profile.observedAt !== null && !utcTimestamp) ||
      (profile.dataKind === "observation" && !utcTimestamp)) {
    throw new Error("Observations require an ISO 8601 UTC timestamp.");
  }
  const samples = profile.samples;
  if (!Array.isArray(samples) || samples.length < 2 || samples.length > 2000) {
    throw new Error("Provide between 2 and 2,000 samples.");
  }
  let previous = -1;
  for (const [index, point] of samples.entries()) {
    const altitude = (value) => value === null ||
      (Number.isFinite(value) && value >= -2000 && value <= 100000);
    if (!point || !Number.isFinite(point.distanceKm) || point.distanceKm < 0 || point.distanceKm > 50000 ||
        point.distanceKm <= previous || (index === 0 && point.distanceKm !== 0)) {
      throw new Error("Distances must start at zero, increase strictly, and stay within 50,000 km.");
    }
    if (!altitude(point.topFt) || !altitude(point.baseFt) ||
        (point.baseFt !== null && (point.topFt === null || point.baseFt > point.topFt)) ||
        (point.phase !== null && !["liquid", "ice", "unknown"].includes(point.phase)) ||
        ![true, false, null].includes(point.supercooled) ||
        (point.topFt === null && (point.phase !== null || point.supercooled !== null))) {
      throw new Error("Invalid cloud fields at sample " + (index + 1) + ".");
    }
    previous = point.distanceKm;
  }
  return profile;
}

function loadProfile(profile) {
  current = validProfile(profile);
  byId("profile-title").textContent = current.title;
  const timestamp = current.observedAt
    ? new Date(current.observedAt).toISOString().replace(".000Z", "Z")
    : "No observation time";
  byId("source").textContent = current.source + " · " + timestamp;
  byId("data-kind").textContent = current.dataKind === "simulated" ? "Simulated data" : "Observation profile";
  selector.max = current.samples.length - 1;
  selectSample(0);
}

function selectSample(index) {
  selector.value = index;
  const point = current.samples[index];
  const height = (value) => value === null ? "Unavailable" : number.format(value) + " ft MSL";
  byId("distance").textContent = number.format(point.distanceKm) + " km";
  selector.setAttribute("aria-valuetext", byId("distance").textContent);
  byId("top").textContent = height(point.topFt);
  byId("base").textContent = height(point.baseFt);
  byId("phase").textContent = phaseLabels[point.phase] || "Unavailable";
  byId("cue").textContent = point.supercooled === null ? "Unavailable"
    : point.supercooled ? "Flagged" : "Unflagged";
  drawChart();
}

function plotSize() {
  return { left: 55, right: chart.clientWidth - 16, top: 19, bottom: chart.clientHeight - 34 };
}

function drawChart() {
  if (!current) return;
  const ratio = window.devicePixelRatio || 1;
  chart.width = Math.round(chart.clientWidth * ratio);
  chart.height = Math.round(chart.clientHeight * ratio);
  const ctx = chart.getContext("2d");
  ctx.scale(ratio, ratio);
  const { left, right, top, bottom } = plotSize();
  const samples = current.samples;
  const distance = samples.at(-1).distanceKm;
  const highest = Math.max(0, ...samples.map((point) => point.topFt ?? 0));
  const lowest = Math.min(0, ...samples.map((point) => point.baseFt ?? point.topFt ?? 0));
  const step = Math.max(2500, Math.ceil((highest - lowest) / 20000) * 5000);
  const ceiling = Math.max(step, Math.ceil(highest / step) * step);
  const floor = Math.floor(lowest / step) * step;
  const x = (km) => left + (right - left) * (km / distance);
  const y = (feet) => bottom - (bottom - top) * ((feet - floor) / (ceiling - floor));

  ctx.fillStyle = "#0b1524";
  ctx.fillRect(left, top, right - left, bottom - top);
  ctx.font = "11px Inter, system-ui, sans-serif";
  ctx.fillStyle = "#a9bdd1";
  ctx.fillText("ft MSL", 2, 12);
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let feet = floor; feet <= ceiling; feet += step) {
    const height = y(feet);
    ctx.fillStyle = "#2e435b";
    ctx.fillRect(left, height, right - left, 1);
    ctx.fillStyle = "#a9bdd1";
    ctx.fillText(number.format(feet), left - 7, height);
  }

  for (const [index, point] of samples.entries()) {
    const start = index === 0 ? 0 : (samples[index - 1].distanceKm + point.distanceKm) / 2;
    const end = index === samples.length - 1 ? distance : (samples[index + 1].distanceKm + point.distanceKm) / 2;
    const width = x(end) - x(start);
    if (point.topFt === null) {
      ctx.fillStyle = "#40516a";
      ctx.fillRect(x(start), bottom - 5, width, 5);
      continue;
    }
    const cloudTop = y(point.topFt);
    ctx.fillStyle = colors[point.phase] || colors.unknown;
    const thickness = point.baseFt === null ? 2 : Math.max(2, y(point.baseFt) - cloudTop);
    ctx.globalAlpha = point.baseFt === null ? 1 : .72;
    ctx.fillRect(x(start), cloudTop, width, thickness);
    ctx.globalAlpha = 1;
    if (point.supercooled === true) {
      ctx.fillStyle = "#ffbc65";
      ctx.fillRect(x(start), cloudTop, width, 3);
    }
  }

  ctx.strokeStyle = "#8cdbff";
  ctx.setLineDash([4, 4]);
  const selected = x(samples[Number(selector.value)].distanceKm);
  ctx.beginPath();
  ctx.moveTo(selected, top);
  ctx.lineTo(selected, bottom);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#a9bdd1";
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillText("A · 0 km", left, bottom + 8);
  ctx.textAlign = "right";
  ctx.fillText("B · " + number.format(distance) + " km", right, bottom + 8);
}

selector.addEventListener("input", () => selectSample(Number(selector.value)));
chart.addEventListener("pointerdown", (event) => {
  const { left, right } = plotSize();
  const fraction = (event.clientX - chart.getBoundingClientRect().left - left) / (right - left);
  const target = fraction * current.samples.at(-1).distanceKm;
  const index = current.samples.reduce((closest, point, candidate, samples) =>
    Math.abs(point.distanceKm - target) < Math.abs(samples[closest].distanceKm - target) ? candidate : closest, 0);
  selectSample(index);
});

const fileInput = byId("profile-file");
const error = byId("error");
let loadRequest = 0;
fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;
  const request = ++loadRequest;
  fileInput.value = "";
  error.hidden = true;
  try {
    if (file.size > 1024 * 1024) throw new Error("Choose a JSON file under 1 MB.");
    const content = await file.text();
    if (request === loadRequest) loadProfile(JSON.parse(content));
  } catch (problem) {
    if (request !== loadRequest) return;
    error.textContent = "Profile could not be loaded. " + problem.message;
    error.hidden = false;
  }
});
byId("reset").addEventListener("click", () => {
  loadRequest++;
  error.hidden = true;
  loadProfile(sampleProfile);
});
loadProfile(sampleProfile);
new ResizeObserver(drawChart).observe(chart);
