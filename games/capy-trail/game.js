// State machine + fixed-step loop + window.__capy test hook (design -> game.js). Only this file writes
// the save; render/input never write sim state.
import { createSim, TURN_BEFORE, TURN_BUFFER, POWER_TIME, LEVEL_FINISH_COAST_T, newLogEntriesSince } from "./sim/sim.js";
import { computeScore } from "./sim/score.js";
import { resetRunProgress, stepMissions, finishRun } from "./sim/missions.js";
import * as saveMod from "./sim/save.js";
import { resolveSeed } from "./sim/rng.js";
import { LEVELS, LEVELS_LIVE } from "./sim/levels.js";
import { starsEarned, mergeStars, totalStars } from "./sim/level-stars.js";
import { createWorld } from "./render/scene.js";
import { resolveHeroKind } from "./render/hero.js";
import { resolveActiveTheme } from "./theme-active.js";
import { createInput } from "./input.js";
import { createHud } from "./ui/hud.js";
import { createScreens } from "./ui/screens.js";
import { createLevelMap } from "./ui/level-map.js";
import { createInRunLabel } from "./ui/in-run-label.js";
import { createPowerupRing } from "./ui/powerup-ring.js";
import { createMapPanel } from "./ui/map.js";
import { lockup as brandLockup } from "./brand.js";
import * as audio from "./render/audio.js";

const FIXED_DT = 1 / 60;
const CRASH_GAG_TIME = 1.2;
const HIT_STOP_TIME = 0.09; // spec §2: "90 ms hit stop -> trip-and-tumble or biome gag, 1.2 s -> results"
// P3 (THE-1324): every run opens on a high reveal of the trail that settles into the chase camera. It's a
// presentation timer (real time, like the crash gag); the sim doesn't step during it, so grace, the spawner
// and the geese's 0-3 s opening all start after the settle. Shorter on an instant retry; a fade under
// reduce motion. `?intro=0` turns it off (test/QA hook, like ?seed=).
const INTRO_TIME = 2.5, INTRO_RETRY_TIME = 1.2, INTRO_FADE_TIME = 0.5;
const INTRO_ON = new URLSearchParams(location.search).get("intro") !== "0";
const NEAR_MISS_FREEZE_TIME = 0.04; // spec §2: "40 ms hit stop" on a near miss
const STUMBLE_HIT_STOP_TIME = 0.06; // A12.5 (THE-1301): "a 60 ms hit stop" on every stumble
// THE-1373: which hero (and chaser) render/scene.js builds -- theme.js's own "bear" default, or a
// `?hero=` override for the per-hero Playwright network-isolation test.
const heroKind = resolveHeroKind(window.THEME, location.search);
// THE-1372: the active hero's name/copy (theme.js's heroes.bear / heroes.capy), merged over the shared
// keys. Every other module below keeps reading theme.title/theme.text.*/etc. exactly as before.
const theme = resolveActiveTheme(window.THEME, heroKind);
window.UIKit.applyTheme(theme);

