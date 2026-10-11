// Cannonball Family: screens, the fixed-step loop, keyboard and pointer aim, and the test hook (THE-449 S1–S2).
// The rules are in sim.js.
import { createLevel, fire, step, cloneSim, hash, fastForwardAim, randomShot, DT, tinsDown, FUSE_STEPS, CANNON, STAR_MAX, FIELD } from "./sim.js";
import { levelDef, LEVEL_COUNT, DEMO_SHOT } from "./levels.js";
import { continueLevel, progressTotals, isCleared } from "./progress.js";
import { chapterOf } from "./generator.js";
import { aimFrom, FULL_POWER_PX } from "./aim.js";
import { createSave } from "./save.js";
import { createCastStore } from "./family.js";
import { bindFamilySheet } from "./family-sheet.js";
import { draw, fitView, viewFromCamera, scaleForHeight, screenToWorld, worldToScreen, memberFor, loadPhotos } from "./render.js";
import { initCamera, stepCamera, skipToAim } from "./camera.js";
import { bindPull } from "./input.js";
import { dailyLevel, localDateKey, shareLine, ARCADE_URL } from "./daily.js";
import { DAILY_TABLE } from "./daily-table.js";
import { CBF } from "./troupe.js";
import * as audio from "./audio.js";
import { createCompositor } from "./gl.js";
import {
  initFx, stepFx, triggerRing, triggerCA, triggerFlash, ringState,
  triggerShake, triggerMuzzle, triggerFluff, triggerSplinters, triggerDust, triggerStoneSparks, triggerConfetti,
  shakeOffset, drawParticles,
} from "./fx.js";

let LEVEL = 1; // the level being played (1–30)
const MAX_CATCH_UP = 5 * DT; // spec §2: after a stall, at most 5 steps catch up (no burst)
const KEY_ANGLE = 1, KEY_POWER = 0.02; // spec §5 keyboard steps

const app = document.getElementById("cb-app");
const canvas = document.getElementById("cb-world");
const ctx = canvas.getContext("2d");

// THE-523 S4 / spec v2 §G1-G2: the GL compositor. ?gl=0 forces the 2D fallback (for QA and this file's own
// real-pointer tests); otherwise gl.js tries WebGL and reports back whether it actually got it. ?flat=1 (CTO
// review on THE-561 B3) zeroes the post pass's always-on grain/vignette/grade, test-only, so the S4 parity
// check can compare the GL and fallback paths' geometry alone - the look players actually see is unaffected.
const glCanvas = document.getElementById("cb-gl");
const glForcedOff = new URLSearchParams(location.search).get("gl") === "0";
const flatPost = new URLSearchParams(location.search).get("flat") === "1";
const compositor = glForcedOff ? null : createCompositor(glCanvas, canvas);
const fx = initFx();
function glActive() {
  return !!(compositor && compositor.state.ok);
}
function syncGlVisibility() {
  const on = glActive();
  glCanvas.hidden = !on;
  canvas.style.visibility = on ? "hidden" : "visible"; // the 2D canvas stays the scene buffer either way; only its own display toggles
}
const hud = document.getElementById("cb-hud");
const resultCard = document.getElementById("cb-result");
const resultHeadlineEl = document.getElementById("cb-result-headline");
const resultScoreEl = document.getElementById("cb-result-score");
const resultStarsEl = document.getElementById("cb-result-stars");
const resultWhoEl = document.getElementById("cb-result-who");
const resultPointsEl = document.getElementById("cb-result-points");
const resultNextBtn = document.getElementById("cb-btn-next");
const resultShareBtn = document.getElementById("cb-btn-share");
const resultRetryBtn = document.getElementById("cb-btn-retry");
const resultPair = document.getElementById("cb-result-pair");
const resultLevelsBtn = document.getElementById("cb-btn-result-levels");
const resultPatches = document.querySelector("#cb-result > .cbf-patches");
const T = window.THEME.text;

// theme.js re-skin (spec §8, AC-W7): the title, the [data-theme-text] copy and theme.colors (seat colours included,
// via --cbf-seat-* on :root) land on the page now, the image slots once they load. The title screen waits for the
// slots (see the end of this file), so the default cover never flashes before the edited one.
UIKit.applyTheme(window.THEME);
const themeReady = UIKit.loadImageSlots(window.THEME).then((slots) => {
  if (!slots.cover) return;
  slots.cover.className = "cbf-hero__cover";
  slots.cover.alt = "";
  document.querySelector("#cbf-title .cbf-hero").append(slots.cover);
});

let storage = null;
try { storage = window.localStorage; } catch (e) { storage = null; } // blocked storage: play on, nothing saved
const blank = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const save = createSave(storage ?? blank);
const castStore = createCastStore(storage ?? blank, window.THEME.familyName);
audio.setMuted(!save.settings().sound);

let cast = castStore.loadCast(); // the family: its size is the rail's F, its names show on the rail
// One Image per seat with a photo, null elsewhere; reloaded on save. onReady rebuilds the rail chips once a
// slow-to-decode photo is ready (render.js's own note): the main canvas redraws every frame regardless.
let photos = loadPhotos(cast, castStore, () => buildRail());
const plaqueName = document.getElementById("cb-plaque-name");
function showPlaque() {
  plaqueName.textContent = cast.family;
}
showPlaque();

let sim = createLevel(levelDef(LEVEL), { level: LEVEL, familySize: cast.members.length });
let inPlay = false; // false on the title screen: no pulls, no keys
let ended = false; // the result card is up
let manual = false; // true while a test drives the clock through __sim.pause or __sim.step
let paused = false; // tab hidden, or the Pause/How to play dialog is open (syncPaused() is the only writer)
let pull = null; // { start, now } while a pointer is down
let keyAim = { angle: 45, power: 0.6 }, keyActive = false; // keyboard aim, once an arrow key has been used
let peekHeld = false; // spec C3: true while the V key or the binoculars patch is held
let view = fitView(1, 1), dpr = 1;
// The play screen's own CSS-px box the world canvas gets (past the rail; see computeViewportBox()), separate
// from `view` (which also folds in the camera's current pan/zoom, recomputed every frame — see updateView()).
let viewportBox = { w: 1, h: 1, ox: 0, oy: 0, full: true };
let camera = null; // built fresh per level by startLevel/startDaily (initCamera); null before the first level loads
let retryShot = false; // this level's own first-vs-retry flag (spec C1's 0.8 s intro length), set in startLevel
let acc = 0, last = performance.now();

// The daily Family Tower (spec §2). dailyFirstAttempt is true only while today's result isn't saved yet: once it
// is, any further play of the day's tower is Practice and never writes. dailyShotsWritten tracks how many of
// sim.shots are already in the save, so a resumed replay doesn't re-record what it's replaying.
let dailyMode = false, dailyDate = null, dailyFirstAttempt = false, dailyShotsWritten = 0, lastDailyResult = null;

// Consecutive losses on a level, this session (DESIGN.md §5, spec §8 comforts: "after 2 fails on a level, the
// full arc shows for that level"). In-memory only, not saved: it's a per-session nudge, not a progress field,
// and a reload is itself a fresh start at a level anyway. Reset by a win; the daily tower doesn't use this.
const levelFails = {};

// The aim preview's arc fraction (DESIGN.md §5, spec §7 "Running-stitch aim line"): the full arc on levels 1–3
// and after 2 fails on this level, otherwise the first 35–40 % (CBF.aimStitch reads this as a 0–1 fraction).
function arcFraction() {
  if (dailyMode) return 1; // the daily is always short (2 ledges); the long-preview concern doesn't apply
  if (LEVEL <= 3 || (levelFails[LEVEL] ?? 0) >= 2) return 1;
  return 0.375; // the midpoint of the spec's 35–40 %
}

// The first-run demo (spec §5 "Controls and first 10 seconds", §I1; shown once, ever, on this device, on level
// 1 only). The real sim is frozen throughout (advance() never runs while demoPhase is set): nothing the player
// will actually play moves, so there's nothing to resolve early, and the fuse starts fresh only once it ends.
// §I1's own acceptance ("shows the intro pan, a pull, the flight follow and a tin going down, automatically
// once") is covered by a *cloned* sim (demoSim) that the "fire" phase fires and steps for real, same as a live
// shot - the clone means the player's own level 1 (tins standing, shotsLeft) never moves, but the camera and
// renderer, which both key off whichever sim's phase/flyer is "active", follow it exactly as they would a real
// flight. demoClock is wall-clock seconds since the current phase started, driving the captions, the hand loop
// and the ghost flight's own stepping.
let demoPhase = null; // null | "goal" (0-1.5s) | "rule" (1.5-3s) | "loop" (one pull) | "fire" (ghost flight + hold)
let demoClock = 0;
let demoSim = null, demoAcc = 0, demoShotPath = [];
const DEMO_RESULT_HOLD_MS = 700; // how long the demo holds on the downed tin before handing control to the player
const demoEl = document.getElementById("cb-demo");
const demoCaption = document.getElementById("cb-demo-caption");
const HAND_LOOP_MS = 1800; // one pull-back-and-release cycle of the felt hand

// Which sim the camera and the renderer should follow this frame: the real one, except mid-ghost-flight.
function activeSim() {
  return demoPhase === "fire" ? demoSim : sim;
}

function startDemo() {
  demoPhase = "goal";
  demoClock = 0;
  demoEl.hidden = false;
  demoCaption.hidden = false;
  demoCaption.textContent = T.demoGoal;
  positionDemoCaption();
}

