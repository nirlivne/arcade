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
  // shortest/longest arrow length (so the generator can reject 1-cell stubs and check its snake lengths), and
  // openCount -- how many arrows can leave at the very start (THE-195's "most arrows start blocked").
  // `playableCells` overrides the fill-density denominator: a mask-packed board's real playable area is the
  // mask's cell count, not its w*h bounding box (most of the bbox is silhouette background).
  function analyze(board, playableCells) {
    const arrowCount = board.arrows.size;
    const totalCells = playableCells !== undefined ? playableCells : board.w * board.h;
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

    return { solvable: true, arrowCount, fillDensity, depth, openCount: layers[0].length, meanFreeRatio, trapCount, minArrowLen, maxArrowLen };
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
  //
  // `mask`, when given, is a Set of "x,y" keys: only those cells are playable (a silhouette, per THE-119).
  // Every other cell in the w*h bounding box is pre-marked occupied so walks never step outside the shape,
  // and `density` is a fraction of the mask's cell count rather than the whole bounding box.
  function tile(w, h, rand, minLen, maxLen, bendProbability, density, mask) {
    const occupied = new Set();
    let order;
    if (mask) {
      order = [];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (mask.has(cellKey(x, y))) order.push([x, y]);
          else occupied.add(cellKey(x, y));
        }
      }
    } else {
      order = [];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) order.push([x, y]);
    }
    const cells = shuffle(order, rand);
    const playableCount = mask ? mask.size : w * h;
    const targetCells = Math.round(playableCount * density);
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

  // BFS distance from each mask cell to the nearest non-mask cell (or grid edge) -- 0 on the boundary,
  // rising toward the interior. `tilePacked` places deep cells first and boundary cells last, since a
  // boundary cell's straight-line lane to the grid edge is short and mostly outside the mask (rarely
  // contested), while an interior cell's lane has to cross a lot of the shape and is only reliably clear
  // very early, before much else is placed. Without this ordering the two get placed in random order and
  // density plateaus well short of target once the board starts filling up (verified empirically).
  function maskDepth(w, h, mask) {
    const dist = new Map();
    const queue = [];
    for (const key of mask) {
      const [x, y] = key.split(",").map(Number);
      let boundary = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      if (!boundary) {
        for (const name of DIR_NAMES) {
          const [dx, dy] = DIRS[name];
          if (!mask.has(cellKey(x + dx, y + dy))) {
            boundary = true;
            break;
          }
        }
      }
      if (boundary) {
        dist.set(key, 0);
        queue.push(key);
      }
    }
    let qi = 0;
    while (qi < queue.length) {
      const key = queue[qi++];
      const [x, y] = key.split(",").map(Number);
      const d = dist.get(key);
      for (const name of DIR_NAMES) {
        const [dx, dy] = DIRS[name];
        const nk = cellKey(x + dx, y + dy);
        if (mask.has(nk) && !dist.has(nk)) {
          dist.set(nk, d + 1);
          queue.push(nk);
        }
      }
    }
    return dist;
  }

  // Builds a mask-packed board that is solvable *by construction* instead of by reject-sampling `tile`'s
  // output: at the fill densities and board sizes THE-118 asks for (90%+ of 300-600 playable cells), an
  // arrow's exit direction from a plain random walk is essentially arbitrary, so almost every dense tiling's
  // "A blocked by B" graph has a cycle somewhere and whole-board reject-sampling stops converging (verified
  // empirically while building the v1.1 ladder -- see tools/rush-lane/gen-levels.mjs's density-ceiling
  // comment). This fixes that by adding arrows one at a time in *removal order, reversed*: each new arrow is
  // only accepted once its own exit lane is already clear of every arrow placed before it. That single local
  // invariant is enough to guarantee the finished board solves: reading the arrows back off in the reverse
  // of their placement order is a valid greedy peel, because by the time the solver reaches an arrow, every
  // arrow placed after it (the only ones allowed to sit in its lane) has already been removed. A starting
  // cell that can't grow a free-lane arrow in `triesPerArrow` tries is left empty (a small gap) rather than
  // placed anyway -- accepting a not-actually-free arrow there would break the invariant this function
  // exists to guarantee, silently reintroducing the cyclic-board risk it's meant to avoid.
  function tilePacked(w, h, rand, minLen, maxLen, bendProbability, density, mask, triesPerArrow, gapFillMaxLen) {
    const tries = triesPerArrow || 15;
    const wallOccupied = new Set();
    let cells;
    if (mask) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!mask.has(cellKey(x, y))) wallOccupied.add(cellKey(x, y));
        }
      }
      const depth = maskDepth(w, h, mask);
      const byDepth = new Map();
      for (const key of mask) {
        const d = depth.get(key);
        if (!byDepth.has(d)) byDepth.set(d, []);
        byDepth.get(d).push(key.split(",").map(Number));
      }
      const depths = [...byDepth.keys()].sort((a, b) => b - a); // deepest (interior) first, boundary (0) last
      cells = [];
      for (const d of depths) cells.push(...shuffle(byDepth.get(d), rand));
    } else {
      const order = [];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) order.push([x, y]);
      cells = shuffle(order, rand);
    }
    const playableCount = mask ? mask.size : w * h;
    const targetCells = Math.round(playableCount * density);

    const board = createBoard(w, h, []);
    const bodyOccupied = new Set(wallOccupied);
    let nextId = 1;
    let filled = 0;

    for (const [x, y] of cells) {
      if (filled >= targetCells) break;
      if (bodyOccupied.has(cellKey(x, y))) continue;

      let best = null;
      for (let t = 0; t < tries; t++) {
        const candidate = growArrow(x, y, bodyOccupied, rand, minLen, maxLen, bendProbability, nextId, w, h);
        // growArrow falls back to a 1-cell stub when a cell is fully boxed in; treat that the same as a
        // failed try here (skip the cell as a gap) rather than bake a stub into the shipped ladder.
        if (candidate.cells.length < minLen) continue;
        board.arrows.set(candidate.id, candidate);
        if (isFree(board, candidate.id)) {
          best = candidate;
          break;
        }
        board.arrows.delete(candidate.id);
      }
      if (!best) continue; // no free-lane growth from this cell -- leave it a gap, try the next candidate
      for (const [cx, cy] of best.cells) bodyOccupied.add(cellKey(cx, cy));
      filled += best.cells.length;
      nextId++;
    }

    // Opt-in second sweep (existing callers that don't pass gapFillMaxLen see byte-identical output): the
    // pass above tries every mask cell exactly once at the level's real length band, so a cell stranded in a
    // pocket too small for that band becomes a permanent gap even though a *shorter* arrow would fit there.
    // Re-trying just the leftover cells with a short band (2..gapFillMaxLen) rescues those pockets -- this is
    // what pushing fill density from the high-0.8s into the low-0.9s needs at these arrow lengths (THE-137).
    if (gapFillMaxLen && mask) {
      for (const [x, y] of cells) {
        if (bodyOccupied.has(cellKey(x, y))) continue;
        let best = null;
        for (let t = 0; t < tries; t++) {
          const candidate = growArrow(x, y, bodyOccupied, rand, 2, gapFillMaxLen, bendProbability, nextId, w, h);
          if (candidate.cells.length < 2) continue;
          board.arrows.set(candidate.id, candidate);
          if (isFree(board, candidate.id)) {
            best = candidate;
            break;
          }
          board.arrows.delete(candidate.id);
        }
        if (!best) continue;
        for (const [cx, cy] of best.cells) bodyOccupied.add(cellKey(cx, cy));
        filled += best.cells.length;
        nextId++;
      }
    }
    return board;
  }

  // Weights for tileConstrained's candidate score, tuned on the L10-L60 masks (THE-195): a permanent door costs
  // more than a plain open lane gains, and 16 is where fill on the xl masks recovers to v1.2 levels (0.86-0.94).
  const DOOR_PENALTY = 3;
  const DEFAULT_DEPTH_PRESSURE = 16;

  // THE-195 (board item 4): a mask packer that makes *most* arrows start blocked. tilePacked only accepts an
  // arrow whose lane is already clear, and packs the rim last, so almost every rim arrow ends up pointing out
  // of the silhouette -- a lane nothing can ever block -- and ~45-60% of each board is open at the start
  // (99% of those are rim arrows pointing out, per THE-194). Here an arrow may be placed blocked, as long as
  // the "A waits for every arrow in its lane" graph stays acyclic, which is all solvability needs (see
  // `solve`): with no cycle, some arrow is always free, and removing it never blocks another, so no dead end
  // is reachable. Each starting cell grows `tries` candidates and keeps the best by `scoreOf` -- blocked
  // beats open, blocking an arrow that is still open scores, a lane that leaves the mask without crossing a
  // single mask cell (a permanent "door") costs, and so does pushing the deepest affected arrow toward the
  // cap (`depthPressure`: without it, the blocked-first preference builds long chains that hit the cap early
  // and strand the cells behind them as gaps, costing ~10 points of fill on the xl masks) -- subject to two
  // hard limits: no cycle, and no arrow deeper than `depthCap - 1` solve layers (layer = 0 when the lane is
  // clear, else 1 + the deepest arrow in the lane, exactly `solve`'s rounds, so depth <= depthCap).
  // The rest (cell order, growth, gap-fill sweep) mirrors tilePacked, but cells go in random order: nothing
  // here needs the interior packed first.
  function tileConstrained(w, h, rand, minLen, maxLen, bendProbability, density, mask, triesPerArrow, gapFillMaxLen, depthCap, depthPressure) {
    const tries = triesPerArrow || 15;
    const cap = depthCap;
    const pressure = depthPressure === undefined ? DEFAULT_DEPTH_PRESSURE : depthPressure;
    const bodyOccupied = new Set();
    const order = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (mask.has(cellKey(x, y))) order.push([x, y]);
        else bodyOccupied.add(cellKey(x, y));
      }
    }
    const cells = shuffle(order, rand);
    const targetCells = Math.round(mask.size * density);

    const arrowAt = new Map(); // cell -> id
    const laneCross = new Map(); // cell -> ids of placed arrows whose lane crosses it
    const waitsOn = new Map(); // id -> Set of ids in its lane
    const waitedBy = new Map(); // id -> Set of ids whose lane it sits in
    const layer = new Map();
    const arrows = [];
    let nextId = 1;
    let filled = 0;

    function laneCells(arrow) {
      const probe = { w, h, arrows: new Map([[arrow.id, arrow]]) };
      return laneOf(probe, arrow.id);
    }

    // Everything placing `arrow` would change, or null if it would self-block, close a cycle or push some
    // arrow past the depth cap. `raised` maps each existing arrow whose layer would go up to its new layer.
    function evaluate(arrow) {
      const lane = laneCells(arrow);
      const own = new Set(arrow.cells.map(([x, y]) => cellKey(x, y)));
      const inLane = new Set();
      let emptyMaskInLane = 0;
      for (const [x, y] of lane) {
        const key = cellKey(x, y);
        if (own.has(key)) return null; // its own body is in the way: could never leave
        const hit = arrowAt.get(key);
        if (hit !== undefined) inLane.add(hit);
        else if (mask.has(key)) emptyMaskInLane++;
      }
      const waiters = new Set();
      for (const key of own) {
        const ids = laneCross.get(key);
        if (ids) for (const id of ids) waiters.add(id);
      }
      let myLayer = 0;
      for (const id of inLane) myLayer = Math.max(myLayer, layer.get(id) + 1);
      if (myLayer >= cap) return null;
      // Raise every arrow that (transitively) waits on the new one; reaching one it waits on is a cycle.
      const raised = new Map();
      const stack = [];
      for (const id of waiters) {
        if (inLane.has(id)) return null;
        stack.push([id, myLayer + 1]);
      }
      while (stack.length) {
        const [id, need] = stack.pop();
        if ((raised.has(id) ? raised.get(id) : layer.get(id)) >= need) continue;
        if (need >= cap) return null;
        raised.set(id, need);
        for (const up of waitedBy.get(id)) {
          if (inLane.has(up)) return null;
          stack.push([up, need + 1]);
        }
      }
      // Cycles can also run through arrows whose layer didn't need raising: check reachability outright.
      if (inLane.size && waiters.size) {
        const seen = new Set();
        const walk = [...waiters];
        while (walk.length) {
          const id = walk.pop();
          if (seen.has(id)) continue;
          seen.add(id);
          if (inLane.has(id)) return null;
          for (const up of waitedBy.get(id)) walk.push(up);
        }
      }
      return { arrow, lane, inLane, waiters, myLayer, raised, door: inLane.size === 0 && emptyMaskInLane === 0 };
    }

    function scoreOf(ev) {
      let openBlocked = 0;
      for (const id of ev.waiters) if (waitsOn.get(id).size === 0) openBlocked++;
      let peak = ev.myLayer;
      for (const l of ev.raised.values()) peak = Math.max(peak, l);
      return (ev.inLane.size > 0 ? 2 : 0) + openBlocked - (ev.door ? DOOR_PENALTY : 0) - (pressure * peak) / cap;
    }

    function place(ev) {
      const { arrow } = ev;
      arrows.push(arrow);
      for (const [x, y] of arrow.cells) {
        bodyOccupied.add(cellKey(x, y));
        arrowAt.set(cellKey(x, y), arrow.id);
      }
      for (const [x, y] of ev.lane) {
        const key = cellKey(x, y);
        if (!laneCross.has(key)) laneCross.set(key, []);
        laneCross.get(key).push(arrow.id);
      }
      waitsOn.set(arrow.id, new Set(ev.inLane));
      waitedBy.set(arrow.id, new Set(ev.waiters));
      for (const id of ev.inLane) waitedBy.get(id).add(arrow.id);
      for (const id of ev.waiters) waitsOn.get(id).add(arrow.id);
      layer.set(arrow.id, ev.myLayer);
      for (const [id, l] of ev.raised) layer.set(id, l);
      filled += arrow.cells.length;
      nextId++;
    }

    function pickArrow(x, y, lo, hi) {
      let best = null;
      let bestScore = -Infinity;
      for (let t = 0; t < tries; t++) {
        const candidate = growArrow(x, y, bodyOccupied, rand, lo, hi, bendProbability, nextId, w, h);
        if (candidate.cells.length < lo) continue; // boxed in: leave a gap rather than bake a stub
        const ev = evaluate(candidate);
        if (!ev) continue;
        const score = scoreOf(ev);
        if (score > bestScore) {
          best = ev;
          bestScore = score;
        }
      }
      return best;
    }

    for (const [x, y] of cells) {
      if (filled >= targetCells) break;
      if (bodyOccupied.has(cellKey(x, y))) continue;
      const best = pickArrow(x, y, minLen, maxLen);
      if (best) place(best);
    }
    if (gapFillMaxLen) {
      for (const [x, y] of cells) {
        if (bodyOccupied.has(cellKey(x, y))) continue;
        const best = pickArrow(x, y, 2, gapFillMaxLen);
        if (best) place(best);
      }
    }
    return createBoard(w, h, arrows);
  }

  // The "arrow A touches arrow B" graph: two arrows are neighbours when any of A's cells is 4-adjacent to
  // one of B's. Used only for colour assignment below.
  function neighborArrows(board) {
    const occ = occupancyMap(board);
    const neighbors = new Map();
    for (const id of board.arrows.keys()) neighbors.set(id, new Set());
    for (const arrow of board.arrows.values()) {
      for (const [x, y] of arrow.cells) {
        for (const name of DIR_NAMES) {
          const [dx, dy] = DIRS[name];
          const hit = occ.get(cellKey(x + dx, y + dy));
          if (hit !== undefined && hit !== arrow.id) neighbors.get(arrow.id).add(hit);
        }
      }
    }
    return neighbors;
  }

  // Greedy graph colouring per THE-119's spec (DESIGN.md 15.2): visit arrows by most touching neighbours
  // first (the hardest-to-colour ones get first pick); for each, prefer a colour that (1) no touching
  // neighbour uses and (2) doesn't form a `neverAdjacent` pair with any neighbour's colour, tie-broken by (3)
  // whichever such colour is least used so far (keeps the palette balanced). Relaxes (2) before (1) when
  // nothing satisfies both, and as a last resort (a local neighbourhood denser than the palette) picks the
  // least-used colour overall, accepting an occasional clash rather than growing the palette. Returns a new
  // board; does not mutate the input. `neverAdjacent` is a list of [colourA, colourB] 0-indexed pairs (the
  // CVD-unsafe pairs from THE-119's contrast check) to avoid placing next to each other when avoidable.
  function assignColors(board, paletteSize, neverAdjacent) {
    const size = paletteSize || 12;
    const neighbors = neighborArrows(board);
    const neverSet = new Set((neverAdjacent || []).map(([a, b]) => (a < b ? a + "," + b : b + "," + a)));
    const isNeverAdjacent = (c1, c2) => neverSet.has(c1 < c2 ? c1 + "," + c2 : c2 + "," + c1);

    const ids = [...board.arrows.keys()].sort((a, b) => neighbors.get(b).size - neighbors.get(a).size);
    const colors = new Map();
    const usage = new Array(size).fill(0);
    for (const id of ids) {
      const neighborColors = new Set();
      for (const n of neighbors.get(id)) if (colors.has(n)) neighborColors.add(colors.get(n));

      let best = null;
      for (let relax = 0; relax < 2 && best === null; relax++) {
        for (let c = 0; c < size; c++) {
          if (neighborColors.has(c)) continue;
          if (relax === 0) {
            let clash = false;
            for (const nc of neighborColors) if (isNeverAdjacent(c, nc)) { clash = true; break; }
            if (clash) continue;
          }
          if (best === null || usage[c] < usage[best]) best = c;
        }
      }
      if (best === null) {
        best = 0;
        for (let c = 1; c < size; c++) if (usage[c] < usage[best]) best = c;
      }
      colors.set(id, best);
      usage[best]++;
    }
    const arrows = [...board.arrows.values()].map((a) => Object.assign({}, a, { color: colors.get(a.id) }));
    return createBoard(board.w, board.h, arrows);
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

  // Generates a solvable, cycle-free board. `rand` is a 0..1 RNG (see `rng` above). `accept(metrics, board)`
  // is an optional predicate for a target difficulty band (the board is passed too, for checks metrics
  // doesn't carry, e.g. per-row coverage against a mask); without it, any solvable board is returned. Keeps
  // retrying (drawing further from the same `rand` stream) until `accept` passes or `maxAttempts` is spent,
  // in which case it falls back to the *best-fill* solvable board seen (highest `metrics.fillDensity`, first
  // attempt wins ties) rather than just the first one, so a level never fails to generate but also doesn't
  // settle for an early, sparser pack when a later attempt (still within maxAttempts) filled more of the
  // mask. Deterministic: `rand` is only ever advanced by the attempt loop, so the same seed always walks the
  // same attempt sequence and picks the same best-fill board (THE-147).
  // `opts.mask` packs the board inside a silhouette instead of the full w*h rectangle (see `tile`).
  // `opts.paletteSize`, when set, colours the returned board's arrows via `assignColors`.
  // `opts.depthCap` (with a mask) switches packing to `tileConstrained` -- most arrows blocked at the start,
  // solve depth <= depthCap -- and `opts.depthPressure` overrides its depth weight. `opts.rank(metrics, board)`
  // replaces fill density as the fallback's "best" measure when no attempt passes `accept` (higher wins).
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
    const mask = opts.mask;
    const paletteSize = opts.paletteSize;
    const neverAdjacent = opts.neverAdjacent;
    const gapFillMaxLen = opts.gapFillMaxLen;
    const playableCells = mask ? mask.size : w * h;
    const rank = opts.rank || ((m) => m.fillDensity);

    let fallback = null;
    let attemptsMade = 0;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      attemptsMade = attempt + 1;
      // A mask means a large, dense, irregular board is likely -- exactly the case plain `tile` reject-
      // sampling stops converging on (see `tilePacked`'s comment), so build those by construction instead.
      const board = mask && opts.depthCap
        ? tileConstrained(w, h, rand, minLen, maxLen, bendProbability, density, mask, opts.triesPerArrow, gapFillMaxLen, opts.depthCap, opts.depthPressure)
        : mask
        ? tilePacked(w, h, rand, minLen, maxLen, bendProbability, density, mask, opts.triesPerArrow, gapFillMaxLen)
        : tile(w, h, rand, minLen, maxLen, bendProbability, density);
      const metrics = analyze(board, playableCells);
      if (!metrics.solvable) continue;
      const score = rank(metrics, board);
      if (!fallback || score > fallback.score) fallback = { board, metrics, score };
      if (!accept || accept(metrics, board)) {
        const finalBoard = paletteSize ? assignColors(board, paletteSize, neverAdjacent) : board;
        return { board: finalBoard, metrics, attempts: attemptsMade };
      }
    }
    if (!fallback) return null;
    const finalBoard = paletteSize ? assignColors(fallback.board, paletteSize, neverAdjacent) : fallback.board;
    return { board: finalBoard, metrics: fallback.metrics, attempts: attemptsMade };
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
    neighborArrows,
    assignColors,
    tilePacked,
    tileConstrained,
    generate,
    rng,
  };
});
