// R3 the disguise queue extras (spec §3.4, beat 15): "a line of 8 ink extras in hats... step, step,
// step, stop. On a stop beat their feet freeze and their hats dip." Pure flavor rendering -- the
// crowd-zone hidden rule (sim/crowd.js) doesn't need these drawn to work, but a player can't learn
// "move in step" from a beat they never see. Driven by the same crowdBeat() clock run.js's
// crowdHidden() reads (cpTick, time since CP8 was (re)entered), so the hero's pose and the extras'
// pose are always the same beat (spec: "your pose syncs to theirs").
import { agentSide, runPose, AGENT_POSE } from '../engine/chars.js';
import { C } from '../engine/paper.js';
import { CROWD_BEAT_S, crowdBeat, crowdDistance } from '../sim/crowd.js';
import { GROUND_Y, CROWD_ZONE } from '../data/level1.js';

const EXTRA_COUNT = 8;
const DIP_Y = 10; // world units the hat/body sinks on the stop beat's freeze

// THE-1557 carry-over: the extras only ever animated in place (fixed per-index x). Spec: they
// *cross* the stage -- each extra's x now advances by crowdDistance(cpTickSec) (same beat clock as
// their pose), wrapping back to the zone's start so the line keeps re-entering from behind.
export function drawQueueExtras(cpTickSec) {
  const { isStop, beatIndex, beatElapsed } = crowdBeat(cpTickSec);
  const stepPhase = (beatIndex % 3 + beatElapsed / CROWD_BEAT_S) / 3; // one walk cycle per 3 step beats
  const y = GROUND_Y + (isStop ? DIP_Y : 0);
  const pose = isStop ? AGENT_POSE.stand : runPose(stepPhase);
  const span = CROWD_ZONE.xMax - CROWD_ZONE.xMin;
  const travelled = crowdDistance(cpTickSec) % span;
  for (let i = 0; i < EXTRA_COUNT; i++) {
    const base = (span * (i + 0.5)) / EXTRA_COUNT;
    const x = CROWD_ZONE.xMin + (base + travelled) % span;
    agentSide(x, y, 0.42, pose, { col: C.ink, porkpie: true, accent: C.red });
  }
}
