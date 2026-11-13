// The generator (design -> sim/patterns.js). Ships the scripted opening exactly (spec §5: identical on
// every seed), then drives the real S3 content: the 24-chunk tiered library (sim/chunks.js), picked by
// distance-tier mix (sim/chunk-picker.js) and placed into world s (sim/chunk-placer.js), skipping any
// chunk whose hazards would land inside an upcoming junction's exclusion window (spec §3/§10.4 #7).
import { distanceAt, speedAt, SPEED_CAP } from "./speed.js";
import { pickChunk } from "./chunk-picker.js";
import { placeChunk, placeRow, isInJunctionExclusionWindow, coinBaitsIntoBlock, JUNCTION_EXCLUSION_BEFORE_T, JUNCTION_EXCLUSION_AFTER_T } from "./chunk-placer.js";
import { CHUNKS } from "./chunks.js";
import { rollCorridor, placeCorridor, isInCorridorSpan, FIRST_CORRIDOR_MIN_T, CORRIDOR_GAP_SAMPLE_T, JUNCTION_MARGIN_T, ROW_AFTER_CLOSURE_T } from "./narrowing.js";
import { POWER_TIME, BALLOON_RISE_T, BALLOON_FLOAT_T, BALLOON_DESCEND_T } from "./powerups.js";

const MAX_CHUNK_DURATION_T = Math.max(...CHUNKS.map((c) => c.duration));

// A12.1/C3 (THE-1297): the scripted opening, rewritten to `row` events -- identical on every seed (spec
// §5). The geese line lands with L3 (C3): this builds the rows, the grace rule as it is now, and the 20 s
// toast without any geese copy.
const OPENING = [
  { at: 1.5, kind: "coinLine", lane: 0, count: 8, spacing: 2 },
  { at: 3.5, kind: "row", cells: ["low", "low", "low"] }, // full log row: jump
  { at: 6.0, kind: "junction", dir: "L" },
  { at: 8.5, kind: "row", cells: ["high", "high", "high"] }, // full branch row: duck
  { at: 10.0, kind: "row", cells: ["low", "low", "none"] }, // 2-lane row: step right, or jump
  { at: 11.2, kind: "row", cells: ["none", "block", "none"] }, // post: step either way
];

function randIn(rng, lo, hi) { return lo + rng() * (hi - lo); }

// Junction cadence (spec §3, C1 amendment THE-1293): every 8-10 s up to 60 s, narrowing linearly to every
// 6-8 s by 120 s (not 4-5 s -- the CTO's C1 fix: that left only 1-2 s of row space between late-game
// corners given A12.8's wider 3.0 s row-ban window, against the board's "is the late game too easy?"),
// then holding. Returns [lo, hi] for the interval that starts at sim time `t`.
export function junctionInterval(t) {
  if (t <= 60) return [8, 10];
  if (t >= 120) return [6, 8];
  const f = (t - 60) / 60;
  return [8 - 2 * f, 10 - 2 * f];
}

// Buffer (seconds, converted via local speed like everything else here) left between one chunk's own end
// and the next chunk's start -- on top of every chunk's own internal margin (every chunk's first hazard
// is >= 1.0 s from its own start) this keeps the worst-case boundary gap comfortably over the spec's
// 0.8 s floor even for the tightest-authored chunks (several end with their last hazard only 0.4 s from
// chunk end).
const CHUNK_BUFFER_T = 0.6;
const PICKUP_FIRST_S = 300, PICKUP_MIN_GAP_S = 500; // spec Part 1: first not before 300 m, then <= 1 per 500 m
// spec Part 1's five kinds, all enabled now (THE-1402). rollMysteryPrize's 40/15/15/15/15 is a separate,
// unrelated weighting (the mystery box's own PRIZE), not this equal-weight pick of which kind a pickup is.
const PICKUP_KINDS = { honey: { enabled: true }, shield: { enabled: true }, balloon: { enabled: true }, spring: { enabled: true }, mystery: { enabled: true } };
const ENABLED_PICKUP_KINDS = Object.keys(PICKUP_KINDS).filter((k) => PICKUP_KINDS[k].enabled);
function pickPickupKind(rng) { return ENABLED_PICKUP_KINDS[Math.floor(rng() * ENABLED_PICKUP_KINDS.length)]; }

