// Juice state for the post pass and the particle/shake layer (THE-523 S4+S5; spec v2 §G3, §G5, §G6, §G7).
// Pure: no DOM, no clock - the caller (game.js) advances it with an explicit dt, the same pattern as camera.js,
// and never touches the sim. (Slow-mo, the shine sweep and the bokeh backdrop layer were cut from this release
// to THE-543 at the 10-08 board check - see the plan's "cut order".)
const RING_LIFE = 0.7; // spec G3
const CA_DECAY = 2.5, FLASH_DECAY = 2.6; // per second, spec G3
const MAX_RINGS = 4;
const SHAKE_MAX = 10; // CSS px cap, spec G6
const SHAKE_DECAY = 30; // px/s, spec G6
const MAX_PARTICLES = 220; // performance cap (spec G8); confetti alone spawns 80 at once

export function initFx() {
  return { rings: [], ca: 0, flash: 0, shake: 0, particles: [], reducedMotion: false };
}

// Advances decay. reducedMotion (spec G7): no shake or CA, flash capped at 0.3, rings at half amplitude (not
// suppressed - the spec lists rings separately from "no shake/CA/slow-mo/parallax", so they still show, just
// dimmer). Particles are never suppressed by reduced motion - the spec's G7 list doesn't include them. The flag
// is stashed on fx so ringState() (read per-ring, at draw time) can apply the halving without the caller having
// to thread it through separately.
export function stepFx(fx, dt, reducedMotion) {
  fx.rings = fx.rings.filter((r) => { r.t += dt; return r.t < RING_LIFE; });
  fx.ca = Math.max(0, fx.ca - CA_DECAY * dt);
  fx.flash = Math.max(0, fx.flash - FLASH_DECAY * dt);
  fx.shake = Math.max(0, fx.shake - SHAKE_DECAY * dt);
  fx.particles = fx.particles.filter((p) => { stepParticle(p, dt); return p.life > 0; });
  fx.reducedMotion = reducedMotion;
  if (reducedMotion) {
    fx.ca = 0;
    fx.flash = Math.min(fx.flash, 0.3);
    fx.shake = 0;
  }
  return fx;
}

// x, y: world units (the caller converts to screen UV when building the GL uniform list, since fx.js doesn't
// know about the camera or the viewport - it only ever deals in amplitudes and timers).
export function triggerRing(fx, x, y, amp) {
  if (fx.rings.length >= MAX_RINGS) fx.rings.shift();
  fx.rings.push({ x, y, t: 0, amp });
}
export function triggerCA(fx, amp) {
  fx.ca = Math.max(fx.ca, amp);
}
export function triggerFlash(fx, amp) {
  fx.flash = Math.max(fx.flash, amp);
}
// Screen shake (spec G6): scales with the impact, capped at 10 CSS px, decays at 30/s. A second, weaker trigger
// while the first is still decaying doesn't stack - same "take the max" rule as CA/flash above.
export function triggerShake(fx, amp) {
  fx.shake = Math.min(SHAKE_MAX, Math.max(fx.shake, amp));
}
// A fresh random jitter for the current frame, scaled by the live shake amplitude. Impure (Math.random): called
// once per rendered frame by the caller, never by stepFx, so it never affects fx's own (otherwise deterministic)
// decay state.
export function shakeOffset(fx) {
  if (!fx.shake) return { dx: 0, dy: 0 };
  return { dx: (Math.random() * 2 - 1) * fx.shake, dy: (Math.random() * 2 - 1) * fx.shake };
}

// A ring's current radius (0 -> 0.35 of the screen height, ease-out cubic) and its live (decaying) amplitude.
// reducedMotion (spec G7) halves the amplitude rather than suppressing the ring entirely.
export function ringState(ring, reducedMotion) {
  const t = Math.min(1, ring.t / RING_LIFE);
  const eased = 1 - (1 - t) ** 3;
  const amp = ring.amp * (1 - t);
  return { r: eased * 0.35, amp: reducedMotion ? amp * 0.5 : amp };
}

// ---- Particles (spec G5) ----
// A single small table shared by every kind: world-space x/y, a velocity, optional gravity (g) and drag (per
// spec G5's confetti: velocity *= drag ** dt each step), an optional sway (a sideways wobble added to vx,
// spec's "sway" for confetti) and vrot (a spin rate, confetti's "fake flip" - no real 3D, just a squash via
// cos(rot) at draw time). size and color are draw-time-only; kind only picks the shape in drawParticles.
function rand(lo, hi) { return lo + Math.random() * (hi - lo); }

function mkParticle(kind, x, y, vx, vy, life, extra = {}) {
  return { kind, x, y, vx, vy, life, maxLife: life, rot: 0, swayT: 0, size: 4, color: "#F6E9C9", ...extra };
}

function stepParticle(p, dt) {
  if (p.g) p.vy += p.g * dt;
  if (p.drag) { const d = p.drag ** dt; p.vx *= d; p.vy *= d; }
  p.swayT += dt;
  const sway = p.sway ? Math.sin(p.swayT * (p.swayFreq || 5)) * p.sway : 0;
  p.x += (p.vx + sway) * dt;
  p.y += p.vy * dt;
  if (p.vrot) p.rot += p.vrot * dt;
  p.life -= dt;
}

function spawn(fx, list) {
  for (const p of list) {
    if (fx.particles.length >= MAX_PARTICLES) fx.particles.shift();
    fx.particles.push(p);
  }
}