// D2-3 (THE-595): skin.css's shared .cbf-caption top offset assumes the portrait rail-row layout (rail-h +
// plaque-h); in the landscape rail-as-left-column layout the Fuse plaque floats above that assumed stack, so
// the demo's own caption (unlike the brief knack caption, which is never shown mid-pull) needs a *measured*
// clearance under it, not an assumed one. Harmless before cb-play's curtain-open layout settles (bottom <= 0).
function positionDemoCaption() {
  const fuseBottom = plaqueFuse.getBoundingClientRect().bottom;
  demoCaption.style.top = fuseBottom > 0 ? `${fuseBottom + 12}px` : "";
}

function endDemo() {
  demoPhase = null;
  demoSim = null;
  demoShotPath = [];
  demoEl.hidden = true;
  demoCaption.hidden = true;
  demoCaption.style.top = "";
  save.markDemoSeen();
  updateRailState(); // hands the rail chips' is-now back to the real sim state
  last = performance.now(); // the fuse starts fresh from here, not from whenever startLevel ran
}

demoEl.addEventListener("pointerdown", endDemo);
document.getElementById("cb-demo-skip").addEventListener("click", (e) => { e.stopPropagation(); endDemo(); });

const RULE_CHIP_MS = 1500 / 5; // 5 is the default family size; a 6th (Teen) just gets caught in the last slot

// Advances the demo's own clock and caption/hand/rail-chip/ghost-flight state. Runs every frame while
// demoPhase is set, independent of advance()/step() on the real sim (which never moves during the demo).
function tickDemo(dtMs) {
  demoClock += dtMs;
  if (demoPhase === "goal" || demoPhase === "rule") positionDemoCaption(); // re-measured each tick: cb-play's own layout isn't settled yet the instant startDemo() runs, mid curtain-open
  if (demoPhase === "goal" && demoClock >= 1500) {
    demoPhase = "rule";
    demoClock = 0;
    demoCaption.textContent = T.demoRule;
  } else if (demoPhase === "rule") {
    // "The rail chips light one by one" (spec §5): is-now sweeps left to right across the rail, independent
    // of sim.N - sim.shotsLeft (updateRailState skips this phase so it can't fight this loop over the class).
    const lit = Math.min(railEl.children.length - 1, Math.floor(demoClock / RULE_CHIP_MS));
    [...railEl.children].forEach((li, i) => li.classList.toggle("is-now", i === lit));
    if (demoClock >= 1500) { demoPhase = "loop"; demoClock = 0; demoCaption.hidden = true; }
  } else if (demoPhase === "loop" && demoClock >= DEMO_PULL_MS + DEMO_HOLD_MS) {
    // The pull has released: fire the one scripted shot on a clone, instead of resetting to pull again forever.
    demoPhase = "fire";
    demoClock = 0;
    demoAcc = 0;
    demoShotPath = [];
    demoSim = cloneSim(sim);
    fire(demoSim, DEMO_SHOT.angle, DEMO_SHOT.power, "demo");
  } else if (demoPhase === "fire") {
    if (demoSim.phase === "flight" || demoSim.phase === "bow") {
      demoAcc = Math.min(demoAcc + dtMs / 1000, MAX_CATCH_UP);
      while (demoAcc >= DT) { step(demoSim, 1); demoAcc -= DT; }
      if (demoSim.phase === "flight" && demoSim.flyer) demoShotPath.push({ x: demoSim.flyer.x, y: demoSim.flyer.y });
    } else if (demoClock >= DEMO_RESULT_HOLD_MS) {
      endDemo(); // the ghost shot has resolved (a tin down) and held long enough to read; hand control back
    }
  }
}

// The rail's own screen-space footprint, read from its live layout rather than duplicating skin.css's
// breakpoints here: top plank (portrait, and landscape taller than 520px — spec's 1280×720 row) shrinks the
// height fitView gets; a landscape phone's left column (spec's 844×390 row, skin.css's own breakpoint)
// shrinks the width instead. Reading the real element keeps this correct if the designer ever retunes the
// breakpoints or --rail-h/--rail-w, with nothing here to fall out of sync. Only while cb-play is the active
// screen, though: #cb-world is one canvas shared by every screen (the tent is drawn full-bleed behind all of
// them, spec §6 "never black bars"), and the rail is display:none the rest of the time, so its rect would
// read zero there — fitting against it anyway would shrink the world on the title/map/result for no reason.
// railEl itself is declared further down (buildRail/updateRailState's own home), reused here.
const playScreenEl = document.getElementById("cb-play");
// The CSS-px box the world canvas gets on cb-play (past the rail), or the full canvas elsewhere (full: true,
// decorative screens have no rail to dodge). Recomputed on resize/screen-change only — the rail's own layout
// doesn't move mid-level, unlike the camera (updateView() below, which runs every frame).
function computeViewportBox() {
  const w = app.clientWidth, h = app.clientHeight;
  if (!playScreenEl.classList.contains("is-active")) return { w, h, ox: 0, oy: 0, full: true };
  const railRect = railEl.getBoundingClientRect();
  const railIsColumn = railRect.height > railRect.width; // the left-column layout is taller than it is wide
  return {
    w: railIsColumn ? w - railRect.width : w,
    h: railIsColumn ? h : h - railRect.height,
    ox: railIsColumn ? railRect.width : 0,
    oy: railIsColumn ? 0 : railRect.height,
    full: false,
  };
}
// view = the camera (gameplay) or the decorative default (fitView), fit into viewportBox and re-offset past
// the rail — the camera itself only ever thinks in the box it's given, never the full canvas (THE-523).
function updateView() {
  const fitted = viewportBox.full ? fitView(viewportBox.w, viewportBox.h) : viewFromCamera(camera, viewportBox.w, viewportBox.h);
  view = { ...fitted, ox: fitted.ox + viewportBox.ox, oy: fitted.oy + viewportBox.oy };
}
function resize() {
  dpr = window.devicePixelRatio || 1;
  const w = app.clientWidth, h = app.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  if (compositor) compositor.resize(w, h); // glCanvas already fills the box via .cb-world's own CSS (inset:0, 100%/100%)
  viewportBox = computeViewportBox();
  updateView();
}

// The single place a screen change happens, so inPlay can never stay true behind a screen that isn't the
// play screen (CTO review: R and Space/Enter otherwise leaked through to a level behind the map, the title
// or the "Our family" sheet, since inPlay was only ever set true on startLevel/startDaily and never reset).
// Swaps the active screen behind the curtains (DESIGN.md §9 "Screen change"; skin.css's own usage comment on
// .cbf-curtains): close, swap the screen classes while hidden, open. transitionend is the normal path; the
// timeout is the fallback for prefers-reduced-motion (skin.css sets the close/open transition to 0ms there,
// so transitionend may fire before the listener attaches, or not fire meaningfully at all) and for a test
// harness driving the clock manually, where no real transition runs.
const curtains = document.getElementById("cb-curtains");
function applyScreen(id) {
  for (const s of document.querySelectorAll(".cb-screen")) s.classList.toggle("is-active", s.id === id);
  if (window.UIKit) window.UIKit.showScreen(id);
  inPlay = id === "cb-play";
  resize(); // the rail only occupies space on cb-play (see resize's own note); re-fit now that is-active changed
  // The result stage canvas reads its own element's clientWidth/Height (CTO review: calling this synchronously
  // from checkEnd(), right after showScreen(), ran before the curtain had actually applied is-active — the
  // normal case, not the very-first-screen one — so the stage read a 0×0 box and drew nothing). This is the
  // one place is-active genuinely lands, so it's the right place to (re)draw a screen that depends on it.
  if (pendingResultDraw && (id === "cbf-call" || id === "cbf-fail" || id === "cbf-daily")) {
    const draw1 = pendingResultDraw;
    pendingResultDraw = null;
    draw1();
  }
}
let pendingResultDraw = null; // set by checkEnd() just before showScreen(); consumed by applyScreen() above
let screenShown = false; // false until the very first showScreen call: nothing to close over yet, so no curtain
let pendingOpen = null; // the in-flight transition's own open(), if a screen change is still closing/opening
// THE-523 / spec v2 §C7 (THE-527 feel check): the camera's intro clock is frozen until the curtain has fully
// finished its reopen transition, not just started it (see markCurtainOpen below) - the feel check measured
// the fort's own 0.6s hold being entirely hidden under the curtain otherwise.
let curtainOpen = false;
function markCurtainOpen() {
  let done = false;
  const finish = () => { if (done) return; done = true; curtainOpen = true; };
  curtains.addEventListener("transitionend", finish, { once: true });
  setTimeout(finish, 480); // --dur-slow (420ms) + slack, the same fallback pattern as showScreen's own open()
}
function showScreen(id) {
  if (!screenShown) { screenShown = true; applyScreen(id); curtainOpen = true; return; } // no curtain cycle yet to wait for
  if (pendingOpen) {
    // A second screen change landed before the first one's curtain finished (e.g. two showScreen calls in the
    // same synchronous task, as checkEnd() can produce right after a level loads via the test hook): swap to
    // this id instead when the curtain opens, rather than running two independent close/open cycles or — the
    // bug this replaced — silently applying the new screen without ever clearing is-closed, leaving the
    // curtain stuck shut because the first cycle's own open() was still the only thing that would clear it.
    pendingOpen.id = id;
    return;
  }
  curtainOpen = false;
  curtains.classList.add("is-closed");
  const pending = { id, opened: false };
  pendingOpen = pending;
  const open = () => {
    if (pending.opened) return;
    pending.opened = true;
    applyScreen(pending.id);
    curtains.classList.remove("is-closed");
    if (pendingOpen === pending) pendingOpen = null;
    markCurtainOpen();
  };
  curtains.addEventListener("transitionend", open, { once: true });
  setTimeout(open, 480); // --dur-slow (420ms) + slack, in case transitionend doesn't fire
}

