// World assembly: renderer, camera rig, lights, the forest ribbon, pooled hazard/coin/signpost meshes
// and the capy. game.js calls renderFrame(state, dt) once per animation frame with sim.state(); this
// module never writes sim state, only reads it (design: "render never writes sim state").
//
// S1 simplification (flagged for CTO review): the trail is one fixed-length ribbon rebuilt (not
// streamed) as the capy approaches its end, not the pooled-tile-of-12 architecture the design calls for.
// It reconstructs its heading from every junction the sim has ever placed (sim.state().junctions is
// unfiltered for exactly this reason). True endless tile pooling is S3/S4 scope.
import * as THREE from "three";
import {
  BIOME, makeTrail, trailPointsFromJunctions, trailMesh, appendTrailMesh, groundMesh, decorSlot, decorSlotRange, DECOR_STEP,
  skyDome, makeRenderer, chaseCam, coinMesh, coinPopMesh, honeyJarMesh, nearMissPopMesh, signpost, forkStub,
  ribbonResyncS, logOnStumps, mergedLowLog, bubble, aura, shieldPopMesh, PU,
} from "./look.js";
import { loadPowerupTemplates, shieldPickupMesh, balloonPickupMesh, springPickupMesh, rideBalloonMesh, mysteryPickupMesh, mysteryLid } from "./powerups.js";
import { loadFinishTemplate, finishArchMesh } from "./finish.js";
import { arcHeightNow } from "../sim/jump.js";
import { expr as exprCapy } from "./capy.js";
import { createHero } from "./hero.js";
import { loadBirdTemplate, spawnBird, updateBird, birdVisualOffsetY } from "./bird.js";
import { loadPropsTemplate, propMesh, pickVariant, LOG_VARIANTS, BUSH_VARIANTS } from "./props.js";
import { loadDecorModels, decorModelsForTier } from "./decor-models.js";
import { loadFillerTemplates, fillerGroup, placeFillerGroup } from "./fillers.js";
import { loadObstacleTemplates, snagMesh, duckMesh, SNAG_VARIANTS } from "./obstacles.js";
import { stumbleThunk, liveBeeVoiceCount } from "./sfx.js";
import { play, playCoin } from "./audio.js";
import { placeAt } from "./placement.js";
import { capyLeanAngle, cameraRollAngle } from "./bank.js";
import { missedCornerPosition, stubDirection, STUB_LENGTH } from "./fork.js";
import { nextGroundBasis, GROUND_LEAD } from "./ground-policy.js";
import { createDecorWindow } from "./decor-window.js";
import { sunFollow } from "./shadow-follow.js";
import { applyIntroCam } from "./intro-cam.js";
import { createAmbient } from "./ambient.js";
import { createGlanceState, updateGlance, EASE_IN_T, HOLD_T, EASE_OUT_T, CANCEL_EASE_OUT_T } from "./glance.js";

const CORNER_OVERRUN_TIME = 0.4; // render-layer seconds to run the capy out to the stub's dead end
const COIN_POP_DURATION = 0.15; // spec §7
const HONEY_FLY_DURATION = 0.35; // spec Part 1: coins "fly to the capy" -- longer than the normal 0.15 s pop, since a honey-collected coin can start up to 15 m out and needs to read as travelling, not just popping in place
const NEAR_MISS_POP_DURATION = 0.25; // a touch longer than the coin pop (0.15 s) so the wider ring has time to read
// THE-1391 (design/capy-trail/powerups/README.md "1. Picnic Shield"): the bubble's own wobble/blink/pop timing.
const SHIELD_WOBBLE_HZ = 2, SHIELD_BLINK_HZ = 4, SHIELD_BLINK_LEAD_S = 3, SHIELD_BLINK_FLOOR = 0.35;
const SHIELD_BUBBLE_POP_T = 0.12; // "scale 1 -> 1.25 and uAlpha 1 -> 0 over 0.12 s, then hide"
const SHIELD_BURST_DURATION = COIN_POP_DURATION; // "reuse coinPopMesh()'s ring + sparks ... for the burst"
const BALLOON_POP_IN_T = 0.3, BALLOON_SWAY_HZ = 0.7, BALLOON_SWAY_AMP = 0.06, BALLOON_CAMERA_LIFT = 0.75;
const SPRING_AURA_HZ = 2; // README "Ring + aura": "opacity pulses 0.4 -> 0.6 at 2 Hz"
const MYSTERY_LID_OPEN_T = 0.12, MYSTERY_LID_ANGLE = -1.1, MYSTERY_PRIZE_SOUND_AT = 0.15, MYSTERY_HIDE_AT = 0.25;

const RIBBON_MARGIN = 150; // rebuild once the capy is within this many metres of the ribbon's end
const RIBBON_MIN = 300;
const BIRD_SETTLE_TTC = 1.0; // s before contact the bird's swoop has landed it at its duck height
const RIBBON_GROW = 300;

const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3); // spec §7's easing family, cubic-bezier(.2,.9,.3,1.25) approximated for a 0..1 progress value

