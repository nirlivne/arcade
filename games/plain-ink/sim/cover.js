// Ink cover and the hidden rule (design §3, spec §2.1 "Ink cover"/"Hidden").
import { BODY_W, BODY_H } from './physics.js';

export const GRID_COLS = 7;
export const GRID_ROWS = 17;

function inRect(px, py, r) {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

// box: the hero's feet point { x, y }. world: { groundInk, shapes } where shapes are authored
// rects in draw order (back to front); only layer === 'back' shapes count toward cover.
export function cover(box, coatInk, world) {
  const left = box.x - BODY_W / 2, top = box.y - BODY_H;
  const backShapes = world.shapes.filter((s) => s.layer === 'back');
  let matched = 0;
  for (let r = 0; r < GRID_ROWS; r++) {
    const py = top + (BODY_H * (r + 0.5)) / GRID_ROWS;
    for (let c = 0; c < GRID_COLS; c++) {
      const px = left + (BODY_W * (c + 0.5)) / GRID_COLS;
      let ink = world.groundInk;
      for (let i = backShapes.length - 1; i >= 0; i--) {
        if (inRect(px, py, backShapes[i])) { ink = backShapes[i].ink; break; }
      }
      if (ink === coatInk) matched++;
    }
  }
  return matched / (GRID_COLS * GRID_ROWS);
}

export const HIDE_STILL_S = 0.2; // s the hero must stand still before a hide counts (spec §2.1)

export function hidden({ grounded, cover, stillTime, redSet = false, frontHideFull = false }) {
  if (redSet) return !!frontHideFull;
  return grounded && cover >= 0.8 && stillTime >= HIDE_STILL_S;
}

// Red-set hide rects (spec §2.1 "Hidden" exceptions): true only when the whole body box -- not
// just a sample point -- falls inside one authored front-layer hide rect. No still-time needed.
export function frontHideFull(box, hideRects) {
  const left = box.x - BODY_W / 2, right = box.x + BODY_W / 2;
  const top = box.y - BODY_H, bottom = box.y;
  return hideRects.some((r) => left >= r.x && right <= r.x + r.w && top >= r.y && bottom <= r.y + r.h);
}