// The member on the next slot, by name (the rail chips and the flight label come with the skin in S6).
function nextName() {
  const slot = sim.rail[sim.N - sim.shotsLeft];
  return slot ? cast.members[slot.member].name : "";
}

// Restart (and the R key) is free before the daily's first shot, and hidden for the rest of the first attempt
// (spec O13 = a): a closed tab can't reroll the day, and it can't cost a child the day either.
function canRestart() {
  return !dailyMode || !dailyFirstAttempt || sim.shotsLeft === sim.N;
}

const railEl = document.getElementById("cb-rail");
const plaqueLevel = document.getElementById("cb-plaque-level");
const plaqueFuse = document.getElementById("cb-plaque-fuse");

// The troupe rail (DESIGN.md section 7): one chip per shot, in firing order. Each member's head is drawn once per
// level (it doesn't change mid-level); only is-now/is-flown/the star toggle every frame, in updateRailState.
function buildRail() {
  railEl.replaceChildren(...sim.rail.map((slot, i) => {
    const li = document.createElement("li");
    li.className = "cbf-chip";
    if (slot.knack) li.dataset.knack = slot.knack;
    const headCanvas = document.createElement("canvas");
    headCanvas.className = "cbf-chip__head";
    headCanvas.width = 40;
    headCanvas.height = 40;
    const hctx = headCanvas.getContext("2d");
    CBF.head(hctx, 20, 20, { m: memberFor(cast, slot.member, photos), size: 34, expr: "ready" });
    li.append(headCanvas);
    if (slot.knack) { const knackIcon = document.createElement("i"); knackIcon.className = "cbf-chip__knack"; li.append(knackIcon); }
    if (i >= sim.N - sim.cap) { const star = document.createElement("i"); star.className = "cbf-chip__star"; li.append(star); }
    return li;
  }));
}

// Cheap, every frame: which chip is loaded now, which have already flown. No redraw (skin.css hides the star and
// dims the head via these classes).
function updateRailState() {
  if (demoPhase === "rule") return; // tickDemo owns is-now during "the rail chips light one by one"
  const now = sim.N - sim.shotsLeft;
  [...railEl.children].forEach((li, i) => {
    li.classList.toggle("is-now", i === now && sim.phase === "aim");
    li.classList.toggle("is-flown", i < now);
  });
}

function updateHud() {
  const fuseSecs = Math.ceil(sim.fuse / 120);
  const label = dailyMode ? (dailyFirstAttempt ? T.dailyLabel : T.practice) : `${T.level} ${LEVEL}`;
  const bestPart = dailyMode ? "" : ` · ${T.best} ${save.best(LEVEL)}`;
  hud.textContent = `${label} · ${T.next} ${nextName()} · ${T.shots} ${sim.shotsLeft} · ${T.fuse} ${fuseSecs} s${bestPart}`;
  plaqueLevel.textContent = label;
  plaqueFuse.textContent = `${T.fuse} ${fuseSecs} s`;
  updateRailState();
  document.getElementById("cb-btn-retry").hidden = !canRestart();
  document.getElementById("cb-btn-pause-restart").hidden = !canRestart();
}

// The fort's own centre (midpoint of every ledge/tin/stone x), for camera.js's fortX (spec C1/C2/C4).
function fortCenterX(def) {
  const xs = [];
  for (const L of def.ledges) xs.push(L.x0, L.x1);
  for (const t of def.tins) xs.push(t.x);
  for (const s of def.stones || []) xs.push(s.x);
  for (const d of def.drums || []) xs.push(d.x); // THE-523 S2: drums are a target too (spec v2 §D)
  return (Math.min(...xs) + Math.max(...xs)) / 2;
}

// The aim frame's own camera x: the one where the cannon lands 18% in from the left edge of the current
// viewport box (spec C2). Scale only depends on the box's height (render.js's scaleForHeight), never its x pan,
// so this has no circular dependency on the camera it's computing.
function aimCameraX(box) {
  const scale = scaleForHeight(box.h, 1);
  return CANNON.x + 0.32 * box.w / scale;
}

// Levels/the daily already started at least once this session get the shorter 0.8 s retry intro pan (spec
// C1); a fresh level or the day's first attempt gets the full 1.4 s. Session-only (not saved): a reload is
// itself a fresh start at whatever it loads.
const startedLevels = new Set();
let dailyStarted = false;

// Starts level n (default: the one Play continues at). A fresh attempt of that level.
// defOverride (test hook only, see __sim.loadCustom): plays a def directly instead of levelDef(n)'s own table,
// for a dev/QA scenario that isn't one of the 30 real levels (THE-523 S2's drum/crate checks, for example).
function startLevel(n = LEVEL, defOverride = null) {
  dailyMode = false;
  LEVEL = n;
  sim = createLevel(defOverride || levelDef(LEVEL), { level: LEVEL, familySize: cast.members.length });
  retryShot = startedLevels.has(n);
  startedLevels.add(n);
  camera = initCamera(fortCenterX(sim.def));
  inPlay = true;
  ended = false;
  pull = null;
  tags = [];
  tagTins = [];
  lastDrumHp = [];
  lastCrateHp = [];
  lastCracked = 0;
  lastStonesList = sim.stones;
  shotPath = [];
  lastShotPath = [];
  acc = 0;
  last = performance.now();
  resultCard.classList.remove("is-active");
  showScreen("cb-play");
  buildRail();
  updateHud();
  if (n === 1 && !save.demoSeen()) startDemo(); else { demoPhase = null; demoEl.hidden = true; }
}

// Starts (or resumes) today's Family Tower. The first attempt counts; a reload mid-attempt resumes it by
// fast-forwarding to each saved shot's step and firing it, which lands on the same hash as an unbroken run
// (spec O13 = a). Once the first attempt is done, any further play of the day's tower is Practice.
function startDaily() {
  dailyDate = localDateKey(new Date());
  const def = dailyLevel(dailyDate, DAILY_TABLE);
  // dailyLevel() only returns null if DAILY_TABLE's own row 0 isn't solved yet (THE-535: every other null row
  // falls back to a known-good one) - nothing playable to start, so fall back to the level map instead of
  // crashing on def.N below.
  if (!def) { openMap(); return; }
  dailyMode = true;
  const saved = save.loadDaily();
  const resuming = !!(saved && saved.date === dailyDate && !saved.done);
  dailyFirstAttempt = !(saved && saved.date === dailyDate && saved.done);
  // Share reads lastDailyResult (CTO review on THE-449): it was only ever set at the end of a first attempt
  // in this same session, so Share did nothing after a reload straight into today's already-done tower (a
  // Practice end then showed Share, but shareResult() found lastDailyResult still null and returned early).
  if (!dailyFirstAttempt) lastDailyResult = { won: saved.won, stars: saved.stars, score: saved.score, shotsUsed: saved.shots.length, totalShots: def.N };
  sim = createLevel(def, { level: def.level, familySize: cast.members.length });
  retryShot = dailyStarted;
  dailyStarted = true;
  camera = initCamera(fortCenterX(sim.def));
  dailyShotsWritten = 0;
  if (resuming) {
    for (const s of saved.shots) {
      fastForwardAim(sim, s.step - sim.step);
      // A fuse-fired shot drew the rng twice for its angle and power (randomShot, sim.js); an unbroken run
      // draws it there too, so a replay that skips straight to fire() leaves the rng one draw short forever
      // after (CTO review on THE-449: the hash right after a replay matched, but the *next* fuse shot then
      // diverged). Draw it here to match, and check it lines up with what was actually fired and saved.
      if (s.source === "fuse") {
        const drawn = randomShot(sim);
        if (Math.abs(drawn.angle - s.angle) > 1e-9 || Math.abs(drawn.power - s.power) > 1e-9) {
          throw new Error(`daily resume: rng drift replaying a fuse shot (drew ${drawn.angle}/${drawn.power}, saved ${s.angle}/${s.power})`);
        }
      }
      fire(sim, s.angle, s.power, "replay");
      for (let i = 0; i < 5000 && (sim.phase === "flight" || sim.phase === "bow"); i++) step(sim, 1);
    }
    dailyShotsWritten = saved.shots.length;
  }
  inPlay = true;
  ended = false;
  pull = null;
  // Reflects the resumed tins' down state already, so a tag doesn't pop for a tin that went down before the
  // reload (tags are for what happens live, not for replaying the resumed shots' history).
  tagTins = sim.tins.map((t) => t.down);
  lastDrumHp = sim.drums.map((d) => d.hp ?? 0);
  lastCrateHp = sim.ledges.map((L) => (L.crate ? L.hp ?? 0 : undefined));
  lastCracked = sim.cracked; // CTO review on THE-561 (B2): a resume can replay shots that already cracked a
  lastStonesList = sim.stones; // stone, same as lastDrumHp/lastCrateHp above reading the resumed sim's own state
  tags = [];
  shotPath = [];
  lastShotPath = [];
  acc = 0;
  last = performance.now();
  resultCard.classList.remove("is-active");
  showScreen("cb-play");
  buildRail();
  updateHud();
}

// The daily save's own source alphabet (CTO review on THE-449): only what the game itself can fire during
// play, sanitised in case a future caller ever passes something else through fire()'s free-text source.
const DAILY_SOURCES = new Set(["aim", "keys", "fuse", "fuse-held"]);

