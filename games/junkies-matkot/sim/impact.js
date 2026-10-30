// THE-1184 S2 (board note 2): pure impact physics. Opt-in via match.impactEnabled -- sim.js's resolveHit
// falls back to the legacy formula untouched when it's off, so every pre-r3 gate/test (seed-exact
// speeds/angles) stays byte-identical. No clock, no Math.random: paddle velocity is the sim's own
// per-tick position delta (paddle.vx/vy from movePaddles), so replays and this module's own output are
// deterministic -- same inputs always produce the same outgoing (vx, vy, speed).
import { C } from "./constants.js";

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// rampBase: today's pre-impact ramp speed (FIRST_TOUCH_SPEED, or prior*RAMP_MULT capped at SPEED_CAP).
// offsetRatio: contact offset / halfLen, in [-1, 1] (same as the legacy formula). dir: +1 for the left
// paddle, -1 for the right. (nx, ny): the contact normal (paddleContact's own), i.e. the direction the
// ball bounces away in. (paddleVx, paddleVy): the paddle's per-tick velocity.
export function computeImpact({ rampBase, offsetRatio, dir, nx, ny, paddleVx, paddleVy }) {
  // u_n: paddle velocity along the outgoing normal. nx's sign already encodes "toward the opponent"
  // (paddleContact only registers a hit while facing the ball), so this is positive exactly when the
  // paddle is swinging into the ball and negative while retreating -- no extra side-indexed sign needed.
  const uN = paddleVx * nx + paddleVy * ny;
  const speed = clamp(rampBase + C.IMPACT.SWING_GAIN * uN, C.IMPACT.SPEED_MIN, C.IMPACT.SPEED_MAX);

  // Tangential (sideways) paddle velocity: the component perpendicular to the outgoing normal -- the
  // role the legacy SPIN_FACTOR*paddle.vy term played back when the normal was always the fixed x axis
  // (nx=1, ny=0 reduces this to exactly paddleVy, so the left paddle's legacy feel carries over).
  const tangentialV = paddleVy * nx - paddleVx * ny;

  const maxRad = (C.CONTACT_ANGLE_MAX_DEG * Math.PI) / 180;
  const baseAngle = C.CONTACT_ANGLE_MAX_DEG * offsetRatio * (Math.PI / 180);
  let vx = speed * Math.cos(baseAngle) * dir;
  let vy = speed * Math.sin(baseAngle) + C.IMPACT.SPIN_FACTOR * tangentialV;
  const mag = Math.hypot(vx, vy) || speed;
  vx = (vx / mag) * speed;
  vy = (vy / mag) * speed;

  const finalAngle = clamp(Math.atan2(vy, Math.abs(vx)), -maxRad, maxRad);
  vx = speed * Math.cos(finalAngle) * dir;
  vy = speed * Math.sin(finalAngle);

  // A fast forward swing (vx, the swing axis) or a fast sideways flick (vy) both read as a smash, same
  // as the legacy single-axis check generalised to 2D paddle motion.
  const smash = speed >= C.SMASH_BALL_SPEED ||
    Math.abs(paddleVx) >= C.SMASH_FLICK_PADDLE_SPEED ||
    Math.abs(paddleVy) >= C.SMASH_FLICK_PADDLE_SPEED;

  return { vx, vy, speed, smash };
}
