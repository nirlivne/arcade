// Level 1 data: set 1 (G-A-M-E hops, the M hide, the R-E wall + CP1) and the start of set 2 with
// W2 (spec §3.2 beats 1-8). S1 scope only: the x positions below are a tracer-bullet approximation
// of the beat table, not final authored geometry -- S4 owns the precise, bot-checked level.
import { EYE_H, patrolSweep } from '../sim/seekers.js';
import { LAMP_HALF_ANGLE_DEG, sweepOffsetDeg, beamFootprint, bulbLit } from '../sim/lamps.js';

// S4a scope note: beats 12-13 (SET 3's R2 lamp-code doors / Frame F2, CP6) are a carry-over this
// slice doesn't touch (CTO/board cut, THE-1555); sets 4-5 below pick up from a fresh CP7 instead
// of continuing set 3's unfinished lobby. Film frames (F1-F3) are S5/S9 scope per spec §3.1's
// content-numbers table, so set 4 has no frame piece here either.

export const LETTER_H = 240;
export const GROUND_Y = 0;

// Set starts (THE-1559 world shift, CTO answer to Q1): sets 4-6 moved right to make room for the
// R2 lobby (set 3, CP5 -> SET4_START, +1500 u) and the R1 EDITOR wall (set 5, CP10 -> SET6_START,
// another +1300 u). Every set 4-6 x below is written relative to its set's start, so nothing
// inside a set moved relative to its seekers. Pre-shift values: 7000 / 9900 / 12000.
export const SET4_START = 8500;
export const SET5_START = 11400;
export const SET6_START = 14800;

// R2 the lamp-code doors (spec §3.4 / beat 12, THE-1559): the lobby runs from CP5 to this wall,
// 720 u high (out of jump reach), which closes the lobby on the right, so a door is the only way
// on. CP6 sits on top of it; from there the hero drops into set 4.
export const R2_WALL = { x: SET4_START - 600, y: -720, w: 100, h: 720, solid: true, oneWay: false };
// camera x for the 0.8 s wide hold on lobby entry (render only, game.js): CP5, the doors, the
// bulb and the wall all fit in the 1920 u authoring frame around it
export const R2_LOBBY_VIEW_X = 7250;
export const R2_CODE = 2; // the bulb's blinks per cycle (sim/lamps.js bulbLit); the 2-dash door is right
const R2_CLOSET_EXIT = { x: 6540, y: 0 }; // the lobby's left edge, just short of L4's reach
const R2_LIFT_TO = { x: R2_WALL.x + 50, y: R2_WALL.y }; // = CP6's spawn

// R1 the backwards letter (spec §3.4 / beat 19, THE-1559): the giant EDITOR wall, 720 u tall (out
// of jump reach), between CP10 and set 6. The letters are backdrop seek pieces (SEEK_PIECES below);
// the R is cut backwards and is the door: a solid barrier right behind it closes the way on, and
// opens (sim/run.js drops any rect whose `opensWith` piece is resolved) once a FLIP turns the R
// right. The barrier sits behind the R, not on it, so the hero can stand in front of the R itself.
const R1_WALL_X = SET5_START + 2300;
const R1_LETTER_W = 150;
export const R1_DOOR = { x: R1_WALL_X + 6 * R1_LETTER_W, y: -720, w: 50, h: 720, solid: true, oneWay: false, opensWith: 'r1R' };
// The Negative (spec beat 19): on a black backing just behind the R, on the only path to set 6, so
// the ending can't be reached without it. Touching it takes it (sim/run.js).
export const NEGATIVE = { x: R1_DOOR.x + R1_DOOR.w + 50, y: -120, w: 80, h: 120 };

// set 6 stage end (THE-1559, THE-1558 review): a wall at the Editor's back (Editor eye x = I-slot
// right edge + 200 = SET6_START + 1210, makeWatcherEditor below; run.test.mjs "stage end" pins
// it), 720 u high (out of jump reach, like the EDITOR wall), so the CP12 jump over his head has
// nowhere to land. Its left face is 1 u behind his eye, so the eye stays outside it and his sight
// isn't blocked.
export const STAGE_END_WALL = { x: SET6_START + 1211, y: -720, w: 789, h: 720, solid: true, oneWay: false };

