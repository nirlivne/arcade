// S2 (THE-1259): the baked build/make_capy.py capy.glb + AnimationMixer, replacing S1's procedural
// buildCapy() stand-in. The GLB's node names mirror S1's pivot groups 1:1 (root/body/head/eye_l/
// eye_l_lid/ear_l/topper/leg_fl/...), so lean and expression stay procedural in code exactly as S1 drove
// its THREE.Group pivots -- only the 5 clips named in G4 (idle, gallop, jump, duck, crash) are baked, and
// crash doubles as the grace-period "stumble" (see the "stumble" case in pose() below).
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export const EXPR = { deadpan: { lid: 0.0, s: 1 }, content: { lid: 1.35, s: 1 }, surprised: { lid: -0.95, s: 1.25 }, sleepy: { lid: 0.85, s: 1 }, dizzy: { lid: 0.6, s: 0.8 } };

const loader = new GLTFLoader();

// Async on purpose (GLTFLoader has no sync path); render/scene.js fires this and keeps rendering the
// rest of the world while it resolves, so a slow load is a few frames with no capy, not a blocked boot.
export async function loadCapy(url = "./assets/capy.glb", { topper = "orange" } = {}) {
  const gltf = await loader.loadAsync(url);
  const root = gltf.scene;
  const find = (name) => root.getObjectByName(name);
  const eyes = {
    l: { pivot: find("eye_l"), lid: find("eye_l_lid") },
    r: { pivot: find("eye_r"), lid: find("eye_r_lid") },
  };
  const body = find("body");
  const head = find("head");
  const topperNode = find("topper");
  const mouth = find("mouth");
  const mixer = new THREE.AnimationMixer(root);
  const clips = {};
  for (const clip of gltf.animations) clips[clip.name] = clip;
  topperNode.visible = topper === "orange"; // only topper S2 ships; S6 adds the other 3 (design -> toppers)
  // saved so render/scene.js can reattach the topper to `head` after detaching it to bounce off on a
  // crash (THREE.Object3D.attach() preserves world transform on reparent, not the original local one)
  const topperHome = { position: topperNode.position.clone(), rotation: topperNode.rotation.clone() };

  root.userData = { eyes, body, head, topper: topperNode, topperHome, mouth, mixer, clips, action: null, actionName: null };
  return root;
}

export function expr(capy, name) {
  const x = EXPR[name];
  const { eyes } = capy.userData;
  for (const side of ["l", "r"]) {
    const { pivot, lid } = eyes[side];
    if (lid) lid.rotation.x = x.lid;
    if (pivot) pivot.scale.setScalar(x.s);
  }
}

// Procedural lean (G4: "15 deg, head leads by 0.1 s"), additive on top of whatever clip is playing. The
// body carries the full bank; the head gets a bit more (1.3x) as a cheap stand-in for a literal 0.1 s
// time-lead (CTO item 4, THE-1259 2026-11-05 22:43Z: wired to lane steps and corners -- see
// render/scene.js's computeBank()).
// CTO fix B10 (THE-1259 S2 review, 2026-11-05 23:53Z): a right step tilted the capy left (and a left
// corner tilted it right) -- the sign was backwards. render/bank.js's capyLeanAngle() hands this the
// already-correctly-signed angle, so no extra negation belongs here.
export function lean(capy, bankRad) {
  const { body, head } = capy.userData;
  if (body) body.rotation.z = bankRad;
  if (head) head.rotation.z = bankRad * 0.3; // additional lead on top of the body's own bank
}

function playClip(capy, name, { loop = true, timeScale = 1 } = {}) {
  const u = capy.userData;
  const clip = u.clips[name];
  if (!clip) return null;
  if (u.actionName === name) { u.action.timeScale = timeScale; return u.action; }
  const action = u.mixer.clipAction(clip);
  action.reset();
  action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
  action.clampWhenFinished = !loop;
  action.timeScale = timeScale;
  if (u.action && u.action !== action) action.crossFadeFrom(u.action, 0.1, false);
  action.play();
  u.action = action; u.actionName = name;
  return action;
}

// Drives the mixer by a render-layer dt (visual juice, like the coin pop and particles -- not a
// gameplay timer; sim.js alone owns jump/duck/grace timing in sim time, design -> "Timers and
// animations"). simPose is sim.state().pose: "gallop" | "jump" | "duck" | "stumble" | "bonk", or "idle"
// for the title/pre-run capy, which sim.js never emits.
export function pose(capy, simPose, dt, speed = 8) {
  if (!capy) return;
  expr(capy, "deadpan");
  switch (simPose) {
    case "gallop":
      playClip(capy, "gallop", { timeScale: Math.max(speed, 1) / 8 });
      break;
    case "jump":
      playClip(capy, "jump", { loop: false });
      break;
    case "duck":
      playClip(capy, "duck", { loop: false });
      expr(capy, "content");
      break;
    case "stumble":
      // Plays "crash" forward from its own start; sim.js holds this pose for STUMBLE_T seconds of real
      // time (the grace-period stumble), so by the time it hands back to "gallop" the clip has reached
      // about its own t=STUMBLE_T mark -- the wobble pose -- without this module needing to track sim's
      // stumble timer itself.
      playClip(capy, "crash", { loop: false });
      expr(capy, "surprised");
      break;
    case "bonk":
      playClip(capy, "crash", { loop: false });
      expr(capy, "dizzy");
      // topper bounce-off is driven by render/scene.js (it needs the `scene` to reparent into world
      // space, which this module doesn't have); it watches for the sim's "hit" log entry the same way
      break;
    default:
      playClip(capy, "idle");
  }
  capy.userData.mixer.update(dt);
}
