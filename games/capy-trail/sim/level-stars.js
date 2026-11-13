// THE-1412 (design/capy-trail/levels.md "Stars"): pure helpers, independently testable from the stateful
// sim. Bit 0 finish, bit 1 coins (this run's coins >= the level's coinTarget), bit 2 no hits (a shield
// absorb never counts -- sim.js's _stumble short-circuits before logging "stumble" when the shield
// absorbs, so counting stumble events already excludes it).
function bitCount(n) { return (n & 1) + ((n >> 1) & 1) + ((n >> 2) & 1); }
export function totalStars(starsArray) { return starsArray.reduce((a, m) => a + bitCount(m), 0); }

export function starsEarned({ finished, coinsThisRun, hits }, level) {
  if (!finished) return 0; // a caught/abandoned run (levels 10-12) earns nothing new, README "Failed"
  let mask = 1;
  if (coinsThisRun >= level.coinTarget) mask |= 2;
  if (hits === 0) mask |= 4;
  return mask;
}

// Stars are kept once earned in any run -- OR the newly-earned mask into the saved one.
export function mergeStars(savedMask, earnedMask) { return (savedMask | earnedMask) & 7; }

// Level 1 (index 0) is always unlocked; level N+1 unlocks once level N's finish bit (bit 0) is set.
export function isUnlocked(starsArray, levelIndex) {
  if (levelIndex <= 0) return true;
  return ((starsArray[levelIndex - 1] ?? 0) & 1) === 1;
}
