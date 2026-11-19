// Cloud Dive end-of-flight report view (task 8.4). Fills #report from report.js.
// Reference results are drawn only after the flight has ended (R8.2). The personal best stays in this
// browser (localStorage) and is never sent anywhere (R8.4). No ranking is claimed (R8.5).

import {
  REFERENCE_LABELS, browserStorage, buildReport, formatUsdWhole, recordPersonalBest, reportHeadline, shareText,
} from "./report.js";
import { BEST_LABEL, buildReview, settingsText } from "./flight-review.js";

const YOU_COLOUR = "#74d4ff";
const BEST_COLOUR = "#ffb347";

// Revision f (R25.3): altitude, lane and anti-ice of the player and of the Best game reference over distance, on
// the same axes. `ctx` is a 2D context of a canvas w x h CSS pixels. Pure drawing; the review comes from
// flight-review.js.
export function drawReview(ctx, review, w, h) {
  const padL = 64, padR = 12, top = 22;
  // rows from the top: altitude, lane, two anti-ice strips (you, Best), the legend line; each row fits inside h
  const strip = 10, legendH = 20;
  const free = h - top - legendH - 2 * strip - 4 - 32;
  const altH = Math.round(free * 0.68), laneH = Math.round(free * 0.32);
  const laneTop = top + altH + 16, iceTop = laneTop + laneH + 16;
  const x = (km) => padL + (km / review.totalKm) * (w - padL - padR);
  const minFt = Math.min(...review.altsFt), maxFt = Math.max(...review.altsFt);
  const yAlt = (ft) => top + altH - ((ft - minFt) / Math.max(1, maxFt - minFt)) * altH;
  const yLane = (l) => laneTop + ((l - 1) / Math.max(1, review.nLanes - 1)) * laneH;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(0, 0, w, h);
  ctx.font = "12px Segoe UI, sans-serif";
  ctx.fillStyle = "#a9b8d6";
  ctx.strokeStyle = "rgba(169,184,214,0.25)";
  ctx.lineWidth = 1;
  for (const ft of [minFt, Math.round((minFt + maxFt) / 2 / 1000) * 1000, maxFt]) {
    ctx.beginPath(); ctx.moveTo(padL, yAlt(ft)); ctx.lineTo(w - padR, yAlt(ft)); ctx.stroke();
    ctx.fillText(`${Math.round(ft).toLocaleString("en-US")} ft`, 4, yAlt(ft) + 4);
  }
  for (const l of [1, review.nLanes]) {
    ctx.beginPath(); ctx.moveTo(padL, yLane(l)); ctx.lineTo(w - padR, yLane(l)); ctx.stroke();
    ctx.fillText(`lane ${l}`, 4, yLane(l) + 4);
  }
  ctx.fillText("anti-ice", 4, iceTop + strip + 2);
  const line = (pts, key, y, colour, dash) => {
    ctx.strokeStyle = colour;
    ctx.lineWidth = 2.5;
    ctx.setLineDash(dash);
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(x(p.km), y(p[key])) : ctx.moveTo(x(p.km), y(p[key]))));
    ctx.stroke();
    ctx.setLineDash([]);
  };
  line(review.you, "altFt", yAlt, YOU_COLOUR, []);
  line(review.best, "altFt", yAlt, BEST_COLOUR, [7, 5]);
  line(review.you, "lane", yLane, YOU_COLOUR, []);
  line(review.best, "lane", yLane, BEST_COLOUR, [7, 5]);
  const bars = (pts, y, colour) => {
    ctx.fillStyle = colour;
    let prevKm = 0;
    for (const p of pts) {
      if (p.antiIce) ctx.fillRect(x(prevKm), y, Math.max(1, x(p.km) - x(prevKm)), strip);
      prevKm = p.km;
    }
  };
  bars(review.you, iceTop, YOU_COLOUR);
  bars(review.best, iceTop + strip + 4, BEST_COLOUR);
  ctx.fillStyle = "#a9b8d6";
  for (const g of review.gates) {
    ctx.fillRect(x(g.km) - 0.5, top - 6, 1, 6);
    ctx.fillText(String(g.n), x(g.km) - 3, top - 9);
  }
  ctx.font = "13px Segoe UI, sans-serif";
  ctx.fillStyle = YOU_COLOUR;
  ctx.fillText("You", padL, h - 6);
  ctx.fillStyle = BEST_COLOUR;
  ctx.fillText("- - Best (game reference)", padL + 40, h - 6);
  ctx.fillStyle = "#a9b8d6";
  ctx.fillText("Numbers on top: your gates. Strips: anti-ice on.", padL + 230, h - 6);
}

