// Level generator (THE-449 S3–S4; spec §3 chapter table; the daily shape is the spec's "Daily" row). Pure: a seed and
// a shape always give the same tower. Tins are hex pyramids on each shelf, touching, so they spawn asleep at their
// exact resting places. The solver (tools/cannonball-family-solve.mjs) decides which seeds ship.
import { mulberry32 } from "./rng.js";

const TIN_R = 20, STONE_R = 20, ROW_DROP = Math.sqrt(3) * TIN_R; // a row sits in the notches of the one below
const FLOOR = 456, X_MIN = 320, X_MAX = 620;
const KNACK_NAMES = ["light", "heavy", "bounce"];

export function chapterOf(level) {
  return level <= 10 ? 1 : level <= 20 ? 2 : 3;
}

// The chapter table's numbers for a level. Used by the generator and by the tests (one assertion per number).
export function levelShape(level) {
  const ch = chapterOf(level);
  if (ch === 1) {
    return {
      N: level <= 5 ? 3 : 4,
      ledges: [1, 2],
      tins: Math.min(8, 4 + Math.floor((level - 1) / 2)),
      stones: level <= 4 ? 0 : 1,
      planks: 0,
    };
  }
  if (ch === 2) {
    return {
      N: level <= 15 ? 4 : 5,
      ledges: [2, 3],
      tins: Math.min(10, 7 + Math.floor((level - 11) / 3)),
      stones: [1, 2],
      planks: [0, 1],
    };
  }
  return {
    N: 5,
    ledges: [2, 4],
    tins: Math.min(12, 10 + Math.floor((level - 21) / 4.5)),
    stones: [2, 3],
    planks: [1, 2],
  };
}

// The daily Family Tower (spec v4c, THE-460): N 4, exactly 2 shelves, 7–8 tins, 1–2 stones, 0–1 planks, ≤ 2 knacks.
// 3 shelves almost never clears in N − 1 = 3 shots (measured: 79.8 % of generated towers, 1 solved of 2,079 sampled),
// so the shape is fixed at 2, not a range: 2 shelves with ≤ 8 tins solved 8.8 % of seeds in the CTO's measurement.
export const DAILY_SHAPE = { N: 4, ledges: 2, tins: [7, 8], stones: [1, 2], planks: [0, 1] };

// Knacks per slot. Chapter 1 follows the table (light from L4, heavy from L5 with stones, bounce from L7); chapter 2
// and the daily have up to two knack slots; chapter 3 has any mix.
function knacksFor(kind, shape, rng) {
  const slots = new Array(shape.N).fill(null);
  const free = () => {
    const open = slots.map((_, i) => i).filter((i) => slots[i] === null);
    return open.length ? open[Math.floor(rng() * open.length)] : -1;
  };
  if (kind.level !== undefined && kind.ch === 1) {
    const L = kind.level;
    if (L >= 4) slots[free()] = "light";
    if (L >= 5 && shape.stones > 0) slots[free()] = "heavy";
    if (L >= 7) slots[free()] = "bounce";
  } else if (kind.ch === 2 || kind.ch === "daily") {
    const count = 1 + Math.floor(rng() * 2);
    for (let i = 0; i < count; i++) slots[free()] = KNACK_NAMES[Math.floor(rng() * KNACK_NAMES.length)];
  } else {
    for (let i = 0; i < shape.N; i++) if (rng() < 0.5) slots[i] = KNACK_NAMES[Math.floor(rng() * KNACK_NAMES.length)];
  }
  return slots.map((s) => (s === -1 ? null : s));
}

// The tins of one shelf: a pyramid of rows, each row touching and centred. The base row is as long as the shelf
// allows; rows above are shorter by one until all n tins are placed.
function pyramid(ledge, n) {
  const maxBase = Math.floor((ledge.x1 - ledge.x0 - 2 * TIN_R) / (2 * TIN_R)) + 1;
  const base = Math.min(n, maxBase);
  const cx = (ledge.x0 + ledge.x1) / 2;
  const out = [];
  let remaining = n, len = base, row = 0;
  while (remaining > 0 && len > 0) {
    const take = Math.min(len, remaining);
    for (let i = 0; i < take; i++) {
      out.push({ x: cx - (take - 1) * TIN_R + i * 2 * TIN_R, y: ledge.top - TIN_R - row * ROW_DROP, ledge: -1 });
    }
    remaining -= take;
    len = take - 1;
    row += 1;
  }
  return remaining === 0 ? out : null; // a shelf too narrow for its share is a failed layout
}

