// One versioned key, sanitised on load, injected storage (THE-688 S1 scope: the bag + best scores only;
// later slices extend the schema). Pure except for the injected storage calls.
import { REGULARS, BEHAVIOURS } from "./deal.js";
import { HAND_INFO } from "./cards.js";

export const SAVE_KEY = "all-in-chomp:v1";
const BOOK_KEYS = new Set(HAND_INFO.filter((h) => h.key !== "highCard").map((h) => h.key));
const HAND_KEYS = new Set(HAND_INFO.map((h) => h.key));
const HAND_BY_KEY = Object.fromEntries(HAND_INFO.map((h) => [h.key, h]));
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function sanitiseBag(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!Array.isArray(raw.order) || raw.order.length !== REGULARS.length) return null;
  if (new Set(raw.order).size !== REGULARS.length) return null;
  for (const id of raw.order) if (!REGULARS.includes(id)) return null;
  if (!Number.isInteger(raw.i) || raw.i < 0 || raw.i > raw.order.length) return null;
  const last = REGULARS.includes(raw.last) ? raw.last : null;
  return { order: raw.order, i: raw.i, last };
}

function sanitiseBook(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, entry] of Object.entries(raw)) {
    if (!BOOK_KEYS.has(key)) continue;
    if (!entry || typeof entry !== "object") continue;
    if (!REGULARS.includes(entry.chomper) || !DATE_RE.test(entry.date)) continue;
    out[key] = { chomper: entry.chomper, date: entry.date };
  }
  return out;
}

function sanitiseNight(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!DATE_RE.test(raw.date)) return null;
  if (!Number.isInteger(raw.n) || raw.n < 1) return null;
  if (!Number.isInteger(raw.best) || raw.best < 0) return null;
  if (!REGULARS.includes(raw.chomper)) return null;
  if (!HAND_KEYS.has(raw.hand)) return null;
  return { date: raw.date, n: raw.n, best: raw.best, chomper: raw.chomper, hand: raw.hand };
}

// bestHandThisRun is either null or one of cards.js's HAND_INFO entries verbatim (bestHand()'s own return
// value) - validate shape+hand-key membership rather than trust the saved rank/name_he/payout blindly.
function sanitiseBestHand(raw) {
  if (raw == null) return null;
  if (typeof raw !== "object" || !HAND_KEYS.has(raw.key)) return null;
  const canonical = HAND_BY_KEY[raw.key];
  if (!Number.isInteger(raw.rank) || raw.rank !== canonical.rank) return null;
  if (raw.name_he !== canonical.name_he || raw.payout !== canonical.payout) return null;
  return { rank: canonical.rank, key: canonical.key, name_he: canonical.name_he, payout: canonical.payout };
}

function sanitiseRunSnapshot(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!REGULARS.includes(raw.chomper)) return null;
  if (!Array.isArray(raw.ghosts) || raw.ghosts.length !== 4 || raw.ghosts.some((g) => !REGULARS.includes(g))) return null;
  if (new Set(raw.ghosts).size !== 4 || raw.ghosts.includes(raw.chomper)) return null;
  if (!Array.isArray(raw.behaviours) || raw.behaviours.length !== 4) return null;
  if ([...raw.behaviours].sort().join() !== [...BEHAVIOURS].sort().join()) return null;
  if (!Number.isInteger(raw.level) || raw.level < 1) return null;
  if (!Number.isInteger(raw.score) || raw.score < 0) return null;
  if (!Number.isInteger(raw.buyIns) || raw.buyIns < 0 || raw.buyIns > 4) return null;
  if (!Number.isInteger(raw.rngSeed)) return null;
  if (raw.nightly === true && !DATE_RE.test(raw.date)) return null; // THE-690 r2 #4: a nightly snapshot without its own date can't be checked against "is this still today"
  return {
    chomper: raw.chomper,
    ghosts: raw.ghosts,
    behaviours: raw.behaviours,
    level: raw.level,
    score: raw.score,
    buyIns: raw.buyIns,
    rngSeed: raw.rngSeed,
    bonusBuyInUsed: raw.bonusBuyInUsed === true,
    firstRun: raw.firstRun === true,
    firstRunSteps: Number.isInteger(raw.firstRunSteps) && raw.firstRunSteps >= 0 ? raw.firstRunSteps : 0,
    nightly: raw.nightly === true,
    nightNumber: Number.isInteger(raw.nightNumber) ? raw.nightNumber : null,
    date: raw.nightly === true ? raw.date : null,
    bestHandThisRun: sanitiseBestHand(raw.bestHandThisRun),
  };
}

