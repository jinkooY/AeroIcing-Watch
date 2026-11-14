// 3D cockpit renderer (design 14, task 15.2). Draws a scene description from scene.js buildScene and nothing
// else: it never reads or changes the case file or the engine state, and keeps no game state of its own.
// Geometry is built by cockpit-geometry.js (tested in Node); this file only turns it into three.js objects.
// Evidence drawings (R16.7): Observed = solid orange glow, Possible = faint blue haze with dots,
// Not assessed = sparse grey line hatch, Not indicated = nothing. Clouds are soft volumes; an estimated base
// fades out and carries a label. The frame and panel are built from boxes: no logo, no livery.
// Load this module only after webglAvailable() passes (design 14.10).

import * as THREE from "./vendor/three/three.module.min.js";
import { VIEW_KM, MAX_TRIANGLES, DEFAULT_FOV_DEG } from "./scene.js";
import {
  EYE_HEIGHT_KM, SKY_SEGMENTS, buildDrawPlan, cameraEuler, fovForAspect, geometryKey, meshFromBoxes,
  stippleData, gateDotData, hatchData, softData, diagonalData, stripeData, dashData, LEVEL_OBSERVED, LEVEL_POSSIBLE, LEVEL_NOT_ASSESSED, cockpitBoxes, frostData, frostOpacity, frostRect, shakeOffsetDeg, windStreakSegments, MAX_STREAKS,
} from "./cockpit-geometry.js";

import { chaseCamera, aircraftBoxes, chaseBudget } from "./chase.js";

export { webglAvailable } from "./webgl-test.js";
export * from "./cockpit-geometry.js";

const TEX = 32;
const FROST_TEX = 64;
const NEAR_KM = 0.05;
// Task 15.6: cloud volumes fade out close to the eye, so a start cell inside cloud does not turn the whole
// windshield white. Fully clear below CLOUD_NEAR_CLEAR_KM, full strength beyond CLOUD_NEAR_FULL_KM. Display only.
const CLOUD_NEAR_CLEAR_KM = 4;
const CLOUD_NEAR_FULL_KM = 24;
const CLOUD_MAX_OPACITY = 0.8;

function fadeNearEye(material) {
  material.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vEyeKm;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvEyeKm = -mvPosition.z;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vEyeKm;")
      .replace("#include <dithering_fragment>",
        `#include <dithering_fragment>\n  gl_FragColor.a *= smoothstep(${CLOUD_NEAR_CLEAR_KM.toFixed(1)}, ${CLOUD_NEAR_FULL_KM.toFixed(1)}, vEyeKm);`);
  };
}

function dataTexture(bytes, wrap, size = TEX) {
  const t = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

function geometryFrom(data) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(data.positions, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(data.colors, 4)); // rgba: alpha fades the edges
  g.setAttribute("uv", new THREE.Float32BufferAttribute(data.uvs, 2));
  g.setIndex(data.indices);
  g.computeBoundingSphere();
  return g;
}

