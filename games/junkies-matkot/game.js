// rAF -> fixed 120 Hz accumulator -> Sim.step(); keys + touch reducers -> arbiter -> Sim.setInput;
// WebGL2 instanced-quad render with a face-texture atlas; window.__pong test hook. All 11 heads,
// squash/stretch, big-head comeback render, rally heat, match-point/final-hit slow-mo, the full pick
// screen (two carousels, dice, ready, 10s auto-start, solo entry point), A1 keyboard path, rematch
// < 1s with a swap, the first-session serve wait, synth sfx, the in-game replay (sim/replay.js),
// solo's CPU opponent (sim/cpu.js), a single wall-timer registry (scheduleTimer/clearAllTimers).
import { C } from "./sim/constants.js";
import * as Sim from "./sim/sim.js";
import * as Touch from "./input/touch.js";
import * as Keys from "./input/keys.js";
import * as Arbiter from "./input/arbiter.js";
import { createSave } from "./save.js";
import { HEADS, headById } from "./faces.js";
import { createScreens } from "./screens.js";
import { computeLayout } from "./render/layout.js";
import { createRenderer } from "./render/gl.js";
import { loadAtlas } from "./render/atlas.js";
import { paintBackdrop } from "./render/backdrop.js";
import { COLORS, HEAD, BALL, MOMENTS, CROWD, DISTRACTION_KIND } from "./render/recipe.js";
import { bakeCrowd } from "./render/crowd.js";
import { createAudio } from "./audio.js";
import { buildCard, shareResult } from "./share.js";
import * as Tiers from "./render/tiers.js";
import * as Fx from "./render/fx.js";
import * as Moments from "./sim/moments.js";
import * as Cpu from "./sim/cpu.js";
import { createRng } from "./sim/rng.js";
import * as Replay from "./sim/replay.js";
import { CROSS_MARGIN_U } from "./sim/distractions.js";
import { shadowFor, CONTACT_HN } from "./render/shadow.js";
import * as Arc from "./render/arc.js";

const theme = window.THEME;
document.title = theme.title;

const params = new URLSearchParams(location.search);
const seedParam = Number(params.get("seed"));
// Test-only: forces every incoming pointer to be treated as the single first-ever pointer id, so the
// G17 Playwright regression can prove it fails against a single-pointer build before trusting it
// against the real one (spec §3 / THE-1105). Never used in production.
const singleTouchDebug = params.get("singleTouch") === "1";

function getStorage() {
  try { return window.localStorage; } catch (e) { return memoryStorage(); }
}
function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, v) };
}
const save = createSave(getStorage());
const audio = createAudio();
audio.setMuted(save.get().muted);

const appRoot = document.getElementById("app");
const canvas = document.getElementById("scene");
canvas.style.touchAction = "none";

// skin.css reads data-reduce-motion on .jm-app to kill every animation/transition (G12).
function setReduceMotion(on) {
  fxCtrl = Fx.create({ reduceMotion: on });
  appRoot.toggleAttribute("data-reduce-motion", on);
}
const prefersReduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const savedReduceMotion = save.get().reduceMotion;
let fxCtrl;
setReduceMotion(savedReduceMotion === null ? prefersReduceMotion : savedReduceMotion);
let tiersCtrl = Tiers.create(save.get().tier === "low" ? "low" : save.get().tier === "mid" ? "mid" : "high");

// --- pick-screen state (G7) --------------------------------------------
const savedPicks = save.get().lastPicks;
let pickIds = [savedPicks[0] || HEADS[0].id, savedPicks[1] || HEADS[1].id];
let pickReady = [false, false];
let pickReadyAt = null; // performance.now() of the first ready tap; 10s auto-start counts from here
let solo = false;
let humanSide = save.get().soloSide; // THE-1142 S3 (board note 3): 0 = left, 1 = right; the CPU takes the other side
let playMode = save.get().playMode; // THE-1185 B3 (DESIGN.md §13.6): the play sheet's "נגד מי?" row
let diceSpinning = false; // THE-1141: true while the CPU's head is spinning on the pick screen, between "יאללה!" and the match
let diceSpinShownAt = -Infinity;
const DICE_SPIN_MIN_SKIP_MS = 400; // designer's number, DESIGN.md §11.2
let cpuController = null;
let cpuNowMs = 0;
let headColor = {}; // head id -> hex colour, D2-3: colour follows the head, not the side, across a swap
let isFirstMatchOfSession = true; // spec §5/D2-6: only the very first match waits for paddle movement
// THE-1184 S6 (DESIGN.md §13.4): the impact teaching banner never shares a serve with the r2 banner
// (showTeachBanner). impactTipArmedForFirstPoint queues it for the serve right after this match's
// first point when the r2 banner took serve 1 instead; pendingImpactTip is the actual "show on the
// next serve" flag, consumed once.
let impactTipArmedForFirstPoint = false;
let pendingImpactTip = false;

function colorForSide(side) {
  if (pickIdsForMatch[0] === pickIdsForMatch[1]) {
    const base = hexToRgb(theme.playerColors[side]);
    return side === 1 ? tintWhiteRgb(base, 0.18) : base; // mirror match: the right copy gets an 18% tint
  }
  return hexToRgb(headColor[pickIdsForMatch[side]] || theme.playerColors[side]);
}
function tintWhiteRgb([r, g, b], amount) {
  return [r + (1 - r) * amount, g + (1 - g) * amount, b + (1 - b) * amount, 1];
}

const screens = createScreens(appRoot, theme, {
  // N4/THE-1117: cycle/toggleReady delegate to the same functions the keyboard path (KeyW/S/D,
  // Up/Down/Left) uses, instead of repeating the carousel/ready logic here.
  cycle(side, dir) { cyclePick(side, dir); },
  randomize(side) {
    pickIds[side] = HEADS[Math.floor(Math.random() * HEADS.length)].id;
    renderPickScreen();
  },
  toggleReady(side) { requestFullscreenOnFirstPlayTap(); toggleReadyKey(side); },
  // THE-1141 DESIGN.md §11.2, extended THE-1185 B3 (§13.6): "שחקו!" opens the play sheet (mode + side +
  // level) instead of starting a match immediately; "יאללה!"/Enter confirms, "חזרה"/Esc cancels with
  // nothing started.
  openSoloSheet() {
    requestFullscreenOnFirstPlayTap(); // THE-1142 S5b: the first Play tap of the session, straight from this click's own gesture
    screens.renderSoloSheet(pickIds, humanSide, save.get().cpuLevel, playMode, !isCoarsePointer());
    screens.showSoloSheet();
  },
  setCpuLevel(level) { save.setCpuLevel(level); screens.renderSoloSheet(pickIds, humanSide, level, playMode, !isCoarsePointer()); }, // THE-1142 S2: takes effect on the next solo match (cpuController is only (re)built there)
  setSoloSide(side) { humanSide = side; save.setSoloSide(side); screens.renderSoloSheet(pickIds, humanSide, save.get().cpuLevel, playMode, !isCoarsePointer()); }, // THE-1142 S3
  // THE-1185 B3: which side of the "נגד מי?" row is pressed; remembered like every other setting.
  setPlayMode(mode) {
    playMode = mode;
    save.setPlayMode(mode);
    screens.renderSoloSheet(pickIds, humanSide, save.get().cpuLevel, playMode, !isCoarsePointer());
  },
  soloGo() {
    screens.hideSoloSheet();
    if (playMode === "friend") {
      // THE-1185 B3: friend mode has no CPU/dice spin -- it's the same "both players ready" start the
      // old per-side מוכן? buttons used (toggleReadyKey's own both-ready branch), just triggered from
      // the play sheet's "יאללה!" instead of two separate taps.
      solo = false;
      pickReady = [true, true];
      pickReadyAt = null;
      renderPickScreen();
      beginMatchFromPick();
      return;
    }
    solo = true;
    const human = pickIds[humanSide];
    const others = HEADS.filter((h) => h.id !== human);
    const cpuHeadId = others[Math.floor(Math.random() * others.length)].id;
    pickIds = humanSide === 0 ? [human, cpuHeadId] : [cpuHeadId, human];
    diceSpinning = true;
    diceSpinShownAt = performance.now();
    renderPickScreen();
    // Designer's number (DESIGN.md §11.2/§11.3): 1200ms, was 600; skippable after 400ms (skipDiceSpinIfDue).
    scheduleTimer("soloDice", 1200, () => { if (screen === "pick") { diceSpinning = false; beginMatchFromPick(); } });
  },
  soloBack() { screens.hideSoloSheet(); },
  about(on = true) { toggleAbout(on); },
  toggleSound() { toggleMute(); },
  toggleFullscreen() { doToggleFullscreen(); }, // THE-1142 S5b
  toggleReduceMotion() {
    const on = !fxCtrl.reduceMotion;
    setReduceMotion(on);
    save.setReduceMotion(on);
    screens.setPauseState(on, save.get().muted);
  },
  install() { promptInstall(); },
  pause() { setPaused(true); },
  resume() { setPaused(false); },
  pauseToPick() { setPaused(false); setScreen("pick"); },
  _setIds(ids) { pickIds = [ids[0] || pickIds[0], ids[1] || pickIds[1]]; renderPickScreen(); },
  share() { if (!resultInputBlocked()) doShare(); },
  replayAgain() { if (!resultInputBlocked()) replayAgainFromResult(); },
});
const renderer = createRenderer(canvas);
// THE-1143 B2: the crowd sprites bake once at a fixed reference size (atlas.js's own head CELL, 256px),
// independent of the court's on-screen scale -- same as heads, the renderer scales the drawn quad to
// whatever size pushDistraction asks for, so there's no need to re-bake this on resize.
loadAtlas(HEADS, bakeCrowd(256)).then((atlas) => { headAtlas = atlas; if (renderer) renderer.setAtlas(atlas.canvas); });
let headAtlas = null;
if (renderer) {
  renderer.setTier(tiersCtrl.tier);
  if (!renderer.isWebGL2) tiersCtrl = Tiers.create("low"); // WebGL1 -> Low directly (G11), no Canvas2D fallback
  renderer.setOnRestore(() => { resizeCanvas(); if (headAtlas) renderer.setAtlas(headAtlas.canvas); });
}
canvas.addEventListener("webglcontextlost", () => setPaused(true));

