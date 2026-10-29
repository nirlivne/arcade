// Junkies Matkot board tuning r1 (THE-1141): the beach crowd, drawn in 2D canvas and pre-baked to textures, the
// same pattern as render/headSprite.js (bake once per size, upload to the atlas, draw as one quad per frame).
// Look only: flat sunset shapes, a plum die-cut outline, a cream rim light on the sun side (top). No faces from
// photos, nothing sexualised: the people are friendly cartoon standees in everyday modest beachwear.
//
//   import { bakeCrowd } from "./crowd.js";
//   const sprites = bakeCrowd(px);   // px = head disc diameter in device px; returns { crab: [c0, c1], seller, walker, gull }
//   Each canvas has its foot point at (w / 2, h - pad) (gull: its centre). Draw the cast shadow separately (CROWD.shadow).
import { CROWD } from "./recipe.js";

const PLUM = CROWD.outline;

function canvasFor(w, h) {
  const c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
  return c;
}
function line(ctx, S) { ctx.lineWidth = Math.max(1.5, CROWD.outlineOfS * S); ctx.strokeStyle = PLUM; ctx.lineJoin = "round"; ctx.lineCap = "round"; }
function fillStroke(ctx, fill) { ctx.fillStyle = fill; ctx.fill(); ctx.stroke(); }
function ellipse(ctx, x, y, rx, ry, rot = 0) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); }
function rimLight(ctx, x, y, rx, ry, S) { // a cream arc on the sun side (top) of a round shape
  ctx.save(); ctx.strokeStyle = CROWD.rimLight; ctx.globalAlpha = 0.85; ctx.lineWidth = Math.max(1, S * 0.018);
  ctx.beginPath(); ctx.ellipse(x, y, rx * 0.86, ry * 0.8, 0, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke(); ctx.restore();
}
function face(ctx, x, y, r, S, opts = {}) { // the shared cartoon face: dot eyes, a smile, cheeks
  ctx.fillStyle = PLUM;
  for (const s of [-1, 1]) { ellipse(ctx, x + s * r * 0.36, y - r * 0.08, r * 0.09, r * 0.12); ctx.fill(); }
  ctx.save(); ctx.lineWidth = Math.max(1.2, S * 0.014); ctx.strokeStyle = PLUM;
  ctx.beginPath(); ctx.arc(x, y + r * 0.12, r * 0.34, Math.PI * 0.18, Math.PI * 0.82); ctx.stroke(); ctx.restore();
  ctx.fillStyle = "rgba(232, 69, 124, .28)";
  for (const s of [-1, 1]) { ellipse(ctx, x + s * r * 0.58, y + r * 0.22, r * 0.16, r * 0.1); ctx.fill(); }
  if (opts.moustache) {
    ctx.fillStyle = PLUM; ctx.beginPath();
    ctx.ellipse(x - r * 0.17, y + r * 0.2, r * 0.2, r * 0.08, -0.25, 0, Math.PI * 2);
    ctx.ellipse(x + r * 0.17, y + r * 0.2, r * 0.2, r * 0.08, 0.25, 0, Math.PI * 2); ctx.fill();
  }
}

// --- crab: S = width. A coral shell, two raised claws, eye stalks, three legs a side that alternate per frame ---
function drawCrab(ctx, S, frame) {
  const k = CROWD.crab.colors, cx = S * 0.5, cy = S * 0.5;
  line(ctx, S);
  const legSwing = frame ? 0.18 : -0.18;
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) { // legs
    const a = (0.15 + i * 0.32 + (i % 2 ? legSwing : -legSwing)) * s;
    ctx.beginPath(); ctx.moveTo(cx + s * S * 0.2, cy + S * 0.06);
    ctx.quadraticCurveTo(cx + s * S * 0.36, cy + S * (0.0 + i * 0.05), cx + s * S * (0.38 + 0.04 * i) + Math.sin(a) * S * 0.04, cy + S * (0.14 + i * 0.06));
    ctx.lineWidth = S * 0.04; ctx.stroke();
  }
  line(ctx, S);
  for (const s of [-1, 1]) { // arms + claws, up and out
    const clawUp = frame ? 0.02 : 0;
    ctx.beginPath(); ctx.moveTo(cx + s * S * 0.18, cy - S * 0.04); ctx.quadraticCurveTo(cx + s * S * 0.34, cy - S * 0.06, cx + s * S * 0.36, cy - S * (0.2 + clawUp));
    ctx.lineWidth = S * 0.05; ctx.stroke(); line(ctx, S);
    const px = cx + s * S * 0.37, py = cy - S * (0.27 + clawUp), r = S * 0.1;
    ctx.beginPath(); // a pac-man claw opening upward
    ctx.moveTo(px, py); ctx.arc(px, py, r, -Math.PI / 2 + 0.55, -Math.PI / 2 - 0.55 + Math.PI * 2); ctx.closePath();
    fillStroke(ctx, k.body);
  }
  for (const s of [-1, 1]) { // eye stalks
    ctx.beginPath(); ctx.moveTo(cx + s * S * 0.07, cy - S * 0.12); ctx.lineTo(cx + s * S * 0.09, cy - S * 0.24); ctx.lineWidth = S * 0.03; ctx.stroke();
    line(ctx, S); ellipse(ctx, cx + s * S * 0.09, cy - S * 0.27, S * 0.055, S * 0.055); fillStroke(ctx, k.eye);
    ctx.fillStyle = PLUM; ellipse(ctx, cx + s * S * 0.095, cy - S * 0.265, S * 0.026, S * 0.03); ctx.fill();
  }
  ellipse(ctx, cx, cy, S * 0.27, S * 0.17); // shell
  const g = ctx.createLinearGradient(0, cy - S * 0.17, 0, cy + S * 0.17); g.addColorStop(0, k.bodyHi); g.addColorStop(1, k.body);
  fillStroke(ctx, g); rimLight(ctx, cx, cy, S * 0.27, S * 0.17, S);
  ctx.save(); ctx.lineWidth = Math.max(1.2, S * 0.02); ctx.beginPath(); ctx.arc(cx, cy - S * 0.01, S * 0.08, Math.PI * 0.2, Math.PI * 0.8); ctx.stroke(); ctx.restore();
}

