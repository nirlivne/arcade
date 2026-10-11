// Camera (THE-523 / spec v2 §C, amended by §C7 from the S1 feel check on THE-527). Pure: no DOM, no clock — the
// caller (game.js) passes an explicit dt each frame and world points it already has. The sim never imports this
// (§C6): it is presentation only, so replays, the solver and the daily stay deterministic.
//
// camera.y stays fixed at CAM_Y always (§A1 "the camera always shows 720 world units of height" needs no
// vertical pan) - altitude (§C5) only ever adjusts zoom, never y. Peek (§C3) is a horizontal-only detour from
// the aim frame, same as everything else here.
export const CAM_Y = 360; // §C7 framing amendment (was 320): the floor sits ~22 CSS px above the bottom edge at 844x390
const WORLD_H = 720; // mirrors render.js's WORLD_H (spec A1); duplicated rather than imported to avoid a cycle (render.js already imports CAM_Y from here)

const INTRO_HOLD = 0.6, INTRO_HOLD_RETRY = 0.3, INTRO_PAN = 1.4, INTRO_PAN_RETRY = 0.8; // spec C1 + C7
const HIT_HOLD = 0.6, MISS_HOLD = 0.4, RETURN_PAN = 0.8; // spec C4 + C7 (short-miss hold is shorter, no fort visit)
const FOLLOW_EASE_FROM = 0.7; // spec C4: past 70% of the distance, ease from following the flyer to framing the fort
const LEAD_FRAC = 0.12, LEAD_RAMP = 0.3; // spec C7: cam.x = flyer.x + 0.12*visibleW, ramped in over 0.3s after launch
const PEEK_PAN = 0.5; // spec C3: each pan (in or out) takes 0.5s
const ALT_Y = -600, ALT_MIN_ZOOM = 0.75, ALT_MARGIN = 40; // spec C5

function smoothstep(t) { return t * t * (3 - 2 * t); }
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp01(t) { return Math.max(0, Math.min(1, t)); }

// fortX: the fort's own centre (game.js's fortCenterX()) — every level start shows the fort first, whether or
// not this is a retry (spec C1); aimX isn't needed yet, since "intro" only ever looks at fortX, and the real
// aimX arrives through stepCamera's own input on the very next frame. curtainOpen starts false: the intro
// clock doesn't run until game.js reports the curtain has finished opening (spec C7).
export function initCamera(fortX) {
  return { x: fortX, y: CAM_Y, zoom: 1, mode: "intro", t: 0, aimX: fortX, fortX, landingX: fortX, reachedFort: false, peekFrom: fortX };
}

const SKIP_IMMUNE = new Set(["flight", "peekIn", "peek", "peekOut"]); // these own their own exit, skipToAim must not fight them

// A tap or key during the intro pan, the post-shot hold, or the return pan skips straight to the aim frame
// (spec C1/C7). This only ever mutates the camera: the shot itself already resolved in the sim (C7: "this
// skips the camera only"). A no-op during flight (the shot must resolve first) and during any peek mode (CTO
// review on THE-561: the generic "any tap/key skips to aim" keydown listener in game.js fires on every OS key
// autorepeat while V is held for peek, which kept snapping cam.mode back to "aim" ~30x/s and made a held peek
// visibly stutter back to the start of its own pan instead of holding on the fort).
export function skipToAim(cam) {
  if (!SKIP_IMMUNE.has(cam.mode)) { cam.mode = "aim"; cam.t = 0; }
}

