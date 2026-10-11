// Level generator (THE-449 S3-S4, rewritten for THE-523 S3 / spec v2 §B1/§D/§F). Pure: a seed and a shape always
// give the same tower. The solver (tools/cannonball-family-solve.mjs) decides which seeds ship.
import { mulberry32 } from "./rng.js";

// THE-527 feel check, spec v2 §C8/§A2: tin r 22, the v2 world (floor 680, cannon x 140). STONE_R/DRUM_R per spec §D.
const TIN_R = 22, STONE_R = 20, DRUM_R = 34, ROW_DROP = Math.sqrt(3) * TIN_R;
const FLOOR = 680, CANNON_X = 140;
const KNACK_NAMES = ["light", "heavy", "bounce"];

export function chapterOf(level) {
  return level <= 10 ? 1 : level <= 20 ? 2 : 3;
}

// Distance D = cannon x to the nearest target piece (spec v2 §B1). Deterministic per level, not per seed: the
// band grows with the level, and from level 6 it never drops below 1,250 (amendment r4, the S1 feel check: the
// fort is visible from the aim frame up to D ~ 1,200, so the off-screen flag and the peek only matter past that).
export function distanceFor(level) {
  if (level <= 1) return 900;
  if (level <= 10) {
    const span = (level - 1) / 9; // 0 at level 1, 1 at level 10
    const base = Math.round(900 + span * 600); // 900 -> 1500
    return level >= 6 ? Math.max(1250, base) : base;
  }
  if (level <= 20) {
    const span = (level - 11) / 9;
    return Math.round(1400 + span * 600); // 1400 -> 2000
  }
  const span = (level - 21) / 9;
  return Math.round(1800 + span * 500); // 1800 -> 2300
}

// F4: piece counts by chapter (tins, drums, crates). Used both for generated levels and the daily.
export function pieceCounts(chapter, rng) {
  const pick = ([lo, hi]) => lo + Math.floor(rng() * (hi - lo + 1));
  if (chapter === 1) return { tins: pick([4, 8]), drums: pick([0, 1]), crates: pick([0, 2]) };
  if (chapter === 2) return { tins: pick([7, 10]), drums: pick([1, 2]), crates: pick([1, 3]) };
  return { tins: pick([9, 12]), drums: pick([2, 3]), crates: pick([2, 4]) };
}

// D3: family members per level. N = par + 1 for 1-10, par + 2 from 11, capped at 6.
export function familySizeFor(level, par) {
  return Math.min(6, par + (level <= 10 ? 1 : 2));
}

// D2: the par band per chapter (the solver picks the actual par within this from its sweep).
export function parBand(level) {
  if (level <= 3) return [1, 1];
  if (level <= 10) return [1, 2];
  if (level <= 20) return [2, 3];
  return [3, 4];
}

function overlaps(a, b, ra, rb) {
  return Math.hypot(a.x - b.x, a.y - b.y) < ra + rb - 0.5;
}
function hitsBox(p, r, L) {
  const cx = Math.min(Math.max(p.x, L.x0), L.x1), cy = Math.min(Math.max(p.y, L.top), L.top + L.h);
  return Math.hypot(p.x - cx, p.y - cy) < r - 0.5;
}
function boxesOverlap(a, b) {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.top < b.top + b.h && a.top + a.h > b.top;
}

// A pyramid of tins on a shelf (ledge is { x0, x1, top }), touching, base as wide as the shelf allows. Each row
// above the base nests into the row below's left pocket (offset +TIN_R from that row's own left edge), not
// independently re-centered on the shelf - a ragged row (fewer tins than a full "one less than the row below"
// count, which happens whenever n isn't a full triangular number) that re-centers on the shelf can land right on
// top of a tin below it instead of in a gap, overlapping it.
function pyramid(ledge, n) {
  const maxBase = Math.floor((ledge.x1 - ledge.x0 - 2 * TIN_R) / (2 * TIN_R)) + 1;
  if (maxBase < 1) return null;
  const base = Math.min(n, maxBase);
  const cx = (ledge.x0 + ledge.x1) / 2;
  const out = [];
  let remaining = n, len = base, row = 0, rowLeft = cx - (base - 1) * TIN_R;
  while (remaining > 0 && len > 0) {
    const take = Math.min(len, remaining);
    for (let i = 0; i < take; i++) out.push({ x: rowLeft + i * 2 * TIN_R, y: ledge.top - TIN_R - row * ROW_DROP });
    remaining -= take;
    rowLeft += TIN_R; // next row nests one pocket in from this row's left edge
    len = take - 1;
    row += 1;
  }
  return remaining === 0 ? out : null;
}

// Validates a full piece set against itself: no tin/drum overlaps another, or a ledge it isn't resting on; no
// stone on a ledge or on a tin/drum. Returns true if clean.
function validate(ledges, tins, drums, stones) {
  const circles = [...tins.map((t) => ({ ...t, r: TIN_R })), ...drums.map((d) => ({ ...d, r: DRUM_R }))];
  for (let i = 0; i < circles.length; i++) {
    for (let j = i + 1; j < circles.length; j++) if (overlaps(circles[i], circles[j], circles[i].r, circles[j].r)) return false;
    for (let li = 0; li < ledges.length; li++) {
      if (circles[i].ledge === li) continue; // circle.ledge is the ledge's own index, not the ledge object
      if (hitsBox(circles[i], circles[i].r, ledges[li])) return false;
    }
  }
  for (const s of stones) {
    if (circles.some((c) => overlaps(s, c, STONE_R, c.r))) return false;
    if (ledges.some((L) => hitsBox(s, STONE_R, L))) return false;
  }
  for (let i = 0; i < ledges.length; i++) for (let j = i + 1; j < ledges.length; j++) if (boxesOverlap(ledges[i], ledges[j])) return false;
  return true;
}

