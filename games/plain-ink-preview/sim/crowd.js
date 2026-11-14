// R3 the disguise queue (spec §3.4, §2.1 "Hidden" exceptions): inside the crowd zone, hidden is
// not cover-based -- it's "coat ink and in step" with the extras' 4-beat walk cycle. Exposure and
// spotted still run through the normal Watcher (W6) machinery; only the hidden computation swaps.

export const CROWD_BEAT_S = 0.5; // one beat
export const CROWD_CYCLE_BEATS = 4; // step, step, step, stop
export const CROWD_EDGE_TOL_S = 0.15;
export const CROWD_SPEED = 200; // u/s, held direction inside the zone
export const CROWD_ZONE_LEN = 1500;
export const CROWD_CYCLES = 5;

// tSec: seconds since the zone's clock started (its own checkpoint-relative trigger tick / 120).
export function crowdBeat(tSec) {
  const cycleS = CROWD_BEAT_S * CROWD_CYCLE_BEATS;
  let cycle = tSec % cycleS;
  if (cycle < 0) cycle += cycleS;
  const beatIndex = Math.floor(cycle / CROWD_BEAT_S);
  const beatElapsed = cycle - beatIndex * CROWD_BEAT_S;
  return { beatIndex, isStop: beatIndex === CROWD_CYCLE_BEATS - 1, beatElapsed, beatRemaining: CROWD_BEAT_S - beatElapsed };
}

// Total distance an extra has walked by tSec (THE-1557 carry-over: the drawn extras were pose-only,
// never actually crossing the stage). Moves at CROWD_SPEED through the 3 step beats of each cycle,
// holds flat through the 4th (stop) beat -- mirrors crowdBeat()'s own beat/cycle math so the extras'
// walk distance always lines up with the pose they're drawn in.
export function crowdDistance(tSec) {
  const cycleS = CROWD_BEAT_S * CROWD_CYCLE_BEATS;
  const stepS = CROWD_BEAT_S * (CROWD_CYCLE_BEATS - 1);
  let t = tSec % cycleS;
  if (t < 0) t += cycleS;
  const cycles = Math.floor(tSec / cycleS);
  return cycles * stepS * CROWD_SPEED + Math.min(t, stepS) * CROWD_SPEED;
}

function requiredMoving(beatIndex) {
  return beatIndex !== CROWD_CYCLE_BEATS - 1; // every beat but the last (the stop beat) requires moving
}

// moving: true if a move direction is held this tick (physics intent.left || intent.right).
//
// The +/-0.15s tolerance (spec §3.4 R3) is a *late-reaction* grace only: for the first 0.15s of a
// new beat, still matching the PREVIOUS beat's requirement is forgiven too (a bot reacting a touch
// late to the new beat, not a bot that holds one state through the whole beat). A bot that is
// simply wrong for the rest of the beat gets no further grace at the beat's far edge -- that
// matters: a hold-right bot is "out of step" for 0.5 - 0.15 = 0.35s of every stop beat, which must
// clear SPOTTED_S (0.3s) to snip it (spec AC). A symmetric grace at both edges would shrink that to
// 0.2s and never snip it.
export function inStep(tSec, moving) {
  const { beatIndex, beatElapsed } = crowdBeat(tSec);
  const current = requiredMoving(beatIndex);
  if (moving === current) return true;
  if (beatElapsed < CROWD_EDGE_TOL_S) {
    const prevIndex = (beatIndex + CROWD_CYCLE_BEATS - 1) % CROWD_CYCLE_BEATS;
    if (moving === requiredMoving(prevIndex)) return true;
  }
  return false;
}

export function crowdHidden(coat, stepOk) {
  return coat === 'ink' && stepOk;
}
