// THE-1372 (board 2026-11-07: "I can't read the green toast mid-run"): a short coaching label anchored to
// the hero's head in screen space, replacing the UIKit menu toast during a run. One reused DOM element, no
// per-frame allocation -- step() just repositions it from the caller's current head-screen point.
const POP_IN = 0.15, HOLD = 0.85, FADE_OUT = 0.2; // ~1.2 s total, matching the old toast's on-screen time
const LIFT_PX = 54; // placed above the head, never over the lane ahead (which renders below/around it)
const MARGIN_PX = 12; // keeps the pill inside the safe area at the viewport edges

export function createInRunLabel(el) {
  let timer = 0, duration = 0, reduceMotion = false, active = false;

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function position(pt) {
    if (!pt) return;
    const w = window.innerWidth, h = window.innerHeight;
    const x = clamp(pt.x, MARGIN_PX, w - MARGIN_PX);
    const y = clamp(pt.y - LIFT_PX, MARGIN_PX, h - MARGIN_PX);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }

  // THE-1412: a level's own hint (levels/README.md: "shows ... for 2.5 s") needs longer on screen than
  // every other coaching label's ~1.2 s total -- an optional 3rd arg overrides the total duration (still
  // including the same pop-in/fade-out), defaulting to the original POP_IN+HOLD+FADE_OUT so every
  // existing caller is unaffected.
  function show(text, headScreen, totalS = POP_IN + HOLD + FADE_OUT) {
    el.textContent = text;
    el.hidden = false;
    reduceMotion = window.UIKit?.reduceMotion?.() ?? false;
    // CTO review (THE-1374): style.css animates .uk-pop (the kit's own pop), so that's the class to set;
    // remove + reflow first so a second label in a row pops again instead of keeping the finished animation
    // THE-1408: clear is-mission here so a later coaching label never keeps it; game.js re-adds it.
    el.classList.remove("uk-pop", "is-fading", "is-mission");
    void el.offsetWidth;
    el.classList.toggle("uk-pop", !reduceMotion);
    timer = 0;
    duration = totalS;
    active = true;
    position(headScreen);
  }

  // Called once per rendered frame while a label is live, so it tracks the hero as it moves/sways.
  function step(dt, headScreen) {
    if (!active) return;
    timer += dt;
    position(headScreen);
    if (!reduceMotion && timer >= duration - FADE_OUT) el.classList.add("is-fading");
    if (timer >= duration) hide();
  }

  function hide() {
    active = false;
    el.hidden = true;
    el.classList.remove("is-fading", "uk-pop");
  }

  return { show, step, hide, get active() { return active; } };
}
