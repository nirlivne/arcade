// Captain Fold: one flight (THE-260 design, THE-264 M1). Pure and testable (dt is always passed in, never read
// from a clock): the throw (pull fraction -> power -> initial flight), the fixed-step accumulator that turns a
// variable frame dt into whole DT steps (core.js's physics never runs at a variable rate), the event -> porthole
// reaction mapping, the best-flag x, and the flight's result object. game.js drives this; render.js and audio.js
// only read what it returns.
import { P, PX_PER_M, DT, newFlight as coreNewFlight, step as coreStep, score, starsFor, obstacleY, throwSpeed } from "./core.js";

export const MAX_FRAME_DT = 0.1; // s, a stalled tab/slow frame never causes a catch-up physics burst
export const HOLD_STRAIN_MS = 250; // spec S2/S7: a continuously held climb longer than this reads as strain
export const NEAR_MISS_M = 1.2; // spec S2: passing within this of an obstacle's hitbox (not hitting it) winces
const NEAR_MISS_PX = NEAR_MISS_M * PX_PER_M;

// Pull length (device px) -> a throw power fraction 0..1 (spec S2: 24 px min pull, >=120 px full pull, clamped).
// Returns null for a pull under the minimum: the caller cancels the throw (a "tk" spring-back, no flight).
export function pullToPower(pullPx, minPx = 24, maxPx = 120) {
  if (pullPx < minPx) return null;
  return Math.min(1, (pullPx - minPx) / (maxPx - minPx));
}

// Start a flight. `bestX` is the flight's best-so-far x (pixels) for this course, used to fire the "new best"
// reaction and place the best flag; 0 (or the course's best crash/landing x) is supplied by progress.js.
export function startFlight(course, power, bestX = 0) {
  return {
    f: coreNewFlight(course, power),
    course,
    bestX,
    passedBest: bestX <= 0, // already "past" a zero best, so a fresh course doesn't fire a spurious new-best
    heldSince: null, // ms timestamp (flight-local, injected) the hold began, or null while released
    nearMissed: new Set(), // obstacle indexes already winced at (spec: at most once per obstacle)
    acc: 0, // the fixed-step accumulator's leftover time
  };
}

function nearMiss(flight) {
  const { f, course } = flight;
  for (let i = 0; i < course.obstacles.length; i++) {
    if (flight.nearMissed.has(i) || f.knocked.has(i)) continue;
    const o = course.obstacles[i];
    if (f.x + P.HIT_R + NEAR_MISS_PX < o.x || f.x - P.HIT_R - NEAR_MISS_PX > o.x + o.w) continue;
    const [y0, y1] = obstacleY(o, f.t);
    const cx = Math.max(o.x, Math.min(f.x, o.x + o.w));
    const cy = Math.max(y0, Math.min(f.y, y1));
    const dist = Math.hypot(f.x - cx, f.y - cy) - P.HIT_R;
    if (dist > 0 && dist <= NEAR_MISS_PX) { flight.nearMissed.add(i); return true; }
  }
  return false;
}

// One fixed physics step plus the derived (non-physics) events the porthole/audio care about: "star", "bounce",
// "crash", "land" (from core.js) pass through unchanged; "nearmiss" and "newbest" are computed here.
function tickOnce(flight, held) {
  const ev = coreStep(flight.f, flight.course, held);
  const out = [];
  if (ev) out.push(ev);
  if (!flight.f.over) {
    if (nearMiss(flight)) out.push("nearmiss");
    if (!flight.passedBest && flight.f.x >= flight.bestX) { flight.passedBest = true; out.push("newbest"); }
  }
  return out;
}

// Advance by a frame's wall-clock dt (seconds, capped) plus the current hold state and "now" (ms, injected,
// flight-local: 0 at flight start is fine). Runs zero or more fixed DT steps and returns everything that
// happened this frame: the raw core events, the derived events, and the resolved single porthole reaction
// (the highest-priority thing to show, since only one face can be on screen at a time). `onStep`, if given, is
// called once per fixed DT step with the post-step flight.f (THE-305: game.js uses it to sample one flight-line
// point per physics step, not per variable-length frame).
export function tick(flight, held, frameDt, nowMs, onStep) {
  const dt = Math.min(MAX_FRAME_DT, Math.max(0, frameDt));
  flight.acc += dt;
  const events = [];
  while (flight.acc >= DT && !flight.f.over) {
    events.push(...tickOnce(flight, held));
    flight.acc -= DT;
    onStep?.(flight.f);
  }
  if (flight.f.over) flight.acc = 0;
  if (held && flight.heldSince == null) flight.heldSince = nowMs;
  else if (!held) flight.heldSince = null;
  const strain = !flight.f.over && (flight.f.stalled || (flight.heldSince != null && nowMs - flight.heldSince > HOLD_STRAIN_MS));
  const reaction = resolveReaction(events, strain, flight.passedBest);
  return { events, reaction };
}

// Priority: an ending state wins outright; otherwise the most recent notable event this frame; otherwise the
// ongoing strain/stall read; otherwise neutral. "star" alone doesn't have a dedicated face (spec's 5 faces are
// neutral, strain-or-stall, near-miss, crash, new best), so it falls through to neutral/strain. `passedBest`
// (THE-306) gates the land-event face: a landing only reads as "best" when this flight actually passed its best
// x at some point - otherwise every landing showed the best face regardless of the result.
export function resolveReaction(events, strain, passedBest) {
  if (events.includes("crash") || events.includes("bounce")) return "crash"; // DESIGN.md 6.3: a bounce shares the crash face
  if (events.includes("land") && passedBest) return "newbest_land"; // touchdown is handled by the result screen, not a face swap
  if (events.includes("newbest")) return "newbest";
  if (events.includes("nearmiss")) return "nearmiss";
  return strain ? "strain" : "neutral";
}

// THE-306: the porthole must hold a reaction for its DESIGN.md 6.3 minimum before swapping again, so a one-frame
// nearmiss/newbest isn't immediately stomped by next frame's neutral/strain read (and facePNG, being async, gets
// a chance to actually paint). A higher-priority reaction can still interrupt an unfinished hold early - a crash
// always cuts a wince short, for instance. Pure and testable: `since` is the ms timestamp `current` was set.
export const REACTION_PRIORITY = { neutral: 0, strain: 1, nearmiss: 2, newbest: 3, newbest_land: 3, crash: 4 };
export const REACTION_MIN_HOLD_MS = { neutral: 0, strain: 400, nearmiss: 600, newbest: 1200, newbest_land: 1200, crash: 900 };
export function latchReaction(current, since, candidate, nowMs) {
  if (candidate === current) return { reaction: current, since };
  const heldFor = nowMs - since;
  const minHold = REACTION_MIN_HOLD_MS[current] || 0;
  const canInterrupt = (REACTION_PRIORITY[candidate] ?? 0) > (REACTION_PRIORITY[current] ?? 0);
  if (heldFor >= minHold || canInterrupt) return { reaction: candidate, since: nowMs };
  return { reaction: current, since };
}

// The flight's result object once it's over: everything progress.js/render.js need, with no re-derivation of
// core internals. Returns null while the flight is still in progress.
export function flightResult(flight) {
  const { f, course } = flight;
  if (!f.over) return null;
  const kind = f.result.kind; // "land" | "crash"
  return {
    kind,
    distanceM: Math.round(Math.min(f.maxX, course.L) / PX_PER_M),
    stars: starsFor(f),
    score: score(f, course),
    luckyStars: f.starsTaken.size,
    isNewBest: flight.passedBest && f.maxX > flight.bestX,
    flightS: f.result.t,
    x: f.result.x,
  };
}
