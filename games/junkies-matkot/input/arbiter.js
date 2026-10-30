// Per player, "last input wins" between keys and touch (spec §2). Whichever source most recently
// produced an event for a player keeps driving that player's target y until the other source produces
// one. Output = target y per player; the touch speed cap is applied in the sim, not here.
export function createArbiterState() {
  return { lastSource: [null, null] }; // "keys" | "touch" | null, per player
}

export function noteTouch(state, player) {
  const lastSource = state.lastSource.slice();
  lastSource[player] = "touch";
  return { lastSource };
}

export function noteKeys(state, player) {
  const lastSource = state.lastSource.slice();
  lastSource[player] = "keys";
  return { lastSource };
}

export function resolve(state, touchY, keysY) {
  return [0, 1].map((p) => (state.lastSource[p] === "keys" ? keysY[p] : touchY[p]));
}

// THE-1184 S3 (board note 1): the x axis uses the exact same per-player lastSource -- whichever device
// most recently drove a player drives both of their axes together, not an independently-tracked x
// source. Byte-identical arbitration logic to resolve(), just reading the x arrays.
export function resolveX(state, touchX, keysX) {
  return [0, 1].map((p) => (state.lastSource[p] === "keys" ? keysX[p] : touchX[p]));
}
