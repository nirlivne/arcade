// S4 lagoon water (ART-BRIEF.md sec5: "shallow #2FC2C0 -> deep #167E9A by a CPU shore distance
// attribute"). Pure decision logic (plain-node testable, no three.js): the colour blend itself lives in
// look.js's waterMaterial (three.js Color lerp), this is just the 0-1 ramp from a vertex's distance to
// the nearest shore edge (boardwalk/island) to how "deep" it reads.
export const WATER_SHORE_BAND = 6; // metres of shore distance over which shallow fades to deep

// 0 at the shore edge (dist 0), 1 once dist >= WATER_SHORE_BAND -- smoothstep so the edge doesn't band.
export function waterDepthT(shoreDist) {
  const x = Math.max(0, Math.min(1, shoreDist / WATER_SHORE_BAND));
  return x * x * (3 - 2 * x);
}
