// The jump curve, in one leaf module so both the sim and the coin-arc placer use the exact same numbers
// (P2, THE-1322) without an import cycle (sim -> patterns -> chunk-placer -> coin-arc).
export const JUMP_AIR = 0.65;
export const JUMP_PEAK = 1.4;
export const COIN_HOVER = 0.5; // a coin floats this high over the ground (render HOVER_Y.coin matches)
// height above the ground at fraction p (0..1) of the air time: a parabola peaking at `peak`
export function jumpHeight(p, peak = JUMP_PEAK) { return 4 * peak * p * (1 - p); }

// THE-1398 "Spring Paws": "about x1.6 height and proportionally longer" jumps. Measured
// (spring-fairness.test.mjs, the reactive bot driving real content at human cadence): a full x1.6 on
// JUMP_AIR too reliably lands an unfair hit -- the jump stays airborne into the row right after the one it
// was taken for, which the bot clears cleanly without spring. x1.45 and below measured clean; 1.3 keeps a
// real margin under that cliff. Height stays the full x1.6 the spec asks for; airtime caps short of it.
export const SPRING_HEIGHT_MULT = 1.6;
export const SPRING_AIR_MULT = 1.3;
export function jumpAirFor(spring) { return spring ? JUMP_AIR * SPRING_AIR_MULT : JUMP_AIR; }
export function jumpPeakFor(spring) { return spring ? JUMP_PEAK * SPRING_HEIGHT_MULT : JUMP_PEAK; }

// One source of truth for "arc height now" (THE-1398): a coin is placed at a fixed `s` for the *normal*
// jump's own air time (coin-arc.js); a *longer* spring jump reaches that `s` at a different fraction of
// its own flight (centred take-off, same convention as coin-arc.test.mjs's "ideal moment"). heroP restates
// the coin's own `p` as that fraction, so jumpHeight there (spring-scaled peak) is the real height the capy
// has -- a plain linear rescale of `y` drifts off the curve away from the apex. Used by sim.js's
// _checkCoins and render/scene.js alike; identity when spring isn't active. Falls back to a linear scale
// for a coin with no `p` (a hand-built fixture, never real generated content).
export function arcHeightNow(c, springActive) {
  if (!springActive) return c.y;
  if (c.p === undefined) return COIN_HOVER + (c.y - COIN_HOVER) * SPRING_HEIGHT_MULT;
  const heroP = (c.p - 0.5) / SPRING_AIR_MULT + 0.5;
  return COIN_HOVER + jumpHeight(heroP, JUMP_PEAK * SPRING_HEIGHT_MULT);
}
