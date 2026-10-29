// THE-1156 S2 (board note 2, "the ball looks like it bounces on the sand"). The old model restarted a
// fixed 420ms sin(pi*t) arc at every hit, wall bounce AND serve -- a fast rally hit the sand several
// times a second. A wall bounce only flips the ball's vy, never its vx, so a flight's x-distance (and
// therefore its duration) is fixed the instant it leaves a paddle or a serve launches; this module gives
// that one flight a single arc from contact height, up, back down to contact height, and a wall bounce
// partway through doesn't touch it. Pure: the caller (game.js) owns the wall clock and feeds elapsedMs.

// Duration (ms) of a flight that just started at `fromX`, heading toward `toX`, at speed |vx| (u/s).
export function flightDurationMs(fromX, toX, vx) {
  if (!vx) return 0;
  return (1000 * Math.abs(toX - fromX)) / Math.abs(vx);
}

// Height (normalised: contactHN at the sand-adjacent contact point, 1 at the arc's apex) at `elapsedMs`
// into a flight lasting `flightMs` total -- one sin(pi*t) arc end to end. Past the end of the flight (the
// ball hasn't been hit again yet, e.g. held at a goal line) it clamps to contactHN rather than looping.
export function flightHeightNorm(elapsedMs, flightMs, contactHN) {
  const t = flightMs > 0 ? Math.min(1, Math.max(0, elapsedMs / flightMs)) : 1;
  return contactHN + (1 - contactHN) * Math.sin(Math.PI * t);
}
