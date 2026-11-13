// THE-1412: lays out one authored level (sim/levels.js) with the game's real placers -- same algorithm as
// design/capy-trail/levels/level-check.mjs's own layout(), but producing the real stateful records (ids,
// hit/cleared/taken flags) sim.js's hazard/coin/junction/pickup/closure checks already read, in the same
// shape sim/patterns.js's createPatterns() returns. No randomness: a level's layout is fixed data, placed
// at fixed times/distances, so it is byte-identical every time regardless of the run's seed.
import { CHUNKS } from "./chunks.js";
import { placeChunk, placeRow } from "./chunk-placer.js";
import { placeCorridor, ROW_AFTER_CLOSURE_T } from "./narrowing.js";
import { speedAt, distanceAt } from "./speed.js";
import { rollMysteryPrize } from "./patterns.js";
import { mulberry32 } from "./rng.js";
import { POWER_TIME, BALLOON_LANDING_T } from "./powerups.js";

const ROW_T = 1.6, ROW_AT = 1.0, CHUNK_BUFFER_T = 0.6, J_AT = 1.2, J_T = 2.2, COR_LEAD = 1.0, COR_GAP = 1.3;
const CELL = { "-": "none", L: "low", H: "high", E: "either", B: "block" };
const byId = Object.fromEntries(CHUNKS.map((c) => [c.id, c]));
const cellsOf = (str) => [...str].map((ch) => CELL[ch]);
const COIN_MIN_GAP = 0.6; // same same-lane dedupe as patterns.js's addCoin
// THE-1417: a level's Mystery Box prizes are deterministic per level, not per run seed -- rolled off a
// fixed per-level RNG (never sim.rng), in script order, through the same rollMysteryPrize() weights
// Endless uses. canBalloon reuses the slice 3b junction rule (level-check.mjs's design-time check, same
// POWER_TIME.balloon + BALLOON_LANDING_T safety margin): a box whose fixed position couldn't hold a
// flight just has balloon excluded from its own roll, so a rolled balloon prize always fits by construction.
// Arbitrary but fixed; picked (by search) so a balloon prize actually rolls in both level 9 and level 12
// at their real canBalloon positions, so the TDD suite has a real prize flight to assert against instead
// of a vacuous "no balloon ever rolled" pass.
const MYSTERY_SEED_BASE = 26;

