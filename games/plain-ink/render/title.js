// The title screen (S8 THE-1565; spec §6 "the title is the set, the hero is the I of INK", brief
// 01-title). Drawn in a 1920x1080 authoring frame fitted to the canvas height and centred; the
// cream ground and the tangerine diagonal run past the frame to the canvas edges. The DOM tickets
// (PLAY / CONTINUE / NEW RUN, best line, HOW TO PLAY, ABOUT) sit over it, bottom-left.
import { g, C, piece, rectP } from '../engine/paper.js';
import { agentSide, AGENT_POSE } from '../engine/chars.js';
import { drawLetterPiece } from './glyphs.js';
import { HERO_SCALE, WATCHER_SCALE } from './actors.js';
import { EYE_H } from '../sim/seekers.js';

const FW = 1920, FH = 1080;
const LH = 245, LW = 105, PITCH = 125;
const row = (text, x0, y) => [...text].map((ch, i) => ({ label: ch, x: x0 + i * PITCH, y, w: LW, h: LH })).filter((r) => r.label !== ' ');
const ROW1_Y = 225, ROW2_Y = 555;
// row 2: P L A I N _ [hero] N K -- the hero stands where INK's I would be
const HERO_X = 160 + 6 * PITCH + LW / 2;
export const TITLE_SCREEN_LETTERS = [...row('HIDE IN', 160, ROW1_Y), ...row('PLAIN', 160, ROW2_Y), ...row('NK', 160 + 7 * PITCH, ROW2_Y)];
const HERO_S = HERO_SCALE * (LH / 165); // the hero is as tall as a letter
const GUARD = { x: 1710, feet: 910, s: WATCHER_SCALE * (LH / 165) * 1.3 }; // ~1.6x the hero, as in the brief

// canvasW/H in device pixels (the frame is fitted to the canvas height)
export function drawTitleScreen(canvasW, canvasH) {
  const s = canvasH / FH;
  const ox = (canvasW - FW * s) / 2;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = C.paper;
  g.fillRect(0, 0, canvasW, canvasH);
  g.setTransform(s, 0, 0, s, ox, 0);
  const farR = (canvasW - ox) / s + 40;
  // the tangerine field on the 30° diagonal (the brief's title cut), past the frame edge on the right
  piece([[1170, -40], [farR, -40], [farR, FH + 40], [560, FH + 40]], C.mus, { gap: 0, shadow: false });
  // three hanging lamp shades
  for (const lx of [160, 960, 1760]) {
    g.fillStyle = C.paperD; g.fillRect(lx - 2, -10, 4, 60);
    piece([[lx - 36, 50], [lx + 36, 50], [lx + 30, 118], [lx - 30, 118]], C.paperD, { gap: 1.5, shadow: false });
  }
  // the guard's cream beam, from his eye up across the title (it reaches the hero's row, not him)
  const eyeX = GUARD.x - 50, eyeY = GUARD.feet - EYE_H * (GUARD.s / WATCHER_SCALE);
  piece([[eyeX, eyeY], [1120, 95], [1000, 292]], C.paper, { gap: 0, shadow: false });
  TITLE_SCREEN_LETTERS.forEach((r, i) => drawLetterPiece(r, C.ink, 9100 + i * 37));
  agentSide(HERO_X, ROW2_Y + LH, HERO_S, AGENT_POSE.stand, { col: C.ink, porkpie: true, accent: C.red });
  agentSide(GUARD.x, GUARD.feet, GUARD.s, AGENT_POSE.stand, { col: C.ink, accent: C.red, flip: true });
  g.restore();
}