function renderPickScreen() { screens.renderPick(pickIds, pickReady, save.get().muted, solo && diceSpinning ? humanSide : null); }
// A fresh tap/click/key, once the dice spin has shown for at least DICE_SPIN_MIN_SKIP_MS, starts the
// match immediately instead of waiting out the rest of the spin (designer's number, DESIGN.md §11.2).
function skipDiceSpinIfDue() {
  if (!diceSpinning || performance.now() - diceSpinShownAt < DICE_SPIN_MIN_SKIP_MS) return;
  clearTimer("soloDice");
  diceSpinning = false;
  beginMatchFromPick();
}
renderPickScreen();

// --- About / pause sheets (skin.css .jm-scrim > .jm-towel.jm-sheet; built by screens.js) ---
function toggleAbout(on) {
  screens.el.aboutSheet.hidden = !on;
  if (on) screens.setPauseState(fxCtrl.reduceMotion, save.get().muted);
}

// --- Pause (G10/G11 context-loss recovery needs this; also Esc/P, tab hidden, window blur) ---
// B4/THE-1117 + design "paused" row: resume isn't instant -- it's a 0.8s count (the same duration as
// the sim's own serve count) with the match frozen where it was, then play continues. Entering pause
// stays instant; only the resume side waits.
let isPaused = false;
function setPaused(on) {
  if (screen !== "match" && screen !== "swap") return;
  if (on) {
    isPaused = true;
    clearTimer("resume");
    screens.el.pauseSheet.hidden = false;
    screens.setPauseState(fxCtrl.reduceMotion, save.get().muted);
    letSleep(); // THE-1142 S5b
  } else {
    screens.el.pauseSheet.hidden = true;
    keepAwake(); // THE-1142 S5b: reacquired right on the resume tap, not after the 0.8s count below
    scheduleTimer("resume", C.SERVE_COUNT_S * 1000, () => {
      if (screen === "match" || screen === "swap") isPaused = false;
    });
  }
}
window.addEventListener("blur", () => setPaused(true));
document.addEventListener("visibilitychange", () => { if (document.hidden) setPaused(true); });
window.addEventListener("keydown", (e) => {
  if ((e.code === "Escape" || e.code === "KeyP") && screen === "match") setPaused(!isPaused);
  else if (e.code === "KeyM") toggleMute(); // B5/G8: M toggles mute from anywhere, same path as the sound button
});

function toggleMute() {
  const muted = !save.get().muted;
  save.setMuted(muted);
  audio.setMuted(muted);
  renderPickScreen();
  screens.setPauseState(fxCtrl.reduceMotion, muted);
}

// --- Meme moments (G13): the megaphone banner overlay, built by screens.js. skin.css says remove it
// on our own timer, never animationend (that event doesn't fire under reduce-motion).
// THE-1142 S4 (board note 4): held longer than before (placeholder numbers, pending the designer's),
// and skippable -- a tap/click/key after MOMENT_MIN_SKIP_MS clears it early, via the timer registry
// instead of a bare wall-clock compare in draw(). ---
// Designer's numbers (DESIGN.md §11.3 / design/junkies-matkot/r1/recipe-r1.js HOLDS), landed on the
// design branch (THE-1141) after this slice started with placeholders -- adopted here. Comeback has no
// skip at all (it's a banner over live play, nothing is blocked by it).
const MOMENT_DURATION_MS = { smash: 2200, comeback: 1800, matchPoint: 1500 };
const MOMENT_MIN_SKIP_MS = { smash: 900, matchPoint: 600 }; // comeback: intentionally absent (no skip)
let momentShownAt = -Infinity;
let activeMomentType = null;
function showMoment(fired) {
  const head = headById(fired.headId);
  if (!["smash", "comeback", "matchPoint"].includes(fired.type)) return;
  screens.showMoment(fired, {
    name: head ? head.name : "",
    line: head ? head.lines[0] : "",
    image: head ? head.image : "",
    speedKmh: fired.speedKmh,
  });
  momentShownAt = performance.now();
  activeMomentType = fired.type;
  screens.setSkipHintVisible(false);
  scheduleTimer("moment", MOMENT_DURATION_MS[fired.type] || 700, () => { activeMomentType = null; screens.clearMoment(); screens.setSkipHintVisible(false); });
  // THE-1141 DESIGN.md §11.3: the "נגיעה מדלגת" pill fades in once skip is actually allowed.
  const minSkipMs = MOMENT_MIN_SKIP_MS[fired.type];
  if (minSkipMs != null) scheduleTimer("skipHint", minSkipMs, () => screens.setSkipHintVisible(true, !isCoarsePointer()));
}
// A fresh tap/click/key, once the moment has shown for at least its type's minSkipMs, dismisses it
// early. A type with no entry in MOMENT_MIN_SKIP_MS (comeback) can never be skipped.
function skipMomentIfDue() {
  const minSkipMs = activeMomentType && MOMENT_MIN_SKIP_MS[activeMomentType];
  if (minSkipMs == null || performance.now() - momentShownAt < minSkipMs) return;
  clearTimer("moment");
  clearTimer("skipHint");
  activeMomentType = null;
  screens.clearMoment();
  screens.setSkipHintVisible(false);
}

// --- Rotate screen (G21): phone portrait, or a coarse-pointer device in portrait (Δ4) ---
const coarsePointerQuery = window.matchMedia("(any-pointer: coarse)");
function isCoarsePointer() { return coarsePointerQuery.matches || navigator.maxTouchPoints > 0; }
function isPortrait() { return window.innerHeight > window.innerWidth; }
let rotateShowing = false;
function updateRotateScreen() {
  const shouldShow = isPortrait() && isCoarsePointer();
  // Δ4: a tablet-sized portrait device says "the device", a phone-sized one says "the phone".
  screens.el.rotateTitle.textContent = Math.max(window.innerWidth, window.innerHeight) >= 900
    ? "סובבו את המכשיר"
    : (theme.text.rotate || "סובבו את הטלפון");
  if (shouldShow === rotateShowing) return;
  rotateShowing = shouldShow;
  screens.el.rotate.hidden = !shouldShow;
  if (shouldShow && (screen === "match" || screen === "swap")) setPaused(true);
}
window.addEventListener("resize", updateRotateScreen);

// --- Full screen + wake lock (THE-1142 S5b, board note 7): copies the Junkies Pro pattern
// (games/junkies-pro/js/game.js:1693 -- requestFullscreen/webkit fallback, a screen wake lock, an
// orientation lock). THE-1143 N3 (CTO review): the automatic first-Play-tap request is still gated to
// coarse pointers, like Junkies Pro's own immerse() (a mouse/keyboard user on desktop doesn't expect
// their first click to suddenly take over the screen) -- but the *toggle button* stays available and
// works on phone, tablet and desktop alike, so a desktop player can still choose full screen. ---
function fsEl() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
function requestFullscreen() {
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!req || fsEl()) return;
  try {
    const p = req.call(el, { navigationUI: "hide" });
    if (p && p.then) p.then(lockLandscape, () => {}); // a refusal is silent: the game goes on either way
  } catch (e) {}
}
function lockLandscape() { try { screen.orientation.lock("landscape").catch(() => {}); } catch (e) {} }
let firstPlayTapHandled = false;
function requestFullscreenOnFirstPlayTap() {
  if (firstPlayTapHandled || !isCoarsePointer()) return; // THE-1143 N3: automatic only on touch; the toggle button covers desktop
  firstPlayTapHandled = true;
  requestFullscreen();
}
function doToggleFullscreen() {
  if (fsEl()) {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) { try { exit.call(document); } catch (e) {} }
  } else {
    requestFullscreen();
  }
}
function updateFullscreenButton() {
  const supported = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
  screens.setFullscreenState(supported, !!fsEl());
}
document.addEventListener("fullscreenchange", updateFullscreenButton);
document.addEventListener("webkitfullscreenchange", updateFullscreenButton);
updateFullscreenButton();

let wakeLock = null;
let wakeLockReleasePending = false; // THE-1143 N2: letSleep() called while a request() was still in flight
function keepAwake() {
  if (wakeLock || !navigator.wakeLock || document.hidden) return;
  wakeLock = "asking";
  wakeLockReleasePending = false;
  navigator.wakeLock.request("screen").then(
    (l) => {
      if (wakeLockReleasePending) { wakeLockReleasePending = false; wakeLock = null; l.release().catch(() => {}); return; }
      wakeLock = l;
      l.addEventListener("release", () => { if (wakeLock === l) wakeLock = null; });
    },
    () => { wakeLock = null; wakeLockReleasePending = false; }
  );
}
function letSleep() {
  if (wakeLock === "asking") { wakeLockReleasePending = true; return; } // release once request() resolves, not before
  if (wakeLock && wakeLock.release) wakeLock.release().catch(() => {});
  wakeLock = null;
}

// --- PWA: install button + offline (sw.js registered after game:ready) ------
let deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  screens.setInstallVisible(true);
});
window.addEventListener("appinstalled", () => { screens.setInstallVisible(false); deferredInstallPrompt = null; });
async function promptInstall() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  screens.setInstallVisible(false);
}

