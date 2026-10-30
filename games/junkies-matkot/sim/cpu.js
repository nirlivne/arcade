// The solo CPU paddle (G16, spec §3). Pure given a seeded rng and the match state it reads -- no
// clock, no Math.random. Re-targets every 100ms (not every tick, so the input doesn't look twitchy);
// between re-targets it keeps steering toward its last-computed target the same way a human's held
// drag does. The rubber band (trailing/leading by >= 3) swaps its lag/error/speed knobs. Aim error is
// re-rolled whenever a fresh shot starts heading toward this side (not every tick, so it reads as one
// "guess" per incoming ball, re-rolled again on the next one). `autopilot()` is used by the CPU-vs-CPU
// gate and any side a caller wants CPU-driven outside solo play.
import { C } from "./constants.js";
import * as Aim from "./aim.js";

export function create(side, rng, level) {
  return {
    side,
    rng,
    level, // THE-1142 S2: undefined = legacy/unleveled (today's exact numbers); see knobsFor
    targetY: C.COURT_H / 2, // fed to Sim.setInput -- rate-limited toward aimY by this mode's max speed
    targetX: C.PADDLE_CENTER_X[side], // THE-1184 S4: fed to Sim.setInput's x; legacy (no level) never moves this
    aimY: C.COURT_H / 2, // the desired point (lagged ball position +- error), updated every re-target
    lastRetargetMs: -Infinity,
    lastCallMs: null,
    aimError: 0,
    lastAimRollRally: -1,
    history: [], // ring of {t, y} ball.y samples, for the lagged "what the CPU last saw" lookup
    offence: null, // THE-1184 S4: { wantedLandingY, bounces, bankDir, willSwing }, re-rolled per incoming shot
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
    // THE-1184 S4 (board note 0): only present once a level is given, so the legacy/unleveled path never
    // sees these and offence stays off for every pre-r3 caller.
    aimProb: lvl.aimProb,
    bankProb: lvl.bankProb,
    swingProb: lvl.swingProb,
    xSpeedMult: lvl.xSpeedMult,
    offenceErrorMult: lvl.offenceErrorMult,
    zoneDefenceMult: lvl.zoneDefenceMult,
  };
}

function sampleAt(history, t) {
  if (!history.length) return null;
  let best = history[0];
  for (const h of history) if (Math.abs(h.t - t) < Math.abs(best.t - t)) best = h;
  return best;
}

// Reflects a raw (unfolded) straight-line y into [lo, hi] the way the ball itself bounces off the top
// and bottom walls -- a triangle wave, so any number of reflections folds back in one shot.
function fold(y, lo, hi) {
  if (hi <= lo) return lo;
  const range = hi - lo;
  const period = 2 * range;
  let t = (y - lo) % period;
  if (t < 0) t += period;
  if (t > range) t = period - t;
  return lo + t;
}

// THE-1156 S1 (board note 1): where the ball will cross the paddle line (paddleX) if it travels in a
// straight line from `ball` {x,y,vx,vy} and reflects off the top/bottom walls along the way, folded into
// the court's y envelope [ballR, courtH - ballR]. Pure -- callers feed it the CPU's *lagged* ball sample,
// so prediction doesn't erase the cost of reaction lag, only the cost of not reading bank shots.
export function predictInterceptY(ball, paddleX, courtH, ballR) {
  const lo = ballR, hi = courtH - ballR;
  const t = ball.vx !== 0 ? (paddleX - ball.x) / ball.vx : 0;
  const rawY = ball.y + ball.vy * Math.max(0, t);
  // THE-1157 r1 (non-blocking): a corrupted/degenerate sample (e.g. vx underflowing toward 0 right at
  // the paddle line) can produce a non-finite t/rawY -- fall back to the ball's own y rather than
  // handing the CPU a NaN target that would propagate into clamp()/Math.max() downstream.
  return Number.isFinite(rawY) ? fold(rawY, lo, hi) : fold(ball.y, lo, hi);
}

