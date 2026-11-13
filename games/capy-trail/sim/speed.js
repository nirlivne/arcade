// Speed curve (spec §3, G10): one pure function of sim time. Ease-out from 8 to 16 m/s over the first
// 90 s, then a slow linear ramp to a 22 m/s cap (reached at t = 390 s). checks: v(0)=8, v(45)=14,
// v(90)=16, v(300)=20.2, v(400)=22.
export const SPEED_CAP = 22;
export function speedAt(t) {
  if (t <= 90) return 8 + 8 * (1 - Math.pow(1 - t / 90, 2));
  return Math.min(16 + 0.02 * (t - 90), SPEED_CAP);
}

// Numeric integral of speedAt from 0 to t (trapezoid rule). Used once to lay out the opening script's
// fixed distances, so "first log at 3.5 s" is a real, seed-independent position on the trail (spec §5:
// "the same layout on every seed").
export function distanceAt(t, steps = 2000) {
  if (t <= 0) return 0;
  const dt = t / steps;
  let s = 0, prev = speedAt(0);
  for (let i = 1; i <= steps; i++) {
    const cur = speedAt(i * dt);
    s += ((prev + cur) / 2) * dt;
    prev = cur;
  }
  return s;
}
