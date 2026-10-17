// The rules, stepped by index only (1 step = 1/60s). S6 scope adds maze B + level scaling (speeds +4%/level
// to L8, fold -0.5s/level floor 2s), alternating mazes, the nightly table (seeded lineup/deck, dealt
// outside this module - see deal.js's dealNightly), and mid-level reload (levelSnapshot/resumeLevel). No
// DOM, no clock, no Math.random. Pure.
import { mulberry32 } from "./rng.js";
import { MAZE_A, MAZE_B, parse } from "./maze.js";
import { stepActor, placeAtTile, tileIndexOf, segIndexOf, isAtCentre, tileCenter, actorAtCentre, OPPOSITE, DELTA } from "./move.js";
import { modeAt, targetTile, pickDirection, foldDirection, eyesDirection } from "./ghosts.js";
import { dealHand, bestHand } from "./cards.js";
import { createTalkState, updateTalk } from "./talk.js";

export const READY_STEPS = 90; // 1.5s at 60Hz
export const DYING_STEPS = 90;
export const EAT_FREEZE_STEPS = 30; // 0.5s
export const CLEAR_STEPS = 90; // 1.5s, the hand beat
export const START_BUY_INS = 3;
export const FOLD_STEPS_L1 = 360; // 6s at L1; -0.5s/level, floor 2s (120 steps)
export const FREE_FIRST_RUN_STEPS = 20 * 60; // 20s
export const BONUS_BUY_IN_SCORE = 10000;
export const MAX_BUY_INS = 4; // the +1 bonus buy-in caps here, same cap the game-over check never exceeds
export const CARD_THRESHOLDS = [25, 50, 75, 100, 125];
export const CARD_DURATION_STEPS = 9 * 60; // 9s
export const REBUY_WAIT_STEPS = 240; // 4s: an eaten chaser sits in the seat before it comes back out (board, 2026-10-17)
export const MAX_SCALE_LEVEL = 8;
const FOLD_STEPS_PER_LEVEL = 30; // -0.5s a level
const FOLD_STEPS_FLOOR = 120; // 2s, the fold duration never scales below this
const CHOMPER_SPEED_L1 = 30; // 7.5 t/s
const GHOST_SPEED_L1 = 28; // 7.0 t/s
const FOLD_SPEED_L1 = 18; // 4.5 t/s
const EYES_SPEED = 56; // 14 t/s - eyes/chip glide never scales with level
// Release order follows the dealt slot order (G2/spec §3): 4/8/12/16s of level time.
const RELEASE_STEPS = [4, 8, 12, 16].map((s) => s * 60);

// Every speed +4%/level to L8, then flat; rounded to the nearest whole sub-unit.
function scaleSpeed(base, level) {
  const mult = 1 + 0.04 * (Math.min(level, MAX_SCALE_LEVEL) - 1);
  return Math.round(base * mult);
}
function foldStepsForLevel(level) {
  return Math.max(FOLD_STEPS_FLOOR, FOLD_STEPS_L1 - FOLD_STEPS_PER_LEVEL * (level - 1));
}
// L1-2 maze A, then B, A, B... (spec §3 / design §3).
export function mazeKeyForLevel(level) {
  if (level <= 2) return "A";
  return level % 2 === 0 ? "A" : "B";
}
function mazeRowsForLevel(level) {
  return mazeKeyForLevel(level) === "A" ? MAZE_A : MAZE_B;
}

// Shared by both mazes (design/all-in-chomp/mazes.mjs): the chomper start and the bonus spot are the same
// tile, just below the seat door.
const START_PLAYER = { x: 12, y: 9 };
export const BONUS_SPOT = START_PLAYER;

const PHASE_CODE = { ready: 1, play: 2, eatFreeze: 3, clear: 4, dying: 5, over: 6 };
const DIR_CODE = { up: 1, down: 2, left: 3, right: 4 };
const MODE_CODE = { scatter: 1, chase: 2 };

function freshGhost(slot, id, behaviour, seatTile) {
  const actor = placeAtTile(seatTile.x, seatTile.y, null);
  actor.want = null;
  return { ...actor, slot, id, behaviour, active: false, folded: false, foldLeft: 0, eaten: false, forceReverse: false, rebuyLeft: 0 };
}

function freshActors(maze, ghostIds, behaviours) {
  const player = placeAtTile(START_PLAYER.x, START_PLAYER.y, "left");
  const ghosts = ghostIds.map((id, slot) => freshGhost(slot, id, behaviours[slot], maze.seat));
  return { player, ghosts };
}

