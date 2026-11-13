// THE-1395/THE-1412: the 12 authored levels, copied verbatim from design/capy-trail/levels/levels.js (no
// logic here). Format, script item shapes and field meanings are documented there, and in that file's own
// header comment; sim/level-patterns.js walks `script`. LEVELS_LIVE (bottom) gates which levels are playable.

export const LEVELS = [
  // ---------------------------------------------------------------- slice 8: levels 1-3
  { n: 1, name: "First steps", teach: "jump and duck", hint: "Jump logs, duck branches", t0: 0, catch: false, coinTarget: 320, script: [
    { coins: 0, n: 8 }, 2.5, "LLL", 1.0, "HHH", 1.0, "LLL", 0.6, "HHH", 0.6, "LLL", "LLL", 0.6, "HHH", "HHH", 0.8,
    "EEE", 0.6, "LLL", "HHH", 0.6, "LLL", "HHH", "LLL", 0.8, "EEE", "HHH", "HHH", "LLL", 0.8,
    "LLL", "HHH", "EEE", "LLL", "HHH", 0.6, "HHH", "LLL", "LLL", "HHH", "EEE", "LLL",
  ] },
  { n: 2, name: "Side steps", teach: "change lanes", hint: "Step left and right", t0: 10, catch: false, coinTarget: 225, script: [
    { coins: 0, n: 6 }, 2.0, "-B-", 1.0, "B--", 1.0, "--B", 1.0, "LL-", 0.6, "-HH", 0.6, "B-B", 0.6,
    "e1", "e2", "e3", 1.0, "-B-", "LL-", "-HH", 0.6, "e5", "e6", "e8", "B-B", "e7", "e4",
  ] },
  { n: 3, name: "Corners", teach: "turn at the fork", hint: "Turn at the fork!", t0: 20, catch: false, coinTarget: 175, script: [
    { coins: 0, n: 6 }, 1.0, { j: "L" }, 1.0, "e2", 1.0, { j: "R" }, 1.0, "e5", 1.0, { j: "R" }, "e1", 1.0,
    { j: "L" }, "e6", 1.0, { j: "L" }, "e3", 1.0, { j: "R" }, "e8", 1.0, { j: "L" }, "e7", { j: "R" }, "e4",
  ] },

  // ---------------------------------------------------------------- slice 9: levels 4-8
  { n: 4, name: "Narrow path", teach: "narrowings", hint: "The trail narrows: follow the coins", t0: 30, catch: false, coinTarget: 350, script: [
    { coins: 0, n: 6 }, 1.0, "e5", { cor: "B", close: 1, dur: 2.4, rows: ["LL-"] }, "e2", { j: "L" }, "e6",
    { cor: "B", close: -1, dur: 2.6, rows: ["-HH"] }, "e7",
    { cor: "A", close: [1, 0], approach: 1.6, one: 2.4, rowsA: [], rows1: ["H--"] }, { j: "R" }, "e3",
    { cor: "B", close: -1, dur: 3.0, rows: ["-LL"] }, "m4", { j: "L" }, "e8",
    { cor: "A", close: [-1, 0], approach: 1.6, one: 2.6, rowsA: [], rows1: ["--L"] }, "e1",
  ] },
  { n: 5, name: "Honey jar", teach: "Honey Jar pulls coins in", hint: "Grab the Honey Jar!", t0: 40, catch: false, coinTarget: 440, script: [
    { coins: 0, n: 6 }, 1.0, "e1", { j: "R" }, "m1", { pu: "honey", lane: 0 }, "m2", "m5", { j: "L" }, "e5",
    { cor: "B", close: 1, dur: 2.4, rows: ["HH-"] }, "m3", { j: "R" }, "e6", { pu: "honey", lane: 0 }, "m8", "m6",
    { j: "L" }, "m4", "e7",
  ] },
  { n: 6, name: "Picnic shield", teach: "Picnic Shield takes a hit", hint: "Shield: one free bump", t0: 50, catch: false, coinTarget: 400, script: [
    { coins: 0, n: 6 }, 1.0, "e2", { j: "L" }, "m1", { pu: "shield", lane: 0 }, "h1", "m6", { j: "R" }, "e5",
    { cor: "B", close: -1, dur: 2.6, rows: ["-LL"] }, "m7", { j: "L" }, "m3", { pu: "shield", lane: 0 }, "h3", "h4",
    { j: "R" }, "m5",
  ] },
  // THE-1414: coinTarget lowered 430 -> 370 (levels.md's own "75% of best path" rule, recalculated). The
  // designer's 430/571-best figures assumed the balloon only adds its sky coins; since a920a9c it also
  // clears the ground coins it flies over, and -- "no ground coins from 4 m up, in any lane" (sim.js) --
  // skipping both balloons entirely scores higher (495) than taking them (452: 571 old-best minus the 76
  // sky coins that were double-counted, since lane 0's ground coins under the flight are gone either way).
  // 370 = round(495 * 0.75 / 5) * 5, inside (lazy 206, 396].
  { n: 7, name: "Balloon ride", teach: "Balloon Ride over it all", hint: "Balloon: float over it all", t0: 55, catch: false, coinTarget: 370, script: [
    { coins: 0, n: 6 }, 1.0, "e3", { j: "R" }, "m2", { pu: "balloon", lane: 0 }, "m3", "m6", { j: "L" }, "e8",
    { cor: "B", close: 1, dur: 2.6, rows: ["EE-"] }, "m1", { j: "R" }, "e2", { pu: "balloon", lane: 0 }, "h2", "m8",
    { j: "L" }, "m4",
  ] },
  { n: 8, name: "Spring paws", teach: "Spring Paws: big jumps", hint: "Spring Paws: big jumps!", t0: 60, catch: false, coinTarget: 440, script: [
    { coins: 0, n: 6 }, 1.0, "e6", { j: "L" }, "m4", { pu: "spring", lane: 0 }, "e5", "LLL", "EEE", "e7", { j: "R" }, "m3",
    { cor: "A", close: [-1, 1], approach: 1.6, one: 2.4, rowsA: [], rows1: ["-L-"] }, "m8", { j: "L" }, "m2",
    { pu: "spring", lane: 0 }, "m6", "LLL", "m7", { j: "R" }, "e1",
  ] },

  // ---------------------------------------------------------------- slice 10: levels 9-12
  { n: 9, name: "Mystery box", teach: "Mystery Box: a surprise", hint: "What is in the box?", t0: 70, catch: false, coinTarget: 525, script: [
    { coins: 0, n: 6 }, 1.0, "m1", { pu: "mystery", lane: 0 }, "m5", { j: "R" }, "m8",
    { cor: "A", close: [1, 0], approach: 2.0, one: 2.4, rowsA: ["LL-"], rows1: ["H--"] }, "h1", { j: "L" }, "m2",
    { pu: "mystery", lane: -1 }, "h5", "m6", { j: "R" }, "m3", { cor: "B", close: -1, dur: 2.8, rows: ["-HL"] },
    "h7", { j: "L" }, "m7", { pu: "mystery", lane: 1 }, "h8",
  ] },
  { n: 10, name: "Bee alert", teach: "two bumps close together = caught", hint: "Two bumps close together = caught", t0: 80, catch: true, coinTarget: 520, script: [
    { coins: 0, n: 6 }, 1.0, "m1", { j: "L" }, "m3", "m6", { j: "R" }, "e5", { cor: "B", close: 1, dur: 2.6, rows: ["LH-"] },
    "h2", { j: "L" }, "m8", { pu: "shield", lane: 0 }, "h3", "h6", { j: "R" }, "m7",
    { cor: "A", close: [-1, 0], approach: 2.0, one: 2.6, rowsA: ["-HH"], rows1: ["--L"] }, "h4", { j: "L" }, "m5",
  ] },
  { n: 11, name: "Mixed trail", teach: "everything so far", hint: "Everything at once!", t0: 100, catch: true, coinTarget: 635, script: [
    { coins: 0, n: 6 }, 1.0, "m4", { j: "R" }, "h1", { pu: "honey", lane: 0 }, "h5", "m2", { j: "L" }, "h3",
    { cor: "A", close: [1, -1], approach: 2.0, one: 2.4, rowsA: ["HH-"], rows1: ["-L-"] }, "m6", { j: "R" }, "h7",
    { pu: "spring", lane: 0 }, "h8", "m3", { j: "L" }, "h2", { cor: "B", close: -1, dur: 2.8, rows: ["-EH"] },
    "h4", { j: "R" }, "m8", "h6",
  ] },
  { n: 12, name: "The long trail", teach: "the final run", hint: "The long trail. Go!", t0: 120, catch: true, coinTarget: 820, script: [
    { coins: 0, n: 6 }, 1.0, "h1", { j: "L" }, "m5", { pu: "shield", lane: 0 }, "h3", "h6", { j: "R" }, "m2",
    { cor: "A", close: [-1, 0], approach: 2.0, one: 2.4, rowsA: ["-LL"], rows1: ["--H"] }, "h8", { j: "L" }, "h2",
    { pu: "balloon", lane: 0 }, "m7", "h5", { j: "R" }, "h4", { cor: "B", close: 1, dur: 2.8, rows: ["LH-"] },
    "m1", { j: "L" }, "h7", { pu: "mystery", lane: 0 }, "m6", "h3", { j: "R" }, "m8",
    { cor: "A", close: [1, 0], approach: 2.0, one: 2.6, rowsA: ["HL-"], rows1: ["L--"] }, "h1",
  ] },
];

export const LEVELS_LIVE = 12; // THE-1417 (slice 10): all 12 levels are playable.