export function update(cpu, match, nowMs) {
  const side = cpu.side, opponent = 1 - side;
  const history = [
    ...cpu.history,
    { t: nowMs, x: match.ball.x, y: match.ball.y, vx: match.ball.vx, vy: match.ball.vy },
  ].filter((h) => nowMs - h.t <= 2000);
  const knobs = knobsFor([match.score[side], match.score[opponent]], cpu.level);

  const incomingToMe = side === 0 ? match.ball.vx < 0 : match.ball.vx > 0;
  let aimError = cpu.aimError;
  let lastAimRollRally = cpu.lastAimRollRally;
  let offence = cpu.offence;
  if (incomingToMe && match.rally !== lastAimRollRally) {
    lastAimRollRally = match.rally;
    const mag = (C.CPU.AIM_ERROR_U_BASE + C.CPU.AIM_ERROR_SPEED_FACTOR * match.ball.speed) * knobs.aimErrorMult;
    aimError = (cpu.rng() * 2 - 1) * mag;
    // THE-1184 S4 (board note 0): one offence decision per incoming shot, same cadence as aimError's own
    // re-roll. Gated on the match's own zone+impact opt-in, not just cpu.level -- a leveled CPU playing
    // a legacy (no zone/impact) match must draw the exact same rng sequence as before S4, or every
    // r1/r2-era continuity gate (tuned against those exact draws) desyncs and fails.
    if (knobs.aimProb !== undefined && match.zoneEnabled && match.impactEnabled) {
      const willAim = cpu.rng() < knobs.aimProb;
      if (willAim) {
        const opponentY = match.paddles[opponent].y; // "predicted" position: no human reaction yet
        const farY = Math.abs(C.PADDLE_Y_MIN - opponentY) > Math.abs(C.PADDLE_Y_MAX - opponentY) ? C.PADDLE_Y_MIN : C.PADDLE_Y_MAX;
        const willBank = cpu.rng() < knobs.bankProb;
        offence = {
          wantedLandingY: farY,
          bounces: willBank ? (cpu.rng() < 0.5 ? 1 : 2) : 0,
          bankDir: cpu.rng() < 0.5 ? 1 : -1,
          willSwing: cpu.rng() < knobs.swingProb,
        };
      } else {
        offence = null;
      }
    }
  }

  let aimY = cpu.aimY, lastRetargetMs = cpu.lastRetargetMs;
  if (nowMs - cpu.lastRetargetMs >= C.CPU.RETARGET_MS) {
    const goingAway = side === 0 ? match.ball.vx > 0 : match.ball.vx < 0;
    if (goingAway) {
      aimY = C.CPU.DRIFT_Y; // drifts to the resting spot instead of chasing a ball headed the other way
    } else {
      const lagged = sampleAt(history, nowMs - knobs.reactionLagMs);
      // THE-1156 S1 (board note 1): medium/hard predict the wall-folded intercept from the lagged
      // sample instead of just chasing the lagged y, so a bank shot no longer walks straight past them.
      // Easy keeps chasing (legacy behaviour) -- and so does the no-level/unknown-level path, byte-for-
      // byte, since `predicts` is false whenever cpu.level isn't exactly "medium" or "hard".
      const predicts = cpu.level === "medium" || cpu.level === "hard";
      let predictedY;
      if (lagged && predicts) {
        // THE-1184 S4 fix (the defensive mirror of the solver's own contactX bug above): once this
        // paddle has actually moved in its zone, the real paddle line it'll meet the ball at can be far
        // from the legacy fixed front face -- for a steep/banked shot, even a couple hundred units of x
        // error folds into a wildly wrong predicted y (caught the same way, via the adaptive-player
        // gate: hard was drifting to the wrong y entirely on bank-ish returns).
        const dir = side === 0 ? 1 : -1;
        const paddleLineX = match.zoneEnabled ? match.paddles[side].x + dir * (C.CAPSULE_THICK / 2) : C.FRONT_FACE_X[side];
        predictedY = predictInterceptY(lagged, paddleLineX, C.COURT_H, C.BALL_R);
      } else {
        predictedY = lagged ? lagged.y : cpu.aimY;
      }
      // THE-1184 S4/S5: a zone+impact match gets its own defensive sharpening (zoneDefenceMult), kept
      // separate from the shared aimErrorMult so the r1/r2-era non-zone continuity gates never move.
      const zoneMult = match.zoneEnabled && knobs.zoneDefenceMult !== undefined ? knobs.zoneDefenceMult : 1;
      aimY = predictedY + aimError * zoneMult;
      // THE-1184 S4: once it knows where it'll meet the ball, aim the return by positioning to the
      // contact OFFSET the solver says sends it to offence.wantedLandingY -- the sim's own offset-to-
      // angle physics (legacy formula or impact.js, both use the same CONTACT_ANGLE_MAX_DEG*offsetRatio
      // shape) does the rest at the moment of the real hit.
      // Every level that rolls an offence attempt applies it -- easy's own interceptY input is only the
      // raw lagged y (no wall-fold prediction), so an easy aim attempt can be based on a stale read and
      // misfire, which is exactly the "occasionally aims, sometimes gets it wrong" flavour easy wants.
      if (offence) {
        const opponentGoalX = side === 0 ? C.COURT_W : 0;
        // THE-1184 S4 fix: the solver's geometry has to use where this paddle will *actually* contact
        // the ball, not the legacy fixed front face -- once it starts swinging forward in the zone, its
        // real x moves well past that, which was silently handing the solver the wrong distance and
        // producing a believably-angled but wrongly-aimed shot (more swinging made hard *worse*, not
        // better, until this was caught against the adaptive-player gate).
        const dir = side === 0 ? 1 : -1;
        const contactXNow = match.paddles[side].x + dir * (C.CAPSULE_THICK / 2);
        const { offsetRatio } = Aim.solveAimOffset({
          interceptY: predictedY, contactX: contactXNow, opponentGoalX,
          wantedLandingY: offence.wantedLandingY, bounces: offence.bounces, bankDir: offence.bankDir,
          courtH: C.COURT_H, ballR: C.BALL_R,
        });
        aimY = predictedY - offsetRatio * C.CONTACT_OFFSET_U + aimError * knobs.offenceErrorMult;
      }
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

  // THE-1184 S4 (board note 0): zone positioning. A leveled CPU in a zone+impact match hovers mid-zone
  // by default and steps to the forward edge (nearest the net) when it has decided to swing for pace --
  // "arrives early" falls out naturally from this running every tick the ball is incoming, not from a
  // separate timing threshold: a faster xSpeedMult (hard) simply covers the zone sooner.
  let targetX = cpu.targetX;
  if (knobs.xSpeedMult !== undefined && match.zoneEnabled) {
    const [zA, zB] = C.PADDLE_X_ZONE[side];
    const zLo = Math.min(zA, zB), zHi = Math.max(zA, zB);
    const mid = (zLo + zHi) / 2;
    const fwd = side === 0 ? zHi : zLo; // the edge nearer the net
    const wantX = offence && offence.willSwing ? fwd : mid;
    const maxStepX = knobs.maxPaddleSpeed * knobs.xSpeedMult * dtS;
    const currentX = match.paddles[side].x;
    const deltaX = Math.max(-maxStepX, Math.min(maxStepX, wantX - currentX));
    targetX = currentX + deltaX;
  }

  return { cpu: { ...cpu, history, aimError, lastAimRollRally, offence, aimY, lastRetargetMs, targetY, targetX, lastCallMs: nowMs } };
}