// Places tins (and optionally a drum) on a set of shelves, sharing the tin count as evenly as possible across
// them; one shelf (shelfForDrum, default the last) gets the drum instead of one tin's worth of space, if asked.
function placeOnShelves(shelves, tinTotal, wantDrum, rng) {
  const per = shelves.map((_, i) => Math.floor(tinTotal / shelves.length) + (i < tinTotal % shelves.length ? 1 : 0));
  const tins = [], drums = [];
  // The drum's span is reserved on its host shelf *before* the pyramid is built there, not fitted into
  // whatever's left over afterwards - pyramid() always spreads its base across the full width it's given
  // (more tins just make a wider base), so a leftover-space search after the fact routinely finds nothing.
  const drumHost = wantDrum ? Math.floor(rng() * shelves.length) : -1;
  const drumOnLeft = rng() < 0.5;
  const pad = 2 * DRUM_R + 20;
  for (let i = 0; i < shelves.length; i++) {
    const n = per[i];
    if (n === 0) continue;
    const shelf = i === drumHost
      ? (drumOnLeft ? { ...shelves[i], x0: shelves[i].x0 + pad } : { ...shelves[i], x1: shelves[i].x1 - pad })
      : shelves[i];
    const p = pyramid(shelf, n);
    if (!p) return null;
    for (const t of p) tins.push({ x: t.x, y: t.y, ledge: i });
  }
  if (wantDrum) {
    const host = shelves[drumHost];
    const dx = drumOnLeft ? host.x0 + DRUM_R : host.x1 - DRUM_R;
    drums.push({ x: dx, y: host.top - DRUM_R, ledge: drumHost });
  }
  return { tins, drums };
}

// ---------------------------------------------------------------- the 8 archetypes (spec v2 §F1)
// Each builder: (rng, D, counts) -> a partial def { ledges, tins, drums, stones } or null if this seed can't
// place it. D = the distance from the cannon to the nearest target piece; counts = { tins, drums, crates }
// from pieceCounts(). Crates are plain ledges with crate: true (and hp 1 or 2); stone walls are plain ledges
// with neither touch nor crate (an obstacle, never a target).

const drumPad = (counts) => (counts.drums > 0 ? 2 * DRUM_R + 20 : 0); // extra shelf width so a wanted drum has its own clear span beside the tin pyramid, never stacked into it

// A pyramid needs its base row to grow with n or it runs out of rows before it runs out of tins (maxBase too
// small for n => pyramid() returns null). A triangular pyramid of base b holds up to b+(b-1)+...+1 tins, so the
// base needed for n is roughly sqrt(2n); give it a bit of headroom so single-shelf archetypes can still fit
// chapter 3's 9-12 tins (spec F4) on one shelf.
const shelfSpanFor = (tinCount) => Math.ceil(Math.sqrt(2 * Math.max(1, tinCount))) * 2 * TIN_R + 2 * TIN_R;

// placeOnShelves() indexes tins/drums by position *within the array it was given*, starting at 0 - when that
// array is a single-element slice like [ledges[1]] (not the full ledges array), the result needs remapping to
// the shelf's real index in the full array, or sim.js reads the wrong ledge for every down/break check.
function remapLedge(placed, realIndex) {
  for (const t of placed.tins) t.ledge = realIndex;
  for (const d of placed.drums) d.ledge = realIndex;
  return placed;
}

// 1. Pyramid: two piles of tins, each on its own low crate, split with a wide gap (loosened per THE-595 D1-B:
// one pyramid of touching tins on a single crate let one hit domino the entire pile - adjacent circles toppling
// each other - clearing it in one shot at chapter 2/3 distances; the gap is the same fix buildBridge and
// buildTwinTowers already use. The first crate carries the iron-band hp bump and the drum, same as the single
// crate did before; crate2 (and any further decorative crates) count toward counts.crates so F4's band still
// holds (2 main crates is never fewer than counts.crates' own floor of 1 for chapter 2, 2 for chapter 3).
function buildPyramid(rng, D, counts) {
  const near = CANNON_X + D;
  const half = Math.ceil(counts.tins / 2), otherHalf = counts.tins - half;
  const w1 = Math.max(100, shelfSpanFor(half)) + Math.floor(rng() * 40) + drumPad(counts);
  const w2 = Math.max(100, shelfSpanFor(otherHalf)) + Math.floor(rng() * 40);
  const gap = 500 + Math.floor(rng() * 250);
  const crateTop = FLOOR - 90;
  const crate1 = { x0: near, x1: near + w1, top: crateTop, h: 18, crate: true, hp: counts.crates >= 2 ? 2 : 1 };
  const crate2 = { x0: near + w1 + gap, x1: near + w1 + gap + w2, top: crateTop, h: 18, crate: true, hp: 1 };
  const placed1 = placeOnShelves([crate1], half, counts.drums > 0, rng);
  if (!placed1) return null;
  const p2 = otherHalf > 0 ? pyramid(crate2, otherHalf) : [];
  if (!p2) return null;
  const ledges = [crate1, crate2];
  for (let i = 2; i < counts.crates; i++) {
    const cx1 = crate2.x1 + 40 + Math.floor(rng() * 60);
    ledges.push({ x0: cx1, x1: cx1 + 100, top: FLOOR - 40, h: 18, crate: true, hp: 1 });
  }
  const tins = [...placed1.tins, ...p2.map((t) => ({ x: t.x, y: t.y, ledge: 1 }))];
  if (!validate(ledges, tins, placed1.drums, [])) return null;
  return { ledges, tins, drums: placed1.drums, stones: [] };
}