export function createLevelPatterns(level) {
  const D0 = distanceAt(level.t0, 4000);
  const S = (t) => distanceAt(level.t0 + t, 4000) - D0;
  const V = (t) => speedAt(level.t0 + t);
  const hazards = [], coins = [], junctions = [], pickups = [], closures = [], corridors = [], mysteryQueue = [];
  let hid = 0, cid = 0, jid = 0, pid = 0;

  function addCoin(c) {
    for (let i = coins.length - 1; i >= 0 && i >= coins.length - 60; i--) {
      const o = coins[i];
      if (o.lane !== c.lane || Math.abs(o.s - c.s) >= COIN_MIN_GAP) continue;
      if (c.arc && !o.arc && !o.taken) coins[i] = { ...c, id: o.id };
      return;
    }
    coins.push(c);
  }
  function addHazard(h) {
    hazards.push({ id: `h${hid++}`, s: h.s, lane: h.lane, kind: h.kind, mergeWidth: h.mergeWidth ?? 1, mergeCenterLane: h.mergeCenterLane ?? h.lane, hiddenForMerge: h.hiddenForMerge ?? false, hit: false, cleared: false });
  }
  function arcFields(c) { return c.y === undefined ? {} : { y: c.y, arc: true, ...(c.p === undefined ? {} : { p: c.p }) }; }
  function pushCoin(c) { addCoin({ id: `c${cid++}`, s: c.s, lane: c.lane, ...arcFields(c), taken: false, passed: false }); }

  let t = 0;
  for (const it of level.script) {
    const s = S(t), v = V(t);
    if (typeof it === "number") { t += it; continue; }
    if (typeof it === "string" && /^[emh]\d$/.test(it)) {
      const ch = byId[it];
      const p = placeChunk(ch, s, v);
      for (const h of p.hazards) addHazard(h);
      for (const c of p.coins) pushCoin(c);
      t += ch.duration + CHUNK_BUFFER_T; continue;
    }
    if (typeof it === "string") {
      const rs = S(t + ROW_AT), rv = V(t + ROW_AT);
      const p = placeRow(cellsOf(it), rs, rv);
      for (const h of p.hazards) addHazard(h);
      for (const c of p.coins) pushCoin(c);
      t += ROW_T; continue;
    }
    if (it.j) {
      const jt = t + J_AT;
      junctions.push({ id: `j${jid++}`, s: S(jt), v: V(jt), dir: it.j, t: jt, resolved: null });
      t += J_T; continue;
    }
    if (it.pu) {
      const pickup = { id: `pk${pid++}`, kind: it.pu, s, lane: it.lane, taken: false };
      pickups.push(pickup);
      if (it.pu === "mystery") mysteryQueue.push({ pickup, t });
      continue;
    }
    if (it.coins !== undefined) {
      for (let i = 0; i < it.n; i++) pushCoin({ s: s + i * 2, lane: it.coins });
      continue;
    }
    if (it.cor) {
      const ft = t + COR_LEAD, fv = V(ft);
      const rowsAt = (list, from, to, open) => list.map((str, i) => ({
        at: from + ROW_AFTER_CLOSURE_T + i * COR_GAP, lanes: open, kinds: open.map((l) => cellsOf(str)[l + 1]),
      }));
      let block;
      if (it.cor === "B") {
        const open = [-1, 0, 1].filter((l) => l !== it.close);
        block = { shape: "B", dur: it.dur, guideLane: 0, fillers: [{ lane: it.close, from: 0, to: it.dur, kind: "trunk" }], rows: rowsAt(it.rows, 0, it.dur, open) };
      } else {
        const [outer, second] = it.close, dur = it.approach + it.one;
        const open2 = [-1, 0, 1].filter((l) => l !== outer), open1 = open2.filter((l) => l !== second);
        block = {
          shape: "A", dur, guideLane: open1[0], secondLane: second, secondAt: it.approach, hasTail: false, tailDur: 0,
          fillers: [{ lane: outer, from: 0, to: dur, kind: "trunk" }, { lane: second, from: it.approach, to: dur, kind: "boulderLine" }],
          rows: [...rowsAt(it.rowsA, 0, it.approach, open2), ...rowsAt(it.rows1, it.approach, dur, open1)],
        };
      }
      const c = placeCorridor(block, S(ft), fv, ft);
      corridors.push(c);
      for (const f of c.fillers) closures.push(f);
      for (const r of c.rows) addHazard(r);
      for (const cc of c.coins) pushCoin(cc);
      t += COR_LEAD + block.dur + ROW_AFTER_CLOSURE_T + CHUNK_BUFFER_T; continue;
    }
  }
  const finishT = t + 1.0;
  const finishS = S(finishT);
  if (mysteryQueue.length) {
    const rng = mulberry32(MYSTERY_SEED_BASE + level.n);
    for (const { pickup, t: pt } of mysteryQueue) {
      const flightEnd = pt + POWER_TIME.balloon + BALLOON_LANDING_T;
      const canBalloon = flightEnd <= finishT
        && !junctions.some((j) => j.t > pt && j.t - 2.0 < flightEnd)
        && !corridors.some((c) => c.startT > pt && c.startT < flightEnd);
      pickup.prize = rollMysteryPrize(rng, canBalloon);
    }
  }
  function ensureAhead() {} // the whole level is placed up front; nothing left to generate
  return { hazards, coins, junctions, pickups, closures, corridors, chunkLog: [], ensureAhead, finishS, finishT };
}
