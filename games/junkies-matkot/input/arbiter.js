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