// D1-B (THE-595): a plain ledge (touch: counts.touch || undefined, false from chapter 2) never gives way, so a
// shot can only ever down the one tin it directly strikes - confirmed across every plain-ledge archetype
// (tallTower, twinTowers, fort, hilltop, bunker all capped at 0-1 downs per shot at chapter 2/3 distances),
// never enough to clear 7-12 tins within the rail's own N shots. A crate shelf breaking on a hard hit
// (markDown's L.off check) drops every tin resting on it at once, the same give-way chapter 1 already gets for
// free from touch. Used in place of touch: counts.touch || undefined on every tin-holding shelf below, chapter
// 1's touch: true is unaffected and keeps working as it already did.
const tinShelf = (counts) => (counts.touch ? { touch: true } : { crate: true, hp: counts.crates >= 2 ? 2 : 1 });

// 2. Tall tower: 3-4 narrow stacked shelves.
function buildTallTower(rng, D, counts) {
  const near = CANNON_X + D;
  // Capped at 3 for chapter 2/3 (never touch): each level becomes its own crate below, and a 4th would push
  // the level's total crate count past F4's chapter-2 band (max 3) on its own, with nothing else to trade off.
  const levels = counts.touch ? 3 + (rng() < 0.5 ? 0 : 1) : 3;
  // D1-B (THE-595 round 3): level 28 - tallTower's farthest chapter-3 slot (D ~2,190) - never cleared: a
  // reachability probe (same technique as trapeze's) found this D's own ceiling is ~90, so the unchanged
  // 90-unit stride put the 2nd (170) and 3rd (260) shelf both out of any single shot's reach - no amount of
  // extra shots helps, since (unlike trapeze's two crates) these shelves don't rest on or affect each other.
  // Level 13's own D (~1,533) stays fine at the original base/stride (confirmed: already solved, untouched by
  // this - 1,700 is a threshold between the two, not tuned to either). Past it, both taper down so all of a
  // 2-shelf tower's heights sit well under the measured ceiling.
  const far = !counts.touch && D > 1700;
  const towerLevels = far ? 2 : levels;
  // stride must clear a tin's own diameter (2*TIN_R = 44) plus the shelf's h (16) or the lower shelf's tin
  // physically overlaps the shelf above it (validate() rightly rejects every seed at a smaller stride, found
  // empirically: the first version of this taper used 35 and never produced a single valid def) - 68 clears
  // that with margin while keeping the far shelf's own height (base + stride = 78) under the ~90 ceiling.
  const base = far ? 10 : 80, stride = far ? 68 : 90;
  const w = Math.max(110, shelfSpanFor(Math.ceil(counts.tins / towerLevels))) + Math.floor(rng() * 30) + drumPad(counts);
  const ledges = [];
  for (let i = 0; i < towerLevels; i++) ledges.push({ x0: near, x1: near + w, top: FLOOR - base - i * stride, h: 16, ...tinShelf(counts) });
  const placed = placeOnShelves(ledges, counts.tins, counts.drums > 0, rng);
  if (!placed) return null;
  if (!validate(ledges, placed.tins, placed.drums, [])) return null;
  return { ledges, tins: placed.tins, drums: placed.drums, stones: [] };
}

// 3. Twin towers: two forts 300-500 apart.
function buildTwinTowers(rng, D, counts) {
  const near = CANNON_X + D;
  // D1-B (THE-595 round 3): level 30 - twinTowers' farthest chapter-3 slot and the single farthest level in
  // the whole table (D ~2,300) - never cleared either, same shape as bunker's miss: the *second* tower at
  // near + gap (300-500) pushed its own distance well past the edge of what any shot reaches at all (a direct
  // probe found D ~2,300 alone is right at the practical range ceiling - even gap's own low end made the
  // second tower's reachability razor-thin). D stays this far because it's the level's own distance, not
  // something to retune per archetype, so the gap narrows instead, keeping the second tower close enough to
  // land solidly inside the solver's own search grid rather than right at its edge.
  const far = D > 2000;
  const w = Math.max(110, shelfSpanFor(Math.ceil(counts.tins / 2))) + Math.floor(rng() * 30);
  // far's own gap (80-150) is smaller than w (up to ~240 for chapter 3's tin counts) - measuring it from
  // near (shelf 1's start) the way the close-range gap always safely could (gap 300-500 > w) put the two
  // shelves overlapping by however much gap fell short of w (confirmed: validate() rejected every seed).
  // Measuring from w2x1 - shelf 1's own end - instead avoids that by construction, regardless of width.
  // Narrowing the gap alone still exhausted a 150-seed budget at level 30 (D ~2,300, the single farthest
  // level in the table, right at the practical range ceiling): the second tower's own distance (near + w +
  // gap) was still landing in a too-thin reachable window even at gap's own low end. Lowering the far
  // height too (70 -> 40) buys more of that margin back, the same lever bunker's far case already uses.
  const gap = far ? 40 + Math.floor(rng() * 50) : 300 + Math.floor(rng() * 200);
  const h = far ? 40 : 70;
  const tower1x1 = near + w;
  const tower2x0 = far ? tower1x1 + gap : near + gap;
  const ledges = [
    { x0: near, x1: tower1x1, top: FLOOR - h, h: 16, ...tinShelf(counts) },
    { x0: tower2x0, x1: tower2x0 + w, top: FLOOR - h, h: 16, ...(counts.touch ? { touch: true } : { crate: true, hp: 1 }) },
  ];
  const half = Math.ceil(counts.tins / 2);
  const p1 = pyramid(ledges[0], half), p2 = pyramid(ledges[1], counts.tins - half);
  if (!p1 || !p2) return null;
  const tins = [...p1.map((t) => ({ ...t, ledge: 0 })), ...p2.map((t) => ({ ...t, ledge: 1 }))];
  const drums = counts.drums > 0 ? [{ x: ledges[1].x1 + 20, y: FLOOR - h - 10 - DRUM_R }] : [];
  if (drums.length) ledges.push({ x0: ledges[1].x1, x1: ledges[1].x1 + 60, top: FLOOR - h - 10, h: 16 }), drums[0].ledge = 2;
  if (!validate(ledges, tins, drums, [])) return null;
  return { ledges, tins, drums, stones: [] };
}