const els = {
  canvas: document.getElementById("scene"),
  hud: document.getElementById("hud"),
  hudCoins: document.getElementById("hudCoins"),
  hudCoinPebble: document.getElementById("hudCoinPebble"),
  hudScoreWrap: document.getElementById("hudScoreWrap"),
  hudScore: document.getElementById("hudScore"),
  hudMult: document.getElementById("hudMult"),
  hudScoreSub: document.getElementById("hudScoreSub"),
  levelHud: document.getElementById("levelHud"),
  levelHudName: document.getElementById("levelHudName"),
  levelHudProgress: document.getElementById("levelHudProgress"),
  pauseBtn: document.getElementById("pauseBtn"),
  aboutBtn: document.getElementById("aboutBtn"),
  aboutDialog: document.getElementById("aboutDialog"),
  aboutClose: document.getElementById("aboutClose"),
  aboutBrand: document.getElementById("aboutBrand"),
  pauseHomeBtn: document.getElementById("pauseHomeBtn"),
  pauseAboutBtn: document.getElementById("pauseAboutBtn"),
  titleHint: document.getElementById("titleHint"),
  titleUtil: document.getElementById("titleUtil"),
  titleMusicBtn: document.getElementById("titleMusicBtn"),
  titleSoundBtn: document.getElementById("titleSoundBtn"),
  musicBtn: document.getElementById("musicBtn"),
  soundBtn: document.getElementById("soundBtn"),
  pauseMusicBtn: document.getElementById("pauseMusicBtn"),
  pauseSoundBtn: document.getElementById("pauseSoundBtn"),
  pauseMusicLabel: document.getElementById("pauseMusicLabel"),
  pauseSoundLabel: document.getElementById("pauseSoundLabel"),
  settingMotion: document.getElementById("settingMotion"),
  settingQuality: document.getElementById("settingQuality"),
  settingBearHD: document.getElementById("settingBearHD"),
  settingBearHDRow: document.getElementById("settingBearHDRow"),
  chaserPip: document.getElementById("chaserPip"),
  chaserRingFill: document.getElementById("chaserRingFill"),
  inRunLabel: document.getElementById("inRunLabel"),
  powerupRing: document.getElementById("powerupRing"),
  powerupRingFill: document.getElementById("powerupRingFill"),
  mapCanvas: document.getElementById("mapCanvas"),
  missions: document.getElementById("missions"),
  missionsTitle: document.getElementById("missionsTitle"),
  missionsReward: document.getElementById("missionsReward"),
  missionsList: document.getElementById("missionsList"),
  stickZone: document.getElementById("stickZone"),
  stickBase: document.getElementById("stickBase"),
  stickKnob: document.getElementById("stickKnob"),
  jumpBtn: document.getElementById("jumpBtn"),
  duckBtn: document.getElementById("duckBtn"),
  playBtn: document.getElementById("playBtn"),
  levelsBtn: document.getElementById("levelsBtn"),
  titleStars: document.getElementById("titleStars"),
  titleStarsCount: document.getElementById("titleStarsCount"),
  mapBackBtn: document.getElementById("mapBackBtn"),
  levelsTrail: document.getElementById("levelsTrail"),
  mapTotal: document.getElementById("mapTotal"),
  mapTotalText: document.getElementById("mapTotalText"),
  mapGoalName: document.getElementById("mapGoalName"),
  mapGoals: document.getElementById("mapGoals"),
  mapPlayBtn: document.getElementById("mapPlayBtn"),
  resultsPanel: document.getElementById("resultsPanel"),
  resultCause: document.getElementById("resultCause"),
  resultScore: document.getElementById("resultScore"),
  resultMult: document.getElementById("resultMult"),
  resultLine: document.getElementById("resultLine"),
  resultDistance: document.getElementById("resultDistance"),
  resultCoins: document.getElementById("resultCoins"),
  resultBest: document.getElementById("resultBest"),
  resultDeadpan: document.getElementById("resultDeadpan"),
  levelStars: document.getElementById("levelStars"),
  levelStar0: document.getElementById("levelStar0"),
  levelStar1: document.getElementById("levelStar1"),
  levelStar2: document.getElementById("levelStar2"),
  levelResultLine: document.getElementById("levelResultLine"),
  levelResultCoins: document.getElementById("levelResultCoins"),
  levelResultTime: document.getElementById("levelResultTime"),
  levelResultHits: document.getElementById("levelResultHits"),
  againBtn: document.getElementById("againBtn"),
  homeBtn: document.getElementById("homeBtn"),
  retryBtn: document.getElementById("retryBtn"),
  mapBtn: document.getElementById("mapBtn"),
  shareBtn: document.getElementById("shareBtn"),
  resumeBtn: document.getElementById("resumeBtn"),
  titleBrand: document.getElementById("titleBrand"),
  contextLostScreen: document.getElementById("contextLost"),
};

const isTouch = matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
els.stickZone.hidden = !isTouch;
// jumpBtn/duckBtn visibility is owned by ui/screens.js from here (shown only while running, THE-1259 fix)
// THE-1372: the chaser pip's aria-label names the active hero's chaser (bees/geese) too.
els.chaserPip.setAttribute("aria-label", theme.text.chaserNear);
const inRunLabel = createInRunLabel(els.inRunLabel);
const powerupRing = createPowerupRing(els.powerupRing, els.powerupRingFill);

// Brand placement (spec: title gets a small "by The Game Company" lockup, 24 px badge / 30 px desktop,
// at the bottom, never above or larger than the title, never over the capy's silhouette -- css handles
// the position, this just needs the right badge size at each breakpoint). Static, set once: no per-frame
// or per-run cost, and the badge/lockup never changes after boot.
els.titleBrand.innerHTML = brandLockup(matchMedia("(min-width: 900px)").matches ? 30 : 24, { on: "ink", key: "ink" });
els.aboutBrand.innerHTML = `<span class="ct-about-by">A game by</span> ${brandLockup(24, { on: "ink", key: "ink" })}`; // P5

let data = saveMod.load();
let sim = null;
// Board mobile feedback (2026-11-07): a long press must never open the context menu or start a text
// selection (style.css turns selection off too; these catch browsers that ignore the CSS).
for (const type of ["contextmenu", "selectstart"]) document.addEventListener(type, (e) => e.preventDefault());

let world = null;
let tier = data.settings.tier === "auto" ? (isTouch ? "mid" : "high") : data.settings.tier;
let phase = "boot"; // boot | title | running | paused | crashing | results | rotate | contextLost | levels
let pendingSeed = null;
// THE-1412: the LEVELS index of the run in progress/just finished, or null for Endless. lastLevelFailed
// is only meaningful right after a level's enterResults() (levels 10-12, the bees catching).
let currentLevelIndex = null, lastLevelFailed = false;
// P5 (THE-1328): the title shows the live world for the run that Play will start (same seed, so the
// title shot, the intro and the run are one continuous trail). Not stepped: it only gets rendered.
let titleSim = null, titleSeed = null, runSeed = null;
function makeTitleSim() {
  titleSeed = pendingSeed ?? resolveSeed(location.search);
  pendingSeed = null;
  titleSim = createSim(titleSeed);
}
let crashGagT = 0;
let hitStopT = 0;
let nearMissFreezeT = 0;
let nearMissLogT = -1;
let hintsShown = {};
let sessionRuns = 0;
let lastT = null, acc = 0;
// THE-1408: liveMissions/missionRun track this run (not written to `data` until enterResults()).
let liveMissions = null, missionRun = { lastStumbleS: 0 }, missionLogT = -1, pendingMissionLabel = false;
let runStartMult = 1, runStartMissions = null;