// platforms: the physics/collision rects. hideShapes: back-layer ink shapes for cover sampling
// (some platforms double as hide shapes; decorative hide letters like the M carry no collision).
export const platforms = [
  // the floors are collision only: the ground's *ink* for cover purposes is the set's background
  // fill (groundInk in coverWorldAt below), not this thin collision rect -- see THE-1550 hand-off.
  { x: -1000, y: GROUND_Y, w: 4000, h: 2000, solid: true, oneWay: false }, // set 1 floor
  { x: 3000, y: GROUND_Y, w: SET4_START - 3000, h: 2000, solid: true, oneWay: false }, // sets 2-3 floor (to the R2 lobby's end)

  // G-A-M-E hops: one-way ledge tops, small gaps between
  { x: 700, y: -LETTER_H, w: 140, h: 20, solid: true, oneWay: true, ink: 'ink', label: 'G' },
  { x: 900, y: -LETTER_H, w: 140, h: 20, solid: true, oneWay: true, ink: 'ink', label: 'A' },
  { x: 1100, y: -LETTER_H, w: 140, h: 20, solid: true, oneWay: true, ink: 'ink', label: 'M' },
  { x: 1300, y: -LETTER_H, w: 140, h: 20, solid: true, oneWay: true, ink: 'ink', label: 'E' },
  // 300u word gap down to the floor follows (no platform until the floor resumes)

  // the R-E wall: two solid climbable steps, CP1 on top of the E
  { x: 2600, y: -LETTER_H, w: 150, h: LETTER_H, solid: true, oneWay: false, ink: 'ink', label: 'R' },
  { x: 2790, y: -360, w: 150, h: 360, solid: true, oneWay: false, ink: 'ink', label: 'E' },

  // sets 4-5 floor (S4a: THE-1555), continuing from set 3's floor at SET4_START
  { x: SET4_START, y: GROUND_Y, w: SET6_START - SET4_START, h: 2000, solid: true, oneWay: false },
  // set 6 floor (THE-1557), continuing at SET6_START: CP11 -> the chase -> CP12 -> the I-slot
  { x: SET6_START, y: GROUND_Y, w: 2000, h: 2000, solid: true, oneWay: false },
  STAGE_END_WALL,
  R2_WALL,
  R1_DOOR,
];

// set 5 "EDITED BY THE EDITOR": free-standing FRONT-layer letters (spec beat 17, G5) -- the hero
// passes BEHIND them, so they are not in `platforms` (never collision) and are drawn after the
// hero (game.js). They still block LOS (segmentBlocked, los.js reads solid && !oneWay off any
// rect it's given, not specifically `platforms`) via frontLayerAt() below. CTO review on THE-1556:
// these were wrongly in `platforms` as solid collision, so no hide rect could ever actually be
// entered -- a hero walking toward one just stopped against its wall. The I is drawn (visual only,
// spec fix 5: "too narrow" for a hide rect) but carries no hide rect and isn't a LOS blocker.
export const SET5_LETTERS = [
  { x: SET5_START + 100, y: -200, w: 150, h: 200, ink: 'ink', label: 'E (set5)' },
  { x: SET5_START + 400, y: -200, w: 150, h: 200, ink: 'ink', label: 'D (set5)' },
  { x: SET5_START + 700, y: -200, w: 70, h: 200, ink: 'ink', label: 'I (set5)' },
  { x: SET5_START + 1000, y: -200, w: 150, h: 200, ink: 'ink', label: 'T (set5)' },
  { x: SET5_START + 1300, y: -200, w: 150, h: 200, ink: 'ink', label: 'E2 (set5)' },
  { x: SET5_START + 1600, y: -200, w: 150, h: 200, ink: 'ink', label: 'D2 (set5)' },
  // R1's two front hide letters (spec §3.4, THE-1559 Q9): before the EDITOR wall, where a hero can
  // duck while W8 looks at a rattled letter. The first holds CP10's spawn. Both stay clear of the
  // letters' 40 u seek pads (seek.test.mjs data test), so FLIP inside them is always a coat flip.
  { x: SET5_START + 1850, y: -200, w: 150, h: 200, ink: 'ink', label: 'T (r1 front)' },
  { x: SET5_START + 2100, y: -200, w: 150, h: 200, ink: 'ink', label: 'E (r1 front)' },
];
// LOS-blocking front layer: solid/oneWay are read by los.js's segmentBlocked off whatever rect
// list it's given (run.js feeds this in addition to, never instead of, the collision rects) -- the
// I is left out, "visual only" per spec fix 5.
export function frontLayerAt(x) {
  return SET5_LETTERS.filter((l) => l.label !== 'I (set5)').map((l) => ({ ...l, solid: true, oneWay: false }));
}

// Red-set hide rects (spec §2.1 "Hidden" exceptions, fix 5): the whole-body-box front-layer hide
// spots on set 5's E, D, T, E, D -- same geometry as the letters above (minus the I), kept as
// their own export so frontHideFull() (cover.js) doesn't have to filter SET5_LETTERS by label.
export const SET5_HIDE_RECTS = frontLayerAt().map(({ x, y, w, h }) => ({ x, y, w, h }));
export function redSetAt(x) {
  return x >= SET5_START && x < SET6_START;
}
export function hideRectsAt(x) {
  return redSetAt(x) ? SET5_HIDE_RECTS : [];
}

// The last hide (spec beat 22, fix 4): the I of INK is an empty slot backed by an authored ink
// back-plate >= body box + 20u on each side (BODY_W=70, BODY_H=162 -> >= 110x202u), so the ink
// coat gets full cover there the same way set 5's letters do (frontHideFull). This is its own
// small zone, not the whole of set 6 -- unlike the red set, set 6 has no general ground-cover rule
// (spec §3.3: "Set 6: scissors (contact), then the Editor's sight on the title").
export const I_SLOT_RECT = { x: SET6_START + 900, y: -202, w: 110, h: 202 };
export function inISlotAt(x) {
  return x >= I_SLOT_RECT.x - 50 && x < I_SLOT_RECT.x + I_SLOT_RECT.w + 50;
}
export function iSlotHideRectsAt(x) {
  return inISlotAt(x) ? [I_SLOT_RECT] : [];
}