function overlaps(a, b, ra, rb) {
  return Math.hypot(a.x - b.x, a.y - b.y) < ra + rb - 0.5;
}

// The circle-vs-box check for a tin or stone against a shelf it isn't on: no overlap with any box.
function hitsBox(p, r, L) {
  const cx = Math.min(Math.max(p.x, L.x0), L.x1), cy = Math.min(Math.max(p.y, L.top), L.top + L.h);
  return Math.hypot(p.x - cx, p.y - cy) < r - 0.5;
}

// Builds a tower from a shape (numbers or [lo, hi] ranges, picked from the seed). kind: { level, ch } for knacks and
// touch; the daily passes { ch: "daily" } and gets no touch shelves. Returns null when this seed isn't placeable.
function build(shape, seed, kind) {
  const rng = mulberry32(seed);
  const pick = (v) => (Array.isArray(v) ? v[0] + Math.floor(rng() * (v[1] - v[0] + 1)) : v);
  const N = shape.N;
  const shelves = pick(shape.ledges);
  const stones = pick(shape.stones);
  const planks = Math.min(pick(shape.planks), shelves);
  const tinTotal = typeof shape.tins === "number" ? shape.tins : pick(shape.tins);
  const touch = kind.ch === 1;

  // Shelves from the lowest up, each at its own height and a random place along the field.
  const ledges = [];
  for (let i = 0; i < shelves; i++) {
    const w = 120 + Math.floor(rng() * 81);
    const top = FLOOR - 70 - i * 70 - Math.floor(rng() * 20);
    const x0 = X_MIN + Math.floor(rng() * (X_MAX - X_MIN - w));
    ledges.push({
      x0, x1: x0 + w, top, h: 16,
      plank: i < planks ? true : undefined,
      touch: touch ? true : undefined, // chapter 1 shelves topple from any touch (the level 1 rule, as data)
    });
  }

  // Tins share out across the shelves, as evenly as possible.
  const per = ledges.map((_, i) => Math.floor(tinTotal / shelves) + (i < tinTotal % shelves ? 1 : 0));
  const tins = [];
  for (let i = 0; i < shelves; i++) {
    const p = pyramid(ledges[i], per[i]);
    if (!p) return null;
    for (const t of p) tins.push({ x: t.x, y: t.y, ledge: i });
  }

  // Stones stand on the floor along the approach, never on a shelf or a tin.
  const stonePos = [];
  for (let tries = 0; stonePos.length < stones && tries < 200; tries++) {
    const s = { x: 300 + rng() * 260, y: FLOOR - STONE_R };
    if (stonePos.some((q) => overlaps(s, q, STONE_R, STONE_R))) continue;
    stonePos.push(s);
  }
  if (stonePos.length < stones) return null;

  // Validate: no tin overlaps another tin, a shelf it doesn't rest on, or a stone; no stone on a shelf.
  for (let i = 0; i < tins.length; i++) {
    for (let j = i + 1; j < tins.length; j++) if (overlaps(tins[i], tins[j], TIN_R, TIN_R)) return null;
    if (ledges.some((L, k) => k !== tins[i].ledge && hitsBox(tins[i], TIN_R, L))) return null;
  }
  for (const s of stonePos) {
    if (tins.some((t) => overlaps(s, t, STONE_R, TIN_R))) return null;
    if (ledges.some((L) => hitsBox(s, STONE_R, L))) return null;
  }

  return {
    N,
    seed,
    ledges,
    tins,
    stones: stonePos,
    slots: knacksFor(kind, { N, stones }, rng),
  };
}

// The tower for a level (1–30) and seed. Null when this seed's layout is not placeable (the caller tries the next).
export function generateLevel(level, seed) {
  const def = build(levelShape(level), seed, { level, ch: chapterOf(level) });
  return def && { level, ...def };
}

// The daily tower for a seed (the daily pool, spec §2). Null when this seed isn't placeable.
export function generateDaily(seed) {
  const def = build(DAILY_SHAPE, seed, { ch: "daily" });
  return def && { level: "daily", ...def };
}
