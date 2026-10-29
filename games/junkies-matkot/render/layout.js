// Pure layout math (Delta7, full bleed, no letterbox needed at any landscape size the court doesn't
// already fill). Court height = min(0.80 H, (W - 2m) * 9/16), m = max(0.08 W, safe-area inset + 16 px).
// A 0.05 H rope band sits under the court; the sky/sea/tower backdrop fills everything above it.
// Matches design/junkies-matkot/recipe.js's courtLayout() exactly (same formula, different field
// names); the extra horizon/sun/guide fields are for the beach backdrop and the pick-screen guides.
import { C } from "../sim/constants.js";

export function computeLayout(viewportW, viewportH, safeInset = 0) {
  const m = Math.max(0.08 * viewportW, safeInset + 16);
  const courtH = Math.min(0.8 * viewportH, ((viewportW - 2 * m) * 9) / 16);
  const courtW = (courtH * 16) / 9;
  const ropeH = 0.05 * viewportH;
  const backdropH = viewportH - courtH - ropeH;
  const courtX = (viewportW - courtW) / 2;
  const courtY = backdropH;
  const scale = courtH / C.COURT_H; // world units -> screen px, also used to size the heads
  const horizon = courtY * 0.58;
  return {
    courtX, courtY, courtW, courtH, backdropH, ropeH, scale,
    W: viewportW, H: viewportH, cw: courtW, ch: courtH,
    l: courtX, r: courtX + courtW, t: courtY, b: courtY + courtH,
    horizon, sunX: viewportW / 2, sunR: horizon * 0.8,
    guideX: (courtX - 0.1044 * courtH) / 2,
  };
}
