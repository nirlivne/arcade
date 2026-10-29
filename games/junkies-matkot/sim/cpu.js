// The solo CPU paddle (G16, spec §3). Pure given a seeded rng and the match state it reads -- no
// clock, no Math.random. Re-targets every 100ms (not every tick, so the input doesn't look twitchy);
// between re-targets it keeps steering toward its last-computed target the same way a human's held
// drag does. The rubber band (trailing/leading by >= 3) swaps its lag/error/speed knobs. Aim error is
// re-rolled whenever a fresh shot starts heading toward this side (not every tick, so it reads as one
// "guess" per incoming ball, re-rolled again on the next one). `autopilot()` is used by the CPU-vs-CPU
// gate and any side a caller wants CPU-driven outside solo play.
import { C } from "./constants.js";

export function create(side, rng, level) {
  return {
    side,
    rng,
    level, // THE-1142 S2: undefined = legacy/unleveled (today's exact numbers); see knobsFor
    targetY: C.COURT_H / 2, // fed to Sim.setInput -- rate-limited toward aimY by this mode's max speed
    aimY: C.COURT_H / 2, // the desired point (lagged ball position +- error), updated every re-target
    lastRetargetMs: -Infinity,
    lastCallMs: null,
    aimError: 0,
    lastAimRollRally: -1,
    history: [], // ring of {t, y} ball.y samples, for the lagged "what the CPU last saw" lookup
  };
}

export function autopilot(on) { return !!on; }

// scorePerspective: [thisSide'sScore, opponent'sScore]. Contact-offset aiming (CONTACT_OFFSET_RATIO)
// isn't applied yet -- the CPU currently just gets its paddle to the ball's y; sim.js's existing
// offset-to-angle physics already gives its returns some natural angle variation.
//
// level (THE-1142 S2, board note 2): an explicit "easy"/"medium"/"hard" scales the rubber-band's base
// numbers via C.CPU_LEVELS. No level argument (or an unknown one) is the legacy/unleveled path and
// returns exactly the pre-S2 numbers -- every existing caller that doesn't pass a level (the G16 gates,
// the pre-S2 unit tests) is unaffected byte-for-byte.
export function knobsFor(scorePerspective, level) {
  const diff = scorePerspective[0] - scorePerspective[1];
  const mode = diff >= 3 ? "leading" : diff <= -3 ? "trailing" : "base";
  const baseAimErrorMult = mode === "base" ? 1 : C.CPU.AIM_ERROR_MULT[mode];
  const lvl = level && C.CPU_LEVELS[level];
  if (!lvl) {
    return { mode, reactionLagMs: C.CPU.REACTION_LAG_MS[mode], aimErrorMult: baseAimErrorMult, maxPaddleSpeed: C.CPU.MAX_PADDLE_SPEED[mode] };
  }
  return {
    mode,
    reactionLagMs: Math.max(40, C.CPU.REACTION_LAG_MS[mode] + lvl.reactionLagAddMs),
    aimErrorMult: baseAimErrorMult * lvl.aimErrorMult,
    maxPaddleSpeed: C.CPU.MAX_PADDLE_SPEED[mode] * lvl.maxPaddleSpeedMult,
  };
}

function sampleAt(history, t) {
  if (!history.length) return null;
  let best = history[0];
  for (const h of history) if (Math.abs(h.t - t) < Math.abs(best.t - t)) best = h;
  return best.y;
}

export function update(cpu, match, nowMs) {
  const side = cpu.side, opponent = 1 - side;
  const history = [...cpu.history, { t: nowMs, y: match.ball.y }].filter((h) => nowMs - h.t <= 2000);
  const knobs = knobsFor([match.score[side], match.score[opponent]], cpu.level);

  const incomingToMe = side === 0 ? match.ball.vx < 0 : match.ball.vx > 0;
  let aimError = cpu.aimError;
  let lastAimRollRally = cpu.lastAimRollRally;
  if (incomingToMe && match.rally !== lastAimRollRally) {
    lastAimRollRally = match.rally;
    const mag = (C.CPU.AIM_ERROR_U_BASE + C.CPU.AIM_ERROR_SPEED_FACTOR * match.ball.speed) * knobs.aimErrorMult;
    aimError = (cpu.rng() * 2 - 1) * mag;
  }

  let aimY = cpu.aimY, lastRetargetMs = cpu.lastRetargetMs;
  if (nowMs - cpu.lastRetargetMs >= C.CPU.RETARGET_MS) {
    const goingAway = side === 0 ? match.ball.vx > 0 : match.ball.vx < 0;
    if (goingAway) {
      aimY = C.CPU.DRIFT_Y; // drifts to the resting spot instead of chasing a ball headed the other way
    } else {
      const lagged = sampleAt(history, nowMs - knobs.reactionLagMs);
      aimY = (lagged ?? cpu.aimY) + aimError;
    }
    aimY = Math.max(C.PADDLE_Y_MIN, Math.min(C.PADDLE_Y_MAX, aimY));
    lastRetargetMs = nowMs;
  }

  // The sim chases whatever target it's given at one uniform speed, so the CPU's own (slower) max
  // speed has to be enforced here: only ever hand the sim a target a bounded step from the paddle's
  // actual current position, not the full aim point at once.
  const dtS = cpu.lastCallMs === null ? 0 : Math.max(0, (nowMs - cpu.lastCallMs) / 1000);
  const maxStep = knobs.maxPaddleSpeed * dtS;
  const currentY = match.paddles[side].y;
  const delta = Math.max(-maxStep, Math.min(maxStep, aimY - currentY));
  const targetY = currentY + delta;

  return { cpu: { ...cpu, history, aimError, lastAimRollRally, aimY, lastRetargetMs, targetY, lastCallMs: nowMs } };
}
