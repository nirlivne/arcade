// The match: ball, two capsule paddles, fixed-step physics, swept paddle collision (sub-stepped so a
// 1900 u/s ball can't tunnel through a 72 u-thick paddle), serve aimed away from the receiver (Delta10),
// speed ramp, angle + spin, first to 7. No DOM, no clock, no Math.random: everything seeded.
//
// "Sides" never appear here: a paddle is index 0 (left) or 1 (right). Which head renders on which side,
// and the rematch's left/right swap, are game.js concerns -- the sim only knows paddle indices.
import { C } from "./constants.js";
import { createRng, range } from "./rng.js";
import * as Distractions from "./distractions.js";

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// opts.distractions (THE-1142 S5, default false): every pre-S5 caller omits it, so match creation draws
// the exact same rng sequence as before and the distraction step is skipped entirely -- every existing
// gate/test (G15/A5/G16, sim.test.mjs's seed-exact assertions) stays byte-identical. game.js turns it on
// for real solo/2P matches; the window.__pong.seed() test-hook intentionally leaves it off, so the rest
// of the Playwright suite keeps its distraction-free, fully predictable physics.
export function createMatch(seed, opts = {}) {
  const rng = createRng(seed >>> 0);
  const match = {
    seed, rng,
    distractionsEnabled: !!opts.distractions,
    state: "pointPause",
    stateTimer: 0,
    score: [0, 0],
    receiver: rng() < 0.5 ? 0 : 1, // first serve of the match: seeded random side
    ball: { x: C.COURT_W / 2, y: C.COURT_H / 2, vx: 0, vy: 0, speed: 0 },
    paddles: [0, 1].map(() => ({ y: C.COURT_H / 2, vy: 0, targetY: C.COURT_H / 2, len: C.CAPSULE_LEN, capsuleScale: 1 })),
    rally: 0,
    heat: 0,
    winner: null,
    lastHitSmash: false,
    lastHitSpeed: 0,
    events: [],
    timeScale: 1, // ball-motion time scale: match point (0.4x), final hit (0.3x), freeze (0)
    matchPointTicksLeft: 0, // G6/row8: 0.4x for 0.5s wall from the match-point serve launch
    matchPointUsed: [false, false], // fires once per side, the first serve after it first reaches 6
    finalHit: false, // true once a hit would win the match if unreturned (row8 final-hit slow-mo)
    freezeTicksLeft: 0, // the 200ms freeze between the deciding ball reaching the goal line and the point resolving
    pendingScorer: null,
    firstServeWait: null, // spec §5/D2-6: armed by game.js only for the very first match of a session
  };
  if (match.distractionsEnabled) Object.assign(match, Distractions.initialState(rng));
  enterPointPause(match);
  return match;
}

export function setInput(match, side, y) {
  match.paddles[side].targetY = clamp(y, C.PADDLE_Y_MIN, C.PADDLE_Y_MAX);
}

// Spec §5 / D2-6: the first serve of a session waits until each human paddle has moved >= 30 u from
// where it started, or 4 s pass, before the normal 0.8 s count begins. game.js calls this once, right
// after the first match of a session is created, before the first step().
export function armFirstServeWait(match) {
  match.firstServeWait = { active: true, startY: [match.paddles[0].y, match.paddles[1].y], elapsed: 0 };
}

export function step(match, dt = 1 / C.STEP_HZ) {
  if (match.state === "matchEnd") return match;
  movePaddles(match, dt);
  if (match.distractionsEnabled) Distractions.step(match, dt);
  if (match.state === "pointPause") {
    match.stateTimer -= dt;
    if (match.stateTimer <= 1e-9) enterServe(match);
  } else if (match.state === "serve") {
    if (match.firstServeWait && match.firstServeWait.active) {
      const w = match.firstServeWait;
      w.elapsed += dt;
      const moved = [0, 1].some((side) => Math.abs(match.paddles[side].y - w.startY[side]) >= 30);
      if (moved || w.elapsed >= 4) {
        w.active = false;
        match.stateTimer = C.SERVE_COUNT_S; // the normal count starts fresh once the wait clears
      }
    } else {
      match.stateTimer -= dt;
      if (match.stateTimer <= 1e-9) launchServe(match);
    }
  } else if (match.state === "rally") {
    advanceRally(match, dt);
  }
  return match;
}

