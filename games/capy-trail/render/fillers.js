// A12.2/A12.10 (THE-1296 models, THE-1299 L2): renders a filler (sim/narrowing.js's buildFillerSpan piece,
// `patterns.closures`) as a giant trunk or a boulder line, assembled from the Designer's trunk.glb /
// boulders.glb exactly the way the design-only viewer (design/capy-trail/a12-models.html) and the build
// script's own docstring (build/make_a12.py) say a level tool should: trunkRun/boulderRun are lifted from
// that viewer unchanged (its own comment: "the developer can lift those two functions as they are").
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { placeAt } from "./placement.js";

const loader = new GLTFLoader();

export async function loadFillerTemplates(trunkUrl = "./assets/trunk.glb", boulderUrl = "./assets/boulders.glb") {
  const [trunkG, boulderG] = await Promise.all([loader.loadAsync(trunkUrl), loader.loadAsync(boulderUrl)]);
  trunkG.scene.traverse((m) => { if (m.isMesh) m.castShadow = m.receiveShadow = true; });
  boulderG.scene.traverse((m) => { if (m.isMesh) m.castShadow = m.receiveShadow = true; });
  return { trunkG, boulderG };
}

// `zOffset` is each piece's own distance along the run (used to be baked into local position.z so the
// whole group could be placed with one placeAt() at the front face -- THE-1350: a long run on a bend
// needs every piece placed at its own point on the curved lane instead, so this is now a tag for
// placeFillerGroup() below to read, not a transform.
function piece(g, name, zOffset = 0) { const o = g.scene.getObjectByName(name).clone(); o.position.set(0, 0, 0); o.userData.zOffset = zOffset; return o; }

// Assembles a trunk run of length L: the root plate (faces the player, z=0), n uniform-scaled 5 m bark
// segments, then the broken end -- make_a12.py's own docstring formula for n and the per-segment z-scale.
export function trunkRun(templates, L) {
  const g = new THREE.Group();
  const n = Math.max(1, Math.ceil((L - 2.2) / 5)), k = (L - 2.2) / (5 * n);
  g.add(piece(templates.trunkG, "trunk_plate", 0));
  for (let i = 0; i < n; i++) {
    const seg = piece(templates.trunkG, "trunk_seg", 1.0 + 5 * k * i);
    seg.scale.z = k;
    g.add(seg);
  }
  g.add(piece(templates.trunkG, "trunk_end", L - 1.2));
  return g;
}

// Assembles a boulder line of length L: round(L / 2.5) modules butted with a 0.1 m overlap (no seam),
// the front module always the tallest (boulder_a) -- same module order the design viewer settled on.
const BOULDER_ORDER = ["boulder_a", "boulder_b", "boulder_c", "boulder_c", "boulder_b"];
export function boulderRun(templates, L) {
  const g = new THREE.Group();
  const n = Math.max(1, Math.round(L / 2.5));
  for (let i = 0; i < n; i++) {
    g.add(piece(templates.boulderG, i === 0 ? "boulder_a" : BOULDER_ORDER[1 + ((i * 7) % 4)], 2.5 * i));
  }
  return g;
}

export function fillerGroup(templates, kind, length) {
  return kind === "trunk" ? trunkRun(templates, length) : boulderRun(templates, length);
}

// THE-1350 (board, verified by CTO): a filler used to be placed with one placeAt() on the whole group at
// its front face (sStart), along that one point's tangent -- fine for a short piece, but on a bend a
// 15-50 m run visibly drifts off the curved lane by the far end. Each module is placed at its own point
// along the lane instead (sStart + its own zOffset), same placeAt() every other hazard mesh uses, so the
// line of modules follows the curve. `group` keeps an identity transform; it's just a container now.
export function placeFillerGroup(group, trail, sStart, lane) {
  for (const child of group.children) placeAt(child, trail, sStart + child.userData.zOffset, lane);
}
