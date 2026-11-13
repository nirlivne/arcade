// Spec amendment A12.1/A12.7 (THE-1297, L1 slice): converts one picked chunk's time-relative `row` events
// into world `s` -- one hazard record per non-empty cell (sim.js hit-testing stays per lane, A12.1's own
// requirement) -- and auto-generates the A12.7 G1/G2/G4 guide coin line for every row of width >= 2. The
// old single-lane `hazard` event and its hand-authored `coinLine`/`jumpArc` pairing are gone; `coinLine`
// and `bait` remain as plain, hand-authored coin primitives (the opening's lead-in line, and a chunk's own
// side incentive) unrelated to a row's own guidance.
import { LANES } from "./track.js";
import { placeJumpArc } from "./coin-arc.js";

const ARC_TAIL_COINS = 2; // P2: the `__` after the landing
// A12.7 G1: "1.5-2.0 s before the row". The nominal lead is measured at the row's own placement-time `v`,
// but a row can sit several seconds into its chunk, and a chunk itself is placed up to ~6 s ahead of the
// player (patterns.js's lookahead buffer) -- while speed is still ramping (true before ~90 s) the *real*,
// measured lead (an actual trajectory's elapsed time between the guide's first coin and the row) lands
// under the nominal one, the same shrinkage chunks.js's own header already documents for row-to-row gaps.
// Generating at the top of the allowed range, not the bottom, keeps the real lead at or above 1.5 s
// instead of just barely on the 1.5 s floor where this shrinkage can tip it under (measured: a 1.5 s
// nominal lead early in the ramp can land as low as ~1.0 s real).
export const GUIDE_LEAD_T = 2.0;
export const GUIDE_LINE_SPACING = 2; // A12.7 G3 (reused): "2 m apart"
export const GUIDE_TRAP_WINDOW_T = 1.0; // A12.7 G4/R5: "no coin within 1.0 s before a block cell ... in the same lane"
// A12.1's own guide-lane pick order: an empty cell first, then low (becomes an arc), then either (also an
// arc, A12.7 G2), then high (stays a flat line at hover height -- a sliding capy still picks it up).
const GUIDE_KIND_PRIORITY = { none: 0, low: 1, either: 2, high: 3 };

// A12.8 (widens spec §3's old 1.0 s before / 0.5 s after window): "none from 2.0 s before to 1.0 s after a
// corner centre." Distinct from sim.js's player input turn window (TURN_BEFORE/TURN_AFTER/TURN_BUFFER).
export const JUNCTION_EXCLUSION_BEFORE_T = 2.0, JUNCTION_EXCLUSION_AFTER_T = 1.0;
export function isInJunctionExclusionWindow(s, junctions) {
  return junctions.some((j) => {
    const before = JUNCTION_EXCLUSION_BEFORE_T * j.v, after = JUNCTION_EXCLUSION_AFTER_T * j.v;
    return s >= j.s - before && s <= j.s + after;
  });
}

// A12.1: "2 or 3 adjacent low/high/either cells draw as one long log / branch bar / etc." Groups a row's 3
// cells into contiguous same-kind runs and returns one hazard record per non-empty cell; every record in a
// run >= 2 wide carries the run's own width/centre lane for the renderer, and all but one (the
// representative, the lowest-|lane| member) are flagged `hiddenForMerge` so the renderer draws one merged
// prop instead of 2-3 stacked ones. Sim hit-testing (sim/sim.js) only ever reads `lane`/`kind`/`s`, so none
// of this affects what actually gets hit.
function rowHazards(cells, s) {
  const out = [];
  let i = 0;
  while (i < 3) {
    if (cells[i] === "none") { i++; continue; }
    let j = i;
    while (j + 1 < 3 && cells[j + 1] === cells[i]) j++;
    const runLanes = []; for (let k = i; k <= j; k++) runLanes.push(LANES[k]);
    const width = runLanes.length;
    const mergeCenterLane = runLanes.reduce((a, l) => a + l, 0) / width;
    const repLane = runLanes.includes(0) ? 0 : runLanes[0];
    for (const lane of runLanes) {
      out.push({ s, lane, kind: cells[i], mergeWidth: width, mergeCenterLane, hiddenForMerge: width > 1 && lane !== repLane });
    }
    i = j + 1;
  }
  return out;
}

// A12.7 G1: the guide lane for one row -- the best (lowest-priority-number) non-`block` cell, tied cases
// preferring the lane closest to centre (A12.1 D1: a full row of one kind guides over M). `isLaneTrapped`
// (chunk-aware callers only) excludes a lane whose would-be guide line has no room left after R5/G4 trims
// it against a nearby `block` cell -- picking the *next*-best lane up front instead of generating a line
// that gets chopped down to almost nothing (A12.1's own chunks can place a `block` row just 1.2 s before a
// row that would otherwise guide into that same lane; the chunk's full row-gap convention is well under
// the guide's own 2.0 s + 1.0 s reach, so this isn't a rare edge case within a chunk).
function pickGuideLane(cells, isLaneTrapped = () => false) {
  let best = null;
  for (let i = 0; i < 3; i++) {
    if (cells[i] === "block" || isLaneTrapped(LANES[i])) continue;
    const p = GUIDE_KIND_PRIORITY[cells[i]];
    if (best === null || p < best.p || (p === best.p && Math.abs(LANES[i]) < Math.abs(LANES[best.i]))) best = { i, p };
  }
  return best ? LANES[best.i] : null;
}

