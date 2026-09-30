// Loop Break save.js: the three `loop-break:*` keys, each versioned and sanitised on its own so one
// corrupted key can't wipe the rest (spec §2/§8). Storage is injected (design.md "Pure (storage injected)")
// so tests pass a fake store and the browser passes window.localStorage. Every read and write is try/catch.
//
// `current`/`attempt` are sanitised for shape only (pos is n notches 0..7, used/takeBackLeft in range);
// game.js cross-checks `pos.length`, `used <= budget` etc. against the actual level from the catalog at
// load time, since only it knows which level `id` refers to, then drops `current`/`attempt` if they disagree.
export const SAVE_KEY = "loop-break:v1";
export const DAILY_KEY = "loop-break:daily";
export const STREAK_KEY = "loop-break:streak";
const VERSION = 1;
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function clampInt(v, min, max, fallback) {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function isNotchArray(v) {
  return Array.isArray(v) && v.length > 0 && v.every((x) => Number.isInteger(x) && x >= 0 && x < 8);
}

// --- loop-break:v1 (progress + settings + the in-progress level) ---

function sanitizeSettings(raw) {
  const r = isPlainObject(raw) ? raw : {};
  const motion = ["os", "reduce", "full"].includes(r.motion) ? r.motion : "os";
  const skin = r.skin === "gunmetal" ? "gunmetal" : "blued";
  return {
    sound: typeof r.sound === "boolean" ? r.sound : true,
    haptics: typeof r.haptics === "boolean" ? r.haptics : true,
    shake: typeof r.shake === "boolean" ? r.shake : true,
    motion,
    skin,
  };
}

function sanitizeLevels(raw) {
  const r = isPlainObject(raw) ? raw : {};
  const out = {};
  for (const key of Object.keys(r)) {
    const id = clampInt(key, 1, 999, 0);
    if (!id) continue;
    const e = isPlainObject(r[key]) ? r[key] : {};
    out[id] = { stars: clampInt(e.stars, 0, 3, 0), best: clampInt(e.best, 0, 999, 0) };
  }
  return out;
}

function sanitizeLastMove(raw) {
  if (!isPlainObject(raw) || !isNotchArray(raw.startPos)) return null;
  return { ring: clampInt(raw.ring, 0, 5, 0), startPos: raw.startPos.map((x) => clampInt(x, 0, 7, 0)) };
}

function sanitizeCurrent(raw) {
  if (!isPlainObject(raw) || !isNotchArray(raw.pos)) return null;
  const id = clampInt(raw.id, 1, 999, 0);
  if (!id) return null;
  return {
    id,
    pos: raw.pos.map((x) => clampInt(x, 0, 7, 0)),
    used: clampInt(raw.used, 0, 999, 0),
    takeBackLeft: clampInt(raw.takeBackLeft, 0, 1, 1),
    lastMove: sanitizeLastMove(raw.lastMove),
  };
}

export function defaultSave() {
  return {
    v: VERSION,
    firstRunDone: false,
    settings: { sound: true, haptics: true, shake: true, motion: "os", skin: "blued" },
    levels: {},
    skin2Unlocked: false,
    current: null,
  };
}

export function sanitize(raw) {
  const r = isPlainObject(raw) ? raw : {};
  return {
    v: VERSION,
    firstRunDone: typeof r.firstRunDone === "boolean" ? r.firstRunDone : false,
    settings: sanitizeSettings(r.settings),
    levels: sanitizeLevels(r.levels),
    skin2Unlocked: typeof r.skin2Unlocked === "boolean" ? r.skin2Unlocked : false,
    current: sanitizeCurrent(r.current),
  };
}

// --- loop-break:daily ---

function sanitizeDailyAttempt(raw) {
  if (!isPlainObject(raw) || !isNotchArray(raw.pos)) return null;
  return {
    pos: raw.pos.map((x) => clampInt(x, 0, 7, 0)),
    used: clampInt(raw.used, 0, 999, 0),
    takeBackLeft: clampInt(raw.takeBackLeft, 0, 1, 1),
  };
}

function sanitizeDailyResult(raw) {
  if (!isPlainObject(raw)) return null;
  return { moves: clampInt(raw.moves, 0, 999, 0), stars: clampInt(raw.stars, 0, 3, 0) };
}

// Shape-checks the cached generated level itself; a bad shape drops it so it regenerates. The daily's level
// is always regenerated from the date rather than trusted from cache (see game.js's ensureDaily), but this
// range-checks ring indices against `n` anyway as defense-in-depth for any other caller or older cached data.
function sanitizeDailyLevelData(raw) {
  if (!isPlainObject(raw)) return null;
  const n = clampInt(raw.n, 3, 6, 0);
  if (!n || !isNotchArray(raw.start) || raw.start.length !== n || !Array.isArray(raw.links)) return null;
  const inRange = (x) => Number.isInteger(x) && x >= 0 && x < n;
  const links = raw.links
    .filter((l) => isPlainObject(l) && inRange(l.from) && inRange(l.to) && l.from !== l.to && (l.type === "claw" || l.type === "pinion"))
    .map((l) => ({ from: l.from, to: l.to, type: l.type }));
  const driveOnly = Array.isArray(raw.driveOnly) ? raw.driveOnly.filter(inRange) : [];
  const par = clampInt(raw.par, 1, 20, 0);
  if (!par) return null;
  return { n, links, driveOnly, start: raw.start.map((x) => clampInt(x, 0, 7, 0)), par, budget: clampInt(raw.budget, par, par + 5, par) };
}

export function defaultDaily() {
  return { v: VERSION, date: null, level: null, attempt: null, result: null, failedAttempts: 0 };
}

// Doesn't compare `date` against today -- that needs the caller's clock, so game.js drops a cached daily
// whose date isn't today's local date after loading (spec §2 "a cached daily whose date isn't today... is
// dropped and regenerated").
export function sanitizeDaily(raw) {
  const r = isPlainObject(raw) ? raw : {};
  const date = typeof r.date === "string" && DATE_KEY_RE.test(r.date) ? r.date : null;
  const level = sanitizeDailyLevelData(r.level);
  const ok = date && level;
  return {
    v: VERSION,
    date: ok ? date : null,
    level: ok ? level : null,
    attempt: ok ? sanitizeDailyAttempt(r.attempt) : null,
    result: ok ? sanitizeDailyResult(r.result) : null,
    failedAttempts: ok ? clampInt(r.failedAttempts, 0, 999, 0) : 0,
  };
}

// --- loop-break:streak ---

export function defaultStreak() {
  return { v: VERSION, count: 0, last: null };
}

export function sanitizeStreak(raw) {
  const r = isPlainObject(raw) ? raw : {};
  const last = typeof r.last === "string" && DATE_KEY_RE.test(r.last) ? r.last : null;
  return { v: VERSION, count: clampInt(r.count, 0, 999999, 0), last };
}

// --- generic load/persist, try/catch on every read and write ---

function loadKey(storage, key, sanitizer, fallback) {
  try {
    const raw = storage.getItem(key);
    return raw ? sanitizer(JSON.parse(raw)) : fallback();
  } catch {
    return fallback();
  }
}

function persistKey(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const loadSave = (storage) => loadKey(storage, SAVE_KEY, sanitize, defaultSave);
export const loadDaily = (storage) => loadKey(storage, DAILY_KEY, sanitizeDaily, defaultDaily);
export const loadStreak = (storage) => loadKey(storage, STREAK_KEY, sanitizeStreak, defaultStreak);
export const persistSave = (storage, save) => persistKey(storage, SAVE_KEY, save);
export const persistDaily = (storage, daily) => persistKey(storage, DAILY_KEY, daily);
export const persistStreak = (storage, streak) => persistKey(storage, STREAK_KEY, streak);
