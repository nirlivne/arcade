// Captain Fold render.js: the canvas world (THE-260 design/spec S6, THE-264 M4). Ported from the Designer's
// reference renderers design/captain-fold/{world.js,pilot.js} (recipes, not shippable code - DESIGN.md: "neither
// file ships"); this file re-implements their drawing recipe against the game's real course/flight state and
// reads every colour from tokens.css via getComputedStyle. Render never feeds back into the model: it only
// reads flight/course state.
import { P, obstacleY as coreObstacleY, DT, newFlight, step } from "./core.js";
import { plane as buildPlaneSvg, face as buildFaceSvg, rasterSVG } from "./sprites.js";

const TAU = Math.PI * 2;
const STAR_PTS = [[0, -10], [3, -3], [10, -3], [4.5, 1.5], [6.5, 9], [0, 4.5], [-6.5, 9], [-4.5, 1.5], [-10, -3], [-3, -3]];
const TOKEN_NAMES = [
  "sky-900", "sky-700", "sky-600", "sky-400", "sky-200", "sun", "cloud", "cloud-back", "cloud-edge",
  "paper", "paper-shade", "ink", "ink-2", "marigold", "marigold-deep", "tomato", "tomato-deep",
  "lawn-far", "lawn-mid", "lawn", "lawn-deep", "fence", "kraft", "kraft-deep", "kraft-light",
  "laundry-a", "laundry-b", "laundry-c", "pigeon", "pigeon-deep",
  "updraft", "updraft-edge", "fan", "fan-edge", "down", "down-edge", "chevron",
  "star", "star-facet", "flag", "flag-pole", "blanket-a", "blanket-b", "bull", "wall", "wall-trim",
  "fold-paper", "fold-rule", "fold-margin", "fold-shade", "fold-far", "fold-kind",
];

export function readTokens(el = document.documentElement) {
  const cs = getComputedStyle(el);
  const t = (n) => cs.getPropertyValue(n).trim();
  const out = {};
  for (const n of TOKEN_NAMES) out[n] = t("--cf-" + n);
  out.outline = parseFloat(t("--cf-outline-w")) || 2.5;
  out.lineW = parseFloat(t("--cf-line-w")) || 2.4;
  out.dash = parseFloat(t("--cf-line-dash")) || 7;
  return out;
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function hash(i) { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
function poly(ctx, pts) { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); }
function lift(ctx, on = true, blur = 1.8, dy = 1.6) {
  ctx.shadowColor = on ? "rgba(30,42,51,0.28)" : "transparent";
  ctx.shadowBlur = on ? blur : 0;
  ctx.shadowOffsetY = on ? dy : 0;
  ctx.shadowOffsetX = 0;
}
function inkStroke(ctx, T, cam, px) {
  ctx.save();
  lift(ctx, false);
  ctx.lineJoin = "round";
  ctx.lineWidth = (px ?? T.outline) / cam.s;
  ctx.strokeStyle = T.ink;
  ctx.stroke();
  ctx.restore();
}

// Camera (spec S6, G6-A9): s = min(0.85*viewH/CEILING, 0.75*viewW/560, 1.25); the 0.85 height factor guarantees
// >= 15% ground/sky in landscape. World space: y up from the lawn (0). Screen space: y down from the top.
// `anchorX` (THE-311): the demo's final "pan to the blanket" beat anchors the camera on the landing zone instead
// of the (frozen) plane, without touching the plane's own drawn position.
export function camera(flight, viewW, viewH, dpr = 1, anchorX) {
  const s = Math.min((0.85 * viewH) / P.CEILING, (0.75 * viewW) / 560, 1.25);
  const bandH = P.CEILING * s;
  const bandTop = Math.round((viewH - bandH) / 2);
  const planeX = anchorX ?? flight.f.x;
  const x0 = planeX - (0.25 * viewW) / s;
  const yLawn = bandTop + bandH;
  const cam = {
    W: viewW, H: viewH, s, dpr, x0, yLawn, bandTop, bandH,
    X: (x) => (x - x0) * s,
    Y: (y) => yLawn - y * s,
  };
  return cam;
}
const sx = (c, x) => c.X(x);
const sy = (c, y) => c.Y(y);
function worldXf(ctx, c) { ctx.setTransform(c.s * c.dpr, 0, 0, -c.s * c.dpr, -c.x0 * c.s * c.dpr, c.yLawn * c.dpr); }
function screenXf(ctx, c) { ctx.setTransform(c.dpr, 0, 0, c.dpr, 0, 0); }

// ---- sky: a cached gradient, rebuilt whenever the viewport size changes.
function drawSky(ctx, c, T) {
  screenXf(ctx, c);
  const g = ctx.createLinearGradient(0, 0, 0, c.H);
  const top = Math.max(0.02, (c.bandTop - 30) / c.H);
  g.addColorStop(0, T["sky-700"]);
  g.addColorStop(top, T["sky-600"]);
  g.addColorStop(Math.min(0.97, (c.bandTop + c.bandH * 0.62) / c.H), T["sky-400"]);
  g.addColorStop(Math.min(0.99, c.yLawn / c.H), T["sky-200"]);
  g.addColorStop(1, T["sky-200"]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, c.W, c.H);
  const r = 0.6 * Math.max(c.W, c.H);
  const sun = ctx.createRadialGradient(0.84 * c.W, c.yLawn - 20, 0, 0.84 * c.W, c.yLawn - 20, r);
  sun.addColorStop(0, hexA(T.sun, 0.85));
  sun.addColorStop(1, hexA(T.sun, 0));
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, c.W, c.H);
}