// A12.7 G1/G2: the guide coin line (and jump arc, if the guide lane needs a jump) for one row of width >=
// 2. A width < 2 row gets no guide (A12.1: guidance is reserved for rows that force a choice).
function rowGuideCoins(cells, s, v, isLaneTrapped) {
  const width = cells.filter((c) => c !== "none").length;
  if (width < 2) return [];
  const lane = pickGuideLane(cells, isLaneTrapped);
  if (lane === null) return []; // every cell is `block`, or every passable lane is trapped
  const kind = cells[LANES.indexOf(lane)];
  const coins = [];
  const leadM = GUIDE_LEAD_T * v;
  if (kind === "low" || kind === "either") {
    // P2 (THE-1322): `__/--__` -- the flat approach, the arc along the real jump with its apex over the
    // hazard (G2), then a short flat tail after the landing
    const arc = placeJumpArc(s, lane, v);
    const approachEnd = arc[0].s - GUIDE_LINE_SPACING;
    for (let cs = s - leadM; cs <= approachEnd; cs += GUIDE_LINE_SPACING) coins.push({ s: cs, lane });
    coins.push(...arc);
    for (let k = 1; k <= ARC_TAIL_COINS; k++) coins.push({ s: arc.at(-1).s + k * GUIDE_LINE_SPACING, lane });
  } else {
    // "none" or "high": the line stays flat at hover height straight through the row (G1: "a sliding capy
    // still picks it up")
    for (let cs = s - leadM; cs <= s; cs += GUIDE_LINE_SPACING) coins.push({ s: cs, lane });
  }
  return coins;
}

// A12.7 G4/R5: true if a coin at (coinS, lane) sits within 1.0 s (at speed `v`) before a `block` cell in
// that same lane -- "the risk is tight timing, never a wall." Checked against every hazard actually being
// placed, not just the row the coin belongs to: a chunk's own later row can still trap an earlier row's
// trailing coin. The one G4 predicate: sim/patterns.js's cross-chunk checks call it too.
export function coinBaitsIntoBlock(coinS, lane, hazards, v) {
  const windowM = GUIDE_TRAP_WINDOW_T * v;
  return hazards.some((h) => h.kind === "block" && h.lane === lane && h.s - coinS > 0 && h.s - coinS < windowM);
}

// Places one row in isolation (used both by placeChunk below and by sim/patterns.js's scripted opening,
// so the same guidance logic drives both).
export function placeRow(cells, s, v) {
  const hazards = rowHazards(cells, s);
  const coins = rowGuideCoins(cells, s, v).filter((c) => !coinBaitsIntoBlock(c.s, c.lane, hazards, v));
  return { hazards, coins };
}

export function placeChunk(chunk, startS, v) {
  // Pass 1: every row's hazards, up front -- a row's own guide pick (pass 2) needs to see the *whole*
  // chunk's block cells, not just its own, to avoid picking a lane it can't actually give a real lead in.
  const hazards = [];
  const rowSByEvent = new Map();
  for (const e of chunk.events) {
    if (e.kind !== "row") continue;
    const s = startS + e.at * v;
    rowSByEvent.set(e, s);
    for (const h of rowHazards(e.cells, s)) hazards.push(h);
  }
  const reachM = (GUIDE_LEAD_T + GUIDE_TRAP_WINDOW_T) * v;
  const isLaneTrappedAt = (s) => (lane) => hazards.some((h) => h.kind === "block" && h.lane === lane && s - h.s > 0 && s - h.s < reachM);

  const candidateCoins = [];
  for (const e of chunk.events) {
    if (e.kind === "row") {
      const s = rowSByEvent.get(e);
      for (const c of rowGuideCoins(e.cells, s, v, isLaneTrappedAt(s))) candidateCoins.push(c);
    } else if (e.kind === "coinLine" || e.kind === "bait") {
      const s = startS + e.at * v;
      for (let i = 0; i < e.count; i++) candidateCoins.push({ s: s + i * e.spacing, lane: e.lane });
    }
  }
  // A12.7 G4/R5, checked against every hazard the whole chunk places (not just the row a coin came from):
  // a chunk's own later row can still trap an earlier row's (or a bait line's) coin -- this is now mostly
  // a backstop for bait/coinLine events, since picking an untrapped lane up front already keeps a row's
  // own guide line clear.
  const coins = candidateCoins.filter((c) => !coinBaitsIntoBlock(c.s, c.lane, hazards, v));
  return { hazards, coins, endS: startS + chunk.duration * v };
}
