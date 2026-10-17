// Canvas: the table, pickups and heads, drawn with recipe.js (THE-687, design/all-in-chomp/recipe.js, copied
// in whole per DESIGN.md's own invitation). The context passed in is already scaled by devicePixelRatio, so
// every recipe.js call below draws in CSS px (recipe.js's own convention). No canvas text (G10): every
// letter is DOM. Render only.
import * as R from "./recipe.js";
import { BONUS_SPOT } from "./sim.js";

export const BEHAVIOUR_KEY = { direct: "direct", ambusher: "ambush", flanker: "flank", shy: "shy" };
const FLASH_STEPS = 120; // last 2s of a fold (foldLeft<=120) flips the stack/tint back at 4Hz (DESIGN.md "flash")

// levelLooks: theme.js's per-level token overrides for the table's colours (board 2026-10-17), indexed by
// (level - 1) % length; an empty list or entry keeps the tokens.
export function createRenderer(ctx, C, levelLooks = []) {
  // The static table (felt/wood, walls, the seat) is the same every frame for a given maze/tile/origin/level,
  // so cache it on an offscreen canvas instead of repainting every wall tube and wall block each frame.
  let tableCanvas = null;
  let cacheKey = "";

  function ensureTable(maze, kind, T, ox, oy, w, h, dpr, level) {
    const key = `${kind}:${level}:${T}:${ox}:${oy}:${w}:${h}:${dpr}`;
    if (cacheKey === key && tableCanvas) return;
    cacheKey = key;
    tableCanvas = document.createElement("canvas");
    tableCanvas.width = Math.max(1, Math.ceil(w * dpr));
    tableCanvas.height = Math.max(1, Math.ceil(h * dpr));
    const tg = tableCanvas.getContext("2d");
    tg.scale(dpr, dpr);
    const look = levelLooks.length ? levelLooks[(level - 1) % levelLooks.length] || {} : {};
    R.drawTable(tg, maze.rows, T, { ...C, ...look }, kind, ox, oy, w, h);
  }

  function actorScreen(actor, T, ox, oy) {
    return { x: ox + (actor.x / 240) * T, y: oy + (actor.y / 240) * T };
  }

  function drawGhostActor(g, sprites, T, ox, oy, t) {
    const { x, y } = actorScreen(g, T, ox, oy);
    const col = C.behaviour[BEHAVIOUR_KEY[g.behaviour]];
    if (g.eaten || g.rebuyLeft > 0) { // eyes gliding home, or seated for the rebuy wait: the chip
      R.drawEaten(ctx, sprites, x, y, T, C, col, 1);
      return;
    }
    let state = "chase";
    if (g.folded) state = g.foldLeft <= FLASH_STEPS ? "flash" : "folded";
    R.drawGhost(ctx, sprites, x, y, T, C, col, { t, state, phase: g.slot });
  }

  function drawChomperActor(p, sprites, T, ox, oy, t, moving) {
    const { x, y } = actorScreen(p, T, ox, oy);
    R.drawChomper(ctx, sprites, x, y, T, { t, moving, lean: 0, squash: 0 });
  }

  // sprites: { [faceId]: buildHeadSprites(...) result }. mazeKind: "A" | "B" (sim.js's mazeKeyForLevel(level),
  // since maze.js's parsed maze doesn't tag which key it came from).
  function draw(run, sprites, T, ox, oy, mazeKind, t = 0) {
    const maze = run.maze;
    const dpr = ctx.getTransform().a || 1;
    const w = maze.w * T + ox * 2, h = maze.h * T + oy * 2;
    ensureTable(maze, mazeKind, T, ox, oy, w, h, dpr, run.level);
    ctx.clearRect(0, 0, ctx.canvas.width / dpr, ctx.canvas.height / dpr);
    ctx.drawImage(tableCanvas, 0, 0, tableCanvas.width / dpr, tableCanvas.height / dpr);

    // drawPickups gates both chips (".") and ALL IN ("o") tiles on one "gone" set - union the sim's two
    // separate sets (chips eaten, ALL IN eaten) for this one call.
    const gone = new Set(run.eaten);
    for (const k of run.allInEaten) gone.add(k);
    R.drawPickups(ctx, maze.rows, T, C, ox, oy, gone, t);

    if (run.jokerSlot) {
      // The bonus spot is the chomper's start tile (sim.js's BONUS_SPOT = START_PLAYER, (12,9)), not the
      // seat door - maze.door is a different tile a few rows up. The joker blinks for its last 1.5 s.
      const spot = BONUS_SPOT;
      const fading = run.jokerSlot.left < 90 && Math.floor(run.jokerSlot.left / 8) % 2 === 0;
      if (!fading) R.jokerOnFelt(ctx, ox + (spot.x + 0.5) * T, oy + (spot.y + 0.5) * T, T, C, t);
    }

    for (const g of run.ghosts) {
      if (!g.active) continue;
      const sp = sprites[g.id];
      if (sp) drawGhostActor(g, sp, T, ox, oy, t);
    }
    const chomperSprites = sprites[run.chomper];
    if (chomperSprites) drawChomperActor(run.player, chomperSprites, T, ox, oy, t, !!run.player.dir);
  }

  return { draw };
}
