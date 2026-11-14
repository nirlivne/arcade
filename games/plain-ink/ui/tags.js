// The first-10-s in-world tags (spec §5 "First 10 s", THE-1637): RUN on the flag, JUMP over the G,
// FLIP + FREEZE over the M of COMPANY (the first hide). One at a time, forward only; the first hide
// ends the lesson for good (save.taught). Pure, so node-testable; game.js pins them to the camera.
import * as level1 from '../data/level1.js';

const START = level1.checkpoints.find((c) => c.id === 'start');
const G = level1.platforms.find((p) => p.label === 'G');
const M = level1.hideOnlyShapes.find((s) => s.label === 'M-hide');

// x: world anchor; near: show once the hero is this close (u); doneX: passed once the hero is beyond
export const TAGS = [
  { id: 'run', x: START.spawnX, near: Infinity, doneX: G.x - 60 },
  { id: 'jump', x: G.x + G.w / 2, near: Infinity, doneX: G.x + G.w + 20 },
  { id: 'flip', x: M.x + M.w / 2, near: 500, doneX: M.x + M.w + 300 },
];

export function newTags(taught = false) {
  return { i: taught ? TAGS.length : 0, taught };
}

export function stepTags(t, heroX, hidden) {
  if (t.i >= TAGS.length) return t;
  if (hidden) return { i: TAGS.length, taught: true };
  let i = t.i;
  while (i < TAGS.length && heroX > TAGS[i].doneX) i += 1;
  return i === t.i ? t : { i, taught: false };
}

export function visibleTag(t, heroX) {
  const tag = TAGS[t.i];
  return tag && heroX >= tag.x - tag.near ? tag.id : null;
}