let match = null;
let replayRec = null; // sim/replay.js recorder for the current match, re-attached on every createMatch
let headIds = [null, null]; // which head id plays paddle 0 (left) / 1 (right) *this match*
let pickIdsForMatch = [null, null]; // snapshot of pickIds at the moment colour assignment happened
let screen = "pick"; // "pick" | "match" | "result" | "swap" | "replay"
let touchState = Touch.createTouchState();
let keysState = Keys.createKeysState();
let arbiterState = Arbiter.createArbiterState();
const firstEverPointerId = { value: null };
let resultActionTaken = false; // rematch/Space/Enter disables after the first press (spec §2)
// THE-1142 S4/S6 (designer's number, DESIGN.md §11.3 recipe-r1.js HOLDS.resultInputGuardMs): the result
// screen's buttons ignore presses for this long after it appears, so a mis-tap carried over from
// dismissing the replay can't fire a result action by accident.
const RESULT_INPUT_GUARD_MS = 700;
let resultShownAt = -Infinity;
function resultInputBlocked() { return screen === "result" && performance.now() - resultShownAt < RESULT_INPUT_GUARD_MS; }
const squashHitAt = [-Infinity, -Infinity]; // performance.now() of each side's last hit (wall clock, render-only)
const SQUASH_MS = 140;
// THE-1156 S2 (board note 2): one height arc per paddle-to-paddle flight, started at the serve launch or
// a hit (never a wall bounce -- a wall only flips vy, not vx, so the flight's duration doesn't change).
let flightStartAt = -Infinity; // performance.now() the current flight began
let flightMs = 0; // that flight's total duration, computed once at flightStartAt
let wasDistractionHeld = false; // tracks the distractionHold edge, so a seagull release starts a new flight

// THE-1162 (DESIGN.md §12.5): the crowd entry bubble, shown once per distraction's crossing of x 150-1450 u.
const BUBBLE_ENTER_X_MIN = 150, BUBBLE_ENTER_X_MAX = 1450;
const BUBBLE_MS = 1600, BUBBLE_OUT_MS = 200; // tokens.css --jm-t-bubble; .is-out for the last BUBBLE_OUT_MS
const BUBBLE_TEXT = { crab: "סליחה, רק עובר!", gull: "יש ציפס?", seller: "ארטיק! ארטיק!" };
let bubbleShownFor = null; // the match.distraction instance already given its entry bubble (edge-trigger, once per spawn)
let activeBubbleDistraction = null; // the distraction instance the on-screen bubble is following, for the per-frame position update in draw()
function startFlight(nowMs) {
  flightStartAt = nowMs;
  const vx = match.ball.vx;
  const targetSide = vx >= 0 ? 1 : 0;
  // THE-1189 D2: once the receiving paddle can stand forward in its zone (same pattern as sim/cpu.js),
  // time the arc to its real front face instead of the legacy fixed one, or the ball lands/shadows wrong.
  const dir = targetSide === 0 ? 1 : -1;
  const targetX = match.zoneEnabled ? match.paddles[targetSide].x + dir * (C.CAPSULE_THICK / 2) : C.FRONT_FACE_X[targetSide];
  flightMs = Arc.flightDurationMs(match.ball.x, targetX, vx);
}
let guideFaded = [true, true]; // M4: both already "faded" until the first match arms them
let momentsSched = Moments.create();
let maxTrailEver = [0, 0]; // the worst deficit each side has faced so far this match (G13 comeback detection)
function resetMoments() { momentsSched = Moments.create(); maxTrailEver = [0, 0]; confettiParticles = null; confettiStartAt = 0; }

// --- THE-1123 M7: win confetti (recipe.js MOMENTS.win). Counts as one full-field flash against the
// G12 cap (Fx.requestFlash), same budget pool a chromatic-aberration-heavy rally shares. Rendered
// independent of `screen` so it keeps playing across the match -> replay -> result transition instead
// of being cut off by it. Reduce motion swaps the falling simulation for a static scatter (positions
// fixed at spawn, no per-frame motion) rather than skipping the moment outright.
let confettiParticles = null;
let confettiStartAt = 0;
function triggerConfetti() {
  const now = performance.now();
  const [nextFx, ok] = Fx.requestFlash(fxCtrl, now);
  fxCtrl = nextFx;
  if (!ok) return;
  confettiStartAt = now;
  const reduceMotion = fxCtrl.reduceMotion;
  confettiParticles = Array.from({ length: MOMENTS.win.confetti }, () => ({
    x: Math.random() * C.COURT_W,
    y: reduceMotion ? Math.random() * C.COURT_H : -Math.random() * 200,
    vx: reduceMotion ? 0 : (Math.random() - 0.5) * 200,
    vy: reduceMotion ? 0 : 500 + Math.random() * 400,
    size: 14 + Math.random() * 10,
    rot: Math.random() * Math.PI * 2,
    rotSpeed: reduceMotion ? 0 : (Math.random() - 0.5) * 6,
    colorHex: COLORS.confetti[Math.floor(Math.random() * COLORS.confetti.length)],
  }));
}
function pushConfetti(instances, toPx, now) {
  if (!confettiParticles) return;
  const elapsed = now - confettiStartAt;
  if (elapsed >= MOMENTS.win.confettiMs) { confettiParticles = null; return; }
  const t = elapsed / 1000;
  for (const p of confettiParticles) {
    const wy = p.y + p.vy * t;
    if (wy > C.COURT_H + 40) continue; // fallen past the sand line
    const [px, py] = toPx(p.x + p.vx * t, wy);
    instances.push({ x: px, y: py, w: p.size, h: p.size * 0.6, color: rgba(p.colorHex, 1), shape: "rect", rotation: p.rot + p.rotSpeed * t });
  }
}

// --- timer registry (design "Timers and animations"): every wall-time setTimeout is tagged and
// cleared whenever the screen changes. B3/THE-1117: the dice-spin and swap timers used to be bare
// setTimeouts, so a screen change (or a second trigger) while one was still pending could fire its
// callback over whatever the player had since navigated to (double match-start, a stray setScreen
// over the pick screen). scheduleTimer always clears its own tag first, so re-triggering the same
// action (double solo tap) cannot stack two callbacks either.
const activeTimers = new Map(); // tag -> setTimeout id
function scheduleTimer(tag, ms, fn) {
  clearTimer(tag);
  const id = setTimeout(() => { activeTimers.delete(tag); fn(); }, ms);
  activeTimers.set(tag, id);
}
function clearTimer(tag) {
  const id = activeTimers.get(tag);
  if (id !== undefined) clearTimeout(id);
  activeTimers.delete(tag);
}
function clearAllTimers(keepTag = null) {
  for (const [tag, id] of activeTimers) {
    if (tag !== keepTag) { clearTimeout(id); activeTimers.delete(tag); }
  }
}

function setScreen(name) {
  // Every state change drops any pending dice/swap/resume timer from the old screen -- except swap ->
  // match, which is the same match continuing: a resume count started during the swap must survive it,
  // or the match stays paused with the sheet already hidden (THE-1108 r2).
  clearAllTimers(screen === "swap" && name === "match" ? "resume" : null);
  if (name !== "match") activeMomentType = null; // THE-1142 S4: its timer was just cleared above; screens.show() below hides the DOM overlay
  // THE-1157 r1 fix: clearAllTimers() above cancels the point/teach/bubble clear timers without removing
  // the DOM nodes they were going to remove -- a stale .jm-point/.jm-teach/.jm-bubble otherwise survives
  // into the next match. screens.show() doesn't touch .jm-hud's children, so this has to be explicit.
  if (name !== "match") { screens.clearPointMoment(); screens.clearTeachBanner(); screens.clearBubble(); activeBubbleDistraction = null; }
  if (name === "match") keepAwake(); else if (name !== "swap") letSleep(); // THE-1142 S5b: release on result/pick/replay, not mid-swap
  screen = name;
  screens.show(name === "swap" ? "match" : name); // swap reuses the match DOM, canvas-only transition
  if (name !== "match" && name !== "swap") { isPaused = false; screens.el.pauseSheet.hidden = true; }
  if (name === "pick") { pickReady = [false, false]; pickReadyAt = null; solo = false; renderPickScreen(); }
  touchState = Touch.createTouchState(
    match ? [match.paddles[0].y, match.paddles[1].y] : undefined,
    match ? [match.paddles[0].x, match.paddles[1].x] : undefined,
  );
  keysState = Keys.createKeysState(
    match ? [match.paddles[0].y, match.paddles[1].y] : undefined,
    match ? [match.paddles[0].x, match.paddles[1].x] : undefined,
  );
  arbiterState = Arbiter.createArbiterState();
}

function beginMatchFromPick() {
  headIds = [pickIds[0], pickIds[1]];
  pickIdsForMatch = headIds.slice();
  headColor = {};
  headColor[headIds[0]] = theme.playerColors[0];
  headColor[headIds[1]] = theme.playerColors[1];
  match = Sim.createMatch((seedParam || Date.now()) >>> 0, { distractions: true, zone: true, impact: true }); // THE-1142 S5 / THE-1184 S1-S2: real matches only, not the ?seed= / __pong.seed() test-hook path
  const armWait = isFirstMatchOfSession;
  if (armWait) { Sim.armFirstServeWait(match); isFirstMatchOfSession = false; }
  replayRec = Replay.attachRecorder(match, { firstServeWaitArmed: armWait });
  resetMoments();
  // M4: first match only. Solo has no guide on the CPU's side (it would never fade).
  if (armWait) {
    guideFaded = solo ? (humanSide === 0 ? [false, true] : [true, false]) : [false, false];
    // THE-1184 S6: can't also show the impact tip on this same serve -- queue it for the serve right
    // after this match's first point instead.
    impactTipArmedForFirstPoint = !save.get().impactTipSeen;
    pendingImpactTip = false;
  } else {
    impactTipArmedForFirstPoint = false;
    pendingImpactTip = !save.get().impactTipSeen; // no r2 banner this match: show on its first serve
  }
  if (solo) { cpuController = Cpu.create(1 - humanSide, createRng((match.seed ^ 0x9e3779b9) >>> 0), save.get().cpuLevel); cpuNowMs = 0; }
  else cpuController = null;
  setScreen("match"); // THE-1189: setScreen's own clearAllTimers runs first -- the teach banner's clear
  // timer below has to be scheduled after it, or setScreen wipes the timer the instant it's set (the
  // banner then never clears and blocks the impact tip from ever showing).
  if (armWait) {
    screens.showGuides(isCoarsePointer(), solo, humanSide);
    // THE-1156 S4 (board note 4, DESIGN.md §12.4): the first-serve teaching banner, same one-time flag.
    screens.showTeachBanner();
    scheduleTimer("teach-banner-clear", 3500, () => screens.clearTeachBanner());
  }
}