// A fresh level's card deck + bonus-slot state, drawn from the run's own rng (the "sim" stream: deck,
// folded-ghost turns - spec's "fx" stream for talk/cosmetics is S5).
function freshLevelCards(rng) {
  const { handClass, cards } = dealHand(rng);
  return {
    deckClass: handClass,
    deckCards: cards,
    cardsCollected: [],
    cardsSpawned: 0,
    cardsDue: 0,
    cardSlot: null,
    chipsEatenLevel: 0,
  };
}

// Two RNG streams seeded from the same run seed + a constant, so talk/cosmetic picks never move the sim
// stream (and so hash(run) - which reads the sim stream - never shifts because of a talk draw).
const FX_SEED_CONSTANT = 0x9e3779b9;

export function createRun({
  seed,
  chomper,
  ghosts: ghostIds,
  behaviours,
  firstRun = false,
  ownLineCount = () => 2,
  nightly = false,
  nightNumber = null,
  level = 1,
}) {
  const maze = parse(mazeRowsForLevel(level));
  const rng = mulberry32(seed);
  const fxRng = mulberry32((seed ^ FX_SEED_CONSTANT) >>> 0);
  const { player, ghosts } = freshActors(maze, ghostIds, behaviours);
  const run = {
    maze,
    rng,
    fxRng,
    ownLineCount,
    talk: createTalkState(),
    chomper,
    ghostIds,
    behaviours,
    firstRun,
    nightly,
    nightNumber,
    level,
    scoreAtLevelStart: 0,
    buyInsAtLevelStart: START_BUY_INS,
    rngAtLevelStart: rng.state >>> 0,
    phase: "ready",
    timer: READY_STEPS,
    step: 0,
    levelSteps: 0,
    firstRunSteps: 0,
    modeSteps: 0,
    mode: modeAt(0),
    chain: 200,
    allInEaten: new Set(),
    bonusBuyInUsed: false,
    score: 0,
    buyIns: START_BUY_INS,
    chipsLeft: maze.chipCount,
    eaten: new Set(),
    lastHand: null,
    lastCatcherId: null,
    bestHandThisRun: null, // the best hand made across every level this run (for the nightly share line)
    ...freshLevelCards(rng),
    player,
    ghosts,
  };
  // The deal beat: the chomper always speaks its own line the moment the run is dealt.
  updateTalk(run.talk, [{ event: "deal", who: chomper }], run.fxRng, run.ownLineCount);
  return run;
}

// 'ready', 'play' and 'eatFreeze' buffer the direction (applied once legal); 'dying' and 'over' swallow it.
export function input(run, dir) {
  if (run.phase === "ready" || run.phase === "play" || run.phase === "eatFreeze") run.player.want = dir;
}

export function currentTile(actor) {
  return { x: tileIndexOf(actor.x), y: tileIndexOf(actor.y) };
}

// The tile whose centre a ghost stands on or reaches next along its heading. Ghosts decide for this tile,
// so the turn is ready the moment they arrive (stepActor applies it only at the centre).
function upcomingTile(actor) {
  if (!actor.dir) return currentTile(actor);
  const [dx, dy] = DELTA[actor.dir];
  const axis = dx ? "x" : "y";
  const pos = actor[axis];
  const idx = isAtCentre(pos) ? tileIndexOf(pos) : segIndexOf(pos) + (dx + dy > 0 ? 1 : 0);
  const tile = currentTile(actor);
  tile[axis] = idx;
  return tile;
}

// A catch/grab: same tile, >=0.5 tile overlap (centre distance <=120u on a shared axis), or a swap this
// step (both crossing a shared boundary between each other). Reused for both the chomper-vs-chaser catch
// and the chomper-vs-folded-ghost grab - the geometry is identical either way. Exported standalone so both
// crossing cases can be unit-tested directly, since realistic speeds never cover enough ground in one step
// to exercise a genuine tile swap through step() itself.
export function caught(p, g, prevPlayerTile, prevGhostTile) {
  const pTile = currentTile(p), gTile = currentTile(g);
  const sameTile = pTile.x === gTile.x && pTile.y === gTile.y;
  const overlap = (p.y === g.y && Math.abs(p.x - g.x) <= 120) || (p.x === g.x && Math.abs(p.y - g.y) <= 120);
  const swapped =
    prevPlayerTile.x === gTile.x &&
    prevPlayerTile.y === gTile.y &&
    prevGhostTile.x === pTile.x &&
    prevGhostTile.y === pTile.y;
  return sameTile || overlap || swapped;
}

