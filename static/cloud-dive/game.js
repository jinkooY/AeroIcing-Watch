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
import { initGatePanel } from "./gate-panel.js";
import { webglAvailable } from "./webgl-test.js";
import { buildScene } from "./scene.js";
import { createPanel, sourceLine } from "./panel.js";
import { fuelDisplayUsd, fuelDisplayWithDepartureUsd } from "./fuel-counter.js";
import { departureUsd, withDeparture } from "./departure.js";
import { cardApplies, departureCardText } from "./departure-card.js";
import { popupFor } from "./cost-popup.js";
import { createCruiseCamera, positionKm, eyePosition } from "./cruise-camera.js";
import { chooseView, buttonLabel, viewKeyApplies } from "./view-mode.js";
import { toggleMode, chaseKeyApplies, chaseButtonLabel } from "./chase.js";
import { phaseStep, phasePose } from "./phases.js";
import {
  inLead, newPhaseState, sceneOptions, isStartKey, frameDt, leadAdvance, engineStartState, finishLead,
  withLeadEye, leadStatusText,
  inEnding, endingInput, finishEnding, isSkipKey, endingStatusText, skippable, setReducedMotion,
} from "./takeoff.js";

let gatePanel = null; // set in boot(); the cockpit view (task 15.5) calls gatePanel.setCockpit(on)
import { initReport } from "./report-view.js";
import * as hotseat from "./hotseat.js";
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
  hot: null,            // hot-seat session (hotseat.js), or null for the single-player flow; in memory only (R20.3)
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

