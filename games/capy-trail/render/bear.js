// THE-1373: assets/bear.glb (THE-1370 hand-off, design/capy-trail/bear/RIG.md) -- a skinned rig, not the
// capy's rigid GLB parts, so there are no clips to bake (the source's were dropped per RIG.md). Every pose
// below is the bone-angle table RIG.md measured off Polyfork's own Run/Jump/Duck clips, written as plain
// trig so no AnimationMixer/clip is involved. Gait phase is tied to distance, not wall time (RIG.md's own
// "T = 0.86 * 8 / max(speed,1)" collapses to a constant 6.88 m per stride below the 0.45 s floor), so the
// legs never go out of sync with how far the bear has actually run.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { loopSubdivide, smoothNormals } from "./bear-subdivide.js";

const loader = new GLTFLoader();
const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

const BONE_NAMES = [
  "Hips", "Spine", "Chest", "Neck", "Head", "Jaw", "LeftEar", "RightEar",
  "LeftFrontUpLeg", "LeftFrontElbow", "LeftFrontLeg", "LeftFrontFoot",
  "RightFrontUpLeg", "RightFrontElbow", "RightFrontLeg", "RightFrontFoot",
  "Tail", "TailTip",
  "LeftHindUpLeg", "LeftHindLeg", "LeftHindHock", "LeftHindFoot",
  "RightHindUpLeg", "RightHindLeg", "RightHindHock", "RightHindFoot",
];

export async function loadBear(url = "./assets/bear.glb") {
  const gltf = await loader.loadAsync(url);
  const root = gltf.scene;
  const find = (name) => root.getObjectByName(name);
  const bones = {};
  for (const name of BONE_NAMES) bones[name] = find(name);
  const body = find("body");
  if (body) body.frustumCulled = false; // RIG.md: the crash roll reaches outside the bind-pose bounds
  const head = bones.Head;
  root.userData = {
    bones, body, head,
    hipsRestY: bones.Hips ? bones.Hips.position.y : 0.648,
    phase: 0, // 0..1 fraction of the current gallop stride, advanced by distance (see pose() below)
    poseName: null, poseElapsed: 0, stumbleFlip: 1,
    applied: {}, // last frame's eased bone angles (rad), by bone name -- the "from" state for a pose change
    appliedHipsY: null, appliedHipsScale: null, appliedRootZ: 0,
    leanZ: 0,
  };
  return root;
}

// THE-1582: Settings -> "HD bear" (off by default). Built in-house at load from the same free CC BY mesh:
// one Loop subdivision pass (render/bear-subdivide.js, 2,542 -> 10,168 triangles), position-welded smooth
// normals, and a physical material with a soft sheen for a fur-ish rim. Same skeleton, joints and pose
// tables, so nothing downstream changes. The default (off) path never calls this.
const HD_SHEEN = new THREE.Color(0.62, 0.5, 0.38);
export function makeBearHD(bear) {
  const body = bear?.userData.body;
  const mesh = body?.isSkinnedMesh ? body : body?.getObjectByProperty("isSkinnedMesh", true);
  if (!mesh) return false;
  const g = mesh.geometry;
  const colAttr = g.getAttribute("color");
  const toFloat = (a) => {
    if (!a) return null;
    const out = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) out[i * a.itemSize + c] = a.getComponent(i, c);
    return out; // getComponent() denormalises a normalized uint8 colour/weight to 0..1
  };
  const r = loopSubdivide({
    position: toFloat(g.getAttribute("position")),
    color: toFloat(colAttr), colorSize: colAttr ? colAttr.itemSize : 3,
    joints: g.getAttribute("skinIndex") ? Uint16Array.from(g.getAttribute("skinIndex").array) : null,
    weights: toFloat(g.getAttribute("skinWeight")),
    index: g.index.array,
  });
  // Loop pulls convex extremities inward; put the paws back on the ground (bind-pose min y unchanged).
  g.computeBoundingBox();
  const minY0 = g.boundingBox.min.y;
  let minY1 = Infinity;
  for (let i = 1; i < r.position.length; i += 3) minY1 = Math.min(minY1, r.position[i]);
  const dy = minY0 - minY1;
  for (let i = 1; i < r.position.length; i += 3) r.position[i] += dy;

  const hd = new THREE.BufferGeometry();
  hd.setAttribute("position", new THREE.BufferAttribute(r.position, 3));
  hd.setAttribute("normal", new THREE.BufferAttribute(smoothNormals(r.position, r.index), 3));
  if (r.color) hd.setAttribute("color", new THREE.BufferAttribute(r.color, r.colorSize));
  if (r.joints) hd.setAttribute("skinIndex", new THREE.BufferAttribute(r.joints, 4));
  if (r.weights) hd.setAttribute("skinWeight", new THREE.BufferAttribute(r.weights, 4));
  hd.setIndex(new THREE.BufferAttribute(r.index, 1));
  hd.computeBoundingBox(); hd.computeBoundingSphere();
  mesh.geometry = hd;
  g.dispose();

  const old = mesh.material;
  mesh.material = new THREE.MeshPhysicalMaterial({
    name: "BearClayHD",
    color: old.color ? old.color.clone() : 0xffffff,
    vertexColors: !!r.color,
    roughness: 0.78, metalness: 0,
    sheen: 1, sheenRoughness: 0.55, sheenColor: HD_SHEEN,
  });
  old.dispose();
  bear.userData.hd = true;
  return true;
}

