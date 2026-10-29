// Seeded mulberry32: deterministic, fast, good enough spread for a serve angle / CPU jitter. No
// Math.random anywhere in sim/.
export function createRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Uniform float in [min, max).
export function range(rng, min, max) { return min + rng() * (max - min); }
