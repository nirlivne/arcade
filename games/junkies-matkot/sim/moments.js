// Meme moment scheduler (G13). Fed a wall-time arg by the caller, never reads the clock itself, so
// it's node-tested like the rest of sim/. Hard cap 5 per match including the win; starts >= 15s wall
// apart, except the win (always plays -- exempt from both the spacing rule and the hard cap, so a
// late-match win is never the thing that gets dropped). A trigger blocked by spacing or the cap is
// dropped, not queued. Same-point priority when several types trigger off one point: win > matchPoint
// > comeback > smash. Per-type caps: smash 3, comeback 1 per player, matchPoint 2, win 1.
const SPACING_MS = 15000;
const HARD_CAP = 5;
const PRIORITY = ["win", "matchPoint", "comeback", "smash"];
const TYPE_CAP = { smash: 3, comeback: 1, matchPoint: 2, win: 1 };

export function create() {
  return {
    total: 0,
    lastStartAt: -Infinity,
    typeCounts: { smash: 0, comeback: 0, matchPoint: 0, win: 0 },
    comebackUsed: [false, false],
    log: [],
  };
}

function eligible(sched, cand, nowMs) {
  // Comeback's cap is 1 per player, tracked independently per side -- not the shared typeCounts cap.
  if (cand.type === "comeback") { if (sched.comebackUsed[cand.side]) return false; }
  else if (sched.typeCounts[cand.type] >= TYPE_CAP[cand.type]) return false;
  if (cand.type === "win") return true; // always plays: no spacing check, no hard-cap check
  if (sched.total >= HARD_CAP) return false;
  if (nowMs - sched.lastStartAt < SPACING_MS) return false;
  return true;
}

// candidates: [{ type: "smash"|"comeback"|"matchPoint"|"win", side, ...detail }], every type that's
// live for this single point/serve. Returns { sched, fired: candidate|null }; `fired` is dropped, not
// queued, when nothing in `candidates` is eligible right now.
export function requestMoment(sched, candidates, nowMs) {
  const bySide = new Map(candidates.map((c) => [c.type, c]));
  for (const type of PRIORITY) {
    const cand = bySide.get(type);
    if (!cand || !eligible(sched, cand, nowMs)) continue;
    const fired = { ...cand, atMs: nowMs };
    return {
      sched: {
        total: sched.total + 1,
        lastStartAt: nowMs,
        typeCounts: { ...sched.typeCounts, [type]: sched.typeCounts[type] + 1 },
        comebackUsed: type === "comeback" ? sched.comebackUsed.map((v, i) => (i === cand.side ? true : v)) : sched.comebackUsed,
        log: [...sched.log, fired],
      },
      fired,
    };
  }
  return { sched, fired: null };
}
