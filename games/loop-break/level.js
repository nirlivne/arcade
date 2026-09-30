// Loop Break level.js: one medallion in play (THE-228 M1). Pure and testable -- no DOM, no timers. Tracks
// ring positions, the budget (batons used), the single per-attempt Take-back, and the "merge" (spec §2):
// turning the same ring again straight after is the same move, so overshoot-and-correct is free and a merge
// that ends back where it started relights its baton. `input.js` owns pointer/keyboard -> ring + notch calls;
// this module only ever sees whole-notch turns, so a caller (pointer drag) can call `turn` once per detent
// crossed during a live drag, matching "linked rings turn live during the drag".
import { NOTCHES, moveVector, applyMove, isSolved, solve } from "./core.js";

function driverOf(level, ring) {
  const l = level.links.find((x) => x.to === ring);
  return l ? l.from : null;
}

// The moves still needed, giving the open merge's ring the benefit of every one of its 8 positions (its own
// correction is free while the merge is still open) -- spec §2 "Dead end" / the CTO's B2 formula.
export function movesNeeded(level, pos, openRing) {
  let min = Infinity;
  for (let v = 0; v < NOTCHES; v++) {
    const trial = pos.slice();
    trial[openRing] = v;
    const plan = solve(level, trial);
    if (plan) min = Math.min(min, plan.length);
  }
  return min === Infinity ? 0 : min;
}

// `opts.freeWind`: L1-2 rewind the batons instead of failing (spec §2); the pack numbering lives in game.js,
// not here, so the caller decides.
export function createAttempt(level, opts = {}) {
  return {
    level,
    pos: level.start.slice(),
    used: 0,
    takeBackLeft: 1,
    dragRing: null,
    lastMove: null, // { ring, startPos: number[] } -- the most recent merge, open or just closed
    spent: false, // whether a baton is currently allocated to lastMove
    outcome: null, // null | "solved" | "failed"
    freeWind: !!opts.freeWind,
  };
}

function openMerge(state, ring) {
  if (state.lastMove && state.lastMove.ring === ring) return state;
  return { ...state, lastMove: { ring, startPos: state.pos.slice() }, spent: false };
}

// Grips a ring (or its crown). A drive-only ring plays a tock and grips nothing; touching a *different*
// grabbable ring than the open merge's closes that merge (spec: "touches a different ring... the merge closes").
export function beginDrag(state, ring) {
  if (state.outcome) return { state, events: [] };
  const level = state.level;
  if (level.driveOnly.includes(ring)) {
    return { state, events: [{ type: "tock", ring, driver: driverOf(level, ring) }] };
  }
  return { state: { ...openMerge(state, ring), dragRing: ring }, events: [{ type: "gripped", ring }] };
}

export function endDrag(state) {
  // `state.dragRing === 0` (the outermost ring) is falsy, so this must check for null/undefined explicitly
  // -- a bare `!state.dragRing` would wrongly treat "dragging ring 0" as "nothing to release" and leave the
  // ring stuck selected (found via a real-browser pass, THE-232: every repro happened to grab ring 0 first).
  if (state.dragRing == null) return { state, events: [] };
  return { state: { ...state, dragRing: null }, events: [{ type: "released", ring: state.dragRing }] };
}

// One detent crossing of `ring` by d = +1 or -1. Spends a baton on the first detent of a new merge, refunds
// it if the merge returns to its start value, and only ever spends once per departure (spec §2 "Merge rule").
export function turn(state, ring, d) {
  if (state.outcome) return { state, events: [] };
  const level = state.level;
  if (level.driveOnly.includes(ring)) {
    return { state, events: [{ type: "tock", ring, driver: driverOf(level, ring) }] };
  }
  let next = openMerge(state, ring);
  const events = [{ type: "detent", ring }];
  const before = next.pos;
  const after = applyMove(level, before, ring, d);
  for (let i = 0; i < level.n; i++) {
    if (before[i] === after[i]) continue;
    if (i !== ring) events.push({ type: "linkDriven", from: ring, to: i });
    if (after[i] === 0 && before[i] !== 0) events.push({ type: "gapAligned", ring: i });
    else if (after[i] !== 0 && before[i] === 0) events.push({ type: "linkLifted", ring: i });
  }
  next = { ...next, pos: after };

  const atStart = after[ring] === next.lastMove.startPos[ring];
  if (atStart) {
    if (next.spent) {
      next = { ...next, used: next.used - 1, spent: false };
      events.push({ type: "batonRelit" });
    }
  } else if (!next.spent) {
    next = { ...next, used: next.used + 1, spent: true };
    events.push({ type: "moveSpent" });
  }

  if (isSolved(next.pos)) {
    next = { ...next, outcome: "solved" };
    events.push({ type: "solved", used: next.used });
    return { state: next, events };
  }

  const needed = movesNeeded(level, next.pos, ring);
  const left = level.budget - next.used;
  if (left < needed) {
    if (next.freeWind) {
      next = { ...next, used: 0 };
      events.push({ type: "freeWind" });
    } else {
      next = { ...next, outcome: "failed" };
      events.push({ type: "deadEnd" });
    }
  }
  return { state: next, events };
}

// Reverses the whole last merged move (every detent + cascade) and refunds its baton if one was spent.
// Allowed from the fail caseback (spec: "also offered on the fail caseback if unused"), never after a win.
export function takeBack(state) {
  if (state.outcome === "solved" || state.takeBackLeft <= 0 || !state.lastMove) return { state, events: [] };
  const wasFailed = state.outcome === "failed";
  const next = {
    ...state,
    pos: state.lastMove.startPos.slice(),
    used: state.spent ? state.used - 1 : state.used,
    dragRing: null,
    lastMove: null,
    spent: false,
    takeBackLeft: 0,
    outcome: null,
  };
  const events = [{ type: "takeBack", ring: state.lastMove.ring }];
  if (wasFailed) events.push({ type: "resumedFromFail" });
  return { state: next, events };
}

export function restart(state) {
  return { state: createAttempt(state.level, { freeWind: state.freeWind }), events: [{ type: "restarted" }] };
}