// --- person (seller / walker): S = height, a front-view paper standee, 2-frame walk (legs swap, body bobs) ---
function drawLegs(ctx, S, cx, top, frame, skin, shorts, shortsLen) {
  const step = frame ? 1 : -1;
  for (const s of [-1, 1]) {
    const lift = s === step ? S * 0.025 : 0;
    const x = cx + s * S * 0.075, y0 = top, y1 = S * 0.955 - lift;
    ctx.beginPath(); ctx.roundRect(x - S * 0.035, y0, S * 0.07, y1 - y0, S * 0.03); fillStroke(ctx, skin);
    ctx.beginPath(); ctx.roundRect(x - S * 0.05, y1 - S * 0.012, S * 0.1, S * 0.03, S * 0.015); fillStroke(ctx, PLUM); // flip-flop
  }
  ctx.beginPath(); ctx.roundRect(cx - S * 0.15, top - S * 0.06, S * 0.3, shortsLen, [S * 0.03, S * 0.03, S * 0.05, S * 0.05]); fillStroke(ctx, shorts);
  ctx.beginPath(); ctx.moveTo(cx, top - S * 0.02); ctx.lineTo(cx, top - S * 0.06 + shortsLen); ctx.stroke(); // the leg split
}
function drawSeller(ctx, S, frame) {
  const k = CROWD.seller.colors, cx = S * 0.5, bob = frame ? S * CROWD.seller.bobOfS : 0;
  line(ctx, S);
  drawLegs(ctx, S, cx, S * 0.66, frame, k.skin, k.shorts, S * 0.16);
  ctx.save(); ctx.translate(0, -bob);
  // the cool box on a strap, hanging at the left hip
  ctx.beginPath(); ctx.moveTo(cx + S * 0.12, S * 0.32); ctx.lineTo(cx - S * 0.2, S * 0.58); ctx.lineWidth = S * 0.025; ctx.stroke(); line(ctx, S);
  ctx.beginPath(); ctx.roundRect(cx - S * 0.36, S * 0.55, S * 0.24, S * 0.17, S * 0.03); fillStroke(ctx, k.box);
  ctx.beginPath(); ctx.roundRect(cx - S * 0.375, S * 0.535, S * 0.27, S * 0.05, S * 0.02); fillStroke(ctx, k.boxLid);
  ctx.beginPath(); ctx.roundRect(cx - S * 0.28, S * 0.61, S * 0.08, S * 0.07, S * 0.02); fillStroke(ctx, k.pop); // a popsicle sticker
  // body: a cream T-shirt
  ctx.beginPath(); ctx.roundRect(cx - S * 0.16, S * 0.33, S * 0.32, S * 0.36, [S * 0.08, S * 0.08, S * 0.03, S * 0.03]); fillStroke(ctx, k.shirt);
  // arms: the right one holds a popsicle up, the left hangs to the box
  ctx.beginPath(); ctx.roundRect(cx - S * 0.21, S * 0.36, S * 0.065, S * 0.22, S * 0.03); fillStroke(ctx, k.skin);
  ctx.save(); ctx.translate(cx + S * 0.17, S * 0.39); ctx.rotate(0.55);
  ctx.beginPath(); ctx.roundRect(-S * 0.032, -S * 0.2, S * 0.065, S * 0.22, S * 0.03); fillStroke(ctx, k.skin);
  ctx.beginPath(); ctx.roundRect(-S * 0.012, -S * 0.3, S * 0.024, S * 0.1, S * 0.01); fillStroke(ctx, k.stick);
  ctx.beginPath(); ctx.roundRect(-S * 0.04, -S * 0.42, S * 0.08, S * 0.14, [S * 0.04, S * 0.04, S * 0.012, S * 0.012]); fillStroke(ctx, k.pop);
  ctx.restore(); line(ctx, S);
  // head + cap
  const hr = S * 0.13, hy = S * 0.2;
  ellipse(ctx, cx, hy, hr, hr * 1.05); fillStroke(ctx, k.skin); rimLight(ctx, cx, hy, hr, hr, S);
  face(ctx, cx, hy + hr * 0.12, hr, S, { moustache: true });
  ctx.beginPath(); ctx.ellipse(cx, hy - hr * 0.35, hr * 1.02, hr * 0.72, 0, Math.PI, 0); ctx.closePath(); fillStroke(ctx, k.cap);
  ctx.beginPath(); ctx.ellipse(cx + hr * 0.5, hy - hr * 0.36, hr * 0.85, hr * 0.2, 0, 0, Math.PI * 2); fillStroke(ctx, k.brim);
  ctx.restore();
}
function drawWalker(ctx, S, frame) {
  const k = CROWD.walker.colors, cx = S * 0.5, bob = frame ? S * CROWD.walker.bobOfS : 0;
  line(ctx, S);
  drawLegs(ctx, S, cx, S * 0.64, frame, k.skin, k.shorts, S * 0.19); // knee-length board shorts
  ctx.save(); ctx.translate(0, -bob);
  ctx.beginPath(); ctx.roundRect(cx - S * 0.155, S * 0.34, S * 0.31, S * 0.33, [S * 0.08, S * 0.08, S * 0.03, S * 0.03]); fillStroke(ctx, k.shirt); // loose T-shirt
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.roundRect(cx + s * S * 0.2 - S * 0.032, S * 0.37, S * 0.065, S * 0.2, S * 0.03); fillStroke(ctx, k.skin); }
  // the swim ring round the waist, both hands on it
  ellipse(ctx, cx, S * 0.62, S * 0.27, S * 0.075); fillStroke(ctx, k.ring);
  ctx.save(); ctx.strokeStyle = k.ringHi; ctx.lineWidth = S * 0.02; ctx.setLineDash([S * 0.06, S * 0.07]);
  ctx.beginPath(); ctx.ellipse(cx, S * 0.615, S * 0.2, S * 0.04, 0, Math.PI * 0.05, Math.PI * 0.95); ctx.stroke(); ctx.restore(); line(ctx, S);
  // head, sunglasses pushed up, a wide sun hat
  const hr = S * 0.125, hy = S * 0.22;
  ellipse(ctx, cx, hy, hr, hr * 1.05); fillStroke(ctx, k.skin);
  face(ctx, cx, hy + hr * 0.15, hr, S);
  ellipse(ctx, cx, hy - hr * 0.55, hr * 1.75, hr * 0.38); fillStroke(ctx, k.hat);
  ctx.beginPath(); ctx.ellipse(cx, hy - hr * 0.62, hr * 0.95, hr * 0.85, 0, Math.PI, 0); ctx.closePath(); fillStroke(ctx, k.hat);
  ctx.beginPath(); ctx.rect(cx - hr * 0.94, hy - hr * 0.78, hr * 1.88, hr * 0.2); ctx.fillStyle = k.hatBand; ctx.fill();
  rimLight(ctx, cx, hy - hr * 0.8, hr * 0.95, hr * 0.8, S);
  ctx.restore();
}

