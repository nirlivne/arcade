// Tower definitions (THE-449 S1–S3). Level 1 is hand-placed (CTO decision on THE-456, spec amendment v4a): one high,
// far ledge that topples from any touch (touch: true), so one aimed shot clears it (par 1, 2 stars). Levels 2–30 are
// generated from their seed (generator.js) and their rows in level-table.js hold the seed, the par and the shots that
// clear it (written by tools/cannonball-family-solve.mjs). par = the fewest shots; cap = min(3, N − par) for stars.
// slots[k] = the knack on rail slot k (null = plain), set per slot. The rules never read the level number.
import { generateLevel } from "./generator.js";
import { LEVEL_TABLE } from "./level-table.js";

export const LEVEL_COUNT = 30;

export const LEVEL_1 = {
  N: 3, seed: 1, par: 1,
  slots: [null, null, null],
  ledges: [{ x0: 460, x1: 600, top: 160, h: 16, touch: true }],
  tins: [
    { x: 490, y: 140, ledge: 0 },
    { x: 530, y: 140, ledge: 0 },
    { x: 570, y: 140, ledge: 0 },
    { x: 550, y: 105.36, ledge: 0 },
  ],
};

// The definition of level n (1–30), or null for a level that doesn't exist. Levels 2–30 carry their stored solution.
export function levelDef(n) {
  if (n === 1) return LEVEL_1;
  const row = LEVEL_TABLE[n];
  if (!row) return null;
  const def = generateLevel(n, row.seed);
  return def && { ...def, par: row.par, shots: row.shots };
}
