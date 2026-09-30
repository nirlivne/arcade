// Loop Break rules core: the medallion model, the exact solver and the level generator (THE-228 M1).
// Pure and dependency-free. Shared by the game (level.js, the in-browser daily, the hint), the generator tool
// (tools/loop-break-gen.mjs) and QA's bots.
//
// Model (CTO answers on THE-230):
// - n rings, index 0 = outermost. Each ring has one gap; `pos[i]` in 0..NOTCHES-1 is the gap's offset in
//   notches from the 12 o'clock index. Solved = every pos is 0.
// - Links join adjacent rings, at most one per pair, one-way: {from, to, type}. type "claw" turns the driven
//   ring the same way by the same amount, "pinion" the opposite way. Links cascade (A -> B -> C).
// - A drive-only ring can't be grabbed; it always has at least one driver.
// - One move = one drag of ring k by any amount d (1..NOTCHES-1). Moves add, so they commute: the optimum
//   drags each ring at most once and the solution is unique. par = rings with a nonzero amount in it.

export const NOTCHES = 8;
export const LINK_SIGN = { claw: 1, pinion: -1 };

const mod = (x) => ((x % NOTCHES) + NOTCHES) % NOTCHES;

// mulberry32; small, fast and identical in Node and the browser.
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const randInt = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

