// The rework's whole-game step (THE-1648; spec-rework §1, board design §3): physics -> hidden (H1-H5) ->
// seen (S1, S3, S4) -> the warning meter (S2) -> snip / respawn (rule 5). Pure: game.js and the tests only
// change the state through step(). Hazards run on the sim beat clock (CTO ruling 4), so a respawn never
// resets them. The released level's step (sim/run.js) stays for the later levels.
import { DT, BODY_H, tick as physicsTick, newBody } from './physics.js';
import { samplePoints, coverCount, isHidden, beamPolygon, lampSees, guardSees, roomSees, stepWarning, inView, pointInPoly, beatAt, HIDE_MIN } from './rules.js';
import { guardNow, roomNow } from './hazards.js';

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
    ...hazardsAt(level, tick),
    lastPaperTick: -Infinity,
    closeTicks: 0,
    ended: false,
    view: overrides.view || DEFAULT_VIEW,
    longGrace: !!overrides.longGrace,
    graceUsed: !!overrides.graceUsed,
  };
}

// a lamp at one beat: its angle and lit state, and the polygon that is both drawn and counted (H3)
function lampNow(l, beat) {
  const angleDeg = l.angleAt(beat);
  const lit = l.litAt(beat);
  return { id: l.id, bulb: l.bulb, angleDeg, lit, glow: l.glowAt ? l.glowAt(beat) : false, zone: l.zone || null, canSnip: l.canSnip !== false, poly: lit ? beamPolygon({ bulb: l.bulb, angleDeg, halfAngleDeg: l.halfAngleDeg, throw: l.throw }) : null };
}

// every watcher at one beat: lamps, guards (+ their clipped cones), flashing rooms. They run on the sim beat
// clock only, so a snip or a respawn never resets them (rule 5).
export function hazardsAtBeat(level, beat) {
  return {
    lamps: level.lamps.map((l) => lampNow(l, beat)),
    guards: (level.guards || []).map((g) => ({ ...guardNow(g, beat, level.solids), canSnip: g.canSnip !== false })),
    rooms: (level.rooms || []).map((r) => ({ ...roomNow(r, beat), canSnip: r.canSnip !== false })),
  };
}
export const hazardsAt = (level, tick) => hazardsAtBeat(level, beatAt(tick));

// points of the body covered by these go-behinds alone (no coat can match: coat null)
const coveredBy = (x, feetY, goBehinds) => coverCount(x, feetY, null, { ground: 'open', backdrops: [], patches: [], goBehinds });
const rectsMeet = (r, v) => r.x < v.x1 && r.x + r.w > v.x0 && r.y < v.y1 && r.y + r.h > v.y0;

// What the watchers make of a body this tick (H1-H5, S1, S3, S4, ruling 11). view = the camera rect, or null
// for "everything on screen" (the window check's strict case). step() and the window check both use it.
export function perceive(level, hz, body, view) {
  const patches = hz.lamps.filter((l) => l.poly).map((l) => l.poly);
  const scene = sceneFor(level, patches);
  const centre = { x: body.x, y: body.y - BODY_H / 2 };
  const behindGB = coveredBy(body.x, body.y, level.goBehinds) >= HIDE_MIN;
  // ruling 11: inside a lit flashing room only a go-behind hides (H3 / H5 don't)
  const litRoom = hz.rooms.some((r) => r.lit && centre.x >= r.rect.x && centre.x < r.rect.x + r.rect.w && centre.y >= r.rect.y && centre.y < r.rect.y + r.rect.h);
  const count = litRoom ? coveredBy(body.x, body.y, level.goBehinds) : coverCount(body.x, body.y, body.coat, scene);
  const hidden = isHidden(count);
  const points = samplePoints(body.x, body.y);
  const hero = { points, hidden };
  const on = (p) => !view || inView(p, view);
  const seers = [
    ...hz.lamps.filter((l) => lampSees({ ...l, onScreen: on(l.bulb) }, hero)),
    ...hz.guards.filter((g) => guardSees({ ...g, onScreen: on(g.eye) }, hero)),
    ...hz.rooms.filter((r) => roomSees({ ...r, onScreen: !view || rectsMeet(r.rect, view) }, centre, behindGB)),
  ];
  // a brave pass: hidden inside a live, on-screen beam or cone
  const brave = hidden && (hz.lamps.some((l) => l.poly && on(l.bulb) && points.some((p) => pointInPoly(p, l.poly))) ||
    hz.guards.some((g) => on(g.eye) && points.some((p) => pointInPoly(p, g.cone))));
  return { scene, count, hidden, points, seers, brave };
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
  Object.assign(s, hazardsAt(level, s.tick)); // hazards keep running, snipped or not (rule 5)

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

  // H1-H5 (+ ruling 11 in a lit room): what is behind the 45 points, this tick only; S1/S3/S4: who sees
  const view = viewRect(body, s.view);
  const per = perceive(level, s, body, view);
  const { scene, points } = per;
  s.count = per.count;
  s.hidden = per.hidden;

  // H6: the paper sound on the edge, rate-limited (the drawing never is)
  if (s.hidden !== state.hidden && s.tick - state.lastPaperTick >= PAPER_GAP_TICKS) {
    events.push({ type: s.hidden ? 'paperHide' : 'paperShow', tick: s.tick });
    s.lastPaperTick = s.tick;
  }
  // narration: firstHide is an ink coat matched on ink (the line says "black on black"), not a go-behind or the light
  if (s.hidden && !state.hidden && body.coat === 'ink' && coverCount(body.x, body.y, 'ink', { ...scene, goBehinds: [] }) >= HIDE_MIN) {
    events.push({ type: 'firstHide', tick: s.tick });
  }

  const seers = per.seers;
  const seen = seers.length > 0;
  s.seenBy = seen ? seers[0].id : null;

  // narration: a brave pass -- hidden inside a live, on-screen beam or cone for 0.3 s
  s.closeTicks = per.brave ? state.closeTicks + 1 : 0;
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
    const snipper = seers.find((w) => w.canSnip);
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
  if (end && s.hidden && coveredBy(body.x, body.y, [end]) >= HIDE_MIN) {
    s.ended = true;
    events.push({ type: 'ended', tick: s.tick });
  }
  return { state: s, events };
}
