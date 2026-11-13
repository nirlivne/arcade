// A12.4 (THE-1301): goose.glb (THE-1296 models hand-off) -- a gang of 3 instanced geese, each with its own
// mixer so they don't flap in lockstep (same pattern as render/bird.js's pooled birds). sim/sim.js never
// sees these; it only exposes state().chaser = { mode, dist, strikeT } for render/scene.js to place them.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const loader = new GLTFLoader();

export async function loadGooseTemplate(url = "./assets/goose.glb") {
  const gltf = await loader.loadAsync(url);
  const clips = {};
  for (const name of ["waddle-run", "honk", "pounce"]) clips[name] = gltf.animations.find((c) => c.name === name);
  return { scene: gltf.scene, clips };
}

export function spawnGoose(template, phase = 0) {
  const obj = template.scene.clone(true);
  obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const mixer = new THREE.AnimationMixer(obj);
  const clip = template.clips["waddle-run"];
  let action = null;
  if (clip) { action = mixer.clipAction(clip); action.play(); mixer.update(phase); } // stagger so a gang of 3 doesn't waddle in lockstep
  obj.userData = { mixer, template, action };
  return obj;
}

export function updateGoose(goose, dt) { goose.userData.mixer.update(dt); }

// A12.4: "pounce" plays once, on the capy getting caught; "honk" layers in on a stumble arrival and every
// 1.2 s while close. Both are one-shot clips played on top of (not instead of) the looping waddle-run.
function playOneShot(goose, name) {
  const clip = goose.userData.template.clips[name];
  if (!clip) return;
  const action = goose.userData.mixer.clipAction(clip);
  action.reset(); action.setLoop(THREE.LoopOnce); action.clampWhenFinished = true; action.play();
}
export function gooseHonk(goose) { playOneShot(goose, "honk"); }
export function goosePounce(goose) { playOneShot(goose, "pounce"); }

// A12.4: lane-unit offsets (render/placement.js's own laneX() scale, not metres) for the gang-of-3
// silhouette -- a "lane" here is purely cosmetic, geese never collide with anything, so a fractional value
// between real lane centres is fine. 0.3 lanes = 0.3 * LANE_SPACING (1.6 m) = 0.48 m either side of the capy.
export const GOOSE_LANE_OFFSETS = [-0.3, 0, 0.3];
// A new run after a catch: the pounce clip clamps on its last frame, so it has to be stopped explicitly
// or the next run's geese would start mid-pounce.
export function gooseReset(goose) {
  const { mixer, template } = goose.userData;
  for (const name of ["honk", "pounce"]) { const clip = template.clips[name]; if (clip) mixer.clipAction(clip).stop(); }
}