function startMatch(seed) { // test-hook entry (window.__pong.seed)
  headIds = [pickIds[0], pickIds[1]];
  pickIdsForMatch = headIds.slice();
  headColor = { [headIds[0]]: theme.playerColors[0], [headIds[1]]: theme.playerColors[1] };
  match = Sim.createMatch(seed >>> 0);
  replayRec = Replay.attachRecorder(match);
  resetMoments();
  setScreen("match");
}

function doRematch() {
  if (resultActionTaken || resultInputBlocked()) return;
  resultActionTaken = true;
  setScreen("swap");
  scheduleTimer("swap", 400, () => {
    if (screen !== "swap") return; // the player backed out (pause -> title) before this fired
    // Side-swap on rematch (G6) is a two-human "swap seats" cue; solo keeps the human on their chosen
    // side (humanSide, THE-1142 S3) and just re-picks a fresh CPU opponent for the other side.
    if (!solo) headIds = [headIds[1], headIds[0]];
    pickIdsForMatch = headIds.slice(); // headColor map is untouched: colour follows the head across the swap
    save.setLastPicks(headIds);
    match = Sim.createMatch((match.seed + 1) >>> 0, { distractions: true, zone: true, impact: true }); // THE-1142 S5 / THE-1184 S1-S2
    replayRec = Replay.attachRecorder(match);
    resetMoments();
    // THE-1184 S6: a rematch never shows the r2 banner, so show the impact tip on its first serve if
    // it's still unseen (covers a player who somehow never saw a point in their very first match).
    impactTipArmedForFirstPoint = false;
    pendingImpactTip = !save.get().impactTipSeen;
    if (solo) { cpuController = Cpu.create(1 - humanSide, createRng((match.seed ^ 0x9e3779b9) >>> 0), save.get().cpuLevel); cpuNowMs = 0; }
    setScreen("match");
  }); // 0.4s swap tween (A4/D2-3); rematch-to-serve stays well under 1s
}
screens.el.rematchBtn.addEventListener("click", doRematch);
screens.el.changeHeadsBtn.addEventListener("click", () => { if (!resultInputBlocked()) setScreen("pick"); });

// --- in-game replay (B1/G14/THE-774, THE-1117): the final point auto-plays once between matchEnd and
// the result screen -- last REPLAY_MAX_SIM_S of sim time at 1x, then the last REPLAY_SLOWMO_LAST_S at
// REPLAY_SLOWMO_SCALE -- and the result screen's "▶ הנקודה המנצחת" button re-plays it, returning to
// `result` either way. `onDone` is what tells the two call sites apart: the very first time (straight
// off matchEnd) it still has to do the result-screen setup; replaying again from the result screen,
// that setup already happened, so it just goes back.
let replayPlayback = null; // { trace, splitIndex, splitWallMs, totalWallMs, elapsedMs, onDone }

function enterReplay(onDone) {
  const result = match && replayRec ? Replay.resimulate(match.seed, replayRec) : null;
  if (!result || !result.trace.length) { onDone(); return; } // nothing recorded (e.g. a forced score): skip straight through
  const slowmoTicks = Math.round(C.REPLAY_SLOWMO_LAST_S * C.STEP_HZ);
  const splitIndex = Math.max(0, result.trace.length - slowmoTicks);
  const tickMs = 1000 / C.STEP_HZ;
  const splitWallMs = splitIndex * tickMs;
  const totalWallMs = splitWallMs + (result.trace.length - splitIndex) * (tickMs / C.REPLAY_SLOWMO_SCALE);
  replayPlayback = { trace: result.trace, splitIndex, splitWallMs, totalWallMs, elapsedMs: 0, onDone };
  setScreen("replay");
}

function finishReplay() {
  const pb = replayPlayback;
  if (!pb) return;
  replayPlayback = null; // cleared before onDone, in case onDone itself calls enterReplay again
  pb.onDone();
}

// Samples the trace at the current playback elapsed time, honouring the two-speed pacing.
function replaySample(pb) {
  const tickMs = 1000 / C.STEP_HZ;
  const tickIndex = pb.elapsedMs <= pb.splitWallMs
    ? pb.elapsedMs / tickMs
    : pb.splitIndex + (pb.elapsedMs - pb.splitWallMs) / (tickMs / C.REPLAY_SLOWMO_SCALE);
  const idx = Math.max(0, Math.min(pb.trace.length - 1, Math.floor(tickIndex)));
  const f = pb.trace[idx];
  return { ball: { x: f.x, y: f.y }, paddles: [f.paddles[0], f.paddles[1]], distraction: f.distraction || null };
}

function replayAgainFromResult() {
  if (screen !== "result") return;
  enterReplay(() => setScreen("result"));
}

function onMatchEnd() {
  enterReplay(() => {
    save.setLastPicks(headIds);
    save.addWin(headIds[match.winner]);
    screens.updateResult(match.winner, match.score, headIds);
    resultActionTaken = false;
    resultShownAt = performance.now();
    setScreen("result");
    buildResultCard().then((canvas) => {
      if (canvas && screen === "result") screens.el.cardSlot.replaceChildren(canvas);
    });
  });
}

// G14: the result card. A fresh Image (not the shared atlas) so the card gets the winner's photo at
// full source resolution rather than the atlas's downsampled cell. Shown on screen as `.jm-print`
// (onMatchEnd) and reused for the share chain (doShare), so it's built once per match end.
let lastCardCanvas = null;
async function buildResultCard() {
  if (!match || match.winner == null) return null;
  const winner = headById(headIds[match.winner]);
  const loser = headById(headIds[1 - match.winner]);
  if (!winner) return null;
  const img = new Image();
  img.src = winner.image;
  const loserImg = new Image();
  if (loser) loserImg.src = loser.image;
  try { await img.decode(); } catch (e) { /* card still renders, just without the photo */ }
  if (loser) { try { await loserImg.decode(); } catch (e) { /* loser disc skipped */ } }
  // M5: the winning rally's trail on the card photo, from a re-sim of the same recording the in-game
  // replay uses (sim/replay.js), so it shares that trace's last-4 s crop.
  const replayResult = replayRec ? Replay.resimulate(match.seed, replayRec) : null;
  const trail = replayResult && replayResult.trace.length ? replayResult.trace.map((f) => [f.x, f.y]) : [];
  lastCardCanvas = await buildCard({
    theme,
    winnerName: winner.name,
    winnerLine2: winner.lines[1] ?? winner.lines[0],
    loserName: loser ? loser.name : "",
    score: match.winner === 0 ? match.score : [match.score[1], match.score[0]],
    rallyHits: match.rally, // the winning rally: launchServe is the only reset and none follows matchEnd
    winnerImage: img.complete ? img : null,
    loserImage: loser && loserImg.complete ? loserImg : null,
    winnerColor: theme.playerColors[match.winner],
    loserColor: theme.playerColors[1 - match.winner],
    trail,
  });
  return lastCardCanvas;
}

async function doShare() {
  if (!match || match.winner == null) return;
  const winner = headById(headIds[match.winner]);
  const loser = headById(headIds[1 - match.winner]);
  if (!winner) return;
  const canvas = lastCardCanvas || await buildResultCard();
  if (!canvas) return;
  const text = (theme.text.shareText || "{winner} ניצח את {loser} {score}")
    .replace("{winner}", winner.name)
    .replace("{loser}", loser ? loser.name : "")
    .replace("{score}", `${match.score[0]}-${match.score[1]}`);
  await shareResult(canvas, { theme, root: appRoot, text, url: theme.shareUrl || location.href });
}

// --- input wiring -----------------------------------------------------
function canvasRectToWorld(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  const layout = computeLayout(r.width, r.height);
  return {
    x: ((clientX - r.left) - layout.courtX) / layout.scaleX, // THE-1184 S6: x uses scaleX now
    y: ((clientY - r.top) - layout.courtY) / layout.scale,
  };
}

function pointerEventToTouchEvent(type, e) {
  let id = e.pointerId;
  if (singleTouchDebug) {
    if (firstEverPointerId.value === null) firstEverPointerId.value = id;
    id = firstEverPointerId.value; // every finger collapses onto the first one ever seen
  }
  const { x, y } = canvasRectToWorld(e.clientX, e.clientY);
  return { type, id, x, y };
}

const touchCtx = () => ({ midlineX: C.COURT_W / 2, viewportH: window.innerHeight, solo, humanSide });

function fadeGuideOnce(side) {
  if (guideFaded[side]) return;
  guideFaded[side] = true;
  screens.fadeGuide(side);
}
function onPointerDown(e) {
  if (screen !== "match") return;
  skipMomentIfDue(); // THE-1142 S4: a fresh press also dismisses an on-screen moment early, past its minimum hold
  const te = pointerEventToTouchEvent("down", e);
  touchState = Touch.reduce(touchState, te, touchCtx());
  const side = solo ? humanSide : te.x < touchCtx().midlineX ? 0 : 1; // solo: touch.js routes every touch to humanSide regardless of x
  arbiterState = Arbiter.noteTouch(arbiterState, side);
  fadeGuideOnce(side);
}
function onPointerMove(e) {
  if (screen !== "match") return;
  touchState = Touch.reduce(touchState, pointerEventToTouchEvent("move", e), touchCtx());
}
function onPointerUp(e) {
  touchState = Touch.reduce(touchState, pointerEventToTouchEvent("up", e), touchCtx());
}
function onPointerCancel(e) {
  touchState = Touch.reduce(touchState, pointerEventToTouchEvent("cancel", e), touchCtx());
}
canvas.addEventListener("pointerdown", onPointerDown);
window.addEventListener("pointermove", onPointerMove);
window.addEventListener("pointerup", onPointerUp);
window.addEventListener("pointercancel", onPointerCancel);

