// Deterministic RNG (mulberry32) + daily-seed helpers. Pure, no DOM, no Date.now().
// Two streams per run: `sim` (turbulence, gusts, crosswind, drift side, door wander, aisle layout, float
// times) and `fx` (shake noise, debris, cosmetic picks) so cosmetics never move the sim hash.

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
// Recreate a stream exactly where it left off: mulberry32(saved.state).

// Two independent streams derived from one run seed.
export function createStreams(seed) {
  return {
    sim: mulberry32(seed >>> 0),
    fx: mulberry32((seed ^ 0x9e3779b9) >>> 0),
  };
}

// FNV-1a hash of a "YYYY-MM-DD" string into a 32-bit seed.
export function seedFromDate(localYMD) {
  let h = 0x811c9dc5;
  for (let i = 0; i < localYMD.length; i++) {
    h ^= localYMD.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Calendar days between two "YYYY-MM-DD" local-date strings (+1), e.g. for a launch-day counter.
// Parses the components directly (never the real UTC offset) so this is pure local-calendar math.
export function dayNumber(localYMD, epochYMD) {
  const parse = (s) => s.split("-").map(Number);
  const [y1, m1, d1] = parse(localYMD);
  const [y0, m0, d0] = parse(epochYMD);
  const ms = Date.UTC(y1, m1 - 1, d1) - Date.UTC(y0, m0 - 1, d0);
  return Math.floor(ms / 86400000) + 1;
}
