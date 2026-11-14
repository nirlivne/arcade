// The rework's hiding and seeing rules (spec-rework §1: H1-H6, S1-S4; board design §3). Pure functions
// only: sim/play.js calls them every tick, the window check and the bots call the same ones.
import { BODY_W, BODY_H, TICK_HZ } from './physics.js';

// ---- the 45 sample points (§1.1) ----
export const SAMPLE_COLS = 5;
export const SAMPLE_ROWS = 9;
export const SAMPLE_N = SAMPLE_COLS * SAMPLE_ROWS;
export const HIDE_MIN = 27; // H1/H5: 27 of 45 = 60 %

// cell centres of the hero's body box; feet at (x, feetY), y grows downward. Bottom row first.
export function samplePoints(x, feetY) {
  const pts = [];
  for (let r = 0; r < SAMPLE_ROWS; r++) {
    const y = feetY - (BODY_H * (r + 0.5)) / SAMPLE_ROWS;
    for (let c = 0; c < SAMPLE_COLS; c++) pts.push({ x: x - BODY_W / 2 + (BODY_W * (c + 0.5)) / SAMPLE_COLS, y });
  }
  return pts;
}

// half-open, so two touching backdrops (W1|W2) never both claim the seam
const inRect = (p, r) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;

export function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// What is behind one point, top of the stack down (§1.1): go-behind -> lamp patch (cream) -> backdrop -> ground.
// scene: { ground, goBehinds: [rect], patches: [poly], backdrops: [{ ...rect, ink }] } (backdrops back to front)
export function behindAt(p, scene) {
  if (scene.goBehinds.some((r) => inRect(p, r))) return 'covered';
  if (scene.patches.some((poly) => pointInPoly(p, poly))) return 'cream';
  for (let i = scene.backdrops.length - 1; i >= 0; i--) if (inRect(p, scene.backdrops[i])) return scene.backdrops[i].ink;
  return scene.ground;
}

// matched + covered points (H1). Only ink and cream can match a coat (H4).
export function coverCount(x, feetY, coat, scene) {
  let n = 0;
  for (const p of samplePoints(x, feetY)) {
    const b = behindAt(p, scene);
    if (b === 'covered' || b === coat) n++;
  }
  return n;
}

// H2: no timer, no ground check -- the count alone decides, every tick
export const isHidden = (count) => count >= HIDE_MIN;

// ---- lamp beams (§1.4) ----
// A triangle: apex at the bulb, edges at angle +-halfAngle (0 deg = straight down, + toward +x), length
// `throw`, clipped at the floor. The returned polygon is both the drawn patch and the counted one (H3).
export function beamPolygon({ bulb, angleDeg, halfAngleDeg, throw: len }, floorY = 0) {
  const at = (deg) => {
    const r = (deg * Math.PI) / 180;
    return { x: bulb.x + Math.sin(r) * len, y: bulb.y + Math.cos(r) * len };
  };
  return clipBelow([{ x: bulb.x, y: bulb.y }, at(angleDeg - halfAngleDeg), at(angleDeg + halfAngleDeg)], floorY);
}

// Sutherland-Hodgman against the half-plane y <= floorY (works for any simple polygon: a half-plane is convex)
export function clipBelow(poly, floorY) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const aIn = a.y <= floorY, bIn = b.y <= floorY;
    if (aIn) out.push(a);
    if (aIn !== bIn) {
      const t = (floorY - a.y) / (b.y - a.y);
      out.push({ x: a.x + (b.x - a.x) * t, y: floorY });
    }
  }
  return out;
}

// ---- seeing (§1.2) ----
// CTO ruling 2 / ruling 10 (board gate 1, THE-1650): option B. 'A' = a lamp senses with its lit beam only.
// 'B' = it also watches its dashed swing zone (lamp.zone, a polygon) while the hero is visible. A lamp that
// doesn't swing has no zone (zone = its beam), so an unlit blinking lamp still sees nothing. One switch: the
// board may flip it back to 'A' after gate 2.
export const LAMP_SENSE = 'B';

// lamp: { poly, lit, onScreen, zone? }; hero: { points, hidden }
export function lampSees(lamp, hero, mode = LAMP_SENSE) {
  if (hero.hidden || !lamp.onScreen) return false; // S3, S4
  const areas = [];
  if (lamp.lit && lamp.poly) areas.push(lamp.poly);
  if (mode === 'B' && lamp.zone) areas.push(lamp.zone);
  return areas.some((poly) => hero.points.some((p) => pointInPoly(p, poly))); // S1
}

// S1 for a walking guard: any point inside his clipped cone (hazards.conePolygon has line of sight built in:
// each ray stops at the first stand-on or wall) while the hero is visible and his eye is on screen (S3, S4).
export function guardSees(guard, hero) {
  if (hero.hidden || !guard.onScreen) return false;
  return hero.points.some((p) => pointInPoly(p, guard.cone));
}

// Ruling 11, the flashing room: while lit it sees the hero's centre anywhere in its rect unless a go-behind
// hides them (coats don't count in there). No cone, no line of sight. Dark, it sees nothing.
export function roomSees(room, centre, behindGoBehind) {
  if (!room.lit || !room.onScreen || behindGoBehind) return false;
  return inRect(centre, room.rect);
}

// S2, the board's no-farm meter (CTO ruling 8, spec-rework rev 310859ef): fills in 0.70 s while seen; unseen,
// it holds for 0.50 s, then drains at half the fill rate (full to empty in 1.40 s). A seen tick restarts the
// hold. Nothing else resets it (only a respawn, in play.js). fill = the "Longer grace" comfort (0.5 = half
// speed): it scales the fill only, never the hold or the drain.
export const WARN_FILL_S = 0.7;
export const WARN_HOLD_S = 0.5;
export const WARN_DRAIN_S = 1.4;
export function stepWarning({ w, unseenFor }, seen, dt, fill = 1) {
  if (seen) return { w: Math.min(1, w + (dt * fill) / WARN_FILL_S), unseenFor: 0 };
  const u = unseenFor + dt;
  if (u <= WARN_HOLD_S + 1e-9) return { w, unseenFor: u };
  return { w: Math.max(0, w - dt / WARN_DRAIN_S), unseenFor: u };
}

// S4: view = the camera's visible world rect { x0, x1, y0, y1 }
export const inView = (p, v) => p.x >= v.x0 && p.x <= v.x1 && p.y >= v.y0 && p.y <= v.y1;

// ---- the beat clock (CTO ruling 4): from sim ticks, never the AudioContext ----
export const BPM = 132;
export const BEAT_TICKS = (TICK_HZ * 60) / BPM; // 54.545...: beats don't land on whole ticks
export const beatAt = (tick) => tick / BEAT_TICKS;
