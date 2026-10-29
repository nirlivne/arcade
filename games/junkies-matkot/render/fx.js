// G12 flash/motion caps + the reduce-motion gate. Pure: the caller passes in `now` (ms); no DOM, no
// timers. Flash budget <= 3 full-field flashes/s; chromatic <= 3/s at 120ms each; shake <= 6px in play,
// 8px on the win, <= 200ms each; reduce-motion (About/pause sheet) turns off shake, chromatic, ripple,
// sand shimmer and the zoom punch -- slow-mo, the takeovers and the score are unaffected.
const RATE_WINDOW_MS = 1000;
const RATE_MAX = 3;
export const CHROMATIC_PULSE_MS = 120;
export const SHAKE_MAX_MS = 200;
export const FLASH_COLOR_IS_SATURATED_RED_OR_WHITE = false; // the flash tint is never saturated red/white (tomato #E8402F is used, and it's local/capped, not a full strobe)

export function create({ reduceMotion = false } = {}) {
  return { reduceMotion, flashTimes: [], chromaticTimes: [] };
}

function requestFromBudget(times, now) {
  const kept = times.filter((t) => now - t < RATE_WINDOW_MS);
  if (kept.length >= RATE_MAX) return [kept, false];
  kept.push(now);
  return [kept, true];
}

export function requestFlash(ctrl, now) {
  const [flashTimes, ok] = requestFromBudget(ctrl.flashTimes, now);
  return [{ ...ctrl, flashTimes }, ok];
}

export function requestChromatic(ctrl, now) {
  const [chromaticTimes, ok] = requestFromBudget(ctrl.chromaticTimes, now);
  return [{ ...ctrl, chromaticTimes }, ok];
}

export function allowShake(ctrl) { return !ctrl.reduceMotion; }
export function allowChromaticVisual(ctrl) { return !ctrl.reduceMotion; }
export function allowRipple(ctrl) { return !ctrl.reduceMotion; }
export function allowShimmer(ctrl) { return !ctrl.reduceMotion; }
export function allowZoomPunch(ctrl) { return !ctrl.reduceMotion; }

export function shakeAmplitude(context) { return context === "win" ? 8 : 6; }
