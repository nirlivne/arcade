// Petal Patch run/daily logic: the endless run curve and its seeded no-repeat draw, the daily's local-date
// index, streak, and the THE-175 share line. Pure -- dates and randomness are always passed in, never read
// from Date.now()/Math.random() directly, so this is fully testable (design.md "dates injected").

export const SHARE_URL = "https://nirlivne.github.io/arcade/games/petal-patch/";
const DAILY_COUNT = 366;
// The epoch is a named constant so the CEO can still move it (spec §2 "Daily date"); 2026-10-01 is a Thursday.
export const EPOCH = { y: 2026, m: 9, d: 1 }; // month is 0-indexed: October = 9

// --- seeded RNG (LCG, matches the generator's) ---
export function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function newRunSeed(rand = Math.random) {
  return Math.floor(rand() * 0xffffffff) >>> 0;
}

function shuffleWithRng(rng, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// --- run curve: board # in the run -> tier (spec §3) ---
export function tierForBoardNo(boardNo) {
  if (boardNo === 1) return "P";
  if (boardNo <= 3) return "E";
  if (boardNo <= 5) return "M1";
  if (boardNo <= 8) return "M2";
  if (boardNo <= 11) return "H1";
  return "H2";
}

export function h2HalfForBoardNo(boardNo) {
  return boardNo <= 15 ? "lower" : "upper";
}

// H2's 60 boards split by steps ascending: first half = "lower" (boards 12-15), rest = "upper" (16+).
function h2Halves(pack) {
  const sorted = [...pack.endless.H2].sort((a, b) => a.steps - b.steps || a.id.localeCompare(b.id));
  const mid = Math.ceil(sorted.length / 2);
  return { lower: sorted.slice(0, mid).map((b) => b.id), upper: sorted.slice(mid).map((b) => b.id) };
}

function poolKeyForBoardNo(boardNo) {
  const tier = tierForBoardNo(boardNo);
  if (tier !== "H2") return tier;
  return h2HalfForBoardNo(boardNo) === "lower" ? "H2lower" : "H2upper";
}

function poolIdsFor(pack, poolKey) {
  if (poolKey === "P") return pack.practice.map((b) => b.id);
  if (poolKey === "H2lower" || poolKey === "H2upper") {
    const halves = h2Halves(pack);
    return poolKey === "H2lower" ? halves.lower : halves.upper;
  }
  return pack.endless[poolKey].map((b) => b.id);
}

export function findBoard(pack, tier, id) {
  const list = tier === "P" ? pack.practice : pack.endless[tier];
  return list.find((b) => b.id === id);
}

// Draw the next id from a pool: no repeat until the shuffled order is exhausted, then reshuffle excluding
// the last 10 ids played (spec §3 "Endless run curve"). poolState = { order:[ids], pos, recent:[<=10 ids] }.
export function drawFromPool(rng, poolIds, poolState) {
  let { order, pos, recent } = poolState || { order: [], pos: 0, recent: [] };
  if (!order.length || pos >= order.length) {
    const excluded = new Set(recent);
    const avail = poolIds.filter((id) => !excluded.has(id));
    order = shuffleWithRng(rng, avail.length ? avail : poolIds);
    pos = 0;
  }
  const id = order[pos];
  pos += 1;
  recent = [...recent, id].slice(-10);
  return { id, poolState: { order, pos, recent } };
}

// nextRunBoard(pack, rng, runPoolState, boardNo) -> { id, tier, poolState } (poolState = the full per-run
// pool-state map, updated for the drawn pool key only).
export function nextRunBoard(pack, rng, runPoolState, boardNo) {
  const tier = tierForBoardNo(boardNo);
  const poolKey = poolKeyForBoardNo(boardNo);
  const ids = poolIdsFor(pack, poolKey);
  const { id, poolState } = drawFromPool(rng, ids, (runPoolState || {})[poolKey]);
  return { id, tier, poolState: { ...runPoolState, [poolKey]: poolState } };
}

export function isBetterRun(a, b) {
  if (!a) return false;
  if (!b) return true;
  if (a.boards !== b.boards) return a.boards > b.boards;
  return a.stars > b.stars;
}

// --- daily ---

// Days since the local epoch date, computed via Date.UTC on both ends only to make the subtraction
// DST-proof (design.md "Save and seed"). `date` must be a plain Date already in the viewer's local time.
export function daysSinceEpoch(date) {
  const y = date.getFullYear(), m = date.getMonth(), d = date.getDate();
  return Math.round((Date.UTC(y, m, d) - Date.UTC(EPOCH.y, EPOCH.m, EPOCH.d)) / 86400000);
}

// Before the epoch: board 0, "No. 1". Past the list: board = d mod 366, No. keeps counting (d + 1).
export function dailyBoardIndex(d) {
  if (d < 0) return 0;
  return d % DAILY_COUNT;
}

export function dailyNo(d) {
  if (d < 0) return 1;
  return d + 1;
}

export function dailyDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function parseDateKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function isNextLocalDay(prevKey, key) {
  if (!prevKey) return false;
  const diff = Math.round((parseDateKey(key) - parseDateKey(prevKey)) / 86400000);
  return diff === 1;
}

// A wilted daily still counts as played (keeps the streak); only a missed date resets it (spec §2 "Streak").
export function nextStreak(streak, dateKey, played) {
  if (!played) return streak || { last: null, count: 0 };
  if (streak && streak.last === dateKey) return streak; // already recorded today
  const count = isNextLocalDay(streak?.last, dateKey) ? (streak?.count || 0) + 1 : 1;
  return { last: dateKey, count };
}

// --- share text (THE-175 format, verbatim) ---

export function formatTime(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// `title`/`url` are read from theme.js by the caller (game.js) and passed in -- this module stays pure
// and never reads window.THEME itself, so it can keep being tested with plain data.
export function shareText({ no, wilted, petals, ms, stars, title = "Petal Patch", url = SHARE_URL }) {
  const result = wilted ? "🥀" : "🌸".repeat(Math.max(1, Math.min(3, petals)));
  const starStr = "★".repeat(wilted ? 1 : Math.max(0, Math.min(3, stars)));
  return `${title} No. ${no}\n${result} ${formatTime(ms)} ${starStr}\n${url}`;
}

// The run's "Share run" text (THE-189), same shape as the daily's shareText above: pure, `title`/`url`
// read from theme.js by the caller. No dedication line -- that's a clipping-only extra (spec §2).
export function runShareText({ boards, stars, title = "Petal Patch", url = SHARE_URL }) {
  const boardWord = boards === 1 ? "board" : "boards";
  return `${title} · endless run\n${boards} ${boardWord} · ${stars}★\n${url}`;
}