const hud = createHud({ hudEl: els.hud, coinsEl: els.hudCoins, coinPebbleEl: els.hudCoinPebble, scoreWrapEl: els.hudScoreWrap, scoreEl: els.hudScore, multEl: els.hudMult, scoreSubEl: els.hudScoreSub, levelHudProgressEl: els.levelHudProgress, pauseBtn: els.pauseBtn, chaserPipEl: els.chaserPip, chaserRingFillEl: els.chaserRingFill }, { onPause: () => pauseGame("pebble"), theme });
const screens = createScreens({ els, theme, isTouch }, {
  onStart: startFromTitle, onRestart: restartRun, onHome: goHome, onResume: resumeGame,
  onOpenLevels: openLevelMap, onRetryLevel: retryLevel, onLevelMap: openLevelMapFromResults,
});
// THE-1412 (levels/README.md "Level map"): the trail map screen, built from sim/levels.js + the save.
const levelMap = createLevelMap(
  { trailEl: els.levelsTrail, totalEl: els.mapTotal, totalTextEl: els.mapTotalText, goalNameEl: els.mapGoalName, goalsEl: els.mapGoals, playBtn: els.mapPlayBtn },
  { onPlay: playLevel },
);
// THE-1375: the secret `0`-key map panel -- a read-only debug overlay, never reachable from the HUD.
const mapPanel = createMapPanel({ canvas: els.mapCanvas });
const input = createInput({
  stickZone: els.stickZone, stickBase: els.stickBase, stickKnob: els.stickKnob, jumpBtn: els.jumpBtn, duckBtn: els.duckBtn,
  onIntent: (action) => { if (phase === "running" && sim) sim.press(action); },
  onPause: () => { if (phase === "running") pauseGame("key"); },
  onMusic: () => toggleMusic(),
  onSound: () => toggleSound(),
  onMap: () => mapPanel.toggle(),
});

// P4 (THE-1326), split in two by THE-1353: the AudioContext is created on the first real gesture (never
// before); music and sound are separate saved toggles (HUD pebble or M/N each, mirrored on the pause
// card since the pause screen covers the HUD), and menu buttons click.
function showMusic() {
  for (const b of [els.musicBtn, els.pauseMusicBtn, els.titleMusicBtn]) {
    b.setAttribute("aria-pressed", String(data.settings.music));
    b.setAttribute("aria-label", data.settings.music ? "Music on" : "Music off");
    b.classList.toggle("is-off", !data.settings.music);
  }
  // A13.3 (THE-1318 review): the pause pill's state is in words, not just the icon strike-through.
  els.pauseMusicLabel.textContent = data.settings.music ? "Music on" : "Music off";
}
function showSound() {
  for (const b of [els.soundBtn, els.pauseSoundBtn, els.titleSoundBtn]) {
    b.setAttribute("aria-pressed", String(data.settings.sound));
    b.setAttribute("aria-label", data.settings.sound ? "Sound on" : "Sound off");
    b.classList.toggle("is-off", !data.settings.sound);
  }
  els.pauseSoundLabel.textContent = data.settings.sound ? "Sound on" : "Sound off";
}
function toggleMusic() {
  data.settings.music = !data.settings.music;
  saveMod.save(data);
  audio.setMusicEnabled(data.settings.music);
  showMusic();
}
function toggleSound() {
  data.settings.sound = !data.settings.sound;
  saveMod.save(data);
  audio.setSoundEnabled(data.settings.sound);
  showSound();
}
audio.setMusicEnabled(data.settings.music);
audio.setSoundEnabled(data.settings.sound);
showMusic();
showSound();

// S7 (THE-1303): a saved reduce-motion choice overrides the OS prefers-reduced-motion
// (ui-kit.js UIKit.reduceMotion() reads this attribute first). Unset (the "auto" default) falls through
// to the OS setting; the toggle only ever sets it to an explicit "true" or "false".
if (data.settings.reduceMotion) document.documentElement.setAttribute("data-reduce-motion", "true");
els.settingMotion.checked = data.settings.reduceMotion;
els.settingMotion.addEventListener("change", () => {
  data.settings.reduceMotion = els.settingMotion.checked;
  saveMod.save(data);
  document.documentElement.setAttribute("data-reduce-motion", String(els.settingMotion.checked));
});
for (const b of [els.musicBtn, els.pauseMusicBtn, els.titleMusicBtn]) b.addEventListener("click", () => toggleMusic());
for (const b of [els.soundBtn, els.pauseSoundBtn, els.titleSoundBtn]) b.addEventListener("click", () => toggleSound());
// a clicked HUD button must not keep the keyboard: Space (jump) or Enter would click it again
const soundToggleBtns = [els.musicBtn, els.soundBtn, els.pauseMusicBtn, els.pauseSoundBtn, els.titleMusicBtn, els.titleSoundBtn];
for (const b of [...soundToggleBtns, els.pauseBtn]) b.addEventListener("click", () => b.blur());
for (const type of ["pointerdown", "pointerup", "touchend", "click", "keydown"]) window.addEventListener(type, () => audio.unlock(), true);
document.addEventListener("click", (e) => { if (e.target.closest?.("button") && !soundToggleBtns.includes(e.target.closest("button"))) audio.play("click", { gain: 0.6 }); });
document.addEventListener("visibilitychange", () => { if (document.hidden) audio.suspend(); else audio.resume(); });

