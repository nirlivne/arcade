// The in-world tags (THE-1637, re-pinned for the rework level 1 by THE-1648, spec-rework §3/§5): RUN at the
// start, JUMP before the H hop, FLIP TO MATCH at the rehearsal lamp. FREEZE is dropped (H2: hiding is
// instant). One at a time, forward only; a hide while FLIP TO MATCH is up ends the lesson for good
// (save.taught). Pure, so node-testable; game.js pins them to the camera.
import * as L1 from '../data/level1-rework.js';

const H = L1.standOns.find((p) => p.label === 'H');
const RL = L1.lamps.find((l) => l.id === 'RL');
const at = (id) => L1.tags.find((t) => t.id === id);

// x, y: world anchor (y = the tag's bottom edge); near: show once the hero is this close (u); doneX: passed
// once the hero is beyond. FLIP TO MATCH stays up across the rehearsal beam and fades at W1.
export const TAGS = [
  { ...at('run'), near: Infinity, doneX: H.x - 60 },
  { ...at('jump'), near: Infinity, doneX: H.x + H.w + 20 },
  { ...at('flip'), near: 500, doneX: L1.backdrops.find((b) => b.id === 'W1').x, lamp: RL.id },
];

export function newTags(taught = false) {
  return { i: taught ? TAGS.length : 0, taught };
}

export function stepTags(t, heroX, hidden) {
  if (t.i >= TAGS.length) return t;
  let i = t.i;
  while (i < TAGS.length && heroX > TAGS[i].doneX) i += 1;
  // only a hide with the FLIP tag on screen is the lesson learned (the N in part 1 hides any coat)
  if (hidden && TAGS[i]?.id === 'flip' && visibleTag({ i }, heroX)) return { i: TAGS.length, taught: true };
  return i === t.i ? t : { i, taught: false };
}

export function visibleTag(t, heroX) {
  const tag = TAGS[t.i];
  return tag && heroX >= tag.x - tag.near ? tag.id : null;
}
