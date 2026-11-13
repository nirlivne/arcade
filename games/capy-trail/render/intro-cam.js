// P3 (THE-1324): the run-start reveal. The camera opens high and off to one side over the start, looking a
// long way down the trail, and eases into the chase camera's own pose. k = 0..1 (game.js's intro timer).
import * as THREE from "three";

// high and back, so the capy and its geese sit in the lower third with the trail running away ahead (also
// the title shot, P5: close enough that the capy chewing and the geese behind it read)
const START_UP = 10, START_BACK = 16, START_SIDE = -4, START_LOOK_AHEAD = 30;
// A13.2.C1 (THE-1318 review): the title shot is this same start pose, with the title card now sitting at
// screen-left (A13.2). START_SIDE's sign flipped (was +4): moving the camera to the *left* of the trail
// pushes the capy's own screen position right, clear of the card -- the old +4 put it inside the card's
// column (confirmed via __capyDebug.capyScreenBox(), tools/capy-trail-tests/title-overlap.test.mjs). The
// old ±3 m side sway swung the capy across the card's full width; narrowed to ±1 m so it drifts without
// crossing back into the card.
const TITLE_SIDE_SWAY = 1.0;
export function easeInOutCubic(k) { return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; }

// Blends `chase` (the chase camera for this frame, already posed) from the high start pose; mutates it.
// swayT (seconds, or null under reduce motion): P5's slow title drift, eased out as the intro settles.
export function applyIntroCam(chase, trail, s, k, chaseAhead = 9, swayT = null) {
  const e = easeInOutCubic(Math.max(0, Math.min(1, k)));
  const sway = swayT === null ? 0 : 1 - e;
  const side = START_SIDE + sway * TITLE_SIDE_SWAY * Math.sin(swayT * 0.23), up = START_UP + sway * 1.2 * Math.sin(swayT * 0.17);
  const a = trail.at(s - START_BACK), far = trail.at(Math.min(trail.len, s + START_LOOK_AHEAD));
  const near = trail.at(Math.min(trail.len, s + chaseAhead));
  const startPos = new THREE.Vector3(a.p.x + a.side.x * side, up, a.p.z + a.side.z * side);
  const look = new THREE.Vector3(far.p.x + (near.p.x - far.p.x) * e, 0.6 * e, far.p.z + (near.p.z - far.p.z) * e);
  chase.position.lerpVectors(startPos, chase.position.clone(), e);
  chase.lookAt(look);
  return chase;
}
