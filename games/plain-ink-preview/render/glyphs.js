// Real cut-letter glyphs (design §1; THE-1555 CEO add-on: "the letters are still plain blocks").
// data/glyphs.json is baked once at build time (tools/plain-ink-glyphs.mjs) from the real font
// outlines -- the shipped game never touches opentype.js, only this pre-cut polygon data.
// Collision and cover keep using the authored rects (level1.js); this only changes what gets
// drawn on top of a platform/hide-shape piece that carries a letter label.
import { piece, roughC, rectP } from '../engine/paper.js';

// Fetched once at module load (a plain data file, ~11 KB; type="module" script loading already
// requires top-level await support, so this needs no separate boot/loading state). Precached by
// sw.js like every other shipped asset. CTO review on THE-1556: a rejected fetch must not fail the
// whole module (and so the whole game boot) -- fall back to no glyphs, which drawLetterPiece below
// already treats as "use the plain rect" at every call site.
const glyphData = await fetch(new URL('../data/glyphs.json', import.meta.url)).then((r) => r.json()).catch(() => null);

// A piece's label may carry a disambiguating suffix ("E (set5)", "E2 (set5)") for authored-data
// bookkeeping; only its first character selects the glyph.
function glyphFor(label) {
  return label ? glyphData?.glyphs[label[0]] : undefined;
}

function polyArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

export function hasGlyph(label) {
  return !!glyphFor(label);
}

// Fits the baked glyph into rect {x,y,w,h} (y/h: top edge + height, sim/physics.js convention):
// uniform scale from the glyph's own cap height to the rect's height, centred horizontally,
// baseline flush with the rect's bottom edge. Returns one polygon per contour (letters with
// counters, like A or D, bake to more than one -- piece() fills them evenodd, so a counter reads
// as a hole rather than solid ink).
// stretch (THE-1648, rework stand-ons): scale x to the rect's width too, so a stand-on's letter is exactly as
// wide as what you can land on (the rework's "what you see is what counts"), at the cost of the letter's
// proportions
export function letterContours(label, rect, stretch = false) {
  const gl = glyphFor(label);
  if (!gl) return null;
  const capH = gl.bottom - gl.top;
  const s = rect.h / capH;
  const sx = stretch ? rect.w / (gl.x1 - gl.x0) : s;
  const cx = rect.x + rect.w / 2 - ((gl.x0 + gl.x1) / 2) * sx;
  const baseY = rect.y + rect.h - gl.bottom * s;
  return gl.contours.map((poly) => poly.map(([x, y]) => [cx + x * sx, baseY + y * s]));
}

// opt.solid (spec §2.1 fix 5, the red-set hide letters): "the letter is cut with that area solid,
// its counter closed by a paper patch in the letter's ink" -- draw only the outer contour (the
// largest by area), not every counter-hole contour, so a D or O reads as a solid silhouette
// instead of its usual evenodd-cut hole.
//
// opt.backing (THE-1556 carry-over, THE-1557): letterContours scales the glyph uniformly from its
// own cap height, so a narrow letter (E is ~50u wide) doesn't fill a wider authored rect (150u) --
// a hero hidden in the rect's unfilled margin visibly sticks out past the glyph's drawn silhouette.
// Filling the full rect in the same ink first, then drawing the glyph on top, guarantees the rect's
// whole footprint reads as solid ink without warping the glyph's proportions (a non-uniform x scale
// would distort the letterform instead).
export function drawLetterPiece(rect, col, seed, opt = {}) {
  let contours = letterContours(rect.label, rect, !!opt.stretch);
  if (!contours) return false;
  if (opt.solid && contours.length > 1) {
    contours = [contours.reduce((a, b) => (polyArea(b) > polyArea(a) ? b : a))];
  }
  if (opt.backing) piece([rectP(rect.x, rect.y, rect.w, rect.h)], col, { gap: 0, shadow: false });
  // THE-1566 carry-over 5: the cut is deterministic per letter, so it's roughed once and cached
  // (spec §8: zero rough() per frame); the key holds everything the cut depends on
  const amp = opt.amp ?? 1.6;
  const key = `L|${rect.label}|${rect.x}|${rect.y}|${rect.w}|${rect.h}|${seed}|${opt.solid ? 1 : 0}|${amp}|${opt.stretch ? 1 : 0}|`;
  const cut = contours.map((c, i) => roughC(key + i, () => c, seed + i * 13, amp, 9));
  piece(cut, col, { gap: opt.gap ?? 2.4, shadow: opt.shadow ?? true });
  return true;
}
