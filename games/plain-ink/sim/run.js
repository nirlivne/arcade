// The whole-game step function for S1's slice: physics + cover/hidden + seekers + checkpoints +
// snip/respawn (design §2, §4; spec §2.1 "Checkpoints"/"Snipped"). step() is pure; game.js only
// ever mutates its state through this and respawn/loadCheckpoint.
import { DT, tick as physicsTick, newBody, BODY_W, BODY_H } from './physics.js';
import { cover, hidden, frontHideFull, HIDE_STILL_S } from './cover.js';
import { stepWatcher, SPOTTED_S, LONG_GRACE_S } from './seekers.js';
import { segmentBlocked } from './los.js';
import { CROWD_SPEED, inStep, crowdHidden } from './crowd.js';
import { scissorsX, scissorsCaught } from './scissors.js';

export const RESPAWN_S = 1.0; // design choice within the spec's <= 1.5s ceiling
export const STILL_V = 1; // u/s: below this and no move/jump/flip input counts as "still"

// The finale (spec beats 20-22), both keyed to CP11's own cpTick (same pattern as every other
// timed beat in this level): the reveal stub plays once per attempt (not replayed after a chase
// death, spec §2.1 "Snipped"), then the scissors chase runs until CP12. REVEAL_S matches the
// spec's beat 20 span (t=136-141s).
export const REVEAL_S = 5;

// Spotted beat (CTO on THE-1551, D2 #2 / spec "Snip gag"): head snap + lens glint, a hard freeze,
// then the scissor-cut line and wipe play out before respawn -- all inside RESPAWN_S.
export const SNIP_FREEZE_S = 0.18; // head snap + glint; CTO's "150-200ms freeze", nothing moves
export const SNIP_STOP_S = 0.5; // spec's "0.5s stop-time": the cut line plays from FREEZE to here
export function snipPhase(elapsedS) {
  if (elapsedS < SNIP_FREEZE_S) return 'freeze';
  if (elapsedS < SNIP_STOP_S) return 'cut';
  return 'wipe';
}

// overrides: restore a save (spec §8 "Return loop") -- clockMs/snips/coat come from the saved
// run instead of the checkpoint defaults, so Continue resumes exactly where the player left off.
export function newRunState(spawn, level, overrides = {}) {
  return {
    tick: 0,
    body: { ...newBody(spawn.spawnX, spawn.spawnY, true), coat: overrides.coat || spawn.coat || 'ink' },
    stillTime: 0,
    cp: spawn.id,
    cpTick: 0,
    // ticks since level start, or since the hero last respawned AT level start (spec: W1 the
    // Doorman "enters 20s after level start or a level-start respawn") -- a respawn at any other
    // checkpoint does not reset it, since the Doorman is already doing its thing by then.
    sinceLevelStartTick: 0,
    clockMs: overrides.clockMs || 0,
    snips: overrides.snips || 0,
    snipping: false,
    respawnTicksLeft: 0,
    watchers: level.watchers.map((w) => ({ id: w.id, rt: w.makeRuntime(), patrol: w.patrol, beamShape: w.beamShape, triggerX: w.triggerX, triggerAtTick: w.triggerAtTick, triggerTick: 0 })),
    cover: 0,
    hidden: false,
    // the finale (spec beats 20-22): revealed persists across a chase-death respawn to CP11 (the
    // reveal stub is not replayed); chaseTick is ticks since the chase itself started (0 through
    // the reveal, then counts up -- distinct from cpTick so a respawn restarts the chase at 0
    // without re-running the reveal delay); ended is the terminal "hidden in the I-slot" state.
    revealed: overrides.revealed || false,
    chaseTick: 0,
    ended: false,
    // ids of seek pieces already resolved (spec §2.1 "Seek action"); kept through snips, since a
    // flipped-right piece stays flipped (and through a reload: the saved run keeps them, THE-1561).
    resolved: overrides.resolved ? overrides.resolved.slice() : [],
    // R2: the running door script ({ kind: 'lift'|'closet', ticksLeft, door }) or null, and the
    // wrong doors tried so far (drawn with an X; they can still be opened again).
    script: null,
    wrongDoors: [],
    // the Negative (spec beat 19): taken once, kept through snips and in the saved run
    negative: overrides.negative || false,
    // R1: a seeker turned by a wrong letter ({ watcher, phase: 'telegraph'|'look', ticksLeft, at })
    look: null,
    // spec §8 Longer grace: game.js writes the setting here every tick (a mid-run toggle counts at
    // once); graceUsed = it was on at any point this run (results "grace" tag; kept in the saved run)
    longGrace: !!overrides.longGrace,
    graceUsed: !!overrides.graceUsed,
  };
}

