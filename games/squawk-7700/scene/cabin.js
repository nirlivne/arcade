// The aisle: third-person behind the Passenger, from the designer's recipe (THE-734 scene.js), trimmed
// for S4 (obstacles only; the hero model and seated-passenger heads land as S7 polish). Render only.
import * as THREE from "../vendor/three.module.min.js";
import { bake, solid, glow, mesh, paint, MAT, PAL } from "./world.js";
import { hero } from "./heroes.js";

const CABIN_PAL = {
  wall: "#E7DFD1", ceiling: "#EFE8DC", seat: "#2C6B72", seatHi: "#3D8A90", carpet: "#4A3A5E",
  strip: "#FF3344", window: "#9C5A86", bag: "#5EA6B8", mask: "#FFC93C", cord: "#F4F1EA",
  // cartTop: the recipe's dark-slate value reads as near-black against this cabin's dusk purple/teal
  // palette at 844x390 (D1-1: "the trolleys are dark on dark"); the amber warning accent already used
  // for the lock light stands out instead, without changing the body/belly colours.
  cart: "#B9BCC4", cartTop: PAL.lampAmber, cartStripe: "#1C6B74", belly: "#1C6B74", door: "#3A3F4A", lock: PAL.lampAmber,
};

export function createCabinScene(trackLen) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#1E1428");
  scene.fog = new THREE.Fog("#2A1830", 10, 52);
  scene.add(new THREE.HemisphereLight(new THREE.Color("#FFF0DC"), new THREE.Color("#5A2A3A"), 1.7));
  const sun = new THREE.DirectionalLight(new THREE.Color("#FFD9A8"), 1.2); sun.position.set(-4, 3, 2); scene.add(sun);

  const L = trackLen + 16;
  const cab = new THREE.Group();
  const tube = new THREE.CylinderGeometry(3.4, 3.4, L, 14, 1, true); tube.rotateX(Math.PI / 2);
  const t = mesh(tube, (m) => (m.y < 0.1 ? CABIN_PAL.carpet : m.y > 2.6 ? CABIN_PAL.ceiling : CABIN_PAL.wall));
  t.scale.y = 0.82; t.position.set(0, 1.0, L / 2 - 8); cab.add(t);
  const floor = solid(new THREE.PlaneGeometry(6.4, L).rotateX(-Math.PI / 2), CABIN_PAL.carpet);
  floor.position.set(0, 0, L / 2 - 8); cab.add(floor);
  for (const sx of [-1.35, 1.35]) { const s = glow(new THREE.PlaneGeometry(0.07, L).rotateX(-Math.PI / 2), CABIN_PAL.strip); s.position.set(sx, 0.01, L / 2 - 8); cab.add(s); }
  // No row cap (D2-5): the seats used to stop at ~62 m (26 rows x 2.4 m), leaving the back half of a
  // 120 m track an empty tube. Fill every row to the tube's own length instead.
  const rows = Math.ceil(L / 2.4);
  for (let i = 0; i < rows; i++) for (const sx of [-1, 1]) {
    const w = glow(new THREE.PlaneGeometry(0.24, 0.34), CABIN_PAL.window); w.position.set(sx * 3.05, 1.7, -8 + i * 2.4); w.rotation.y = -sx * Math.PI / 2; cab.add(w);
    const seat = mesh(new THREE.BoxGeometry(0.56, 1.1, 0.24), (m, n) => (n.z > 0.5 ? CABIN_PAL.seatHi : CABIN_PAL.seat));
    seat.position.set(sx * 1.75, 0.85, -8 + i * 2.4 - 0.5); cab.add(seat);
  }
  const door = solid(new THREE.BoxGeometry(1.4, 2.2, 0.1), CABIN_PAL.door); door.position.set(0, 1.1, trackLen + 2); cab.add(door);
  const lock = glow(new THREE.BoxGeometry(0.12, 0.12, 0.04), CABIN_PAL.lock); lock.position.set(0.45, 1.2, trackLen + 1.93); cab.add(lock);
  scene.add(bake(cab));

  // Obstacles: one InstancedMesh per kind, positions set live from the sim's row list each frame.
  // frustumCulled stays false on all three (D1-1): their bounding sphere was computed once, at
  // construction, with count still 0, so the renderer culled them forever once setObstacles gave them
  // real matrices -- the aisle's bags, masks and trolleys were never drawn (THE-756 sign-off r1).
  const bags = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.4, 0.3), new THREE.MeshLambertMaterial({ color: CABIN_PAL.bag, flatShading: true }), 32);
  const masks = new THREE.InstancedMesh(new THREE.ConeGeometry(0.14, 0.2, 6), new THREE.MeshLambertMaterial({ color: CABIN_PAL.mask, flatShading: true }), 32);
  // The trolley gets the recipe's bright top + teal belly stripe (paint() per-face) instead of one flat
  // colour, so it reads against the dark cabin at 844x390 (D1-1).
  const cartGeo = paint(new THREE.BoxGeometry(0.8, 1.0, 1.1), (m, n) => (n.y > 0.5 ? CABIN_PAL.cartTop : Math.abs(n.x) > 0.5 && Math.abs(m.y) < 0.12 ? CABIN_PAL.belly : CABIN_PAL.cart));
  const carts = new THREE.InstancedMesh(cartGeo, MAT.lit, 32);
  bags.count = masks.count = carts.count = 0;
  bags.frustumCulled = masks.frustumCulled = carts.frustumCulled = false;
  scene.add(bags, masks, carts);

  const d = new THREE.Object3D(); // scratch, reused by setObstacles and updatePassengers below

  // Seated passengers (G10, THE-767 r2): the designer's recipe (design/squawk-7700/scene.js
  // cabinScene) draws faceless heads + overhead masks for the nearest 8 rows only, the rest left to
  // the fog (10-52 m) to cover -- +2 draw calls total, one InstancedMesh each, both frustumCulled =
  // false for the same reason as the obstacles above (D1-1: a bounding sphere computed at count = 0
  // never grows). Varied hair/skin tone per head (instance colour, recipe's `tones`), seen from behind.
  const HEAD_ROWS = 8;
  const HEAD_TONES = ["#2B2420", "#5A3A28", "#8A8F96", "#1E1A18", "#A0703F", "#C9C2B8", "#3E2A22", "#6E4B36"];
  const heads = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.17, 0), new THREE.MeshLambertMaterial({ flatShading: true }), HEAD_ROWS * 2);
  const overheadMasks = new THREE.InstancedMesh(new THREE.ConeGeometry(0.14, 0.18, 6), new THREE.MeshLambertMaterial({ color: CABIN_PAL.mask, flatShading: true }), HEAD_ROWS);
  heads.count = HEAD_ROWS * 2; overheadMasks.count = HEAD_ROWS;
  heads.frustumCulled = overheadMasks.frustumCulled = false;
  scene.add(heads, overheadMasks);
  let headRngSeed = 3;
  const headRnd = () => ((headRngSeed = (headRngSeed * 16807) % 2147483647) / 2147483647);
  let lastHeadRow = null;
  // z: the row just at/behind the current view (same formula as the static seat loop above). The
  // window only needs to shift once every ~2.4 m travelled, not every frame (THE-759 lesson: don't
  // rebuild instance matrices for a value that rarely changes).
  function updatePassengers(z) {
    const startRow = Math.max(0, Math.floor((z + 8.5) / 2.4) - 1);
    if (startRow === lastHeadRow) return;
    lastHeadRow = startRow;
    headRngSeed = 3;
    let hi = 0;
    for (let r = 0; r < HEAD_ROWS; r++) {
      const rowZ = -8 + (startRow + r) * 2.4 - 0.5;
      for (const sx of [-1, 1]) {
        d.position.set(sx * 1.75, 1.42, rowZ + 0.1);
        d.rotation.set(headRnd() * 0.3, headRnd() * Math.PI * 2, 0);
        d.scale.setScalar(1); d.updateMatrix();
        heads.setMatrixAt(hi, d.matrix);
        heads.setColorAt(hi, new THREE.Color(HEAD_TONES[Math.floor(headRnd() * HEAD_TONES.length)]));
        hi++;
      }
      d.position.set(0, 2.2, rowZ);
      d.rotation.set(Math.PI, headRnd() * Math.PI * 2, 0);
      d.scale.setScalar(1); d.updateMatrix();
      overheadMasks.setMatrixAt(r, d.matrix);
    }
    heads.instanceMatrix.needsUpdate = true;
    if (heads.instanceColor) heads.instanceColor.needsUpdate = true;
    overheadMasks.instanceMatrix.needsUpdate = true;
  }

  // The Passenger runner (D2-5): always from behind, live limbs for a run cycle keyed off distance
  // travelled (not wall-clock time, so pausing never leaves mid-stride legs frozen oddly).
  const passenger = hero("passenger", "run", { live: true, scale: 0.66 });
  const legL = passenger.getObjectByName("legL"), legR = passenger.getObjectByName("legR");
  const armL = passenger.getObjectByName("armL"), armR = passenger.getObjectByName("armR");
  scene.add(passenger);

  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 120);
  const LANE_X = [-0.9, 0, 0.9];

  // rows: the sim's current row list (z, obstacles[{lane,kind}]), hit/passed rows excluded by the caller.
  function setObstacles(rows) {
    let nb = 0, nm = 0, nc = 0;
    for (const row of rows) {
      for (const o of row.obstacles) {
        const x = LANE_X[o.lane];
        if (o.kind === "bag") { d.position.set(x, 0.3, row.z); d.rotation.set(0, 0, 0); d.scale.setScalar(1); d.updateMatrix(); if (nb < 32) bags.setMatrixAt(nb++, d.matrix); }
        else if (o.kind === "mask") { d.position.set(x, 1.3, row.z); d.rotation.set(Math.PI, 0, 0); d.scale.setScalar(1); d.updateMatrix(); if (nm < 32) masks.setMatrixAt(nm++, d.matrix); }
        else { d.position.set(x, 0.55, row.z); d.rotation.set(0, 0, 0); d.scale.setScalar(1); d.updateMatrix(); if (nc < 32) carts.setMatrixAt(nc++, d.matrix); }
      }
    }
    bags.count = nb; masks.count = nm; carts.count = nc;
    bags.instanceMatrix.needsUpdate = true; masks.instanceMatrix.needsUpdate = true; carts.instanceMatrix.needsUpdate = true;
  }

  // laneX: the player's current interpolated lane x. z: distance travelled.
  function followCamera(laneX, z) {
    camera.position.set(laneX * 0.5, 2.45, z - 5.0);
    camera.lookAt(laneX, 0.9, z + 14);
    updatePassengers(z);
    passenger.position.set(laneX, 0, z);
    const strideF = 2.2; // steps/metre at the sim's WALK_V/SPRINT_V scale, just for the visual cycle
    const phase = z * strideF;
    legL.rotation.x = Math.sin(phase) * 0.75; legR.rotation.x = -Math.sin(phase) * 0.75;
    armR.rotation.x = Math.sin(phase) * 0.8; armL.rotation.x = -Math.sin(phase) * 0.8;
  }

  // For the aisle-render check (D1-1): instance counts and frustumCulled, so a QA pass can assert the
  // obstacles are both present and not silently culled, without reaching into scene internals.
  function obstacleStats() {
    return {
      bagCount: bags.count, maskCount: masks.count, cartCount: carts.count,
      headCount: heads.count, overheadMaskCount: overheadMasks.count,
      frustumCulled: bags.frustumCulled || masks.frustumCulled || carts.frustumCulled || heads.frustumCulled || overheadMasks.frustumCulled,
    };
  }

  return { scene, camera, setObstacles, followCamera, obstacleStats };
}
