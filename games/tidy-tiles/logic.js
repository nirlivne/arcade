// Tidy Tiles: pure game logic (no DOM). Classic script (works from file://) and CommonJS for node tests.
var TidyLogic = (function () {
const SIZE = 8;
const COLORS = 4; // piece colours are 1..COLORS
const STONE = 9; // locked cell: counts as filled for lines, is never removed
const HAND = 3;
const GOAL_TARGET = 3; // lines containing the goal colour needed per bonus

function hashString(s) {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rngFor = (seed, salt) => mulberry32(hashString(seed + '|' + salt));

const parse = (rows, weight = 1) => {
  const cells = [];
  rows.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === '#') cells.push([r, c]); }));
  return { cells, h: rows.length, w: rows[0].length, weight };
};

const SHAPES = [
  parse(['#']),
  parse(['##']), parse(['#', '#']),
  parse(['###']), parse(['#', '#', '#']),
  parse(['####']), parse(['#', '#', '#', '#']),
  parse(['#####'], 0.6), parse(['#', '#', '#', '#', '#'], 0.6),
  parse(['##', '##']), parse(['###', '###', '###'], 0.5),
  parse(['###', '###']), parse(['##', '##', '##']),
  parse(['##', '#.']), parse(['##', '.#']), parse(['#.', '##']), parse(['.#', '##']),
  parse(['###', '.#.']),
  parse(['#..', '#..', '###'], 0.7),
];

const emptyCells = () => new Array(SIZE * SIZE).fill(0);

function canPlace(cells, shape, r, c) {
  for (const [dr, dc] of shape.cells) {
    const rr = r + dr, cc = c + dc;
    if (rr < 0 || cc < 0 || rr >= SIZE || cc >= SIZE || cells[rr * SIZE + cc] !== 0) return false;
  }
  return true;
}

function fitsAnywhere(cells, shape) {
  for (let r = 0; r <= SIZE - shape.h; r++)
    for (let c = 0; c <= SIZE - shape.w; c++)
      if (canPlace(cells, shape, r, c)) return true;
  return false;
}

// Rows and columns that are completely filled.
function fullLines(cells) {
  const rows = [], cols = [];
  for (let r = 0; r < SIZE; r++) {
    let full = true;
    for (let c = 0; c < SIZE; c++) if (cells[r * SIZE + c] === 0) { full = false; break; }
    if (full) rows.push(r);
  }
  for (let c = 0; c < SIZE; c++) {
    let full = true;
    for (let r = 0; r < SIZE; r++) if (cells[r * SIZE + c] === 0) { full = false; break; }
    if (full) cols.push(c);
  }
  return { rows, cols };
}

const MUTATORS = ['stone', 'bonus', 'pattern', 'goal'];

// Mutators for a seed: 2 or 3 of the four, drawn deterministically.
function makeMutators(seed) {
  const rng = rngFor(seed, 'mut');
  const pool = [...MUTATORS];
  const count = rng() < 0.35 ? 3 : 2;
  const kinds = [];
  while (kinds.length < count) kinds.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  const taken = new Set();
  const pick = () => { let i; do { i = Math.floor(rng() * SIZE * SIZE); } while (taken.has(i)); taken.add(i); return i; };
  const mut = { kinds, stones: [], pattern: [], bonusRow: null, goalColor: null };
  if (kinds.includes('stone')) for (let n = 0; n < 5; n++) mut.stones.push(pick());
  if (kinds.includes('pattern')) for (let n = 0; n < 10; n++) mut.pattern.push([pick(), 1 + Math.floor(rng() * COLORS)]);
  if (kinds.includes('bonus')) mut.bonusRow = 1 + Math.floor(rng() * (SIZE - 2));
  if (kinds.includes('goal')) mut.goalColor = 1 + Math.floor(rng() * COLORS);
  return mut;
}

// The set of three offered shapes for a given index. Depends only on (seed, index) unless the board
// makes every drawn shape unplaceable, in which case it re-draws (still deterministic) until one fits.
function drawSet(seed, index, cells) {
  const total = SHAPES.reduce((a, s) => a + s.weight, 0);
  for (let attempt = 0; attempt < 200; attempt++) {
    const rng = rngFor(seed, 'set' + index + ':' + attempt);
    const hand = [];
    for (let k = 0; k < HAND; k++) {
      let x = rng() * total, si = 0;
      while (si < SHAPES.length - 1 && x >= SHAPES[si].weight) { x -= SHAPES[si].weight; si++; }
      hand.push({ shape: si, color: 1 + Math.floor(rng() * COLORS) });
    }
    if (hand.some((p) => fitsAnywhere(cells, SHAPES[p.shape]))) return hand;
  }
  // Practically unreachable: offer the smallest shapes so a free cell can always be used.
  return [{ shape: 0, color: 1 }, { shape: 0, color: 2 }, { shape: 1, color: 3 }];
}