export const SEEK_PAD = 40; // u, each side (THE-1559 Q3)
// R1 (spec §3.4, THE-1559 Q10): a wrong letter rattles; its watcher holds still for a 0.5 s
// telegraph (head snap), then looks at that letter for 3 s, then looks away again.
export const R1_TELEGRAPH_TICKS = 60;
export const R1_LOOK_TICKS = 360;

// Collision/LOS rects with any opened door taken out (R1: the R's barrier, opensWith 'r1R').
function liveRects(rects, resolved) {
  return rects.some((r) => r.opensWith) ? rects.filter((r) => !r.opensWith || !resolved.includes(r.opensWith)) : rects;
}

function nextLook(look) {
  if (!look) return null;
  if (look.ticksLeft > 1) return { ...look, ticksLeft: look.ticksLeft - 1 };
  return look.phase === 'telegraph' ? { ...look, phase: 'look', ticksLeft: R1_LOOK_TICKS } : null;
}

function bodyOverlaps(body, r, pad = 0) {
  const left = body.x - BODY_W / 2, right = body.x + BODY_W / 2;
  const top = body.y - BODY_H, bottom = body.y;
  return right > r.x - pad && left < r.x + r.w + pad && bottom > r.y - pad && top < r.y + r.h + pad;
}

// The seek piece a FLIP this tick would resolve, or null. Hide rect wins (CTO, THE-1559 Q3): inside
// a hide rect FLIP is always a coat flip, so a player matching their coat while hiding can never
// trigger a seek by accident.
function seekTarget(body, level, resolved) {
  if (!level.seekPieces) return null;
  const hideRects = [
    ...(level.hideRectsAt ? level.hideRectsAt(body.x) : []),
    ...(level.iSlotHideRectsAt ? level.iSlotHideRectsAt(body.x) : []),
  ];
  if (hideRects.some((h) => bodyOverlaps(body, h))) return null;
  // in a row of pieces (R1's EDITOR wall) the pads overlap: the one whose centre is nearest wins
  let best = null, bestD = Infinity;
  for (const p of level.seekPieces) {
    if (resolved.includes(p.id) || !bodyOverlaps(body, p, SEEK_PAD)) continue;
    const d = Math.abs(p.x + p.w / 2 - body.x);
    if (d < bestD) { best = p; bestD = d; }
  }
  return best;
}

function bodyPoints(body) {
  return {
    feet: { x: body.x, y: body.y },
    centre: { x: body.x, y: body.y - BODY_H / 2 },
    head: { x: body.x, y: body.y - BODY_H },
  };
}

function overlapsCheckpoint(body, c) {
  const left = body.x - BODY_W / 2, right = body.x + BODY_W / 2;
  const top = body.y - BODY_H, bottom = body.y;
  return right > c.triggerX && left < c.triggerX + c.triggerW && bottom > c.triggerY && top < c.triggerY + c.triggerH;
}

