/* Rush Lane board model: pure logic, no DOM. Loads as a classic script in the browser (window.RushLaneBoard)
   and via require() in node for tests. A board is { w, h, arrows: Map<id, arrow> } where an arrow is
   { id, cells: [[x,y], ...] } (tail -> head, 4-connected, self-avoiding, any number of bends) and { dir } is the head's
   direction (one of DIRS' keys) -- the direction the arrow leaves the board in when tapped free.

   Solvability is monotone: removing an arrow only ever frees cells, never blocks one. So a greedy solver
   (repeatedly remove any currently-free arrow) finds a solution whenever one exists; if it ever gets stuck
   with arrows left, those arrows form a dependency cycle and the board is unsolvable. */
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) module.exports = mod;
  else root.RushLaneBoard = mod;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const DIR_NAMES = Object.keys(DIRS);

  function cellKey(x, y) {
    return x + "," + y;
  }

  function createBoard(w, h, arrows) {
    const map = new Map();
    for (const a of arrows) map.set(a.id, a);
    return { w, h, arrows: map };
  }

  function cloneBoard(board) {
    return { w: board.w, h: board.h, arrows: new Map(board.arrows) };
  }

  function occupancyMap(board) {
    const map = new Map();
    for (const arrow of board.arrows.values()) {
      for (const [x, y] of arrow.cells) map.set(cellKey(x, y), arrow.id);
    }
    return map;
  }

  // Cells from just past the head to the board edge, in the arrow's direction. An empty array means the
  // head already sits on the boundary in that direction, i.e. the arrow is immediately free.
  function laneOf(board, id) {
    const arrow = board.arrows.get(id);
    if (!arrow) return [];
    const [hx, hy] = arrow.cells[arrow.cells.length - 1];
    const [dx, dy] = DIRS[arrow.dir];
    const lane = [];
    let x = hx + dx;
    let y = hy + dy;
    while (x >= 0 && x < board.w && y >= 0 && y < board.h) {
      lane.push([x, y]);
      x += dx;
      y += dy;
    }
    return lane;
  }

  // The id of the first arrow occupying the lane, or null if the lane is clear to the edge. `occ` is an
  // optional precomputed occupancyMap(board), so callers doing many lookups (the solver) can share one.
  function blockerOf(board, id, occ) {
    const lane = laneOf(board, id);
    if (lane.length === 0) return null;
    const map = occ || occupancyMap(board);
    for (const [x, y] of lane) {
      const hit = map.get(cellKey(x, y));
      if (hit !== undefined) return hit;
    }
    return null;
  }

  function isFree(board, id, occ) {
    return blockerOf(board, id, occ) === null;
  }

  function freeIds(board) {
    const occ = occupancyMap(board);
    const ids = [];
    for (const id of board.arrows.keys()) if (isFree(board, id, occ)) ids.push(id);
    return ids;
  }

  function remove(board, id) {
    const arrow = board.arrows.get(id);
    board.arrows.delete(id);
    return arrow;
  }

  // Greedy solve: peel off free arrows in "layers" (all arrows free at once each round) until the board
  // empties (solvable) or a round frees nothing with arrows still left (a dependency cycle: unsolvable).
  function solve(board) {
    const b = cloneBoard(board);
    const order = [];
    const layers = [];
    while (b.arrows.size > 0) {
      const occ = occupancyMap(b);
      const free = [];
      for (const id of b.arrows.keys()) if (isFree(b, id, occ)) free.push(id);
      if (free.length === 0) return { solvable: false, order, layers };
      layers.push(free.slice());
      for (const id of free) {
        order.push(id);
        b.arrows.delete(id);
      }
    }
    return { solvable: true, order, layers };
  }

  // Difficulty metrics from the "A is blocked by B" dependency graph, used by the generator to reject
  // boards outside a level's target band: dependency depth (solve layers), mean free-arrow ratio per step,
  // trap count (arrows unlocked one layer in, whose sole blocker was free from the very first layer -- they
  // look one tap away the whole time but need that other arrow gone first), arrow count, fill density and
  // shortest/longest arrow length (so the generator can reject 1-cell stubs and check its snake lengths).
  function analyze(board) {
    const arrowCount = board.arrows.size;
    const totalCells = board.w * board.h;
    const usedCells = totalCells === 0 ? 0 : [...board.arrows.values()].reduce((sum, a) => sum + a.cells.length, 0);
    const fillDensity = totalCells === 0 ? 0 : usedCells / totalCells;
    const lengths = [...board.arrows.values()].map((a) => a.cells.length);
    const minArrowLen = lengths.length ? Math.min(...lengths) : 0;
    const maxArrowLen = lengths.length ? Math.max(...lengths) : 0;
    const { solvable, layers } = solve(board);
    if (!solvable) return { solvable: false, arrowCount, fillDensity, minArrowLen, maxArrowLen };

    const depth = layers.length;
    const meanFreeRatio =
      layers.reduce((sum, layer, i) => {
        const remainingAtStep = layers.slice(i).reduce((s, l) => s + l.length, 0);
        return sum + layer.length / remainingAtStep;
      }, 0) / depth;

    const layerOfId = new Map();
    layers.forEach((layer, i) => layer.forEach((id) => layerOfId.set(id, i)));
    let trapCount = 0;
    for (const id of board.arrows.keys()) {
      if (layerOfId.get(id) !== 1) continue;
      const blockerId = blockerOf(board, id);
      if (blockerId !== null && layerOfId.get(blockerId) === 0) trapCount++;
    }

    return { solvable: true, arrowCount, fillDensity, depth, meanFreeRatio, trapCount, minArrowLen, maxArrowLen };
  }

  // ---------- generator ----------

  function shuffle(arr, rand) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = a[i];
      a[i] = a[j];
      a[j] = tmp;
    }
    return a;
  }

  function perpendicular(dir) {
    return dir === "up" || dir === "down" ? ["left", "right"] : ["up", "down"];
  }

  // The compass direction from cell a to adjacent cell b.
  function dirBetween(a, b) {
    for (const name of DIR_NAMES) {
      const [dx, dy] = DIRS[name];
      if (a[0] + dx === b[0] && a[1] + dy === b[1]) return name;
    }
    return DIR_NAMES[0];
  }

  // A self-avoiding random walk from (x, y): straight steps, with a per-step chance to bend 90 degrees
  // (never a U-turn, since the previous cell already occupies that direction), any number of times, up to
  // a randomly chosen target length in [minLen, maxLen]. Stops early if boxed in on all sides -- the walk
  // never revisits a cell (self-crossing arrows can't be tapped free from a single lane) or steps onto an
  // already-occupied one, so the returned path is always a valid, if possibly short, tube.
  function walkPath(x, y, d0, occupied, rand, minLen, maxLen, bendProbability, w, h) {
    const cells = [[x, y]];
    const used = new Set(occupied);
    used.add(cellKey(x, y));
    let dir = d0;
    let cx = x;
    let cy = y;
    const targetLen = minLen + Math.floor(rand() * (maxLen - minLen + 1));
    while (cells.length < targetLen) {
      const bend = cells.length > 1 && rand() < bendProbability;
      const order = bend ? shuffle(perpendicular(dir), rand).concat([dir]) : [dir].concat(shuffle(perpendicular(dir), rand));
      let moved = false;
      for (const cand of order) {
        const [ddx, ddy] = DIRS[cand];
        const nx = cx + ddx;
        const ny = cy + ddy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const key = cellKey(nx, ny);
        if (used.has(key)) continue;
        cells.push([nx, ny]);
        used.add(key);
        cx = nx;
        cy = ny;
        dir = cand;
        moved = true;
        break;
      }
      if (!moved) break;
    }
    return cells;
  }

  // Grows one arrow from an empty starting cell: a self-avoiding walk of straight runs and any number of
  // 90-degree bends (snakes, spirals), using only still-empty cells, targeting a length in [minLen, maxLen].
  // Tries every starting direction (in random order) until one reaches minLen; if none can (the starting
  // cell is boxed in), falls back to the longest path any direction managed, down to a length-1 arrow when
  // there is truly no room to grow at all.
  function growArrow(x, y, occupied, rand, minLen, maxLen, bendProbability, id, w, h) {
    let best = [[x, y]];
    for (const d0 of shuffle(DIR_NAMES, rand)) {
      const cells = walkPath(x, y, d0, occupied, rand, minLen, maxLen, bendProbability, w, h);
      if (cells.length > best.length) best = cells;
      if (best.length >= minLen) break;
    }
    const dir = best.length > 1 ? dirBetween(best[best.length - 2], best[best.length - 1]) : DIR_NAMES[Math.floor(rand() * DIR_NAMES.length)];
    return { id, cells: best, dir };
  }

  // Fills the grid with arrows up to `density` (fraction of cells covered), leaving the rest as empty gaps.
  // Gaps matter for solvability: in a fully tiled board almost every lane is blocked by construction (every
  // cell belongs to some arrow), so the "A blocked by B" graph is dense and nearly always cyclic on anything
  // but a tiny board. Leaving real empty space gives lanes an actual chance to be clear, which is what makes
  // solvable boards common enough for reject-sampling (see `generate`) to converge quickly, and turns fill
  // density into a meaningful difficulty knob rather than a constant.
  function tile(w, h, rand, minLen, maxLen, bendProbability, density) {
    const occupied = new Set();
    const order = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) order.push([x, y]);
    const cells = shuffle(order, rand);
    const targetCells = Math.round(w * h * density);
    const arrows = [];
    let nextId = 1;
    let filled = 0;
    for (const [x, y] of cells) {
      if (filled >= targetCells) break;
      if (occupied.has(cellKey(x, y))) continue;
      const arrow = growArrow(x, y, occupied, rand, minLen, maxLen, bendProbability, nextId++, w, h);
      arrows.push(arrow);
      for (const [cx, cy] of arrow.cells) occupied.add(cellKey(cx, cy));
      filled += arrow.cells.length;
    }
    return createBoard(w, h, arrows);
  }

  // mulberry32: a small, fast seeded RNG returning floats in [0, 1). Kept local (not shared with the
  // studio's UIKit.rng) so board.js has zero DOM/UIKit dependency and can run standalone under node.
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

  // Generates a solvable, cycle-free board. `rand` is a 0..1 RNG (see `rng` above). `accept(metrics)` is an
  // optional predicate for a target difficulty band; without it, any solvable board is returned. Keeps
  // retrying (drawing further from the same `rand` stream) until `accept` passes or `maxAttempts` is spent,
  // in which case it falls back to the first solvable board found so a level never fails to generate.
  function generate(opts) {
    const w = opts.w;
    const h = opts.h;
    const rand = opts.rand;
    const minLen = opts.minLen || 1;
    const maxLen = opts.maxLen || 4;
    const bendProbability = opts.bendProbability === undefined ? 0.35 : opts.bendProbability;
    const density = opts.density === undefined ? 0.55 : opts.density;
    const maxAttempts = opts.maxAttempts || 500;
    const accept = opts.accept;

    let fallback = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const board = tile(w, h, rand, minLen, maxLen, bendProbability, density);
      const metrics = analyze(board);
      if (!metrics.solvable) continue;
      if (!fallback) fallback = { board, metrics, attempts: attempt + 1 };
      if (!accept || accept(metrics)) return { board, metrics, attempts: attempt + 1 };
    }
    return fallback;
  }

  return {
    DIRS,
    cellKey,
    createBoard,
    cloneBoard,
    occupancyMap,
    laneOf,
    blockerOf,
    isFree,
    freeIds,
    remove,
    solve,
    analyze,
    generate,
    rng,
  };
});