// Appends any shots fired since the last check to the daily save, one write each (AC-P5). Practice never calls
// this (dailyFirstAttempt is false by then), so it never writes. source is saved so a resume can tell a
// fuse-fired (random) shot from an aimed one and draw the rng to match (see startDaily's resume branch).
function recordNewDailyShots() {
  if (!dailyMode || !dailyFirstAttempt) return;
  while (dailyShotsWritten < sim.shots.length) {
    const s = sim.shots[dailyShotsWritten];
    const source = DAILY_SOURCES.has(s.source) ? s.source : "aim";
    save.appendDailyShot(dailyDate, { angle: s.angle, power: s.power, step: s.step, source });
    dailyShotsWritten += 1;
  }
}

// Fills in a template string's one {placeholder} (theme.js keeps re-skin text as plain strings; this is the
// one spot that needs a value spliced in, so a tiny inline substitution beats pulling in a template library).
function fillTemplate(str, key, value) {
  return str.replace(`{${key}}`, value);
}

// Builds "Gramps and Kid" from a list of names (DESIGN.md §8's own card example), for the "didn't need to
// fly" line. Never more than a few names (family size is capped at 6), so a plain Oxford-less join is enough:
// "A", "A and B", "A, B and C".
function joinNames(names) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// The rail members whose own slot never fired this run (sim.stars = min(shotsLeft, cap), the same count the
// star row itself shows): the last shotsLeft slots in rail order never got to sim.N - sim.shotsLeft's own
// "about to fire" position. Returns cast member indices, de-duplicated (a short rail can repeat a member
// across levels, though not within one level's own N <= family size in practice).
function unflownMembers() {
  const unflownSlots = sim.rail.slice(sim.N - sim.shotsLeft);
  return [...new Set(unflownSlots.map((slot) => slot.member))];
}

// The curtain call / fail card's family row (DESIGN.md §8: "the whole family bowing ... stars pinned on the
// members who didn't fly" / shrugging on a loss). Drawn once per result, not every frame (the card is static;
// re-running this on resize would be the only reason to redo it, which the viewport pass doesn't exercise
// here since the result screen isn't resized mid-display in any test or real flow).
const resultCanvas = document.getElementById("cb-result-canvas");
function drawResultStage(won, unflown) {
  const stageEl = document.getElementById("cb-result-stage");
  const w = stageEl.clientWidth || 1, h = stageEl.clientHeight || 1;
  const localDpr = window.devicePixelRatio || 1;
  resultCanvas.width = Math.round(w * localDpr);
  resultCanvas.height = Math.round(h * localDpr);
  const rctx = resultCanvas.getContext("2d");
  rctx.setTransform(localDpr, 0, 0, localDpr, 0, 0);
  rctx.clearRect(0, 0, w, h);
  CBF.tokens();
  const n = cast.members.length;
  const size = Math.max(44, Math.min(72, w / (n + 1)));
  const y = h * 0.62;
  cast.members.forEach((m, i) => {
    const x = w * ((i + 1) / (n + 1));
    CBF.flyer(rctx, x, y, { m: memberFor(cast, i, photos), size, pose: won ? "bow" : "shrug", pinStar: won && unflown.includes(i) });
  });
}

// Runs once when a shot ends the level (or the day's tower): the result is saved, then the result card shows.
// outcome (used only for the headline/who/score fields below) is "won" or "lost"; dailyMode picks its own
// branch regardless, same as before.
function checkEnd() {
  if (ended || (sim.phase !== "won" && sim.phase !== "lost")) return;
  ended = true;
  const won = sim.phase === "won";
  let newBest = false; // a level result that beats the saved best (set in the level branch below)
  if (won) {
    audio.playCurtainCall(); // drum roll + cymbal (DESIGN.md §10), the win-only curtain call
    triggerCA(fx, 1.6); // spec v2 G3: a clear
    triggerFlash(fx, 0.6);
    // D2-1 (THE-595): sim.def.W is only ever set for a hand-placed def (level 1); every generated level left it
    // undefined, so x1 was NaN here and all 80 pieces spawned at the same degenerate x - the "dark clump at one
    // point" the sign-off caught. sim.world.b.r is the same right bound boundsFor() already computed for the
    // physics world, so it's right for every level. CBF.FXP.confetti.cols is the spec's own confetti palette.
    triggerConfetti(fx, CANNON.x, sim.world.b.r, -200, CBF.FXP.confetti.cols);
  }
  const unflown = unflownMembers();
  const whoText = won && unflown.length ? fillTemplate(T.didntFly, "names", joinNames(unflown.map((i) => cast.members[i].name))) : "";

  function setStars(lit, cap) {
    resultStarsEl.replaceChildren(...Array.from({ length: cap }, (_, i) => {
      const star = document.createElement("i");
      star.className = "cbf-star" + (i < lit ? " is-lit" : " is-cap");
      return star;
    }));
  }

  // Retry is one element for every outcome (CTO review history on THE-449: keeping a single button, not one
  // per screen, is what already lets every real-pointer test click #cb-btn-retry regardless of win/loss/daily).
  // It's the full-width primary slot on a loss, and folded into the secondary pair (as "Again"/"Practice")
  // next to Levels otherwise; moving it in the DOM is what cbf-patch--lg's own grid-column rules key off.
  // resultLevelsBtn is a stable module-scope reference, not assumed to be resultPair's firstElementChild: a
  // previous call can leave resultRetryBtn itself sitting first in resultPair, which made that assumption
  // wrong on the very next result screen (CTO review: insertBefore threw, the node wasn't resultPair's child).
  function placeRetry(primary, label) {
    resultRetryBtn.hidden = false;
    resultRetryBtn.textContent = label;
    resultRetryBtn.classList.toggle("cbf-patch--lg", primary);
    resultRetryBtn.classList.toggle("cbf-patch--navy", !primary);
    if (primary) resultPatches.insertBefore(resultRetryBtn, resultPair);
    else resultPair.insertBefore(resultRetryBtn, resultLevelsBtn);
  }

  // Which of the skin's three result ids this outcome gets (DESIGN.md §7: #cbf-call / #cbf-fail / #cbf-daily,
  // THE-475): the one section is relabelled before showScreen() so the skin's per-outcome grid layout picks
  // it up — showScreen matches by the live id, so this has to happen before that call, not after. resultCard
  // is the cached reference from module scope (CTO review: a second getElementById("cb-result") here returns
  // null once the first call has already renamed it away from that id).
  const resultId = dailyMode ? "cbf-daily" : won ? "cbf-call" : "cbf-fail";
  resultCard.id = resultId;

  if (dailyMode) {
    const wasFirstAttempt = dailyFirstAttempt; // capture before finishDaily flips it below
    if (wasFirstAttempt) {
      save.finishDaily(dailyDate, { won, stars: sim.stars, score: sim.score });
      dailyFirstAttempt = false;
    }
    // Share always reports the first attempt (spec O13 = a), never a Practice replay (CTO review — this used
    // to be set on every daily end, so Share after a Practice run reported the Practice result, not the
    // day's). A Practice end reads the saved first-attempt result back instead of using this run's own.
    // shotsUsed/totalShots feed the share line's "N/N" (spec v2 §E4); totalShots is always the current sim.N,
    // even on a Practice read, since the same daily def is deterministic and replays to the same N.
    const practiceSaved = wasFirstAttempt ? null : save.loadDaily();
    const shown = wasFirstAttempt
      ? { won, stars: sim.stars, score: sim.score, shotsUsed: sim.N - sim.shotsLeft, totalShots: sim.N }
      : { ...practiceSaved, shotsUsed: practiceSaved.shots.length, totalShots: sim.N };
    if (wasFirstAttempt) lastDailyResult = shown; // Practice leaves it exactly as the first attempt set it
    resultHeadlineEl.textContent = (shown.won ? fillTemplate(T.win, "family", cast.family) : T.lose) + (wasFirstAttempt ? "" : ` · ${T.practice}`);
    resultScoreEl.textContent = shareLine(dailyDate, shown).split("\n")[0];
    setStars(shown.stars, sim.cap);
    resultWhoEl.textContent = "";
    resultPointsEl.textContent = "";
    resultNextBtn.hidden = true;
    resultShareBtn.hidden = false;
    placeRetry(false, T.practice);
  } else {
    const bestWas = save.best(LEVEL);
    save.saveResult(LEVEL, { score: sim.score, stars: sim.stars });
    newBest = save.best(LEVEL) > bestWas;
    resultHeadlineEl.textContent = won ? fillTemplate(T.win, "family", cast.family) : T.lose;
    resultScoreEl.textContent = `${T.level} ${LEVEL} · ${tinsDown(sim)}/${sim.tins.length}`;
    setStars(sim.stars, sim.cap);
    resultWhoEl.textContent = whoText;
    resultPointsEl.textContent = String(sim.score);
    resultNextBtn.hidden = !(won && LEVEL < LEVEL_COUNT);
    resultShareBtn.hidden = true;
    placeRetry(!won, T.retry);
    levelFails[LEVEL] = won ? 0 : (levelFails[LEVEL] ?? 0) + 1; // the full-arc comfort kicks in at 2
  }
  document.getElementById("cb-share-msg").textContent = "";
  // spec v2 §H1: shown once, ever, the first curtain call after a v1 -> schema 2 save migration.
  document.getElementById("cb-result-migration").textContent = save.consumeMigrationNotice() ? T.migrationNotice : "";
  pendingResultDraw = () => drawResultStage(won, unflown);
  showScreen(resultId);
  // Celebration (AC-W6): a win or a new best. ui-kit draws the confetti, or a soft glow under reduced motion.
  // D2-1 (THE-595): the spec's own confetti palette (CBF.FXP.confetti in troupe.js) and spread across the top
  // edge, not ui-kit's generic token colours bursting from one point.
  if (window.UIKit && (won || newBest)) {
    window.UIKit.celebrate({
      colors: ["--cbf-cream", "--cbf-star", "--cbf-tin-tomato", "--cbf-tin-robin", "--cbf-tin-pea", "--cbf-tin-mustard"],
      spreadX: [0, innerWidth],
      y: innerHeight * 0.12,
    });
  }
  // showScreen applies the new screen synchronously only for the very first screen ever shown (screenShown's
  // own check) — every later call defers to applyScreen() via the curtain, where pendingResultDraw is
  // actually consumed. That first-screen case can't happen here (checkEnd only runs after at least one level
  // has already been shown), but calling it directly would be relying on that, not guaranteeing it.
  updateHud();
}

