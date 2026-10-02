// Captain Fold input.js: pointer + keys -> ledge pull-and-release, hold-anywhere in flight (THE-260 design).
// Knows no game rules - it only reports gestures to the handlers game.js gives it, and asks game.js which mode
// ("ledge" or "flight") to interpret them in, since a drag means something different in each. Hold-anywhere:
// listeners go on the whole play surface (`stage`), not just the plane, per spec S2. Pointer capture keeps a
// drag tracked even if the finger leaves the element; `pointercancel`, `blur` and a mode switch all release.
//
// handlers: { pullStart(x, y), pullMove(dx), pullEnd(pullPx | null), hold(bool) }
// `pullEnd(null)` means the pull was released under the minimum (spec: springs back, nothing counted).
export function attachInput(stage, handlers, getMode) {
  let pull = null; // { pointerId, x0, y0 }
  let held = false;
  const activeHoldPointers = new Set(); // CTO review B1: lifting one of two fingers must not drop the hold

  function setHeld(next) {
    if (held === next) return;
    held = next;
    handlers.hold(held);
  }

  function isHudTarget(e) {
    return !!(e.target && e.target.closest && e.target.closest("[data-hud-control]"));
  }

  function onPointerDown(e) {
    if (isHudTarget(e)) return; // a press on the pause tab or other HUD control is never a hold/pull (spec S2)
    if (getMode() === "flight") {
      activeHoldPointers.add(e.pointerId);
      try { stage.setPointerCapture?.(e.pointerId); } catch { /* a pointer the browser no longer considers active: keep tracking it by id anyway */ }
      setHeld(true);
      return;
    }
    if (getMode() !== "ledge" || pull) return;
    pull = { pointerId: e.pointerId, x0: e.clientX, y0: e.clientY };
    try { stage.setPointerCapture?.(e.pointerId); } catch { /* a pointer the browser no longer considers active: keep tracking it by id anyway */ }
    handlers.pullStart(e.clientX, e.clientY);
  }

  function onPointerMove(e) {
    if (pull && e.pointerId === pull.pointerId) {
      handlers.pullMove(pull.x0 - e.clientX, e.clientY - pull.y0); // dx: how far back (right-to-left) it's pulled
    }
  }

  function endPull(e, cancelled) {
    if (!pull || e.pointerId !== pull.pointerId) return;
    const dx = pull.x0 - e.clientX;
    pull = null;
    // THE-301: a pointercancel (browser takes the gesture as a pan) carries clientX 0, not the real release
    // point - reading dx from it would always read as a full-power pull. Treat any cancel as a cancelled pull
    // (springs back, nothing counted), same as a release under the minimum.
    handlers.pullEnd(cancelled ? null : dx > 0 ? dx : null);
  }

  // CTO review B1: this used to branch on getMode() === "flight" to decide whether a pointerup/cancel should
  // release the hold - but the flight has usually already ended (mode reads "none") by the time the finger
  // actually lifts, so the release branch never ran and `held` (here and in game.js's own copy) stayed true
  // forever, into the NEXT throw too. Releasing unconditionally, in every mode, is correct: a hold flag means
  // nothing outside flight mode anyway, and this is the only path that reliably clears it.
  function endHold(e) {
    activeHoldPointers.delete(e.pointerId);
    if (activeHoldPointers.size === 0) setHeld(false);
  }

  function onPointerUp(e) {
    endHold(e);
    endPull(e, false);
  }

  function onPointerCancel(e) {
    endHold(e);
    endPull(e, true);
  }

  function onKeyDown(e) {
    if (e.repeat) return;
    if (e.code === "Space" || e.code === "ArrowUp") {
      e.preventDefault();
      if (getMode() === "flight") setHeld(true);
    }
  }

  function onKeyUp(e) {
    if (e.code === "Space" || e.code === "ArrowUp") setHeld(false);
  }

  // Losing focus/visibility must never leave a hold latched (spec S2: no stuck hold after a tab-away).
  function releaseAll() {
    pull = null;
    activeHoldPointers.clear();
    setHeld(false);
  }

  stage.addEventListener("pointerdown", onPointerDown);
  stage.addEventListener("pointermove", onPointerMove);
  stage.addEventListener("pointerup", onPointerUp);
  stage.addEventListener("pointercancel", onPointerCancel);
  stage.addEventListener("lostpointercapture", onPointerCancel);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", releaseAll);
  document.addEventListener("visibilitychange", () => { if (document.hidden) releaseAll(); });

  return {
    releaseAll,
    isHeld: () => held,
    detach() {
      stage.removeEventListener("pointerdown", onPointerDown);
      stage.removeEventListener("pointermove", onPointerMove);
      stage.removeEventListener("pointerup", onPointerUp);
      stage.removeEventListener("pointercancel", onPointerCancel);
      stage.removeEventListener("lostpointercapture", onPointerCancel);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", releaseAll);
    },
  };
}
