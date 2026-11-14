// The rework's whole-game step (THE-1648; spec-rework §1, board design §3): physics -> hidden (H1-H5) ->
// seen (S1, S3, S4) -> the warning meter (S2) -> snip / respawn (rule 5). Pure: game.js and the tests only
// change the state through step(). Hazards run on the sim beat clock (CTO ruling 4), so a respawn never
// resets them. The released level's step (sim/run.js) stays for the later levels.
import { DT, tick as physicsTick, newBody } from './physics.js';
import { samplePoints, behindAt, coverCount, isHidden, beamPolygon, lampSees, stepWarning, inView, pointInPoly, beatAt, HIDE_MIN } from './rules.js';

export const RESPAWN_TICKS = Math.round(1.0 / DT); // rule 5: back at the checkpoint after 1.0 s
export const PAPER_GAP_TICKS = Math.ceil(0.12 / DT - 1e-9); // H6: one paper sound per 120 ms (15 ticks)
export const CLOSE_CALL_TICKS = Math.round(0.3 / DT); // narration: 0.3 s hidden inside a live beam
export const LONG_GRACE_FILL = 0.5; // settings "Longer grace" comfort: the meter fills at half speed (1.4 s)

// the camera's half-width / reach above / below the floor line, world u. game.js writes the real one every
// tick; this default is a 16:9 desktop view (1080 u tall, floor line at 74 %).
export const DEFAULT_VIEW = { halfW: 960, up: 799, down: 281 };

export function newPlayState(cp, level, overrides = {}) {
  const tick = overrides.tick ?? Math.round(((overrides.clockMs || 0) / 1000) / DT);
  return {
    tick, // sim ticks since level start: the beat clock (never reset by a respawn)
    body: { ...newBody(cp.spawnX, cp.spawnY, true), coat: overrides.coat || cp.coat || 'ink' },
    cp: cp.id,
    clockMs: overrides.clockMs || 0,
    snips: overrides.snips || 0,
    snipping: false,
    respawnTicksLeft: 0,
    hidden: false,
    count: 0, // matched + covered points of 45
    warn: 0, // S2 meter, 0..1
    warnUnseen: 0, // s since the hero was last seen (the meter holds 0.5 s before it drains)
    eyeBy: null, // the lamp whose eye stays open while w > 0 (the last one that saw the hero)
    seenBy: null, // id of a watcher seeing the hero this tick (the eye that opens)
    held: false, // the rehearsal lamp filled the meter and is holding it at 1
    lamps: level.lamps.map((l) => lampNow(l, tick)),
    lastPaperTick: -Infinity,
    closeTicks: 0,
    ended: false,
    view: overrides.view || DEFAULT_VIEW,
    longGrace: !!overrides.longGrace,
    graceUsed: !!overrides.graceUsed,
  };
}

// a lamp at one tick: its angle and lit state from the sim beat, and the polygon that is both drawn and counted
function lampNow(l, tick) {
  const beat = beatAt(tick);
  const angleDeg = l.angleAt(beat);
  const lit = l.litAt(beat);
  return { id: l.id, bulb: l.bulb, angleDeg, lit, glow: l.glowAt ? l.glowAt(beat) : false, poly: lit ? beamPolygon({ bulb: l.bulb, angleDeg, halfAngleDeg: l.halfAngleDeg, throw: l.throw }) : null };
}

function viewRect(body, v) {
  return { x0: body.x - v.halfW, x1: body.x + v.halfW, y0: -v.up, y1: v.down };
}

function sceneFor(level, patches) {
  return { ground: level.ground, backdrops: level.backdrops, goBehinds: level.goBehinds, patches };
}