// Weights (CTO call): coins 40 %, each power-up 15 %; canBalloon=false (can't hold a flight here) splits
// the 60 % over the 3 others instead.
const MYSTERY_PRIZE_KINDS = ["honey", "shield", "balloon", "spring"];
export function rollMysteryPrize(rng, canBalloon) {
  const r = rng();
  if (r < 0.4) return { coins: 50 + Math.floor(rng() * 151) }; // 50-200, whole numbers
  const kinds = canBalloon ? MYSTERY_PRIZE_KINDS : MYSTERY_PRIZE_KINDS.filter((k) => k !== "balloon");
  const idx = Math.min(kinds.length - 1, Math.floor(((r - 0.4) / 0.6) * kinds.length));
  return { kind: kinds[idx] };
}

// THE-1394 "Balloon Ride" placement: the flight window (pickup s -> s + flight distance, + landing
// protection) must never overlap a junction/corridor, and no later junction may land inside one already
// placed. A candidate is only ever checked once the player is within 80 m of it, so the real flown speed
// is at most a couple of seconds' ramp from this call's local `v` -- SPEED_CAP would blow the forbidden
// window out to ~1.5x the typical junction spacing, leaving nowhere safe to ever place one.
const BALLOON_FLIGHT_SAFETY = 1.0;
export function balloonFlightDistance(v) { return v * POWER_TIME.balloon * BALLOON_FLIGHT_SAFETY; }
// THE-1404: only the airborne leg (rise + float + descend) actually needs to clear a junction -- that's
// the part where jump/duck is ignored and the player's attention is on the sky coins, so they can't react
// to a turn. The last 1 s (landing protection) is back on the ground with input live; turning there works
// exactly like normal play, so it's allowed to run into a junction's approach (root cause of THE-1404: the
// old check held the FULL 6 s window, incl. landing, to the junction's own 2.0 s/1.0 s hazard-exclusion
// margins -- against junctions recurring every 6-10 s, that almost never fit).
const BALLOON_AIR_T = BALLOON_RISE_T + BALLOON_FLOAT_T + BALLOON_DESCEND_T;
export function balloonAirDistance(v) { return v * BALLOON_AIR_T * BALLOON_FLIGHT_SAFETY; }
export const BALLOON_AIR_BEFORE_T = 1.5; // TURN_BEFORE (1.0) + 0.5 s to actually see the turn, back on the ground
// Padding on a reserved span so the later (margin-free) isInBalloonSpan point check stays safe against a
// future junction's own (then still-unknown) speed-scaled exclusion margin.
const BALLOON_SPAN_PAD = JUNCTION_EXCLUSION_BEFORE_T * SPEED_CAP;
function isInBalloonSpan(s, spans) { return spans.some((sp) => s >= sp.sStart && s <= sp.sEnd); }
// Does a *candidate* balloon's flight window land on an already-placed junction/corridor? (The reverse --
// a junction placed later landing on an already-reserved span -- is handled where junctions get added.)
// The junction half only ever checks the airborne leg (see above); the corridor half keeps the full
// flight+landing window -- a corridor is a physical lane narrowing, not a reaction-time margin, and
// landing mid-narrowing is untouched by this fix.
export function balloonFlightOverlapsJunctionOrCorridor(pickupS, v, junctions, corridorSpans) {
  const airEndS = pickupS + balloonAirDistance(v);
  for (const j of junctions) {
    const after = JUNCTION_EXCLUSION_AFTER_T * j.v, before = BALLOON_AIR_BEFORE_T * j.v;
    if (pickupS <= j.s + after && airEndS >= j.s - before) return true;
  }
  const flightEndS = pickupS + balloonFlightDistance(v);
  return corridorSpans.some((sp) => pickupS <= sp.sEnd && flightEndS >= sp.sStart);
}

// P2 (THE-1322): an arc coin keeps its height (and its arc flag) when it's registered. THE-1398: its own
// `p` (fraction of the normal jump's air time/distance) rides along too, if the caller's own coin has one
// -- see coin-arc.js's placeJumpArc for why a Spring Paws jump needs it.
function arcFields(c) { return c.y === undefined ? {} : { y: c.y, arc: true, ...(c.p === undefined ? {} : { p: c.p }) }; }

