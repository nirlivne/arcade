// Draws the ground, letters/platforms and seeker wedges in world coordinates (the caller has
// already set the canvas transform to the camera, per render/camera.js).
import { g, C, piece, rectP, roughC } from '../engine/paper.js';

// a rough-cut rect, roughed once and cached (spec §8: zero rough() per frame; the shapes never change)
const roughRect = (x, y, w, h, seed) => roughC(`R|${x}|${y}|${w}|${h}|${seed}`, () => rectP(x, y, w, h), seed, 1.6, 10);
import { raycastLength } from '../sim/los.js';
import { hasGlyph, drawLetterPiece } from './glyphs.js';

// getters, not copies: theme.js colour slots rewrite C at boot, after this module has loaded (S9)
const INK = { get ink() { return C.ink; }, get cream() { return C.paper; }, get mus() { return C.mus; }, get red() { return C.red; } };
const SHADOW_TINT = { get cream() { return C.musD; }, get mus() { return C.inkL; } }; // flat wedge tint per set (spec §2.1 "Watchers")
// Set 4's tint is spec'd by exact hex (`#d6c6a2` = paperD) and must not touch set 1's existing
// look, which also happens to use groundInk 'cream' -- keyed by set NUMBER instead (THE-1556
// review), so this can only ever affect set 4. Sets with no entry here fall back to SHADOW_TINT.
const SET_SHADOW_TINT = { get 4() { return C.paperD; } };

export function drawBackground(canvasW, canvasH, cam, groundInk) {
  // fills in screen space (not world space) so it always covers the viewport regardless of zoom
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = INK[groundInk] || C.paper;
  g.fillRect(0, 0, canvasW, canvasH);
  g.restore();
}

export function drawFloor(worldLeft, worldRight, floorY) {
  g.fillStyle = C.ink;
  g.fillRect(worldLeft, floorY, worldRight - worldLeft, 2000);
}

export function drawPlatforms(platforms, seed = 1) {
  for (const p of platforms) {
    if (!p.ink) continue; // collision-only (the floor itself; its ink is the background fill)
    // Real cut-letter glyphs where a baked outline exists for this piece's label (design §1); the
    // plain rough-cut rect stays the fallback for shapes with no letter (and for any glyph miss).
    if (hasGlyph(p.label) && drawLetterPiece(p, INK[p.ink] || C.ink, seed + p.x)) continue;
    piece(roughRect(p.x, p.y, p.w, p.h, seed + p.x), INK[p.ink] || C.ink, { gap: 2.4, shadow: true });
  }
}

// Front-layer pieces (spec beat 17, set 5's EDITED letters): drawn after the hero (game.js), so a
// hidden hero reads as behind them, not under them. Red-set hide letters draw solid (opt.solid),
// closing their counter per fix 5; the I (no glyph lookup needed here since it still has one) is
// plain -- it carries no hide rect, so there's no counter-closing requirement for it either way.
export function drawFrontLayer(letters, seed = 2000) {
  for (const p of letters) {
    if (hasGlyph(p.label) && drawLetterPiece(p, INK[p.ink] || C.ink, seed + p.x, { solid: true, backing: true })) continue;
    piece(roughRect(p.x, p.y, p.w, p.h, seed + p.x), INK[p.ink] || C.ink, { gap: 2.4, shadow: true });
  }
}

// The odd pieces (spec beats 4/13/16, THE-1559; decoration since G1c). Unresolved, each one shows
// the "piece that doesn't belong"; once a seek FLIP resolves it, it draws right. col: a colour that
// reads on its set's ground. Placeholders until the S8 art pass (CEO: Designer reviews in S8).
export function drawOddPieces(pieces, resolved, colFor, groundColFor, seed = 3000) {
  for (const p of pieces) {
    const done = resolved.includes(p.id);
    const col = colFor(p);
    if (p.id === 'oddLamp') {
      // a hanging lamp shade on a chain, and its paper shadow: wrong way = widening up, toward the
      // light; right = widening down to the floor.
      const cx = p.x + p.w / 2, top = p.y, bottom = p.y + p.h;
      g.fillStyle = col;
      g.fillRect(cx - 2, top - 200, 4, 200);
      piece([[[cx - 40, top], [cx + 40, top], [cx + 22, top - 30], [cx - 22, top - 30]]], col, { gap: 1.5, shadow: true });
      const shadow = done
        ? [[cx - 20, top + 10], [cx + 20, top + 10], [cx + p.w / 2, bottom], [cx - p.w / 2, bottom]]
        : [[cx - p.w / 2, top + 10], [cx + p.w / 2, top + 10], [cx + 20, bottom], [cx - 20, bottom]];
      piece([shadow], col, { gap: 2.4, shadow: false });
      continue;
    }
    const mirror = p.id === 'oddC' && !done;
    if (mirror) {
      g.save();
      g.translate(p.x + p.w / 2, 0);
      g.scale(-1, 1);
      g.translate(-(p.x + p.w / 2), 0);
    }
    if (!(hasGlyph(p.label) && drawLetterPiece(p, col, seed + p.x))) {
      piece(roughRect(p.x, p.y, p.w, p.h, seed + p.x), col, { gap: 2.4, shadow: true });
    }
    if (mirror) g.restore();
    if (p.id === 'oddS' && !done) {
      // the extra cut: a slanted gap through the S in the ground colour
      g.fillStyle = groundColFor(p);
      g.save();
      g.translate(p.x + p.w / 2, p.y + p.h / 2);
      g.rotate(-0.25);
      g.fillRect(-p.w, -6, p.w * 2, 12);
      g.restore();
    }
  }
}