function movePaddles(match, dt) {
  const maxDelta = C.TOUCH_SPEED_CAP * dt;
  for (const p of match.paddles) {
    const dy = clamp(p.targetY - p.y, -maxDelta, maxDelta);
    p.vy = dy / dt;
    p.y = clamp(p.y + dy, C.PADDLE_Y_MIN, C.PADDLE_Y_MAX);
  }
}

function enterPointPause(match) {
  match.state = "pointPause";
  match.stateTimer = C.POINT_PAUSE_S;
  match.ball.x = C.COURT_W / 2;
  match.ball.y = C.COURT_H / 2;
  match.ball.vx = 0;
  match.ball.vy = 0;
  match.ball.speed = 0;
  if (match.distractionsEnabled) Distractions.onPointEnd(match);
}

function enterServe(match) {
  match.state = "serve";
  match.stateTimer = C.SERVE_COUNT_S;
  updateBigHead(match);
}

// G6: re-checked at every serve. A side trailing by >= 3 gets the x1.15 capsule (hitbox + render);
// it reverts the first serve where its deficit is back down to <= 2. Never changes mid-rally.
function updateBigHead(match) {
  for (let side = 0; side < 2; side++) {
    const trailing = match.score[1 - side] - match.score[side];
    if (trailing >= C.BIG_HEAD_TRAIL_ON) match.paddles[side].capsuleScale = C.BIG_HEAD_SCALE;
    else if (trailing <= C.BIG_HEAD_TRAIL_OFF) match.paddles[side].capsuleScale = 1;
  }
}

function launchServe(match) {
  const { vx, vy } = computeServeVelocity(match);
  match.ball.vx = vx;
  match.ball.vy = vy;
  match.ball.speed = C.SERVE_SPEED;
  match.rally = 0;
  match.heat = 0;
  match.lastHitSmash = false;
  match.lastHitSpeed = 0;
  match.finalHit = false;
  match.state = "rally";

  // G6/row8: the first serve after a side first reaches match point (score 6) runs at 0.4x for 0.5s wall.
  for (let side = 0; side < 2; side++) {
    if (match.score[side] >= C.MATCH_POINT_AT && !match.matchPointUsed[side]) {
      match.matchPointUsed[side] = true;
      match.matchPointTicksLeft = Math.round(C.MATCH_POINT_DURATION_S * C.STEP_HZ);
      match.timeScale = C.MATCH_POINT_SCALE;
      match.events.push({ type: "matchPoint", side });
    }
  }
}

// Delta10: travels toward the receiver's side, aimed at whichever vertical half is farther from the
// receiver's paddle right now -- a paddle that never moves can't be in position to return it.
function computeServeVelocity(match) {
  const receiver = match.receiver;
  const dir = receiver === 0 ? -1 : 1;
  const angleDeg = range(match.rng, C.SERVE_ANGLE_MIN_DEG, C.SERVE_ANGLE_MAX_DEG);
  const angleRad = (angleDeg * Math.PI) / 180;
  const receiverPaddleY = match.paddles[receiver].y;
  const vSign = receiverPaddleY <= C.COURT_H / 2 ? 1 : -1;
  return {
    vx: C.SERVE_SPEED * Math.cos(angleRad) * dir,
    vy: C.SERVE_SPEED * Math.sin(angleRad) * vSign,
  };
}