// The review section: the chart and one row per gate (R25.3, R25.4). Null when there is no review.
function reviewSection(store, st) {
  const c = store.engineCase;
  const review = buildReview(c, store.flown, st, store.caseData.references);
  if (!review) return null;
  const box = el("section", null, "report-review");
  box.id = "report-review";
  box.appendChild(el("h4", `Your flight and ${BEST_LABEL}`));
  box.appendChild(el("p", "Shown after the flight only. Best is the lowest cost the game solver found with the game's " +
    "cost rules. It is a game reference, not a procedure and not a route to fly.", "small"));
  const cv = document.createElement("canvas");
  cv.className = "review-chart";
  cv.setAttribute("role", "img");
  cv.setAttribute("aria-label", `Altitude, lane and anti-ice over distance for your flight and for Best (game reference, not a procedure). ` +
    `${review.gates.length} gates; the table below lists them.`);
  const w = 640, h = 300;
  const dpr = (typeof devicePixelRatio === "number" && devicePixelRatio > 0) ? devicePixelRatio : 1;
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  cv.style.aspectRatio = `${w} / ${h}`;
  const ctx = cv.getContext && cv.getContext("2d");
  // a drawing error must not take the gate table with it
  if (ctx) { try { ctx.scale(dpr, dpr); drawReview(ctx, review, w, h); } catch (e) { cv.hidden = true; console.error(e); } }
  box.appendChild(cv);
  const wrap = el("div", null, "report-table-wrap");
  wrap.appendChild(table("At each of your gates: settings flown next, and the cost to the next gate (game values, illustrative)",
    ["Gate", "km", "You", "Best (game reference)", "Your cost", "Best cost"],
    review.gates.map((g) => [String(g.n), String(Math.round(g.km)), settingsText(g.you), settingsText(g.best),
      formatUsdWhole(g.youUsd), formatUsdWhole(g.bestUsd)])));
  box.appendChild(wrap);
  return box;
}

function el(tag, text, cls) {
  const n = document.createElement(tag);
  if (text !== undefined && text !== null) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}

function table(caption, head, rows) {
  const t = el("table", null, "report-table");
  t.appendChild(el("caption", caption));
  const hr = document.createElement("tr");
  for (const h of head) {
    const th = el("th", h);
    th.scope = "col";
    hr.appendChild(th);
  }
  const thead = document.createElement("thead");
  thead.appendChild(hr);
  t.appendChild(thead);
  const tb = document.createElement("tbody");
  for (const r of rows) {
    const tr = document.createElement("tr");
    r.forEach((cell, i) => {
      const td = el(i === 0 ? "th" : "td", cell);
      if (i === 0) td.scope = "row";
      tr.appendChild(td);
    });
    tb.appendChild(tr);
  }
  t.appendChild(tb);
  return t;
}

