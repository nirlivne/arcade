// THE-1412 (levels/README.md "Finish line"): lazy GLB load for the one-node finish arch -- same "a few
// frames with nothing to show" async pattern as every other GLB in this module (render/powerups.js etc.).
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const loader = new GLTFLoader();

export async function loadFinishTemplate(path = "./assets/finish-arch.glb") {
  const g = await loader.loadAsync(path);
  g.scene.traverse((m) => { if (m.isMesh) m.castShadow = m.receiveShadow = true; });
  return g;
}

export function finishArchMesh(template) {
  const o = template.scene.getObjectByName("finish_arch").clone(true);
  o.position.set(0, 0, 0);
  return o;
}
