// THE-1408 (spec Part 2 "Missions"). Pool/rules/events: design/capy-trail/missions.md. Pure, no Math.random.
import { mulberry32 } from "./rng.js";

// id,tier,target,mode(T=total/R=run),group[,extra]
const POOL_RAW = `
t1-jump-15,1,15,T,jump
t1-duck-10,1,10,T,duck
t1-lane-20,1,20,T,lane
t1-turn-5,1,5,T,turn
t1-coins-150,1,150,T,coin
t1-coinrun-60,1,60,R,coin
t1-reach-300,1,300,R,distance
t1-honey-1,1,1,T,pickup,honey
t2-jump-40,2,40,T,jump
t2-hop-15,2,15,T,clear,jump
t2-under-10,2,10,T,clear,duck
t2-close-3,2,3,R,nearMiss
t2-coinrun-120,2,120,R,coin
t2-reach-600,2,600,R,distance
t2-powerups-3,2,3,T,pickup
t2-shield-1,2,1,T,pickup,shield
t3-nohit-500,3,500,R,noHit
t3-reach-1000,3,1000,R,distance
t3-coinrun-250,3,250,R,coin
t3-turnrun-10,3,10,R,turn
t3-balloon-2,3,2,T,pickup,balloon
t3-spring-2,3,2,T,pickup,spring
t3-saved-1,3,1,T,shieldPop,hit
t3-escape-3,3,3,T,escape
t3-powerups-6,3,6,T,pickup
t4-nohit-1500,4,1500,R,noHit
t4-reach-2000,4,2000,R,distance
t4-coins-2000,4,2000,T,coin
t4-hoprun-12,4,12,R,clear,jump
t4-close-8,4,8,R,nearMiss
t4-under-25,4,25,T,clear,duck
t4-mystery-3,4,3,T,pickup,mystery
t4-sky-30,4,30,T,skyCoin
`.trim().split("\n");

export const MISSION_POOL = POOL_RAW.map((line) => {
  const [id, tier, target, mode, group, extra] = line.split(",");
  return { id, tier: +tier, target: +target, mode: mode === "R" ? "run" : "total", group, extra };
});
const BY_ID = new Map(MISSION_POOL.map((m) => [m.id, m]));
export function missionById(id) { return BY_ID.get(id); }

export function tierFor(mult) { return Math.min(mult, 4); }

// missions.md "x5 up": tier-4 targets scale x(1 + 0.25*(mult-4)); >=10 rounds to nearest 5, else rounds up.
export function targetFor(m, mult) {
  if (m.tier !== 4 || mult < 4) return m.target;
  const scaled = m.target * (1 + 0.25 * (mult - 4));
  return scaled >= 10 ? Math.round(scaled / 5) * 5 : Math.ceil(scaled);
}

function rngForDraw(seed, drawIndex) { return mulberry32(((seed >>> 0) + drawIndex * 2654435761) >>> 0); }

// Deterministic per (seed, drawIndex): 3 ids from `tier`, no two sharing a group, none of `exclude`.
export function drawSet(seed, drawIndex, tier, exclude = []) {
  const rng = rngForDraw(seed, drawIndex);
  const candidates = MISSION_POOL.filter((m) => m.tier === tier && !exclude.includes(m.id));
  const picked = [], usedGroups = new Set(), pool = candidates.slice();
  while (picked.length < 3 && pool.length) {
    const m = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    if (usedGroups.has(m.group)) continue;
    picked.push(m); usedGroups.add(m.group);
  }
  for (const m of candidates) { if (picked.length >= 3) break; if (!picked.includes(m)) picked.push(m); }
  return picked.map((m) => m.id);
}

export function freshMissions(seed, tier = 1, sets = 1) {
  return { set: drawSet(seed, sets - 1, tier, []), prog: [0, 0, 0], done: [false, false, false], seed, sets };
}

// Run-mode progress (and the noHit/distance high-water marks) resets at each run start; a done mission
// keeps its display regardless, so it's skipped.
export function resetRunProgress(missions) {
  const prog = missions.prog.map((p, i) => {
    if (missions.done[i]) return p;
    const m = missionById(missions.set[i]);
    return m && m.mode === "run" ? 0 : p;
  });
  return { ...missions, prog };
}

function matchIncrement(m, entry, powerKind) {
  switch (m.group) {
    case "jump": case "duck": case "lane": case "turn": case "coin": case "nearMiss": case "escape":
      return entry.type === m.group ? 1 : 0;
    case "skyCoin": return entry.type === "coin" && powerKind === "balloon" ? 1 : 0;
    case "clear": return entry.type === "clear" && entry.how === m.extra ? 1 : 0;
    case "shieldPop": return entry.type === "shieldPop" && entry.reason === m.extra ? 1 : 0;
    case "pickup": return entry.type === "pickup" && (!m.extra || entry.kind === m.extra) ? 1 : 0;
    default: return 0; // distance/noHit: continuous below, not log-driven
  }
}

// Called every step with the sim.log entries new since the last call (the log caps at 512), plus `s` and
// `power.kind`. `run` is ephemeral per-run state (not saved): lastStumbleS, the noHit baseline. Never
// mutates its inputs.
export function stepMissions(missions, mult, run, entries, s, powerKind) {
  const prog = missions.prog.slice(), done = missions.done.slice();
  let lastStumbleS = run.lastStumbleS;
  const ms = missions.set.map(missionById);

  for (const e of entries) {
    if (e.type === "stumble") lastStumbleS = s;
    for (let i = 0; i < 3; i++) { if (!done[i] && ms[i]) prog[i] += matchIncrement(ms[i], e, powerKind); }
  }
  for (let i = 0; i < 3; i++) {
    if (done[i] || !ms[i]) continue;
    if (ms[i].group === "noHit") prog[i] = Math.max(prog[i], s - lastStumbleS);
    else if (ms[i].group === "distance") prog[i] = Math.max(prog[i], s);
  }
  for (let i = 0; i < 3; i++) { if (!done[i] && ms[i] && prog[i] >= targetFor(ms[i], mult)) done[i] = true; }
  return { missions: { ...missions, prog, done }, run: { lastStumbleS } };
}

// Run end, before the Results animation: a complete set bumps mult +1 for good and draws the next set
// (tier = min(newMult, 4), excluding the 3 just done). `mult` stays the save's own top-level field.
export function finishRun(missions, mult) {
  if (!missions.done.every(Boolean)) return { missions, mult };
  const newMult = mult + 1, sets = missions.sets + 1;
  const set = drawSet(missions.seed, sets - 1, tierFor(newMult), missions.set);
  return { missions: { set, prog: [0, 0, 0], done: [false, false, false], seed: missions.seed, sets }, mult: newMult };
}
