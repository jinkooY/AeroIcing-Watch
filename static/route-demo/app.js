"use strict";

const get = (id) => document.getElementById(id);
const colors = ["#78dfcf", "#ffd48a"];
const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const gridNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });
const format = (value, unit = "") => Number.isFinite(value) ? number.format(value) + unit : "Unavailable";
const utc = (value, precision = 16) => value
  ? new Date(value).toISOString().slice(0, precision).replace("T", " ") + " UTC"
  : "Unavailable";
const availability = {
  criterion_not_met: "Temperature/RH criteria unmet",
  possible_environment: "Temperature/RH criteria met",
  possible: "Temperature/RH criteria met",
  unassessed: "Unevaluable"
};
const svgNS = "http://www.w3.org/2000/svg";
const plot = { left: 55, right: 570, top: 20, bottom: 233 };
let scenario;
let routeIndex = 0;
let segmentIndex = 0;

function html(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function svg(parent, tag, attrs, content = "") {
  const node = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.textContent = content;
  parent.append(node);
  return node;
}

function fillDetails(list, pairs) {
  list.replaceChildren(...pairs.map(([label, value]) => {
    const item = html("div");
    const description = html("dd");
    description.append(value);
    item.append(html("dt", label), description);
    return item;
  }));
}

function sourceLink(label, href) {
  const anchor = html("a", label);
  anchor.href = href;
  return anchor;
}

function drawRouteCards() {
  const cards = scenario.routes.map((route, index) => {
    const button = html("button", "", "route");
    button.type = "button";
    button.style.setProperty("--route-color", colors[index]);
    const metrics = html("span", "", "metrics");
    const values = [
      ["Distance", format(route.distance_km, " km")],
      ["Cruise time", format(route.total_time_s === null ? null : route.total_time_s / 60, " min")],
      ["Cruise fuel estimate", format(route.estimated_fuel_kg, " kg")]
    ];
    for (const [label, value] of values) {
      const metric = html("span", "", "metric");
      metric.append(html("strong", value), html("small", label));
      metrics.append(metric);
    }
    const { assessed_segments, possible_segments, planned_segments } = route.icing;
    const coverage = `${possible_segments} met screening criteria · ${assessed_segments}/${planned_segments} evaluated`;
    button.append(html("span", route.label, "route-heading"), metrics, html("span", coverage, "coverage"));
    button.addEventListener("click", () => setRoute(index));
    return button;
  });
  get("routes").replaceChildren(...cards);
  const [direct, via] = scenario.routes;
  if ([direct.distance_km, via.distance_km, direct.total_time_s, via.total_time_s,
    direct.estimated_fuel_kg, via.estimated_fuel_kg].every(Number.isFinite)) {
    const signed = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, signDisplay: "exceptZero" });
    get("difference").textContent = `Via waypoint relative to direct · ${signed.format(via.distance_km - direct.distance_km)} km · ${signed.format((via.total_time_s - direct.total_time_s) / 60)} min · ${signed.format(via.estimated_fuel_kg - direct.estimated_fuel_kg)} kg`;
  }
  const thresholds = direct.icing.thresholds;
  get("cue-note").textContent = `Research screen uses forecast temperatures of ${thresholds.temperature_c.join(" to ")} °C and relative humidity of at least ${thresholds.rh_percent_min}%. Segments without either input are unevaluable.`;
}

function routeGeometry({ waypoints, segments, replay }) {
  // Schema 2 exports the exact segment boundaries, including the via waypoint.
  if (Array.isArray(replay?.track) && replay.track.length >= 2) return replay.track;
  const geometry = [waypoints[0], ...segments, waypoints.at(-1)];
  const waypoint = waypoints[1];
  if (waypoints.length === 3) {
    // Schema 1 only has segment midpoints. Restore the turn between the closest adjacent pair.
    const longitudeScale = Math.cos(waypoint.latitude * Math.PI / 180);
    const distance = (point) => Math.hypot(
      point.latitude - waypoint.latitude, (point.longitude - waypoint.longitude) * longitudeScale
    );
    let breakIndex = 1;
    for (let index = 2; index < segments.length; index++) {
      if (distance(segments[index - 1]) + distance(segments[index])
          < distance(segments[breakIndex - 1]) + distance(segments[breakIndex])) {
        breakIndex = index;
      }
    }
    geometry.splice(breakIndex + 1, 0, waypoint);
  }
  return geometry;
}

