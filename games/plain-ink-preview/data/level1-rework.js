// Level 1 of the gameplay rework (spec-rework §3, board design §6): parts 1-2 (slice 1, THE-1648) and parts
// 3-4 with the timing hazards and the flashing room (slice 2, THE-1651; rulings 10-12). The released level
// (sets 1-6, riddles, finale) stays in data/level1.js for later levels.
//
// Units: world u, x right, y down, floor top at y = 0. Rects { x, y, w, h }, y = top edge.
// The four looks (spec-rework §2): standOns collide and carry tape + shadow; backdrops are flat full ink or
// cream; goBehinds are drawn in front of the hero and cover any coat; decorations do nothing.
import { makeLamp } from '../sim/hazards.js';

export const GROUND_Y = 0;
export const GROUND = 'tangerine'; // the whole level: open ground matches no coat (H4)

const standOn = (label, x, y, w, h) => ({ label, x, y, w, h, solid: true, oneWay: false, ink: 'ink', tape: true, shadow: true });

// The floor is a stand-on too (ink band, tape on top). No pits in level 1.
export const FLOOR = { ...standOn('floor', -1000, GROUND_Y, 19000, 2000) };
export const LEFT_WALL = { label: 'wall', x: -300, y: -720, w: 100, h: 720, solid: true, oneWay: false, ink: 'ink' };
// past the flashing room's far door (16900), leaving room for the title to assemble around the I
export const RIGHT_WALL = { label: 'wall', x: 17300, y: -720, w: 200, h: 720, solid: true, oneWay: false, ink: 'ink' };

// the flashing room's hop blocks (ruling 11: about 240 u high; the jump apex is 300 u)
export const HOP = { h: 240, w: 90, x1: 15560, x2: 16260 };

export const standOns = [
  // part 1 (0-12 s): the four hops, H-I-D-E
  standOn('H', 700, -120, 180, 120), // hop 1 (+120)
  standOn('I', 1000, -200, 120, 200), // hop 2 (+80), 120 u gap
  standOn('D', 1240, -280, 180, 280), // hop 3 (+80)
  standOn('E', 1540, -160, 180, 160), // hop 4 (-120), then drop to the floor at 1720
  // part 3: the blinking lamp's ledges; the 200 u gap between them needs a jump (ruling 12)
  { ...standOn('ledge', 8500, -160, 200, 160), id: 'BL-L' },
  { ...standOn('ledge', 8900, -160, 200, 160), id: 'BL-R' }, // the calm ledge after
  // part 4: the two ledges under the slow lamp, a 300 u gap over the ink | cream seam
  { ...standOn('ledge', 11600, -240, 300, 240), id: 'LA' }, // in front of BA (ink)
  { ...standOn('ledge', 12200, -240, 300, 240), id: 'LB' }, // in front of BB (cream)
  // the flashing room: one taped block on each hop (R1 -> R2, R2 -> I), so each hop is a jump (ruling 11)
  { ...standOn('block', HOP.x1, -HOP.h, HOP.w, HOP.h), id: 'HOP1' },
  { ...standOn('block', HOP.x2, -HOP.h, HOP.w, HOP.h), id: 'HOP2' },
];

// collision + guard line of sight (S1): the stand-ons and the walls
export const solids = [FLOOR, LEFT_WALL, RIGHT_WALL, ...standOns];

// part 4's backdrops meet at the seam in the middle of the LA-LB gap. Under ruling 10 they reach past the slow
// lamp's whole swing zone at hero height, so a matching coat is always possible inside it.
const SEAM_X = 12050, BA_X = 11400, BB_X1 = 12760;

export const backdrops = [
  // part 1: a plain cream poster panel -- a cream coat goes dashed here (first look at H6, nothing at stake)
  { id: 'B1', x: 1950, y: -480, w: 520, h: 480, ink: 'cream' },
  // part 2: ink / cream / ink, touching -- flip as you walk; the only feedback is H6
  { id: 'W1', x: 4700, y: -480, w: 400, h: 480, ink: 'ink' },
  { id: 'W2', x: 5100, y: -480, w: 400, h: 480, ink: 'cream' },
  { id: 'W3', x: 5500, y: -480, w: 400, h: 480, ink: 'ink' },
  // part 3: the night wall the spotlight is mounted on; the blinking lamp's wall; the guard's long wall
  { id: 'N1', x: 7100, y: -900, w: 1100, h: 900, ink: 'ink' },
  { id: 'N2', x: 8450, y: -900, w: 800, h: 900, ink: 'ink' },
  { id: 'W4', x: 9800, y: -480, w: 1000, h: 480, ink: 'ink' },
  // part 4: ink | cream, touching
  { id: 'BA', x: BA_X, y: -720, w: SEAM_X - BA_X, h: 720, ink: 'ink' },
  { id: 'BB', x: SEAM_X, y: -720, w: BB_X1 - SEAM_X, h: 720, ink: 'cream' },
];

export const decorations = [
  // an "&" at body height: walk through it and see it does nothing
  { id: 'DEC1', label: '&', x: 2620, y: -320, w: 260, h: 320 },
];

