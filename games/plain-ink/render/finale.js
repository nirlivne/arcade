// Set 6 finale art (S8 THE-1565; spec beats 20-22, §3.6, brief 08-ending). Render only: the sim's
// I-slot, Editor and scissors are untouched (THE-1565 Q2/Q3/Q8). World units, drawn under the
// camera transform. The title HIDE IN PLAIN INK sits on a giant cream circle; its I of INK is the
// sim's I-slot (data/level1.js I_SLOT_RECT), so the hidden hero IS that letter.
import { g, C, piece, rectP, circP } from '../engine/paper.js';
import { agentSide, AGENT_POSE } from '../engine/chars.js';
import { hash } from '../engine/lib.js';
import { drawLetterPiece } from './glyphs.js';
import { I_SLOT_RECT, GROUND_Y } from '../data/level1.js';
import { WATCHER_SCALE } from './actors.js';
import { editorLeanPose } from '../ui/ending.js';

const LH = I_SLOT_RECT.h; // letter height = the I-slot's height (202 u)
const LW = 100, PITCH = 120;
const SLOT_X = I_SLOT_RECT.x;

// row 2 on the ground: P L A I N _ [I-slot] N K -- the slot keeps its own x; row 1 HIDE IN above
function row(text, x0, y) {
  return [...text].map((ch, i) => ({ label: ch, x: x0 + i * PITCH, y, w: LW, h: LH })).filter((r) => r.label !== ' ');
}
const ROW2_X0 = SLOT_X - 6 * PITCH; // "PLAIN " ends one pitch before the slot
export const TITLE_LETTERS = [
  ...row('HIDE IN', SLOT_X - 5 * PITCH + 20, GROUND_Y - LH - 268),
  ...row('PLAIN', ROW2_X0, GROUND_Y - LH),
  ...row('NK', SLOT_X + I_SLOT_RECT.w + 20, GROUND_Y - LH),
];
const left = ROW2_X0, right = SLOT_X + I_SLOT_RECT.w + 20 + PITCH + LW;
export const CIRCLE = { x: (left + right) / 2, y: GROUND_Y - 200, r: 580 };
// a step ahead of CP11's spawn, where the reveal camera frames it (gone at CP12: PLAIN lands here)
export const DESK = { x: CIRCLE.x - 470, y: GROUND_Y - 110, w: 260, h: 110 };
const ASSEMBLE_S = 1.2;

export function drawCircle() {
  piece([circP(CIRCLE.x, CIRCLE.y, CIRCLE.r, 120)], C.paper, { gap: 0, shadow: false });
}

// t: seconds since CP12 was reached (null = not yet; Infinity = already assembled). Letters fly in
// from scattered spots and turn into place over 1.2 s; reduce motion fades them in instead.
export function drawTitleLetters(t, reduceMotion) {
  if (t == null) return;
  const k = Math.min(1, Math.max(0, t / ASSEMBLE_S));
  const e = 1 - (1 - k) ** 3;
  TITLE_LETTERS.forEach((r, i) => {
    g.save();
    if (reduceMotion) {
      g.globalAlpha = e;
    } else if (e < 1) {
      const h = hash(i * 7.3 + 1), h2 = hash(i * 3.1 + 9);
      const dx = (h - 0.5) * 1400 * (1 - e), dy = -(500 + h2 * 500) * (1 - e);
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      g.translate(cx + dx, cy + dy);
      g.rotate((h2 - 0.5) * 2.4 * (1 - e));
      g.translate(-cx, -cy);
    }
    drawLetterPiece(r, C.ink, 7000 + i * 31);
    g.restore();
  });
}

// beat 20: the Editor's desk with the tape recorder; two reels turn while the briefing tape plays
// (the right one is the strip's red reel). spin: seconds the reels have turned.
export function drawDesk(spin) {
  piece([rectP(DESK.x, DESK.y, DESK.w, DESK.h)], C.ink, { gap: 2.4, shadow: true });
  piece([rectP(DESK.x + 40, DESK.y - 60, 180, 60)], C.inkL, { gap: 2, shadow: false });
  const reel = (cx, col, dir) => {
    const cy = DESK.y - 92, r = 40;
    piece([circP(cx, cy, r, 28)], col, { gap: 2, shadow: true });
    for (let k = 0; k < 3; k++) {
      const a = spin * 4 * dir + (k * Math.PI * 2) / 3;
      piece([circP(cx + Math.cos(a) * r * 0.5, cy + Math.sin(a) * r * 0.5, 9, 10)], C.ink, { gap: 0, shadow: false });
    }
  };
  reel(DESK.x + 85, C.paperD, 1);
  reel(DESK.x + 175, C.red, 1);
}

// the Editor at his desk, back to the hero; in the last second he turns and his eye goes lipstick
export function drawEditorAtDesk(turned) {
  agentSide(DESK.x + DESK.w + 40, GROUND_Y, WATCHER_SCALE * 1.15, AGENT_POSE.stand, {
    col: C.ink, accent: C.red, flip: turned, eye: turned ? 'alert' : null,
  });
}

// the giant scissors (beat 21): two lipstick blades pivoting at (x, y), pointing right (blade 300 u).
// open: 0 shut .. 1 wide.
export function drawScissors(x, open, y = GROUND_Y - 130) {
  const px = x, py = y;
  const a = (6 + 18 * open) * (Math.PI / 180);
  const blade = (sign) => {
    const ang = sign * a, L = 300;
    const tip = [px + Math.cos(ang) * L, py + Math.sin(ang) * L];
    const nx = -Math.sin(ang) * 26, ny = Math.cos(ang) * 26;
    return [[px - nx * 0.4, py - ny * 0.4], [px + nx, py + ny], tip];
  };
  const ring = (sign) => circP(px - 70, py - sign * 46, 34, 22);
  piece([ring(1)], C.redD, { gap: 2, shadow: true });
  piece([ring(-1)], C.redD, { gap: 2, shadow: true });
  piece([circP(px - 70, py - 46, 16, 14)], C.ink, { gap: 0, shadow: false });
  piece([circP(px - 70, py + 46, 16, 14)], C.ink, { gap: 0, shadow: false });
  piece([blade(-1)], C.red, { gap: 2, shadow: true });
  piece([blade(1)], C.red, { gap: 2, shadow: true });
  piece([circP(px, py, 9, 10)], C.paper, { gap: 0, shadow: false });
}

// §3.6 lean pose lives in ui/ending.js (pure, tested)
export function drawEditorLean(editorX, lean) {
  const p = editorLeanPose(editorX, lean, WATCHER_SCALE);
  agentSide(p.x, p.footY, p.s, AGENT_POSE.stand, { col: C.ink, accent: C.red, flip: true, eye: 'open' });
  return p;
}