function goFullscreenLandscape() {
  const el = document.documentElement;
  if (!isTouch || !el.requestFullscreen || document.fullscreenElement) return;
  if (matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches) return;
  try {
    Promise.resolve(el.requestFullscreen({ navigationUI: "hide" }))
      .then(() => screen.orientation?.lock?.("landscape"))
      .catch(() => {});
  } catch (e) { /* older engines throw synchronously; the game still plays windowed */ }
}

let introT = 0, introDur = 0, introFade = false;
// THE-1412: levelIndex selects a sim/levels.js entry (banked coins, missions keep counting, best/bestScore
// untouched, the level HUD replaces the score HUD); null (default) is today's Endless run, unchanged.
function newRun({ retry = false, levelIndex = null } = {}) {
  const seed = pendingSeed ?? titleSeed ?? resolveSeed(location.search);
  runSeed = seed;
  pendingSeed = null; titleSeed = null; titleSim = null;
  currentLevelIndex = levelIndex;
  const level = levelIndex !== null ? LEVELS[levelIndex] : null;
  sim = createSim(seed, data.mult, level);
  sim.speedOverride = null;
  hintsShown = {};
  runStartMult = data.mult;
  runStartMissions = resetRunProgress(data.missions);
  liveMissions = runStartMissions;
  missionRun = { lastStumbleS: 0 };
  missionLogT = -1;
  pendingMissionLabel = false;
  inRunLabel.hide();
  powerupRing.hide();
  crashGagT = 0;
  hitStopT = 0;
  nearMissFreezeT = 0;
  nearMissLogT = -1;
  sessionRuns++;
  els.levelHud.hidden = !level;
  els.hudScoreWrap.hidden = !!level;
  els.hudScoreSub.hidden = !!level;
  if (level) els.levelHudName.textContent = `Level ${level.n}`;
  world.resize(els.canvas.clientWidth, els.canvas.clientHeight, Math.min(window.devicePixelRatio || 1, tier === "high" ? 2 : 1.5));
  screens.showRunning();
  audio.music(true);
  if (INTRO_ON) {
    phase = "intro"; introT = 0;
    introFade = window.UIKit?.reduceMotion?.() ?? false;
    introDur = introFade ? INTRO_FADE_TIME : retry ? INTRO_RETRY_TIME : INTRO_TIME;
  } else startRunning();
}
function startRunning() {
  phase = "running";
  acc = 0;
  els.canvas.style.opacity = "";
  input.reset(); // nothing held through the intro carries into the run
  hud.show(true);
}
// P3: any key or pointer press during the intro skips it, and is swallowed (capture phase, before input.js
// sees it), so the skipping press never also jumps, ducks or changes lane (THE-774 "armed at press-down").
for (const type of ["pointerdown", "keydown"]) {
  window.addEventListener(type, (e) => {
    if (phase !== "intro") return;
    if (type === "keydown" && (e.ctrlKey || e.metaKey || e.altKey || ["Control", "Shift", "Alt", "Meta"].includes(e.key))) return; // F5, Ctrl+R etc. still work
    e.stopPropagation(); e.preventDefault();
    startRunning();
  }, true);
}

function startFromTitle() {
  if (phase !== "title" && phase !== "boot") return;
  goFullscreenLandscape();
  newRun();
}
// THE-1412: the Results "Again" action (button click, Enter/Space, or a bare tap outside the panel) --
// Endless unchanged; in a level it depends on how the run ended (levels/README.md): failed (caught, only
// possible on levels 10-12) retries the same level, otherwise it advances, or opens the map once there is
// nowhere further to advance to in this slice (the last LIVE level, which also covers "after level 12"
// once every level is live).
function restartRun() {
  if (phase !== "results") return;
  if (currentLevelIndex === null) { newRun({ retry: true }); return; }
  if (lastLevelFailed) { newRun({ retry: true, levelIndex: currentLevelIndex }); return; }
  if (currentLevelIndex >= LEVELS_LIVE - 1) { openLevelMapFromResults(); return; }
  newRun({ levelIndex: currentLevelIndex + 1 });
}
// THE-1412: the Retry pebble on level results -- always the same level again, never advances (hidden on
// a failed run, README: "not when failed").
function retryLevel() {
  if (phase !== "results" || currentLevelIndex === null) return;
  newRun({ retry: true, levelIndex: currentLevelIndex });
}
function missionsView() { return { mult: data.mult, missions: resetRunProgress(data.missions) }; }

