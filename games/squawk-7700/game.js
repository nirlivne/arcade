// rAF loop, fixed 60 Hz accumulator (<= 5 steps/frame), pause sources, window.__squawk test hook.
// ?seed=N picks the run seed; ?debug=1 shows the draw-call/triangle overlay. ?menu=0 skips the title
// screen (test convenience: real-pointer tests that only care about in-beat physics).
import * as Sim from "./sim.js";
import { DIVE, levelOffCallout } from "./beats/dive.js";
import { LANDING } from "./beats/landing.js";
import { DOOR } from "./beats/door.js";
import { AISLE } from "./beats/aisle.js";
import { createInput } from "./input.js";
import { createSave, SAVE_KEY } from "./save.js";
import { createHud } from "./hud.js";
import { createMenu } from "./menu.js";
import { createRenderer, createDebugOverlay } from "./render.js";
import { createAudio } from "./audio.js";
import { todaySeed, shareText } from "./daily.js";

const theme = window.THEME;
// theme.colors overrides tokens.css's --sq-* custom properties (spec §8 theme swap check).
for (const [name, value] of Object.entries(theme.colors || {})) {
  if (/^--[\w-]+$/.test(name) && typeof value === "string") document.documentElement.style.setProperty(name, value);
}
document.title = theme.title;
const DT = 1 / 60;
const params = new URLSearchParams(location.search);
const debugOn = params.get("debug") === "1";
const seedParam = Number(params.get("seed"));
const skipMenu = params.get("menu") === "0";
const touch = matchMedia("(pointer: coarse)").matches;

// Site storage blocked (Chrome/Safari privacy settings): the `window.localStorage` getter itself
// throws SecurityError, before save.js's own try/catch around getItem/setItem ever runs -- the whole
// module used to die right here, with no title screen and no __squawk hook (CTO review r2 #2). Fall
// back to an in-memory store so the game still plays, just without saving across reloads.
function getStorage() {
  try { return window.localStorage; } catch (e) { return memoryStorage(); }
}
function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, v) };
}
const storage = getStorage();
let isFirstEverLoad = true;
try { isFirstEverLoad = storage.getItem(SAVE_KEY) == null; } catch (e) { /* treat as first-ever */ }
const save = createSave(storage);
// A brand-new player's reduced-motion setting starts from the OS preference (Comforts: "default from
// prefers-reduced-motion"); after that it's the player's own toggle, never re-derived from the OS.
if (isFirstEverLoad && matchMedia("(prefers-reduced-motion: reduce)").matches) save.setSettings({ motion: true });
const saved = save.get();
const daily = todaySeed();
const ARCADE_URL = "https://nirlivne.github.io/arcade/games/squawk-7700/";

// A new local day resets the daily best (today's best is kept only for the current local date; §2d).
if (!saved.daily || saved.daily.date !== daily.date) save.setDaily({ date: daily.date, n: daily.n, best: null, reachedBeat: null });

let run;
let mode = "title"; // "title" | "run" | "practice"
if (Number.isFinite(seedParam) && params.has("seed")) {
  run = Sim.createRun(seedParam >>> 0);
  mode = skipMenu ? "run" : "title";
} else if (saved.run && !skipMenu) {
  run = Sim.reload(saved.run.seed, saved.run);
  mode = "run";
} else {
  run = Sim.createRun(daily.seed);
  if (skipMenu) mode = "run";
}

const appRoot = document.getElementById("app");
const canvas = document.getElementById("scene");
const hudRoot = document.getElementById("hud");
const overlayRoot = document.getElementById("overlay");
const fxRoot = document.getElementById("fx");
const menuRoot = document.getElementById("menu");
const input = createInput(canvas, { isTapArmed: () => run.phase === "ending" });
const hud = createHud(hudRoot, overlayRoot, fxRoot, theme, (d) => input.pressDigit(d));
const { resize, render, triggerLookback, vignetteStrength, sunFlare, setReducedMotion, isDegraded, aisleObstacleStats } = createRenderer(canvas, { touch, reducedMotion: save.get().settings.motion });
const audio = createAudio();
const debugOverlay = debugOn ? createDebugOverlay(document.body) : null;

function applyReducedMotion(on) {
  appRoot.classList.toggle("is-reduced", on);
  setReducedMotion(on);
}
applyReducedMotion(save.get().settings.motion);

