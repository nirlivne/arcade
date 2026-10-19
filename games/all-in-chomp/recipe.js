// All-In Chomp canvas drawing recipe (THE-687). The reference implementation of games/all-in-chomp/DESIGN.md
// "Drawing recipe": the style tile and the board mockups are drawn with exactly this file, so what you see in
// design/all-in-chomp/samples/ is what this code draws. The developer may copy it into the game whole (it has
// no dependencies) or port it function by function. Render only; no game state, no canvas text (G10: every
// letter is DOM).
//
// Units: T = tile size in CSS px. Every function takes a 2D context already scaled by devicePixelRatio, so it
// draws in CSS px. Sprite builders take `px` = CSS px * dpr and return canvases at device resolution plus
// `.css` (their CSS size) so they're drawn with drawSprite().

// ---------------------------------------------------------------- tokens
export function readTokens(el = document.documentElement) {
  const cs = getComputedStyle(el), v = (k) => cs.getPropertyValue("--aic-" + k).trim();
  const K = ["baize", "baize-hi", "baize-lo", "room", "rail", "rail-2", "lamp", "cream", "cream-2", "chip-rim", "ink", "marigold",
    "hot", "hot-lo", "b-direct", "b-ambush", "b-flank", "b-shy", "b-shy-spot", "fold", "wood", "wood-hi", "wood-lo", "clutter",
    "clutter-2", "mouth", "tongue", "suit-spade", "suit-heart", "suit-diamond", "suit-club"];
  const C = {}; for (const k of K) C[k] = v(k);
  C.behaviour = { direct: C["b-direct"], ambush: C["b-ambush"], flank: C["b-flank"], shy: C["b-shy"] };
  C.suit = { s: C["suit-spade"], h: C["suit-heart"], d: C["suit-diamond"], c: C["suit-club"] };
  return C;
}

const canvas = (w, h) => { const c = document.createElement("canvas"); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; };
const mid = (...ps) => [ps.reduce((s, p) => s + p[0], 0) / ps.length, ps.reduce((s, p) => s + p[1], 0) / ps.length];
export const drawSprite = (g, s, x, y, ax = 0.5, ay = 0.5) => g.drawImage(s, x - s.css.w * ax, y - s.css.h * ay, s.css.w, s.css.h);

