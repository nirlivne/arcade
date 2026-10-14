// Relative drag anywhere -> { ix, iy } in [-1, 1]. Drag down = pull (iy +1), drag right = roll right
// (ix +1). Touch-down point = neutral; full deflection at `radiusFrac` of the short side. One active
// pointer drives the yoke; keyboard arrows/WASD are an equivalent path. No DeviceOrientation, ever.
export function createInput(el, opts = {}) {
  const radiusFrac = opts.radiusFrac ?? 0.18;
  const isTapArmed = opts.isTapArmed ?? (() => false);
  let ix = 0, iy = 0;
  let dragIx = 0, dragIy = 0;
  let activePointerId = null;
  let originX = 0, originY = 0;
  let pointerDownAt = 0, pointerMoved = false, tapArmedAtDown = false;
  let pendingTap = false; // one pulse per tick, set on a short/still pointerup -- the ending's "tap to continue"
  const keys = { up: false, down: false, left: false, right: false };
  let keyContext = false;
  let pendingDigit = null; // one pulse per tick; DOM keypad taps call pressDigit() the same way

  function shortSide() { return Math.min(el.clientWidth, el.clientHeight); }

  function onPointerDown(e) {
    if (activePointerId !== null) return;
    activePointerId = e.pointerId;
    originX = e.clientX; originY = e.clientY;
    pointerDownAt = performance.now();
    pointerMoved = false;
    // A held yoke from the previous phase (e.g. rollout) must not arm a tap the instant it's released
    // into `ending` -- only a press that *starts* once the ending is already showing counts.
    tapArmedAtDown = isTapArmed();
    el.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e) {
    if (e.pointerId !== activePointerId) return;
    const r = shortSide() * radiusFrac || 1;
    dragIx = clamp((e.clientX - originX) / r, -1, 1);
    dragIy = clamp((e.clientY - originY) / r, -1, 1);
    if (Math.hypot(e.clientX - originX, e.clientY - originY) > 10) pointerMoved = true;
  }
  function onPointerUp(e) {
    if (e.pointerId !== activePointerId) return;
    activePointerId = null;
    dragIx = 0; dragIy = 0;
    // A tap: released quickly, barely moved -- the yoke drag never engaged far enough to matter.
    if (tapArmedAtDown && !pointerMoved && performance.now() - pointerDownAt < 500) pendingTap = true;
  }
  function onKeyDown(e) {
    if (e.key === " " || e.key === "Enter") { keyContext = true; return; }
    if (e.repeat) return;
    if (e.key >= "0" && e.key <= "9") { pendingDigit = Number(e.key); return; }
    if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") keys.up = true;
    else if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") keys.down = true;
    else if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") keys.left = true;
    else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") keys.right = true;
  }
  function onKeyUp(e) {
    if (e.key === " " || e.key === "Enter") { keyContext = false; return; }
    if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") keys.up = false;
    else if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") keys.down = false;
    else if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") keys.left = false;
    else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") keys.right = false;
  }

  el.style.touchAction = "none";
  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerup", onPointerUp);
  el.addEventListener("pointercancel", onPointerUp);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  // A finger held through a swallowed phase becomes the new neutral when the live phase starts.
  function rezero() {
    if (activePointerId !== null) { dragIx = 0; dragIy = 0; }
    ix = 0; iy = 0;
  }

  // A DOM keypad button calls this on tap; consumed (pulsed) by the next tick(), same as a digit key.
  function pressDigit(d) { pendingDigit = d; }

  // Called once per sim step (60 Hz). `button` merges the keyboard context key with a held DOM
  // button, passed in by the caller (hud.isContextHeld()) since that button is outside this element.
  function tick(dt, contextHeld = false) {
    const keyX = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    const keyY = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    if (keyX !== 0 || keyY !== 0) {
      ix = rampToward(ix, keyX, 4, 6, dt);
      iy = rampToward(iy, keyY, 4, 6, dt);
    } else if (activePointerId !== null) {
      ix = dragIx; iy = dragIy;
    } else {
      ix = decay(ix, dt); iy = decay(iy, dt);
    }
    const digit = pendingDigit;
    pendingDigit = null;
    const tap = pendingTap;
    pendingTap = false;
    return { ix, iy, button: keyContext || contextHeld, digit, tap };
  }

  function destroy() {
    el.removeEventListener("pointerdown", onPointerDown);
    el.removeEventListener("pointermove", onPointerMove);
    el.removeEventListener("pointerup", onPointerUp);
    el.removeEventListener("pointercancel", onPointerUp);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
  }

  return { tick, rezero, destroy, pressDigit };
}

function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
// Ramp toward a key target at `onRate` /s, or toward 0 at `offRate` /s when no key is held.
function rampToward(cur, target, onRate, offRate, dt) {
  const rate = target !== 0 ? onRate : offRate;
  const d = target - cur;
  const step = rate * dt;
  if (Math.abs(d) <= step) return target;
  return cur + Math.sign(d) * step;
}
// Release-to-neutral over 0.15 s when nothing drives the yoke.
function decay(v, dt) {
  const rate = 1 / 0.15;
  const step = rate * dt;
  if (Math.abs(v) <= step) return 0;
  return v - Math.sign(v) * step;
}
