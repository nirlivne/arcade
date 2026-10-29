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
import { COLORS, HEAD, BALL, MOMENTS } from "./render/recipe.js";
import { createAudio } from "./audio.js";
import { buildCard, shareResult } from "./share.js";
import * as Tiers from "./render/tiers.js";
import * as Fx from "./render/fx.js";
import * as Moments from "./sim/moments.js";
import * as Cpu from "./sim/cpu.js";
import { createRng } from "./sim/rng.js";
import * as Replay from "./sim/replay.js";

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
let cpuController = null;
let cpuNowMs = 0;
let headColor = {}; // head id -> hex colour, D2-3: colour follows the head, not the side, across a swap
let isFirstMatchOfSession = true; // spec §5/D2-6: only the very first match waits for paddle movement

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
  toggleReady(side) { toggleReadyKey(side); },
  solo() {
    solo = true;
    const human = pickIds[0];
    const others = HEADS.filter((h) => h.id !== human);
    pickIds = [human, others[Math.floor(Math.random() * others.length)].id];
    renderPickScreen();
    scheduleTimer("soloDice", 600, () => { if (screen === "pick") beginMatchFromPick(); }); // the dice-spin beat (spec §5)
  },
  about(on = true) { toggleAbout(on); },
  toggleSound() { toggleMute(); },
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
  share() { doShare(); },
  replayAgain() { replayAgainFromResult(); },
});
const renderer = createRenderer(canvas);
loadAtlas(HEADS).then((atlas) => { headAtlas = atlas; if (renderer) renderer.setAtlas(atlas.canvas); });
let headAtlas = null;
if (renderer) {
  renderer.setTier(tiersCtrl.tier);
  if (!renderer.isWebGL2) tiersCtrl = Tiers.create("low"); // WebGL1 -> Low directly (G11), no Canvas2D fallback
  renderer.setOnRestore(() => { resizeCanvas(); if (headAtlas) renderer.setAtlas(headAtlas.canvas); });
}
canvas.addEventListener("webglcontextlost", () => setPaused(true));