function replayHref() {
  const route = scenario.routes[routeIndex];
  return `#route=${encodeURIComponent(route.id)}&segment=${segmentIndex}`;
}

function syncHash() {
  const hash = replayHref();
  get("replay-link").href = `replay.html${hash}`;
  if (location.hash !== hash) history.replaceState(null, "", hash);
}

function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  const route = scenario.routes.findIndex((item) => item.id === params.get("route"));
  const segmentText = params.get("segment");
  const segment = segmentText !== null && /^\d+$/.test(segmentText) ? Number(segmentText) : null;
  return { route, segment };
}

function drawMap(route, segment) {
  const map = get("map");
  map.replaceChildren();
  const locations = scenario.routes.flatMap((item) => [...item.waypoints, ...item.segments, ...routeGeometry(item)]);
  const longitude = locations.map((point) => point.longitude);
  const latitude = locations.map((point) => point.latitude);
  const minLon = Math.floor(Math.min(...longitude)) - 1;
  const maxLon = Math.ceil(Math.max(...longitude)) + 1;
  const minLat = Math.floor(Math.min(...latitude)) - 1;
  const maxLat = Math.ceil(Math.max(...latitude)) + 1;
  const x = (lon) => plot.left + (lon - minLon) / (maxLon - minLon) * (plot.right - plot.left);
  const y = (lat) => plot.bottom - (lat - minLat) / (maxLat - minLat) * (plot.bottom - plot.top);
  for (let lon = Math.ceil(minLon / 4) * 4; lon <= maxLon; lon += 4) {
    svg(map, "line", { x1: x(lon), x2: x(lon), y1: plot.top, y2: plot.bottom });
    svg(map, "text", { x: x(lon), y: plot.bottom + 22, "text-anchor": "middle" }, `${lon}°E`);
  }
  for (let lat = minLat; lat <= maxLat; lat += 2) {
    svg(map, "line", { x1: plot.left, x2: plot.right, y1: y(lat), y2: y(lat) });
    svg(map, "text", { x: plot.left - 7, y: y(lat) + 5, "text-anchor": "end" }, `${lat}°N`);
  }
  const routeOrder = scenario.routes.filter((item) => item !== route).concat(route);
  for (const candidate of routeOrder) {
    const isSelected = candidate === route;
    const geometry = routeGeometry(candidate);
    const coordinates = geometry.map((point) => `${x(point.longitude)},${y(point.latitude)}`).join(" ");
    svg(map, "polyline", {
      points: coordinates, fill: "none", stroke: colors[scenario.routes.indexOf(candidate)],
      "stroke-width": isSelected ? 4 : 2.5, "stroke-dasharray": candidate.id === "via" ? "9 5" : "none",
      opacity: isSelected ? 1 : .65
    });
  }
  for (const point of scenario.routes.find((candidate) => candidate.id === "via").waypoints) {
    const px = x(point.longitude);
    const py = y(point.latitude);
    const atRight = px > (plot.right + plot.left) * .7;
    svg(map, "circle", { cx: px, cy: py, r: 4, fill: "var(--text)" });
    svg(map, "text", { x: px + (atRight ? -8 : 8), y: py - 9, class: "station-label",
      "text-anchor": atRight ? "end" : "start" }, point.label);
  }
  svg(map, "circle", { cx: x(segment.longitude), cy: y(segment.latitude), r: 8, fill: colors[routeIndex],
    stroke: "var(--bg)", "stroke-width": 3 });
}

