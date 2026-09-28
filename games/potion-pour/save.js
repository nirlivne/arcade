// Potion Pour save-data shape guards: pure logic, no DOM (loads as a classic script, window.PotionPourSave, and
// via require() in node for tests -- same pattern as Rush Lane's save.js). UIKit.store only guards against JSON
// that fails to parse, not against shape, so every read of a save goes through these sanitisers instead of
// trusting the stored value directly: a save can be valid JSON but the wrong shape (null, {}, a number, a
// stale/out-of-range level...).
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) module.exports = mod;
  else root.PotionPourSave = mod;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function isPlainObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }

  function clampInt(v, min, max, fallback) {
    const n = Math.trunc(Number(v));
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  // A level-number key that's already out of range (or not a plain integer at all) is garbage, not a
  // slightly-off value -- clamping it would silently remap it onto a real level and overwrite that level's
  // actual best.
  function exactIntInRange(key, min, max) {
    if (!/^\d+$/.test(key)) return null;
    const n = Number(key);
    return n >= min && n <= max ? n : null;
  }

  // `raw` is whatever UIKit.store handed back for the "progress" key. `levelCount` is LEVELS.length.
  // `bestPours` maps level number -> fewest pours the player has solved it in; `stars` maps level number -> the
  // best star rating (1-3, design brief §6) earned there. Both are per-level return-loop items.
  function sanitizeProgress(raw, levelCount) {
    const p = isPlainObject(raw) ? raw : {};
    const rawBest = isPlainObject(p.bestPours) ? p.bestPours : {};
    const bestPours = {};
    for (const key of Object.keys(rawBest)) {
      const level = exactIntInRange(key, 1, levelCount);
      if (level === null) continue;
      const n = Math.trunc(Number(rawBest[key]));
      if (Number.isFinite(n) && n > 0) bestPours[level] = n;
    }
    const rawStars = isPlainObject(p.stars) ? p.stars : {};
    const stars = {};
    for (const key of Object.keys(rawStars)) {
      const level = exactIntInRange(key, 1, levelCount);
      if (level === null) continue;
      stars[level] = clampInt(rawStars[key], 0, 3, 0);
    }
    return { currentLevel: clampInt(p.currentLevel, 1, levelCount + 1, 1), bestPours, stars };
  }

  // `raw` is whatever UIKit.store handed back for the "dailyBest" key: a map of "YYYY-MM-DD" -> min moves taken.
  function sanitizeDailyBest(raw) {
    if (!isPlainObject(raw)) return {};
    const best = {};
    for (const key of Object.keys(raw)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
      const n = Math.trunc(Number(raw[key]));
      if (Number.isFinite(n) && n > 0) best[key] = n;
    }
    return best;
  }

  // `raw` is whatever UIKit.store handed back for the "settings" key.
  function sanitizeSettings(raw) {
    const s = isPlainObject(raw) ? raw : {};
    return {
      sound: typeof s.sound === "boolean" ? s.sound : true,
      vibration: typeof s.vibration === "boolean" ? s.vibration : false,
      reduceMotion: typeof s.reduceMotion === "boolean" ? s.reduceMotion : false,
      showFit: typeof s.showFit === "boolean" ? s.showFit : true,
    };
  }

  // `raw` is whatever UIKit.store handed back for the "midLevel" key: mid-shelf state so a shelf that takes up
  // to 2 minutes survives a reload (design brief §11). `levelCount` is LEVELS.length. Returns null for anything
  // that isn't a well-formed, in-range mid-level save -- callers fall back to starting the level fresh, same as
  // if there were no save at all, rather than trying to partially trust a malformed one.
  function sanitizeMidLevel(raw, levelCount) {
    if (!isPlainObject(raw)) return null;
    const isDaily = raw.isDaily === true;
    let level;
    if (isDaily) {
      if (typeof raw.level !== "string" || !/^daily-\d{4}-\d{2}-\d{2}$/.test(raw.level)) return null;
      level = raw.level;
    } else {
      level = exactIntInRange(String(raw.level), 1, levelCount);
      if (level === null) return null;
    }
    const capacity = clampInt(raw.capacity, 1, 20, null);
    if (capacity === null) return null;
    if (!Array.isArray(raw.vials) || raw.vials.length < 1 || raw.vials.length > 20) return null;
    const vials = [];
    for (const v of raw.vials) {
      if (!Array.isArray(v) || v.length > capacity) return null;
      const layers = [];
      for (const c of v) {
        const n = Math.trunc(Number(c));
        if (!Number.isFinite(n) || n < 0 || n > 11) return null;
        layers.push(n);
      }
      vials.push(layers);
    }
    const pours = clampInt(raw.pours, 0, 999, 0);
    const undosLeft = raw.undosLeft === "inf" ? Infinity : clampInt(raw.undosLeft, 0, 999, 0);
    const hintsLeft = clampInt(raw.hintsLeft, 0, 999, 0);
    const extraVialLeft = clampInt(raw.extraVialLeft, 0, 1, 0);
    return { level, isDaily, capacity, vials, pours, undosLeft, hintsLeft, extraVialLeft };
  }

  // "YYYY-MM-DD" must round-trip through the *local* calendar day, matching UIKit.dateKey (which reads local
  // Year/Month/Date fields). `new Date("YYYY-MM-DD")` parses the string as UTC midnight instead, so in any
  // timezone behind UTC that silently rolls back to the previous local day (Rush Lane's save.js hit this).
  function parseLocalDateKey(dateStr) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || "");
    if (!m) return new Date();
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  return { isPlainObject, clampInt, sanitizeProgress, sanitizeDailyBest, sanitizeSettings, sanitizeMidLevel, parseLocalDateKey };
});