async function openCase(entry, hot = null) {
  if (store.loading) return;
  store.loading = true;
  const status = $("picker-status");
  status.textContent = `Loading ${entry.title}...`;
  try {
    const data = await fetchJson(CASES_DIR + entry.file);
    if (data.schemaVersion !== 2) throw new Error(`${entry.file}: unsupported case file version`);
    const engineCase = engine.loadCase(data);
    store.caseData = data;
    store.hot = hot;
    store.engineCase = engineCase;
    store.state = engine.initialState(engineCase);
    store.track = [];
    store.prev = null;
    store.images = { ir: null, phase: null };
    delete store.entryErrors[entry.id];
    showFlight();
    resetCockpitFlight();
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
    const hotBtn = document.createElement("button");
    hotBtn.type = "button";
    hotBtn.textContent = "Hot-seat (2 to 4 players)";
    if (reason) {
      btn.disabled = true;
      hotBtn.disabled = true;
      btn.setAttribute("aria-describedby", `reason-${entry.id}`);
      hotBtn.setAttribute("aria-describedby", `reason-${entry.id}`);
    } else {
      btn.addEventListener("click", () => openCase(entry));
      hotBtn.addEventListener("click", () => openHotseatSetup(entry, hotBtn));
    }
    const actions = document.createElement("div");
    actions.className = "case-actions";
    actions.append(btn, hotBtn);
    li.append(info, actions);
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
  store.hot = null;
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
  // Engine total + Departure climb, except while the runway lead-in runs (R15.5, R4.6).
  renderDepartureCard();
  const dep = departureUsd(s.caseData && s.caseData.params);
  const showDep = dep > 0 && !leadActive();
  $("hud-total").textContent = formatUsd(showDep ? withDeparture(engine.totalUsd(c, st), s.caseData.params) : engine.totalUsd(c, st));
  $("hud-total-label").textContent = showDep ? "Fuel cost incl. Departure climb" : "Fuel cost (game)";
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
  if (isCockpitView()) return; // the 2D canvases are hidden in the cockpit view
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
  $("src-line").textContent = ` | ${sourceLine(d)}`; // source line with UTC time on every flight screen (R1.3)
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

const DIALOG_IDS = {
  report: "dlg-report", why: "dlg-why", sources: "dlg-sources", legend: "dlg-legend",
  hotseat: "dlg-hotseat", handover: "dlg-handover", results: "dlg-results",
};
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
  const { opener, restore, name } = current;
  current = null;
  if (!restore) return;
  // Hot-seat: after a player has read their own report, the device is handed on (R20.1).
  if (name === "report" && store.hot && hotseat.handOverDue(store.hot)) {
    openHandOver();
    return;
  }
  // After the last player closes their report, the results table opens (R20.2).
  if (name === "report" && store.hot && hotseat.resultsDue(store.hot)) {
    openResults(opener);
    return;
  }
  const target = firstFocusable([opener, $("ctl-go"), $("back-to-cases"), $("flight-title")]);
  if (target) target.focus();
}

// ---- Hot-seat dialogs (task 18.2). Session in memory only; nothing is stored or uploaded (R20.3). ----
let hotPending = null; // the case entry waiting for the setup dialog

function renderHotNames() {
  const n = Number($("hotseat-count").value);
  const box = $("hotseat-names");
  const old = [...box.querySelectorAll("input")].map((i) => i.value);
  box.replaceChildren();
  for (let i = 0; i < n; i += 1) {
    const label = document.createElement("label");
    label.setAttribute("for", `hotseat-name-${i}`);
    label.textContent = `Name of player ${i + 1} (optional)`;
    const input = document.createElement("input");
    input.type = "text";
    input.id = `hotseat-name-${i}`;
    input.maxLength = hotseat.MAX_NAME_LENGTH;
    input.autocomplete = "off";
    input.value = old[i] || "";
    label.appendChild(input);
    box.appendChild(label);
  }
}

function openHotseatSetup(entry, opener) {
  hotPending = entry;
  $("hotseat-case").textContent = `Case: ${entry.title}`;
  renderHotNames();
  openDialog("hotseat", opener);
}

function submitHotseat(e) {
  e.preventDefault();
  const entry = hotPending;
  if (!entry) return;
  const names = [...$("hotseat-names").querySelectorAll("input")].map((i) => i.value);
  const session = hotseat.start(hotseat.setupNames(names, Number($("hotseat-count").value)));
  hotPending = null;
  closeDialog(false);
  openCase(entry, session);
}

function openHandOver() {
  $("handover-text").textContent = hotseat.handOverText(store.hot);
  openDialog("handover", null);
}

// Results table (task 18.3). Built with textContent only; a real <table> with column and row headers.
function openResults(opener) {
  const view = hotseat.resultsRows(store.hot, store.caseData.references, store.caseData.params);
  const table = $("results-table");
  table.replaceChildren();
  const cap = document.createElement("caption");
  cap.textContent = "Fuel cost per player, lowest first. Diverted flights are not ranked.";
  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  for (const h of view.headers) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = h;
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  const tbody = document.createElement("tbody");
  const nPlayers = store.hot.players.length;
  view.rows.forEach((row, i) => {
    const tr = document.createElement("tr");
    if (i >= nPlayers) tr.className = "baseline-row";
    row.forEach((text, c) => {
      const cell = document.createElement(c === 0 ? "th" : "td");
      if (c === 0) cell.scope = "row";
      cell.textContent = text;
      tr.appendChild(cell);
    });
    tbody.appendChild(tr);
  });
  table.append(cap, thead, tbody);
  $("results-departure").textContent = view.departureLine;
  $("results-notes").textContent = view.notes.join(" ");
  openDialog("results", opener);
}

function playAgain() {
  if (!store.hot || !store.engineCase) return;
  store.hot = hotseat.playAgain(store.hot);
  store.track = [];
  store.prev = null;
  store.state = engine.initialState(store.engineCase);
  reportShownFor = null;
  closeDialog(false);
  resetCockpitFlight();
  notify();
  $("flight-title").focus?.({ preventScroll: true });
}

// A fresh engine and a fresh takeoff lead-in on the same case (R20.1).
function startNextFlight() {
  if (!store.hot || !hotseat.handOverDue(store.hot) || !store.engineCase) return;
  store.hot = hotseat.next(store.hot);
  store.track = [];
  store.prev = null;
  store.state = engine.initialState(store.engineCase);
  reportShownFor = null;
  closeDialog(false);
  resetCockpitFlight();
  notify();
  $("flight-title").focus?.({ preventScroll: true });
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
  if (endingRunning()) return; // the arrival or diversion cinematic plays first; the report opens after it (R15.9, R15.10)
  reportShownFor = st;
  if (s.hot) {
    const res = hotseat.resultFromEngine(engine.summary(s.engineCase, st), s.caseData.params);
    if (res) s.hot = hotseat.finish(s.hot, res);
  }
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

// ------------------------------------------------------------------------------------------
// Cockpit view (task 15.5, design 14.7 and 14.10). The default flight view. cockpit3d.js is loaded with a
// dynamic import() after the WebGL test passes, so a 3D failure never breaks the 2D game: the 2D view opens
// with a notice and plays the same flight through the same controller, with the same costs (R19.1).
// The 3D layer only draws the scene description built by scene.js from the case and the engine state; nothing
// here changes the engine state.
// ------------------------------------------------------------------------------------------

const cockpit = {
  status: "idle",   // "idle" | "loading" | "ready" | "failed" (the 3D layer)
  reason: null,     // "no-webgl" | "load-failed" when failed
  wants2d: false,   // the player chose the 2D view (key V or button, R19.2)
  view: "2d",       // the view on screen: "cockpit" | "2d"
  renderer: null,   // createCockpit() result
  panel: null,      // createPanel() result
  camera: createCruiseCamera(),
  scene: null,      // scene description of the current engine state
  sceneFor: null,   // engine state object the scene was built from
  from: null,       // { altFt, lane } before the last step, for display blending
  to: null,         // { altFt, lane } at the current step
  lastStep: null,
  handle: 0,        // requestAnimationFrame handle
  phase: null,      // phases.js state of the flight: runway, takeoff and climb before the engine starts (task 17.3)
  leadLast: null,   // frame time of the previous lead-in frame, for real elapsed time
  leadKey: "",      // phase and state the panel was last built for
  mode: "cockpit",  // camera of the 3D view: "cockpit" | "chase" (key C, task 19.1); display only
};
let flightController = null; // set in boot()

const isCockpitView = () => cockpit.view === "cockpit";
const pixelRatio = () => Math.min(typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? devicePixelRatio : 1, 2);

// A new flight: forget the previous camera and blend positions.
function resetCockpitFlight() {
  cockpit.camera.reset();
  cockpit.scene = null;
  cockpit.sceneFor = null;
  cockpit.from = null;
  cockpit.to = null;
  cockpit.lastStep = null;
  cockpit.fuelPrev = null;
  cockpit.fuelCur = null;
  cockpit.stopState = null;
  cockpit.phase = store.engineCase ? newPhaseState(store.caseData, store.engineCase, reducedMotion()) : null;
  cockpit.leadLast = null;
  cockpit.leadKey = "";
  if (cockpit.panel && cockpit.panel.hideCost) cockpit.panel.hideCost();
  renderLeadUi();
}

// ---- Runway and takeoff (task 17.3) ----
// The lead-in runs only in the cockpit view. The 2D view starts the flight as before (R19.1).
const leadActive = () => isCockpitView() && inLead(cockpit.phase);

// Shows or hides the takeoff box and the controls, and the gate choices, for the current phase.
function renderLeadUi() {
  const lead = leadActive();
  const ending = endingRunning();
  document.body.classList.toggle("lead-active", lead || ending);
  $("lead-box").hidden = !(lead || ending);
  $("lead-title").textContent = ending ? (cockpit.phase.phase === "arrival" ? "Arrival" : "Diversion") : "Departure";
  const ready = lead && cockpit.phase.phase === "ready";
  $("takeoff-btn").hidden = !ready;
  $("skip-btn").hidden = !cinematicRunning();
  const air = store.caseData && store.caseData.airports ? store.caseData.airports : {};
  const icao = air.from ? air.from.icao : "";
  const toIcao = air.to ? air.to.icao : "";
  $("lead-status").textContent = lead ? leadStatusText(cockpit.phase, icao) : ending ? endingStatusText(cockpit.phase, toIcao) : "";
  if (gatePanel) gatePanel.setCockpit(isCockpitView() && !lead && !ending);
  renderDepartureCard();
}

// Departure climb status card of the 2D view, before the first step (task 17.7, R19.1, R15.5).
function renderDepartureCard() {
  const s = store;
  const show = Boolean(s.caseData) && cardApplies({ view: cockpit.view, state: s.state, params: s.caseData.params });
  $("departure-card").hidden = !show;
  if (!show) return;
  const t = departureCardText(s.caseData, s.engineCase);
  $("departure-card-title").textContent = t.title;
  $("departure-card-cost").textContent = t.cost;
  $("departure-card-route").textContent = t.route;
  $("departure-card-level").textContent = t.level;
  $("departure-card-note").textContent = t.note;
}

// ---- Arrival and diversion cinematics (task 17.5) ----
// Unscored and display only: the engine state and the case are never changed here.
const endingRunning = () => isCockpitView() && inEnding(cockpit.phase);

// The engine reported the end of the flight: start the cinematic in the cockpit view; the 2D view goes
// straight to the report (R15.9, R15.10).
function beginEnding(s) {
  const ps = cockpit.phase;
  if (!ps || !s.engineCase || !s.state || s.state.status === "flying") return;
  if (ps.phase !== "cruise" && ps.phase !== "gate") return;
  let next = phaseStep(ps, 0, endingInput(s.engineCase, s.state));
  if (!isCockpitView()) next = finishEnding(next);
  cockpit.phase = next;
  cockpit.leadLast = null;
  cockpit.sceneFor = null;
  renderLeadUi();
  if (endingRunning()) $("skip-btn").focus({ preventScroll: true });
}

// Skip (task 17.6): button and Space, only while takeoff, climb, arrival or diversion runs (R15.11).
// Space in cruise and gate stays Continue/Pause. Only the phase moves on; no value changes.
const cinematicRunning = () => isCockpitView() && skippable(cockpit.phase);
let skipRequested = false;
function skipEnding() {
  if (!cinematicRunning()) return;
  skipRequested = true;
  requestCockpitFrame();
}

// The reduced-motion setting can change during play (R15.12): the running phase keeps its progress.
function onReducedMotionChange() {
  if (cockpit.phase) cockpit.phase = setReducedMotion(cockpit.phase, reducedMotion());
  requestCockpitFrame();
}

function onSkipKey(e) {
  if (!cinematicRunning() || e.defaultPrevented || !isSkipKey(e)) return;
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
  if (t && (t.tagName === "BUTTON" || t.tagName === "A") && t !== $("skip-btn")) return;
  e.preventDefault();
  skipEnding();
}

// One cinematic frame. Returns true when it drew the frame; false when the cinematic just ended (the report
// opens and the normal frame follows).
function endingFrame(now) {
  const s = store;
  const c = s.engineCase;
  const reduced = reducedMotion();
  const dt = frameDt(now, cockpit.leadLast);
  cockpit.leadLast = now;
  const skip = skipRequested;
  skipRequested = false;
  cockpit.phase = phaseStep(cockpit.phase, dt, skip ? { skip: true } : {});
  if (!inEnding(cockpit.phase)) {
    cockpit.sceneFor = null;
    renderLeadUi();
    maybeOpenReport(s);
    return false;
  }
  const pose = phasePose(cockpit.phase);
  const scene = withLeadEye(buildScene(s.caseData, s.state, pose, sceneOptions(s.caseData, c, { mode: cockpit.mode, reducedMotion: reduced })));
  if (cockpit.panel && s.state !== cockpit.sceneFor) {
    cockpit.sceneFor = s.state;
    cockpit.panel.update(scene, { caseData: s.caseData, engineCase: c, state: s.state, track: s.track });
    if (cockpit.panel.setFuel) {
      const total = engine.totalUsd(c, s.state);
      cockpit.panel.setFuel(fuelDisplayWithDepartureUsd(total, total, 1, true, departureUsd(s.caseData && s.caseData.params)));
    }
  }
  try {
    cockpit.renderer.render(scene, { nowMs: now, reducedMotion: reduced });
  } catch (err) {
    console.warn("3D view stopped:", err && err.message ? err.message : err);
    cockpit.status = "failed";
    cockpit.reason = "load-failed";
    applyView();
    return true;
  }
  requestCockpitFrame();
  return true;
}

// A new view or a flight already under way ends the lead-in without a cinematic.
function syncLeadToView() {
  if (inEnding(cockpit.phase) && !isCockpitView()) {
    cockpit.phase = finishEnding(cockpit.phase);
    cockpit.sceneFor = null;
    renderLeadUi();
    maybeOpenReport(store);
  }
  if (!cockpit.phase || !inLead(cockpit.phase)) return;
  const started = Boolean(store.state && store.state.step > 0);
  if (!isCockpitView() || started) {
    cockpit.phase = finishLead(cockpit.phase);
    cockpit.sceneFor = null;
  }
}

function startTakeoff() {
  if (!leadActive() || cockpit.phase.phase !== "ready") return;
  cockpit.phase = phaseStep(cockpit.phase, 0, { start: true });
  cockpit.leadLast = null;
  renderLeadUi();
  $("lead-title").focus({ preventScroll: true });
  requestCockpitFrame();
}

function onStartKey(e) {
  if (!leadActive() || cockpit.phase.phase !== "ready" || e.defaultPrevented) return;
  if (!isStartKey(e) || !gameKeysAllowed(e)) return;
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
  if (t && (t.tagName === "BUTTON" || t.tagName === "A") && t !== $("takeoff-btn")) return;
  e.preventDefault();
  startTakeoff();
}

// One lead-in frame (ready, takeoff, climb). Returns true when it drew the frame; false when the climb just ended
// and the normal cruise frame should follow. The engine does not step here (engineMayStep is false).
function leadFrame(now) {
  const s = store;
  const c = s.engineCase;
  const reduced = reducedMotion();
  const dt = cockpit.phase.phase === "ready" ? 0 : frameDt(now, cockpit.leadLast);
  cockpit.leadLast = now;
  const before = cockpit.phase.phase;
  const skip = skipRequested && before !== "ready";
  if (skip) skipRequested = false;
  const r = leadAdvance(cockpit.phase, dt, skip ? { skip: true } : {});
  cockpit.phase = r.ps;
  if (r.engineStart) {
    const next = engineStartState(c, s.state);
    cockpit.sceneFor = null;
    if (next !== s.state) setState(next);
    renderLeadUi();
    renderHud(s); // the Departure climb joins the shown total at the hand-over (R15.5)
    return false;
  }
  if (cockpit.phase.phase !== before) renderLeadUi();
  const pose = phasePose(cockpit.phase);
  const base = buildScene(s.caseData, s.state, pose, sceneOptions(s.caseData, c, { mode: cockpit.mode, reducedMotion: reduced }));
  const scene = withLeadEye(base);
  // The panel text changes inside the climb when the aircraft passes the altitude block (R15.6).
  const key = `${cockpit.phase.phase}|${scene.panel.levelHere}`;
  if (cockpit.panel && (key !== cockpit.leadKey || s.state !== cockpit.sceneFor)) {
    cockpit.leadKey = key;
    cockpit.sceneFor = s.state;
    const total = engine.totalUsd(c, s.state);
    cockpit.panel.update(scene, { caseData: s.caseData, engineCase: c, state: s.state, track: s.track });
    if (cockpit.panel.setFuel) cockpit.panel.setFuel(fuelDisplayUsd(total, total, 1, true));
  }
  try {
    cockpit.renderer.render(scene, { nowMs: now, reducedMotion: reduced });
  } catch (err) {
    console.warn("3D view stopped:", err && err.message ? err.message : err);
    cockpit.status = "failed";
    cockpit.reason = "load-failed";
    applyView();
    return true;
  }
  if (cockpit.phase.phase !== "ready") requestCockpitFrame();
  return true;
}

function onAntiIce(next) {
  const st = store.state;
  if (st && flightController && st.antiIce !== next) flightController.toggleAntiIce();
}

function resizeCockpit() {
  if (!cockpit.renderer) return;
  const box = $("cockpit-canvas"); // the windshield: the space above the panel
  if (box.clientWidth > 0 && box.clientHeight > 0) cockpit.renderer.resize(box.clientWidth, box.clientHeight, pixelRatio());
  requestCockpitFrame();
}

async function loadCockpit() {
  if (cockpit.status !== "idle") return;
  if (!webglAvailable()) {
    cockpit.status = "failed";
    cockpit.reason = "no-webgl";
    applyView();
    return;
  }
  cockpit.status = "loading";
  try {
    const lib = await import("./cockpit3d.js");
    cockpit.renderer = lib.createCockpit($("cockpit-canvas"), { pixelRatio: pixelRatio() });
    cockpit.panel = createPanel($("cockpit-panel"), { onAntiIce });
    if (typeof ResizeObserver === "function") new ResizeObserver(resizeCockpit).observe($("cockpit-canvas"));
    cockpit.status = "ready";
  } catch (err) {
    console.warn("3D view not loaded:", err && err.message ? err.message : err);
    if (cockpit.renderer) { try { cockpit.renderer.dispose(); } catch { /* already unusable */ } }
    cockpit.renderer = null;
    cockpit.panel = null;
    cockpit.status = "failed";
    cockpit.reason = "load-failed";
  }
  applyView();
}

// Puts the chosen view on screen: cockpit or 2D, the fallback notice and the view button.
function applyView() {
  const choice = chooseView(cockpit);
  const was = cockpit.view;
  cockpit.view = choice.view;
  const on = choice.view === "cockpit";
  document.body.classList.toggle("view-cockpit", on);
  $("cockpit-view").hidden = !on;
  syncLeadToView();
  if (store.engineCase && store.state) renderHud(store);
  renderLeadUi(); // also hands the gate choices to the cockpit view, except during the lead-in
  const note = $("view-notice");
  note.textContent = choice.notice || "";
  note.hidden = !choice.notice;
  const btn = $("view-toggle");
  btn.hidden = !choice.canToggle;
  btn.textContent = buttonLabel(choice.view);
  $("chase-toggle").hidden = !(choice.view === "cockpit");
  if (was === choice.view) return;
  if (on) {
    resizeCockpit();
    if (store.engineCase && store.state) notify(); // builds the scene and the panel for the current state
  } else if (store.engineCase && store.state) {
    paintScene(store, 1);
  }
}

function toggleView() {
  cockpit.wants2d = !cockpit.wants2d;
  applyView();
}

function onViewKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
  if (!gameKeysAllowed(e)) return;
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
  const flightOn = Boolean(store.engineCase && store.state) && !$("flight").hidden;
  if (!viewKeyApplies(e.key, { flightOn, canToggle: chooseView(cockpit).canToggle })) return;
  e.preventDefault();
  toggleView();
}

// Key C and the button: outside chase camera or cockpit camera. Only the drawing changes; the engine state,
// the controller and the panel are untouched (R16.11).
function toggleChase() {
  cockpit.mode = toggleMode(cockpit.mode);
  const btn = $("chase-toggle");
  btn.textContent = chaseButtonLabel(cockpit.mode);
  btn.setAttribute("aria-pressed", String(cockpit.mode === "chase"));
  cockpit.sceneFor = null; // rebuild the scene description with the new mode
  requestCockpitFrame();
}

function onChaseKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
  if (!gameKeysAllowed(e)) return;
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
  const flightOn = Boolean(store.engineCase && store.state) && !$("flight").hidden;
  if (!chaseKeyApplies(e.key, { flightOn, cockpitView: isCockpitView() })) return;
  e.preventDefault();
  toggleChase();
}

