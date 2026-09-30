// Loop Break game.js: the screen/overlay state machine and the wiring input -> level -> render -> progress
// -> save (design.md, DESIGN.md). Screens (`.lb-screen`, mutually exclusive): title, map, play. Overlays
// (`.lb-overlay`, layered on top of whichever screen is under them): result, fail, pause, settings, howto.
// Ring/key input is only live on the play screen with no overlay open (spec §2 "Pause/dialog").
// Demo, comforts wiring beyond settings persistence, PWA and the M5 craft pass (audio, ease/overshoot, win/
// fail sequences, haptics, perf) land in following milestones; this module is written so those slot in
// without reshaping what's here.
import { solve, grabbable, dailyLevel } from "./core.js";
import * as Level from "./level.js";
import * as Progress from "./progress.js";
import * as Save from "./save.js";
import { createMedallion, frameState, draw as drawMedallion, geometry as medallionGeometry } from "./render.js";
import { attachInput } from "./input.js";
import * as Audio from "./audio.js";

const CATALOG = window.LOOP_BREAK_LEVELS.levels; // [{id, pack, n, links, driveOnly, start, par, budget}, ...]
const byId = new Map(CATALOG.map((l) => [l.id, l]));
const PACKS = [1, 2, 3].map((p) => CATALOG.filter((l) => l.pack === p));
const FREE_WIND_IDS = new Set([1, 2]);
const TOTAL_STARS = CATALOG.length * 3;

const $ = (id) => document.getElementById(id);
const els = {
  screens: { title: $("lb-title"), map: $("lb-map"), play: $("lb-play") },
  overlays: { result: $("ov-result"), fail: $("ov-fail"), pause: $("ov-pause"), settings: $("ov-settings"), howto: $("ov-howto") },
  datelineText: $("dateline-text"),
  streakPips: $("streak-pips"),
  titleMedallion: $("title-medallion"),
  arcShade: $("arc-title-shade"),
  arcFill: $("arc-title-fill"),
  tagline: $("tagline"),
  btnPlay: $("btn-play"),
  btnDaily: $("btn-daily"),
  dailyNote: $("daily-note"),
  btnHowToTitle: $("btn-howto-title"),
  btnSettingsTitle: $("btn-settings-title"),
  btnMapBack: $("btn-map-back"),
  mapTitle: $("map-title"),
  packs: $("packs"),
  btnPause: $("btn-pause"),
  playTitle: $("play-title"),
  movesWindow: $("moves-window"),
  movesNum: $("moves-num"),
  stage: $("stage"),
  canvas: $("lb-medallion"),
  crowns: $("crowns"),
  undo: $("lb-undo"),
  restart: $("lb-restart"),
  resultBig: $("result-big"),
  resultSub: $("result-sub"),
  resultStars: $("result-stars"),
  resultSharebox: $("result-sharebox"),
  resultPlates: $("result-plates"),
  btnResultLevels: $("btn-result-levels"),
  failBig: $("fail-big"),
  failSub: $("fail-sub"),
  failPlates: $("fail-plates"),
  btnFailLevels: $("btn-fail-levels"),
  btnResume: $("btn-resume"),
  btnPauseRestart: $("btn-pause-restart"),
  btnPauseLevels: $("btn-pause-levels"),
  btnPauseHowTo: $("btn-pause-howto"),
  btnPauseSettings: $("btn-pause-settings"),
  settingSound: $("setting-sound"),
  settingHaptics: $("setting-haptics"),
  settingShake: $("setting-shake"),
  settingMotion: $("setting-motion"),
  skinPicker: $("skin-picker"),
  btnSettingsDone: $("btn-settings-done"),
  settingsCredit: $("settings-credit"),
  howtoSteps: $("howto-steps"),
  howtoDots: $("howto-dots"),
  btnHowToBack: $("btn-howto-back"),
  btnHowToNext: $("btn-howto-next"),
  ghost: $("ghost"),
  btnSkipDemo: $("btn-skip-demo"),
  btnWatchDemo: $("btn-watch-demo"),
  side: $("side"),
};

// A blocked localStorage getter/setter (SecurityError: Safari with cookies blocked, some embedded
// webviews) must not stop the game from booting -- fall back to an in-memory stub so the session still
// plays, it just won't persist (THE-234 blocking #2).
function safeStorage() {
  try {
    const probeKey = "loop-break:probe";
    window.localStorage.setItem(probeKey, "1");
    window.localStorage.removeItem(probeKey);
    return window.localStorage;
  } catch {
    const mem = new Map();
    return {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => { mem.set(k, String(v)); },
      removeItem: (k) => { mem.delete(k); },
    };
  }
}
const storage = safeStorage();

let clockNow = () => new Date();
const isFirstRun = !storage.getItem(Save.SAVE_KEY);
let save = Save.loadSave(storage);
if (isFirstRun && window.THEME.defaultSkin === "gunmetal") save.settings.skin = "gunmetal"; // theme.js is the one re-skin point (Standard v2 §2.5); save.js's own default is skin-agnostic ("blued")
let daily = Save.loadDaily(storage);
let streak = Save.loadStreak(storage);
let attempt = null; // current level.js state
let level = null; // the level catalog entry currently in play (or a daily's generated level)
let dailyMode = false;
let io = null; // the attachInput() handle, re-created per play-screen mount
let animSkip = false; // test hook (window.__loopBreak.skipAnimations): lets QA bots fast-forward the M5 win/fail sequences and detent ease
let screen = "title"; // "title" | "map" | "play"
let overlay = null; // null | "result" | "fail" | "pause" | "settings" | "howto"
let pauseReturn = null; // overlay to reopen after Settings closes when opened from Pause, else null
let medallionCache = null; // { key, medallion, R, dpr, skin } for the play stage
let howtoIndex = 0;

// --- timer/animation registry (design.md): a generation counter bumped on level start, restart, quit and
// every screen change; the rAF loop checks it every frame so a stale loop from a previous level can never
// touch the current one. Only two animated things exist so far: the live drag offset (set directly from
// input.js's onDragMove) and the detent release ease below.
let generation = 0;
let rafHandle = null;
let liveDrag = null; // { ring, frac } while a real drag is in progress
let releaseEase = null; // { ring, moveFrom, startTime }: eases frac -> 0 after release
let sequence = null; // { type: "win"|"fail", startTime, stars, litAtStart, lid } -- the win/fail beats (below)
let demoActive = false;
let demoStepTimer = null;

function bumpGeneration() {
  generation++;
  liveDrag = null;
  releaseEase = null;
  sequence = null;
  if (rafHandle) { cancelAnimationFrame(rafHandle); rafHandle = null; }
}

function ensureAnimating() {
  if (rafHandle) return;
  const gen = generation;
  const tick = () => {
    if (gen !== generation) return; // a new level/restart/screen change happened; this loop is stale
    const stillAnimating = renderPlay();
    rafHandle = stillAnimating ? requestAnimationFrame(tick) : null;
  };
  rafHandle = requestAnimationFrame(tick);
}

