// Loop Break input.js: pointer + keyboard -> ring/notch intents. Knows no rules (design.md): it only calls
// the handlers game.js gives it. Per DESIGN.md §2/§5 addendum 3: pointer listeners go on `.lb-stage`, not
// the canvas (`.lb-medallion` has `pointer-events: none` and bleeds 15% past the stage for the contact
// shadow) -- R = the stage's CSS width / 2, centred on the stage's own box. A drag is quantized into
// whole-notch `turn` calls one at a time (so future per-detent sound/animation hooks have a single call per
// crossing), converting the continuous pointer angle into an unwrapped running total so a fast multi-notch
// drag still lands on the right ring position. Deviation from the design sketch's `dragTo(angle)`: kept
// here rather than in level.js, so the rules core stays pure/angle-free -- flagged on THE-232.
import { geometry } from "./render.js";
import { NOTCHES } from "./core.js";

function pointFromEvent(stage, e) {
  const rect = stage.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top, R: rect.width / 2 };
}

function hitRing(geo, dx, dy) {
  const r = Math.hypot(dx, dy);
  for (let i = 0; i < geo.rings.length; i++) {
    if (r <= geo.rings[i].r1 && r >= geo.rings[i].r0) return i;
  }
  return null;
}

function angleNotch(dx, dy) {
  let a = Math.atan2(dx, -dy);
  if (a < 0) a += 2 * Math.PI;
  return (a / (2 * Math.PI)) * NOTCHES;
}

// handlers: { onBeginDrag(ring), onTurn(ring, d), onDragMove(ring, frac), onEndDrag(ring, frac), onTakeBack(),
// onRestart(), onPause() }. `frac` is the not-yet-applied remainder of the continuous drag, in notches (-0.5..0.5-ish):
// `drag.total` is the raw unwrapped continuous position, `drag.applied` is how many whole notches turn()
// has already been called for, so `frac = total - applied` is exactly the live offset still to resolve --
// what the designer's feel check called for (draw the gripped ring, and its cascade, at the live finger
// angle, snapping to the nearest notch only on release).
export function attachInput(stage, handlers) {
  let level = null;
  let drag = null; // { pointerId, ring, lastRaw, total, applied }
  let selectedRing = 0;

  function setLevel(nextLevel) {
    level = nextLevel;
    selectedRing = 0;
  }

  function onPointerDown(e) {
    if (!level || drag) return;
    const p = pointFromEvent(stage, e);
    const geo = geometry(level, p.R);
    const dx = p.x - p.R, dy = p.y - p.R;
    const ring = hitRing(geo, dx, dy);
    if (ring == null) return;
    stage.setPointerCapture(e.pointerId);
    const raw = angleNotch(dx, dy);
    drag = { pointerId: e.pointerId, ring, lastRaw: raw, total: 0, applied: 0 };
    selectedRing = ring;
    handlers.onBeginDrag(ring);
  }

  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const p = pointFromEvent(stage, e);
    const raw = angleNotch(p.x - p.R, p.y - p.R);
    let d = raw - drag.lastRaw;
    if (d > NOTCHES / 2) d -= NOTCHES;
    if (d < -NOTCHES / 2) d += NOTCHES;
    drag.total += d;
    drag.lastRaw = raw;
    const target = Math.round(drag.total);
    while (drag.applied < target) { handlers.onTurn(drag.ring, 1); drag.applied++; }
    while (drag.applied > target) { handlers.onTurn(drag.ring, -1); drag.applied--; }
    if (handlers.onDragMove) handlers.onDragMove(drag.ring, drag.total - drag.applied);
  }

  function endDrag(e) {
    if (!drag || (e && e.pointerId !== drag.pointerId)) return;
    const ring = drag.ring;
    const frac = drag.total - drag.applied;
    drag = null;
    handlers.onEndDrag(ring, frac);
  }

  function onKeyDown(e) {
    if (drag) return; // keys ignored while a pointer drags (spec §2)
    if (e.key >= "1" && e.key <= "6") {
      const ring = Number(e.key) - 1;
      if (level && ring < level.n) selectedRing = ring;
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      if (!level) return;
      const d = e.key === "ArrowRight" ? 1 : -1;
      handlers.onBeginDrag(selectedRing);
      handlers.onTurn(selectedRing, d);
      handlers.onEndDrag(selectedRing, 0);
      e.preventDefault();
    } else if (e.key === "z" || e.key === "Z") {
      handlers.onTakeBack();
    } else if (e.key === "r" || e.key === "R") {
      handlers.onRestart();
    } else if (e.key === "Escape") {
      handlers.onPause();
    }
  }

  // A crown drag: one notch per 28 px of horizontal movement (spec §5), offered as an alternative to the
  // ring band for small inner rings / accessibility.
  function attachCrown(el, ring) {
    let cdrag = null;
    el.addEventListener("pointerdown", (e) => {
      if (drag) return;
      el.setPointerCapture(e.pointerId);
      cdrag = { pointerId: e.pointerId, startX: e.clientX, applied: 0 };
      handlers.onBeginDrag(ring);
    });
    el.addEventListener("pointermove", (e) => {
      if (!cdrag || e.pointerId !== cdrag.pointerId) return;
      const continuous = (e.clientX - cdrag.startX) / 28;
      const target = Math.round(continuous);
      while (cdrag.applied < target) { handlers.onTurn(ring, 1); cdrag.applied++; }
      while (cdrag.applied > target) { handlers.onTurn(ring, -1); cdrag.applied--; }
      if (handlers.onDragMove) handlers.onDragMove(ring, continuous - cdrag.applied);
    });
    const release = (e) => {
      if (!cdrag || (e && e.pointerId !== cdrag.pointerId)) return;
      const frac = ((e && e.clientX != null ? e.clientX : cdrag.startX) - cdrag.startX) / 28 - cdrag.applied;
      cdrag = null;
      handlers.onEndDrag(ring, frac);
    };
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
  }

  stage.addEventListener("pointerdown", onPointerDown);
  stage.addEventListener("pointermove", onPointerMove);
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);
  window.addEventListener("blur", () => endDrag());
  document.addEventListener("keydown", onKeyDown);

  return {
    setLevel,
    attachCrown,
    getSelectedRing: () => selectedRing,
    destroy() {
      stage.removeEventListener("pointerdown", onPointerDown);
      stage.removeEventListener("pointermove", onPointerMove);
      stage.removeEventListener("pointerup", endDrag);
      stage.removeEventListener("pointercancel", endDrag);
      document.removeEventListener("keydown", onKeyDown);
    },
  };
}
