// Petal Patch save: the `petal-patch:v1` key, per-field sanitiser (a wrong-shape field resets only that
// field, never the whole save), try/catch on every read and write. Storage is injected (design.md "Pure
// (storage injected)") so tests can pass a fake store and the browser passes window.localStorage.

export const SAVE_KEY = "petal-patch:v1";
export const SAVE_VERSION = 1;
const MAX_CELL = 81; // the largest board is 9x9; a generic range guard, not board-specific validation
const MS_DAY = 24 * 60 * 60 * 1000;
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function clampInt(v, min, max, fallback) {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function isCellArray(v) {
  return Array.isArray(v) && v.every((c) => Number.isInteger(c) && c >= 0 && c < MAX_CELL);
}

function sanitizeBoardState(raw) {
  const r = isPlainObject(raw) ? raw : {};
  return {
    id: typeof r.id === "string" ? r.id : "",
    bugs: isCellArray(r.bugs) ? r.bugs : [],
    red: isCellArray(r.red) ? r.red : [],
    marks: isCellArray(r.marks) ? r.marks : [],
    petals: clampInt(r.petals, 0, 3, 3),
    hints: clampInt(r.hints, 0, 3, 3),
    ms: clampInt(r.ms, 0, MS_DAY, 0),
  };
}

function sanitizeSettings(raw) {
  const r = isPlainObject(raw) ? raw : {};
  const motion = ["os", "reduce", "full"].includes(r.motion) ? r.motion : "os";
  return {
    sound: typeof r.sound === "boolean" ? r.sound : true,
    autoX: typeof r.autoX === "boolean" ? r.autoX : true,
    motion,
  };
}

function sanitizePoolState(raw) {
  const p = isPlainObject(raw) ? raw : {};
  const out = {};
  for (const key of Object.keys(p)) {
    const s = p[key];
    if (!isPlainObject(s)) continue;
    out[key] = {
      order: Array.isArray(s.order) ? s.order.filter((x) => typeof x === "string") : [],
      pos: clampInt(s.pos, 0, 1e6, 0),
      recent: Array.isArray(s.recent) ? s.recent.filter((x) => typeof x === "string").slice(-10) : [],
    };
  }
  return out;
}

function sanitizeRun(raw) {
  if (!isPlainObject(raw)) return null;
  if (!isPlainObject(raw.board)) return null;
  return {
    seed: clampInt(raw.seed, 0, 0xffffffff, 0),
    boardNo: clampInt(raw.boardNo, 1, 1e6, 1),
    poolState: sanitizePoolState(raw.poolState),
    board: sanitizeBoardState(raw.board),
    stars: clampInt(raw.stars, 0, 1e6, 0),
    score: clampInt(raw.score, 0, 1e6, 0),
    // Set when `board` was saved already-solved (spec §2 "clear hold... saved at that instant"), so a
    // resume knows to advance to the next board instead of reopening a board with nothing left to do
    // (THE-180 review fix 2).
    cleared: raw.cleared === true,
  };
}

function sanitizeBest(raw) {
  const r = isPlainObject(raw) ? raw : {};
  return { boards: clampInt(r.boards, 0, 1e6, 0), stars: clampInt(r.stars, 0, 1e6, 0) };
}

function sanitizeDailyEntry(raw) {
  const r = isPlainObject(raw) ? raw : {};
  return {
    done: typeof r.done === "boolean" ? r.done : false,
    wilted: typeof r.wilted === "boolean" ? r.wilted : false,
    petals: clampInt(r.petals, 0, 3, 3),
    ms: clampInt(r.ms, 0, MS_DAY, 0),
    stars: clampInt(r.stars, 0, 3, 0),
    board: isPlainObject(r.board) ? sanitizeBoardState(r.board) : null,
  };
}

function sanitizeDaily(raw) {
  if (!isPlainObject(raw)) return {};
  const out = {};
  for (const key of Object.keys(raw)) {
    if (!DATE_KEY_RE.test(key)) continue;
    out[key] = sanitizeDailyEntry(raw[key]);
  }
  return out;
}

function sanitizeStreak(raw) {
  const r = isPlainObject(raw) ? raw : {};
  const last = typeof r.last === "string" && DATE_KEY_RE.test(r.last) ? r.last : null;
  return { last, count: clampInt(r.count, 0, 1e6, 0) };
}

export function defaultSave() {
  return {
    v: SAVE_VERSION,
    firstRunDone: false,
    settings: { sound: true, autoX: true, motion: "os" },
    run: null,
    best: { boards: 0, stars: 0 },
    daily: {},
    streak: { last: null, count: 0 },
    active: null,
  };
}

function sanitizeActive(raw) {
  return raw === "run" || raw === "daily" ? raw : null;
}

// Walks the shape per field: a wrong type, out-of-range value or missing field resets the default for
// that field only. An unknown/missing `v` falls back to the same per-field defaults (there is no earlier
// version to migrate from yet). Never throws.
export function sanitize(raw) {
  const r = isPlainObject(raw) ? raw : {};
  return {
    v: SAVE_VERSION,
    firstRunDone: typeof r.firstRunDone === "boolean" ? r.firstRunDone : false,
    settings: sanitizeSettings(r.settings),
    run: sanitizeRun(r.run),
    best: sanitizeBest(r.best),
    daily: sanitizeDaily(r.daily),
    streak: sanitizeStreak(r.streak),
    // Which mode a reload should resume directly into (paused), per spec §2 "Reload mid-board" -- distinct
    // from "‹ Menu", which deliberately returns to the start screen instead. Cleared on any menu return.
    active: sanitizeActive(r.active),
  };
}

export function load(storage) {
  try {
    const raw = storage.getItem(SAVE_KEY);
    if (!raw) return defaultSave();
    return sanitize(JSON.parse(raw));
  } catch {
    return defaultSave();
  }
}

export function persist(storage, save) {
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}
