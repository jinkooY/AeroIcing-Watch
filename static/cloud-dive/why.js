// "Why?" cards (task 8.5, R9.4). Card text lives in WHY_CARDS so the wording test (8.6) can import
// or scan it. The text explains the data and the game model. It gives no advice and no suggested action.
// The display-scale card reuses the scene.js strings, so the numbers shown are the constants in use (R16.12).

import { STRINGS } from "./scene.js";

export const WHY_CARDS = [
  {
    id: "why-supercooled",
    title: "What is supercooled water?",
    paragraphs: [
      "Cloud droplets can stay liquid at temperatures below 0 C. Water in that state is called supercooled. " +
        "A droplet that touches a surface such as an aircraft wing can freeze on contact.",
      "The satellite cloud phase product marks cloud tops where it detects supercooled liquid water. " +
        "That flag describes the cloud top only. It is evidence, not a statement about how much ice would form.",
      "The ice index in this game is a game model with illustrative values. It is not a weather statement.",
    ],
  },
  {
    id: "why-tops",
    title: "Why does the satellite see only cloud tops?",
    paragraphs: [
      "A passive imager measures the radiation that leaves the top of the cloud layer it looks at. " +
        "It does not see through that layer.",
      "A supercooled layer below a higher cloud is not visible to it. " +
        "A pixel with no supercooled signal says nothing about layers underneath, so the game shows it as Not indicated, " +
        "which is a statement about the cloud top the satellite sees, not about what lies underneath.",
      "Where data are missing or rejected, the game shows Not assessed and does not treat it as Not indicated.",
    ],
  },
  {
    id: "why-base",
    title: "Why is the cloud base an estimate?",
    paragraphs: [
      "The satellite does not measure the base of a cloud. The base in this game uses the Noh et al. (2017) " +
        "statistical estimate, which works from cloud-top properties.",
      "It is drawn dashed, with a hatched band for the range of candidate heights. " +
        "Where the method cannot give a base, for example in deep convection, no base value is shown and none is invented.",
    ],
  },
  {
    id: "why-antiice",
    title: "Why does anti-ice cost fuel?",
    paragraphs: [
      "Aircraft anti-ice systems use engine power or heat, so running them raises fuel burn.",
      "In this game the anti-ice fuel factor is an illustrative game parameter stored in the case file. " +
        "It is not a figure for any real aircraft, and the dollar values are illustrative too.",
    ],
  },
  {
    id: "why-cruise-level",
    title: "Why is the start altitude called cruise level?",
    paragraphs: [
      "In this game the altitude the flight starts at is called cruise level. " +
        "It belongs to the game's altitude block, a fixed range of altitudes that the game lets you fly in.",
      "The block is below airline cruise level. It is a game setting chosen so that the cloud layers of the case fall inside it. " +
        "It is not a flight procedure.",
    ],
  },
  {
    id: "why-flat-ground",
    title: "Why is the ground flat?",
    paragraphs: [
      "The 3D view draws flat ground at the departure airport elevation. The game uses no terrain data, so mountains are not drawn. " +
        "For example, on the Denver case the Rocky Mountains are not drawn.",
      "The game's altitude block was set without terrain data. The evidence and the dollar values do not depend on the drawn ground.",
    ],
  },
  {
    id: "why-display-scale",
    title: "Why do the distances look different in the 3D view?",
    paragraphs: [STRINGS.displayScale, STRINGS.leadIn],
  },
];

export function renderWhy(root, cards = WHY_CARDS) {
  root.replaceChildren();
  const h = document.createElement("h3");
  h.textContent = "Why?";
  root.appendChild(h);
  for (const card of cards) {
    // details/summary is natively keyboard operable (Enter or Space) and exposes its open state.
    const d = document.createElement("details");
    d.className = "why-card";
    d.id = card.id;
    const s = document.createElement("summary");
    s.textContent = card.title;
    d.appendChild(s);
    for (const text of card.paragraphs) {
      const p = document.createElement("p");
      p.textContent = text;
      d.appendChild(p);
    }
    root.appendChild(d);
  }
}

export function initWhy({ root, subscribe }) {
  let built = false;
  subscribe((store) => {
    const show = Boolean(store.caseData);
    root.hidden = !show;
    if (show && !built) {
      renderWhy(root);
      built = true;
    }
  });
}
