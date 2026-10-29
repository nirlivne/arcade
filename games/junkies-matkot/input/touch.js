// Pure touch reducer (G9). A pointer belongs to the half where it landed until it lifts; crossing the
// midline changes nothing. Per half, a stack of pointer ids: the newest (top of stack) drives; a lift
// or pointercancel pops it and the next-newest re-anchors with no jump (relative drag keeps every id's
// own last-seen y up to date even while it isn't driving). A third finger joins the stack of the half
// it landed in and takes over that half (Delta5); it never reaches the other half. `reset()` is called
// on every game state change: ids already down are marked stale until they lift and land again.
import { C } from "../sim/constants.js";

export function createTouchState(initialY = [C.COURT_H / 2, C.COURT_H / 2]) {
  return {
    targetY: [initialY[0], initialY[1]],
    stacks: [[], []], // per half: [{id, lastY}], newest last
    ownerHalf: new Map(), // id -> 0 | 1
    stale: new Set(),
  };
}

function clamp(v) { return Math.max(C.PADDLE_Y_MIN, Math.min(C.PADDLE_Y_MAX, v)); }

export function reduce(state, event, ctx = {}) {
  const { type, id, x, y } = event;

  if (type === "reset") {
    const stale = new Set(state.stale);
    for (const stack of state.stacks) for (const p of stack) stale.add(p.id);
    return { ...state, stacks: [[], []], ownerHalf: new Map(), stale };
  }

  if (type === "down") {
    if (state.stale.has(id)) return state;
    const half = ctx.solo ? (ctx.humanSide ?? 0) : x < ctx.midlineX ? 0 : 1;
    const stacks = state.stacks.map((s) => s.slice());
    stacks[half].push({ id, lastY: y });
    const ownerHalf = new Map(state.ownerHalf);
    ownerHalf.set(id, half);
    return { ...state, stacks, ownerHalf };
  }

  if (type === "move") {
    if (state.stale.has(id)) return state;
    const half = state.ownerHalf.get(id);
    if (half === undefined) return state;
    const stacks = state.stacks.map((s) => s.slice());
    const stack = stacks[half];
    const idx = stack.findIndex((p) => p.id === id);
    if (idx < 0) return state;
    const isActive = idx === stack.length - 1;
    const dy = y - stack[idx].lastY;
    stack[idx] = { id, lastY: y };
    if (!isActive) return { ...state, stacks };
    const gain = (ctx.viewportH || 0) <= C.SHORT_VIEWPORT_H ? C.DRAG_GAIN_SHORT : C.DRAG_GAIN_NORMAL;
    const targetY = state.targetY.slice();
    targetY[half] = clamp(targetY[half] + dy * gain);
    return { ...state, stacks, targetY };
  }

  if (type === "up" || type === "cancel") {
    if (state.stale.has(id)) {
      const stale = new Set(state.stale);
      stale.delete(id);
      return { ...state, stale };
    }
    const half = state.ownerHalf.get(id);
    if (half === undefined) return state;
    const stacks = state.stacks.map((s) => s.slice());
    stacks[half] = stacks[half].filter((p) => p.id !== id);
    const ownerHalf = new Map(state.ownerHalf);
    ownerHalf.delete(id);
    return { ...state, stacks, ownerHalf };
  }

  return state;
}