// 4. Fort: crate walls on both sides, so it needs a lob.
function buildFort(rng, D, counts) {
  const near = CANNON_X + D;
  const innerW = Math.max(140, shelfSpanFor(counts.tins)) + Math.floor(rng() * 60) + drumPad(counts);
  // D1-B (THE-595, CTO amendment round 5): after the 3-way archetype rotation, fort is the only archetype at
  // level 30's own distance (D ~2,300). The shelf itself (FLOOR-70) already matches the height every other
  // far archetype's low shelf uses, already confirmed reachable here - it's the flanking walls (90-150) that
  // don't clear at this range (confirmed via a direct probe: only <=10 does). Tapered the same way bunker's
  // wall was.
  const wallH = D > 2000 ? 5 + Math.floor(rng() * 10) : 90 + Math.floor(rng() * 60);
  const wallW = 30;
  const ledges = [
    { x0: near, x1: near + wallW, top: FLOOR - wallH, h: wallH, crate: true, hp: 1 },
    { x0: near + wallW, x1: near + wallW + innerW, top: FLOOR - 70, h: 16, ...tinShelf(counts) },
    { x0: near + wallW + innerW, x1: near + wallW + innerW + wallW, top: FLOOR - wallH, h: wallH, crate: true, hp: 1 },
  ];
  const placedRaw = placeOnShelves([ledges[1]], counts.tins, counts.drums > 0, rng);
  const placed = placedRaw && remapLedge(placedRaw, 1);
  if (!placed) return null;
  if (!validate(ledges, placed.tins, placed.drums, [])) return null;
  return { ledges, tins: placed.tins, drums: placed.drums, stones: [] };
}

// 5. Hilltop: the fort sits on a hill box 150-260 high.
function buildHilltop(rng, D, counts) {
  const near = CANNON_X + D;
  // D1-B (THE-595, CTO amendment): level 30's own distance (D ~2,300, after the twinTowers<->hilltop swap)
  // needs the same distance-aware height taper as the other far archetypes - a reachability probe found the
  // original hillH+70 shelf height (320-400 at this hillH band) is nowhere close to the ~90 ceiling measured
  // everywhere else at this range; only a stride down to ~50 (instead of 70) on top of a much lower hill (10-
  // 20, instead of 150-260) lands inside it. Level 17's own D (~1,867, well under this round's D > 2,000
  // threshold) keeps the original hill height and shelf stride, unaffected.
  const far = D > 2000;
  const hillH = far ? 10 + Math.floor(rng() * 10) : 150 + Math.floor(rng() * 110);
  const shelfStride = far ? 50 : 70;
  const hillW = 220 + Math.floor(rng() * 80);
  const shelfW = Math.max(140, shelfSpanFor(counts.tins)) + Math.floor(rng() * 40) + drumPad(counts);
  const shelfX0 = Math.max(near, near + (hillW - shelfW) / 2); // never let a wide shelf creep closer than D
  const ledges = [
    { x0: near, x1: near + hillW, top: FLOOR - hillH, h: hillH }, // the hill itself, a static box (never a target)
    { x0: shelfX0, x1: shelfX0 + shelfW, top: FLOOR - hillH - shelfStride, h: 16, ...tinShelf(counts) },
  ];
  const placedRaw = placeOnShelves([ledges[1]], counts.tins, counts.drums > 0, rng);
  const placed = placedRaw && remapLedge(placedRaw, 1);
  if (!placed) return null;
  // The tin shelf is already 1 crate (ch2/3) or 0 (ch1's touch shelf); top up to counts.crates with small
  // decorative obstacles so the level's own crate total still lands in F4's band either way.
  for (let i = counts.touch ? 0 : 1; i < counts.crates; i++) {
    const cx = near + hillW + 30 + i * 90;
    ledges.push({ x0: cx, x1: cx + 70, top: FLOOR - 24, h: 20, crate: true, hp: 1 });
  }
  if (!validate(ledges, placed.tins, placed.drums, [])) return null;
  return { ledges, tins: placed.tins, drums: placed.drums, stones: [] };
}

