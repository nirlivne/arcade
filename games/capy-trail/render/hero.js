// THE-1373 (board feedback #4, THE-1369/THE-1368): one small hero interface so render/scene.js never has
// to branch on "which animal" itself. createHero(kind) returns { build, pose, head, setGlanceYaw,
// placeAt, crashVisual, chaser }; capy+goose and bear+bees both implement it. Board ruling (2026-11-07
// 11:35Z, "keep the capy in case we revert"): nothing under render/capy.js or render/goose.js changes
// behaviour here, they're just wrapped. The one hard rule this module exists to enforce: **only the
// active hero's GLBs are ever requested** -- createHero(kind) calls exactly one of loadCapy/loadBear and
// exactly one of loadGooseTemplate/loadBeeTemplate, never both, so the inactive hero's assets never hit
// the network (tools/capy-trail-tests covers this with a per-hero network-request recording test).
import * as THREE from "three";
import { loadCapy, pose as poseCapy, lean as leanCapy } from "./capy.js";
import { loadBear, makeBearHD, pose as poseBear, lean as leanBear, headWorld as bearHeadWorld, crashLiftY as bearCrashLiftY } from "./bear.js";
import { loadGooseTemplate, spawnGoose, updateGoose, gooseHonk, goosePounce, gooseReset, GOOSE_LANE_OFFSETS } from "./goose.js";
import { loadBeeTemplate, spawnBee, updateBee, beeReset, beeWingBurst, BEE_COUNT } from "./bees.js";
import { honk, honkChorus, createBeeSwarm } from "./sfx.js";
import { placeAt } from "./placement.js";
import { CHASER_CLOSE_DIST, CHASER_FAR_DIST } from "../sim/sim.js";

const HONK_EVERY = 1.2; // A12.4's own cadence, shared by both chasers

// THE-1391: the hero's own local-space bounding box, measured once right after build() (before any
// pose()/lean() call perturbs a bone), ported from design/capy-trail/powerups.html's own heroBox() -- the
// one anchor every power-up visual (bubble, ring, aura) hangs off, so none of them ever reads a bear-only
// or capy-only bone (spec Part 1: "the hero is switchable ... anchor them to the hero interface").
function heroLocalBox(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), box = new THREE.Box3();
  root.traverse((m) => {
    if (!m.isMesh) return;
    if (m.isSkinnedMesh) { m.skeleton.update(); m.computeBoundingBox(); } else if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    box.union((m.boundingBox || m.geometry.boundingBox).clone().applyMatrix4(m.matrixWorld).applyMatrix4(inv));
  });
  return box;
}

// -------------------------------------------------------------------------- the capy + geese hero
function createCapyHero() {
  let capy = null;
  let topperBounce = null;
  let box = null;
  const GRAVITY = 9, TOPPER_REST_Y = 0.1;

  return {
    kind: "capy",
    async build(scene) {
      const obj = await loadCapy("./assets/capy.glb", { topper: "orange" });
      capy = obj; scene.add(capy);
      box = heroLocalBox(capy);
    },
    get object3D() { return capy; },
    box() { return box; },
    pose(state, dt, introK = 1) {
      if (!capy) return;
      poseCapy(capy, introK < 1 ? "idle" : state.pose, dt, state.v);
    },
    lean(bankRad) { if (capy) leanCapy(capy, bankRad); },
    head() { return capy ? (() => { const v = new THREE.Vector3(); capy.userData.head.getWorldPosition(v); return v; })() : null; },
    setGlanceYaw(rad) { if (capy?.userData.head) capy.userData.head.rotation.y = rad; },
    liftY() { return 0; }, // the capy's crash gag doesn't lift the root; the topper bounce is its own effect below
    crashVisual: {
      start(scene) {
        if (!capy || !capy.userData.topper || topperBounce) return;
        const obj = capy.userData.topper;
        scene.attach(obj);
        topperBounce = { obj, vx: (Math.random() - 0.5) * 1.6, vy: 2.6, vz: (Math.random() - 0.5) * 1.6, bounced: false, resting: false };
      },
      step(dt) {
        if (!topperBounce || topperBounce.resting) return;
        const b = topperBounce;
        b.vy -= GRAVITY * dt;
        b.obj.position.x += b.vx * dt; b.obj.position.y += b.vy * dt; b.obj.position.z += b.vz * dt;
        b.obj.rotation.x += dt * 6; b.obj.rotation.z += dt * 4;
        if (b.obj.position.y <= TOPPER_REST_Y) {
          b.obj.position.y = TOPPER_REST_Y;
          if (!b.bounced && Math.abs(b.vy) > 0.3) { b.vy = -b.vy * 0.35; b.bounced = true; }
          else { b.vx = 0; b.vy = 0; b.vz = 0; b.resting = true; }
        }
      },
      reset() {
        if (!capy || !capy.userData.topper) return;
        const { topper, head, topperHome } = capy.userData;
        if (topper.parent !== head) head.attach(topper);
        topper.position.copy(topperHome.position); topper.rotation.copy(topperHome.rotation);
        topper.visible = true;
        topperBounce = null;
      },
      debugState() {
        if (!capy) return null;
        const { topper, head } = capy.userData;
        return { visible: topper.visible, parentIsHead: topper.parent === head };
      },
    },
    chaser: createGooseChaser(),
  };
}