// The level map: all 30 open, grouped into 3 chapters of 10, each a felt patch with its stars out of
// STAR_MAX (spec v2 §E2: the cap is fixed, not N - par - see progress.js's own capOf()). DESIGN.md's class
// contract: #cbf-map, .cbf-bar/.cbf-h2/.cbf-total, .cbf-chapter__title, ol.cbf-levels >
// button.cbf-level(.is-cleared, .is-current) > b, .cbf-level__stars > i(.is-lit).
function levelPatch(n, data, current) {
  const d = levelDef(n);
  const li = document.createElement("li");
  const b = document.createElement("button");
  b.type = "button";
  const num = document.createElement("b");
  num.textContent = String(n);
  if (!d) {
    // S3's solver hasn't produced this level yet (THE-523): show it locked rather than crash on a null def.
    b.type = "button";
    b.className = "cbf-level is-locked";
    b.disabled = true;
    b.append(num);
    li.append(b);
    return li;
  }
  const cap = STAR_MAX;
  const got = Math.min(cap, data.stars[String(n)] ?? 0);
  b.className = "cbf-level" + (isCleared(data, n) ? " is-cleared" : "") + (n === current ? " is-current" : "");
  b.dataset.level = String(n);
  const stars = document.createElement("span");
  stars.className = "cbf-level__stars";
  for (let i = 0; i < cap; i++) {
    const star = document.createElement("i");
    if (i < got) star.classList.add("is-lit");
    stars.append(star);
  }
  b.append(num, stars);
  b.addEventListener("click", () => startLevel(n));
  li.append(b);
  return li;
}
function openMap() {
  const data = save.load();
  const current = continueLevel(data);
  const chaptersEl = document.querySelector("[data-map-chapters]");
  const chapters = [];
  for (let c = 1; c <= 3; c++) {
    const from = (c - 1) * 10 + 1, to = c * 10;
    const title = document.createElement("h3");
    title.className = "cbf-chapter__title";
    title.textContent = T[`chapter${c}`];
    const ol = document.createElement("ol");
    ol.className = "cbf-levels";
    for (let n = from; n <= to; n++) {
      if (chapterOf(n) !== c) continue; // chapterOf is the single source of the boundary; this just mirrors it
      ol.append(levelPatch(n, data, current));
    }
    chapters.push(title, ol);
  }
  chaptersEl.replaceChildren(...chapters);
  const t = progressTotals(data);
  document.getElementById("cb-map-total").textContent = `${t.earned} / ${t.possible}`;
  showScreen("cbf-map");
}

// The held aim, read at each step: the fuse uses it if a pull of 20 px or more is down.
const heldAim = () => (pull ? aimFrom(pull.start, pull.now) : null);

const HITSTOP_MS = 60; // DESIGN.md §9 "First tin contact"
let hitStopUntil = 0; // performance.now() timestamp; frame() pauses advance() until past this
let lastDownThisShot = 0; // sim.downThisShot as of the previous advance(), to catch the 0→1 edge

// "+100" tags (DESIGN.md §9: pop 0.6→1.1→1 over 240ms, float up 18px and fade over 700ms; one per target, at
// the target). tagTins mirrors sim.tins' down flags across advance() calls, so a tin's own false→true edge
// spawns exactly one tag at that tin's own position, however many go down in the same shot.
const TAG_POP_MS = 240, TAG_FLOAT_MS = 700, TAG_FLOAT_PX = 18;
let tags = []; // { x, y, bornAt } in world units, bornAt a performance.now() timestamp
let tagTins = []; // this shot's tins' down flags as of the previous advance() call
let lastDrumHp = [], lastCrateHp = []; // this shot's drums'/crates' hp as of the previous advance() call (fx triggers only, THE-523 S4)
let lastCracked = 0, lastStonesList = []; // sim.cracked and sim.stones as of the previous advance() call (spec G5: sparks on a stone hit); reset in startLevel()/startDaily() below, the same as lastDrumHp/lastCrateHp (CTO review on THE-561, B2)

// A post-pass shake amplitude from an impact (spec v2 §G6): scales with the same impact reading as the ring,
// just mapped to CSS px instead of a shader amplitude.
function impactShakeAmp(impact) {
  return 10 * Math.max(0, Math.min(1, (impact - 300) / 600));
}

// A post-pass ring's amplitude from an impact (spec v2 §G3): 0.25-0.6, scaled by how far past the 300 hit
// threshold the impact was, capped at 600 over (a very hard hit always reads as the max).
function impactRingAmp(impact) {
  return 0.25 + 0.35 * Math.max(0, Math.min(1, (impact - 300) / 600));
}

let lastShotsLogged = 0; // sim.shots.length as of the previous advance(): a new entry is a cannon fire, any source
let lastPosesLogged = 0; // sim.poses.length as of the previous advance(): a new entry is a landing (bow/shrug)

// The last-shot tacking-dot trace (spec v2 §C7, THE-527 feel check): the previous shot's real flight path,
// kept as world points and shown while aiming the next one. shotPath records the shot currently in flight;
// lastShotPath is what's actually drawn, replaced once that shot resolves and hidden again the moment the
// next one fires (checkEnd()/advance() below own clearing it, draw() itself never reads sim.phase for this).
let shotPath = [], lastShotPath = [];

// Cannon shake (DESIGN.md §9 "Fire": 2 px, 160 ms, skin.css's .cbf-app.is-shake). Off under reduced motion.
const appEl = document.getElementById("cb-app");
function shake() {
  if (window.UIKit && window.UIKit.reduceMotion()) return;
  appEl.classList.remove("is-shake");
  void appEl.offsetWidth; // restart the animation when the previous shot's is still running
  appEl.classList.add("is-shake");
}

function advance(n) {
  const wasFlight = sim.phase === "flight";
  step(sim, n, heldAim);
  if (sim.shots.length > lastShotsLogged) {
    audio.playCannon(); shake(); shotPath = []; lastShotPath = [];
    triggerRing(fx, CANNON.x, CANNON.y, 0.5); // spec v2 G3: fire
    triggerCA(fx, 0.8);
    const lastShot = sim.shots[sim.shots.length - 1];
    triggerMuzzle(fx, CANNON.x, CANNON.y, -(lastShot.angle * Math.PI) / 180); // spec G5
  }
  lastShotsLogged = sim.shots.length;
  if (sim.phase === "flight" && sim.flyer) shotPath.push({ x: sim.flyer.x, y: sim.flyer.y });
  else if (wasFlight) lastShotPath = shotPath; // the shot just resolved: this is now "the last shot's path"
  if (sim.downThisShot > 0 && lastDownThisShot === 0) hitStopUntil = performance.now() + HITSTOP_MS;
  lastDownThisShot = sim.downThisShot;
  const now = performance.now();
  sim.tins.forEach((t, i) => {
    if (t.down && !tagTins[i]) {
      tags.push({ x: t.x, y: t.y, bornAt: now });
      audio.playTonk((i % 4) / 3);
      triggerRing(fx, t.x, t.y, impactRingAmp(t.impact));
      triggerShake(fx, impactShakeAmp(t.impact));
      triggerFluff(fx, t.x, t.y);
    }
    tagTins[i] = t.down;
  });
  sim.drums.forEach((d, i) => {
    const hp = d.hp ?? 0;
    if (lastDrumHp[i] === undefined) lastDrumHp[i] = hp;
    if (hp < lastDrumHp[i]) {
      if (hp <= 0) { // spec G3/G5: drum burst - torn felt skin, the same fluff look as a tin down
        triggerRing(fx, d.x, d.y, 0.8); triggerCA(fx, 1.2); triggerShake(fx, 10); triggerFluff(fx, d.x, d.y, 10);
      } else { triggerRing(fx, d.x, d.y, impactRingAmp(d.impact)); triggerShake(fx, impactShakeAmp(d.impact)); }
    }
    lastDrumHp[i] = hp;
  });
  sim.ledges.forEach((L, i) => {
    if (!L.crate) return;
    const hp = L.hp ?? 0;
    if (lastCrateHp[i] === undefined) lastCrateHp[i] = hp;
    if (hp < lastCrateHp[i]) {
      triggerRing(fx, (L.x0 + L.x1) / 2, L.top, impactRingAmp(L.impact));
      triggerShake(fx, impactShakeAmp(L.impact));
      if (hp <= 0) triggerSplinters(fx, (L.x0 + L.x1) / 2, L.top); // spec G5: splinters once it actually breaks
    }
    lastCrateHp[i] = hp;
  });
  if (sim.cracked > lastCracked) { // spec G5: sparks on a stone hit (it leaves sim.world once it cracks)
    const broken = lastStonesList.filter((s) => !sim.stones.includes(s));
    for (const s of broken) { triggerStoneSparks(fx, s.x, s.y); triggerRing(fx, s.x, s.y, 0.4); }
  }
  lastCracked = sim.cracked;
  lastStonesList = sim.stones;
  tags = tags.filter((tg) => now - tg.bornAt < TAG_POP_MS + TAG_FLOAT_MS);
  if (sim.poses.length > lastPosesLogged) {
    // "Landing" (DESIGN.md §9): the net sags, then bow or shrug. Both the boing and the pose sound land here,
    // the one moment resolve() (sim.js) settles a shot.
    audio.playBoing();
    if (sim.pose === "bow") audio.playBow(); else audio.playShrug();
    triggerDust(fx, 320, FIELD.floor); // spec G5: dust on landing, the same net spot render.js draws the pose at
  }
  lastPosesLogged = sim.poses.length;
  if (sim.phase !== "aim") pull = null; // a fuse shot ended the pull: the real release will fire nothing
  recordNewDailyShots(); // covers a fuse-fired shot, taken inside step()
  checkEnd();
}

