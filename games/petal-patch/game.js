// Petal Patch game.js: the screen state machine, the timer registry, and the wiring from input -> model
// -> render -> run/save. Matches the designer's class contract (DESIGN.md §1): screens use `hidden`,
// `body[data-state]` mirrors the state machine, `html[data-motion]` is the resolved reduce|full choice.
// Browser-only ES module entry point (loaded via <script type="module">).

import * as rules from "./rules.mjs";
import * as solver from "./solver.mjs";
import * as model from "./model.mjs";
import * as run from "./run.mjs";
import * as save from "./save.mjs";
import { attachBoardInput, attachKeyboardInput } from "./input.js";
import * as render from "./render.js";
import { runDemo, stopDemo } from "./demo.js";
import { shareResult } from "./share.js";

const $ = (sel) => document.querySelector(sel);
const els = {
  boardEl: $("#board"), boardWrap: $("#board-wrap"), heroEl: $("#hero"), flowerEl: $("#flower"),
  clockEl: $("#clock"), starTargetsEl: $("#star-targets"), parEl: $("#par"), chipsEl: $("#chips"),
  hintCountEl: $("#hint-count"), resultEl: $("#result"), runoverEl: $("#runover"), stripTitleText: $("#strip-title-text"), stripTag: $("#strip-tag"),
  playScreen: document.querySelector('[data-screen="play"]'),
};

// ---------- timer registry (design.md "Timers and animations") ----------
let generation = 0;
const timerRegistry = { timeouts: new Map(), rafs: new Set() };
const timers = {
  after(ms, fn) {
    const gen = generation;
    const id = setTimeout(() => { timerRegistry.timeouts.delete(id); if (gen === generation) fn(); }, ms);
    timerRegistry.timeouts.set(id, gen);
    return id;
  },
  cancel(id) { clearTimeout(id); timerRegistry.timeouts.delete(id); },
  raf(fn) {
    const gen = generation;
    const id = requestAnimationFrame((t) => { timerRegistry.rafs.delete(id); if (gen === generation) fn(t); });
    timerRegistry.rafs.add(id);
    return id;
  },
  clearAll() {
    for (const id of timerRegistry.timeouts.keys()) clearTimeout(id);
    for (const id of timerRegistry.rafs) cancelAnimationFrame(id);
    timerRegistry.timeouts.clear();
    timerRegistry.rafs.clear();
  },
};
function bumpGeneration() { generation++; timers.clearAll(); }

// ---------- test-hook time overrides ----------
let dateOverride = null;
function nowDate() { return dateOverride ? new Date(dateOverride) : new Date(); }

// ---------- pack + save ----------
const pack = window.PETAL_LEVELS;
let S = save.load(window.localStorage);

function decodeBoard(b) {
  if (!b) return null;
  return { id: b.id, n: b.n, beds: b.beds.split("").map(Number), sol: b.sol.split("").map(Number), par: b.par };
}
function findBoardById(id) {
  for (const b of pack.practice) if (b.id === id) return decodeBoard(b);
  for (const key of Object.keys(pack.endless)) for (const b of pack.endless[key]) if (b.id === id) return decodeBoard(b);
  for (const b of pack.daily) if (b.id === id) return decodeBoard(b);
  return null;
}

// ---------- clock ----------
let clockRunning = false;
let clockBase = 0;
let clockBaseMs = 0;

function startClock() { clockRunning = true; clockBase = performance.now(); clockBaseMs = G.boardState.ms; tickClock(); }
function stopClock() {
  if (clockRunning && G.boardState) G.boardState = model.setElapsed(G.boardState, clockBaseMs + (performance.now() - clockBase));
  clockRunning = false;
}
function tickClock() {
  if (!clockRunning) return;
  G.boardState = model.setElapsed(G.boardState, clockBaseMs + (performance.now() - clockBase));
  render.renderClock(els.clockEl, G.boardState.ms);
  timers.raf(tickClock);
}

// ---------- global mutable game state ----------
const G = {
  screen: "start", boardOverlay: null, paused: false, dialog: null, dialogOpener: null,
  mode: null, board: null, boardState: null,
  runPoolState: {}, runSeed: 0, runBoardNo: 0, runStars: 0,
  dailyKey: null, dailyNo: 1, shareText: "",
};

