// Pure keys reducer (G8). event.code only (layout-independent). KeyW/KeyS drive the left paddle,
// ArrowUp/ArrowDown the right one; both pairs work at once. Holding both of one player's keys: the
// last one pressed wins; releasing it hands back to the other held key, if any. 0 -> full speed
// (1300 u/s) over 80 ms of being held, timed in step()'s dt rather than a wall clock.
import { C } from "../sim/constants.js";

const LEFT_KEYS = { KeyW: "up", KeyS: "down" };
const RIGHT_KEYS = { ArrowUp: "up", ArrowDown: "down" };

export function createKeysState(initialY = [C.COURT_H / 2, C.COURT_H / 2]) {
  return {
    y: [initialY[0], initialY[1]],
    activeDir: [null, null],
    heldMs: [0, 0],
    pressOrder: [[], []], // per player: held direction codes, most-recently-pressed last
  };
}

export function onKey(state, code, isDown) {
  let player, dir;
  if (code in LEFT_KEYS) { player = 0; dir = LEFT_KEYS[code]; }
  else if (code in RIGHT_KEYS) { player = 1; dir = RIGHT_KEYS[code]; }
  else return state;

  const pressOrder = state.pressOrder.map((o) => o.slice());
  const order = pressOrder[player];
  const idx = order.indexOf(dir);
  if (isDown) {
    if (idx >= 0) order.splice(idx, 1);
    order.push(dir);
  } else if (idx >= 0) {
    order.splice(idx, 1);
  }

  const newActive = order.length ? order[order.length - 1] : null;
  const activeDir = state.activeDir.slice();
  const heldMs = state.heldMs.slice();
  if (newActive !== activeDir[player]) heldMs[player] = 0;
  activeDir[player] = newActive;
  return { ...state, pressOrder, activeDir, heldMs };
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
  return { ...state, y, heldMs };
}
