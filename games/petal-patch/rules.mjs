// Petal Patch board geometry: an n x n grid split into n beds (one per row/col, like the other units).
// Pure, no DOM, no randomness. `beds` is a Uint8Array/array of length n*n, beds[i] in [0, n).

export function idx(r, c, n) {
  return r * n + c;
}

export function rc(i, n) {
  return [Math.floor(i / n), i % n];
}

// Every cell a ladybug at `i` rules out: same row, same column, same bed, and the 8 neighbours.
export function attackSet(i, n, beds) {
  const [r, c] = rc(i, n);
  const out = new Set();
  for (let k = 0; k < n * n; k++) {
    if (k === i) continue;
    const [kr, kc] = rc(k, n);
    if (kr === r || kc === c || beds[k] === beds[i] || (Math.abs(kr - r) <= 1 && Math.abs(kc - c) <= 1)) out.add(k);
  }
  return out;
}

// Union of attackSet(b) for every placed ladybug b. Always derived, never stored (spec §2 "Auto-x").
export function autoX(bugs, n, beds) {
  const out = new Set();
  for (const b of bugs) for (const k of attackSet(b, n, beds)) out.add(k);
  return out;
}

export function isSolved(bugs, n) {
  return bugs.length === n;
}

// The 3n units a board must satisfy: n rows, n columns, n beds.
export function units(n, beds) {
  const list = [];
  for (let r = 0; r < n; r++) list.push({ kind: "row", id: r, cells: Array.from({ length: n }, (_, c) => idx(r, c, n)) });
  for (let c = 0; c < n; c++) list.push({ kind: "col", id: c, cells: Array.from({ length: n }, (_, r) => idx(r, c, n)) });
  const bedCells = Array.from({ length: n }, () => []);
  for (let i = 0; i < n * n; i++) bedCells[beds[i]].push(i);
  for (let g = 0; g < n; g++) list.push({ kind: "bed", id: g, cells: bedCells[g] });
  return list;
}

// A unit is "done" once one of the placed ladybugs sits in it.
export function unitDone(unit, bugSet) {
  return unit.cells.some((i) => bugSet.has(i));
}

// Live (candidate) cells: not a placed ladybug, not in `dead` (typically autoX(bugs) plus any other
// known-eliminated cells the caller folds in, e.g. red mistake cells).
export function liveCells(n, bugs, dead) {
  const bugSet = new Set(bugs);
  const deadSet = dead instanceof Set ? dead : new Set(dead);
  const live = new Array(n * n).fill(true);
  for (const b of bugSet) live[b] = false;
  for (const d of deadSet) live[d] = false;
  return live;
}

// Bed adjacency graph: two beds are adjacent if any of their cells share an edge (not diagonal — that's
// for the colour-adjacency rule in spec §3, which is about the printed hedge borders, not the no-touch rule).
export function bedAdjacency(n, beds) {
  const adj = Array.from({ length: n }, () => new Set());
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const i = idx(r, c, n);
      if (c + 1 < n) {
        const j = idx(r, c + 1, n);
        if (beds[i] !== beds[j]) { adj[beds[i]].add(beds[j]); adj[beds[j]].add(beds[i]); }
      }
      if (r + 1 < n) {
        const j = idx(r + 1, c, n);
        if (beds[i] !== beds[j]) { adj[beds[i]].add(beds[j]); adj[beds[j]].add(beds[i]); }
      }
    }
  }
  return adj;
}

// 9 bed colour slots (spec §3 "beds coloured by graph colouring"), index order fixed by the designer's
// tokens.css --bed-0..--bed-8 (THE-177): 0 sage, 1 butter, 2 borage, 3 lavender, 4 clay, 5 mint, 6 rose,
// 7 gravel, 8 moss. `data-bed` on a cell is this colour index, not the raw bed id (DESIGN.md §1.5).
// Banned adjacent pairs (spec §3): borage/lavender, sage/rose, gravel/moss, borage/rose, lavender/gravel.
export const BED_COLOR_NAMES = ["sage", "butter", "borage", "lavender", "clay", "mint", "rose", "gravel", "moss"];
const BANNED_PAIRS = [[2, 3], [0, 6], [7, 8], [2, 6], [3, 7]];
const NUM_COLORS = BED_COLOR_NAMES.length;

function isBannedPair(a, b) {
  return BANNED_PAIRS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

// One greedy colouring pass over bed adjacency, avoiding the banned pairs above. For each bed, prefers a
// colour no other bed has used yet (so a 9-bed board reaches for all 9 slots, not just the lowest few --
// THE-186), falling back to the first legal colour (reuse) if every unused one conflicts.
function bedColorsOnce(n, beds, order) {
  const adj = bedAdjacency(n, beds);
  const seq = order || [...Array(n).keys()].sort((a, b) => adj[b].size - adj[a].size);
  const color = new Array(n).fill(-1);
  const used = new Array(NUM_COLORS).fill(false);
  for (const bed of seq) {
    let chosen = -1;
    for (const preferUnused of [true, false]) {
      for (let c = 0; c < NUM_COLORS; c++) {
        if (preferUnused && used[c]) continue;
        let ok = true;
        for (const nb of adj[bed]) {
          if (color[nb] === -1) continue;
          if (color[nb] === c || isBannedPair(c, color[nb])) { ok = false; break; }
        }
        if (ok) { chosen = c; break; }
      }
      if (chosen !== -1) break;
    }
    color[bed] = chosen === -1 ? 0 : chosen;
    if (chosen !== -1) used[chosen] = true;
  }
  return color;
}

// Deterministic seeded shuffle of the bed order, used only to retry colouring (see bedColors below) --
// seeded from n and the actual bed layout, not the wall clock or a passed-in RNG, so the generator,
// --verify and render.js always land on the same colours for a given board without shipping them.
function seededOrder(n, beds, attempt) {
  let seed = (attempt * 2654435761 + n * 97) >>> 0;
  for (let i = 0; i < beds.length; i++) seed = (seed * 31 + beds[i]) >>> 0;
  const next = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const order = [...Array(n).keys()];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

const MAX_RETRIES = 24;

// Bed colouring: every bed gets its own colour (n <= 9, 9 slots) with 0 banned-pair violations. If an
// explicit `order` is passed, colours that order once (unchanged behaviour, used by callers that already
// picked an order). Otherwise retries bedColorsOnce with seeded shuffles of the bed order until a pass
// comes back all-distinct with no violations, keeping the least-bad attempt if none does (measured over
// all 668 shipped boards: 0 violations, all-distinct, at most 18 retries -- THE-186).
export function bedColors(n, beds, order) {
  if (order) return bedColorsOnce(n, beds, order);
  let best = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const seq = attempt === 0 ? undefined : seededOrder(n, beds, attempt);
    const color = bedColorsOnce(n, beds, seq);
    const violations = bedColorViolations(n, beds, color).length;
    const distinct = new Set(color).size;
    if (violations === 0 && distinct === Math.min(n, NUM_COLORS)) return color;
    if (!best || violations < best.violations || (violations === best.violations && distinct > best.distinct)) {
      best = { color, violations, distinct };
    }
  }
  return best.color;
}

export function bedColorViolations(n, beds, color) {
  const adj = bedAdjacency(n, beds);
  const out = [];
  for (let a = 0; a < n; a++) {
    for (const b of adj[a]) {
      if (b > a && isBannedPair(color[a], color[b])) out.push([a, b]);
    }
  }
  return out;
}
