// Grid movement in integer sub-units (G2). 1 tile = 240 u, tile centres at col*240+120 / row*240+120.
// Buffered turn (kept until legal or replaced), pre-turn within 0.35 tile (84 u) of the next centre (corner
// cut: both axes move, nothing snaps), instant reverse (even mid-tile), walls stop the actor at the centre.
// Pure.
import { TILE } from "./maze.js";

const HALF = TILE / 2;
const PRE_TURN = Math.round(0.35 * TILE); // 84 u

const AXIS_SIGN = {
  left: { axis: "x", sign: -1 },
  right: { axis: "x", sign: 1 },
  up: { axis: "y", sign: -1 },
  down: { axis: "y", sign: 1 },
};
const PERP = { left: ["up", "down"], right: ["up", "down"], up: ["left", "right"], down: ["left", "right"] };
export const OPPOSITE = { left: "right", right: "left", up: "down", down: "up" };
export const DELTA = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

export function tileIndexOf(pos) {
  return Math.floor(pos / TILE);
}
export function centerOf(tileIndex) {
  return tileIndex * TILE + HALF;
}
export function tileCenter(col, row) {
  return { x: centerOf(col), y: centerOf(row) };
}
// The centre-aligned segment a position falls in: centerOf(k) <= pos < centerOf(k+1). Unlike tileIndexOf
// (which flips at tile boundaries, i.e. HALFWAY between two centres), this flips nowhere relevant to
// movement decisions, so it's the right basis for "how far to the next centre" mid-transit (stepActor's own
// use below).
export function segIndexOf(pos) {
  return Math.floor((pos - HALF) / TILE);
}
export function isAtCentre(pos) {
  return (pos - HALF) % TILE === 0;
}
// Both axes centred: a full decision point. sim.js's moveGhosts uses this to gate eyesDirection specifically
// (see its own comment) - the one direction-picking case that genuinely needs the later, centre-exact tile
// rather than the early-flipping tileIndexOf every other ghost behaviour uses.
export function actorAtCentre(actor) {
  return isAtCentre(actor.x) && isAtCentre(actor.y);
}

function wrapTunnel(maze, col, row, dir) {
  if (maze.tunnels.length !== 2 || maze.tunnels[0].y !== maze.tunnels[1].y || row !== maze.tunnels[0].y) return null;
  const [a, b] = maze.tunnels;
  if (col === a.x && dir === "left") return { x: b.x, y: row };
  if (col === b.x && dir === "right") return { x: a.x, y: row };
  return null;
}

// Can the actor leave tile (col,row) heading dir? Walls and the grid edge (outside a tunnel wrap) block it.
// forGhost (default true) picks maze.walkable (includes the seat/door) vs maze.walkableChomper (excludes
// them - THE-690 #8: the seat is a ghost-only room, the chomper can't camp inside it).
export function canEnter(maze, col, row, dir, forGhost = true) {
  const passable = forGhost ? maze.walkable : maze.walkableChomper;
  const wrapped = wrapTunnel(maze, col, row, dir);
  if (wrapped) return passable(wrapped.x, wrapped.y);
  const [dx, dy] = DELTA[dir];
  const nx = col + dx, ny = row + dy;
  if (nx < 0 || nx >= maze.w || ny < 0 || ny >= maze.h) return false;
  return passable(nx, ny);
}

// The tile reached from (col,row) heading dir, honouring the tunnel wrap, or null if blocked. Used by BFS
// pathing (the gate bot) as well as movement itself.
export function stepTile(maze, col, row, dir, forGhost = true) {
  if (!canEnter(maze, col, row, dir, forGhost)) return null;
  const wrapped = wrapTunnel(maze, col, row, dir);
  if (wrapped) return wrapped;
  const [dx, dy] = DELTA[dir];
  return { x: col + dx, y: row + dy };
}

