// The finale chase (spec §3.2 beat 21): a chase hazard, not a seeker -- contact snips even while
// hidden (fix 6), so this deliberately has no exposure/cone machinery, just a position and a
// contact check. Deterministic in elapsed seconds since the chase started, same pattern as every
// other timed beat in this level (lamps' sweep, the crowd's beat clock).
import { BODY_W } from './physics.js';

export const SCISSORS_SPEED = 520; // u/s
export const SCISSORS_START_GAP = 600; // u behind the hero's position when the chase starts

// startX: the hero's x when the chase started (CP11's spawnX -- the hero is always exactly there,
// frozen through the reveal stub or freshly respawned). tSec: seconds since the chase started.
export function scissorsX(startX, tSec) {
  return startX - SCISSORS_START_GAP + SCISSORS_SPEED * tSec;
}

// Contact, not a cone -- half the body width is close enough to call it caught.
export function scissorsCaught(scissorsX, heroX) {
  return Math.abs(heroX - scissorsX) <= BODY_W / 2;
}