export function headWorld(bear) {
  if (!bear?.userData.head) return null;
  const v = new THREE.Vector3();
  bear.userData.head.getWorldPosition(v);
  return v;
}

// RIG.md: "put the bank on Spine rotation.z ... 0.3x on Head rotation.z", additive on top of whatever pose
// is live (stumble/crash already use Spine/Head z for their own narrative tilt).
export function lean(bear, bankRad) {
  if (!bear) return;
  bear.userData.leanZ = bankRad;
}

// ---------------------------------------------------------------- pose tables (degrees; rotation.x unless noted)
// Run (RIG.md "Swing ranges by state" -> Run): mid/amp/peak (fraction of stride) per bone.
const GALLOP = {
  LeftFrontUpLeg: { mid: 4.5, amp: 19.5, peak: 0.91 },
  RightFrontUpLeg: { mid: 2.5, amp: 18.5, peak: 0.01 },
  LeftFrontElbow: { mid: -35, amp: 24, peak: 0.72 },
  RightFrontElbow: { mid: -35, amp: 24, peak: 0.64 },
  LeftFrontFoot: { mid: 50, amp: 37, peak: 0.21 },
  RightFrontFoot: { mid: 50, amp: 37, peak: 0.30 },
  LeftHindUpLeg: { mid: -8.5, amp: 20.5, peak: 0.38 },
  RightHindUpLeg: { mid: -7.5, amp: 21.5, peak: 0.49 },
  LeftHindLeg: { mid: 41, amp: 22, peak: 0.70 },
  RightHindLeg: { mid: 41, amp: 22, peak: 0.79 },
  LeftHindHock: { mid: -71, amp: 25, peak: 0.09 },
  RightHindHock: { mid: -71, amp: 25, peak: 0.08 },
  LeftHindFoot: { mid: 36, amp: 23, peak: 0.85 },
  RightHindFoot: { mid: 36, amp: 23, peak: 0.90 },
  // flavour, not in the measured table: a little life in the extremities so the gallop doesn't read as a
  // torso with 8 identical pendulum legs. Small enough it can't fight the measured ranges above.
  Neck: { mid: 0, amp: 1, peak: 0.61, freq: 2 },
  Head: { mid: 0, amp: 1, peak: 0.11, freq: 2 },
  Tail: { mid: 0, amp: 6, peak: 0.5 },
  LeftEar: { mid: -4, amp: 4, peak: 0.0 },
  RightEar: { mid: -4, amp: 4, peak: 0.0 },
};
const GALLOP_HIPS_Y = { mid: -0.079, amp: 0.026, peak: 0.11, freq: 2 };
const GALLOP_HIPS_ROT_X = { mid: 0, amp: 2.5, peak: 0.25 };
const GALLOP_STRIDE_M = 0.86 * 8; // metres per stride while above the 0.45 s floor (T * speed, both sides cancel)
const GALLOP_T_FLOOR = 0.45;

function cyc({ mid, amp, peak, freq = 1 }, u) { return mid + amp * Math.cos(TAU * freq * (u - peak)); }

// Jump tuck (RIG.md "Jump tuck"): static target, held through the airborne window.
const JUMP = {
  LeftFrontUpLeg: -45, RightFrontUpLeg: -45,
  LeftFrontElbow: -85, RightFrontElbow: -85,
  LeftFrontFoot: 70, RightFrontFoot: 70,
  LeftHindUpLeg: -35, RightHindUpLeg: -35,
  LeftHindLeg: 70, RightHindLeg: 70,
  LeftHindHock: -110, RightHindHock: -110,
  LeftHindFoot: 50, RightHindFoot: 50,
  Spine: 6, Chest: 6, Neck: -14, Head: -8, Tail: -20, LeftEar: -15, RightEar: -15,
};

