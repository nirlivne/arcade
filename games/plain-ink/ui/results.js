// Results strip (spec §3.6: TIME · SNIPS, best time, fewest snips) and the return loop's two bests
// (spec §8, G1c: best time + fewest snips, each kept on its own; THE-1565 Q1/Q7). Pure.

export function formatTime(ms) {
  const tenths = Math.floor(ms / 100);
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  return `${m}:${String(s).padStart(2, '0')}.${tenths % 10}`;
}

// A finished run: update each best on its own, end the saved run. Returns a new save.
export function applyResult(save, { clockMs, snips }) {
  const prev = save.best;
  const newBestTime = !prev || clockMs < prev.timeMs;
  const newBestSnips = !prev || snips < prev.snips;
  const best = { timeMs: newBestTime ? clockMs : prev.timeMs, snips: newBestSnips ? snips : prev.snips };
  return { save: { ...save, best, run: null }, newBestTime, newBestSnips };
}
