"use strict";

// ── Airport database ────────────────────────────────────────────────────────
let _airports = null;

async function loadAirports() {
  if (_airports) return _airports;
  try {
    const res = await fetch("/airports.json");
    _airports = await res.json();
  } catch {
    _airports = {};
  }
  return _airports;
}

/** Resolve ICAO code or "lat,lon" string → {lat, lon} or null. */
async function resolveEndpoint(raw) {
  const text = raw.trim().toUpperCase();
  const airports = await loadAirports();
  if (airports[text]) return { lat: airports[text].lat, lon: airports[text].lon };
  const parts = raw.split(/[,\s]+/);
  if (parts.length === 2) {
    const lat = parseFloat(parts[0]);
    const lon = parseFloat(parts[1]);
    if (isFinite(lat) && isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      return { lat, lon };
    }
  }
  return null;
}

/** Parse "FL350", "350", "35000" → altitude in feet. */
function parseAltitude(raw) {
  const text = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (text.startsWith("FL")) {
    const fl = parseInt(text.slice(2), 10);
    return isFinite(fl) ? fl * 100 : null;
  }
  const ft = parseInt(text, 10);
  return isFinite(ft) ? ft : null;
}

// ── Frame dropdown ──────────────────────────────────────────────────────────
async function populateFrames() {
  const select = document.getElementById("time-select");
  try {
    const res = await fetch("/api/icing/frames");
    const data = await res.json();
    if (!data.frames || data.frames.length === 0) {
      showOfflineNotice(true);
      loadProfile(sampleProfile);
      return;
    }
    for (const frame of data.frames) {
      const opt = document.createElement("option");
      opt.value = frame.ts;
      const age = frame.age_min < 60
        ? `${Math.round(frame.age_min)} min ago`
        : `${(frame.age_min / 60).toFixed(1)} h ago`;
      const stale = frame.stale ? " · stale" : "";
      opt.textContent = `${frame.ts.replace("T", " ").replace(":00Z", "Z")}  (${age}${stale})`;
      select.appendChild(opt);
    }
  } catch {
    showOfflineNotice(true);
    loadProfile(sampleProfile);
  }
}

// ── Satellite source labels (G5) and retrieval states ──────────────────────
const SOURCE_LABELS = {
  gk2a: "GK-2A (KMA/NMSC)",
  G16: "GOES-16 (NOAA, archive)",
  G18: "GOES-18 (NOAA)",
  G19: "GOES-19 (NOAA)",
  H09: "Himawari-9 (JMA/NOAA)",
  msg: "Meteosat (EUMETSAT)",
};
const STATE_LABELS = {
  observed: "Cloud observed",
  clear: "Clear sky",
  no_retrieval: "No retrieval — not assessed",
  quality_rejected: "Quality rejected — not assessed",
  inconsistent_retrieval: "Inconsistent retrieval — not assessed",
  outside_domain: "Outside satellite coverage — not assessed",
  source_unavailable: "Satellite source unavailable — not assessed",
  no_satellite_coverage: "No satellite coverage — not assessed",
};

function sourceLabel(code) {
  return code ? (SOURCE_LABELS[code] || code) : "None";
}

// ── Evidence levels (decision D1: replaces the legacy risk badge and altitude suggestions) ──
const EVIDENCE_ORDER = [
  ["Observed supercooled layer at planned altitude", "observed"],
  ["Possible (forecast only)", "possible"],
  ["Not indicated", "not-indicated"],
  ["Not assessed", "not-assessed"],
];

function renderEvidence(profile) {
  const list = document.getElementById("evidence-list");
  list.innerHTML = "";
  const km = profile.dataKind === "simulated" ? null : profile.evidenceKm;
  for (const [name, key] of EVIDENCE_ORDER) {
    const li = document.createElement("li");
    li.dataset.level = key;
    const label = document.createElement("span");
    label.textContent = name;
    const value = document.createElement("strong");
    const v = km && Number.isFinite(km[name]) ? km[name] : null;
    value.textContent = v === null ? "—" : `${v.toFixed(0)} km`;
    li.append(label, value);
    list.appendChild(li);
  }
}
// ── UI helpers ──────────────────────────────────────────────────────────────
function showOfflineNotice(visible) {
  document.getElementById("offline-notice").classList.toggle("visible", visible);
}

function showError(msg) {
  const el = document.getElementById("error-msg");
  if (msg) {
    el.textContent = msg;
    el.classList.add("visible");
  } else {
    el.classList.remove("visible");
    el.textContent = "";
  }
}

function setLoading(active) {
  const btn = document.getElementById("submit-btn");
  document.getElementById("loading").classList.toggle("visible", active);
  btn.disabled = active;
  btn.textContent = active ? "Loading…" : "Show cross-section";
}

