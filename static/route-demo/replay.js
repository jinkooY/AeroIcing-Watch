"use strict";

// 3D replay of the archived route-comparison scenario (schema_version 2).
// No Cesium ion: imagery is the NaturalEarthII tile set bundled with CesiumJS,
// terrain is the bare WGS84 ellipsoid.

const SCHEMA_VERSION = 2;
const colors = ["#78dfcf", "#ffd48a"];
const get = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const fmt = (value, unit = "") => Number.isFinite(value) ? nf.format(value) + unit : "Unavailable";

const state = {
  scenario: null,
  routes: [],
  routeIndex: 0,
  timeMs: 0,
  playing: false,
  speed: 60,
  follow: false,
  segmentIndex: -1,
  viewer: null,
  aircraft: null,
  routeEntities: [],
  lastFrame: null
};

// Date.parse only guarantees millisecond precision; the scenario carries microseconds.
function parseUtc(text) {
  if (!text) return null;
  const value = Date.parse(String(text).replace(/(\.\d{3})\d+/, "$1"));
  return Number.isFinite(value) ? value : null;
}

const utcText = (ms) => Number.isFinite(ms)
  ? new Date(ms).toISOString().slice(0, 19).replace("T", " ") + " UTC"
  : "Unavailable";

function durationText(seconds) {
  if (!Number.isFinite(seconds)) return "Unavailable";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h} h ${String(m).padStart(2, "0")} min ${String(s).padStart(2, "0")} s`;
}

function setStatus(text, isError = false) {
  const node = get("status");
  node.textContent = text;
  node.classList.toggle("error", isError);
}

// ---------- URL hash (shared with the 2D page) ----------

function readHash() {
  const params = new URLSearchParams(location.hash.replace(/^#/, ""));
  const segment = Number.parseInt(params.get("segment"), 10);
  return { route: params.get("route"), segment: Number.isInteger(segment) ? segment : null };
}

function currentHash() {
  const route = state.routes[state.routeIndex];
  if (!route) return location.hash;
  const segment = Math.max(0, state.segmentIndex);
  return `#route=${encodeURIComponent(route.data.id)}&segment=${segment}`;
}

function writeHash() {
  const hash = currentHash();
  if (location.hash !== hash) history.replaceState(null, "", hash);
  get("link-2d").href = "index.html" + hash;
  get("fallback-link").href = "index.html" + hash;
}

// ---------- Route model ----------

function buildRoute(data, index, heightM) {
  const replay = data.replay || {};
  const track = (replay.track || []).map((point) => ({
    latitude: point.latitude,
    longitude: point.longitude,
    distanceKm: point.distance_km,
    timeMs: parseUtc(point.time),
    waypoint: point.waypoint || null
  }));
  // Playable part = leading boundaries that carry a time (truncated routes stop early).
  let timedCount = 0;
  while (timedCount < track.length && track[timedCount].timeMs !== null) timedCount += 1;
  const startMs = parseUtc(replay.start_at) ?? track[0]?.timeMs;
  const lastTimed = timedCount ? track[timedCount - 1].timeMs : startMs;
  const endMs = Math.min(parseUtc(replay.end_at) ?? lastTimed, lastTimed);
  return {
    data,
    index,
    color: colors[index % colors.length],
    track,
    timedCount,
    playableSegments: Math.max(0, Math.min(data.segments.length, timedCount - 1)),
    startMs,
    endMs,
    status: replay.status || "complete",
    stoppedReason: replay.stopped_reason || null,
    heightM
  };
}

// Index i of the segment whose time span [track[i], track[i+1]] contains t.
function spanIndexAt(route, t) {
  const last = route.playableSegments - 1;
  for (let i = 0; i < last; i += 1) {
    if (t < route.track[i + 1].timeMs) return i;
  }
  return Math.max(0, last);
}

// ---------- Cesium scene ----------

function webglAvailable() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