// Builds the scene description for the current engine state (cruise only, from engine step 0) and updates the panel.
function rebuildCockpitScene(s) {
  const c = s.engineCase;
  const st = s.state;
  const here = { altFt: c.altsFt[st.alt], lane: st.lane };
  if (cockpit.lastStep === null || st.step < cockpit.lastStep || st.step > cockpit.lastStep + 1) cockpit.from = null;
  else if (st.step === cockpit.lastStep + 1) cockpit.from = cockpit.to;
  // Display-only fuel counter: previous total, kept only for a one-step advance (task 16.3, R13.10).
  const total = engine.totalUsd(c, st);
  if (st.step !== cockpit.lastStep) cockpit.fuelPrev = st.step === cockpit.lastStep + 1 && cockpit.fuelCur != null ? cockpit.fuelCur : total;
  cockpit.fuelCur = total;
  cockpit.to = here;
  cockpit.lastStep = st.step;
  cockpit.scene = buildScene(s.caseData, st, { phase: "cruise" }, sceneOptions(s.caseData, c, { mode: cockpit.mode, reducedMotion: reducedMotion() }));
  cockpit.sceneFor = st;
  if (cockpit.panel) {
    cockpit.panel.update(cockpit.scene, { caseData: s.caseData, engineCase: c, state: st, track: s.track });
  }
}

