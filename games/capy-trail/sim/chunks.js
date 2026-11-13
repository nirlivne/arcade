// Spec amendment A12.1 (THE-1297, L1 slice): the hand-made chunk library, rewritten from single-lane
// `hazard` events to `row` events -- a row is the set of 3 lane cells (L, M, R) at one track `s`. The old
// vocabulary (one hazard per event, hand-authored `coinLine`/`jumpArc` guide coins) is gone: sim/
// chunk-placer.js now derives one hazard record per non-empty cell AND the A12.7 G1/G2/G4 guide coin line
// automatically from a row's own cells, so a chunk only has to author the shape of its rows. `bait` stays
// hand-authored (A12.7 G4: "bait lines stay, but only on passable cells" -- a side incentive, not the main
// guide).
//
// Row cell kinds: "none" | "low" | "high" | "either" | "block" (A12.1 obstacle vocabulary). "either" is a
// log on stumps: jump or duck both clear it (sim/sim.js's HAZARD_BAND.either). 2-3 adjacent cells of the
// same kind draw as one merged prop (render/scene.js); sim hit-testing stays per lane either way.
//
// Tier rules (A12.1's width-share table): easy = one kind per row, 0% mixed, `either` only from the 4th
// easy chunk on; a 2-lane `block` row (and a 3-lane `block,block,X` row) never appears in easy. medium = up
// to 2 kinds per row, >=30% of all rows mixed. hard = up to 3 kinds per row, >=50% of all rows mixed. Every
// row keeps >= 1.0 s from its neighbours (both within a chunk and, via sim/patterns.js's own buffer + a
// chunk's own >= 1.0 s head margin, across a chunk boundary) -- comfortably over A12.1 R3's 0.8 s/1.0 s
// floor, and enough that R2's reachability rule (<= 2 lane steps for any gap >= 1.0 s) always holds
// regardless of which two rows end up adjacent, since 2 steps reaches any of the 3 lanes from any other.
//
// Counted library-wide (tools/capy-trail-tests/chunks.test.mjs, Q1): 24 chunks, 8/8/8; each tier's own
// width/full/mixed shares land inside A12.1's table; library-wide >= 65% of rows are width >= 2 and >= 20%
// are full rows; no `block` full row exists (R4); >= 30% of medium+hard chunks carry a `bait` line.

