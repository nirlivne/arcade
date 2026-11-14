// Lamps: sweeping cream beams, a seeker and a hiding shape at once (spec §2.1 "Lamps").
// A lamp reuses seekers.js's stepWatcher/inCone for "sees" -- this module only owns the two things
// that are lamp-specific: the deterministic sweep angle, and the beam's floor footprint, which
// run.js feeds into coverWorldAt as a 'back' cream shape so the existing cover()/hidden() pipeline
// picks it up unchanged ("beam = cream hiding shape and a seeker").

export const LAMP_HALF_ANGLE_DEG = 12;
export const SWEEP_HALF_DEG = 25;
export const SWEEP_RATE_DEG_S = 18;
export const HOLD_S = 1.0;
export const SWAY_S = 0.5;

const SWEEP_S = (SWEEP_HALF_DEG * 2) / SWEEP_RATE_DEG_S; // one-way travel time
const END_S = HOLD_S + SWAY_S; // stationary at each end: spec "readable >= 1.5s ahead"
const LEG_S = SWEEP_S + END_S;
const PERIOD_S = LEG_S * 2;

// Degrees offset from the lamp's centre facing, oscillating continuously between -25 and +25.
// Deterministic in elapsed seconds (same pattern as level1's Watcher patrols), so every retry of
// a checkpoint replays the identical sweep (spec "Snipped": "every retry is the same").
export function sweepOffsetDeg(tSec) {
  let t = tSec % PERIOD_S;
  if (t < 0) t += PERIOD_S;
  if (t < SWEEP_S) return -SWEEP_HALF_DEG + SWEEP_RATE_DEG_S * t;
  if (t < SWEEP_S + END_S) return SWEEP_HALF_DEG;
  const t2 = t - SWEEP_S - END_S;
  if (t2 < SWEEP_S) return SWEEP_HALF_DEG - SWEEP_RATE_DEG_S * t2;
  return -SWEEP_HALF_DEG;
}

// L3 the R2 code bulb (spec §3.4, THE-1559 Q5): blinks twice, then pauses -- 0.25 s on, 0.3 s off,
// 0.25 s on, 1.5 s dark, in sim ticks (120 Hz). N = 2 is fixed in this data. Each lit pulse is
// shorter than SPOTTED_S (0.3 s) and the bulb sees nothing while dark, so exposure resets between
// pulses (CTO rule): the bulb alone can cause a close call but never a snip.
const BULB_PHASES = [30, 36, 30, 180]; // on, off, on, off (ticks)
export const BULB_CYCLE_TICKS = BULB_PHASES.reduce((a, b) => a + b, 0);
export function bulbLit(tick) {
  let t = ((tick % BULB_CYCLE_TICKS) + BULB_CYCLE_TICKS) % BULB_CYCLE_TICKS;
  for (let i = 0; i < BULB_PHASES.length; i++) {
    if (t < BULB_PHASES[i]) return i % 2 === 0;
    t -= BULB_PHASES[i];
  }
  return false;
}

// Where the beam's two edge rays (centre angle +/- halfAngleDeg) hit floorY, as an axis-aligned
// rect banded generously above the floor (a flat-rect approximation of the wedge, like the rest of
// cover.js's authored-rect shapes; the cone is only 12deg wide so the narrowing over one body
// height is small). null if either edge ray points away from the floor.
const FOOTPRINT_BAND_H = 400;
export function beamFootprint(eye, facingAngleRad, halfAngleDeg, floorY) {
  const half = (halfAngleDeg * Math.PI) / 180;
  const dy = floorY - eye.y;
  const xAt = (theta) => {
    const s = Math.sin(theta);
    if (s <= 0) return null;
    return eye.x + Math.cos(theta) * (dy / s);
  };
  const xLeft = xAt(facingAngleRad - half);
  const xRight = xAt(facingAngleRad + half);
  if (xLeft === null || xRight === null) return null;
  const x0 = Math.min(xLeft, xRight), x1 = Math.max(xLeft, xRight);
  return { x: x0, y: floorY - FOOTPRINT_BAND_H, w: x1 - x0, h: FOOTPRINT_BAND_H, ink: 'cream', layer: 'back', label: 'beam' };
}