function createViewer() {
  if (new URLSearchParams(location.search).has("force-fallback")) {
    throw new Error("Fallback forced by the force-fallback URL parameter.");
  }
  if (typeof Cesium === "undefined") throw new Error("CesiumJS could not be loaded.");
  if (!webglAvailable()) throw new Error("WebGL is not available in this browser.");

  const imagery = Cesium.TileMapServiceImageryProvider.fromUrl(
    Cesium.buildModuleUrl("Assets/Textures/NaturalEarthII")
  );
  const viewer = new Cesium.Viewer("globe", {
    baseLayer: Cesium.ImageryLayer.fromProviderAsync(imagery),
    terrainProvider: new Cesium.EllipsoidTerrainProvider(),
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    shouldAnimate: false
  });
  viewer.scene.globe.enableLighting = false;
  viewer.scene.skyAtmosphere.show = true;
  return viewer;
}

function cartesian(point, heightM) {
  return Cesium.Cartesian3.fromDegrees(point.longitude, point.latitude, heightM);
}

function prepareGeometry(route) {
  const ellipsoid = Cesium.Ellipsoid.WGS84;
  route.cartesians = route.track.map((p) => cartesian(p, route.heightM));
  route.geodesics = [];
  route.axes = [];
  for (let i = 0; i < route.track.length - 1; i += 1) {
    const a = Cesium.Cartographic.fromDegrees(route.track[i].longitude, route.track[i].latitude);
    const b = Cesium.Cartographic.fromDegrees(route.track[i + 1].longitude, route.track[i + 1].latitude);
    route.geodesics.push(new Cesium.EllipsoidGeodesic(a, b, ellipsoid));
    const axis = Cesium.Cartesian3.subtract(route.cartesians[i + 1], route.cartesians[i], new Cesium.Cartesian3());
    route.axes.push(Cesium.Cartesian3.normalize(axis, axis));
  }
}

// Position at time t: linear by time between the two boundaries around t, along the geodesic.
function positionAt(route, t) {
  const i = spanIndexAt(route, t);
  const t0 = route.track[i].timeMs;
  const t1 = route.track[i + 1].timeMs;
  const fraction = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
  if (fraction <= 0) return { position: route.cartesians[i], axis: route.axes[i], index: i, fraction: 0 };
  if (fraction >= 1) return { position: route.cartesians[i + 1], axis: route.axes[i], index: i, fraction: 1 };
  const c = route.geodesics[i].interpolateUsingFraction(fraction);
  const position = Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, route.heightM);
  return { position, axis: route.axes[i], index: i, fraction };
}

