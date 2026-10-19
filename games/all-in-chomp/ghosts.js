// Ghost behaviours and the scatter/chase mode schedule (G2, spec §3). The behaviour comes from the deal,
// never from a person. Decisions happen only at tile centres (move.js's stepActor is called with
// { preTurn: false } for ghosts - confirmed by the S1 feel check, THE-689). Pure.
import { canEnter, DELTA, OPPOSITE } from "./move.js";
import { levelTuning, CALM_SCHEDULE_SEC } from "./difficulty.js";

// One scatter corner per release slot (0-3), independent of which ghost or behaviour sits in that slot.
export const SCATTER_CORNERS = [
  { x: 2, y: 2 },
  { x: 22, y: 2 },
  { x: 2, y: 12 },
  { x: 22, y: 12 },
];

// Seconds, alternating scatter/chase, starting in scatter; the last chase phase runs forever.
export const MODE_SCHEDULE_SEC = [7, 20, 7, 20, 5, 20, 5, Infinity];

const SHY_FLEE_RADIUS_TILES_SQ = 64; // 8-tile radius, squared (compared against squared tile distance)

// Which mode is active after `stepsElapsed` steps of level time (paused while any ghost is folded - S3). L1-L3
// use the gentle start's calm schedule (difficulty.js, 2026-10-19).
export function modeAt(stepsElapsed, level) {
  const schedule = levelTuning(level).calm ? CALM_SCHEDULE_SEC : MODE_SCHEDULE_SEC;
  let acc = 0;
  for (let i = 0; i < schedule.length; i++) {
    const mode = i % 2 === 0 ? "scatter" : "chase";
    const sec = schedule[i];
    if (sec === Infinity) return mode;
    const dur = sec * 60;
    if (stepsElapsed < acc + dur) return mode;
    acc += dur;
  }
  return "chase"; // unreachable (both schedules end in Infinity), kept total
}

// The target tile for one ghost this step. `chomper` = { tile: {x,y}, dir }. `directChaserTile` is the
// current direct chaser's tile (needed only by the flanker; falls back to the chomper's tile if there is
// no direct chaser dealt, which can't happen with 4 distinct behaviours but keeps this total).
export function targetTile(behaviour, slot, mode, ghostTile, chomper, directChaserTile) {
  if (mode === "scatter") return SCATTER_CORNERS[slot];
  const dir = chomper.dir || "left";
  const [dx, dy] = DELTA[dir];
  switch (behaviour) {
    case "direct":
      return { x: chomper.tile.x, y: chomper.tile.y };
    case "ambusher":
      return { x: chomper.tile.x + dx * 4, y: chomper.tile.y + dy * 4 };
    case "flanker": {
      const pivot = { x: chomper.tile.x + dx * 2, y: chomper.tile.y + dy * 2 };
      const dc = directChaserTile || chomper.tile;
      return { x: pivot.x * 2 - dc.x, y: pivot.y * 2 - dc.y };
    }
    case "shy": {
      const dist2 = (chomper.tile.x - ghostTile.x) ** 2 + (chomper.tile.y - ghostTile.y) ** 2;
      return dist2 > SHY_FLEE_RADIUS_TILES_SQ ? { x: chomper.tile.x, y: chomper.tile.y } : SCATTER_CORNERS[slot];
    }
    default:
      return { x: chomper.tile.x, y: chomper.tile.y };
  }
}

const DECISION_ORDER = ["up", "left", "down", "right"];

// Only eyes go back into the seat room (allowRoom); a chasing or folded ghost that left it never re-enters
// the door or the seat, so it never meets a dead end.
function openCandidates(maze, col, row, currentDir, allowRoom = false) {
  const into = (d, t) => t && col + DELTA[d][0] === t.x && row + DELTA[d][1] === t.y;
  const inSeat = maze.seat && col === maze.seat.x && row === maze.seat.y;
  const intoRoom = (d) => into(d, maze.seat) || (!inSeat && into(d, maze.door));
  let candidates = DECISION_ORDER.filter((d) => canEnter(maze, col, row, d) && (allowRoom || !intoRoom(d)));
  if (currentDir && candidates.length > 1) {
    const noReverse = candidates.filter((d) => d !== OPPOSITE[currentDir]);
    if (noReverse.length > 0) candidates = noReverse;
  }
  return candidates;
}

// Among open directions from (col,row), minus the reverse of currentDir (unless it's the only option),
// the one minimising squared distance to target; ties broken in the fixed order above.
export function pickDirection(maze, col, row, currentDir, target) {
  const candidates = openCandidates(maze, col, row, currentDir);
  let best = null, bestDist = Infinity;
  for (const d of candidates) {
    const [dx, dy] = DELTA[d];
    const dist = (col + dx - target.x) ** 2 + (row + dy - target.y) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  return best;
}

// A folded ghost's movement: a seeded RNG pick among the open directions (minus the reverse unless it's
// the only option) - not a chase, not fleeing, just wandering while it waits out the fold.
export function foldDirection(maze, col, row, currentDir, rng) {
  const candidates = openCandidates(maze, col, row, currentDir);
  if (candidates.length === 0) return null;
  return candidates[Math.floor(rng() * candidates.length)];
}

// The gentle start's wrong turn (2026-10-19): at a junction (two or more open ways, never back), with
// `chance`, a random open way; null otherwise. Draws from rng only at junctions.
export function wrongTurn(maze, col, row, currentDir, rng, chance) {
  const candidates = openCandidates(maze, col, row, currentDir);
  if (candidates.length < 2 || !(rng() < chance)) return null;
  return candidates[Math.floor(rng() * candidates.length)];
}

// Eaten ghosts ("eyes") glide home downhill on the maze's precomputed distToSeat field.
export function eyesDirection(maze, col, row, currentDir) {
  const candidates = openCandidates(maze, col, row, currentDir, true);
  let best = null, bestDist = Infinity;
  for (const d of candidates) {
    const [dx, dy] = DELTA[d];
    const dist = maze.distToSeat.get(`${col + dx},${row + dy}`);
    if (dist != null && dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  return best;
}