// THE-774/B1: any new press that starts once `replay` is already showing skips it; one already held
// from before (a finger down before the match ended, carried into the replay) never fires a new
// "pointerdown" for the same contact, so it can't skip -- only a fresh press can. Capture-phase and
// window-wide so it catches a press anywhere, including on the `.jm-letterbox` overlay itself.
window.addEventListener("pointerdown", () => {
  if (screen === "replay") finishReplay();
  else if (screen === "pick" && diceSpinning) skipDiceSpinIfDue(); // THE-1141 DESIGN.md §11.2
}, { capture: true });

// THE-1184 S3 (board note 1): x axis keys fold into the same two sets -- the match-screen keydown/keyup
// handlers below forward anything in either set to Keys.onKey, which already knows (by code) which axis
// a key belongs to.
const LEFT_KEYS = new Set(["KeyW", "KeyS", "KeyA", "KeyD"]);
const RIGHT_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
// THE-1143 N1 (CTO review r2): in solo either pair drives the human, so both pairs are folded onto the
// human's own pair right at the event -- keys.js, the arbiter and the guide then see one player only.
// THE-1184 S3/THE-1185 B2 (CTO review r3): the x axis folds by *screen* direction, not by fwd/back role
// -- "fwd"/"back" are side-relative (fwd is +x for the left player, -x for the right one), so folding by
// that role flips the screen direction whenever the chosen side differs from the key pair's natural
// side (DESIGN.md §13.3: "every key moves the paddle the way its arrow points on the screen"). Folding
// by screenLeft/screenRight instead is side-symmetric by construction.
const SOLO_KEY_CODES = [
  { up: "KeyW", down: "KeyS", screenLeft: "KeyA", screenRight: "KeyD" },
  { up: "ArrowUp", down: "ArrowDown", screenLeft: "ArrowLeft", screenRight: "ArrowRight" },
];
const KEY_ROLE = {
  KeyW: "up", KeyS: "down", KeyA: "screenLeft", KeyD: "screenRight",
  ArrowUp: "up", ArrowDown: "down", ArrowLeft: "screenLeft", ArrowRight: "screenRight",
};
function paddleKeyCode(code) {
  if (!solo || !(LEFT_KEYS.has(code) || RIGHT_KEYS.has(code))) return code;
  return SOLO_KEY_CODES[humanSide][KEY_ROLE[code]];
}
// Keys auto-repeat while held (and a key can already be held when `replay` starts), so replay skip and
// rematch only count a fresh press (`!e.repeat`) -- unlike pointerdown, a held keydown is not a one-shot.
window.addEventListener("keydown", (e) => {
  if (screen === "match") {
    if (!e.repeat) skipMomentIfDue(); // THE-1142 S4: a fresh key also dismisses an on-screen moment early, past its minimum hold
    const code = paddleKeyCode(e.code);
    if (LEFT_KEYS.has(code)) { keysState = Keys.onKey(keysState, code, true); arbiterState = Arbiter.noteKeys(arbiterState, 0); fadeGuideOnce(0); }
    else if (RIGHT_KEYS.has(code)) { keysState = Keys.onKey(keysState, code, true); arbiterState = Arbiter.noteKeys(arbiterState, 1); fadeGuideOnce(1); }
    return;
  }
  if (screen === "replay") {
    if ((e.code === "Space" || e.code === "Enter") && !e.repeat) finishReplay();
    return;
  }
  // THE-1141 DESIGN.md §11.2 keyboard contract for the solo sheet: ←/→ picks the side (physical),
  // ↑/↓ the level, Enter = "יאללה!", Esc = "חזרה". The sheet is a modal overlay on top of the pick
  // screen (screen is still "pick" while it's open), so this is checked ahead of that screen's own keys.
  if (!screens.el.soloSheet.hidden) {
    const tubeFocused = document.activeElement && document.activeElement.classList?.contains("jm-tube");
    if (e.code === "ArrowLeft") screens.el.soloSideTubes[0].click();
    else if (e.code === "ArrowRight") screens.el.soloSideTubes[1].click();
    else if (e.code === "ArrowUp" || e.code === "ArrowDown") {
      const levels = ["easy", "medium", "hard"];
      const idx = levels.indexOf(save.get().cpuLevel);
      const next = levels[(idx + (e.code === "ArrowUp" ? -1 : 1) + levels.length) % levels.length];
      screens.el.soloLevelTubes.find((b) => b.dataset.level === next)?.click();
    } else if (e.code === "Enter" && !tubeFocused) screens.el.soloGoBtn.click();
    else if (e.code === "Escape") screens.el.soloBackBtn.click();
    return;
  }
  if (screen === "pick") {
    if (diceSpinning) { if (!e.repeat) skipDiceSpinIfDue(); return; } // THE-1141 DESIGN.md §11.2
    // A1: the carousel keys (W/S, Up/Down) keep working even while a centre tube has focus.
    // THE-1185 B3 (DESIGN.md §13.6): the calm screen's own keyboard contract -- Enter/Space opens the
    // play sheet (the old per-side quick-ready KeyD/ArrowLeft shortcuts and "Enter = both ready" are
    // gone along with the per-side ready buttons they drove; 2-player now starts from the play sheet's
    // own friend mode). Enter/Space is the one key a focused tube already handles itself (native button
    // activation), so only treat it as "open the sheet" when nothing is focused.
    const tubeFocused = document.activeElement && document.activeElement.classList?.contains("jm-tube");
    if (e.code === "KeyW") { cyclePick(0, -1); }
    else if (e.code === "KeyS") { cyclePick(0, 1); }
    else if (e.code === "ArrowUp") { cyclePick(1, -1); }
    else if (e.code === "ArrowDown") { cyclePick(1, 1); }
    else if ((e.code === "Enter" || e.code === "Space") && !tubeFocused) { screens.el.soloBtn.click(); }
    else if (e.code === "KeyC") { screens.el.soloBtn.click(); }
    return;
  }
  if (screen === "result") {
    if ((e.code === "Space" || e.code === "Enter") && !e.repeat && document.activeElement?.tagName !== "BUTTON") doRematch();
  }
  if (e.code === "Escape" && !screens.el.aboutSheet.hidden) toggleAbout(false);
});
window.addEventListener("keyup", (e) => {
  if (LEFT_KEYS.has(e.code) || RIGHT_KEYS.has(e.code)) keysState = Keys.onKey(keysState, paddleKeyCode(e.code), false);
});
function cyclePick(side, dir) {
  const idx = HEADS.findIndex((h) => h.id === pickIds[side]);
  pickIds[side] = HEADS[(idx + dir + HEADS.length) % HEADS.length].id;
  renderPickScreen();
}
function toggleReadyKey(side) {
  pickReady[side] = !pickReady[side];
  if (pickReady[side] && pickReadyAt === null) pickReadyAt = performance.now();
  renderPickScreen();
  if (pickReady[0] && pickReady[1]) beginMatchFromPick();
}

// --- fixed-step loop ---------------------------------------------------
const DT = 1 / C.STEP_HZ;
let acc = 0, last = performance.now();

// THE-1119 M1: the full-bleed beach world is painted once per resize (Canvas2D, render/backdrop.js)
// and uploaded as a single GL texture -- it has gradients and ~180 small elements (glint, grain,
// footprints) that don't fit the 96-instance-per-frame batch or the flat-colour shader.
let backdropCanvas = null;
function updateBackdrop(w, h) {
  if (!renderer) return;
  if (!backdropCanvas) backdropCanvas = document.createElement("canvas");
  backdropCanvas.width = w;
  backdropCanvas.height = h;
  paintBackdrop(backdropCanvas.getContext("2d"), computeLayout(w, h), { playerColors: theme.playerColors });
  renderer.setBackground(backdropCanvas);
}

