// The rework's four looks + lamps + the warning mark (THE-1648; spec-rework §1.4, §2, §1.2 S2). World units;
// the caller has set the camera transform. Sizes and colours come from tokens.css (read once, lazily).
// Only stand-ons get the tape strip and the hard shadow: a shadow now means "you can stand on this".
import { g, C, piece, rectP, roughC } from '../engine/paper.js';
import { hasGlyph, drawLetterPiece } from './glyphs.js';

let T = null;
function tok() {
  if (T) return T;
  const css = getComputedStyle(document.documentElement);
  const v = (name, fb) => css.getPropertyValue(name).trim() || fb;
  const n = (name, fb) => parseFloat(v(name, fb));
  const list = (name, fb) => v(name, fb).split(/\s+/).map(Number);
  T = {
    tape: v('--pi-tape', '#f0e4c6'), tapeH: n('--pi-tape-h', 14),
    shadow: v('--pi-shadow', '#0d0b09'), shX: n('--pi-standon-shadow-x', 10), shY: n('--pi-standon-shadow-y', 12),
    cutDash: list('--pi-cut-dash', '18 12'), cutW: n('--pi-cut-w', 5), cutInset: n('--pi-cut-inset', 10),
    decor: { tangerine: v('--pi-decor-tangerine', '#b8591a'), cream: v('--pi-decor-cream', '#d6c6a2'), ink: v('--pi-decor-ink', '#3b322b') },
    warn: v('--pi-warn-fill', '#e0335a'),
    font: v('--font-display', 'Impact, sans-serif'),
  };
  return T;
}

const INK = (ink) => (ink === 'cream' ? C.paper : C.ink);
const OPP = (ink) => (ink === 'cream' ? C.ink : C.paper);
const roughRect = (x, y, w, h, seed, amp = 1.6) => roughC(`RW|${x}|${y}|${w}|${h}|${seed}`, () => rectP(x, y, w, h), seed, amp, 10);

// baked +-1 u jitter on the tape's lower edge (masking tape, not a ruler line)
function tapeStrip(x, y, w, h, seed) {
  return roughC(`TAPE|${x}|${y}|${w}|${seed}`, () => {
    const pts = [[x, y], [x + w, y]];
    let s = seed;
    for (let px = x + w; px >= x; px -= 24) { s = (s * 9301 + 49297) % 233280; pts.push([px, y + h + (s / 233280) * 2 - 1]); }
    return pts;
  }, seed, 0.4, 12);
}

// ---- stand-ons (and the floor) ----
export function drawStandOnShadows(list) {
  const t = tok();
  for (const p of list) {
    if (!p.shadow) continue;
    const sh = { ...p, x: p.x + t.shX, y: p.y + t.shY };
    if (!(hasGlyph(p.label) && drawLetterPiece(sh, t.shadow, 11 + p.x, { shadow: false, gap: 0, stretch: true }))) piece([rectP(sh.x, sh.y, p.w, p.h)], t.shadow, { gap: 0, shadow: false });
    piece([rectP(sh.x, sh.y, p.w, t.tapeH)], t.shadow, { gap: 0, shadow: false }); // under the tape too
  }
}
export function drawStandOns(list, seed = 11) {
  const t = tok();
  for (const p of list) {
    if (!(hasGlyph(p.label) && drawLetterPiece({ ...p }, INK(p.ink), seed + p.x, { shadow: false, stretch: true }))) {
      piece(roughRect(p.x, p.y, p.w, p.h, seed + p.x), INK(p.ink), { gap: 2.4, shadow: false });
    }
    if (p.tape) piece([tapeStrip(p.x, p.y, p.w, t.tapeH, seed + p.x)], t.tape, { gap: 0, shadow: false });
  }
}
export function drawFloorStandOn(left, right, floorY) {
  const t = tok();
  g.fillStyle = C.ink;
  g.fillRect(left, floorY, right - left, 2000);
  g.fillStyle = t.tape;
  g.fillRect(left, floorY, right - left, t.tapeH);
}

