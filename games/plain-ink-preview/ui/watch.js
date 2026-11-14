// SEE THE ROUTE: the route bot's own clean run, replayed through the real sim so a stuck player can
// watch the level being solved. The tape (data/solution.js, built by tools/plain-ink-solution.mjs) is
// one intent per 120 Hz tick, run-length encoded as [mask, count, mask, count, ...]. Pure.
export const BIT = { left: 1, right: 2, jumpHeld: 4, jumpPressed: 8, flipPressed: 16 };

export const maskOf = (i) => (i.left ? 1 : 0) | (i.right ? 2 : 0) | (i.jumpHeld ? 4 : 0) | (i.jumpPressed ? 8 : 0) | (i.flipPressed ? 16 : 0);
export const intentOf = (m) => ({ left: !!(m & 1), right: !!(m & 2), jumpHeld: !!(m & 4), jumpPressed: !!(m & 8), flipPressed: !!(m & 16) });

export function encodeTape(intents) {
  const rle = [];
  for (const intent of intents) {
    const m = maskOf(intent);
    if (rle.length && rle[rle.length - 2] === m) rle[rle.length - 1] += 1;
    else rle.push(m, 1);
  }
  return rle;
}

export function decodeTape(rle) {
  let n = 0;
  for (let i = 1; i < rle.length; i += 2) n += rle[i];
  const out = new Uint8Array(n);
  for (let i = 0, at = 0; i < rle.length; i += 2) { out.fill(rle[i], at, at + rle[i + 1]); at += rle[i + 1]; }
  return out;
}

export const SPEEDS = [1, 2, 4];
export const nextSpeed = (s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length];
// a one-tick press (JUMP, FLIP) stays lit this long on the key row, so the eye can catch it
export const PRESS_LIT_TICKS = 30;
// after the last hide the picture holds this long, then the player gets the game back
export const END_HOLD_TICKS = 240;
