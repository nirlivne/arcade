// Canvas drawing (THE-449 S6; design "World and units", "Layout"). Render only: it reads the sim and never changes
// it. Uses the ported troupe renderer (troupe.js, CBF) for the big top, the troupe and every prop.
import { FIELD, CANNON, TIN_R, FLYER_R } from "./sim.js";
import { arcPoints } from "./aim.js";
import { CBF } from "./troupe.js";

export const WORLD_W = FIELD.r - FIELD.l, WORLD_H = 480;
const MAX_SCALE = 1.5; // spec §6 scale cap
const FACE_LOADED = 92, FACE_FLIGHT = 72; // world units (= the r 36 collider's diameter for flight)
// CSS px floors (spec §6; the flight floor raised 44 -> 48 per THE-474/THE-453's likeness check: a fresh
// matcher on 6 real people scored 44px at 4/6 matched, 48px at 6/6, both centre- and face-crop). Exported so
// tests can check the real constant, not a copy of the number.
export const FACE_LOADED_MIN = 56, FACE_FLIGHT_MIN = 48;

// The world (640 × 480) scaled uniformly into the canvas and centred. view maps world → CSS px.
export function fitView(cssW, cssH) {
  const scale = Math.min(cssW / WORLD_W, cssH / WORLD_H, MAX_SCALE);
  return { scale, ox: (cssW - WORLD_W * scale) / 2, oy: (cssH - WORLD_H * scale) / 2 };
}

export function screenToWorld(view, x, y) {
  return { x: (x - view.ox) / view.scale, y: (y - view.oy) / view.scale };
}

export function worldToScreen(view, x, y) {
  return { x: view.ox + x * view.scale, y: view.oy + y * view.scale };
}

// A member for CBF's head()/flyer(): { m: {colour, look, photo}, ... }. cast is the "Our family" save; i is the
// rail's member index. photos (optional) is loadPhotos()'s own array, same indexing as cast.members: a seat's
// loaded Image, or null — passed through as m.photo, which CBF.head()/flyer() draw as the die-cut sticker in
// place of the felt face when it's present (CTO review on THE-449: a picked photo changed nothing in the game
// before this, since nothing ever loaded or passed one through). Missing cast (not loaded yet) falls back to
// a plain default look.
export function memberFor(cast, i, photos = null) {
  const m = cast && cast.members[i];
  if (!m) return { colour: "poppy", look: 0 };
  return { colour: m.colour, look: m.look, photo: readyPhoto(photos && photos[i]) };
}

// Loads every seat's saved photo (family.js's store) into an Image once, for memberFor to pass to CBF. Returns
// an array the same length as cast.members (null for a seat with no photo or a photo that fails to decode).
// Called once per cast load/save (THE-449 S6), not every frame: an Image only needs loading when the photo
// itself changes, never on a redraw. onReady (optional) runs once a seat's own Image finishes decoding — the
// main canvas redraws every frame regardless and self-corrects once readyPhoto() stops filtering it out, but
// anything drawn once per level load (the rail chips) needs its own nudge to redraw if the decode is still in
// flight the first time, rather than showing the felt face for the rest of that level.
export function loadPhotos(cast, store, onReady = null) {
  return cast.members.map((m, i) => {
    if (!m.photo) return null;
    const url = store.getPhoto(i);
    if (!url) return null;
    const img = new Image();
    if (onReady) img.addEventListener("load", onReady, { once: true });
    img.src = url;
    return img;
  });
}

// memberFor's own photo arg must be either a decoded image or null — never an Image mid-decode (CBF.sticker
// reads photo.width/height to scale the die-cut circle, which is 0 before decode, so it would draw at zero
// size instead of falling back to the felt face). loadPhotos() returns synchronously so game.js can rebuild
// the rail/HUD at once; this is the one place that actually checks .complete before a frame uses the result.
export function readyPhoto(img) {
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}

// The rail slot about to load (the next shot) and the one that already fired (the current flyer, and whoever
// is bowing/shrugging after it land). fire() (sim.js) decrements shotsLeft the instant a shot launches, so
// sim.N - sim.shotsLeft is already the *next* slot once the phase leaves "aim" — flight and bow both need
// one slot back from that (CTO review on THE-449: this read the next slot in flight too, so the wrong
// member's head flew every shot). A pure function so it's unit-testable without a canvas.
export function flyingSlot(sim) {
  const next = sim.rail[sim.N - sim.shotsLeft];
  const flown = sim.rail[Math.max(0, sim.N - sim.shotsLeft - 1)];
  return { next, flown };
}