function advanceRally(match, dt) {
  // Freeze: the deciding ball sits on the goal line for 200ms (wall ticks) before the point resolves,
  // so the win reads instead of flashing straight to the result. No ball/paddle motion scale here --
  // paddles keep tracking their targets via movePaddles(), already called once per step() above.
  if (match.freezeTicksLeft > 0) {
    match.timeScale = 0;
    match.freezeTicksLeft--;
    if (match.freezeTicksLeft === 0) handlePoint(match, match.pendingScorer);
    return;
  }

  // Tick down the match-point window; it owns timeScale until it runs out, unless a final hit (more
  // urgent) is in progress.
  if (match.matchPointTicksLeft > 0) {
    match.matchPointTicksLeft--;
    if (match.matchPointTicksLeft === 0 && !match.finalHit) match.timeScale = 1;
  }
  if (match.finalHit) match.timeScale = C.FINAL_HIT_SCALE;
  else if (match.matchPointTicksLeft > 0) match.timeScale = C.MATCH_POINT_SCALE;

  const ball = match.ball;
  const speed = Math.hypot(ball.vx, ball.vy);
  const scaledDt = dt * match.timeScale;
  const dist = speed * scaledDt;
  const n = Math.max(1, Math.ceil(dist / C.SUBSTEP_MAX_TRAVEL));
  const subDt = scaledDt / n;
  for (let i = 0; i < n; i++) {
    ball.x += ball.vx * subDt;
    ball.y += ball.vy * subDt;

    if (ball.y - C.BALL_R < 0) {
      ball.y = C.BALL_R + (C.BALL_R - ball.y);
      ball.vy = -ball.vy;
      match.events.push({ type: "wall", wall: "top" });
    } else if (ball.y + C.BALL_R > C.COURT_H) {
      ball.y = C.COURT_H - C.BALL_R - (ball.y + C.BALL_R - C.COURT_H);
      ball.vy = -ball.vy;
      match.events.push({ type: "wall", wall: "bottom" });
    }

    for (let side = 0; side < 2; side++) {
      const contact = paddleContact(ball, match.paddles[side], side);
      if (contact) resolveHit(match, ball, match.paddles[side], side, contact);
    }

    if (ball.x - C.BALL_R <= 0) return finishPoint(match, 1);
    if (ball.x + C.BALL_R >= C.COURT_W) return finishPoint(match, 0);
  }
}

// row8 final-hit freeze: when the deciding ball (flagged at the hit that would win the match)
// reaches the goal line, hold it there for 200ms wall before the point actually resolves.
function finishPoint(match, scorer) {
  if (match.finalHit) {
    match.timeScale = 0;
    match.freezeTicksLeft = Math.round(C.FINAL_HIT_FREEZE_S * C.STEP_HZ);
    match.pendingScorer = scorer;
    return;
  }
  handlePoint(match, scorer);
}

// Circle (the ball) vs capsule (the paddle: a vertical segment + radius). Front-facing only -- a ball
// already past the paddle's front face can't bounce off its back (no back-of-head saves) -- and only
// while actually approaching, so a ball already moving away doesn't re-trigger while still overlapping
// the spot it just bounced from.
function paddleContact(ball, paddle, side) {
  const cx = C.PADDLE_CENTER_X[side];
  const scale = paddle.capsuleScale || 1;
  const halfLen = (C.CAPSULE_LEN / 2) * scale;
  const capsuleR = (C.CAPSULE_THICK / 2) * scale;
  const closestY = clamp(ball.y, paddle.y - halfLen, paddle.y + halfLen);
  const dx = ball.x - cx;
  const dy = ball.y - closestY;
  const dist = Math.hypot(dx, dy);
  const minDist = capsuleR + C.BALL_R;
  if (dist > minDist) return null;
  const facingOk = side === 0 ? dx >= 0 : dx <= 0;
  if (!facingOk) return null;
  const nx = dist > 0 ? dx / dist : (side === 0 ? 1 : -1);
  const ny = dist > 0 ? dy / dist : 0;
  if (ball.vx * nx + ball.vy * ny >= 0) return null; // not approaching
  return { nx, ny, closestY, minDist, halfLen };
}

