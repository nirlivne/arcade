// Cannonball Family: screens, the fixed-step loop, keyboard and pointer aim, and the test hook (THE-449 S1–S2).
// The rules are in sim.js.
import { createLevel, fire, step, hash, fastForwardAim, randomShot, DT, tinsDown, FUSE_STEPS, CANNON } from "./sim.js";
import { levelDef, LEVEL_COUNT } from "./levels.js";
import { continueLevel, progressTotals, isCleared } from "./progress.js";
import { chapterOf } from "./generator.js";
import { aimFrom, FULL_POWER_PX } from "./aim.js";
import { createSave } from "./save.js";
import { createCastStore } from "./family.js";
import { bindFamilySheet } from "./family-sheet.js";
import { draw, fitView, screenToWorld, worldToScreen, memberFor, loadPhotos } from "./render.js";
import { bindPull } from "./input.js";
import { dailyLevel, localDateKey, shareLine, ARCADE_URL } from "./daily.js";
import { DAILY_TABLE } from "./daily-table.js";
import { CBF } from "./troupe.js";
import * as audio from "./audio.js";

let LEVEL = 1; // the level being played (1–30)
const MAX_CATCH_UP = 5 * DT; // spec §2: after a stall, at most 5 steps catch up (no burst)
const KEY_ANGLE = 1, KEY_POWER = 0.02; // spec §5 keyboard steps

const app = document.getElementById("cb-app");
const canvas = document.getElementById("cb-world");
const ctx = canvas.getContext("2d");
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
let view = fitView(1, 1), dpr = 1;
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

// The first-run demo (spec §5 "Controls and first 10 seconds"; shown once, ever, on this device, on level 1
// only). The sim is frozen throughout (advance() never runs while demoPhase is set): nothing physical
// happens during the demo, so there's nothing to resolve early, and the fuse starts fresh only once it ends.
// demoClock is wall-clock seconds since the demo started, driving both the two captions and the looping hand.
let demoPhase = null; // null | "goal" (0-1.5s) | "rule" (1.5-3s) | "loop" (hand demo, until a tap or Space/Enter)
let demoClock = 0;
const demoEl = document.getElementById("cb-demo");
const demoCaption = document.getElementById("cb-demo-caption");
const HAND_LOOP_MS = 1800; // one pull-back-and-release cycle of the felt hand

function startDemo() {
  demoPhase = "goal";
  demoClock = 0;
  demoEl.hidden = false;
  demoCaption.hidden = false;
  demoCaption.textContent = T.demoGoal;
}

function endDemo() {
  demoPhase = null;
  demoEl.hidden = true;
  demoCaption.hidden = true;
  save.markDemoSeen();
  updateRailState(); // hands the rail chips' is-now back to the real sim state
  last = performance.now(); // the fuse starts fresh from here, not from whenever startLevel ran
}

demoEl.addEventListener("pointerdown", endDemo);
document.getElementById("cb-demo-skip").addEventListener("click", (e) => { e.stopPropagation(); endDemo(); });

const RULE_CHIP_MS = 1500 / 5; // 5 is the default family size; a 6th (Teen) just gets caught in the last slot