const CLOUD_PATH_D = "M0,30 C-4,14 12,4 26,10 C32,-6 58,-6 64,10 C76,2 96,10 92,26 C104,28 104,42 92,42 L6,42 C-6,42 -8,32 0,30 Z";
let cloudPath;
function drawCloud(ctx, T, x, y, k) {
  cloudPath = cloudPath || new Path2D(CLOUD_PATH_D);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.fillStyle = T["cloud-back"];
  ctx.translate(0, 4);
  ctx.fill(cloudPath);
  ctx.translate(0, -4);
  lift(ctx);
  ctx.fillStyle = T.cloud;
  ctx.fill(cloudPath);
  lift(ctx, false);
  ctx.strokeStyle = T["cloud-edge"];
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(8, 38);
  ctx.bezierCurveTo(30, 34, 70, 34, 90, 38);
  ctx.stroke();
  ctx.restore();
}

// ---- the parallax layer (0.35x): high clouds, far + mid hills and the picket fence. Pre-rendered per resize.
function buildParallaxTile(T, c) {
  const w = Math.ceil(c.W * 2), h = Math.ceil(c.yLawn + 4);
  const cv = document.createElement("canvas");
  cv.width = w * c.dpr;
  cv.height = h * c.dpr;
  const x = cv.getContext("2d");
  x.scale(c.dpr, c.dpr);
  const k = Math.max(0.55, c.s);
  if (c.bandTop > 150) for (let i = 0; i < 5; i++) drawCloud(x, T, (i / 5) * w + hash(i) * 80, c.bandTop - 120 + hash(i + 9) * 40, 0.55 * k + hash(i + 3) * 0.2);
  const y = c.yLawn;
  const hill = (col, base, amp, seed) => {
    x.beginPath();
    x.moveTo(0, y + 2);
    for (let i = 0; i <= 8; i++) {
      const px = (i / 8) * w, py = y - base * k - Math.sin(i * 1.7 + seed) * amp * k;
      i ? x.quadraticCurveTo(px - w / 16, py - amp * 0.6 * k, px, py) : x.lineTo(px, py);
    }
    x.lineTo(w, y + 2);
    x.closePath();
    lift(x);
    x.fillStyle = col;
    x.fill();
    lift(x, false);
  };
  hill(T["lawn-far"], 70, 18, 0.5);
  hill(T["lawn-mid"], 34, 10, 2.1);
  const f = k / 0.52, pitch = 13 * f, ph = 22 * f;
  lift(x);
  x.fillStyle = T.fence;
  x.fillRect(0, y - ph * 0.55, w, 3.2 * f);
  for (let px = 3; px < w; px += pitch) {
    poly(x, [[px, y], [px, y - ph + 3 * f], [px + 3.5 * f, y - ph], [px + 7 * f, y - ph + 3 * f], [px + 7 * f, y]]);
    x.fill();
  }
  lift(x, false);
  return cv;
}
function drawParallax(ctx, c, tile, camX) {
  screenXf(ctx, c);
  const w = tile.width / c.dpr, off = -((camX * c.s * 0.35) % w);
  ctx.drawImage(tile, off, 0, w, tile.height / c.dpr);
  ctx.drawImage(tile, off + w, 0, w, tile.height / c.dpr);
}

// ---- the band's own cloud bank (the top 6 m, 1.0x): every 150 world px.
function drawCloudBank(ctx, c, T) {
  screenXf(ctx, c);
  const k = c.s * 1.25, first = Math.floor(c.x0 / 150) - 1;
  for (let i = first; i < first + c.W / (150 * c.s) + 3; i++) {
    const x = sx(c, i * 150 + hash(i) * 70), y = sy(c, 606 + hash(i + 5) * 30);
    drawCloud(ctx, T, x, y - 30 * k, k * (0.9 + hash(i + 2) * 0.5));
  }
}

// ---- the lawn from y 0 down to the screen bottom, with a cut edge and grass tufts.
function drawGround(ctx, c, T) {
  screenXf(ctx, c);
  const y = c.yLawn;
  lift(ctx, true, 3, -1);
  ctx.fillStyle = T.lawn;
  ctx.beginPath();
  ctx.moveTo(0, y);
  for (let px = 0; px <= c.W + 20; px += 20) ctx.lineTo(px, y + Math.sin((px / c.s + c.x0) * 0.05) * 1.2);
  ctx.lineTo(c.W, c.H);
  ctx.lineTo(0, c.H);
  ctx.closePath();
  ctx.fill();
  lift(ctx, false);
  const y2 = y + Math.max(48, (c.H - y) * 0.62);
  lift(ctx, true, 3, -1);
  ctx.fillStyle = T["lawn-deep"];
  ctx.beginPath();
  ctx.moveTo(0, y2);
  for (let px = 0; px <= c.W + 24; px += 24) ctx.lineTo(px, y2 + Math.sin(px * 0.018 + 1.3) * 7);
  ctx.lineTo(c.W, c.H);
  ctx.lineTo(0, c.H);
  ctx.closePath();
  ctx.fill();
  lift(ctx, false);
  ctx.strokeStyle = T["lawn-deep"];
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";
  const first = Math.floor(c.x0 / 30);
  for (let i = first; i < first + c.W / (30 * c.s) + 2; i++) {
    const x = sx(c, i * 30 + hash(i) * 12), yy = y + 6 + hash(i + 1) * 14;
    ctx.beginPath();
    ctx.moveTo(x - 3, yy - 5);
    ctx.lineTo(x, yy);
    ctx.lineTo(x + 3, yy - 6);
    ctx.stroke();
  }
}