function requestCockpitFrame() {
  if (!cockpit.handle && isCockpitView()) cockpit.handle = requestAnimationFrame(cockpitFrame);
}

// One frame. The eye follows the aircraft with motionFrac while the flight runs and eases to a stop within
// 1.5 s when it stops at a gate, a pause or the end (R15.8). The loop stops when nothing moves.
// ?perf=1 (task 15.6): frame timing while the flight runs, read by tools/layout_check.mjs as window.__cdPerf().
// Never shown. Frames are only drawn while something moves, so only running frames are timed.
const perfOn = new URLSearchParams(location.search).get("perf") === "1";
const perfRun = { times: [], cpuMs: [], tri: 0, calls: 0 };
if (perfOn) {
  window.__cdPerf = () => {
    const t = perfRun.times;
    const gaps = t.slice(1).map((v, i) => v - t[i]).filter((g) => g < 250).sort((a, b) => a - b);
    const sum = gaps.reduce((a, b) => a + b, 0);
    const cpu = perfRun.cpuMs.slice().sort((a, b) => a - b);
    const q = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : null);
    return {
      frames: gaps.length, fps: sum > 0 ? (gaps.length * 1000) / sum : null,
      gapP50Ms: q(gaps, 0.5), gapP95Ms: q(gaps, 0.95), gapMaxMs: gaps.length ? gaps[gaps.length - 1] : null,
      cpuMeanMs: cpu.length ? cpu.reduce((a, b) => a + b, 0) / cpu.length : null, cpuP95Ms: q(cpu, 0.95),
      triangles: perfRun.tri, drawCalls: perfRun.calls,
    };
  };
}

