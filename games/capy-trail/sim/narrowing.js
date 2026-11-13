// Spec amendment A12.2/A12.3 (THE-1297 L1 kept this off, THE-1299 L2 turns it on): long lane-fillers and
// corridors, replacing A11's closure sequences (THE-1283). A filler is one continuous obstacle in one lane
// -- a giant fallen trunk or a boulder line, 15-50 m long (A12.2) -- and a corridor is a pair (or two) of
// fillers placed by `s` ahead of time that never react to the capy's lane, same as A11's sequences. The
// A11.1 cue code (chevrons, the lead/cue-start fields, the moss lane, "no coin in the closing-lane cue
// window") is gone: the front face itself, drawn from >= max(2.0 s * v, 25 m) out (render/scene.js), plus
// the guide coin line (A12.7 G1/G3, built below) replace it.
//
// Positions are placed via the SAME local-v linear projection (`toS`, anchored at the calling ensureAhead
// invocation's own (t, s, v)) that junctions and ordinary chunk-sourced hazards already use -- not the
// exact distanceAt integral -- so a filler's position and a junction's position stay consistently
// approximate within one ensureAhead call (see sim/patterns.js's own header for why that consistency, not
// exactness, is what the A12.8 junction-margin check actually needs).
import { placeJumpArc } from "./coin-arc.js";
import { JUMP_AIR } from "./jump.js";
import { LANES } from "./track.js";
import { GUIDE_LEAD_T, GUIDE_LINE_SPACING } from "./chunk-placer.js";

export const FILLER_KINDS = ["trunk", "boulderLine"]; // A12.2
export const FILLER_PIECE_MIN_LEN = 15, FILLER_PIECE_MAX_LEN = 50; // A12.2
export const FILLER_PIECE_GAP = 0.2; // A12.2: "gap <= 0.3 m" between 2 pieces butted end to end; stay under the cap with headroom
export const ROW_GAP_T = 0.8; // A11.3 reaction-gap floor, reused inside a corridor's own rows
export const ROW_AFTER_CLOSURE_T = 1.0, ROW_BEFORE_BOUNDARY_T = 0.8; // A12.3: "no row within 1.0 s after the first front... none within 0.8 s of any other front face or reopen point"
// Row positions are placed via `toS`'s local-v projection, not the exact distanceAt integral -- while
// speed is still ramping (true before ~90 s) a row's *measured* time lands a little earlier than its own
// nominal generation time (same shrinkage sim/chunks.js's own header documents for row-to-row gaps). A
// mixed row (independently-picked kind per lane, MIXED_ROW_MIN_T on) needs the stricter 1.0 s floor, not
// 0.8 s -- measured: a bare 1.0 s nominal gap here can land as low as ~0.90 s real at 50-90 s sim time, so
// generating at 1.3 s (not the bare 1.0 s floor placeRowTimes's own A11-era default used) keeps the
// *measured* gap safely above 1.0 s regardless of which floor the two rows end up needing.
const ROW_GAP_GENERATION_T = 1.3;
export const CORRIDOR_GAP_T = [15, 25]; // A12.3: one corridor every 15-25 s, front to front
export const FIRST_CORRIDOR_MIN_T = 32; // A12.3
export const JUNCTION_MARGIN_T = 2.5; // A11.4/A12.8: 3 lanes open +-2.5 s around every corner centre
// The scheduler samples from a tighter window than the full [15, 25] range so that a candidate landing
// just inside a junction's own +-2.5 s margin (and getting pushed out to clear it) still lands the
// *realized* gap inside [15, 25] rather than overshooting it -- the margin only ever pushes later, never
// earlier, so leaving this much headroom on the top end is the one-sided fix that headroom needs.
export const CORRIDOR_GAP_SAMPLE_T = [15, 25 - JUNCTION_MARGIN_T];
export const MIXED_ROW_MIN_T = 44; // A12.3: "mixed is allowed in a 2-lane stretch from 44 s on"
// A12.3/A12.12: shape C (split) is cut first within L2's own budget -- the board's core ask is a corridor
// that narrows and reopens (B) and one that goes to a single lane (A); the 15 % share of a THIRD shape
// that commits the player to a side is the first thing the slice map names as safe to drop. Flipping this
// back to true needs a real `rollShapeC` (none exists below) added alongside rollShapeB/rollShapeA.
export const CORRIDOR_C_ENABLED = false;