// R3 the disguise queue (spec §3.4, beat 15): a 1500 u open stage, no platforms inside it.
export const CROWD_ZONE = { xMin: SET4_START + 1100, xMax: SET4_START + 2600 };
export function isInCrowdZone(x) {
  return x >= CROWD_ZONE.xMin && x < CROWD_ZONE.xMax;
}

// the M of COMPANY: a wide ink hide window, no collision (fix 5's "wide cut" niche)
export const hideOnlyShapes = [
  { x: 2150, y: -LETTER_H, w: 220, h: LETTER_H, ink: 'ink', label: 'M-hide' },
  // CTO fix on THE-1581: left edge moved 3350->2965, right edge 3650->3685 -- W2 triggers on at
  // x=3000 already in-cone/in-range facing left, so the old left edge made reaching cover take
  // ~0.6s of exposure (impossible, SPOTTED_S is 0.3s). 2965, not 3000: cover() needs the body's
  // full footprint inside the shape (BODY_W/2=35 either side of its centre x), so a body centred
  // right at the trigger (x=3000) only gets full cover if the shape already starts 35u earlier --
  // at exactly 3000 half the body still sampled the uncovered 'mus' ground past the trigger line.
  // Same buffer applied at the right edge (3650->3685), matching W2's own xMax: the scripted hide
  // route (THE-1581, run.test.mjs) creeps across the whole band in short hidden bursts and needs
  // full cover available right up to W2's patrol limit, not 35u short of it.
  { x: 2965, y: -LETTER_H, w: 720, h: LETTER_H, ink: 'ink', label: 'STA-hide' }, // set 2: S, T, A of STARRING
  // CTO fix on THE-1581: left edge moved 4030->3685, made contiguous with STA-hide's right edge;
  // right edge moved 4250->4285 (same BODY_W/2=35 buffer as STA-hide, see above -- a body centred
  // right at the old 4250 edge only got partial cover). W2's own cone (length 760, same-height
  // alignment) stays "in cone" continuously across any open gap between hide shapes, so an
  // un-hidden crossing of even a modest gap accumulates exposure for the whole crossing (over
  // SPOTTED_S no matter how it's timed, at 600 u/s) -- removing the gap lets a hide route creep
  // the whole way through instead of needing a timed blind dash across it.
  { x: 3685, y: -LETTER_H, w: 600, h: LETTER_H, ink: 'ink', label: 'D-U-hide' }, // THE UNDERSTUDY: freeze under W3
  // set 4 beat 14 (W5, spec: "flip to cream, freeze on the ground, let it walk through"): the open
  // ground is already the hide surface here (coverWorldAt's set-4 band is 'cream'), so this shape
  // changes nothing about cover -- it names and positions the beat's hide window, in W5's own
  // patrol path, so level-check counts and verifies it like every other authored spot.
  { x: SET4_START + 100, y: GROUND_Y, w: 300, h: 1, ink: 'cream', label: 'set4-ground-hide' },
];

// Seek pieces (spec §2.1 "Seek action", THE-1559): FLIP while the body box overlaps one of these
// (padded SEEK_PAD, sim/run.js) resolves it instead of flipping the coat. The three odd pieces are
// decoration only (G1c cut the film frames): they flip right, drop nothing and save nothing. The
// backwards C still teaches R1's seek. seek.test.mjs checks no hide rect comes within the pad.
export const SEEK_PIECES = [
  // spec beat 4 (t ~12 s): the C of PICTURE, cut backwards, on the set 1 ground after the GAME hops
  { id: 'oddC', kind: 'odd', x: 1880, y: -LETTER_H, w: 150, h: LETTER_H, label: 'C (backwards)' },
  // spec beat 13: a hanging lamp whose paper shadow falls toward its own light, at the R2 lobby exit
  // (the drop from CP6 into set 4). Not a seeker: it doesn't count as L1-L4.
  { id: 'oddLamp', kind: 'odd', x: SET4_START - 320, y: -LETTER_H, w: 160, h: LETTER_H, label: 'lamp shadow (wrong way)' },
  // spec beat 16: the S of COSTUMES cut in two, near the end of set 4 (after the R3 queue)
  { id: 'oddS', kind: 'odd', x: SET5_START - 260, y: -LETTER_H, w: 150, h: LETTER_H, label: 'S (split)' },
  // R2 (spec §3.4): the O, D, R of PROOFREADERS, sill dashes 3, 1, 2. FLIP at a door opens it: the
  // door whose dashes match the bulb's blinks (R2_CODE) is a 1.5 s lift to CP6; the others are a
  // 3 s closet that lets you out at the lobby's left edge, so the walk back crosses L4's sweep.
  // `to`/`ticks` are where and after how long the hero comes out (sim/run.js).
  { id: 'doorO', kind: 'door', x: SET4_START - 1200, y: -LETTER_H, w: 120, h: LETTER_H, label: 'O (door)', dashes: 3, opens: 'closet', to: R2_CLOSET_EXIT, ticks: 360 },
  { id: 'doorD', kind: 'door', x: SET4_START - 1000, y: -LETTER_H, w: 120, h: LETTER_H, label: 'D (door)', dashes: 1, opens: 'closet', to: R2_CLOSET_EXIT, ticks: 360 },
  // R1 (spec §3.4): E-D-I-T-O-R. A FLIP at a wrong letter rattles it and alerts W8 (sim/run.js:
  // 0.5 s telegraph, then a 3 s look at that letter); it stays unresolved. The R is right: it turns,
  // opens R1_DOOR and solves R1.
  ...['E', 'D', 'I', 'T', 'O', 'R'].map((ch, i) => ({
    id: `r1${ch}`, kind: 'letter', x: R1_WALL_X + i * R1_LETTER_W, y: -720, w: R1_LETTER_W, h: 720, label: `${ch} (r1)`,
    ...(ch === 'R' ? { riddle: 'R1', backwards: true } : { alerts: 'w8' }),
  })),
  { id: 'doorR', kind: 'door', x: SET4_START - 800, y: -LETTER_H, w: 120, h: LETTER_H, label: 'R (door)', dashes: 2, opens: 'lift', to: R2_LIFT_TO, ticks: 180 },
];