// input: { phase (sim.phase), flyer: {x,y} | null, cannonX, aimX, fortX, visibleW, visibleH, retry, curtainOpen,
// peek }. visibleW: the current viewport box's width in world units (game.js's own viewportBox.w / scale), for
// the lead (spec C7). visibleH: the viewport's height in CSS px, for the altitude zoom (spec C5). peek: true
// while the V key/binoculars patch is held (spec C3) - aiming is blocked by game.js's own canAim() checking
// cam.mode === "aim", which peek already leaves. Mutates and returns cam.
export function stepCamera(cam, dt, input) {
  const { phase, flyer, cannonX, aimX, fortX, visibleW, visibleH, retry, curtainOpen, peek } = input;
  cam.aimX = aimX; cam.fortX = fortX;
  if (phase === "flight" && cam.mode !== "flight") { cam.mode = "flight"; cam.t = 0; cam.reachedFort = false; }
  if (cam.mode === "flight" && phase !== "flight") {
    // Short miss (spec C7): if the flight never eased past 70% of the distance, hold on the landing spot
    // (not the fort) for 0.4s, then return - never a hard cut, never an uninvited fort visit. landingX is
    // cam.x as it already stood the instant before this transition (lead included), not a fresh flyerX
    // recompute, so there's no jump from dropping the lead at the exact moment the hold starts.
    cam.landingX = cam.x;
    cam.mode = cam.reachedFort ? "holdEnd" : "missHold";
    cam.t = 0;
  }
  const introMode = cam.mode === "intro" || cam.mode === "introPan";
  if (!introMode || curtainOpen) cam.t += dt; // spec C7: the intro clock is frozen until the curtain opens
  cam.y = CAM_Y; cam.zoom = 1;
  switch (cam.mode) {
    case "intro": {
      cam.x = fortX;
      const hold = retry ? INTRO_HOLD_RETRY : INTRO_HOLD;
      if (curtainOpen && cam.t >= hold) { cam.mode = "introPan"; cam.t = 0; }
      break;
    }
    case "introPan": {
      const dur = retry ? INTRO_PAN_RETRY : INTRO_PAN;
      cam.x = lerp(fortX, aimX, smoothstep(clamp01(cam.t / dur)));
      if (cam.t >= dur) { cam.mode = "aim"; cam.t = 0; }
      break;
    }
    case "aim":
      cam.x = aimX;
      if (peek) { cam.mode = "peekIn"; cam.t = 0; cam.peekFrom = cam.x; }
      break;
    // Peek (spec C3): a binoculars patch/V key pans to frame the fort, holds while held, then pans back the
    // instant it's released - from wherever the pan had actually gotten to, never a cut. Only reachable from
    // "aim" (above) and only ever returns to "aim": peek has no meaning mid-flight, and canAim() already keeps
    // the player from firing while cam.mode isn't "aim".
    case "peekIn": {
      cam.x = lerp(cam.peekFrom, fortX, smoothstep(clamp01(cam.t / PEEK_PAN)));
      if (!peek) { cam.mode = "peekOut"; cam.t = 0; cam.peekFrom = cam.x; }
      else if (cam.t >= PEEK_PAN) { cam.mode = "peek"; cam.t = 0; }
      break;
    }
    case "peek": {
      cam.x = fortX;
      if (!peek) { cam.mode = "peekOut"; cam.t = 0; cam.peekFrom = cam.x; }
      break;
    }
    case "peekOut": {
      cam.x = lerp(cam.peekFrom, aimX, smoothstep(clamp01(cam.t / PEEK_PAN)));
      if (cam.t >= PEEK_PAN) { cam.mode = "aim"; cam.t = 0; }
      break;
    }
    case "flight": {
      const dist = Math.max(1, fortX - cannonX);
      const flyerX = flyer ? flyer.x : cannonX;
      const progress = clamp01((flyerX - cannonX) / dist);
      const lead = LEAD_FRAC * (visibleW || 0) * clamp01(cam.t / LEAD_RAMP);
      const followX = flyerX + lead;
      const blend = smoothstep(clamp01((progress - FOLLOW_EASE_FROM) / (1 - FOLLOW_EASE_FROM)));
      if (blend > 0) cam.reachedFort = true;
      cam.x = lerp(followX, fortX, blend);
      break;
    }
    case "holdEnd":
      cam.x = fortX;
      if (cam.t >= HIT_HOLD) { cam.mode = "return"; cam.t = 0; }
      break;
    case "missHold":
      cam.x = cam.landingX; // the landing spot, not the fort (spec C7)
      if (cam.t >= MISS_HOLD) { cam.mode = "return"; cam.t = 0; }
      break;
    case "return": {
      const from = cam.reachedFort ? fortX : cam.landingX;
      cam.x = lerp(from, aimX, smoothstep(clamp01(cam.t / RETURN_PAN)));
      if (cam.t >= RETURN_PAN) { cam.mode = "aim"; cam.t = 0; }
      break;
    }
  }
  // Altitude (spec C5): while the flyer is in flight and not too high (y >= -600), it must stay at least
  // 40 CSS px below the top edge; the camera zooms out (down to 0.75x) to hold it there, then zooms back in
  // as it descends. scale = cssH * zoom / WORLD_H mirrors render.js's scaleForHeight at zoom <= 1 (the only
  // range altitude ever asks for), without importing render.js (which already imports CAM_Y from here).
  // Above y = -600, the flyer reads as "too high to track by zooming out any further" - the spec hands that
  // case to a top-edge marker instead (game.js/render.js), so the zoom simply holds at its floor, 0.75x.
  cam.highFlyer = false;
  if (cam.mode === "flight" && flyer && visibleH) {
    if (flyer.y <= ALT_Y) {
      cam.zoom = ALT_MIN_ZOOM;
      cam.highFlyer = true;
    } else if (cam.y - flyer.y > 0) {
      const scaleMax = (visibleH / 2 - ALT_MARGIN) / (cam.y - flyer.y);
      const zoomNeeded = (WORLD_H * scaleMax) / visibleH;
      cam.zoom = Math.max(ALT_MIN_ZOOM, Math.min(1, zoomNeeded));
    }
  }
  return cam;
}