// DESIGN.md §9 motion: detent ease 140ms, `--ease-spring` cubic-bezier(.3,1.4,.5,1) (~2deg overshoot on 45deg).
// Standard Newton-Raphson cubic-bezier-to-easing solve (the same algorithm browsers use for CSS easings).
function makeBezierEasing(x1, y1, x2, y2) {
  const A = (a1, a2) => 1 - 3 * a2 + 3 * a1;
  const B = (a1, a2) => 3 * a2 - 6 * a1;
  const C = (a1) => 3 * a1;
  const calcBezier = (t, a1, a2) => ((A(a1, a2) * t + B(a1, a2)) * t + C(a1)) * t;
  const calcSlope = (t, a1, a2) => 3 * A(a1, a2) * t * t + 2 * B(a1, a2) * t + C(a1);
  function getTForX(x) {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const slope = calcSlope(t, x1, x2);
      if (Math.abs(slope) < 1e-6) break;
      t -= (calcBezier(t, x1, x2) - x) / slope;
    }
    return t;
  }
  return (x) => (x <= 0 ? 0 : x >= 1 ? 1 : calcBezier(getTForX(x), y1, y2));
}
const easeSpring = makeBezierEasing(0.3, 1.4, 0.5, 1);
const DETENT_EASE_MS = 140;

// The offset to render right now: the live drag if one is in progress, else the settling remainder of a
// release ease (clearing it once the ease completes), else nothing.
function computeLiveOffset() {
  if (liveDrag) return liveDrag;
  if (releaseEase) {
    const t = Math.min(1, (performance.now() - releaseEase.startTime) / DETENT_EASE_MS);
    if (t >= 1) { releaseEase = null; return null; }
    return { ring: releaseEase.ring, frac: releaseEase.moveFrom * (1 - easeSpring(t)) };
  }
  return null;
}

// The 4-picture how-to (spec §5): drag/crown -> gap to index; claw same way, pinion the other; drag the
// toothed ring alone -> the driver's claw lifts; batons = moves, a grey ring only moves when its driver does.
const HOWTO_STEPS = [
  { medallion: { n: 3, links: [], driveOnly: [] }, state: { angles: [45, 0, 0], lit: [0, 1, 1] } },
  { medallion: { n: 3, links: [{ from: 0, to: 1, type: "claw" }, { from: 1, to: 2, type: "pinion" }], driveOnly: [] }, state: { angles: [45, 45, -45], lit: [0, 0, 0] } },
  { medallion: { n: 2, links: [{ from: 0, to: 1, type: "claw" }], driveOnly: [] }, state: { angles: [0, 45], lit: [1, 0] } },
  { medallion: { n: 3, links: [{ from: 0, to: 1, type: "pinion" }], driveOnly: [1] }, state: { angles: [0, 0, 45], lit: [1, 1, 0], budget: 4, used: 1 } },
].map((step, i) => ({ ...step, text: window.THEME.text.howToSteps[i] }));

applySettingsToDom();
applyThemeTextToDom();
window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", applySettingsToDom);

function showScreen(name) {
  screen = name;
  bumpGeneration(); // every screen change invalidates any in-flight animation (design.md timer registry)
  for (const key of Object.keys(els.screens)) {
    els.screens[key].hidden = key !== name;
    els.screens[key].classList.toggle("is-active", key === name);
  }
}

function renderHowTo() {
  els.howtoSteps.innerHTML = "";
  els.howtoDots.innerHTML = "";
  const dpr = window.devicePixelRatio || 1;
  HOWTO_STEPS.forEach((step, i) => {
    const active = i === howtoIndex;
    const fig = document.createElement("figure");
    fig.className = "lb-step" + (active ? " is-active" : "");
    const canvasEl = document.createElement("canvas");
    canvasEl.className = "lb-step__art";
    canvasEl.width = 160;
    canvasEl.height = 160;
    const caption = document.createElement("figcaption");
    caption.className = "lb-step__text";
    caption.textContent = step.text;
    fig.appendChild(canvasEl);
    fig.appendChild(caption);
    els.howtoSteps.appendChild(fig);
    els.howtoDots.insertAdjacentHTML("beforeend", `<i class="lb-dot${active ? " is-active" : ""}"></i>`);
    if (active) {
      const canvas = fig.querySelector("canvas");
      canvas.width = 160 * dpr;
      canvas.height = 160 * dpr;
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, canvas.width / 2, canvas.height / 2);
      const m = createMedallion({ ...step.medallion, id: "howto" + i }, 70, dpr);
      drawMedallion(m, ctx, 0, 0, step.state);
    }
  });
  const T = window.THEME.text;
  els.btnHowToBack.querySelector(".lb-plate__label").textContent = howtoIndex === 0 ? T.howToClose : T.howToBack;
  els.btnHowToNext.querySelector(".lb-plate__label").textContent = howtoIndex === HOWTO_STEPS.length - 1 ? T.howToDone : T.howToNext;
}

function openOverlay(name) {
  overlay = name;
  if (name === "howto") { howtoIndex = 0; renderHowTo(); }
  for (const key of Object.keys(els.overlays)) els.overlays[key].classList.toggle("is-open", key === name);
}

function closeOverlay() {
  overlay = null;
  for (const key of Object.keys(els.overlays)) els.overlays[key].classList.remove("is-open");
}

function inputLive() {
  return screen === "play" && overlay === null && sequence === null && !demoActive;
}

function persist() {
  Save.persistSave(storage, save);
}

