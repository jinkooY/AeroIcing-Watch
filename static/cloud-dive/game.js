// Cloud Dive UI shell. Static files only: no backend, no build step.
//
// Sections (later tasks plug into the marked extension points):
//   1. Store            shared app state with subscribe(); controls, report and why cards read it
//   2. Formatting       pure helpers
//   3. Case loading     index.json, case file, error states (design section 11)
//   4. Picker           case list with disabled entries and reasons
//   5. HUD              dollar total, ice bar, anti-ice, altitude, lane, distance
//   6. Provenance       source, UTC time, attribution (R1.3)
//   7. Boot
//
// Extension points:
//   8.2 renderer   edit render.js (renderScene); it is called on every store change
//   8.3 controls   import a module that calls subscribe() and fills #controls; use setState()
//   8.4 report     fill #report when state.status !== "flying"
//   8.5 why cards  fill #why

import * as engine from "./engine.js";
import { renderScene, describeScene, levelNames, drawLegendCanvas } from "./render.js";
import { drawFollowView, imageLegend } from "./map.js";
import { updateTrack, motionFrac, describeMap, imageNames, fitCanvas, routeKey, firstFocusable } from "./view-helpers.js";
import { TICK_MS } from "./controller.js";
import { initControls } from "./controls.js";
import { initReport } from "./report-view.js";
import { initWhy } from "./why.js";

const CASES_DIR = "cases/";
const INDEX_URL = `${CASES_DIR}index.json`;
const FILE_NAME_RE = /^[A-Za-z0-9._-]+\.json$/;

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------------------------------
// 1. Store
// ------------------------------------------------------------------------------------------

const store = {
  index: null,          // parsed cases/index.json
  entryErrors: {},      // case id -> reason the entry is disabled
  caseData: null,       // parsed case file
  engineCase: null,     // engine.loadCase result
  state: null,          // engine state (never mutated; replaced via setState)
  loading: false,
  basemap: null,        // parsed cases/basemap.json, or null when missing (R13.7)
  images: { ir: null, phase: null }, // HTMLImageElement or null per image kind
  imageKind: "ir",      // "ir" | "phase"
  track: [],            // flown positions [{lane, step}], reset with every flight
  prev: null,           // previous track entry, for display-only smooth motion
  changeAt: 0,          // performance.now() of the last step change
};
const listeners = new Set();