// set: which of the game's 6 sets this checkpoint sits in (spec §3.1: "Sets / screens / length:
// 6 / ~14 / ~27 000 u"), for the title screen's "Continue (SET n/6)" (spec §8).
export const SET_COUNT = 6;
export const checkpoints = [
  { id: 'start', set: 1, spawnX: 600, spawnY: GROUND_Y, coat: 'ink', triggerX: 550, triggerY: -50, triggerW: 1, triggerH: 1 },
  { id: 'cp1', set: 1, spawnX: 2865, spawnY: -360, coat: 'ink', triggerX: 2790, triggerY: -460, triggerW: 150, triggerH: 100 },
  { id: 'cp2', set: 2, spawnX: 3875, spawnY: GROUND_Y, coat: 'ink', triggerX: 3800, triggerY: -100, triggerW: 150, triggerH: 100 },
  // CP3: past W3's patrol zone (xMax 4250), the SET 3 boundary where this slice's scope starts.
  { id: 'cp3', set: 3, spawnX: 4350, spawnY: GROUND_Y, coat: 'ink', triggerX: 4300, triggerY: -100, triggerW: 150, triggerH: 100 },
  // CP4 (spec beat 10, t=52s): past L2's floor sweep (past the sweep's full footprint envelope).
  { id: 'cp4', set: 3, spawnX: 5300, spawnY: GROUND_Y, coat: 'ink', triggerX: 5250, triggerY: -100, triggerW: 150, triggerH: 100 },
  // CP5 (spec beat 11, t=62s): the R2 lobby entrance, past W4's hand lamp.
  { id: 'cp5', set: 3, spawnX: 6500, spawnY: GROUND_Y, coat: 'ink', triggerX: 6450, triggerY: -100, triggerW: 150, triggerH: 100 },
  // CP6 (spec beat 12 end, t=76s): on top of the R2 lobby wall, where the right door's lift arrives.
  { id: 'cp6', set: 3, spawnX: R2_LIFT_TO.x, spawnY: R2_LIFT_TO.y, coat: 'ink', triggerX: R2_WALL.x, triggerY: R2_WALL.y - 100, triggerW: R2_WALL.w, triggerH: 100 },
  // CP7 (spec beat 14): SET 4 start.
  { id: 'cp7', set: 4, spawnX: SET4_START + 50, spawnY: GROUND_Y, coat: 'cream', triggerX: SET4_START, triggerY: -100, triggerW: 150, triggerH: 100 },
  // CP8 (spec beat 14/15 boundary, t=94s): "behind the front-layer O (safe viewing spot)", just
  // before the R3 queue zone -- keeps the queue's replay-on-snip within the spec's <= 15s ceiling.
  // THE-1557 carry-over: triggerH was 100, well under physics.js's APEX_HEIGHT (300) -- a jump
  // cleared it outright and skipped the checkpoint, so the queue beat was never shown. 400 clears
  // the full jump apex with margin.
  { id: 'cp8', set: 4, spawnX: SET4_START + 1050, spawnY: GROUND_Y, coat: 'ink', triggerX: SET4_START + 1000, triggerY: -400, triggerW: 150, triggerH: 400 },
  // CP9 (spec beat 17, t=114s): SET 5 start, past the R3 zone. (CP10, beat 18's R4 Mole ledge, is
  // the other half of this slice's cut -- THE-1557.) Spawn centred inside the first hide rect (the
  // set-5 E), not just past the trigger flag -- the red set gives no cover outside a hide rect, so
  // a respawn anywhere else in W7's reach would be an instant, un-escapable re-snip.
  { id: 'cp9', set: 5, spawnX: SET5_START + 175, spawnY: GROUND_Y, coat: 'ink', triggerX: SET5_START, triggerY: -100, triggerW: 150, triggerH: 100 },
  // CP10 (spec beat 18, t=126s): past SET5_LETTERS (end SET5_START+1750) and W7's patrol loop
  // (xMax SET5_START+1400) -- R4 the Mole is cut (G1b), so this is just "the long way past the second W7 loop",
  // pure geometry/timing, no new mechanic.
  { id: 'cp10', set: 5, spawnX: SET5_START + 1900, spawnY: GROUND_Y, coat: 'ink', triggerX: SET5_START + 1850, triggerY: -100, triggerW: 150, triggerH: 100 },
  // CP11 (spec beat 19/20 boundary, t=136s): SET 6 start, "the cutting room". The reveal stub
  // (beat 20) and the scissors chase (beat 21) both run relative to this checkpoint's own cpTick,
  // same as every other timed beat in this level (sim/run.js).
  { id: 'cp11', set: 6, spawnX: SET6_START + 50, spawnY: GROUND_Y, coat: 'ink', triggerX: SET6_START, triggerY: -100, triggerW: 150, triggerH: 100 },
  // CP12 (spec beat 21/22 boundary, t=155s): "the foot of the circle (the scissors stop at the
  // light)". 650u past CP11 -- a hero holding the run cap the whole chase clears it with room to
  // spare (sim/scissors.test.mjs proves the cap always outruns the chase).
  { id: 'cp12', set: 6, spawnX: SET6_START + 700, spawnY: GROUND_Y, coat: 'ink', triggerX: SET6_START + 650, triggerY: -100, triggerW: 150, triggerH: 100 },
];

