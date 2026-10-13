// Arrows + WASD, and swipe anywhere on the play surface. Thin; covered by real-pointer tests, not unit
// tests (DOM-dependent).
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

// Fires once per gesture, on the dominant axis, once the pointer has travelled max(16px, 4% of the
// element's short side). Re-armed on the next pointerdown.
export function attachSwipe(el, onDir) {
  let startX = 0, startY = 0, active = false, fired = false;

  function threshold() {
    const r = el.getBoundingClientRect();
    return Math.max(16, 0.04 * Math.min(r.width, r.height));
  }

  function onDown(e) {
    startX = e.clientX;
    startY = e.clientY;
    active = true;
    fired = false;
  }
  function onMove(e) {
    if (!active || fired) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    const t = threshold();
    if (Math.abs(dx) < t && Math.abs(dy) < t) return;
    fired = true;
    onDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up");
  }
  function onUp() {
    active = false;
  }

  el.style.touchAction = "none";
  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onUp);
  return () => {
    el.removeEventListener("pointerdown", onDown);
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", onUp);
    el.removeEventListener("pointercancel", onUp);
  };
}