// Advances the demo's own clock and caption/hand/rail-chip state. Runs every frame while demoPhase is set,
// independent of advance()/step() (the sim itself never moves during the demo).
function tickDemo(dtMs) {
  demoClock += dtMs;
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
function resize() {
  dpr = window.devicePixelRatio || 1;
  const w = app.clientWidth, h = app.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  if (!playScreenEl.classList.contains("is-active")) { view = fitView(w, h); return; }
  const railRect = railEl.getBoundingClientRect();
  const railIsColumn = railRect.height > railRect.width; // the left-column layout is taller than it is wide
  const worldW = railIsColumn ? w - railRect.width : w;
  const worldH = railIsColumn ? h : h - railRect.height;
  const fitted = fitView(worldW, worldH);
  // fitView centres inside (worldW, worldH); re-offset into the full canvas, past the rail's own edge, so the
  // centred world doesn't creep under the rail column/plank.
  view = { ...fitted, ox: fitted.ox + (railIsColumn ? railRect.width : 0), oy: fitted.oy + (railIsColumn ? 0 : railRect.height) };
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
function showScreen(id) {
  if (!screenShown) { screenShown = true; applyScreen(id); return; }
  if (pendingOpen) {
    // A second screen change landed before the first one's curtain finished (e.g. two showScreen calls in the
    // same synchronous task, as checkEnd() can produce right after a level loads via the test hook): swap to
    // this id instead when the curtain opens, rather than running two independent close/open cycles or — the
    // bug this replaced — silently applying the new screen without ever clearing is-closed, leaving the
    // curtain stuck shut because the first cycle's own open() was still the only thing that would clear it.
    pendingOpen.id = id;
    return;
  }
  curtains.classList.add("is-closed");
  const pending = { id, opened: false };
  pendingOpen = pending;
  const open = () => {
    if (pending.opened) return;
    pending.opened = true;
    applyScreen(pending.id);
    curtains.classList.remove("is-closed");
    if (pendingOpen === pending) pendingOpen = null;
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

// Starts level n (default: the one Play continues at). A fresh attempt of that level.
function startLevel(n = LEVEL) {
  dailyMode = false;
  LEVEL = n;
  sim = createLevel(levelDef(LEVEL), { level: LEVEL, familySize: cast.members.length });
  inPlay = true;
  ended = false;
  pull = null;
  tags = [];
  tagTins = [];
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
  dailyMode = true;
  dailyDate = localDateKey(new Date());
  const def = dailyLevel(dailyDate, DAILY_TABLE);
  const saved = save.loadDaily();
  const resuming = !!(saved && saved.date === dailyDate && !saved.done);
  dailyFirstAttempt = !(saved && saved.date === dailyDate && saved.done);
  // Share reads lastDailyResult (CTO review on THE-449): it was only ever set at the end of a first attempt
  // in this same session, so Share did nothing after a reload straight into today's already-done tower (a
  // Practice end then showed Share, but shareResult() found lastDailyResult still null and returned early).
  if (!dailyFirstAttempt) lastDailyResult = { won: saved.won, stars: saved.stars };
  sim = createLevel(def, { level: def.level, familySize: cast.members.length });
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
  tags = [];
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
  if (won) audio.playCurtainCall(); // drum roll + cymbal (DESIGN.md §10), the win-only curtain call
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
    const shown = wasFirstAttempt ? { won, stars: sim.stars } : save.loadDaily();
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
  pendingResultDraw = () => drawResultStage(won, unflown);
  showScreen(resultId);
  // Celebration (AC-W6): a win or a new best. ui-kit draws the confetti, or a soft glow under reduced motion.
  if (window.UIKit && (won || newBest)) window.UIKit.celebrate();
  // showScreen applies the new screen synchronously only for the very first screen ever shown (screenShown's
  // own check) — every later call defers to applyScreen() via the curtain, where pendingResultDraw is
  // actually consumed. That first-screen case can't happen here (checkEnd only runs after at least one level
  // has already been shown), but calling it directly would be relying on that, not guaranteeing it.
  updateHud();
}

// The level map: all 30 open, grouped into 3 chapters of 10, each a felt patch with its stars out of its cap
// (DESIGN.md's class contract: #cbf-map, .cbf-bar/.cbf-h2/.cbf-total, .cbf-chapter__title, ol.cbf-levels >
// button.cbf-level(.is-cleared, .is-current) > b, .cbf-level__stars > i(.is-lit)).
function levelPatch(n, data, current) {
  const d = levelDef(n);
  const cap = Math.min(3, d.N - d.par);
  const got = Math.min(cap, data.stars[String(n)] ?? 0);
  const li = document.createElement("li");
  const b = document.createElement("button");
  b.type = "button";
  b.className = "cbf-level" + (isCleared(data, n) ? " is-cleared" : "") + (n === current ? " is-current" : "");
  b.dataset.level = String(n);
  const num = document.createElement("b");
  num.textContent = String(n);
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

let lastShotsLogged = 0; // sim.shots.length as of the previous advance(): a new entry is a cannon fire, any source
let lastPosesLogged = 0; // sim.poses.length as of the previous advance(): a new entry is a landing (bow/shrug)

// Cannon shake (DESIGN.md §9 "Fire": 2 px, 160 ms, skin.css's .cbf-app.is-shake). Off under reduced motion.
const appEl = document.getElementById("cb-app");
function shake() {
  if (window.UIKit && window.UIKit.reduceMotion()) return;
  appEl.classList.remove("is-shake");
  void appEl.offsetWidth; // restart the animation when the previous shot's is still running
  appEl.classList.add("is-shake");
}

function advance(n) {
  step(sim, n, heldAim);
  if (sim.shots.length > lastShotsLogged) { audio.playCannon(); shake(); } // every real fire, held fuse or random (DESIGN.md §9 "Fire")
  lastShotsLogged = sim.shots.length;
  if (sim.downThisShot > 0 && lastDownThisShot === 0) hitStopUntil = performance.now() + HITSTOP_MS;
  lastDownThisShot = sim.downThisShot;
  const now = performance.now();
  sim.tins.forEach((t, i) => {
    if (t.down && !tagTins[i]) { tags.push({ x: t.x, y: t.y, bornAt: now }); audio.playTonk((i % 4) / 3); }
    tagTins[i] = t.down;
  });
  tags = tags.filter((tg) => now - tg.bornAt < TAG_POP_MS + TAG_FLOAT_MS);
  if (sim.poses.length > lastPosesLogged) {
    // "Landing" (DESIGN.md §9): the net sags, then bow or shrug. Both the boing and the pose sound land here,
    // the one moment resolve() (sim.js) settles a shot.
    audio.playBoing();
    if (sim.pose === "bow") audio.playBow(); else audio.playShrug();
  }
  lastPosesLogged = sim.poses.length;
  if (sim.phase !== "aim") pull = null; // a fuse shot ended the pull: the real release will fire nothing
  recordNewDailyShots(); // covers a fuse-fired shot, taken inside step()
  checkEnd();
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
  draw(ctx, sim, view, dpr, preview, cast, demoPhase ? 1 : arcFraction(), hand, wobble, liveTags, photos);
  requestAnimationFrame(frame);
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

function canAim() {
  return inPlay && !ended && !paused && !demoPhase && sim.phase === "aim";
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

resize();
themeReady.then(() => showScreen("cbf-title"));
requestAnimationFrame(frame);