// 6. Bunker: a stone wall 200-350 high, 150-300 in front of the fort (an obstacle ledge, not a touch/crate
// shelf). Chapter 2-3 (loosened per THE-595 D1-C): once a lob clears the one wall, the single shelf behind it
// was wide open - landing anywhere on it broke the crate and dropped every tin, an easy one-shot at closer
// chapter-2 distances (measured over half of seeds at level 15). Splitting that shelf into two, the same gap
// fix as buildPyramid/buildBridge/buildTrapeze, means clearing the wall only ever reaches one half.
function buildBunker(rng, D, counts) {
  const near = CANNON_X + D;
  // D1-B (THE-595 round 3): level 29 - bunker's farthest chapter-3 slot (D ~2,244) - never cleared. Two
  // compounding causes, found by reachability probes: (1) the fixed 200-350 wall itself doesn't clear at this
  // range (only <=10 cleared at the original 150-300 gap, or <=20 once it widened to 300-450); (2) even after
  // that, the two-crate split's *second* crate sits at near + wallGap + w1 + gap - at level 29's real seeds that
  // lands past D ~3,400, far beyond anything a shot can reach at all (a bare, unobstructed low target already
  // stops being reachable past D ~2,300). No gap width fixes a target that far out, so far bunker drops the
  // split and uses one shelf with an iron band (hp 2) instead - that still guarantees >= 2 real hits (the same
  // "no one-shot" guarantee the split gave) without needing a second target at an unreachable distance. Chapter
  // 1's wall (touch, always close range) is unaffected - `far` requires !counts.touch, so it's never true there.
  const far = !counts.touch && D > 2000;
  const wallH = far ? 10 + Math.floor(rng() * 20) : 200 + Math.floor(rng() * 150);
  const wallGap = far ? 300 + Math.floor(rng() * 150) : 150 + Math.floor(rng() * 150);
  const fortNear = near + wallGap;
  if (far) {
    const w = Math.max(150, shelfSpanFor(counts.tins)) + Math.floor(rng() * 40) + drumPad(counts);
    const ledges = [
      { x0: near, x1: near + 26, top: FLOOR - wallH, h: wallH },
      { x0: fortNear, x1: fortNear + w, top: FLOOR - 70, h: 16, crate: true, hp: 2 },
    ];
    const placedRaw = placeOnShelves([ledges[1]], counts.tins, counts.drums > 0, rng);
    const placed = placedRaw && remapLedge(placedRaw, 1);
    if (!placed) return null;
    // The one shelf already carries an iron band; every one of counts.crates becomes its own small decorative
    // obstacle instead (same pattern buildHilltop uses), so the level's crate total still lands in F4's band.
    for (let i = 1; i < counts.crates; i++) {
      const cx = fortNear + w + 30 + (i - 1) * 90;
      ledges.push({ x0: cx, x1: cx + 70, top: FLOOR - 24, h: 20, crate: true, hp: 1 });
    }
    if (!validate(ledges, placed.tins, placed.drums, [])) return null;
    return { ledges, tins: placed.tins, drums: placed.drums, stones: [] };
  }
  if (!counts.touch) {
    const half = Math.ceil(counts.tins / 2), otherHalf = counts.tins - half;
    const w1 = Math.max(100, shelfSpanFor(half)) + Math.floor(rng() * 30) + drumPad(counts);
    const w2 = Math.max(100, shelfSpanFor(otherHalf)) + Math.floor(rng() * 30);
    const gap = 500 + Math.floor(rng() * 250);
    const ledges = [
      { x0: near, x1: near + 26, top: FLOOR - wallH, h: wallH }, // the stone wall: a plain obstacle
      { x0: fortNear, x1: fortNear + w1, top: FLOOR - 70, h: 16, crate: true, hp: counts.crates >= 2 ? 2 : 1 },
      { x0: fortNear + w1 + gap, x1: fortNear + w1 + gap + w2, top: FLOOR - 70, h: 16, crate: true, hp: 1 },
    ];
    const placed1 = placeOnShelves([ledges[1]], half, counts.drums > 0, rng);
    if (!placed1) return null;
    const p2 = otherHalf > 0 ? pyramid(ledges[2], otherHalf) : [];
    if (!p2) return null;
    const tins = [...placed1.tins.map((t) => ({ ...t, ledge: 1 })), ...p2.map((t) => ({ x: t.x, y: t.y, ledge: 2 }))];
    if (!validate(ledges, tins, placed1.drums, [])) return null;
    return { ledges, tins, drums: placed1.drums, stones: [] };
  }
  const shelfW = Math.max(140, shelfSpanFor(counts.tins)) + Math.floor(rng() * 40) + drumPad(counts);
  const ledges = [
    { x0: near, x1: near + 26, top: FLOOR - wallH, h: wallH }, // the stone wall: a plain obstacle
    { x0: fortNear, x1: fortNear + shelfW, top: FLOOR - 70, h: 16, touch: true },
  ];
  const placedRaw = placeOnShelves([ledges[1]], counts.tins, counts.drums > 0, rng);
  const placed = placedRaw && remapLedge(placedRaw, 1);
  if (!placed) return null;
  if (counts.crates > 0) ledges.push({ x0: fortNear + shelfW + 30, x1: fortNear + shelfW + 110, top: FLOOR - 24, h: 20, crate: true, hp: 1 });
  if (!validate(ledges, placed.tins, placed.drums, [])) return null;
  return { ledges, tins: placed.tins, drums: placed.drums, stones: [] };
}