function randIn(rng, lo, hi) { return lo + rng() * (hi - lo); }

function openLanesExcluding(closedLanes) { return LANES.filter((l) => !closedLanes.includes(l)); }

// Picks `count` row times inside [windowStart, windowEnd], exactly ROW_GAP_GENERATION_T apart, shrinking
// count if the window is too short to hold it rather than ever violating the gap floor. The whole run of
// rows gets one random offset within the window's slack -- simpler and exact (by construction) than
// jittering every individual gap.
function placeRowTimes(rng, windowStart, windowEnd, minCount, maxCount) {
  const span = windowEnd - windowStart;
  if (span <= 0) return [];
  const maxFit = Math.max(1, Math.floor(span / ROW_GAP_GENERATION_T) + 1);
  let count = Math.min(maxCount, maxFit);
  count = Math.max(Math.min(minCount, maxFit), count);
  if (count <= 0) return [];
  const minSpan = (count - 1) * ROW_GAP_GENERATION_T;
  const slack = Math.max(0, span - minSpan);
  const offset = randIn(rng, 0, slack);
  const times = [];
  for (let i = 0; i < count; i++) times.push(windowStart + offset + i * ROW_GAP_GENERATION_T);
  return times;
}

function pickFillerKind(rng) { return FILLER_KINDS[Math.floor(rng() * FILLER_KINDS.length)]; }
function pickRowKind(rng) { return ["low", "high", "either"][Math.floor(rng() * 3)]; }

// A12.2: "a lane run longer than 50 m is 2 pieces butted end to end (gap <= 0.3 m). Its first piece is
// always the one with the clearest front." Splits `totalLen` into ceil(totalLen / 50) pieces (1 in the
// overwhelming majority of cases -- only a corridor's outer-lane filler, which can span the whole
// 3.0-6.2 s stretch, ever gets long enough to need 2), each a separate record for sim/sim.js's
// isLaneClosedAt / _checkClosures (both already iterate every entry in patterns.closures, so N separate
// adjoining records read as one continuously closed lane with no code change there).
export function buildFillerSpan(lane, sStart, totalLen, kind, v) {
  const n = Math.max(1, Math.ceil(totalLen / FILLER_PIECE_MAX_LEN));
  const gapTotal = (n - 1) * FILLER_PIECE_GAP;
  const pieceLen = (totalLen - gapTotal) / n;
  const pieces = [];
  let s = sStart;
  for (let i = 0; i < n; i++) {
    const sEnd = s + pieceLen;
    pieces.push({ lane, sStart: s, sEnd, kind, v, hit: false, cleared: false });
    s = sEnd + FILLER_PIECE_GAP;
  }
  return pieces;
}

// G1e (CEO, THE-1247; CTO review THE-1300): a corridor is a plain-data block -- { type, shape, dur,
// guideLane, fillers: [{lane, from, to, kind}], rows: [{at, lanes, kinds}] }, every time an offset in
// seconds from its own front face. The endless spawner rolls one (rollCorridor: the only place that knows
// the run clock, A12.3's shape shares and the 44 s mixed-row rule, all passed in) and placeCorridor puts it
// at any `s` and speed `v` with no clock, ramp or RNG of its own -- so update 1's level generator can hand
// placeCorridor a fixed list instead (tools/capy-trail-tests/narrowing.test.mjs does exactly that).