export function createPatterns(rng) {
  const hazards = [];
  const coins = [];
  // Review (2026-11-07): every coin goes through here, so overlapping lines (a row's arc and the next row's
  // approach, a bait line) never stack two coins in one lane within the 0.6 m pickup window. An arc coin
  // replaces a flat one there (an arc must stay whole); otherwise the newcomer is dropped.
  const COIN_MIN_GAP = 0.6;
  // A reserved (sStart, sEnd) span per placed balloon, pushed below, so no later junction lands inside its
  // flight. (The README's "ground lane under the sky coins stays empty" is done by the sim on pickup, not
  // here -- THE-1377 review: scrubbing at generation emptied the lane for players who skipped the balloon.)
  const balloonSpans = [];
  function addCoin(c) {
    for (let i = coins.length - 1; i >= 0 && i >= coins.length - 60; i--) {
      const o = coins[i];
      if (o.lane !== c.lane || Math.abs(o.s - c.s) >= COIN_MIN_GAP) continue;
      if (c.arc && !o.arc && !o.taken) { coins[i] = { ...c, id: o.id }; }
      return;
    }
    coins.push(c);
  }
  const junctions = [];
  const pickups = [];
  const closures = [];
  const corridors = [];
  const corridorSpans = [];
  const chunkLog = [];
  let hid = 0, cid = 0, jid = 0, pid = 0;
  let generatedTo = 0;
  let nextJunctionAt = null;
  let lastJunctionT = 6.0; // the opening script's own fixed junction (A11.3: "first junction's centre")
  let lastJunctionS = null, lastJunctionV = null; // exact values, for the A11.4 margin (set after OPENING below)
  let nextCorridorAt = null;
  let corridorCount = 0;
  let gapIndex = 0;
  let lastCorridorGapIndex = -Infinity; // A11.4/A12.8: never 2 corridors in the same junction gap or in 2 gaps running
  const lastDirs = [];
  const lastTwoChunkIds = [null, null];
  let nextPickupS = PICKUP_FIRST_S;
  // spec §2: grace ends at 20 s; hold the first post-grace hazard to 1.5 s after the "one bonk" toast.
  // graceStartS gets a small safety margin (2 m, matching the S1 stopgap's own "clamp a hair before" fix):
  // distanceAt()'s trapezoid integral and a caller's own (likely Euler) step integration don't agree to
  // the metre, so a hazard landed right at the nominal boundary can read as just-past-grace to one
  // integration method and just-before to another -- widening the excluded band a hair keeps the rule
  // true regardless of which method a caller uses to decide "when" the hazard was actually met.
  const graceStartS = distanceAt(20) - 2;
  const graceFloorS = distanceAt(21.5);

  // A12.1 (THE-1297): a hazard record carries its render-only merge metadata through unchanged when
  // present (chunk-placer.js's rowHazards()); `addJunction`'s `t` is the junction's own sim time, kept so
  // the generator's own pacing checks (A12.8/C1) can measure real corner-to-corner spacing without having
  // to re-derive it from `s`/`v`.
  function addHazard(h) {
    hazards.push({ id: `h${hid++}`, s: h.s, lane: h.lane, kind: h.kind, mergeWidth: h.mergeWidth ?? 1, mergeCenterLane: h.mergeCenterLane ?? h.lane, hiddenForMerge: h.hiddenForMerge ?? false, hit: false, cleared: false });
  }
  function addCoinLine(sStart, lane, count, spacing) {
    for (let i = 0; i < count; i++) addCoin({ id: `c${cid++}`, s: sStart + i * spacing, lane, taken: false, passed: false });
  }
  function addJunction(s, v, dir, t) { junctions.push({ id: `j${jid++}`, s, v, dir, t, resolved: null }); }

  for (const ev of OPENING) {
    const s = distanceAt(ev.at);
    const v = speedAt(ev.at);
    if (ev.kind === "row") {
      const placed = placeRow(ev.cells, s, v);
      for (const h of placed.hazards) addHazard(h);
      for (const c of placed.coins) addCoin({ id: `c${cid++}`, s: c.s, lane: c.lane, ...arcFields(c), taken: false, passed: false });
    } else if (ev.kind === "coinLine") addCoinLine(s, ev.lane, ev.count, ev.spacing);
    else if (ev.kind === "junction") addJunction(s, v, ev.dir, ev.at);
    generatedTo = Math.max(generatedTo, s);
  }
  lastJunctionS = junctions[0].s; lastJunctionV = junctions[0].v; // the opening's own fixed junction

  function nextJunctionDir() {
    let dir = rng() < 0.5 ? "L" : "R";
    if (lastDirs.length === 2 && lastDirs[0] === lastDirs[1] && lastDirs[1] === dir) dir = dir === "L" ? "R" : "L";
    lastDirs.push(dir);
    if (lastDirs.length > 2) lastDirs.shift();
    return dir;
  }

  // Places one chunk at `atS` (local speed `v`), skipping it and reporting failure if any of its hazards
  // would land inside an upcoming junction's exclusion window, or inside the post-grace hold window (spec
  // §2: hold the first post-grace hazard to 1.5 s after the 20 s "one bonk" toast) -- the caller advances
  // a little and retries rather than ever placing a chunk that violates either rule. A chunk started well
  // before the grace boundary can still place one of its *later* internal hazards inside the hold window
  // (events are 1-5 s after a chunk's own start, same order of magnitude as the 1.5 s hold itself), so
  // this has to check every hazard's own landed s, not just clamp the chunk's start s.
  function tryPlaceChunkAt(atS, v) {
    const chunk = pickChunk(rng, atS, lastTwoChunkIds);
    const placed = placeChunk(chunk, atS, v);
    for (const h of placed.hazards) {
      if (isInJunctionExclusionWindow(h.s, junctions)) return null; // reject the whole chunk, not just the one hazard -- keeps the chunk's own internal pacing/shape intact
      if (h.s >= graceStartS && h.s < graceFloorS) return null;
      // A12.3: a corridor allows only low/high/either rows across every open lane -- no block hazard and
      // no lane-change pattern from the ordinary chunk library may land inside one.
      if (isInCorridorSpan(h.s, corridorSpans)) return null;
      // A12.7 G4/R5 (THE-1297): placeChunk already guards a chunk's own coins against its own block
      // cells; this is the cross-chunk-boundary half of the same rule -- reject the whole chunk if one of
      // ITS OWN block cells would turn an already-placed (previous chunk's) coin into a trap.
      if (h.kind === "block" && coins.some((c) => coinBaitsIntoBlock(c.s, c.lane, [h], v))) return null;
    }
    // the mirror case: this chunk's own leading coin landing too close before a PREVIOUS chunk's trailing
    // block in the same lane (placeChunk only ever checks a chunk against its own hazards).
    for (const c of placed.coins) {
      if (coinBaitsIntoBlock(c.s, c.lane, hazards, v)) return null;
    }
    for (const h of placed.hazards) addHazard(h);
    for (const c of placed.coins) addCoin({ id: `c${cid++}`, s: c.s, lane: c.lane, ...arcFields(c), taken: false, passed: false });
    lastTwoChunkIds[0] = lastTwoChunkIds[1];
    lastTwoChunkIds[1] = chunk.id;
    chunkLog.push(chunk.id);
    return placed.endS;
  }

  // Keeps ~6 s (at least 60 m) of content generated ahead of the capy's current (t, s, v).
  function ensureAhead(t, s, v) {
    const horizon = s + Math.max(60, v * 6);

    // Junctions must exist before the chunk-placement loop below can reject a hazard that would land in
    // their exclusion window -- so they need to be generated far enough ahead that a chunk placed right at
    // the current horizon's edge can never reach past an undiscovered junction with its own hazards. A
    // chunk started at the horizon can still place a hazard up to MAX_CHUNK_DURATION_T seconds later, and
    // the exclusion window itself extends another JUNCTION_EXCLUSION_*_T s past the junction's own centre
    // (A12.8/THE-1297 widened this from 1.0/0.5 s to 2.0/1.0 s -- a flat +50 m margin wasn't enough either
    // way, measured violations up to ~45 m past that margin at higher speeds, where the same time budget
    // covers more metres). Size the margin in time, like every other gap in this module, and convert with
    // the current v (a slight under-estimate is fine here since v only ever still rises between now and
    // the junction, which widens -- never shrinks -- the real margin needed).
    const junctionLookaheadMargin = (MAX_CHUNK_DURATION_T + Math.max(JUNCTION_EXCLUSION_BEFORE_T, JUNCTION_EXCLUSION_AFTER_T)) * v;
    if (nextJunctionAt === null) {
      nextJunctionAt = 6.0 + randIn(rng, ...junctionInterval(6.0));
      // A12.8 (THE-1297): the window's wider back-reach (2.0 s, up from 1.0 s) can now land on the
      // scripted opening's own fixed last row (the "post" at 11.2 s, already in `generatedTo`) for an
      // early random draw -- nudge the very first real junction later rather than exclude a row the
      // player has no way to avoid encountering. Same local-v projection the main loop below uses for
      // this same `nextJunctionAt`, so the two stay consistent.
      while (s + v * Math.max(1.5, nextJunctionAt - t) - JUNCTION_EXCLUSION_BEFORE_T * speedAt(nextJunctionAt) < generatedTo) nextJunctionAt += 0.5;
    }
    if (nextCorridorAt === null) nextCorridorAt = FIRST_CORRIDOR_MIN_T; // A12.3: first corridor >= 32 s
    // Same local-v linear projection junctions use for their own `s` (projectedS below) -- a filler's
    // position has to live in that same approximate coordinate frame, not the exact distanceAt integral,
    // or it can drift tens of metres from a junction's own `s` and trip the A11.4/A12.8 margin check on a
    // filler that was never really that close on the actual trail.
    const toS = (time) => s + v * (time - t);
    while (true) {
      const junctionProjectedS = s + v * Math.max(1.5, nextJunctionAt - t);
      // A corridor candidate needs its own lookahead check here, independent of the junction's -- if a
      // previous corridor stretched nextJunctionAt way out, the junction's own projectedS can sit well
      // past the horizon while a *closer* corridor is still due. Breaking on the junction's reach alone
      // would defer that corridor to a later call, by which point the chunk-placement loop below (which
      // only ever races up to the *plain* `horizon`, not this margin) can have already filled the gap
      // the corridor needs with ordinary content it was never checked against.
      const corridorProjectedS = s + v * Math.max(1.5, nextCorridorAt - t);
      if (Math.min(junctionProjectedS, corridorProjectedS) > horizon + junctionLookaheadMargin) break; // not needed yet, leave state as-is for the next call

      // A12.3/A12.8: a corridor due before the upcoming junction gets built now, in the gap between the
      // last junction placed and this one -- and that gap is stretched (nextJunctionAt pushed out) to fit
      // it, rather than ever splitting a corridor across a junction's own +-2.5 s hands-off window.
      gapIndex++;
      if (nextCorridorAt < nextJunctionAt && gapIndex > lastCorridorGapIndex + 1) {
        // A11.4/A12.8's margin is a *distance* (2.5 s at a junction's own, exact speed), not a flat time
        // offset -- converting it through `toS`'s local-v projection (same anchor as everything else this
        // call) needs the margin stated in this call's own time units, i.e. divided by this call's `v`,
        // not multiplied by it. Using the *previous* junction's own exact `lastJunctionV` for the "after
        // it" side, and the speed cap (an upper bound on the *upcoming* junction's real, still-unknown
        // speed) for the "before it" side, keeps both margins true regardless of how much the curve has
        // ramped between this anchor and either junction.
        const minStartTForPrevMargin = t + (lastJunctionS + JUNCTION_MARGIN_T * lastJunctionV - s) / v;
        const candidateStartT = Math.max(nextCorridorAt, minStartTForPrevMargin);
        // G1e: roll the corridor as plain data, then place it with the pure placer -- at this call's own
        // local-v frame (toS), so its fillers, rows and end line up with the junctions' projected `s`.
        const block = rollCorridor(rng, { isFirst: corridorCount === 0, atT: candidateStartT, v });
        const corridor = placeCorridor(block, toS(candidateStartT), v, candidateStartT);
        const minNextJunctionAtForOwnMargin = corridor.endT + (JUNCTION_MARGIN_T * SPEED_CAP) / v;
        nextJunctionAt = Math.max(nextJunctionAt, minNextJunctionAtForOwnMargin);
        for (const f of corridor.fillers) closures.push(f);
        corridors.push(corridor);
        const corridorEndS = corridor.endS;
        corridorSpans.push({ sStart: corridor.frontS, sEnd: corridorEndS });
        for (const r of corridor.rows) addHazard(r);
        for (const c of corridor.coins) addCoin({ id: `c${cid++}`, s: c.s, lane: c.lane, ...arcFields(c), taken: false, passed: false });
        // Keep the ordinary chunk-placement frontier from resuming right at the corridor's own boundary:
        // its last row can sit up to ROW_BEFORE_BOUNDARY_T before sEnd, and the very first ordinary hazard
        // of whatever chunk comes next needs real headroom beyond that -- same reasoning as the row-to-row
        // gap fix above (positions here are the `toS` local-v projection, not the exact distanceAt
        // integral, so a *measured* gap against the real speed curve shrinks a little versus its nominal
        // one; this buffer absorbs that shrinkage too).
        generatedTo = Math.max(generatedTo, corridorEndS + (ROW_AFTER_CLOSURE_T + CHUNK_BUFFER_T) * v);
        lastCorridorGapIndex = gapIndex;
        corridorCount++;
        nextCorridorAt = corridor.startT + randIn(rng, ...CORRIDOR_GAP_SAMPLE_T);
        continue; // re-check from the top next iteration, now against the (possibly stretched) nextJunctionAt
      }

      // A junction can't land inside an already-reserved balloon span (padded by BALLOON_SPAN_PAD).
      if (isInBalloonSpan(junctionProjectedS, balloonSpans)) { nextJunctionAt += 0.5; continue; }

      // the junction's own speed is the speed the game runs at *at its own time* (nextJunctionAt), not the
      // generator's current placement-time v -- the exclusion window has to reflect what the player
      // actually experiences there, and the speed curve only ramps up between now and then.
      addJunction(junctionProjectedS, speedAt(nextJunctionAt), nextJunctionDir(), nextJunctionAt);
      lastJunctionT = nextJunctionAt; lastJunctionS = junctionProjectedS; lastJunctionV = speedAt(nextJunctionAt);
      const [lo, hi] = junctionInterval(nextJunctionAt);
      nextJunctionAt += randIn(rng, lo, hi);
    }
    let guard = 0;
    while (generatedTo < horizon && guard++ < 200) {
      const endS = tryPlaceChunkAt(generatedTo, v);
      if (endS === null) {
        // the chunk would've landed on a junction's exclusion window or the post-grace hold window --
        // nudge forward past it (a flat few metres) and retry with a fresh pick, rather than spin forever
        // on the same spot
        generatedTo += Math.max(5, v * 0.3);
        continue;
      }
      generatedTo = endS + CHUNK_BUFFER_T * v;
    }

    // One pickup scheduler (spec Part 1): first not before 300 m, then at most one per 500 m, never inside
    // a junction's turn/fork exclusion window or a corridor's narrowing margin -- nudge forward past either
    // and retry rather than skip the pickup outright (same pattern tryPlaceChunkAt's own caller uses).
    //
    // THE-1404: a rolled balloon (a direct pickup, or a mystery prize) stays a balloon -- make room for it
    // instead of re-rolling the kind away when the first slot doesn't fit. "Make room" means sliding this
    // one pickup's own s forward to the first spot whose flight actually clears every already-placed
    // junction/corridor; a junction not yet placed out there respects the span reserved below exactly the
    // way the scheduler above already pushes one off an existing balloonSpan -- no separate "stretch" path
    // needed. junctionInterval's own curve is untouched.
    while (nextPickupS !== null && s + 80 >= nextPickupS && nextPickupS <= generatedTo) {
      if (isInJunctionExclusionWindow(nextPickupS, junctions) || isInCorridorSpan(nextPickupS, corridorSpans)) {
        nextPickupS += Math.max(5, v * 0.3);
        continue;
      }
      const kind = pickPickupKind(rng);
      const lane = [-1, 0, 1][Math.floor(rng() * 3)];
      // canBalloon is always true now: a box whose own slot can't hold a flight just has that flight's
      // slot moved below, same as a direct balloon pickup.
      const prize = kind === "mystery" ? rollMysteryPrize(rng, true) : undefined;
      let pickupS = nextPickupS;
      if (kind === "balloon" || (prize && prize.kind === "balloon")) {
        let guard = 0;
        while (
          (isInJunctionExclusionWindow(pickupS, junctions) || isInCorridorSpan(pickupS, corridorSpans) ||
            balloonFlightOverlapsJunctionOrCorridor(pickupS, v, junctions, corridorSpans)) && guard++ < 2000
        ) {
          pickupS += Math.max(5, v * 0.3);
        }
        balloonSpans.push({ sStart: pickupS - BALLOON_SPAN_PAD, sEnd: pickupS + balloonFlightDistance(v) + BALLOON_SPAN_PAD });
      }
      pickups.push({ id: `pk${pid++}`, kind, s: pickupS, lane, taken: false, ...(prize ? { prize } : {}) });
      nextPickupS = pickupS + PICKUP_MIN_GAP_S;
    }
  }

  return { hazards, coins, junctions, pickups, closures, corridors, chunkLog, ensureAhead };
}