function drawChart(route, segment) {
  const chart = get("chart");
  chart.replaceChildren();
  const allSpeeds = scenario.routes.flatMap(({ segments }) => segments.map((point) => point.ground_speed_kt))
    .filter(Number.isFinite);
  if (allSpeeds.length === 0) {
    svg(chart, "text", { x: 300, y: 130, "text-anchor": "middle" }, "No groundspeed estimates available");
    return;
  }
  const minSpeed = Math.floor((Math.min(...allSpeeds) - 5) / 20) * 20;
  const maxSpeed = Math.ceil((Math.max(...allSpeeds) + 5) / 20) * 20;
  const maxDistance = Math.ceil(Math.max(...scenario.routes.map((item) => item.distance_km)) / 200) * 200;
  const x = (km) => plot.left + km / maxDistance * (plot.right - plot.left);
  const y = (knots) => plot.bottom - (knots - minSpeed) / (maxSpeed - minSpeed) * (plot.bottom - plot.top);
  const tick = Math.max(20, Math.ceil((maxSpeed - minSpeed) / 100) * 20);
  for (let speed = minSpeed; speed <= maxSpeed; speed += tick) {
    svg(chart, "line", { x1: plot.left, x2: plot.right, y1: y(speed), y2: y(speed) });
    svg(chart, "text", { x: plot.left - 8, y: y(speed) + 5, "text-anchor": "end" }, number.format(speed));
  }
  const distanceStep = Math.ceil(maxDistance / 800) * 200;
  for (let km = 0; km <= maxDistance; km += distanceStep) {
    svg(chart, "line", { x1: x(km), x2: x(km), y1: plot.top, y2: plot.bottom });
    svg(chart, "text", { x: x(km), y: plot.bottom + 22, "text-anchor": "middle" }, format(km));
  }
  svg(chart, "text", { x: 310, y: 277, "text-anchor": "middle" }, "Distance from departure · km");
  const routeOrder = scenario.routes.filter((item) => item !== route).concat(route);
  for (const candidate of routeOrder) {
    let path = "";
    let continuing = false;
    for (const sample of candidate.segments) {
      if (!Number.isFinite(sample.ground_speed_kt)) {
        continuing = false;
        continue;
      }
      path += `${continuing ? "L" : "M"}${x(sample.cumulative_distance_km)},${y(sample.ground_speed_kt)} `;
      continuing = true;
    }
    svg(chart, "path", { d: path, fill: "none", stroke: colors[scenario.routes.indexOf(candidate)],
      "stroke-width": candidate === route ? 4 : 2.5, opacity: candidate === route ? 1 : .65,
      "stroke-dasharray": candidate.id === "via" ? "9 5" : "none" });
  }
  const selectedX = x(segment.cumulative_distance_km);
  svg(chart, "line", { x1: selectedX, x2: selectedX, y1: plot.top, y2: plot.bottom, class: "zero" });
  if (Number.isFinite(segment.ground_speed_kt)) {
    svg(chart, "circle", { cx: selectedX, cy: y(segment.ground_speed_kt), r: 7, fill: colors[routeIndex],
      stroke: "var(--bg)", "stroke-width": 2 });
  }
  chart.onclick = (event) => {
    const bounds = chart.getBoundingClientRect();
    const px = (event.clientX - bounds.left) * 600 / bounds.width;
    if (px < plot.left || px > plot.right) return;
    const km = (px - plot.left) / (plot.right - plot.left) * maxDistance;
    const nearest = route.segments.reduce((best, item, index) => {
      return Math.abs(item.cumulative_distance_km - km) < Math.abs(route.segments[best].cumulative_distance_km - km)
        ? index : best;
    }, 0);
    setSegment(nearest);
  };
}