// Steps the camera and rebuilds `view` from it (THE-523 §C). Runs every rAF frame regardless of manual/paused
// (so a test driving the clock through __sim.step still gets a settled aim-frame view to read worldToScreen
// against), except while actually paused — nothing should visibly move behind an open dialog.
function updateCamera(dtMs) {
  if (!inPlay || !camera || paused) return;
  const dt = Math.min(dtMs, 250) / 1000; // clamps a stalled tab's huge delta, same spirit as MAX_CATCH_UP
  const asim = activeSim(); // the demo's "fire" phase follows its own ghost flight, not the frozen real sim
  const flyer = asim.phase === "flight" && asim.flyer ? { x: asim.flyer.x, y: asim.flyer.y } : null;
  stepCamera(camera, dt, {
    phase: asim.phase, flyer, cannonX: CANNON.x,
    aimX: aimCameraX(viewportBox), fortX: fortCenterX(sim.def), retry: retryShot,
    visibleW: viewportBox.w / scaleForHeight(viewportBox.h, 1), visibleH: viewportBox.h, curtainOpen,
    peek: peekHeld,
  });
  updateView();
}

function frame(now) {
  const dtMs = now - last;
  if (demoPhase) tickDemo(dtMs);
  // The sim never advances during the demo: nothing physical happens in it, so the fuse (which only counts
  // down inside step(), spec §5 "the fuse starts after the demo") simply hasn't started yet.
  const running = inPlay && !ended && !manual && !paused && !demoPhase && now >= hitStopUntil;
  if (running) {
    acc = Math.min(acc + dtMs / 1000, MAX_CATCH_UP);
    while (acc >= DT) { advance(1); acc -= DT; }
  } else {
    acc = 0;
  }
  last = now;
  if (inPlay && !ended) updateHud();
  updateCamera(dtMs);
  // Fuse fizz (DESIGN.md §9, §10): quiet, last 5 s only (FUSE_STEPS/3 = 600 steps = 5 s), louder as it nears 0.
  // Not during the demo (the fuse hasn't started) or a dialog/pause (sim.fuse is frozen there, so fizz would
  // have nothing to ramp toward anyway, and a sheet shouldn't have a sound bed running behind it).
  const fuseSecsLeft = sim.fuse / 120;
  if (inPlay && !demoPhase && !paused && sim.phase === "aim" && fuseSecsLeft <= 5) {
    audio.startFizz();
    audio.updateFizz(fuseSecsLeft);
  } else {
    audio.stopFizz();
  }
  const demoPull = demoHandPull(); // a synthetic { start, now } in screen px, or null off the loop phase
  const preview = demoPull ? aimFrom(demoPull.start, demoPull.now) : pull ? aimFrom(pull.start, pull.now) : keyActive ? keyAim : null;
  const hand = demoPull && { x: demoPull.now.x, y: demoPull.now.y, down: !!preview };
  // "The tins wobble once" (spec §5, 0-1.5 s): one damped swing, eased out over the "goal" caption's window.
  const wobble = demoPhase === "goal" ? 0.12 * Math.sin((demoClock / 1500) * Math.PI * 3) * (1 - demoClock / 1500) : 0;
  const liveTags = tags.map((tg) => {
    const age = now - tg.bornAt;
    // Pop: scale 0.6 -> 1.1 -> 1 over 240ms (two eased segments); float/fade: starts once the pop ends, 18px
    // up and alpha 1 -> 0 over 700ms (DESIGN.md §9 "First tin contact").
    const scale = age < TAG_POP_MS * 0.6 ? 0.6 + 0.5 * (age / (TAG_POP_MS * 0.6))
      : age < TAG_POP_MS ? 1.1 - 0.1 * ((age - TAG_POP_MS * 0.6) / (TAG_POP_MS * 0.4))
      : 1;
    const floatT = Math.max(0, Math.min(1, (age - TAG_POP_MS) / TAG_FLOAT_MS));
    return { x: tg.x, y: tg.y - TAG_FLOAT_PX * floatT, scale, alpha: 1 - floatT };
  });
  const asim = activeSim(); // "fire" draws the ghost flight; every other phase draws the real (frozen) sim
  const trace = asim.phase === "aim" ? lastShotPath : []; // spec C7: hidden again the instant the next shot fires
  const flightTrail = asim.phase === "flight" ? (demoPhase === "fire" ? demoShotPath : shotPath) : []; // spec G5: the live flyer's own streamer
  const chapterLevel = dailyMode ? 1 : LEVEL;
  draw(ctx, asim, view, dpr, preview, cast, demoPhase ? 1 : arcFraction(), hand, wobble, liveTags, photos, camera ? camera.fortX : null, chapterLevel, trace, flightTrail);
  drawParticles(ctx, fx, view); // spec G5/G1(c): additive particles, onto the same 2D scene gl.js then uploads
  renderGl(now, chapterLevel);
  applyShake();
  requestAnimationFrame(frame);
}

// Screen shake (spec G6): a fresh random jitter every frame, scaled by fx.shake's live (decaying) amplitude.
// Applied to #cb-app, the same element the cannon-fire kick (shake(), above) animates via a CSS class - the
// two never fight for long: the kick is a brief 160ms animation, and real impacts land well after a shot has
// already fired.
function applyShake() {
  const off = shakeOffset(fx);
  appEl.style.transform = off.dx || off.dy ? `translate(${off.dx.toFixed(1)}px, ${off.dy.toFixed(1)}px)` : "";
}

// THE-523 S4 / spec v2 §G1-G3: steps fx.js's post-pass state and, when GL is actually available, composites
// the just-drawn 2D scene through the post pass. syncGlVisibility() runs every frame so a context loss mid-game
// (spec G2) drops back to the plain 2D canvas within one frame, not just at the next explicit check.
let lastFxT = performance.now();
function renderGl(now, chapterLevel) {
  const dt = Math.min(now - lastFxT, 250) / 1000;
  lastFxT = now;
  const reducedMotion = !!(window.UIKit && window.UIKit.reduceMotion());
  stepFx(fx, dt, reducedMotion);
  syncGlVisibility();
  if (!glActive()) return;
  const cssW = canvas.clientWidth || 1, cssH = canvas.clientHeight || 1;
  const toUv = (x, y) => { const p = worldToScreen(view, x, y); return { x: p.x / cssW, y: p.y / cssH }; };
  const rings = fx.rings.map((r) => { const s = ringState(r, fx.reducedMotion), uv = toUv(r.x, r.y); return { x: uv.x, y: uv.y, r: s.r, amp: s.amp }; });
  const chapter = CBF.CHAPTERS[CBF.chapterFor(chapterLevel)];
  compositor.render({ rings, ca: fx.ca, flash: fx.flash, chapter, grainSeed: now * 0.001, neutral: flatPost });
}

// The felt hand's loop (spec §5): pulls back from the cannon along a fixed down-left line (reads as an
// up-right launch, the same screen-space convention aimFrom uses for a real pull) to a full-power reach,
// holds briefly, then releases and resets. Returns a synthetic { start, now } in screen px while the loop
// phase is on, or null the rest of the time (the goal/rule captions show no hand yet, spec §5's own order).
const DEMO_PULL_MS = HAND_LOOP_MS * 0.55, DEMO_HOLD_MS = HAND_LOOP_MS * 0.15; // the remainder: release + reset pause
function demoHandPull() {
  if (demoPhase !== "loop") return null;
  const start = worldToScreen(view, CANNON.x, CANNON.y);
  const t = demoClock % HAND_LOOP_MS;
  const reach = t < DEMO_PULL_MS ? t / DEMO_PULL_MS : t < DEMO_PULL_MS + DEMO_HOLD_MS ? 1 : 0;
  const dist = reach * FULL_POWER_PX;
  return { start, now: { x: start.x - dist * Math.SQRT1_2, y: start.y + dist * Math.SQRT1_2 } };
}

// The camera gates aiming too (spec C2: aiming happens at the aim frame): a pull can't start mid-intro-pan,
// mid-flight-follow or mid-return — sim.phase === "aim" alone would otherwise let a pull start while the
// camera is still easing back from the fort after the previous shot.
function canAim() {
  return inPlay && !ended && !paused && !demoPhase && sim.phase === "aim" && !!camera && camera.mode === "aim";
}

