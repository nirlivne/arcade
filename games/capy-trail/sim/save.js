// capy-trail:v2. Validate-or-default on every load (G18): a wrong-shape value, corrupt JSON or blocked
// storage all fall back to the defaults inside try/catch, never a console error (the recurring
// code-review check for wrong-shape saves). Writes happen only at results, purchase and settings change
// (game.js owns when to call save(); this module never writes on its own).
// THE-1407: v1 -> v2. load() reads the v2 key; if it's missing, it reads v1, migrates it (bestScore: 0 --
// no fake score invented from the old distance -- and mult: 1), and the next save() call writes v2. The
// v1 key is left in place (cheap rollback) and never written again. Slice 7/8 add fields to v2 with
// defaults through sanitize() below, so there is no v3 -- extend sanitize()/defaults() in place.
// THE-1408: `missions` added the same way; `mult` stays top-level (slice 6). `missions.seed` defaults to
// a fixed constant, not Date.now(), so sanitize() stays pure (same bad input -> same output, every call).
// THE-1412: `levels.stars` added the same way -- 12 ints, 0-7 bitmask (bit 0 finish, 1 coins, 2 no hits).
// Wrong shape (not an array, wrong length, non-integer, out of 0-7) -> all zeros. A level run OR-merges its
// newly-earned mask into the saved one wherever the caller writes the save (game.js); sanitize() only
// validates shape, it never merges.
import { freshMissions, missionById, tierFor } from "./missions.js";
export const SAVE_KEY = "capy-trail:v2";
export const SAVE_KEY_V1 = "capy-trail:v1";
const MISSIONS_DEFAULT_SEED = 1;
export const LEVEL_COUNT = 12;

const TIERS = new Set(["auto", "high", "mid", "low"]);
const TOPPERS = new Set(["orange", "lilypad", "duck", "crown"]);

export function defaults() {
  return {
    v: 2,
    best: 0,
    bestScore: 0,
    coins: 0,
    owned: ["orange"],
    equipped: "orange",
    seenHowTo: false,
    mult: 1,
    missions: freshMissions(MISSIONS_DEFAULT_SEED, 1, 1),
    settings: { tier: "auto", music: true, sound: true, reduceMotion: false, bearHD: false },
    levels: { stars: new Array(LEVEL_COUNT).fill(0) },
  };
}

// THE-1412: 12 ints, each 0-7. Anything else about the array (not an array, wrong length, a non-integer
// or out-of-range entry anywhere) redraws the whole thing fresh -- there's no per-entry partial repair,
// same "wrong shape -> defaults" rule as every other field here.
function sanitizeLevels(raw) {
  const d = defaults().levels;
  const stars = raw?.stars;
  if (!Array.isArray(stars) || stars.length !== LEVEL_COUNT) return d;
  if (!stars.every((n) => Number.isInteger(n) && n >= 0 && n <= 7)) return d;
  return { stars: [...stars] };
}

// THE-1408: `set` must be 3 distinct ids from `tier`; anything else (unknown/duplicate/wrong-tier/shape)
// redraws a whole fresh set, since prog/done are positional and a changed set voids the old progress.
function sanitizeMissions(raw, tier) {
  const seed = typeof raw?.seed === "number" && Number.isFinite(raw.seed) ? raw.seed >>> 0 : MISSIONS_DEFAULT_SEED;
  const sets = isPosInt(raw?.sets) ? raw.sets : 1;
  const setOk = Array.isArray(raw?.set) && raw.set.length === 3 && new Set(raw.set).size === 3
    && raw.set.every((id) => missionById(id)?.tier === tier);
  if (!setOk) return freshMissions(seed, tier, sets);
  const prog = Array.isArray(raw.prog) && raw.prog.length === 3
    ? raw.prog.map((p) => (isFiniteNonNeg(p) ? p : 0))
    : [0, 0, 0];
  const done = Array.isArray(raw.done) && raw.done.length === 3 ? raw.done.map((d) => d === true) : [false, false, false];
  return { set: [...raw.set], prog, done, seed, sets };
}

function isFiniteNonNeg(v) { return typeof v === "number" && Number.isFinite(v) && v >= 0; }
function isNonNegInt(v) { return isFiniteNonNeg(v) && Number.isInteger(v); }
function isPosInt(v) { return typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v >= 1; }

