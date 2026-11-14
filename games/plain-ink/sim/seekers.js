// Watchers: sight wedges, exposure, spotted/closeCall (spec §2.1 "Seekers see"/"Close call"/"Watchers").
import { segmentBlocked } from './los.js';

// spec: the sight wedge is "from the eye (175u up)" -- a watcher's sim y is its eye, this far
// above its feet/standing surface. render/actors.js uses this to draw the body at the right spot
// (CTO review on THE-1551: Watchers were drawn with their feet AT the eye, floating 175u high).
export const EYE_H = 175;

export function inCone(point, eye, facingAngle, halfAngleDeg, length) {
  const dx = point.x - eye.x, dy = point.y - eye.y;
  const dist = Math.hypot(dx, dy);
  if (dist > length) return false;
  const pointAngle = Math.atan2(dy, dx);
  let diff = pointAngle - facingAngle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return Math.abs(diff) <= (halfAngleDeg * Math.PI) / 180;
}

// Spec amendment A1 (CTO on THE-1581): a cone from an eye at about hero height has almost no
// vertical spread near the eye, so a hero could always jump over the far cone and land/run through
// a Watcher's body at close range without ever testing "in cone". Any hero point within NEAR_R of
// the eye (any direction) now also counts as seen -- still gated by LOS and hidden, same as the
// cone test. Lamps are exempt: the beam is the only thing a lamp senses with.
export const NEAR_R = 160;
function anyPointInCone(target, eye, facingAngle, halfAngleDeg, length, isLamp) {
  return ['head', 'centre', 'feet'].some((k) => inCone(target[k], eye, facingAngle, halfAngleDeg, length)
    || (!isLamp && Math.hypot(target[k].x - eye.x, target[k].y - eye.y) <= NEAR_R));
}

// THE-1618 (CTO review on THE-1557): the route bot's own "is this gap crossing safe" check was a
// distance-only model that missed facing, the cone's narrow half-angle, and letters blocking line
// of sight -- producing a false "no safe window" finding for a gap the real exposure rule actually
// clears twice a cycle. This is the same precondition stepWatcher's own `active` flag uses (cone or
// NEAR_R, and LOS), factored out as a pure, stateless check so a tool can plan a dash against the
// exact rule run.js uses instead of reinventing an approximation of it.
export function exposedAt(eye, facingAngle, halfAngleDeg, length, isLamp, target, losRects) {
  if (!anyPointInCone(target, eye, facingAngle, halfAngleDeg, length, isLamp)) return false;
  return !['head', 'centre', 'feet'].every((k) => segmentBlocked(eye, target[k], losRects));
}

// A full back-and-forth horizontal patrol (spec §2.1 "Watchers": "Before every turn: head-tilt
// pose 0.5s, then a 0.25s turn. Patrol-end dwell 1.5s."), walking between xMax (facing left/PI)
// and xMin (facing right/0). Deterministic in elapsed seconds, like every other patrol in this
// game, so a checkpoint replay is identical every time. During the turn window, facingAngle
// interpolates linearly between the two facings rather than snapping, so the cone actually sweeps
// across the turn instead of leaving an instant, momentarily-undefended flip.
export function patrolSweep(tSec, { xMin, xMax, speed, headTiltS = 0.5, turnS = 0.25, dwellS = 1.5 }) {
  const legS = (xMax - xMin) / speed;
  const endS = headTiltS + turnS + dwellS;
  const cycleS = legS + endS;
  const periodS = cycleS * 2;
  let t = tSec % periodS;
  if (t < 0) t += periodS;

  function endPhase(elapsed, oldFacing, newFacing) {
    if (elapsed < headTiltS) return oldFacing;
    if (elapsed < headTiltS + turnS) {
      const p = (elapsed - headTiltS) / turnS;
      return oldFacing + (newFacing - oldFacing) * p;
    }
    return newFacing;
  }

  if (t < legS) return { x: xMax - speed * t, facingAngle: Math.PI };
  let rest = t - legS;
  if (rest < endS) return { x: xMin, facingAngle: endPhase(rest, Math.PI, 0) };
  rest -= endS;
  if (rest < legS) return { x: xMin + speed * rest, facingAngle: 0 };
  rest -= legS;
  return { x: xMax, facingAngle: endPhase(rest, 0, Math.PI) };
}

export const SPOTTED_S = 0.3;
export const LONG_GRACE_S = 0.6; // spec §8 comfort "Longer grace"
export const CLOSE_CALL_S = 0.15;

// maxExposure: a rehearsal/decoy seeker (spec beat 7, L1) whose exposure caps below SPOTTED_S, so
// it can build a close call but can never spot -- "it can't snip."
export function newWatcher({ x, y, speed = 180, halfAngleDeg = 22, length = 760, facingAngle = 0, maxExposure = Infinity }) {
  return { x, y, speed, halfAngleDeg, length, facingAngle, maxExposure, exposure: 0, peak: 0, spottedFired: false };
}

export function stepExposure(exposure, dt, { inCone, los, hidden }) {
  return inCone && los && !hidden ? exposure + dt : 0;
}

// target: { head, centre, feet } points of the hero's body box.
// spottedS: the exposure that spots (SPOTTED_S, or LONG_GRACE_S with the comfort on).
export function stepWatcher(watcher, dt, target, { losBlocked = false, hidden = false, spottedS = SPOTTED_S } = {}) {
  const eye = { x: watcher.x, y: watcher.y };
  const active = anyPointInCone(target, eye, watcher.facingAngle, watcher.halfAngleDeg, watcher.length, watcher.isLamp) && !losBlocked && !hidden;
  const prevExposure = watcher.exposure;
  const events = [];
  let { exposure, peak, spottedFired } = watcher;

  if (active) {
    exposure = prevExposure + dt;
    if (watcher.maxExposure !== undefined) exposure = Math.min(exposure, watcher.maxExposure);
    peak = Math.max(peak, exposure);
    if (exposure >= spottedS && !spottedFired) {
      events.push({ type: 'spotted' });
      spottedFired = true;
    }
  } else {
    if (prevExposure > 0 && peak >= CLOSE_CALL_S && peak < spottedS) {
      events.push({ type: 'closeCall' });
    }
    exposure = 0;
    peak = 0;
    spottedFired = false;
  }

  return { watcher: { ...watcher, exposure, peak, spottedFired }, events };
}