export function createWorld(canvas, { seed = 1, tier = "high", width = 1, height = 1, dpr = 1, hero: heroKind = "bear", bearHD = false } = {}) {
  const renderer = makeRenderer(canvas, width, height, dpr);
  // THE-1373: the active hero (bear+bees or capy+geese) owns its own GLB loads and chaser -- see
  // render/hero.js. Nothing else in this module names a GLB path or branches on which animal it is.
  const hero = createHero(heroKind, { bearHD });
  const B = BIOME.forest;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(B.horizon);
  scene.fog = new THREE.FogExp2(new THREE.Color(B.fog), B.fogD);
  // CTO fix K1 (THE-1259 S2 review PASS, 2026-11-06 02:00Z, fix-first in S3): "the sky goes flat past about
  // 400 m (skyDome is a 400 m sphere at the origin, and the far plane is 400)." skyDome()'s shader colours
  // purely by normalized direction from the dome's own local origin, so it looks identical from anywhere
  // inside the sphere -- the bug is that the dome never moves, so once the camera travels far enough from
  // world (0,0,0) it gets close to (and past) the dome's 400 m radius, which is also exactly the camera's
  // far clip plane. Standard skybox fix: re-centre the dome on the camera's x/z every frame (not y, so the
  // horizon band stays level) so the camera is always effectively at the dome's local origin.
  const sky = skyDome(B);
  scene.add(sky);
  const hemi = new THREE.HemisphereLight(new THREE.Color(B.hemiSky), new THREE.Color(B.hemiGround), B.hemiInt);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(new THREE.Color(B.sun), B.sunInt);
  scene.add(sun); scene.add(sun.target); // placed every frame by sunFollow (P1: fixed direction, texel-snapped)
  sun.castShadow = tier !== "low";
  sun.shadow.mapSize.set(tier === "high" ? 2048 : 1024, tier === "high" ? 2048 : 1024);
  const sc = sun.shadow.camera; sc.left = sc.bottom = -32; sc.right = sc.top = 32; sc.near = 1; sc.far = 90; sun.shadow.radius = 4; sun.shadow.bias = -0.0006;

  // THE-1284: bird.glb and props.glb (logs, decor bushes) load async, same "a few frames with no mesh, not
  // a blocked boot" pattern as capy.glb below -- declared here (before rebuildGroundAndDecor, which reads
  // propsTemplate on its very first call at world-creation time) rather than down by the capy load.
  let disposed = false;
  let birdTemplate = null, propsTemplate = null, fillerTemplates = null;
  loadBirdTemplate("./assets/bird.glb").then((t) => { if (!disposed) birdTemplate = t; });
  loadPropsTemplate("./assets/props.glb").then((t) => {
    if (disposed) return;
    propsTemplate = t;
    // decor slots built before this used the procedural fallback bush for life: rebuild them with the real ones
    if (trail) { decorWin.clear(); rebuildGroundAndDecor(groundBasisS ?? 0, lastS); }
  });
  // THE-1355: the A14 tree/sheep/hut/flowers GLBs (THE-1352) replace look.js's old procedural shapes for
  // those kinds -- same async-load gap and forced rebuild-on-load as propsTemplate just above.
  let decorModelsTiered = null;
  loadDecorModels().then((t) => {
    if (disposed) return;
    decorModelsTiered = decorModelsForTier(t, tier);
    if (trail) { decorWin.clear(); rebuildGroundAndDecor(groundBasisS ?? 0, lastS); }
  });
  loadFillerTemplates("./assets/trunk.glb", "./assets/boulders.glb").then((t) => { if (!disposed) fillerTemplates = t; });
  let obstacleTemplates = null; // P1 (THE-1320): snag blocker + duck tunnel
  loadObstacleTemplates().then((t) => { if (!disposed) obstacleTemplates = t; });
  // THE-1373: the chaser (geese or bees) is the active hero's own concern now -- build() loads its
  // template and spawns its instances, replacing the goose-specific load call that used to live here.
  hero.chaser.build(scene);

  let trail = null, trailMeshObj = null, groundMeshObj = null, decorGroup = null, ribbonLength = 0, meshedToS = 0;
  // CTO fix B8 r3 (THE-1259 S2 review, 2026-11-06 00:45Z): ground/decor used to only re-centre as a side
  // effect of a full ribbon rebuild (every RIBBON_GROW = 300 m), far less often than their own ~240 m-wide
  // window needs to stay ahead of the capy -- "no ground between rebuilds (at 420 m there's none)". They
  // now have their own, more frequent trigger (render/ground-policy.js), decoupled from the ribbon's own
  // rarer rebuild. buildRibbon() only rebuilds the trail/trailMesh now.
  //
  // CTO fix P1 (THE-1259 S2 review r4, 2026-11-06 01:18Z): "trailMesh rebuilds from 0 (57 ms at 3,000 m)."
  // `trail` itself (the curve + its junction point list) is cheap to rebuild (~1 ms even at 3,000 m) and
  // has to be, since new junctions reshape the curve -- but the mesh's per-metre ring geometry does not
  // need rebuilding for a trail section the capy has already passed, so appendTrailMesh() only builds and
  // splices on the newly grown suffix. fresh=true (the first call, or a brand-new run after buildRibbon's
  // caller resets state) still does the one full trailMesh() build.
  //
  // THE-1285 (CTO, R2 review): `keepToS` (from ribbonResyncS) cuts the built ribbon back before appending,
  // for a junction that appeared inside ribbon already built. See appendTrailMesh.
  let builtJunctionCount = 0;
  function buildRibbon(junctions, minLength, fresh = false, keepToS = null) {
    const length = Math.max(minLength, RIBBON_MIN);
    const points = trailPointsFromJunctions(junctions, length);
    const previousMeshedToS = meshedToS;
    trail = makeTrail(points);
    if (fresh || !trailMeshObj) {
      if (trailMeshObj) { scene.remove(trailMeshObj); trailMeshObj.geometry.dispose(); }
      trailMeshObj = trailMesh(trail, B, "forest", junctions); scene.add(trailMeshObj);
    } else {
      appendTrailMesh(trailMeshObj, trail, B, previousMeshedToS, junctions, keepToS);
    }
    ribbonLength = length;
    meshedToS = trail.len;
    builtJunctionCount = junctions.length;
  }
  buildRibbon([], RIBBON_MIN, true);

  let groundBasisS = null;
  // P1 (THE-1320): decor lives in persistent 3 m slots (render/decor-window.js): built once, far ahead,
  // removed only once it can't be on screen. It used to be re-scattered wholesale on every re-centre.
  decorGroup = new THREE.Group(); scene.add(decorGroup);
  const ambient = createAmbient(scene, { tier, seed }); // P6 (THE-1330): falling leaves + birds overhead
  const VISIBLE_M = Math.sqrt(-Math.log(0.04)) / B.fogD; // FogExp2: beyond this < 4 % of an object shows
  const decorWin = createDecorWindow({
    build: (k, sd) => decorSlot(trail, seed, k, sd, tier, propsTemplate ? BUSH_VARIANTS.map((n) => propsTemplate[n]) : null, decorModelsTiered),
    add: (o) => decorGroup.add(o), remove: (o) => decorGroup.remove(o), visibleM: VISIBLE_M,
  });
  function viewAt(s) { // the chase camera's ground position and heading, near enough for the keep/remove test
    const a = trail.at(Math.max(0, s - 4.4)), b = trail.at(Math.min(trail.len, s + 9));
    const dx = b.p.x - a.p.x, dz = b.p.z - a.p.z, l = Math.hypot(dx, dz) || 1;
    return { x: a.p.x, z: a.p.z, fx: dx / l, fz: dz / l };
  }
  function rebuildGroundAndDecor(basisS, capyS = basisS) {
    const centerS = basisS + GROUND_LEAD;
    if (groundMeshObj) { scene.remove(groundMeshObj); groundMeshObj.geometry.dispose(); }
    groundMeshObj = groundMesh(trail, B, centerS); scene.add(groundMeshObj);
    decorWin.update(decorSlotRange(trail, centerS), viewAt(capyS));
    groundBasisS = basisS;
  }
  rebuildGroundAndDecor(0);
  { const sp = sunFollow(trail.at(12).p, (sc.right - sc.left) / sun.shadow.mapSize.x); sun.target.position.set(sp.target.x, sp.target.y, sp.target.z); sun.position.set(sp.position.x, sp.position.y, sp.position.z); }

  // The hero's GLB(s) load async (GLTFLoader has no sync path); the rest of the world renders immediately
  // and renderFrame() below no-ops the hero update until it resolves, so a slow load is a few frames with
  // no hero on screen, not a blocked boot (game.js's boot()/tier() stay synchronous).
  let heroReady = false;
  let lastCamera = null;
  // THE-1391: the Picnic Shield bubble + its pop burst, both parented to the hero object (so they follow
  // lean/jump/duck for free) and sized off the hero's own measured box -- never a bear-only or capy-only
  // bone (spec Part 1's "anchor to the hero interface" rule). Built once the box is available; null until
  // then (heroReady already gates every other hero-dependent render step the same way).
  let shieldBubble = null, shieldBurst = null;
  // THE-1398: the Spring Paws aura, a ground ring under the hero (README "Ring + aura") -- a scene child,
  // not a hero child, so it stays flat on the ground and tracks the hero's x/z each frame without
  // inheriting its lean/jump (unlike the shield bubble, a sphere that doesn't care about tilt).
  let springAura = null;
  // The ride balloon needs the hero's box and the lazily-loaded pu-balloon.glb, which resolve
  // independently -- builds once both are ready. (The timer ring is the existing generic DOM overlay,
  // ui/powerup-ring.js, driven by sim.power.kind/t -- balloon gets it for free, no 3D ring needed.)
  let rideBalloon = null, heroBox = null;
  function tryBuildRideBalloon() {
    if (rideBalloon || !heroBox || !powerupTemplates) return;
    rideBalloon = rideBalloonMesh(powerupTemplates, tier);
    const c = heroBox.getCenter(new THREE.Vector3()), size = heroBox.getSize(new THREE.Vector3());
    // README tie point: box centre x, box.max.y - 0.04, box centre z - 0.25 x box length (the back).
    rideBalloon.position.set(c.x, heroBox.max.y - 0.04, c.z - size.z * 0.25);
    rideBalloon.visible = false;
    hero.object3D.add(rideBalloon);
  }
  hero.build(scene).then(() => {
    if (disposed) return;
    heroReady = true;
    const box = hero.box();
    if (box) {
      heroBox = box;
      shieldBubble = bubble(box, PU.shield);
      shieldBubble.visible = false;
      shieldBubble.userData.baseScale = shieldBubble.scale.clone();
      hero.object3D.add(shieldBubble);
      shieldBurst = shieldPopMesh();
      shieldBurst.position.copy(box.getCenter(new THREE.Vector3()));
      shieldBurst.visible = false;
      hero.object3D.add(shieldBurst);
      springAura = aura(box, PU.spring);
      springAura.visible = false;
      scene.add(springAura);
      tryBuildRideBalloon();
    }
  });

  // Pools: a handful of each prop kind, repositioned/hidden per frame from the sim's nearby lists --
  // keeps draw calls bounded regardless of how much content the generator queues up (budget: design ->
  // "Generator, solver and performance").
  function makePool(builder, count) { const arr = []; for (let i = 0; i < count; i++) { const m = builder(); m.visible = false; scene.add(m); arr.push(m); } return arr; }
  // THE-1284: logs (variant-picked from props.glb) and birds (cloned from bird.glb, each with its own
  // mixer) can't be pre-built at world-creation time the way the old procedural meshes were -- the asset
  // hasn't loaded yet, and a log's own look depends on which hazard it's currently showing (pickVariant
  // keyed by the hazard's own id, so the same hazard always looks the same across pool-slot reuse, see
  // render/props.js). Both are keyed pools (like blockerPool/mossPool below), keyed by the hazard's id.
  //
  // THE-1285 (CTO, R3 review): an item keeps its slot until it leaves the list (slots used to follow list
  // position, so every slot rebuilt -- a bird re-cloned its GLB and mixer -- whenever the front item left).
  // `dispose` is for procedural one-off builds only (blockers, moss): their geometry *and* materials are
  // theirs alone. Cloned glTF objects share the template's geometry/material, so they're never disposed.
  function makeKeyedPool(count) { const arr = []; for (let i = 0; i < count; i++) arr.push({ obj: null, key: null }); return arr; }
  function releaseSlot(slot, dispose) {
    scene.remove(slot.obj);
    if (dispose) slot.obj.traverse((m) => { m.geometry?.dispose(); m.material?.dispose(); });
    slot.obj = null; slot.key = null;
  }
  // Returns [{ slot, item }] for the first `slots.length` items, building an object only for a newly seen key.
  function syncKeyedPool(slots, items, keyOf, build, dispose = false) {
    const wanted = new Map();
    for (const item of items) { if (wanted.size === slots.length) break; wanted.set(keyOf(item), item); }
    for (const slot of slots) if (slot.obj && !wanted.has(slot.key)) releaseSlot(slot, dispose);
    const out = [];
    for (const [key, item] of wanted) {
      let slot = slots.find((s) => s.key === key);
      if (!slot) { slot = slots.find((s) => s.key === null); slot.key = key; slot.obj = build(item, slots.indexOf(slot)); scene.add(slot.obj); }
      slot.obj.visible = true;
      out.push({ slot, item });
    }
    return out;
  }
  const blockPool = makeKeyedPool(10);
  const logPool = makeKeyedPool(10);
  const birdPool = makeKeyedPool(10);
  const eitherPool = makeKeyedPool(10); // A12.1 (THE-1297): log on stumps
  const branchPool = makeKeyedPool(4); // A12.1/C2: merged 2-3 lane branch bar + leaf curtain (single-cell high stays a bird)
  const coinPool = makePool(() => coinMesh(), 90); // P2 arcs are 7-13 coins (was 6)
  const signPool = makePool(() => signpost(), 6);
  const popPool = makePool(() => coinPopMesh(), 8);
  const nearMissPopPool = makePool(() => nearMissPopMesh(), 4);
  const stubPool = makePool(() => forkStub(STUB_LENGTH, B, seed), 6); // CTO item 1: the fork's dead-end stub
  const pickupPool = makePool(() => honeyJarMesh(), 3); // spec Part 1: at most 1 per 500 m, a handful in view at once is plenty
  // THE-1391: the shield pickup is the real pu-shield.glb (THE-1388), not a procedural look.js mesh --
  // slots start as empty groups and get the real (shared-geometry/material) mesh appended once the GLB
  // resolves, same "a few frames with nothing to show" gap as every other lazy GLB load in this module.
  const shieldPickupPool = makePool(() => new THREE.Group(), 3);
  // THE-1394: same lazy-GLB pool pattern for the balloon pickup.
  const balloonPickupPool = makePool(() => new THREE.Group(), 3);
  // THE-1398: same lazy-GLB pool pattern for the Spring Paws pickup.
  const springPickupPool = makePool(() => new THREE.Group(), 3);
  const mysteryPickupPool = makePool(() => new THREE.Group(), 3); // the open one is a separate mesh, below
  let mysteryOpenMesh = null, mysteryOpenLid = null;
  let powerupTemplates = null;
  loadPowerupTemplates().then((t) => {
    if (disposed) return;
    powerupTemplates = t;
    for (const slot of shieldPickupPool) slot.add(shieldPickupMesh(t));
    for (const slot of balloonPickupPool) slot.add(balloonPickupMesh(t));
    for (const slot of springPickupPool) slot.add(springPickupMesh(t));
    for (const slot of mysteryPickupPool) slot.add(mysteryPickupMesh(t));
    mysteryOpenMesh = mysteryPickupMesh(t);
    mysteryOpenLid = mysteryLid(mysteryOpenMesh);
    mysteryOpenMesh.visible = false;
    scene.add(mysteryOpenMesh);
    tryBuildRideBalloon();
  });
  // THE-1412: one finish arch, placed at the active level's finishS (null in Endless) -- one draw call,
  // safe on Low (levels/README.md). Same lazy-group-then-fill pattern as the pickup pools above.
  const finishArchGroup = new THREE.Group();
  finishArchGroup.visible = false;
  scene.add(finishArchGroup);
  loadFinishTemplate().then((g) => { if (disposed) return; finishArchGroup.add(finishArchMesh(g)); });

  // A12.2 (THE-1299): a filler (trunk or boulder line) spans a whole piece (15-50 m) -- too variable to
  // pre-build like the fixed-length pools above. Built once per filler (keyed by the filler record itself;
  // patterns.js never recreates one) through syncKeyedPool above, and disposed when the filler leaves.
  const fillerPool = makeKeyedPool(6); // up to 2 lanes closed at once (shape A), each up to 2 pieces (A12.2's >50 m split)

  // Coin-pop tracking (spec §7 juice): reads new "coin" log entries, not sim state writes (render never
  // writes sim state). Coin ids reset per run (patterns.js's own counter starts at 0 each createPatterns
  // call), so re-seeing a low id after a restart must NOT be treated as "already popped" -- detected via
  // a backward jump in state.s, the simplest reliable "a new run started" signal available here.
  const seenCoinIds = new Set();
  let activePops = [];
  let activeNearMissPops = []; // spec §2 near-miss juice: a separate pop list from coins, own pool/duration
  let lastS = 0;
  // Camera shake (spec §7: crash 0.35 s/0.12 m, stumble 0.15 s/0.05 m, landing 0.03 m), driven the same
  // way: hit/stumble/land have no unique id like a coin, so new entries are found by sim time instead
  // (log entries are monotonic in `t` within a run; `lastLogT` resets alongside the coin tracking above).
  let lastLogT = -1;
  let shieldPopT = null; // THE-1391: seconds since the last "shieldPop" log entry; null = no pop playing
  let balloonPopT = null; // seconds since pickup, drives the 0.3 s pop-in; null once past it
  let mysteryOpenT = null, mysteryOpenPos = null, mysteryPrizePlayed = false; // null = no box open
  let shake = { t: 0, dur: 0, amp: 0 };
  function triggerShake(amp, dur) { shake = { t: 0, dur, amp }; }

  // CTO D1 fix (THE-1259 S3, THE-1272): the deadpan glance. A render-layer seed (not the sim's) so the
  // glance cadence doesn't perturb sim determinism/replays.
  const glanceState = createGlanceState(seed + 1);
  glanceState._cancelFromP = 0; // progress to ease out from if input cancels mid-glance (render-local, not part of glance.js's own pure state)

  // Crash-gag crash visual (CTO item 2, THE-1259 2026-11-05 22:43Z: "trip-and-tumble, with the orange
  // topper bouncing off"): the capy hero's own topper-bounce effect, behind hero.crashVisual so this
  // module doesn't need to know a bear has no topper (hero.crashVisual is a no-op for it).

  // CTO item 1 (THE-1259, 2026-11-05 22:43Z): "when [a corner's] missed, the capy runs straight on into
  // the dead end; it doesn't follow the bend." sim.s freezes the instant a post-grace miss crashes the
  // run (game.js stops stepping once sim.crashed), so this can't be driven by a live sim distance -- it's
  // cosmetic motion during the crash gag, same idea as the topper bounce-off. Only the full crash
  // ("hit", cause "corner") gets the overrun; a grace-period miss ("stumble") auto-corrects per spec §2,
  // so the capy stays on the branch there.
  let cornerOverrun = null;

  let laneDrawn = 0, laneEasing = false; // render-only smoothing of sim lane snaps (see laneSim below)
  // P4: render-only sound state: the coin streak pitch and the footstep cadence
  let coinStep = 0, lastCoinT = -10, stepDist = 0;
  const STEP_EVERY = 2.6; // metres per footfall pair: about one gallop cycle at 8 m/s, quicker as it speeds up
  let prevChaserMode = "close"; // matches the sim's own construction-time default (A12.4 run-start)
  // A12.4: "a honk on the stumble, then one every 1.2 s" while a strike is active. Audio-only cadence, so a
  // render-local timer is fine (it never feeds back into the sim).
  let lastRunKey;
  let sheepClockT = 0; // THE-1355: the A14 sheep's graze clip (render/decor-models.js), High/Mid only
  function renderFrame(state, dt, soundOff = false, { introK = 1, swayT = null, runKey, chaserVoice = true } = {}) {
    // CTO fix P1 (THE-1259 S2 review r4): a new run creates a brand-new sim with its own seed (game.js's
    // newRun()), so state.junctions is a different list than whatever trailMeshObj was last built/appended
    // from -- this check has to run *before* buildRibbon can decide to append, or appendTrailMesh would
    // splice new-run ring geometry onto an old-run ribbon prefix built from a different curve entirely.
    // a new run: s jumped back, or a different seed is being drawn (e.g. a new title seed at s = 0)
    const isNewRun = state.s < lastS - 10 || (runKey !== undefined && lastRunKey !== undefined && runKey !== lastRunKey);
    if (runKey !== undefined) lastRunKey = runKey;
    if (isNewRun) { seenCoinIds.clear(); activePops = []; activeNearMissPops = []; lastLogT = -1; shieldPopT = null; balloonPopT = null; mysteryOpenT = null; hero.crashVisual.reset(); cornerOverrun = null; decorWin.clear(); ambient.reset(); groundBasisS = null; coinStep = 0; lastCoinT = -10; stepDist = 0; hero.chaser.reset(); }
    const dsFrame = isNewRun ? 0 : Math.max(0, state.s - lastS);
    lastS = state.s;
    const resyncS = isNewRun ? null : ribbonResyncS(state.junctions, builtJunctionCount, meshedToS);
    if (resyncS !== null) buildRibbon(state.junctions, ribbonLength, false, resyncS);
    const lenBefore = trail.len;
    if (isNewRun || state.s + RIBBON_MARGIN > ribbonLength) buildRibbon(state.junctions, isNewRun ? RIBBON_MIN : ribbonLength + RIBBON_GROW, isNewRun);
    if (!isNewRun && trail.len !== lenBefore) decorWin.dropFrom(Math.floor((lenBefore - 30) / DECOR_STEP));
    const newGroundBasis = nextGroundBasis(state.s, groundBasisS);
    if (resyncS !== null) decorWin.dropFrom(Math.floor(resyncS / DECOR_STEP)); // slots past the new bend stood on the old curve
    if (newGroundBasis !== null) rebuildGroundAndDecor(newGroundBasis, state.s);
    else if (resyncS !== null) rebuildGroundAndDecor(groundBasisS, state.s); // re-flatten the ground along the new bend

    // THE-1355: every sheep tagged by decorSlot() (High/Mid tier only -- decorModelsForTier's `animate`)
    // samples the graze clip at its own time offset, so a flock doesn't graze in lockstep.
    sheepClockT += dt;
    if (decorModelsTiered?.sheepAnimate) {
      for (const o of decorGroup.children) {
        if (!o.userData.sheepAnim) continue;
        const w = decorModelsTiered.sheepAnimate(sheepClockT + o.userData.sheepOffset);
        o.morphTargetInfluences[0] = w[0]; o.morphTargetInfluences[1] = w[1];
      }
    }

    const newEntries = state.log.filter((e) => e.t > lastLogT);
    if (state.log.length) lastLogT = state.log[state.log.length - 1].t;
    let nearMissJustNow = false, inputJustPressed = false;
    for (const entry of newEntries) {
      if (entry.type === "coin" && !seenCoinIds.has(entry.id)) {
        seenCoinIds.add(entry.id);
        // P4: a coin "ding" a semitone higher for each coin taken within 0.6 s of the last (a streak sings)
        coinStep = entry.t - lastCoinT <= 0.6 ? Math.min(7, coinStep + 1) : 0; lastCoinT = entry.t;
        playCoin(coinStep);
        const c = state.coinsList.find((cc) => cc.id === entry.id);
        if (c) activePops.push({ s: c.s, lane: c.lane, y: c.y, t: 0, flyToCapy: !!entry.flyToCapy });
      } else if (entry.type === "pickup") {
        // Honey, shield and balloon have their own recipes; a future kind without one falls back to the
        // coin-chime stand-in. Balloon's lift-off sound plays alongside its pickup squeak -- no separate
        // "lift-off" log event, since the flight starts the instant it's picked up.
        if (entry.kind === "honey") play("honeyPickup", { gain: 0.7 });
        else if (entry.kind === "shield") play("shieldUp", { gain: 0.7 });
        else if (entry.kind === "balloon") { play("balloonPickup", { gain: 0.7 }); play("balloonFloat", { gain: 0.55 }); balloonPopT = 0; }
        else if (entry.kind === "spring") play("springPickup", { gain: 0.7 });
        else if (entry.kind === "mystery") {
          play("mysteryOpen", { gain: 0.7 });
          mysteryOpenT = 0; mysteryPrizePlayed = false;
          const p = state.pickupsList.find((pp) => pp.id === entry.id);
          mysteryOpenPos = p ? { s: p.s, lane: p.lane } : null;
          if (p && entry.prize?.coins !== undefined) {
            for (let i = -1; i <= 1; i++) activePops.push({ s: p.s + i * 0.3, lane: p.lane, t: 0, flyToCapy: false });
          }
        }
        else playCoin(0);
      } else if (entry.type === "shieldPop") {
        // THE-1391: the bubble's own 0.12 s pop-out plus a ring+spark burst at the hero, on an absorbed
        // hit or a plain 20 s timeout alike (README "Pop (the absorbed hit, or the 20 s timeout)").
        shieldPopT = 0;
        play("shieldPop", { gain: 0.8 });
      } else if (entry.type === "balloonDescend") {
        play("balloonDescend", { gain: 0.5 }); // the sim's own float-to-descend phase edge
      } else if (entry.type === "hit") {
        triggerShake(0.12, 0.35); hero.crashVisual.start(scene); play("crash"); // P4
        if (entry.cause === "corner") {
          const missed = state.junctions.filter((j) => j.resolved === "missed" && Math.abs(j.s - state.s) < 20);
          if (missed.length) {
            const j = missed.reduce((a, b) => (Math.abs(a.s - state.s) < Math.abs(b.s - state.s) ? a : b));
            cornerOverrun = { junctionS: j.s, t: 0 };
          }
        }
        // A12.4: "they pounce ... a honk chorus" -- the caught cause is the one crash that plays the
        // chaser's own pounce/catch effect (geese pounce + honk chorus, or the bees' catch sting).
        if (entry.cause === "caught") hero.chaser.onCatch(soundOff);
      } else if (entry.type === "stumble") {
        // A12.5: "a 0.12 s camera nudge (off under reduce motion), a woody thunk plus a capy hrmf"
        triggerShake(0.05, 0.12); stumbleThunk(soundOff);
        // A12.4: "a honk on the stumble" -- only a real (post-grace) strike, not every grace-period
        // stumble, engages the chaser (sim.js only arms a strike outside grace -- see its _stumble header).
        if (!state.grace) hero.chaser.onStumbleArrival(soundOff);
      }
      else if (entry.type === "land") { triggerShake(0.03, 0.1); play("land", { gain: 0.6 }); }
      else if (entry.type === "nearMiss") {
        nearMissJustNow = true;
        const h = state.hazards.find((hh) => hh.id === entry.id);
        if (h) activeNearMissPops.push({ s: h.s, lane: h.lane, t: 0 });
      } else if (entry.type === "jump" || entry.type === "duck" || entry.type === "lane" || entry.type === "turn") {
        inputJustPressed = true;
        // P4: jump whoosh, duck swish, a lighter swish for a lane step or a turn (A14/THE-1351: its own
        // "lane" buffer, not duck resampled -- that pushed the hiss to ~8 kHz). THE-1398: springBoing
        // replaces jump on take-off while Spring Paws is active (README "3. Spring Paws").
        if (entry.type === "jump") play(entry.spring ? "springBoing" : "jump", entry.spring ? { gain: 0.6 } : undefined);
        else if (entry.type === "duck") play("duck"); else play("lane", { gain: 0.4 });
      }
    }
    // A12.4: "close -> far in 1.5 s with a deflated honk" -- a mode change, not a log entry, so it's
    // detected the same way the ribbon/ground rebuild triggers above are (comparing this frame to the last).
    if (prevChaserMode === "close" && state.chaser.mode === "far") hero.chaser.onModeCloseToFar(soundOff);
    prevChaserMode = state.chaser.mode;
    if (introK >= 1 && !state.crashed && !state.airborne) {
      stepDist += dsFrame;
      if (stepDist >= STEP_EVERY) { stepDist -= STEP_EVERY; play("step", { gain: 0.22, rate: 0.9 + 0.2 * ((state.s * 7.31) % 1) }); }
    }
    // B13 (CTO ruling THE-1260 2026-11-06 05:25Z): the real 40 ms freeze now lives in game.js, which holds
    // the previous frame entirely (skips calling renderFrame) rather than shrinking dt here -- the capy and
    // camera are positioned straight off state.s every frame, so a dt shrink scoped to this module never
    // actually stopped them moving. This module still only handles the "close!" pop/glance cue below.
    if (cornerOverrun) cornerOverrun.t = Math.min(cornerOverrun.t + dt, CORNER_OVERRUN_TIME);
    activePops = activePops.filter((p) => (p.t += dt) < (p.flyToCapy ? HONEY_FLY_DURATION : COIN_POP_DURATION));
    activeNearMissPops = activeNearMissPops.filter((p) => (p.t += dt) < NEAR_MISS_POP_DURATION);
    if (shieldPopT !== null) { shieldPopT += dt; if (shieldPopT >= Math.max(SHIELD_BUBBLE_POP_T, SHIELD_BURST_DURATION)) shieldPopT = null; }
    if (balloonPopT !== null) { balloonPopT += dt; if (balloonPopT >= BALLOON_POP_IN_T) balloonPopT = null; }
    if (mysteryOpenT !== null) {
      mysteryOpenT += dt;
      if (!mysteryPrizePlayed && mysteryOpenT >= MYSTERY_PRIZE_SOUND_AT) { play("mysteryPrize", { gain: 0.65 }); mysteryPrizePlayed = true; }
      if (mysteryOpenT >= MYSTERY_HIDE_AT) mysteryOpenT = null;
    }
    hero.crashVisual.step(dt);

    const reduceMotion = window.UIKit?.reduceMotion?.() ?? false;

    // CTO fix C1 (THE-1259 S2 review r4, 2026-11-06 01:18Z): "the capy disappears during the crash gag."
    // During a cornerOverrun the capy runs straight down the dead-end stub, off the curved main trail --
    // set below whenever that's the camera's own source of truth, so chaseCam can follow the capy instead
    // of looking down a curve the capy has already left. null otherwise (chaseCam samples trail.at(state.s)
    // as usual, same as every other crash).
    let cameraFollow = null;
    // Hoisted above the `if (heroReady)` gate: the chaser (below) needs it too, and they must keep
    // tracking the hero's own lane even during the few frames before its GLB resolves (THE-1284's own
    // load-gap note).
    const laneSim = state.lane + (state.stepLane !== null ? (state.stepLane - state.lane) * state.stepT : 0);
    // A12.5 bounce-back / late-dodge resolves the lane instantly in sim (up to half a lane in one frame).
    // A normal step moves ~0.11 lanes per frame, so a bigger jump is a snap: ease it out over ~0.1 s.
    if (isNewRun || Math.abs(laneSim - laneDrawn) < 0.02) laneEasing = false;
    else if (Math.abs(laneSim - laneDrawn) > 0.25) laneEasing = true;
    laneDrawn = laneEasing ? laneDrawn + (laneSim - laneDrawn) * Math.min(1, dt * 25) : laneSim;
    const laneNow = laneDrawn;
    if (heroReady) {
      const heroObj = hero.object3D;
      hero.pose(state, dt, introK); // P3: the hero idles through the intro reveal
      hero.lean(capyLeanAngle(state, reduceMotion));
      placeAt(heroObj, trail, state.s, laneNow);
      if (cornerOverrun) {
        const overrunPos = missedCornerPosition(trail, cornerOverrun.junctionS, cornerOverrun.t / CORNER_OVERRUN_TIME);
        const { dir } = stubDirection(trail, cornerOverrun.junctionS);
        heroObj.position.x = overrunPos.x; heroObj.position.z = overrunPos.z;
        heroObj.rotation.y = Math.atan2(dir.x, dir.z) || heroObj.rotation.y;
        cameraFollow = { x: overrunPos.x, z: overrunPos.z, dirX: dir.x, dirZ: dir.z };
      }
      heroObj.position.y += state.y + hero.liftY();

      // THE-1391: the Picnic Shield bubble -- on while the shield is active, wobbling at 2 Hz and
      // blinking in its last 3 s, then a quick 0.12 s pop-out (scale up, fade) once "shieldPop" fires
      // (absorbed hit or a plain 20 s timeout alike). Both the bubble and its burst are children of
      // heroObj, so no extra positioning is needed here beyond their own one-time local offsets.
      if (shieldBubble) {
        if (shieldPopT !== null) {
          const u = Math.min(shieldPopT / SHIELD_BUBBLE_POP_T, 1);
          shieldBubble.visible = u < 1;
          shieldBubble.scale.copy(shieldBubble.userData.baseScale).multiplyScalar(1 + 0.25 * u);
          shieldBubble.material.uniforms.uAlpha.value = 1 - u;
        } else {
          const on = state.power.kind === "shield" && state.power.t > 0;
          shieldBubble.visible = on;
          if (on) {
            const wobble = 1 + 0.03 * Math.sin(state.t * SHIELD_WOBBLE_HZ * Math.PI * 2);
            shieldBubble.scale.copy(shieldBubble.userData.baseScale).multiplyScalar(wobble);
            const blink = state.power.t <= SHIELD_BLINK_LEAD_S
              ? SHIELD_BLINK_FLOOR + (1 - SHIELD_BLINK_FLOOR) * (0.5 + 0.5 * Math.sin(state.t * SHIELD_BLINK_HZ * Math.PI * 2))
              : 1;
            shieldBubble.material.uniforms.uAlpha.value = blink;
          }
        }
      }
      if (shieldBurst) {
        const active = shieldPopT !== null;
        shieldBurst.visible = active;
        if (active) {
          const u = shieldPopT / SHIELD_BURST_DURATION; // spec §7's "1 -> 1.4 -> 0" pop family
          const scale = u < 0.5 ? 1 + 0.8 * (u / 0.5) : Math.max(0, 1.4 * (1 - (u - 0.5) / 0.5));
          shieldBurst.scale.setScalar(Math.max(scale, 0.001));
        }
      }

      // The ride balloon: on the hero's back for the whole active window (including landing protection,
      // not yet "put away"), a 0.3 s spring pop-in on pickup, and a gentle sway while flying.
      if (rideBalloon) {
        const on = state.power.kind === "balloon" && state.power.t > 0;
        rideBalloon.visible = on;
        if (on) {
          // 0 -> 1.1 -> 1 over 0.3 s, same two-segment linear pop family as activePops' own 1 -> 1.4 -> 0.
          const u = balloonPopT === null ? 1 : balloonPopT / BALLOON_POP_IN_T;
          const scale = u < 0.5 ? 1.1 * (u / 0.5) : 1.1 - (u - 0.5) / 0.5 * 0.1;
          rideBalloon.scale.setScalar(Math.max(scale, 0.001));
          rideBalloon.rotation.z = Math.sin(state.t * BALLOON_SWAY_HZ * Math.PI * 2) * BALLOON_SWAY_AMP;
        }
      }

      // THE-1398: the Spring Paws aura, on while it's active, following the hero's x/z (not its lean/jump
      // -- a flat ground ring), opacity pulsing 0.4 -> 0.6 at 2 Hz (README "Ring + aura").
      if (springAura) {
        const on = state.power.kind === "spring" && state.power.t > 0;
        springAura.visible = on;
        if (on) {
          springAura.position.set(heroObj.position.x, 0.15, heroObj.position.z);
          springAura.material.opacity = 0.5 + 0.1 * Math.sin(state.t * SPRING_AURA_HZ * Math.PI * 2);
        }
      }

      // CTO D1 fix (THE-1259 S3, THE-1272): the deadpan glance -- the nearest upcoming hazard or junction
      // sets the suppression lead time (spec: skip if under 1.2 s ahead so it never looks away during a
      // read); nearMissJustNow/inputJustPressed come from this frame's new log entries, computed above.
      let nextAheadT = Infinity;
      for (const h of state.hazards) if (h.s >= state.s) nextAheadT = Math.min(nextAheadT, (h.s - state.s) / Math.max(state.v, 1));
      for (const j of state.junctions) if (!j.resolved && j.s >= state.s) nextAheadT = Math.min(nextAheadT, (j.s - state.s) / Math.max(state.v, 1));
      const glance = updateGlance(glanceState, { t: state.t, dt, pose: state.pose, nearMissJustNow, nextHazardOrJunctionT: nextAheadT, inputJustPressed });
      const GLANCE_ANGLE = 0.96; // 55 deg (THE-1272)
      let p = 0; // 0..1 progress toward GLANCE_ANGLE within the current phase
      if (glance.phase === "easeIn") p = easeOutCubic(Math.min(glance.phaseT / EASE_IN_T, 1));
      else if (glance.phase === "hold") p = 1;
      else if (glance.phase === "easeOut") p = 1 - Math.min(glance.phaseT / EASE_OUT_T, 1);
      else if (glance.phase === "cancelling") p = Math.max(0, 1 - glance.phaseT / CANCEL_EASE_OUT_T) * glanceState._cancelFromP;
      if (glance.phase !== "cancelling") glanceState._cancelFromP = p; // remember where to ease out from if input cancels mid-glance
      hero.setGlanceYaw(GLANCE_ANGLE * p);
    }

    // THE-1373: the chaser (geese or bees), behind the hero at state.chaser.dist (9.0 m far, off screen
    // behind the camera at its own 4.4 m back -- spec's own "behind the camera" note). Once caught it
    // converges onto the hero's back while its own catch effect plays. Fully owned by render/hero.js now
    // (placement, the pile/wrap convergence, the chaser's own sound-cadence timer) -- this module only
    // feeds it the trail/state/lane/dt every frame.
    hero.chaser.update(trail, state, laneNow, dt, { heroObj: hero.object3D, soundOff, voice: chaserVoice });

    // CTO fix F2 (THE-1259): keep a hit hazard visible through the crash gag (D1-2) instead of filtering
    // it out the instant it's hit -- the capy should be seen slamming into it, not have it vanish.
    // P1 (THE-1320): a block is a 2.4-2.6 m snag, variant keyed by hazard id like the logs.
    {
      const list = obstacleTemplates ? state.hazards.filter((h) => h.kind === "block") : [];
      for (const { slot, item: h } of syncKeyedPool(blockPool, list, (h) => h.id, (h) => snagMesh(obstacleTemplates, pickVariant(SNAG_VARIANTS, seed, h.id)))) {
        placeAt(slot.obj, trail, h.s, h.lane, "block");
      }
    }
    // THE-1284: logs (variant-picked from props.glb, keyed by hazard id so the same log always looks the
    // same) -- hidden until propsTemplate loads (a few frames at boot, same as the capy's own gap above).
    // A12.1/C2 (THE-1297): a 2-3 lane run of `low` cells merges into one wide log (mergedLowLog scales the
    // single representative hazard's own mesh) instead of 2-3 stacked single-lane ones -- every lane still
    // gets its own hazard record for sim hit-testing (chunk-placer.js's rowHazards), only the extra copies'
    // render are skipped here (`hiddenForMerge`).
    {
      const list = propsTemplate ? state.hazards.filter((h) => h.kind === "low" && !h.hiddenForMerge) : [];
      for (const { slot, item: h } of syncKeyedPool(logPool, list, (h) => h.id, (h) => {
        const mesh = propMesh(propsTemplate, pickVariant(LOG_VARIANTS, seed, h.id));
        return h.mergeWidth > 1 ? mergedLowLog(mesh, h.mergeWidth) : mesh;
      })) {
        placeAt(slot.obj, trail, h.s, h.mergeCenterLane, "low");
      }
    }
    // A12.1/C2: "either" (a log on stumps) -- always a single lane (A12.1's hit box table), built from the
    // same log mesh plus 2 procedural stumps (render/look.js's logOnStumps).
    {
      const list = propsTemplate ? state.hazards.filter((h) => h.kind === "either") : [];
      for (const { slot, item: h } of syncKeyedPool(eitherPool, list, (h) => h.id, (h) => logOnStumps(propMesh(propsTemplate, pickVariant(LOG_VARIANTS, seed, h.id))))) {
        placeAt(slot.obj, trail, h.s, h.lane, "either");
      }
    }
    // THE-1284: birds -- loops the "flap" clip on each instance's own mixer, plus a visual-only swoop/bob
    // on top of placeAt()'s own fixed HOVER_Y.high (birdVisualOffsetY's doc comment: the sim's hit height
    // never moves, only this additive render-layer offset does). A12.1/C2: a 2-3 lane run of `high` cells
    // is a branch bar + leaf curtain instead (the R3 low bird stays for an isolated single-lane `high`).
    {
      const list = birdTemplate ? state.hazards.filter((h) => h.kind === "high" && h.mergeWidth === 1) : [];
      for (const { slot, item: h } of syncKeyedPool(birdPool, list, (h) => h.id, (h, i) => spawnBird(birdTemplate, i * 0.13))) {
        placeAt(slot.obj, trail, h.s, h.lane, "high");
        slot.obj.position.y += birdVisualOffsetY(h.s - state.s - state.v * BIRD_SETTLE_TTC, state.t, birdPool.indexOf(slot));
        updateBird(slot.obj, dt);
      }
    }
    {
      // P1 (THE-1320): the 2-3 lane duck obstacle is a trunk on two rocks with a tunnel under it (was the
      // branch bar + leaf curtain, which read as a bush)
      const list = obstacleTemplates ? state.hazards.filter((h) => h.kind === "high" && h.mergeWidth > 1 && !h.hiddenForMerge) : [];
      for (const { slot, item: h } of syncKeyedPool(branchPool, list, (h) => h.id, (h) => duckMesh(obstacleTemplates, h.mergeWidth))) {
        placeAt(slot.obj, trail, h.s, h.mergeCenterLane, "branch");
      }
    }
    {
      // A12.2 (THE-1299): a filler (giant trunk or boulder line, patterns.closures) -- the front face
      // itself (the root plate disc / tallest boulder module) is the warning now, drawn from well past the
      // A12.3 draw-distance floor, with no chevron/moss cue needed (A11.1 deleted).
      const list = fillerTemplates ? state.closures : [];
      const spanOf = (c) => Math.max(0.5, c.sEnd - c.sStart);
      // dispose=false (unlike the old procedural blocker pool): fillerGroup's pieces clone the shared
      // trunk/boulder GLB template nodes (render/props.js's own reasoning for logs/birds/branches) --
      // disposing a clone's geometry/material would destroy the template every other instance still uses.
      // THE-1350: placeFillerGroup places each module at its own point on the lane (not one placeAt() on
      // the whole group at sStart) so a long filler follows a bend instead of cutting across it.
      for (const { slot, item: c } of syncKeyedPool(fillerPool, list, (c) => c, (c) => fillerGroup(fillerTemplates, c.kind, spanOf(c)))) {
        placeFillerGroup(slot.obj, trail, c.sStart, c.lane);
      }
    }
    {
      const list = state.coinsList.filter((c) => !c.taken && !c.passed && c.s > state.s - 3); // missed coins behind never starve the pool
      const springOn = !!state.arcSpring; // THE-1398: arcs ahead follow the bigger curve (sim's _arcSpring)
      for (let i = 0; i < coinPool.length; i++) {
        const c = list[i];
        if (!c) { coinPool[i].visible = false; continue; }
        coinPool[i].visible = true; placeAt(coinPool[i], trail, c.s, c.lane, "coin"); coinPool[i].rotation.y += dt * 2;
        if (c.y !== undefined) coinPool[i].position.y = arcHeightNow(c, springOn); // P2: an arc coin sits on the real jump curve
      }
    }
    {
      // spec Part 1: pickupsList is windowed the same way as hazards/coinsList (sim.js's `near` filter);
      // only the un-taken honey jars render here -- shield pickups (THE-1391) are their own pool below.
      const list = state.pickupsList.filter((p) => !p.taken && p.kind === "honey");
      for (let i = 0; i < pickupPool.length; i++) {
        const p = list[i];
        if (!p) { pickupPool[i].visible = false; continue; }
        pickupPool[i].visible = true; placeAt(pickupPool[i], trail, p.s, p.lane, "coin");
        pickupPool[i].rotation.y += dt * 1.5;
        pickupPool[i].position.y += Math.sin(state.t * 3 + p.s) * 0.08; // a gentle bob, distinct from the coin's own rotate-in-place
      }
    }
    {
      // THE-1391 (design/capy-trail/powerups/README.md "Pickups (all four)"): "put it at y = 0.7 in its
      // lane, and spin + bob it exactly like magnetMesh()" -- same motion as the honey jar above, just its
      // own y (not placeAt's "coin" 0.5 m hover) and gated on the lazy pu-shield.glb load having resolved.
      const list = powerupTemplates ? state.pickupsList.filter((p) => !p.taken && p.kind === "shield") : [];
      for (let i = 0; i < shieldPickupPool.length; i++) {
        const p = list[i];
        if (!p) { shieldPickupPool[i].visible = false; continue; }
        shieldPickupPool[i].visible = true; placeAt(shieldPickupPool[i], trail, p.s, p.lane);
        shieldPickupPool[i].rotation.y += dt * 1.5;
        shieldPickupPool[i].position.y = 0.7 + Math.sin(state.t * 3 + p.s) * 0.08;
      }
    }
    {
      // THE-1394: the balloon pickup, same pool/motion pattern as the shield pickup just above.
      const list = powerupTemplates ? state.pickupsList.filter((p) => !p.taken && p.kind === "balloon") : [];
      for (let i = 0; i < balloonPickupPool.length; i++) {
        const p = list[i];
        if (!p) { balloonPickupPool[i].visible = false; continue; }
        balloonPickupPool[i].visible = true; placeAt(balloonPickupPool[i], trail, p.s, p.lane);
        balloonPickupPool[i].rotation.y += dt * 1.5;
        balloonPickupPool[i].position.y = 0.7 + Math.sin(state.t * 3 + p.s) * 0.08;
      }
    }
    {
      // THE-1398: the Spring Paws pickup, same pool/motion pattern as the shield/balloon pickups above.
      const list = powerupTemplates ? state.pickupsList.filter((p) => !p.taken && p.kind === "spring") : [];
      for (let i = 0; i < springPickupPool.length; i++) {
        const p = list[i];
        if (!p) { springPickupPool[i].visible = false; continue; }
        springPickupPool[i].visible = true; placeAt(springPickupPool[i], trail, p.s, p.lane);
        springPickupPool[i].rotation.y += dt * 1.5;
        springPickupPool[i].position.y = 0.7 + Math.sin(state.t * 3 + p.s) * 0.08;
      }
    }
    {
      const list = powerupTemplates ? state.pickupsList.filter((p) => !p.taken && p.kind === "mystery") : [];
      for (let i = 0; i < mysteryPickupPool.length; i++) {
        const p = list[i];
        if (!p) { mysteryPickupPool[i].visible = false; continue; }
        mysteryPickupPool[i].visible = true; placeAt(mysteryPickupPool[i], trail, p.s, p.lane);
        mysteryPickupPool[i].rotation.y += dt * 1.5;
        mysteryPickupPool[i].position.y = 0.7 + Math.sin(state.t * 3 + p.s) * 0.08;
      }
      if (mysteryOpenMesh) {
        mysteryOpenMesh.visible = mysteryOpenT !== null && !!mysteryOpenPos;
        if (mysteryOpenMesh.visible) {
          placeAt(mysteryOpenMesh, trail, mysteryOpenPos.s, mysteryOpenPos.lane);
          mysteryOpenMesh.position.y = 0.7;
          if (mysteryOpenLid) mysteryOpenLid.rotation.x = MYSTERY_LID_ANGLE * easeOutCubic(Math.min(mysteryOpenT / MYSTERY_LID_OPEN_T, 1));
        }
      }
    }
    {
      // THE-1412: trail-tangent placement at ground level, same as every other prop (placeAt's default
      // "ground" kind) -- levels.js's level-check rule keeps the finish on a straight, clear of a corner.
      finishArchGroup.visible = !!state.level;
      if (state.level) placeAt(finishArchGroup, trail, state.level.finishS, 0);
    }
    {
      const upcoming = state.junctions.filter((j) => !j.resolved && j.s > state.s - 5);
      for (let i = 0; i < signPool.length; i++) {
        const j = upcoming[i];
        if (!j) { signPool[i].visible = false; continue; }
        signPool[i].visible = true; placeAt(signPool[i], trail, j.s, j.dir === "L" ? -1.6 : 1.6);
        // CTO fix J1 (THE-1259 S2 review r4, 2026-11-06 01:18Z): signpost() builds a canonical "turn
        // right" shape (arrow tip at local +X); verified against the actual drawn branch direction that
        // scale.x=-1 (not +1) is the flip that makes the arrow point where an "L" branch really goes.
        signPool[i].scale.x = j.dir === "L" ? 1 : -1;
      }
    }
    {
      // CTO item 1: every junction is a fork with a visible dead-end stub, not just the ones the player
      // happens to miss -- it has to read as a fork *before* the corner, not only after a crash.
      const nearby = state.junctions.filter((j) => j.s > state.s - 20 && j.s < state.s + 150);
      for (let i = 0; i < stubPool.length; i++) {
        const j = nearby[i];
        if (!j) { stubPool[i].visible = false; continue; }
        const { origin, dir } = stubDirection(trail, j.s);
        stubPool[i].visible = true;
        stubPool[i].position.set(origin.x, 0, origin.z);
        stubPool[i].rotation.y = Math.atan2(dir.x, dir.z);
      }
    }
    {
      for (let i = 0; i < popPool.length; i++) {
        const p = activePops[i];
        if (!p) { popPool[i].visible = false; continue; }
        popPool[i].visible = true;
        if (p.flyToCapy && heroReady) {
          // spec Part 1: honey-collected coins "fly to the capy" instead of popping in place -- ease the
          // pop mesh from its own (s, lane) toward the hero's current world position over the fly
          // duration, same easeOutCubic family as the glance (spec §7's one easing family).
          const u = Math.min(p.t / HONEY_FLY_DURATION, 1);
          const e = easeOutCubic(u);
          placeAt(popPool[i], trail, p.s, p.lane, "coin");
          if (p.y !== undefined) popPool[i].position.y = p.y; // P2: an arc coin flies from where it was
          popPool[i].position.lerp(hero.object3D.position, e);
          popPool[i].scale.setScalar(Math.max(1 - 0.5 * e, 0.001)); // shrinks as it approaches, reads as "consumed"
        } else {
          placeAt(popPool[i], trail, p.s, p.lane, "coin");
          if (p.y !== undefined) popPool[i].position.y = p.y; // P2: an arc coin pops where it was
          const u = p.t / COIN_POP_DURATION; // spec §7: 1 -> 1.4 -> 0 in 0.15 s
          const scale = u < 0.5 ? 1 + 0.8 * (u / 0.5) : 1.4 * (1 - (u - 0.5) / 0.5);
          popPool[i].scale.setScalar(Math.max(scale, 0.001));
        }
      }
    }
    {
      // spec §2 near-miss juice: the wider "close!" ring pop (nearMissPopMesh), same 1 -> 1.4 -> 0 timing
      // family as the coin pop but its own pool/duration so a near miss and a coin pickup landing in the
      // same frame don't fight over pool slots.
      for (let i = 0; i < nearMissPopPool.length; i++) {
        const p = activeNearMissPops[i];
        if (!p) { nearMissPopPool[i].visible = false; continue; }
        nearMissPopPool[i].visible = true;
        placeAt(nearMissPopPool[i], trail, p.s, p.lane, "coin");
        const u = p.t / NEAR_MISS_POP_DURATION;
        const scale = u < 0.5 ? 1 + 0.8 * (u / 0.5) : 1.4 * (1 - (u - 0.5) / 0.5);
        nearMissPopPool[i].scale.setScalar(Math.max(scale, 0.001));
      }
    }

    const aspect = renderer.domElement.width / renderer.domElement.height || 1;
    const camera = chaseCam(trail, state.s, { aspect, roll: cameraRollAngle(state, reduceMotion), follow: cameraFollow });
    if (introK < 1) applyIntroCam(camera, trail, state.s, introK, 9, swayT); // P3 (THE-1324): the run-start reveal (P5: and the title shot)
    // At y=4 the chase camera loses the hero: a plain vertical translate, no re-aim, so the balloon's
    // top is allowed to leave the frame rather than pulling the camera back (README's own call).
    if (state.power.kind === "balloon" && state.power.t > 0) camera.position.y += BALLOON_CAMERA_LIFT * state.y;
    lastCamera = camera;
    if (shake.t < shake.dur && !reduceMotion) {
      const decay = 1 - shake.t / shake.dur;
      const jitter = () => (Math.random() * 2 - 1) * shake.amp * decay;
      camera.position.x += jitter(); camera.position.y += jitter();
    }
    shake.t += dt;
    sky.position.set(camera.position.x, 0, camera.position.z); // CTO fix K1: keep the camera at the dome's local origin
    ambient.update(dt, camera, { reduceMotion, trail, s: state.s }); // P6 + THE-1353 (leaves pinned to the real path)
    { // P1 (THE-1320): the sun follows a point just ahead of the capy, fixed direction, whole shadow texels
      const sp = sunFollow(trail.at(Math.min(state.s + 12, trail.len)).p, (sc.right - sc.left) / sun.shadow.mapSize.x);
      sun.target.position.set(sp.target.x, sp.target.y, sp.target.z); sun.position.set(sp.position.x, sp.position.y, sp.position.z);
    }
    renderer.render(scene, camera);
  }

  function resize(w, h, dpr2) { renderer.setPixelRatio(dpr2); renderer.setSize(w, h, false); }
  // CTO fix (THE-1374): the bees' buzz is a live voice, not a one-shot, so it only changes when renderFrame()
  // runs. silence() stops it for the phases that don't render (pause, results, rotate); the next renderFrame()
  // rebuilds it. dispose() stops it too, or a quality-tier switch leaves the old world's voice playing.
  function silence() { hero.chaser.stop(); }
  function dispose() { disposed = true; silence(); renderer.dispose(); }

  // Dev/QA-only, deliberately separate from the spec'd G13 window.__capy test hook (design -> "Test
  // hook"): not gameplay-relevant, just enough for a B5 regression test (CTO, THE-1259 S2 review) that
  // the topper actually comes back after a crash, not a read/write surface for cheats.
  function debugTopperState() { return hero.crashVisual.debugState(); }

  // Dev/QA-only (K1 regression, THE-1259 S2 review PASS, 2026-11-06 02:00Z): the sky dome's own world
  // position, so a test can confirm it tracks the camera instead of sitting fixed at the origin.
  function debugSkyPosition() { return { x: sky.position.x, y: sky.position.y, z: sky.position.z }; }

  // Dev/QA-only (B6, THE-1259 S2 review r3: "shoot the A3 strip... in-game"): "yawn" (the sleepy
  // expression, model sheet png/14) has no real-gameplay trigger -- sim.js never emits the "idle" pose
  // during a run (it's reserved for the title-screen diorama, which isn't wired up yet), and even then
  // pose()'s idle case never calls expr("sleepy") itself. This forces it for one evidence screenshot
  // without faking the rest of the scene -- camera, lighting, trail are all the real running game.
  function debugForceExpr(name) { if (hero.kind === "capy" && hero.object3D) exprCapy(hero.object3D, name); }

  // Dev/QA-only (D1, THE-1259 S3, THE-1272, 2026-11-06 02:16Z): forces the glance's timer due on the next
  // renderFrame call where it isn't otherwise suppressed (still needs t >= 5 s and gallop pose -- this
  // only skips the 8-12 s wait, not the real onboarding/pose rules), for an evidence/QA shot -- the glance
  // is otherwise only reachable by waiting out its real first-fire window or a real near miss, same
  // reasoning as debugForceExpr.
  function debugForceGlance() { glanceState.nextAt = -Infinity; }

  // Dev/QA-only (D1, THE-1259 S3, THE-1272): the capy head's current glance rotation, so a real-browser
  // regression test can confirm the glance actually turns the head rather than just checking the pure
  // timer state (glance.test.mjs already covers that side).
  function debugGlanceAngle() { const head = hero.object3D?.userData.head; return head ? head.rotation.y : null; }

  // Dev/QA-only (A13.2.C2, THE-1318 review): the hero's on-screen bounding box in CSS px, from the last
  // rendered frame's own camera, so the title-card overlap check can sample the full ±3 m sway instead of
  // eyeballing one frame.
  function debugCapyScreenBox() {
    const capy = hero.object3D;
    if (!capy || !lastCamera) return null;
    const box = new THREE.Box3().setFromObject(capy);
    const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const corner = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
      corner.project(lastCamera);
      const x = (corner.x * 0.5 + 0.5) * w, y = (-corner.y * 0.5 + 0.5) * h;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    return { left: minX, top: minY, right: maxX, bottom: maxY, width: maxX - minX, height: maxY - minY };
  }

  // Dev/QA-only (B6 corrected, THE-1259 S2 review r4, 2026-11-06 01:18Z): "my r3 'chase camera' ask was
  // wrong, because faces don't show from behind. Shoot the strip at play scale (about 4.9 m), front
  // three-quarter, at 844x390, beside png/14." chaseCam() only ever looks at the capy's back (the "BACK 3/4
  // (THE PLAY VIEW)" panel on png/14) -- the expression strip needs the "3/4" panel, a camera in front of
  // and to the side of the capy looking back at its face. Lighting/fog/trail/ground are still the real
  // running game; the camera is swapped (same spirit as debugForceExpr -- a render-one-frame probe, not a
  // permanent gameplay camera mode) and the hazard/coin/sign/stub/decor pools are hidden for this one frame
  // only: png/14's own "3/4" panel is an isolated diorama shot with nothing else in frame, and a camera
  // placed near the capy at play scale otherwise ends up staring straight at whatever hazard or prop
  // happens to be between it and the capy on a live run (confirmed: the first two attempts at this either
  // had a bird or a log filling the whole foreground instead of the capy's face).
  function debugRenderFrontThreeQuarter() {
    const capy = hero.object3D;
    if (!capy) return;
    const aspect = renderer.domElement.width / renderer.domElement.height || 1;
    const cam = new THREE.PerspectiveCamera(60, aspect, 0.1, 400);
    const p = capy.position;
    // placeAt() sets the hero's rotation.y to the trail's own heading (atan2(t.x, t.z), same convention as
    // forward = (sin(heading), 0, cos(heading))) every frame -- its facing direction changes as the
    // trail curves, so "in front of" has to be computed from its current heading, not a fixed world axis.
    const heading = capy.rotation.y;
    const fwdX = Math.sin(heading), fwdZ = Math.cos(heading);
    const sideX = Math.cos(heading), sideZ = -Math.sin(heading); // perpendicular to forward
    // ~4.9 m out (play scale), ahead of the capy and off to one side -- a "3/4" angle measured from the
    // forward axis (40 deg: enough off-axis to read as 3/4 rather than a flat front-on shot, but close
    // enough to "ahead" that the face is the main thing in frame, matching png/14's "3/4" panel).
    const dist = 4.9, angleFromForward = (40 * Math.PI) / 180, eyeHeight = 0.8;
    cam.position.set(
      p.x + fwdX * dist * Math.cos(angleFromForward) + sideX * dist * Math.sin(angleFromForward),
      p.y + eyeHeight,
      p.z + fwdZ * dist * Math.cos(angleFromForward) + sideZ * dist * Math.sin(angleFromForward)
    );
    cam.lookAt(p.x, p.y + 0.55, p.z);

    const hidden = [];
    const hideAll = (objs) => { for (const o of objs) if (o.visible) { hidden.push(o); o.visible = false; } };
    hideAll(logPool.map((s) => s.obj).filter(Boolean)); hideAll(birdPool.map((s) => s.obj).filter(Boolean)); hideAll(blockPool.map((s) => s.obj).filter(Boolean));
    hideAll(coinPool); hideAll(signPool); hideAll(stubPool); hideAll(popPool); hideAll(pickupPool); hideAll(nearMissPopPool);
    hideAll(shieldPickupPool); if (shieldBubble) hideAll([shieldBubble]); if (shieldBurst) hideAll([shieldBurst]);
    hideAll(balloonPickupPool); if (rideBalloon) hideAll([rideBalloon]);
    hideAll(springPickupPool); if (springAura) hideAll([springAura]);
    hideAll(mysteryPickupPool); if (mysteryOpenMesh) hideAll([mysteryOpenMesh]);
    if (decorGroup) hideAll([decorGroup]);
    renderer.render(scene, cam);
    for (const o of hidden) o.visible = true;
  }

  // THE-1373: exposes hero.head() (world position) for QA/test and for the later in-run label (T2) and
  // map marker (T4/THE-1375) to read, without either of them needing to know which hero is active.
  function debugHeroKind() { return hero.kind; }
  function debugBearHD() { return heroReady ? !!hero.hd : null; } // THE-1582: null until the GLB resolves; capy -> false
  function debugChaserVoice() { return liveBeeVoiceCount(); }
  function heroHeadWorld() { const v = hero.head(); return v ? { x: v.x, y: v.y, z: v.z } : null; }

  // THE-1372: the hero's head, projected to CSS px in this frame's own camera (same projection math as
  // debugCapyScreenBox above) -- game.js positions the in-run coaching label from this every frame, so it
  // tracks the hero as it moves/sways without either side needing to know which hero is active.
  function heroHeadScreen() {
    const v = hero.head();
    if (!v || !lastCamera) return null;
    const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
    const p = v.clone().project(lastCamera);
    return { x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h };
  }

  return {
    renderFrame, resize, dispose, silence, renderer, debugTopperState, debugForceExpr, debugRenderFrontThreeQuarter,
    debugSkyPosition, debugForceGlance, debugGlanceAngle, debugCapyScreenBox, debugHeroKind, heroHeadWorld, debugChaserVoice,
    heroHeadScreen, debugBearHD,
  };
}