function resolveHit(match, ball, paddle, side, contact) {
  match.rally++;
  const newSpeed = match.rally === 1 ? C.FIRST_TOUCH_SPEED : Math.min(C.SPEED_CAP, ball.speed * C.RAMP_MULT);
  const offset = clamp(ball.y - paddle.y, -contact.halfLen, contact.halfLen);
  const offsetRatio = offset / contact.halfLen;
  const dir = side === 0 ? 1 : -1;
  const maxRad = (C.CONTACT_ANGLE_MAX_DEG * Math.PI) / 180;

  const baseAngle = C.CONTACT_ANGLE_MAX_DEG * offsetRatio * (Math.PI / 180);
  let vx = newSpeed * Math.cos(baseAngle) * dir;
  let vy = newSpeed * Math.sin(baseAngle) + C.SPIN_FACTOR * paddle.vy;
  const mag = Math.hypot(vx, vy) || newSpeed;
  vx = (vx / mag) * newSpeed;
  vy = (vy / mag) * newSpeed;

  let finalAngle = clamp(Math.atan2(vy, Math.abs(vx)), -maxRad, maxRad);
  vx = newSpeed * Math.cos(finalAngle) * dir;
  vy = newSpeed * Math.sin(finalAngle);

  ball.vx = vx;
  ball.vy = vy;
  ball.speed = newSpeed;
  ball.x = C.PADDLE_CENTER_X[side] + contact.nx * contact.minDist;
  ball.y = contact.closestY + contact.ny * contact.minDist;

  enforceWallClearance(ball);

  const smash = newSpeed >= C.SMASH_BALL_SPEED || Math.abs(paddle.vy) >= C.SMASH_FLICK_PADDLE_SPEED;
  match.lastHitSmash = smash;
  match.lastHitSpeed = newSpeed;
  const prevHeat = match.heat;
  match.heat = match.rally >= C.HEAT_FIRE ? 2 : match.rally >= C.HEAT_HOT ? 1 : 0;
  match.events.push({ type: "hit", side, speed: newSpeed, paddleVy: paddle.vy, offset });
  if (match.heat !== prevHeat) match.events.push({ type: "heat", level: match.heat });

  // row8 final hit: this hit wins the match if the other side doesn't return it. Re-evaluated on
  // every hit, so a save by the other side clears or moves the flag to their own next decisive hit.
  match.finalHit = match.score[side] + 1 >= C.WIN_SCORE;
  if (match.finalHit) match.timeScale = C.FINAL_HIT_SCALE;
  else if (match.matchPointTicksLeft === 0) match.timeScale = 1;
}

// Pinning: a ball that bounces off a paddle while touching a wall must leave at >= 15 deg off that
// wall, so it can never settle into a near-parallel path that keeps re-hitting the corner.
function enforceWallClearance(ball) {
  const minSin = Math.sin((15 * Math.PI) / 180);
  const speed = ball.speed;
  const nearTop = ball.y - C.BALL_R <= 0.5;
  const nearBottom = ball.y + C.BALL_R >= C.COURT_H - 0.5;
  if (nearTop && ball.vy < speed * minSin) {
    ball.vy = speed * minSin;
    ball.vx = Math.sign(ball.vx || 1) * Math.sqrt(Math.max(0, speed * speed - ball.vy * ball.vy));
  } else if (nearBottom && ball.vy > -speed * minSin) {
    ball.vy = -speed * minSin;
    ball.vx = Math.sign(ball.vx || 1) * Math.sqrt(Math.max(0, speed * speed - ball.vy * ball.vy));
  }
}

function handlePoint(match, scorer) {
  match.events.push({ type: "point", scorer, smash: match.lastHitSmash, speed: match.lastHitSpeed });
  match.score[scorer]++;
  if (match.score[scorer] >= C.WIN_SCORE) {
    match.state = "matchEnd";
    match.winner = scorer;
    match.events.push({ type: "win", winner: scorer });
  } else {
    match.receiver = scorer === 0 ? 1 : 0;
    enterPointPause(match);
  }
}
