// Circle physics for Cannonball Family (THE-449 S1). Copied from games/bloop-stack/physics.js (no library), with:
// an ES module (no window), static ledges (boxes), per-body mass and restitution overrides for the knacks, and
// no merges. Circles only; planks topple by rule in sim.js, never as rigid bodies. Pure: no DOM, no clock, no
// unseeded RNG. The caller steps it with a fixed dt (1/120 s).

export const GRAVITY = 900;
const MAX_V = 1400; // 1400 / 120 = 11.7 px per step, below the smallest tin radius (20), so no tunnelling
// SLEEP_T 0.1 s (bloop used 0.5 s): a tower woken at rest must settle and freeze within 1 px, and it can't creep
// for the half-second it takes to sleep. MU caps pair friction; SURFACE_DAMP removes that share of the tangential
// speed on each static contact. Both were tuned on a woken 12-tin pyramid (see tools/cannonball-family-tests).
const SLEEP_V = 20, SLEEP_T = 0.1, ITER = 8, WAKE_V = 40, BOUNCE_V = 250;
const MU = 0.6, SURFACE_DAMP = 0.06;

export class World {
  // bounds: { l, r, floor } in world units (y down). Ledges: { x0, x1, top, h }, a static box.
  constructor(bounds) {
    this.b = bounds;
    this.bodies = [];
    this.ledges = [];
  }
  // A body: { x, y, r, vx?, vy?, sleep?, mass? (multiplier on r*r, knacks), e? (restitution, knacks) }.
  add(body) {
    body.vx = body.vx || 0;
    body.vy = body.vy || 0;
    body.sleep = !!body.sleep;
    body.sleepT = 0;
    body.m = body.r * body.r * (body.mass || 1);
    body.impact = 0;
    this.bodies.push(body);
    return body;
  }
  remove(body) {
    this.bodies = this.bodies.filter((b) => b !== body);
  }
  // A ledge with off: true has no collider (a plank that has swung down). It stays in the list, so nothing shifts.
  addLedge(ledge) {
    ledge.impact = 0;
    this.ledges.push(ledge);
    return ledge;
  }
  wakeAll() {
    for (const b of this.bodies) { b.sleep = false; b.sleepT = 0; }
  }
  step(dt) {
    const bs = this.bodies, b = this.b;
    for (const L of this.ledges) L.impact = 0;
    for (const a of bs) {
      a.impact = 0;
      if (a.sleep) continue;
      a.vy += GRAVITY * dt;
      const sp = Math.sqrt(a.vx * a.vx + a.vy * a.vy);
      if (sp > MAX_V) { a.vx *= MAX_V / sp; a.vy *= MAX_V / sp; }
      a.vx *= 0.9995; a.vy *= 0.9995;
      a.x += a.vx * dt; a.y += a.vy * dt;
    }
    for (let k = 0; k < ITER; k++) {
      for (const a of bs) {
        if (a.sleep) continue;
        if (a.x - a.r < b.l) { a.x = b.l + a.r; contact(a, 1, 0, 0.1); }
        if (a.x + a.r > b.r) { a.x = b.r - a.r; contact(a, -1, 0, 0.1); }
        if (a.y + a.r > b.floor) { a.y = b.floor - a.r; contact(a, 0, -1, 0.15); }
        for (const L of this.ledges) if (!L.off) ledgeContact(a, L);
      }
      for (let i = 0; i < bs.length; i++) {
        const a = bs[i];
        for (let j = i + 1; j < bs.length; j++) pairContact(a, bs[j]);
      }
    }
    for (const a of bs) {
      if (a.sleep) continue;
      if (a.vx * a.vx + a.vy * a.vy < SLEEP_V * SLEEP_V) {
        a.sleepT += dt;
        if (a.sleepT > SLEEP_T) { a.sleep = true; a.vx = a.vy = 0; }
      } else a.sleepT = 0;
    }
  }
}

// A moving body meets a static surface with unit normal (nx, ny): reflect the normal speed with restitution e and
// damp the tangential speed (the floor's 0.94 rule, applied per iteration).
function contact(a, nx, ny, e) {
  const vn = a.vx * nx + a.vy * ny;
  if (vn >= 0) return;
  a.impact = Math.max(a.impact, -vn);
  const bounce = a.e !== undefined ? a.e : (-vn > 200 ? e : 0);
  a.vx -= (1 + bounce) * vn * nx;
  a.vy -= (1 + bounce) * vn * ny;
  const tx = -ny, ty = nx;
  const vt = a.vx * tx + a.vy * ty;
  a.vx -= vt * SURFACE_DAMP * tx;
  a.vy -= vt * SURFACE_DAMP * ty;
}

function ledgeContact(a, L) {
  const cx = Math.min(Math.max(a.x, L.x0), L.x1);
  const cy = Math.min(Math.max(a.y, L.top), L.top + L.h);
  const dx = a.x - cx, dy = a.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= a.r * a.r) return;
  let nx = 0, ny = -1, d = 0; // a centre inside the box is pushed out through its top
  if (d2 > 1e-9) { d = Math.sqrt(d2); nx = dx / d; ny = dy / d; }
  const approach = -(a.vx * nx + a.vy * ny);
  if (approach > L.impact) L.impact = approach; // the strongest hit on this ledge this step (planks read it)
  a.x += nx * (a.r - d);
  a.y += ny * (a.r - d);
  contact(a, nx, ny, 0.15);
}

function pairContact(a, c) {
  if (a.sleep && c.sleep) return;
  const dx = c.x - a.x, dy = c.y - a.y, rr = a.r + c.r;
  if (dx > rr || dx < -rr || dy > rr || dy < -rr) return;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rr * rr) return;
  const d = Math.sqrt(d2);
  let nx = 0, ny = 1;
  if (d >= 1e-6) { nx = dx / d; ny = dy / d; }
  let ia = a.sleep ? 0 : 1 / a.m, ic = c.sleep ? 0 : 1 / c.m;
  // a sleeper wakes only when something moving hits it
  if (a.sleep && Math.hypot(c.vx, c.vy) > WAKE_V) { a.sleep = false; a.sleepT = 0; ia = 1 / a.m; }
  else if (c.sleep && Math.hypot(a.vx, a.vy) > WAKE_V) { c.sleep = false; c.sleepT = 0; ic = 1 / c.m; }
  const isum = ia + ic;
  if (isum === 0) return;
  const ov = rr - d, corr = Math.max(ov - 0.05, 0) * 0.5 / isum;
  a.x -= nx * corr * ia; a.y -= ny * corr * ia;
  c.x += nx * corr * ic; c.y += ny * corr * ic;
  const vn = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
  if (vn >= 0) return;
  const fast = -vn > BOUNCE_V;
  a.impact = Math.max(a.impact, -vn);
  c.impact = Math.max(c.impact, -vn);
  const e = a.e !== undefined || c.e !== undefined ? Math.max(a.e || 0, c.e || 0) : (fast ? 0.18 : 0);
  const jn = -(1 + e) * vn / isum;
  a.vx -= nx * jn * ia; a.vy -= ny * jn * ia;
  c.vx += nx * jn * ic; c.vy += ny * jn * ic;
  const tx = -ny, ty = nx;
  const vt = (c.vx - a.vx) * tx + (c.vy - a.vy) * ty;
  const jt = Math.max(-MU * jn, Math.min(MU * jn, -vt * 0.5 / isum));
  a.vx -= tx * jt * ia; a.vy -= ty * jt * ia;
  c.vx += tx * jt * ic; c.vy += ty * jt * ic;
}
