// THE-1375: pure layout helper for the secret `0`-key map overlay (ui/map.js). (s, lane, junctions) -> a
// 2D point on the trail unrolled flat, no canvas/DOM here so it's unit-testable on its own. Bends the
// heading +-90 deg at every junction's own `s` by its pre-rolled `dir` -- independent of `resolved`, same
// as render/look.js's trailPointsFromJunctions() builds the real 3D ribbon: the trail's shape is fixed at
// generation time, the sim only decides whether the capy actually follows it.
import { LANE_SPACING } from "../sim/track.js";

function rotate(v, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

// One breakpoint per junction (plus s=0), each the position/heading the strip has *after* that junction's
// own turn. Built once per draw and reused for every point looked up that frame (pointAt below), rather
// than re-walking the whole junction list per entity.
export function trailBreakpoints(junctions) {
  const sorted = [...junctions].sort((a, b) => a.s - b.s);
  let pos = { x: 0, y: 0 }, dir = { x: 0, y: 1 }, cur = 0;
  const points = [{ s: 0, pos, dir }];
  for (const j of sorted) {
    const seg = j.s - cur;
    pos = { x: pos.x + dir.x * seg, y: pos.y + dir.y * seg };
    dir = rotate(dir, j.dir === "L" ? Math.PI / 2 : -Math.PI / 2); // turn left = rotate the forward vector +90 deg (CCW)
    cur = j.s;
    points.push({ s: cur, pos, dir, junction: j });
  }
  return points;
}

// `lane` may be a fractional "effective lane" (mid lane-step), same convention as sim/sim.js's capyX().
export function pointAt(breakpoints, s, lane = 0) {
  let bp = breakpoints[0];
  for (const b of breakpoints) { if (b.s <= s) bp = b; else break; }
  const seg = s - bp.s;
  const x = bp.pos.x + bp.dir.x * seg, y = bp.pos.y + bp.dir.y * seg;
  const side = { x: bp.dir.y, y: -bp.dir.x }; // perpendicular to dir, +lane = the side a positive lane sits on
  return { x: x + side.x * lane * LANE_SPACING, y: y + side.y * lane * LANE_SPACING };
}