// Returns a talk candidate ({event, who:null}) if this score crossed the once-per-run bonus threshold.
function awardScore(run, points) {
  run.score += points;
  if (!run.bonusBuyInUsed && run.score >= BONUS_BUY_IN_SCORE) {
    run.buyIns = Math.min(run.buyIns + 1, MAX_BUY_INS);
    run.bonusBuyInUsed = true;
    return { event: "bonusBuyIn", who: null };
  }
  return null;
}

// A chip under the chomper is eaten once. Reaching a card threshold (25/50/75/100/125 this level) queues a
// card; reaching 0 chips left is the level clear, handled by the caller (step()) once all of this step's
// pickups are resolved. Returns a talk candidate, if any (the bonus buy-in).
function eatChip(run) {
  const tile = currentTile(run.player);
  const key = `${tile.x},${tile.y}`;
  if (run.maze.at(tile.x, tile.y) === "." && !run.eaten.has(key)) {
    run.eaten.add(key);
    run.chipsLeft -= 1;
    run.chipsEatenLevel += 1;
    const bonus = awardScore(run, 10);
    if (CARD_THRESHOLDS.includes(run.chipsEatenLevel)) run.cardsDue += 1;
    return bonus;
  }
  return null;
}

// The single bonus slot: shows the next due card once free, 9s each, grabbed by running over it at the
// bonus spot (BONUS_SPOT = the chomper's start tile, (12,9) on both mazes, design/all-in-chomp/mazes.mjs).
// Missed/queued cards are simply lost, never scored. Returns any talk candidates raised this step.
function updateCardSlot(run) {
  const candidates = [];
  if (run.cardSlot) {
    run.cardSlot.left -= 1;
    if (run.cardSlot.left <= 0) {
      run.cardSlot = null; // missed = gone
      candidates.push({ event: "cardMissed", who: null });
    }
  }
  if (!run.cardSlot && run.cardsDue > 0 && run.cardsSpawned < run.deckCards.length) {
    run.cardSlot = { card: run.deckCards[run.cardsSpawned], left: CARD_DURATION_STEPS };
    run.cardsSpawned += 1;
    run.cardsDue -= 1;
    if (run.cardsSpawned === 1) candidates.push({ event: "firstCard", who: null });
    if (run.cardsSpawned === 5) candidates.push({ event: "fifthCard", who: null });
  }
  return candidates;
}

function tryGrabCard(run) {
  if (!run.cardSlot) return;
  const tile = currentTile(run.player);
  const spot = BONUS_SPOT;
  if (tile.x === spot.x && tile.y === spot.y) {
    run.cardsCollected.push(run.cardSlot.card);
    run.cardSlot = null;
  }
}

// A new ALL IN restarts the fold for every ghost not gliding home (eaten) and resets the chain to 200,
// whether or not those ghosts were already folded. Returns the talk candidates raised this step.
function tryGrabAllIn(run) {
  const tile = currentTile(run.player);
  const key = `${tile.x},${tile.y}`;
  if (run.maze.at(tile.x, tile.y) !== "o" || run.allInEaten.has(key)) return [];
  run.allInEaten.add(key);
  const bonus = awardScore(run, 50);
  run.chain = 200;
  const foldSteps = foldStepsForLevel(run.level);
  for (const g of run.ghosts) {
    if (g.active && !g.eaten && !g.rebuyLeft) {
      g.folded = true;
      g.foldLeft = foldSteps;
    }
  }
  const candidates = [{ event: "allin", who: null }];
  if (bonus) candidates.push(bonus);
  return candidates;
}

function releaseGhosts(run) {
  for (const g of run.ghosts) {
    if (!g.active && run.levelSteps >= RELEASE_STEPS[g.slot]) {
      g.active = true;
      const c = tileCenter(run.maze.door.x, run.maze.door.y);
      g.x = c.x;
      g.y = c.y;
      g.dir = "up";
      g.want = "up";
    }
  }
}

