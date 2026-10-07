// Seeded RNG (mulberry32): the only randomness in the game, so a seed replays the same way every time. Pure.
// next.state is the generator's internal counter after its last draw (0 if never drawn), so a caller can read
// it into hash() without the rng itself needing to expose anything beyond the next() it already had (CTO
// review on THE-449: hash() didn't include the rng state, so a resumed run could pass its hash check right
// after the replay and still diverge at the next fuse-fired random shot).
export function mulberry32(seed) {
  let a = seed >>> 0;
  function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    next.state = a;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  next.state = a;
  return next;
}
