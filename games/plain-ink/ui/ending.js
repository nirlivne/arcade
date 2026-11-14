// The ending (spec §3.6, §2.2 last row; THE-1565 Q4-Q6). The sim has stopped on the last-hide tick
// (state.ended), so the ending runs on its own UI tick count at the same 120 Hz -- deterministic,
// and stepped by __ink.step under ?qa=step. Pure.
import { BPM } from '../audio/music.js';
import { EYE_H } from '../sim/seekers.js';
import { GROUND_Y } from '../data/level1.js';

const HZ = 120;
const s = (sec) => Math.round(sec * HZ);

export const ENDING_TICKS = s(12);
const LEAN_END = s(1.5); // the Editor leans in to the cream circle
const SWEEP_END = s(3.5); // his sight runs along HIDE IN PLAIN INK, over the I
export const ENDING_SWEEP_START = LEAN_END, ENDING_SWEEP_END = SWEEP_END;
const BEAT = s(60 / BPM); // one beat of silence between the chord and the bongo

export const endingCues = [
  // line 6 (strip + voice) is not a cue here: S7's narration already starts it on the sim's `ended`
  // event, the same tick the ending begins (no second trigger).
  { type: 'musicStop', tick: 0 },
  { type: 'chord', tick: SWEEP_END }, // brass chord + the scarf untucks for one frame
  { type: 'bongo', tick: SWEEP_END + BEAT },
  { type: 'results', tick: ENDING_TICKS },
];

export const endingDone = (t) => t >= ENDING_TICKS;
export const canSkip = (seenEnding) => seenEnding === true; // after the first full view, any time
export const leanT = (t) => Math.min(1, Math.max(0, t / LEAN_END));
export const sweepT = (t) => Math.min(1, Math.max(0, (t - LEAN_END) / (SWEEP_END - LEAN_END)));
// "the scarf untucks for a single frame": one film frame (1/24 s), so at least one render shows it
export const scarfUntuck = (t) => t >= SWEEP_END && t < SWEEP_END + s(1 / 24);

// §3.6: the Editor leans in to the cream circle, growing toward the camera until his brim sits in the
// top third of the frame. His feet stay on the floor (THE-1566 carry-over 4); at full lean (2.2x) his
// head stays in frame at 844x390 and his eye is ~385 u up, between HIDE IN and PLAIN INK.
// lean: 0..1; baseScale: the Watcher draw scale.
export function editorLeanPose(editorX, lean, baseScale) {
  const grow = 1 + 1.2 * lean;
  return { x: editorX + 180 * lean, footY: GROUND_Y, eyeY: GROUND_Y - EYE_H * grow, s: baseScale * grow };
}
