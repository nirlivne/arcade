// Board note 5 (r1) / THE-1156 S2+S4 board note 1 (r2): the ball shadow must track its (cosmetic) bounce
// height, not sit at a fixed offset. shadowFor(heightNorm) -> how to draw the shadow (relative to the
// ball's own radius) and how far above it, and how much bigger, the ball sprite itself should be drawn.
// heightNorm (hN) is 0 at paddle height (r2: "the ball never touches the sand" -- it's matkot, the ball
// is airborne the whole flight), 1 at the top of the arc.
//
// Designer's numbers: DESIGN.md §12.1 (THE-1155 r2 delta), superseding §11.4's sand-level (hN 0) table.
const DX_OF_R = [0.25, 0.45], DY_OF_R = [1.9, 2.4];
const RX_OF_R = [1.05, 1.6], RY_OF_R = [0.65, 1.0];
const ALPHA = [0.38, 0.16];
const LIFT_OF_R = [1.2, 4.0];
const BALL_SCALE = [1, 1.12];
// GL has no blur: 3 stacked ellipses, sized x [1, 1+0.25hb, 1+0.5hb], alpha x [1-0.55hb, 0.3hb, 0.25hb] of
// the alpha above, fed hb = 0.2 + 0.8*hN (not hN) so the shadow is a little soft even right at a hit (§12.1).
const GL_LAYER_SIZE_MULT = [0, 0.25, 0.5];
const GL_LAYER_ALPHA = [[1, -0.55], [0, 0.3], [0, 0.25]];

export const CONTACT_HN = 0; // the ball's height at every matka hit and at the serve (r2: paddle height, not sand)

function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function lerp([a, b], t) { return a + (b - a) * t; }

export function shadowFor(heightNorm) {
  const h = clamp01(heightNorm);
  const hb = 0.2 + 0.8 * h;
  const alpha = lerp(ALPHA, h);
  return {
    dxOfR: lerp(DX_OF_R, h),
    dyOfR: lerp(DY_OF_R, h),
    rxOfR: lerp(RX_OF_R, h),
    ryOfR: lerp(RY_OF_R, h),
    alpha,
    liftOfR: lerp(LIFT_OF_R, h),
    ballScale: lerp(BALL_SCALE, h),
    layers: GL_LAYER_SIZE_MULT.map((sizeMult, i) => ({
      sizeMult: 1 + sizeMult * hb,
      alpha: alpha * (GL_LAYER_ALPHA[i][0] + GL_LAYER_ALPHA[i][1] * hb),
    })),
  };
}