// ---- air currents: chevrons give the direction (greyscale-safe). t is a seconds clock for scroll/wobble.
function drawAir(ctx, c, T, a, t) {
  worldXf(ctx, c);
  const col = a.kind === "up" ? T.updraft : a.kind === "fan" ? T.fan : T.down;
  const edge = a.kind === "up" ? T["updraft-edge"] : a.kind === "fan" ? T["fan-edge"] : T["down-edge"];
  ctx.save();
  ctx.globalAlpha = a.kind === "fan" ? 0.32 : 0.6;
  ctx.fillStyle = col;
  ctx.fillRect(a.x, a.y0, a.w, a.y1 - a.y0);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = edge;
  ctx.lineWidth = 2 / c.s;
  if (a.kind === "fan") {
    ctx.setLineDash([6 / c.s, 5 / c.s]);
    ctx.strokeRect(a.x, a.y0, a.w, a.y1 - a.y0);
    ctx.setLineDash([]);
  } else {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y0);
    ctx.lineTo(a.x, a.y1);
    ctx.moveTo(a.x + a.w, a.y0);
    ctx.lineTo(a.x + a.w, a.y1);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.rect(a.x, a.y0, a.w, a.y1 - a.y0);
  ctx.clip();
  ctx.globalAlpha = 0.7;
  ctx.strokeStyle = a.kind === "fan" ? T.fan : col === T.down ? T["down-edge"] : T.updraft;
  ctx.lineWidth = 9;
  ctx.lineCap = "round";
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    if (a.kind === "fan") {
      const yy = a.y0 + ((i + 0.5) / 3) * (a.y1 - a.y0);
      for (let x = a.x; x <= a.x + a.w; x += 12) ctx.lineTo(x, yy + Math.sin(x * 0.03 + t * 3 + i) * 8);
    } else {
      const xx = a.x + ((i + 0.5) / 3) * a.w;
      for (let y = a.y0; y <= a.y1; y += 12) ctx.lineTo(xx + Math.sin(y * 0.025 + t * 2 + i * 2) * 10, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 0.95;
  ctx.strokeStyle = T.chevron;
  ctx.lineWidth = 3.5 / c.s;
  ctx.lineJoin = "round";
  const stepPx = 62, off = (t * 40) % stepPx, cx = a.x + a.w / 2, cy = (a.y0 + a.y1) / 2;
  ctx.beginPath();
  if (a.kind === "fan") {
    for (let x = a.x + off; x < a.x + a.w; x += stepPx) {
      ctx.moveTo(x - 5, cy + 12);
      ctx.lineTo(x + 6, cy);
      ctx.lineTo(x - 5, cy - 12);
    }
  } else {
    const dir = a.kind === "up" ? 1 : -1;
    for (let k = 0; k < (a.y1 - a.y0) / stepPx + 1; k++) {
      const y = dir > 0 ? a.y0 + off + k * stepPx : a.y1 - off - k * stepPx;
      ctx.moveTo(cx - 12, y - 5.5 * dir);
      ctx.lineTo(cx, y + 5.5 * dir);
      ctx.lineTo(cx + 12, y - 5.5 * dir);
    }
  }
  ctx.stroke();
  if (a.kind === "up") {
    ctx.lineWidth = 1.2 / c.s;
    ctx.strokeStyle = T.chevron;
    for (let i = 0; i < 4; i++) {
      const x = a.x + 10 + hash(i + a.x) * (a.w - 20), h = a.y1 - a.y0, y = a.y0 + ((hash(i * 3 + a.x) * h + t * 25) % h);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - 6);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y + 3, 3, 0, TAU);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// ---- obstacles: warm paper + a 2.5 CSS px ink outline (nothing else has it).
// `t` is physics time (it places the bobbing pigeon, so it must match the hitbox); `animT` drives the purely
// decorative motion (kite tail, wing flap) and is frozen at 0 under reduced motion (THE-308).
function drawObstacle(ctx, c, T, o, t, i, knocked, animT = t) {
  worldXf(ctx, c);
  ctx.save();
  const inkLine = (px = 1.6) => { ctx.lineWidth = px / c.s; ctx.strokeStyle = T.ink; };
  if (knocked) ctx.globalAlpha = 0.4;
  if (o.kind === "hang") {
    const top = 596;
    inkLine(1.6);
    ctx.beginPath();
    ctx.moveTo(o.x - 70, top);
    ctx.quadraticCurveTo(o.x + o.w / 2, top - 22, o.x + o.w + 70, top);
    ctx.stroke();
    const face = i % 2 ? T["laundry-b"] : T["laundry-a"], stripe = i % 2 ? T["laundry-a"] : T["laundry-b"];
    const hem = [];
    for (let x = o.x + o.w + 2; x >= o.x - 2; x -= 8) hem.push([x, o.y0 + Math.sin(x * 0.4) * 2.5]);
    poly(ctx, [[o.x - 2, top - 12], [o.x + o.w + 2, top - 14], ...hem]);
    lift(ctx);
    ctx.fillStyle = face;
    ctx.fill();
    lift(ctx, false);
    ctx.save();
    ctx.clip();
    ctx.fillStyle = stripe;
    for (let y = top - 40; y > o.y0; y -= 40) ctx.fillRect(o.x - 4, y, o.w + 8, 9);
    ctx.restore();
    poly(ctx, [[o.x - 2, top - 12], [o.x + o.w + 2, top - 14], ...hem]);
    inkStroke(ctx, T, c);
    ctx.fillStyle = T["kraft-deep"];
    for (const px of [o.x + 6, o.x + o.w - 12]) ctx.fillRect(px, top - 20, 6, 14);
  } else if (o.kind === "rise") {
    const cx = o.x + o.w / 2;
    ctx.beginPath();
    ctx.rect(cx - 6, 0, 12, o.y1 - 50);
    lift(ctx);
    ctx.fillStyle = T["kraft-deep"];
    ctx.fill();
    lift(ctx, false);
    inkStroke(ctx, T, c);
    ctx.beginPath();
    ctx.rect(o.x + 2, o.y1 - 56, o.w - 4, 42);
    lift(ctx);
    ctx.fillStyle = T.kraft;
    ctx.fill();
    lift(ctx, false);
    inkStroke(ctx, T, c);
    ctx.fillStyle = T.ink;
    ctx.beginPath();
    ctx.arc(cx, o.y1 - 34, 8, 0, TAU);
    ctx.fill();
    ctx.fillStyle = T["kraft-deep"];
    ctx.fillRect(cx - 3, o.y1 - 52, 6, 8);
    poly(ctx, [[o.x - 6, o.y1 - 16], [cx, o.y1 + 4], [o.x + o.w + 6, o.y1 - 16]]);
    lift(ctx);
    ctx.fillStyle = T.tomato;
    ctx.fill();
    lift(ctx, false);
    inkStroke(ctx, T, c);
  } else if (o.kind === "wide") {
    ctx.beginPath();
    ctx.rect(o.x, 0, o.w, o.y1 - 22);
    lift(ctx);
    ctx.fillStyle = T["kraft-light"];
    ctx.fill();
    lift(ctx, false);
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = T.kraft;
    ctx.lineWidth = 1.2 / c.s;
    for (let x = o.x + 18; x < o.x + o.w; x += 18) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, o.y1);
      ctx.stroke();
    }
    ctx.restore();
    ctx.beginPath();
    ctx.rect(o.x, 0, o.w, o.y1 - 22);
    inkStroke(ctx, T, c);
    if (o.y1 > 110) {
      ctx.beginPath();
      ctx.rect(o.x + o.w - 70, 0, 40, Math.min(90, o.y1 - 40));
      ctx.fillStyle = T["kraft-deep"];
      ctx.fill();
      inkStroke(ctx, T, c, 1.6);
      ctx.beginPath();
      ctx.rect(o.x + 30, o.y1 - 80, 46, 34);
      ctx.fillStyle = T.paper;
      ctx.fill();
      inkStroke(ctx, T, c, 1.6);
      ctx.beginPath();
      ctx.moveTo(o.x + 53, o.y1 - 80);
      ctx.lineTo(o.x + 53, o.y1 - 46);
      ctx.moveTo(o.x + 30, o.y1 - 63);
      ctx.lineTo(o.x + 76, o.y1 - 63);
      inkLine(1.4);
      ctx.stroke();
    }
    poly(ctx, [[o.x - 8, o.y1 - 24], [o.x + o.w + 8, o.y1 - 24], [o.x + o.w + 2, o.y1 + 2], [o.x - 2, o.y1 + 2]]);
    lift(ctx);
    ctx.fillStyle = T["kraft-deep"];
    ctx.fill();
    lift(ctx, false);
    inkStroke(ctx, T, c);
  } else if (o.kind === "float") {
    const cx = o.x + o.w / 2, cy = (o.y0 + o.y1) / 2, hh = (o.y1 - o.y0) / 2 + 4;
    inkLine(1);
    ctx.beginPath();
    ctx.moveTo(cx, cy + hh);
    ctx.quadraticCurveTo(cx - 40, cy + hh + 80, cx - 90, 600);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - hh);
    for (let k = 1; k <= 12; k++) ctx.lineTo(cx + Math.sin(k * 0.9 + animT * 3) * 10, cy - hh - k * 8);
    ctx.stroke();
    for (let k = 1; k <= 3; k++) {
      const bx = cx + Math.sin(k * 3 * 0.9 + animT * 3) * 10, by = cy - hh - k * 24;
      poly(ctx, [[bx - 7, by + 4], [bx + 7, by - 4], [bx + 7, by + 4], [bx - 7, by - 4]]);
      ctx.fillStyle = k % 2 ? T.tomato : T.paper;
      ctx.fill();
    }
    const Lp = [cx - o.w / 2 - 4, cy + hh * 0.2], Rp = [cx + o.w / 2 + 4, cy + hh * 0.2], Up = [cx, cy + hh], Dp = [cx, cy - hh];
    lift(ctx);
    poly(ctx, [Up, Rp, Dp, Lp]);
    ctx.fillStyle = T.paper;
    ctx.fill();
    lift(ctx, false);
    poly(ctx, [Up, Lp, Dp]);
    ctx.fillStyle = T.tomato;
    ctx.fill();
    ctx.strokeStyle = T["kraft-deep"];
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(...Up);
    ctx.lineTo(...Dp);
    ctx.moveTo(...Lp);
    ctx.lineTo(...Rp);
    ctx.stroke();
    poly(ctx, [Up, Rp, Dp, Lp]);
    inkStroke(ctx, T, c);
  } else if (o.kind === "bob") {
    const cy = o.mid + o.amp * Math.sin((TAU * t) / o.period + o.phase), cx = o.x + o.w / 2;
    const flap = Math.sin(animT * 9 + o.phase);
    const body = [[cx - 34, cy + 2], [cx - 14, cy + 14], [cx + 18, cy + 12], [cx + 30, cy + 22], [cx + 34, cy + 10], [cx + 22, cy - 2], [cx - 6, cy - 18], [cx - 30, cy - 10]];
    poly(ctx, body);
    lift(ctx);
    ctx.fillStyle = T.pigeon;
    ctx.fill();
    lift(ctx, false);
    inkStroke(ctx, T, c);
    poly(ctx, [[cx + 34, cy + 16], [cx + 44, cy + 13], [cx + 34, cy + 10]]);
    ctx.fillStyle = T["marigold-deep"];
    ctx.fill();
    inkStroke(ctx, T, c, 1.6);
    ctx.fillStyle = T.ink;
    ctx.beginPath();
    ctx.arc(cx + 26, cy + 15, 2.4, 0, TAU);
    ctx.fill();
    poly(ctx, [[cx - 10, cy + 6], [cx + 12, cy + 6], [cx - 4, cy + 6 + 28 * flap]]);
    ctx.fillStyle = T["pigeon-deep"];
    ctx.fill();
    inkStroke(ctx, T, c);
  } else if (o.kind === "wall") {
    ctx.beginPath();
    ctx.rect(o.x, 0, 400, 640);
    lift(ctx);
    ctx.fillStyle = T.wall;
    ctx.fill();
    lift(ctx, false);
    inkStroke(ctx, T, c);
    ctx.fillStyle = T["wall-trim"];
    ctx.fillRect(o.x, 0, 400, 16);
    for (const wy of [120, 360]) {
      ctx.beginPath();
      ctx.rect(o.x + 40, wy, 70, 90);
      ctx.fillStyle = T["sky-400"];
      ctx.fill();
      inkStroke(ctx, T, c, 1.6);
      ctx.fillStyle = T.paper;
      ctx.fillRect(o.x + 36, wy - 8, 78, 8);
    }
  }
  ctx.restore();
}