// Duck belly-slide (RIG.md "Duck"): static target plus the Hips squash.
const DUCK = {
  LeftFrontUpLeg: -82, RightFrontUpLeg: -82,
  LeftFrontElbow: -5, RightFrontElbow: -5,
  LeftFrontFoot: 75, RightFrontFoot: 75,
  LeftHindUpLeg: 82, RightHindUpLeg: 82,
  LeftHindLeg: 0, RightHindLeg: 0, LeftHindHock: 0, RightHindHock: 0,
  LeftHindFoot: 10, RightHindFoot: 10,
  Spine: 4, Chest: 8, Neck: 14, Head: 6, Tail: 20, LeftEar: 35, RightEar: 35,
};
const DUCK_HIPS_Y = 0.318; // absolute, RIG.md: "from 0.648 to 0.318"
const DUCK_HIPS_SCALE = [1.10, 0.75, 1.05];

// Stumble (RIG.md "Stumble"): (x, y, z) per bone; z components flip sign each occurrence (stumbleFlip) so
// consecutive stumbles don't read as the exact same canned lurch.
const STUMBLE = {
  Spine: [8, 0, 6], Chest: [10, 0, 6],
  Neck: [10, 0, 0], Head: [18, 0, -10], Jaw: [18, 0, 0],
  LeftFrontUpLeg: [-28, 0, 0], LeftFrontElbow: [-45, 0, 0],
  RightFrontUpLeg: [-5, 0, -8], RightFrontElbow: [-15, 0, 0],
  LeftHindUpLeg: [18, 0, 0], LeftHindHock: [-40, 0, 0],
  RightHindUpLeg: [-10, 0, 0], RightHindHock: [-60, 0, 0],
  LeftEar: [20, 0, 15], RightEar: [20, 0, -15],
};
const STUMBLE_HIPS_Y = -0.06; // offset from rest

// Crash/bonk (RIG.md "Crash"): (x, y, z) per bone, plus the root roll.
const CRASH = {
  Spine: [0, 0, 8], Head: [-10, 0, 10], Jaw: [25, 0, 0],
  LeftFrontUpLeg: [-30, 0, -20], LeftFrontElbow: [-40, 0, 0],
  RightFrontUpLeg: [-50, 0, 20], RightFrontElbow: [-20, 0, 0],
  LeftHindUpLeg: [25, 0, -20], LeftHindHock: [-30, 0, 0],
  RightHindUpLeg: [40, 0, 20], RightHindHock: [-50, 0, 0],
  Tail: [30, 0, 0], LeftEar: [30, 0, 0], RightEar: [30, 0, 0],
};
const CRASH_HIPS_Y = -0.2; // offset from rest
const CRASH_ROOT_Z = 80 * DEG;
// Approximate lift so the rolled bear's lowest point rests near y=0 (RIG.md: "lift it so its lowest point
// sits on y = 0; at 80 deg that's the measured bounding box" -- no exact figure was handed off, so this is
// tuned by eye against the real render, not transcribed from the doc).
const CRASH_LIFT_Y = 0.28;

// Idle (title screen): RIG.md's "almost still" rest-to-idle pose.
const IDLE = {
  LeftHindHock: -25, RightHindHock: -25,
  LeftFrontLeg: -17, RightFrontLeg: -17,
  LeftFrontFoot: 11, RightFrontFoot: 11,
  LeftHindFoot: 19, RightHindFoot: 19,
};
const IDLE_HIPS_Y = -0.01;

const TRANS_DUR = { gallop: 0.15, jump: 0.1, duck: 0.12, stumble: 0.06, bonk: 0.08, idle: 0.2 };

function staticTarget(table, flip = 1) {
  const out = {};
  for (const [name, v] of Object.entries(table)) {
    if (Array.isArray(v)) out[name] = [v[0] * DEG, (v[1] || 0) * DEG, v[2] * flip * DEG];
    else out[name] = [v * DEG, 0, 0];
  }
  return out;
}