function buildScene() {
  const viewer = state.viewer;
  const entities = viewer.entities;

  state.routes.forEach((route, index) => {
    prepareGeometry(route);
    const color = Cesium.Color.fromCssColorString(route.color);
    const playable = route.cartesians.slice(0, route.timedCount);
    const line = entities.add({
      name: route.data.label,
      polyline: {
        positions: playable,
        width: new Cesium.CallbackProperty(() => state.routeIndex === index ? 6 : 3, false),
        material: new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(
          () => state.routeIndex === index ? color : color.withAlpha(0.45), false
        )),
        arcType: Cesium.ArcType.GEODESIC
      }
    });
    line.routeIndex = index;
    state.routeEntities.push(line);
    if (route.timedCount < route.track.length) {
      const rest = entities.add({
        polyline: {
          positions: route.cartesians.slice(route.timedCount - 1),
          width: 3,
          material: new Cesium.PolylineDashMaterialProperty({ color: Cesium.Color.GRAY }),
          arcType: Cesium.ArcType.GEODESIC
        }
      });
      rest.routeIndex = index;
    }
  });

  const seen = new Set();
  for (const route of state.routes) {
    for (const point of route.track) {
      if (!point.waypoint || seen.has(point.waypoint)) continue;
      seen.add(point.waypoint);
      entities.add({
        name: point.waypoint,
        position: cartesian(point, route.heightM),
        point: {
          pixelSize: 9,
          color: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.fromCssColorString("#0b1522"),
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        },
        label: {
          text: point.waypoint,
          font: "600 13px Segoe UI, sans-serif",
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -18),
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      });
    }
  }

  state.aircraft = entities.add({
    name: "Aircraft",
    position: new Cesium.CallbackProperty(() => state.sample?.position, false),
    billboard: {
      image: "aircraft.svg",
      width: 34,
      height: 34,
      // The billboard's up vector points along the travel direction of the current segment.
      alignedAxis: new Cesium.CallbackProperty(() => state.sample?.axis ?? Cesium.Cartesian3.ZERO, false),
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    },
    viewFrom: new Cesium.Cartesian3(0, -250000, 180000)
  });

  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  const routeAt = (position) => {
    const picked = viewer.scene.drillPick(position, 5, 6, 6);
    const hit = picked.find((p) => p.id && Number.isInteger(p.id.routeIndex));
    return hit ? hit.id.routeIndex : null;
  };
  handler.setInputAction((event) => {
    const index = routeAt(event.position);
    if (index !== null && index !== state.routeIndex) selectRoute(index);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  handler.setInputAction((event) => {
    viewer.scene.canvas.style.cursor = routeAt(event.endPosition) !== null ? "pointer" : "";
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
}

function overviewSphere() {
  const points = state.routes.flatMap((route) => route.cartesians);
  return Cesium.BoundingSphere.fromPoints(points);
}

function overview(fly = true) {
  const viewer = state.viewer;
  if (!viewer) return;
  setFollow(false, false);
  const sphere = overviewSphere();
  const narrow = viewer.canvas.clientWidth < viewer.canvas.clientHeight;
  viewer.camera.flyToBoundingSphere(sphere, {
    offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-50), sphere.radius * (narrow ? 3.4 : 2.6)),
    duration: fly ? 1.2 : 0
  });
}

function setFollow(on, restoreOverview = true) {
  state.follow = on;
  get("follow").setAttribute("aria-pressed", String(on));
  if (!state.viewer) return;
  if (on) {
    state.viewer.trackedEntity = state.aircraft;
  } else if (state.viewer.trackedEntity) {
    state.viewer.trackedEntity = undefined;
    if (restoreOverview) overview(true);
  }
}

// ---------- UI ----------

function renderCards() {
  const cards = get("cards");
  cards.replaceChildren(...state.routes.map((route, index) => {
    const d = route.data;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "route";
    button.style.setProperty("--route-color", route.color);
    button.setAttribute("aria-pressed", "false");
    const heading = document.createElement("span");
    heading.className = "route-heading";
    heading.textContent = d.label;
    const meta = document.createElement("small");
    meta.textContent = `${fmt(d.distance_km, " km")} · ${durationText(d.total_time_s)} · ${fmt(d.estimated_fuel_kg, " kg")} fuel`;
    button.append(heading, meta);
    if (route.status === "truncated") {
      const warn = document.createElement("small");
      warn.textContent = "Replay truncated";
      button.append(warn);
    }
    button.addEventListener("click", () => selectRoute(index));
    return button;
  }));
}

function fillKv(dl, rows) {
  dl.replaceChildren(...rows.flatMap(([key, value]) => {
    const dt = document.createElement("dt");
    dt.textContent = key;
    const dd = document.createElement("dd");
    dd.textContent = value;
    return [dt, dd];
  }));
}

function renderRouteStatic() {
  const route = state.routes[state.routeIndex];
  get("cards").querySelectorAll("button").forEach((button, index) => {
    button.setAttribute("aria-pressed", String(index === state.routeIndex));
  });
  const timeline = get("timeline");
  timeline.max = String(Math.max(0, Math.round((route.endMs - route.startMs) / 1000)));
  timeline.setAttribute("aria-label", `Replay time for ${route.data.label}`);
  get("t-start").textContent = utcText(route.startMs);
  get("t-end").textContent = utcText(route.endMs);

  const select = get("seg-select");
  select.replaceChildren(...route.data.segments.slice(0, route.playableSegments).map((segment, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `${index + 1}. ${segment.id}`;
    return option;
  }));

  const stopped = get("stopped-note");
  if (route.status === "truncated") {
    stopped.hidden = false;
    const stoppedIndex = route.data.replay.stopped_segment_index;
    const stoppedId = Number.isInteger(stoppedIndex)
      ? route.data.segments[stoppedIndex]?.id ?? `segment index ${stoppedIndex}`
      : null;
    stopped.textContent = `Truncated replay: stops at ${utcText(route.endMs)}` +
      (stoppedId ? ` before ${stoppedId}` : "") +
      `. Reason: ${route.stoppedReason || "not recorded"}.`;
  } else {
    stopped.hidden = true;
  }

  const d = route.data;
  fillKv(get("route-totals"), [
    ["Distance", fmt(d.distance_km, " km")],
    ["Total time", durationText(d.total_time_s)],
    ["Total fuel", fmt(d.estimated_fuel_kg, " kg")],
    ["Replay window", `${utcText(route.startMs)} – ${utcText(route.endMs)}`]
  ]);

  const ctps = d.ctps_observation?.state;
  const sc = state.scenario;
  const altitudeFt = sc.replay?.pressure_altitude_ft ?? sc.assumptions?.altitude_ft_pressure;
  fillKv(get("labels"), [
    ["Data", "Archived forecast (not live)"],
    ["Forecast", `${sc.forecast.source}, initialised ${utcText(parseUtc(sc.forecast.initialized_at))}`],
    ["Time", "UTC"],
    ["Phase", "Cruise-only replay (no climb or descent)"],
    ["Altitude", Number.isFinite(altitudeFt) ? `FL${Math.round(altitudeFt / 100)} (pressure altitude)` : "Unavailable"],
    ["Playback speed", `${state.speed}× real time`],
    ["CTPS observation", ctps === "available" ? "Available" : "No data"]
  ]);
}

function renderTime() {
  const route = state.routes[state.routeIndex];
  get("timeline").value = String(Math.round((state.timeMs - route.startMs) / 1000));
  get("clock").textContent = utcText(state.timeMs);
  get("play").textContent = state.playing ? "Pause" : "Play";
  const index = spanIndexAt(route, state.timeMs);
  if (index !== state.segmentIndex) {
    state.segmentIndex = index;
    renderSegment();
    writeHash();
  } else {
    get("current-utc").textContent = utcText(state.timeMs);
  }
}

function renderSegment() {
  const route = state.routes[state.routeIndex];
  const index = state.segmentIndex;
  const s = route.data.segments[index];
  get("seg-select").value = String(index);
  get("seg-prev").disabled = index <= 0;
  get("seg-next").disabled = index >= route.playableSegments - 1;
  const dl = get("seg-detail");
  fillKv(dl, [
    ["Segment", `${s.id} (${index + 1} of ${route.data.segments.length})`],
    ["Midpoint ETA", utcText(parseUtc(s.eta))],
    ["Current time", utcText(state.timeMs)],
    ["Wind from / speed", `${fmt(s.wind_from_deg, "°")} / ${fmt(s.wind_speed_kt, " kt")}`],
    ["Groundspeed", fmt(s.ground_speed_kt, " kt")],
    ["Temperature", fmt(s.temperature_c, " °C")],
    ["Relative humidity", fmt(s.rh_percent, " %")],
    ["Segment fuel", fmt(s.fuel_kg, " kg")],
    ["Segment duration", fmt(s.duration_s, " s")]
  ]);
  dl.querySelectorAll("dd")[2].id = "current-utc";
}

function updateAircraft() {
  const route = state.routes[state.routeIndex];
  if (route.cartesians) state.sample = positionAt(route, state.timeMs);
}

function setTime(ms) {
  const route = state.routes[state.routeIndex];
  state.timeMs = Math.min(Math.max(ms, route.startMs), route.endMs);
  updateAircraft();
  renderTime();
}

function setPlaying(on) {
  const route = state.routes[state.routeIndex];
  if (on && state.timeMs >= route.endMs) state.timeMs = route.startMs;
  state.playing = on;
  state.lastFrame = null;
  renderTime();
}

function selectRoute(index, segment = null) {
  state.routeIndex = index;
  state.playing = false;
  state.segmentIndex = -1;
  const route = state.routes[index];
  renderRouteStatic();
  const seg = Number.isInteger(segment) && segment >= 0 && segment < route.playableSegments ? segment : 0;
  setTime(seg === 0 ? route.startMs : route.track[seg].timeMs);
  state.viewer?.scene.requestRender();
}

function goToSegment(index) {
  const route = state.routes[state.routeIndex];
  const clamped = Math.min(Math.max(index, 0), route.playableSegments - 1);
  setTime(route.track[clamped].timeMs);
}

function applyHash() {
  const { route, segment } = readHash();
  let index = state.routes.findIndex((r) => r.data.id === route);
  if (index < 0) index = 0;
  selectRoute(index, segment);
}

function tick(now) {
  if (state.playing) {
    if (state.lastFrame !== null) {
      const route = state.routes[state.routeIndex];
      const next = state.timeMs + (now - state.lastFrame) * state.speed;
      if (next >= route.endMs) {
        state.playing = false;
        setTime(route.endMs);
      } else {
        setTime(next);
      }
    }
    state.lastFrame = now;
  }
  requestAnimationFrame(tick);
}

function bindControls() {
  get("play").addEventListener("click", () => setPlaying(!state.playing));
  get("restart").addEventListener("click", () => {
    setTime(state.routes[state.routeIndex].startMs);
    setPlaying(false);
  });
  get("speed").addEventListener("change", (event) => {
    state.speed = Number(event.target.value);
    get("speed-chip").textContent = `Playback ${state.speed}×`;
    renderRouteStatic();
  });
  get("timeline").addEventListener("input", (event) => {
    const route = state.routes[state.routeIndex];
    setTime(route.startMs + Number(event.target.value) * 1000);
  });
  get("seg-prev").addEventListener("click", () => goToSegment(state.segmentIndex - 1));
  get("seg-next").addEventListener("click", () => goToSegment(state.segmentIndex + 1));
  get("seg-select").addEventListener("change", (event) => goToSegment(Number(event.target.value)));
  get("overview").addEventListener("click", () => overview(true));
  get("follow").addEventListener("click", () => setFollow(!state.follow));
  window.addEventListener("hashchange", () => {
    if (location.hash !== currentHash()) applyHash();
  });
}

function showFallback(error) {
  console.warn("3D replay unavailable:", error);
  get("globe").hidden = true;
  get("fallback").hidden = false;
  get("fallback-message").textContent =
    `The 3D view could not start (${error && error.message ? error.message : "unknown error"}). ` +
    "The route comparison is still available in 2D.";
  get("follow").disabled = true;
  get("overview").disabled = true;
}

function renderNotes() {
  const sc = state.scenario;
  get("height-note").textContent =
    `Render height ${fmt(sc.replay.display_height_m, " m")} is display-approximate. ${sc.replay.height_reference}. ` +
    `${sc.replay.interpolation}.`;
  const f = sc.forecast;
  const attribution = get("attribution");
  attribution.replaceChildren(
    `${f.attribution} ${f.copyright}. ${f.disclaimer} `,
    link(f.source_url, "Source"), " · ", link(f.license_url, "CC BY 4.0"), " · ", link(f.terms_url, "ECMWF terms")
  );
}

function link(href, text) {
  const a = document.createElement("a");
  a.href = href;
  a.textContent = text;
  a.rel = "noopener";
  return a;
}

async function main() {
  let scenario;
  try {
    const response = await fetch("scenario.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    scenario = await response.json();
  } catch (error) {
    setStatus(`Could not load scenario.json (${error.message}).`, true);
    return;
  }
  if (scenario.schema_version !== SCHEMA_VERSION) {
    setStatus(
      `Unsupported scenario schema_version ${JSON.stringify(scenario.schema_version)}. ` +
      `This replay requires schema_version ${SCHEMA_VERSION}.`, true
    );
    return;
  }
  if (!scenario.replay || !scenario.routes?.every((r) => r.replay?.track?.length >= 2)) {
    setStatus("The scenario has no replay track data.", true);
    return;
  }

  state.scenario = scenario;
  const heightM = scenario.replay.display_height_m;
  state.routes = scenario.routes.map((data, index) => buildRoute(data, index, heightM));

  get("layout").hidden = false;
  setStatus("");
  renderCards();
  renderNotes();
  bindControls();

  try {
    state.viewer = createViewer();
    buildScene();
    overview(false);
  } catch (error) {
    state.viewer?.destroy();
    state.viewer = null;
    showFallback(error);
  }

  applyHash();
  requestAnimationFrame(tick);
}

main();
