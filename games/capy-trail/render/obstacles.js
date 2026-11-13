// P1 readability (THE-1320): the "go around" blocker is a broken standing snag (snag.glb, 2 variants,
// 2.4-2.6 m: plainly too tall to jump) and the 2-3 lane duck obstacle is a trunk resting on two rocks with
// a tunnel under it (duck.glb). Both are centred on the hazard's own s (and lane / merge-centre lane), on
// the ground. Same clone-the-template pattern as props.js: clones share geometry, never dispose them.
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const loader = new GLTFLoader();
export const SNAG_VARIANTS = ["snag_a", "snag_b"];

export async function loadObstacleTemplates(snagUrl = "./assets/snag.glb", duckUrl = "./assets/duck.glb") {
  const [snagG, duckG] = await Promise.all([loader.loadAsync(snagUrl), loader.loadAsync(duckUrl)]);
  for (const g of [snagG, duckG]) g.scene.traverse((m) => { if (m.isMesh) m.castShadow = m.receiveShadow = true; });
  return { snagG, duckG };
}

function piece(g, name) { const o = g.scene.getObjectByName(name).clone(); o.position.set(0, 0, 0); return o; }
export function snagMesh(templates, name) { return piece(templates.snagG, name); }
export function duckMesh(templates, lanes) { return piece(templates.duckG, `duck_w${lanes >= 3 ? 3 : 2}`); }
