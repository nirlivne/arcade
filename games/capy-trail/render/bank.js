// Procedural lean/camera-bank signal (CTO item 4, THE-1259 2026-11-05 22:43Z; spec §7: capy lean 15 deg,
// camera bank 4 deg with a 0.25 s lead into corners; G18: off under reduce motion). Pure function of sim
// state -- no three.js needed, so this is plain-node testable. Returns a normalized -1..1 signal: sign is
// turn/step direction (negative = left), magnitude is how "into" the bank we are right now. Callers scale
// it separately for the capy's own lean (15 deg) and the camera's roll (4 deg).
const CORNER_LEAD = 0.25; // the bank reaches full strength this many seconds before the corner centre
const CORNER_WINDOW_AHEAD = 1.25; // starts ramping up from here (matches sim.js's TURN_BEFORE+TURN_BUFFER)
const CORNER_WINDOW_BEHIND = -0.25; // fully faded by here (matches sim.js's TURN_AFTER)

function laneBank(state) {
  if (state.stepLane === null) return 0;
  const dir = Math.sign(state.stepLane - state.lane);
  return dir * Math.sin(Math.min(Math.max(state.stepT, 0), 1) * Math.PI); // 0 -> 1 -> 0 across the step
}

function cornerBank(state) {
  const upcoming = state.junctions.filter((j) => !j.resolved && j.s > state.s - 5);
  if (upcoming.length === 0) return 0;
  const j = upcoming.reduce((a, b) => (a.s < b.s ? a : b));
  const v = Math.max(state.v, 1);
  const tToCorner = (j.s - state.s) / v;
  if (tToCorner > CORNER_WINDOW_AHEAD || tToCorner < CORNER_WINDOW_BEHIND) return 0;
  let amt;
  if (tToCorner > CORNER_LEAD) amt = 1 - (tToCorner - CORNER_LEAD) / (CORNER_WINDOW_AHEAD - CORNER_LEAD);
  else amt = (tToCorner - CORNER_WINDOW_BEHIND) / (CORNER_LEAD - CORNER_WINDOW_BEHIND);
  amt = Math.max(0, Math.min(1, amt));
  const dir = j.dir === "L" ? -1 : 1; // matches the lane-offset sign convention used elsewhere (render/scene.js signpost placement)
  return dir * amt;
}

export function computeBank(state, reduceMotion) {
  if (reduceMotion) return 0;
  const bank = laneBank(state) + cornerBank(state);
  return Math.max(-1, Math.min(1, bank));
}

// CTO fix B10 (THE-1259 S2 review, 2026-11-05 23:53Z): on `45e9994`, a right step tilted the capy left
// and rolled the camera left (and a left corner did the opposite) -- both consumers of computeBank()'s
// signal had the sign backwards relative to the screen. computeBank() itself is unchanged (the CTO
// confirmed it passes); these wrap it with the per-consumer sign and the spec's own magnitudes (G4: capy
// lean 15 deg; spec §7: camera bank 4 deg) so the fix -- and a regression test for it -- lives in one
// place instead of at each call site in render/scene.js.
export const CAPY_LEAN_MAX = 15 * (Math.PI / 180);
export const CAMERA_BANK_MAX = 4 * (Math.PI / 180);

export function capyLeanAngle(state, reduceMotion) {
  return computeBank(state, reduceMotion) * CAPY_LEAN_MAX;
}

export function cameraRollAngle(state, reduceMotion) {
  return -computeBank(state, reduceMotion) * CAMERA_BANK_MAX;
}