function labelTexture(text) {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "rgba(10,14,22,0.7)";
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = "#f2f5fa";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (text.length > 18 && text.includes(" ")) {
    // Long level names: two lines, split at the space nearest the middle.
    const spaces = [...text].map((ch, i) => (ch === " " ? i : -1)).filter((i) => i >= 0);
    const cut = spaces.reduce((b, i) => (Math.abs(i - text.length / 2) < Math.abs(b - text.length / 2) ? i : b), spaces[0]);
    ctx.font = "bold 25px sans-serif";
    ctx.fillText(text.slice(0, cut), 128, 18, 244);
    ctx.fillText(text.slice(cut + 1), 128, 47, 244);
  } else {
    ctx.font = "bold 28px sans-serif";
    ctx.fillText(text, 128, 33, 244);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// options: { pixelRatio, maxTriangles, viewKm }
export function createCockpit(canvas, options = {}) {
  const maxTriangles = options.maxTriangles || MAX_TRIANGLES;
  const viewKm = options.viewKm || VIEW_KM;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.autoClear = false;
  renderer.info.autoReset = false; // two passes per frame: count both, reset after reading
  renderer.setPixelRatio(options.pixelRatio || 1);

  const world = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(DEFAULT_FOV_DEG, 1.78, NEAR_KM, viewKm * 1.5);
  const overlay = new THREE.Scene();
  const overlayCamera = new THREE.PerspectiveCamera(DEFAULT_FOV_DEG, 1.78, 0.05, 5);
  world.fog = new THREE.Fog(0xbcd6ee, viewKm * 0.35, viewKm);

  const textures = {
    soft: dataTexture(softData(TEX), false),
    stipple: dataTexture(stippleData(TEX), true),
    gateDot: dataTexture(gateDotData(TEX), true),
    hatch: dataTexture(hatchData(TEX), true),
    frost: dataTexture(frostData(FROST_TEX), false, FROST_TEX),
    diagonal: dataTexture(diagonalData(TEX), true),
    stripe: dataTexture(stripeData(TEX), true),
    dash: dataTexture(dashData(TEX), true),
  };
  const base = { vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide };
  const mats = {
    cloud: new THREE.MeshBasicMaterial({ ...base, map: textures.soft }),
    observed: new THREE.MeshBasicMaterial({ ...base, blending: THREE.AdditiveBlending, fog: false }),
    possible: new THREE.MeshBasicMaterial({ ...base, map: textures.stipple }),
    notAssessed: new THREE.MeshBasicMaterial({ ...base, map: textures.hatch, alphaTest: 0.05 }),
    guide: new THREE.MeshBasicMaterial({ ...base, map: textures.dash, alphaTest: 0.05 }),
    // Sky gates (design 15.2): outline for every level, fills by pattern. Depth test on so clouds hide a far frame.
    gateLine: new THREE.MeshBasicMaterial({ ...base, fog: false }),
    gateObserved: new THREE.MeshBasicMaterial({ ...base, map: textures.diagonal, alphaTest: 0.05, fog: false }),
    gatePossible: new THREE.MeshBasicMaterial({ ...base, map: textures.gateDot, fog: false }),
    gateNotAssessed: new THREE.MeshBasicMaterial({ ...base, map: textures.stripe, alphaTest: 0.05, fog: false }),
    solid: new THREE.MeshBasicMaterial({ vertexColors: true }),
    frame: new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }),
  };
  mats.frost = new THREE.MeshBasicMaterial({
    map: textures.frost, color: 0xe8f4ff, transparent: true, opacity: 0, depthWrite: false, depthTest: false, fog: false,
  });
  fadeNearEye(mats.cloud);
  const renderOrder = { cloud: 1, notAssessed: 2, possible: 3, observed: 4, gate: 5 };

  // Sky dome (follows the eye) and flat ground (follows the eye in x and z only).
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(viewKm * 1.1, SKY_SEGMENTS[0], SKY_SEGMENTS[1]),
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  dome.renderOrder = -2;
  dome.frustumCulled = false;
  world.add(dome);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(viewKm * 4, viewKm * 4).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x4d6b4a }),
  );
  ground.renderOrder = -1;
  ground.frustumCulled = false;
  world.add(ground);
  let skyKey = "";

  const slots = {};
  const makeSlot = (name, material, order) => {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    mesh.visible = false;
    world.add(mesh);
    slots[name] = mesh;
    return mesh;
  };
  makeSlot("clouds", mats.cloud, renderOrder.cloud);
  makeSlot("notAssessed", mats.notAssessed, renderOrder.notAssessed);
  makeSlot("possible", mats.possible, renderOrder.possible);
  makeSlot("observed", mats.observed, renderOrder.observed);
  makeSlot("airports", mats.solid, 0);
  makeSlot("gateLine", mats.gateLine, renderOrder.gate);
  makeSlot("gateObserved", mats.gateObserved, renderOrder.gate);
  makeSlot("gatePossible", mats.gatePossible, renderOrder.gate);
  makeSlot("gateNotAssessed", mats.gateNotAssessed, renderOrder.gate);
  const guides = makeSlot("guides", mats.guide, 0);
  // Generic aircraft model of the chase view (task 19.1): built once at the origin, moved every frame.
  const aircraft = makeSlot("aircraft", mats.solid, 0);
  aircraft.geometry = geometryFrom(meshFromBoxes(aircraftBoxes([0, 0, 0])));
  const frameMesh = new THREE.Mesh(new THREE.BufferGeometry(), mats.frame);
  frameMesh.frustumCulled = false;
  overlay.add(frameMesh);
  // Frost on the windshield edges (R18.1): a textured quad over the opening; opacity = scene.effects.frost.
  const frostMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mats.frost);
  frostMesh.frustumCulled = false;
  frostMesh.renderOrder = 20;
  frostMesh.visible = false;
  overlay.add(frostMesh);

  // Wind streaks (R16.9): at most 12 thin lines in the windshield opening; positions from windStreakSegments.
  const streakGeom = new THREE.BufferGeometry();
  streakGeom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_STREAKS * 6), 3));
  streakGeom.setDrawRange(0, 0);
  const streakMesh = new THREE.LineSegments(
    streakGeom,
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthTest: false, fog: false }),
  );
  streakMesh.frustumCulled = false;
  streakMesh.renderOrder = 15;
  streakMesh.visible = false;
  overlay.add(streakMesh);

  const labelGroup = new THREE.Group();
  world.add(labelGroup);
  const labelCache = new Map();

  const fill = (name, boxes) => {
    const mesh = slots[name];
    mesh.geometry.dispose();
    mesh.visible = boxes.length > 0;
    mesh.geometry = boxes.length ? geometryFrom(meshFromBoxes(boxes)) : new THREE.BufferGeometry();
  };

  function setLabels(labels) {
    for (const s of [...labelGroup.children]) {
      labelGroup.remove(s);
      s.material.dispose();
    }
    for (const l of labels) {
      let tex = labelCache.get(l.text);
      if (tex === undefined) {
        tex = labelTexture(l.text);
        labelCache.set(l.text, tex);
      }
      if (!tex) continue;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, fog: false }));
      sp.position.set(l.x, l.y, l.z);
      sp.scale.set(l.width, l.width / 4, 1);
      sp.renderOrder = 10;
      labelGroup.add(sp);
    }
  }

  function setSky(sky) {
    const top = new THREE.Color((sky && sky.topColor) || "#2b5d9b");
    const hor = new THREE.Color((sky && sky.horizonColor) || "#bcd6ee");
    const key = `${top.getHexString()}${hor.getHexString()}`;
    if (key === skyKey) return;
    skyKey = key;
    const pos = dome.geometry.getAttribute("position");
    const col = new Float32Array(pos.count * 3);
    const r = viewKm * 1.1;
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = Math.pow(Math.min(Math.max(pos.getY(i) / r, 0), 1), 0.6); // horizon colour at and below the eye
      c.copy(hor).lerp(top, t);
      col.set([c.r, c.g, c.b], i * 3);
    }
    dome.geometry.setAttribute("color", new THREE.BufferAttribute(col, 3));
    world.fog.color.copy(hor);
    renderer.setClearColor(hor, 1);
  }

  let lastKey = "";
  let lastAspect = 0;
  let lastFov = 0;
  let plan = null;
  let size = { w: 1, h: 1 };
  const stats = { triangles: 0, drawnTriangles: 0, drawCalls: 0, dropped: null };

  function resize(w, h, pixelRatio) {
    size = { w: Math.max(1, Math.floor(w)), h: Math.max(1, Math.floor(h)) };
    if (pixelRatio) renderer.setPixelRatio(pixelRatio);
    renderer.setSize(size.w, size.h, false);
  }

  // scene: the plain object from buildScene. Returns the stats of this draw.
  // opts: { nowMs, reducedMotion } for the display-only shake.
  function render(scene, opts = {}) {
    if (!scene || !scene.camera) return stats;
    const aspect = size.w / size.h;
    const vfov = fovForAspect(aspect, scene.camera.fovDeg || DEFAULT_FOV_DEG);
    if (aspect !== lastAspect || vfov !== lastFov) {
      camera.aspect = overlayCamera.aspect = aspect;
      camera.fov = overlayCamera.fov = vfov;
      camera.updateProjectionMatrix();
      overlayCamera.updateProjectionMatrix();
      frameMesh.geometry.dispose();
      frameMesh.geometry = geometryFrom(meshFromBoxes(cockpitBoxes(aspect, vfov)));
      const fr = frostRect(aspect, vfov);
      frostMesh.scale.set(fr.x1 - fr.x0, fr.y1 - fr.y0, 1);
      frostMesh.position.set((fr.x0 + fr.x1) / 2, (fr.y0 + fr.y1) / 2, fr.z);
      lastAspect = aspect;
      lastFov = vfov;
    }
    const chase = scene.mode === "chase";
    const key = geometryKey(scene) + (chase ? "c" : "k");
    if (key !== lastKey) {
      lastKey = key;
      plan = buildDrawPlan(scene, { maxTriangles: chase ? chaseBudget(maxTriangles) : maxTriangles, aspect, fovDeg: vfov, viewKm });
      fill("clouds", plan.clouds);
      fill("observed", plan.observed);
      fill("possible", plan.possible);
      fill("notAssessed", plan.notAssessed);
      fill("airports", plan.airports);
      const gateFill = (lv) => plan.gates.filter((b) => b.part === "fill" && b.level === lv);
      fill("gateLine", plan.gates.filter((b) => b.part !== "fill"));
      fill("gateObserved", gateFill(LEVEL_OBSERVED));
      fill("gatePossible", gateFill(LEVEL_POSSIBLE));
      fill("gateNotAssessed", gateFill(LEVEL_NOT_ASSESSED));
      fill("guides", plan.guides);
      setLabels(plan.labels);
      stats.triangles = plan.triangles;
      stats.dropped = plan.dropped;
    }
    setSky(scene.sky);

    // In chase mode scene.camera is the aircraft pose; the drawn camera sits behind and above it.
    const [px, py, pz] = scene.camera.pos;
    const cam = chase ? chaseCamera(scene.camera) : scene.camera;
    camera.position.set(cam.pos[0], cam.pos[1], cam.pos[2]);
    aircraft.visible = chase;
    frameMesh.visible = !chase;
    if (chase) {
      aircraft.position.set(px, py, pz);
      aircraft.rotation.set(((scene.camera.rollDeg || 0) * Math.PI) / 180, (-(scene.camera.yawDeg || 0) * Math.PI) / 180,
        ((scene.camera.pitchDeg || 0) * Math.PI) / 180, "YZX");
    }
    // Shake (R18.2): amplitude from scene.effects.shakeDeg, time from the frame; none under reduced motion.
    const amp = scene.effects && scene.effects.shakeDeg;
    const sh = shakeOffsetDeg(amp, opts.nowMs, opts.reducedMotion);
    const e = cameraEuler({
      ...cam,
      pitchDeg: (cam.pitchDeg || 0) + sh.pitchDeg,
      yawDeg: (cam.yawDeg || 0) + sh.yawDeg,
      rollDeg: (cam.rollDeg || 0) + sh.rollDeg,
    });
    camera.rotation.set(e.x, e.y, e.z, "YXZ");
    dome.position.set(px, py, pz);
    ground.position.set(px, scene.ground ? scene.ground.y : 0, pz);
    guides.position.set(px, py - EYE_HEIGHT_KM, 0);
    const alpha = Math.min(Math.max(scene.cloudAlpha, 0), 1);
    mats.cloud.opacity = alpha * CLOUD_MAX_OPACITY;
    slots.clouds.visible = alpha > 0 && plan.clouds.length > 0;

    const frost = frostOpacity(scene); // draws engine state only; never writes it
    mats.frost.opacity = frost;
    frostMesh.visible = frost > 0;

    const segs = windStreakSegments(scene, aspect, vfov, opts.nowMs, opts.reducedMotion);
    const sp = streakGeom.getAttribute("position");
    segs.forEach((s, i) => sp.array.set([s.x0, s.y0, s.z, s.x1, s.y1, s.z], i * 6));
    sp.needsUpdate = true;
    streakGeom.setDrawRange(0, segs.length * 2);
    streakMesh.visible = segs.length > 0;

    renderer.clear();
    renderer.render(world, camera);
    renderer.clearDepth();
    renderer.render(overlay, overlayCamera);
    stats.drawnTriangles = renderer.info.render.triangles;
    stats.drawCalls = renderer.info.render.calls;
    renderer.info.reset();
    return stats;
  }

  function dispose() {
    for (const m of [...Object.values(slots), frameMesh, frostMesh, streakMesh, dome, ground]) m.geometry.dispose();
    Object.values(mats).forEach((m) => m.dispose());
    Object.values(textures).forEach((t) => t.dispose());
    setLabels([]);
    labelCache.forEach((t) => t && t.dispose());
    renderer.dispose();
  }

  return { render, resize, dispose, stats: () => ({ ...stats }) };
}
