// The run: phase machine, beat sequencing, the run clock, attemptOpen, scoring, the events queue, the
// state hash. No DOM, no clock, no Math.random, no three.js import (checked by a test).
import { createStreams } from "./rng.js";
import * as dive from "./beats/dive.js";
import * as landing from "./beats/landing.js";
import * as aisle from "./beats/aisle.js";
import * as door from "./beats/door.js";

const BEATS = { dive, landing, aisle, door };

// Phase step counts at a fixed 60 Hz.
export const CARD_STEPS = 120; // 2 s
export const INTRO_STEPS = 180; // 3 s
export const FAIL_STEPS = 10; // ~160 ms
export const REWIND_STEPS = 180; // 3 s
export const CLEAR_STEPS = 90; // 1.5 s
export const FINAL_STEPS = 90; // 1.5 s, the landing's FINAL cut (not clocked)
export const ENDING_STEPS = 240; // 4 s, the tarmac-at-dawn cut after beat 4 clears; a tap skips it
export const MAX_FAILS = 3;
export const DT = 1 / 60;

const MEDAL_RULES = {
  dive: { silverMargin: 2.5, goldMargin: 5.0 },
  landing: { silverBumps: 1, silverY: 10, goldBumps: 0, goldY: 4, goldSink: 240 },
  aisle: { silverBumps: 1, silverTime: 28, goldBumps: 0, goldTime: 24 },
  door: { silverTime: 12, goldTime: 8 },
};

function currentBeatName(run) { return run.beatOrder[run.beatIndex]; }
function currentBeat(run) { return BEATS[currentBeatName(run)]; }

// opts.practice: true = beat-select practice (a fail rewinds to a retry, never ends the run; clearing
// the one beat in beatOrder finishes straight to "results" with no "ending" cut and no run-best write).
export function createRun(seed, opts = {}) {
  const streams = createStreams(seed);
  return {
    seed,
    rngSim: streams.sim,
    rngFx: streams.fx,
    beatOrder: opts.beatOrder || ["door", "aisle", "dive", "landing"],
    practice: !!opts.practice,
    beatIndex: 0,
    phase: "card",
    phaseSteps: 0,
    checkpoint: "start",
    attemptNumber: 1,
    fails: 0,
    clockSteps: 0,
    attemptOpen: false,
    carry: opts.practice && (opts.beatOrder || [])[0] === "landing" ? { rudder: 0.33 } : { rudder: 1 },
    beat: null,
    lastOutcome: null,
    beatResults: {},
    best: null,
    over: false,
    complete: false,
    input: { ix: 0, iy: 0, button: false, digit: null, skip: false },
    events: [],
  };
}

export function setInput(run, input) {
  run.input = { ix: input.x ?? input.ix ?? 0, iy: input.y ?? input.iy ?? 0, button: !!input.button, digit: input.digit ?? null, skip: !!input.skip };
}

function medalFor(name, outcome) {
  if (!outcome.cleared) return null;
  const rule = MEDAL_RULES[name];
  if (!rule) return "bronze";
  if (name === "landing") {
    if (outcome.bumps === rule.goldBumps && outcome.metric <= rule.goldY && outcome.sink <= rule.goldSink) return "gold";
    if (outcome.bumps <= rule.silverBumps && outcome.metric <= rule.silverY) return "silver";
    return "bronze";
  }
  if (name === "aisle") {
    if (outcome.bumps === rule.goldBumps && outcome.metric <= rule.goldTime) return "gold";
    if (outcome.bumps <= rule.silverBumps && outcome.metric <= rule.silverTime) return "silver";
    return "bronze";
  }
  if (name === "door") {
    if (outcome.metric <= rule.goldTime) return "gold";
    if (outcome.metric <= rule.silverTime) return "silver";
    return "bronze";
  }
  if (outcome.bumps === 0 && outcome.margin >= rule.goldMargin) return "gold";
  if (outcome.bumps <= 1 && outcome.margin >= rule.silverMargin) return "silver";
  return "bronze";
}

function enterIntro(run) {
  const name = currentBeatName(run);
  run.beat = BEATS[name].create(run.rngSim, run.carry, run.checkpoint);
  run.phase = "intro";
  run.phaseSteps = 0;
  run.attemptOpen = true;
  run.events.push({ type: "save", reason: "intro" });
}