// A12.3: rows inside a corridor stretch -- `low`/`high`/`either` only, across every lane open during
// [from, to] (the same kind in every lane by default; with `mixedEligible`, a row may instead pick its
// kind per lane independently). No `block`, ever (A12.3: "there's no block inside a corridor").
function rollCorridorRows(rng, from, to, openLanes, mixedEligible) {
  return placeRowTimes(rng, from + ROW_AFTER_CLOSURE_T, to - ROW_BEFORE_BOUNDARY_T, 1, 2).map((at) => {
    const mixed = openLanes.length > 1 && mixedEligible && rng() < 0.5;
    const shared = mixed ? null : pickRowKind(rng);
    return { at, lanes: openLanes, kinds: openLanes.map(() => (mixed ? pickRowKind(rng) : shared)) };
  });
}

// Shape B (3 -> 2 -> 3): one filler in an outer lane for the whole stretch (A12.3: 1.2-3.0 s).
// At the first corridor's ~12.5 m/s a 1.2 s draw is under A12.2's 15 m floor, so the floor wins there.
function rollShapeB(rng, v, mixedEligible) {
  const dur = Math.max(randIn(rng, 1.2, 3.0), FILLER_PIECE_MIN_LEN / Math.max(v, 1));
  const outerFirst = rng() < 0.5 ? -1 : 1;
  const fillers = [{ lane: outerFirst, from: 0, to: dur, kind: pickFillerKind(rng) }];
  const rows = rollCorridorRows(rng, 0, dur, openLanesExcluding([outerFirst]), mixedEligible);
  // A12.7 G1: the guide line steers into "whichever lane stays open longest" -- shape B's centre lane is
  // in the open set for the whole stretch (only an outer lane ever closes), so it's always that one.
  return { type: "corridor", shape: "B", dur, guideLane: 0, fillers, rows };
}

// Shape A (3 -> 2 -> 1 -> (2 ->) 3): an outer filler for the 2-lane approach (1.2-2.0 s), then a second
// filler in one of the 2 open lanes for the 1-lane corridor (1.8-3.0 s, capped so its own piece never
// exceeds the 50 m single-piece length -- A12.3's own "the 50 m piece cap binds" note at 22 m/s). An
// optional tail (0-1.2 s, ~50 % of A) lets the second filler reopen before the first, so the lane count
// goes 1 -> 2 -> 3 instead of straight 1 -> 3.
// `v` (the speed the corridor will be placed at) only bounds the two piece lengths, A12.2's 15-50 m.
function rollShapeA(rng, v, mixedEligible) {
  const approachDur = randIn(rng, 1.2, 2.0);
  const outerFirst = rng() < 0.5 ? -1 : 1;
  const oneLaneDur = Math.min(randIn(rng, 1.8, 3.0), FILLER_PIECE_MAX_LEN / Math.max(v, 1));
  // The tail shortens the second filler's own physical piece (it reopens before the first) -- cap it so
  // that piece never drops under the A12.2 15 m floor, and skip the tail outright on a draw too tight to
  // fit even the minimum (0.1 s) tail and still clear the floor.
  const maxTailDur = Math.min(1.2, oneLaneDur - FILLER_PIECE_MIN_LEN / Math.max(v, 1));
  const hasTail = rng() < 0.5 && maxTailDur > 0.1;
  const tailDur = hasTail ? randIn(rng, 0.1, maxTailDur) : 0;
  const dur = approachDur + oneLaneDur;
  const secondReopen = dur - tailDur;

  const openAfterFirst = openLanesExcluding([outerFirst]);
  const secondLane = openAfterFirst[Math.floor(rng() * openAfterFirst.length)];
  const open1Lane = openLanesExcluding([outerFirst, secondLane]);
  const fillers = [
    { lane: outerFirst, from: 0, to: dur, kind: pickFillerKind(rng) },
    { lane: secondLane, from: approachDur, to: secondReopen, kind: pickFillerKind(rng) },
  ];
  const rows = [
    ...rollCorridorRows(rng, 0, approachDur, openAfterFirst, mixedEligible),
    ...rollCorridorRows(rng, approachDur, secondReopen, open1Lane, mixedEligible),
  ];
  // A12.7 G1: shape A's single surviving lane (open1Lane's one entry) is open from the very start all the
  // way to its own reopen -- the longest-open lane of the whole corridor, by construction.
  return { type: "corridor", shape: "A", dur, guideLane: open1Lane[0], fillers, rows, secondLane, secondAt: approachDur, hasTail, tailDur };
}