// Muzzle smoke (a few soft puffs) and 24 sparks on fire, spec G5. angleRad: the shot's own launch angle (screen
// convention, negative = up), so the burst reads as coming out of the cannon's barrel.
export function triggerMuzzle(fx, x, y, angleRad) {
  const list = [];
  for (let i = 0; i < 5; i++) {
    const a = angleRad + rand(-0.35, 0.35), sp = rand(15, 50);
    list.push(mkParticle("smoke", x, y, Math.cos(a) * sp, Math.sin(a) * sp - 15, rand(0.4, 0.55), { g: -15, size: rand(8, 14), color: "#D9D2C4" }));
  }
  for (let i = 0; i < 24; i++) {
    const a = angleRad + rand(-0.5, 0.5), sp = rand(180, 450);
    list.push(mkParticle("spark", x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.18, 0.28), { g: 500, size: 2, color: "#FFD36B" }));
  }
  spawn(fx, list);
}
// 6-10 felt fluff pieces per tin down, or a drum burst (spec G5; drum reuses the same felt-fluff look as its
// own "torn skin" per render.js).
export function triggerFluff(fx, x, y, n = 8) {
  const list = [];
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), sp = rand(40, 140);
    list.push(mkParticle("fluff", x, y, Math.cos(a) * sp, Math.sin(a) * sp - 60, rand(0.5, 0.75), { g: 260, size: rand(4, 7), color: "#F2E6C8", vrot: rand(-6, 6) }));
  }
  spawn(fx, list);
}
// Splinters when a crate breaks (spec G5).
export function triggerSplinters(fx, x, y) {
  const list = [];
  for (let i = 0; i < 10; i++) {
    const a = rand(-Math.PI, 0), sp = rand(80, 220); // mostly upward/outward off a broken shelf
    list.push(mkParticle("splinter", x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.4, 0.6), { g: 500, size: rand(3, 6), color: "#8B5A2B", vrot: rand(-10, 10) }));
  }
  spawn(fx, list);
}
// Dust on landing (spec G5): the net's own sag point, every time a shot resolves.
export function triggerDust(fx, x, y) {
  const list = [];
  for (let i = 0; i < 8; i++) {
    const a = rand(-Math.PI, 0), sp = rand(25, 70);
    list.push(mkParticle("dust", x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.35, 0.5), { g: -10, size: rand(5, 9), color: "#CBB892" }));
  }
  spawn(fx, list);
}
// Sparks on a stone hit (spec G5) - a stone cracking (sim.cracked) or taking a hard impact.
export function triggerStoneSparks(fx, x, y) {
  const list = [];
  for (let i = 0; i < 10; i++) {
    const a = rand(0, Math.PI * 2), sp = rand(120, 320);
    list.push(mkParticle("spark", x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.15, 0.25), { g: 400, size: 2, color: "#FFF1C2" }));
  }
  spawn(fx, list);
}
// 80 pieces of confetti on a clear (spec G5), with the Say Cheese confetti physics: gravity 700, drag
// pow(0.3, dt), sway and a fake flip (no real 3D - a spin rate that drawParticles reads as a squash via
// cos(rot)). Spawns across [x0, x1] at y0, falling - called once the curtain call starts. colors: the caller's
// own palette (game.js passes CBF.FXP.confetti.cols, the spec's palette - fx.js stays DOM/import-free, so it
// takes colours as data rather than reaching into troupe.js itself); CONFETTI_COLORS is only the fallback.
const CONFETTI_COLORS = ["#E2574C", "#F2B33D", "#4C8C6B", "#3C6FA6", "#F6E9C9"];
export function triggerConfetti(fx, x0, x1, y0, colors = CONFETTI_COLORS) {
  const list = [];
  for (let i = 0; i < 80; i++) {
    const x = rand(x0, x1);
    list.push(mkParticle("confetti", x, y0, rand(-40, 40), rand(-30, 30), rand(1.6, 2.2), {
      g: 700, drag: 0.3, sway: rand(20, 50), swayFreq: rand(3, 6), vrot: rand(-8, 8),
      size: rand(5, 8), color: colors[i % colors.length],
    }));
  }
  spawn(fx, list);
}

// Draws every live particle onto ctx, which the caller has already set to CSS-px space (dpr transform, no
// world scale - render.js's draw() leaves it there). view: {scale, ox, oy} (render.js), for the world -> CSS-px
// conversion; duplicated inline rather than importing worldToScreen from render.js, which would create an
// import cycle (render.js already imports CAM_Y from camera.js, and game.js wires fx to render the same way it
// wires camera, keeping fx.js itself free of any render.js/camera.js dependency). "lighter" composites every
// particle additively (spec G1(c): "a batched additive particle layer") onto the same scene canvas that gl.js
// then uploads as its texture, so the GL and 2D-fallback paths render identically with one draw path, not two.
export function drawParticles(ctx, fx, view) {
  if (!fx.particles.length) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const p of fx.particles) {
    const sx = view.ox + p.x * view.scale, sy = view.oy + p.y * view.scale;
    const alpha = Math.max(0, Math.min(1, p.life / p.maxLife));
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    const s = p.size * view.scale;
    if (p.kind === "confetti" || p.kind === "splinter") {
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(p.rot);
      ctx.scale(1, Math.max(0.15, Math.abs(Math.cos(p.rot)))); // the "fake flip" (spec G6): a squash, no real 3D
      ctx.fillRect(-s / 2, -s / 2, s, s);
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(0.5, s / 2), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}
