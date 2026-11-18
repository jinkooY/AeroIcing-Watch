// "How costs work" card (revision e, R24.4). The rules of the game model in words, with no dollar value and no
// number computed from the flight: it is not a cost preview and it names no choice as better (R6.5, R17.3,
// guardrails rule 4). Each sentence matches engine.js (costComponents and step). DOM-free.

export const COST_RULES_TITLE = "How costs work (game model, illustrative)";

export const COST_RULES = Object.freeze([
  "Every km burns fuel. A head-wind makes each km take longer, so it costs more. The altitude changes the fuel per km too.",
  "Anti-ice on: extra fuel for every km while it is on. The ice index does not rise.",
  "Anti-ice off in Possible or Observed cells: the ice index can rise, and it does not go down. A higher ice index (game model) slows the aircraft and adds drag, so each later km costs more.",
  "Climb over: extra fuel for each 1,000 ft climbed. Descend: no climb fuel.",
  "Go left or Go right: a longer, diagonal path.",
  "Ice index (game model) 50: the flight stops at an ice gate. 100: forced diversion, with its own cost.",
]);