function bodyState(s) { document.body.dataset.state = s; }

// ---------- persistence ----------
function persist() { save.persist(window.localStorage, S); }
function boardStateToSave(bs) { return { id: bs.id, bugs: bs.bugs, red: bs.red, marks: bs.marks, petals: bs.petals, hints: bs.hints, ms: bs.ms }; }

function solutionCellSet(board) {
  const set = new Set();
  for (let r = 0; r < board.n; r++) set.add(r * board.n + board.sol[r]);
  return set;
}

// Rehydrates a saved BoardState against the *actual* board it belongs to (THE-180 review fix 1): the
// generic save sanitiser only knows shapes, not board content, so a save that's stale, tampered with, or
// for a different-sized board could otherwise carry a bug on a non-solution cell, a red mark on a
// solution cell, or a cell index past this board's n*n. mistakes/hintUsed aren't stored (review fix 3) --
// they're derived from petals/hints, which are otherwise the only record of them.
function boardStateFromSave(bs, board, opts) {
  const n2 = board.n * board.n;
  const sol = solutionCellSet(board);
  const inRange = (c) => Number.isInteger(c) && c >= 0 && c < n2;
  const practice = !!(opts && opts.practice);
  const bugs = bs.bugs.filter((c) => inRange(c) && sol.has(c));
  const red = bs.red.filter((c) => inRange(c) && !sol.has(c));
  const marks = bs.marks.filter(inRange);
  return {
    id: bs.id, n: board.n, bugs, red, marks, petals: bs.petals, hints: bs.hints, ms: bs.ms,
    practice, hintUsed: bs.hints < 3, mistakes: practice ? 0 : Math.max(0, 3 - bs.petals),
    undoStack: [], solved: false, wilted: false,
  };
}

function saveRun(opts) {
  if (G.mode !== "run") return;
  S.run = { seed: G.runSeed, boardNo: G.runBoardNo, poolState: G.runPoolState, board: boardStateToSave(G.boardState), stars: G.runStars, score: G.runBoardNo - 1, cleared: !!(opts && opts.cleared) };
  S.active = "run";
  persist();
}
function saveDaily(extra) {
  if (G.mode !== "daily") return;
  const done = !!(extra && extra.done);
  const entry = { done, wilted: !!(extra && extra.wilted), petals: G.boardState.petals, ms: G.boardState.ms,
    stars: extra && extra.stars !== undefined ? extra.stars : 0, board: done ? null : boardStateToSave(G.boardState) };
  S.daily[G.dailyKey] = entry;
  // A wilted daily still counts as played and keeps the streak; only a missed date resets it (spec §2 "Streak").
  if (done) S.streak = run.nextStreak(S.streak, G.dailyKey, true);
  S.active = done ? null : "daily";
  persist();
}

// ---------- screens ----------
function showScreen(name) {
  G.screen = name;
  for (const sc of document.querySelectorAll(".screen")) sc.toggleAttribute("hidden", sc.dataset.screen !== name);
}

// ---------- board lifecycle ----------
function loadBoardIntoPlay(board, state, opts) {
  G.board = board;
  G.boardState = state;
  bumpGeneration();
  G.boardOverlay = null;
  els.playScreen.dataset.mode = (opts && opts.mode) || G.mode || "";
  render.buildBoard(els.boardEl, board);
  render.drawBoard(els.boardEl, board, state, S.settings.autoX);
  render.renderFlower(els.flowerEl, state.petals, false);
  render.renderClock(els.clockEl, state.ms);
  render.renderStarTargets(els.starTargetsEl, 0);
  render.renderPar(els.parEl, board.par);
  render.renderHintCount(els.hintCountEl, state.hints);
  els.resultEl.hidden = true;
  els.runoverEl.hidden = true;
  els.stripTitleText.textContent = (opts && opts.label) || "";
  els.stripTag.hidden = !state.practice;
  showScreen("play");
  if (opts && opts.paused) {
    G.paused = true;
    stopClock();
    openDialog($("#pause-dialog"), null);
  } else {
    G.paused = false;
    bodyState(state.practice ? "practice" : "play");
    startClock();
    // Keyboard input is scoped to the board element (bubbling), so a keyboard-only player needs a cell
    // focused to act at all; focusing cell 0 on load gets them playing without requiring a Tab first.
    els.boardEl.querySelector('[data-cell="0"]')?.focus({ preventScroll: true });
  }
}