export function step(state, intent, level) {
  // The last beat of the level (spec §2.1): hidden in the I-slot stops the clock and locks input
  // on that tick, for good -- a true no-op from here, not a countdown like the respawn freeze.
  if (state.ended) return { state, events: [] };

  const events = [];
  let { tick, body, stillTime, cp, cpTick, sinceLevelStartTick, clockMs, snips, snipping, respawnTicksLeft, watchers, revealed, chaseTick, ended, resolved = [], script = null, wrongDoors = [], negative = false, look = null, longGrace = false } = state;
  const graceUsed = !!state.graceUsed || longGrace;
  // the one state literal every return builds from the current locals (THE-1561, S5 carry-over)
  const pack = (cover, hidden) => ({ state: { tick, body, stillTime, cp, cpTick, sinceLevelStartTick, clockMs, snips, snipping, respawnTicksLeft, watchers, cover, hidden, revealed, chaseTick, ended, resolved, script, wrongDoors, negative, look, longGrace, graceUsed }, events });
  tick += 1;
  sinceLevelStartTick += 1;
  clockMs += DT * 1000;

  if (snipping) {
    respawnTicksLeft -= 1;
    if (respawnTicksLeft <= 0) {
      const cpDef = level.checkpoints.find((c) => c.id === cp);
      body = { ...newBody(cpDef.spawnX, cpDef.spawnY, true), coat: cpDef.coat || 'ink' };
      stillTime = 0;
      cpTick = 0;
      chaseTick = 0; // the chase restarts at 0 on respawn; revealed is untouched (not replayed)
      look = null; // a turned watcher resets with every other seeker
      if (cp === 'start') sinceLevelStartTick = 0;
      snipping = false;
      // fresh exposure/spottedFired, or a hero respawned in sight could never be spotted again
      watchers = watchers.map((w, i) => ({ ...w, rt: level.watchers[i].makeRuntime(), triggerTick: 0 }));
      events.push({ type: 'respawn', tick });
    }
    return pack(0, false);
  }

  // R2 door scripts (spec §3.4): the lift ride or the closet. Input is locked, the hero is out of
  // sight (hidden) and the set holds still (seekers don't step), like a short cutaway. The run
  // clock keeps running. At the end the hero steps out at the door's `to`.
  if (script) {
    if (script.ticksLeft > 1) {
      script = { ...script, ticksLeft: script.ticksLeft - 1 };
      return pack(0, true);
    }
    const door = level.seekPieces.find((p) => p.id === script.door);
    body = { ...newBody(door.to.x, door.to.y, true), coat: body.coat };
    stillTime = 0;
    events.push({ type: script.kind === 'lift' ? 'liftArrived' : 'closetExit', tick, id: door.id });
    script = null;
  }

  // The finale reveal + chase (spec beats 20-21), both keyed off CP11's own cpTick. The reveal
  // freezes input (effectiveIntent below) until it has run once; after that -- including every
  // chase-death respawn, which lands back on CP11 -- the chase is immediately live.
  let effectiveIntent = intent;
  if (cp === 'cp11' && !revealed) {
    effectiveIntent = { left: false, right: false, jumpHeld: false, jumpPressed: false, flipPressed: false };
  }

  // Seek FLIP (spec §2.1): FLIP at an unresolved seek piece resolves it instead of flipping the
  // coat, and doesn't count as input for stillness (below), so seeking while hidden stays hidden.
  // A door (R2, spec §3.4) opens instead: the right one is a lift, a wrong one a closet. A wrong
  // door is not resolved (no lockout); it is only marked in wrongDoors for the X.
  let seeked = false;
  const lookBefore = look;
  if (effectiveIntent.flipPressed && body.flipLockT <= 0) {
    const target = seekTarget(body, level, resolved);
    if (target) {
      seeked = true;
      effectiveIntent = { ...effectiveIntent, flipPressed: false };
      events.push({ type: 'seek', tick, id: target.id });
      if (target.kind === 'door') {
        script = { kind: target.opens, ticksLeft: target.ticks, door: target.id };
        if (target.opens === 'lift') {
          resolved = [...resolved, target.id]; // resolved, so it opens once: riddleSolved fires once
          events.push({ type: 'riddleSolved', tick, riddle: 'R2' });
        } else {
          if (!wrongDoors.includes(target.id)) wrongDoors = [...wrongDoors, target.id];
          events.push({ type: 'closet', tick, id: target.id });
        }
        return pack(0, true);
      }
      if (target.alerts) {
        // R1 wrong letter: rattle, and turn its watcher toward it (telegraph first). Not resolved.
        events.push({ type: 'rattle', tick, id: target.id });
        look = { watcher: target.alerts, phase: 'telegraph', ticksLeft: R1_TELEGRAPH_TICKS, at: { x: target.x + target.w / 2, y: target.y + target.h / 2 }, id: target.id };
      } else {
        resolved = [...resolved, target.id];
        if (target.riddle) events.push({ type: 'riddleSolved', tick, riddle: target.riddle });
      }
    }
  }
  // a running look counts down; a fresh one (set by a FLIP this tick) starts counting next tick
  if (look === lookBefore) look = nextLook(look);

  // R3 disguise queue (spec §3.4): crowd pace caps run speed while inside the zone; zone
  // membership is read from the hero's position at the START of the tick, same as every other
  // trigger check below (checkpoints, watcher triggerX). The beat clock itself (crowdBeat/inStep)
  // runs on cpTick -- "time since this checkpoint (CP8) was (re)entered", the same checkpoint-
  // relative rule every other seeker timer in this level already follows (fix 1) -- not on time
  // since the hero physically crossed into the zone. CTO review on THE-1556: the queue must
  // already be marching (visibly, and for the beat math) before the hero reaches it, not start
  // fresh at the zone boundary.
  const inCrowdZone = level.isInCrowdZone ? level.isInCrowdZone(body.x) : false;
  body = physicsTick(body, effectiveIntent, liveRects(level.rectsAt ? level.rectsAt(body.x) : level.rects, resolved), inCrowdZone ? CROWD_SPEED : undefined);

  // The Negative (spec beat 19): touching it takes it, once; it is kept through snips.
  if (!negative && level.negative && bodyOverlaps(body, level.negative)) {
    negative = true;
    events.push({ type: 'negative', tick });
  }
  cpTick += 1;

  if (cp === 'cp11') {
    if (!revealed) {
      if (cpTick / 120 >= REVEAL_S) revealed = true;
    } else {
      chaseTick += 1;
      const cp11Def = level.checkpoints.find((c) => c.id === 'cp11');
      const sx = scissorsX(cp11Def.spawnX, chaseTick / 120);
      if (scissorsCaught(sx, body.x)) {
        snipping = true;
        respawnTicksLeft = Math.round(RESPAWN_S / DT);
        snips += 1;
        events.push({ type: 'snip', tick, seeker: 'scissors' });
        return pack(0, false);
      }
    }
  }

  const moving = !!(intent.left || intent.right || intent.jumpPressed || (intent.flipPressed && !seeked));
  const speed = Math.hypot(body.vx, body.vy);
  stillTime = body.grounded && !moving && speed < STILL_V ? stillTime + DT : 0;

  for (const c of level.checkpoints) {
    if (c.id === cp) continue;
    if (overlapsCheckpoint(body, c)) {
      cp = c.id;
      cpTick = 0;
      events.push({ type: 'checkpoint', id: c.id, tick });
      break;
    }
  }

  // Pass 1: advance every watcher's patrol first (it's purely time/trigger-driven, never depends
  // on the hero), so a lamp's beam -- fed into this same tick's cover world below -- matches
  // exactly where stepWatcher will see it a few lines later ("flip to cream and freeze before the
  // light reaches you" needs cover to already reflect where the beam IS this tick, not last tick).
  const patrolled = watchers.map((w) => {
    // the patrol clock only starts once the hero has crossed the watcher's trigger (spec D1 #1:
    // a clock keyed to cpTick ran from level start, parking W2 over the wall long before arrival).
    // Off duty until then too: W2's resting cone at xMax already reaches the CP1/wall-top area by
    // angle+length alone, with nothing solid in the way, so an un-triggered watcher must not watch.
    // W1 the Doorman gates on time since level start instead of a world-x trigger (spec: "enters
    // 20s after level start or a level-start respawn"); its triggerTick is derived, not counted.
    let crossed, triggerTick;
    if (w.triggerAtTick !== undefined) {
      crossed = sinceLevelStartTick >= w.triggerAtTick;
      triggerTick = crossed ? sinceLevelStartTick - w.triggerAtTick : 0;
    } else {
      crossed = w.triggerX === undefined || body.x >= w.triggerX;
      triggerTick = crossed ? w.triggerTick + 1 : 0;
    }
    let rt = w.patrol ? w.patrol(w.rt, triggerTick) : w.rt;
    // R1: a watcher turned by a wrong letter holds still through the telegraph (head snap), then
    // looks straight at that letter; with no look it rests on its own facing.
    if (rt.restAngle !== undefined) {
      const mine = look && look.watcher === w.id ? look : null;
      const facingAngle = mine && mine.phase === 'look' ? Math.atan2(mine.at.y - rt.y, mine.at.x - rt.x) : rt.restAngle;
      rt = { ...rt, facingAngle, telegraph: !!mine && mine.phase === 'telegraph' };
    }
    return { ...w, rt, crossed, triggerTick };
  });

  const lampShapes = patrolled
    .filter((w) => w.crossed && w.beamShape)
    .map((w) => w.beamShape(w.rt))
    .filter(Boolean);
  const world = level.coverWorldAt(body.x, lampShapes);
  const cov = cover({ x: body.x, y: body.y }, body.coat, world);

  // Hidden (spec §2.1): the R3 crowd zone, the red set 5 and set 6's I-slot each replace the
  // normal cover-based rule with their own full-body-in-an-authored-rect version (see
  // sim/crowd.js and cover.js's frontHideFull); everywhere else, unchanged.
  const moveHeld = !!(intent.left || intent.right);
  const redSet = level.redSetAt ? level.redSetAt(body.x) : false;
  const inISlot = level.inISlotAt ? level.inISlotAt(body.x) : false;
  const isHidden = inCrowdZone
    ? crowdHidden(body.coat, inStep(cpTick / 120, moveHeld))
    : redSet
      // CTO ruling THE-1619: a set-5 hide needs the hero to stop (0.2 s), like every other hide.
      // Kept at this call site, not in cover.js hidden(), because the I-slot also passes redSet.
      ? stillTime >= HIDE_STILL_S && hidden({ grounded: body.grounded, cover: cov, stillTime, redSet, frontHideFull: frontHideFull({ x: body.x, y: body.y }, level.hideRectsAt ? level.hideRectsAt(body.x) : []) })
      : inISlot
        ? hidden({ grounded: body.grounded, cover: cov, stillTime, redSet: true, frontHideFull: frontHideFull({ x: body.x, y: body.y }, level.iSlotHideRectsAt ? level.iSlotHideRectsAt(body.x) : []) })
        : hidden({ grounded: body.grounded, cover: cov, stillTime });

  // LOS rects: the collision rects only. Set 5's EDITED letters (frontLayerAt) are a front layer,
  // in front of the hero and W7 alike, so they never stand between two characters on the floor
  // behind them; only being *inside* a letter (the hidden rule) protects you (CTO ruling THE-1619).
  const losRects = liveRects(level.rectsAt ? level.rectsAt(body.x) : level.rects, resolved);
  const target = bodyPoints(body);
  let spotted = false;
  watchers = patrolled.map((w) => {
    const rt = w.rt;
    const eye = { x: rt.x, y: rt.y };
    const losBlocked = !w.crossed || ['head', 'centre', 'feet'].every((k) => segmentBlocked(eye, target[k], losRects));
    const r = stepWatcher(rt, DT, target, { losBlocked, hidden: isHidden, spottedS: longGrace ? LONG_GRACE_S : SPOTTED_S });
    let watcherRt = r.watcher;
    for (const e of r.events) {
      events.push({ ...e, seeker: w.id, tick });
      if (e.type === 'spotted') {
        spotted = true;
        // head snap: look straight at the hero the instant they're spotted (CTO's "spotted beat").
        watcherRt = { ...watcherRt, facingAngle: Math.atan2(target.centre.y - watcherRt.y, target.centre.x - watcherRt.x) };
      }
    }
    return { id: w.id, rt: watcherRt, patrol: w.patrol, beamShape: w.beamShape, triggerX: w.triggerX, triggerAtTick: w.triggerAtTick, triggerTick: w.triggerTick };
  });

  if (spotted) {
    snipping = true;
    respawnTicksLeft = Math.round(RESPAWN_S / DT);
    snips += 1;
    events.push({ type: 'snip', tick });
  }

  // Last beat of the level (spec §2.1): hidden in the I-slot stops the clock on this tick, for
  // good -- state.ended short-circuits every future step() call at the top of the function.
  if (inISlot && isHidden) {
    ended = true;
    events.push({ type: 'ended', tick });
  }

  return pack(cov, isHidden);
}