// ── Extended sample readout (additive — augments viewer.js selectSample) ───
function updateExtendedReadout(sample) {
  const srcEl = document.getElementById("sample-source");
  const stateEl = document.getElementById("sample-state");
  if (srcEl) {
    srcEl.textContent = sample.satelliteSource !== undefined
      ? sourceLabel(sample.satelliteSource) + (sample.domainEdge ? ` · low-quality view (${sample.viewZenithDeg}° view angle)` : "")
      : "—";
  }
  if (srcEl) srcEl.title = sample.qualityNote || "";
  if (stateEl) {
    stateEl.textContent = sample.retrievalState
      ? (STATE_LABELS[sample.retrievalState] || sample.retrievalState)
      : "—";
  }
  const tempEl = document.getElementById("top-temp");
  const expEl = document.getElementById("icing-exposure");
  if (!tempEl || !expEl) return;
  tempEl.textContent = sample.cloudTopTemperatureC !== undefined && sample.cloudTopTemperatureC !== null
    ? `${sample.cloudTopTemperatureC} °C`
    : "Unavailable";
  expEl.style.color = "";
  expEl.textContent = sample.evidenceLevel || "Not assessed";
}

// Patch viewer.js selectSample to also update extended fields.
// This runs after viewer.js is loaded (defer order: sample.js → viewer.js → app.js).
(function patchViewer() {
  const originalSelectSample = window.selectSample;
  if (typeof originalSelectSample !== "function") return;
  window.selectSample = function (index) {
    originalSelectSample(index);
    if (window._currentProfile && window._currentProfile.samples) {
      updateExtendedReadout(window._currentProfile.samples[index] || {});
    }
  };
})();

// Keep a reference to the loaded profile for extended readout.
const _origLoadProfile = window.loadProfile;
window.loadProfile = function (profile) {
  window._currentProfile = profile;
  _origLoadProfile(profile);
  if (profile.samples && profile.samples.length > 0) {
    updateExtendedReadout(profile.samples[0]);
  }
};

// ── Per-profile notices (polar gap, sources used) ──────────────────────────
function renderProfileNotices(profile) {
  const polar = document.getElementById("polar-notice");
  if (polar) {
    const hasPolar = profile.polarGap === true
      || (profile.notices || []).includes("polar_gap")
      || (profile.samples || []).some((s) => s.retrievalState === "outside_domain"
        && Math.abs(s.latitude) > 70);
    polar.classList.toggle("visible", hasPolar);
  }
  const list = document.getElementById("source-list");
  if (list) {
    const codes = profile.satelliteSources || (profile.satelliteSource ? [profile.satelliteSource] : []);
    list.textContent = codes.length ? `Sources: ${codes.map(sourceLabel).join(" + ")}` : "";
  }
}

// ── Submit handler ──────────────────────────────────────────────────────────
async function submit() {
  showError(null);
  showOfflineNotice(false);

  const fromRaw = document.getElementById("from-input").value;
  const toRaw   = document.getElementById("to-input").value;
  const altRaw  = document.getElementById("alt-input").value;
  const at      = document.getElementById("time-select").value;

  const [from, to] = await Promise.all([
    resolveEndpoint(fromRaw),
    resolveEndpoint(toRaw),
  ]);
  if (!from) { showError(`Cannot resolve departure: "${fromRaw}"`); return; }
  if (!to)   { showError(`Cannot resolve destination: "${toRaw}"`); return; }

  const altFt = parseAltitude(altRaw);
  if (!altFt || altFt < 0 || altFt > 60000) {
    showError("Enter a valid altitude: FL350, 350, or 35000");
    return;
  }

  const params = new URLSearchParams({
    from_lat: from.lat, from_lon: from.lon,
    to_lat:   to.lat,   to_lon:   to.lon,
    alt_ft:   altFt,
  });
  if (at) params.set("at", at);

  setLoading(true);
  try {
    const res = await fetch(`/api/icing/cross-section?${params}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Server error ${res.status}`);
    }
    const profile = await res.json();
    window._currentProfile = profile;
    loadProfile(profile);
    renderEvidence(profile);
    renderProfileNotices(profile);
    if (profile.dataKind === "simulated") showOfflineNotice(true);
  } catch (err) {
    showError(err.message || "Request failed. Check your connection.");
  } finally {
    setLoading(false);
  }
}

// ── Keyboard: Enter in any field submits ───────────────────────────────────
document.querySelectorAll("#from-input, #to-input, #alt-input").forEach((el) => {
  el.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
});
document.getElementById("submit-btn").addEventListener("click", submit);

// ── Init ────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  populateFrames();
});
