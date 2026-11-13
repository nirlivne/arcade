// Timer ring for the active timed power-up (spec Part 1), anchored next to the hero's head every frame
// from render/scene.js's heroHeadScreen() -- same technique as ui/in-run-label.js. Shrinks as the caller's
// `frac` (remaining time / the kind's own duration) counts down to 0; hidden whenever no power is active.
const R = 15; // matches the shared svg viewBox (index.html)
const CIRC = 2 * Math.PI * R;

export function createPowerupRing(el, fillEl) {
  fillEl.style.strokeDasharray = `${CIRC}`;

  // THE-1391 (spec Part 1 "Ring + aura"): "the timer ring uses --pu-shield colour while the shield is on,
  // and --pu-honey for honey (ring colour per kind from the tokens)" -- `kind` names the token directly
  // (tokens.css --pu-<kind>), so a slice turning on a new kind needs no change here.
  function step(headScreen, frac, kind) {
    const on = frac !== null && !!headScreen;
    el.hidden = !on;
    if (!on) return;
    el.style.left = `${headScreen.x}px`;
    el.style.top = `${headScreen.y}px`;
    fillEl.style.strokeDashoffset = `${CIRC * (1 - Math.max(0, Math.min(1, frac)))}`;
    fillEl.style.stroke = kind ? `var(--pu-${kind})` : "";
  }
  function hide() { el.hidden = true; }
  return { step, hide };
}