// W1 the Doorman (spec §3.2 beat 6): steps out of the E's set-1 face at t=20s (a 0.5s head-tilt
// before its wedge turns on), then walks left at 240 u/s from there to x=200 and back, looping.
// Off duty (sim/run.js's triggerAtTick gate) until t=20.5s, so it can't catch anyone before that --
// the spec's "can't be lost" first 20s.
export function makeWatcherW1() {
  const xStart = 2790, xMin = 200, y = GROUND_Y - EYE_H, speed = 240;
  const legS = (xStart - xMin) / speed; // one-way walk time
  const periodS = legS * 2;
  return {
    id: 'w1',
    triggerAtTick: Math.round(20.5 * 120),
    makeRuntime: () => ({ x: xStart, y, speed, halfAngleDeg: 22, length: 760, facingAngle: Math.PI, exposure: 0, peak: 0, spottedFired: false }),
    // S1/S2 stand-in: a continuous ping-pong, no patrol-end dwell/head-turn yet (S3 scope, like W2).
    patrol(rt, activeTick) {
      const tSec = (activeTick / 120) % periodS;
      const goingLeft = tSec < legS;
      const x = goingLeft ? xStart - speed * tSec : xMin + speed * (tSec - legS);
      return { ...rt, x, facingAngle: goingLeft ? Math.PI : 0 };
    },
  };
}

// L1 the rehearsal lamp (spec §3.2 beat 7, t=18-24s): "its beam sweeps the path; it can't snip
// (exposure caps at 0.29s) -> guaranteed close call." THE-1557 carry-over: gives L1 the real lamp's
// 12deg beam and sweep (same deterministic oscillation as L2/W4), matching the other three.
//
// beamShape (the cream footprint that would let a cream coat actually hide in L1's beam) is
// deliberately NOT wired in. L1 sits at x=3100, dead centre of STA-hide's authored ink span
// (2965-3685, see below); ANY footprint placed near L1 (beamFootprint's spread is only ~75u
// regardless of angle) lands inside that span. Tried both priority orders in coverWorldAt's shape
// list: lamp-overrides-authored (matches L2/W4's spec intent) pokes a real ~75u hole in STA-hide's
// established ink safety, which the existing "reactive hide route reaches CP3 with zero snips" test
// catches (a snip from W2, not from L1 -- losing ink-cover there exposes the hero to W2's cone, a
// few ticks into set 2); authored-overrides-lamp protects that route but makes L1's beamShape
// permanently inert (its whole footprint is inside STA-hide, so cream cover there is always 0).
// CEO decision (THE-1603, 2026-11-13): keep STA-hide's safety. L1 stays visual-only -- a sweeping
// lamp for looks and tension, no cover effect. Don't move L1, don't narrow STA-hide, no per-shape
// priority flag. The "flip to cream in a lamp beam" lesson is already taught by L2 and W4.
export function makeWatcherL1() {
  const x = 3100, y = GROUND_Y - EYE_H;
  return {
    id: 'l1',
    makeRuntime: () => ({ x, y, speed: 0, halfAngleDeg: LAMP_HALF_ANGLE_DEG, length: 760, facingAngle: Math.PI, maxExposure: 0.29, exposure: 0, peak: 0, spottedFired: false, isLamp: true }),
    patrol(rt, triggerTick) {
      const facingAngle = Math.PI + (sweepOffsetDeg(triggerTick / 120) * Math.PI) / 180;
      return { ...rt, facingAngle };
    },
  };
}

export function makeWatcherW2() {
  const xMax = 3650, xMin = 3250, y = GROUND_Y - EYE_H, speed = 180;
  return {
    id: 'w2',
    // the patrol clock starts only once the hero crosses into set 2 (S1 feel check D1 #1: keyed to
    // cpTick it ran from level start, so W2 was already parked over the R-E wall on arrival).
    triggerX: 3000,
    makeRuntime: () => ({ x: xMax, y, speed, halfAngleDeg: 22, length: 760, facingAngle: Math.PI, exposure: 0, peak: 0, spottedFired: false }),
    // Full patrol (spec §2.1 "Watchers": walk, head-tilt 0.5s, turn 0.25s, dwell 1.5s at each end).
    // Replaces the old S1/S2 one-way stand-in (THE-1552 carry-over: a static clamp at xMin left a
    // long undefended dwell a no-hide search bot could always time a crossing against).
    patrol(rt, triggerTick) {
      const p = patrolSweep(triggerTick / 120, { xMin, xMax, speed });
      return { ...rt, x: p.x, facingAngle: p.facingAngle };
    },
  };
}

