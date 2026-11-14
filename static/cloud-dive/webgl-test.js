// WebGL context test (design 14.10, R19.1). No three.js import, so a caller can run this test first and
// load cockpit3d.js only when it passes. Reads nothing from the case or the engine.

// Returns true when a WebGL or WebGL2 context can be created. `doc` is injectable for tests.
export function webglAvailable(doc) {
  try {
    const d = doc || (typeof document !== "undefined" ? document : null);
    if (!d || typeof d.createElement !== "function") return false;
    const canvas = d.createElement("canvas");
    if (!canvas || typeof canvas.getContext !== "function") return false;
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    return Boolean(gl);
  } catch (_e) {
    return false;
  }
}
