// The escort: an exterior chase camera behind and above the airliner, two fighters alongside (per the
// designer's recipe, escort-* mockup). Render only.
import * as THREE from "../vendor/three.module.min.js";
import { skyDome, clouds, fighter, PAL } from "./world.js";
import { airliner } from "./airliner.js";

export function createEscortScene() {
  const pal = PAL.escort;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(pal[4], 120, 620);
  scene.add(skyDome(pal));
  scene.add(clouds(26, 700, -40, 19));
  scene.add(new THREE.HemisphereLight(new THREE.Color(pal[1]).lerp(new THREE.Color("#ffffff"), 0.35), new THREE.Color(pal[2]), 1.25));
  const sun = new THREE.DirectionalLight(new THREE.Color(pal[3]), 2.4); sun.position.set(60, 30, -90); scene.add(sun);

  const plane = airliner({ rudder: 0.33 });
  scene.add(plane);
  const left = fighter(); left.position.set(-19, 5, -2); scene.add(left);
  const right = fighter(); right.position.set(18, 1, -8); scene.add(right);

  const camera = new THREE.PerspectiveCamera(44, 16 / 9, 0.5, 2400);
  camera.position.set(7, 8, -52);
  camera.lookAt(-1, 0.5, 4);

  function setRudderDamage(chunksLost) {
    for (let i = 0; i < 3; i++) {
      const piece = plane.getObjectByName("rudder" + i);
      if (piece) piece.visible = i < 3 - chunksLost;
    }
  }
  return { scene, camera, plane, setRudderDamage };
}
