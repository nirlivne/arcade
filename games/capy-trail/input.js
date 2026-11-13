// Keyboard + the floating stick / JUMP / DUCK touch controls (spec §5, design -> input.js). Every touch
// pointer is tracked by its own pointerId (Pointer Events): at most 2 concurrent pointers ever get a
// role (stick, jump or duck) -- a third finger is ignored outright, and the first two keep their roles
// (G14d). Gameplay-only: the title-advance / results-restart "any key" paths live in ui/screens.js.
const STICK_RADIUS = 60; // px, half of the 120 px base (design: 120 px base, 58 px knob)
const DEADZONE = 0.3;
const FIRE_AT = 0.5;

export function createInput({ stickZone, stickBase, stickKnob, jumpBtn, duckBtn, onIntent, onPause, onMusic, onSound, onMap }) {
  const roles = new Map(); // pointerId -> "stick" | "jump" | "duck"
  let stickPointerId = null, stickOrigin = null;
  let armedX = true, armedY = true;

  const roleTaken = (role) => { for (const r of roles.values()) if (r === role) return true; return false; };

  function showStick(x, y) {
    stickBase.style.left = `${x}px`; stickBase.style.top = `${y}px`;
    stickKnob.style.left = `${x}px`; stickKnob.style.top = `${y}px`;
    stickBase.hidden = false; stickKnob.hidden = false;
  }
  function moveKnob(x, y) { stickKnob.style.left = `${x}px`; stickKnob.style.top = `${y}px`; }
  function hideStick() { stickBase.hidden = true; stickKnob.hidden = true; }

  function targetIsWithin(el, node) { return node === el || (node && el.contains(node)); }

  function onPointerDown(e) {
    if (roles.size >= 2) return; // G14d: a third finger is ignored outright
    if (targetIsWithin(stickZone, e.target) && !roleTaken("stick")) {
      roles.set(e.pointerId, "stick");
      stickPointerId = e.pointerId; stickOrigin = { x: e.clientX, y: e.clientY };
      armedX = true; armedY = true;
      showStick(e.clientX, e.clientY);
      stickZone.setPointerCapture?.(e.pointerId);
    } else if (targetIsWithin(jumpBtn, e.target) && !roleTaken("jump")) {
      roles.set(e.pointerId, "jump");
      onIntent("jump");
      jumpBtn.setPointerCapture?.(e.pointerId);
    } else if (targetIsWithin(duckBtn, e.target) && !roleTaken("duck")) {
      roles.set(e.pointerId, "duck");
      onIntent("duck");
      duckBtn.setPointerCapture?.(e.pointerId);
    }
  }

  function onPointerMove(e) {
    if (e.pointerId !== stickPointerId || roles.get(e.pointerId) !== "stick") return;
    let dx = e.clientX - stickOrigin.x, dy = e.clientY - stickOrigin.y;
    const dist = Math.hypot(dx, dy);
    if (dist > STICK_RADIUS) { const k = STICK_RADIUS / dist; dx *= k; dy *= k; } // G14c: clamp, keep steering
    moveKnob(stickOrigin.x + dx, stickOrigin.y + dy);
    const nx = dx / STICK_RADIUS, ny = dy / STICK_RADIUS, absX = Math.abs(nx), absY = Math.abs(ny);
    if (absX < DEADZONE) armedX = true;
    if (absY < DEADZONE) armedY = true;
    if (absX >= absY) { // the dominant axis wins on a diagonal
      if (armedX && absX >= FIRE_AT) { onIntent(nx < 0 ? "left" : "right"); armedX = false; }
    } else if (armedY && absY >= FIRE_AT) {
      onIntent(ny > 0 ? "duck" : "jump"); armedY = false;
    }
  }

  function endPointer(e) {
    const role = roles.get(e.pointerId);
    if (!role) return;
    roles.delete(e.pointerId);
    if (role === "stick" && e.pointerId === stickPointerId) {
      stickPointerId = null; stickOrigin = null; armedX = true; armedY = true;
      hideStick(); // G14b: steering zeroes in the same frame as release
    }
  }

  function onKeyDown(e) {
    if (e.repeat) return;
    const k = e.key;
    if (k === "a" || k === "A" || k === "ArrowLeft") onIntent("left");
    else if (k === "d" || k === "D" || k === "ArrowRight") onIntent("right");
    else if (k === "w" || k === "W" || k === "ArrowUp" || k === " ") onIntent("jump");
    else if (k === "s" || k === "S" || k === "ArrowDown") onIntent("duck");
    else if (k === "Escape" || k === "p" || k === "P") onPause?.();
    else if (k === "m" || k === "M") onMusic?.();
    else if (k === "n" || k === "N") onSound?.();
    // THE-1375: a secret debug map, main-row 0 or Numpad 0 (e.code so it fires regardless of Num Lock)
    else if (k === "0" || e.code === "Numpad0") onMap?.();
  }

  stickZone.addEventListener("pointerdown", onPointerDown);
  jumpBtn.addEventListener("pointerdown", onPointerDown);
  duckBtn.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", endPointer);
  window.addEventListener("pointercancel", endPointer);
  window.addEventListener("keydown", onKeyDown);

  function reset() { // G14f: pause clears held keys and pointers
    roles.clear(); stickPointerId = null; stickOrigin = null; armedX = true; armedY = true; hideStick();
  }

  function destroy() {
    stickZone.removeEventListener("pointerdown", onPointerDown);
    jumpBtn.removeEventListener("pointerdown", onPointerDown);
    duckBtn.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", endPointer);
    window.removeEventListener("pointercancel", endPointer);
    window.removeEventListener("keydown", onKeyDown);
  }

  return { reset, destroy };
}
