// THE-1284: props.glb (THE-1282 part B hand-off) replaces look.js's single procedural log() and the
// "bush" case of its forest decor set with the Designer's 2-3 variants each (log_a/b/c, bush_a/b/c), each
// a single static mesh (no animation) -- loaded once; callers build a plain THREE.Mesh sharing the
// template's own geometry/material (never cloned) for whichever named variant a seeded pick resolves to.
//
// CTO fix P1's reasoning (render/look.js's getPropVariants(), THE-1259 S2 review r4) applies here too: a
// per-instance `.clone(true)` of a glTF node (THE-1284's first attempt, for both logs and decor bushes)
// measured a real frame hitch the pre-R3 baseline didn't have (frame-sampler, 104 ms at a hazard-pool/
// decor-window churn). Since neither a log nor a decor bush needs independent per-instance animation
// state (unlike the bird, which keeps its own `.clone(true)` + mixer in render/bird.js), sharing the
// static geometry/material directly removes the clone/traverse cost entirely, matching decorProp()'s own
// already-cheap shape.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const loader = new GLTFLoader();
export const LOG_VARIANTS = ["log_a", "log_b", "log_c"];
export const BUSH_VARIANTS = ["bush_a", "bush_b", "bush_c"];

export async function loadPropsTemplate(url = "./assets/props.glb") {
  const gltf = await loader.loadAsync(url);
  const variants = {};
  for (const name of [...LOG_VARIANTS, ...BUSH_VARIANTS]) {
    const node = gltf.scene.getObjectByName(name);
    const mesh = node.getObjectByName(`${name}_mesh`) ?? node;
    variants[name] = { geometry: mesh.geometry, material: mesh.material };
  }
  return variants;
}

export function propMesh(template, name) {
  const { geometry, material } = template[name];
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

// Deterministic per (seed, id): the same hazard/decor instance always picks the same variant, without
// drawing from the sim's own seeded rng (that would perturb sim determinism/replays, same reasoning as
// render/glance.js's render-local seed). A simple string hash, not cryptographic -- only needs a stable,
// well-mixed spread across `variants.length` buckets.
export function pickVariant(variants, seed, id) {
  let h = seed >>> 0;
  const s = String(id);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return variants[h % variants.length];
}
