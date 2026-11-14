// The demo's paper puppet stage (S8 THE-1565, spec §8): one paper card per rule, drawn with the
// game's own renderers so the demo looks like play. Card-local units match the world (feet at
// y = 0, hero 162 u tall), zoomed into a card on a 1920x1080 frame fitted to the canvas height.
// t = demo ticks (120 Hz). Captions are DOM (game.js), so this draws pictures only.
import { g, C, piece, rectP, circP } from '../engine/paper.js';
import { drawHero, drawWatcher } from './actors.js';
import { drawWedge } from './world.js';
import { drawLetterPiece } from './glyphs.js';
import { drawCutBand } from './snipGag.js';
import { CARD_TICKS, demoCard, DEMO_CARDS } from '../ui/demo.js';
import { EYE_H } from '../sim/seekers.js';

const FH = 1080, FW = 1920;
const CARD = { x: 380, y: 120, w: 1160, h: 700 };
const ZOOM = 1.55;
const lerp = (a, b, k) => a + (b - a) * Math.min(1, Math.max(0, k));

const scenes = {
  // (1) ink coat stops on an ink letter -> dashed line; a sight wedge passes, nothing happens
  hide(k) {
    drawLetterPiece({ label: 'M', x: -60, y: -240, w: 200, h: 240 }, C.ink, 8800, { backing: true });
    const x = lerp(-300, 40, k / 0.35);
    const still = k > 0.45;
    drawHero({ x, y: 0, coat: 'ink', hidden: still, facingLeft: false, runPhase: still ? null : k * 6, grounded: true });
    const wx = 330, wy = -EYE_H;
    const a = Math.PI + lerp(-0.5, 0.55, (k - 0.5) / 0.45);
    if (k > 0.5) drawWedge({ x: wx, y: wy, facingAngle: a, halfAngleDeg: 16, length: 560 }, 'cream', [], 4);
    drawWatcher({ x: wx, y: wy, facingAngle: Math.PI, exposure: 0 });
  },
  // (2) inside a cream lamp beam, flip to cream
  light(k) {
    piece([[260, -360], [-200, 0], [120, 0]], C.paper, { gap: 0, shadow: false });
    piece([rectP(232, -380, 56, 30)], C.paperD, { gap: 1.5, shadow: false });
    const x = lerp(-320, -40, k / 0.4);
    drawHero({ x, y: 0, coat: k > 0.55 ? 'cream' : 'ink', hidden: k > 0.7, facingLeft: false, runPhase: k < 0.4 ? k * 6 : null, grounded: true });
  },
  // (3) walk into a wedge -> SNIP band
  snip(k) {
    const wx = 330, wy = -EYE_H;
    drawWedge({ x: wx, y: wy, facingAngle: Math.PI - 0.2, halfAngleDeg: 18, length: 600 }, 'cream', [], 4);
    drawWatcher({ x: wx, y: wy, facingAngle: Math.PI, exposure: k > 0.45 ? 1 : 0 });
    const x = lerp(-380, -60, k / 0.45);
    drawHero({ x, y: 0, coat: 'ink', hidden: false, facingLeft: false, runPhase: k < 0.45 ? k * 6 : null, grounded: true });
    if (k > 0.5) drawCutBand(-60, 0, Math.min(1, (k - 0.5) / 0.3));
  },
  // (4) the goal: the tangerine strip of film
  goal(k) {
    const bob = Math.sin(k * Math.PI * 2) * 6;
    piece([rectP(-170, -250 + bob, 340, 150)], C.mus, { gap: 2.4, shadow: true });
    for (let i = 0; i < 7; i++) {
      piece([rectP(-150 + i * 46, -238 + bob, 22, 16)], C.ink, { gap: 0, shadow: false });
      piece([rectP(-150 + i * 46, -128 + bob, 22, 16)], C.ink, { gap: 0, shadow: false });
    }
    piece([circP(0, -175 + bob, 34, 20)], C.ink, { gap: 0, shadow: false });
  },
};

export function drawDemo(canvasW, canvasH, t) {
  const s = canvasH / FH;
  const ox = (canvasW - FW * s) / 2;
  const i = demoCard(t);
  const id = DEMO_CARDS[i].id;
  const k = (t - i * CARD_TICKS) / CARD_TICKS;
  const dark = id === 'light' || id === 'goal';
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = C.ink;
  g.fillRect(0, 0, canvasW, canvasH);
  g.setTransform(s, 0, 0, s, ox, 0);
  piece([rectP(CARD.x, CARD.y, CARD.w, CARD.h)], dark ? C.inkL : C.paper, { gap: 3, gapCol: C.paperD, shadow: true });
  // card progress pips under the card
  DEMO_CARDS.forEach((_, j) => piece([rectP(FW / 2 - 70 + j * 40, CARD.y + CARD.h + 26, j === i ? 26 : 14, 8)], j === i ? C.paper : C.paperD, { gap: 0, shadow: false }));
  const groundY = CARD.y + CARD.h - 110;
  g.save();
  g.beginPath(); g.rect(CARD.x, CARD.y, CARD.w, CARD.h); g.clip();
  g.fillStyle = dark ? C.ink : C.paperD;
  g.fillRect(CARD.x, groundY, CARD.w, CARD.y + CARD.h - groundY);
  g.setTransform(s * ZOOM, 0, 0, s * ZOOM, ox + (CARD.x + CARD.w / 2) * s, groundY * s);
  scenes[id](k);
  g.restore();
  g.restore();
}
