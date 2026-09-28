/* Potion Pour shelf model: pure logic, no DOM. Loads as a classic script in the browser (window.PotionPourShelf)
   and via require() in node for tests and the offline generator (same UMD pattern as Rush Lane's board.js).

   A state is { vials, capacity }. Each vial is a bottom -> top array of colour ids (0-based integers); an empty
   vial is []. `capacity` is the fixed layer count per vial (4). Vial order in `state.vials` is meaningful to the
   UI (it is the shelf position, and `pour`/`tap` addresses vials by index) -- only the solver's internal search
   ignores order, via a canonical key that sorts a *copy* of the vials.

   canPour(a -> b): a is non-empty, a !== b, b is not full, and b is empty or its top colour equals a's top colour.
   pour(a -> b): moves the *whole* top run of a (every consecutive same-colour layer at the top), as much as fits
   in b. This "whole run, as much as fits" rule is the one thing every other function here has to stay honest to:
   a constructed state is only reachable by real play if some sequence of exactly these moves produces it, which
   is why the generator below always solver-verifies instead of trusting its own construction. */
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) module.exports = mod;
  else root.PotionPourShelf = mod;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function cloneVials(vials) {
    return vials.map((v) => v.slice());
  }

  function createState(vials, capacity) {
    return { vials: cloneVials(vials), capacity };
  }

  // The colour and count of the consecutive same-colour run sitting on top of a vial, or null when empty.
  function topRun(vial) {
    if (!vial || vial.length === 0) return null;
    const color = vial[vial.length - 1];
    let count = 0;
    for (let i = vial.length - 1; i >= 0 && vial[i] === color; i--) count++;
    return { color, count };
  }

  function isUniform(vial) {
    return vial.length > 0 && vial.every((c) => c === vial[0]);
  }

  function isVialSolved(vial, capacity) {
    return vial.length === 0 || (vial.length === capacity && isUniform(vial));
  }

  function isSolved(state) {
    return state.vials.every((v) => isVialSolved(v, state.capacity));
  }

  function canPour(state, a, b) {
    if (a === b) return false;
    const va = state.vials[a];
    const vb = state.vials[b];
    if (!va || !vb) return false;
    if (va.length === 0) return false;
    if (vb.length >= state.capacity) return false;
    if (vb.length === 0) return true;
    const runA = topRun(va);
    return vb[vb.length - 1] === runA.color;
  }

  // Returns { state, amount } for a legal pour, or null if the pour is illegal. `amount` is how many layers
  // moved (the whole top run of `a`, capped by the free space in `b`).
  function pour(state, a, b) {
    if (!canPour(state, a, b)) return null;
    const run = topRun(state.vials[a]);
    const space = state.capacity - state.vials[b].length;
    const amount = Math.min(run.count, space);
    const vials = cloneVials(state.vials);
    vials[a].length -= amount;
    for (let i = 0; i < amount; i++) vials[b].push(run.color);
    return { state: { vials, capacity: state.capacity }, amount, color: run.color };
  }

  function legalMoves(state) {
    const moves = [];
    for (let a = 0; a < state.vials.length; a++) {
      for (let b = 0; b < state.vials.length; b++) {
        if (a !== b && canPour(state, a, b)) moves.push([a, b]);
      }
    }
    return moves;
  }

  // The solver's move set: `legalMoves` minus the two moves that can never appear in an optimal solution --
  // pouring a single-colour vial into an empty one (a no-op relocation) and pouring out of an already-solved
  // vial (strictly wasteful, since the goal only needs every vial pure, not any particular vial pure).
  function prunedMoves(state) {
    return legalMoves(state).filter(([a, b]) => {
      const va = state.vials[a];
      if (isUniform(va) && state.vials[b].length === 0) return false;
      if (va.length === state.capacity && isUniform(va)) return false;
      return true;
    });
  }

  function addVial(state) {
    return { vials: cloneVials(state.vials).concat([[]]), capacity: state.capacity };
  }

  // Vial order doesn't matter for solvability, so the canonical key sorts a copy of the vials: this is what
  // keeps the BFS state space from multiplying by every permutation of otherwise-identical shelves.
  function canonicalKey(vials) {
    return vials
      .map((v) => v.join(","))
      .sort()
      .join("|");
  }

  // BFS over `prunedMoves`, real vial indices kept throughout (only the visited-set key is order-blind), so a
  // reconstructed path is a legal, in-order move list a player (or the test hook) can actually replay. Capped by
  // node count and wall time; on a cap hit `solvable` is null so callers can tell "unsolvable" from "unknown".
  function solve(state, opts) {
    const o = opts || {};
    const maxNodes = o.maxNodes || 200000;
    const maxTimeMs = o.maxTimeMs === undefined ? 2000 : o.maxTimeMs;
    const start = Date.now();

    if (isSolved(state)) return { solvable: true, moves: 0, path: [], capped: false, nodes: 1 };

    const startKey = canonicalKey(state.vials);
    const visited = new Set([startKey]);
    const cameFrom = new Map(); // key -> { prevKey, move: [a, b] }
    const stateOf = new Map([[startKey, state.vials]]);
    let frontier = [startKey];
    let nodes = 1;

    while (frontier.length) {
      if (nodes > maxNodes || Date.now() - start > maxTimeMs) {
        return { solvable: null, moves: null, path: null, capped: true, nodes };
      }
      const next = [];
      for (const key of frontier) {
        const vials = stateOf.get(key);
        const cur = { vials, capacity: state.capacity };
        for (const [a, b] of prunedMoves(cur)) {
          const res = pour(cur, a, b);
          if (!res) continue;
          const childKey = canonicalKey(res.state.vials);
          if (visited.has(childKey)) continue;
          visited.add(childKey);
          cameFrom.set(childKey, { prevKey: key, move: [a, b] });
          stateOf.set(childKey, res.state.vials);
          nodes++;
          if (isSolved(res.state)) {
            const path = [];
            let k = childKey;
            while (cameFrom.has(k)) {
              const step = cameFrom.get(k);
              path.push(step.move);
              k = step.prevKey;
            }
            path.reverse();
            return { solvable: true, moves: path.length, path, capped: false, nodes };
          }
          next.push(childKey);
          if (nodes > maxNodes) break;
        }
        if (nodes > maxNodes) break;
      }
      frontier = next;
    }
    return { solvable: false, moves: null, path: null, capped: false, nodes };
  }

  // Colours whose top run currently has nowhere legal to go -- the reason string the UI shows on a dead end.
  function stuckTops(state) {
    const stuck = [];
    for (let i = 0; i < state.vials.length; i++) {
      const run = topRun(state.vials[i]);
      if (!run) continue;
      let hasHome = false;
      for (let j = 0; j < state.vials.length; j++) {
        if (j !== i && canPour(state, i, j)) {
          hasHome = true;
          break;
        }
      }
      if (!hasHome) stuck.push(run.color);
    }
    return stuck.filter((c, i) => stuck.indexOf(c) === i);
  }

  // A dead end is "no legal pour at all" OR "the solver proves no solution is reachable" -- water-sort boards can
  // almost always shuffle a colour back and forth, so the first condition alone would almost never fire, which is
  // why the solver check matters. `extraVialAvailable` counts the still-unused extra-vial helper, but it is only
  // ever a way out of a dead end the player is *already in* -- it never means "not stuck": with zero legal pours
  // right now, the shelf being rescuable by the extra vial doesn't put a move back on the board (THE-127). So a
  // solvable-only-with-the-extra-vial result still reports `deadEnd: true`, with `needsExtraVial: true` telling
  // the caller the way out is the extra vial rather than undo.
  function isDeadEnd(state, opts) {
    const o = opts || {};
    const capOpts = { maxNodes: o.maxNodes || 20000, maxTimeMs: o.maxTimeMs === undefined ? 80 : o.maxTimeMs };
    const hasMoves = legalMoves(state).length > 0;

    if (!hasMoves && !o.extraVialAvailable) {
      return { deadEnd: true, reason: "no-moves", tops: stuckTops(state), needsExtraVial: false };
    }

    if (hasMoves) {
      const result = solve(state, capOpts);
      if (result.capped || result.solvable) return { deadEnd: false, reason: null, tops: [] };
    }

    const reason = hasMoves ? "unsolvable" : "no-moves";
    if (o.extraVialAvailable) {
      const rescued = solve(addVial(state), capOpts);
      if (rescued.capped || rescued.solvable) {
        return { deadEnd: true, reason, tops: stuckTops(state), needsExtraVial: true };
      }
    }
    return { deadEnd: true, reason, tops: stuckTops(state), needsExtraVial: false };
  }

  // mulberry32: a small, fast seeded RNG returning floats in [0, 1). Kept local (no UIKit dependency) so shelf.js
  // has zero DOM dependency and can run standalone under node, same as Rush Lane's board.js.
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // A fresh, solved shelf: one vial per colour (full), plus `extraEmpty` empty vials.
  function solvedShelf(colors, capacity, extraEmpty) {
    const vials = [];
    for (let c = 0; c < colors; c++) vials.push(new Array(capacity).fill(c));
    for (let e = 0; e < extraEmpty; e++) vials.push([]);
    return { vials, capacity };
  }

  // Scrambles a solved shelf by repeatedly moving a random amount of some vial's top run onto another vial that
  // merely has room -- not necessarily a matching colour or an empty vial, so this deliberately produces mixed
  // stacks that are not always reachable by legal forward play. That is exactly the generator "trap" the build
  // spec warns about: construction alone never proves solvability, only the solver-verify step below does.
  function scramble(state, steps, rand) {
    let cur = state;
    for (let i = 0; i < steps; i++) {
      const from = [];
      for (let v = 0; v < cur.vials.length; v++) if (cur.vials[v].length > 0) from.push(v);
      if (!from.length) break;
      const a = from[Math.floor(rand() * from.length)];
      const run = topRun(cur.vials[a]);
      const to = [];
      for (let v = 0; v < cur.vials.length; v++) {
        if (v !== a && cur.vials[v].length < cur.capacity) to.push(v);
      }
      if (!to.length) continue;
      const b = to[Math.floor(rand() * to.length)];
      const space = cur.capacity - cur.vials[b].length;
      const amount = 1 + Math.floor(rand() * Math.min(run.count, space));
      const vials = cloneVials(cur.vials);
      vials[a].length -= amount;
      for (let k = 0; k < amount; k++) vials[b].push(run.color);
      cur = { vials, capacity: cur.capacity };
    }
    return cur;
  }

  // Generates one solver-verified, solvable level. `accept(metrics)` is an optional predicate for a target
  // difficulty band (metrics: { minMoves, nodes }); without it, any solvable scramble is returned. Keeps
  // retrying with fresh scrambles (drawing further from the same `rand` stream) until `accept` passes or
  // `maxAttempts` is spent, falling back to the easiest solvable candidate found so generation never fails.
  function generate(opts) {
    const o = opts || {};
    const colors = o.colors;
    const capacity = o.capacity || 4;
    const extraEmpty = o.extraEmpty === undefined ? 1 : o.extraEmpty;
    const rand = o.rand;
    const scrambleSteps = o.scrambleSteps || colors * 4;
    const maxAttempts = o.maxAttempts || 60;
    const accept = o.accept;
    const solveOpts = o.solveOpts;

    let fallback = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const start = solvedShelf(colors, capacity, extraEmpty);
      const candidate = scramble(start, scrambleSteps, rand);
      if (isSolved(candidate)) continue; // scrambling did nothing useful; try again
      const result = solve(candidate, solveOpts);
      if (!result.solvable) continue;
      const metrics = { minMoves: result.moves, nodes: result.nodes };
      const record = { state: candidate, metrics, attempts: attempt + 1 };
      if (!fallback || metrics.minMoves > fallback.metrics.minMoves) fallback = record;
      if (!accept || accept(metrics)) return record;
    }
    return fallback;
  }

  return {
    createState,
    topRun,
    isUniform,
    isVialSolved,
    isSolved,
    canPour,
    pour,
    legalMoves,
    prunedMoves,
    addVial,
    canonicalKey,
    solve,
    stuckTops,
    isDeadEnd,
    solvedShelf,
    scramble,
    generate,
    rng,
  };
});
