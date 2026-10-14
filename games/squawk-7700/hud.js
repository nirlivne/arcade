// In-beat DOM HUD: the skin's instrument layer (THE-734 skin.css/tokens.css) over the 3D canvas.
// Instruments stay dir="ltr" with Latin digits (never mirrored); Hebrew labels come from theme.js.
import { createSeg, createTape, createGmeter, createLocScale, ghost, GLYPH } from "./hud-widgets.js";

const VMO = 340, VD = 440;

// Comma-grouped altitude readout (e.g. 3,200) without `toLocaleString`'s Intl overhead -- called on
// every visible tick label and the readout every rAF of the dive/landing (THE-760: this showed up as
// the single largest per-frame JS cost once THE-759's HUD-rebuild fix removed the bigger one). Values
// here are always non-negative integers in the thousands, so a manual grouping is exact.
function fmtAlt(v) {
  const s = String(Math.round(v));
  return s.length > 3 ? s.slice(0, s.length - 3) + "," + s.slice(-3) : s;
}

// `root` is #hud (.sq-hud, zoomed by --sq-scale): instruments only. `overlay` is a plain sibling of
// #hud (NOT .sq-hud) for the prompt/callout, which carry their own `zoom: var(--sq-scale)` in skin.css
// -- nesting them inside .sq-hud would double-apply the zoom (two zoomed ancestors compound: 1.4x1.4
// at desktop scale), overflowing the prompt text off both edges of the screen. Matches
// design/squawk-7700/screens.html, where .sq-prompt is always a sibling of .sq-hud, never its child.
export function createHud(root, overlay, fxRoot, theme, onDigit) {
  root.innerHTML = `
    <div class="sq-xpdr" id="sq-xpdr" data-ring="off"><div class="sq-xpdr__glass"><span class="sq-label">XPDR</span><span id="sq-xpdr-digits"></span></div></div>
    <div class="sq-status"><span class="sq-clock" id="sq-clock" dir="ltr">0:00</span><span class="sq-fails" id="sq-fails" aria-label="3 ניסיונות"></span><span class="sq-label">ניסיונות</span><span class="sq-bumps" id="sq-bumps"><b>0</b>טלטלות</span></div>
    <div class="sq-beats" id="sq-beats"></div>
    <div class="sq-mw is-off" id="sq-mw" role="status" aria-live="polite" aria-label="MASTER WARNING">MASTER<br>WARNING</div>
    <button class="sq-key sq-pause" id="sq-pause" aria-label="השהיה">${GLYPH.pause}</button>
    <div class="sq-souls"><b id="sq-souls-n"></b><span>על הסיפון</span></div>
    <div class="sq-tape sq-tape--spd" id="sq-tape-spd" style="display:none"></div>
    <div class="sq-tape sq-tape--alt" id="sq-tape-alt" style="display:none"></div>
    <div class="sq-gm" id="sq-gm" style="display:none"></div>
    <div class="sq-ra" id="sq-ra" style="display:none"><span class="sq-label">RA</span><b id="sq-ra-val">0</b></div>
    <div class="sq-loc" id="sq-loc" style="display:none"></div>
    <div class="sq-dist" id="sq-dist" style="display:none"><span class="sq-label" id="sq-dist-label">0 M</span><div class="sq-dist__bar"><i id="sq-dist-fill"></i><b id="sq-dist-dot"></b></div>${GLYPH.door}</div>
    <button class="sq-ctx" id="sq-context" data-state="off" style="display:none"><span class="sq-ctx__en" id="sq-ctx-en"></span><span class="sq-ctx__he" id="sq-ctx-he"></span></button>
    <div class="sq-keypad sq-panel" id="sq-keypad" style="display:none">
      <div class="sq-keypad__read sq-glass"><span class="sq-label">CODE</span><span id="sq-keypad-digits"></span></div>
      <div class="sq-keypad__keys" id="sq-keypad-keys"></div>
    </div>
    <div class="sq-lock" id="sq-lock" style="display:none">
      <div class="sq-lock__head"><span>נעילת הדלת</span><span class="sq-label" id="sq-lock-pct">LOCK 0%</span></div>
      <div class="sq-lock__bar"><i id="sq-lock-fill"></i></div>
    </div>
  `;
  overlay.innerHTML = `
    <div class="sq-prompt" id="sq-prompt"><div class="sq-prompt__big" id="sq-prompt-big"></div><div class="sq-prompt__hint" id="sq-prompt-hint"></div></div>
    <div class="sq-callout" id="sq-callout" style="opacity:0"><div class="sq-callout__num" id="sq-callout-num"></div><div class="sq-callout__word" id="sq-callout-word"></div></div>
    <div class="sq-ghost" id="sq-ghost" style="display:none"></div>
    <div class="sq-ghost" id="sq-squawk-nudge" style="display:none; position:absolute; bottom:14px; left:calc(var(--sq-edge) + var(--sq-tape-w) + 14px); width:64px; height:64px;"></div>
  `;
  fxRoot.innerHTML = `
    <div class="sq-vig sq-vig--grey" id="sq-vig-grey"></div>
    <div class="sq-vig sq-vig--red" id="sq-vig-red"></div>
    <div class="sq-caution" id="sq-caution"></div>
    <div class="sq-flare" id="sq-flare" style="opacity:0"></div>
    <div class="sq-flash" id="sq-flash"></div>
    <div class="sq-rewind" id="sq-rewind" style="display:none"></div>
  `;

  root.querySelector("#sq-souls-n").textContent = String(theme.SOULS);

  const el = {
    xpdr: root.querySelector("#sq-xpdr"),
    xpdrDigits: root.querySelector("#sq-xpdr-digits"),
    clock: root.querySelector("#sq-clock"),
    fails: root.querySelector("#sq-fails"),
    bumps: root.querySelector("#sq-bumps"),
    bumpsVal: root.querySelector("#sq-bumps b"),
    beats: root.querySelector("#sq-beats"),
    mw: root.querySelector("#sq-mw"),
    pause: root.querySelector("#sq-pause"),
    tapeSpd: root.querySelector("#sq-tape-spd"),
    tapeAlt: root.querySelector("#sq-tape-alt"),
    gm: root.querySelector("#sq-gm"),
    ra: root.querySelector("#sq-ra"),
    raVal: root.querySelector("#sq-ra-val"),
    loc: root.querySelector("#sq-loc"),
    dist: root.querySelector("#sq-dist"),
    distLabel: root.querySelector("#sq-dist-label"),
    distFill: root.querySelector("#sq-dist-fill"),
    distDot: root.querySelector("#sq-dist-dot"),
    context: root.querySelector("#sq-context"),
    ctxEn: root.querySelector("#sq-ctx-en"),
    ctxHe: root.querySelector("#sq-ctx-he"),
    keypad: root.querySelector("#sq-keypad"),
    keypadDigits: root.querySelector("#sq-keypad-digits"),
    keypadKeys: root.querySelector("#sq-keypad-keys"),
    lock: root.querySelector("#sq-lock"),
    lockPct: root.querySelector("#sq-lock-pct"),
    lockFill: root.querySelector("#sq-lock-fill"),
    prompt: overlay.querySelector("#sq-prompt"),
    promptBig: overlay.querySelector("#sq-prompt-big"),
    promptHint: overlay.querySelector("#sq-prompt-hint"),
    callout: overlay.querySelector("#sq-callout"),
    calloutNum: overlay.querySelector("#sq-callout-num"),
    calloutWord: overlay.querySelector("#sq-callout-word"),
    ghost: overlay.querySelector("#sq-ghost"),
    squawkNudge: overlay.querySelector("#sq-squawk-nudge"),
    vigGrey: fxRoot.querySelector("#sq-vig-grey"),
    vigRed: fxRoot.querySelector("#sq-vig-red"),
    caution: fxRoot.querySelector("#sq-caution"),
    flare: fxRoot.querySelector("#sq-flare"),
    flash: fxRoot.querySelector("#sq-flash"),
    rewind: fxRoot.querySelector("#sq-rewind"),
  };

  // Stateful widgets (THE-759): built once, then mutated in place on update instead of reassigning a
  // fresh SVG string into innerHTML every rAF.
  const xpdrSeg = createSeg(el.xpdrDigits);
  const keypadSeg = createSeg(el.keypadDigits);
  const tapeSpdW = createTape({ span: 120, step: 10, major: 20, vmo: VMO, vd: VD, unit: "KT", id: "spd" });
  const tapeAltW = createTape({ span: 4000, step: 200, major: 1000, side: "r", unit: "FT", fs: 11, rs: 15, fmt: fmtAlt, id: "alt" });
  el.tapeSpd.appendChild(tapeSpdW.el);
  el.tapeAlt.appendChild(tapeAltW.el);
  const gmeterW = createGmeter();
  el.gm.appendChild(gmeterW.el);
  const locScaleW = createLocScale();
  el.loc.appendChild(locScaleW.el);

  el.fails.innerHTML = [0, 1, 2].map(() => `<i></i>`).join("");
  const failsChildren = Array.from(el.fails.children);
  el.keypadKeys.innerHTML = [1, 2, 3, 4, 5, 6, 7, 8, 9, "", 0, ""]
    .map((d) => (d === "" ? `<div></div>` : `<button data-digit="${d}">${d}</button>`))
    .join("");
  el.keypadKeys.addEventListener("pointerdown", (e) => {
    const key = e.target.closest("button[data-digit]");
    if (key && onDigit) { e.preventDefault(); onDigit(Number(key.dataset.digit)); }
  });

  // D1-4 (sign-off r2): the context button hides under the cursor the instant the door locks, so a
  // mouse `pointerup` lands on whatever is now under the pointer instead of this button, and
  // `contextDown` never clears -- FLARE never gets its release edge, a mouse player can't land.
  // `setPointerCapture` routes the up/cancel back to this element regardless of what's under the
  // cursor by then; the window listeners below are the backstop for cases capture can't cover
  // (blur, or the button disappearing/changing action out from under a still-down pointer).
  // Only the pointer that pressed the button releases it: on touch, lifting a second finger (e.g. off
  // the yoke) must not end a SQUAWK hold (THE-768).
  let contextDown = false, contextPointer = null;
  el.context.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    contextDown = true;
    contextPointer = e.pointerId;
    try { el.context.setPointerCapture(e.pointerId); } catch (err) { /* capture is best-effort */ }
  });
  const releaseContext = (e) => { if (e.pointerId === contextPointer) contextDown = false; };
  el.context.addEventListener("pointerup", releaseContext);
  el.context.addEventListener("pointercancel", releaseContext);
  window.addEventListener("pointerup", releaseContext);
  window.addEventListener("pointercancel", releaseContext);
  window.addEventListener("blur", () => { contextDown = false; });
  function isContextHeld() { return contextDown; }

  let pauseRequested = false;
  el.pause.addEventListener("click", () => { pauseRequested = true; });
  function consumePauseRequest() { const v = pauseRequested; pauseRequested = false; return v; }

  function setXpdr(code, ring) {
    xpdrSeg.update(code);
    el.xpdr.dataset.ring = ring;
  }

  let lastContextLabel = null;
  function setContext(labelEn, labelHe, state) {
    if (!labelEn) {
      el.context.style.display = "none";
      lastContextLabel = null;
      contextDown = false;
      return;
    }
    if (labelEn !== lastContextLabel) { lastContextLabel = labelEn; contextDown = false; }
    el.context.style.display = "grid";
    el.context.dataset.state = state || "off";
    el.ctxEn.textContent = labelEn;
    el.ctxHe.textContent = labelHe || "";
  }

  function setKeypad(visible, entered) {
    el.keypad.style.display = visible ? "block" : "none";
    if (visible) keypadSeg.update((entered || []).join("").padEnd(4, " "));
  }

  function setLock(visible, frac, half) {
    el.lock.style.display = visible ? "grid" : "none";
    if (!visible) return;
    el.lockFill.parentElement.parentElement.classList.toggle("is-half", !!half);
    el.lockPct.textContent = `LOCK ${Math.round((frac || 0) * 100)}%`;
    el.lockFill.style.setProperty("--p", String(frac || 0));
  }

  function setDist(visible, metersLeft, frac) {
    el.dist.style.display = visible ? "flex" : "none";
    if (!visible) return;
    el.distLabel.textContent = `${Math.round(metersLeft)} M`;
    el.distFill.parentElement.style.setProperty("--p", String(frac));
  }

  let lastBeatIdx = -1;
  function update(run) {
    const f = run.beat && run.beat.flight;
    const showTapes = !!f;
    el.tapeSpd.style.display = showTapes ? "block" : "none";
    el.tapeAlt.style.display = showTapes ? "block" : "none";
    if (f) {
      el.tapeSpd.classList.toggle("is-over", f.v > VMO);
      tapeSpdW.update(f.v);
      tapeAltW.update(f.alt);
    }
    const s = Math.floor(run.clockSteps / 60);
    el.clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    failsChildren.forEach((i, idx) => i.classList.toggle("is-used", idx < run.fails));
    const bumps = Object.values(run.beatResults || {}).reduce((n, r) => n + (r.bumps || 0), 0) + (run.beat ? run.beat.bumps || 0 : 0);
    el.bumpsVal.textContent = String(bumps);
    // Clamped to 4 (D2-6): once the last beat clears, run.beatIndex advances to 4 for the ending cut,
    // which used to read as "5/4". Only rebuilt on change (THE-759): this rebuilt every frame of every
    // beat before, for a value that in practice changes a handful of times per run.
    const beatIdx = Math.min(4, run.beatIndex + 1);
    if (beatIdx !== lastBeatIdx) {
      lastBeatIdx = beatIdx;
      el.beats.innerHTML = [1, 2, 3, 4].map((i) => `<i class="${i < beatIdx ? "is-done" : i === beatIdx ? "is-now" : ""}"></i>`).join("") + `<span>${beatIdx}/4</span>`;
    }
  }

  function setMasterWarning(on, flashing) {
    el.mw.classList.toggle("is-off", !on);
    el.mw.classList.toggle("is-flash", !!flashing);
  }

  function setPrompt(big, hint) {
    el.promptBig.textContent = big || "";
    el.promptHint.textContent = hint || "";
    el.prompt.style.display = big || hint ? "block" : "none";
  }

  function setPromptClass(cls) {
    el.prompt.className = "sq-prompt" + (cls ? " " + cls : "");
  }

  function setVignette(strength) { el.vigGrey.style.setProperty("--v", String(Math.max(0, Math.min(1, strength)))); }
  function setRedVignette(strength) { el.vigRed.style.setProperty("--v", String(Math.max(0, Math.min(1, strength)))); }

  let cautionClock = 0;
  function tickCaution(dt, on) {
    if (!on) { cautionClock = 0; el.caution.classList.remove("is-on"); return; }
    el.caution.classList.add("is-on");
  }

  function setSunFlare(flare) {
    if (!flare || !flare.visible) { el.flare.style.opacity = "0"; return; }
    el.flare.style.setProperty("--x", `${flare.x * 100}%`);
    el.flare.style.setProperty("--y", `${flare.y * 100}%`);
    el.flare.style.opacity = "1";
  }

  function setGmeter(g) {
    el.gm.style.display = "block";
    gmeterW.update(g);
  }
  function hideGmeter() { el.gm.style.display = "none"; }

  function setLoc(y) {
    el.loc.style.display = "block";
    locScaleW.update(y);
  }
  function hideLoc() { el.loc.style.display = "none"; }

  function setRadioAlt(visible, ft, flare) {
    el.ra.style.display = visible ? "flex" : "none";
    if (!visible) return;
    el.ra.classList.toggle("is-flare", !!flare);
    el.raVal.textContent = String(Math.round(ft));
  }

  // Positioning matches design/squawk-7700/screens.html per beat: the door's hand sits on the keypad's
  // hinted key (inside .sq-keypad, right/bottom per skin.css); the others float centre-low.
  const GHOST_POS = {
    door: "position:absolute; right:-31px; bottom:-49px;",
    aisle: "position:absolute; left:50%; bottom:8px; margin-left:-60px; height:110px;",
    dive: "position:absolute; left:50%; bottom:8px; margin-left:-60px;",
    landing: "position:absolute; left:50%; bottom:8px; margin-left:-60px;",
  };
  let lastGhostKey = null;
  function setGhost(dir, beatName) {
    if (!dir) { el.ghost.style.display = "none"; lastGhostKey = null; return; }
    el.ghost.style.display = "block";
    const key = dir + "|" + beatName;
    if (key === lastGhostKey) return; // already positioned and drawn for this dir/beat (THE-759: this
    // used to redraw the SVG from a fresh string every frame of every un-demoed intro)
    lastGhostKey = key;
    el.ghost.setAttribute("style", GHOST_POS[beatName] || GHOST_POS.dive);
    if (beatName === "door") el.keypad.appendChild(el.ghost); else overlay.appendChild(el.ghost);
    el.ghost.innerHTML = ghost(dir);
  }

  // The SQUAWK idle nudge (D2-9, sign-off r1): after 4s with no input at the squawk step, a ghost tap
  // over the context button, independent of the first-run demo ghost above (which only covers intro).
  function setSquawkNudge(on) {
    el.squawkNudge.style.display = on ? "block" : "none";
    if (on && !el.squawkNudge.innerHTML) el.squawkNudge.innerHTML = ghost("tap");
  }

  let calloutT = 0;
  function showCalloutNum(text, sub) {
    el.callout.classList.remove("sq-callout--fail");
    el.calloutWord.textContent = "";
    el.calloutNum.textContent = text;
    el.calloutNum.style.display = "block";
    calloutT = 2.2;
    el.callout.style.opacity = "1";
  }
  function showCalloutWord(text) {
    el.callout.classList.remove("sq-callout--fail");
    el.calloutNum.textContent = "";
    el.calloutNum.style.display = "none";
    el.calloutWord.textContent = text;
    calloutT = 1.5;
    el.callout.style.opacity = "1";
  }
  function showFailReason(text) {
    el.callout.classList.add("sq-callout--fail");
    el.calloutNum.textContent = "";
    el.calloutNum.style.display = "none";
    el.calloutWord.textContent = text;
    calloutT = 1.3;
    el.callout.style.opacity = "1";
  }
  function tickCallout(dt) {
    if (calloutT > 0) { calloutT -= dt; if (calloutT <= 0) el.callout.style.opacity = "0"; }
  }

  let flashT = 0;
  function flash() { flashT = 1; el.flash.classList.remove("is-on"); void el.flash.offsetWidth; el.flash.classList.add("is-on"); }
  function tickFlash(dt) { /* animation drives the flash via CSS; nothing to tick */ }

  function setRewind(on) { el.rewind.style.display = on ? "block" : "none"; }

  return {
    update, setXpdr, setPrompt, setPromptClass, setVignette, setRedVignette, tickCaution, setMasterWarning,
    setSunFlare, setGmeter, hideGmeter, setLoc, hideLoc, setRadioAlt, setDist, setGhost,
    showCalloutNum, showCalloutWord, showFailReason, tickCallout, flash, tickFlash, setContext,
    isContextHeld, setKeypad, setLock, setRewind, consumePauseRequest, setSquawkNudge,
  };
}
