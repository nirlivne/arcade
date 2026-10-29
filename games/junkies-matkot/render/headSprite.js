// THE-1119 M6: the head-on-a-matka portrait (recipe.js HEAD, DESIGN §5), full Canvas2D fidelity --
// used by the pick screen's `.jm-carousel__head` canvas (DESIGN §6: "the pick-screen carousel sits on
// the same matka frame"). The in-match WebGL court draws a flat-shaded approximation of the same
// recipe values instead (render/gl.js has no gradients or per-instance arcs); this is the one place
// the full composite (wood gradient, rim-light arc, rotated grip, die-cut face, golden glow, long
// shadow) is drawn as specced. Browser-only (CanvasRenderingContext2D), not node-tested.
import { COLORS, HEAD } from "./recipe.js";

function hexToRgba(hex, a) {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const tintCache = new Map();
function tinted(img, color) {
  const key = img.src + color;
  if (tintCache.has(key)) return tintCache.get(key);
  const c = document.createElement("canvas"); c.width = img.naturalWidth || 1; c.height = img.naturalHeight || 1;
  const x = c.getContext("2d"); x.drawImage(img, 0, 0);
  x.globalCompositeOperation = "source-in"; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
  tintCache.set(key, c);
  return c;
}

// Draws the full matka + head composite centred at (cx, cy), disc diameter `d` (px), `color` = the
// player-colour rim. `img` may be null (draws the matka alone, e.g. while a face photo is loading).
export function drawHeadPortrait(ctx, img, cx, cy, d, color, o = {}) {
  const R = d * 0.5;
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(o.tilt || 0);
  if (o.squash) ctx.scale(1 - o.squash, 1 + o.squash * 0.55);

  // long sunset shadow, toward the camera
  if (o.shadow !== false) {
    const sh = HEAD.shadow;
    ctx.save(); ctx.fillStyle = hexToRgba(COLORS.shadow, sh.alpha);
    ctx.filter = `blur(${Math.max(1, d * sh.blurOfD)}px)`;
    ctx.beginPath();
    ctx.ellipse(sh.dxOfD * d, sh.dyOfD * d, sh.rxOfD * d, sh.ryOfD * d, -0.06, 0, 7);
    ctx.fill(); ctx.restore();
  }

  // grip: player-colour bands on a wood handle, angled down and out of court (mirrored for the right)
  const side = o.side || -1;
  const grip = HEAD.grip;
  ctx.save(); ctx.rotate((side * grip.angleDeg * Math.PI) / 180);
  const gw = grip.wOfR * R, gl = grip.lenOfR * R;
  ctx.fillStyle = COLORS.grip; ctx.fillRect(-gw / 2, R * 0.78, gw, gl);
  ctx.fillStyle = color;
  for (let i = 0; i < grip.bands; i++) ctx.fillRect(-gw * 0.55, R * 0.78 + gl * (0.12 + i * 0.32), gw * 1.1, gl * 0.16);
  ctx.restore();

  // the matka disc: wood gradient, player-colour rim, plum ring, sun-side rim light
  const g = ctx.createLinearGradient(0, -R, 0, R);
  g.addColorStop(0, COLORS.woodHi); g.addColorStop(0.5, COLORS.wood); g.addColorStop(1, COLORS.woodLo);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = HEAD.rimW * d; ctx.stroke();
  ctx.strokeStyle = COLORS.plum; ctx.lineWidth = HEAD.plumRing * d;
  ctx.beginPath(); ctx.arc(0, 0, R + HEAD.rimW * d * 0.5 + HEAD.plumRing * d * 0.5, 0, 7); ctx.stroke();
  const rl = HEAD.rimLight;
  ctx.strokeStyle = COLORS.rimLight; ctx.globalAlpha = rl.alpha; ctx.lineWidth = rl.w * d;
  ctx.beginPath(); ctx.arc(0, 0, R - rl.w * d, (rl.from * Math.PI) / 180, (rl.to * Math.PI) / 180); ctx.stroke();
  ctx.globalAlpha = 1;

  // the head: plum die-cut outline, golden rim glow, the photo itself
  if (img) {
    const hh = d * (HEAD.headScale + (o.scale ? o.scale - 1 : 0));
    const hw = hh * (img.naturalWidth / img.naturalHeight || 1);
    const hy = HEAD.headOffsetY * d;
    const out = HEAD.dieCut * d;
    for (const [dx, dy] of [[-out, 0], [out, 0], [0, -out], [0, out], [-out, -out], [out, out]]) {
      ctx.drawImage(tinted(img, COLORS.plum), -hw / 2 + dx, hy - hh / 2 + dy, hw, hh);
    }
    ctx.save();
    ctx.globalAlpha = HEAD.faceRimGlow.alpha;
    ctx.filter = `blur(${Math.max(1, d * HEAD.faceRimGlow.blur)}px)`;
    ctx.drawImage(tinted(img, HEAD.faceRimGlow.color), -hw / 2, hy - hh / 2 + HEAD.faceRimGlow.offsetY * d, hw, hh);
    ctx.restore();
    ctx.drawImage(img, -hw / 2, hy - hh / 2, hw, hh);
    if (o.flash) { ctx.save(); ctx.globalAlpha = o.flash; ctx.drawImage(tinted(img, COLORS.faceFlash), -hw / 2, hy - hh / 2, hw, hh); ctx.restore(); }
    if (o.mirrorTint) { ctx.save(); ctx.globalAlpha = HEAD.mirrorTint; ctx.drawImage(tinted(img, color), -hw / 2, hy - hh / 2, hw, hh); ctx.restore(); }
  }
  ctx.restore();
}