// W3 on THE UNDERSTUDY's letter tops (spec §3.2 beat 9, t=32-42s): "looks down (walk 3s/look
// 1.5s). Cross under on em-dash ledges, freeze on D and U." It walks a full patrol leg in exactly
// WALK_S (leg distance / speed), so it's stationary and facing straight down at each end during
// the 1.5s look -- the predictable, readable threat the beat teaches ("cone from above"). The
// player crosses on the set 2 floor beneath it (a separate "em-dash ledge" layer is S4 scope, like
// the rest of this level's precise geometry) and ducks into the D-U hide window to pass unseen.
export function makeWatcherW3() {
  // CTO review on THE-1551: the sim y is the eye, not the feet -- W3 stands on the letter tops
  // (feet at -LETTER_H), so its eye is 175u above that, not AT -LETTER_H.
  // CTO fix on THE-1581: xMin 3950/triggerX 4000 turned W3 on *inside* its own floor footprint
  // (about 3782-4118 at xMin), so a runner crossing from CP2 only got ~0.2s of real exposure --
  // a data bug, not a phase/logic one. xMin 4100 (speed 50 keeps the walk at exactly WALK_S=3s,
  // same as before) and triggerX 3900 turns it on before that footprint while keeping the CP2
  // spawn (3875) outside it.
  const xMin = 4100, xMax = 4250, y = -LETTER_H - EYE_H, speed = 50;
  const WALK_S = 3, LOOK_S = 1.5, periodS = WALK_S + LOOK_S;
  return {
    id: 'w3',
    triggerX: 3900,
    makeRuntime: () => ({ x: xMin, y, speed, halfAngleDeg: 22, length: 760, facingAngle: Math.PI / 2, exposure: 0, peak: 0, spottedFired: false }),
    patrol(rt, triggerTick) {
      const tSec = triggerTick / 120;
      const legIndex = Math.floor(tSec / periodS);
      const cyclePos = tSec - legIndex * periodS;
      const goingRight = legIndex % 2 === 0;
      const walkProgress = Math.min(cyclePos, WALK_S); // clamps once the look phase starts
      const x = goingRight ? xMin + speed * walkProgress : xMax - speed * walkProgress;
      return { ...rt, x, facingAngle: Math.PI / 2 };
    },
  };
}

// L2 the floor sweep (spec §3.2 beat 10, t=42-52s): "sweeps the floor. Ink coat in the dark is
// hidden when still; the beam is cream, so flip to cream and freeze before it reaches you." A
// hanging lamp, stationary x, its beam swinging side to side over the set 3 floor between CP3 and
// CP4. halfAngleDeg/length are generous (the beam's real reach is the floor footprint fed into
// cover; inCone/LOS only need to not themselves clip a hero standing in the lit patch).
export function makeWatcherL2() {
  const x = 4650, y = -700; // hangs well above the floor so the sweep covers a wide floor patch
  return {
    id: 'l2',
    triggerX: 4550, // off duty until past CP3's trigger zone, so the CP3 spawn stays safe (like W2/W3)
    makeRuntime: () => ({ x, y, speed: 0, halfAngleDeg: LAMP_HALF_ANGLE_DEG, length: 1400, facingAngle: Math.PI / 2 + (sweepOffsetDeg(0) * Math.PI) / 180, exposure: 0, peak: 0, spottedFired: false, isLamp: true }),
    patrol(rt, triggerTick) {
      const facingAngle = Math.PI / 2 + (sweepOffsetDeg(triggerTick / 120) * Math.PI) / 180;
      return { ...rt, facingAngle };
    },
    beamShape(rt) {
      return beamFootprint({ x: rt.x, y: rt.y }, rt.facingAngle, rt.halfAngleDeg, GROUND_Y);
    },
  };
}

// W4 with a hand lamp (spec §3.2 beat 11, t=52-62s): "its beam is a moving cream wedge; freeze
// cream in it, ink outside it." Stood at the edge of the R2 lobby floor between CP4 and CP5 (a
// stationary stand-in like L1/L2 -- W4 walking its own patrol while also swinging a hand lamp is
// S4 geometry scope, not this slice's). Held up and aimed down at the approaching floor, same
// "sweeps a floor patch" shape as L2 -- held-vs-hanging is a render-only distinction.
export function makeWatcherW4() {
  const x = 6000, y = -500;
  return {
    id: 'w4',
    triggerX: 5450, // off duty until past CP4's trigger zone
    makeRuntime: () => ({ x, y, speed: 0, halfAngleDeg: LAMP_HALF_ANGLE_DEG, length: 1400, facingAngle: Math.PI / 2 + (sweepOffsetDeg(0) * Math.PI) / 180, exposure: 0, peak: 0, spottedFired: false, isLamp: true }),
    patrol(rt, triggerTick) {
      const facingAngle = Math.PI / 2 + (sweepOffsetDeg(triggerTick / 120) * Math.PI) / 180;
      return { ...rt, facingAngle };
    },
    beamShape(rt) {
      return beamFootprint({ x: rt.x, y: rt.y }, rt.facingAngle, rt.halfAngleDeg, GROUND_Y);
    },
  };
}