export const goBehinds = [
  // an "N": walking behind it turns the hero dashed with a paper sound, whatever the coat
  { id: 'G1', label: 'N', x: 3000, y: -360, w: 240, h: 360, ink: 'ink' },
  // part 4: a "P" the second guard walks behind
  { id: 'G2', label: 'P', x: 13560, y: -420, w: 340, h: 420, ink: 'cream' },
  // the flashing room (ruling 11): R1 -> R2 -> the I of INK, about 700 u apart
  { id: 'R1', label: 'R', x: 15150, y: -420, w: 200, h: 420, ink: 'ink' },
  { id: 'R2', label: 'R', x: 15850, y: -420, w: 200, h: 420, ink: 'ink' },
  // the last hide: hidden behind the I of INK ends the level (the title assembles around it)
  { id: 'END', label: 'I', x: 16550, y: -420, w: 140, h: 420, ink: 'ink', end: true },
];

// Lamps (spec-rework §1.4, CTO ruling 3: every bulb at y >= -700). parts: the angle schedule
// [[beats, fromDeg, toDeg], ...] on the float sim beat; a lamp that swings gets a dashed zone (ruling 10).
const SLOW = { half: 17, throw: 900, rest: 23 };
export const lamps = [
  // RL, the rehearsal lamp: fixed straight down, can't catch (on w = 1 the scissors snap on empty air and w holds)
  makeLamp({ id: 'RL', bulb: { x: 4100, y: -700 }, halfAngleDeg: 23, throw: 800, canSnip: false, tag: 'REHEARSAL' }),
  // SL, the sweeping spotlight: rest down 4 beats, swing up the wall over 2, rest up (off the route) 8, back over 2
  makeLamp({ id: 'SL', bulb: { x: 7400, y: -600 }, halfAngleDeg: 12, throw: 840, bracket: true, parts: [[4, 0, 0], [2, 0, 120], [8, 120, 120], [2, 120, 0]] }),
  // BL, the blinking lamp over the gap: off beats 0-6 (on beat 5 the filament glows: the tell), on beats 6-8
  makeLamp({ id: 'BL', bulb: { x: 8800, y: -700 }, halfAngleDeg: 15, throw: 760, parts: [[8, 0, 0]], litBeats: [6, 8], glowBeats: [5, 6] }),
  // SLOW, the pendulum over the seam: rest on LA 4, swing 4, rest on LB 4, swing back 4
  makeLamp({ id: 'SLOW', bulb: { x: SEAM_X, y: -700 }, halfAngleDeg: SLOW.half, throw: SLOW.throw,
    parts: [[4, -SLOW.rest, -SLOW.rest], [4, -SLOW.rest, SLOW.rest], [4, SLOW.rest, SLOW.rest], [4, SLOW.rest, -SLOW.rest]] }),
];

// walking guards (§4): patrol xMin <-> xMax, 8 beats a leg; at beat 0 at xMin walking right; 24-beat cycle
export const guards = [
  { id: 'GU1', xMin: 9940, xMax: 10660 },
  { id: 'GU2', xMin: 13500, xMax: 14220 },
];

// the flashing room (ruling 11): 12 beats, 6 dark (the 6th is the warning), 6 lit. Lit, only go-behinds hide.
export const rooms = [
  { id: 'FR', rect: { x: 14900, y: -2000, w: 2000, h: 2000 }, cycleBeats: 12, darkBeats: 6 },
];

export const checkpoints = [
  { id: 'cp1', part: 1, x: 150, spawnX: 150, spawnY: GROUND_Y, coat: 'ink' }, // level start
  { id: 'cp2', part: 2, x: 3450, spawnX: 3450, spawnY: GROUND_Y, coat: 'ink' },
  { id: 'cp3', part: 3, x: 6650, spawnX: 6650, spawnY: GROUND_Y, coat: 'ink' }, // before SL
  { id: 'cp3b', part: 3, x: 8300, spawnX: 8300, spawnY: GROUND_Y, coat: 'ink' }, // before BL
  { id: 'cp3c', part: 3, x: 9300, spawnX: 9300, spawnY: GROUND_Y, coat: 'ink' }, // before GU1
  { id: 'cp4', part: 4, x: 11300, spawnX: 11300, spawnY: GROUND_Y, coat: 'ink' }, // before SLOW
  { id: 'cp4b', part: 4, x: 12800, spawnX: 12800, spawnY: GROUND_Y, coat: 'ink' }, // before GU2
  { id: 'cp4c', part: 4, x: 14800, spawnX: 14800, spawnY: GROUND_Y, coat: 'ink' }, // before the flashing room
];

// THE-1637 in-world tags (FREEZE dropped: it contradicts H2). y = the tag's bottom edge.
export const tags = [
  { id: 'run', x: 300, y: -420 },
  { id: 'jump', x: 620, y: -420 },
  { id: 'flip', x: 3800, y: -560 },
];

export const PARTS = 4; // the HUD part tag
export const partAt = (x) => (x < 3450 ? 1 : x < 6650 ? 2 : x < 11300 ? 3 : 4);
