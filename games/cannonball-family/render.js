// Canvas drawing (THE-449 S6; design "World and units", "Layout"). Render only: it reads the sim and never changes
// it. Uses the ported troupe renderer (troupe.js, CBF) for the big top, the troupe and every prop.
import { FIELD, CANNON, TIN_R, FLYER_R } from "./sim.js";
import { arcPoints } from "./aim.js";
import { CBF } from "./troupe.js";
import { CAM_Y } from "./camera.js";

export const WORLD_H = 720; // spec v2 §A1: the camera always shows this many world units of height
const MAX_SCALE = 1.5; // spec §6 scale cap
const FACE_LOADED = 92, FACE_FLIGHT = 72; // world units (= the r 36 collider's diameter for flight)
// CSS px floors (spec §6; the flight floor raised 44 -> 48 per THE-474/THE-453's likeness check: a fresh
// matcher on 6 real people scored 44px at 4/6 matched, 48px at 6/6, both centre- and face-crop). Exported so
// tests can check the real constant, not a copy of the number.
export const FACE_LOADED_MIN = 56, FACE_FLIGHT_MIN = 48;
// D2-5 (THE-595): the altitude marker's own trigger floor in CSS px - see its use below. The sprite's own
// half-size can exceed this at a tall viewport, in which case that (size / 2) wins instead.
export const HIGH_FLYER_MARKER_MIN = 40;

// scale is driven by viewport height alone (spec A1: "visible width = 720 x the viewport's aspect ratio"), so
// a camera x pan never changes it — only cssH and zoom (<1 = zoomed out, showing more than 720 units) do.
export function scaleForHeight(cssH, zoom = 1) {
  return Math.min(cssH / (WORLD_H / zoom), MAX_SCALE);
}

// Maps a camera { x, y, zoom } (world units, world units, scale factor) to CSS px: cam.x/y land at the
// viewport's centre. view maps world -> CSS px via { scale, ox, oy }.
export function viewFromCamera(cam, cssW, cssH) {
  const scale = scaleForHeight(cssH, cam.zoom);
  return { scale, ox: cssW / 2 - cam.x * scale, oy: cssH / 2 - cam.y * scale };
}