function resizeCanvas() {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.min(Math.round(r.width * dpr), 2560);
  const h = Math.round(r.height * dpr);
  if (renderer) renderer.resize(w, h);
  updateBackdrop(w, h);
  // skin.css hangs the HUD/meme layouts off these (DESIGN.md §6); CSS px, not the DPR-scaled buffer.
  const cssLayout = computeLayout(r.width, r.height);
  appRoot.style.setProperty("--jm-court-l", `${cssLayout.l}px`);
  appRoot.style.setProperty("--jm-court-r", `${cssLayout.r}px`);
  appRoot.style.setProperty("--jm-court-t", `${cssLayout.t}px`);
  appRoot.style.setProperty("--jm-court-b", `${cssLayout.b}px`);
  // THE-1184 S6 (DESIGN.md §13.1): the first-match guides now centre inside each zone (world x 230/1370
  // u), not in the old side margin (which shrank to a few dozen px). skin.css's .jm-guide--l/r left:
  // formula still computes the pre-r3 margin-based position -- it needs switching to these vars
  // (follow-up for the designer/CTO; out of dev's skin.css lane).
  appRoot.style.setProperty("--jm-guide-l", `${cssLayout.guideLeftX}px`);
  appRoot.style.setProperty("--jm-guide-r", `${cssLayout.guideRightX}px`);
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();
updateRotateScreen();

function updatePickCountdown() {
  if (screen === "pick" && pickReadyAt !== null && !(pickReady[0] && pickReady[1])) {
    const left = 10 - (performance.now() - pickReadyAt) / 1000;
    screens.setCountdown(Math.max(0, left));
    if (left <= 0) { pickReady = [true, true]; renderPickScreen(); beginMatchFromPick(); }
  }
}

let lastMatchState = null;
const shakeAt = { t: -Infinity, context: "play" };

function tick() {
  if (match && screen === "match" && !isPaused) {
    keysState = Keys.step(keysState, DT);
    const targets = Arbiter.resolve(arbiterState, touchState.targetY, keysState.y);
    const targetsX = Arbiter.resolveX(arbiterState, touchState.targetX, keysState.x); // THE-1184 S3
    const inputs = [targets[0], targets[1]];
    const inputsX = [targetsX[0], targetsX[1]];
    if (solo && cpuController) { // THE-1142 S3: the human drives humanSide; the CPU takes the other index
      const cpuSide = 1 - humanSide;
      const r = Cpu.update(cpuController, match, cpuNowMs);
      cpuController = r.cpu;
      cpuNowMs += DT * 1000;
      inputs[cpuSide] = cpuController.targetY;
      inputsX[cpuSide] = cpuController.targetX; // THE-1184 S4: undefined until the CPU gains the x axis
    }
    Sim.setInput(match, 0, inputs[0], inputsX[0]);
    Sim.setInput(match, 1, inputs[1], inputsX[1]);
    if (replayRec) Replay.recordTick(replayRec, inputs, inputsX); // THE-1185 B1: x travels in the log too now
    Sim.step(match, DT);
    if (match.state !== lastMatchState) {
      tiersCtrl = Tiers.notifyStateChange(tiersCtrl, performance.now());
      if (match.state === "rally" && lastMatchState !== "rally") startFlight(performance.now()); // serve launch: the ball takes off
      // THE-1184 S6 (DESIGN.md §13.4): the impact tip shows right as the serve count for its target
      // serve begins -- 3200ms visible, then clearTeachBanner's existing 300ms fade (reusing the r2
      // banner's own 3500ms total timer).
      if (match.state === "serve" && lastMatchState !== "serve" && pendingImpactTip) {
        // THE-1189: an older .jm-teach (the r2 banner) can still be up here -- showImpactTeachBanner()
        // then no-ops. Only spend the one-shot impactTipSeen flag, and only start its own clear timer,
        // on a serve where it actually rendered; otherwise keep retrying on the next serve.
        if (screens.showImpactTeachBanner()) {
          pendingImpactTip = false;
          scheduleTimer("impact-tip-clear", 3500, () => screens.clearTeachBanner());
          save.setImpactTipSeen(true);
        }
      }
      lastMatchState = match.state;
    }
    // THE-1156 S4 (DESIGN.md §12.1 restarts): a seagull release hands the ball a new velocity mid-air --
    // a new flight starts from here, same as a hit. A crab only flips vy (no restart, same flight).
    if (wasDistractionHeld && !match.distractionHold) startFlight(performance.now());
    wasDistractionHeld = !!match.distractionHold;
    // THE-1162 (DESIGN.md §12.5): the entry bubble, once per spawn, the first tick its foot point is
    // inside x 150-1450 u. bubbleShownFor edge-triggers on the distraction object's identity, so a new
    // spawn (a different object) always gets its own chance even if an old reference is stale.
    if (match.distraction && match.distraction !== bubbleShownFor &&
        match.distraction.x >= BUBBLE_ENTER_X_MIN && match.distraction.x <= BUBBLE_ENTER_X_MAX) {
      bubbleShownFor = match.distraction;
      activeBubbleDistraction = match.distraction;
      const { kind, x, y, below } = distractionBubblePlacement(match.distraction);
      screens.showBubble(BUBBLE_TEXT[kind] || "", x, y, below);
      scheduleTimer("bubble-out", BUBBLE_MS - BUBBLE_OUT_MS, () => screens.setBubbleOut());
      scheduleTimer("bubble-clear", BUBBLE_MS, () => { screens.clearBubble(); activeBubbleDistraction = null; });
    }
    const momentCandidates = [];
    for (const ev of match.events) {
      if (ev.type === "distractionHit" && ev.kind === "passerby") {
        startFlight(performance.now()); // a block reverses vx: a new flight, same as a hit
      } else if (ev.type === "hit") {
        squashHitAt[ev.side] = performance.now();
        startFlight(performance.now()); // THE-1156 S2: a new flight starts at every hit, not a wall bounce
        audio.tok(match.rally);
      } else if (ev.type === "point") {
        // THE-1184 S6: this match's first point arms the impact tip for the very next serve; only the
        // first point does anything here (the flag is one-shot per match).
        if (impactTipArmedForFirstPoint) {
          impactTipArmedForFirstPoint = false;
          pendingImpactTip = true;
        }
        audio.whistle();
        const scorer = ev.scorer;
        // THE-1156 S4 (board note 4, DESIGN.md §12.3): the "point!" moment. No sign on a smash point --
        // the smash takeover is that point's moment already. The 2nd whistle blast still plays either way.
        scheduleTimer("point-whistle2", 280, () => audio.whistle2());
        if (!ev.smash) {
          const conceder = 1 - scorer;
          // THE-1157 r1 fix: canvas.width/height are the backing-buffer px (device px at DPR > 1);
          // computeLayout wants CSS px, same as the --x/--y the DOM element actually renders at.
          const rect = canvas.getBoundingClientRect();
          const layout = computeLayout(rect.width, rect.height);
          const lineX = conceder === 0 ? layout.l : layout.r;
          const inward = conceder === 0 ? 1 : -1;
          const signX = lineX + inward * 0.17 * layout.cw;
          const crossY = Math.max(C.COURT_H * 0.22, Math.min(C.COURT_H * 0.78, match.ball.y));
          const signY = layout.t + crossY * layout.scale;
          const scorerHead = headById(headIds[scorer]);
          screens.showPointMoment(signX, signY, scorer, scorerHead ? scorerHead.name : "");
          scheduleTimer("point-moment-clear", 1100, () => screens.clearPointMoment());
        }
        if (ev.smash) { shakeAt.t = performance.now(); shakeAt.context = "play"; }
        // G13 comeback: the score is tied right now, and this scorer trailed by >= 3 at some
        // earlier point this match (not necessarily this one). Checked before the tracker updates.
        if (match.score[0] === match.score[1] && maxTrailEver[scorer] >= 3) {
          momentCandidates.push({ type: "comeback", side: scorer, headId: headIds[scorer] });
        }
        maxTrailEver[0] = Math.max(maxTrailEver[0], match.score[1] - match.score[0]);
        maxTrailEver[1] = Math.max(maxTrailEver[1], match.score[0] - match.score[1]);
        if (ev.smash) {
          momentCandidates.push({ type: "smash", side: scorer, headId: headIds[scorer], speedKmh: ev.speed * C.KMH_PER_US });
        }
      } else if (ev.type === "matchPoint") {
        audio.drumroll();
        momentCandidates.push({ type: "matchPoint", side: ev.side, headId: headIds[ev.side] });
      } else if (ev.type === "win") {
        shakeAt.t = performance.now();
        shakeAt.context = "win";
        momentCandidates.push({ type: "win", side: ev.winner, headId: headIds[ev.winner] });
        triggerConfetti();
      }
    }
    if (momentCandidates.length) {
      const { sched, fired } = Moments.requestMoment(momentsSched, momentCandidates, performance.now());
      momentsSched = sched;
      if (fired && fired.type !== "win") showMoment(fired); // the win shows on the result screen instead
    }
    match.events = [];
    if (match.state === "matchEnd") onMatchEnd();
  }
}

function squashScale(side) {
  const p = Math.min(1, (performance.now() - squashHitAt[side]) / SQUASH_MS); // 0 = just hit, 1 = settled
  return { x: 0.88 + 0.12 * p, y: 1.07 - 0.07 * p };
}

function shakeOffset() {
  if (!Fx.allowShake(fxCtrl)) return [0, 0];
  const elapsed = performance.now() - shakeAt.t;
  if (elapsed >= Fx.SHAKE_MAX_MS) return [0, 0];
  const amp = Fx.shakeAmplitude(shakeAt.context) * (1 - elapsed / Fx.SHAKE_MAX_MS);
  const phase = elapsed * 0.08;
  return [Math.sin(phase * 2.3) * amp, Math.cos(phase * 1.7) * amp];
}

const startTimeS = performance.now() / 1000;


function rgba(hex, a) {
  const c = hexToRgb(hex);
  return [c[0], c[1], c[2], a];
}

// THE-1119 M6: heads on matkas. The GL shader has no gradients or arcs, so the wood gradient, rim
// light and die-cut outline from recipe.js HEAD (full fidelity in render/headSprite.js, used by the
// pick screen's own canvas) are approximated here with flat-shaded, rotatable instances: a long cast
// shadow, a rotated grip, concentric rim/plum-ring/wood discs (a cheap 2-stop "gradient"), a golden
// face-glow wash, and the photo itself. `color` is the player-colour rgba array (colorForSide).
function pushHead(instances, side, cx, cy, scale, color, uv, opts = {}) {
  const d = HEAD.discU * scale, R = d / 2;
  const sqx = opts.sqx ?? 1, sqy = opts.sqy ?? 1;
  const sideSign = side === 0 ? 1 : -1; // "down and out of court": left swings toward -x, right toward +x

  // Long cast shadow (recipe.js HEAD.shadow), approximated as 3 tapering, fading ellipses since the
  // GL shader has no blur -- one hard-edged ellipse at the full offset reads as a floating blob, not
  // a soft shadow (THE-1119 r1).
  const sh = HEAD.shadow;
  for (const [f, a] of [[0.45, 0.22], [0.75, 0.14], [1, 0.08]]) {
    instances.push({
      x: cx + sh.dxOfD * d * f, y: cy + sh.dyOfD * d * f,
      w: sh.rxOfD * d * 2 * (0.7 + f * 0.3), h: sh.ryOfD * d * 2 * (0.7 + f * 0.3) * f,
      color: rgba(COLORS.shadow, a), shape: "circle",
    });
  }

  const grip = HEAD.grip;
  const angleRad = (sideSign * grip.angleDeg * Math.PI) / 180;
  const gw = grip.wOfR * R, gl = grip.lenOfR * R;
  const localY = R * 0.78 + gl / 2;
  const gx = cx - Math.sin(angleRad) * localY, gy = cy + Math.cos(angleRad) * localY;
  instances.push({ x: gx, y: gy, w: gw, h: gl, rotation: angleRad, color: hexToRgb(COLORS.grip), shape: "rect" });
  instances.push({ x: gx, y: gy, w: gw * 1.15, h: gl * 0.22, rotation: angleRad, color, shape: "rect" });

  const rOuterPlum = R + (HEAD.rimW + HEAD.plumRing) * d;
  const rOuterRim = R + HEAD.rimW * d;
  instances.push({ x: cx, y: cy, w: rOuterPlum * 2 * sqx, h: rOuterPlum * 2 * sqy, color: hexToRgb(COLORS.plum), shape: "circle" });
  instances.push({ x: cx, y: cy, w: rOuterRim * 2 * sqx, h: rOuterRim * 2 * sqy, color, shape: "circle" });
  instances.push({ x: cx, y: cy, w: d * sqx, h: d * sqy, color: hexToRgb(COLORS.wood), shape: "circle" });
  instances.push({ x: cx, y: cy, w: d * 0.78 * sqx, h: d * 0.78 * sqy, color: hexToRgb(COLORS.woodHi), shape: "circle" });

  const faceD = d * HEAD.headScale, faceY = cy + HEAD.headOffsetY * d;
  instances.push({ x: cx, y: faceY, w: faceD * 1.08 * sqx, h: faceD * 1.08 * sqy, color: rgba(HEAD.faceRimGlow.color, HEAD.faceRimGlow.alpha), shape: "circle" });
  if (uv) instances.push({ x: cx, y: faceY, w: faceD * 0.92 * sqx, h: faceD * 0.92 * sqy, color: [1, 1, 1, 1], shape: "circle", uv });
}

// THE-1119 M3: the ball -- cream fill, a plum outline that reads on bright sand, and a shadow that
// gives it height. Heat-tinted fill (recipe.js COLORS.heat); the warm streak itself comes from the
// trail-feedback buffer in render/gl.js (its decay is fixed to dt there), not from extra instances here.
function pushBall(instances, bx, by, scale, heat, heightNorm = 0) {
  const r = Math.max(BALL.minDrawPx, BALL.drawRU * scale);
  const heatColors = COLORS.heat[heat] || COLORS.heat[0];
  // THE-1142 S1 (board note 5): the shadow sits at the ball's ground position (bx, by) and scales/
  // fades/leans with heightNorm; the ball sprite itself is drawn lifted off it and a little larger, per
  // shadowFor's liftOfR/ballScale. 3 GL layers approximate blur (DESIGN.md §11.4), the same trick
  // pushHead's cast shadow already uses.
  const sh = shadowFor(heightNorm);
  const sx = bx + sh.dxOfR * r, sy = by + sh.dyOfR * r;
  for (const layer of sh.layers) {
    if (layer.alpha <= 0) continue;
    instances.push({
      x: sx, y: sy,
      w: sh.rxOfR * r * 2 * layer.sizeMult, h: sh.ryOfR * r * 2 * layer.sizeMult,
      color: rgba(COLORS.shadow, layer.alpha), shape: "circle",
    });
  }
  const ballR = r * sh.ballScale;
  const ballY = by - sh.liftOfR * r;
  if (heat === 2 && heatColors.glow) instances.push({ x: bx, y: ballY, w: BALL.glow.rOfR * ballR * 2, h: BALL.glow.rOfR * ballR * 2, color: rgba(heatColors.glow, 0.18), shape: "circle" });
  const outlinePx = Math.max(BALL.outline.minPx, BALL.outline.ofR * ballR);
  instances.push({ x: bx, y: ballY, w: (ballR + outlinePx) * 2, h: (ballR + outlinePx) * 2, color: hexToRgb(BALL.outline.color), shape: "circle" });
  instances.push({ x: bx, y: ballY, w: ballR * 2, h: ballR * 2, color: hexToRgb(heatColors.ballMid), shape: "circle" });
  instances.push({ x: bx + BALL.highlight.dxOfR * ballR, y: ballY + BALL.highlight.dyOfR * ballR, w: ballR * 0.7, h: ballR * 0.7, color: [1, 1, 1, 0.85], shape: "circle" });
}

// THE-1143 B2: the designer's pre-baked crowd sprites (render/crowd.js, DESIGN.md §11.5), drawn from
// the shared atlas like a head. "Main size" (the axis sizeOfD scales) is width for crab/gull, height
// for seller/walker, matching crowd.js's own BOX aspect boxes. Foot point is bottom-centre (gull: its
// centre), so the quad's drawn centre is offset up by half its height to plant the feet at the
// distraction's actual (sim) ground position. A 2-frame walk/wing cycle ticks on CROWD[kind].frameMs,
// wall-clock (cosmetic only, like the ball's bounce arc); the gull mirrors horizontally to fly left.
const DISTRACTION_MAIN_AXIS = { crab: "w", seller: "h", walker: "h", gull: "w" };
function pushDistraction(instances, d, scale, toPx) {
  const kind = DISTRACTION_KIND[d.type] || "crab";
  const recipe = CROWD[kind];
  const [cx, cy] = toPx(d.x, d.y);
  const frame = Math.floor(performance.now() / recipe.frameMs) % 2;
  const uv = headAtlas ? headAtlas.crowdUvOf(kind, frame) : null;
  const aspect = headAtlas ? headAtlas.crowdAspectOf(kind, frame) : 1;
  const mainU = recipe.sizeOfD * HEAD.discU * scale; // world "main size" -> screen px
  let drawW, drawH;
  if (DISTRACTION_MAIN_AXIS[kind] === "w") { drawW = mainU; drawH = mainU / aspect; }
  else { drawH = mainU; drawW = mainU * aspect; }
  if (d.vx < 0) drawW = -drawW; // THE-1149: every sprite faces its direction of travel (negative width flips the quad, not the uv)

  let centerY;
  if (kind === "gull") {
    // THE-1149 (DESIGN.md §11.5): the gull dives on a quadratic arc, lowest hN 0.4 at mid-court, and its
    // shadow is the §11.4 ball shadow with r = 0.13 S. hN comes from crossing progress along x, so live
    // play, replay samples and forceDistraction all draw it the same way.
    const span = C.COURT_W + 2 * CROSS_MARGIN_U;
    const p = Math.max(0, Math.min(1, (d.x + CROSS_MARGIN_U) / span));
    const hN = 0.4 + 0.6 * (2 * p - 1) ** 2;
    const r = 0.13 * mainU;
    const sh = shadowFor(hN);
    for (const layer of sh.layers) {
      if (layer.alpha <= 0) continue;
      instances.push({
        x: cx + sh.dxOfR * r, y: cy + sh.dyOfR * r,
        w: sh.rxOfR * r * 2 * layer.sizeMult, h: sh.ryOfR * r * 2 * layer.sizeMult,
        color: rgba(COLORS.shadow, layer.alpha), shape: "circle",
      });
    }
    centerY = cy - sh.liftOfR * r; // the gull's foot point is its centre
  } else {
    const sh = CROWD.shadow; // the flat ground pool under the feet
    instances.push({
      x: cx + sh.dxOfS * mainU, y: cy + sh.dyOfS * mainU,
      w: sh.rxOfS * mainU * 2, h: sh.ryOfS * mainU * 2,
      color: rgba(COLORS.shadow, sh.alpha), shape: "circle",
    });
    centerY = cy - Math.abs(drawH) / 2;
  }
  if (uv) instances.push({ x: cx, y: centerY, w: drawW, h: drawH, color: [1, 1, 1, 1], shape: "circle", uv });
  else instances.push({ x: cx, y: centerY, w: Math.abs(drawW), h: Math.abs(drawH), color: hexToRgb(COLORS.plum), shape: "circle" }); // atlas not loaded yet: a flat placeholder disc
}

// THE-1162 (DESIGN.md §12.5): the crowd entry bubble's anchor, in CSS px -- same reasoning as the F1
// point-sign fix (THE-1157): the .jm-bubble DOM node needs CSS px, not the canvas's backing-buffer
// scale, so this recomputes the layout from the canvas's CSS rect rather than draw()'s device-space one.
function distractionAnchorCss(d) {
  const rect = canvas.getBoundingClientRect();
  const layout = computeLayout(rect.width, rect.height);
  const [cx, cy] = [layout.courtX + d.x * layout.scaleX, layout.courtY + d.y * layout.scale]; // THE-1184 S6: x uses scaleX
  const kind = DISTRACTION_KIND[d.type] || "crab";
  const recipe = CROWD[kind];
  const aspect = headAtlas ? headAtlas.crowdAspectOf(kind, 0) : 1;
  const mainU = recipe.sizeOfD * HEAD.discU * layout.scale;
  const drawH = DISTRACTION_MAIN_AXIS[kind] === "w" ? mainU / aspect : mainU;
  let centerY;
  if (kind === "gull") {
    const span = C.COURT_W + 2 * CROSS_MARGIN_U;
    const p = Math.max(0, Math.min(1, (d.x + CROSS_MARGIN_U) / span));
    const hN = 0.4 + 0.6 * (2 * p - 1) ** 2;
    centerY = cy - shadowFor(hN).liftOfR * 0.13 * mainU;
  } else {
    centerY = cy - Math.abs(drawH) / 2;
  }
  return { kind, x: cx, top: centerY - Math.abs(drawH) / 2, bottom: centerY + Math.abs(drawH) / 2, layout };
}

// DESIGN.md §12.5 clamp: 8 px in from the court's sides, its top >= the court top + 4 px; if that would
// put the bubble on the sprite (a low-flying gull near the top wall), flip to .jm-bubble--below instead.
function distractionBubblePlacement(d) {
  const { kind, x, top, bottom, layout } = distractionAnchorCss(d);
  const marginTop = layout.t + 4;
  const cx = Math.max(layout.l + 8, Math.min(layout.r - 8, x));
  let y = top - 6, below = false;
  if (y < marginTop) { below = true; y = Math.max(marginTop, bottom + 6); }
  return { kind, x: cx, y, below };
}

function ballHeightNorm(nowMs) {
  // THE-1156 S2: one arc for the whole current paddle-to-paddle flight (render/arc.js), started at
  // startFlight() on serve launch or a hit -- a wall bounce never touches flightStartAt/flightMs.
  return Arc.flightHeightNorm(nowMs - flightStartAt, flightMs, CONTACT_HN);
}

function draw(dt = 1 / 60) {
  if (!renderer) return;
  const layout = computeLayout(canvas.width, canvas.height);
  const scale = layout.scale;
  const [shakeX, shakeY] = screen === "match" ? shakeOffset() : [0, 0];
  const toPx = (wx, wy) => [layout.courtX + wx * layout.scaleX + shakeX, layout.courtY + wy * scale + shakeY]; // THE-1184 S6: x uses scaleX
  // THE-1184 S1/THE-1185 (CTO review r3): the head disc's x now tracks the paddle's real zone position
  // instead of a fixed court-unit constant -- DESIGN.md §13.1's formula, in px (not world units, so the
  // disc's own size isn't stretched by scaleX): discCentrePx = frontFacePx - dir*R.
  const headDiscX = (side, paddleX) => {
    const dir = side === 0 ? 1 : -1;
    const frontFaceWorldX = paddleX + dir * (C.CAPSULE_THICK / 2);
    const frontFacePx = layout.courtX + frontFaceWorldX * layout.scaleX + shakeX;
    return frontFacePx - dir * layout.R;
  };
  const instances = [];
  let heat = 0;
  if (match && screen === "match") {
    heat = match.heat;
    for (let side = 0; side < 2; side++) {
      const p = match.paddles[side];
      const capsuleScale = p.capsuleScale || 1;
      const sq = squashScale(side);
      const hx = headDiscX(side, p.x);
      const [, hy] = toPx(0, p.y);
      const uv = headAtlas ? headAtlas.uvOf(headIds[side]) : null;
      pushHead(instances, side, hx, hy, scale * capsuleScale, colorForSide(side), uv, { sqx: sq.x, sqy: sq.y });
    }
    const [bx, by] = toPx(match.ball.x, match.ball.y);
    pushBall(instances, bx, by, scale, heat, ballHeightNorm(performance.now()));
    if (match.distraction) pushDistraction(instances, match.distraction, scale, toPx);
    // THE-1162: the entry bubble follows its distraction every frame while it's up (the sprite keeps
    // moving); it stops once that distraction's own clear timer removes the bubble (activeBubbleDistraction = null).
    if (activeBubbleDistraction && match.distraction === activeBubbleDistraction) {
      const { x, y, below } = distractionBubblePlacement(activeBubbleDistraction);
      screens.updateBubblePosition(x, y, below);
    }
    // THE-1141 DESIGN.md §11.2: the "אתם" tag stays in the HUD until the first point ends.
    const youSide = solo && match.score[0] + match.score[1] === 0 ? humanSide : null;
    screens.updateHud(match.score, match.rally, [headById(headIds[0])?.name || "", headById(headIds[1])?.name || ""], youSide);
  } else if (replayPlayback && screen === "replay") {
    // B1: the same paddle/ball draw as live play, fed from the re-sim trace instead of `match` -- no
    // heat glow/rings (the trace doesn't carry heat) and capsuleScale is always 1 (big head isn't
    // tracked in the trace; a minor fidelity simplification for the replay only).
    const sample = replaySample(replayPlayback);
    for (let side = 0; side < 2; side++) {
      const hx = headDiscX(side, sample.paddles[side].x);
      const [, hy] = toPx(0, sample.paddles[side].y);
      const uv = headAtlas ? headAtlas.uvOf(headIds[side]) : null;
      pushHead(instances, side, hx, hy, scale, colorForSide(side), uv, {});
    }
    const [bx, by] = toPx(sample.ball.x, sample.ball.y);
    pushBall(instances, bx, by, scale, 0);
    if (sample.distraction) pushDistraction(instances, sample.distraction, scale, toPx); // THE-1143 B1
  }

  const now = performance.now();
  let chromaticPx = 0, rippleAmount = 0;
  if (heat > 0 && Fx.allowChromaticVisual(fxCtrl)) {
    const [next, ok] = Fx.requestChromatic(fxCtrl, now);
    fxCtrl = next;
    if (ok) chromaticPx = heat === 2 ? 4 : 2;
  }
  if (heat > 0 && Fx.allowRipple(fxCtrl)) rippleAmount = heat === 2 ? 1 : 0.5;

  renderer.render(instances, [0.78, 0.7, 0.5], {
    tier: tiersCtrl.tier,
    chromaticPx,
    rippleAmount,
    timeS: now / 1000 - startTimeS,
    dt,
  });

  // THE-1123 M7: drawn after render(), straight onto the canvas (renderOverlay), not mixed into
  // `instances` -- see the note on renderOverlay in render/gl.js for why the trail/bloom chain and a
  // burst of fast confetti don't mix.
  const confettiInstances = [];
  pushConfetti(confettiInstances, toPx, now);
  if (confettiInstances.length) renderer.renderOverlay(confettiInstances);
}

function hexToRgb(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
}
theme.playerColors = theme.playerColors || ["#0FA3B1", "#E8457C"];

function frame(now) {
  const frameMs = now - last;
  let dt = Math.min(0.25, frameMs / 1000);
  last = now;
  if (renderer && renderer.isWebGL2 && frameMs > 0 && frameMs < 1000) tiersCtrl = Tiers.recordFrame(tiersCtrl, frameMs, now);
  if (screen === "replay" && replayPlayback) {
    replayPlayback.elapsedMs += dt * 1000;
    if (replayPlayback.elapsedMs >= replayPlayback.totalWallMs) finishReplay();
  }
  acc += dt;
  let steps = 0;
  while (acc >= DT && steps < 10) { tick(); acc -= DT; steps++; }
  updatePickCountdown();
  draw(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
setScreen("pick");
window.dispatchEvent(new CustomEvent("game:start"));
window.dispatchEvent(new CustomEvent("game:ready"));

// PWA offline (G18): sw.js is generated by `node tools/sw-build.mjs junkies-matkot`, registered only
// after the game itself is interactive (true at this point, right after first paint) so a slow
// install can't block the first paint.
// THE-1156 S5 (board note: version row + update reload): same pattern as games/all-in-chomp/register-
// sw.js + game.js buildVersion. A published update's sw.js claims the page immediately, but this page's
// already-running files are stale -- reload once, only between games (pick/result), never mid-match.
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register("sw.js", { scope: "./" }).catch(() => {});
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) return; // first install: nothing stale on screen
    reloadBetweenGames();
  });
}
function reloadBetweenGames() {
  if (screen === "pick" || screen === "result") location.reload();
  else setTimeout(reloadBetweenGames, 2000);
}

