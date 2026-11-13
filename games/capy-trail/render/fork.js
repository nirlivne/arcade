// The junction fork (CTO item 1, THE-1259 2026-11-05 22:43Z): "straight ahead, a short stub (about 6-8 m)
// ends in a visible dead end... the branch turns 90°... When the turn is taken, the capy follows the
// branch. When it's missed, the capy runs straight on into the dead end; it doesn't follow the bend."
// Pure geometry (no three.js needed beyond Vector3 math), so this is plain-node testable independent of
// a renderer. render/scene.js uses it both to build the stub's dead-end visual and to override the capy's
// rendered position during a missed-corner crash gag.
import * as THREE from "three";
import { CORNER_PIN } from "./look.js";

export const STUB_LENGTH = 7; // CTO: "about 6-8 m"
// THE-1281 (CTO direction on THE-1280): the corner is now a true CORNER_R=5 m arc spanning
// [j.s-CORNER_PIN, j.s+CORNER_PIN] (render/look.js), so the incoming-heading chord this used to sample
// (j.s-2 to j.s) is now about 22 deg into the bend, not "still straight". The stub leaves from the arc's
// own start instead, along the real tangent there -- exact, not an approximation -- and its length grows
// by CORNER_PIN so the dead end still lands about STUB_LENGTH past the corner itself (j.s), matching the
// original "about 6-8 m past the corner" intent.
const STUB_LENGTH_FROM_ARC_START = STUB_LENGTH + CORNER_PIN;

export function stubDirection(trail, junctionS) {
  const arcStartS = Math.max(0, junctionS - CORNER_PIN);
  const { p, t } = trail.at(arcStartS);
  const dir = new THREE.Vector3(t.x, 0, t.z);
  if (dir.lengthSq() < 1e-9) dir.set(0, 0, 1); else dir.normalize();
  return { origin: p, dir };
}

export function stubEnd(trail, junctionS, length = STUB_LENGTH_FROM_ARC_START) {
  const { origin, dir } = stubDirection(trail, junctionS);
  return { x: origin.x + dir.x * length, z: origin.z + dir.z * length };
}

// The capy's rendered position on a missed corner: `t` is progress (0..1) into the dead-end overrun
// (render-layer time, not sim.s -- sim.s freezes the instant a post-grace miss crashes the run, so a live
// sim distance can't drive "running into the dead end"; the overrun is cosmetic motion during the crash
// gag, same idea as the topper bounce-off). `t=0` is the branch position at the junction, `t=1` is the
// stub's dead end.
export function missedCornerPosition(trail, junctionS, t) {
  const { origin, dir } = stubDirection(trail, junctionS);
  const clamped = Math.max(0, Math.min(1, t));
  const dist = STUB_LENGTH_FROM_ARC_START * clamped;
  return { x: origin.x + dir.x * dist, z: origin.z + dir.z * dist };
}

// The capy's rendered position on a *taken* corner: unaffected, just the normal branch position.
export function takenCornerPosition(trail, s) {
  return trail.at(Math.max(0, Math.min(trail.len, s))).p;
}