// preview: { angle, power } while a pull is held or the keyboard aim is active (null otherwise). cast is the
// "Our family" save (names, colours, looks; photos are drawn later, see DESIGN.md §6.5). arcFrac is the aim
// stitch's length as a 0–1 fraction of the full arc (game.js's arcFraction(); DESIGN.md §5 feel-check item 1:
// the full preview turns aiming into "put the dots on a tin" from level 4 on). hand: { x, y, down } (screen
// px) draws the first-run demo's felt hand at the pull's current point (spec §5); null the rest of the time.
// wobble: a rotation (radians) applied to every tin, for the demo's "the tins wobble once" opening beat.
// tags: [{ x, y, scale, alpha }] (world units), the "+100" pop per downed target (DESIGN.md §9). photos:
// loadPhotos()'s own array (or null), passed to memberFor for whichever member is drawn each frame.
export function draw(ctx, sim, view, dpr, preview, cast, arcFrac = 1, hand = null, wobble = 0, tags = [], photos = null) {
  const cssW = ctx.canvas.width / dpr, cssH = ctx.canvas.height / dpr;
  CBF.tokens(); // refresh the palette from tokens.css (cheap; a no-op once nothing changes)

  // Pass 1: the big top, full-bleed behind the world (spec §6: never black bars).
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const floorCss = view.oy + FIELD.floor * view.scale;
  CBF.tent(ctx, cssW, cssH, { floorY: floorCss, spot: [view.ox + 480 * view.scale, view.oy + 220 * view.scale, 260 * view.scale] });

  // Pass 2: the world (ledges, tins, stones, the cannon, the net, the stitch and the trail), at world scale.
  ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.ox, dpr * view.oy);
  const k = view.scale;
  for (const L of sim.ledges) {
    if (L.off) continue; // a swung plank or a given-way touch shelf has no collider and no shelf left to draw
    if (L.plank) CBF.plank(ctx, L.x0, L.top, L.x1 - L.x0, 1, 0, FIELD.floor, k);
    else CBF.ledge(ctx, L.x0, L.top, L.x1 - L.x0, FIELD.floor, k);
  }
  for (const s of sim.stones) CBF.stone(ctx, s.x, s.y, s.r, Math.round(s.x + s.y), k);
  // A downed tin keeps falling and rolling in the physics world (markDown only flags it; it's never removed
  // from sim.world), so drawing it at its current t.x/t.y the same as a standing one lets that tumble read on
  // screen — the feel-check's payoff of a knock-down, where popping it on the counting frame had none
  // (DESIGN.md §5 feel-check item 2). band: true switches the tin to a label band (item 3: a blind read called
  // the plain lid "cannonballs" for 2 of 3 tins; the band read as "tins" 2 of 2).
  for (const t of sim.tins) CBF.tin(ctx, t.x, t.y, TIN_R, CBF.tins()[t.ledge % CBF.tins().length], k, { band: true, rot: wobble });

  // "+100" tags (DESIGN.md §9): CBF.tag's own ctx.scale(1/k, 1/k) already floors its size in CSS px the same
  // way a head/flyer does; the pop/float scale is applied as an extra factor around that call, since tag()
  // itself (troupe.js, the designer's reference renderer) takes alpha and rotation but not a pop scale.
  for (const tg of tags) {
    ctx.save();
    ctx.translate(tg.x, tg.y);
    ctx.scale(tg.scale, tg.scale);
    CBF.tag(ctx, 0, 0, "+100", { k, alpha: tg.alpha });
    ctx.restore();
  }

  const held = preview && sim.phase === "aim";
  const angleRad = held ? -(preview.angle * Math.PI) / 180 : -Math.PI / 4;
  CBF.cannon(ctx, CANNON.x, CANNON.y, angleRad, 70, { k, fuse: sim.fuse / 1800, t: sim.step / 120 });

  if (held) {
    const pts = arcPoints(CANNON, preview.angle, preview.power, 60).map((p) => [p.x, p.y]);
    CBF.aimStitch(ctx, pts, arcFrac, { k });
  }

  CBF.net(ctx, 150, 634, FIELD.floor, 12, { k });

  // Pass 3: the troupe, at a CSS-px size that floors independent of the world scale (spec §6 "Face size floor").
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const { next: nextSlot, flown: flownSlot } = flyingSlot(sim);
  if (sim.phase === "aim" && nextSlot) {
    const p = worldToScreen(view, CANNON.x, CANNON.y);
    const size = Math.max(FACE_LOADED * k, FACE_LOADED_MIN);
    CBF.loaded(ctx, p.x, p.y, angleRad, 70 * k, { m: memberFor(cast, nextSlot.member, photos), size, knack: nextSlot.knack });
  } else if (sim.phase === "flight" && sim.flyer) {
    const p = worldToScreen(view, sim.flyer.x, sim.flyer.y);
    const size = Math.max(FACE_FLIGHT * k, FACE_FLIGHT_MIN);
    const va = Math.atan2(sim.flyer.vy, sim.flyer.vx);
    CBF.flyer(ctx, p.x, p.y, { m: memberFor(cast, flownSlot ? flownSlot.member : 0, photos), size, pose: "flight", va, knack: flownSlot && flownSlot.knack });
  } else if ((sim.phase === "bow" || sim.phase === "won" || sim.phase === "lost") && sim.pose) {
    const p = worldToScreen(view, 320, FIELD.floor - 20);
    const size = Math.max(FACE_LOADED * k, FACE_LOADED_MIN);
    CBF.flyer(ctx, p.x, p.y, { m: memberFor(cast, flownSlot ? flownSlot.member : 0, photos), size, pose: sim.pose });
  }

  // The first-run demo's felt hand (spec §5), at the synthetic pull's current screen point.
  if (hand) CBF.hand(ctx, hand.x, hand.y, hand.down, k);
}
