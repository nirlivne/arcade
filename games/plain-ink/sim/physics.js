// Hero movement and jump: 120 Hz fixed step, AABB vs authored rects (design §1, spec §2.1).
// y grows downward (world convention); vy < 0 is rising, vy > 0 is falling.

export const TICK_HZ = 120;
export const DT = 1 / TICK_HZ;

export const BODY_W = 70;
export const BODY_H = 162;

export const RUN_MAX = 600;
export const ACCEL_TIME = 0.08;
export const DECEL_TIME = 0.06;
export const ACCEL = RUN_MAX / ACCEL_TIME;
export const DECEL = RUN_MAX / DECEL_TIME;

export const APEX_HEIGHT = 300;
export const APEX_TIME = 0.38;
export const APEX_HANG_V = 120;
export const JUMP_CUTOFF = 0.45;
export const FALL_CAP = 1800;

export const COYOTE_S = 0.1;
export const BUFFER_S = 0.12;
export const FLIP_DEBOUNCE_S = 0.1;

// Solve v0 (launch speed) for a jump whose gravity halves while |vy| < hangV,
// so it reaches `height` at `time` to apex. See THE-1550 hand-off for the derivation.
function solveJumpV0(height, time, hangV) {
  const d = height * height - time * time * hangV * hangV + 2 * height * time * hangV;
  return (height + Math.sqrt(d)) / time;
}
export const JUMP_V = solveJumpV0(APEX_HEIGHT, APEX_TIME, APEX_HANG_V);
export const GRAVITY = (JUMP_V + APEX_HANG_V) / APEX_TIME;
export const GRAVITY_HANG = GRAVITY / 2;

const moveToward = (v, target, maxDelta) => {
  if (v < target) return Math.min(v + maxDelta, target);
  if (v > target) return Math.max(v - maxDelta, target);
  return v;
};

export function newBody(x, y, grounded = false) {
  return {
    x, y, vx: 0, vy: 0, coat: 'ink',
    grounded, groundedAge: grounded ? 0 : Infinity, pressAge: Infinity,
    flipLockT: 0, jumpCutApplied: true,
  };
}

// rects: { x, y, w, h, solid, oneWay } in world units; y/h describe the rect's top edge and height.
export function tick(body, intent, rects, runMax = RUN_MAX) {
  const dt = DT;
  let { x, y, vx, vy, coat, grounded, groundedAge, pressAge, flipLockT, jumpCutApplied } = body;
  const wasGrounded = grounded;

  const dir = (intent.right ? 1 : 0) - (intent.left ? 1 : 0);
  const targetVx = dir * runMax;
  vx = moveToward(vx, targetVx, (dir !== 0 ? ACCEL : DECEL) * dt);

  flipLockT = Math.max(0, flipLockT - dt);
  if (intent.flipPressed && flipLockT <= 0) {
    coat = coat === 'ink' ? 'cream' : 'ink';
    flipLockT = FLIP_DEBOUNCE_S;
  }

  pressAge = intent.jumpPressed ? 0 : pressAge + dt;

  let didJump = false;
  const canCoyote = !grounded && groundedAge <= COYOTE_S;
  if (intent.jumpPressed && (grounded || canCoyote)) {
    vy = -JUMP_V;
    grounded = false;
    jumpCutApplied = false;
    didJump = true;
    pressAge = Infinity;
  }

  if (vy < 0 && !intent.jumpHeld && !jumpCutApplied) {
    vy *= JUMP_CUTOFF;
    jumpCutApplied = true;
  }
  const g = Math.abs(vy) < APEX_HANG_V ? GRAVITY_HANG : GRAVITY;
  vy += g * dt;
  if (vy > FALL_CAP) vy = FALL_CAP;

  let nx = x + vx * dt;
  const ny0 = y + vy * dt;

  // horizontal collision (solid rects only; one-way ledges never block sideways)
  for (const r of rects) {
    if (!r.solid || r.oneWay) continue;
    const top = y - BODY_H, bottom = y;
    if (!(bottom > r.y && top < r.y + r.h)) continue;
    const left = nx - BODY_W / 2, right = nx + BODY_W / 2;
    if (right > r.x && left < r.x + r.w) {
      nx = vx > 0 ? r.x - BODY_W / 2 : vx < 0 ? r.x + r.w + BODY_W / 2 : nx;
      vx = 0;
    }
  }

  // vertical collision
  let ny = ny0;
  let nowGrounded = false;
  for (const r of rects) {
    if (!r.solid) continue;
    const left = nx - BODY_W / 2, right = nx + BODY_W / 2;
    if (!(right > r.x && left < r.x + r.w)) continue;
    if (r.oneWay) {
      if (vy >= 0 && y <= r.y && ny0 >= r.y) { ny = r.y; vy = 0; nowGrounded = true; }
    } else {
      if (vy >= 0 && y <= r.y && ny0 >= r.y) { ny = r.y; vy = 0; nowGrounded = true; }
      else if (vy < 0 && y >= r.y + r.h && ny0 <= r.y + r.h) { ny = r.y + r.h; vy = 0; }
    }
  }

  // jump buffer: a press shortly before landing fires right on touchdown
  if (!wasGrounded && nowGrounded && !didJump && pressAge <= BUFFER_S) {
    vy = -JUMP_V;
    nowGrounded = false;
    jumpCutApplied = false;
    pressAge = Infinity;
  }

  const newGroundedAge = nowGrounded ? 0 : groundedAge + dt;

  return { x: nx, y: ny, vx, vy, coat, grounded: nowGrounded, groundedAge: newGroundedAge, pressAge, flipLockT, jumpCutApplied };
}
