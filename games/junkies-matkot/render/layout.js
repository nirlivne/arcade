// Pure layout math (Delta7, full bleed, no letterbox needed at any landscape size the court doesn't
// already fill). Court height = min(0.80 H, (W - 2m) * 9/16), m = max(0.08 W, safe-area inset + 16 px).
// A 0.05 H rope band sits under the court; the sky/sea/tower backdrop fills everything above it.
// Matches design/junkies-matkot/recipe.js's courtLayout() exactly (same formula, different field
// names); the extra horizon/sun/guide fields are for the beach backdrop and the pick-screen guides.
//
// THE-1184 S6 (DESIGN.md §13.1, board note 3 "goal lines nearer the screen edges"): x and y scale
// separately now. scaleY (the old single `scale`) still sizes everything -- heads, ball, shadows,
// crowd, distractions, towel bands, type -- so sprites keep their shape. scaleX only places things in
// x, stretching the spacing (not the sprites) so the goal line can sit much closer to the screen edge
// without squeezing the big head's disc off the paddle at the back of its zone.
import { C } from "../sim/constants.js";

export function computeLayout(viewportW, viewportH, safeInset = 0) {
  const m = Math.max(0.08 * viewportW, safeInset + 16);
  const courtH = Math.min(0.8 * viewportH, ((viewportW - 2 * m) * 9) / 16);
  const ropeH = 0.05 * viewportH;
  const backdropH = viewportH - courtH - ropeH;
  const courtY = backdropH;
  const scaleY = courtH / C.COURT_H; // world units -> screen px for sizes and y-positions

  // R: the big-head disc radius in px (BIG_HEAD_SCALE x half the disc's court diameter), used only to
  // keep its back rim >= 6px on screen when the paddle sits at the back of its zone.
  const R = 1.15 * 110 * scaleY;
  let inset = Math.max(safeInset + 12, Math.ceil((6 + 2 * R - 0.06 * viewportW) / 0.88));
  let scaleX = Math.min((viewportW - 2 * inset) / C.COURT_W, 1.45 * scaleY); // cap the stretch
  if (scaleX === 1.45 * scaleY) inset = (viewportW - C.COURT_W * scaleX) / 2; // capped: re-centre
  const courtW = C.COURT_W * scaleX;
  const courtX = inset;

  const horizon = courtY * 0.58;
  return {
    courtX, courtY, courtW, courtH, backdropH, ropeH, R, // R: the big-head disc radius in px (§13.1)
    scale: scaleY, scaleX, scaleY, // `scale` is kept as the legacy alias for scaleY (sizes, y-positions)
    W: viewportW, H: viewportH, cw: courtW, ch: courtH,
    l: courtX, r: courtX + courtW, t: courtY, b: courtY + courtH,
    horizon, sunX: viewportW / 2, sunR: horizon * 0.8,
    // DESIGN.md §13.1: the first-match guides centre in each zone, world (230, 450) / (1370, 450).
    guideLeftX: courtX + 230 * scaleX,
    guideRightX: courtX + 1370 * scaleX,
    guideX: (courtX - 0.1044 * courtH) / 2, // legacy margin-based value, kept for any caller not yet converted
  };
}