// 7. Bridge: two planks at the same height, tins split across both, the drum guaranteed on the first (spec F1
// "plank + drum between pillars"). One pyramid on a single continuous plank (loosened once already per THE-595
// D1-B, still didn't hold at a 260-420 gap) let a low, fast, long lob stay within tin-catching height across
// the *entire* span in one smooth descent, sweeping every tin and the drum in one shot at chapter 2/3
// distances - not a rolling-surface effect (a real air gap between the two planks didn't stop it on its own),
// just how far a shallow trajectory's own catch band stays wide at these ranges. A gap wide enough that the same
// shallow arc has measurably dropped below catching height by the second plank is what actually buys the "no
// one-shot" rule back; 500-750 (vs. buildTwinTowers' 300-500, whose shelves sit much lower at FLOOR-70) is what
// held up empirically against the one-shot sweep across many seeds.
function buildBridge(rng, D, counts) {
  const near = CANNON_X + D;
  const plankTop = FLOOR - (120 + Math.floor(rng() * 60));
  // Chapter 1 (touch, spec F1 "plank + drum between pillars"): never had the "no one-shot" rule D1-C added
  // from level 11, so it keeps the original single continuous plank - found broken via the full levels.test.mjs
  // run (level 7, bridge's only chapter-1 slot, stopped clearing in its stored 1 shot): the two-plank split
  // below never checked counts.touch, so it was quietly running for chapter 1 too, splitting level 7's tins
  // across a gap one shot can't reach both sides of.
  if (counts.touch) {
    const w = Math.max(160, shelfSpanFor(counts.tins)) + Math.floor(rng() * 60) + 2 * DRUM_R + 20;
    const ledges = [{ x0: near, x1: near + w, top: plankTop, h: 14, plank: true }];
    const placed = placeOnShelves(ledges, counts.tins, counts.drums > 0, rng);
    if (!placed) return null;
    if (counts.crates > 0) ledges.push({ x0: near - 70, x1: near - 10, top: FLOOR - 24, h: 20, crate: true, hp: 1 });
    if (!validate(ledges, placed.tins, placed.drums, [])) return null;
    return { ledges, tins: placed.tins, drums: placed.drums, stones: [] };
  }
  const half = Math.ceil(counts.tins / 2), otherHalf = counts.tins - half;
  const w1 = Math.max(100, shelfSpanFor(half)) + Math.floor(rng() * 30) + 2 * DRUM_R + 20; // the drum is guaranteed here (spec F1)
  const w2 = Math.max(100, shelfSpanFor(otherHalf)) + Math.floor(rng() * 30);
  const gap = 500 + Math.floor(rng() * 250);
  const ledges = [
    { x0: near, x1: near + w1, top: plankTop, h: 14, plank: true },
    { x0: near + w1 + gap, x1: near + w1 + gap + w2, top: plankTop, h: 14, plank: true },
  ];
  const placed1 = placeOnShelves([ledges[0]], half, true, rng);
  if (!placed1) return null;
  const p2 = otherHalf > 0 ? pyramid(ledges[1], otherHalf) : [];
  if (!p2) return null;
  const tins = [...placed1.tins, ...p2.map((t) => ({ x: t.x, y: t.y, ledge: 1 }))];
  const drums = placed1.drums;
  // Both planks already give way on their own (PLANK_IMPULSE), so none of counts.crates is spent on them yet;
  // every one of it becomes its own small decorative obstacle, so the level's crate total lands in F4's band.
  for (let i = 0; i < counts.crates; i++) ledges.push({ x0: near - 70 - i * 80, x1: near - 10 - i * 80, top: FLOOR - 24, h: 20, crate: true, hp: 1 });
  if (!validate(ledges, tins, drums, [])) return null;
  return { ledges, tins, drums, stones: [] };
}

// 8. Trapeze: tins on a narrow ledge above the floor (380-480, chapter 1 only - touch: true already gives way
// on any touch, so the height never affected clearing there). Chapter 2-3 (loosened per THE-595 D1-B, three
// rounds): a plain ledge at this height never gives way, so a shot can only ever down the one tin it directly
// strikes - the ball's own flight necessarily arrives steeply this high (there's no flat, skimming approach
// that reaches 380-480 the way a lower shot gets), so it never sweeps sideways through a row either. That
// capped every shot at 1 tin, never enough to clear 7-12 tins within the rail's own N shots. Round 1 made the
// ledge a crate instead (markDown's L.off check drops every resting tin at once on a hard hit, the same
// give-way chapter 1 gets for free from touch) - which fixed the clear, but a single crate over the full tin
// pyramid reopened the one-shot problem (same failure pyramid's own single crate had, D1-C). Round 2 split
// into two crates with a wide gap (the fix that already held for buildBridge and buildPyramid) - but at 380-480
// and chapter 2/3's farthest distances (levels 20 and 27, D ~2,000-2,130), nothing the solver tried landed a
// hit on the second crate within par at all, gap width aside: round 3 lowers chapter 2/3's own height to
// 220-300 - still clearly elevated above the FLOOR-70-ish shelves every other archetype uses, but inside the
// arc the solver reliably clears at that range.
function buildTrapeze(rng, D, counts) {
  const near = CANNON_X + D;
  if (counts.touch) {
    const h = 380 + Math.floor(rng() * 100);
    const w = Math.max(110, shelfSpanFor(counts.tins)) + Math.floor(rng() * 30) + drumPad(counts);
    const ledges = [{ x0: near, x1: near + w, top: FLOOR - h, h: 14, touch: true }];
    const placed = placeOnShelves(ledges, counts.tins, counts.drums > 0, rng);
    if (!placed) return null;
    if (counts.crates > 0) ledges.push({ x0: near, x1: near + w, top: FLOOR - 24, h: 20, crate: true, hp: 1 });
    if (!validate(ledges, placed.tins, placed.drums, [])) return null;
    return { ledges, tins: placed.tins, drums: placed.drums, stones: [] };
  }
  // D1-B (THE-595 round 3): levels 20 and 27 - trapeze's farthest chapter-2 and chapter-3 slots (D ~2,000 and
  // ~2,130) - found no clear at all within maxPar at 380-480, gap width aside, and a flat lower band (220-300)
  // still didn't reach far enough down: a standalone reachability probe at these exact D values found the
  // real ceiling is steep and distance-dependent (D 2,000 needs <=~170; D 2,133 needs <=~90), while level 12's
  // own D (~1,467) stays fine at the full 380-480 band. So height now tapers with D past that point instead of
  // a second flat band: unchanged up to 1,467 (every trapeze level at or inside that distance keeps the same
  // look it always had), then down at ~0.5/unit, comfortably under the measured ceiling with margin at both
  // levels 20 and 27 for the harder two-crate-plus-pyramid clear (not just one probe shot reaching one tin).
  const hBase = D <= 1467 ? 380 : Math.max(70, 400 - (D - 1467) * 0.5);
  const h = hBase + Math.floor(rng() * 60);
  const half = Math.ceil(counts.tins / 2), otherHalf = counts.tins - half;
  const w1 = Math.max(90, shelfSpanFor(half)) + Math.floor(rng() * 30) + drumPad(counts);
  const w2 = Math.max(90, shelfSpanFor(otherHalf)) + Math.floor(rng() * 30);
  const gap = 500 + Math.floor(rng() * 250);
  const ledges = [
    { x0: near, x1: near + w1, top: FLOOR - h, h: 14, crate: true, hp: counts.crates >= 2 ? 2 : 1 },
    { x0: near + w1 + gap, x1: near + w1 + gap + w2, top: FLOOR - h, h: 14, crate: true, hp: 1 },
  ];
  const placed1 = placeOnShelves([ledges[0]], half, counts.drums > 0, rng);
  if (!placed1) return null;
  const p2 = otherHalf > 0 ? pyramid(ledges[1], otherHalf) : [];
  if (!p2) return null;
  const tins = [...placed1.tins, ...p2.map((t) => ({ x: t.x, y: t.y, ledge: 1 }))];
  if (counts.crates > 2) ledges.push({ x0: near, x1: near + w1, top: FLOOR - 24, h: 20, crate: true, hp: 1 });
  if (!validate(ledges, tins, placed1.drums, [])) return null;
  return { ledges, tins, drums: placed1.drums, stones: [] };
}

