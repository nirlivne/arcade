// Seeded RNG (mulberry32): the only randomness in the game. Pure.
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

// Local calendar date (YYYY-MM-DD) folded to a 32-bit seed, so the nightly table deals the same lineup and
// deck to everyone on the same local day, independent of the free-play seed.
export function seedFromDate(dateStr) {
  let h = 0x811c9dc5;
  for (let i = 0; i < dateStr.length; i++) {
    h ^= dateStr.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

// Fisher-Yates, seeded. Does not mutate the input.
export function shuffle(rng, arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
