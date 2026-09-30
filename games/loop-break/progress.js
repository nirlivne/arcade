// Loop Break progress.js: pack progress (best stars per level, unlocks), the daily by local date (No.,
// streak, the failed-attempt star cap) and the share line (THE-229 format). Pure -- every date comes in as
// a `Date`, read only via getFullYear/getMonth/getDate (never UTC), so tests inject fixed dates instead of
// relying on the system clock or timezone.
export const SHARE_URL = "https://nirlivne.github.io/arcade/games/loop-break/";
export const LAUNCH_DATE = { y: 2026, m: 10, d: 1 }; // dailies start 2026-10-01 (spec §3); No. 1 that day.
const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function localDateParts(date) {
  return { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() };
}

export function dateKey({ y, m, d }) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseDateKey(s) {
  const m = DATE_KEY_RE.exec(s);
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
}

// Both parts are already resolved local y/m/d, so this arithmetic never depends on the caller's timezone.
function daysBetween(a, b) {
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
}

// N = local days since launch + 1, floored at 1 so a pre-launch clock never shows "No. 0" (CTO, THE-232).
export function dailyNumber(date) {
  return Math.max(1, daysBetween(LAUNCH_DATE, localDateParts(date)) + 1);
}

// The streak shows 0 once the last opened day is two or more days back, computed at render time so the
// display is never stale even before the next daily is opened (spec §8).
export function effectiveStreak(streak, date) {
  if (!streak || !streak.last) return 0;
  const last = parseDateKey(streak.last);
  if (!last) return 0;
  const gap = daysBetween(last, localDateParts(date));
  return gap <= 1 ? streak.count : 0;
}

// Called once, the first time that local date's daily is won. A no-op if today was already counted.
export function advanceStreak(streak, date) {
  const today = dateKey(localDateParts(date));
  if (streak.last === today) return streak;
  const last = streak.last && parseDateKey(streak.last);
  const gap = last ? daysBetween(last, localDateParts(date)) : Infinity;
  return { last: today, count: gap === 1 ? streak.count + 1 : 1 };
}

// ★★★ = par, ★★ = par+1, ★ = opened within budget (only reachable on +2-slack levels, since a +1-slack
// level's budget is par+1 -- spec §2 "Stars").
export function starsFor(used, par) {
  if (used <= par) return 3;
  if (used === par + 1) return 2;
  return 1;
}

// A failed attempt earlier the same day caps that day's recorded result at ★★ (spec rev 3, §2 "Daily").
export function cappedStars(stars, failedAttempts) {
  return failedAttempts > 0 ? Math.min(stars, 2) : stars;
}

// The best result per level survives across replays: the higher star count, then the fewer moves.
export function mergeLevelResult(levels, id, stars, used) {
  const prev = levels[id];
  const nextStars = Math.max(prev ? prev.stars : 0, stars);
  const nextBest = prev && prev.stars >= stars ? Math.min(prev.best, used) : used;
  return { ...levels, [id]: { stars: nextStars, best: nextBest } };
}

// pack 2 unlocks after L8, pack 3 after L16 (spec §8).
export function packUnlocked(pack, levels) {
  if (pack <= 1) return true;
  if (pack === 2) return !!levels[8];
  return !!levels[16];
}

// The second skin unlocks on finishing pack 1 (L1-8 all with a recorded result).
export function skin2Unlocked(levels) {
  for (let id = 1; id <= 8; id++) if (!levels[id]) return false;
  return true;
}

export function shareText(no, used, stars, url = SHARE_URL) {
  const moveWord = used === 1 ? "move" : "moves";
  return `Loop Break #${no} — opened in ${used} ${moveWord} ${"★".repeat(stars)}\n${url}`;
}
