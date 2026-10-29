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
  return { rngLog, inputLog: [], firstServeWaitArmed };
}

export function recordTick(rec, targets) {
  rec.inputLog.push([targets[0], targets[1]]);
}

// Re-sims the whole match from the recording and returns { finalScore, finalWinner, trace }, where
// `trace` is the ball/paddle state at each tick of the final point, cropped to its last
// C.REPLAY_MAX_SIM_S of sim time (the design's "last 4.0s" rule; THE-774's skip logic and the
// 1x-then-0.4x playback speed are game.js/screens.js display concerns, not stored here).
export function resimulate(seed, rec) {
  const m = Sim.createMatch(seed);
  if (rec.firstServeWaitArmed) Sim.armFirstServeWait(m);
  let i = 0;
  m.rng = () => rec.rngLog[i++];

  let lastServeLaunchTick = 0;
  let wasRally = false;
  const fullTrace = [];
  for (let tick = 0; tick < rec.inputLog.length && m.state !== "matchEnd"; tick++) {
    const [y0, y1] = rec.inputLog[tick];
    Sim.setInput(m, 0, y0);
    Sim.setInput(m, 1, y1);
    Sim.step(m, 1 / C.STEP_HZ);
    if (m.state === "rally" && !wasRally) lastServeLaunchTick = tick;
    wasRally = m.state === "rally";
    fullTrace.push({ tick, x: m.ball.x, y: m.ball.y, paddles: [m.paddles[0].y, m.paddles[1].y] });
  }

  const capTicks = Math.round(C.REPLAY_MAX_SIM_S * C.STEP_HZ);
  const finalPointTrace = fullTrace.filter((f) => f.tick >= lastServeLaunchTick);
  const trace = finalPointTrace.length > capTicks ? finalPointTrace.slice(finalPointTrace.length - capTicks) : finalPointTrace;

  return { finalScore: m.score.slice(), finalWinner: m.winner, trace };
}
