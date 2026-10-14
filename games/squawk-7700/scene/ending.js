// The `ending` cut (spec §2a/§7, sign-off r1 D2-6 THE-756): 4 s on the tarmac at dawn, the airliner
// parked (gear down, rudder stub), the 3 heroes standing in front, 2 escort jets passing overhead.
// Stylised low-poly figures with plain faceted heads (no faces, G7). Render only.
import * as THREE from "../vendor/three.module.min.js";
import { skyDome, desert, fighter, solid, glow, bake, PAL } from "./world.js";
import { airliner } from "./airliner.js";
import { hero } from "./heroes.js";

export function createEndingScene() {
  const p = PAL.dawn;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(p[4], 80, 1500);
  const dome = skyDome(p); dome.userData.sunDir.set(-0.35, 0.08, -0.93).normalize(); scene.add(dome);
  scene.add(new THREE.HemisphereLight(new THREE.Color("#FFF1DE"), new THREE.Color(PAL.sandLo), 1.35));
  const sun = new THREE.DirectionalLight(new THREE.Color(p[3]), 2.2); sun.position.set(-40, 18, -90); scene.add(sun);

  const ds = desert(11, 3000); ds.position.y = -0.4; scene.add(ds);
  const ap = new THREE.Group();
  const slab = solid(new THREE.PlaneGeometry(260, 220).rotateX(-Math.PI / 2), PAL.apron); ap.add(slab);
  for (let i = 0; i < 6; i++) { const ln = glow(new THREE.PlaneGeometry(0.3, 60).rotateX(-Math.PI / 2), "#E8C25A"); ln.position.set(-60 + i * 24, 0.03, -30); ap.add(ln); }
  scene.add(bake(ap));

  const plane = airliner({ rudder: 0, gear: true });
  plane.position.set(4, 3.95, -26); plane.rotation.y = -2.3;
  scene.add(plane);

  const heroes = new THREE.Group();
  [["pilot", -1.5, 0.25, "stand"], ["captain", 0, 0, "stand"], ["passenger", 1.5, -0.2, "wave"]].forEach(([k, x, ry, pose]) => {
    const h = hero(k, pose, { scale: 0.66 }); h.position.set(x, 0, 0); h.rotation.y = ry; heroes.add(h);
  });
  scene.add(heroes);

  const left = fighter(), right = fighter();
  scene.add(left, right);

  const camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.1, 3000);
  camera.position.set(-1.2, 1.25, 7.6);
  camera.lookAt(0.6, 4.2, -18);

  // t in [0, 1] over the 4s cut: the jets sweep in from behind and pass high overhead.
  function setT(t) {
    const sweep = -220 + t * 420;
    left.position.set(-30, 70, -160 + sweep * 0.1);
    right.position.set(-8, 76, -172 + sweep * 0.1);
    left.rotation.set(-0.15, 0.9, 0.2);
    right.rotation.set(-0.15, 0.9, 0.2);
  }
  setT(0);

  return { scene, camera, plane, heroes, setT };
}