// deps: { root, getStore, subscribe }
export function initReport(deps) {
  const { root, getStore, subscribe } = deps;
  let shownFor = null; // the final state object already drawn (the store notifies on every change)

  function render(store) {
    const c = store.engineCase;
    const st = store.state;
    if (!c || !st || st.status === "flying") {
      shownFor = null;
      root.hidden = true;
      root.replaceChildren();
      return;
    }
    if (shownFor === st) return;
    shownFor = st;

    const data = store.caseData;
    const report = buildReport(c, st, data.references, data.params);
    const storage = browserStorage();
    // Hot-seat flights share one device, so they do not touch the personal best; single-player is unchanged.
    const hot = Boolean(store.hot);
    const best = hot ? null : recordPersonalBest(storage, data.id, report);

    const kids = [];
    const h = el("h3", report.ranked ? "Flight report" : "Flight report: not ranked");
    h.id = "report-title";
    h.tabIndex = -1;
    root.setAttribute("aria-labelledby", "report-title");
    kids.push(h);

    const headline = reportHeadline(report);
    if (headline) {
      const lead = el("p", null, "report-lead");
      lead.appendChild(el("span", headline.vsStraight ? headline.vsStraight.text : "Straight-ahead: not available",
        "report-lead-main"));
      lead.appendChild(document.createElement("br"));
      lead.appendChild(el("span", headline.aboveBest ? headline.aboveBest.text : "Best: not available",
        "report-lead-best"));
      kids.push(lead);
    }

    if (report.ranked) {
      kids.push(el("p", report.savingSharePercent === null
        ? "Saving share from Straight-ahead to Best: not available for this case."
        : `Saving share from Straight-ahead to Best: ${Math.round(report.savingSharePercent)} percent ` +
          `(0 percent = Straight-ahead cost, 100 percent = Best cost; a negative value means ` +
          `a higher cost than Straight-ahead). The Wasteful extreme is shown as a reference only.`));
      kids.push(el("p", `Total fuel cost: ${formatUsdWhole(report.totalUsd)}`, "report-total"));
    } else {
      kids.push(el("p", `Not ranked. The ice index reached 100 and the flight ended in a diversion. ` +
        `Cost up to the diversion: ${formatUsdWhole(report.costUpToDiversionUsd)}. ` +
        `Diversion cost (illustrative game value): ${formatUsdWhole(report.diversionUsd)}. ` +
        `Departure climb (illustrative game value): ${formatUsdWhole(report.departureUsd)}. ` +
        `Total: ${formatUsdWhole(report.totalUsd)}.`, "report-total"));
    }

    kids.push(table("Cost components (game values, illustrative)", ["Component", "Cost"],
      report.components.map((x) => [x.label, formatUsdWhole(x.usd)])));

    kids.push(el("p", `Ice-index peak (game model): ${report.icePeak} / 100. ` +
      `Minutes with anti-ice on: ${report.minutesAntiIce.toFixed(1)}.`));

    kids.push(table("Kilometres per evidence level", ["Evidence level", "km"],
      [...report.kmPerLevel.map((x) => [x.label, x.km.toFixed(1)]),
        ["Distance flown", report.distanceKm.toFixed(1)]]));

    const refRows = REFERENCE_LABELS.map(([key, label, note]) => [
      `${label} (game baseline)`,
      report.references[key] === null ? "Not available" : formatUsdWhole(report.references[key]),
      note,
    ]);
    kids.push(table("Game references for this case (shown after play, not procedures)",
      ["Reference", "Cost", "Definition"], refRows));
    const review = reviewSection(store, st);
    if (review) kids.push(review);

    let bestText;
    if (hot) bestText = "Hot-seat flight: the personal best is not updated.";
    else if (!report.ranked) bestText = "Diverted flights do not count toward a personal best.";
    else if (!best.available) bestText = "Personal best could not be saved: browser storage is not available.";
    else if (best.isNew) bestText = `New personal best on this device: ${formatUsdWhole(report.totalUsd)}.`;
    else bestText = `Personal best on this device: ${best.best === null ? "none yet" : formatUsdWhole(best.best)}.`;
    kids.push(el("p", `${bestText} Stored only in this browser, never uploaded.`, "small"));

    const share = el("textarea", null, "share-text");
    share.id = "share-text";
    share.readOnly = true;
    share.rows = 3;
    share.value = shareText(report, data.title);
    share.setAttribute("aria-label", "Share text");
    const copy = el("button", "Copy share text");
    copy.type = "button";
    copy.addEventListener("click", async () => {
      share.select();
      try {
        await navigator.clipboard.writeText(share.value);
        copy.textContent = "Copied";
      } catch {
        copy.textContent = "Select the text and copy it";
      }
    });
    kids.push(share, copy);

    root.replaceChildren(...kids);
    root.hidden = false;
    h.focus?.();
  }

  subscribe(render);
}
