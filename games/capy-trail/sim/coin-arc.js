// P2 (THE-1322, board feedback #2 item 6): coins over a jump obstacle trace the real jump, `__/--\__`.
// A plain placeable block (G1e): s (the obstacle, where the apex should be), lane and v (speed) in, coins
// out. No clock, no Math.random. The ideal take-off is half the air time before s, so the arc spans
// s - v*JUMP_AIR/2 .. s + v*JUMP_AIR/2 and each coin sits where a capy that took off then would be.
import { JUMP_AIR, COIN_HOVER, jumpHeight } from "./jump.js";

export { COIN_HOVER };
const ARC_SPACING = 1.2; // roughly; the count is rounded to an even number so one coin sits on the apex

export function placeJumpArc(s, lane, v) {
  const air = v * JUMP_AIR;
  let n = Math.max(6, Math.round(air / ARC_SPACING));
  if (n % 2) n++;
  const coins = [];
  for (let k = 0; k <= n; k++) {
    const p = k / n;
    // THE-1398: `p` (the coin's own fraction of the *normal* jump's air time/distance) rides along so
    // arcHeightNow() can re-derive this exact coin's height under a Spring Paws jump -- air time scales,
    // so a coin's fraction of the *bigger* flight isn't the same number, and jumpHeight's parabola isn't
    // invertible from `y` alone (two `p` solutions, one per side of the apex).
    coins.push({ s: s - air / 2 + air * p, lane, y: COIN_HOVER + jumpHeight(p), arc: true, p });
  }
  return coins;
}