// The decorative screens (title, map, result) have no sim to frame, so they get a fixed camera over a nominal
// box rather than gameplay's own (game.js only builds a real camera for cb-play).
const DECOR_CAM = { x: 640, y: CAM_Y, zoom: 1 };
export function fitView(cssW, cssH) {
  return viewFromCamera(DECOR_CAM, cssW, cssH);
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
// loadPhotos()'s own array (or null), passed to memberFor for whichever member is drawn each frame. fortX:
// the fort's own centre (game.js's fortCenterX()), for the chapter backdrop's spotlight aim and the off-screen
// fort flag (spec v2 §C2/§C7, §F3/§G4 L1-L2, moved into S2 by the S1 feel check on THE-527); level: the
// current level number (or 1), for the chapter palette. trace: [{x,y}] world points, the previous shot's real
// flight path, shown as faint tacking dots while aiming the next one (spec C7, new) - game.js already clears
// it to [] once that next shot fires, so draw() just renders whatever it's handed.
export function draw(ctx, sim, view, dpr, preview, cast, arcFrac = 1, hand = null, wobble = 0, tags = [], photos = null, fortX = null, level = 1, trace = [], flightTrail = []) {
  const cssW = ctx.canvas.width / dpr, cssH = ctx.canvas.height / dpr;
  CBF.tokens(); // refresh the palette from tokens.css (cheap; a no-op once nothing changes)

  // Pass 1: the chapter backdrop, full-bleed behind the world (spec §6: never black bars; §F3/§G4 L1-L2 parallax).
  // Drawn under the same world transform as pass 2 (D1-A, THE-595): backdrop()/ring() place tiles and the ring
  // floor at real world coordinates, so a dpr-only transform left them stuck near CSS-px-as-world-units while
  // the camera panned past them, smearing into near-white canvas past cam.x ~ 1,000.
  ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.ox, dpr * view.oy);
  const chapter = CBF.chapterFor(level);
  const leftWorldX = screenToWorld(view, 0, 0).x, visW = cssW / view.scale, visH = cssH / view.scale;
  const beams = [{ x: CANNON.x + 20, w: 300 }, { x: fortX ?? CANNON.x + 900, w: 460 }];
  CBF.backdrop(ctx, chapter, { x: leftWorldX, y: 0, zoom: 1 }, { w: visW, h: visH }, sim.step / 120, { beams, floorY: FIELD.floor });
  CBF.ring(ctx, chapter, leftWorldX, leftWorldX + visW, FIELD.floor);

  // Pass 2: the world (ledges, tins, stones, the cannon, the net, the stitch and the trail), at world scale.
  ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.ox, dpr * view.oy);
  const k = view.scale;
  for (const L of sim.ledges) {
    if (L.off) continue; // a swung plank or a given-way touch shelf has no collider and no shelf left to draw
    if (L.plank) CBF.plank(ctx, L.x0, L.top, L.x1 - L.x0, 1, 0, FIELD.floor, k);
    else if (L.crate) CBF.crate(ctx, L.x0, L.top, L.x1 - L.x0, L.h, { k, iron: L.iron, hp: L.hp });
    else CBF.ledge(ctx, L.x0, L.top, L.x1 - L.x0, FIELD.floor, k);
  }
  for (const s of sim.stones) CBF.stone(ctx, s.x, s.y, s.r, Math.round(s.x + s.y), k);
  // A burst drum leaves sim.world (sim.js's burstDrum), so it's simply not drawn once d.down is true - the
  // burst animation itself (torn skin, felt fluff) is S5's juice pass, not logic this slice needs.
  for (const d of sim.drums) {
    if (d.down) continue;
    CBF.drum(ctx, d.x, d.y, d.r, d.hp >= 2 ? "whole" : "dent", k);
  }
  // A downed tin keeps falling and rolling in the physics world (markDown only flags it; it's never removed
  // from sim.world), so drawing it at its current t.x/t.y the same as a standing one lets that tumble read on
  // screen — the feel-check's payoff of a knock-down, where popping it on the counting frame had none
  // (DESIGN.md §5 feel-check item 2). band: true switches the tin to a label band (item 3: a blind read called
  // the plain lid "cannonballs" for 2 of 3 tins; the band read as "tins" 2 of 2).
  for (const t of sim.tins) CBF.tin(ctx, t.x, t.y, TIN_R, CBF.tins()[t.ledge % CBF.tins().length], k, { band: true, rot: wobble });

  // The last-shot tacking-dot trace (spec C7): the same stitched trail() the live flyer leaves (spec G5),
  // faded, since this is a record of what happened, not a live effect - a lower globalAlpha over trail()'s own
  // fixed colour is enough, no new art needed.
  if (trace.length >= 2) {
    ctx.save();
    ctx.globalAlpha = 0.35;
    CBF.trail(ctx, trace.map((p) => [p.x, p.y]), { k });
    ctx.restore();
  }
  // The live flyer's own felt streamer trail (spec G5): full alpha, drawn only while sim.phase is "flight" -
  // game.js hands it the in-progress shotPath, the same array trace above is built from once the shot resolves.
  if (flightTrail.length >= 2) CBF.trail(ctx, flightTrail.map((p) => [p.x, p.y]), { k });

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
    // Altitude marker (spec C5): past y = -600 the camera's zoom-out floors at 0.75x rather than chasing the
    // flyer any further, so once it actually clips the top edge a small felt pennant tracks its x instead -
    // a plain shape, not a new CBF art function, since this is a functional indicator, not a character.
    // D2-5 (THE-595): the trigger has to clear the sprite's own half-size (size/2), not a flat 40 - at a tall
    // enough viewport (scaleForHeight can reach MAX_SCALE 1.5, so size up to 108) the flyer's own sprite starts
    // clipping the top edge before a flat 40px trigger would, leaving it there with no marker for a few frames.
    if (p.y < Math.max(HIGH_FLYER_MARKER_MIN, size / 2)) {
      ctx.save();
      ctx.fillStyle = "rgba(246,233,201,.95)";
      ctx.beginPath();
      ctx.moveTo(p.x, 8); ctx.lineTo(p.x - 7, 22); ctx.lineTo(p.x + 7, 22);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  } else if ((sim.phase === "bow" || sim.phase === "won" || sim.phase === "lost") && sim.pose) {
    const p = worldToScreen(view, 320, FIELD.floor - 20);
    const size = Math.max(FACE_LOADED * k, FACE_LOADED_MIN);
    CBF.flyer(ctx, p.x, p.y, { m: memberFor(cast, flownSlot ? flownSlot.member : 0, photos), size, pose: sim.pose });
  }

  // The off-screen fort flag (spec §C2, moved into S2 by the S1 feel check on THE-527): shown only while the
  // fort's own centre sits past the right edge, pinned there with the remaining distance in "metres" (100
  // world units = 1 m, troupe.js's own fortFlag() convention).
  if (fortX !== null && sim.phase !== "won" && sim.phase !== "lost") {
    const fortScreenX = worldToScreen(view, fortX, 0).x;
    if (fortScreenX > cssW - 10) {
      CBF.fortFlag(ctx, cssW - 6, cssH * 0.3, (fortX - CANNON.x) / 100, { t: sim.step / 120 });
    }
  }

  // The first-run demo's felt hand (spec §5), at the synthetic pull's current screen point.
  if (hand) CBF.hand(ctx, hand.x, hand.y, hand.down, k);
}