function wakeAudio() { audio.ensure(); window.removeEventListener("pointerdown", wakeAudio); window.removeEventListener("keydown", wakeAudio); }
window.addEventListener("pointerdown", wakeAudio);
window.addEventListener("keydown", wakeAudio);

function vibrate(ms) { if (navigator.vibrate && save.get().settings.haptics) navigator.vibrate(ms); }

let prevPhase = run.phase;
let prevT = 0, prevV = 0, prevCautionOn = false;
let hitStopT = 0;
let paused = false;
// THE-774: a GEAR/FLARE press (or hold) still down when `ending` starts must not skip it the instant
// it begins -- only a fresh press (rising edge) that starts once `ending` is already showing counts.
let skipButtonArmed = false, prevButtonForSkip = false;
// D2-4: the prompt fades once the player has acted this attempt, so nothing covers the windshield
// through the pull-out; reset at every fresh intro (onPhaseEnter).
let promptPlayerActed = false;
let lastPromptBig = null;
let pauseSources = new Set();
let wasPortrait = false;

function resizeCanvas() {
  const w = window.innerWidth, h = window.innerHeight;
  canvas.width = w; canvas.height = h;
  resize(w, h);
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

function setPaused(on, source) {
  if (on) pauseSources.add(source); else pauseSources.delete(source);
  paused = pauseSources.size > 0;
}
document.addEventListener("visibilitychange", () => { setPaused(document.hidden, "hidden"); if (document.hidden && mode !== "title") openPause(); });
window.addEventListener("blur", () => { setPaused(true, "blur"); if (mode !== "title") openPause(); });
window.addEventListener("focus", () => setPaused(false, "blur"));

function currentBeatName() { return run.beatOrder[run.beatIndex]; }

function startRun(seed, opts) {
  run = Sim.createRun(seed, opts);
  prevPhase = null; // force the first tick's onPhaseEnter("card") to fire and show the cut card
  mode = opts && opts.practice ? "practice" : "run";
  setPaused(false, "menu");
}

function openPause() {
  if (mode === "title") return;
  setPaused(true, "menu");
  menu.showPause();
}
function closeMenuAndResume() {
  menu.hideAll();
  setPaused(false, "menu");
  input.rezero();
}

function todayShareText() {
  const d = save.get().daily;
  const run_ = d && d.best ? { n: d.n, clockSteps: d.best.clockSteps, bumps: d.best.bumps, medals: d.best.medals } : { n: d ? d.n : daily.n, reachedBeat: d && d.reachedBeat };
  return shareText(run_, ARCADE_URL, theme);
}

async function doShare() {
  const text = todayShareText();
  if (navigator.share) { try { await navigator.share({ text }); return; } catch (e) { /* cancelled or unsupported: fall through to clipboard */ } }
  if (navigator.clipboard) { try { await navigator.clipboard.writeText(text); } catch (e) { /* clipboard blocked: nothing else to fall back to */ } }
}

const menu = createMenu(menuRoot, theme, save, {
  play() { startRun(daily.seed); },
  beatSelect() { menu.showBeatSelect(); },
  practice(beatName) { startRun(daily.seed, { beatOrder: [beatName], practice: true }); },
  howTo() { menu.showHowTo(); },
  settings() { menu.showSettings(); },
  about() { menu.showAbout(); },
  close() { if (mode === "title") menu.showTitle(daily); else menu.showPause(); },
  resume() { closeMenuAndResume(); },
  restartBeat() {
    Sim.restartBeat(run);
    prevPhase = run.phase;
    if (run.over) {
      // Sim.restartBeat -> enterOver already pushed a runOver event; route it through the one real
      // handler instead of hand-rolling the screen/save logic a second time, so daily.reachedBeat
      // (and share variant C) are set here too, not just on the natural fail-phase path (CTO review
      // r2 non-blocking note).
      handleEvents(run.events);
      menu.showRunOver(currentBeatName());
      setPaused(true, "menu");
      return;
    }
    const snap = Sim.snapshot(run);
    if (snap) save.setRun(snap);
    closeMenuAndResume();
  },
  quit() { mode = "title"; save.setRun(null); menu.hideAll(); menu.showTitle(daily); setPaused(false, "menu"); },
  toTitle() { mode = "title"; menu.hideAll(); menu.showTitle(daily); setPaused(false, "menu"); },
  again() { startRun(daily.seed); },
  share() { doShare(); },
  setSetting(key, value) {
    save.setSettings({ [key]: value });
    if (key === "sound") audio.setMuted(!value);
    if (key === "motion") applyReducedMotion(value);
  },
  toggleSound() {
    const on = !save.get().settings.sound;
    save.setSettings({ sound: on });
    audio.setMuted(!on);
    menu.showTitle(daily);
  },
});

audio.setMuted(!saved.settings.sound);
if (mode === "title") { setPaused(true, "menu"); menu.showTitle(daily); }
// A reload can land on an already-`over` run (the reload itself was the 3rd fail, Sim.reload above).
// Without this, the game sits frozen on the last live frame forever, every later reload included,
// since a `run.over` sim never ticks again to fire onPhaseEnter("over") naturally (CTO review r1 #2).
// Sim.reload -> enterOver already pushed the runOver event onto run.events; route it through the one
// real handler (sets daily.reachedBeat for share variant C) instead of duplicating the save/screen
// logic a third time (CTO review r2 non-blocking note).
else if (run.over) { handleEvents(run.events); menu.showRunOver(currentBeatName()); setPaused(true, "menu"); }

function handleEvents(events) {
  for (const e of events) {
    if (e.type === "fail") { hud.flash(); hud.showFailReason(theme.text.failReason[e.reason] || ""); }
    if (e.type === "bump") vibrate(15);
    if (e.type === "wrongDigit" && run.beat) { /* the keypad display's own render already shows the clear */ }
    if (e.type === "rudderChunk") {
      const chunksLost = run.beat ? run.beat.flight.chunksLost : e.data.chunk;
      triggerLookback(chunksLost);
      vibrate([10, 30, 10]);
    }
    if (e.type === "clear" && e.beat === "dive") {
      hud.showCalloutNum(levelOffCallout(run.beat).toLocaleString("en-US"), "FT");
    }
    if (e.type === "clear" && e.beat === "door") hud.showCalloutWord("פתוח!");
    if (e.type === "save") {
      const snap = Sim.snapshot(run);
      if (snap) save.setRun(snap);
    }
    if (e.type === "clear" && !run.practice) {
      save.setBeat(e.beat, { cleared: true, medal: e.medal, bestScore: run.beatResults[e.beat].metric });
    } else if (e.type === "clear" && run.practice) {
      const prev = save.get().beats[e.beat];
      const better = !prev.bestScore || run.beatResults[e.beat].metric < prev.bestScore;
      save.setBeat(e.beat, { cleared: true, medal: better ? e.medal : prev.medal, bestScore: better ? run.beatResults[e.beat].metric : prev.bestScore });
    }
    if (e.type === "runComplete") {
      // run.best has no `date` (sim.js is pure, it doesn't know "today"); stamp it here or
      // save.js's sanitiseBest silently drops the whole thing on the next reload (CTO review r1 #1).
      const stamped = { ...run.best, date: daily.date };
      save.setBest(stamped);
      save.setRun(null);
      save.setDaily({ date: daily.date, n: daily.n, best: stamped, reachedBeat: null });
    }
    if (e.type === "runOver") {
      save.setRun(null);
      const d = save.get().daily;
      if (!d || !d.best) save.setDaily({ date: daily.date, n: daily.n, best: null, reachedBeat: e.reachedBeat });
    }
  }
}

const CARD_FL = { door: "FL340 · 07:41", aisle: "FL280 · 07:52", dive: "FL170 · 08:04", landing: "FL030 · 08:19" };

function onPhaseEnter(phase) {
  if (phase === "card" && mode !== "title") menu.showCard(CARD_FL[currentBeatName()] || CARD_FL.door, currentBeatName(), run.attemptNumber);
  else if (phase !== "card") menu.hideAll();
  if (phase === "intro") { input.rezero(); promptPlayerActed = false; }
  if (phase === "over" && mode !== "practice") { menu.showRunOver(currentBeatName()); setPaused(true, "menu"); }
  if (phase === "results" && mode !== "practice") { menu.showResults(run, daily); setPaused(true, "menu"); }
  else if (phase === "results" && mode === "practice") { menu.showBeatSelect(); setPaused(true, "menu"); }
}

// A silent scripted gesture during a beat's first-ever 3s intro (spec §5: "ghost hand... until that
// beat has been cleared once"); the player's own input takes over the moment they touch a control.
// door: ix the 4-digit code by *sequence position*, not digit value (DOOR.CODE repeats "7" twice --
// deduping on the last value sent would skip the repeat and then send the wrong next digit).
const GHOST = {
  door: (t) => (t > 0.6 && t < 2.6 ? { digitIndex: Math.min(3, Math.floor((t - 0.6) / 0.5)) } : {}),
  aisle: () => ({ ix: 0 }),
  dive: (t) => ({ iy: t > 1 ? Math.min(1, (t - 1) / 1.5) : 0 }),
  landing: () => ({ ix: 0, iy: 0 }),
};
let ghostDigitIndexSent = -1;

// Rewind ring buffer (design: "render plays the last 3 s backwards from a 180-entry ring buffer,
// desaturated"; 180 = REWIND_STEPS, exactly 3 s at the fixed 60 Hz step). Each live sim step pushes
// the render snapshot it just produced; during the `rewind` phase, frame() reads this back in reverse
// by run.phaseSteps instead of building a live flight/view from `run` (which the phase machine has
// already reset to the checkpoint by the time rewind starts).
const REWIND_BUFFER_LEN = 180;
let rewindBuffer = [];
function pushRewindFrame(snap) {
  rewindBuffer.push(snap);
  if (rewindBuffer.length > REWIND_BUFFER_LEN) rewindBuffer.shift();
}

function tick() {
  if (!paused && run.phase !== prevPhase) onPhaseEnter(run.phase);
  if (!paused) {
    const real = input.tick(DT, hud.isContextHeld());
    const beatName = currentBeatName();
    const demoSeen = save.get().demoSeen[beatName];
    const playerActed = real.ix !== 0 || real.iy !== 0 || real.button || real.digit != null;
    if (playerActed && run.phase === "play") promptPlayerActed = true;
    const useGhost = run.phase === "intro" && !demoSeen && !playerActed && GHOST[beatName];
    let ix = real.ix, iy = real.iy, button = real.button, digit = real.digit;
    if (useGhost) {
      const g = GHOST[beatName](run.beat ? run.beat.t : 0);
      ix = g.ix ?? 0; iy = g.iy ?? 0;
      if (g.digitIndex != null && g.digitIndex !== ghostDigitIndexSent) { digit = DOOR.CODE[g.digitIndex]; ghostDigitIndexSent = g.digitIndex; }
    } else ghostDigitIndexSent = -1;
    // THE-774: a plain tap/click on the canvas never set `button` (that's keyboard Space/Enter or the
    // HUD context button, which is hidden during `ending`) -- `real.tap` is input.js's own short/still
    // pointerup detection, the only path a mouse click or real touch tap has to skip the cut. `real.tap`
    // already guards against a held yoke release (input.js arms it at press-down time); `button` is
    // armed here the same way, on its rising edge, so a GEAR/FLARE key/button held through rollout
    // doesn't skip the cut the moment it starts.
    if (real.button && !prevButtonForSkip) skipButtonArmed = run.phase === "ending";
    else if (!real.button) skipButtonArmed = false;
    prevButtonForSkip = real.button;
    Sim.setInput(run, { x: ix, y: iy, button, digit, skip: run.phase === "ending" && ((real.button && skipButtonArmed) || real.digit != null || real.tap) });
    prevPhase = run.phase;

    if (currentBeatName() === "dive") {
      const t = run.beat ? run.beat.t : 0;
      const v = run.beat ? run.beat.flight.v : 0;
      const cautionOn = run.phase === "intro" || run.phase === "play" ? t >= DIVE.PUSH_START_T && t < DIVE.PUSH_END_T : false;
      if (cautionOn && !prevCautionOn) audio.caution();
      if (prevT < DIVE.PUSH_END_T && t >= DIVE.PUSH_END_T) audio.nearSilence(); // the pull-out begins
      if (prevV > 340 && v <= 340) hitStopT = 0.07; // the needle leaves the red
      prevT = t; prevV = v; prevCautionOn = cautionOn;
    }

    Sim.step(run);
    handleEvents(run.events);
    if (run.phase === "intro" || run.phase === "play") pushRewindFrame(buildViewSnapshot());
    else if (run.phase === "card") rewindBuffer = []; // a fresh attempt starts with no stale tail
  }
  hud.tickFlash(DT);
}

function contextButtonState() {
  const name = currentBeatName();
  if (name === "door" && run.beat && (run.phase === "intro" || run.phase === "play")) {
    if (run.beat.step === "squawk") return { en: "SQUAWK", he: theme.text.contextSquawk, state: "live" };
    if (run.beat.step === "door") return { en: "DOOR", he: theme.text.contextDoor, state: "live" };
    return { en: null };
  }
  if (name !== "landing" || !run.beat || (run.phase !== "intro" && run.phase !== "play")) return { en: null };
  // The escort shows GEAR dimmed, not hidden (sign-off r1 D3, THE-756): it reads as a real step still
  // ahead, not a button that simply doesn't exist yet.
  if (run.beat.sub === "escort") return { en: "GEAR", he: theme.text.contextGear, state: "off" };
  if (run.beat.sub === "approach" || run.beat.sub === "rollout") {
    if (!run.beat.gearDown) {
      const lit = run.beat.flight.alt <= LANDING.GEAR_OFFER_ALT;
      return { en: "GEAR", he: theme.text.contextGear, state: lit ? "live" : "off" };
    }
    const lit = run.beat.flight.alt <= LANDING.FLARE_LIVE_ALT;
    return { en: "FLARE", he: theme.text.contextFlare, state: lit ? "live" : "off" };
  }
  return { en: null };
}

// One prompt at a time, centre-low (spec §5): a big word plus a small hint (sign-off r1 D2-4), the
// goal and the fail rule, replaced the first time a beat clears once (demoSeen), when only the ghost
// hand's intro disappears too. Fades once the player has acted this attempt (or at the latest contextual
// change, e.g. FLARE lighting up) so nothing covers the windshield through the pull-out.
function promptFor() {
  // D3 (sign-off r2, THE-767): the ending cut can be skipped by a tap/press (game.js's `skip` input,
  // see buildViewSnapshot's ending branch) but nothing told the player that -- the mockup's
  // "הקישו כדי להמשיך" ("tap to continue") was missing. Sign-off r3 D3 (THE-739): a small hint line under
  // the heroes, as in the mockup, not the big prompt across them.
  if (run.phase === "ending") return { big: "", hint: theme.text.endingContinue, cls: "sq-prompt--calm sq-prompt--foot" };
  const name = currentBeatName();
  if (!run.beat || (run.phase !== "intro" && run.phase !== "play")) return { big: "" };
  let p;
  if (name === "door") {
    if (run.beat.step === "keypad") p = { big: theme.text.doorPrompt1, hint: theme.text.doorPrompt1Hint };
    else if (run.beat.step === "squawk") p = { big: theme.text.doorPrompt2, hint: theme.text.doorPrompt2Hint, press: true };
    else p = { big: theme.text.doorPrompt3, hint: theme.text.doorPrompt3Hint, cls: "sq-prompt--calm" };
  } else if (name === "aisle") {
    p = { big: theme.text.aislePrompt, hint: theme.text.aislePromptHint, cls: "sq-prompt--high" };
  } else if (name === "dive") {
    p = { big: theme.text.divePrompt, hint: theme.text.divePromptHint };
  } else if (name === "landing") {
    if (run.beat.sub === "escort") p = { big: theme.text.escortPrompt, hint: theme.text.escortPromptHint, cls: "sq-prompt--calm sq-prompt--low" };
    // D2-12 (sign-off r2): `sq-prompt--high` (not the default centre-low spot) keeps every approach
    // prompt clear of the runway now that the camera pitches down further to show it earlier.
    else if (!run.beat.gearDown) {
      p = run.beat.flight.alt > LANDING.GEAR_OFFER_ALT
        ? { big: theme.text.approachPrompt1, hint: theme.text.approachPrompt1Hint, cls: "sq-prompt--calm sq-prompt--high" }
        : { big: theme.text.approachPrompt2, hint: theme.text.approachPrompt2Hint, cls: "sq-prompt--calm sq-prompt--high", press: true };
    }
    else if (run.beat.flareActive) p = { big: "", cls: "sq-prompt--calm sq-prompt--high" };
    // "יישור!" only once FLARE is actually live (<= FLARE_LIVE_ALT), not from gear-down on (D2-4).
    else if (run.beat.flight.alt <= LANDING.FLARE_LIVE_ALT) p = { big: theme.text.approachPrompt3, hint: theme.text.approachPrompt3Hint, cls: "sq-prompt--calm sq-prompt--high", press: true };
    else p = { big: theme.text.approachPrompt1, hint: theme.text.approachPrompt1Hint, cls: "sq-prompt--calm sq-prompt--high" };
  } else {
    p = { big: "" };
  }
  if (p.big !== lastPromptBig) { lastPromptBig = p.big; promptPlayerActed = false; }
  // An action prompt (press: SQUAWK, GEAR, FLARE) stays up until its button is pressed, which changes
  // the prompt: steering the yoke must not hide the one call the player has to act on (code review
  // THE-757, tools/squawk-7700-tests/prompt-action-check.mjs).
  if (run.phase === "play" && promptPlayerActed && !p.press) return { big: "", cls: p.cls };
  return p;
}

// The ghost hand's gesture direction per beat, shown only during the un-demoed first intro.
function ghostDirFor(beatName) {
  if (beatName === "door") return "tap";
  if (beatName === "aisle") return "lr";
  if (beatName === "dive") return "down";
  if (beatName === "landing") return run.beat && run.beat.sub === "escort" ? "lr" : "down";
  return null;
}

// The render input for the current live `run` state: { view, flight }. Used both for live rendering
// and, pushed into rewindBuffer each sim step, for the 3 s backward rewind playback.
function buildViewSnapshot() {
  // The title screen (D2-1): the airliner over the dusk cloud deck, not whatever beat the sim is
  // parked on underneath it (the run sits paused at the door's card the whole time mode is "title").
  if (mode === "title") return { view: "title", flight: { pitch: 0, bank: 0, v: 0, alt: 0, inputIx: 0, inputIy: 0, cautionOn: false, range: 0, endingT: 0 }, cautionOn: false };
  // The ending cut (D2-6): run.beat still holds the cleared landing beat (its .flight carry), so the
  // ordinary f ? ... : ... branch below never reached the endingT fallback and the camera froze
  // (ending-a === ending-b, sign-off r1). Always take the dedicated ending snapshot in this phase.
  if (run.phase === "ending") return { view: "ending", flight: { pitch: 0, bank: 0, v: 0, alt: 0, inputIx: 0, inputIy: 0, cautionOn: false, range: 0, endingT: Math.min(1, run.phaseSteps / Sim.ENDING_STEPS) }, cautionOn: false };
  // Results and run-over sit on the ending scene's last frame, the dawn tarmac (D2-7): run.beatIndex is
  // past the end after results (currentBeatName() is undefined), which used to fall through to the
  // dive cockpit as a default.
  if (run.phase === "results" || run.phase === "over") return { view: "ending", flight: { pitch: 0, bank: 0, v: 0, alt: 0, inputIx: 0, inputIy: 0, cautionOn: false, range: 0, endingT: 1 }, cautionOn: false };
  const f = run.beat && run.beat.flight;
  const beatName = currentBeatName();
  const live = run.phase === "intro" || run.phase === "play";
  const cautionOn = beatName === "dive" && live ? (run.beat.t >= DIVE.PUSH_START_T && run.beat.t < DIVE.PUSH_END_T) : false;
  let view = "dive";
  if (beatName === "landing" && run.beat) view = run.beat.sub === "escort" ? "escort" : "approach";
  else if (beatName === "aisle") view = "aisle";
  else if (beatName === "door") view = "door";
  const flight = f
    ? { ...f, inputIx: run.input.ix, inputIy: run.input.iy, cautionOn, range: run.beat && run.beat.range }
    : { pitch: 0, bank: run.beat ? run.beat.bank || 0 : 0, v: 0, alt: 0, inputIx: 0, inputIy: 0, cautionOn: false, range: 0 };
  if (view === "aisle" && run.beat) {
    flight.aisleLane = run.beat.lane;
    flight.aisleZ = run.beat.z;
    flight.aisleRows = run.beat.rows.filter((r) => !run.beat.hitRows.has(r.z));
  }
  return { view, flight, cautionOn };
}

let acc = 0, last = performance.now();
function frame(now) {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (hitStopT > 0) {
    hitStopT = Math.max(0, hitStopT - dt);
  } else if (!paused) {
    acc += dt;
    let steps = 0;
    while (acc >= DT && steps < 5) { tick(); acc -= DT; steps++; }
  }
  const portrait = menu.checkOrientation();
  if (portrait) setPaused(true, "portrait");
  // Spec §2a: "Resume always goes through the pause sheet." Landscape alone can never resume play --
  // the instant portrait ends, the pause sheet takes over (replacing the turn screen, not stacking
  // under it) and the player has to tap Resume, same as any other pause (CTO review r1 #7). The
  // "portrait" source must always clear here, title screen or not -- on the title screen openPause()
  // is a no-op (its own guard), but the pause source still has to drop or it outlives the screen:
  // Play -> startRun() only ever clears "menu", so a title-screen rotation left the sim frozen forever
  // even after tapping Play (CTO review r2 #1).
  else if (wasPortrait) { setPaused(false, "portrait"); if (mode !== "title") openPause(); }
  wasPortrait = portrait;
  if (hud.consumePauseRequest()) openPause();
  appRoot.classList.toggle("is-menu-active", menuRoot.classList.contains("is-active") || portrait);
  // Hide the HUD during the ending cut (D2-6): it used to show the stale landing instruments over the
  // tarmac composition. skin.css has no class for this, so toggle the instrument layer directly.
  hudRoot.style.display = run.phase === "ending" ? "none" : "";
  hud.update(run);
  const f = run.beat && run.beat.flight;
  const beatName = currentBeatName();
  const live = run.phase === "intro" || run.phase === "play";
  const cautionOn = beatName === "dive" && live ? (run.beat.t >= DIVE.PUSH_START_T && run.beat.t < DIVE.PUSH_END_T) : false;
  hud.tickCaution(dt, cautionOn);
  hud.tickCallout(dt);
  if (f) { hud.setVignette(vignetteStrength(f.g)); hud.setRedVignette(f.g < 0 ? Math.min(1, -f.g / 2) : 0); }
  else hud.setRedVignette(beatName === "aisle" && run.beat && run.beat.inFloat ? 0.45 : 0);
  audio.tick(f ? f.v : 0, f ? f.g : 1, dt);
  const ctxState = contextButtonState();
  hud.setContext(ctxState.en, ctxState.he, ctxState.state);
  hud.setKeypad(beatName === "door" && run.beat && run.beat.step === "keypad" && live, run.beat ? run.beat.entered : []);
  hud.setLock(beatName === "door" && run.beat && run.beat.step === "door" && live, run.beat ? run.beat.fill : 0, run.beat && Math.abs(run.beat.bank || 0) >= 10);
  const prompt = promptFor();
  hud.setPromptClass(prompt.cls);
  hud.setPrompt(prompt.big, prompt.hint);
  const demoSeen = run.beat ? save.get().demoSeen[beatName] : true;
  hud.setGhost(live && !demoSeen && run.phase === "intro" ? ghostDirFor(beatName) : null, beatName);
  if (run.beat && run.phase === "clear" && !demoSeen) save.setDemoSeen(beatName);
  // SQUAWK idle nudge (D2-9): 4s with no input at the squawk step pulses the ghost over the context
  // button, on every run (not just the un-demoed first one) -- the context button's own CSS already
  // breathes while "live", but the onboarding review found that alone wasn't a strong enough nudge.
  hud.setSquawkNudge(live && beatName === "door" && run.beat && run.beat.step === "squawk" && run.beat.idleT >= 4);

  // XPDR ring: red until level (dive/escort), green once level or past the overspeed danger; amber once squawked.
  let ring = "off", xpdrCode = "7700";
  if (beatName === "door" && run.beat) { xpdrCode = run.beat.entered.join("").padEnd(4, " "); ring = run.beat.squawked ? "amber" : "off"; }
  else if (beatName === "dive" && f) ring = f.v > 340 ? "alarm" : f.pitch >= 0 ? "ok" : "alarm";
  else if (beatName === "landing" && f) ring = Math.abs(f.bank) < 10 ? "ok" : "alarm";
  hud.setXpdr(xpdrCode, ring);
  hud.setMasterWarning(cautionOn || (beatName === "dive" && f && f.v > 340), cautionOn);

  if (beatName === "dive" && f) { hud.setGmeter(f.g); hud.hideLoc(); hud.setRadioAlt(false); hud.setDist(false); }
  else if (beatName === "landing" && run.beat && run.beat.sub !== "escort" && f) {
    hud.hideGmeter();
    hud.setLoc(f.y || 0);
    hud.setRadioAlt(f.alt <= 2500, f.alt, f.alt <= 60);
    hud.setDist(false);
  } else if (beatName === "aisle" && run.beat) {
    hud.hideGmeter(); hud.hideLoc(); hud.setRadioAlt(false);
    const left = AISLE.TRACK_LEN - run.beat.z;
    hud.setDist(true, Math.max(0, left), Math.max(0, Math.min(1, run.beat.z / AISLE.TRACK_LEN)));
  } else { hud.hideGmeter(); hud.hideLoc(); hud.setRadioAlt(false); hud.setDist(false); }
  hud.setRewind(run.phase === "rewind");

  // Rewind plays the last 3 s backwards from the ring buffer (design); reduced motion = hard cut to
  // the earliest buffered frame instead, no backward animation (Comforts).
  let view, flight;
  if (run.phase === "rewind" && rewindBuffer.length) {
    const reducedMotionOn = save.get().settings.motion;
    const idx = reducedMotionOn ? 0 : Math.max(0, rewindBuffer.length - 1 - run.phaseSteps);
    ({ view, flight } = rewindBuffer[idx]);
  } else {
    ({ view, flight } = buildViewSnapshot());
  }
  const info = render(flight, run.rngFx, dt, view, !paused);
  hud.setSunFlare(view === "dive" ? sunFlare() : { visible: false });
  window.__squawkDebugInfo = { calls: info.calls, triangles: info.triangles };
  if (debugOverlay) debugOverlay.update(info);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.dispatchEvent(new CustomEvent("game:start"));

// The test hook (G11). Real-pointer tests use it only to read, never to move the yoke.
window.__squawk = {
  state() {
    const f = run.beat && run.beat.flight;
    return {
      phase: run.phase,
      beat: run.beatOrder[run.beatIndex],
      t: run.beat ? run.beat.t : 0,
      attemptOpen: run.attemptOpen,
      checkpoint: run.checkpoint,
      fails: run.fails,
      clockSteps: run.clockSteps,
      inputButton: !!run.input.button, // THE-767 D1-4 regression: a stuck mouse context button leaves this true into the next beat
      flight: f ? { pitch: f.pitch, bank: f.bank, v: f.v, alt: f.alt, g: f.g, rudder: f.rudder, heading: f.heading, y: f.y, dose: f.dose, chunksLost: f.chunksLost, margin: f.margin } : null,
      landing: run.beat && currentBeatName() === "landing" ? { sub: run.beat.sub, gearDown: !!run.beat.gearDown, flareActive: !!run.beat.flareActive, range: run.beat.range } : null,
      aisle: run.beat && currentBeatName() === "aisle" ? { lane: run.beat.lane, targetLane: run.beat.targetLane, armed: !!run.beat.armed } : null,
      door: run.beat && currentBeatName() === "door" ? { step: run.beat.step, fill: run.beat.fill } : null,
    };
  },
  step(n = 1) { for (let i = 0; i < n; i++) tick(); },
  setInput(i) { Sim.setInput(run, i); },
  seed(s) { run = Sim.createRun(s >>> 0); prevPhase = run.phase; mode = "run"; menu.hideAll(); setPaused(false, "menu"); },
  gotoBeat(name) {
    const idx = run.beatOrder.indexOf(name);
    if (idx < 0) return;
    run.beatIndex = idx;
    Sim.goToCard(run);
    prevPhase = run.phase;
    mode = "run";
    menu.hideAll();
    setPaused(false, "menu");
  },
  pause(on) { setPaused(on, "hook"); },
  hash() { return Sim.hash(run); },
  events() { return run.events; },
  mode() { return mode; },
  menu,
  isDegraded() { return isDegraded(); },
  aisleObstacleStats() { return aisleObstacleStats(); },
};