// R2 the lamp-code doors (spec §3.4, THE-1559). Placeholders until the S8 art pass: the lobby wall
// and the O, D, R door letters in paper on the ink set; each door's sill dashes in tangerine on the
// floor (3, 1, 2); a lipstick X over each wrong door tried; the right door drawn open once it's
// resolved; and the code bulb in a tangerine frame, paper while lit, ink while dark.
export function drawR2({ wall, doors, bulb, wrongDoors, resolved }) {
  piece(roughRect(wall.x, wall.y, wall.w, wall.h, 4100), C.paper, { gap: 2.4, shadow: true });
  for (const d of doors) {
    const open = resolved.includes(d.id);
    if (!(hasGlyph(d.label) && drawLetterPiece(d, open ? C.inkL : C.paper, 4200 + d.x))) {
      piece(roughRect(d.x, d.y, d.w, d.h, 4200 + d.x), C.paper, { gap: 2.4, shadow: true });
    }
    const dashW = 22, gap = 12, total = d.dashes * dashW + (d.dashes - 1) * gap;
    g.fillStyle = C.mus;
    for (let i = 0; i < d.dashes; i++) g.fillRect(d.x + d.w / 2 - total / 2 + i * (dashW + gap), 10, dashW, 8);
    if (wrongDoors.includes(d.id)) {
      g.strokeStyle = C.red;
      g.lineWidth = 12;
      g.beginPath();
      g.moveTo(d.x, d.y + 20); g.lineTo(d.x + d.w, d.y + d.h - 20);
      g.moveTo(d.x + d.w, d.y + 20); g.lineTo(d.x, d.y + d.h - 20);
      g.stroke();
    }
  }
  g.fillStyle = C.mus;
  g.fillRect(bulb.x - 34, bulb.y - 34, 68, 68);
  g.fillStyle = bulb.lit ? C.paper : C.inkL;
  g.beginPath();
  g.arc(bulb.x, bulb.y, 24, 0, Math.PI * 2);
  g.fill();
}

// R1 the EDITOR wall + the Negative (spec §3.4 / beat 19, THE-1559). Placeholders until S8: ink
// letters (the R mirrored until it's turned right), a paper edge and a small shake on the rattled
// letter while its watcher is turned (lipstick wouldn't read on the red set), the shut barrier
// behind the R, and the Negative as a tangerine strip on a black backing until it's taken.
export function drawR1({ letters, door, negative, resolved, look, taken, tSec }) {
  for (const l of letters) {
    const backwards = l.backwards && !resolved.includes(l.id);
    const rattling = look && look.id === l.id;
    const dx = rattling && look.phase === 'telegraph' ? Math.sin(tSec * 60) * 6 : 0;
    g.save();
    g.translate(dx, 0);
    if (backwards) { g.translate(l.x + l.w / 2, 0); g.scale(-1, 1); g.translate(-(l.x + l.w / 2), 0); }
    if (!(hasGlyph(l.label) && drawLetterPiece(l, C.ink, 5000 + l.x))) {
      piece(roughRect(l.x, l.y, l.w, l.h, 5000 + l.x), C.ink, { gap: 2.4, shadow: true });
    }
    g.restore();
    if (rattling) {
      g.strokeStyle = C.paper;
      g.lineWidth = 8;
      g.strokeRect(l.x + dx, l.y, l.w, l.h);
    }
  }
  if (!resolved.includes(door.opensWith)) piece([rectP(door.x, door.y, door.w, door.h)], C.ink, { gap: 0, shadow: false });
  if (!taken) {
    piece([rectP(negative.x - 20, negative.y - 20, negative.w + 40, negative.h + 20)], C.ink, { gap: 0, shadow: false });
    g.fillStyle = C.mus;
    g.fillRect(negative.x, negative.y + 20, negative.w, negative.h - 40);
  }
}

export function drawHideShapes(shapes, seed = 500) {
  for (const s of shapes) {
    piece(roughRect(s.x, s.y, s.w, s.h, seed + s.x), INK[s.ink] || C.ink, { gap: 2.4, shadow: true });
  }
}

export function drawCheckpointFlag(cp, reached) {
  const poleX = cp.triggerX + cp.triggerW / 2;
  const baseY = cp.triggerY + cp.triggerH;
  g.fillStyle = C.ink;
  g.fillRect(poleX - 3, baseY - 140, 6, 140);
  piece(rectP(poleX, baseY - 140, 46, 30), reached ? C.red : C.paperD, { gap: 1.5, shadow: false });
}

// one Watcher's sight wedge: a flat polygon in the set's shadow tint (never a hiding shape).
// D1 fix (a): each ray clips at the first solid && !oneWay rect, so the drawn cone matches what
// the watcher's own line-of-sight check actually reaches (spec: "what you see is what it sees").
// A lamp's wedge is drawn cream instead (spec §2.1 "Watchers": "on the ink set they carry hand
// lamps: the wedge is a cream beam instead, a hiding shape") -- still the same clipped cone shape,
// just a different fill, since the actual hiding footprint (sim/lamps.js's beamFootprint) is a
// separate, simpler rect fed into cover() and is never drawn directly.
export function drawWedge(watcher, groundInk, rects = [], set) {
  const half = (watcher.halfAngleDeg * Math.PI) / 180;
  const a0 = watcher.facingAngle - half, a1 = watcher.facingAngle + half;
  const eye = { x: watcher.x, y: watcher.y };
  const pts = [[watcher.x, watcher.y]];
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    const len = raycastLength(eye, a, watcher.length, rects);
    pts.push([watcher.x + Math.cos(a) * len, watcher.y + Math.sin(a) * len]);
  }
  const fill = watcher.isLamp ? C.paper : (SET_SHADOW_TINT[set] || SHADOW_TINT[groundInk] || C.inkL);
  piece(pts, fill, { gap: 0, shadow: false });
}