// L3 the R2 code bulb (spec §3.4, beat 12): hangs over the D door and blinks the code (sim/lamps.js
// bulbLit, N = 2). It only sees while lit: dark, its cone has zero length, so exposure resets
// between pulses (CTO rule, THE-1559 Q5) and the r2.test.mjs gate holds a hero still under it for
// 3 cycles without a snip.
export function makeWatcherL3() {
  const x = SET4_START - 940, y = -600;
  const LIT_LENGTH = 1400;
  return {
    id: 'l3',
    triggerX: 6560, // on duty once past CP5, like L4
    makeRuntime: () => ({ x, y, speed: 0, halfAngleDeg: LAMP_HALF_ANGLE_DEG, length: LIT_LENGTH, lit: true, facingAngle: Math.PI / 2, exposure: 0, peak: 0, spottedFired: false, isLamp: true }),
    patrol(rt, triggerTick) {
      const lit = bulbLit(triggerTick);
      return { ...rt, lit, length: lit ? LIT_LENGTH : 0 };
    },
    beamShape(rt) {
      return rt.lit ? beamFootprint({ x: rt.x, y: rt.y }, rt.facingAngle, rt.halfAngleDeg, GROUND_Y) : null;
    },
  };
}

// L4 the lobby lamp (spec §3.2 beat 12): sweeps the lobby floor between CP5 and the doors, so the
// walk in -- and every walk back out of a wrong door's closet -- crosses it. Hung low (y -450) so
// its whole sweep stays between the closet exit (x 6540) and the first door's seek pad.
export function makeWatcherL4() {
  const x = 6920, y = -450;
  return {
    id: 'l4',
    triggerX: 6560,
    makeRuntime: () => ({ x, y, speed: 0, halfAngleDeg: LAMP_HALF_ANGLE_DEG, length: 1400, facingAngle: Math.PI / 2 + (sweepOffsetDeg(0) * Math.PI) / 180, exposure: 0, peak: 0, spottedFired: false, isLamp: true }),
    patrol(rt, triggerTick) {
      const facingAngle = Math.PI / 2 + (sweepOffsetDeg(triggerTick / 120) * Math.PI) / 180;
      return { ...rt, facingAngle };
    },
    beamShape(rt) {
      return beamFootprint({ x: rt.x, y: rt.y }, rt.facingAngle, rt.halfAngleDeg, GROUND_Y);
    },
  };
}

// W5 (spec §3.2 beat 14, t=84-94s): "patrols toward you on open ground: flip to cream, freeze on
// the ground, let it walk through." Set 4's ground is cream (same cover rule as set 1), so a
// plain back-and-forth patrol like W2's is the whole mechanic -- no letters to hide on here.
export function makeWatcherW5() {
  const xMin = SET4_START + 200, xMax = SET4_START + 700, y = GROUND_Y - EYE_H, speed = 180;
  return {
    id: 'w5',
    triggerX: SET4_START + 50,
    makeRuntime: () => ({ x: xMax, y, speed, halfAngleDeg: 22, length: 760, facingAngle: Math.PI, exposure: 0, peak: 0, spottedFired: false }),
    patrol(rt, triggerTick) {
      const p = patrolSweep(triggerTick / 120, { xMin, xMax, speed });
      return { ...rt, x: p.x, facingAngle: p.facingAngle };
    },
  };
}

// W6 the balcony Watcher (spec §3.4 R3, beat 15): "whose wedge covers the whole stage and never
// turns." Stationary, high above the 1500 u queue stage, facing straight down; wide enough that
// every point of the stage floor falls inside the cone from this one fixed position. Its own
// exposure/spotted machinery is unchanged -- only `hidden` is computed differently while the hero
// is inside CROWD_ZONE (sim/crowd.js), via W6's own triggerTick as the zone's beat clock (fix 1:
// seeker timers already run on "time since this checkpoint/trigger was (re)entered").
export function makeWatcherW6() {
  const x = (CROWD_ZONE.xMin + CROWD_ZONE.xMax) / 2, y = -900;
  // length is deliberately short of the zone's exact farthest corner (half the zone width, at the
  // hero's feet on the ground), not padded past it. THE-1555 review: even a few extra units of
  // length let W6's cone reach past the literal 1500 u stage -- and because exposure doesn't reset
  // mid-accumulation, a hero exiting the zone the instant it clears CROWD_ZONE.xMax still had
  // exposure building from the last tick or two inside it, with nothing covering the (uncapped
  // run-speed) few units just past the boundary. 90% of the true corner distance leaves the very
  // edges of the stage uncovered, which is fine -- the queue mechanic is about crossing it, not
  // idling at its exact corner -- and keeps real margin past CROWD_ZONE.xMax.
  const halfZoneW = (CROWD_ZONE.xMax - CROWD_ZONE.xMin) / 2;
  const length = Math.hypot(halfZoneW, GROUND_Y - y) * 0.9;
  return {
    id: 'w6',
    triggerX: CROWD_ZONE.xMin,
    makeRuntime: () => ({ x, y, speed: 0, halfAngleDeg: 80, length, facingAngle: Math.PI / 2, exposure: 0, peak: 0, spottedFired: false }),
  };
}