// THE-1353: the old single `mute` boolean splits into `music` + `sound`. A save written before this
// still has `mute` and no `music`/`sound` -- migrate it (mute: true -> both off, false/missing -> both
// on) instead of defaulting it away. A save already in the new shape (music/sound booleans present) wins
// outright, even if a stale `mute` field also happens to be present.
function sanitizeSettings(raw) {
  const d = defaults().settings;
  if (!raw || typeof raw !== "object") return d;
  const migratedOn = typeof raw.mute === "boolean" ? !raw.mute : null;
  return {
    tier: TIERS.has(raw.tier) ? raw.tier : d.tier,
    music: typeof raw.music === "boolean" ? raw.music : migratedOn !== null ? migratedOn : d.music,
    sound: typeof raw.sound === "boolean" ? raw.sound : migratedOn !== null ? migratedOn : d.sound,
    reduceMotion: typeof raw.reduceMotion === "boolean" ? raw.reduceMotion : d.reduceMotion,
    bearHD: raw.bearHD === true, // THE-1582: Settings -> "HD bear", off unless explicitly true
  };
}

// Pure: raw (whatever JSON.parse produced, or undefined) -> a well-shaped v2 save. Never throws. Field-by-
// field validate-or-default, independent of the raw object's own declared `v` or shape -- this is also
// what lets a v1-shaped object (migration input, or a v2 key that somehow holds v1-shaped data) sanitize
// cleanly: bestScore/mult just default since they're absent, nothing else special-cased.
export function sanitize(raw) {
  const d = defaults();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return d;
  const ownedIn = Array.isArray(raw.owned) ? raw.owned.filter((id) => TOPPERS.has(id)) : [];
  const owned = new Set(ownedIn.length ? ownedIn : d.owned);
  owned.add("orange"); // always owned: the signature (spec §3)
  const equipped = typeof raw.equipped === "string" && owned.has(raw.equipped) ? raw.equipped : "orange";
  return {
    v: 2,
    best: isFiniteNonNeg(raw.best) ? raw.best : d.best,
    bestScore: isNonNegInt(raw.bestScore) ? raw.bestScore : d.bestScore,
    coins: isNonNegInt(raw.coins) ? raw.coins : d.coins,
    owned: [...owned],
    equipped,
    seenHowTo: typeof raw.seenHowTo === "boolean" ? raw.seenHowTo : d.seenHowTo,
    mult: isPosInt(raw.mult) ? raw.mult : d.mult,
    missions: sanitizeMissions(raw.missions, tierFor(isPosInt(raw.mult) ? raw.mult : d.mult)),
    settings: sanitizeSettings(raw.settings),
    levels: sanitizeLevels(raw.levels),
  };
}

function safeStorage(storage) {
  if (storage) return storage;
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch (e) { return null; }
}

// v1 -> v2: carries the bank, best distance, owned/equipped, seenHowTo and settings across; bestScore and
// mult are new in v2 and always start at their defaults (0 and 1), never backfilled from v1 data.
function migrateV1(rawV1) {
  if (!rawV1 || typeof rawV1 !== "object" || Array.isArray(rawV1)) return defaults();
  return sanitize({ ...rawV1, bestScore: 0, mult: 1 });
}

export function load(storage) {
  const s = safeStorage(storage);
  if (!s) return defaults();
  try {
    const v2Text = s.getItem(SAVE_KEY);
    if (v2Text) return sanitize(JSON.parse(v2Text));
  } catch (e) { /* corrupt v2 -- fall through and try a v1 migration below */ }
  try {
    const v1Text = s.getItem(SAVE_KEY_V1);
    if (v1Text) return migrateV1(JSON.parse(v1Text));
  } catch (e) { /* corrupt v1 too -- defaults below */ }
  return defaults();
}

export function save(data, storage) {
  const s = safeStorage(storage);
  if (!s) return false;
  try {
    s.setItem(SAVE_KEY, JSON.stringify(sanitize(data))); // v1 key is never written again (cheap rollback)
    return true;
  } catch (e) {
    return false; // storage blocked or full: play continues without persistence
  }
}
