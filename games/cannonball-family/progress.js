// Level progress (THE-449 S4; spec §2 "Level select", "Stars"). Pure: reads the saved best scores and stars.
import { levelDef, LEVEL_COUNT } from "./levels.js";

const capOf = (n) => {
  const d = levelDef(n);
  return Math.min(3, d.N - d.par);
};

// A level is cleared once it has a best score: a win always scores at least 100 (one target).
export function isCleared(data, n) {
  return (data.best[String(n)] ?? 0) > 0;
}

// Play: the lowest uncleared level; once all are cleared, the lowest level still below its star cap; else level 1.
export function continueLevel(data) {
  for (let n = 1; n <= LEVEL_COUNT; n++) if (!isCleared(data, n)) return n;
  for (let n = 1; n <= LEVEL_COUNT; n++) if ((data.stars[String(n)] ?? 0) < capOf(n)) return n;
  return 1;
}

// The level map's total: the stars earned (each level capped) out of the possible stars (the sum of the caps).
export function progressTotals(data) {
  let earned = 0, possible = 0, cleared = 0;
  for (let n = 1; n <= LEVEL_COUNT; n++) {
    const cap = capOf(n);
    possible += cap;
    earned += Math.min(cap, data.stars[String(n)] ?? 0);
    if (isCleared(data, n)) cleared += 1;
  }
  return { earned, possible, cleared };
}