// ---------------------------------------------------------------- heads
// 1. Level the eye line (rotation from the eye landmarks, capped at 24 deg), never mirror.
// 2. Crop to the opaque box. 3. Scale to the target height. 4. 12-direction ink outline (2 px at 44 px).
// Returns { img, mouthY, mouthW, w, h } in the levelled+cropped source space (mouthY = the split line).
export function levelFace(face, img) {
  const L = face.landmarks;
  const le = mid(L.left_eye_outer, L.left_eye_inner), re = mid(L.right_eye_outer, L.right_eye_inner);
  const a = Math.max(-0.42, Math.min(0.42, Math.atan2(re[1] - le[1], re[0] - le[0])));
  const S = Math.ceil(Math.hypot(img.width, img.height)), R = canvas(S, S), g = R.getContext("2d");
  g.translate(S / 2, S / 2); g.rotate(-a); g.drawImage(img, -img.width / 2, -img.height / 2);
  const map = (p) => { const x = p[0] - img.width / 2, y = p[1] - img.height / 2, c = Math.cos(-a), s = Math.sin(-a); return [S / 2 + x * c - y * s, S / 2 + x * s + y * c]; };
  // crop to alpha > 20
  const d = g.getImageData(0, 0, S, S).data; let x0 = S, y0 = S, x1 = 0, y1 = 0;
  for (let y = 0; y < S; y += 2) for (let x = 0; x < S; x += 2) if (d[(y * S + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const out = canvas(x1 - x0 + 2, y1 - y0 + 2); out.getContext("2d").drawImage(R, -x0, -y0);
  const m = mid(map(L.mouth_left), map(L.mouth_right), map(L.mouth_top), map(L.mouth_bottom));
  const ml = map(L.mouth_left), mr = map(L.mouth_right);
  const el = map(le), er = map(re); // the eye centres, for the moments' shades and X eyes (rot.js, 2026-10-19)
  return { img: out, mouthX: m[0] - x0, mouthY: m[1] - y0, mouthW: Math.abs(mr[0] - ml[0]), w: out.width, h: out.height,
    eyeL: [el[0] - x0, el[1] - y0], eyeR: [er[0] - x0, er[1] - y0] };
}

// Scale a levelled face to height h (device px) and add the ink outline. tint = null | [colour, alpha].
export function inkHead(src, h, C, { line = 2, tint = null } = {}) {
  const s = h / src.height, w = Math.ceil(src.width * s), p = Math.ceil(line) + 1;
  const a = canvas(w, h), ga = a.getContext("2d"); ga.imageSmoothingQuality = "high"; ga.drawImage(src, 0, 0, w, h);
  if (tint) { ga.globalCompositeOperation = "source-atop"; ga.globalAlpha = tint[1]; ga.fillStyle = tint[0]; ga.fillRect(0, 0, w, h); ga.globalAlpha = 1; }
  const sil = canvas(w, h), gs = sil.getContext("2d"); gs.drawImage(a, 0, 0); gs.globalCompositeOperation = "source-in"; gs.fillStyle = C.ink; gs.fillRect(0, 0, w, h);
  const o = canvas(w + p * 2, h + p * 2), g = o.getContext("2d");
  for (let i = 0; i < 12; i++) { const t = (i / 12) * Math.PI * 2; g.drawImage(sil, p + Math.cos(t) * line, p + Math.sin(t) * line); }
  g.drawImage(a, p, p); o.pad = p; o.scale = s; return o;
}

// The chomp jaw. The head is cut along the horizontal line through the mouth centre; the lower part drops by
// `open` (0..1) * JAW_DROP * mouth width (tan 14 deg = 0.25, so the opening never exceeds 14 deg seen from the
// mouth corner). The gap is bridged by stretching the 1-px row just above the cut (so cheeks stretch rather than
// split), then a dark mouth + tongue fills the middle, mouth-wide only. Returns a source-space canvas (not inked).
export const JAW_DROP = 0.25;
export function jawFrame(lv, open, C) {
  const drop = Math.round(open * JAW_DROP * lv.mouthW), cut = Math.round(lv.mouthY);
  const o = canvas(lv.w, lv.h + drop), g = o.getContext("2d");
  g.drawImage(lv.img, 0, 0, lv.w, cut, 0, 0, lv.w, cut);                       // upper head
  if (drop > 0) g.drawImage(lv.img, 0, cut - 1, lv.w, 1, 0, cut, lv.w, drop);    // stretched cheek bridge
  g.drawImage(lv.img, 0, cut, lv.w, lv.h - cut, 0, cut + drop, lv.w, lv.h - cut); // lower jaw
  if (drop > 0) {
    const mw = lv.mouthW * 0.5, cy = cut + drop / 2, ry = drop / 2 + lv.mouthW * 0.04;
    g.save(); g.globalCompositeOperation = "source-atop";
    g.fillStyle = C.mouth; g.beginPath(); g.ellipse(lv.mouthX, cy, mw, ry, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = C.tongue; g.beginPath(); g.ellipse(lv.mouthX, cy + ry * 0.45, mw * 0.55, ry * 0.45, 0, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  return o;
}

// Build every sprite one actor needs at one size (rebuild on resize only). hPx = head height in device px.
//   chomp: 4 jaw frames (open 0, 1/3, 2/3, 1), inked. normal / closed: inked. folded: closed (or normal) + pale-blue tint.
export function buildHeadSprites(face, imgs, hPx, C, dpr = 1) {
  const line = Math.max(1.5, hPx / 22);
  const lv = levelFace(face, imgs.normal), lc = imgs.closed ? levelFace(face, imgs.closed) : null;
  const mk = (src, tint) => { const s = inkHead(src, hPx * (src.height / lv.h), C, { line, tint }); s.css = { w: s.width / dpr, h: s.height / dpr }; return s; };
  return {
    id: face.id, hasClosed: !!lc,
    normal: mk(lv.img), closed: lc ? mk(lc.img) : null,
    chomp: [0, 1 / 3, 2 / 3, 1].map((o) => mk(jawFrame(lv, o, C))),
    folded: mk((lc || lv).img, [C.fold, 0.3]),
    eyeY: (face.landmarks.left_eye_top[1] + face.landmarks.right_eye_top[1]) / 2 / face.h, // rough, for cards over eyes
    mouthFrac: lv.mouthY / lv.h,
  };
}

// The chomper. t = seconds (render clock), moving = bool, lean = -1..1 (horizontal travel; 0 on vertical).
// Jaw: 8 Hz while moving, shut when stopped. Lean: up to 6 deg toward travel (ease it over 100 ms in the caller).
// Head height 1.9 T, centred 0.05 T above the tile centre. Squash: 6 % stretch along travel is cut (heads stay
// upright and unwarped); only the 80 ms turn squash of 8 % vertical is kept.
export function drawChomper(g, sp, x, y, T, { t = 0, moving = true, lean = 0, squash = 0 } = {}) {
  const k = moving ? Math.abs(Math.sin(Math.PI * 8 * t)) : 0, frame = sp.chomp[Math.min(3, Math.round(k * 3))];
  const top = -sp.chomp[0].css.h / 2 - T * 0.05; // top-anchored: the upper head stays put, the jaw drops below
  g.save(); g.translate(x, y); g.rotate((lean * 6 * Math.PI) / 180); g.scale(1 + squash * 0.04, 1 - squash * 0.08);
  g.drawImage(frame, -frame.css.w / 2, top, frame.css.w, frame.css.h);
  g.restore();
}

// ---------------------------------------------------------------- the fallback chomper (one rule for everyone)
// Only used if any face fails the jaw gate (it doesn't; see styletile). The head rides a big hot-red chip
// whose top half lifts like a lid at 8 Hz.
export function drawChipChomper(g, sp, x, y, T, C, { t = 0, moving = true } = {}) {
  const k = moving ? Math.abs(Math.sin(Math.PI * 8 * t)) : 0, r = T * 0.62;
  g.save(); g.translate(x, y + T * 0.45);
  chip(g, 0, 0, r, C.hot, C, 8);
  g.fillStyle = C.mouth; g.beginPath(); g.ellipse(0, 0, r * 0.7, r * 0.22 * k + 0.5, 0, 0, Math.PI * 2); g.fill();
  g.restore();
  drawSprite(g, sp.normal, x, y + T * 0.35 - k * T * 0.12, 0.5, 1);
}

// ---------------------------------------------------------------- chips, stacks, cards
export function chip(g, x, y, r, col, C, edge = 6, rim = C.cream) {
  g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  if (r > 5) {
    g.strokeStyle = rim; g.lineWidth = r * 0.28; g.setLineDash([r * 0.42, r * ((Math.PI * 2) / edge) - r * 0.42]);
    g.beginPath(); g.arc(x, y, r * 0.84, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
    g.strokeStyle = "rgba(0,0,0,.25)"; g.lineWidth = Math.max(1, r * 0.08); g.beginPath(); g.arc(x, y, r * 0.6, 0, Math.PI * 2); g.stroke();
  }
  g.strokeStyle = C.ink; g.lineWidth = Math.max(1, r * 0.12); g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
}
// The pellet: cream disc, tan rim. r = max(2.4, 0.12 T) (5-6 px at T 22).
export function dot(g, x, y, T, C) { const r = Math.max(2.4, T * 0.12); g.fillStyle = C.cream; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.strokeStyle = C["chip-rim"]; g.lineWidth = Math.max(1, T * 0.045); g.stroke(); }
// ALL IN: hot-red chip r = 0.36 T with 8 cream edge spots and a cream centre, lamp halo pulsing at 1.2 Hz.
export function allIn(g, x, y, T, C, t = 0) {
  const r = T * 0.36;
  g.save(); g.globalAlpha = 0.3 + 0.22 * Math.sin(t * Math.PI * 2.4); g.fillStyle = C.lamp; g.beginPath(); g.arc(x, y, r * 1.55, 0, Math.PI * 2); g.fill(); g.restore();
  chip(g, x, y, r, C.hot, C, 8); g.fillStyle = C.cream; g.beginPath(); g.arc(x, y, r * 0.3, 0, Math.PI * 2); g.fill();
}
// A chip stack seen 3/4 from above; (x, y) = centre of the top chip's face. w = chip width.
export function stack(g, x, y, w, col, C, { n = 3, wob = 0, spot = null } = {}) {
  const th = w * 0.17, ry = w * 0.2, sp = spot || (col === C["b-shy"] ? C["b-shy-spot"] : C.cream);
  for (let i = n - 1; i >= 0; i--) {
    const cx = x + Math.sin(wob + i * 1.3) * w * 0.05, cy = y + i * th;
    g.fillStyle = col; g.strokeStyle = C.ink; g.lineWidth = Math.max(1.2, w * 0.035);
    g.beginPath(); g.ellipse(cx, cy + th, w / 2, ry, 0, 0, Math.PI); g.lineTo(cx - w / 2, cy); g.ellipse(cx, cy, w / 2, ry, 0, Math.PI, 0, true); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = sp; for (let k = -2; k <= 2; k++) g.fillRect(cx + k * w * 0.2 - w * 0.03, cy + th * 0.25, w * 0.06, th * 0.6);
    g.fillStyle = col; g.beginPath(); g.ellipse(cx, cy, w / 2, ry, 0, 0, Math.PI * 2); g.fill(); g.stroke();
  }
}

// Suit pips as paths (no text). (x, y) centre, s = height.
export function suit(g, kind, x, y, s, col) {
  g.save(); g.translate(x, y); g.scale(s / 20, s / 20); g.fillStyle = col; g.beginPath();
  if (kind === "h") { g.moveTo(0, 9); g.bezierCurveTo(-12, 0, -10, -10, -4.5, -9.5); g.bezierCurveTo(-1.5, -9.2, 0, -6.5, 0, -5.5); g.bezierCurveTo(0, -6.5, 1.5, -9.2, 4.5, -9.5); g.bezierCurveTo(10, -10, 12, 0, 0, 9); }
  else if (kind === "d") { g.moveTo(0, -10); g.quadraticCurveTo(4, -4, 8, 0); g.quadraticCurveTo(4, 4, 0, 10); g.quadraticCurveTo(-4, 4, -8, 0); g.quadraticCurveTo(-4, -4, 0, -10); }
  else if (kind === "s") { g.moveTo(0, -10); g.bezierCurveTo(-3, -5, -11, -1, -9, 4); g.bezierCurveTo(-7.5, 7.5, -3, 7, -1.2, 4); g.lineTo(-3, 10); g.lineTo(3, 10); g.lineTo(1.2, 4); g.bezierCurveTo(3, 7, 7.5, 7.5, 9, 4); g.bezierCurveTo(11, -1, 3, -5, 0, -10); }
  else { g.arc(0, -5, 4.6, 0, Math.PI * 2); g.moveTo(-4.8, 2); g.arc(-4.8, 2, 4.6, 0, Math.PI * 2); g.moveTo(4.8, 2); g.arc(4.8, 2, 4.6, 0, Math.PI * 2); g.moveTo(-1.4, 2); g.lineTo(-3, 10); g.lineTo(3, 10); g.lineTo(1.4, 2); }
  g.fill(); g.restore();
}
function cardShape(g, w, h, C, fill = C.cream) { g.fillStyle = fill; g.strokeStyle = C.ink; g.lineWidth = Math.max(1.2, w * 0.07); g.beginPath(); g.roundRect(-w / 2, -h / 2, w, h, w * 0.16); g.fill(); g.stroke(); }
// The joker on the felt (board 2026-10-17, in place of the card): a cream card with a marigold star pip, the
// card's size, tilt and bob. w = 0.82 T, tilt -5 deg, bob 1 px at 1.5 Hz. No canvas text (G10).
export function jokerOnFelt(g, x, y, T, C, t = 0) {
  const w = T * 0.82, h = w * 1.38;
  g.save(); g.translate(x, y + Math.sin(t * Math.PI * 3) * 1); g.rotate(-0.09);
  g.fillStyle = "rgba(0,0,0,.35)"; g.beginPath(); g.roundRect(-w / 2 + 1.5, -h / 2 + 2.5, w, h, w * 0.16); g.fill();
  cardShape(g, w, h, C);
  jokerStar(g, h * 0.3, w, C);
  g.restore();
}
// The joker's marigold star pip, centred at the current origin; r = the outer radius, w = the card width (ink).
function jokerStar(g, r, w, C) {
  g.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  g.closePath(); g.fillStyle = C.marigold; g.fill(); g.strokeStyle = C.ink; g.lineWidth = Math.max(1, w * 0.05); g.stroke();
}
// The held joker (board 2026-10-19: "the player should know he owns a joker!"). heldJokerRing goes under the
// chomper: a gold halo under its chin, pulsing at 1.2 Hz. heldJokerCard goes over it: a joker card riding the
// head's top corner, w 0.72 T, tilted 12 deg, bobbing 1 px at 2 Hz.
export function heldJokerRing(g, x, y, T, C, t = 0) {
  const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 2.4), cy = y + T * 0.88, rx = T * 0.78, ry = T * 0.24;
  g.save();
  g.globalAlpha = 0.22 + 0.18 * pulse;
  g.fillStyle = C.marigold; g.beginPath(); g.ellipse(x, cy, rx * 1.15, ry * 1.4, 0, 0, Math.PI * 2); g.fill();
  g.globalAlpha = 0.7 + 0.3 * pulse;
  g.strokeStyle = C.marigold; g.lineWidth = Math.max(2.5, T * 0.13);
  g.beginPath(); g.ellipse(x, cy, rx, ry, 0, 0, Math.PI * 2); g.stroke();
  g.restore();
}
export function heldJokerCard(g, x, y, T, C, t = 0) {
  const w = T * 0.72, h = w * 1.38;
  g.save(); g.translate(x + T * 0.72, y - T * 0.86 + Math.sin(t * Math.PI * 4)); g.rotate(0.21);
  g.fillStyle = "rgba(0,0,0,.35)"; g.beginPath(); g.roundRect(-w / 2 + 1, -h / 2 + 2, w, h, w * 0.16); g.fill();
  cardShape(g, w, h, C);
  jokerStar(g, h * 0.3, w, C);
  g.restore();
}
// Our card back: cream border, hot-red panel, cream lattice.
export function cardBack(g, x, y, w, C, rot = 0, sx = 1) {
  const h = w * 1.4; g.save(); g.translate(x, y); g.rotate(rot); g.scale(sx, 1); cardShape(g, w, h, C);
  g.fillStyle = C.hot; g.beginPath(); g.roundRect(-w * 0.36, -h * 0.4, w * 0.72, h * 0.8, w * 0.08); g.fill();
  g.save(); g.clip(); g.strokeStyle = "rgba(255,244,220,.55)"; g.lineWidth = Math.max(0.8, w * 0.04);
  for (let k = -6; k <= 6; k++) { g.beginPath(); g.moveTo(k * w * 0.16 - h, -h); g.lineTo(k * w * 0.16 + h, h); g.moveTo(k * w * 0.16 + h, -h); g.lineTo(k * w * 0.16 - h, h); g.stroke(); }
  g.restore(); g.restore();
}

// ---------------------------------------------------------------- ghosts
// A ghost = its head (1.5 T) on a 3-chip stack (0.95 T wide) in its behaviour colour. The stack wobbles
// (each chip offset on a sine) and the whole ghost hops 1.5 px at 8 Hz. (x, y) = tile centre.
// state: "chase" | "folded" (pale stack, closed eyes or cards over the eyes, 2 cards at the chin) | "flash"
// (folded, last 2 s: stack + tint flip back to the behaviour colour at 4 Hz) | "eaten" (see drawEaten).
export function drawGhost(g, sp, x, y, T, C, col, { t = 0, state = "chase", phase = 0 } = {}) {
  const hop = Math.abs(Math.sin(Math.PI * 8 * t + phase)) * 1.5, w = T * 0.95;
  const flashOn = state === "flash" && Math.floor(t * 8) % 2 === 0, folded = state === "folded" || (state === "flash" && !flashOn);
  stack(g, x, y + T * 0.28 - hop, w, folded ? C.fold : col, C, { wob: t * 6 + phase });
  const head = folded ? sp.folded : sp.normal, by = y + T * 0.36 - hop;
  drawSprite(g, head, x, by, 0.5, 1);
  if (state === "folded" || state === "flash") {
    const hh = head.css.h, cw = T * (sp.hasClosed ? 0.44 : 0.5);
    // cards at the chin, fanned (the closed eyes stay visible); faces with no eyes-closed frame raise them over the eyes
    const cy = sp.hasClosed ? by - hh * 0.04 : by - hh * (1 - sp.eyeY) - hh * 0.02;
    cardBack(g, x - cw * 0.4, cy, cw, C, -0.3); cardBack(g, x + cw * 0.4, cy, cw, C, 0.26);
  }
}
// Eaten: the head shrinks (0.18 s) into a chip in its behaviour colour with a mini head inside, gliding home at
// 14 t/s. The nickname is a DOM tag (.aic-tag--eaten) that follows it. k = 0..1 shrink progress.
export function drawEaten(g, sp, x, y, T, C, col, k = 1) {
  const r = T * 0.5 * (0.6 + 0.4 * k);
  chip(g, x, y, r, col, C, 8, col === C["b-shy"] ? C["b-shy-spot"] : C.cream);
  g.save(); g.beginPath(); g.arc(x, y, r * 0.66, 0, Math.PI * 2); g.clip();
  g.fillStyle = C.cream; g.fill();
  const s = (r * 1.5) / sp.normal.css.h; g.drawImage(sp.normal, x - (sp.normal.css.w * s) / 2, y - r * 0.62, sp.normal.css.w * s, sp.normal.css.h * s);
  g.restore();
  g.strokeStyle = C.ink; g.lineWidth = 1.2; g.beginPath(); g.arc(x, y, r * 0.66, 0, Math.PI * 2); g.stroke();
}
// The talk pip over the speaker's head: a cream bubble with three ink dots (no text).
export function talkPip(g, x, y, T, C) {
  const w = T * 0.85, h = T * 0.55;
  g.fillStyle = C.cream; g.strokeStyle = C.ink; g.lineWidth = 1.5;
  g.beginPath(); g.roundRect(x - w / 2, y - h, w, h, h * 0.45); g.moveTo(x - 3, y); g.lineTo(x - 6, y + 4); g.lineTo(x + 2, y); g.fill(); g.stroke();
  g.fillStyle = C.ink; for (let i = -1; i <= 1; i++) { g.beginPath(); g.arc(x + i * w * 0.24, y - h / 2, Math.max(1.2, T * 0.06), 0, Math.PI * 2); g.fill(); }
}
// A guest at the bonus spot: head 1.6 T on a marigold halo plate (the "אורח · 1,000" plate is DOM).
export function drawGuest(g, sp, x, y, T, C, t = 0) {
  g.save(); g.globalAlpha = 0.45 + 0.2 * Math.sin(t * 6); g.fillStyle = C.marigold; g.beginPath(); g.ellipse(x, y + T * 0.42, T * 0.9, T * 0.3, 0, 0, Math.PI * 2); g.fill(); g.restore();
  drawSprite(g, sp.normal, x, y + T * 0.45 + Math.sin(t * 5) * 1, 0.5, 1);
}

// ---------------------------------------------------------------- the table (static layer; draw once per resize)
// maze = array of strings (25 x 15). kind "A" (felt table) or "B" (kitchen table). ox, oy = maze origin.
export function drawTable(g, rows, T, C, kind, ox = 0, oy = 0, W = rows[0].length * T + ox * 2, H = rows.length * T + oy * 2) {
  const cols = rows[0].length, nrows = rows.length, mw = cols * T, mh = nrows * T;
  const wall = (r, c) => r >= 0 && r < nrows && c >= 0 && c < cols && rows[r][c] === "#";
  // room + lamp pool
  g.fillStyle = C.room; g.fillRect(0, 0, W, H);
  const lamp = g.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, Math.max(W, H) * 0.62);
  lamp.addColorStop(0, "rgba(255,210,122,.10)"); lamp.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = lamp; g.fillRect(0, 0, W, H);
  const cx = ox + mw / 2, cy = oy + mh / 2;
  if (kind === "A") {
    // the felt, rounded like an oval table (radius 3 tiles), lit from the lamp
    const felt = g.createRadialGradient(cx, cy - T, T, cx, cy, mw * 0.6);
    felt.addColorStop(0, C["baize-hi"]); felt.addColorStop(0.55, C.baize); felt.addColorStop(1, C["baize-lo"]);
    g.fillStyle = felt; g.beginPath(); g.roundRect(ox + T * 0.3, oy + T * 0.3, mw - T * 0.6, mh - T * 0.6, T * 3); g.fill();
    // the felt print: a dashed betting line (an oval) and the dealer's box round the seat
    g.strokeStyle = "rgba(255,244,220,.28)"; g.lineWidth = 1.2; g.setLineDash([4, 4]);
    g.beginPath(); g.ellipse(cx, cy, mw * 0.36, mh * 0.3, 0, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
  } else {
    // the kitchen table: walnut planks running across, lit from the lamp
    g.save(); g.beginPath(); g.roundRect(ox + T * 0.3, oy + T * 0.3, mw - T * 0.6, mh - T * 0.6, T * 0.8); g.clip();
    const wood = g.createRadialGradient(cx, cy - T, T, cx, cy, mw * 0.6);
    wood.addColorStop(0, C["wood-hi"]); wood.addColorStop(0.55, C.wood); wood.addColorStop(1, C["wood-lo"]);
    g.fillStyle = wood; g.fillRect(ox, oy, mw, mh);
    g.strokeStyle = "rgba(26,20,18,.35)"; g.lineWidth = 1;
    for (let k = 1; k < nrows / 2.5; k++) { const y = oy + k * T * 2.5 + 0.5; g.beginPath(); g.moveTo(ox, y); g.lineTo(ox + mw, y); g.stroke(); }
    g.strokeStyle = "rgba(255,230,190,.07)"; g.lineWidth = 1;
    for (let k = 0; k < 40; k++) { const y = oy + ((k * 37) % mh), x = ox + ((k * 113) % mw); g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + T * 2, y - 2, x + T * 4, y + 2, x + T * 6, y); g.stroke(); }
    g.restore();
  }
  // walls: padded-rail tubes stroked centre to centre (ink 0.5 T + 3, body, inner tone, lamp highlight)
  const tube = (wid, col, dy = 0) => {
    g.strokeStyle = col; g.lineWidth = wid; g.lineCap = "round"; g.beginPath();
    for (let r = 0; r < nrows; r++) for (let c = 0; c < cols; c++) {
      if (!wall(r, c)) continue; const x = ox + (c + 0.5) * T, y = oy + (r + 0.5) * T + dy;
      g.moveTo(x, y); g.lineTo(x + 0.01, y);
      if (wall(r, c + 1)) { g.moveTo(x, y); g.lineTo(x + T, y); }
      if (wall(r + 1, c)) { g.moveTo(x, y); g.lineTo(x, y + T); }
    }
    g.stroke();
  };
  const body = kind === "A" ? C.rail : C.clutter, inner = kind === "A" ? C["rail-2"] : C["clutter-2"];
  tube(T * 0.5 + 3, C.ink); tube(T * 0.5, body); tube(T * 0.22, inner, -T * 0.06); tube(1.3, "rgba(255,210,122,.5)", -T * 0.16);
  // fill solid wall blocks (2x2 and bigger) so they read as one cushion / one object
  for (let r = 0; r < nrows - 1; r++) for (let c = 0; c < cols - 1; c++) {
    if (wall(r, c) && wall(r + 1, c) && wall(r, c + 1) && wall(r + 1, c + 1)) {
      const x = ox + (c + 0.5) * T, y = oy + (r + 0.5) * T; g.fillStyle = body; g.fillRect(x - 0.5, y - 0.5, T + 1, T + 1);
    }
  }
  if (kind === "B") clutter(g, rows, T, C, ox, oy);
  // the dealer's seat: a dark well with a cream dashed box; the door is a cream bar
  const S = find(rows, "S"), D = find(rows, "=");
  if (S) {
    const x = ox + S.c * T, y = oy + S.r * T;
    g.fillStyle = "rgba(10,20,14,.55)"; g.beginPath(); g.roundRect(x - T * 0.9, y - T * 0.35, T * 2.8, T * 1.6, T * 0.3); g.fill();
    g.strokeStyle = "rgba(255,244,220,.55)"; g.lineWidth = 1.2; g.setLineDash([3, 3]); g.beginPath(); g.roundRect(x - T * 0.75, y - T * 0.2, T * 2.5, T * 1.3, T * 0.22); g.stroke(); g.setLineDash([]);
  }
  if (D) { const x = ox + D.c * T, y = oy + D.r * T; g.fillStyle = C.cream; g.beginPath(); g.roundRect(x + T * 0.1, y + T * 0.62, T * 0.8, T * 0.18, 2); g.fill(); g.strokeStyle = C.ink; g.lineWidth = 1; g.stroke(); }
}
function find(rows, ch) { for (let r = 0; r < rows.length; r++) { const c = rows[r].indexOf(ch); if (c >= 0) return { r, c }; } return null; }
// Maze B's clutter: top-down objects sitting on the larger wall blocks (a plate, the seeds bowl, a mug, a phone).
function clutter(g, rows, T, C, ox, oy) {
  const blocks = [], seen = new Set(), nrows = rows.length, cols = rows[0].length;
  for (let r = 0; r < nrows; r++) for (let c = 0; c < cols; c++) {
    if (rows[r][c] !== "#" || seen.has(r + "," + c) || r === 0 || c === 0 || r === nrows - 1 || c === cols - 1) continue;
    let w = 0; while (c + w < cols - 1 && rows[r][c + w] === "#") w++;
    let h = 0; while (r + h < nrows - 1 && rows[r + h].slice(c, c + w) === "#".repeat(w)) h++;
    for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) seen.add(r + i + "," + (c + j));
    if (w >= 2 && h >= 2 && !rows.slice(r, r + h).some((row) => /[S=]/.test(row.slice(c - 1, c + w + 1)))) blocks.push({ r, c, w, h });
  }
  blocks.forEach((b, i) => {
    const x = ox + (b.c + b.w / 2) * T, y = oy + (b.r + b.h / 2) * T - T * 0.06, s = Math.min(b.w, b.h) * T * 0.36;
    const kind = i % 4;
    g.save(); g.translate(x, y);
    if (kind === 0) { // plate with a crumb
      g.fillStyle = C.cream; g.strokeStyle = C.ink; g.lineWidth = 1.5; g.beginPath(); g.arc(0, 0, s, 0, Math.PI * 2); g.fill(); g.stroke();
      g.strokeStyle = C["cream-2"]; g.beginPath(); g.arc(0, 0, s * 0.68, 0, Math.PI * 2); g.stroke();
      g.fillStyle = C["chip-rim"]; g.beginPath(); g.arc(s * 0.2, -s * 0.15, s * 0.1, 0, Math.PI * 2); g.arc(-s * 0.25, s * 0.2, s * 0.07, 0, Math.PI * 2); g.fill();
    } else if (kind === 1) { // the sunflower-seeds bowl
      g.fillStyle = C.hot; g.strokeStyle = C.ink; g.lineWidth = 1.5; g.beginPath(); g.arc(0, 0, s * 0.9, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = C.ink; for (let k = 0; k < 9; k++) { const a = k * 2.4, d = s * 0.5 * Math.sqrt((k + 0.5) / 9); g.beginPath(); g.ellipse(Math.cos(a) * d, Math.sin(a) * d, s * 0.12, s * 0.06, a, 0, Math.PI * 2); g.fill(); }
    } else if (kind === 2) { // a mug, top-down, with a handle
      g.fillStyle = C.cream; g.strokeStyle = C.ink; g.lineWidth = 1.5; g.beginPath(); g.arc(s * 0.6, 0, s * 0.28, -1.2, 1.2); g.stroke();
      g.beginPath(); g.arc(0, 0, s * 0.62, 0, Math.PI * 2); g.fill(); g.stroke(); g.fillStyle = "#5A3A26"; g.beginPath(); g.arc(0, 0, s * 0.45, 0, Math.PI * 2); g.fill();
    } else { // a phone face down (Ronzo, leave the phone)
      g.rotate(0.25); g.fillStyle = C.ink; g.beginPath(); g.roundRect(-s * 0.45, -s * 0.8, s * 0.9, s * 1.6, s * 0.18); g.fill();
      g.strokeStyle = C["clutter-2"]; g.lineWidth = 1.5; g.stroke(); g.fillStyle = C["clutter-2"]; g.beginPath(); g.arc(-s * 0.18, -s * 0.5, s * 0.1, 0, Math.PI * 2); g.fill();
    }
    g.restore();
  });
}

// Pickups: chips, ALL IN and the card spot. eaten = Set of "x,y". Draw each frame (cheap) or cache.
export function drawPickups(g, rows, T, C, ox, oy, eaten, t = 0) {
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[0].length; c++) {
    const ch = rows[r][c], x = ox + (c + 0.5) * T, y = oy + (r + 0.5) * T;
    if (eaten && eaten.has(c + "," + r)) continue;
    if (ch === ".") dot(g, x, y, T, C);
    else if (ch === "o") allIn(g, x, y, T, C, t + r * 0.1 + c * 0.1);
  }
}