function createGooseChaser() {
  let geese = [];
  let template = null;
  const GOOSE_RENDER_CLOSE_DIST = 0.75; // render/scene.js's own tuned "keep all 3 inside frame" offset (THE-1296/THE-1301)
  const renderOffset = CHASER_CLOSE_DIST - GOOSE_RENDER_CLOSE_DIST;
  const PILE_TIME = 0.25, FEATHER_TIME = 1.2, FEATHER_COUNT = 18;
  const PILE_SLOTS = [{ ds: -0.3, dl: -0.12, y: 0.32 }, { ds: 0.05, dl: 0.02, y: 0.62 }, { ds: -0.1, dl: 0.14, y: 0.36 }];
  let pile = null;
  let feathers = [], featherT = null;
  const featherMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, depthWrite: false });
  const featherGeo = new THREE.PlaneGeometry(0.09, 0.2);
  let honkCadenceT = 0;

  function startFeathers(origin) {
    featherT = 0; featherMat.opacity = 1;
    for (const f of feathers) {
      f.visible = true;
      f.position.set(origin.x + (Math.random() - 0.5) * 0.6, origin.y + 0.6 + Math.random() * 0.4, origin.z + (Math.random() - 0.5) * 0.6);
      f.userData.v = new THREE.Vector3((Math.random() - 0.5) * 1.8, 1.2 + Math.random() * 1.4, (Math.random() - 0.5) * 1.8);
      f.userData.spin = (Math.random() - 0.5) * 8; f.userData.phase = Math.random() * 6.28;
    }
  }
  function stepFeathers(dt) {
    if (featherT === null) return;
    featherT += dt;
    if (featherT >= FEATHER_TIME) { featherT = null; for (const f of feathers) f.visible = false; return; }
    featherMat.opacity = Math.min(1, 2.5 * (1 - featherT / FEATHER_TIME));
    for (const f of feathers) {
      const v = f.userData.v;
      v.y = Math.max(v.y - 4.5 * dt, -0.6);
      v.x *= 1 - 1.5 * dt; v.z *= 1 - 1.5 * dt;
      f.position.addScaledVector(v, dt);
      f.position.x += Math.sin(featherT * 6 + f.userData.phase) * 0.3 * dt;
      f.rotation.z += f.userData.spin * dt; f.rotation.y += f.userData.spin * 0.5 * dt;
    }
  }

  return {
    async build(scene) {
      template = await loadGooseTemplate("./assets/goose.glb");
      geese = GOOSE_LANE_OFFSETS.map((_, i) => spawnGoose(template, i * 0.3));
      for (const g of geese) { g.visible = false; scene.add(g); }
      feathers = Array.from({ length: FEATHER_COUNT }, () => { const m = new THREE.Mesh(featherGeo, featherMat); m.visible = false; scene.add(m); return m; });
    },
    isReady() { return geese.length > 0; },
    update(trail, state, laneNow, dt, { heroObj, soundOff } = {}) {
      if (!geese.length) return;
      const chaseRenderDist = Math.max(0, state.chaser.dist - renderOffset);
      if (pile) {
        if (pile.fromDist === null) { pile.fromDist = GOOSE_RENDER_CLOSE_DIST; if (heroObj) startFeathers(heroObj.position); }
        pile.t = Math.min(pile.t + dt, PILE_TIME);
      }
      stepFeathers(dt);
      for (let i = 0; i < geese.length; i++) {
        const g = geese[i];
        g.visible = true;
        if (pile) {
          const p = pile.t / PILE_TIME, e = 1 - (1 - p) * (1 - p), slot = PILE_SLOTS[i];
          const back = pile.fromDist * (1 - e) - slot.ds * e;
          placeAt(g, trail, state.s - back, laneNow + GOOSE_LANE_OFFSETS[i] * (1 - e) + slot.dl * e);
          g.position.y += slot.y * e + Math.sin(p * Math.PI) * 0.5;
        } else placeAt(g, trail, state.s - chaseRenderDist, laneNow + GOOSE_LANE_OFFSETS[i]);
        updateGoose(g, dt);
      }
      if (state.chaser.strikeT > 0 && state.chaser.mode === "close" && !state.crashed) {
        honkCadenceT += dt;
        if (honkCadenceT >= HONK_EVERY) { honkCadenceT -= HONK_EVERY; this.onCadenceTick(soundOff); }
      } else honkCadenceT = 0;
    },
    onCadenceTick(soundOff) { honk(soundOff, { volume: 0.10 }); if (geese.length) gooseHonk(geese[Math.floor(Math.random() * geese.length)]); },
    onStumbleArrival(soundOff) { honk(soundOff); for (const g of geese) gooseHonk(g); honkCadenceT = 0; },
    onCatch(soundOff) { honkChorus(soundOff); for (const g of geese) goosePounce(g); pile = { t: 0, fromDist: null }; },
    onModeCloseToFar(soundOff) { honk(soundOff, { deflated: true }); },
    start() {}, stop() {},
    reset() { pile = null; honkCadenceT = 0; featherT = null; for (const f of feathers) f.visible = false; for (const g of geese) gooseReset(g); },
  };
}

