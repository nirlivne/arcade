// Pure keys reducer (G8). event.code only (layout-independent). KeyW/KeyS drive the left paddle,
// ArrowUp/ArrowDown the right one; both pairs work at once. Holding both of one player's keys: the
// last one pressed wins; releasing it hands back to the other held key, if any. 0 -> full speed
// (1300 u/s) over 80 ms of being held, timed in step()'s dt rather than a wall clock.
import { C } from "../sim/constants.js";

const LEFT_KEYS = { KeyW: "up", KeyS: "down" };
const RIGHT_KEYS = { ArrowUp: "up", ArrowDown: "down" };

// THE-1184 S3 (board note 1, designer's proposed map pending the real design delta): the x axis gains
// its own pair per player, same "last pressed wins" mechanics as y, tracked completely independently
// (a held y key never affects x's press order or vice versa). "fwd"/"back" are raw labels resolved to a
// +-1 court-x sign in step() -- forward means toward the net, which is +x for the left paddle and -x for
// the right one (mirrored zones), not a shared sign.
const LEFT_KEYS_X = { KeyA: "back", KeyD: "fwd" };
const RIGHT_KEYS_X = { ArrowLeft: "fwd", ArrowRight: "back" };

export function createKeysState(initialY = [C.COURT_H / 2, C.COURT_H / 2], initialX = C.PADDLE_CENTER_X) {
  return {
    y: [initialY[0], initialY[1]],
    activeDir: [null, null],
    heldMs: [0, 0],
    pressOrder: [[], []], // per player: held direction codes, most-recently-pressed last
    x: [initialX[0], initialX[1]],
    activeDirX: [null, null],
    heldMsX: [0, 0],
    pressOrderX: [[], []],
  };
}

function onAxisKey(state, map, code, isDown, activeKey, heldKey, orderKey) {
  let player, dir;
  if (code in map[0]) { player = 0; dir = map[0][code]; }
  else if (code in map[1]) { player = 1; dir = map[1][code]; }
  else return null;

  const pressOrder = state[orderKey].map((o) => o.slice());
  const order = pressOrder[player];
  const idx = order.indexOf(dir);
  if (isDown) {
    if (idx >= 0) order.splice(idx, 1);
    order.push(dir);
  } else if (idx >= 0) {
    order.splice(idx, 1);
  }

  const newActive = order.length ? order[order.length - 1] : null;
  const activeDir = state[activeKey].slice();
  const heldMs = state[heldKey].slice();
  if (newActive !== activeDir[player]) heldMs[player] = 0;
  activeDir[player] = newActive;
  return { ...state, [orderKey]: pressOrder, [activeKey]: activeDir, [heldKey]: heldMs };
}

export function onKey(state, code, isDown) {
  const y = onAxisKey(state, [LEFT_KEYS, RIGHT_KEYS], code, isDown, "activeDir", "heldMs", "pressOrder");
  if (y) return y;
  const x = onAxisKey(state, [LEFT_KEYS_X, RIGHT_KEYS_X], code, isDown, "activeDirX", "heldMsX", "pressOrderX");
  if (x) return x;
  return state;
}

export function step(state, dt) {
  const y = state.y.slice();
  const heldMs = state.heldMs.slice();
  for (const p of [0, 1]) {
    if (state.activeDir[p]) {
      heldMs[p] += dt * 1000;
      const speed = Math.min(C.KEYS_SPEED_CAP, (heldMs[p] / C.KEYS_RAMP_MS) * C.KEYS_SPEED_CAP);
      const dy = (state.activeDir[p] === "up" ? -1 : 1) * speed * dt;
      y[p] = Math.max(C.PADDLE_Y_MIN, Math.min(C.PADDLE_Y_MAX, y[p] + dy));
    } else {
      heldMs[p] = 0;
    }
  }

  const x = state.x.slice();
  const heldMsX = state.heldMsX.slice();
  for (const p of [0, 1]) {
    if (state.activeDirX[p]) {
      heldMsX[p] += dt * 1000;
      const speed = Math.min(C.KEYS_SPEED_CAP, (heldMsX[p] / C.KEYS_RAMP_MS) * C.KEYS_SPEED_CAP);
      const fwdSign = p === 0 ? 1 : -1; // forward (toward the net) is +x for the left paddle, -x for the right
      const dirSign = state.activeDirX[p] === "fwd" ? fwdSign : -fwdSign;
      const dx = dirSign * speed * dt;
      const [a, b] = C.PADDLE_X_ZONE[p];
      x[p] = Math.max(Math.min(a, b), Math.min(Math.max(a, b), x[p] + dx));
    } else {
      heldMsX[p] = 0;
    }
  }
  return { ...state, y, heldMs, x, heldMsX };
}