function setSegment(index) {
  const route = scenario.routes[routeIndex];
  if (index < 0 || index >= route.segments.length) return;
  segmentIndex = index;
  const segment = route.segments[index];
  get("segment").value = String(index);
  get("previous").disabled = index === 0;
  get("next").disabled = index === route.segments.length - 1;
  const screen = availability[segment.icing_environment] || "Unevaluable";
  get("segment-summary").textContent = `${route.label} · Segment ${index + 1} of ${route.segments.length} · ${screen}`;
  const wind = Number.isFinite(segment.wind_speed_kt) && Number.isFinite(segment.wind_from_deg)
    ? `${format(segment.wind_from_deg)}° true at ${format(segment.wind_speed_kt, " kt")}`
    : "Unavailable";
  fillDetails(get("segment-detail"), [
    ["Midpoint ETA", utc(segment.eta, 19)],
    ["Distance from departure", format(segment.cumulative_distance_km, " km")],
    ["Pressure altitude", format(scenario.assumptions.altitude_ft_pressure, " ft")],
    ["Groundspeed", format(segment.ground_speed_kt, " kt")],
    ["Wind from", wind],
    ["Temperature", format(segment.temperature_c, " °C")],
    ["Relative humidity", format(segment.rh_percent, "%")],
    ["Segment fuel estimate", format(segment.fuel_kg, " kg")]
  ]);
  drawMap(route, segment);
  drawChart(route, segment);
  syncHash();
}

function setRoute(index, initialSegment = 0) {
  routeIndex = index;
  const { segments, ctps_observation } = scenario.routes[index];
  for (const [cardIndex, card] of [...get("routes").children].entries()) {
    card.setAttribute("aria-pressed", String(cardIndex === index));
  }
  get("segment").replaceChildren(...segments.map((segment, position) => {
    const option = html("option", `${position + 1} · ${format(segment.cumulative_distance_km, " km")}`);
    option.value = String(position);
    return option;
  }));
  get("observation").textContent = ctps_observation.state === "no_recent_observation"
    ? "Concurrent GK-2A CTPS cloud observations were unavailable for this route."
    : "GK-2A CTPS availability could not be verified for the decision time.";
  setSegment(initialSegment >= 0 && initialSegment < segments.length ? initialSegment : 0);
}

function render(data) {
  scenario = data;
  const { assumptions, forecast } = data;
  const level = `FL${Math.round(assumptions.altitude_ft_pressure / 100)}`;
  get("assumptions").textContent = `${assumptions.aircraft} / ${assumptions.engine} · ${format(assumptions.initial_mass_kg, " kg")} · ${level} · TAS ${format(assumptions.tas_kt, " kt")} · ${assumptions.model} ${assumptions.version} · Departure ${utc(data.departure_at)}`;
  fillDetails(get("forecast"), [
    ["Source", sourceLink(forecast.source, forecast.source_url)],
    ["Data license", sourceLink("CC BY 4.0", forecast.license_url)],
    ["Terms of use", sourceLink("ECMWF terms", forecast.terms_url)],
    ["Forecast grid", gridNumber.format(forecast.resolution_deg) + "°"],
    ["Initialized", utc(forecast.initialized_at)],
    ["Local bundle ready", utc(forecast.available_at, 19)],
    ["Decision time", utc(data.decision_at, 19)],
    ["Forecast valid times", forecast.valid_times.map((value) => utc(value)).join(" · ")]
  ]);
  get("source-credit").textContent = [forecast.attribution, forecast.copyright, forecast.disclaimer].join(" ");
  drawRouteCards();
  get("segment").addEventListener("change", (event) => setSegment(Number(event.target.value)));
  get("previous").addEventListener("click", () => setSegment(segmentIndex - 1));
  get("next").addEventListener("click", () => setSegment(segmentIndex + 1));
  const initial = readHash();
  if (initial.route >= 0) setRoute(initial.route, initial.segment ?? 0);
  else setRoute(0);
  window.addEventListener("hashchange", () => {
    const next = readHash();
    if (next.route >= 0 && next.route !== routeIndex) setRoute(next.route, next.segment ?? 0);
    else if (next.route === routeIndex && next.segment !== null) setSegment(next.segment);
    syncHash();
  });
  get("load-status").hidden = true;
  get("demo").hidden = false;
}

async function loadDemo() {
  try {
    const response = await fetch("scenario.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (![1, 2].includes(data.schema_version) || data.routes.length !== 2) throw new Error("Unsupported scenario");
    render(data);
  } catch (error) {
    console.error(error);
    get("load-status").textContent = "The scenario could not load. Open this page through the hosted demo or a local HTTP server.";
  }
}

loadDemo();