const ARCHETYPES = {
  pyramid: buildPyramid, tallTower: buildTallTower, twinTowers: buildTwinTowers, fort: buildFort,
  hilltop: buildHilltop, bunker: buildBunker, bridge: buildBridge, trapeze: buildTrapeze,
};
export const ARCHETYPE_NAMES = ["pyramid", "tallTower", "twinTowers", "fort", "hilltop", "bunker", "bridge", "trapeze"];

// Stones stand on the floor along the approach (never on a shelf, tin or drum), independent of archetype.
function placeStones(rng, ledges, tins, drums, count, xRange) {
  const stones = [];
  for (let tries = 0; stones.length < count && tries < 200; tries++) {
    const s = { x: xRange[0] + rng() * (xRange[1] - xRange[0]), y: FLOOR - STONE_R };
    if (stones.some((q) => overlaps(s, q, STONE_R, STONE_R))) continue;
    if (tins.some((t) => overlaps(s, t, STONE_R, TIN_R))) continue;
    if (drums.some((d) => overlaps(s, d, STONE_R, DRUM_R))) continue;
    if (ledges.some((L) => hitsBox(s, STONE_R, L))) continue;
    stones.push(s);
  }
  return stones.length === count ? stones : null;
}

// Knacks per slot (unchanged roles from v1; spec v2 §B4 retunes the numbers in knacks.js/sim.js, not the slots
// themselves). Chapter 1 follows the level table; chapter 2+/daily get 1-2 random slots.
function knacksFor(kind, N, rng) {
  const slots = new Array(N).fill(null);
  const free = () => {
    const open = slots.map((_, i) => i).filter((i) => slots[i] === null);
    return open.length ? open[Math.floor(rng() * open.length)] : -1;
  };
  if (kind.level !== undefined && kind.ch === 1) {
    const L = kind.level;
    if (L >= 4) slots[free()] = "light";
    if (L >= 5) slots[free()] = "heavy";
    if (L >= 7) slots[free()] = "bounce";
  } else {
    const count = 1 + Math.floor(rng() * 2);
    for (let i = 0; i < count; i++) slots[free()] = KNACK_NAMES[Math.floor(rng() * KNACK_NAMES.length)];
  }
  return slots.map((s) => (s === -1 ? null : s));
}

// Builds one archetype's tower directly (exported for tests/tools; generateLevel/generateDaily are the normal
// entry points). counts: { tins, drums, crates, stones?, planks? } (planks ignored - the bridge archetype is
// the only one with a plank, and it supplies its own). N: rail slots. Returns null if this seed can't place it.
export function buildArchetype(name, seed, D, counts) {
  const rng = mulberry32(seed);
  const build = ARCHETYPES[name];
  if (!build) return null;
  const partial = build(rng, D, counts);
  if (!partial) return null;
  const stones = placeStones(rng, partial.ledges, partial.tins, partial.drums, counts.stones ?? 0, [CANNON_X + 260, CANNON_X + D - 120]);
  if (stones === null) return null;
  return { N: counts.N, seed, ledges: partial.ledges, tins: partial.tins, drums: partial.drums, stones };
}