// The endless spawner's half: rolls one corridor block. `isFirst` forces shape B (A12.3: "first corridor
// of every run ... shape B"); `atT` is the run time the corridor lands at (shape shares, A12.3's 44 s mixed
// rows); `v` is the speed it will be placed at.
export function rollCorridor(rng, { isFirst, atT, v }) {
  let shape;
  if (isFirst) shape = "B";
  else if (!CORRIDOR_C_ENABLED) shape = rng() < (atT >= 120 ? 45 / 85 : 0.55) ? "A" : "B";
  else shape = atT < 120 ? (rng() < 0.55 ? "A" : "B") : (() => { const r = rng(); return r < 0.45 ? "A" : r < 0.85 ? "B" : "C"; })();
  const mixedEligible = atT >= MIXED_ROW_MIN_T;
  if (shape === "A") return rollShapeA(rng, v, mixedEligible);
  return rollShapeB(rng, v, mixedEligible); // shape C isn't built while CORRIDOR_C_ENABLED is false
}

// The placer: puts a corridor block's front face at `s`, at speed `v`. Pure -- same block, s and v in,
// same records out. `t` only labels the output's times (startT/endT/row `t`) for the spawner's own
// spacing and junction checks; nothing here depends on it. The guide coin line (A12.7 G1/G3) is part of
// the block: from 2.0 s before the front face to the reopen, in `guideLane`, which never closes during the
// corridor it belongs to, so one straight line covers it.
export function placeCorridor(block, s, v, t = 0) {
  const at = (dt) => s + dt * v;
  const fillers = block.fillers.flatMap((f) => buildFillerSpan(f.lane, at(f.from), (f.to - f.from) * v, f.kind, v));
  const rows = block.rows.flatMap((r) => r.lanes.map((lane, i) => ({ s: at(r.at), t: t + r.at, lane, kind: r.kinds[i] })));
  const endS = at(block.dur);
  const coins = [];
  // P2 (THE-1322): a log on the guide lane gets the real jump arc in place of the flat line over it
  const jumps = rows.filter((r) => r.lane === block.guideLane && (r.kind === "low" || r.kind === "either"));
  const nearJump = (cs) => jumps.some((r) => Math.abs(cs - r.s) <= (v * JUMP_AIR) / 2 + GUIDE_LINE_SPACING / 2);
  for (let cs = s - GUIDE_LEAD_T * v; cs <= endS; cs += GUIDE_LINE_SPACING) if (!nearJump(cs)) coins.push({ s: cs, lane: block.guideLane });
  for (const r of jumps) coins.push(...placeJumpArc(r.s, r.lane, v));
  coins.sort((a, b) => a.s - b.s);
  const placed = { shape: block.shape, fillers, rows, coins, frontS: s, endS, startT: t, endT: t + block.dur, guideLane: block.guideLane };
  if (block.shape === "A") Object.assign(placed, { secondLane: block.secondLane, secondFrontT: t + block.secondAt, hasTail: block.hasTail, tailDur: block.tailDur });
  return placed;
}

// True if `s` falls inside a filler's own run, or inside *any* corridor's overall span (used by the chunk
// placer to keep ordinary chunk-sourced hazards -- which can be `block`-kind or force a lane change, both
// forbidden on a corridor, A12.3 -- off a corridor's span entirely).
export function isLaneClosedAt(lane, s, fillers) {
  return fillers.some((f) => f.lane === lane && s >= f.sStart && s <= f.sEnd);
}
export function isInCorridorSpan(s, corridorSpans) {
  return corridorSpans.some((sp) => s >= sp.sStart && s <= sp.sEnd);
}
