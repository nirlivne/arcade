// Level progress (THE-449 S4; spec §2 "Level select", "Stars"). Pure: reads the saved best scores and stars.
import { LEVEL_COUNT, levelDef } from "./levels.js";
import { STAR_MAX } from "./sim.js";

// THE-523 / spec v2 §E2: every level's star cap is STAR_MAX now - stars come from score thresholds, not a
// per-level cap on unused members (the v1 rule this replaced).
const capOf = () => STAR_MAX;

// A level is cleared once it has a best score: a win always scores at least 100 (one target).
export function isCleared(data, n) {
  return (data.best[String(n)] ?? 0) > 0;
}

// Play: the lowest uncleared, solved level; once all solved levels are cleared, the lowest solved level still
// below its star cap; else level 1. THE-523 S3: levelDef(n) is null for a level the solver hasn't produced yet
// (levels 11-30, in progress) - never routed to, or startLevel(n) crashes on a null def.
export function continueLevel(data) {
  for (let n = 1; n <= LEVEL_COUNT; n++) if (levelDef(n) && !isCleared(data, n)) return n;
  for (let n = 1; n <= LEVEL_COUNT; n++) if (levelDef(n) && (data.stars[String(n)] ?? 0) < capOf(n)) return n;
  return 1;
}

// The level map's total: the stars earned (each level capped) out of the possible stars (the sum of the caps),
// counting only levels the solver has actually produced (THE-523 S3, in progress for 11-30).
export function progressTotals(data) {
  let earned = 0, possible = 0, cleared = 0;
  for (let n = 1; n <= LEVEL_COUNT; n++) {
    if (!levelDef(n)) continue;
    const cap = capOf(n);
    possible += cap;
    earned += Math.min(cap, data.stars[String(n)] ?? 0);
    if (isCleared(data, n)) cleared += 1;
  }
  return { earned, possible, cleared };
}
