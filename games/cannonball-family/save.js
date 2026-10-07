// Saves (THE-449 S1–S4): the best score and the best stars per level, and the daily Family Tower's first attempt.
// Sanitised on load. Storage is injected (getItem/setItem), so the game passes a try/catch wrapper around
// localStorage and the tests pass a plain object.
export const SAVE_KEY = "cannonball-family:v1";
const STAR_MAX = 3;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// source tells a resume apart a fuse-fired (random) shot from an aimed one, so it can redraw the rng to match
// (CTO review on THE-449, game.js's startDaily resume branch). Missing or unrecognised falls back to "aim"
// (never redrawing the rng) rather than failing the whole shot closed: a save from before this field existed
// still replays, just without the rng fix for whatever fuse shots are in it.
const SHOT_SOURCES = new Set(["aim", "keys", "fuse", "fuse-held"]);
function sanitiseShot(s) {
  if (!(s && typeof s === "object" && Number.isFinite(s.angle) && Number.isFinite(s.power) && Number.isInteger(s.step))) return null;
  return { angle: s.angle, power: s.power, step: s.step, source: SHOT_SOURCES.has(s.source) ? s.source : "aim" };
}

// The daily's first attempt (spec "Daily Family Tower"): never names, photos, colours or looks (R6).
function sanitiseDaily(raw) {
  if (!raw || typeof raw !== "object" || !DATE_RE.test(raw.date) || !Array.isArray(raw.shots)) return null;
  const shots = raw.shots.map(sanitiseShot);
  if (shots.some((s) => s === null)) return null;
  const done = raw.done === true;
  const out = { date: raw.date, shots, done };
  if (done) {
    if (typeof raw.won !== "boolean" || !Number.isInteger(raw.stars) || raw.stars < 0 || raw.stars > STAR_MAX || !Number.isInteger(raw.score) || raw.score < 0) return null;
    out.won = raw.won;
    out.stars = raw.stars;
    out.score = raw.score;
  }
  return out;
}

// Spec §8 comforts: a sound toggle and a reduced-motion setting, both in Pause. Defaults: sound on, motion
// normal (reducedMotion false) — the OS's own prefers-reduced-motion already applies regardless (tokens.css),
// this is only the game's own override for a player without that OS setting who still wants it off here.
function sanitiseSettings(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    sound: typeof r.sound === "boolean" ? r.sound : true,
    reducedMotion: typeof r.reducedMotion === "boolean" ? r.reducedMotion : false,
  };
}

export function sanitise(raw) {
  const out = { v: 1, best: {}, stars: {}, daily: null, demoSeen: false, settings: sanitiseSettings(null) };
  if (!raw || typeof raw !== "object" || raw.v !== 1) return out;
  for (const [level, score] of Object.entries(raw.best || {})) {
    if (/^\d+$/.test(level) && Number.isInteger(score) && score >= 0) out.best[level] = score;
  }
  for (const [level, n] of Object.entries(raw.stars || {})) {
    if (/^\d+$/.test(level) && Number.isInteger(n) && n >= 0 && n <= STAR_MAX) out.stars[level] = n;
  }
  out.daily = sanitiseDaily(raw.daily);
  out.demoSeen = raw.demoSeen === true;
  out.settings = sanitiseSettings(raw.settings);
  return out;
}

export function createSave(storage, key = SAVE_KEY) {
  let data = null;
  function load() {
    if (data) return data;
    let raw = null;
    try { raw = JSON.parse(storage.getItem(key)); } catch (e) { raw = null; }
    data = sanitise(raw);
    return data;
  }
  function write() {
    try { storage.setItem(key, JSON.stringify(data)); } catch (e) { /* storage blocked: play on, nothing saved */ }
  }
  // A level end: the best score and the best stars are kept separately. One write, and only when one of them improves.
  function saveResult(level, { score, stars }) {
    const d = load();
    const id = String(level);
    const bestWas = d.best[id] ?? -1, starsWas = d.stars[id] ?? -1;
    d.best[id] = Math.max(bestWas, score);
    d.stars[id] = Math.max(starsWas, stars);
    if (d.best[id] !== bestWas || d.stars[id] !== starsWas) write();
    return { best: d.best[id], stars: d.stars[id] };
  }
  function best(level) {
    return load().best[String(level)] ?? 0;
  }
  function starsOf(level) {
    return load().stars[String(level)] ?? 0;
  }
  function loadDaily() {
    return load().daily;
  }
  // The spec §5 first-run demo: shown once, ever, on this device (not once per level 1 play).
  function demoSeen() {
    return load().demoSeen;
  }
  function markDemoSeen() {
    const d = load();
    if (!d.demoSeen) { d.demoSeen = true; write(); }
  }
  function settings() {
    return load().settings;
  }
  function setSetting(key, value) {
    const d = load();
    d.settings = sanitiseSettings({ ...d.settings, [key]: value });
    write();
  }
  // Each first-attempt shot is appended and written as it fires (spec "Daily Family Tower", AC-P5: shots + 1
  // writes). A shot for a new date starts a fresh attempt: a closed tab can't cost a child the day, but it also
  // can't carry yesterday's shots into today.
  function appendDailyShot(date, shot) {
    const d = load();
    if (!d.daily || d.daily.date !== date) d.daily = { date, shots: [], done: false };
    d.daily.shots.push(shot);
    write();
  }
  // The first attempt's result: one write. After this, replays are Practice and never call this again.
  function finishDaily(date, { won, stars, score }) {
    const d = load();
    if (!d.daily || d.daily.date !== date) d.daily = { date, shots: [], done: false };
    d.daily.done = true;
    d.daily.won = won;
    d.daily.stars = stars;
    d.daily.score = score;
    write();
  }
  return { load, saveResult, best, starsOf, loadDaily, appendDailyShot, finishDaily, demoSeen, markDemoSeen, settings, setSetting };
}
