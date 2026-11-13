// Seeded RNG (mulberry32): same seed -> same run, every time. No Math.random anywhere in sim/.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Resolves the run seed the same way everywhere: ?seed=N, else a fresh one from Date.now().
export function resolveSeed(search) {
  const m = /(?:^|[?&])seed=(\d+)/.exec(search || "");
  return m ? Number(m[1]) >>> 0 : (Date.now() >>> 0);
}
