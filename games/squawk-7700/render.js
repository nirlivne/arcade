// Renderer setup and the per-beat camera rig: the dive's cockpit + rudder look-back cut, the escort's
// exterior chase camera, and the approach/landing's cockpit over the desert runway. Shake, vignette,
// speed lines, debris, the sun flare DOM anchor and the ?debug=1 overlay. Render only: reads the sim's
// flight state and events, never writes them.
import * as THREE from "./vendor/three.module.min.js";
import { createCockpitScene } from "./scene/cockpit.js";
import { createLookbackScene } from "./scene/lookback.js";
import { createEscortScene } from "./scene/escort.js";
import { createCabinScene } from "./scene/cabin.js";
import { createEndingScene } from "./scene/ending.js";
import { createTitleScene } from "./scene/title.js";
import { createSpeedLines, createDebris, createCabinDebris } from "./scene/fx.js";
import { AISLE } from "./beats/aisle.js";

const LOOKBACK_S = 0.4;

export function createRenderer(canvas, { touch, reducedMotion } = {}) {
  let reduced = !!reducedMotion;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !touch, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const baseDpr = Math.min(window.devicePixelRatio || 1, touch ? 1.5 : 2);
  renderer.setPixelRatio(baseDpr);

  // Auto-degrade (spec §10.6 MUST-PASS): a 2 s rolling average < 40 fps drops DPR to 1.0 and halves
  // particle counts, once per session (never re-checked after it fires, so it can't flap). `?degrade=1`
  // forces it immediately, for QA.
  let degraded = new URLSearchParams(location.search).get("degrade") === "1";
  let perfWindowT = 0, perfWindowFrames = 0, wasLive = false;
  function applyDegrade() {
    degraded = true;
    renderer.setPixelRatio(1.0);
  }
  if (degraded) applyDegrade();
  // live: play is actually running (not a menu/pause/title/shader-compile frame). The window only
  // counts live frames, and restarts clean every time live play (re)starts, so a slow first load or
  // a DOM-heavy menu frame can never burn the session's one-shot degrade on time that was never
  // real in-game performance (CTO review r2 non-blocking note).
  function tickPerf(dt, live) {
    if (degraded) return;
    if (!live) { wasLive = false; perfWindowT = 0; perfWindowFrames = 0; return; }
    if (!wasLive) { perfWindowT = 0; perfWindowFrames = 0; wasLive = true; }
    perfWindowT += dt;
    perfWindowFrames++;
    if (perfWindowT >= 2) {
      const avgFps = perfWindowFrames / perfWindowT;
      if (avgFps < 40) applyDegrade();
      perfWindowT = 0; perfWindowFrames = 0;
    }
  }
  function particleScale() { return degraded ? 0.5 : 1; }
  function isDegraded() { return degraded; }

  const dive = createCockpitScene({ outside: "dive" });
  // The door beat's aft jump-seat view, the Captain braced on the left yoke (D2-5): cruise-dusk sky,
  // tilted per the beat's bank wander, not a stand-in for the right-seat dive cockpit.
  const door = createCockpitScene({ outside: "cruise", view: "aft", captain: true, fov: 64 });
  const lookback = createLookbackScene();
  const escort = createEscortScene();
  const approach = createCockpitScene({ outside: "land", eye: 1.56, agl: 3000 * 0.3048, range: 4000 });
  const approachRunway = approach.world.getObjectByName("runway");
  const approachGround = approach.world.getObjectByName("desert");
  const cabin = createCabinScene(AISLE.TRACK_LEN);
  const ending = createEndingScene();
  const title = createTitleScene();

  const speedLines = createSpeedLines();
  const debris = createDebris();
  const cabinDebris = createCabinDebris();
  dive.scene.add(speedLines.mesh, debris.mesh, cabinDebris.mesh);

  let lookbackT = 0;
  let clock = 0;
  let sunScreen = { x: 0.5, y: 0.2, visible: false };
  const scenes = [dive, door, lookback, escort, approach, cabin, ending, title];

  function resize(w, h) {
    renderer.setSize(w, h, false);
    for (const s of scenes) { s.camera.aspect = w / h; s.camera.updateProjectionMatrix(); }
  }

  // Start a 0.4s cutaway to the tail camera showing the current rudder damage (dive only).
  function triggerLookback(chunksLost) {
    lookback.setRudderDamage(chunksLost);
    lookbackT = LOOKBACK_S;
    debris.spawn(new THREE.Vector3(0, 4.6, -9.4), fxRandRef.current || Math.random, 8, particleScale());
  }
  const fxRandRef = { current: null };

  function renderDive(flight, fxRand, dt) {
    dive.world.rotation.set((-flight.pitch * Math.PI) / 180, 0, (-flight.bank * Math.PI) / 180, "ZXY");
    if (dive.yoke) {
      dive.yoke.rotation.x = -(flight.inputIy || 0) * 0.5;
      dive.yoke.rotation.z = -(flight.inputIx || 0) * 0.6;
    }
    const over = Math.max(0, flight.v - 340);
    const trauma = over > 0 ? Math.min(1, 0.3 + over / 100) : 0;
    if (trauma > 0) {
      const shake = trauma * trauma * 0.03 * (reduced ? 0.25 : 1);
      dive.camera.position.x = 0.55 + (fxRand() - 0.5) * shake;
      dive.camera.position.y = 1.24 + (fxRand() - 0.5) * shake;
      dive.camera.fov = reduced ? 60 : 60 + Math.min(8, (over / (440 - 340)) * 8); // Comforts: no FOV kick
    } else {
      dive.camera.position.set(0.55, 1.24, 0.12);
      dive.camera.fov = 60;
    }
    dive.camera.updateProjectionMatrix();
    speedLines.update(flight.v, fxRand, dt, reduced, particleScale());
    debris.update(dt);
    cabinDebris.update(trauma, fxRand, clock, particleScale());
    // Comforts: master caution stays steady, not flickering at 2 Hz.
    const lampOn = reduced ? flight.cautionOn : flight.cautionOn && Math.floor(clock * 2) % 2 === 0;
    for (const lamp of dive.cautionLamps) if (lamp) lamp.material.color.set(lampOn ? "#FF3344" : "#3A1418");
    updateSunFlare(dive.camera, flight);
    return lookbackT > 0 ? lookback : dive;
  }

  function renderDoor(flight) {
    door.world.rotation.set(0, 0, (-(flight.bank || 0) * Math.PI) / 180, "ZXY");
    return door;
  }

  function renderEscort(flight) {
    escort.plane.rotation.z = (-flight.bank * Math.PI) / 180;
    escort.plane.rotation.x = (flight.pitch * Math.PI) / 180 * 0.3;
    escort.setRudderDamage(flight.chunksLost || 0);
    return escort;
  }

  // D2-12 (sign-off r2, THE-768): what hides the runway is the eye height, not the gaze. At a 1.36 m
  // eye the glareshield's front edge (y ~1.13, z ~-1.36) sits only ~9deg below level, while the
  // compressed glide path puts the threshold 11-14deg down from 1,700 to 1,000 ft -- and no camera
  // rotation helps: occlusion depends only on where the eye sits, not where it looks. A 1.56 m
  // eye drops the glareshield to ~16deg, so the runway clears it from ~1,700 ft (mockup).
  const APPROACH_EYE = 1.56;

  function renderApproach(flight) {
    approach.world.rotation.set((-flight.pitch * Math.PI) / 180, 0, (-flight.bank * Math.PI) / 180, "ZXY");
    // flight.alt is feet (the sim's unit); the scene is metres (recipe THE-734 "Units"). agl/world.js's
    // desert+runway placement was feeding feet straight in as metres, a ~3.3x scale error that buried
    // the runway far below the glide path at any real altitude -- the runway was never in the windshield
    // because it was never where the geometry below it said it was (D1-2).
    const agl = Math.max(0, flight.alt || 0) * 0.3048, range = Math.max(0, flight.range ?? 1400);
    if (approachGround) approachGround.position.y = -agl;
    if (approachRunway) approachRunway.position.set(-(flight.y || 0), -agl + 0.2, -range - 1200);
    approach.camera.position.set(0.55, APPROACH_EYE, 0.12);
    approach.camera.fov = 62;
    // The shown pitch (GLIDE_DEG, -3deg) is cosmetic, not the true flight-path angle -- the arcade
    // altK compression (x4) makes the real descent far steeper, so a fixed cockpit gaze loses the
    // runway under the glareshield for most of the approach. Aim at the threshold directly instead
    // (the same rotation the world group itself uses, so it's still "the cockpit holds still, the
    // world turns" -- only the gaze direction tracks where the ground actually is).
    // Aim at least 800 m out, never at the plane's own feet: close to touchdown this looks naturally
    // further down the runway (the way a pilot actually looks on short final), instead of pitching the
    // gaze down so steeply it stares into the dashboard.
    const threshold = new THREE.Vector3(-(flight.y || 0), -agl + 0.2, -Math.max(range, 800));
    threshold.applyEuler(new THREE.Euler((-flight.pitch * Math.PI) / 180, 0, (-flight.bank * Math.PI) / 180, "ZXY"));
    approach.camera.up.set(0, 1, 0);
    approach.camera.lookAt(threshold);
    approach.camera.updateProjectionMatrix();
    updateSunFlare(approach.camera, flight);
    return approach;
  }

  const LANE_X = [-0.9, 0, 0.9];
  function renderAisle(flight) {
    if (flight.aisleRows) cabin.setObstacles(flight.aisleRows);
    const laneX = LANE_X[flight.aisleLane ?? 1];
    cabin.followCamera(laneX, flight.aisleZ || 0);
    return cabin;
  }

  // Scratch objects reused every call (THE-759: this allocated a fresh Vector3/Euler every dive frame).
  const SUN_DIR = new THREE.Vector3(0.42, 0.06, -0.9).normalize();
  const sunFlareCamDir = new THREE.Vector3();
  const sunFlareEuler = new THREE.Euler();
  const sunFlareP = new THREE.Vector3();
  function updateSunFlare(camera, flight) {
    camera.getWorldDirection(sunFlareCamDir);
    if (SUN_DIR.dot(sunFlareCamDir) > 0.2) {
      sunFlareEuler.set((-flight.pitch * Math.PI) / 180, 0, (-flight.bank * Math.PI) / 180, "ZXY");
      sunFlareP.copy(SUN_DIR).applyEuler(sunFlareEuler).project(camera);
      sunScreen = { x: (sunFlareP.x + 1) / 2, y: (1 - sunFlareP.y) / 2, visible: sunFlareP.z < 1 };
    } else sunScreen = { x: 0.5, y: 0.2, visible: false };
  }

  // flight: the sim's current flight state (+ inputIx/inputIy, cautionOn, range for the approach;
  // aisleLane/aisleZ/aisleRows for the aisle; endingT in [0,1] for the ending). view: "dive" | "escort" |
  // "approach" | "aisle" | "ending". fxRand: the fx rng stream (cosmetic only). dt: seconds. live: true
  // when play is actually running (gates the auto-degrade perf window, see tickPerf).
  function render(flight, fxRand, dt, view = "dive", live = true) {
    fxRandRef.current = fxRand;
    clock += dt;
    tickPerf(dt, live);
    if (lookbackT > 0) lookbackT = Math.max(0, lookbackT - dt);

    let active;
    if (view === "title") { title.setT((clock * 0.015) % 1); active = title; }
    else if (view === "door") active = renderDoor(flight);
    else if (view === "escort") active = renderEscort(flight);
    else if (view === "approach") active = renderApproach(flight);
    else if (view === "aisle") active = renderAisle(flight);
    else if (view === "ending") { ending.setT(flight.endingT || 0); active = ending; }
    else active = renderDive(flight, fxRand, dt);

    renderer.render(active.scene, active.camera);
    return renderer.info.render;
  }

  function vignetteStrength(g) { return Math.max(0, Math.min(1, (g - 3) / 1.5)) * 0.8; }
  function sunFlare() { return sunScreen; }
  function inLookback() { return lookbackT > 0; }
  function setReducedMotion(on) { reduced = !!on; }

  // aisleObstacleStats (D1-1 QA check, tools/squawk-7700-tests/aisle-render-check.mjs): instance
  // counts and frustumCulled for the aisle's bags/masks/trolleys, read-only.
  return { renderer, resize, render, triggerLookback, vignetteStrength, sunFlare, inLookback, setReducedMotion, isDegraded, aisleObstacleStats: cabin.obstacleStats };
}

// ?debug=1 overlay: draw calls / triangles from renderer.info, kept to the G10 budget (<= 80 / 80k).
export function createDebugOverlay(container) {
  const el = document.createElement("div");
  el.style.cssText = "position:absolute;top:4px;left:4px;color:#9f9;font:11px monospace;background:#0008;padding:2px 6px;pointer-events:none;z-index:9999;";
  container.appendChild(el);
  return { update(info) { el.textContent = `calls ${info.calls} tris ${info.triangles}`; } };
}