function renderPickScreen() { screens.renderPick(pickIds, pickReady, save.get().muted); }
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
  } else {
    screens.el.pauseSheet.hidden = true;
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
// on our own timer, never animationend (that event doesn't fire under reduce-motion). ---
let momentHideAt = 0;
const MOMENT_DURATION_MS = { smash: 700, comeback: 1200, matchPoint: 500 };
function showMoment(fired) {
  const head = headById(fired.headId);
  if (!["smash", "comeback", "matchPoint"].includes(fired.type)) return;
  screens.showMoment(fired, {
    name: head ? head.name : "",
    line: head ? head.lines[0] : "",
    image: head ? head.image : "",
    speedKmh: fired.speedKmh,
  });
  momentHideAt = performance.now() + (MOMENT_DURATION_MS[fired.type] || 700);
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
const squashHitAt = [-Infinity, -Infinity]; // performance.now() of each side's last hit (wall clock, render-only)
const SQUASH_MS = 140;
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
  screen = name;
  screens.show(name === "swap" ? "match" : name); // swap reuses the match DOM, canvas-only transition
  if (name !== "match" && name !== "swap") { isPaused = false; screens.el.pauseSheet.hidden = true; }
  if (name === "pick") { pickReady = [false, false]; pickReadyAt = null; solo = false; renderPickScreen(); }
  touchState = Touch.createTouchState(match ? [match.paddles[0].y, match.paddles[1].y] : undefined);
  keysState = Keys.createKeysState(match ? [match.paddles[0].y, match.paddles[1].y] : undefined);
  arbiterState = Arbiter.createArbiterState();
}

function beginMatchFromPick() {
  headIds = [pickIds[0], pickIds[1]];
  pickIdsForMatch = headIds.slice();
  headColor = {};
  headColor[headIds[0]] = theme.playerColors[0];
  headColor[headIds[1]] = theme.playerColors[1];
  match = Sim.createMatch((seedParam || Date.now()) >>> 0);
  const armWait = isFirstMatchOfSession;
  if (armWait) { Sim.armFirstServeWait(match); isFirstMatchOfSession = false; }
  replayRec = Replay.attachRecorder(match, { firstServeWaitArmed: armWait });
  resetMoments();
  // M4: first match only. Solo has no guide on the CPU's side (it would never fade).
  if (armWait) { guideFaded = [false, solo]; screens.showGuides(isCoarsePointer(), solo); }
  if (solo) { cpuController = Cpu.create(1, createRng((match.seed ^ 0x9e3779b9) >>> 0)); cpuNowMs = 0; }
  else cpuController = null;
  setScreen("match");
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
  if (resultActionTaken) return;
  resultActionTaken = true;
  setScreen("swap");
  scheduleTimer("swap", 400, () => {
    if (screen !== "swap") return; // the player backed out (pause -> title) before this fired
    // Side-swap on rematch (G6) is a two-human "swap seats" cue; solo keeps the human on side 0
    // (touch.js/keys.js hard-wire solo input to half 0) and just re-picks a fresh CPU opponent.
    if (!solo) headIds = [headIds[1], headIds[0]];
    pickIdsForMatch = headIds.slice(); // headColor map is untouched: colour follows the head across the swap
    save.setLastPicks(headIds);
    match = Sim.createMatch((match.seed + 1) >>> 0);
    replayRec = Replay.attachRecorder(match);
    resetMoments();
    if (solo) { cpuController = Cpu.create(1, createRng((match.seed ^ 0x9e3779b9) >>> 0)); cpuNowMs = 0; }
    setScreen("match");
  }); // 0.4s swap tween (A4/D2-3); rematch-to-serve stays well under 1s
}
screens.el.rematchBtn.addEventListener("click", doRematch);
screens.el.changeHeadsBtn.addEventListener("click", () => setScreen("pick"));

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
  return { ball: { x: f.x, y: f.y }, paddles: [f.paddles[0], f.paddles[1]] };
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
    x: ((clientX - r.left) - layout.courtX) / layout.scale,
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

const touchCtx = () => ({ midlineX: C.COURT_W / 2, viewportH: window.innerHeight, solo });

function fadeGuideOnce(side) {
  if (guideFaded[side]) return;
  guideFaded[side] = true;
  screens.fadeGuide(side);
}
function onPointerDown(e) {
  if (screen !== "match") return;
  const te = pointerEventToTouchEvent("down", e);
  touchState = Touch.reduce(touchState, te, touchCtx());
  const side = te.x < touchCtx().midlineX ? 0 : 1;
  arbiterState = Arbiter.noteTouch(arbiterState, side);
  fadeGuideOnce(solo ? 0 : side); // solo: touch.js maps both halves to side 0
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
window.addEventListener("pointerdown", () => { if (screen === "replay") finishReplay(); }, { capture: true });

const LEFT_KEYS = new Set(["KeyW", "KeyS"]);
const RIGHT_KEYS = new Set(["ArrowUp", "ArrowDown"]);
// Keys auto-repeat while held (and a key can already be held when `replay` starts), so replay skip and
// rematch only count a fresh press (`!e.repeat`) -- unlike pointerdown, a held keydown is not a one-shot.
window.addEventListener("keydown", (e) => {
  if (screen === "match") {
    if (LEFT_KEYS.has(e.code)) { keysState = Keys.onKey(keysState, e.code, true); arbiterState = Arbiter.noteKeys(arbiterState, 0); fadeGuideOnce(0); }
    else if (RIGHT_KEYS.has(e.code)) { keysState = Keys.onKey(keysState, e.code, true); arbiterState = Arbiter.noteKeys(arbiterState, 1); fadeGuideOnce(1); }
    return;
  }
  if (screen === "replay") {
    if ((e.code === "Space" || e.code === "Enter") && !e.repeat) finishReplay();
    return;
  }
  if (screen === "pick") {
    // A1: the carousel keys (W/S/D, Up/Down/Left) keep working even while a centre tube has focus.
    // Enter is the one key a focused tube already handles itself (native button activation), so only
    // treat it as "both ready now" when nothing is focused, to avoid double-handling a tube's own Enter.
    const tubeFocused = document.activeElement && document.activeElement.classList?.contains("jm-tube");
    if (e.code === "KeyW") { cyclePick(0, -1); }
    else if (e.code === "KeyS") { cyclePick(0, 1); }
    else if (e.code === "ArrowUp") { cyclePick(1, -1); }
    else if (e.code === "ArrowDown") { cyclePick(1, 1); }
    else if (e.code === "KeyD") { toggleReadyKey(0); }
    else if (e.code === "ArrowLeft") { toggleReadyKey(1); }
    else if (e.code === "Enter" && !tubeFocused) { pickReady = [true, true]; renderPickScreen(); beginMatchFromPick(); }
    else if (e.code === "KeyC") { screens.el.soloBtn.click(); }
    return;
  }
  if (screen === "result") {
    if ((e.code === "Space" || e.code === "Enter") && !e.repeat && document.activeElement?.tagName !== "BUTTON") doRematch();
  }
  if (e.code === "Escape" && !screens.el.aboutSheet.hidden) toggleAbout(false);
});
window.addEventListener("keyup", (e) => {
  if (LEFT_KEYS.has(e.code) || RIGHT_KEYS.has(e.code)) keysState = Keys.onKey(keysState, e.code, false);
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
  paintBackdrop(backdropCanvas.getContext("2d"), computeLayout(w, h));
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
    Sim.setInput(match, 0, targets[0]);
    let target1 = targets[1];
    if (solo && cpuController) {
      const r = Cpu.update(cpuController, match, cpuNowMs);
      cpuController = r.cpu;
      cpuNowMs += DT * 1000;
      target1 = cpuController.targetY;
    }
    Sim.setInput(match, 1, target1);
    if (replayRec) Replay.recordTick(replayRec, [targets[0], target1]);
    Sim.step(match, DT);
    if (match.state !== lastMatchState) { tiersCtrl = Tiers.notifyStateChange(tiersCtrl, performance.now()); lastMatchState = match.state; }
    const momentCandidates = [];
    for (const ev of match.events) {
      if (ev.type === "hit") {
        squashHitAt[ev.side] = performance.now();
        audio.tok(match.rally);
      } else if (ev.type === "point") {
        audio.whistle();
        const scorer = ev.scorer;
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

// THE-1119 M6: the matka disc sits behind the capsule, not at the capsule's own centre (recipe.js
// HEAD.discCenterXU = 16 u; its court-side rim lands on the capsule front face at x 126 u).
const HEAD_DISC_X = [HEAD.discCenterXU, C.COURT_W - HEAD.discCenterXU];

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
function pushBall(instances, bx, by, scale, heat) {
  const r = Math.max(BALL.minDrawPx, BALL.drawRU * scale);
  const heatColors = COLORS.heat[heat] || COLORS.heat[0];
  instances.push({
    x: bx + BALL.shadow.dxOfR * r, y: by + BALL.shadow.dyOfR * r,
    w: BALL.shadow.rxOfR * r * 2, h: BALL.shadow.ryOfR * r * 2,
    color: rgba(COLORS.shadow, BALL.shadow.alpha), shape: "circle",
  });
  if (heat === 2 && heatColors.glow) instances.push({ x: bx, y: by, w: BALL.glow.rOfR * r * 2, h: BALL.glow.rOfR * r * 2, color: rgba(heatColors.glow, 0.18), shape: "circle" });
  const outlinePx = Math.max(BALL.outline.minPx, BALL.outline.ofR * r);
  instances.push({ x: bx, y: by, w: (r + outlinePx) * 2, h: (r + outlinePx) * 2, color: hexToRgb(BALL.outline.color), shape: "circle" });
  instances.push({ x: bx, y: by, w: r * 2, h: r * 2, color: hexToRgb(heatColors.ballMid), shape: "circle" });
  instances.push({ x: bx + BALL.highlight.dxOfR * r, y: by + BALL.highlight.dyOfR * r, w: r * 0.7, h: r * 0.7, color: [1, 1, 1, 0.85], shape: "circle" });
}

function draw(dt = 1 / 60) {
  if (!renderer) return;
  if (performance.now() >= momentHideAt || screen !== "match") screens.clearMoment();
  const layout = computeLayout(canvas.width, canvas.height);
  const scale = layout.scale;
  const [shakeX, shakeY] = screen === "match" ? shakeOffset() : [0, 0];
  const toPx = (wx, wy) => [layout.courtX + wx * scale + shakeX, layout.courtY + wy * scale + shakeY];
  const instances = [];
  let heat = 0;
  if (match && screen === "match") {
    heat = match.heat;
    for (let side = 0; side < 2; side++) {
      const p = match.paddles[side];
      const capsuleScale = p.capsuleScale || 1;
      const sq = squashScale(side);
      const [hx, hy] = toPx(HEAD_DISC_X[side], p.y);
      const uv = headAtlas ? headAtlas.uvOf(headIds[side]) : null;
      pushHead(instances, side, hx, hy, scale * capsuleScale, colorForSide(side), uv, { sqx: sq.x, sqy: sq.y });
    }
    const [bx, by] = toPx(match.ball.x, match.ball.y);
    pushBall(instances, bx, by, scale, heat);
    screens.updateHud(match.score, match.rally, [headById(headIds[0])?.name || "", headById(headIds[1])?.name || ""]);
  } else if (replayPlayback && screen === "replay") {
    // B1: the same paddle/ball draw as live play, fed from the re-sim trace instead of `match` -- no
    // heat glow/rings (the trace doesn't carry heat) and capsuleScale is always 1 (big head isn't
    // tracked in the trace; a minor fidelity simplification for the replay only).
    const sample = replaySample(replayPlayback);
    for (let side = 0; side < 2; side++) {
      const [hx, hy] = toPx(HEAD_DISC_X[side], sample.paddles[side]);
      const uv = headAtlas ? headAtlas.uvOf(headIds[side]) : null;
      pushHead(instances, side, hx, hy, scale, colorForSide(side), uv, {});
    }
    const [bx, by] = toPx(sample.ball.x, sample.ball.y);
    pushBall(instances, bx, by, scale, 0);
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
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js", { scope: "./" }).catch(() => {});
}

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
      paddles: match.paddles.map((p) => ({ y: p.y, len: p.len, capsuleScale: p.capsuleScale })),
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
};