// W7 (spec §3.2 beat 17, t=114-122s): paces set 5's floor while the hero dashes between the
// EDITED letters; the red-set rule (hidden.js) is what makes ducking behind one actually work.
export function makeWatcherW7() {
  const xMin = SET5_START + 300, xMax = SET5_START + 1400, y = GROUND_Y - EYE_H, speed = 180;
  return {
    id: 'w7',
    triggerX: SET5_START + 50,
    makeRuntime: () => ({ x: xMax, y, speed, halfAngleDeg: 22, length: 760, facingAngle: Math.PI, exposure: 0, peak: 0, spottedFired: false }),
    patrol(rt, triggerTick) {
      const p = patrolSweep(triggerTick / 120, { xMin, xMax, speed });
      return { ...rt, x: p.x, facingAngle: p.facingAngle };
    },
  };
}

// W8 (spec §3.4 R1, beat 19): guards the EDITOR wall from a perch above the front hide letters,
// facing away from the wall, back down the approach the hero already came along. A wrong-letter
// FLIP turns him (sim/run.js: 0.5 s telegraph, then a 3 s look aimed at that letter); then he
// looks away again. On duty from CP10's trigger, so the hero is never behind his default cone.
export function makeWatcherW8() {
  const x = SET5_START + 2200, y = -900;
  const away = Math.atan2(900, -1200); // down-left, away from the wall
  return {
    id: 'w8',
    triggerX: SET5_START + 1850,
    makeRuntime: () => ({ x, y, speed: 0, halfAngleDeg: 22, length: 1400, facingAngle: away, restAngle: away, telegraph: false, exposure: 0, peak: 0, spottedFired: false }),
  };
}

// The Editor (spec §3.2 beat 22, t=155-158s): "the Editor's sight sweeps the title ... Hidden ->
// clock stops." A plain stationary watcher like L1/L2/W4 -- the standard exposure/SPOTTED_S rule
// already does the job (no special-case like the scissors' "ignores hidden"): land in the I-slot,
// flip to ink, freeze before this sweep reaches you, same as any other seeker in this level.
export function makeWatcherEditor() {
  const x = I_SLOT_RECT.x + I_SLOT_RECT.w + 200, y = GROUND_Y - EYE_H;
  return {
    id: 'editor',
    // THE-1557 fix: was CP12's own trigger (SET6_START+650) -- the open 200u walk from CP12 to the
    // I-slot takes ~0.33s at the run cap, just past SPOTTED_S (0.3s), so a straight, no-stopping
    // approach got snipped on arrival every time (run.test.mjs "CP12 to the I-slot..."). The Editor
    // guards the title (the I-slot), not the whole approach -- triggering right at its edge matches
    // spec: "sweeps the title", and still catches anyone who lingers exposed near it without hiding.
    triggerX: I_SLOT_RECT.x - 50,
    makeRuntime: () => ({ x, y, speed: 0, halfAngleDeg: 22, length: 760, facingAngle: Math.PI, exposure: 0, peak: 0, spottedFired: false }),
  };
}

export const watchers = [
  makeWatcherW1(), makeWatcherL1(), makeWatcherW2(), makeWatcherW3(), makeWatcherL2(), makeWatcherW4(),
  makeWatcherL3(), makeWatcherL4(), makeWatcherW5(), makeWatcherW6(), makeWatcherW7(), makeWatcherW8(), makeWatcherEditor(),
];

const allCoverShapes = [
  ...platforms.filter((p) => p.ink).map((p) => ({ ...p, layer: 'back' })),
  ...hideOnlyShapes.map((s) => ({ ...s, layer: 'back' })),
];

// set 1: cream ground. set 2 (from x=3000): tangerine/"mus" ground, neither coat matches -- hide
// on the ink letters instead (spec §3.3). set 3 (from CP3, x=4350): ink ground (spec: "ink ground,
// cream letters"), so the ink coat hides directly on the ground in the dark, same as a lamp's beam
// hides the cream coat. Set 4 (from CP7, SET4_START): cream ground again (spec: "cream ground, ink
// letters"). Set 5 (from SET5_START): the red/"lipstick" set -- groundInk is cosmetic here
// since redSetAt() routes `hidden` through frontHideFull instead of cover() (see run.js).
export function setAt(x) {
  return x < 3000 ? 1 : x < 4350 ? 2 : x < SET4_START ? 3 : x < SET5_START ? 4 : x < SET6_START ? 5 : 6;
}

export function coverWorldAt(x, extraShapes = []) {
  const groundInk = x < 3000 ? 'cream' : x < 4350 ? 'mus' : x < SET4_START ? 'ink' : x < SET5_START ? 'cream' : x < SET6_START ? 'red' : 'ink';
  return { groundInk, set: setAt(x), shapes: extraShapes.length ? [...allCoverShapes, ...extraShapes] : allCoverShapes };
}