function shuffle(rng, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function grabbable(level) {
  const fixed = new Set(level.driveOnly || []);
  return [...Array(level.n).keys()].filter((i) => !fixed.has(i));
}

// How far each ring turns, per notch, when ring k is dragged one notch (cascading through the links).
export function moveVector(level, k) {
  const v = new Array(level.n).fill(0);
  v[k] = 1;
  const queue = [k];
  while (queue.length) {
    const r = queue.shift();
    for (const l of level.links) {
      if (l.from === r && v[l.to] === 0) {
        v[l.to] = v[r] * LINK_SIGN[l.type];
        queue.push(l.to);
      }
    }
  }
  return v;
}

export function applyMove(level, pos, k, d) {
  const v = moveVector(level, k);
  return pos.map((p, i) => mod(p + v[i] * d));
}

export const isSolved = (pos) => pos.every((p) => p === 0);

// Drivers before driven (the link graph is a chain of one-way edges, so it has no cycles).
export function topoOrder(level) {
  const indeg = new Array(level.n).fill(0);
  for (const l of level.links) indeg[l.to]++;
  const order = [];
  const ready = [...Array(level.n).keys()].filter((i) => indeg[i] === 0);
  while (ready.length) {
    const r = ready.shift();
    order.push(r);
    for (const l of level.links) if (l.from === r && --indeg[l.to] === 0) ready.push(l.to);
  }
  return order;
}

// The exact optimal plan: align the grabbable rings in driver-first order. Because the solution is unique this
// is optimal, and it's what the hint shows. Returns null if the position can't be solved (never happens for a
// generated level; the tool checks it against BFS).
export function solve(level, pos) {
  let cur = pos.slice();
  const fixed = new Set(level.driveOnly || []);
  const plan = [];
  for (const r of topoOrder(level)) {
    if (fixed.has(r) || cur[r] === 0) continue;
    const d = mod(-cur[r]);
    plan.push({ ring: r, d });
    cur = applyMove(level, cur, r, d);
  }
  return isSolved(cur) ? plan : null;
}

// Breadth-first search over every position, the ground truth for par. 8^6 = 262,144 states at 6 rings.
export function bfsDistance(level, pos) {
  const n = level.n;
  const size = NOTCHES ** n;
  const encode = (p) => p.reduce((acc, x, i) => acc + x * NOTCHES ** i, 0);
  const moves = [];
  for (const k of grabbable(level)) {
    const v = moveVector(level, k);
    for (let d = 1; d < NOTCHES; d++) moves.push(v.map((x) => mod(x * d)));
  }
  const dist = new Int8Array(size).fill(-1);
  const start = encode(pos);
  if (start === 0) return 0;
  dist[start] = 0;
  let frontier = [start];
  const digits = new Array(n);
  for (let depth = 0; frontier.length; depth++) {
    const next = [];
    for (const s of frontier) {
      let x = s;
      for (let i = 0; i < n; i++) { digits[i] = x % NOTCHES; x = Math.floor(x / NOTCHES); }
      for (const m of moves) {
        let t = 0;
        for (let i = n - 1; i >= 0; i--) t = t * NOTCHES + ((digits[i] + m[i]) % NOTCHES);
        if (dist[t] !== -1) continue;
        if (t === 0) return depth + 1;
        dist[t] = depth + 1;
        next.push(t);
      }
    }
    frontier = next;
  }
  return -1;
}

// Bots for the difficulty metric and QA's engagement gate. Each returns true if it solves within `budget`.
// fixer: aligns a random misaligned grabbable ring every move (a player who doesn't read the links).
// random: drags a random grabbable ring by a random amount (a player dragging aimlessly).
function fixerRun(level, rng) {
  let pos = level.start.slice();
  const grab = grabbable(level);
  for (let m = 0; m < level.budget; m++) {
    const off = grab.filter((r) => pos[r] !== 0);
    if (!off.length) return isSolved(pos);
    const r = off[Math.floor(rng() * off.length)];
    pos = applyMove(level, pos, r, mod(-pos[r]));
    if (isSolved(pos)) return true;
  }
  return false;
}

function randomRun(level, rng) {
  let pos = level.start.slice();
  const grab = grabbable(level);
  for (let m = 0; m < level.budget; m++) {
    pos = applyMove(level, pos, grab[Math.floor(rng() * grab.length)], randInt(rng, 1, NOTCHES - 1));
    if (isSolved(pos)) return true;
  }
  return false;
}

export function botRates(level, runs = 400, seed = 1) {
  const rng = makeRng(seed);
  let fixer = 0, random = 0;
  for (let i = 0; i < runs; i++) {
    if (fixerRun(level, rng)) fixer++;
    if (randomRun(level, rng)) random++;
  }
  return { fixer: fixer / runs, random: random / runs };
}

export function metrics(level, runs) {
  const plan = solve(level, level.start);
  const misaligned = level.start.filter((p) => p !== 0).length;
  return { par: plan ? plan.length : -1, misaligned, ...botRates(level, runs) };
}

// One random candidate for a ladder rung:
// cfg = {n, links, types:["claw"|"pinion", ...], driveOnly, par:[lo,hi], slack, fixer:[lo,hi], minMisaligned}
function candidate(cfg, rng) {
  const pairs = shuffle(rng, [...Array(cfg.n - 1).keys()]).slice(0, cfg.links);
  const links = pairs
    .sort((a, b) => a - b)
    .map((i) => {
      const out = rng() < 0.5;
      return { from: out ? i : i + 1, to: out ? i + 1 : i, type: cfg.types[Math.floor(rng() * cfg.types.length)] };
    });
  const driven = shuffle(rng, [...new Set(links.map((l) => l.to))]);
  if (driven.length < (cfg.driveOnly || 0)) return null;
  const driveOnly = driven.slice(0, cfg.driveOnly || 0).sort((a, b) => a - b);
  const level = { n: cfg.n, links, driveOnly, start: null, par: 0, budget: 0 };
  const grab = grabbable(level);
  const par = randInt(rng, cfg.par[0], Math.min(cfg.par[1], grab.length));
  let pos = new Array(cfg.n).fill(0);
  for (const r of shuffle(rng, grab).slice(0, par)) pos = applyMove(level, pos, r, randInt(rng, 1, NOTCHES - 1));
  level.start = pos;
  const plan = solve(level, pos);
  if (!plan || plan.length !== par) return null; // two drags cancelled out on a shared ring
  if (pos.filter((p) => p !== 0).length < (cfg.minMisaligned ?? 1)) return null;
  level.par = par;
  level.budget = par + cfg.slack;
  return level;
}

export const levelKey = (l) =>
  [l.n, l.links.map((x) => `${x.from}${x.type[0]}${x.to}`).join(","), l.driveOnly.join(","), l.start.join("")].join("|");

// Draws candidates until one fits the rung's bands. `seen` (a Set of levelKey) prevents repeats in a pack.
export function generateLevel(cfg, rng, { seen = new Set(), runs = 300, maxTries = 4000 } = {}) {
  for (let t = 0; t < maxTries; t++) {
    const level = candidate(cfg, rng);
    if (!level || seen.has(levelKey(level))) continue;
    const m = metrics(level, runs);
    if (cfg.fixer && (m.fixer < cfg.fixer[0] || m.fixer > cfg.fixer[1])) continue;
    seen.add(levelKey(level));
    return { ...level, metrics: m, tries: t + 1 };
  }
  return null;
}

// Daily medallion by weekday (index = Date#getDay, 0 = Sunday), Monday easiest, one coupling type per day.
// Spec THE-230 §3 daily table and bands.
export const DAILY_LADDER = [
  { n: 6, links: 5, types: ["pinion"], driveOnly: 1, par: [4, 5], slack: 1, fixer: [0.1, 0.35] },
  { n: 4, links: 2, types: ["claw"], par: [3, 3], slack: 2, fixer: [0.45, 0.7] },
  { n: 4, links: 2, types: ["pinion"], par: [3, 4], slack: 1, fixer: [0.45, 0.7] },
  { n: 5, links: 3, types: ["claw"], par: [4, 4], slack: 1, fixer: [0.25, 0.5] },
  { n: 5, links: 3, types: ["pinion"], par: [4, 4], slack: 1, fixer: [0.25, 0.5] },
  { n: 5, links: 3, types: ["pinion"], driveOnly: 1, par: [3, 4], slack: 1, fixer: [0.25, 0.5] },
  { n: 6, links: 4, types: ["claw"], par: [5, 5], slack: 1, fixer: [0.1, 0.35] },
];

// The local calendar date (y, m 1-12, d) seeds everything, so every player gets the same medallion that day.
// The weekday is computed from the civil date itself, so it never depends on the device's time zone.
export function dailyLevel(y, m, d) {
  const cfg = DAILY_LADDER[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const rng = makeRng((y * 10000 + m * 100 + d) >>> 0);
  const level = generateLevel(cfg, rng, { runs: 200, maxTries: 600 });
  if (level) return level;
  // Never expected (the tool checks years of dates); drop the difficulty band rather than fail the day.
  return { ...generateLevel({ ...cfg, fixer: null }, rng, { runs: 200 }), relaxed: true };
}
