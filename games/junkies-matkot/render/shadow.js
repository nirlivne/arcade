// Board note 5: the ball shadow must track its (cosmetic) bounce height, not sit at a fixed offset.
// shadowFor(heightNorm) -> how to draw the shadow (relative to the ball's own radius) and how far above
// it, and how much bigger, the ball sprite itself should be drawn. heightNorm (hN) is 0 at sand level,
// 1 at the top of the bounce arc.
//
// Designer's numbers (DESIGN.md §11.4 / design/junkies-matkot/r1/recipe-r1.js BALL_HEIGHT), landed on
// the design branch (THE-1141) after this slice started with placeholders -- adopted here in S6.
const DX_OF_R = [0.15, 0.45], DY_OF_R = [0.35, 1.1];
const RX_OF_R = [0.95, 1.6], RY_OF_R = [0.6, 1.05];
const ALPHA = [0.45, 0.15];
const LIFT_OF_R = [0, 3.2];
const BALL_SCALE = [1, 1.12];
// GL has no blur: 3 stacked ellipses, sized x [1, 1+0.25hN, 1+0.5hN], alpha x [1-0.55hN, 0.3hN, 0.25hN]
// of the alpha above (one ellipse at full alpha on the sand, hN = 0).
const GL_LAYER_SIZE_MULT = [0, 0.25, 0.5];
const GL_LAYER_ALPHA = [[1, -0.55], [0, 0.3], [0, 0.25]];

export const CONTACT_HN = 0.18; // the ball's height at every matka hit and at the serve

function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function lerp([a, b], t) { return a + (b - a) * t; }

export function shadowFor(heightNorm) {
  const h = clamp01(heightNorm);
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
      sizeMult: 1 + sizeMult * h,
      alpha: alpha * (GL_LAYER_ALPHA[i][0] + GL_LAYER_ALPHA[i][1] * h),
    })),
  };
}