function startPracticeBoard(afterMode) {
  const board = decodeBoard(pack.practice[Math.floor(Math.random() * pack.practice.length)]);
  G.mode = "practice-first";
  G.pendingAfterMode = afterMode;
  loadBoardIntoPlay(board, model.initState(board, { practice: true, hints: 3 }), { label: "Warm-up", mode: "practice" });
}

// Starts a brand-new run (draws board 1 via the seeded pool). To resume a saved run instead, use
// resumeRun(); to advance mid-session, use advanceRunBoard(). Never call nextRunBoard() again for a board
// that's already been drawn and saved -- it would advance the pool a second time and could draw a
// different board than the one the saved BoardState (bugs/marks) actually belongs to.
function startRun(fresh) {
  if (!fresh && S.run) return resumeRun();
  G.runSeed = run.newRunSeed();
  G.runBoardNo = 1;
  G.runPoolState = {};
  G.runStars = 0;
  G.mode = "run";
  const rng = run.makeRng(G.runSeed ^ G.runBoardNo);
  const draw = run.nextRunBoard(pack, rng, G.runPoolState, G.runBoardNo);
  G.runPoolState = draw.poolState;
  const board = findBoardById(draw.id);
  const state = model.initState(board, { practice: draw.tier === "P", hints: 3 });
  loadBoardIntoPlay(board, state, { label: `Run · Board ${G.runBoardNo}`, mode: "run" });
  saveRun();
}

// Resumes S.run exactly as saved: the same board (by id, not redrawn), the same pool/seed/board#, opened
// paused (spec §2 "Reload mid-board"). THE-180 review fixes:
// 1. A save whose board id isn't in the current pack (unknown, empty, or from a stale/tampered save) would
//    otherwise crash boot permanently -- validate it first and drop the run instead.
// 2. A run saved mid clear-hold (`cleared`) has nothing left to do (every ladybug already placed, but
//    `solved` isn't persisted) -- resuming it must advance to the next board, not reopen a dead end.
function resumeRun() {
  const board = findBoardById(S.run.board.id);
  if (!board) {
    S.run = null;
    S.active = null;
    persist();
    goToMenu();
    return;
  }
  G.runSeed = S.run.seed;
  G.runBoardNo = S.run.boardNo;
  G.runPoolState = S.run.poolState;
  G.runStars = S.run.stars;
  G.mode = "run";
  if (S.run.cleared) {
    G.runBoardNo += 1;
    advanceRunBoard();
    return;
  }
  const state = boardStateFromSave(S.run.board, board, { practice: run.tierForBoardNo(G.runBoardNo) === "P" });
  loadBoardIntoPlay(board, state, { label: `Run · Board ${G.runBoardNo}`, mode: "run", paused: true });
}

// Advances the live, in-memory run to its next board (spec §3 run curve). G.runBoardNo is already
// incremented by the caller.
function advanceRunBoard() {
  G.mode = "run";
  const rng = run.makeRng(G.runSeed ^ G.runBoardNo);
  const draw = run.nextRunBoard(pack, rng, G.runPoolState, G.runBoardNo);
  G.runPoolState = draw.poolState;
  const board = findBoardById(draw.id);
  const state = model.initState(board, { practice: draw.tier === "P", hints: 3 });
  loadBoardIntoPlay(board, state, { label: `Run · Board ${G.runBoardNo}`, mode: "run" });
  saveRun();
}

function startDaily() {
  const date = nowDate();
  const d = run.daysSinceEpoch(date);
  const idx = run.dailyBoardIndex(d);
  const no = run.dailyNo(d);
  const key = run.dailyDateKey(date);
  G.mode = "daily";
  G.dailyKey = key;
  G.dailyNo = no;
  const existing = S.daily[key];
  if (existing && existing.done) { openClipping(); return; }
  const board = decodeBoard(pack.daily[idx]);
  const state = existing && existing.board ? boardStateFromSave(existing.board, board, { practice: false }) : model.initState(board, { practice: false, hints: 3 });
  loadBoardIntoPlay(board, state, { label: dateLabel(date), mode: "daily", paused: !!existing });
  saveDaily();
}