function goHome() {
  audio.music(true, 0.5);
  makeTitleSim();
  phase = "title";
  hud.show(false);
  screens.showTitle(data.bestScore, missionsView(), totalStars(data.levels.stars));
}
// THE-1412: Levels (Title) and Map (level results, "Home is replaced by Map in a level") both open the
// trail map; the Back button and Escape there go to goHome(), the same single "Home" destination the rest
// of the game already uses.
function openLevelMap() {
  if (phase !== "title" && phase !== "boot") return;
  levelMap.show(data.levels.stars);
  phase = "levels";
  screens.showLevels();
}
function openLevelMapFromResults() {
  if (phase !== "results") return;
  levelMap.show(data.levels.stars);
  phase = "levels";
  screens.showLevels();
  // THE-774/THE-1408 pattern: this can run from the Results Enter/Space handler, synchronously, while
  // the key is still logically "down" -- the browser's own Enter-activates-focused-button default action
  // fires after this returns, against whatever showLevels() just focused on the new screen (e.g.
  // #mapBackBtn), which would silently bounce straight back to Title. Blur so that default action lands
  // on nothing.
  document.activeElement?.blur?.();
}
function playLevel(levelIndex) {
  if (phase !== "levels") return;
  goFullscreenLandscape();
  newRun({ levelIndex });
}
function pauseGame(source) {
  if (phase === "intro") startRunning(); // a blur/tab-away mid-intro: the run starts paused, never unwatched
  if (phase !== "running") return;
  phase = "paused";
  audio.music(false);
  input.reset();
  inRunLabel.hide();
  powerupRing.hide();
  screens.showPause({ mult: data.mult, missions: liveMissions });
}
function resumeGame() {
  if (phase !== "paused") return;
  audio.music(true);
  phase = "running";
  screens.showRunning();
}

document.addEventListener("visibilitychange", () => { if (document.hidden) pauseGame("hidden"); });
window.addEventListener("blur", () => pauseGame("blur"));
window.addEventListener("resize", checkOrientation);
els.canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); phase = "contextLost"; input.reset(); audio.music(false); screens.showContextLost(); });

let preRotatePhase = null;
function checkOrientation() {
  const portraitLock = isTouch && matchMedia("(orientation: portrait)").matches;
  if (portraitLock) {
    if (phase !== "rotate") {
      if (phase === "intro") startRunning(); // rotating mid-intro: come back to the paused run, not a stale title
      preRotatePhase = phase;
      if (phase === "running") { input.reset(); audio.music(false); }
      phase = "rotate";
      screens.showRotate();
    }
  } else if (phase === "rotate") {
    if (preRotatePhase === "running" || preRotatePhase === "paused") { phase = "paused"; screens.showPause({ mult: data.mult, missions: liveMissions }); }
    else if (preRotatePhase === "levels") { phase = "levels"; levelMap.show(data.levels.stars); screens.showLevels(); }
    else { phase = "title"; screens.showTitle(data.bestScore, missionsView(), totalStars(data.levels.stars)); }
  }
}

// CTO fix item 4 (THE-1259, 2026-11-05 22:43Z): the opening's junction (§5: "at 6.0 s") is the window's
// centre; the window itself opens TURN_BEFORE + TURN_BUFFER seconds earlier (sim.js), so the "now!" hint
// used to fire at 5.8 s -- after the window was already open and barely before it closed at 6.25 s. Show
// it the moment a press would actually register (window opens 1.25 s before centre = 4.75 s).
const OPENING_TURN_AT = 6.0;
const TURN_HINT_AT = OPENING_TURN_AT - TURN_BEFORE - TURN_BUFFER;

// THE-1372 (board 2026-11-07: "I can't read the green toast mid-run"): these used to be screens.toast()
// (the UIKit menu toast); now they're a label anchored to the hero's head (inRunLabel), positioned from
// the current frame's heroHeadScreen() in frame() below. The toast stays for menu/results messages only.
function maybeHint(t) {
  if (currentLevelIndex !== null || data.seenHowTo || sessionRuns > 3) return; // a level shows its own hint (maybeLevelHint)
  const labels = theme.inRunLabels || {};
  if (!hintsShown.jump && t >= 3.3 && t < 3.5) { hintsShown.jump = true; inRunLabel.show(labels.jump || "Jump!", world?.heroHeadScreen()); }
  else if (!hintsShown.turn && t >= TURN_HINT_AT && t < TURN_HINT_AT + 0.2) { hintsShown.turn = true; inRunLabel.show(labels.turnLeft || "← Left!", world?.heroHeadScreen()); }
  else if (!hintsShown.duck && t >= 8.3 && t < 8.5) { hintsShown.duck = true; inRunLabel.show(labels.duck || "Duck!", world?.heroHeadScreen()); }
  else if (!hintsShown.grace && t >= 20.0 && t < 20.3) {
    hintsShown.grace = true;
    inRunLabel.show(labels.graceOver || "Careful now!", world?.heroHeadScreen());
    if (sessionRuns >= 3) { data.seenHowTo = true; saveMod.save(data); }
  }
}
// THE-1412 (levels/README.md): "each level's hint shows as the in-run head label for 2.5 s at t = 1 s".
function maybeLevelHint(t, level) {
  if (hintsShown.levelHint || t < 1.0 || t >= 1.2) return;
  hintsShown.levelHint = true;
  inRunLabel.show(level.hint, world?.heroHeadScreen(), 2.5);
}

