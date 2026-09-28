// Rush Lane save-data shape guards: pure logic, no DOM (loads as a classic script in the browser, window.
// RushLaneSave, and via require() in node for tests -- same pattern as board.js). A save can be valid JSON
// but the wrong shape (null, {}, a number, a stale/out-of-range level, a non-object stars map...);
// UIKit.store only guards against JSON that fails to parse, not against shape, so every read of a save goes
// through these sanitisers instead of trusting the stored value directly.
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) module.exports = mod;
  else root.RushLaneSave = mod;
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

  // A stars-map key that's already out of range (or not a plain integer at all) is garbage, not a slightly-off
  // value -- clamping it would silently remap it onto a real level and overwrite that level's actual stars.
  function exactIntInRange(key, min, max) {
    if (!/^\d+$/.test(key)) return null;
    const n = Number(key);
    return n >= min && n <= max ? n : null;
  }

  // `raw` is whatever UIKit.store handed back for the "progress" key (already guaranteed to be valid JSON,
  // but not guaranteed to be an object, let alone the right shape). `levelCount` is LEVELS.length.
  function sanitizeProgress(raw, levelCount) {
    const p = isPlainObject(raw) ? raw : {};
    const rawStars = isPlainObject(p.stars) ? p.stars : {};
    const stars = {};
    for (const key of Object.keys(rawStars)) {
      const level = exactIntInRange(key, 1, levelCount);
      if (level === null) continue;
      stars[level] = clampInt(rawStars[key], 0, 3, 0);
    }
    return { currentLevel: clampInt(p.currentLevel, 1, levelCount + 1, 1), stars };
  }

  // `raw` is whatever UIKit.store handed back for the "dailyBest" key: a map of "YYYY-MM-DD" -> hearts (0-3).
  function sanitizeDailyBest(raw) {
    if (!isPlainObject(raw)) return {};
    const best = {};
    for (const key of Object.keys(raw)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
      best[key] = clampInt(raw[key], 0, 3, 0);
    }
    return best;
  }

  // "YYYY-MM-DD" must round-trip through the *local* calendar day, matching UIKit.dateKey (which reads local
  // Year/Month/Date fields). `new Date("YYYY-MM-DD")` parses the string as UTC midnight instead, so in any
  // timezone behind UTC that silently rolls back to the previous local day -- for example retrying a daily
  // board would load a different day's puzzle than the one just played. Bad or missing input falls back to
  // "now" (the caller only ever passes either a well-formed key or a falsy value for "today").
  function parseLocalDateKey(dateStr) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || "");
    if (!m) return new Date();
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  return { isPlainObject, clampInt, sanitizeProgress, sanitizeDailyBest, parseLocalDateKey };
});
