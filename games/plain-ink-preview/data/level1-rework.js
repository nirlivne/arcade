// Level 1 of the gameplay rework (spec-rework §3, board design §6), slice 1 (THE-1648): parts 1-2, x 150 -> 6650.
// Parts 3-4 (the timing hazards and the I of INK at x 14900) arrive in slice 2 (THE-1651). The released level
// (sets 1-6, riddles, finale) stays in data/level1.js for later levels.
//
// Units: world u, x right, y down, floor top at y = 0. Rects { x, y, w, h }, y = top edge.
// The four looks (spec-rework §2): standOns collide and carry tape + shadow; backdrops are flat full ink or
// cream; goBehinds are drawn in front of the hero and cover any coat; decorations do nothing.

export const GROUND_Y = 0;
export const GROUND = 'tangerine'; // the whole level: open ground matches no coat (H4)

const standOn = (label, x, y, w, h) => ({ label, x, y, w, h, solid: true, oneWay: false, ink: 'ink', tape: true, shadow: true });

// The floor is a stand-on too (ink band, tape on top). No pits in level 1.
export const FLOOR = { ...standOn('floor', -1000, GROUND_Y, 17000, 2000) };
export const LEFT_WALL = { label: 'wall', x: -300, y: -720, w: 100, h: 720, solid: true, oneWay: false, ink: 'ink' };
// slice-1 stand-in: closes the level after part 2's calm floor (slice 2 moves it to x 15600)
export const RIGHT_WALL = { label: 'wall', x: 6800, y: -720, w: 200, h: 720, solid: true, oneWay: false, ink: 'ink', standIn: true };

// Part 1 (0-12 s): the four hops, H-I-D-E
export const standOns = [
  standOn('H', 700, -120, 180, 120), // hop 1 (+120)
  standOn('I', 1000, -200, 120, 200), // hop 2 (+80), 120 u gap
  standOn('D', 1240, -280, 180, 280), // hop 3 (+80)
  standOn('E', 1540, -160, 180, 160), // hop 4 (-120), then drop to the floor at 1720
];

// collision + guard line of sight (S1): the stand-ons and the walls
export const solids = [FLOOR, LEFT_WALL, RIGHT_WALL, ...standOns];

export const backdrops = [
  // part 1: a plain cream poster panel -- a cream coat goes dashed here (first look at H6, nothing at stake)
  { id: 'B1', x: 1950, y: -480, w: 520, h: 480, ink: 'cream' },
  // part 2: ink / cream / ink, touching -- flip as you walk; the only feedback is H6
  { id: 'W1', x: 4700, y: -480, w: 400, h: 480, ink: 'ink' },
  { id: 'W2', x: 5100, y: -480, w: 400, h: 480, ink: 'cream' },
  { id: 'W3', x: 5500, y: -480, w: 400, h: 480, ink: 'ink' },
];

export const decorations = [
  // an "&" at body height: walk through it and see it does nothing
  { id: 'DEC1', label: '&', x: 2620, y: -320, w: 260, h: 320 },
];

export const goBehinds = [
  // an "N": walking behind it turns the hero dashed with a paper sound, whatever the coat
  { id: 'G1', label: 'N', x: 3000, y: -360, w: 240, h: 360, ink: 'ink' },
  // slice-1 stand-in for the last hide (the I of INK, slice 2 puts it at x 14900): hidden behind it ends the level
  { id: 'END', label: 'I', x: 6400, y: -420, w: 140, h: 420, ink: 'ink', end: true, standIn: true },
];

// Lamps (spec-rework §1.4, CTO ruling 3: every bulb at y >= -700). angleAt/litAt take the float sim beat.
export const lamps = [
  // RL, the rehearsal lamp: fixed straight down, can't catch (on w = 1 the scissors snap on empty air and w holds)
  { id: 'RL', bulb: { x: 4100, y: -700 }, halfAngleDeg: 23, throw: 800, angleAt: () => 0, litAt: () => true, canSnip: false, tag: 'REHEARSAL' },
];

export const checkpoints = [
  { id: 'cp1', part: 1, x: 150, spawnX: 150, spawnY: GROUND_Y, coat: 'ink' }, // level start
  { id: 'cp2', part: 2, x: 3450, spawnX: 3450, spawnY: GROUND_Y, coat: 'ink' },
];

// THE-1637 in-world tags (FREEZE dropped: it contradicts H2). y = the tag's bottom edge.
export const tags = [
  { id: 'run', x: 300, y: -420 },
  { id: 'jump', x: 620, y: -420 },
  { id: 'flip', x: 3800, y: -560 },
];

export const PARTS = 4; // the HUD part tag (slice 1 builds parts 1-2)
export const partAt = (x) => (x < 3450 ? 1 : x < 6650 ? 2 : x < 11300 ? 3 : 4);