// DESIGN.md §12.6: "גרסה <hash>" in the About sheet, the first 8 chars of the cache's version hash
// ("פיתוח" with no cache, e.g. local dev over file:// or before the first install completes).
// THE-1157 r1 (non-blocking): sw.js's own CACHE_VERSION is the authoritative "what should be running"
// answer -- if that exact entry is actually in Cache Storage, show it; a stale leftover cache key from a
// prior version (not yet purged) must not shadow it.
const buildVersion = (async () => {
  let swVersion = null;
  try {
    const m = (await (await fetch("sw.js", { cache: "no-store" })).text()).match(/CACHE_VERSION = 'junkies-matkot-([0-9a-f]+)'/);
    swVersion = m ? m[1] : null;
  } catch {} // sw.js unreachable (file://, offline before first load)
  try {
    const keys = (await caches.keys()).filter((k) => k.startsWith("junkies-matkot-"));
    if (swVersion && keys.includes(`junkies-matkot-${swVersion}`)) return swVersion;
    if (keys.length) return keys[0].slice("junkies-matkot-".length);
  } catch {} // no Cache Storage (file://, private modes)
  return swVersion;
})();
buildVersion.then((v) => screens.setVersion(v ? v.slice(0, 8) : "פיתוח"));

// The test hook. Headless gates import sim/ directly; this hook is for browser/Playwright checks.
window.__pong = {
  seed(n) { startMatch(n); },
  step(n = 1) { for (let i = 0; i < n; i++) tick(); },
  setInput(p, y) { if (match) Sim.setInput(match, p, y); },
  state() {
    if (!match) return { screen, muted: save.get().muted };
    return {
      screen,
      state: match.state,
      score: match.score.slice(),
      ball: { x: match.ball.x, y: match.ball.y, vx: match.ball.vx, vy: match.ball.vy, speed: match.ball.speed },
      paddles: match.paddles.map((p) => ({ y: p.y, x: p.x, len: p.len, capsuleScale: p.capsuleScale })), // THE-1184 S1: x for the 2D-zone Playwright checks
      rally: match.rally,
      heat: match.heat,
      timeScale: match.timeScale,
      winner: match.winner,
      tier: tiersCtrl.tier,
      paused: isPaused,
      muted: save.get().muted,
    };
  },
  events() { return match ? match.events : []; },
  forceScore(l, r) {
    if (!match) return;
    match.score = [l, r];
    if (Math.max(l, r) >= C.WIN_SCORE) { match.state = "matchEnd"; match.winner = l > r ? 0 : 1; onMatchEnd(); }
  },
  pick() { return { ids: pickIds.slice(), ready: pickReady.slice() }; },
  setPick(side, id) { pickIds[side] = id; renderPickScreen(); },
  setTier(t) { tiersCtrl = Tiers.create(t); if (renderer) renderer.setTier(t); },
  reduceMotion(on) { setReduceMotion(!!on); save.setReduceMotion(!!on); screens.setPauseState(!!on, save.get().muted); },
  setPaused(on) { setPaused(!!on); },
  share() { return doShare(); },
  moments() { return momentsSched.log; },
  replay() { return match && replayRec ? Replay.resimulate(match.seed, replayRec) : null; },
  pendingTimerTags() { return [...activeTimers.keys()]; }, // test-only: B3's registry dedupe (THE-1117)
  fireMoment(type, side = 0) { showMoment({ type, side, headId: headIds[side] }); }, // test-only: THE-1142 S4's hold/skip timing, bypassing the natural trigger condition
  momentShowing() { return activeMomentType; }, // test-only: THE-1142 S4
  forceDistraction(type, x, y, vx = 0) { if (match) match.distraction = { type, x, y, vx, r: 55, lifetimeLeft: 4, triggered: false }; }, // test-only: THE-1142 S5, bypassing the 20s onboarding gate; vx (THE-1149) sets the facing
  heightNorm() { return ballHeightNorm(performance.now()); }, // test-only: THE-1156 S2, so a shots/QA script can poll the current flight's arc instead of guessing a wall-clock delay
};
