// The title backdrop (D2-1, sign-off r1 THE-756): the low-poly Dunelark airliner flying right -> left
// over the dusk cloud deck (the Hebrew reading direction), per the recipe's title camera. Render only.
import * as THREE from "../vendor/three.module.min.js";
import { skyDome, clouds, PAL } from "./world.js";
import { airliner } from "./airliner.js";

export function createTitleScene() {
  const pal = PAL.cruise;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(pal[4], 120, 620);
  scene.add(skyDome(pal));
  scene.add(clouds(26, 700, -70, 5));
  scene.add(new THREE.HemisphereLight(new THREE.Color(pal[1]).lerp(new THREE.Color("#ffffff"), 0.35), new THREE.Color(pal[2]), 1.25));
  const sun = new THREE.DirectionalLight(new THREE.Color(pal[3]), 2.4); sun.position.set(60, 30, -90); scene.add(sun);

  const plane = airliner({ rudder: 1 });
  plane.rotation.y = Math.PI; // nose toward -x: crosses the frame right -> left
  scene.add(plane);

  const camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.5, 2400);
  camera.position.set(78, 10, 2);
  camera.lookAt(0, 0, -6);

  // t: slow drift so the jet crosses left-of-centre over many seconds on the title screen.
  function setT(t) { plane.position.set(-40 + t * 10, 0, 0); }
  setT(0);

  return { scene, camera, setT };
}
