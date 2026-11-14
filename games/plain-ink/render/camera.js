// Fit 1080 u of world height into the canvas; follow the hero on x (design §7).
// S1 keeps this to a straight follow -- look-ahead/set-entry-wide holds are S2 polish.
export const WORLD_H = 1080;
export const GROUND_FRAC = 0.74; // leaves the bottom band for touch controls, per design's floor-band intent

export function makeCamera() {
  return { x: 0 };
}

export function followHero(cam, heroX) {
  cam.x = heroX;
}

// transform to hand to ctx.setTransform() so every world-space draw call (rects, agentSide, ...)
// works directly in world units for the rest of the frame.
// floorCapY (css px, optional): the highest the ground line may sit -- the top of the touch buttons minus
// a margin (spec §6 layout row, fix 10). The scale still fits 1080 u of height; only the ground line rises.
export function worldTransform(cam, canvasW, canvasH, floorCapY = Infinity) {
  const scale = canvasH / WORLD_H;
  return [scale, 0, 0, scale, canvasW / 2 - cam.x * scale, Math.min(canvasH * GROUND_FRAC, floorCapY)];
}