function cockpitFrame(now) {
  cockpit.handle = 0;
  const s = store;
  if (!isCockpitView() || !cockpit.renderer || !s.engineCase || !s.state || $("flight").hidden) return;
  if (endingRunning() && endingFrame(now)) return;
  if (leadActive() && leadFrame(now)) return;
  if (s.state !== cockpit.sceneFor) rebuildCockpitScene(s);
  const c = s.engineCase;
  const reduced = reducedMotion();
  const frac = motionFrac(performance.now() - s.changeAt, TICK_MS, reduced);
  const target = positionKm(c, s.prev ? s.prev.step : null, s.state.step, frac);
  let running = false;
  if (flightController) {
    flightController.sync();
    running = flightController.getMode() === "running";
  }
  // Cost pop-up (task 16.7): only at a stop (gate, pause, single step, end), from the two stop states that
  // already happened. Never a preview of a choice.
  if (!running && cockpit.panel && cockpit.panel.showCost && s.state !== cockpit.stopState) {
    const pop = popupFor(c, cockpit.stopState, s.state, true);
    if (pop) cockpit.panel.showCost(pop.text);
    cockpit.stopState = s.state;
  }
  if (cockpit.panel && cockpit.panel.setFuel) {
    cockpit.panel.setFuel(fuelDisplayWithDepartureUsd(cockpit.fuelPrev, cockpit.fuelCur, frac, s.state.status !== "flying" || reduced, departureUsd(s.caseData && s.caseData.params)));
  }
  const x = cockpit.camera.update({ nowMs: now, targetKm: target, running, snap: reduced });
  const base = cockpit.scene;
  const scene = { ...base, camera: { ...base.camera, pos: eyePosition(c, x, cockpit.from, cockpit.to, frac) } };
  try {
    const t0 = perfOn ? performance.now() : 0;
    const drawn = cockpit.renderer.render(scene, { nowMs: now, reducedMotion: reduced });
    if (perfOn && running) {
      perfRun.times.push(now);
      perfRun.cpuMs.push(performance.now() - t0);
      perfRun.tri = drawn.drawnTriangles;
      perfRun.calls = drawn.drawCalls;
    }
  } catch (err) {
    // A draw failure at run time falls back to the 2D view with the notice; the flight goes on unchanged.
    console.warn("3D view stopped:", err && err.message ? err.message : err);
    cockpit.status = "failed";
    cockpit.reason = "load-failed";
    applyView();
    return;
  }
  if (running || frac < 1 || !cockpit.camera.settled(target)) requestCockpitFrame();
}

