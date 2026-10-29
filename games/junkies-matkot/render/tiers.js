// Pure tier-drop decision logic (G10/G11). High (full post chain, DPR <= 2) / Mid (bloom at 1/4 res,
// no ripple, DPR <= 1.5) / Low (no post chain, DPR 1). A sustained p95 > 20ms over a rolling 2s window
// of frame samples drops exactly one tier; it never steps back up mid-match. `notifyStateChange` opens
// a 1s grace window (a match-state transition, e.g. a serve or a point, shouldn't cost a tier on one
// GC pause). No DOM, no clock reads beyond the `now` the caller passes in -- node-tested.
const ORDER = ["high", "mid", "low"];
const WINDOW_MS = 2000;
const P95_DROP_THRESHOLD_MS = 20;
const GRACE_MS = 1000;

export function create(tier = "high") {
  return { tier, samples: [], graceUntil: -Infinity };
}

export function notifyStateChange(ctrl, now) {
  return { ...ctrl, graceUntil: now + GRACE_MS };
}

function p95(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(0.95 * sorted.length) - 1));
  return sorted[idx];
}

export function recordFrame(ctrl, frameMs, now) {
  if (now < ctrl.graceUntil) return ctrl; // a recent state change: this frame doesn't count either way

  const samples = ctrl.samples.filter((s) => now - s.t <= WINDOW_MS);
  samples.push({ t: now, ms: frameMs });

  if (ctrl.tier !== "low") {
    const windowSpan = now - samples[0].t;
    if (windowSpan >= WINDOW_MS && p95(samples.map((s) => s.ms)) > P95_DROP_THRESHOLD_MS) {
      const nextTier = ORDER[ORDER.indexOf(ctrl.tier) + 1];
      return { tier: nextTier, samples: [], graceUntil: now + GRACE_MS };
    }
  }
  return { ...ctrl, samples };
}
