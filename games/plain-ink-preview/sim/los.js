// Line of sight: a Watcher can't see through a solid, non-one-way rect (spec §2.1 "Watchers";
// S1 feel check D1 #1 -- W2 saw through the R-E wall because losBlocked was hardcoded false).

// Liang-Barsky segment-vs-AABB clip: the [t0, t1] parametric range (within [0,1]) where the
// segment p0->p1 is inside the rect's box, or null if it never enters.
function clipSegmentToRect(p0, p1, r) {
  let t0 = 0, t1 = 1;
  const dx = p1.x - p0.x, dy = p1.y - p0.y;
  const edges = [
    [-dx, p0.x - r.x],
    [dx, r.x + r.w - p0.x],
    [-dy, p0.y - r.y],
    [dy, r.y + r.h - p0.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) { if (q < 0) return null; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return null; if (t > t0) t0 = t; }
    else { if (t < t0) return null; if (t < t1) t1 = t; }
  }
  return t0 <= t1 ? [t0, t1] : null;
}

// a watcher patrolling through a tall letter is a flat sprite over a background shape, not
// standing behind a wall from its own point of view -- a rect its eye is currently inside (e.g.
// W1 the Doorman crossing the R-E wall's x-span mid-patrol) must not block its own sight past it,
// or the only non-blocked moment is a sliver too narrow to ever reach SPOTTED_S of exposure.
function eyeInsideRect(eye, r) {
  return eye.x >= r.x && eye.x <= r.x + r.w && eye.y >= r.y && eye.y <= r.y + r.h;
}

export function segmentBlocked(eye, point, rects) {
  for (const r of rects) {
    if (!r.solid || r.oneWay || eyeInsideRect(eye, r)) continue;
    if (clipSegmentToRect(eye, point, r)) return true;
  }
  return false;
}

// D1 fix (a): "clip the drawn wedge at the same rects, so what you see matches what it sees."
// Distance from eye along angle, in rects, before the first solid && !oneWay rect, else maxLen.
export function raycastLength(eye, angle, maxLen, rects) {
  const far = { x: eye.x + Math.cos(angle) * maxLen, y: eye.y + Math.sin(angle) * maxLen };
  let best = maxLen;
  for (const r of rects) {
    if (!r.solid || r.oneWay || eyeInsideRect(eye, r)) continue;
    const hit = clipSegmentToRect(eye, far, r);
    if (hit) best = Math.min(best, hit[0] * maxLen);
  }
  return best;
}