// Unlocks (or resumes) the AudioContext on every real gesture, anywhere (not gated on canAim: the title
// screen's own taps count too) — see audio.js's own note on why this can't just wait for the first shot.
// pointerdown alone, once: true (CTO review r2 on THE-449) isn't enough on mobile: a touch's own pointerdown
// doesn't always count as the "real" gesture iOS Safari's autoplay policy wants, and dropping the listener
// after the very first one meant a context that stayed suspended past that point (e.g. backgrounding the tab
// mid-gesture) never got a second chance to resume. pointerup and keydown are both listened too, and the
// listener stays attached for the life of the page — audio.unlock() is already a cheap no-op once the context
// exists and isn't suspended.
document.addEventListener("pointerdown", audio.unlock);
document.addEventListener("pointerup", audio.unlock);
document.addEventListener("keydown", audio.unlock);

// Any tap or key skips the intro pan, the post-shot hold or the return pan straight to the aim frame (spec
// C1/C7). Separate from canAim()/bindPull (which never see this gesture at all, since canPull() is false the
// whole time): this only ever mutates the camera, so it can't double-fire a shot or fight the dialog/typing
// guards the real keydown handler below has. skipToAim is itself a no-op during flight (the shot must resolve
// in the sim first), so this is safe to call unconditionally on every tap/key.
document.addEventListener("pointerdown", () => { if (inPlay && camera) skipToAim(camera); });
document.addEventListener("keydown", () => { if (inPlay && camera) skipToAim(camera); });

bindPull(app, {
  canPull: canAim,
  onStart: (p) => { pull = { start: p, now: p }; },
  onMove: (p) => { if (pull) pull.now = p; },
  onRelease: (start, end) => {
    if (!pull) return; // the fuse already fired during this pull: nothing more
    pull = null;
    const shot = aimFrom(start, end);
    if (!shot) return; // within 20 px: a cancel, nothing fires
    fire(sim, shot.angle, shot.power, "aim");
    recordNewDailyShots();
  },
  onCancel: () => { pull = null; },
});

function fireKeys() {
  fire(sim, keyAim.angle, keyAim.power, "keys");
  recordNewDailyShots();
}

document.addEventListener("keydown", (e) => {
  // A dialog (e.g. "Our family") sits on top of whichever screen is active, so inPlay alone doesn't see it;
  // and typing a name must never reach R/Space as game keys (CTO review: typing "Mary Ann" restarted the
  // level behind the sheet and the trailing space fired a shot).
  if (document.querySelector("dialog[open]")) return;
  const tag = e.target && e.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  if (!inPlay) return;
  // preventDefault: the same Esc press's default action is the dialog's close request, so without it the sheet
  // this just opened would fire its own cancel and close again ~6 ms later (THE-486, AC-K2).
  if (e.key === "Escape") { e.preventDefault(); openPause(); return; } // spec §5: Esc pause
  if (e.key === "r" || e.key === "R") { if (canRestart()) (dailyMode ? startDaily() : startLevel(LEVEL)); return; }
  if (!canAim()) return;
  // !pull: a held pointer drag is already aiming a shot (spec C3 "aiming is blocked while peeking" cuts both
  // ways - CTO review on THE-561, non-blocking): starting peek mid-drag would still let onRelease fire it once
  // the peek pan has moved the camera away, a confusing shot even though canAim() alone can't see a pull in
  // flight (it only gates whether a *new* one may start).
  if ((e.key === "v" || e.key === "V") && !pull) { peekHeld = true; e.preventDefault(); return; }
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  switch (e.key) {
    case "ArrowLeft": keyAim.angle = clamp(keyAim.angle - KEY_ANGLE, 10, 80); break;
    case "ArrowRight": keyAim.angle = clamp(keyAim.angle + KEY_ANGLE, 10, 80); break;
    case "ArrowUp": keyAim.power = clamp(keyAim.power + KEY_POWER, 0.05, 1); break;
    case "ArrowDown": keyAim.power = clamp(keyAim.power - KEY_POWER, 0.05, 1); break;
    case " ": case "Enter": fireKeys(); break;
    default: return;
  }
  keyActive = true;
  e.preventDefault();
});

// Releasing V ends the peek (spec C3) wherever the key went down - unconditional (no dialog/inPlay guard,
// unlike keydown above), so a key released after a dialog opened or the tab lost focus mid-hold still clears it.
document.addEventListener("keyup", (e) => { if (e.key === "v" || e.key === "V") peekHeld = false; });

// The binoculars patch (spec C3): the same hold-to-peek gesture as V, for touch/mouse. pointercancel and
// pointerleave both release it too - a dragged-off or interrupted gesture must never leave peek stuck on.
const peekBtn = document.getElementById("cb-btn-peek");
peekBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); if (canAim() && !pull) peekHeld = true; }); // !pull: see the V-key handler's own note
["pointerup", "pointercancel", "pointerleave"].forEach((evt) => peekBtn.addEventListener(evt, () => { peekHeld = false; }));

document.getElementById("cb-btn-play").addEventListener("click", () => startLevel(continueLevel(save.load())));
document.getElementById("cb-btn-retry").addEventListener("click", () => { if (canRestart()) (dailyMode ? startDaily() : startLevel(LEVEL)); });
document.getElementById("cb-btn-next").addEventListener("click", () => startLevel(LEVEL + 1));
document.getElementById("cb-btn-levels").addEventListener("click", openMap);
document.getElementById("cb-btn-result-levels").addEventListener("click", () => { if (dailyMode) showScreen("cbf-title"); else openMap(); });
document.getElementById("cb-btn-map-back").addEventListener("click", () => showScreen("cbf-title"));
document.getElementById("cb-btn-daily").addEventListener("click", startDaily);

// Web Share API, falling back to copy-link (html5-game-standards "Play and input"). Never names, photos, colours
// or looks: the text is built only from the daily result (daily.js).
async function shareResult() {
  if (!lastDailyResult) return;
  const text = shareLine(dailyDate, lastDailyResult, ARCADE_URL);
  if (navigator.share) {
    try { await navigator.share({ text }); return; } catch (e) { /* cancelled or unsupported: fall back */ }
  }
  try {
    await navigator.clipboard.writeText(text);
    document.getElementById("cb-share-msg").textContent = T.shareCopied;
  } catch (e) { /* clipboard blocked: nothing more to do */ }
}
document.getElementById("cb-btn-share").addEventListener("click", shareResult);
const sheet = bindFamilySheet({
  dialog: document.getElementById("cb-family"),
  store: castStore,
  text: T,
  onSave: (saved) => { cast = saved; photos = loadPhotos(cast, castStore); showPlaque(); buildRail(); },
});
document.getElementById("cb-btn-family").addEventListener("click", () => sheet.open());
window.addEventListener("resize", resize);

