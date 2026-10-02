// Captain Fold progress.js: per-course stars + best, the daily record (today's best flight) and its share
// text (THE-261, CTO crash-line amendment on THE-260), and fold-collection unlocks (spec S2/S8, THE-264 M1).
// Pure: dates are always local y/m/d (never read from the system clock or UTC directly), so tests inject fixed
// dates. Course/day numbering is owned by courses.js (it already needs the same math for dailyCourse).
import { dailyNo, PACK } from "./courses.js";

export const SHARE_URL = "https://nirlivne.github.io/arcade/games/captain-fold/";

export function dailyNumber(y, m, d) {
  return dailyNo(y, m, d);
}

export function localDateKey(y, m, d) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// A course's best: the higher stars, then the higher score. core.js's score() already guarantees any landing
// scores above any crash on the same course, so taking the max score alone would be enough - stars are tracked
// alongside because the Hangar shows them directly (spec S6 "course map ... stars + best"). bestX (G6-A10, the
// best-flag pennant, brief S3) is updated ATOMICALLY with best - it's the x of the flight that set the current
// best score, not the independent lifetime-max x (a flag drawn at the biggest-ever crash paired with a
// completely different, better landing's score would be wrong: "on the lawn at your best crash x; once landed,
// it moves to your best touchdown"). crashes (G6-A10) is the "3 crashes unlocks the next course anyway" comfort
// counter (spec S8) - it now persists across a reload, and resets the moment the course is landed.
export function mergeCourseBest(courses, id, stars, scoreVal, xMetres, landed) {
  const prev = courses[id] || { stars: 0, best: 0, bestX: 0, crashes: 0 };
  const isNewBest = scoreVal > prev.best;
  return {
    ...courses,
    [id]: {
      stars: Math.max(prev.stars, stars),
      best: isNewBest ? scoreVal : prev.best,
      bestX: isNewBest ? xMetres : prev.bestX,
      crashes: landed ? 0 : prev.crashes + 1,
    },
  };
}

// Today's daily record: unlimited tries per day, but only the day's BEST flight is kept (spec S3) - a landing
// if any flight landed, otherwise the furthest crash. `scoreVal` is core.js's score(): for a crash it is exactly
// the distance flown in metres, which is what the crash share line needs, so no separate field for it. bestX
// (G6-A10) is the x of that same best flight, for the daily's best-flag pennant.
export function mergeDaily(daily, y, m, d, result, scoreVal, xMetres) {
  const date = localDateKey(y, m, d);
  if (daily && daily.date === date && daily.best >= scoreVal) return daily; // an earlier try today was already better
  return { date, best: scoreVal, bestX: xMetres, stars: result.kind === "land" ? result.stars : 0, result: result.kind };
}

// A course is unlocked once the one before it in the pack has been landed at least once (stars > 0 - a crash
// always records 0 stars, per core.js's starsFor()), OR 3 crashes on it anyway (spec S8's comfort, G6-A10:
// persisted now, not a session counter - a kid who reloads shouldn't lose the unlock). The first course is
// always unlocked.
export function courseUnlocked(courses, id) {
  const i = PACK.findIndex((c) => c.id === id);
  if (i <= 0) return true;
  const prev = courses[PACK[i - 1].id];
  return !!prev && (prev.stars > 0 || prev.crashes >= 3);
}

// The course THROW! should continue with: the first unlocked-but-not-yet-landed course, or the last course in
// the pack once everything is landed (so there's always something to fly).
export function nextCourseId(courses) {
  for (const c of PACK) if (!courses[c.id] || courses[c.id].stars === 0) return c.id;
  return PACK[PACK.length - 1].id;
}

// CTO review B6: an entry exists in `courses` after a crash too (mergeCourseBest always records one, stars 0),
// so "finish Chapter N" must require an actual landing (stars > 0) on every course, not just an attempt.
function chapterDone(courses, chapter) {
  for (let i = 1; i <= 8; i++) if (!courses[`${chapter}-${i}`] || courses[`${chapter}-${i}`].stars === 0) return false;
  return true;
}

// Fold-collection unlocks (spec S8, 6 patterns): notebook is always available. `landings`/`lucky` are the
// save's lifetime counters; `courses` is the save's per-course {stars,best} map.
export function unlockedFolds({ landings, lucky, courses }) {
  const folds = ["notebook"];
  if (landings > 0) folds.push("graph");
  if (lucky >= 50) folds.push("newspaper");
  if (chapterDone(courses, 1)) folds.push("map");
  if (Object.values(courses).filter((c) => c.stars === 3).length >= 10) folds.push("origami");
  if (chapterDone(courses, 3)) folds.push("gold");
  return folds;
}

// Share text (THE-261's format; the CTO's crash-line amendment on THE-260): a landing reads "PLANE stars", a
// crash reads "CRASH {m} m" (glyphs omitted from this comment - see the source string literal below).
export function shareText(no, daily, url = SHARE_URL) {
  const line = daily.result === "land" ? `✈️ ${"★".repeat(daily.stars)}` : `💥 ${daily.best} m`;
  return `Captain Fold No. ${no}\n${line}\n${url}`;
}
