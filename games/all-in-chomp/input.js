// Arrows + WASD, and the floating stick: touch anywhere, a stick appears under the finger, and while it
// stays down the dominant axis of the offset is sent (only when it changes). Thin; covered by the
// real-pointer tests (tools/all-in-chomp-stick-realpointer.test.mjs), not unit tests (DOM-dependent).
const KEY_DIR = {
  ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
  w: "up", s: "down", a: "left", d: "right",
  W: "up", S: "down", A: "left", D: "right",
};

export function attachKeyboard(target, onDir) {
  function handler(e) {
    const dir = KEY_DIR[e.key];
    if (dir) {
      onDir(dir);
      e.preventDefault();
    }
  }
  target.addEventListener("keydown", handler);
  return () => target.removeEventListener("keydown", handler);
}

export const STICK_DEAD_ZONE = 10; // px of offset before a direction is read
export const STICK_RADIUS = 36; // px: the knob is clamped to the base ring

// Pointer-downs on these never start a stick: buttons keep their clicks, sheets and screens their own taps.
const STICK_IGNORE = "button, .aic-scrim, .aic-screen, .aic-hint, .aic-turn";

// root: the app root (so a thumb resting in a HUD gutter steers too). onDir(dir): called when the dominant
// axis changes within a gesture. view: { show(x, y), move(dx, dy), hide() } draws the stick (DOM, game.js).
// Mouse and pen take the same path. Ties between the axes go to the horizontal one.
export function attachStick(root, onDir, view) {
  let id = null, ox = 0, oy = 0, last = null;

  function onDown(e) {
    if (id !== null) return;
    if (e.target instanceof Element && e.target.closest(STICK_IGNORE)) return;
    id = e.pointerId;
    ox = e.clientX;
    oy = e.clientY;
    last = null;
    try {
      root.setPointerCapture(id);
    } catch {
      /* synthetic events have no pointer to capture */
    }
    view.show(ox, oy);
  }
  function onMove(e) {
    if (e.pointerId !== id) return;
    const dx = e.clientX - ox, dy = e.clientY - oy;
    const len = Math.hypot(dx, dy);
    const k = len > STICK_RADIUS ? STICK_RADIUS / len : 1;
    view.move(dx * k, dy * k);
    if (len < STICK_DEAD_ZONE) return;
    const dir = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
    if (dir !== last) {
      last = dir;
      onDir(dir);
    }
  }
  function onUp(e) {
    if (e.pointerId !== id) return;
    id = null;
    last = null;
    view.hide();
  }

  root.addEventListener("pointerdown", onDown);
  root.addEventListener("pointermove", onMove);
  root.addEventListener("pointerup", onUp);
  root.addEventListener("pointercancel", onUp);
  return () => {
    root.removeEventListener("pointerdown", onDown);
    root.removeEventListener("pointermove", onMove);
    root.removeEventListener("pointerup", onUp);
    root.removeEventListener("pointercancel", onUp);
  };
}