// Advances actor by `speed` sub-units this step. actor: { x, y, dir, want, carryAxis?, carrySign?, carry? }.
// opts.preTurn (default true) gates the 0.35-tile corner cut: the chomper gets it, but ghost decisions
// (G2/spec §3) happen only at tile centres, confirmed by the S1 feel check (THE-689) - a shared pre-turn
// let the ghost cut corners as early as the chomper, erasing the chomper's only cornering edge. opts.forGhost
// (default true) picks which tiles count as walkable (THE-690 #8: the seat/door are a ghost-only room).
// Mutates and returns actor.
export function stepActor(maze, actor, speed, opts = {}) {
  const preTurn = opts.preTurn !== false;
  const forGhost = opts.forGhost !== false;
  let remaining = speed;
  let guard = 0;
  while (remaining > 0 && guard++ < 10000) {
    const col = tileIndexOf(actor.x), row = tileIndexOf(actor.y);

    if (!actor.dir) {
      if (actor.want && canEnter(maze, col, row, actor.want, forGhost)) {
        actor.dir = actor.want;
        continue;
      }
      break;
    }

    // Reverse is instant, anywhere mid-tile: the tile behind is always the one just departed, always legal.
    if (actor.want === OPPOSITE[actor.dir]) {
      actor.dir = actor.want;
      actor.carry = 0;
      actor.carryAxis = null;
      actor.carrySign = 0;
      continue;
    }

    let { axis, sign } = AXIS_SIGN[actor.dir];
    let distanceAhead, jCol, jRow;

    if (isAtCentre(actor[axis])) {
      // A full decision point (both axes exactly centred here).
      if (actor.want && actor.want !== actor.dir && canEnter(maze, col, row, actor.want, forGhost)) {
        actor.dir = actor.want;
        ({ axis, sign } = AXIS_SIGN[actor.dir]);
      } else if (!canEnter(maze, col, row, actor.dir, forGhost)) {
        actor.dir = null; // wall ahead: stop exactly at the centre, want stays buffered
        break;
      }
      const wrapped = wrapTunnel(maze, col, row, actor.dir);
      if (wrapped) {
        const c = tileCenter(wrapped.x, wrapped.y);
        actor.x = c.x;
        actor.y = c.y;
      }
      distanceAhead = TILE; // freshly departing a centre: a full tile to the next one
      const [dx, dy] = DELTA[actor.dir];
      const curCol = tileIndexOf(actor.x), curRow = tileIndexOf(actor.y);
      jCol = curCol + dx;
      jRow = curRow + dy;
    } else {
      const k = segIndexOf(actor[axis]);
      const upcomingIdx = sign > 0 ? k + 1 : k;
      const upcomingCentre = centerOf(upcomingIdx);
      distanceAhead = sign > 0 ? upcomingCentre - actor[axis] : actor[axis] - upcomingCentre;
      jCol = axis === "x" ? upcomingIdx : col;
      jRow = axis === "y" ? upcomingIdx : row;
    }

    if (
      preTurn &&
      actor.want &&
      PERP[actor.dir].includes(actor.want) &&
      distanceAhead <= PRE_TURN &&
      canEnter(maze, jCol, jRow, actor.want, forGhost)
    ) {
      actor.carryAxis = axis;
      actor.carrySign = sign;
      actor.carry = distanceAhead;
      actor.dir = actor.want;
      continue;
    }

    const move = Math.min(remaining, distanceAhead);
    actor[axis] += sign * move;
    remaining -= move;
    if (actor.carry) {
      const cmove = Math.min(move, actor.carry);
      actor[actor.carryAxis] += actor.carrySign * cmove;
      actor.carry -= cmove;
      if (actor.carry <= 0) {
        actor.carry = 0;
        actor.carryAxis = null;
        actor.carrySign = 0;
      }
    }
  }
  return actor;
}

export function placeAtTile(col, row, dir = null) {
  const c = tileCenter(col, row);
  return { x: c.x, y: c.y, dir, want: dir, carry: 0, carryAxis: null, carrySign: 0 };
}
