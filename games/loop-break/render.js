// Loop Break render.js: wraps the designer's reference renderer (medallion.js, THE-231/DESIGN.md §6), a
// classic script loaded before this module that sets `window.LBMedallion`. This module owns nothing about
// the drawing recipe itself -- LBMedallion.create()/geometry() do that, token-driven -- only the mapping
// from level.js state to the renderer's per-frame state shape, and the medallion instance's lifecycle
// (rebuilt on level load, resize, DPR change or skin swap, per DESIGN.md's pre-render split).
import { moveVector } from "./core.js";
const LB = window.LBMedallion;

export function grabMask(level) {
  const grab = new Array(level.n).fill(true);
  for (const r of level.driveOnly) grab[r] = false;
  return grab;
}

// R = the .lb-stage's CSS width / 2 (DESIGN.md §5 addendum 3: the canvas is sized by CSS, not this code).
export function createMedallion(level, R, dpr) {
  return LB.create({ R, dpr, n: level.n, links: level.links, grab: grabMask(level) });
}

export function geometry(level, R) {
  return LB.geometry(R, level.n);
}

// `live`, when set, is `{ ring, frac }`: the gripped ring's not-yet-applied continuous offset in notches
// (or the settling remainder of the release ease -- same shape either way). Every ring the drag reaches
// gets its angle nudged by `frac * 45 * moveVector[i]` on top of its resting `pos[i] * 45` (cascade sign and
// magnitude straight from core.js's moveVector, the same function the rules core itself uses), so the
// gripped ring and its whole cascade track the live finger angle 1:1 -- the designer's feel-check's #1
// priority note. Chevrons (direction cue, DESIGN.md §6) light on every ring the same live drag reaches.
export function frameState(level, attempt, live) {
  const angles = attempt.pos.map((p) => p * 45);
  const chev = [];
  if (live && live.frac) {
    const v = moveVector(level, live.ring);
    for (let i = 0; i < level.n; i++) {
      if (v[i] === 0) continue;
      angles[i] += v[i] * live.frac * 45;
      chev.push({ ring: i, dir: v[i] > 0 ? 1 : -1 });
    }
  }
  return {
    angles,
    lit: attempt.pos.map((p) => (p === 0 ? 1 : 0)),
    used: attempt.used,
    budget: level.budget,
    selected: attempt.dragRing,
    chev,
  };
}

export function draw(medallion, ctx, cx, cy, state) {
  // Nothing else clears the canvas, so every frame composited over the last (lid ghosting, shadow
  // alpha stacking to black -- THE-236/THE-243). Reset the transform first: cx/cy are in CSS px
  // under the DPR scale medallion.draw() itself applies, but clearRect needs full device-px extents.
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
  medallion.draw(ctx, cx, cy, state);
}