// ---- backdrops: full ink or full cream, nothing else ----
export function drawBackdrops(list, seed = 21) {
  for (const b of list) piece(roughRect(b.x, b.y, b.w, b.h, seed + b.x, 1.2), INK(b.ink), { gap: 0, shadow: false });
}

// ---- decoration: a darker shade of the ground, never pure ink or cream ----
export function drawDecorations(list, ground = 'tangerine', seed = 31) {
  const col = tok().decor[ground] || tok().decor.tangerine;
  for (const d of list) {
    if (d.label === '&') { drawAmpersand(d, col); continue; }
    if (!(hasGlyph(d.label) && drawLetterPiece(d, col, seed + d.x, { shadow: false }))) piece(roughRect(d.x, d.y, d.w, d.h, seed + d.x), col, { gap: 0, shadow: false });
  }
}
// no "&" glyph in the baked set: two stacked loops and a tail, cut from one paper piece
function drawAmpersand(d, col) {
  const cx = d.x + d.w / 2, top = d.y, h = d.h, w = d.w;
  g.save();
  g.strokeStyle = col; g.lineWidth = w * 0.16; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(d.x + w * 0.9, top + h * 0.95);
  g.lineTo(d.x + w * 0.25, top + h * 0.38);
  g.bezierCurveTo(d.x + w * 0.05, top + h * 0.15, d.x + w * 0.35, top + h * 0.02, cx, top + h * 0.06);
  g.bezierCurveTo(d.x + w * 0.75, top + h * 0.12, d.x + w * 0.65, top + h * 0.38, d.x + w * 0.38, top + h * 0.52);
  g.bezierCurveTo(d.x + w * 0.05, top + h * 0.7, d.x + w * 0.15, top + h * 0.98, cx, top + h * 0.95);
  g.bezierCurveTo(d.x + w * 0.75, top + h * 0.92, d.x + w * 0.85, top + h * 0.7, d.x + w * 0.92, top + h * 0.55);
  g.stroke();
  g.restore();
}

