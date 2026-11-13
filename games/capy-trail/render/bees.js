// THE-1373: assets/bee.glb (THE-1370 hand-off, RIG.md "The bee") -- a swarm of 5-8 instances replaces the
// capy's 3 geese when hero: "bear". sim/sim.js never sees these; like render/goose.js it only exposes
// state().chaser = { mode, dist, strikeT } for the swarm centre to follow (RIG.md: "the swarm centre
// following the chaser distance the geese used"). Each bee has its own baked "buzz" wing-flap clip (so a
// swarm doesn't flap in lockstep, same AnimationMixer-per-instance pattern as render/bird.js) plus a small
// per-bee Lissajous jitter orbit layered on top of wherever the swarm places it.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const loader = new GLTFLoader();
const TAU = Math.PI * 2;

export const BEE_COUNT = 6; // RIG.md: "a swarm of 5-8 bee.glb instances"

export async function loadBeeTemplate(url = "./assets/bee.glb") {
  const gltf = await loader.loadAsync(url);
  const clip = gltf.animations.find((c) => c.name === "buzz");
  return { scene: gltf.scene, clip };
}

// Deterministic per-bee variety (no RNG state to thread through the render layer): derived purely from the
// bee's own pool index, same spirit as goose.js's fixed GOOSE_LANE_OFFSETS.
function hash01(i, salt) { const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453; return x - Math.floor(x); }

export function spawnBee(template, i) {
  const obj = template.scene.clone(true);
  obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const mixer = new THREE.AnimationMixer(obj);
  let action = null;
  if (template.clip) { action = mixer.clipAction(template.clip); action.play(); mixer.update(i * 0.037); } // stagger the flap
  // RIG.md: "scale 1.4-1.8 per bee in play", "jitter each bee on its own slow Lissajous (0.15-0.3 m, 0.7-1.3 Hz)"
  const scale = 1.4 + hash01(i, 1) * 0.4;
  obj.scale.setScalar(scale);
  obj.userData = {
    mixer, action,
    jx: 0.15 + hash01(i, 2) * 0.15, jy: 0.08 + hash01(i, 3) * 0.08, jz: 0.15 + hash01(i, 4) * 0.15,
    freq: 0.7 + hash01(i, 5) * 0.6, phase: hash01(i, 6) * TAU,
  };
  return obj;
}

// Called after the caller has placed `bee` at the swarm's base position for this frame (placeAt-style);
// layers the per-bee flap + jitter orbit on top, the same "set base, then add a cosmetic offset" pattern
// render/scene.js already uses for the honey jar pickup's bob.
export function updateBee(bee, t, dt) {
  const u = bee.userData;
  u.mixer.update(dt);
  bee.position.x += Math.sin(t * TAU * u.freq + u.phase) * u.jx;
  bee.position.y += Math.sin(t * TAU * u.freq * 0.8 + u.phase * 1.7) * u.jy;
  bee.position.z += Math.cos(t * TAU * u.freq * 1.3 + u.phase) * u.jz;
}

// A new run after a catch: the wing-burst one-shot (angry pulse, SOUND.md) retimes a random bee's clip --
// stop it so the next run's swarm doesn't start mid-burst, mirroring goose.js's gooseReset().
export function beeReset(bee) {
  if (bee.userData.action) { bee.userData.action.timeScale = 1; bee.userData.action.play(); }
}

// SOUND.md "angry pulse": "pick a random bee for a wing burst (timeScale 3 on its buzz for 0.2 s)".
export function beeWingBurst(bee, dur = 0.2) {
  const a = bee.userData.action;
  if (!a) return;
  a.timeScale = 3;
  setTimeout(() => { a.timeScale = 1; }, dur * 1000);
}