function enterPlay(run) {
  run.phase = "play";
  run.phaseSteps = 0;
}

function enterFail(run, outcome) {
  run.phase = "fail";
  run.phaseSteps = 0;
  // Practice (beat select) never ends the run on a 3rd fail: unlimited retries, no run-over (§2d).
  if (!run.practice) run.fails++;
  run.clockSteps += 300;
  run.attemptOpen = false;
  run.lastOutcome = outcome;
  run.events.push({ type: "fail", reason: outcome.reason });
  run.events.push({ type: "save", reason: "fail" });
}

// The landing's FINAL cut: 1.5s, not clocked, input swallowed, attemptOpen stays as-is (a reload here
// still restarts from the last *saved* checkpoint, i.e. it forfeits this not-yet-banked one).
function enterFinal(run) {
  run.phase = "final";
  run.phaseSteps = 0;
}

function enterOver(run) {
  run.phase = "over";
  run.over = true;
  run.events.push({ type: "runOver", reachedBeat: currentBeatName(run) });
}

function enterRewind(run) {
  run.phase = "rewind";
  run.phaseSteps = 0;
}

export function goToCard(run) {
  run.phase = "card";
  run.phaseSteps = 0;
  run.beat = null;
}

function enterCardRetry(run) {
  goToCard(run);
  run.attemptNumber++;
}

// The pause sheet's "restart this beat" (§2c): costs a fail, same as a reload with an open attempt,
// so it can't farm a clean retry. Practice never fails out (same rule as enterFail/the "fail" phase).
export function restartBeat(run) {
  const hadOpenAttempt = run.attemptOpen;
  run.attemptOpen = false;
  if (hadOpenAttempt && !run.practice) {
    run.fails++;
    run.clockSteps += 300;
    if (run.fails >= MAX_FAILS) { enterOver(run); return run; }
  }
  goToCard(run);
  return run;
}

function enterClear(run, outcome) {
  const name = currentBeatName(run);
  run.phase = "clear";
  run.phaseSteps = 0;
  run.attemptOpen = false;
  // Only flight-model beats (dive, landing) carry a rudder; the door and the aisle leave it untouched
  // for whichever beat reads it next (run.beat.flight is undefined on those beats).
  if (run.beat.flight) run.carry = { rudder: run.beat.flight.rudder };
  run.lastOutcome = outcome;
  // `time` is this beat's own elapsed seconds (the results strip's clock column, D2-11 sign-off r2):
  // door/aisle's medal `metric` already is their clock, but dive's is a speed margin and landing's a
  // touchdown centreline offset -- neither reads as a clock, so the strip needs its own field.
  run.beatResults[name] = { cleared: true, bumps: outcome.bumps, margin: outcome.margin, metric: outcome.metric, time: run.beat.t + (run.beat.escortT || 0), medal: medalFor(name, outcome) };
  run.events.push({ type: "clear", beat: name, medal: run.beatResults[name].medal });
  run.events.push({ type: "save", reason: "clear" });
}

// Only a full (non-practice) run sets the run best and counts toward the daily (§2d); practice saves
// only its own beat's result (already written by enterClear).
function finishRun(run) {
  run.phase = "results";
  run.complete = true;
  if (run.practice) { run.events.push({ type: "save", reason: "complete" }); return; }
  let bumps = 0, margin = 0;
  const medals = run.beatOrder.map((name) => run.beatResults[name] && run.beatResults[name].medal);
  for (const r of Object.values(run.beatResults)) { bumps += r.bumps; margin += r.margin; }
  const score = run.clockSteps / 60 + 3 * bumps - margin;
  if (!run.best || score < run.best.score) run.best = { score, clockSteps: run.clockSteps, bumps, medals };
  run.events.push({ type: "runComplete", score, clockSteps: run.clockSteps, bumps, medals });
  run.events.push({ type: "save", reason: "complete" });
}

function enterEnding(run) {
  run.phase = "ending";
  run.phaseSteps = 0;
}

function enterNextBeatOrComplete(run) {
  run.beatIndex++;
  run.checkpoint = "start";
  if (run.beatIndex >= run.beatOrder.length) { if (run.practice) finishRun(run); else enterEnding(run); }
  else { goToCard(run); run.attemptNumber = 1; }
}

function stepOutcome(run, outcome) {
  if (outcome.reachedFinal) enterFinal(run);
  else if (outcome.cleared) enterClear(run, outcome);
  else if (outcome.failed) enterFail(run, outcome);
}

