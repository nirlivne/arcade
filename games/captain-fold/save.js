// Captain Fold save.js: the single `captain-fold:v1` key (spec S2), sanitised per field so a corrupted or
// wrong-shape save resets to defaults field-by-field rather than crashing or wiping everything. Storage is
// injected (as on Loop Break/Petal Patch) so tests pass a fake store and the browser passes window.localStorage.
// Every read and write is try/catch.
export const SAVE_KEY = "captain-fold:v1";
const VERSION = 1;
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const COURSE_ID_RE = /^[1-3]-[1-8]$/;
const FOLDS = ["notebook", "graph", "newspaper", "map", "origami", "gold"];

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function clampInt(v, min, max, fallback) {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function sanitizeCourses(raw) {
  const r = isPlainObject(raw) ? raw : {};
  const out = {};
  for (const id of Object.keys(r)) {
    if (!COURSE_ID_RE.test(id)) continue;
    const e = isPlainObject(r[id]) ? r[id] : {};
    // bestX (G6-A10): the best flight's x in metres, for the best-flag pennant; crashes (G6-A10): a session-
    // spanning counter for the "3 crashes unlocks the next course anyway" comfort, reset once the course lands.
    out[id] = { stars: clampInt(e.stars, 0, 3, 0), best: clampInt(e.best, 0, 999999, 0), bestX: clampInt(e.bestX, 0, 999999, 0), crashes: clampInt(e.crashes, 0, 999999, 0) };
  }
  return out;
}

function sanitizeDaily(raw) {
  if (!isPlainObject(raw)) return null;
  const date = typeof raw.date === "string" && DATE_KEY_RE.test(raw.date) ? raw.date : null;
  if (!date) return null;
  const result = raw.result === "land" || raw.result === "crash" ? raw.result : null;
  if (!result) return null;
  return { date, best: clampInt(raw.best, 0, 9999999, 0), bestX: clampInt(raw.bestX, 0, 999999, 0), stars: clampInt(raw.stars, 0, 3, 0), result };
}

function sanitizeFolds(raw) {
  return Array.isArray(raw) ? [...new Set(raw.filter((f) => FOLDS.includes(f)))] : [];
}

function sanitizeSettings(raw) {
  const r = isPlainObject(raw) ? raw : {};
  return {
    sound: typeof r.sound === "boolean" ? r.sound : true,
    shake: typeof r.shake === "boolean" ? r.shake : true,
    motion: typeof r.motion === "boolean" ? r.motion : false, // false = normal motion, true = reduced (skin's data-reduce-motion)
    arc: typeof r.arc === "boolean" ? r.arc : true, // the throw-arc guide line, on by default (spec S2)
  };
}

export function defaultSave() {
  return {
    v: VERSION,
    courses: {},
    daily: null,
    lucky: 0,
    landings: 0,
    folds: ["notebook"],
    fold: "notebook",
    settings: { sound: true, shake: true, motion: false, arc: true },
    seenHowTo: false,
    seenFlightHint: false,
  };
}

export function sanitize(raw) {
  const r = isPlainObject(raw) ? raw : {};
  const folds = sanitizeFolds(r.folds);
  if (!folds.includes("notebook")) folds.unshift("notebook");
  const fold = FOLDS.includes(r.fold) && folds.includes(r.fold) ? r.fold : "notebook";
  return {
    v: VERSION,
    courses: sanitizeCourses(r.courses),
    daily: sanitizeDaily(r.daily),
    lucky: clampInt(r.lucky, 0, 9999999, 0),
    landings: clampInt(r.landings, 0, 999999, 0),
    folds,
    fold,
    settings: sanitizeSettings(r.settings),
    seenHowTo: typeof r.seenHowTo === "boolean" ? r.seenHowTo : false,
    // THE-311: gates the in-flight hint plate (#cf-hint-flight) to the player's first-ever flight, independent
    // of seenHowTo (the demo sets that one without the player ever having held anything themselves).
    seenFlightHint: typeof r.seenFlightHint === "boolean" ? r.seenFlightHint : false,
  };
}

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
export const persistSave = (storage, save) => persistKey(storage, SAVE_KEY, save);