// An explicit 'reduce' or 'full' overrides the OS; 'os' (the default) follows prefers-reduced-motion (THE-245).
function reduceMotion() {
  return save.settings.motion === "reduce" ||
    (save.settings.motion === "os" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

function applySettingsToDom() {
  document.documentElement.dataset.skin = save.settings.skin;
  document.documentElement.dataset.motion = reduceMotion() ? "reduce" : "full";
  els.settingSound.checked = save.settings.sound;
  els.settingHaptics.checked = save.settings.haptics;
  els.settingShake.checked = save.settings.shake;
  els.settingMotion.checked = save.settings.motion === "reduce";
  for (const btn of els.skinPicker.querySelectorAll(".lb-skin")) {
    btn.classList.toggle("is-selected", btn.dataset.skin === save.settings.skin);
    btn.classList.toggle("is-locked", btn.dataset.skin === "gunmetal" && !save.skin2Unlocked);
  }
  Audio.setEnabled(save.settings.sound);
  Audio.setHaptics(save.settings.haptics);
}

// Static plate/link labels baked into index.html at their English defaults; filled from THEME.text once at
// boot so a re-skin only ever needs to edit theme.js (Standard v2 §2.5, THE-234 blocking #4). Labels that
// change with game state (Play/Daily/how-to Back-Next, pack names) are re-rendered elsewhere from the same
// THEME.text keys instead.
function applyThemeTextToDom() {
  const T = window.THEME.text;
  els.btnHowToTitle.textContent = T.howTo;
  els.btnPauseHowTo.textContent = T.howTo;
  els.btnSettingsTitle.textContent = T.settings;
  els.btnPauseSettings.textContent = T.settings;
  els.undo.querySelector(".lb-plate__label").textContent = T.takeBack;
  els.restart.querySelector(".lb-plate__label").textContent = T.restart;
  els.btnResume.querySelector(".lb-plate__label").textContent = T.resume;
  els.btnPauseRestart.querySelector(".lb-plate__label").textContent = T.restart;
  els.btnPauseLevels.querySelector(".lb-plate__label").textContent = T.levels;
  els.btnSettingsDone.querySelector(".lb-plate__label").textContent = T.howToDone;
  els.btnWatchDemo.textContent = T.watchDemo;
  els.settingsCredit.textContent = T.credit;
}

// Unlocked on the first real user gesture anywhere (DESIGN.md §8); harmless to call more than once.
document.addEventListener("pointerdown", Audio.unlock, { once: true });
document.addEventListener("keydown", Audio.unlock, { once: true });

// The medallion instance is rebuilt only when the level, stage size, DPR or skin actually change (DESIGN.md's
// pre-render split): rebuilding every frame would defeat the point of pre-rendering the ring sprites.
function ensureMedallion(lvl, stageEl) {
  const rect = stageEl.getBoundingClientRect();
  const R = rect.width / 2;
  const dpr = window.devicePixelRatio || 1;
  const key = `${lvl.id}:${lvl.n}:${Math.round(R)}:${dpr}:${save.settings.skin}`;
  if (!medallionCache || medallionCache.key !== key) {
    const canvas = stageEl.querySelector("canvas.lb-medallion");
    const boxSize = rect.width * 1.3;
    canvas.width = Math.round(boxSize * dpr);
    canvas.height = Math.round(boxSize * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, canvas.width / 2, canvas.height / 2);
    medallionCache = { key, medallion: createMedallion(lvl, R, dpr), R, ctx, canvas };
  }
  return medallionCache;
}

// DESIGN.md §7 "Spring-open": hold 120ms -> lume 40ms/ring arpeggio (hub -> bezel, i.e. innermost ring
// first) -> thunk + a 3px jolt (switchable) -> the lid swings 600ms -> the caseback. Reduced motion keeps
// the sound and the lume run (design.md motion tokens: "sound and lume stay") but skips the lid geometry
// for a flat 200ms pause standing in for its cross-fade.
const WIN_HOLD_MS = 120;
const WIN_LUME_STEP_MS = 40;
const WIN_LID_MS = 600;
const WIN_LID_REDUCED_MS = 200;
const WIN_BOLT_EASE_MS = 90;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

function startWinSequence(stars) {
  bumpGeneration();
  sequence = { type: "win", startTime: performance.now(), stars, lid: null, lumeSoundFired: false, thunkFired: false };
  ensureAnimating();
}

// DESIGN.md §6 "Fail slump": the lume fades 400ms, then each ring droops +8deg over 160ms (ease-in, outer
// ring first, 30ms stagger) and settles back over 240ms (ease-spring -- the same curve as the detent release
// ease). The clack plays as the first ring starts to settle.
const FAIL_LUME_FADE_MS = 400;
const FAIL_DROOP_MS = 160;
const FAIL_DROOP_STAGGER_MS = 30;
const FAIL_SETTLE_MS = 240;
const FAIL_DROOP_DEG = 8;

function startFailSequence() {
  bumpGeneration();
  sequence = { type: "fail", startTime: performance.now(), litAtStart: attempt.pos.map((p) => (p === 0 ? 1 : 0)), clackFired: false };
  ensureAnimating();
}

function failDroopOffset(ring, elapsedSinceDroopStart) {
  const t = elapsedSinceDroopStart - ring * FAIL_DROOP_STAGGER_MS;
  if (t < 0) return 0;
  if (t < FAIL_DROOP_MS) return FAIL_DROOP_DEG * Math.pow(t / FAIL_DROOP_MS, 2); // ease-in
  const st = t - FAIL_DROOP_MS;
  if (st < FAIL_SETTLE_MS) return FAIL_DROOP_DEG * (1 - easeSpring(st / FAIL_SETTLE_MS));
  return 0;
}

// Draws the current beat of the win/fail sequence and returns whether it's still running; opens the normal
// result/fail overlay itself once the sequence completes (so showResult() stays the single place that
// builds the caseback content).
function renderSequence() {
  const m = ensureMedallion(level, els.stage);
  const elapsed = performance.now() - sequence.startTime;
  const reduced = reduceMotion();

  if (sequence.type === "win") {
    const n = level.n;
    const lumeStart = WIN_HOLD_MS;
    const lumeEnd = lumeStart + n * WIN_LUME_STEP_MS;
    const burst = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const ring = n - 1 - i; // hub -> bezel: innermost ring's slot starts first
      burst[ring] = Math.max(0, Math.min(1, (elapsed - (lumeStart + i * WIN_LUME_STEP_MS)) / WIN_LUME_STEP_MS));
    }
    if (elapsed >= lumeStart && !sequence.lumeSoundFired) { sequence.lumeSoundFired = true; Audio.winArpeggio(n); }
    const bolt = Math.max(0, Math.min(1, (elapsed - lumeEnd) / WIN_BOLT_EASE_MS));
    if (elapsed >= lumeEnd && !sequence.thunkFired) {
      sequence.thunkFired = true;
      Audio.thunk();
      if (save.settings.shake && !reduced) {
        els.stage.classList.add("is-jolt");
        setTimeout(() => els.stage.classList.remove("is-jolt"), 200);
      }
    }
    const state = frameState(level, attempt, null);
    state.burst = burst;
    state.bolt = bolt;

    const lidDuration = reduced ? WIN_LID_REDUCED_MS : WIN_LID_MS;
    if (elapsed >= lumeEnd && !reduced) {
      if (!sequence.lid) sequence.lid = m.medallion.snapshot(Object.assign({}, state, { burst: burst.map(() => 1), bolt: 1 }));
      drawMedallion(m.medallion, m.ctx, 0, 0, Object.assign({}, state, { shadow: false }));
      const t = Math.min(1, (elapsed - lumeEnd) / lidDuration);
      m.medallion.drawDial(m.ctx, 0, 0, { kicker: "Opened in", big: String(attempt.used), sub: `moves · par ${level.par}`, stars: sequence.stars });
      m.medallion.drawLid(m.ctx, 0, 0, sequence.lid, easeOutCubic(t) * 90);
    } else {
      drawMedallion(m.medallion, m.ctx, 0, 0, state);
    }

    if (elapsed >= lumeEnd + lidDuration) {
      const stars = sequence.stars;
      sequence = null;
      showResult(true, stars);
      return false;
    }
    return true;
  }

  // fail
  const n = level.n;
  const litFade = Math.max(0, 1 - elapsed / FAIL_LUME_FADE_MS);
  const droopElapsed = elapsed - FAIL_LUME_FADE_MS;
  const angles = attempt.pos.map((p, i) => p * 45 + (droopElapsed >= 0 ? failDroopOffset(i, droopElapsed) : 0));
  const lit = sequence.litAtStart.map((v) => v * (droopElapsed >= 0 ? 0 : litFade));
  if (droopElapsed >= FAIL_DROOP_MS && !sequence.clackFired) { sequence.clackFired = true; Audio.clack(); }
  drawMedallion(m.medallion, m.ctx, 0, 0, { angles, lit, used: attempt.used, budget: level.budget, selected: null });

  const totalMs = FAIL_LUME_FADE_MS + (n - 1) * FAIL_DROOP_STAGGER_MS + FAIL_DROOP_MS + FAIL_SETTLE_MS;
  if (elapsed >= totalMs) {
    sequence = null;
    showResult(false, 0);
    return false;
  }
  return true;
}

// Returns whether the rAF loop should keep going (a live drag, a release ease still settling, or a win/fail
// sequence still playing).
function renderPlay() {
  if (sequence) return renderSequence();
  const m = ensureMedallion(level, els.stage);
  const live = computeLiveOffset();
  drawMedallion(m.medallion, m.ctx, 0, 0, frameState(level, attempt, live));
  els.playTitle.textContent = demoActive ? "Demo" : dailyMode ? `No. ${Progress.dailyNumber(clockNow())}` : `Level ${level.id}`;
  const left = level.budget - attempt.used;
  els.movesNum.textContent = String(left);
  els.movesWindow.classList.toggle("is-last", left === 1);
  const undoSpent = attempt.takeBackLeft <= 0 || attempt.outcome === "solved";
  els.undo.disabled = undoSpent;
  els.undo.querySelector(".lb-pip").classList.toggle("is-spent", undoSpent);
  updateCrowns();
  return !!(liveDrag || releaseEase);
}

// Crown buttons are built once per level mount (buildCrowns) and only ever toggled in place afterwards
// (updateCrowns): a pointer-down on a crown fires onBeginDrag -> renderPlay synchronously, and if that call
// chain replaced the DOM node mid-event, the node holding pointer capture would leave the document and stop
// receiving pointermove (THE-240).
function buildCrowns() {
  els.crowns.innerHTML = "";
  for (let i = 0; i < level.n; i++) {
    const dead = level.driveOnly.includes(i);
    const btn = document.createElement("button");
    btn.className = "lb-crown" + (dead ? " is-dead" : "");
    btn.dataset.ring = i;
    btn.setAttribute("aria-label", "Ring " + (i + 1));
    if (dead) btn.setAttribute("aria-disabled", "true");
    let svg = '<svg class="lb-crown__pict" viewBox="-12 -12 24 24">';
    for (let k = 0; k < level.n; k++) svg += `<circle class="lb-crown__ring${k === i ? " is-on" : ""}" r="${11 - k * 1.7}"/>`;
    btn.innerHTML = svg + '</svg><span class="lb-crown__key">' + (i + 1) + "</span>";
    if (!dead) io.attachCrown(btn, i);
    els.crowns.appendChild(btn);
  }
}

function updateCrowns() {
  const buttons = els.crowns.children;
  for (let i = 0; i < buttons.length; i++) buttons[i].classList.toggle("is-active", i === attempt.dragRing);
}

function saveCurrent() {
  // The demo's scratch attempt never touches real save data (THE-234 blocking #3) -- it plays on a level
  // that isn't in the catalog and has no business overwriting whatever real progress is paused underneath it.
  if (level === DEMO_LEVEL) return;
  // lastMove is always saved null: the open merge doesn't survive a reload (spec §2 "Reload mid-level"),
  // so there is never anything meaningful to restore into it.
  if (dailyMode) {
    daily.attempt = { pos: attempt.pos.slice(), used: attempt.used, takeBackLeft: attempt.takeBackLeft };
    Save.persistDaily(storage, daily);
  } else {
    save.current = { id: level.id, pos: attempt.pos.slice(), used: attempt.used, takeBackLeft: attempt.takeBackLeft, lastMove: null };
    persist();
  }
}

function onOutcome() {
  if (level === DEMO_LEVEL) return; // the demo's scripted win/fail beats run their own sequences directly
  if (attempt.outcome === "solved") {
    if (dailyMode) {
      // The first opening is the recorded result and the share line; a replay never overwrites it, and a
      // failed attempt earlier the same day caps it at ★★ (spec rev 3 "Daily").
      if (!daily.result) {
        const stars = Progress.cappedStars(Progress.starsFor(attempt.used, level.par), daily.failedAttempts);
        daily.result = { moves: attempt.used, stars };
        streak = Progress.advanceStreak(streak, clockNow());
        Save.persistStreak(storage, streak);
      }
      daily.attempt = null;
      Save.persistDaily(storage, daily);
      startWinSequence(daily.result.stars);
    } else {
      const stars = Progress.starsFor(attempt.used, level.par);
      save.levels = Progress.mergeLevelResult(save.levels, level.id, stars, attempt.used);
      save.skin2Unlocked = save.skin2Unlocked || Progress.skin2Unlocked(save.levels);
      save.current = null;
      persist();
      startWinSequence(stars);
    }
  } else if (attempt.outcome === "failed") {
    if (dailyMode) {
      daily.failedAttempts += 1;
      daily.attempt = null; // reload after a fail starts a fresh attempt, same rule as the main pack
      Save.persistDaily(storage, daily);
    } else {
      save.current = null; // reload after a fail starts a fresh attempt (spec §2 "Reload mid-level")
      persist();
    }
    // The fail slump (DESIGN.md §6) is the "why" beat before the caseback covers the board (designer's
    // feel check, THE-233 amendment C): renderPlay() already painted the final, failed board (called by
    // onEndDrag before onOutcome), so the knocked-off ring is visible through the whole animation.
    startFailSequence();
  }
}

function shareDailyResult() {
  if (!daily.result) return;
  const text = Progress.shareText(Progress.dailyNumber(clockNow()), daily.result.moves, daily.result.stars, window.THEME.shareUrl);
  if (navigator.share) navigator.share({ text }).catch(() => {});
  else if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(() => {});
}

function makePlate(label, primary, fn) {
  const b = document.createElement("button");
  b.className = "lb-plate " + (primary ? "lb-plate--primary" : "lb-plate--secondary");
  const span = document.createElement("span");
  span.className = "lb-plate__label";
  span.textContent = label;
  b.appendChild(span);
  b.addEventListener("click", fn);
  return b;
}

function showResult(won, stars) {
  els.resultBig.textContent = String(won ? attempt.used : level.budget - attempt.used);
  els.resultSub.textContent = won ? `moves · par ${level.par}` : `moves left · par ${level.par}`;
  // `.lb-sharebox { display: block }` in skin.css outranks the `hidden` attribute's UA display:none (both
  // are just `display`, and a class selector beats the attribute), so an empty share box showed on every
  // non-daily win (designer's feel check, THE-233 D2). An inline style wins on specificity.
  els.resultSharebox.hidden = true;
  els.resultSharebox.style.display = "none";
  const starEls = els.resultStars.querySelectorAll(".lb-star");
  starEls.forEach((el, i) => el.classList.toggle("is-lit", won && i < stars));

  const T = window.THEME.text;
  if (won) {
    els.resultPlates.innerHTML = "";
    if (dailyMode) {
      els.resultSharebox.hidden = false;
      els.resultSharebox.style.display = "";
      els.resultSharebox.textContent = Progress.shareText(Progress.dailyNumber(clockNow()), daily.result.moves, daily.result.stars, window.THEME.shareUrl);
      els.resultPlates.appendChild(makePlate(T.share, true, shareDailyResult));
      els.resultPlates.appendChild(makePlate(T.replay, false, startDaily));
    } else {
      // Only one "Replay" plate: the primary slot is "Next medallion" when there's a level after this one,
      // else it's the sole plate and takes the primary spot itself (there was a duplicate secondary Replay
      // plate here before, CTO code review non-blocking item).
      if (byId.has(level.id + 1)) {
        els.resultPlates.appendChild(makePlate(T.next, true, () => startLevel(level.id + 1)));
        els.resultPlates.appendChild(makePlate(T.replay, false, () => startLevel(level.id)));
      } else {
        els.resultPlates.appendChild(makePlate(T.replay, true, () => startLevel(level.id)));
      }
    }
    openOverlay("result");
  } else {
    // The fail overlay's big numeral was left as its static "0" placeholder in the markup (never wired --
    // designer's feel check, THE-233 D2), and "moves left" needs to singularize at 1.
    const left = level.budget - attempt.used;
    els.failBig.textContent = String(left);
    els.failSub.textContent = `${left} move${left === 1 ? "" : "s"} left · par ${level.par}`;
    els.failPlates.innerHTML = "";
    els.failPlates.appendChild(makePlate(T.retry, true, () => (dailyMode ? startDaily() : startLevel(level.id))));
    if (attempt.takeBackLeft > 0) {
      const b = makePlate(T.takeBack, false, () => { doTakeBack(); closeOverlay(); });
      b.appendChild(Object.assign(document.createElement("i"), { className: "lb-pip" }));
      els.failPlates.appendChild(b);
    }
    openOverlay("fail");
  }
}

// Maps level.js's events to DESIGN.md §8's synth events. Driven-ring-dragged-alone (the one-way lift) is
// detected inline rather than via an exported helper: a "detent" on a ring that has a driver, while that
// ring itself is the one being dragged, is exactly that case.
// "deadEnd" (clack) and "solved" (thunk + the win arpeggio) are deliberately not handled here: those play
// as part of the timed fail/win sequences below (startFailSequence/startWinSequence), synced to their
// visual beats (the settle, and the lume run reaching the bezel) rather than firing instantly mid-drag.
function playEvents(events) {
  for (const e of events) {
    if (e.type === "tock") Audio.tock();
    else if (e.type === "detent") {
      Audio.detentClick();
      if (level.links.some((l) => l.to === e.ring)) Audio.tickUp();
    } else if (e.type === "gapAligned") Audio.gapTing(e.ring, level.n);
    else if (e.type === "freeWind") Audio.ratchet(level.budget);
  }
}

function mountPlayInput() {
  if (io) io.destroy();
  // Every handler re-checks inputLive() first (spec §2 "Pause/dialog": ring and key input are blocked while
  // any overlay is open), since the keyboard listener stays attached to `document` and `.lb-stage` keeps
  // receiving pointer events regardless of which overlay sits on top of the play screen.
  io = attachInput(els.stage, {
    onBeginDrag: (ring) => {
      if (!inputLive()) return;
      // Grabbing any ring snaps a running release ease to its end state and starts the new drag at once
      // (spec §2 "Input during a detent ease"); liveDrag itself is set below regardless of the merge rule,
      // since a drive-only ring's tock still deserves the "gripped" visual even though it never turns.
      releaseEase = null;
      let events;
      ({ state: attempt, events } = Level.beginDrag(attempt, ring));
      playEvents(events);
      liveDrag = { ring, frac: 0 };
      renderPlay();
    },
    onTurn: (ring, d) => {
      if (!inputLive()) return;
      let events;
      ({ state: attempt, events } = Level.turn(attempt, ring, d));
      playEvents(events);
      renderPlay();
      saveCurrent();
      // The result overlay itself waits for the gesture to actually end (below): the merge is still open
      // and the model already locks further moves once attempt.outcome is set, but popping the caseback up
      // mid-drag covers the board before the player's finger has even lifted, hiding the ring that failed
      // it (designer's feel check, THE-233 amendment D).
    },
    onDragMove: (ring, frac) => {
      if (!inputLive()) return;
      liveDrag = { ring, frac };
      ensureAnimating();
      renderPlay();
    },
    onEndDrag: (ring, frac) => {
      if (!inputLive()) return;
      ({ state: attempt } = Level.endDrag(attempt));
      liveDrag = null;
      // The live offset eases back to the resting notch over 140ms with the spec's overshoot, rather than
      // snapping instantly -- the designer's feel check's #1 priority note.
      if (frac) {
        releaseEase = { ring, moveFrom: frac, startTime: performance.now() };
        ensureAnimating();
      }
      renderPlay();
      if (attempt.outcome) onOutcome();
    },
    onTakeBack: () => { if (inputLive()) doTakeBack(); },
    onRestart: () => { if (inputLive()) doRestart(); },
    onPause: () => { if (inputLive()) openOverlay("pause"); },
  });
  io.setLevel(level);
  buildCrowns();
}

function doTakeBack() {
  let events;
  ({ state: attempt, events } = Level.takeBack(attempt));
  if (events.length) Audio.platePress();
  renderPlay();
  saveCurrent();
  if (events.some((e) => e.type === "resumedFromFail")) closeOverlay();
}

function doRestart() {
  bumpGeneration(); // restart cancels any in-flight drag/release-ease animation (design.md timer registry)
  ({ state: attempt } = Level.restart(attempt));
  Audio.ratchet(2);
  renderPlay();
  saveCurrent();
  closeOverlay();
}

// Reload mid-level restores ring offsets, moves used and Take-back state, but the open merge does not
// survive (spec §2 "Reload mid-level") -- the next drag of any ring is always a fresh move after a reload.
function attemptFromSaved(lvl, saved, freeWind) {
  if (!saved || saved.id !== lvl.id) return null;
  if (saved.pos.length !== lvl.n || saved.used > lvl.budget) return null;
  return { level: lvl, pos: saved.pos.slice(), used: saved.used, takeBackLeft: saved.takeBackLeft, dragRing: null, lastMove: null, spent: false, outcome: null, freeWind: !!freeWind };
}

function startLevel(id) {
  const lvl = byId.get(id);
  if (!lvl || !Progress.packUnlocked(lvl.pack, save.levels)) return;
  level = lvl;
  dailyMode = false;
  const freeWind = FREE_WIND_IDS.has(id);
  attempt = attemptFromSaved(lvl, save.current, freeWind) || Level.createAttempt(lvl, { freeWind });
  closeOverlay();
  showScreen("play");
  mountPlayInput();
  renderPlay();
  saveCurrent();
}

// A cached daily whose date isn't today's local date is dropped and regenerated (spec §2 "Daily"). The
// daily's level is deterministic from the date, so it is never trusted from storage even when the date
// matches -- only `attempt`/`result`/`failedAttempts` carry over. This is what keeps a corrupted or
// stale-build cached level (e.g. bad `links`/`driveOnly` indices) from crashing Daily for the rest of the
// day (THE-234 blocking #1). Not yet gated to "while the start screen is idle" (spec §3's ≤500ms budget) --
// that timing refinement is M5; this generates synchronously, which is already well under budget per the
// generator's own measurements.
function ensureDaily() {
  const { y, m, d } = Progress.localDateParts(clockNow());
  const today = Progress.dateKey({ y, m, d });
  const level = dailyLevel(y, m, d);
  if (daily.date === today) {
    daily = { v: 1, date: today, level, attempt: daily.attempt, result: daily.result, failedAttempts: daily.failedAttempts };
  } else {
    daily = { v: 1, date: today, level, attempt: null, result: null, failedAttempts: 0 };
    Save.persistDaily(storage, daily);
  }
}

function startDaily() {
  ensureDaily();
  level = { ...daily.level, id: "daily" };
  dailyMode = true;
  const saved = daily.attempt;
  attempt = saved && saved.pos.length === level.n && saved.used <= level.budget
    ? { level, pos: saved.pos.slice(), used: saved.used, takeBackLeft: saved.takeBackLeft, dragRing: null, lastMove: null, spent: false, outcome: null, freeWind: false }
    : Level.createAttempt(level, { freeWind: false });
  closeOverlay();
  showScreen("play");
  mountPlayInput();
  renderPlay();
  saveCurrent();
}

// --- first-run demo (spec §5: goal -> fail rule -> rewind + solve, ~8-10s, skippable, replayable from
// How-to). A 3-ring, 1-claw, 2-baton medallion, reusing the real level.js/render.js/audio.js exactly as a
// live play session would (so the coupling, the dead-end check and every sound are the genuine mechanics,
// not a faked-up cutscene) -- only the moves themselves are scripted instead of pointer-driven, and drawn
// with a ghost fingertip (`.lb-ghost`, DESIGN.md) instead of the real cursor.
const DEMO_LEVEL = { id: "demo", n: 3, links: [{ from: 1, to: 0, type: "claw" }], driveOnly: [], start: [3, 3, 5], par: 2, budget: 2 };

function ghostMoveTo(ring, notch) {
  const stageBox = els.stage.getBoundingClientRect();
  const R = stageBox.width / 2;
  const geo = medallionGeometry(level, R);
  const rad = (notch / 8) * 2 * Math.PI;
  const x = R + geo.rings[ring].mid * Math.sin(rad);
  const y = R - geo.rings[ring].mid * Math.cos(rad);
  els.ghost.style.transform = `translate(${x}px, ${y}px)`;
}

function demoWait(ms) {
  return new Promise((resolve) => { demoStepTimer = setTimeout(resolve, ms); });
}

async function runDemoScript(onDone) {
  // Beat 1 (goal): drag ring 1 by -3 notches. Since the claw carries ring 0 the same way and both start at
  // notch 3, this single move lands *both* gaps under the index at once -- coupling, unmistakably.
  ghostMoveTo(1, 0);
  await demoWait(500);
  if (!demoActive) return;
  els.ghost.classList.add("is-down");
  ({ state: attempt } = Level.beginDrag(attempt, 1));
  renderPlay();
  await demoWait(150);
  // Applied as ONE atomic turn(ring, -3) rather than three turn(ring, -1) calls, deliberately: this demo
  // level has zero slack (budget === par, chosen so beat 2 below can genuinely fail after exactly two wrong
  // moves), and the dead-end check's "minimum over the open ring's 8 positions" formula correctly sees
  // ring 2 as still needing its own move regardless of where ring 1 ends up -- so evaluating it after only
  // the first of three individual detents (ring 1 not yet at its final value) reports more moves needed
  // than remain, and fails mid-drag. A real live drag would hit this identical interaction on any level
  // with zero slack; every shipped level has slack >= 1 (loop-break-gen.mjs's verifyLevel requires it), but
  // this exact multi-notch-in-one-gesture path isn't something loop-break-qa.mjs's bots exercise (they
  // apply each decision's full delta in one turn() call, never split across several detents the way a real
  // drag naturally would) -- flagged to the CTO as a QA coverage gap worth its own real-browser probe. The
  // ghost's visual position still eases through the 3 intermediate notches below, one click each.
  ({ state: attempt } = Level.turn(attempt, 1, -3));
  for (let i = 1; i <= 3 && demoActive; i++) {
    ghostMoveTo(1, 3 - i);
    Audio.detentClick();
    renderPlay();
    await demoWait(220);
  }
  if (!demoActive) return;
  Audio.gapTing(0, 3);
  Audio.gapTing(1, 3);
  els.ghost.classList.remove("is-down");
  ({ state: attempt } = Level.endDrag(attempt));
  renderPlay();
  await demoWait(900);
  if (!demoActive) return;

  // Fresh attempt, both batons back, for the fail-rule beat.
  ({ state: attempt } = Level.restart(attempt));
  renderPlay();
  await demoWait(350);
  if (!demoActive) return;

  // Beat 2 (fail rule): drag ring 2 -- unlinked, wrong -- twice. Touching ring 1 with no turn between the
  // two closes the first merge for free, so this genuinely spends two separate batons (spec §2's merge
  // rule), tripping the real dead-end check exactly as it would in play.
  for (let rep = 0; rep < 2 && demoActive; rep++) {
    ghostMoveTo(2, 5);
    await demoWait(280);
    if (!demoActive) return;
    if (rep === 1) ({ state: attempt } = Level.beginDrag(attempt, 1));
    els.ghost.classList.add("is-down");
    ({ state: attempt } = Level.beginDrag(attempt, 2));
    renderPlay();
    await demoWait(150);
    ghostMoveTo(2, 6);
    ({ state: attempt } = Level.turn(attempt, 2, 1));
    Audio.detentClick();
    renderPlay();
    await demoWait(250);
    els.ghost.classList.remove("is-down");
    ({ state: attempt } = Level.endDrag(attempt));
    renderPlay();
    await demoWait(250);
    if (attempt.outcome === "failed") break;
  }
  if (!demoActive) return;
  Audio.clack();
  await demoWait(500);
  if (!demoActive) return;

  // Beat 3 (rewind + solve): the ratchet, then the ghost plays it correctly this time.
  Audio.ratchet(2);
  ({ state: attempt } = Level.restart(attempt));
  renderPlay();
  await demoWait(550);
  if (!demoActive) return;

  ghostMoveTo(1, 0);
  await demoWait(350);
  if (!demoActive) return;
  els.ghost.classList.add("is-down");
  ({ state: attempt } = Level.beginDrag(attempt, 1));
  renderPlay();
  await demoWait(120);
  // Atomic for the same reason as beat 1's identical drag above (this demo level's zero slack).
  ({ state: attempt } = Level.turn(attempt, 1, -3));
  for (let i = 1; i <= 3 && demoActive; i++) {
    ghostMoveTo(1, 3 - i);
    Audio.detentClick();
    renderPlay();
    await demoWait(160);
  }
  if (!demoActive) return;
  Audio.gapTing(0, 3);
  Audio.gapTing(1, 3);
  els.ghost.classList.remove("is-down");
  ({ state: attempt } = Level.endDrag(attempt));
  renderPlay();
  await demoWait(500);
  if (!demoActive) return;

  ghostMoveTo(2, 5);
  await demoWait(300);
  if (!demoActive) return;
  els.ghost.classList.add("is-down");
  ({ state: attempt } = Level.beginDrag(attempt, 2));
  renderPlay();
  await demoWait(120);
  for (let i = 1; i <= 3 && demoActive; i++) {
    ghostMoveTo(2, 5 + i);
    ({ state: attempt } = Level.turn(attempt, 2, 1));
    Audio.detentClick();
    renderPlay();
    await demoWait(160);
  }
  if (!demoActive) return;
  els.ghost.classList.remove("is-down");
  ({ state: attempt } = Level.endDrag(attempt));
  renderPlay();
  if (attempt.outcome === "solved") {
    Audio.thunk();
    Audio.winArpeggio(3);
  }
  await demoWait(900);
  if (!demoActive) return;
  endDemo(onDone);
}

let demoOnDone = null; // so the Skip button (a single always-bound listener) ends the *current* demo the
// same way its own script would have -- back to L1 for a first-run play, back to how-to when watched from there.
// Whatever was live before the demo started (screen/level/attempt/dailyMode), so "Watch the demo" from Pause
// or How-to can restore it instead of stranding the player on the demo's scratch board afterward (THE-234
// blocking #3). Null for the first-run demo, which starts from the title screen with nothing to restore --
// its onDone (goToPlay) already sets up a real level itself.
let demoSnapshot = null;

function startDemo(onDone) {
  if (screen === "play" && level !== DEMO_LEVEL) demoSnapshot = { screen, level, attempt, dailyMode };
  demoActive = true;
  demoOnDone = onDone;
  level = DEMO_LEVEL;
  dailyMode = false;
  attempt = Level.createAttempt(DEMO_LEVEL, { freeWind: false });
  closeOverlay(); // "Watch the demo" is a link inside the how-to overlay; it must not stay open over the play screen
  showScreen("play");
  mountPlayInput();
  renderPlay();
  els.ghost.hidden = false;
  els.btnSkipDemo.hidden = false;
  els.ghost.classList.remove("is-down");
  els.side.hidden = true; // the crowns/plates are inert during the demo (inputLive() blocks them); hide the clutter
  runDemoScript(onDone).catch((e) => { console.error("demo script error:", e); endDemo(onDone); });
}

function endDemo(onDone) {
  if (!demoActive) return;
  demoActive = false;
  demoOnDone = null;
  if (demoStepTimer) { clearTimeout(demoStepTimer); demoStepTimer = null; }
  els.ghost.hidden = true;
  els.btnSkipDemo.hidden = true;
  els.side.hidden = false;
  if (demoSnapshot) {
    ({ level, attempt, dailyMode } = demoSnapshot);
    showScreen(demoSnapshot.screen);
    demoSnapshot = null;
    mountPlayInput();
    renderPlay();
  }
  onDone();
}

function packStats(pack) {
  const levels = PACKS[pack - 1];
  const done = levels.filter((l) => save.levels[l.id]).length;
  const stars = levels.reduce((sum, l) => sum + (save.levels[l.id] ? save.levels[l.id].stars : 0), 0);
  return { done, stars, count: levels.length };
}

function goLevelMap() {
  closeOverlay();
  showScreen("map");
  const totalStars = CATALOG.reduce((sum, l) => sum + (save.levels[l.id] ? save.levels[l.id].stars : 0), 0);
  els.mapTitle.textContent = `${window.THEME.text.levels} · ${totalStars} / ${TOTAL_STARS} ★`;
  els.packs.innerHTML = "";
  const names = window.THEME.text.packs;
  PACKS.forEach((levels, p) => {
    const pack = p + 1;
    const unlocked = Progress.packUnlocked(pack, save.levels);
    const nextUp = levels.find((l) => !save.levels[l.id]);
    let coins = "";
    levels.forEach((lvl, i) => {
      const best = save.levels[lvl.id];
      const state = !unlocked ? "is-locked" : best ? "is-done" : nextUp && nextUp.id === lvl.id ? "is-current" : "";
      coins += `<button class="lb-level ${state}" style="--i:${i}" data-id="${lvl.id}" ${!unlocked ? "disabled" : ""}>` +
        `<span class="lb-level__num">${lvl.id}</span>` +
        (best ? `<span class="lb-stars">${[0, 1, 2].map((k) => `<i class="lb-star${k < best.stars ? " is-lit" : ""}"></i>`).join("")}</span>` : "") +
        "</button>";
    });
    const { done, stars } = packStats(pack);
    els.packs.insertAdjacentHTML("beforeend",
      `<section class="lb-pack${unlocked ? "" : " is-locked"}"><div class="lb-caseback lb-caseback--pack">` +
      `<div class="lb-caseback__body"><h2 class="lb-pack__title"></h2>` +
      `<span class="lb-pack__count">${stars} / ${levels.length * 3} ★</span></div>${coins}</div></section>`);
    // theme.js text goes in through textContent, never into the HTML string.
    els.packs.lastElementChild.querySelector(".lb-pack__title").textContent = `${pack} · ${names[p]}`;
  });
  for (const btn of els.packs.querySelectorAll(".lb-level:not([disabled])")) {
    btn.addEventListener("click", () => startLevel(Number(btn.dataset.id)));
  }
}

function renderTitle() {
  ensureDaily();
  const now = clockNow();
  const dateStr = now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const no = Progress.dailyNumber(now);
  els.datelineText.textContent = `${dateStr} · No. ${no}`;
  const streakCount = Progress.effectiveStreak(streak, now);
  els.streakPips.innerHTML = Array.from({ length: 7 }, (_, i) => `<i class="lb-pip${i < streakCount ? " is-lit" : ""}"></i>`).join("");
  els.arcShade.textContent = window.THEME.title;
  els.arcFill.textContent = window.THEME.title;
  els.tagline.textContent = window.THEME.tagline;
  const T = window.THEME.text;
  const playId = nextPlayLevel();
  els.btnPlay.querySelector(".lb-plate__label").textContent = playId === 1 && !save.current ? T.play : `${T.play} · Level ${playId}`;
  els.btnDaily.querySelector(".lb-plate__label").textContent = `${T.daily} No. ${no}`;
  const dailyLocked = !save.levels[3];
  els.btnDaily.classList.toggle("is-locked", dailyLocked);
  els.btnDaily.disabled = dailyLocked;
  els.dailyNote.textContent = dailyLocked ? "after level 3" : "";

  // A fixed decorative medallion (idle spin/seconds-hand is M5 motion work, per DESIGN.md §4/§9).
  const titleLevel = { id: "title", n: 4, links: [{ from: 0, to: 1, type: "claw" }], driveOnly: [] };
  const m = ensureMedallion(titleLevel, els.titleMedallion.parentElement);
  drawMedallion(m.medallion, m.ctx, 0, 0, { angles: [0, 0, 0, 45], lit: [1, 1, 1, 0] });
}

function goTitle() {
  closeOverlay();
  showScreen("title");
  renderTitle();
}

function openSettings(fromPause) {
  pauseReturn = fromPause ? "pause" : null;
  openOverlay("settings");
}

function closeSettings() {
  applySettingsToDom();
  if (medallionCache) medallionCache = null; // force a rebuild: the skin swap invalidates every cached sprite
  if (pauseReturn) openOverlay(pauseReturn);
  else if (screen === "play") closeOverlay();
  else { closeOverlay(); renderTitle(); }
}

// The how-to opens over pause and closes back to it when that's the opener (designer's dialog rule, THE-231).
function openHowTo(fromPause) {
  pauseReturn = fromPause ? "pause" : null;
  openOverlay("howto");
}

function closeHowTo() {
  if (pauseReturn) openOverlay(pauseReturn);
  else closeOverlay();
}

// The one-more-go path (THE-246): a level in progress resumes it; otherwise pick up the first unfinished
// level in an unlocked pack, so a returning player isn't dropped back on Level 1 once one is complete.
function nextPlayLevel() {
  if (save.current && byId.has(save.current.id)) return save.current.id;
  const next = CATALOG.find((l) => !save.levels[l.id] && Progress.packUnlocked(l.pack, save.levels));
  return next ? next.id : CATALOG[CATALOG.length - 1].id;
}

els.btnPlay.addEventListener("click", () => {
  const goToPlay = () => startLevel(nextPlayLevel());
  // "The first 20s of a first run can't be lost" (html5-game-standards §2.2): the demo plays once, automatically,
  // before L1 -- never again unless replayed from How-to.
  if (!save.firstRunDone) {
    save.firstRunDone = true;
    persist();
    startDemo(goToPlay);
  } else {
    goToPlay();
  }
});
els.btnDaily.addEventListener("click", startDaily);
// From Pause, endDemo restores the paused level first; from the title there is nothing to restore, so go back
// to the title screen rather than leaving the how-to open over the demo's scratch board.
els.btnWatchDemo.addEventListener("click", () => {
  const fromPause = pauseReturn === "pause";
  const fromPlay = screen === "play";
  startDemo(() => {
    if (!fromPlay) goTitle();
    openHowTo(fromPause);
  });
});
els.btnSkipDemo.addEventListener("click", () => { if (demoOnDone) endDemo(demoOnDone); });
els.btnHowToTitle.addEventListener("click", () => openHowTo(false));
els.btnSettingsTitle.addEventListener("click", () => openSettings(false));
els.btnMapBack.addEventListener("click", goTitle);
els.btnPause.addEventListener("click", () => { if (!demoActive) openOverlay("pause"); });
els.btnPauseHowTo.addEventListener("click", () => openHowTo(true));
els.btnResume.addEventListener("click", closeOverlay);
els.btnPauseRestart.addEventListener("click", doRestart);
els.btnPauseLevels.addEventListener("click", goLevelMap);
els.btnPauseSettings.addEventListener("click", () => openSettings(true));
els.btnSettingsDone.addEventListener("click", () => {
  // The checkbox is a single "reduce motion" toggle, so it can only express "reduce" vs. "not reduce" -- it
  // must not collapse an existing "full" (explicit always-on motion, overriding an OS reduce-motion
  // preference) down to "os" just because the box reads unchecked (CTO code review non-blocking item).
  const motion = els.settingMotion.checked ? "reduce" : save.settings.motion === "full" ? "full" : "os";
  save.settings = {
    sound: els.settingSound.checked,
    haptics: els.settingHaptics.checked,
    shake: els.settingShake.checked,
    motion,
    skin: save.settings.skin,
  };
  persist();
  closeSettings();
});
els.skinPicker.addEventListener("click", (e) => {
  const btn = e.target.closest(".lb-skin");
  if (!btn || btn.classList.contains("is-locked")) return;
  save.settings = { ...save.settings, skin: btn.dataset.skin };
  applySettingsToDom();
});
els.undo.addEventListener("click", () => { if (!demoActive) doTakeBack(); });
els.restart.addEventListener("click", () => { if (!demoActive) doRestart(); });
els.btnResultLevels.addEventListener("click", goLevelMap);
els.btnFailLevels.addEventListener("click", goLevelMap);
els.btnHowToBack.addEventListener("click", () => {
  if (howtoIndex === 0) closeHowTo();
  else { howtoIndex--; renderHowTo(); }
});
els.btnHowToNext.addEventListener("click", () => {
  if (howtoIndex === HOWTO_STEPS.length - 1) closeHowTo();
  else { howtoIndex++; renderHowTo(); }
});

// A UI press on any plate/link (DESIGN.md §8 "Plate press"). Delegated so every screen's buttons get it for
// free; crowns are excluded since dragging one already plays detent clicks.
document.addEventListener("click", (e) => {
  if (e.target.closest(".lb-plate, .lb-link, .lb-skin")) Audio.platePress();
});

goTitle();

// --- test hook (design.md "Test hook") ---
window.__loopBreak = {
  state: () => (attempt ? { ...attempt, pos: attempt.pos.slice() } : null),
  level: () => level,
  loadLevel: (id) => startLevel(id),
  loadDaily: (y, m, d) => {
    clockNow = () => new Date(y, m - 1, d);
    startDaily();
  },
  drag(ring, notches) {
    ({ state: attempt } = Level.beginDrag(attempt, ring));
    const step = notches > 0 ? 1 : -1;
    for (let i = 0; i < Math.abs(notches); i++) {
      ({ state: attempt } = Level.turn(attempt, ring, step));
      if (attempt.outcome) break;
    }
    ({ state: attempt } = Level.endDrag(attempt));
    renderPlay();
    saveCurrent();
    if (attempt.outcome) onOutcome();
  },
  crown(ring, notches) {
    window.__loopBreak.drag(ring, notches);
  },
  takeBack: doTakeBack,
  restart: doRestart,
  solve: () => solve(level, attempt.pos),
  bots: {
    planner: (state) => {
      const plan = solve(state.level, state.pos);
      return plan && plan.length ? plan[0] : null;
    },
    fixer: (state, rng) => {
      const off = grabbable(state.level).filter((r) => state.pos[r] !== 0);
      if (!off.length) return null;
      const r = off[Math.floor(rng() * off.length)];
      return { ring: r, d: ((-state.pos[r] % 8) + 8) % 8 };
    },
    random: (state, rng) => {
      const grab = grabbable(state.level);
      const r = grab[Math.floor(rng() * grab.length)];
      return { ring: r, d: 1 + Math.floor(rng() * 7) };
    },
  },
  skipAnimations: (v) => { animSkip = !!v; },
  setClock: (date) => { clockNow = () => date; },
  save: () => persist(),
};