// ---- Turn card (spec v2 §A3, DESIGN.md §19) ----
// Shown by skin.css alone in portrait (.cbf-app:not(.is-upright) > .cbf-turn); "Play upright" only has to add
// .is-upright for the rest of the session - never saved, so a reload is a fresh start and shows the card again.
const uprightBtn = document.getElementById("cb-btn-upright");
uprightBtn.addEventListener("click", () => app.classList.add("is-upright"));
// DESIGN.md §19: "Focus moves to Play upright when the card appears" - CSS alone decides *whether* it's
// showing, so this only has to catch the moment it does (the false -> true edge, not every portrait resize).
let turnCardWasShown = false;
function focusTurnCardOnAppear() {
  const shown = window.innerHeight > window.innerWidth && !app.classList.contains("is-upright");
  if (shown && !turnCardWasShown) uprightBtn.focus();
  turnCardWasShown = shown;
}
window.addEventListener("resize", focusTurnCardOnAppear);
if (screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener("change", focusTurnCardOnAppear);
// Not called yet here: showScreen("cbf-title") below (after themeReady) focuses its own first button, which
// would otherwise win focus back from the turn card on the very first paint - themeReady's own .then() below
// calls this again, after that, so the turn card wins in portrait.
// The installed PWA only (spec A4); a plain browser tab rejects this, which is fine to ignore.
if (screen.orientation && screen.orientation.lock) screen.orientation.lock("landscape").catch(() => {});

// ---- Pause (spec: Resume, Restart, Levels, How to play, Sound, Reduced motion) ----
const pauseDialog = document.getElementById("cb-pause");
const soundToggle = document.getElementById("cb-opt-sound");
const motionToggle = document.getElementById("cb-opt-motion");
const howToDialog = document.getElementById("cb-howto");
if (window.UIKit) window.UIKit.howTo(howToDialog);

// The one and only place paused is written (CTO review on THE-449 r2): every hand-written paused = true/false
// at each call site was its own chance to get it wrong — openHowTo() set it true with nothing to set it back
// when opened from the title (startLevel/startDaily never reset it), and dialog.close()'s own "close" event
// fires on a later task, not synchronously, so pauseDialog's close listener firing *after* openHowTo() had
// already set paused = true silently cleared it again while How to play was still open. Every path that can
// change whether either dialog is open, or whether the tab is hidden, now just calls this and nothing else
// touches paused directly.
function syncPaused() {
  paused = document.hidden || pauseDialog.open || howToDialog.open;
  peekHeld = false; // never leave a peek stuck on across a tab-hide or dialog open (spec C3)
  acc = 0;
  last = performance.now();
}
document.addEventListener("visibilitychange", syncPaused);

function applySettingsToUI() {
  const s = save.settings();
  soundToggle.checked = s.sound;
  motionToggle.checked = s.reducedMotion;
  document.documentElement.setAttribute("data-reduce-motion", String(s.reducedMotion));
}
applySettingsToUI();
function openPause() {
  if (!inPlay || ended || demoPhase) return; // nothing to pause on the title/map/result, or mid-demo
  applySettingsToUI();
  pauseDialog.showModal();
  syncPaused();
}
function closePause() {
  if (pauseDialog.open) pauseDialog.close();
  syncPaused();
}
document.getElementById("cb-btn-pause").addEventListener("click", openPause);
document.getElementById("cb-btn-resume").addEventListener("click", closePause);
pauseDialog.addEventListener("close", syncPaused); // Esc too
document.getElementById("cb-btn-pause-restart").addEventListener("click", () => { if (canRestart()) { closePause(); dailyMode ? startDaily() : startLevel(LEVEL); } });
document.getElementById("cb-btn-pause-levels").addEventListener("click", () => { closePause(); openMap(); });
soundToggle.addEventListener("change", () => { save.setSetting("sound", soundToggle.checked); audio.setMuted(!soundToggle.checked); });
motionToggle.addEventListener("change", () => { save.setSetting("reducedMotion", motionToggle.checked); document.documentElement.setAttribute("data-reduce-motion", String(motionToggle.checked)); });

// ---- How to play (ui-kit's step-through sheet; opened from the title's "?" or Pause) ----
function openHowTo() {
  if (howToDialog.open) return;
  const wasPaused = pauseDialog.open;
  if (wasPaused) pauseDialog.close();
  howToDialog.showModal();
  syncPaused();
  // When this came from Pause, reopen it first (so the player returns to where they were), *then* resync —
  // reopening alone would leave paused wherever the howToDialog "close" handling above last left it.
  if (wasPaused) howToDialog.addEventListener("close", () => { pauseDialog.showModal(); syncPaused(); }, { once: true });
  else howToDialog.addEventListener("close", syncPaused, { once: true });
}
document.getElementById("cb-btn-howto").addEventListener("click", openHowTo);
document.getElementById("cb-btn-pause-howto").addEventListener("click", openHowTo);

// The how-to's 3 pictures (spec §6: "pull back · tins down · stars = members who didn't fly"), drawn once
// through the same reference renderer as the rest of the game (CBF), not separate art assets. Canvases are
// 192x120 (the kit's own 16:10 .uk-step__art box), scaled up 1.6x so each figure reads clearly at that size.
function drawHowToArt() {
  CBF.tokens();
  const K = 1.6;
  const pull = document.querySelector('[data-howto-art="pull"]');
  const pctx = pull.getContext("2d");
  pctx.setTransform(K, 0, 0, K, 96, 15);
  CBF.hand(pctx, 0, 0, true, 1);

  const tins = document.querySelector('[data-howto-art="tins"]');
  const tctx = tins.getContext("2d");
  tctx.setTransform(K, 0, 0, K, 96, 75);
  CBF.tin(tctx, -26, 0, 24, CBF.tins()[0], 1, { band: true });
  CBF.tin(tctx, 26, 0, 24, CBF.tins()[1 % CBF.tins().length], 1, { band: true });

  const stars = document.querySelector('[data-howto-art="stars"]');
  const sctx = stars.getContext("2d");
  sctx.setTransform(K, 0, 0, K, 96, 75);
  CBF.feltStar(sctx, -26, 0, 22, true, 1);
  CBF.feltStar(sctx, 26, 0, 22, true, 1);

  // Drum (spec v2 §D): dented after one hit, whole before it - the same CBF.drum() the live game draws.
  const drum = document.querySelector('[data-howto-art="drum"]');
  const dctx = drum.getContext("2d");
  dctx.setTransform(K, 0, 0, K, 96, 75);
  CBF.drum(dctx, -26, 0, 24, "whole", 1);
  CBF.drum(dctx, 26, 0, 24, "dent", 1);

  // Crate (spec v2 §D): the same CBF.crate() the live game draws, pine then iron-banded.
  const crate = document.querySelector('[data-howto-art="crate"]');
  const cctx = crate.getContext("2d");
  cctx.setTransform(K, 0, 0, K, 96, 95);
  CBF.crate(cctx, -50, 0, 36, 40, { k: 1, iron: false, hp: 1 });
  CBF.crate(cctx, 10, 0, 36, 40, { k: 1, iron: true, hp: 2 });

  // Peek (spec v2 §C3): no CBF art for this (a functional control, not a troupe character) - a plain pair of
  // binocular lenses, the same shape language as the HUD's own key-cap patch.
  const peek = document.querySelector('[data-howto-art="peek"]');
  const kctx = peek.getContext("2d");
  kctx.setTransform(K, 0, 0, K, 96, 60);
  kctx.fillStyle = "#3B2415";
  kctx.beginPath(); kctx.arc(-14, 0, 20, 0, Math.PI * 2); kctx.fill();
  kctx.beginPath(); kctx.arc(14, 0, 20, 0, Math.PI * 2); kctx.fill();
  kctx.fillStyle = "#F6E9C9";
  kctx.beginPath(); kctx.arc(-14, 0, 11, 0, Math.PI * 2); kctx.fill();
  kctx.beginPath(); kctx.arc(14, 0, 11, 0, Math.PI * 2); kctx.fill();
}
drawHowToArt();

// ---- About ----
const aboutDialog = document.getElementById("cb-about");
document.getElementById("cb-btn-about").addEventListener("click", () => aboutDialog.showModal());
document.getElementById("cb-btn-about-close").addEventListener("click", () => aboutDialog.close());

// The test hook (design "Test hook"). The game's logic runs headless: step(n) drives the sim by hand, and state()
// reads it. Real-pointer tests fire through the pointer and read state() here; they never fire through this hook.
window.__sim = {
  step(n = 1) {
    manual = true;
    advance(n);
    return this.state();
  },
  state() {
    return {
      phase: sim.phase,
      level: LEVEL,
      shot: sim.N - sim.shotsLeft,
      shotsLeft: sim.shotsLeft,
      fuse: sim.fuse,
      tinsDown: tinsDown(sim),
      targets: sim.tins.length,
      drums: sim.drums.map((d) => ({ hp: d.hp, down: d.down })),
      cracked: sim.cracked,
      stones: sim.stones.length,
      score: sim.score,
      stars: sim.stars,
      cap: sim.cap,
      stepIndex: sim.step,
      pose: sim.pose,
      poses: sim.poses.slice(),
      rail: sim.rail.map((r) => ({ member: r.member, knack: r.knack })),
      best: save.best(LEVEL),
      bestStars: save.starsOf(LEVEL),
      bodiesAwake: sim.world.bodies.filter((b) => !b.sleep).length,
      daily: dailyMode,
      practice: dailyMode && !dailyFirstAttempt,
      dailyDate,
      canRestart: canRestart(),
      tagCount: tags.length, // one "+100" tag per downed tin, live for TAG_POP_MS + TAG_FLOAT_MS (DESIGN.md §9)
      viewScale: view.scale, // spec §6's own per-viewport scale column; resize()'s rail-aware fit
    };
  },
  hash() {
    return hash(sim);
  },
  load(level = LEVEL) {
    manual = true;
    startLevel(level);
    return this.state();
  },
  // Dev/QA only: plays an arbitrary def directly, not one of the 30 real levels (THE-523 S2). Level number 2
  // (not 1) so this never accidentally triggers the first-run demo, which freezes the sim. Unlike load()/
  // loadDaily(), this never sets manual: it exists to set up a scenario for a real-pointer test that then
  // drives the rest of the flow through real input, with the rAF loop auto-advancing exactly as it would for
  // a real player - not for a test that steps the sim by hand.
  loadCustom(def) {
    startLevel(2, def);
    return this.state();
  },
  loadDaily() {
    manual = true;
    startDaily();
    return this.state();
  },
  fire(angle, power) {
    const ok = fire(sim, angle, power, "hook");
    if (ok) recordNewDailyShots();
    return ok;
  },
  shareLine() {
    return lastDailyResult ? shareLine(dailyDate, lastDailyResult, ARCADE_URL) : null;
  },
  pause(on) {
    manual = !!on;
    acc = 0;
    last = performance.now();
  },
  worldToScreen(x, y) {
    return worldToScreen(view, x, y);
  },
  screenToWorld(x, y) {
    return screenToWorld(view, x, y);
  },
  fuseSteps: FUSE_STEPS,
};

// The camera's own test hook (plan "Test hooks"): QA reads this instead of poking at `view` or the canvas.
window.__cam = {
  state() {
    return camera && { mode: camera.mode, x: camera.x, y: camera.y, zoom: camera.zoom, highFlyer: !!camera.highFlyer };
  },
};

// The GL/fx test hook (plan "Test hooks"): QA reads GL availability, the post pass's live trigger state and
// the reduced-motion flag from here, instead of poking at the canvas or the shader directly.
window.__fx = {
  state() {
    return {
      glOk: glActive(),
      glForcedOff,
      flatPost,
      ringCount: fx.rings.length,
      ca: fx.ca,
      flash: fx.flash,
      shake: fx.shake,
      particleCount: fx.particles.length,
      reducedMotion: !!(window.UIKit && window.UIKit.reduceMotion()),
    };
  },
};

resize();
themeReady.then(() => { showScreen("cbf-title"); focusTurnCardOnAppear(); }); // showScreen focuses the title's own first button; re-run after it so the turn card (shown over every screen) wins focus in portrait
requestAnimationFrame(frame);
