// THE-1119 M1: the full-bleed beach world (sky, sun, tower, sea, sand, rope -- 13 layers, design/
// junkies-matkot/scene.js's drawWorld ported to the game's own layout/recipe). Painted once with
// Canvas2D into an offscreen canvas at the current resolution (paintBackdrop), then uploaded to GL as
// a single texture (gl.js's setBackground) -- the shader has no gradients and the instanced batch has
// no room for 70 glint streaks plus footprints plus grain, so this stays off the per-frame hot path.
// Static: no per-frame glint sparkle, foam breathing or hit-burst (D2, a later pass). Browser-only
// (CanvasRenderingContext2D), not node-tested, like atlas.js.
import { COLORS, WORLD } from "./recipe.js";

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function drawTower(ctx, x, y, u) {
  ctx.save(); ctx.translate(x, y);
  const ink = COLORS.tower;
  ctx.strokeStyle = ink; ctx.lineWidth = 0.6 * u; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(-3 * u, 0); ctx.lineTo(-2.2 * u, -5 * u); ctx.moveTo(3 * u, 0); ctx.lineTo(2.2 * u, -5 * u);
  ctx.moveTo(-2.8 * u, -1.6 * u); ctx.lineTo(2.4 * u, -4 * u); ctx.stroke();
  ctx.fillStyle = ink; ctx.fillRect(-3.6 * u, -9 * u, 7.2 * u, 4.2 * u);
  ctx.beginPath(); ctx.moveTo(-4.6 * u, -8.8 * u); ctx.lineTo(0, -11.2 * u); ctx.lineTo(4.6 * u, -8.8 * u); ctx.fill();
  ctx.fillStyle = COLORS.towerWindow; ctx.fillRect(-2.8 * u, -8.4 * u, 5.6 * u, 1.3 * u);
  ctx.fillStyle = COLORS.rescue; for (let i = 0; i < 4; i++) ctx.fillRect((-3.6 + i * 1.9) * u, -5.8 * u, 0.95 * u, 0.9 * u);
  ctx.fillStyle = COLORS.cream; ctx.beginPath(); ctx.moveTo(3.6 * u, -7.6 * u); ctx.lineTo(5.9 * u, -8.7 * u); ctx.lineTo(5.9 * u, -6.1 * u); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = ink; ctx.lineWidth = 0.4 * u; ctx.beginPath(); ctx.moveTo(0, -11.2 * u); ctx.lineTo(0, -13.6 * u); ctx.stroke();
  ctx.fillStyle = COLORS.rescue; ctx.fillRect(0, -13.6 * u, 2.2 * u, 1.3 * u);
  ctx.restore();
}

function drawHeelLine(ctx, x, y0, y1, u) {
  ctx.save(); ctx.lineCap = "round";
  const R = rng(5);
  const dashU = WORLD.heelLine.dashU;
  for (let y = y0; y < y1; y += (dashU / 11) * u) {
    const w = (0.35 + R() * 0.2) * u, dx = (R() - 0.5) * 0.5 * u;
    ctx.strokeStyle = `rgba(74,46,107,${WORLD.heelLine.shadowAlpha})`; ctx.lineWidth = w * 1.4;
    ctx.beginPath(); ctx.moveTo(x + dx, y); ctx.lineTo(x + dx * 0.5, y + 2.2 * u); ctx.stroke();
    ctx.strokeStyle = `rgba(255,240,215,${WORLD.heelLine.lightAlpha})`; ctx.lineWidth = w * 0.5;
    ctx.beginPath(); ctx.moveTo(x + dx + w * 0.6, y); ctx.lineTo(x + dx * 0.5 + w * 0.6, y + 2.2 * u); ctx.stroke();
  }
  ctx.restore();
}

function drawFoam(ctx, W, seaY, u) {
  ctx.save();
  const wave = (x) => seaY + Math.sin(x / (3.2 * u)) * WORLD.foam.ampU * 0.1 * u + Math.sin(x / (9 * u)) * 0.5 * u;
  ctx.fillStyle = "rgba(255,244,224,0.35)"; ctx.beginPath(); ctx.moveTo(0, seaY - 2 * u);
  for (let x = 0; x <= W; x += 6) ctx.lineTo(x, wave(x) + 1.2 * u);
  ctx.lineTo(W, seaY - 2 * u); ctx.fill();
  ctx.strokeStyle = COLORS.foam; ctx.lineWidth = WORLD.foam.lineU * u * 0.11; ctx.beginPath();
  for (let x = 0; x <= W; x += 6) (x ? ctx.lineTo(x, wave(x)) : ctx.moveTo(x, wave(x)));
  ctx.stroke();
  ctx.restore();
}