function enterCrashing() {
  phase = "crashing";
  hitStopT = HIT_STOP_TIME;
  inRunLabel.hide();
  powerupRing.hide();
}
function enterResults() {
  audio.music(true, 0.5);
  inRunLabel.hide(); powerupRing.hide(); // a level finish skips enterCrashing, which is where these were cleared (THE-1377 review)
  // THE-1412: missions keep counting in a level (spec Part 3), so finishRun() always runs the same way;
  // best/bestScore and the share-card distance stay Endless-only, and a level banks coins but never them.
  const runEndMissions = liveMissions;
  const finished = finishRun(runEndMissions, data.mult);
  data.missions = finished.missions;
  data.mult = finished.mult;
  if (currentLevelIndex !== null) {
    const level = LEVELS[currentLevelIndex];
    const failed = sim.crashed; // only reachable on levels 10-12 (catch: true)
    lastLevelFailed = failed;
    data.coins += sim.coins; // CTO call: a level run banks its coins like Endless
    const savedMask = data.levels.stars[currentLevelIndex];
    const earnedMask = starsEarned({ finished: sim.levelFinished, coinsThisRun: sim.coins, hits: sim.hits }, level);
    const finalMask = mergeStars(savedMask, earnedMask);
    data.levels.stars[currentLevelIndex] = finalMask;
    saveMod.save(data); // save first, animate after
    phase = "results";
    hud.show(false);
    screens.showResults(null,
      { runStartMult, runStartMissions, runEndMissions, finishMult: finished.mult, finishMissions: finished.missions },
      {
        level, failed, coinsThisRun: sim.coins, timeS: sim.t, hits: sim.hits,
        caughtAtS: sim.s, levelLengthM: sim.patterns.finishS, isLastLive: currentLevelIndex >= LEVELS_LIVE - 1,
        finalMask, isNew: [0, 1, 2].map((b) => !!(finalMask & (1 << b)) && !(savedMask & (1 << b))),
      },
    );
    return;
  }
  const score = computeScore(sim.s, sim.scoreMult, sim.coins);
  const isNewBest = score > data.bestScore; // THE-1407: "new best" is score-driven now, not distance
  if (sim.s > data.best) data.best = sim.s; // best distance still kept (save v2), just off the UI this slice
  data.coins += sim.coins;
  if (isNewBest) data.bestScore = score;
  // THE-1408: save first, animate after -- score keeps the mult the run started with (sim.scoreMult).
  saveMod.save(data);
  phase = "results";
  hud.show(false);
  screens.showResults(
    { s: sim.s, coins: sim.coins, score, scoreMult: sim.scoreMult, best: data.bestScore, crashCause: sim.crashCause, crashDetail: sim.crashDetail, isNewBest },
    { runStartMult, runStartMissions, runEndMissions, finishMult: finished.mult, finishMissions: finished.missions },
  );
}

