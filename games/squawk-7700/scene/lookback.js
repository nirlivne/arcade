// The rudder look-back: a 0.4s cut away from the cockpit to an external tail camera (render only; the
// sim keeps running headless underneath). One draw call for the airliner (baked) + the sky dome.
import * as THREE from "../vendor/three.module.min.js";
import { skyDome, clouds, PAL } from "./world.js";
import { airliner } from "./airliner.js";

export function createLookbackScene() {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(PAL.dive[4], 120, 620);
  scene.add(skyDome(PAL.dive));
  scene.add(clouds(26, 700, -40, 11));
  scene.add(new THREE.HemisphereLight(new THREE.Color(PAL.dive[1]).lerp(new THREE.Color("#ffffff"), 0.35), new THREE.Color(PAL.dive[2]), 1.25));
  const sun = new THREE.DirectionalLight(new THREE.Color(PAL.dive[3]), 2.4); sun.position.set(60, 30, -90); scene.add(sun);

  const plane = airliner({ rudder: 1 });
  scene.add(plane);
  const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.5, 2400);
  camera.position.set(0, 9, -30);
  camera.lookAt(0, 4.6, -9.4);

  // chunksLost: 0-3, how many rudder pieces are gone.
  function setRudderDamage(chunksLost) {
    for (let i = 0; i < 3; i++) {
      const piece = plane.getObjectByName("rudder" + i);
      if (piece) piece.visible = i < 3 - chunksLost;
    }
  }
  return { scene, camera, setRudderDamage };
}