function drawBuoyRope(ctx, W, floorY, u) {
  ctx.save();
  const step = (WORLD.rope.floatStepU / 11) * u;
  const y = (x) => floorY + Math.sin((x / W) * Math.PI * 4) * 0.5 * u + 1.2 * u;
  ctx.strokeStyle = "rgba(74,46,107,0.25)"; ctx.lineWidth = 0.5 * u; ctx.beginPath();
  for (let x = 0; x <= W; x += 8) ctx.lineTo(x + 1.6 * u, y(x) + 1.6 * u); ctx.stroke();
  ctx.strokeStyle = "#F4E3C8"; ctx.lineWidth = 0.35 * u; ctx.beginPath();
  for (let x = 0; x <= W; x += 8) (x ? ctx.lineTo(x, y(x)) : ctx.moveTo(x, y(x))); ctx.stroke();
  for (let x = step / 2, i = 0; x < W; x += step, i++) {
    const rx = (WORLD.rope.floatRxU / 11) * u, ry = (WORLD.rope.floatRyU / 11) * u;
    ctx.fillStyle = "rgba(74,46,107,0.3)"; ctx.beginPath(); ctx.ellipse(x + 1.4 * u, y(x) + 1.4 * u, rx, ry, 0, 0, 7); ctx.fill();
    ctx.fillStyle = i % 2 ? COLORS.cream : COLORS.rescue; ctx.beginPath(); ctx.ellipse(x, y(x), rx, ry, 0, 0, 7); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.45)"; ctx.beginPath(); ctx.ellipse(x - rx * 0.3, y(x) - ry * 0.3, rx * 0.4, ry * 0.3, 0, 0, 7); ctx.fill();
  }
  ctx.restore();
}