// --- gull: S = wingspan, side view flying right (mirror the canvas to fly left); wings up / down per frame ---
function drawGull(ctx, S, frame) {
  const k = CROWD.gull.colors, cx = S * 0.5, cy = S * 0.5;
  line(ctx, S);
  const wing = (far) => {
    const up = frame === 0;
    const tipY = up ? cy - S * 0.36 : cy + S * 0.24, tipX = cx - S * (far ? 0.14 : 0.24);
    ctx.beginPath(); ctx.moveTo(cx - S * 0.12, cy - S * 0.02);
    ctx.quadraticCurveTo(cx - S * 0.2, up ? cy - S * 0.12 : cy + S * 0.06, tipX, tipY);
    ctx.quadraticCurveTo(cx + S * 0.02, up ? cy - S * 0.22 : cy + S * 0.14, cx + S * 0.12, cy - S * 0.02); ctx.closePath();
    fillStroke(ctx, far ? k.tip : k.wing);
  };
  ctx.save(); ctx.globalAlpha = 0.9; wing(true); ctx.restore(); line(ctx, S);
  ctx.beginPath(); ctx.moveTo(cx - S * 0.18, cy); ctx.lineTo(cx - S * 0.32, cy - S * 0.06); ctx.lineTo(cx - S * 0.3, cy + S * 0.05); ctx.closePath(); fillStroke(ctx, k.body); // tail
  ellipse(ctx, cx, cy + S * 0.01, S * 0.2, S * 0.085); fillStroke(ctx, k.body);
  ellipse(ctx, cx + S * 0.2, cy - S * 0.06, S * 0.075, S * 0.07); fillStroke(ctx, k.body);
  ctx.beginPath(); ctx.moveTo(cx + S * 0.265, cy - S * 0.07); ctx.lineTo(cx + S * 0.36, cy - S * 0.045); ctx.lineTo(cx + S * 0.265, cy - S * 0.025); ctx.closePath(); fillStroke(ctx, k.beak);
  ctx.fillStyle = PLUM; ellipse(ctx, cx + S * 0.22, cy - S * 0.08, S * 0.016, S * 0.018); ctx.fill();
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx + s * S * 0.03, cy + S * 0.08); ctx.lineTo(cx + s * S * 0.03 - S * 0.06, cy + S * 0.14); ctx.lineWidth = S * 0.02; ctx.strokeStyle = k.legs; ctx.stroke(); }
  line(ctx, S); wing(false);
}

const DRAW = { crab: drawCrab, seller: drawSeller, walker: drawWalker, gull: drawGull };
const BOX = { crab: [1, 0.8], seller: [0.8, 1], walker: [0.8, 1], gull: [1, 1] }; // canvas w, h as a fraction of S

// discPx = the head disc diameter in device px at the current scale.
export function bakeSprite(kind, discPx, frame) {
  const S = Math.round(CROWD[kind].sizeOfD * discPx), pad = Math.ceil(S * 0.04);
  const [bw, bh] = BOX[kind];
  const c = canvasFor(Math.ceil(S * bw) + pad * 2, Math.ceil(S * bh) + pad * 2);
  const ctx = c.getContext("2d");
  ctx.translate(pad + (S * bw - S) / 2, pad + (S * bh - S) / 2);
  if (kind === "crab") ctx.translate(0, -S * 0.12);
  DRAW[kind](ctx, S, frame);
  return c;
}
export function bakeCrowd(discPx) {
  const out = {};
  for (const kind of Object.keys(DRAW)) out[kind] = [0, 1].map((f) => bakeSprite(kind, discPx, f));
  return out;
}
