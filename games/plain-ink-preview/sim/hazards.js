// The rework's timing hazards (THE-1651; spec-rework §3 parts 3-4, §4, rulings 10-12): the sweeping and
// blinking lamps' cycles and swing zones, the walking guard (walk / stop / look / turn, his line-of-sight
// cone) and the flashing room. Pure functions of the float sim beat (CTO ruling 4), so play.js, the
// window check and the renderer all read the same numbers. Every cycle is a whole number of bars.
import { clipBelow } from './rules.js';

const D2R = Math.PI / 180;
const mod = (a, n) => ((a % n) + n) % n;

// ---- lamps ----
// A piecewise angle schedule, [[beats, fromDeg, toDeg], ...], linear inside each part, repeating.
export function swing(parts) {
  const cycleBeats = parts.reduce((s, p) => s + p[0], 0);
  const angleAt = (beat) => {
    let b = mod(beat, cycleBeats);
    for (const [n, a, z] of parts) {
      if (b < n) return a + ((z - a) * b) / n;
      b -= n;
    }
    return parts[parts.length - 1][2];
  };
  const all = parts.flatMap((p) => [p[1], p[2]]);
  return { cycleBeats, angleAt, minDeg: Math.min(...all), maxDeg: Math.max(...all) };
}

// The swing zone (ruling 10): the union of every beam position in the cycle. For a beam of half-angle h and
// length L swinging over [min, max], that union is exactly the sector [min - h, max + h] of radius L,
// clipped at the floor. A lamp that doesn't swing has no zone (its zone is its beam).
export function zonePolygon({ bulb, halfAngleDeg, throw: len, minDeg, maxDeg }, floorY = 0) {
  if (!(maxDeg > minDeg)) return null;
  const pts = [{ x: bulb.x, y: bulb.y }];
  const a0 = minDeg - halfAngleDeg, a1 = maxDeg + halfAngleDeg;
  const n = Math.ceil(a1 - a0); // 1 deg steps
  for (let i = 0; i <= n; i++) {
    const r = (a0 + ((a1 - a0) * i) / n) * D2R;
    pts.push({ x: bulb.x + Math.sin(r) * len, y: bulb.y + Math.cos(r) * len });
  }
  return clipBelow(pts, floorY);
}

// a lamp def with its cycle and zone attached. litBeats: [from, to) inside the cycle where it is on
// (default: always); glowBeats: the tell before it comes on.
export function makeLamp({ parts = [[4, 0, 0]], litBeats = null, glowBeats = null, ...def }) {
  const s = swing(parts);
  const inRange = (r, beat) => { const b = mod(beat, s.cycleBeats); return b >= r[0] && b < r[1]; };
  const lamp = {
    ...def,
    cycleBeats: s.cycleBeats,
    minDeg: s.minDeg,
    maxDeg: s.maxDeg,
    angleAt: s.angleAt,
    litAt: litBeats ? (beat) => inRange(litBeats, beat) : () => true,
    glowAt: glowBeats ? (beat) => inRange(glowBeats, beat) : () => false,
  };
  lamp.zone = zonePolygon(lamp);
  return lamp;
}

// ---- the walking guard (§4) ----
export const GUARD = { eyeH: 175, halfAngleDeg: 20, len: 520, walk: 8, stop: 1, look: 2, turn: 1, foldK: 0.3 };
export const GUARD_CYCLE = 2 * (GUARD.walk + GUARD.stop + GUARD.look + GUARD.turn); // 24 beats, 6 bars

// Where he is at a beat: at beat 0 he is at xMin, starting to walk right. phase: walk | stop | look | turn.
// frame: the walk drawing 0..7 (one per 1/4 beat), the look beat 0..1, or the turn drawing 0..2.
// coneK: the cone length factor (the turn folds it to 30 %, switches side on drawing 2, unfolds on 3).
export function guardAt(gd, beat) {
  const half = GUARD_CYCLE / 2;
  const b = mod(beat - (gd.phaseBeats || 0), GUARD_CYCLE);
  const out = b >= half; // false: the right-going leg
  const t = b - (out ? half : 0);
  const dir0 = out ? -1 : 1;
  const x0 = out ? gd.xMax : gd.xMin, x1 = out ? gd.xMin : gd.xMax;
  const { walk, stop, look } = GUARD;
  if (t < walk) return { x: x0 + ((x1 - x0) * t) / walk, dir: dir0, phase: 'walk', frame: Math.floor(t * 4) % 8, coneK: 1 };
  if (t < walk + stop) return { x: x1, dir: dir0, phase: 'stop', frame: 0, coneK: 1, sub: t - walk };
  if (t < walk + stop + look) return { x: x1, dir: dir0, phase: 'look', frame: Math.floor(t - walk - stop), coneK: 1, sub: t - walk - stop };
  const d = Math.min(2, Math.floor((t - walk - stop - look) * 3));
  return { x: x1, dir: d === 0 ? dir0 : -dir0, phase: 'turn', frame: d, coneK: d < 2 ? GUARD.foldK : 1 };
}

// distance along a ray to the first solid it enters (slab test), or len
function rayLen(o, dx, dy, len, solids) {
  let best = len;
  for (const r of solids) {
    if (o.x >= r.x && o.x <= r.x + r.w && o.y >= r.y && o.y <= r.y + r.h) continue; // the eye is inside: ignore
    let t0 = 0, t1 = best;
    for (const [p, d, lo, hi] of [[o.x, dx, r.x, r.x + r.w], [o.y, dy, r.y, r.y + r.h]]) {
      if (Math.abs(d) < 1e-12) { if (p < lo || p > hi) { t0 = Infinity; break; } continue; }
      let a = (lo - p) / d, b = (hi - p) / d;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t0 > t1) break;
    }
    if (t0 <= t1 && t0 < best) best = t0;
  }
  return best;
}

// The cone he sees with: apex at the eye, horizontal, +-halfAngle, cast as 1 deg rays, each stopped at the
// first stand-on or wall (S1 line of sight). The polygon is both drawn and counted (the drawn cone IS what
// he sees). Ray ends run from the upper edge to the lower edge.
export function conePolygon(eye, dir, coneK, solids) {
  const pts = [{ x: eye.x, y: eye.y }];
  const len = GUARD.len * coneK;
  for (let a = -GUARD.halfAngleDeg; a <= GUARD.halfAngleDeg; a += 1) {
    const r = a * D2R, dx = dir * Math.cos(r), dy = Math.sin(r);
    const L = rayLen(eye, dx, dy, len, solids);
    pts.push({ x: eye.x + dx * L, y: eye.y + dy * L });
  }
  return pts;
}

export function guardNow(gd, beat, solids, floorY = 0) {
  const p = guardAt(gd, beat);
  const eye = { x: p.x, y: floorY - GUARD.eyeH };
  return { id: gd.id, ...p, eye, cone: conePolygon(eye, p.dir, p.coneK, solids) };
}

// ---- the flashing room (ruling 11) ----
// cycleBeats 12: beats [0, darkBeats) dark, the last dark beat is the warning, the rest lit.
export function roomNow(fr, beat) {
  const b = mod(beat - (fr.phaseBeats || 0), fr.cycleBeats);
  return { id: fr.id, rect: fr.rect, lit: b >= fr.darkBeats, warn: b >= fr.darkBeats - 1 && b < fr.darkBeats, beatIn: b };
}
