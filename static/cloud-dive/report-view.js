// Cloud Dive end-of-flight report view (task 8.4). Fills #report from report.js.
// Reference results are drawn only after the flight has ended (R8.2). The personal best stays in this
// browser (localStorage) and is never sent anywhere (R8.4). No ranking is claimed (R8.5).

import {
  REFERENCE_LABELS, browserStorage, buildReport, formatUsdWhole, recordPersonalBest, shareText,
} from "./report.js";

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
    const report = buildReport(c, st, data.references);
    const storage = browserStorage();
    const best = recordPersonalBest(storage, data.id, report);

    const kids = [];
    const h = el("h3", report.ranked ? "Flight report" : "Flight report: not ranked");
    h.id = "report-title";
    h.tabIndex = -1;
    root.setAttribute("aria-labelledby", "report-title");
    kids.push(h);

    if (report.ranked) {
      kids.push(el("p", `Total fuel cost: ${formatUsdWhole(report.totalUsd)}`, "report-total"));
    } else {
      kids.push(el("p", `Not ranked. The ice index reached 100 and the flight ended in a diversion. ` +
        `Cost up to the diversion: ${formatUsdWhole(report.costUpToDiversionUsd)}. ` +
        `Diversion cost (illustrative game value): ${formatUsdWhole(report.diversionUsd)}. ` +
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

    if (report.ranked) {
      kids.push(el("p", report.savingSharePercent === null
        ? "Saving share from Straight-ahead to Best: not available for this case."
        : `Saving share from Straight-ahead to Best: ${Math.round(report.savingSharePercent)} percent ` +
          `(0 percent = Straight-ahead cost, 100 percent = Best cost; a negative value means ` +
          `a higher cost than Straight-ahead). The Wasteful extreme is shown as a reference only.`));
    }

    let bestText;
    if (!report.ranked) bestText = "Diverted flights do not count toward a personal best.";
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