// Fold, rebuy-wait and eyes-home timers/arrivals, run once at the top of each play step, before anyone moves.
function updateGhostTimers(run) {
  for (const g of run.ghosts) {
    if (!g.active) continue;
    if (g.folded) {
      g.foldLeft -= 1;
      if (g.foldLeft <= 0) g.folded = false;
    }
    if (g.rebuyLeft > 0) {
      // The rebuy wait (board, 2026-10-17): seated, still, untouchable. At 0 the ghost is back in the game
      // through the door, heading out exactly like a first release (releaseGhosts), in the current mode.
      g.rebuyLeft -= 1;
      if (g.rebuyLeft === 0) {
        const c = tileCenter(run.maze.door.x, run.maze.door.y);
        g.x = c.x;
        g.y = c.y;
        g.dir = "up";
        g.want = "up";
      }
      continue;
    }
    if (g.eaten) {
      // Exact centre, not just "which cell contains this pixel" (tileIndexOf/currentTile are too loose
      // here - they'd call it arrived up to 119u early, well before eyesDirection's downhill walk actually
      // reaches the seat).
      const seatCentre = tileCenter(run.maze.seat.x, run.maze.seat.y);
      if (g.x === seatCentre.x && g.y === seatCentre.y) {
        g.eaten = false; // home: the chip sits in the seat for the rebuy wait
        g.rebuyLeft = REBUY_WAIT_STEPS;
        g.dir = null;
        g.want = null;
      }
    }
  }
}

function moveGhosts(run) {
  const chomperTile = currentTile(run.player);
  const chomper = { tile: chomperTile, dir: run.player.dir };
  const directChaser = run.ghosts.find((g) => g.active && g.behaviour === "direct" && !g.folded && !g.eaten);
  const directChaserTile = directChaser ? currentTile(directChaser) : null;

  for (const g of run.ghosts) {
    if (!g.active || g.rebuyLeft > 0) continue; // seated for the rebuy wait: still
    // Decide every step for the tile ahead (THE-690 r3), so a turn is queued before the ghost reaches its
    // centre. A reverse chosen for that tile (only at a dead end: eyes entering the seat) waits until the
    // ghost stands on the centre, because stepActor applies a reverse instantly, even mid-tile. The mode
    // switch's forced reverse stays instant.
    const gTile = upcomingTile(g);
    let want;
    let forced = false;
    if (g.eaten) {
      want = eyesDirection(run.maze, gTile.x, gTile.y, g.dir);
    } else if (g.folded) {
      want = foldDirection(run.maze, gTile.x, gTile.y, g.dir, run.rng);
    } else if (g.forceReverse && g.dir) {
      want = OPPOSITE[g.dir];
      g.forceReverse = false;
      forced = true;
    } else {
      const target = targetTile(g.behaviour, g.slot, run.mode, gTile, chomper, directChaserTile);
      want = pickDirection(run.maze, gTile.x, gTile.y, g.dir, target);
    }
    if (!forced && g.dir && want === OPPOSITE[g.dir] && !actorAtCentre(g)) want = null;
    g.want = want;
    const speed = g.eaten ? EYES_SPEED : g.folded ? scaleSpeed(FOLD_SPEED_L1, run.level) : scaleSpeed(GHOST_SPEED_L1, run.level);
    stepActor(run.maze, g, speed, { preTurn: false });
  }
}