function sanitiseSettings(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    sound: typeof r.sound === "boolean" ? r.sound : true,
    motion: typeof r.motion === "boolean" ? r.motion : true,
  };
}

function freshSave() {
  return { v: 1, bag: null, best: {}, firstRunDone: false, book: {}, night: null, run: null, hintSeen: false, settings: sanitiseSettings(null) };
}

export function sanitise(raw) {
  if (!raw || typeof raw !== "object" || raw.v !== 1) return freshSave();
  const out = freshSave();
  out.bag = sanitiseBag(raw.bag);
  for (const [id, score] of Object.entries(raw.best || {})) {
    if (REGULARS.includes(id) && Number.isInteger(score) && score >= 0) out.best[id] = score;
  }
  out.firstRunDone = raw.firstRunDone === true;
  out.book = sanitiseBook(raw.book);
  out.night = sanitiseNight(raw.night);
  out.run = sanitiseRunSnapshot(raw.run);
  out.hintSeen = raw.hintSeen === true;
  out.settings = sanitiseSettings(raw.settings);
  return out;
}

export function createSave(storage, key = SAVE_KEY) {
  let data = null;
  function load() {
    if (data) return data;
    let raw = null;
    try {
      raw = JSON.parse(storage.getItem(key));
    } catch (e) {
      raw = null;
    }
    data = sanitise(raw);
    return data;
  }
  function write() {
    try {
      storage.setItem(key, JSON.stringify(data));
    } catch (e) {
      /* storage blocked: play on, nothing saved */
    }
  }
  function loadBag() {
    return load().bag;
  }
  function saveBag(bag) {
    const d = load();
    d.bag = bag;
    write();
  }
  function best(chomper) {
    return load().best[chomper] ?? 0;
  }
  function saveBest(chomper, score) {
    const d = load();
    const was = d.best[chomper] ?? 0;
    if (score > was) {
      d.best[chomper] = score;
      write();
    }
    return Math.max(was, score);
  }
  function firstRunDone() {
    return load().firstRunDone;
  }
  function markFirstRunDone() {
    const d = load();
    if (!d.firstRunDone) {
      d.firstRunDone = true;
      write();
    }
  }
  function loadBook() {
    return load().book;
  }
  // Stamped the first time a hand is made, with the dealt chomper and the date - never overwritten after.
  function stampHand(key, chomper, date) {
    if (!BOOK_KEYS.has(key)) return;
    const d = load();
    if (d.book[key]) return;
    d.book[key] = { chomper, date };
    write();
  }
  // The nightly table (G18): one slot, the night's best run (replaced only by a higher score that same
  // night; a new date starts fresh).
  function loadNight(date) {
    const d = load();
    if (d.night && d.night.date !== date) return null;
    return d.night;
  }
  function saveNightResult(date, n, { score, chomper, hand }) {
    const d = load();
    if (d.night && d.night.date === date && d.night.best >= score) return d.night;
    d.night = { date, n, best: score, chomper, hand };
    write();
    return d.night;
  }
  // Mid-level reload (G17): the in-progress run, restarted at its own level with the score/buy-ins banked
  // at level start. Cleared at game over (sim.js's run reaching 'over') and during the deal.
  function loadRunSnapshot() {
    return load().run;
  }
  function saveRunSnapshot(snapshot) {
    const d = load();
    d.run = snapshot;
    write();
  }
  function clearRunSnapshot() {
    const d = load();
    if (d.run !== null) {
      d.run = null;
      write();
    }
  }
  function hintSeen() {
    return load().hintSeen;
  }
  function markHintSeen() {
    const d = load();
    if (!d.hintSeen) {
      d.hintSeen = true;
      write();
    }
  }
  function settings() {
    return load().settings;
  }
  function setSetting(key, value) {
    const d = load();
    d.settings = sanitiseSettings({ ...d.settings, [key]: value });
    write();
  }
  return {
    load,
    loadBag,
    saveBag,
    best,
    saveBest,
    firstRunDone,
    markFirstRunDone,
    loadBook,
    stampHand,
    loadNight,
    saveNightResult,
    loadRunSnapshot,
    saveRunSnapshot,
    clearRunSnapshot,
    hintSeen,
    markHintSeen,
    settings,
    setSetting,
  };
}