// -------------------------------------------------------------------------- the bear + bees hero
// THE-1582: `hd` = Settings -> "HD bear" (off by default): same GLB, subdivided + sheen material in-house.
function createBearHero({ hd = false } = {}) {
  let bear = null;
  let box = null;

  return {
    kind: "bear",
    get hd() { return !!bear?.userData.hd; },
    async build(scene) {
      const obj = await loadBear("./assets/bear.glb");
      if (hd) makeBearHD(obj);
      bear = obj; scene.add(bear);
      box = heroLocalBox(bear);
    },
    get object3D() { return bear; },
    box() { return box; },
    pose(state, dt, introK = 1) {
      if (!bear) return;
      poseBear(bear, introK < 1 ? "idle" : state.pose, dt, state.v);
    },
    lean(bankRad) { if (bear) leanBear(bear, bankRad); },
    head() { return bear ? bearHeadWorld(bear) : null; },
    setGlanceYaw(rad) { if (bear?.userData.head) bear.userData.head.rotation.y = rad; },
    liftY() { return bear ? bearCrashLiftY(bear) : 0; },
    crashVisual: { start() {}, step() {}, reset() {}, debugState() { return null; } }, // no topper on the bear
    chaser: createBeeChaser(),
  };
}

function createBeeChaser() {
  let bees = [];
  let template = null;
  let t = 0;
  const BEE_RENDER_CLOSE_DIST = 1.8; // RIG.md: "keep the close swarm at about 1.6-2.0 m behind"
  const BEE_UP = 1.0; // RIG.md: "0.8-1.3 m up"
  const renderOffset = CHASER_CLOSE_DIST - BEE_RENDER_CLOSE_DIST;
  const PILE_TIME = 0.25;
  let pile = null;
  let cadenceT = 0;
  const voice = createBeeSwarm();
  const BEE_LANE_OFFSETS = Array.from({ length: BEE_COUNT }, (_, i) => (i - (BEE_COUNT - 1) / 2) * 0.12);

  return {
    async build(scene) {
      template = await loadBeeTemplate("./assets/bee.glb");
      bees = Array.from({ length: BEE_COUNT }, (_, i) => spawnBee(template, i));
      for (const b of bees) { b.visible = false; scene.add(b); }
    },
    isReady() { return bees.length > 0; },
    update(trail, state, laneNow, dt, { soundOff, voice: voiceOn = true } = {}) {
      t += dt;
      if (!bees.length) return;
      const k = state.chaser.dist <= 0 ? 1 : Math.max(0, Math.min(1, (CHASER_FAR_DIST - state.chaser.dist) / (CHASER_FAR_DIST - CHASER_CLOSE_DIST)));
      // CTO fix (THE-1374): the buzz is for the run screen only (SOUND.md), not the title or the intro; and
      // once caught, leave catchSting()'s own fade alone -- re-targeting every frame through the crash gag
      // used to hold the buzz at the close level instead of letting it die out.
      if (!voiceOn) voice.stop();
      else if (!pile) voice.update(k, !!soundOff);
      const chaseRenderDist = Math.max(0, state.chaser.dist - renderOffset);
      if (pile) pile.t = Math.min(pile.t + dt, PILE_TIME);
      const wrapE = pile ? (1 - (1 - pile.t / PILE_TIME) * (1 - pile.t / PILE_TIME)) : 0;
      for (let i = 0; i < bees.length; i++) {
        const b = bees[i];
        b.visible = true;
        const back = pile ? chaseRenderDist * (1 - wrapE) + 0.15 * wrapE : chaseRenderDist;
        placeAt(b, trail, state.s - back, laneNow + BEE_LANE_OFFSETS[i]);
        b.position.y += BEE_UP * (pile ? 1 - 0.5 * wrapE : 1);
        updateBee(b, t, dt);
      }
      if (state.chaser.strikeT > 0 && state.chaser.mode === "close" && !state.crashed) {
        cadenceT += dt;
        if (cadenceT >= HONK_EVERY) { cadenceT -= HONK_EVERY; this.onCadenceTick(soundOff); }
      } else cadenceT = 0;
    },
    onCadenceTick(soundOff) { voice.cadencePulse(soundOff); if (bees.length) beeWingBurst(bees[Math.floor(Math.random() * bees.length)]); },
    onStumbleArrival(soundOff) { voice.stumbleSwell(soundOff); cadenceT = 0; },
    onCatch(soundOff) { voice.catchSting(soundOff); pile = { t: 0 }; },
    onModeCloseToFar(soundOff) { voice.fallBackRelease(soundOff); },
    start(soundOff) { if (!soundOff) voice.start(); },
    stop() { voice.stop(); },
    reset() { pile = null; cadenceT = 0; for (const b of bees) beeReset(b); voice.start(); },
  };
}

// THE-1582: bearHD only ever touches the bear; the capy ignores it.
export function createHero(kind, { bearHD = false } = {}) {
  return kind === "capy" ? createCapyHero() : createBearHero({ hd: bearHD });
}

// Resolves the active hero kind: a `?hero=` override (for the per-hero test runs) wins over theme.js's
// own setting, which wins over the "bear" default (board ruling 2026-11-07 14:40Z).
export function resolveHeroKind(theme, search = "") {
  const q = new URLSearchParams(search).get("hero");
  if (q === "bear" || q === "capy") return q;
  return theme?.hero === "capy" ? "capy" : "bear";
}