export const CHUNKS = [
  // ---------------------------------------------------------------- easy (one kind per row, 0% mixed;
  // `either` only from the 4th chunk, e4, on; `block` only ever 1-lane here)
  { id: "e1", tier: "easy", duration: 4.0, events: [
    { at: 1.0, kind: "row", cells: ["block", "none", "none"] },
    { at: 2.2, kind: "row", cells: ["low", "low", "none"] },
    { at: 3.4, kind: "row", cells: ["none", "high", "high"] },
  ] },
  { id: "e2", tier: "easy", duration: 4.0, events: [
    { at: 1.0, kind: "row", cells: ["none", "none", "block"] },
    { at: 2.2, kind: "row", cells: ["high", "high", "none"] },
    { at: 3.4, kind: "row", cells: ["none", "low", "low"] },
  ] },
  { id: "e3", tier: "easy", duration: 4.0, events: [
    { at: 1.0, kind: "row", cells: ["none", "none", "block"] },
    { at: 2.2, kind: "row", cells: ["low", "low", "none"] },
    { at: 3.4, kind: "row", cells: ["none", "high", "high"] },
  ] },
  { id: "e4", tier: "easy", duration: 4.0, events: [
    { at: 1.0, kind: "row", cells: ["none", "block", "none"] },
    { at: 2.2, kind: "row", cells: ["either", "either", "none"] },
    { at: 3.4, kind: "row", cells: ["either", "either", "either"] },
  ] },
  { id: "e5", tier: "easy", duration: 4.0, events: [
    { at: 1.0, kind: "row", cells: ["block", "none", "none"] },
    { at: 2.2, kind: "row", cells: ["none", "low", "low"] },
    { at: 3.4, kind: "row", cells: ["low", "low", "low"] },
  ] },
  { id: "e6", tier: "easy", duration: 4.0, events: [
    { at: 1.0, kind: "row", cells: ["none", "none", "block"] },
    { at: 2.2, kind: "row", cells: ["high", "high", "none"] },
    { at: 3.4, kind: "row", cells: ["high", "high", "high"] },
  ] },
  { id: "e7", tier: "easy", duration: 4.0, events: [
    { at: 1.0, kind: "row", cells: ["block", "none", "none"] },
    { at: 2.2, kind: "row", cells: ["none", "either", "either"] },
    { at: 3.4, kind: "row", cells: ["low", "low", "low"] },
  ] },
  { id: "e8", tier: "easy", duration: 4.0, events: [
    { at: 1.0, kind: "row", cells: ["block", "none", "none"] },
    { at: 2.2, kind: "row", cells: ["high", "high", "none"] },
    { at: 3.4, kind: "row", cells: ["high", "high", "high"] },
  ] },

  // ---------------------------------------------------------------- medium (<= 2 kinds per row, >= 30%
  // of all rows mixed, >= 50% of 3-lane rows full)
  { id: "m1", tier: "medium", duration: 5.0, events: [
    { at: 1.0, kind: "row", cells: ["low", "low", "none"] },
    { at: 2.2, kind: "row", cells: ["low", "block", "none"] },
    { at: 3.4, kind: "row", cells: ["none", "none", "block"] },
    { at: 4.6, kind: "row", cells: ["high", "high", "high"] },
  ] },
  { id: "m2", tier: "medium", duration: 5.0, events: [
    { at: 1.0, kind: "row", cells: ["none", "high", "high"] },
    { at: 1.0, kind: "bait", lane: -1, count: 3, spacing: 2 },
    { at: 2.2, kind: "row", cells: ["either", "high", "none"] },
    { at: 3.4, kind: "row", cells: ["none", "high", "none"] },
    { at: 4.6, kind: "row", cells: ["block", "low", "low"] },
  ] },
  { id: "m3", tier: "medium", duration: 5.0, events: [
    { at: 1.0, kind: "row", cells: ["block", "block", "none"] },
    { at: 2.2, kind: "row", cells: ["none", "low", "low"] },
    { at: 3.4, kind: "row", cells: ["high", "none", "none"] },
    { at: 4.6, kind: "row", cells: ["low", "low", "low"] },
  ] },
  { id: "m4", tier: "medium", duration: 5.0, events: [
    { at: 1.0, kind: "row", cells: ["high", "high", "none"] },
    { at: 2.2, kind: "row", cells: ["none", "either", "either"] },
    { at: 3.4, kind: "row", cells: ["none", "none", "either"] },
    { at: 4.6, kind: "row", cells: ["either", "either", "either"] },
  ] },
  { id: "m5", tier: "medium", duration: 5.0, events: [
    { at: 1.0, kind: "row", cells: ["high", "high", "none"] },
    { at: 2.2, kind: "row", cells: ["none", "low", "low"] },
    { at: 3.4, kind: "row", cells: ["low", "none", "none"] },
    { at: 3.4, kind: "bait", lane: 1, count: 3, spacing: 2 },
    { at: 4.6, kind: "row", cells: ["block", "block", "low"] },
  ] },
  { id: "m6", tier: "medium", duration: 5.0, events: [
    { at: 1.0, kind: "row", cells: ["low", "low", "none"] },
    { at: 2.2, kind: "row", cells: ["low", "high", "none"] },
    { at: 3.4, kind: "row", cells: ["high", "high", "high"] },
    { at: 4.6, kind: "row", cells: ["low", "block", "block"] },
  ] },
  { id: "m7", tier: "medium", duration: 5.0, events: [
    { at: 1.0, kind: "row", cells: ["block", "low", "none"] },
    { at: 2.2, kind: "row", cells: ["none", "either", "either"] },
    { at: 3.4, kind: "row", cells: ["either", "either", "high"] },
    { at: 4.6, kind: "row", cells: ["low", "low", "low"] },
  ] },
  { id: "m8", tier: "medium", duration: 5.0, events: [
    { at: 1.0, kind: "row", cells: ["high", "high", "none"] },
    { at: 1.0, kind: "bait", lane: 1, count: 3, spacing: 2 },
    { at: 2.2, kind: "row", cells: ["either", "block", "none"] },
    { at: 3.4, kind: "row", cells: ["low", "low", "low"] },
    { at: 4.6, kind: "row", cells: ["either", "either", "high"] },
  ] },

  // ---------------------------------------------------------------- hard (<= 3 kinds per row, >= 50% of
  // all rows mixed, >= 30% of 3-lane rows full)
  { id: "h1", tier: "hard", duration: 5.0, events: [
    { at: 1.0, kind: "row", cells: ["block", "none", "none"] },
    { at: 2.2, kind: "row", cells: ["low", "high", "none"] },
    { at: 3.4, kind: "row", cells: ["block", "high", "low"] },
    { at: 4.6, kind: "row", cells: ["low", "low", "low"] },
  ] },
  { id: "h2", tier: "hard", duration: 5.0, events: [
    { at: 1.0, kind: "row", cells: ["none", "high", "none"] },
    { at: 1.0, kind: "bait", lane: 1, count: 4, spacing: 2 },
    { at: 2.2, kind: "row", cells: ["block", "low", "none"] },
    { at: 3.4, kind: "row", cells: ["block", "block", "low"] },
    { at: 4.6, kind: "row", cells: ["either", "either", "either"] },
  ] },
  { id: "h3", tier: "hard", duration: 5.0, events: [
    { at: 1.0, kind: "row", cells: ["none", "low", "low"] },
    { at: 2.2, kind: "row", cells: ["either", "block", "none"] },
    { at: 3.4, kind: "row", cells: ["low", "high", "block"] },
    { at: 4.6, kind: "row", cells: ["high", "high", "high"] },
  ] },
  { id: "h4", tier: "hard", duration: 5.0, events: [
    { at: 1.0, kind: "row", cells: ["block", "low", "none"] },
    { at: 2.2, kind: "row", cells: ["none", "either", "either"] },
    { at: 3.4, kind: "row", cells: ["either", "either", "either"] },
    { at: 4.6, kind: "row", cells: ["high", "high", "low"] },
  ] },
  { id: "h5", tier: "hard", duration: 5.0, events: [
    { at: 1.0, kind: "row", cells: ["high", "high", "none"] },
    { at: 1.0, kind: "bait", lane: 1, count: 4, spacing: 2 },
    { at: 2.2, kind: "row", cells: ["none", "low", "either"] },
    { at: 3.4, kind: "row", cells: ["block", "low", "high"] },
    { at: 4.6, kind: "row", cells: ["low", "low", "low"] },
  ] },
  { id: "h6", tier: "hard", duration: 5.0, events: [
    { at: 1.0, kind: "row", cells: ["none", "either", "low"] },
    { at: 2.2, kind: "row", cells: ["block", "high", "none"] },
    { at: 3.4, kind: "row", cells: ["high", "high", "high"] },
    { at: 4.6, kind: "row", cells: ["low", "block", "block"] },
  ] },
  { id: "h7", tier: "hard", duration: 5.0, events: [
    { at: 1.0, kind: "row", cells: ["low", "low", "none"] },
    { at: 2.2, kind: "row", cells: ["none", "high", "either"] },
    { at: 3.4, kind: "row", cells: ["block", "high", "low"] },
    { at: 4.6, kind: "row", cells: ["either", "either", "either"] },
  ] },
  { id: "h8", tier: "hard", duration: 5.0, events: [
    { at: 1.0, kind: "row", cells: ["low", "block", "none"] },
    { at: 1.0, kind: "bait", lane: 1, count: 4, spacing: 2 },
    { at: 2.2, kind: "row", cells: ["none", "high", "high"] },
    { at: 3.4, kind: "row", cells: ["low", "low", "low"] },
    { at: 4.6, kind: "row", cells: ["either", "either", "high"] },
  ] },
];
