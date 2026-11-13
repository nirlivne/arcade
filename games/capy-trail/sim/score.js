// Pure (spec Part 2 "Score"): score = distance_m x scoreMult + coins (coins banked this run, chain
// doubling already folded in by sim.js's own `coins += coinMultiplier`). scoreMult is always 1 until
// slice 7 (missions) raises it; it never lives on the sim, only on the save.
export function computeScore(distanceM, scoreMult, coins) {
  return Math.round(distanceM) * scoreMult + coins;
}