// F2 order rules: levels 1-8 introduce one archetype each in the F1 order; from level 9, no archetype repeats
// in two levels in a row; each chapter uses at least 6 different archetypes; the daily takes its archetype
// from its own seed (see generateDaily). Deterministic per (level, seed): the seed only ever varies level 9+.
// A seeded shuffle of all 8 archetype names, one per chapter+seed.
function chapterPermutation(chapter, seed) {
  const rng = mulberry32(seed * 7 + chapter);
  const arr = [...ARCHETYPE_NAMES];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// D1-B (THE-595): fixed per chapter, independent of any level's own seed - archetypeFor() used to build each
// chapter's permutation from chapterPermutation(ch, seed), the *level's own* seed, so levels 11-30 (each
// solved with a different seed) never shared one shuffle and the "all 8 appear" guarantee below never actually
// held in the shipped table (only 2 archetypes survived, the two the solver happened to find easy seeds for).
// Pinning the permutation to a chapter constant means a level's archetype is decided before the solver ever
// tries a seed for it: every seed the solver searches for that level places the same archetype.
const CHAPTER_SEED = { 2: 2026, 3: 4052 };
// Used only to anchor the chapter-boundary rotation check below to a fixed value, never to the seed a solver
// happens to be trying for level 11 or 21 - otherwise that rotation could itself flip the archetype a boundary
// level gets as the solver searches seeds, which is exactly the bug this fix removes.
const BOUNDARY_SEED = 1;

export function archetypeFor(level, seed) {
  if (level <= 8) return ARCHETYPE_NAMES[level - 1];
  const ch = chapterOf(level);
  if (ch === 1) {
    // Levels 9-10: chapter 1 already has all 8 archetypes from its fixed 1-8 intro, so a simple avoid-the-
    // immediate-repeat pick is enough here (pure: derives the previous level's own archetype the same way).
    const rng = mulberry32(seed * 1000 + level);
    const prevName = level - 1 <= 8 ? ARCHETYPE_NAMES[level - 2] : archetypeFor(level - 1, seed);
    let name = ARCHETYPE_NAMES[Math.floor(rng() * ARCHETYPE_NAMES.length)];
    let guard = 0;
    while (name === prevName && guard < 20) { name = ARCHETYPE_NAMES[Math.floor(rng() * ARCHETYPE_NAMES.length)]; guard += 1; }
    return name;
  }
  // Chapters 2 and 3 (10 free levels each): cycle a fixed-per-chapter permutation of all 8 archetypes. Every
  // entry in a permutation is distinct, so this never repeats on consecutive levels - including at the cycle's
  // own wrap point - and guarantees all 8 appear (comfortably over the spec's "at least 6 different"). Rotated
  // by one if its own first entry would repeat the previous chapter's last level - a permutation stays a
  // permutation under rotation, so every property above still holds.
  const start = ch === 2 ? 11 : 21;
  let perm = chapterPermutation(ch, CHAPTER_SEED[ch]);
  if (perm[0] === archetypeFor(start - 1, BOUNDARY_SEED)) perm = [...perm.slice(1), perm[0]];
  const name = perm[(level - start) % perm.length];
  // CTO amendment on THE-595's escalation (D1-B): level 30's own distance (D ~2,300, the single farthest in
  // the whole table) sits past twinTowers' own reach - a second, separate target always needs more room than
  // one, and no generator-parameter loosening found a working combination there (3 rounds tried). hilltop was
  // tried next (CTO's other suggestion) and hit the same ceiling even tapered - round 4, still no clear after
  // the full budget. `fort` (single wall-flanked shelf, no second target and no hill elevation to clear) is
  // the 3rd single-target option, so a 3-way rotation keeps the chapter's set of 8 archetypes unchanged while
  // avoiding any adjacent repeat: level 30 gets fort (near 29's bunker, different), level 23 gets hilltop at
  // its own original, closer distance (D ~1,911, under this round's D > 2,000 taper threshold, so unaffected
  // - works the same way level 17 already does), and twinTowers moves to level 24 (D ~1,967, off level 22's
  // immediate neighbour) same as before.
  if (ch === 3 && level === 23) return "hilltop";
  if (ch === 3 && level === 24) return "twinTowers";
  if (ch === 3 && level === 30) return "fort";
  return name;
}

// The tower for a level (1-30) and seed. Null when this seed's layout isn't placeable (the caller tries the next).
export function generateLevel(level, seed) {
  const name = archetypeFor(level, seed);
  const D = distanceFor(level);
  const ch = chapterOf(level);
  const rng = mulberry32(seed);
  const counts = pieceCounts(ch, rng);
  const par = parBand(level)[0]; // a provisional par for N; the solver overwrites par/shots once it knows the real one
  const N = familySizeFor(level, par);
  // Chapter 1 shelves topple from any touch (CTO decision on THE-456, spec v4a - unchanged by the v2 delta,
  // so still in force): carried into every archetype via counts.touch, same mechanism as v1's level 1.
  const def = buildArchetype(name, seed, D, { ...counts, N, touch: ch === 1 });
  if (!def) return null;
  def.slots = knacksFor({ level, ch }, N, mulberry32(seed + 7919));
  return { level, archetype: name, ...def };
}

// The daily Family Tower (spec v2 §B1/§F2: D 1,500-2,000, its own archetype from the seed).
export function generateDaily(seed) {
  const rng = mulberry32(seed);
  const D = 1500 + Math.floor(rng() * 501);
  const name = ARCHETYPE_NAMES[Math.floor(rng() * ARCHETYPE_NAMES.length)];
  const counts = pieceCounts(2, rng); // the daily's piece counts follow chapter 2's band (spec v4c's N4/2-shelf shape predates v2; counts now come from the chapter table)
  const par = 2;
  const N = familySizeFor(11, par); // par+2, matching the "from level 11" rule the daily's difficulty sits at
  const def = buildArchetype(name, seed, D, { ...counts, N });
  if (!def) return null;
  def.slots = knacksFor({ ch: "daily" }, N, mulberry32(seed + 7919));
  return { level: "daily", archetype: name, ...def };
}

// The fort's own silhouette hash (spec v2 §K, CTO's definition on THE-521): roundTo100(fortW) |
// roundTo100(fortH) | roundTo100(fortBaseY above the floor) | support-ledge count | floor(tins/3) | drums |
// crates. The fort box is the bounding box of every target piece and every ledge/stone the archetype placed
// (not the cannon or the floor). The archetype id is deliberately not part of the hash (F2 already bans a
// repeat archetype two levels running, so a hash with the id could never collide).
export function fortSilhouette(def) {
  const xs = [], ys = [];
  for (const L of def.ledges) { xs.push(L.x0, L.x1); ys.push(L.top, L.top + L.h); }
  for (const t of def.tins) { xs.push(t.x - TIN_R, t.x + TIN_R); ys.push(t.y - TIN_R, t.y + TIN_R); }
  for (const d of def.drums || []) { xs.push(d.x - DRUM_R, d.x + DRUM_R); ys.push(d.y - DRUM_R, d.y + DRUM_R); }
  for (const s of def.stones || []) { xs.push(s.x - STONE_R, s.x + STONE_R); ys.push(s.y - STONE_R, s.y + STONE_R); }
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  const baseY = FLOOR - Math.max(...ys);
  const round100 = (n) => Math.round(n / 100) * 100;
  const crateCount = def.ledges.filter((L) => L.crate).length;
  return [round100(w), round100(h), round100(baseY), def.ledges.length, Math.floor(def.tins.length / 3), (def.drums || []).length, crateCount].join("|");
}
