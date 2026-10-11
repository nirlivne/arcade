// Tower definitions (THE-449 S1–S3). Level 1 is hand-placed (CTO decision on THE-456, spec amendment v4a): one high,
// far ledge that topples from any touch (touch: true), so one aimed shot clears it (par 1, 2 stars). Levels 2–30 are
// generated from their seed (generator.js) and their rows in level-table.js hold the seed, the par and the shots that
// clear it (written by tools/cannonball-family-solve.mjs). par = the fewest shots; cap = min(3, N − par) for stars.
// slots[k] = the knack on rail slot k (null = plain), set per slot. The rules never read the level number.
import { generateLevel, familySizeFor } from "./generator.js";
import { LEVEL_TABLE } from "./level-table.js";

export const LEVEL_COUNT = 30;

// THE-523 / spec v2 §B1: level 1's nearest target (the leftmost tin, x = 1040) sits exactly D = 900 past the
// cannon (x = 140). touch: true keeps the one-aimed-shot par 1 rule (CTO decision on THE-456, spec v4a) and
// makes the par-shot score deterministic (any touch downs all 4 tins at once): 4*100 tins + 100*(4-2) multi-
// down bonus + 2*1000 family bonus (2 of 3 members unused) = 2600 (spec v2 §E1, verified against sim.js).
// S3 = floor(2600*0.9 / 100)*100 = 2300 (spec §E2); S2 = S3 - 1000 = 1300.
// Tin positions use r = 22 (THE-527 feel check, spec §C8): base row spaced 2*22 apart, the top tin dropped by
// sqrt(3)*22 - the score is unaffected by r, only the geometry.
// THE-596: the v2 ballistics retune (GRAVITY 900->540, SPEED_MIN/MAX 300/900->450/1150) grew the 45°-full-power
// range ~2.7x while D only grew ~2-2.3x, so the old height (top 530, tins at y 508/469.9 - unchanged since v1)
// put the tower where a much wider slice of uniform-random (angle, power) shots passed through it. Raising the
// tower (top 530->190) moves it into a narrower band of that sweep: empirically (tools/cannonball-family-gate.mjs
// style sampling, games/cannonball-family/.scratch sweep, not shipped) this keeps the grid-probed "skilled" bot's
// clear rate >= 0.8 (3 shots/level) while random/idle clear and the uniform-random reach share both drop under
// the gate's 0.2 / 0.07 thresholds. x/width unchanged (D=900 and the 4-tin touch rule are locked).
export const LEVEL_1 = {
  N: 3, seed: 1, par: 1, S2: 1300, S3: 2300,
  slots: [null, null, null],
  ledges: [{ x0: 1008, x1: 1160, top: 90, h: 16, touch: true }],
  tins: [
    { x: 1040, y: 68, ledge: 0 },
    { x: 1084, y: 68, ledge: 0 },
    { x: 1128, y: 68, ledge: 0 },
    { x: 1084, y: 29.9, ledge: 0 },
  ],
};

// The first-run demo's ghost shot (spec §I): a proven one-shot clear of LEVEL_1, asserted in levels.test.mjs.
// THE-525 r2 D2-6: THE-596's raised tower left the old { 45, 0.5 } falling short (0 of 4 tins). This one clears,
// and so do all eight of its ±1° / ±0.01 neighbours, so a small sim change won't silently break it again.
export const DEMO_SHOT = { angle: 48, power: 0.97 };

// The definition of level n (1–30), or null for a level that doesn't exist. Levels 2–30 carry their stored
// solution. N (spec D3: par + 1/2) is resized here from the solver's real par - generateLevel() itself only
// ever sizes it from a provisional, pre-solve par band minimum, since N can't depend on a par the solver
// hasn't found yet.
export function levelDef(n) {
  if (n === 1) return LEVEL_1;
  const row = LEVEL_TABLE[n];
  if (!row) return null;
  const def = generateLevel(n, row.seed);
  return def && { ...def, N: familySizeFor(n, row.par), par: row.par, shots: row.shots };
}