// ---- go-behinds: a front-layer card + its letter, a dashed "cut here" line inset, a scissors glyph ----
export function drawGoBehinds(list, seed = 41) {
  const t = tok();
  for (const gb of list) {
    piece(roughRect(gb.x, gb.y, gb.w, gb.h, seed + gb.x, 1.2), INK(gb.ink), { gap: 2.4, shadow: false });
    // the letter itself, a low-contrast shade on its own card (the card is what covers you)
    const shade = gb.ink === 'cream' ? C.paperD : C.inkL;
    if (hasGlyph(gb.label)) drawLetterPiece({ ...gb, x: gb.x + 24, y: gb.y + 40, w: gb.w - 48, h: gb.h - 70 }, shade, seed + gb.x, { shadow: false, gap: 0 });
    const i = t.cutInset;
    g.save();
    g.strokeStyle = OPP(gb.ink); g.lineWidth = t.cutW; g.setLineDash(t.cutDash);
    g.strokeRect(gb.x + i, gb.y + i, gb.w - 2 * i, gb.h - 2 * i);
    g.restore();
    drawScissorsGlyph(gb.x + i, gb.y + i, 40, OPP(gb.ink), INK(gb.ink));
  }
}
// a 40 u scissors mark sitting on the dashes at the top-left corner
function drawScissorsGlyph(x, y, size, col, bg) {
  const s = size / 40;
  g.save();
  g.translate(x, y); g.scale(s, s);
  g.fillStyle = bg; g.fillRect(-18, -18, 36, 36); // a clean patch so the mark reads on the dashes
  g.strokeStyle = col; g.lineWidth = 4; g.lineCap = 'round';
  g.beginPath(); g.arc(-9, -8, 6, 0, Math.PI * 2); g.moveTo(-3, 8 + 6); g.arc(-9, 8, 6, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(-4, -4); g.lineTo(16, 10); g.moveTo(-4, 4); g.lineTo(16, -10); g.stroke();
  g.restore();
}

// ---- lamps ----
// The patch is the same polygon the sim counts (H3: draw = count), solid cream, no alpha. Where it lands on
// the floor band, the band's top 24 u are painted cream across the footprint.
export const LANDING_H = 24;
export function drawLampPatch(poly, floorY = 0) {
  if (!poly) return;
  piece([poly.map((p) => [p.x, p.y])], C.paper, { gap: 0, shadow: false });
  const onFloor = poly.filter((p) => Math.abs(p.y - floorY) < 1e-6);
  if (onFloor.length >= 2) {
    const x0 = Math.min(...onFloor.map((p) => p.x)), x1 = Math.max(...onFloor.map((p) => p.x));
    g.fillStyle = C.paper;
    g.fillRect(x0, floorY, x1 - x0, LANDING_H);
  }
}

// The shade: an ink cone on a rod, with an eye-slot that opens in 3 steps with the warning (S2 b):
// 0 shut, 1 slit (w > 0), 2 half (w >= 0.4), 3 wide (w >= 0.8). glow = the blinking lamp's tell (slice 2).
export function eyeStep(w) { return w >= 0.8 ? 3 : w >= 0.4 ? 2 : w > 0 ? 1 : 0; }
export function drawLampFixture(lamp, { lit = true, eye = 0, glow = false, tag = null } = {}) {
  const { x, y } = lamp.bulb;
  g.fillStyle = C.ink;
  g.fillRect(x - 4, y - 260, 8, 200); // the rod up out of frame
  piece([[[x - 70, y], [x + 70, y], [x + 30, y - 70], [x - 30, y - 70]]], C.ink, { gap: 2, shadow: false });
  // the bulb under the shade
  g.fillStyle = lit ? C.paper : glow ? C.paperD : C.inkL;
  g.beginPath(); g.arc(x, y + 6, 18, 0, Math.PI); g.fill();
  // the eye-slot on the shade (cream with an ink pupil), opening with the meter
  const open = [0, 3, 9, 16][eye];
  g.fillStyle = C.paper;
  g.beginPath(); g.ellipse(x, y - 34, 24, Math.max(1.5, open), 0, 0, Math.PI * 2); g.fill();
  if (eye > 0) { g.fillStyle = C.ink; g.beginPath(); g.arc(x, y - 34, Math.min(8, open), 0, Math.PI * 2); g.fill(); }
  if (tag) {
    g.save();
    g.translate(x + 84, y - 70); g.rotate(-0.06);
    g.font = `400 40px ${tok().font}`; // canvas can't resolve var(): the token's family list, read at boot
    g.letterSpacing = '2px';
    const w = g.measureText(tag).width + 24;
    g.fillStyle = C.paper; g.fillRect(0, 0, w, 54);
    g.strokeStyle = C.ink; g.lineWidth = 3; g.strokeRect(0, 0, w, 54);
    g.fillStyle = C.ink; g.textBaseline = 'middle'; g.fillText(tag, 12, 29);
    g.restore();
  }
}

// ---- the warning mark (S2 a): a cut-paper "!" tag over the head, cream with an ink edge, filling with
// lipstick from the bottom in proportion to w ----
export function drawWarnMark(x, headY, w) {
  if (w <= 0) return;
  const t = tok();
  const W = 54, H = 96, left = x - W / 2, top = headY - 40 - H;
  const tagPoly = [[left, top + 8], [left + W, top], [left + W - 3, top + H], [left + 3, top + H - 4]];
  piece([tagPoly], C.paper, { gap: 0, shadow: false });
  g.save();
  g.beginPath(); tagPoly.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py))); g.closePath(); g.clip();
  g.fillStyle = t.warn;
  g.fillRect(left - 4, top + H * (1 - w), W + 8, H * w + 4);
  g.restore();
  g.strokeStyle = C.ink; g.lineWidth = 4;
  g.beginPath(); tagPoly.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py))); g.closePath(); g.stroke();
  // the "!" itself, in ink
  g.fillStyle = C.ink;
  g.fillRect(x - 6, top + 16, 12, 46);
  g.beginPath(); g.arc(x, top + 78, 7, 0, Math.PI * 2); g.fill();
}