// layout: computeLayout()'s return value (render/layout.js). Draws the full world into `ctx` at
// layout.W x layout.H (the GL canvas's own backing resolution, so it reads crisp at any DPR).
// opts.heelLine = false skips the half-court groove (M5 share-card photo, recipe.js CARD.photo.world).
export function paintBackdrop(ctx, layout, opts = {}) {
  const { W, H, horizon, sunX, sunR, t, b } = layout;
  const k = layout.scale, su = horizon / 15;
  const R = rng(7);

  // 1) sky: a smooth 3-stop gradient, not bands
  let g = ctx.createLinearGradient(0, 0, 0, horizon);
  g.addColorStop(0, COLORS.skyTop); g.addColorStop(0.55, COLORS.skyMid); g.addColorStop(1, COLORS.skyLow);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, horizon + 1);

  // 4) sun halo (additive look via a soft radial, unclipped so it washes into the lower sky)
  ctx.save();
  g = ctx.createRadialGradient(sunX, horizon, sunR * 0.6, sunX, horizon, sunR * 4.5);
  g.addColorStop(0, "rgba(255,214,140,0.75)"); g.addColorStop(1, "rgba(255,170,76,0)");
  ctx.fillStyle = g; ctx.fillRect(sunX - sunR * 4.5, 0, sunR * 9, horizon);

  ctx.beginPath(); ctx.rect(0, 0, W, horizon); ctx.clip();
  // 2) clouds
  ctx.fillStyle = `rgba(255,190,150,${WORLD.clouds.alpha})`;
  for (let i = 0; i < WORLD.clouds.n; i++) {
    const cx = R() * W, cy = horizon * (WORLD.clouds.yBand[0] + R() * (WORLD.clouds.yBand[1] - WORLD.clouds.yBand[0]));
    ctx.beginPath(); ctx.ellipse(cx, cy, (5 + R() * 9) * su, 0.45 * su, 0, 0, 7); ctx.fill();
  }
  // 3) hotel skyline, outer 22% each side
  ctx.fillStyle = "rgba(92,40,90,0.55)";
  let x = 0;
  while (x < W * 0.22) { const bw = (2.5 + R() * 4) * su, bh = (2 + R() * 5) * su; ctx.fillRect(x, horizon - bh, bw, bh + 1); x += bw + R() * 0.8 * su; }
  x = W * 0.8;
  while (x < W) { const bw = (2.5 + R() * 4) * su, bh = (1.5 + R() * 4) * su; ctx.fillRect(x, horizon - bh, bw, bh + 1); x += bw + R() * 0.8 * su; }
  // 5) sun disc
  const sunCy = horizon + WORLD.sun.cyOffsetR * sunR;
  g = ctx.createLinearGradient(0, horizon - sunR, 0, horizon);
  g.addColorStop(0, COLORS.sunTop); g.addColorStop(1, COLORS.sunRim);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sunX, sunCy, sunR, 0, 7); ctx.fill();
  ctx.fillStyle = `rgba(200,67,106,${WORLD.sun.bandAlpha})`;
  for (let i = 0; i < WORLD.sun.bands; i++) ctx.fillRect(sunX - sunR, horizon - sunR * (0.18 + i * 0.2), sunR * 2, sunR * (0.05 + i * 0.015));
  // 6) lifeguard tower, in front of the sun
  drawTower(ctx, sunX, horizon * (1 + WORLD.tower.baseOffsetOfHorizon), (WORLD.tower.heightOfHorizon * horizon) / 13.6);
  ctx.restore();

  // 7) sea
  g = ctx.createLinearGradient(0, horizon, 0, t);
  g.addColorStop(0, COLORS.seaDeep); g.addColorStop(1, COLORS.sea);
  ctx.fillStyle = g; ctx.fillRect(0, horizon, W, t - horizon + 1);
  // 8) glint
  ctx.save(); ctx.beginPath(); ctx.rect(0, horizon, W, t - horizon); ctx.clip();
  for (let i = 0; i < WORLD.glint.streaks; i++) {
    const tt = R(), yy = horizon + tt * (t - horizon);
    const spread = (WORLD.glint.spreadOfSunR[0] + tt * (WORLD.glint.spreadOfSunR[1] - WORLD.glint.spreadOfSunR[0])) * sunR;
    const xx = sunX + (R() - 0.5) * 2 * spread, len = (0.6 + R() * 2.2) * k * (0.5 + tt) * 10;
    const alpha = WORLD.glint.alpha[0] + R() * (WORLD.glint.alpha[1] - WORLD.glint.alpha[0]);
    ctx.fillStyle = `rgba(255,210,122,${alpha})`; ctx.fillRect(xx, yy, len, Math.max(1, 0.25 * k * 10));
  }
  ctx.restore();

  // 9) sand, full bleed (fills what used to be the purple margins)
  g = ctx.createLinearGradient(0, t, 0, H);
  g.addColorStop(0, COLORS.sandWet); g.addColorStop(0.08, COLORS.sand); g.addColorStop(0.55, COLORS.sandMid); g.addColorStop(1, COLORS.sandShade);
  ctx.fillStyle = g; ctx.fillRect(0, t, W, H - t);
  // 10) sand detail: light pool, grain, footprints
  g = ctx.createRadialGradient(sunX, t, 0, sunX, t, W * 0.45);
  g.addColorStop(0, "rgba(255,226,160,0.35)"); g.addColorStop(1, "rgba(255,226,160,0)");
  ctx.fillStyle = g; ctx.fillRect(0, t, W, H - t);
  const grainN = Math.round((W * (H - t)) / 1000 * WORLD.sand.grainPer1000px2);
  for (let i = 0; i < grainN; i++) {
    ctx.fillStyle = R() < 0.5 ? `rgba(255,248,230,${WORLD.sand.grainAlpha[0]})` : `rgba(90,40,60,${WORLD.sand.grainAlpha[1]})`;
    ctx.fillRect(R() * W, t + R() * (H - t), 1.4, 1.4);
  }
  for (let i = 0; i < WORLD.sand.footprints; i++) {
    const fx = R() * W, fy = t + 6 * k + R() * (b - t - 12 * k), a = R() * 6.28;
    for (const s of [-1, 1]) {
      ctx.save(); ctx.translate(fx + Math.cos(a + 1.57) * s * 0.7 * k, fy + Math.sin(a + 1.57) * s * 0.7 * k); ctx.rotate(a);
      ctx.fillStyle = `rgba(74,46,107,${WORLD.sand.footprintAlpha})`; ctx.beginPath(); ctx.ellipse(0, 0, 1.1 * k, 0.5 * k, 0, 0, 7); ctx.fill(); ctx.restore();
    }
  }

  // 11) heel line (half-court groove), court only
  if (opts.heelLine !== false) drawHeelLine(ctx, W / 2, t + 3 * k, b - 2 * k, k);
  // 12) foam, top wall, full width
  drawFoam(ctx, W, t, k);
  // 13) float rope, bottom band, full width
  drawBuoyRope(ctx, W, b, k);
}