function updateCockpit(s) {
  if (!isCockpitView() || !s.engineCase || !s.state) return;
  if (!leadActive() && !endingRunning() && s.state !== cockpit.sceneFor) rebuildCockpitScene(s); // the lead-in and the cinematics build their own scene
  requestCockpitFrame();
}

function onChange(s) {
  beginEnding(s);
  renderHud(s);
  renderSources(s);
  renderSceneNow(s);
  updateCockpit(s);
  checkLayout(s);
}

function boot() {
  subscribe(onChange);
  // The flight keys do nothing during the runway and climb lead-in: the engine does not step there (R15.2).
  const controller = initControls({
    root: $("controls"), getStore, subscribe, setState, formatFt,
    gameKeysAllowed: (e) => gameKeysAllowed(e) && !leadActive() && !endingRunning(),
  });
  // Task 15.4: cockpit gate choices and inset on the same controller; shown when the cockpit view
  // calls gatePanel.setCockpit(true) (task 15.5). Hidden in the 2D view, where #controls does the same.
  flightController = controller;
  gatePanel = initGatePanel({ root: $("gate-choices"), controller, getStore, subscribe });
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
    dlg.querySelector(".dlg-close")?.addEventListener("click", () => closeDialog());
    dlg.addEventListener("close", () => onDialogClosed(dlg));
  }
  $("hotseat-count").addEventListener("change", renderHotNames);
  $("hotseat-form").addEventListener("submit", submitHotseat);
  $("handover-start").addEventListener("click", startNextFlight);
  $("results-again").addEventListener("click", playAgain);
  $("results-back").addEventListener("click", () => { closeDialog(false); backToCases(); });
  $("handover-end").addEventListener("click", () => { closeDialog(false); backToCases(); });
  // The hand-over cannot be dismissed by accident: Escape is ignored, Start or End hot-seat leave it.
  $("dlg-handover").addEventListener("cancel", (e) => e.preventDefault());
  document.addEventListener("keydown", onLegendKey);
  $("map-kind-toggle").addEventListener("click", toggleImageKind);
  document.addEventListener("keydown", onMapKey);
  $("back-to-cases").addEventListener("click", backToCases);
  $("error-retry").addEventListener("click", loadIndex);
  $("flight-title").tabIndex = -1;
  $("view-toggle").addEventListener("click", toggleView);
  $("takeoff-btn").addEventListener("click", startTakeoff);
  $("skip-btn").addEventListener("click", skipEnding);
  document.addEventListener("keydown", onSkipKey);
  if (typeof matchMedia === "function") {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    if (typeof mq.addEventListener === "function") mq.addEventListener("change", onReducedMotionChange);
    else if (typeof mq.addListener === "function") mq.addListener(onReducedMotionChange);
  }
  document.addEventListener("keydown", onStartKey);
  document.addEventListener("keydown", onViewKey);
  document.addEventListener("keydown", onChaseKey);
  $("chase-toggle").addEventListener("click", toggleChase);
  fitCanvases();
  loadIndex();
  loadCockpit(); // dynamic import; on any failure the 2D view stays with a notice (R19.1)
}

boot();