export function step(run) {
  run.step += 1;
  const talkCandidates = [];

  if (run.phase === "ready") {
    run.timer -= 1;
    if (run.timer <= 0) run.phase = "play";
  } else if (run.phase === "eatFreeze") {
    run.timer -= 1;
    if (run.timer <= 0) run.phase = "play";
  } else if (run.phase === "dying") {
    run.timer -= 1;
    if (run.timer <= 0) {
      if (run.buyIns > 0) {
        const { player, ghosts } = freshActors(run.maze, run.ghostIds, run.behaviours);
        run.player = player;
        run.ghosts = ghosts;
        run.levelSteps = 0;
        run.modeSteps = 0;
        run.mode = modeAt(0);
        run.phase = "ready";
        run.timer = READY_STEPS;
      } else {
        run.firstRun = false;
        run.phase = "over";
        talkCandidates.push({ event: "gameOver", who: null });
      }
    }
  } else if (run.phase === "clear") {
    run.timer -= 1;
    if (run.timer <= 0) {
      run.level += 1;
      run.maze = parse(mazeRowsForLevel(run.level));
      run.eaten.clear();
      run.chipsLeft = run.maze.chipCount;
      run.allInEaten.clear();
      // Bank the RNG state before drawing this level's deck, not after: resumeLevel() restores to
      // rngAtLevelStart and redraws from there, so recording it post-draw (as before) replayed a *different*
      // deck on reload - the live deal had already consumed the state resumeLevel then redrew from (THE-690 #3).
      run.rngAtLevelStart = run.rng.state >>> 0;
      Object.assign(run, freshLevelCards(run.rng));
      const { player, ghosts } = freshActors(run.maze, run.ghostIds, run.behaviours);
      run.player = player;
      run.ghosts = ghosts;
      run.levelSteps = 0;
      run.modeSteps = 0;
      run.mode = modeAt(0);
      run.phase = "ready";
      run.timer = READY_STEPS;
      run.scoreAtLevelStart = run.score;
      run.buyInsAtLevelStart = run.buyIns;
    }
  } else if (run.phase === "play") {
    run.levelSteps += 1;
    // Lifetime play-steps of the whole first-ever run, never reset by a rebuy/level clear (unlike
    // levelSteps) - the free first 20s is only the opening 20s of the run, not of each life (THE-690 #4:
    // levelSteps resets on every respawn, so gating on it kept granting a free catch indefinitely).
    if (run.firstRun) run.firstRunSteps += 1;
    updateGhostTimers(run);
    talkCandidates.push(...updateCardSlot(run));

    // The scatter/chase schedule pauses while any ghost is folded.
    const anyFolded = run.ghosts.some((g) => g.active && g.folded);
    if (!anyFolded) {
      run.modeSteps += 1;
      const newMode = modeAt(run.modeSteps);
      if (newMode !== run.mode) {
        run.mode = newMode;
        for (const g of run.ghosts) if (g.active && !g.folded && !g.eaten && !g.rebuyLeft) g.forceReverse = true;
        talkCandidates.push({ event: "modeChange", who: null });
      }
    }

    releaseGhosts(run);

    const prevPlayerTile = currentTile(run.player);
    const prevGhostTiles = run.ghosts.map((g) => currentTile(g));

    stepActor(run.maze, run.player, scaleSpeed(CHOMPER_SPEED_L1, run.level), { forGhost: false });
    moveGhosts(run);

    // Catches (by active, non-folded, non-eaten ghosts) beat grabs this step - no pickup is applied.
    const caughtBy = run.ghosts.find((g) => g.active && !g.folded && !g.eaten && !g.rebuyLeft && caught(run.player, g, prevPlayerTile, prevGhostTiles[g.slot]));
    if (caughtBy) {
      // A1: the fold ends - folded (and already-eaten) ghosts go home unfolded, no chain score, chain resets.
      for (const g of run.ghosts) {
        if (g.active && g.folded) {
          g.folded = false;
          g.eaten = true;
          g.foldLeft = 0;
        }
      }
      run.chain = 200;
      // A card still showing at the catch is orphaned by the respawn, not earned: without this, a card
      // left standing at the bonus spot (which is also the respawn/start tile) would be auto-grabbed for
      // free the instant the chomper re-seats there, with no actual play involved (THE-690 #7). Any queued
      // (not yet shown) cards are dropped too (THE-690 r2 #3): clearing only the showing one left cardsDue
      // untouched, so the very next play step spawned the next queued card onto that same respawn tile and
      // it was grabbed just as free, repeating for every card still in the queue.
      run.cardSlot = null;
      run.cardsDue = 0;
      run.lastCatcherId = caughtBy.id; // survives into game over for the catcher portrait (game.js)

      const freeCatch = run.firstRun && run.firstRunSteps <= FREE_FIRST_RUN_STEPS;
      run.phase = "dying";
      run.timer = DYING_STEPS;
      if (freeCatch) {
        talkCandidates.push({ event: "freeRedeal", who: null });
      } else {
        run.buyIns -= 1;
        talkCandidates.push({ event: "caught", who: caughtBy.id });
        if (run.buyIns === 1) talkCandidates.push({ event: "lastBuyIn", who: null });
      }
    } else {
      const chipBonus = eatChip(run);
      if (chipBonus) talkCandidates.push(chipBonus);
      talkCandidates.push(...tryGrabAllIn(run));
      tryGrabCard(run);

      const grabbed = run.ghosts.find((g) => g.active && g.folded && !g.eaten && caught(run.player, g, prevPlayerTile, prevGhostTiles[g.slot]));
      if (grabbed) {
        const wasFirstInChain = run.chain === 200;
        const wasAtCap = run.chain === 1600;
        grabbed.folded = false;
        grabbed.eaten = true;
        const bonus = awardScore(run, run.chain);
        run.chain = Math.min(run.chain * 2, 1600);
        run.phase = "eatFreeze";
        run.timer = EAT_FREEZE_STEPS;
        talkCandidates.push({ event: wasFirstInChain ? "firstEat" : wasAtCap ? "chainMax" : "afterEat", who: null });
        if (bonus) talkCandidates.push(bonus);
      }

      // The last chip clears the level: every timer stops before scoring, overriding whatever phase the
      // grab above just set.
      if (run.chipsLeft <= 0) {
        run.lastHand = bestHand(run.cardsCollected);
        if (!run.bestHandThisRun || run.lastHand.rank > run.bestHandThisRun.rank) run.bestHandThisRun = run.lastHand;
        const bonus = awardScore(run, run.lastHand.payout);
        run.phase = "clear";
        run.timer = CLEAR_STEPS;
        talkCandidates.push({ event: run.lastHand.key === "highCard" ? "clearNoHand" : run.lastHand.rank >= 6 ? "clearBigHand" : null, who: null });
        if (bonus) talkCandidates.push(bonus);
      }
    }
  }

  updateTalk(run.talk, talkCandidates.filter((c) => c.event), run.fxRng, run.ownLineCount);
  return run;
}

