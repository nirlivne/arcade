// The daily Family Tower (THE-449 S4; spec §2 "Daily Family Tower"; launch kit THE-444 §1). Pure: the day comes from
// the local date, the tower from the pool, the share line from the result. Nothing here names a person.
import { generateDaily } from "./generator.js";

// Day 1 is the go-live date. THE-454 (the release checklist) sets it to the real go-live date; it's fixed per build.
export const DAILY_EPOCH = "2026-10-07";
export const POOL_SIZE = 365;
export const ARCADE_URL = "https://nirlivne.github.io/arcade/games/cannonball-family/";

const pad = (n) => String(n).padStart(2, "0");

// The device's local calendar date as YYYY-MM-DD (not UTC: the day boundary is local midnight, as the other dailies).
export function localDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Whole days from the epoch to the date. Counted in UTC on the calendar parts, so a daylight-saving change can't shift it.
export function dayIndex(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const [ey, em, ed] = DAILY_EPOCH.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ey, em - 1, ed)) / 86400000);
}

// Family Tower No. N: day 1 is the epoch day.
export function dailyNumber(dateKey) {
  return dayIndex(dateKey) + 1;
}

// The pool row for the date: pool[dayIndex mod 365].
export function poolIndex(dateKey) {
  return ((dayIndex(dateKey) % POOL_SIZE) + POOL_SIZE) % POOL_SIZE;
}

// The day's tower, from the solved pool (table: DAILY_TABLE, row i = pool[i]). The level number is the day index plus
// one, so the rail starts at the same member for everyone that day (member (L − 1) mod F). Null for an unsolved row.
export function dailyLevel(dateKey, table) {
  const row = table[poolIndex(dateKey)];
  if (!row) return null;
  const def = generateDaily(row.seed);
  return def && { ...def, level: dayIndex(dateKey) + 1, par: row.par, shots: row.shots };
}

// The share line (launch kit §1): the result, then one star per unused member capped by the tower's cap. A fail is the
// bomb alone. Never names, photos, colours or looks.
export function shareLine(dateKey, { won, stars }, url = ARCADE_URL) {
  const result = won ? (stars > 0 ? `🎪 ${"★".repeat(stars)}` : "🎪") : "💥";
  return `Family Tower No. ${dailyNumber(dateKey)}\n${result}\n${url}`;
}
