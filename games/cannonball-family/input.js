// Pointer input (THE-449 S1; spec §2 and §5). A pull starts anywhere in the play area and the shot fires on
// release. pointercancel, a lost capture, window blur and tab-away all cancel a pull; the release then fires nothing.
// Points are CSS px relative to el.
export function bindPull(el, handlers) {
  let active = null, start = null;
  const local = (e) => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  el.addEventListener("pointerdown", (e) => {
    // A real button sitting inside the play area (the pause icon in the HUD) must still work as a button: once
    // el.setPointerCapture below fires, every later pointer event on this gesture — including the click a real
    // tap produces — is redirected to el itself, so the button's own click listener never sees it. Letting the
    // pull start under a button is also just wrong: a tap on Pause was never meant to aim.
    if (active !== null || e.button > 0 || !handlers.canPull() || e.target.closest("button, a, input, select, textarea")) return;
    active = e.pointerId;
    start = local(e);
    el.setPointerCapture(e.pointerId);
    handlers.onStart(start);
  });
  el.addEventListener("pointermove", (e) => {
    if (e.pointerId === active) handlers.onMove(local(e));
  });
  el.addEventListener("pointerup", (e) => {
    if (e.pointerId !== active) return;
    active = null;
    handlers.onRelease(start, local(e));
  });
  const cancel = () => {
    if (active === null) return;
    active = null;
    handlers.onCancel();
  };
  el.addEventListener("pointercancel", cancel);
  el.addEventListener("lostpointercapture", cancel);
  window.addEventListener("blur", cancel);
  document.addEventListener("visibilitychange", () => { if (document.hidden) cancel(); });
}