function dateLabel(date) {
  return `Daily · ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

// ---------- dialogs ----------
function openDialog(dialog, opener) {
  G.dialogOpener = opener || null;
  if (G.dialog && G.dialog !== dialog && G.dialog.open) G.dialog.close();
  G.dialog = dialog;
  stopClock();
  bodyState(dialog.dataset.sheet === "pause" ? "paused" : "dialog");
  if (!dialog.open) dialog.showModal();
}
function closeDialog() {
  if (G.dialog && G.dialog.open) G.dialog.close();
  G.dialog = null;
  if (G.dialogOpener === "pause") {
    G.dialogOpener = null;
    openDialog($("#pause-dialog"), null);
    return;
  }
  G.dialogOpener = null;
  if (G.screen === "play") {
    bodyState(G.boardOverlay || (G.boardState && G.boardState.practice ? "practice" : "play"));
    if (!G.paused && !G.boardOverlay) startClock();
  } else if (G.screen === "clipping") bodyState("clipping");
  else bodyState("start");
}

function pause() {
  if (G.paused || G.screen !== "play" || G.boardOverlay) return;
  G.paused = true;
  stopClock();
  openDialog($("#pause-dialog"), null);
}
function resume() {
  G.paused = false;
  if (G.dialog && G.dialog.open) G.dialog.close();
  G.dialog = null;
  G.dialogOpener = null;
  bodyState(G.boardState && G.boardState.practice ? "practice" : "play");
  startClock();
  const focused = els.boardEl.querySelector(".cell[tabindex=\"0\"]") || els.boardEl.querySelector('[data-cell="0"]');
  focused?.focus({ preventScroll: true });
}

// ---------- dispatch: input -> model -> render -> side effects ----------
function boardIntentsAllowed() {
  return G.screen === "play" && !G.paused && !G.dialog && !G.boardOverlay;
}

function dispatch(intent) {
  if (intent.type === "pause") { pause(); return; }
  if (!boardIntentsAllowed()) return;
  const { state, events } = model.apply(G.board, G.boardState, intent, { showAutoX: S.settings.autoX });
  if (state === G.boardState && !events.length) return;
  G.boardState = state;
  render.drawBoard(els.boardEl, G.board, state, S.settings.autoX);
  render.renderFlower(els.flowerEl, state.petals, state.wilted);
  render.renderHintCount(els.hintCountEl, state.hints);
  render.playEvents(els.boardEl, events, G.board, timers);
  checkDeadEnds();
  if (state.solved) onSolved();
  else if (state.wilted) onWilt();
  else if (G.mode === "run") saveRun(); else if (G.mode === "daily") saveDaily();
}

function checkDeadEnds() {
  const units = model.deadEndUnits(G.board, G.boardState);
  if (!units.length) return;
  const cells = units.flatMap((u) => u.cells);
  render.deadEndPulse(els.boardEl, cells);
}

function starsNow() { return model.starsFor(G.boardState, G.board); }
function themeText() { return (window.THEME && window.THEME.text) || {}; }
function themeOf(field, fallback) { return (window.THEME && typeof window.THEME[field] === "string" && window.THEME[field]) || fallback; }

function onSolved() {
  stopClock();
  G.boardOverlay = "clearHold";
  bodyState("clearHold");
  const stars = starsNow();
  timers.after(120, () => {
    $("#result-head").textContent = `${themeText().solvedIn || "Solved in"} ${run.formatTime(G.boardState.ms)}`;
    render.renderStarTargets($("#result-stars"), stars);
    $("#result-par").textContent = G.board.par ? `par ${run.formatTime(G.board.par * 1000)}` : "";
    $("#btn-next-label").textContent = G.mode === "practice-first"
      ? (G.pendingAfterMode === "daily" ? "Today's garden" : "Start the run")
      : "Next board";
    els.resultEl.hidden = false;
    $("#btn-next").focus();
  }, 0);
  // Saved as `cleared` (review fix 2): every ladybug is already placed, so a resume must advance to the
  // next board rather than reopen this one with nothing left to do.
  if (G.mode === "run") { G.runStars += stars; saveRun({ cleared: true }); }
  else if (G.mode === "daily") saveDaily({ done: true, wilted: false, stars });
}

function onNext() {
  els.resultEl.hidden = true;
  if (G.mode === "practice-first") {
    S.firstRunDone = true;
    persist();
    if (G.pendingAfterMode === "daily") startDaily(); else startRun(true);
    return;
  }
  if (G.mode === "run") { G.runBoardNo += 1; advanceRunBoard(); return; }
  if (G.mode === "daily") { openClipping(); return; }
}

function onWilt() {
  stopClock();
  G.boardOverlay = "wilt";
  bodyState("wilt");
  if (G.mode === "run") {
    const boards = G.runBoardNo - 1;
    if (run.isBetterRun({ boards, stars: G.runStars }, S.best)) S.best = { boards, stars: G.runStars };
    S.run = null;
    S.active = null;
    persist();
    timers.after(400, () => {
      $("#runover-headline").textContent = themeText().runoverHeadline || "The patch wilted.";
      const boardWord = boards === 1 ? "board" : "boards";
      $("#runover-meta").textContent = `Board ${G.runBoardNo} · ${boards} ${boardWord} cleared · best ${S.best.boards}`;
      G.shareText = run.runShareText({ boards, stars: G.runStars, title: themeOf("title", "Petal Patch"), url: themeOf("shareUrl", run.SHARE_URL) });
      els.runoverEl.hidden = false;
      $("#btn-newrun").focus();
    }, 0);
  } else if (G.mode === "daily") {
    saveDaily({ done: true, wilted: true, stars: 1 });
    timers.after(400, openClipping, 0);
  }
}

function openClipping() {
  const entry = S.daily[G.dailyKey];
  const text = run.shareText({ no: G.dailyNo, wilted: !!entry.wilted, petals: entry.petals, ms: entry.ms, stars: entry.stars, title: themeOf("title", "Petal Patch"), url: themeOf("shareUrl", run.SHARE_URL) });
  const date = nowDate();
  $("#clip-date").textContent = date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  $("#clip-no").textContent = `No. ${G.dailyNo}`;
  $("#clip-headline").textContent = entry.wilted ? (themeText().clippingWilted || "Today's garden wilted.") : (themeText().clippingSolved || "Today's garden, solved.");
  $("#clip-text").textContent = text;
  $("#share-fallback").value = text;
  $("#clip-meta").textContent = `Your best: ${run.formatTime(bestDailyMs())} · streak ${S.streak.count} days`;
  showScreen("clipping");
  bodyState("clipping");
  G.shareText = text;
  tickCountdown();
}
function bestDailyMs() {
  let best = 0;
  for (const entry of Object.values(S.daily)) {
    if (!entry.done || entry.wilted) continue;
    if (!best || entry.ms < best) best = entry.ms;
  }
  return best;
}

function tickCountdown() {
  if (G.screen !== "clipping") return;
  const now = nowDate();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const ms = next - now;
  const h = String(Math.floor(ms / 3600000)).padStart(2, "0");
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0");
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
  const el = $("#clip-countdown");
  if (el) el.textContent = `${h}:${m}:${s}`;
  timers.after(1000, tickCountdown);
}

// ---------- hint ----------
function computeHintStep() {
  const dead = rules.autoX(G.boardState.bugs, G.board.n, G.board.beds);
  return solver.nextStep(G.board.n, G.board.beds, G.boardState.bugs, dead);
}
function doHint() {
  if (!boardIntentsAllowed()) return;
  const step = computeHintStep();
  const { state } = model.apply(G.board, G.boardState, { type: "hint" });
  G.boardState = state;
  render.renderHintCount(els.hintCountEl, state.hints);
  // The hint charge (and the derived hintUsed/star penalty on reload) must survive a reload same as any
  // other committed action -- found while adding the THE-180 fix-3 regression check.
  if (G.mode === "run") saveRun(); else if (G.mode === "daily") saveDaily();
  if (!step) return;
  const kind = step.unit ? step.unit.kind : null;
  const chipKind = kind === "row" ? "row" : kind === "col" ? "col" : kind === "bed" ? "bed" : null;
  const unitCells = step.unit ? step.unit.cells : [];
  render.hintHighlight(els.boardEl, els.chipsEl, unitCells, step.cells, chipKind);
}

// ---------- undo / clearX ----------
function doUndo() { dispatch({ type: "undo" }); }
function doClearX() { dispatch({ type: "clearX" }); }

// ---------- board input wiring ----------
attachBoardInput(els.boardEl, dispatch);
const kb = attachKeyboardInput(els.boardEl, (intent) => {
  if (intent.type === "undo") return doUndo();
  if (intent.type === "hint") return doHint();
  dispatch(intent);
});

// ---------- buttons ----------
$("#btn-daily").addEventListener("click", () => { if (!S.firstRunDone) startPracticeBoard("daily"); else startDaily(); });
$("#btn-run").addEventListener("click", () => {
  if (!S.firstRunDone) return startPracticeBoard("run");
  startRun(!S.run);
});
$("#btn-menu").addEventListener("click", goToMenu);
$("#btn-pause").addEventListener("click", pause);
$("#btn-confirm-end").addEventListener("click", () => { closeDialog(); S.run = null; persist(); goToMenu(); });
$("#btn-confirm-cancel").addEventListener("click", closeDialog);
$("#btn-next").addEventListener("click", onNext);
$("#btn-newrun").addEventListener("click", () => startRun(true));
$("#btn-runover-menu").addEventListener("click", goToMenu);
$("#btn-runover-share").addEventListener("click", () => shareResult(G.shareText));
$("#btn-share").addEventListener("click", () => shareResult(G.shareText));
$("#btn-copy").addEventListener("click", () => shareResult(G.shareText));
$("#btn-clipping-menu").addEventListener("click", goToMenu);
$("#btn-undo").addEventListener("click", doUndo);
$("#btn-hint").addEventListener("click", doHint);
$("#btn-clearx").addEventListener("click", doClearX);
$("#btn-resume").addEventListener("click", resume);
$("#btn-pause-menu").addEventListener("click", () => { if (G.dialog) G.dialog.close(); G.dialog = null; goToMenu(); });
$("#btn-pause-howto").addEventListener("click", () => openDialog($("#howto-dialog"), "pause"));
$("#btn-pause-settings").addEventListener("click", () => openDialog($("#settings-dialog"), "pause"));
$("#btn-howto").addEventListener("click", () => openDialog($("#howto-dialog"), null));
$("#btn-settings").addEventListener("click", () => openDialog($("#settings-dialog"), null));
$("#btn-about").addEventListener("click", () => openDialog($("#about-dialog"), null));
$("#btn-howto-close").addEventListener("click", closeDialog);
$("#btn-settings-close").addEventListener("click", closeDialog);
$("#btn-about-close").addEventListener("click", closeDialog);
for (const d of document.querySelectorAll("dialog")) {
  d.addEventListener("cancel", (e) => { e.preventDefault(); if (d.dataset.sheet === "pause") resume(); else closeDialog(); });
}

function goToMenu() {
  stopClock();
  bumpGeneration();
  G.mode = null;
  G.paused = false;
  // "‹ Menu" deliberately returns to start with a "Continue" option (spec §2 "Menu mid-board") rather than
  // resuming straight back in -- that direct-resume behaviour is reserved for a real page reload.
  S.active = null;
  persist();
  showScreen("start");
  renderStart();
}

// ---------- settings wiring ----------
$("#toggle-sound").checked = S.settings.sound;
$("#toggle-sound").addEventListener("change", (e) => { S.settings.sound = e.target.checked; persist(); });
$("#toggle-autox").checked = S.settings.autoX;
$("#toggle-autox").addEventListener("change", (e) => {
  S.settings.autoX = e.target.checked;
  persist();
  if (G.screen === "play" && G.boardState) render.drawBoard(els.boardEl, G.board, G.boardState, S.settings.autoX);
});
for (const r of document.querySelectorAll('input[name="motion"]')) {
  r.checked = r.value === S.settings.motion;
  r.addEventListener("change", () => { if (r.checked) { S.settings.motion = r.value; persist(); applyMotion(); } });
}
const reduceMediaQuery = matchMedia("(prefers-reduced-motion: reduce)");
function applyMotion() {
  const resolved = S.settings.motion === "os" ? (reduceMediaQuery.matches ? "reduce" : "full") : S.settings.motion;
  document.documentElement.dataset.motion = resolved;
}
reduceMediaQuery.addEventListener("change", () => { if (S.settings.motion === "os") applyMotion(); });
applyMotion();

// ---------- how-to (static 4-panel list, no pager per DESIGN.md §1.7/§1.8) ----------
// Captions come from theme.js text.howto (review fix 4) and are set via textContent -- only the drawn
// PETAL_ART figure markup ever goes through innerHTML.
function renderHowto() {
  const A = window.PETAL_ART || {};
  const captions = themeText().howto || ["One per row and column.", "One ladybug in every bed.", "Ladybugs never touch.", "Tap twice. Wrong costs a petal."];
  const list = $("#howto-list");
  list.innerHTML = "";
  captions.forEach((caption, i) => {
    const li = document.createElement("li");
    li.className = "howto-step";
    li.dataset.step = String(i + 1);
    const figure = document.createElement("figure");
    figure.innerHTML = (A.howto && A.howto[i]) || "";
    const figcaption = document.createElement("figcaption");
    figcaption.textContent = caption;
    figure.appendChild(figcaption);
    li.appendChild(figure);
    list.appendChild(li);
  });
}
renderHowto();

// ---------- static art glyphs (chips, icon buttons, tools) -- inserted once, all from PETAL_ART ----------
function renderStaticArt() {
  const A = window.PETAL_ART || {};
  for (const chip of document.querySelectorAll(".chip[data-rule]")) {
    const glyph = A.chip && A.chip[chip.dataset.rule];
    if (glyph) chip.insertAdjacentHTML("afterbegin", glyph);
  }
  const iconFor = { "#btn-pause": "pause", "#btn-howto-close": "close", "#btn-settings-close": "close", "#btn-about-close": "close" };
  for (const [sel, key] of Object.entries(iconFor)) { const el = $(sel); if (el && A.icon && A.icon[key]) el.innerHTML = A.icon[key]; }
  const toolIconFor = { "#btn-undo": "undo", "#btn-hint": "hint", "#btn-clearx": "clear" };
  for (const [sel, key] of Object.entries(toolIconFor)) {
    const el = $(sel);
    if (el && A.icon && A.icon[key]) el.insertAdjacentHTML("afterbegin", A.icon[key]);
  }
}
renderStaticArt();

// ---------- pause / tab-away (spec §2) ----------
document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
window.addEventListener("blur", () => pause());

// ---------- start screen meta ----------
function renderStart() {
  const date = nowDate();
  const d = run.daysSinceEpoch(date);
  const no = run.dailyNo(d);
  $("#masthead-date").textContent = date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  $("#masthead-no").textContent = `No. ${no}`;
  const key = run.dailyDateKey(date);
  const entry = S.daily[key];
  const dailyBoard = decodeBoard(pack.daily[run.dailyBoardIndex(d)]);
  $("#daily-note").textContent = `${dailyBoard.n}×${dailyBoard.n}${dailyBoard.par ? ` · par ${run.formatTime(dailyBoard.par * 1000)}` : ""}`;
  $("#daily-label").textContent = entry && entry.done ? "See today's clipping" : entry ? "Continue today's garden" : "Play today's garden";
  $("#run-label").textContent = S.run ? `Continue run · board ${S.run.boardNo}` : "Start a run";
  $("#run-note").textContent = `best ${S.best.boards} boards`;
  if (!S.firstRunDone) { bodyState("demo"); runDemo(els.heroEl, timers); }
  else {
    stopDemo();
    bodyState("start");
    const d2 = decodeBoard(pack.daily[run.dailyBoardIndex(d)]);
    els.heroEl.innerHTML = "";
    const boardDiv = document.createElement("div");
    boardDiv.className = "board board--hero";
    els.heroEl.appendChild(boardDiv);
    render.buildBoard(boardDiv, d2);
    render.drawBoard(boardDiv, d2, model.initState(d2));
  }
}

// ---------- boot ----------
// spec §2 "Reload mid-board": a reload with a live run or daily opens directly on that board, paused --
// unlike "‹ Menu", which deliberately returns to the start screen with a "Continue" option instead.
function boot() {
  applyMotion();
  if (window.UIKit && window.UIKit.applyTheme) window.UIKit.applyTheme(window.THEME);
  if (S.active === "run" && S.run) { startRun(false); return; }
  if (S.active === "daily") { startDaily(); return; }
  showScreen("start");
  renderStart();
}
boot();

// ---------- test hook (design.md "Test hook") ----------
window.__petalPatch = {
  pack,
  state: () => ({ screen: G.screen, mode: G.mode, board: G.board, boardState: G.boardState, overlay: G.boardOverlay, paused: G.paused, save: S, runBoardNo: G.runBoardNo, runStars: G.runStars }),
  screen: () => G.screen,
  loadBoard(kind, idOrIdx) {
    const list = kind === "P" ? pack.practice : kind === "daily" ? pack.daily : pack.endless[kind];
    const rec = typeof idOrIdx === "number" ? list[idOrIdx] : list.find((b) => b.id === idOrIdx);
    const board = decodeBoard(rec);
    G.mode = "practice-first";
    loadBoardIntoPlay(board, model.initState(board, { practice: false, hints: 3 }), { label: "Test", mode: "practice" });
  },
  // Starts a fresh run directly (bypassing the first-ever-play practice gate and any live save), seeded
  // for QA's engagement probes (spec §10 §B: "same seed set across policies and cadences").
  startSeededRun(seed) {
    S.firstRunDone = true;
    S.run = null;
    G.runSeed = seed >>> 0;
    G.runBoardNo = 1;
    G.runPoolState = {};
    G.runStars = 0;
    advanceRunBoard();
  },
  // Advances past the clear-hold/wilt overlay programmatically (the real UI waits for a button click).
  next: onNext,
  newRun: () => startRun(true),
  tap(r, c) { dispatch({ type: "tap", cell: rules.idx(r, c, G.board.n) }); },
  place(r, c) { dispatch({ type: "place", cell: rules.idx(r, c, G.board.n) }); },
  toggleX(r, c) { dispatch({ type: "toggleX", cell: rules.idx(r, c, G.board.n) }); },
  stroke(cellsRC, mode) {
    cellsRC.forEach(([r, c], i) => dispatch({ type: "stroke", cells: [rules.idx(r, c, G.board.n)], mode, continue: i > 0 }));
  },
  key(k) {
    if (k === "z" || k === "Z") return doUndo();
    if (k === "h" || k === "H") return doHint();
    if (k === "Escape") return dispatch({ type: "pause" });
    kb.setFocus(kb.getFocus());
  },
  hintStep: () => computeHintStep(),
  solverStep: () => {
    const dead = new Set([...rules.autoX(G.boardState.bugs, G.board.n, G.board.beds), ...G.boardState.marks]);
    return solver.nextStep(G.board.n, G.board.beds, G.boardState.bugs, dead);
  },
  undo: doUndo,
  hint: doHint,
  clearX: doClearX,
  petalsRemaining: () => G.boardState.petals,
  boardsCleared: () => G.runBoardNo - 1,
  // A bare "YYYY-MM-DD" parses as UTC midnight in the Date constructor, which is the previous local day
  // in any timezone behind UTC -- exactly the studio's recurring daily-date bug, so this hook must not
  // reintroduce it. Parsed as local y/m/d instead, matching run.mjs's own dailyDateKey/daysSinceEpoch.
  setDate(key) {
    if (!key) { dateOverride = null; return; }
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    dateOverride = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(key);
  },
  setNow(ms) { if (G.boardState) { G.boardState = model.setElapsed(G.boardState, ms); render.renderClock(els.clockEl, ms); } },
  save: () => { persist(); return S; },
  load(obj) { window.localStorage.setItem(save.SAVE_KEY, JSON.stringify(obj)); S = save.load(window.localStorage); boot(); },
  reset() { window.localStorage.removeItem(save.SAVE_KEY); S = save.load(window.localStorage); G.mode = null; goToMenu(); },
};