function computeTarget(bear, simPose, dt, speed) {
  const u = bear.userData;
  if (simPose === "gallop") {
    const T = Math.max(GALLOP_T_FLOOR, GALLOP_STRIDE_M / Math.max(speed, 1));
    u.phase = (u.phase + dt / T) % 1;
    const bones = {};
    for (const name of Object.keys(GALLOP)) bones[name] = [cyc(GALLOP[name], u.phase) * DEG, 0, 0];
    return { bones, hipsY: u.hipsRestY + cyc(GALLOP_HIPS_Y, u.phase), hipsScale: null, rootZ: 0,
      hipsRotX: cyc(GALLOP_HIPS_ROT_X, u.phase) * DEG };
  }
  if (simPose === "jump") return { bones: staticTarget(JUMP), hipsY: u.hipsRestY, hipsScale: null, rootZ: 0, hipsRotX: 0 };
  if (simPose === "duck") return { bones: staticTarget(DUCK), hipsY: DUCK_HIPS_Y, hipsScale: DUCK_HIPS_SCALE, rootZ: 0, hipsRotX: 0 };
  if (simPose === "stumble") return { bones: staticTarget(STUMBLE, u.stumbleFlip), hipsY: u.hipsRestY + STUMBLE_HIPS_Y, hipsScale: null, rootZ: 0, hipsRotX: 0 };
  if (simPose === "bonk") return { bones: staticTarget(CRASH), hipsY: u.hipsRestY + CRASH_HIPS_Y, hipsScale: null, rootZ: CRASH_ROOT_Z, hipsRotX: 0 };
  return { bones: staticTarget(IDLE), hipsY: u.hipsRestY + IDLE_HIPS_Y, hipsScale: null, rootZ: 0, hipsRotX: 0 }; // idle
}

const lerp = (a, b, k) => a + (b - a) * k;

// Drives the procedural pose from the sim's state, the bear equivalent of render/capy.js's pose(). simPose
// is sim.state().pose (same enum the capy reads); speed is sim.state().v. Phase-driven, not clip-driven --
// see the module header -- so this needs no AnimationMixer and no dt-based crossfade, only a short eased
// blend on a pose change (TRANS_DUR) so a pose switch doesn't pop.
export function pose(bear, simPose, dt, speed = 8) {
  if (!bear) return;
  const u = bear.userData;
  if (u.poseName !== simPose) {
    if (simPose === "stumble") u.stumbleFlip = -u.stumbleFlip;
    u.poseName = simPose; u.poseElapsed = 0;
  }
  u.poseElapsed += dt;
  const k = Math.min(1, u.poseElapsed / (TRANS_DUR[simPose] ?? 0.1));
  const target = computeTarget(bear, simPose, dt, speed);

  for (const name of BONE_NAMES) {
    const bone = u.bones[name];
    if (!bone) continue;
    const to = target.bones[name] ?? [0, 0, 0];
    const from = u.applied[name] ?? [0, 0, 0];
    const x = lerp(from[0], to[0], k), y = lerp(from[1], to[1], k), z = lerp(from[2], to[2], k);
    let ez = z;
    if (name === "Spine") ez += u.leanZ;
    else if (name === "Head") ez += u.leanZ * 0.3;
    bone.rotation.set(x, y, ez);
    u.applied[name] = [x, y, z];
  }
  if (u.bones.Hips) {
    const fromY = u.appliedHipsY ?? u.hipsRestY;
    const y = lerp(fromY, target.hipsY, k);
    u.bones.Hips.position.y = y; u.appliedHipsY = y;
    const fromRotX = u.appliedHipsRotX ?? 0;
    const rx = lerp(fromRotX, target.hipsRotX ?? 0, k);
    u.bones.Hips.rotation.x = rx; u.appliedHipsRotX = rx;
    const fromScale = u.appliedHipsScale ?? [1, 1, 1];
    const toScale = target.hipsScale ?? [1, 1, 1];
    const sx = lerp(fromScale[0], toScale[0], k), sy = lerp(fromScale[1], toScale[1], k), sz = lerp(fromScale[2], toScale[2], k);
    u.bones.Hips.scale.set(sx, sy, sz); u.appliedHipsScale = [sx, sy, sz];
  }
  const fromRootZ = u.appliedRootZ ?? 0;
  const rootZ = lerp(fromRootZ, target.rootZ, k);
  bear.rotation.z = rootZ; u.appliedRootZ = rootZ;
  // Render/scene.js applies placeAt() (which clobbers position.y to 0) after this call, then adds state.y
  // and any other render-layer offset -- same pattern as render/bird.js's birdVisualOffsetY -- so the
  // crash roll's ground-clearance lift has to be exposed for scene.js to add in afterward, not set here.
  u.crashLiftY = rootZ !== 0 ? CRASH_LIFT_Y * Math.min(1, Math.abs(rootZ) / CRASH_ROOT_Z) : 0;
}

export function crashLiftY(bear) { return bear?.userData.crashLiftY ?? 0; }
