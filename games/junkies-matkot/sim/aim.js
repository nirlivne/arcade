// THE-1184 S4 (board note 0): the CPU's pure aim solver. With no gravity, a ball's landing y after
// travelling a straight line (with wall reflections) depends only on the exit ANGLE, never on speed --
// so this inverts "I want the ball to land at wantedLandingY after N wall bounces" into the contact
// offsetRatio that sim.js's own offset-to-angle physics (both the legacy formula and impact.js) already
// produce that angle from. Pure: no clock, no Math.random, same inputs always produce the same output.
import { C } from "./constants.js";

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// Reflecting a straight line off [lo, hi] is a standard "unfold" trick: travelling past a wall is the
// same as continuing straight past it into a mirrored copy of the court repeated every `2*range` (the
// same period sim/cpu.js's own fold() uses for prediction, just inverted here -- given a desired landed
// value and bounce count, solve for the *unfolded* value that reaches it).
function unfoldedTarget(wantedLandingY, bounces, bankDir, lo, hi) {
  const range = hi - lo;
  if (bounces === 0) return wantedLandingY;
  if (bounces === 1) return bankDir >= 0 ? 2 * hi - wantedLandingY : 2 * lo - wantedLandingY;
  // bounces === 2: touching both walls once each nets a full-period shift, no mirroring.
  return wantedLandingY + bankDir * 2 * range;
}

// interceptY/contactX: where this paddle will actually touch the ball. opponentGoalX: the x this shot
// travels to (the opponent's scoring line -- C.COURT_W for the left paddle, 0 for the right one).
// wantedLandingY: the y this shot should land at when it reaches opponentGoalX. bounces: 0, 1 or 2 wall
// reflections en route. bankDir: for bounces 1/2, which of the two equally-valid banked paths to use
// (+1/-1) -- callers with no preference can just try both and keep whichever offsetRatio is smaller.
export function solveAimOffset({ interceptY, contactX, opponentGoalX, wantedLandingY, bounces, bankDir = 1, courtH, ballR }) {
  const lo = ballR, hi = courtH - ballR;
  const D = Math.abs(opponentGoalX - contactX);
  const yRaw = unfoldedTarget(clamp(wantedLandingY, lo, hi), bounces, bankDir, lo, hi);
  const slope = D > 0 ? (yRaw - interceptY) / D : 0; // dy per unit dx toward the opponent
  const maxRad = (C.CONTACT_ANGLE_MAX_DEG * Math.PI) / 180;
  const angle = Math.atan(slope);
  const offsetRatio = clamp(angle / maxRad, -1, 1);
  return { offsetRatio, angle, slope };
}