function frame(now) {
  requestAnimationFrame(frame);
  if (lastT === null) lastT = now;
  let dt = (now - lastT) / 1000;
  lastT = now;
  if (dt > 0.25) dt = 0.25; // a long real-time gap (tab was hidden) never floods the accumulator
  if (phase === "running" && sim) {
    // B13 r2 (CTO ruling THE-1260 2026-11-06 05:46Z): r1 only held the render call while sim.step() kept
    // running at full speed underneath, so acc kept building and the capy silently advanced 0.3-0.9m --
    // a stutter, not a hit stop (a hit stop pauses game time). The real fix: while frozen, dt goes to 0
    // before the accumulator ever sees it, so no steps fire and acc never builds up; input still reaches
    // sim.press during the freeze, same as the crash hit stop pauses game time, not just drawing.
    if (nearMissFreezeT > 0) { nearMissFreezeT -= dt; dt = 0; }
    else {
      acc += dt;
      let steps = 0;
      while (acc >= FIXED_DT && steps < 5) {
        sim.step(FIXED_DT); acc -= FIXED_DT; steps++; maybeHint(sim.t);
        if (currentLevelIndex !== null) maybeLevelHint(sim.t, LEVELS[currentLevelIndex]);
        // THE-1408: the tracker reads new log entries every step (the log caps at 512).
        const prevDone = liveMissions.done;
        const freshForMissions = newLogEntriesSince(sim.log, missionLogT);
        if (sim.log.length) missionLogT = sim.log[sim.log.length - 1].t;
        const stepped = stepMissions(liveMissions, data.mult, missionRun, freshForMissions, sim.s, sim.power.kind);
        liveMissions = stepped.missions; missionRun = stepped.run;
        if (liveMissions.done.some((d, i) => d && !prevDone[i])) pendingMissionLabel = true;
      }
    }
    // THE-1408: queues behind whatever's already on the hero's head (one label slot).
    if (pendingMissionLabel && !inRunLabel.active) {
      pendingMissionLabel = false;
      inRunLabel.show((theme.inRunLabels || {}).missionDone || "Mission ✓", world?.heroHeadScreen());
      els.inRunLabel.classList.add("is-mission");
      audio.play("missionTick");
    }
    inRunLabel.step(dt, world?.heroHeadScreen());
    powerupRing.step(world?.heroHeadScreen(), sim.power.kind ? sim.power.t / POWER_TIME[sim.power.kind] : null, sim.power.kind);
    const fresh = newLogEntriesSince(sim.log, nearMissLogT);
    if (sim.log.length) nearMissLogT = sim.log[sim.log.length - 1].t;
    if (!sim.crashed && fresh.some((e) => e.type === "nearMiss")) nearMissFreezeT = NEAR_MISS_FREEZE_TIME;
    // A12.5: a stumble gets the same game-time freeze, a touch longer (a stumble is never a near miss, so
    // the two never stack in one frame; max() keeps the longer one if they ever did)
    if (!sim.crashed && fresh.some((e) => e.type === "stumble")) nearMissFreezeT = Math.max(nearMissFreezeT, STUMBLE_HIT_STOP_TIME);
    // THE-1391 (spec Part 1, optional juice): "1-3 words at the hero head on pop ('Saved!')" -- only for
    // an absorbed hit, never the plain 20 s timeout (reason "expire" pops silently, no label).
    const savedBy = fresh.find((e) => e.type === "shieldPop" && e.reason === "hit");
    if (savedBy) inRunLabel.show((theme.inRunLabels || {}).shieldSaved || "Saved!", world?.heroHeadScreen());
    // THE-1402: "a 1-3 word label for the coin prize" -- a power-up prize has no label, its own pickup
    // flow (aura/ring/sound) is the read for it.
    const mysteryCoins = fresh.find((e) => e.type === "pickup" && e.kind === "mystery" && e.prize?.coins !== undefined);
    if (mysteryCoins) inRunLabel.show(`+${mysteryCoins.prize.coins}`, world?.heroHeadScreen());
    // THE-1412 (levels/README.md "the moment"): the finish plays once off its own log entry, then the
    // sim keeps running (easing speed, chaser falling back) for LEVEL_FINISH_COAST_T before Results --
    // no new phase needed, "running" already renders sim normally through the coast.
    if (fresh.some((e) => e.type === "levelFinish")) {
      audio.play("levelFinish", { gain: 0.7 });
      window.UIKit?.celebrate?.({ x: window.innerWidth / 2, y: 0, colors: ["--color-primary", "--color-accent", "--color-text"] });
    }
    if (sim.crashed) { nearMissFreezeT = 0; enterCrashing(); }
    else if (sim.levelFinished && sim.t - sim.levelFinishT >= LEVEL_FINISH_COAST_T) enterResults();
  } else if (phase === "crashing") {
    // the 90 ms hit stop (spec §2) freezes render dt first; the gag's own 1.2 s only starts once it ends,
    // and any dt left over in the same frame the stop ends still advances the gag (no frame lost)
    if (hitStopT > 0) { const consumed = Math.min(hitStopT, dt); hitStopT -= consumed; dt -= consumed; }
    if (hitStopT <= 0) { crashGagT += dt; if (crashGagT >= CRASH_GAG_TIME) enterResults(); }
  }
  if (phase === "intro") {
    introT += dt;
    if (introFade) els.canvas.style.opacity = String(Math.min(1, introT / introDur));
    if (introT >= introDur) startRunning();
  }
  // the title and intro camera drift gently (none under reduce motion); the intro eases it out as it settles
  const swayT = (window.UIKit?.reduceMotion?.() ?? false) ? null : now / 1000;
  const soundOff = !data.settings.sound;
  // THE-1412: the map is a "clear" screen over the world too (levels/README.md "a cream slab over the
  // world"), same live background as Title.
  if (world && titleSim && (phase === "title" || phase === "levels")) world.renderFrame(titleSim.state(), dt, soundOff, { introK: 0, swayT, runKey: titleSeed, chaserVoice: false });
  else if (world && sim && (phase === "running" || phase === "crashing" || phase === "intro")) {
    world.renderFrame(sim.state(), dt, soundOff, { introK: phase === "intro" && !introFade ? introT / introDur : 1, swayT, runKey: runSeed, chaserVoice: phase !== "intro" });
    if (phase === "running") hud.update(sim.state(), data.bestScore);
    mapPanel.onFrame(sim, now); // THE-1375: reads sim directly (not the filtered state()); no-ops first line when closed
  } else if (world) world.silence(); // CTO fix (THE-1374): no frame rendered -> no live chaser voice left playing
}

// S7 (THE-1303): shared by boot, the __capy.tier() test hook and the Settings quality toggle -- a live
// tier switch is just dispose + recreate at the current size (G13/scene.js already supports this; only
// the toggle wiring to reach it was missing).
// THE-1582: the "HD bear" setting rides the same rebuild -- bearHD is read from the save at every build.
function makeWorld() {
  return createWorld(els.canvas, { seed: 1, tier, hero: heroKind, bearHD: data.settings.bearHD, width: els.canvas.clientWidth, height: els.canvas.clientHeight, dpr: Math.min(window.devicePixelRatio || 1, tier === "high" ? 2 : 1.5) });
}
function rebuildWorld() {
  if (world) world.dispose();
  world = makeWorld();
  if (sim) world.renderFrame(sim.state(), 0);
}
function setTier(name) {
  tier = name;
  rebuildWorld();
}

function boot() {
  world = makeWorld();
  window.addEventListener("resize", () => world.resize(els.canvas.clientWidth, els.canvas.clientHeight, Math.min(window.devicePixelRatio || 1, tier === "high" ? 2 : 1.5)));
  checkOrientation();
  makeTitleSim();
  if (phase !== "rotate") { phase = "title"; screens.showTitle(data.bestScore, missionsView(), totalStars(data.levels.stars)); }
  requestAnimationFrame(frame);
  window.dispatchEvent(new CustomEvent("game:ready"));
}
boot();

// S7 (THE-1303): the 2 tiers a player can actually pick between -- their device's own best tier (auto),
// or one step down, for a weaker device or to save battery. Checked = auto (the device's best); the
// engine still has a 3rd "low" rung, reachable only by stepping down from "mid" on a touch device.
const deviceBestTier = isTouch ? "mid" : "high";
const steppedDownTier = isTouch ? "low" : "mid";
els.settingQuality.checked = data.settings.tier === "auto";
els.settingQuality.addEventListener("change", () => {
  data.settings.tier = els.settingQuality.checked ? "auto" : steppedDownTier;
  saveMod.save(data);
  setTier(els.settingQuality.checked ? deviceBestTier : steppedDownTier);
});