export function getStore() {
  return store;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setState(next) {
  store.state = next;
  notify();
}

function notify() {
  for (const fn of listeners) fn(store);
}

// ------------------------------------------------------------------------------------------
// 2. Formatting
// ------------------------------------------------------------------------------------------

export const formatUsd = (v) =>
  `$${v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

export const formatFt = (v) => `${Math.round(v).toLocaleString("en-US")} ft`;

export function formatLane(c, laneIndex) {
  const km = c.lanesKm[laneIndex];
  const offset = km === 0 ? "centre" : `${km > 0 ? "+" : "-"}${Math.abs(km)} km`;
  return `${laneIndex + 1} of ${c.nLanes} (${offset})`;
}

export function formatUtc(iso) {
  if (typeof iso !== "string") return "time not stated";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "time not stated";
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function dataKindLabel(kind) {
  return kind === "simulated" ? "Simulated" : "Observation";
}

// ------------------------------------------------------------------------------------------
// 3. Case loading
// ------------------------------------------------------------------------------------------

function describeFetchError(err, url) {
  if (location.protocol === "file:") {
    return "This page was opened from a file. Serve the folder over http (for example python -m http.server) so the browser can read case files.";
  }
  const msg = err && err.message ? err.message : String(err);
  return `${url}: ${msg}`;
}

async function fetchJson(url) {
  let res;
  try {
    res = await fetch(url, { cache: "no-cache" });
  } catch (err) {
    throw new Error(describeFetchError(err, url));
  }
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new Error(`${url}: file is not readable JSON`);
  }
}

// Returns null when the entry is usable, otherwise the reason it is disabled.
function entryProblem(entry) {
  if (!entry || typeof entry.id !== "string" || typeof entry.title !== "string") {
    return "Case entry is incomplete.";
  }
  if (typeof entry.file !== "string" || !FILE_NAME_RE.test(entry.file)) {
    return "Case file name is missing or not valid.";
  }
  return null;
}

async function loadIndex() {
  const status = $("picker-status");
  status.textContent = "Loading case list...";
  $("case-list").replaceChildren();
  hide("error");
  try {
    const index = await fetchJson(INDEX_URL);
    if (!index || !Array.isArray(index.cases) || index.cases.length === 0) {
      throw new Error(`${INDEX_URL}: no cases listed`);
    }
    store.index = index;
    store.entryErrors = {};
    for (const entry of index.cases) {
      const problem = entryProblem(entry);
      if (problem && entry && typeof entry.id === "string") store.entryErrors[entry.id] = problem;
    }
    status.textContent = "Pick a route and a day. Each case is a stored snapshot, not live data.";
    renderPicker();
    // ?case=<id> opens that case directly (used by the headless layout check, task 12.4).
    const wanted = new URLSearchParams(location.search).get("case");
    const entry = wanted && index.cases.find((e) => e && e.id === wanted);
    if (entry && !store.entryErrors[entry.id]) openCase(entry);
  } catch (err) {
    store.index = null;
    status.textContent = "The case list could not be loaded.";
    $("error-text").textContent = err.message;
    show("error");
    renderPicker();
    renderScene($("scene"), { caseData: null, engineCase: null, state: null, message: "Case list not available." },
      { legend: false, width: canvasCss.scene.w, height: canvasCss.scene.h });
  }
}

async function openCase(entry) {
  if (store.loading) return;
  store.loading = true;
  const status = $("picker-status");
  status.textContent = `Loading ${entry.title}...`;
  try {
    const data = await fetchJson(CASES_DIR + entry.file);
    if (data.schemaVersion !== 2) throw new Error(`${entry.file}: unsupported case file version`);
    const engineCase = engine.loadCase(data);
    store.caseData = data;
    store.engineCase = engineCase;
    store.state = engine.initialState(engineCase);
    store.track = [];
    store.prev = null;
    store.images = { ir: null, phase: null };
    delete store.entryErrors[entry.id];
    showFlight();
    // Test-only: ?ff=end flies the whole case with the starting targets so a headless run can capture the
    // report dialog. It uses the engine's own step; it is not linked from the page and not shown.
    if (new URLSearchParams(location.search).get("ff") === "end") {
      let st = store.state;
      for (let i = 0; i < 100000 && st.status === "flying"; i++) st = engine.step(engineCase, st);
      store.state = st;
    }
    notify();
    loadMapAssets(data); // images and basemap arrive later; the map shows fallbacks until then
  } catch (err) {
    store.entryErrors[entry.id] = err.message;
    status.textContent = `${entry.title} could not be opened. Choose another case.`;
    renderPicker();
  } finally {
    store.loading = false;
  }
}

// ------------------------------------------------------------------------------------------
// 4. Picker
// ------------------------------------------------------------------------------------------

function renderPicker() {
  const list = $("case-list");
  list.replaceChildren();
  const cases = store.index ? store.index.cases : [];
  for (const entry of cases) {
    const reason = entry && store.entryErrors[entry.id];
    const li = document.createElement("li");
    li.className = "case-item" + (reason ? " disabled" : "");

    const info = document.createElement("div");
    const title = document.createElement("div");
    title.className = "case-title";
    title.textContent = (entry && entry.title) || "Untitled case";
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = dataKindLabel(entry && entry.dataKind);
    title.appendChild(tag);

    const meta = document.createElement("div");
    meta.className = "case-meta";
    const route = entry && entry.route ? `${entry.route.from} to ${entry.route.to}, ${Math.round(entry.route.lengthKm)} km` : "";
    meta.textContent = [route, entry && entry.observedAtUtc ? `satellite time ${formatUtc(entry.observedAtUtc)}` : ""]
      .filter(Boolean).join(" | ");
    info.append(title, meta);

    if (reason) {
      const r = document.createElement("div");
      r.className = "case-reason";
      r.id = `reason-${entry.id}`;
      r.textContent = `Unavailable: ${reason}`;
      info.appendChild(r);
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Fly this case";
    if (reason) {
      btn.disabled = true;
      btn.setAttribute("aria-describedby", `reason-${entry.id}`);
    } else {
      btn.addEventListener("click", () => openCase(entry));
    }
    li.append(info, btn);
    list.appendChild(li);
  }
  show("picker");
  hide("flight");
  document.body.classList.remove("in-flight");
  closeDialog(false);
}

function showFlight() {
  hide("picker");
  show("flight");
  document.body.classList.add("in-flight");
  $("flight-title").textContent = store.caseData.title;
  $("flight-title").title = store.caseData.title;
  $("flight-title").focus?.();
}

// Map assets are the site's own static files under cases/ (R13.8). Any failure leaves null: the map then
// draws its fallback text and the lanes (R13.7).
function loadImage(name) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = CASES_DIR + name;
  });
}

async function loadMapAssets(data) {
  if (!store.basemap) {
    try {
      store.basemap = await fetchJson(`${CASES_DIR}basemap.json`);
    } catch {
      store.basemap = null;
    }
  }
  const names = imageNames(data);
  const kinds = Object.keys(names);
  const loaded = await Promise.all(kinds.map((k) => loadImage(names[k])));
  if (store.caseData !== data) return; // the player moved to another case meanwhile
  kinds.forEach((k, i) => { store.images[k] = loaded[i]; });
  notify();
}

function backToCases() {
  store.caseData = null;
  store.track = [];
  store.prev = null;
  store.engineCase = null;
  store.state = null;
  renderPicker();
  notify();
}

// ------------------------------------------------------------------------------------------
// 5. HUD
// ------------------------------------------------------------------------------------------

function renderHud(s) {
  const c = s.engineCase;
  const st = s.state;
  if (!c || !st) return;
  $("hud-total").textContent = formatUsd(engine.totalUsd(c, st));
  $("hud-ice-fill").style.width = `${st.ice}%`;
  $("hud-ice-bar").setAttribute("aria-valuenow", String(st.ice));
  $("hud-ice-text").textContent = `${st.ice} / ${engine.ICE_MAX}`;
  $("hud-anti-ice").textContent = st.antiIce ? "On" : "Off";
  $("hud-alt").textContent = formatFt(c.altsFt[st.alt]);
  $("hud-lane").textContent = formatLane(c, st.lane);
  const flown = Math.min(engine.stateDistanceKm(st), c.distanceKm);
  $("hud-dist").textContent = `${Math.round(flown)} of ${Math.round(c.distanceKm)} km`;
}

const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

let animHandle = 0;

// Draws side view and map view. frac is the display-only share of the way from the previous step
// position to the current one; the engine state is never touched here (R13.10).
function paintScene(s, frac) {
  const message = s.engineCase ? "" : "No case loaded.";
  const base = { caseData: s.caseData, engineCase: s.engineCase, state: s.state, message, prev: s.prev, frac };
  const sc = canvasCss.scene;
  const sceneCtx = $("scene").getContext("2d");
  if (sceneCtx) sceneCtx.clearRect(0, 0, sc.w, sc.h);
  renderScene($("scene"), base, { legend: false, width: sc.w, height: sc.h });
  const follow = $("map-follow").getContext("2d");
  const fc = canvasCss.follow;
  if (follow && s.engineCase && s.state) {
    const mapView = { ...base, images: s.images, basemap: s.basemap, followKm: 200, imageKind: s.imageKind, track: s.track };
    follow.clearRect(0, 0, fc.w, fc.h);
    drawFollowView(follow, mapView, { x: 0, y: 0, w: fc.w, h: fc.h });
  }
}

// CSS-pixel sizes of the canvases (R13.2); fitCanvas updates them when a box changes size.
const canvasCss = { scene: { w: 960, h: 560 }, follow: { w: 960, h: 380 } };

function fitCanvases() {
  for (const [key, id] of [["scene", "scene"], ["follow", "map-follow"]]) {
    fitCanvas($(id), (w, h) => {
      canvasCss[key] = { w, h };
      if (store.engineCase && store.state) paintScene(store, 1);
      else renderScene($("scene"), { caseData: null, engineCase: null, state: null, message: "No case loaded." }, { legend: false, width: canvasCss.scene.w, height: canvasCss.scene.h });
    });
  }
}

function animate() {
  animHandle = 0;
  const s = store;
  if (!s.engineCase || !s.state) return;
  const frac = motionFrac(performance.now() - s.changeAt, TICK_MS, reducedMotion());
  paintScene(s, frac);
  if (frac < 1) animHandle = requestAnimationFrame(animate);
}

function startAnimation() {
  if (!animHandle) animHandle = requestAnimationFrame(animate);
}

let textTimer = 0;
let textAt = 0;
const TEXT_MIN_MS = 1500;

// Text alternative of the map: updated per step, but announced at most every TEXT_MIN_MS (R13.9).
function updateMapText(s) {
  const put = () => {
    textTimer = 0;
    textAt = performance.now();
    const cur = store;
    $("map-text").textContent = describeMap(cur.caseData, cur.engineCase, cur.state);
  };
  if (!s.engineCase || !s.state) {
    $("map-text").textContent = "";
    return;
  }
  const wait = TEXT_MIN_MS - (performance.now() - textAt);
  if (wait <= 0) put();
  else if (!textTimer) textTimer = setTimeout(put, wait);
}

// Map key strip (R14.2): the four evidence patterns with their exact level labels, then the R13.3 image
// label. The R13.4 notes are the tooltip of the strip; the Legend panel carries all of them.
// Level order in the case file: Not assessed, Not indicated, Possible, Observed.
function renderMapKey(s) {
  const levels = levelNames(s.caseData);
  const entries = [
    [levels[3], "key-observed"],
    [levels[2], "key-possible"],
    [levels[0], "key-assessed-not"],
    [levels[1], "key-none"],
  ];
  const list = $("map-key-levels");
  list.replaceChildren();
  for (const [label, cls] of entries) {
    const li = document.createElement("li");
    const sw = document.createElement("span");
    sw.className = `key-swatch ${cls}`;
    sw.setAttribute("aria-hidden", "true");
    li.append(sw, document.createTextNode(label));
    list.appendChild(li);
  }
  const legend = imageLegend(s.caseData);
  const image = $("map-key-image");
  if (legend) {
    image.textContent = `${legend.title}: ${legend.detail}`;
    $("map-key").title = [legend.single, legend.parallax].join(" ");
  } else {
    image.textContent = "Satellite image not available for this case.";
    $("map-key").removeAttribute("title");
  }
}

function renderMapLegend(s) {
  renderMapKey(s);
  drawLegendCanvas($("legend-canvas"), s.caseData);
  const box = $("map-legend");
  box.replaceChildren();
  const legend = imageLegend(s.caseData);
  const add = (text, strong) => {
    const p = document.createElement("p");
    if (strong) p.style.fontWeight = "600";
    p.textContent = text;
    box.appendChild(p);
  };
  if (!legend) {
    add("Satellite image not available for this case. Lanes and evidence patches are drawn on the basemap.");
    return;
  }
  add(legend.title, true);
  add(legend.detail);
  add(legend.single);
  add(legend.parallax);
  add(s.imageKind === "phase"
    ? "Phase image: cloud-top phase classes from the satellite product, shown as different grey levels."
    : "IR image: brightness temperature of the cloud top, 180 K white, 310 K black.");
  add("Hatched area labelled \"Outside satellite image\": no satellite data there (outside the scan sector or the image). It is not clear sky.");
  add(`Evidence patches on the map: ${legend.levels[3]} (orange outline); ${legend.levels[2]} (dots); ${legend.levels[0]} (stripes); ${legend.levels[1]} (no fill).`);
}

function renderToggle(s) {
  const phase = s.imageKind === "phase";
  const b = $("map-kind-toggle");
  b.setAttribute("aria-pressed", String(phase));
  b.textContent = phase ? "Satellite image: phase (M shows IR)" : "Satellite image: IR (M shows phase)";
}

let legendKey = "";

function renderSceneNow(s) {
  if (s.engineCase && s.state) {
    const before = s.track.length ? s.track[s.track.length - 1] : null;
    const next = updateTrack(s.track, s.state);
    if (next !== s.track) {
      s.prev = next.length > 1 && before ? before : null;
      s.track = next;
      s.changeAt = performance.now();
    }
    const lane = s.state.lane + 1;
    $("side-title").textContent = `Side view: altitude along lane ${lane} of ${s.engineCase.nLanes}`;
  } else {
    $("side-title").textContent = "Side view";
  }
  const key = `${s.caseData ? s.caseData.title : ""}|${s.imageKind}|${s.images.ir ? 1 : 0}${s.images.phase ? 1 : 0}`;
  if (key !== legendKey) {
    legendKey = key;
    renderMapLegend(s);
  }
  renderToggle(s);
  const frac = s.engineCase && s.state && s.prev
    ? motionFrac(performance.now() - s.changeAt, TICK_MS, reducedMotion()) : 1;
  paintScene(s, frac);
  if (frac < 1) startAnimation();
  $("scene-text").textContent = describeScene({ caseData: s.caseData, engineCase: s.engineCase, state: s.state });
  updateMapText(s);
}

function toggleImageKind() {
  store.imageKind = store.imageKind === "phase" ? "ir" : "phase";
  notify();
}

function onMapKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
  if (!gameKeysAllowed(e)) return;
  if (e.key !== "m" && e.key !== "M") return;
  if (!store.engineCase || !store.state || $("flight").hidden) return;
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
  e.preventDefault();
  toggleImageKind();
}

// ------------------------------------------------------------------------------------------
// 6. Provenance
// ------------------------------------------------------------------------------------------

function renderSources(s) {
  const d = s.caseData;
  if (!d) return;
  const src = d.sources || {};
  const sat = src.satellite || {};
  const fc = src.forecast || {};
  $("src-kind").textContent = dataKindLabel(d.dataKind);
  $("src-sat").textContent = sat.satellite
    ? `${sat.satellite}, scan start ${formatUtc(sat.scanStartUtc)}`
    : "Not stated";
  $("src-fc").textContent = fc.name
    ? `${fc.name}, run ${formatUtc(fc.runUtc)}`
    : "Not stated";
  const attr = $("src-attr");
  attr.replaceChildren();
  for (const line of src.attribution || []) {
    const li = document.createElement("li");
    li.textContent = line;
    attr.appendChild(li);
  }
  const labels = d.labels || {};
  $("src-labels").textContent = [labels.gameModel, labels.references].filter(Boolean).join(" ");
}

// ------------------------------------------------------------------------------------------
// 7. Boot
// ------------------------------------------------------------------------------------------

function show(id) { $(id).hidden = false; }
function hide(id) { $(id).hidden = true; }

// ------------------------------------------------------------------------------------------
// Dialogs (task 12.3, design 9.2). Report, Why cards, sources and legend are native <dialog> elements
// opened with showModal(). Escape (native) and the Close button close them; the close event returns
// focus to the opener. The report opens by itself when the flight ends.
// ------------------------------------------------------------------------------------------

const DIALOG_IDS = { report: "dlg-report", why: "dlg-why", sources: "dlg-sources", legend: "dlg-legend" };
let current = null; // { name, dlg, opener, restore } of the open dialog, or null
let reportShownFor = null;

const openDialogName = () => (current ? current.name : null);

// True when the game keys (arrows, A, Space, M) may act on the flight for this key event.
const gameKeysAllowed = (e) => routeKey(e, openDialogName()) === "game";

function openDialog(name, opener) {
  const dlg = $(DIALOG_IDS[name]);
  if (!dlg || (current && current.dlg === dlg)) return;
  // Replace an open dialog (for example Legend open when the flight ends): the earlier opener stays.
  let from = opener || null;
  if (current) {
    from = current.opener;
    current.restore = false;
    current.dlg.close();
  }
  current = { name, dlg, opener: from, restore: true };
  dlg.showModal();
  const heading = dlg.querySelector("h1, h2, h3");
  const target = heading || dlg.querySelector(".dlg-close");
  if (target) {
    if (heading) heading.tabIndex = -1;
    target.focus({ preventScroll: true });
  }
}

// Closes the open dialog. restoreFocus false is used when the page changes underneath it.
function closeDialog(restoreFocus = true) {
  if (!current) return;
  current.restore = restoreFocus;
  current.dlg.close();
}

// The close event fires for Escape, the Close button and close(). Focus goes back to the opener, or to the
// first control that can take it (the report opens when Continue is already disabled).
function onDialogClosed(dlg) {
  if (!current || current.dlg !== dlg) return; // a replaced dialog
  const { opener, restore } = current;
  current = null;
  if (!restore) return;
  const target = firstFocusable([opener, $("ctl-go"), $("back-to-cases"), $("flight-title")]);
  if (target) target.focus();
}

// Key L opens Legend, or closes it when only Legend is open (R14.2). Other game keys are blocked by
// gameKeysAllowed while a dialog is open.
function onLegendKey(e) {
  if (routeKey(e, openDialogName()) !== "toggle-legend") return;
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
  if (current) closeDialog();
  else if (store.engineCase && store.state && !$("flight").hidden) {
    const a = document.activeElement;
    openDialog("legend", a && a !== document.body ? a : null);
  }
  else return;
  e.preventDefault();
}

function maybeOpenReport(s) {
  const st = s.state;
  if (!s.engineCase || !st || st.status === "flying") {
    reportShownFor = null;
    return;
  }
  if (reportShownFor === st) return;
  reportShownFor = st;
  // Opener: Start/Continue when it can take focus, else Change case.
  openDialog("report", firstFocusable([$("ctl-go"), $("back-to-cases")]));
}

// ------------------------------------------------------------------------------------------
// Layout check (headless tests only): ?layoutcheck=1 sets document.body.dataset.fits to "yes" or "no"
// after the first render and at the first gate. Never shown. ?case=<id> opens that case directly.
// ------------------------------------------------------------------------------------------

const params = new URLSearchParams(location.search);
const layoutCheck = params.get("layoutcheck") === "1";
let fitsStart = null;
let fitsGateDone = false;

// True when nothing overflows the viewport: the document, the page columns and the grid cells.
function layoutFits() {
  const root = document.documentElement;
  const tall = Math.max(root.scrollHeight, document.body.scrollHeight) <= window.innerHeight;
  const wide = Math.max(root.scrollWidth, document.body.scrollWidth) <= window.innerWidth;
  const boxes = [...document.querySelectorAll("[data-fit-box]")]
    .filter((n) => n.offsetParent !== null)
    .every((n) => n.scrollHeight <= n.clientHeight + 1);
  return tall && wide && boxes;
}

function afterPaint(fn) {
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

function checkLayout(s) {
  if (!layoutCheck || !s.engineCase || !s.state) return;
  const gate = document.getElementById("gate-panel");
  const atGate = Boolean(gate && gate.classList.contains("is-gate"));
  if (fitsStart === null) {
    fitsStart = "pending";
    afterPaint(() => {
      fitsStart = layoutFits();
      document.body.dataset.fits = fitsStart ? "yes" : "no";
    });
  } else if (atGate && !fitsGateDone && typeof fitsStart === "boolean") {
    fitsGateDone = true;
    afterPaint(() => {
      document.body.dataset.fits = fitsStart && layoutFits() ? "yes" : "no";
    });
  }
}

function onChange(s) {
  renderHud(s);
  renderSources(s);
  renderSceneNow(s);
  checkLayout(s);
}

function boot() {
  subscribe(onChange);
  initControls({ root: $("controls"), getStore, subscribe, setState, formatFt, gameKeysAllowed });
  initReport({ root: $("report"), getStore, subscribe });
  initWhy({ root: $("why"), subscribe });
  // After the report view has filled #report, so the dialog opens with its content and heading.
  subscribe(maybeOpenReport);
  // The key help moves from the controls into the legend dialog to keep the controls compact.
  const keyHelp = $("controls").querySelector(".ctl-keys");
  if (keyHelp) $("legend-keys").appendChild(keyHelp);
  for (const b of document.querySelectorAll("[data-dialog]")) {
    b.addEventListener("click", () => openDialog(b.dataset.dialog, b));
  }
  for (const [name, id] of Object.entries(DIALOG_IDS)) {
    const dlg = $(id);
    dlg.querySelector(".dlg-close").addEventListener("click", () => closeDialog());
    dlg.addEventListener("close", () => onDialogClosed(dlg));
  }
  document.addEventListener("keydown", onLegendKey);
  $("map-kind-toggle").addEventListener("click", toggleImageKind);
  document.addEventListener("keydown", onMapKey);
  $("back-to-cases").addEventListener("click", backToCases);
  $("error-retry").addEventListener("click", loadIndex);
  $("flight-title").tabIndex = -1;
  fitCanvases();
  loadIndex();
}

boot();
