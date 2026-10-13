// The maze: 25x15 ASCII rows. '#' wall, '.' chip, 'o' ALL IN, '=' seat door, 'S' dealer's seat, 'T' tunnel
// mouth (paired on one wrap row), ' ' empty floor (walkable, no chip - e.g. round the seat and the tunnel
// mouths). Pure.
export const TILE = 240; // 1 tile = 240 sub-units

// Maze A (the designer's revision, THE-687, replacing the S1 feel check's graph-paper layout): an oval
// felt table, the seat centred, rounded-cushion corners, 148 chips. Maze B (S6): the same seat/door/tunnel
// geometry, a messier "kitchen table" floor plan, 150 chips. Both share seat (12,7), door (12,6), and the
// chomper start / bonus spot (12,9); both validator-clean (design/all-in-chomp/mazes.mjs).
export const MAZE_A = [
  "#########################",
  "##o.........#.........o##",
  "#..##.####.....####.##..#",
  "#.###.####.#.#.####.###.#",
  "#.......................#",
  "#.##.#.#         #.#.##.#",
  "#.##.#.# ###=### #.#.##.#",
  "T   ...# ###S### #...   T",
  "#.##.#.# ####### #.#.##.#",
  "#.##.#.#         #.#.##.#",
  "#.......................#",
  "#.###.####.#.#.####.###.#",
  "#..##.####.....####.##..#",
  "##o.........#.........o##",
  "#########################",
];

export const MAZE_B = [
  "#########################",
  "#o...#.............#...o#",
  "#.##.#.##.#####.##.#.##.#",
  "#.##...##.#####.##...##.#",
  "#....#...... ......#....#",
  "##.#.#.#         #.#.#.##",
  "#..#...# ###=### #...#..#",
  "T  #   # ###S### #   #  T",
  "#....#.# ####### #.#....#",
  "#.##.#.#         #.#.##.#",
  "#.##.......# #.......##.#",
  "#....##.##.#.#.##.##....#",
  "#.##.##.##.....##.##.##.#",
  "#o.....................o#",
  "#########################",
];

const WALKABLE = new Set([".", "o", "=", "S", "T", " "]);
// The seat and its door are a ghost-only room (THE-690 #8): the chomper can walk everywhere a ghost can
// except in there, so it can never camp inside the dealer's seat.
const WALKABLE_CHOMPER = new Set([".", "o", "T", " "]);

export function parse(rows) {
  const h = rows.length;
  const w = rows[0].length;
  const cells = rows.map((r) => r.split(""));
  let seat = null;
  let door = null;
  const tunnels = [];
  const allIn = [];
  let chipCount = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = cells[y][x];
      if (ch === "S") seat = { x, y };
      if (ch === "=") door = { x, y };
      if (ch === "T") tunnels.push({ x, y });
      if (ch === "o") allIn.push({ x, y });
      if (ch === ".") chipCount++;
    }
  }
  function at(x, y) {
    if (y < 0 || y >= h || x < 0 || x >= w) return "#";
    return cells[y][x];
  }
  function walkable(x, y) {
    return WALKABLE.has(at(x, y));
  }
  function walkableChomper(x, y) {
    return WALKABLE_CHOMPER.has(at(x, y));
  }
  // Neighbours in grid space, honouring the tunnel wrap (the only place x wraps around).
  function neighbors(x, y) {
    const out = [];
    if (tunnels.length === 2 && tunnels[0].y === tunnels[1].y && y === tunnels[0].y) {
      if (x === tunnels[0].x) out.push({ x: tunnels[1].x, y });
      if (x === tunnels[1].x) out.push({ x: tunnels[0].x, y });
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < w && ny >= 0 && ny < h) out.push({ x: nx, y: ny });
    }
    return out;
  }
  // BFS distance-to-seat field, computed once (the maze never changes): eyes glide home downhill on it.
  const distToSeat = new Map();
  if (seat) {
    distToSeat.set(`${seat.x},${seat.y}`, 0);
    const q = [[seat.x, seat.y]];
    for (let qi = 0; qi < q.length; qi++) {
      const [x, y] = q[qi];
      const d = distToSeat.get(`${x},${y}`);
      for (const n of neighbors(x, y)) {
        if (!walkable(n.x, n.y)) continue;
        const key = `${n.x},${n.y}`;
        if (distToSeat.has(key)) continue;
        distToSeat.set(key, d + 1);
        q.push([n.x, n.y]);
      }
    }
  }

  return { w, h, rows: cells.map((r) => r.join("")), seat, door, tunnels, allIn, chipCount, at, walkable, walkableChomper, neighbors, distToSeat };
}

// G7: every chip reachable from the start, no dead ends among chip/ALL-IN cells, tunnels pair on one wrap
// row, exactly 4 ALL IN, chip count 130-150. The seat is exempt from the dead-end check (it's a room).
export function validate(maze, start) {
  const errors = [];
  if (maze.allIn.length !== 4) errors.push(`expected 4 ALL IN, found ${maze.allIn.length}`);
  if (maze.chipCount < 130 || maze.chipCount > 150) errors.push(`chip count ${maze.chipCount} out of range 130-150`);
  if (!(maze.tunnels.length === 2 && maze.tunnels[0].y === maze.tunnels[1].y)) {
    errors.push(`expected a tunnel pair on one row, found ${JSON.stringify(maze.tunnels)}`);
  }

  const seen = new Set();
  const stack = [start];
  while (stack.length) {
    const p = stack.pop();
    const key = `${p.x},${p.y}`;
    if (seen.has(key)) continue;
    if (!maze.walkable(p.x, p.y)) continue;
    seen.add(key);
    for (const n of maze.neighbors(p.x, p.y)) stack.push(n);
  }
  let unreached = 0;
  for (let y = 0; y < maze.h; y++) {
    for (let x = 0; x < maze.w; x++) {
      const ch = maze.at(x, y);
      if ((ch === "." || ch === "o") && !seen.has(`${x},${y}`)) unreached++;
    }
  }
  if (unreached > 0) errors.push(`${unreached} chip(s) unreachable from the start`);

  const deadEnds = [];
  for (let y = 0; y < maze.h; y++) {
    for (let x = 0; x < maze.w; x++) {
      const ch = maze.at(x, y);
      if (ch !== "." && ch !== "o") continue;
      const deg = maze.neighbors(x, y).filter((n) => maze.walkable(n.x, n.y)).length;
      if (deg < 2) deadEnds.push({ x, y });
    }
  }
  if (deadEnds.length > 0) errors.push(`${deadEnds.length} dead end(s): ${JSON.stringify(deadEnds)}`);

  return { ok: errors.length === 0, errors };
}