export function step(run) {
  if (run.over || run.complete) return run;
  run.events = [];
  run.phaseSteps++;
  switch (run.phase) {
    case "card":
      if (run.phaseSteps >= CARD_STEPS) enterIntro(run);
      break;
    case "intro": {
      run.beat = currentBeat(run).step(run.beat, run.input, "intro", DT);
      run.clockSteps++;
      stepOutcome(run, currentBeat(run).outcome(run.beat));
      if (run.phase === "intro" && run.phaseSteps >= INTRO_STEPS) enterPlay(run);
      break;
    }
    case "play": {
      run.beat = currentBeat(run).step(run.beat, run.input, "play", DT);
      run.clockSteps++;
      stepOutcome(run, currentBeat(run).outcome(run.beat));
      break;
    }
    case "final":
      if (run.phaseSteps >= FINAL_STEPS) {
        run.checkpoint = "final";
        run.carry = { rudder: run.beat.flight.rudder, escortBumps: run.beat.bumps, escortT: run.beat.t };
        enterIntro(run); // straight to a fresh intro, no card, per the design
      }
      break;
    case "fail":
      if (run.phaseSteps >= FAIL_STEPS) { if (!run.practice && run.fails >= MAX_FAILS) enterOver(run); else enterRewind(run); }
      break;
    case "rewind":
      if (run.phaseSteps >= REWIND_STEPS) enterCardRetry(run);
      break;
    case "clear":
      if (run.phaseSteps >= CLEAR_STEPS) enterNextBeatOrComplete(run);
      break;
    case "ending":
      if (run.phaseSteps >= ENDING_STEPS || run.input.skip) finishRun(run);
      break;
    default:
      break;
  }
  return run;
}

// Restore a run from a save's `run` snapshot (or start fresh if there is none). A reload with an
// open attempt counts as a fail (+300 steps; the 3rd ends the run); a reload during `card` is free.
export function reload(seed, snap, opts) {
  const run = createRun(seed, opts);
  if (!snap) return run;
  run.carry = snap.carry || { rudder: 1 };
  run.checkpoint = snap.checkpoint === "final" ? "final" : "start";
  const beatIdx = run.beatOrder.indexOf(snap.beat);
  if (beatIdx >= 0) run.beatIndex = beatIdx;
  run.clockSteps = snap.clockSteps || 0;
  run.fails = snap.fails || 0;
  if (snap.attemptOpen) {
    run.fails++;
    run.clockSteps += 300;
    if (run.fails >= MAX_FAILS) { enterOver(run); return run; }
  }
  goToCard(run);
  return run;
}

// A plain object matching save.js's `run` field, or null when there's no run in progress to persist.
export function snapshot(run) {
  if (run.over || run.complete) return null;
  return {
    seed: run.seed,
    beat: currentBeatName(run),
    checkpoint: run.checkpoint,
    clockSteps: run.clockSteps,
    fails: run.fails,
    attemptOpen: run.attemptOpen,
    carry: run.carry,
    final: null,
  };
}

function round3(x) { return Math.round(x * 1000) / 1000; }

// A deterministic state hash (floats rounded to 1e-3 so it agrees between Node and Chrome).
export function hash(run) {
  const b = run.beat, f = b && b.flight;
  const parts = [
    run.phase, run.phaseSteps, run.clockSteps, run.fails, run.attemptOpen ? 1 : 0,
    run.rngSim.state, run.rngFx.state,
    f ? round3(f.pitch) : 0, f ? round3(f.bank) : 0, f ? round3(f.v) : 0, f ? round3(f.alt) : 0,
    f ? round3(f.rudder) : 0, f ? round3(f.heading) : 0, f ? round3(f.y) : 0, f ? round3(f.g) : 0,
    f ? round3(f.dose) : 0, f ? f.chunksLost : 0, f ? round3(f.margin) : 0,
    // Beats without a `.flight` (door, aisle) have their own state shape; include whichever applies.
    b && b.entered ? b.entered.join("") : "", b ? b.step || "" : "", b ? round3(b.fill || 0) : 0, b ? round3(b.bank || 0) : 0,
    b ? round3(b.z || 0) : 0, b != null && b.lane != null ? b.lane : -1, b ? b.bumps || 0 : 0,
  ];
  const s = parts.join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}
