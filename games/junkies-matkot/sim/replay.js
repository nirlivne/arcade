// Records a live match's rng draws and per-tick paddle targets, then re-simulates the whole match
// bit-exactly from that log (same seed, same recorded rng values, same recorded inputs) to reproduce
// the final point's ball trace. Replaying the full match from tick 0 -- rather than snapshotting
// mid-match sim state -- keeps this simple and still cheap (a few thousand ticks of pure arithmetic),
// and is trivially correct since sim.js is pure: identical inputs always produce identical output.
import { C } from "./constants.js";
import * as Sim from "./sim.js";

// Wraps `match.rng` to also log every value it returns. sim.js always reads `match.rng` (a property
// lookup) rather than capturing the function in a closure, so this substitution is picked up by every
// later call inside sim.js.
//
// `firstServeWaitArmed` records whether `Sim.armFirstServeWait` was (or will be) applied to this match
// -- the only other thing besides seed + rng + inputs that the sim's live ticks depend on. Without
// re-arming the same wait on re-sim (B2/THE-1117), the first match of a session launches its serve
// after a different number of ticks than it did live, so the serve direction (which reads the
// receiver's paddle y at launch) and everything after it diverges even though every rng draw and
// recorded input replays bit-exact.
export function attachRecorder(match, { firstServeWaitArmed = false } = {}) {
  const rngLog = [];
  const original = match.rng;
  match.rng = () => { const v = original(); rngLog.push(v); return v; };
  // THE-1143 B1: re-sim must create its match with the same { distractions } option the live match
  // used, or the rng draw sequence desyncs from this log the moment distraction logic would have
  // consumed an extra draw (its own createMatch-time "next spawn target" pick) that a distractions-off
  // re-sim never asks for -- read straight off the live match so this can never drift from reality.
  // THE-1185 B1 (CTO review r3): same reasoning for zone/impact -- read straight off the live match so
  // re-sim's CPU/physics branches (which both read match.zoneEnabled/impactEnabled) can't diverge.
  return {
    rngLog, inputLog: [], firstServeWaitArmed,
    distractionsEnabled: !!match.distractionsEnabled,
    zoneEnabled: !!match.zoneEnabled,
    impactEnabled: !!match.impactEnabled,
  };
}

// THE-1185 B1: inputsX is optional (the legacy/non-zone path never produces one, same as what
// Sim.setInput already tolerates) -- logging only y, as before S1, silently dropped every x input that
// happened live, so a re-sim of a zone match diverged the instant either paddle actually moved in x.
export function recordTick(rec, inputsY, inputsX) {
  rec.inputLog.push([
    { y: inputsY[0], x: inputsX ? inputsX[0] : undefined },
    { y: inputsY[1], x: inputsX ? inputsX[1] : undefined },
  ]);
}

// Re-sims the whole match from the recording and returns { finalScore, finalWinner, trace }, where
// `trace` is the ball/paddle state at each tick of the final point, cropped to its last
// C.REPLAY_MAX_SIM_S of sim time (the design's "last 4.0s" rule; THE-774's skip logic and the
// 1x-then-0.4x playback speed are game.js/screens.js display concerns, not stored here).
export function resimulate(seed, rec) {
  // THE-1185 B1: re-create the live match's zone/impact opt-in, or its CPU-targeting/physics branches
  // (both of which read match.zoneEnabled/impactEnabled) silently diverge from the recorded rng log.
  const m = Sim.createMatch(seed, { distractions: rec.distractionsEnabled, zone: rec.zoneEnabled, impact: rec.impactEnabled });
  if (rec.firstServeWaitArmed) Sim.armFirstServeWait(m);
  let i = 0;
  m.rng = () => rec.rngLog[i++];

  let lastServeLaunchTick = 0;
  let wasRally = false;
  const fullTrace = [];
  for (let tick = 0; tick < rec.inputLog.length && m.state !== "matchEnd"; tick++) {
    const [in0, in1] = rec.inputLog[tick];
    Sim.setInput(m, 0, in0.y, in0.x);
    Sim.setInput(m, 1, in1.y, in1.x);
    Sim.step(m, 1 / C.STEP_HZ);
    if (m.state === "rally" && !wasRally) lastServeLaunchTick = tick;
    wasRally = m.state === "rally";
    // THE-1143 B1: carry the active distraction into the trace so replay playback can draw it too.
    // THE-1185 B1: paddle x travels in the trace too, so replay rendering can draw the zone movement.
    fullTrace.push({
      tick, x: m.ball.x, y: m.ball.y,
      paddles: [{ y: m.paddles[0].y, x: m.paddles[0].x }, { y: m.paddles[1].y, x: m.paddles[1].x }],
      distraction: m.distraction ? { type: m.distraction.type, x: m.distraction.x, y: m.distraction.y, vx: m.distraction.vx, r: m.distraction.r } : null,
    });
  }

  const capTicks = Math.round(C.REPLAY_MAX_SIM_S * C.STEP_HZ);
  const finalPointTrace = fullTrace.filter((f) => f.tick >= lastServeLaunchTick);
  const trace = finalPointTrace.length > capTicks ? finalPointTrace.slice(finalPointTrace.length - capTicks) : finalPointTrace;

  return { finalScore: m.score.slice(), finalWinner: m.winner, trace };
}
