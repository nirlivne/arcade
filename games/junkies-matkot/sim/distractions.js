// THE-1142 S5 (board note 6): beach distractions. Pure, seeded off match.rng (replay/CPU gates stay
// deterministic) -- no clock, no Math.random. Three types, each crossing the court horizontally over
// its own lifetime at a fixed y, with one collision opportunity per spawn (then it's spent, even if it
// missed). Max one active at a time; none in the first 20s of a match (onboarding: first 20s can't be
// lost) or outside "rally" (never during serve/pointPause); spawns are paced by accumulated *rally*
// seconds, targeting the designer's "about one every 20-30s" (placeholder range, pending their numbers).
//
// - crab: walks the sand line near a wall; a ball passing near it (inherently a "low" ball, since the
//   crab sits right by the wall) has its y-velocity flipped.
// - seagull: swoops through mid-court; rarely (on contact) snatches the ball, holds it briefly, then
//   drops it at a new y (same x-direction, re-centred so it's never an immediate uncontested score).
// - passerby (ice-cream seller): walks the central band; a ball hitting them bounces straight back
//   (the "block" effect from the two the designer's brief offers for this type).
import { C } from "./constants.js";
import { range } from "./rng.js";

export const TYPES = ["crab", "seagull", "passerby"];

const ONBOARDING_S = 20; // no distraction before this much total match time has elapsed
// THE-1156 S3 (board note 3, "no distractions seen at all"): paced by *match* time across points now,
// not accumulated *rally* seconds reset to 0 on every point end -- a match of short rallies (the common
// case) almost never reached the old rally-time target before it was reset. First target still 20-30s;
// every one after that is 20-40s (placeholder range, pending the designer's number).
const FIRST_TARGET_MIN_S = 20, FIRST_TARGET_MAX_S = 30;
const NEXT_TARGET_MIN_S = 20, NEXT_TARGET_MAX_S = 40;
const RALLY_GRACE_S = 1; // a target due between points waits this long into the next rally, not the instant it starts
export const CROSS_MARGIN_U = 80; // how far off-court the crossing starts/ends

const LIFETIME_S = { crab: 4, seagull: 3, passerby: 5 };
const HIT_RADIUS_U = { crab: 50, seagull: 55, passerby: 60 };
const SEAGULL_SNATCH_CHANCE = 0.35; // "rarely" snatches
const SEAGULL_HOLD_S = 0.6;

function spawnPosition(rng, type) {
  const dir = rng() < 0.5 ? 1 : -1;
  const x = dir === 1 ? -CROSS_MARGIN_U : C.COURT_W + CROSS_MARGIN_U;
  const vx = (dir * (C.COURT_W + CROSS_MARGIN_U * 2)) / LIFETIME_S[type];
  let y;
  if (type === "crab") {
    const nearTop = rng() < 0.5;
    const d = range(rng, 50, 140);
    y = nearTop ? d : C.COURT_H - d;
  } else if (type === "seagull") {
    y = range(rng, C.COURT_H * 0.3, C.COURT_H * 0.7);
  } else {
    y = range(rng, C.COURT_H * 0.2, C.COURT_H * 0.8);
  }
  return { x, y, vx };
}

function spawn(rng, type) {
  const { x, y, vx } = spawnPosition(rng, type);
  return { type, x, y, vx, r: HIT_RADIUS_U[type], lifetimeLeft: LIFETIME_S[type], triggered: false };
}

function applyEffect(match, d) {
  const ball = match.ball;
  const dist = Math.hypot(ball.x - d.x, ball.y - d.y);
  if (dist > d.r + C.BALL_R) return;
  d.triggered = true;
  if (d.type === "crab") {
    ball.vy = -ball.vy;
    match.events.push({ type: "distractionHit", kind: "crab" });
  } else if (d.type === "seagull") {
    const snatched = match.rng() < SEAGULL_SNATCH_CHANCE;
    if (snatched) {
      match.distractionHold = {
        releaseInS: SEAGULL_HOLD_S,
        dirSign: Math.sign(ball.vx) || 1,
        speed: ball.speed,
        newY: range(match.rng, C.COURT_H * 0.25, C.COURT_H * 0.75), // re-centred: never a free shot at a scorer
      };
      ball.vx = 0;
      ball.vy = 0;
    }
    match.events.push({ type: "distractionHit", kind: "seagull", snatched });
  } else {
    // passerby: a block -- bounce straight back the way it came, nudged clear so it can't re-trigger.
    ball.vx = -ball.vx;
    ball.x += Math.sign(ball.vx) * C.BALL_R;
    match.events.push({ type: "distractionHit", kind: "passerby" });
  }
}

export function step(match, dt) {
  if (match.distractionHold) {
    const hold = match.distractionHold;
    hold.releaseInS -= dt;
    if (hold.releaseInS <= 0) {
      match.ball.y = hold.newY;
      match.ball.vx = hold.dirSign * hold.speed;
      match.ball.vy = 0;
      match.ball.speed = hold.speed;
      match.distractionHold = null;
    }
  }

  match.distractionMatchS += dt;

  // Track when the current rally began (match-time), so a target that came due between points (during
  // pointPause/serve) can wait for RALLY_GRACE_S into the new rally instead of firing the instant it starts.
  if (match.state === "rally" && match.distractionPrevState !== "rally") match.distractionRallyStartS = match.distractionMatchS;
  match.distractionPrevState = match.state;

  if (match.distraction) {
    const d = match.distraction;
    d.x += d.vx * dt;
    d.lifetimeLeft -= dt;
    if (!d.triggered && !match.distractionHold) applyEffect(match, d);
    if (d.lifetimeLeft <= 0) {
      match.distraction = null;
      match.distractionNextAtS = match.distractionMatchS + range(match.rng, NEXT_TARGET_MIN_S, NEXT_TARGET_MAX_S);
    }
    return;
  }

  if (match.distractionHold) return; // the ball is mid-snatch: no new spawn until it's released
  if (match.state !== "rally") return;
  if (match.distractionMatchS < ONBOARDING_S) return;
  if (match.distractionMatchS - match.distractionRallyStartS < RALLY_GRACE_S) return;
  if (match.distractionMatchS < match.distractionNextAtS) return;

  const type = TYPES[Math.floor(match.rng() * TYPES.length)];
  match.distraction = spawn(match.rng, type);
  match.events.push({ type: "distractionSpawn", kind: match.distraction.type });
}

// Called when a point ends (sim.js's enterPointPause): an in-flight distraction doesn't carry into the
// next point. THE-1156 S3: the match-time pacing clock (distractionMatchS/distractionNextAtS) is NOT
// reset here -- that was the bug (board note 3). A distraction cut short still re-arms a fresh future
// target, the same way a naturally-finished one does, so the cadence isn't lost either way.
export function onPointEnd(match) {
  if (match.distraction) match.distractionNextAtS = match.distractionMatchS + range(match.rng, NEXT_TARGET_MIN_S, NEXT_TARGET_MAX_S);
  match.distraction = null;
  match.distractionHold = null;
}

export function initialState(rng) {
  return {
    distraction: null,
    distractionHold: null,
    distractionMatchS: 0,
    distractionNextAtS: range(rng, FIRST_TARGET_MIN_S, FIRST_TARGET_MAX_S),
    distractionRallyStartS: -Infinity,
    distractionPrevState: null,
  };
}
