// THE-1284: the new bird.glb (THE-1282 part B hand-off: a 0.40 s "flap" loop) replaces look.js's static
// procedural bird(). Loaded once; render/scene.js clones one instance per pool slot with its own mixer so
// each pooled bird's flap can run independently (a shared mixer would force every bird into lockstep).
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const loader = new GLTFLoader();

export async function loadBirdTemplate(url = "./assets/bird.glb") {
  const gltf = await loader.loadAsync(url);
  const clip = gltf.animations.find((c) => c.name === "flap");
  return { scene: gltf.scene, clip };
}

export function spawnBird(template, phase = 0) {
  const obj = template.scene.clone(true);
  obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const mixer = new THREE.AnimationMixer(obj);
  mixer.clipAction(template.clip).play();
  mixer.update(phase); // stagger instances so a pool doesn't flap in lockstep
  obj.userData = { mixer };
  return obj;
}

export function updateBird(bird, dt) { bird.userData.mixer.update(dt); }

// THE-1284 acceptance: "bobs and swoops in to its duck height as it approaches" (board feedback,
// THE-1279), but "its hit height for the sim is unchanged" -- render/placement.js's placeAt() still sets
// the bird's base y to the fixed HOVER_Y.high, the sim's own render-layer stand-in for HAZARD_BAND.high;
// this returns a purely cosmetic ADDITIVE offset for render/scene.js to apply on top of that, the same
// pattern as the honey jar's bob (render/scene.js: `pickupPool[i].position.y += Math.sin(...)`). Far from the
// capy the bird flies BIRD_SWOOP_HEIGHT above its duck/hit height; as the gap closes under
// BIRD_SWOOP_DIST it eases down to exactly that height, plus a continuous small flap-synced bob.
export const BIRD_SWOOP_DIST = 16, BIRD_SWOOP_HEIGHT = 1.0, BIRD_BOB_AMP = 0.08;
export function birdVisualOffsetY(distAhead, t, phaseKey) {
  const farness = THREE.MathUtils.smoothstep(distAhead, 0, BIRD_SWOOP_DIST); // 0 at/under the capy, 1 at BIRD_SWOOP_DIST+
  const swoop = BIRD_SWOOP_HEIGHT * farness; // full extra height while still far, eased down to 0 (duck height) as it closes in
  const bob = Math.sin(t * 6 + phaseKey) * BIRD_BOB_AMP;
  return swoop + bob;
}
