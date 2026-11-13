// THE-1355 (board feedback #3 item 6, THE-1349): the Designer's A14 GLBs (THE-1352) replace look.js's
// procedural tree()/sheep()/hut()/flowers(). Each file's top-level mesh nodes are already named
// <kind>_hi/lo (hut_hi, hut_lo) or <kind>_<variant>_hi/lo (tree_a_hi, flowers_b_lo) -- same "share the
// geometry/material, never clone per instance" rule as props.js's log/bush variants (render/look.js's own
// CTO fix P1 reasoning): none of these decor kinds, sheep included, needs a per-instance clone/traverse,
// since a sheep's morph weights live on the Mesh instance (morphTargetInfluences), not the shared geometry.
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const loader = new GLTFLoader();
export const TREE_VARIANTS = ["tree_a", "tree_b"];
export const FLOWERS_VARIANTS = ["flowers_a", "flowers_b"];

export async function loadDecorModels({ tree = "./assets/tree.glb", sheep = "./assets/sheep.glb", hut = "./assets/hut.glb", flowers = "./assets/flowers.glb" } = {}) {
  const [treeG, sheepG, hutG, flowersG] = await Promise.all([tree, sheep, hut, flowers].map((u) => loader.loadAsync(u)));
  const nodes = {};
  for (const g of [treeG, sheepG, hutG, flowersG]) g.scene.traverse((o) => { if (o.isMesh) nodes[o.name] = { geometry: o.geometry, material: o.material }; });
  const grazeClip = sheepG.animations.find((a) => a.name === "graze");
  return { nodes, sheepAnimate: makeSheepAnimator(grazeClip) };
}

// MODELS.md: the graze clip (4.0 s loop) keys both sheep_hi.weights and sheep_lo.weights, but THE-1355
// only plays it on High/Mid (sheep_hi) -- Low keeps the static sheep_lo mesh at rest, same frame-budget
// call as the sun shadow/bush-variant cuts Low already makes elsewhere in this file.
function makeSheepAnimator(grazeClip) {
  const track = grazeClip.tracks.find((t) => t.name.startsWith("sheep_hi."));
  const interpolant = track.createInterpolant();
  const duration = grazeClip.duration;
  return (t) => interpolant.evaluate(((t % duration) + duration) % duration);
}

// One tier's worth of decor model templates, keyed the way decorSlot() consumes them: an array to pick a
// variant from (tree, flowers) or a single template (sheep, hut). tier === "low" uses every kind's `-lo`
// node; High/Mid use `-hi`.
export function decorModelsForTier(decorModels, tier) {
  if (!decorModels) return null;
  const { nodes } = decorModels, lod = tier === "low" ? "lo" : "hi";
  return {
    tree: TREE_VARIANTS.map((v) => nodes[`${v}_${lod}`]),
    flowers: FLOWERS_VARIANTS.map((v) => nodes[`${v}_${lod}`]),
    sheep: nodes[`sheep_${lod}`],
    hut: nodes[`hut_${lod}`],
    animate: tier !== "low",
    sheepAnimate: decorModels.sheepAnimate,
  };
}