function createGame(seed, mode = 'daily') {
  const mut = makeMutators(seed);
  const cells = emptyCells();
  mut.stones.forEach((i) => { cells[i] = STONE; });
  mut.pattern.forEach(([i, col]) => { cells[i] = col; });
  const g = { seed, mode, mut, cells, score: 0, moves: 0, setIndex: 0, goalCount: 0, over: false, hand: null, lastClear: null, history: [] };
  g.hand = drawSet(seed, 0, cells);
  checkOver(g);
  return g;
}

// The run ends when none of the shapes still in the hand fits anywhere.
function checkOver(g) {
  g.over = !g.hand.some((p) => p && fitsAnywhere(g.cells, SHAPES[p.shape]));
  return g.over;
}

// Place hand[idx] with its top-left at (r, c). Returns the result, or null if illegal.
function place(g, idx, r, c) {
  const piece = g.hand[idx];
  if (g.over || !piece) return null;
  const shape = SHAPES[piece.shape];
  if (!canPlace(g.cells, shape, r, c)) return null;
  for (const [dr, dc] of shape.cells) g.cells[(r + dr) * SIZE + c + dc] = piece.color;
  g.hand[idx] = null;
  g.moves++;
  let points = shape.cells.length;
  const { rows, cols } = fullLines(g.cells);
  const lines = rows.length + cols.length;
  const clearSet = new Set();
  let goalHits = 0, bonus = false;
  const idxs = [...Array(SIZE).keys()];
  const lineList = [...rows.map((r0) => idxs.map((k) => r0 * SIZE + k)), ...cols.map((c0) => idxs.map((k) => k * SIZE + c0))];
  for (const line of lineList) {
    if (g.mut.goalColor && line.some((i) => g.cells[i] === g.mut.goalColor)) goalHits++;
    line.forEach((i) => clearSet.add(i));
  }
  const cleared = [...clearSet].filter((i) => g.cells[i] !== STONE).map((i) => ({ i, color: g.cells[i] }));
  if (lines) {
    // 1 line 10, 2 lines 40, 3 lines 90, 4 lines 160...
    let clearPoints = 10 * lines * lines;
    if (g.mut.bonusRow !== null && rows.includes(g.mut.bonusRow)) { clearPoints *= 2; bonus = true; }
    points += clearPoints;
    cleared.forEach(({ i }) => { g.cells[i] = 0; });
  }
  let goalReached = false;
  if (goalHits) {
    const before = Math.floor(g.goalCount / GOAL_TARGET);
    g.goalCount += goalHits;
    const times = Math.floor(g.goalCount / GOAL_TARGET) - before;
    if (times > 0) { points += 100 * times; goalReached = true; }
  }
  g.score += points;
  if (g.hand.every((p) => p === null)) { g.setIndex++; g.hand = drawSet(g.seed, g.setIndex, g.cells); }
  checkOver(g);
  g.history.push(goalReached ? 4 : Math.min(lines, 3));
  g.lastClear = { rows, cols, cells: cleared, points, lines, bonus, goalReached };
  return g.lastClear;
}

// Spoiler-free share text: one square per move (result of that move), no pieces, seed, mutators or board.
const MOVE_EMOJI = ['⬜', '🟨', '🟧', '🟥', '🟩'];
function shareGrid(history, perRow = 8, maxMoves = 40) {
  const h = history.slice(-maxMoves);
  const rows = [];
  for (let i = 0; i < h.length; i += perRow) rows.push(h.slice(i, i + perRow).map((v) => MOVE_EMOJI[v]).join(''));
  return rows.join('\n');
}

function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function prevDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return localDate(new Date(y, m - 1, d - 1));
}

// Streak after finishing a daily run on `today`. state: { last, count } or null.
function nextStreak(state, today) {
  if (state && state.last === today) return state;
  if (state && state.last === prevDate(today)) return { last: today, count: state.count + 1 };
  return { last: today, count: 1 };
}

return { SIZE, COLORS, STONE, HAND, GOAL_TARGET, hashString, mulberry32, rngFor, SHAPES, emptyCells, canPlace, fitsAnywhere, fullLines, MUTATORS, makeMutators, drawSet, createGame, checkOver, place, shareGrid, localDate, prevDate, nextStreak };
})();
if (typeof module !== "undefined" && module.exports) module.exports = TidyLogic;