// Mid-level reload (G17/G18): a reload restarts the current level with the same lineup, the score and
// buy-ins banked at level start, and the same RNG/deck state that level started with - so the deck, the
// ALL IN fold rolls and everything downstream replay identically. game.js persists the snapshot (e.g. on
// every 'ready' entry) and calls resumeLevel() on boot instead of createRun() when one exists.
export function levelSnapshot(run) {
  return {
    chomper: run.chomper,
    ghosts: run.ghostIds,
    behaviours: run.behaviours,
    level: run.level,
    score: run.scoreAtLevelStart,
    buyIns: run.buyInsAtLevelStart,
    rngSeed: run.rngAtLevelStart,
    bonusBuyInUsed: run.bonusBuyInUsed,
    firstRun: run.firstRun,
    firstRunSteps: run.firstRunSteps,
    nightly: run.nightly,
    nightNumber: run.nightNumber,
    ownLineCount: run.ownLineCount,
    bestHandThisRun: run.bestHandThisRun,
  };
}

export function resumeLevel(snapshot) {
  const run = createRun({
    seed: snapshot.rngSeed,
    chomper: snapshot.chomper,
    ghosts: snapshot.ghosts,
    behaviours: snapshot.behaviours,
    firstRun: snapshot.firstRun,
    nightly: snapshot.nightly,
    nightNumber: snapshot.nightNumber,
    level: snapshot.level,
    ownLineCount: snapshot.ownLineCount,
  });
  run.score = snapshot.score;
  run.buyIns = snapshot.buyIns;
  run.scoreAtLevelStart = snapshot.score;
  run.buyInsAtLevelStart = snapshot.buyIns;
  if (snapshot.firstRunSteps != null) run.firstRunSteps = snapshot.firstRunSteps;
  run.bonusBuyInUsed = snapshot.bonusBuyInUsed;
  if (snapshot.bestHandThisRun !== undefined) run.bestHandThisRun = snapshot.bestHandThisRun;
  return run;
}

export function hash(run) {
  let h = 0x811c9dc5;
  const ints = [
    run.step,
    run.score,
    run.buyIns,
    run.level,
    PHASE_CODE[run.phase],
    run.timer,
    run.levelSteps,
    run.modeSteps,
    MODE_CODE[run.mode] || 0,
    run.chain,
    run.player.x,
    run.player.y,
    DIR_CODE[run.player.dir] || 0,
    DIR_CODE[run.player.want] || 0,
    run.chipsLeft,
    run.chipsEatenLevel,
    run.cardsSpawned,
    run.cardsDue,
    run.cardsCollected.length,
    run.cardSlot ? run.cardSlot.card.rank : 0,
    run.cardSlot ? run.cardSlot.card.suit : 0,
    run.cardSlot ? run.cardSlot.left : 0,
    run.rng.state >>> 0,
    run.talk.active ? 1 : 0,
    run.talk.stepsLeft,
    run.talk.cooldownLeft,
  ];
  for (const g of run.ghosts) {
    ints.push(g.active ? 1 : 0, g.folded ? 1 : 0, g.eaten ? 1 : 0, g.foldLeft, g.x, g.y, DIR_CODE[g.dir] || 0, DIR_CODE[g.want] || 0, g.rebuyLeft);
  }
  for (const n of ints) {
    h ^= n >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
