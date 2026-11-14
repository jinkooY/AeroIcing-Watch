// View mode selection (task 15.5, design 14.10, R19.1, R19.2). DOM-free.
// The cockpit view is the default for flights. The 2D view opens when the 3D layer is not available (WebGL
// missing, or the 3D module failed to load) with a notice, and at any time by the player (key V or button).
// Both views play the same flight through the same controller, so the costs are the same.

export const VIEW_NOTICE = Object.freeze({
  "no-webgl":
    "The 3D view is not available in this browser because WebGL is off or missing. " +
    "This is the 2D view. It plays the same flight with the same costs.",
  "load-failed":
    "The 3D view could not be loaded. This is the 2D view. It plays the same flight with the same costs.",
});

export const VIEW_BUTTON = Object.freeze({ to2d: "2D view (V)", toCockpit: "Cockpit view (V)" });

// status: "idle" | "loading" | "ready" | "failed" (state of the 3D layer). reason: "no-webgl" | "load-failed".
// wants2d: the player asked for the 2D view. Returns { view: "cockpit" | "2d", notice, canToggle }.
export function chooseView({ status, reason, wants2d }) {
  if (status === "failed") {
    return { view: "2d", notice: VIEW_NOTICE[reason] || VIEW_NOTICE["load-failed"], canToggle: false };
  }
  if (status === "ready") return { view: wants2d ? "2d" : "cockpit", notice: null, canToggle: true };
  return { view: "2d", notice: null, canToggle: false }; // 3D layer not ready yet: the 2D view plays
}

export const buttonLabel = (view) => (view === "cockpit" ? VIEW_BUTTON.to2d : VIEW_BUTTON.toCockpit);

// Key V toggles the view. Only when a flight is on screen, the 3D layer is ready and the game keys are allowed.
export function viewKeyApplies(key, { flightOn, canToggle }) {
  return (key === "v" || key === "V") && Boolean(flightOn) && Boolean(canToggle);
}
