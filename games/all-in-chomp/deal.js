// Casting (G3/G4 rev 3): the chomper comes from a saved shuffle bag of the 8 regulars; ghosts are seeded
// random from the other 7. Pure.
import { shuffle, mulberry32, seedFromDate } from "./rng.js";

export const REGULARS = ["dagi", "eitan", "saalem", "shaiko", "yontsi", "nir", "ronzo", "even"];
export const BEHAVIOURS = ["direct", "ambusher", "flanker", "shy"];

export function freshBag(rng) {
  return { order: shuffle(rng, REGULARS), i: 0, last: null };
}

function isValidBag(bag) {
  if (!bag || typeof bag !== "object") return false;
  if (!Array.isArray(bag.order) || bag.order.length !== REGULARS.length) return false;
  if (new Set(bag.order).size !== REGULARS.length) return false;
  for (const id of bag.order) if (!REGULARS.includes(id)) return false;
  if (!Number.isInteger(bag.i) || bag.i < 0 || bag.i > bag.order.length) return false;
  return true;
}

// nextChomper(bag, rng) -> { chomper, bag }. The bag advances (and must be saved) at the deal, so a reload
// can't re-roll it. A wrong-shape bag gets a fresh one. A new bag never starts with the chomper who just
// finished the previous one.
export function nextChomper(bag, rng) {
  let b = isValidBag(bag) ? bag : freshBag(rng);
  if (b.i >= b.order.length) {
    let order = shuffle(rng, REGULARS);
    if (b.last != null && order[0] === b.last) {
      const j = 1 + Math.floor(rng() * (order.length - 1));
      [order[0], order[j]] = [order[j], order[0]];
    }
    b = { order, i: 0, last: b.last };
  }
  const chomper = b.order[b.i];
  return { chomper, bag: { order: b.order, i: b.i + 1, last: chomper } };
}

// 4 of the other 7, seeded random (no rotation, no history weighting), plus a seeded random permutation of
// the 4 behaviours - the behaviour is never tied to a person. Slot order (index 0-3) also drives the
// release order (4/8/12/16s, sim.js). Returns { ghosts: [4 ids], behaviours: [4 behaviour strings] }.
export function dealGhosts(rng, chomper) {
  const others = REGULARS.filter((id) => id !== chomper);
  const ghosts = shuffle(rng, others).slice(0, 4);
  const behaviours = shuffle(rng, BEHAVIOURS);
  return { ghosts, behaviours };
}

// The nightly table (G18/S6): the whole lineup (chomper + 4 ghosts + behaviours) from the local-date seed,
// the same for everyone that night - doesn't touch the bag. `?seed=N` deals the same way from an arbitrary
// seed. Returns { chomper, ghosts, behaviours, seed }.
export function dealNightly(dateSeed) {
  const rng = mulberry32(dateSeed);
  const chomper = REGULARS[Math.floor(rng() * REGULARS.length)];
  const { ghosts, behaviours } = dealGhosts(rng, chomper);
  return { chomper, ghosts, behaviours, seed: dateSeed };
}

// The player's own local calendar date as YYYY-MM-DD, from getFullYear/getMonth/getDate - never
// toISOString(), which is UTC and gives the wrong date for part of every day off UTC (THE-690 #5: before
// 03:00 IDT, or from 20:00 in a zone behind UTC, toISOString() names the wrong night).
export function localDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// N = days since NIGHT_EPOCH + 1 (local date). theme.js (Game Standard v2 §2.5) can override this; node
// tooling has no window, so it always gets this literal default.
export const NIGHT_EPOCH = (typeof window !== "undefined" && window.THEME && window.THEME.NIGHT_EPOCH) || "2026-10-13";
export function nightNumber(localDateStr) {
  const epoch = new Date(NIGHT_EPOCH + "T00:00:00");
  const d = new Date(localDateStr + "T00:00:00");
  return Math.round((d - epoch) / 86400000) + 1;
}

export function nightlySeed(localDateStr) {
  return seedFromDate(localDateStr);
}