// THE-1582: Settings -> "HD bear" (off by default). Saved, and applied live by rebuilding the world (the
// same dispose + recreate as the quality toggle). The capy has no HD variant, so the row is hidden for it.
els.settingBearHDRow.hidden = heroKind !== "bear";
els.settingBearHD.checked = data.settings.bearHD;
els.settingBearHD.addEventListener("change", () => {
  data.settings.bearHD = els.settingBearHD.checked;
  saveMod.save(data);
  if (heroKind === "bear") rebuildWorld();
});

// ---------------------------------------------------------------- test hook (design -> "Test hook", G13)
window.__capy = {
  state() { return sim ? sim.state() : null; },
  get log() { return sim ? sim.log : []; },
  get phase() { return phase; }, // QA/test-only diagnostic, not part of the G13 action surface
  audioState() { return audio.audioState(); }, // P4 test hook: "none" until the first gesture
  seed(n) { pendingSeed = n; if (phase !== "title") newRun(); else makeTitleSim(); },
  step(n) { if (!sim) return; for (let i = 0; i < n; i++) sim.step(FIXED_DT); if (world) world.renderFrame(sim.state(), FIXED_DT); },
  setSpeed(v) { if (sim) sim.speedOverride = v; },
  skipTo(m) { if (!sim) return; sim.s = m; sim.patterns.ensureAhead(sim.t, sim.s, sim.v); if (world) world.renderFrame(sim.state(), 0); },
  tier(name) { setTier(name); },
};

// Dev/QA-only, separate from the G13 __capy hook above (design -> "Test hook" scopes that one; this one
// is purely for a B5 regression test, THE-1259 S2 review: the topper must come back after a crash).
window.__capyDebug = {
  topper: () => (world ? world.debugTopperState() : null),
  forceExpr: (name) => world?.debugForceExpr(name),
  renderFrontThreeQuarter: () => world?.debugRenderFrontThreeQuarter(),
  skyPosition: () => world?.debugSkyPosition() ?? null,
  forceGlance: () => world?.debugForceGlance(),
  glanceAngle: () => world?.debugGlanceAngle() ?? null,
  capyScreenBox: () => world?.debugCapyScreenBox() ?? null,
  // THE-1373: which hero is active, and its head's world position (heroHeadWorld()) -- for the per-hero
  // tests here and for T2/T4 (the in-run label, the map marker) to build on later.
  heroKind: () => world?.debugHeroKind() ?? null,
  bearHD: () => world?.debugBearHD() ?? null, // THE-1582: true/false once the hero GLB has loaded, else null
  heroHeadWorld: () => world?.heroHeadWorld() ?? null,
  chaserVoice: () => world?.debugChaserVoice() ?? null, // THE-1374: how many bee buzz voices are live
  // THE-1372: the hero's head in screen px (render/scene.js's heroHeadScreen()), so a test can confirm the
  // in-run label is actually anchored there rather than just checking its text.
  heroHeadScreen: () => world?.heroHeadScreen() ?? null,
  // THE-1372: the active (merged) theme, so the copy test can build a share card with the same strings
  // the live game actually used, instead of guessing at window.THEME's raw per-hero shape.
  theme: () => theme,
  // THE-1375: the secret map panel's own open state and draw-call count -- the zero-cost-hidden test
  // proves no draw happened across 600 frames while closed; the toggle test confirms open/close.
  mapOpen: () => mapPanel.isOpen(),
  mapDrawCount: () => mapPanel.debugDrawCount(),
  // THE-1391: a real-time E2E test (chaser-flank-touch) can now cross a pickup before it reaches its own
  // scripted filler, with the shield silently absorbing the very hit the test means to force -- lets that
  // test clear an accidentally-collected power-up first, same narrow "one regression test" precedent as
  // every other entry here.
  clearPower: () => { if (sim) sim.power = { kind: null, t: 0 }; },
  // THE-1391: forces a given power-up active without waiting on the generator's own placement odds --
  // for a frame-time sample with the shield's bubble actually on screen (and any later slice's own visual).
  givePower: (kind, t) => { if (sim) sim.power = { kind, t }; },
  // THE-1412: starts a level directly (1-indexed, matching levels.js's own `n`), skipping the map tap and
  // its phase guard -- for tests that need a level run without driving the map's own UI first.
  startLevel: (n) => newRun({ levelIndex: n - 1 }),
  levelsStars: () => data.levels.stars,
  // THE-1417: forces a real two-hit catch (post-grace side hit, then a 2nd inside the 5 s strike window) --
  // the deterministic, fast path to levels.test.mjs's own "catch -> failed Results" real-pointer regression,
  // same narrow one-test precedent as givePower/clearPower above.
  forceCatch: () => {
    if (!sim) return;
    const bump = () => {
      sim.patterns.hazards = [{ s: sim.s, lane: 0, kind: "block", hit: false, cleared: false }];
      sim.lane = 0; sim.stepLane = 1; sim.stepT = 0.5; sim.stumbleT = 0;
      sim.step(0);
    };
    if (sim.t < 20) sim.t = 20.5;
    bump();
    sim.t += 2;
    bump();
  },
};