// ---- a lucky star: marigold origami star, ink edge, facet lines. >= 18 CSS px across on any s.
function drawStar(ctx, c, T, x, y, t, alpha = 1) {
  screenXf(ctx, c);
  const size = Math.max(26 * c.s, 18), k = size / 20, X = sx(c, x), Y = sy(c, y);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(X, Y);
  ctx.rotate(Math.sin(t * 2 + x * 0.01) * 0.18);
  ctx.scale(k, k);
  poly(ctx, STAR_PTS);
  lift(ctx, true, 1.4 / k, 1.3 / k);
  ctx.fillStyle = T.star;
  ctx.fill();
  lift(ctx, false);
  ctx.lineJoin = "round";
  ctx.lineWidth = 1.6 / k;
  ctx.strokeStyle = T.ink;
  ctx.stroke();
  ctx.strokeStyle = T["star-facet"];
  ctx.lineWidth = 1 / k;
  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.lineTo(0, 4.5);
  ctx.moveTo(-10, -3);
  ctx.lineTo(4.5, 1.5);
  ctx.stroke();
  ctx.restore();
}

// ---- the best-distance flag: kraft pole, paper pennant, "BEST" label.
function drawFlag(ctx, c, T, x, label = "BEST") {
  screenXf(ctx, c);
  const X = sx(c, x), Y = c.yLawn, h = 220 * c.s, pw = Math.max(56 * c.s, 30), ph = Math.max(30 * c.s, 17);
  lift(ctx);
  ctx.fillStyle = T["flag-pole"];
  ctx.fillRect(X - 1.5, Y - h, 3, h);
  ctx.fillStyle = T.flag;
  poly(ctx, [[X + 1.5, Y - h], [X + 1.5 + pw, Y - h + ph / 2], [X + 1.5, Y - h + ph]]);
  ctx.fill();
  lift(ctx, false);
  ctx.fillStyle = T.tomato;
  ctx.fillRect(X + 1.5, Y - h, 3, ph);
  ctx.fillStyle = T.ink;
  ctx.font = `800 ${Math.max(10, 12 * c.s)}px Saira, system-ui, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.fillText(label, X + 7, Y - h + ph / 2 + 0.5);
}

// ---- landing: the picnic blanket + bullseye + zone stake, at the course's own landStart/L.
function drawLanding(ctx, c, T, L) {
  const bx = L - 200;
  screenXf(ctx, c);
  const X0 = sx(c, bx - 120), X1 = sx(c, bx + 120), Y = c.yLawn, hgt = Math.max(18 * c.s, 9);
  ctx.save();
  lift(ctx);
  poly(ctx, [[X0 + 4, Y + 1], [X1 - 4, Y + 1], [X1 + 6, Y + hgt], [X0 - 6, Y + hgt]]);
  ctx.fillStyle = T["blanket-b"];
  ctx.fill();
  lift(ctx, false);
  ctx.clip();
  const cw = Math.max(20 * c.s, 8);
  ctx.fillStyle = hexA(T["blanket-a"], 0.8);
  for (let x = X0 - 6; x < X1 + 6; x += cw * 2) ctx.fillRect(x, Y, cw, hgt);
  ctx.fillStyle = hexA(T["blanket-a"], 0.5);
  ctx.fillRect(X0 - 6, Y + hgt * 0.34, X1 - X0 + 12, hgt * 0.32);
  ctx.restore();
  const BX = sx(c, bx), rw = 50 * c.s;
  ctx.beginPath();
  ctx.ellipse(BX, Y + hgt / 2, rw, hgt * 0.42, 0, 0, TAU);
  ctx.fillStyle = T.bull;
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = T.ink;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(BX, Y + hgt / 2, rw * 0.3, hgt * 0.16, 0, 0, TAU);
  ctx.fillStyle = T.paper;
  ctx.fill();
  const ZX = sx(c, L - 400);
  lift(ctx);
  ctx.fillStyle = T["flag-pole"];
  ctx.fillRect(ZX - 1, Y - 34 * Math.max(c.s, 0.6), 2, 34 * Math.max(c.s, 0.6));
  ctx.fillStyle = T.paper;
  ctx.fillRect(ZX - 12, Y - 34 * Math.max(c.s, 0.6), 24, 12);
  lift(ctx, false);
  ctx.fillStyle = T.ink;
  ctx.font = "800 9px Saira, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("▼", ZX, Y - 34 * Math.max(c.s, 0.6) + 6.5);
  ctx.textAlign = "start";
}

// ---- the pencil-dash flight line: the last few seconds of path (world points, one per physics step).
function drawFlightLine(ctx, c, T, pts, droppedLen = 0) {
  if (pts.length < 2) return;
  screenXf(ctx, c);
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = T.ink;
  ctx.lineWidth = T.lineW;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash([T.dash, T.dash]);
  ctx.lineDashOffset = droppedLen * c.s;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(sx(c, x), sy(c, y)) : ctx.moveTo(sx(c, x), sy(c, y))));
  ctx.stroke();
  ctx.restore();
}

const THROW_ARC_S = 1.5; // spec S2: "a dotted throw arc shows the first 1.5 s of flight while you pull"
function drawThrowArc(ctx, c, T, course, power) {
  const scratch = newFlight(course, power);
  screenXf(ctx, c);
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = T.ink;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(sx(c, scratch.x), sy(c, scratch.y));
  for (let t = 0; t < THROW_ARC_S && !scratch.over; t += DT) {
    step(scratch, course, false);
    ctx.lineTo(sx(c, scratch.x), sy(c, scratch.y));
  }
  ctx.stroke();
  ctx.restore();
}

// ---- the plane: 3 pitch frames pre-rendered from sprites.js per fold pattern (climb -14deg, level 0, dive
// +12deg). Frame by angle a (rad): a > 0.25 climb, a < -0.25 dive, else level; the residual angle is a canvas
// rotation about the sprite's pivot. Sprite width = 72 world px.
const FRAME_DEFS = [["climb", -14], ["level", 0], ["dive", 12]];
export async function buildPlaneFrames(T, pxWidth, expr = "neutral") {
  const fold = { paper: T["fold-paper"], rule: T["fold-rule"], margin: T["fold-margin"], shade: T["fold-shade"], far: T["fold-far"], kind: T["fold-kind"] };
  const out = {};
  for (const [name, pitch] of FRAME_DEFS) {
    const w = pxWidth * 3;
    out[name] = await rasterSVG(buildPlaneSvg({ width: w, pitch, expr, fold }), w, (w * 76) / 146);
  }
  return out;
}
function drawPlane(ctx, c, frames, x, y, a, bank = 0, alpha = 1) {
  if (!frames) return;
  screenXf(ctx, c);
  const f = a > 0.25 ? "climb" : a < -0.25 ? "dive" : "level";
  const base = f === "climb" ? -14 : f === "dive" ? 12 : 0;
  const img = frames[f];
  if (!img) return;
  const w = 72 * c.s, h = (w * 76) / 146;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(sx(c, x), sy(c, y));
  ctx.rotate(((-a * 180) / Math.PI - base) * (Math.PI / 180) + bank);
  ctx.drawImage(img, -0.52 * w, -0.63 * h, w, h);
  ctx.restore();
}

// ---- paper flutter (DESIGN.md S6.2/S9): bank tracks vertical speed with a 120 ms exponential lag (+-18deg
// max), and a +-6deg/6Hz wobble while stalled. Smoothing state is per-flight (a WeakMap keyed on the flight
// object itself, since drawWorld is called every frame with the same live object for one flight and a fresh one
// for the next - no explicit reset needed when a new flight starts).
const bankState = new WeakMap();
export const BANK_MAX_RAD = (18 * Math.PI) / 180;
export const BANK_LAG_S = 0.12;
export const WOBBLE_RAD = (6 * Math.PI) / 180;
export const WOBBLE_HZ = 6;
// `still` (reduced motion, THE-308) drops the stall wobble; the porthole's strain face still tells the stall.
export function updateBank(f, dt, still = false) {
  let st = bankState.get(f);
  if (!st) { st = { bank: 0, lastT: f.t }; bankState.set(f, st); }
  const frameDt = Math.max(0, Math.min(0.1, dt ?? f.t - st.lastT));
  st.lastT = f.t;
  const vy = f.v * Math.sin(f.a); // positive = climbing
  const targetBank = Math.max(-BANK_MAX_RAD, Math.min(BANK_MAX_RAD, (vy / P.VMAX) * BANK_MAX_RAD));
  const k = frameDt > 0 ? 1 - Math.exp(-frameDt / BANK_LAG_S) : 0;
  st.bank += (targetBank - st.bank) * k;
  const wobble = f.stalled && !still ? Math.sin(f.t * WOBBLE_HZ * 2 * Math.PI) * WOBBLE_RAD : 0;
  return st.bank + wobble;
}

// ---- grace blink (DESIGN.md S6.2): after a paper bounce, the plane flickers alpha 0.35/1 at 10 Hz for 1.0 s -
// a "you nearly lost that" tell, since the grace window (core.js's GRACE_S) is otherwise invisible. Diffs
// f.bounces frame to frame (core.js only counts bounces, it has no "bounced at time t" event of its own) to
// find the most recent bounce's timestamp, per flight (the same WeakMap-per-flight pattern as updateBank).
const blinkState = new WeakMap();
const BLINK_HZ = 10;
const BLINK_DURATION_S = 1.0;
const BLINK_LOW_ALPHA = 0.35;
// `steady` (reduced motion, THE-308): no 10 Hz flicker, the plane just dims for the same 1.0 s.
export function updateBlinkAlpha(f, steady = false) {
  let st = blinkState.get(f);
  if (!st) { st = { lastBounces: f.bounces, since: null }; blinkState.set(f, st); }
  if (f.bounces !== st.lastBounces) { st.lastBounces = f.bounces; st.since = f.t; }
  if (st.since == null || f.t - st.since > BLINK_DURATION_S) return 1;
  if (steady) return (1 + BLINK_LOW_ALPHA) / 2;
  return Math.sin((f.t - st.since) * BLINK_HZ * 2 * Math.PI) >= 0 ? 1 : BLINK_LOW_ALPHA;
}

// crash: the crumpled paper ball, 2 bounces over 0.9 s (spec S2, TOUCHDOWN_MS in game.js). Driven by elapsed
// time since the crash (f.result.t, set once by core.js's crash()) rather than extra render-side state - a
// decaying bounce height (each half the last) plus a tumble that slows as the bounces settle.
export const CRUMPLE_BOUNCE_S = 0.9;
const CRUMPLE_BOUNCE_HZ = 2 / CRUMPLE_BOUNCE_S; // 2 bounces over the window
export function crumpleOffset(elapsedS) {
  if (elapsedS >= CRUMPLE_BOUNCE_S) return { dy: 0, rot: 0 };
  const decay = 1 - elapsedS / CRUMPLE_BOUNCE_S;
  const bounce = Math.abs(Math.sin(elapsedS * CRUMPLE_BOUNCE_HZ * Math.PI)) * decay;
  return { dy: bounce * 14, rot: elapsedS * 10 * decay };
}
function drawCrumple(ctx, c, T, x, y, rot = 0) {
  screenXf(ctx, c);
  const r = Math.max(11 * c.s, 8), X = sx(c, x), Y = sy(c, y) - r;
  ctx.save();
  ctx.translate(X, Y);
  ctx.rotate(rot);
  poly(ctx, Array.from({ length: 9 }, (_, i) => [Math.cos((i / 9) * TAU) * r * (0.85 + hash(i) * 0.25), Math.sin((i / 9) * TAU) * r * (0.85 + hash(i + 4) * 0.25)]));
  lift(ctx);
  ctx.fillStyle = T["fold-paper"];
  ctx.fill();
  lift(ctx, false);
  ctx.strokeStyle = T["fold-shade"];
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-r * 0.6, -r * 0.2);
  ctx.lineTo(r * 0.1, r * 0.1);
  ctx.lineTo(r * 0.5, -r * 0.5);
  ctx.moveTo(r * 0.1, r * 0.1);
  ctx.lineTo(-r * 0.1, r * 0.7);
  ctx.stroke();
  ctx.strokeStyle = T["fold-rule"];
  ctx.beginPath();
  ctx.moveTo(-r * 0.7, r * 0.3);
  ctx.lineTo(r * 0.6, r * 0.4);
  ctx.stroke();
  ctx.restore();
}

// ---- render state cache: the parallax tile (rebuilt on resize) and the plane frames (rebuilt on fold change).
// Both are async/expensive; drawWorld draws flat placeholders until they're ready, same as the M2 grey-box did.
// tokens itself is cached too: readTokens() is a getComputedStyle() plus ~50 getPropertyValue() calls, expensive
// enough to matter once per frame (found via the QA engagement probe regressing to ~1x after M4 - a real
// browser running rAF-driven frame() calls pays this cost every frame; the pure-logic sim never calls drawWorld
// at all, so it never caught this). Invalidated only by the cheap data-fold attribute, which is the one thing
// that actually changes the token values at runtime.
const cache = { tokens: null, tokensFold: null, tile: null, tileKey: "", frames: null, frameKey: "", framesPromise: null };

function ensureTokens() {
  const fold = document.documentElement.dataset.fold || "";
  if (!cache.tokens || cache.tokensFold !== fold) {
    cache.tokens = readTokens();
    cache.tokensFold = fold;
  }
  return cache.tokens;
}

function ensureParallaxTile(T, cam) {
  const key = `${cam.W}x${cam.H}x${cam.s.toFixed(3)}`;
  if (cache.tileKey !== key) {
    cache.tile = buildParallaxTile(T, cam);
    cache.tileKey = key;
  }
  return cache.tile;
}

function ensurePlaneFrames(T) {
  const key = `${T["fold-kind"]}|${T["fold-paper"]}|${T["fold-rule"]}|${T["fold-margin"]}|${T["fold-shade"]}|${T["fold-far"]}`;
  if (cache.frameKey !== key && !cache.framesPromise) {
    cache.frameKey = key;
    cache.framesPromise = buildPlaneFrames(T, 72).then((frames) => { cache.frames = frames; cache.framesPromise = null; });
  }
  return cache.frames;
}

export function drawWorld(ctx, viewW, viewH, course, flight, opts = {}) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cam = camera(flight, viewW, viewH, dpr, opts.camX);
  const T = ensureTokens();
  const f = flight.f;
  const t = f.t || 0;
  // Reduced motion (THE-308: the game toggle or the OS setting): decorative motion runs on a frozen clock.
  // Physics-driven positions (the plane, the bobbing pigeon's place, scrolling) still use `t`.
  const still = !!opts.reduceMotion;
  const animT = still ? 0 : t;

  drawSky(ctx, cam, T);
  const tile = ensureParallaxTile(T, cam);
  drawParallax(ctx, cam, tile, f.x);
  drawCloudBank(ctx, cam, T);
  drawGround(ctx, cam, T);

  for (const a of course.air) drawAir(ctx, cam, T, a, animT);

  drawLanding(ctx, cam, T, course.L);
  if (opts.bestX > 0) drawFlag(ctx, cam, T, opts.bestX, "BEST");

  course.obstacles.forEach((o, i) => {
    drawObstacle(ctx, cam, T, o, t, i, f.knocked?.has(i), animT);
  });

  course.stars.forEach((st, i) => {
    if (f.starsTaken?.has(i)) return;
    drawStar(ctx, cam, T, st.x, st.y, animT);
  });

  if (opts.throwArcPower != null) drawThrowArc(ctx, cam, T, course, opts.throwArcPower);
  if (opts.trail?.length > 1) drawFlightLine(ctx, cam, T, opts.trail, opts.trailDropped || 0);

  const frames = ensurePlaneFrames(T);
  if (f.result?.kind === "crash" || (f.over && f.result?.kind !== "land")) {
    const { dy, rot } = crumpleOffset(opts.touchdownElapsedS ?? 0);
    drawCrumple(ctx, cam, T, f.x, Math.max(f.y, 0) + dy, rot);
  } else if (frames) {
    const bank = updateBank(f, undefined, still);
    const blinkAlpha = updateBlinkAlpha(f, still);
    drawPlane(ctx, cam, frames, f.x, f.y, f.a, bank, blinkAlpha);
  } else {
    // Frames still rasterising (first paint only): a flat placeholder dart so nothing is invisible.
    screenXf(ctx, cam);
    ctx.save();
    ctx.translate(sx(cam, f.x), sy(cam, f.y));
    ctx.rotate(-f.a);
    ctx.fillStyle = T.paper;
    ctx.strokeStyle = T.ink;
    ctx.lineWidth = 1.5;
    const r = P.HIT_R * cam.s;
    ctx.beginPath();
    ctx.moveTo(3.5 * r, 0);
    ctx.lineTo(-3.5 * r, -1.1 * r);
    ctx.lineTo(-2.6 * r, 0);
    ctx.lineTo(-3.5 * r, 1.1 * r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  return cam;
}

// THE-309: the title screen's own backdrop - sky + parallax + lawn, no course/flight/obstacles/air. Drawn
// every frame while G.screen === "title" so the canvas never keeps whatever the demo or last flight left on it.
export function drawTitleBackdrop(ctx, viewW, viewH) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cam = camera({ f: { x: 0 } }, viewW, viewH, dpr);
  const T = ensureTokens();
  drawSky(ctx, cam, T);
  const tile = ensureParallaxTile(T, cam);
  drawParallax(ctx, cam, tile, 0);
  drawCloudBank(ctx, cam, T);
  drawGround(ctx, cam, T);
  return cam;
}

export function obstacleY(o, t) {
  return coreObstacleY(o, t);
}

// The porthole face canvas (HUD): pre-rendered per reaction, drawn once whenever the reaction changes.
const faceCache = new Map();
export async function facePNG(expr, size = 134) {
  const key = `${expr}:${size}`;
  if (!faceCache.has(key)) faceCache.set(key, rasterSVG(buildFaceSvg({ expr, size }), size, size));
  return faceCache.get(key);
}