export function step(state, intent, level) {
  if (state.ended) return { state, events: [] };
  const events = [];
  const s = { ...state, tick: state.tick + 1, clockMs: state.clockMs + DT * 1000 };
  s.graceUsed = state.graceUsed || s.longGrace;
  s.lamps = level.lamps.map((l) => lampNow(l, s.tick)); // hazards keep running, snipped or not (rule 5)

  if (s.snipping) {
    s.respawnTicksLeft -= 1;
    if (s.respawnTicksLeft <= 0) {
      const cp = level.checkpoints.find((c) => c.id === s.cp);
      s.body = { ...newBody(cp.spawnX, cp.spawnY, true), coat: 'ink' };
      s.snipping = false;
      s.warn = 0; // the only reset of the meter (rule 5)
      s.warnUnseen = 0;
      s.eyeBy = null;
      s.held = false;
      s.closeTicks = 0;
      events.push({ type: 'respawn', tick: s.tick });
    }
    return { state: s, events };
  }

  s.body = physicsTick(s.body, intent, level.solids);
  const body = s.body;

  for (const c of level.checkpoints) {
    if (c.id === s.cp) continue;
    const order = level.checkpoints.indexOf(c) - level.checkpoints.findIndex((k) => k.id === s.cp);
    if (order > 0 && body.x >= c.x) {
      s.cp = c.id;
      events.push({ type: 'checkpoint', id: c.id, tick: s.tick });
    }
  }

  // H1-H5: what is behind the 45 points, this tick only
  const patches = s.lamps.filter((l) => l.poly).map((l) => l.poly);
  const scene = sceneFor(level, patches);
  s.count = coverCount(body.x, body.y, body.coat, scene);
  s.hidden = isHidden(s.count);

  // H6: the paper sound on the edge, rate-limited (the drawing never is)
  if (s.hidden !== state.hidden && s.tick - state.lastPaperTick >= PAPER_GAP_TICKS) {
    events.push({ type: s.hidden ? 'paperHide' : 'paperShow', tick: s.tick });
    s.lastPaperTick = s.tick;
  }
  // narration: firstHide is an ink coat matched on ink (the line says "black on black"), not a go-behind or the light
  if (s.hidden && !state.hidden && body.coat === 'ink' && coverCount(body.x, body.y, 'ink', { ...scene, goBehinds: [] }) >= HIDE_MIN) {
    events.push({ type: 'firstHide', tick: s.tick });
  }

  // S1/S3/S4: who sees the hero
  const points = samplePoints(body.x, body.y);
  const view = viewRect(body, s.view);
  const hero = { points, hidden: s.hidden };
  const seers = s.lamps.filter((l) => lampSees({ ...l, onScreen: inView(l.bulb, view) }, hero));
  const seen = seers.length > 0;
  s.seenBy = seen ? seers[0].id : null;

  // narration: a brave pass -- hidden inside a live, on-screen beam for 0.3 s
  const brave = s.hidden && s.lamps.some((l) => l.poly && inView(l.bulb, view) && points.some((p) => pointInPoly(p, l.poly)));
  s.closeTicks = brave ? state.closeTicks + 1 : 0;
  if (s.closeTicks === CLOSE_CALL_TICKS) events.push({ type: 'closeCall', tick: s.tick });

  // S2: the warning meter -- fill while seen, hold 0.5 s unseen, then drain (CTO ruling 8). Longer grace
  // scales the fill only.
  const prevW = state.warn;
  const m = stepWarning({ w: prevW, unseenFor: state.warnUnseen }, seen, DT, s.longGrace ? LONG_GRACE_FILL : 1);
  s.warn = m.w;
  s.warnUnseen = m.unseenFor;
  // the cues follow w: the eye of the last lamp that saw you stays open while w > 0 (with the "!" + the note)
  s.eyeBy = s.warn > 0 ? (s.seenBy || state.eyeBy) : null;
  if (prevW === 0 && s.warn > 0) events.push({ type: 'warnStart', tick: s.tick, by: s.seenBy });
  if (prevW > 0 && s.warn === 0) events.push({ type: 'warnEnd', tick: s.tick });
  if (s.warn >= 1 && seen) {
    const snipper = seers.find((l) => level.lamps.find((d) => d.id === l.id).canSnip !== false);
    if (snipper) {
      s.snipping = true;
      s.respawnTicksLeft = RESPAWN_TICKS;
      s.snips += 1;
      s.seenBy = snipper.id;
      events.push({ type: 'snip', tick: s.tick, seeker: snipper.id });
      return { state: s, events };
    }
    if (!state.held) events.push({ type: 'rehearsalSnap', tick: s.tick, by: s.seenBy });
    s.held = true;
  } else if (s.warn < 1) s.held = false;

  // the last hide: hidden behind the end piece
  const end = level.goBehinds.find((g) => g.end);
  if (end && s.hidden && points.filter((p) => behindAt(p, { ground: 'none', backdrops: [], patches: [], goBehinds: [end] }) === 'covered').length >= HIDE_MIN) {
    s.ended = true;
    events.push({ type: 'ended', tick: s.tick });
  }
  return { state: s, events };
}
