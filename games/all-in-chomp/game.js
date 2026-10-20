// rAF loop, fixed 60Hz accumulator (capped at 5 steps a frame), DOM HUD, keys + the stick, window.__sim. S1:
// no deal screen yet (that's S5) - the deal happens instantly and play starts right away. Thin.
import { createRun, input, step, hash as simHash, levelSnapshot, resumeLevel, mazeKeyForLevel, BONUS_SPOT } from "./sim.js";
import { createRenderer, BEHAVIOUR_KEY } from "./render.js";
import * as R from "./recipe.js";
import { attachKeyboard, attachStick } from "./input.js";
import { createSave } from "./save.js";
import { nextChomper, dealGhosts, dealNightly, nightlySeed, nightNumber, localDateString, REGULARS } from "./deal.js";
import { shareText } from "./share.js";
import { createAudio } from "./audio.js";
import { mulberry32 } from "./rng.js";
import { createRot } from "./rot.js";

// Review flags (2026-10-19): ?play=1[&steps=N] deals a table straight away (no title, deal or hint) and steps
// it N frames, for screenshots; ?rot=0 no brain-rot moments; ?rotshow=sweep|clear|joker|bust[&rt=<s>] deals a
// table and plays a moment on it (held at rt s); ?fx=0 no WebGL layer; ?q=1..3 a fixed fx quality.
const QS = new URLSearchParams(location.search);
const ROT_ON = QS.get("rot") !== "0";
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
let rot = null; // the brain-rot moments (rot.js), null with ?rot=0
const rotFaceCache = {};
// The fx layer (fx.js, 2026-10-19): null until loaded after the title, and again when off (?fx=0) or failed.
let fx = null;
let fxLoading = false;
async function loadFx() {
  if (fx || fxLoading || QS.get("fx") === "0") return;
  fxLoading = true;
  try {
    const { createFx } = await import("./fx.js");
    fx = createFx(document.getElementById("chomp-fx"), document.getElementById("chomp-canvas"), {
      reduced: reducedMotion, quality: QS.get("q"), onFail: dropFx, onQuality: () => resize() });
    document.getElementById("chomp-fx").hidden = false;
    resize();
  } catch (err) {
    console.warn("fx layer off:", err);
    dropFx();
  }
  fxLoading = false;
}
function dropFx() {
  if (fx) fx.dispose();
  fx = null;
  document.getElementById("chomp-fx").hidden = true;
  document.getElementById("chomp-canvas").style.opacity = "";
  resize();
}

// Re-skin config (Game Standard v2 §2.5, spec §8): theme.js is a classic script loaded before this module,
// so window.THEME already exists by the time this runs.
const THEME = window.THEME;
const TEXT = THEME.text;
// The dealer's 23 lines (spec §3), 1-indexed to match talk.js's DEALER_EVENT_LINES numbers.
const DEALER_LINES = THEME.dealerLines;

// Fills `{key}` placeholders in a theme string, e.g. format(TEXT.round, { n: 3 }) -> "סיבוב 3".
function format(str, vars) {
  return str.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

const STEP_MS = 1000 / 60;
const MAX_STEPS_PER_FRAME = 5;

let run = null;
let renderer = null;
let rawImages = {}; // { [id]: { normal: Image, closed: Image|null } }, recipe.js's buildHeadSprites input
let tokens = null; // recipe.js's readTokens() result, read once (tokens.css custom properties)
let themeImages = {}; // { [slot]: Image }, loaded THEME.images - only the slots actually set in theme.js
let tile = 32;
let paused = false;
let lastFrameTime = null;
let acc = 0;
let save = null;
let facesById = {};
let bestSaved = false;
let runWasFirstRun = false;
let firstRunMarked = false;
let overHandled = false;
let snapshotRngAtLevelStart = null;

let dealing = false;
let dealStartTime = 0;
let dealDurationMs = 2000;
let hintShowing = false;
let portraitBlocking = false;
let titleShowing = false; // the title shell (THE-705): shown on a fresh boot (no run to resume), and again
// from pause's "לשולחן הראשי" - run is null throughout, so the loop skips every run-dependent step.
let audio = null;
let prevChipsEaten = 0;
let prevAllInCount = 0;
let prevJoker = false; // last frame's held joker (the snap on take, the shout on spend)
let prevLevel = 0; // last frame's level (the level chip bumps on a change)
let clearShowRendered = false;
let prevPhase = null;
let prevRebuyLeft = []; // per ghost slot, last frame's rebuyLeft (the rebuy shout fires on the 1 -> 0 edge)

// .aic-scrim and .aic-turn (skin.css) each set their own `display`, which - tied on specificity with the
// browser's built-in [hidden] rule and coming later in source order - wins over it; toggling only the
// `hidden` attribute leaves them visibly stacked instead of hidden. Set the inline style explicitly too.
function setHidden(el, hidden) {
  el.hidden = hidden;
  el.style.display = hidden ? "none" : "";
}

// Portrait (spec §6): the "turn your phone" screen, touch devices only, game time frozen. Resumes within
// 1s of rotating back via the resize/orientationchange listeners already wired to checkPortrait().
function isTouchDevice() {
  return window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
}

// Android (board, 2026-10-17): outside the installed app the browser's URL bar eats ~56 px of a landscape
// phone. A user gesture may ask for fullscreen, then lock landscape. iPhone Safari rejects the first call and
// nothing changes there; every rejection (and a synchronous throw on old engines) is swallowed. The
// fullscreen change fires resize(), which re-lays out the maze.
function requestPhoneFullscreen() {
  if (!isTouchDevice() || !document.fullscreenEnabled || document.fullscreenElement) return;
  if (window.matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches) return;
  Promise.resolve()
    .then(() => document.documentElement.requestFullscreen({ navigationUI: "hide" }))
    .then(() => (screen.orientation && screen.orientation.lock ? screen.orientation.lock("landscape") : null))
    .catch(() => {});
}
function checkPortrait() {
  const el = document.getElementById("chomp-portrait");
  portraitBlocking = isTouchDevice() && window.innerHeight > window.innerWidth;
  setHidden(el, !portraitBlocking);
}

// The little rotating phone on the "turn your phone" screen (screens.html's turn()): static art, CSS does
// the rotation animation (skin.css's @keyframes aic-turn), so this draws once at boot.
function drawPortraitIcon() {
  const c = document.getElementById("chomp-portrait-canvas");
  const dpr = window.devicePixelRatio || 1;
  c.width = 140 * dpr;
  c.height = 140 * dpr;
  const g = c.getContext("2d");
  g.scale(dpr, dpr);
  g.translate(70, 70);
  g.fillStyle = tokens.cream;
  g.strokeStyle = tokens.ink;
  g.lineWidth = 3;
  g.beginPath();
  g.roundRect(-30, -52, 60, 104, 10);
  g.fill();
  g.stroke();
  g.fillStyle = tokens.baize;
  g.fillRect(-23, -42, 46, 80);
  R.allIn(g, 0, -2, 26, tokens, 0);
}

function todayDate() {
  return localDateString();
}

function randomSeed() {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

let stageOx = 0;
let stageOy = 0;
let sprites = {};
const spriteCache = {};

// Built once per headPx (cached in spriteCache so the title table and the in-game HUD can each ask for their
// own size without rebuilding): the title screen needs faces before any run (and its maze/tile) exists.
function getSprite(id, headPx) {
  const dpr = window.devicePixelRatio || 1;
  const cacheKey = `${id}:${headPx}`;
  if (!spriteCache[cacheKey]) {
    const face = facesById[id];
    const imgs = rawImages[id];
    if (face && imgs) spriteCache[cacheKey] = R.buildHeadSprites(face, imgs, headPx, tokens, dpr);
  }
  return spriteCache[cacheKey];
}
function updateSpriteCache() {
  const dpr = window.devicePixelRatio || 1;
  const headPx = Math.round(tile * 1.9 * dpr);
  for (const id of Object.keys(facesById)) {
    const sp = getSprite(id, headPx);
    if (sp) sprites[id] = sp;
  }
}

const EDGE_PAD = 6; // px between the maze and the screen edge (beyond the safe-area insets)

function safeInsets() {
  const s = getComputedStyle(document.getElementById("chomp-inset-probe"));
  const px = (v) => Math.max(0, parseFloat(v) || 0);
  return { top: px(s.paddingTop), right: px(s.paddingRight), bottom: px(s.paddingBottom), left: px(s.paddingLeft) };
}

// Board, 2026-10-17 (replaces spec §6's 85 % rule): the maze fills the height minus the safe-area insets and
// EDGE_PAD on each edge; the width budget keeps 56 px a side for the HUD, capped at T 40. data-gutter is
// "wide" when the smaller usable gutter (past the inset on that side) is >= 100 px, else "narrow" (664x390
// class). No-ops while on the title screen (run is null - nothing to lay out yet).
function resize() {
  if (!run) return;
  const canvas = document.getElementById("chomp-canvas");
  const maze = run.maze;
  const W = window.innerWidth, H = window.innerHeight;
  const inset = safeInsets();
  const byHeight = Math.floor((H - inset.top - inset.bottom - 2 * EDGE_PAD) / maze.h);
  const byWidth = Math.floor((W - inset.left - inset.right - 112) / maze.w);
  tile = Math.max(16, Math.min(byHeight, byWidth, 40));
  const mw = maze.w * tile, mh = maze.h * tile;
  stageOx = Math.round((W - mw) / 2);
  stageOy = Math.round((H - mh) / 2);
  const usableGutter = Math.min(stageOx - inset.left, stageOx - inset.right);
  document.getElementById("chomp-app").dataset.gutter = usableGutter >= 100 ? "wide" : "narrow";

  // with the fx layer on, its quality sets the 2D canvas's resolution (the canvas is its texture, uploaded each frame)
  const dpr = fx ? fx.dpr() : window.devicePixelRatio || 1;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (fx) fx.resize(W, H);

  const stage = document.getElementById("chomp-stage");
  stage.style.left = "0";
  stage.style.top = "0";
  stage.style.width = `${W}px`;
  stage.style.height = `${H}px`;
  const gutterStart = document.getElementById("chomp-gutter-start");
  const gutterEnd = document.getElementById("chomp-gutter-end");
  gutterStart.style.width = `${stageOx}px`;
  gutterEnd.style.width = `${stageOx}px`;
  const over = document.getElementById("chomp-over");
  over.style.left = `${stageOx}px`;
  over.style.top = `${stageOy}px`;
  over.style.width = `${mw}px`;
  over.style.height = `${mh}px`;

  updateSpriteCache();
}

// Audio cues are detected by diffing against the previous frame rather than consuming sim.js's talk
// candidates directly (those are already claimed/prioritised for the talk bubble; a cue should fire
// whenever the underlying event actually happened, independent of whether talk had a free slot for it).
function updateAudioCues() {
  if (run.chipsEatenLevel > prevChipsEaten) audio.chip();
  prevChipsEaten = run.chipsEatenLevel;
  if (run.allInEaten.size > prevAllInCount) audio.allin();
  prevAllInCount = run.allInEaten.size;
  if (run.joker && !prevJoker) audio.cardGrab(); // the joker card snaps into the hand
  if (!run.joker && prevJoker && run.phase === "play" && !rot) showJokerSpent(); // spent on a catch, play went on (with rot on, the joker moment covers it)
  prevJoker = run.joker;
  if (run.phase === "eatFreeze" && prevPhase !== "eatFreeze") audio.foldEaten();
  if (run.phase === "dying" && prevPhase !== "dying") audio.caught();
  if (run.phase === "clear" && prevPhase !== "clear") audio.handBeat(false); // the clear chord
  prevPhase = run.phase;
}

// The rebuy shout (board, 2026-10-17): the step a seated chaser's wait hits 0 it is back out through the
// door, and the dealer shouts "{name} חזר למשחק!" over the door tile. Detected by diffing the previous
// frame's rebuyLeft per ghost, like updateAudioCues, so it fires once per return.
// A face for the moments (rot.js): the inked head at moment size, its closed frame, and the eye and hat points
// as fractions of the canvas (shades, X eyes, the hat).
function rotFace(id) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const hPx = Math.round(Math.min(window.innerHeight * 0.5, 420) * dpr);
  const key = `${id}:${hPx}`;
  if (rotFaceCache[key]) return rotFaceCache[key];
  const face = facesById[id], imgs = rawImages[id];
  if (!face || !imgs) return null;
  const line = Math.max(2, hPx / 30);
  const lv = R.levelFace(face, imgs.normal);
  const cv = R.inkHead(lv.img, hPx, tokens, { line });
  const closed = imgs.closed ? R.inkHead(R.levelFace(face, imgs.closed).img, hPx, tokens, { line }) : null;
  const at = (p) => [(cv.pad + p[0] * cv.scale) / cv.width, (cv.pad + p[1] * cv.scale) / cv.height];
  const eyeL = at(lv.eyeL), eyeR = at(lv.eyeR);
  const hat = [(eyeL[0] + eyeR[0]) / 2, cv.pad / cv.height + 0.12];
  return (rotFaceCache[key] = { cv, closed, eyeL, eyeR, hat });
}
const screenOf = (u, v) => [stageOx + (u / 240) * tile, stageOy + (v / 240) * tile];
const nameOf = (id) => facesById[id]?.name_he || id;

// The fx layer's per-frame picture of the table (CSS px): chips, ALL IN halos, the felt joker, the held joker,
// the lamp on the chomper, and the bust moment's grey.
function fxFrame(now, dtMs) {
  if (!fx || !run) return;
  const T = tile, ox = stageOx, oy = stageOy, chips = [], allIns = [];
  for (let y = 0; y < run.maze.h; y++) {
    for (let x = 0; x < run.maze.w; x++) {
      const ch = run.maze.at(x, y);
      if (ch !== "." && ch !== "o") continue;
      const key = `${x},${y}`;
      if (ch === "." ? run.eaten.has(key) : run.allInEaten.has(key)) continue;
      (ch === "." ? chips : allIns).push(ox + (x + 0.5) * T, oy + (y + 0.5) * T);
    }
  }
  const [px, py] = screenOf(run.player.x, run.player.y);
  const jokerFelt = run.jokerSlot ? [ox + (BONUS_SPOT.x + 0.5) * T, oy + (BONUS_SPOT.y + 0.5) * T] : null;
  fx.frame({ now, dt: dtMs / 1000, T, chips, allIns, jokerFelt, held: run.joker ? [px, py] : null, lamp: [px, py], gray: rot ? rot.gray() : 0 });
  const canvas2d = document.getElementById("chomp-canvas");
  if (fx && canvas2d.style.opacity !== "0") canvas2d.style.opacity = "0"; // the first fx frame is up: it shows the table now
}

// One fx burst at a screen point; a chaser's chips in its behaviour colour, confetti in this table's colours.
function fxBurst(type, at, who = null) {
  if (!fx || !run) return;
  const g = who ? run.ghosts.find((gh) => gh.id === who) : null;
  const color = g ? tokens.behaviour[BEHAVIOUR_KEY[g.behaviour]] : tokens.marigold;
  const looks = THEME.levelLooks || [];
  const look = looks.length ? Object.values(looks[(run.level - 1) % looks.length] || {}).filter((v) => /^#/.test(v)) : [];
  fx.burst(type, at[0], at[1], { T: tile, color, look });
}

// The sim's cosmetic events (2026-10-19), drained once per frame after the HUD update: the joker pops, the
// moments (rot.js) and the fx layer.
function drainEvents() {
  if (!run.events.length) return;
  const events = run.events.splice(0);
  for (const e of events) {
    const at = screenOf(e.x, e.y);
    // the level clear's confetti waits for the clear moment to end (it would fall behind the rays), so it lands on
    // the new table
    if (fx && ["chip", "allin", "eat", "caught", "jokerTaken"].includes(e.type)) fxBurst(e.type, at, e.who);
    else if (fx && e.type === "clear" && !rot) fxBurst("clear", at);
    if (e.type === "jokerTaken") showJokerGot();
    else if (e.type === "sweep") {
      if (rot && !rot.active()) {
        const others = run.ghostIds.map(rotFace).filter(Boolean);
        rot.sweep({ you: rotFace(run.chomper), others, from: at, toHead: at, prize: e.prize, top: TEXT.rotSweep,
          bottom: TEXT.rotSweepPoints, bottomPrize: e.prize === "joker" ? TEXT.rotSweepJoker : TEXT.rotSweepBonus },
          () => { if (e.prize === "joker") showJokerGot(); });
      } else if (e.prize === "joker") showJokerGot();
    } else if (e.type === "jokerSaved") {
      if (rot) rot.joker({ you: rotFace(run.chomper), catcher: rotFace(e.who), from: at, top: TEXT.rotJoker, bottom: format(TEXT.rotJokerMissed, { name: nameOf(e.who) }) });
    } else if (e.type === "bust") {
      if (rot) rot.bust({ you: rotFace(run.chomper), catcher: rotFace(e.who), from: at, bottom: format(TEXT.rotBust, { name: nameOf(run.chomper) }) });
    } else if (e.type === "clear") {
      if (rot) {
        // rays in the NEXT table's colours (run.level is still the cleared level here)
        const looks = THEME.levelLooks || [], next = run.level + 1;
        const look = looks.length ? looks[(next - 1) % looks.length] || {} : {};
        const k = mazeKeyForLevel(next) === "A" ? "baize" : "wood";
        rot.clear({ you: rotFace(run.chomper), rays: [look[`${k}-hi`] || tokens[`${k}-hi`], look[`${k}-lo`] || tokens[`${k}-lo`]], from: at },
          () => fxBurst("clear", at));
      }
    }
  }
}

function updateRebuyShouts() {
  run.ghosts.forEach((g, i) => {
    if (prevRebuyLeft[i] > 0 && g.rebuyLeft === 0 && g.active) showBackInGame(run.ghostIds[i]);
    prevRebuyLeft[i] = g.rebuyLeft;
  });
}

// A shout over the maze at (x, y) maze px (.aic-pop--shout, 900 ms): the rebuy return, the joker.
function shoutAt(text, x, y) {
  const pop = document.createElement("div");
  pop.className = "aic-pop aic-pop--shout";
  pop.textContent = text;
  // .aic-pop centres itself with translate(50%, -50%) (its keyframes animate that translate too), so it is
  // placed from the right edge of .aic-over, which is the maze rect.
  pop.style.right = `${run.maze.w * tile - x}px`;
  pop.style.top = `${y}px`;
  document.getElementById("chomp-over").appendChild(pop);
  setTimeout(() => pop.remove(), 900);
}

function showBackInGame(id) {
  shoutAt(format(TEXT.backInGame, { name: facesById[id]?.name_he || id }), (run.maze.door.x + 0.5) * tile, (run.maze.door.y + 0.5) * tile);
}

// The joker was spent on a catch (board 2026-10-17): a shout over the chomper, same pop as the rebuy shout.
function showJokerSpent() {
  shoutAt(TEXT.jokerShout, (run.player.x / 240) * tile, (run.player.y / 240) * tile);
}

// A joker was taken, from the felt or as the sweep's prize (2026-10-19): "יש לך ג׳וקר!" over the chomper
// and a card flying from the chomper into the HUD slot.
function showJokerGot() {
  const x = (run.player.x / 240) * tile, y = (run.player.y / 240) * tile;
  shoutAt(TEXT.jokerGot, x, y - tile);
  const card = document.createElement("div");
  card.className = "aic-flycard";
  const sx = stageOx + x, sy = stageOy + y;
  card.style.left = `${sx}px`;
  card.style.top = `${sy}px`;
  document.getElementById("chomp-app").appendChild(card);
  const slot = document.getElementById("chomp-joker").getBoundingClientRect();
  const tx = slot.width ? slot.left + slot.width / 2 : sx, ty = slot.height ? slot.top + slot.height / 2 : sy;
  requestAnimationFrame(() => {
    card.style.transform = `translate(${tx - sx}px, ${ty - sy}px) scale(1.4)`;
    card.style.opacity = "0";
  });
  setTimeout(() => card.remove(), 600);
}

// The level-clear show (board 2026-10-17): shown for the whole `clear` phase (CLEAR_STEPS, 2 s), driven by
// run.phase like every other screen. Toggling `hidden` restarts the slam and the card flip each time.
function updateClearShow() {
  const el = document.getElementById("chomp-clearshow");
  const show = run.phase === "clear";
  el.hidden = !show;
  el.classList.toggle("aic-clearshow--rot", !!rot);
  if (!show) {
    clearShowRendered = false;
    return;
  }
  if (clearShowRendered) return;
  clearShowRendered = true;
  document.getElementById("chomp-clear-shout").textContent = TEXT.clearShout;
  document.getElementById("chomp-clear-round").textContent = format(TEXT.round, { n: run.level + 1 });
  document.getElementById("chomp-clear-next").textContent = TEXT.clearNext;
}

// The bests sheet (board 2026-10-17, in place of the hand book): the best score per dealt face, highest
// first, faces that never scored last.
function renderBests() {
  const list = document.getElementById("chomp-bests-list");
  list.innerHTML = "";
  const rows = REGULARS.map((id) => ({ id, score: save.best(id) })).sort((a, b) => b.score - a.score);
  for (const { id, score } of rows) {
    const p = document.createElement("p");
    const name = document.createElement("b");
    name.textContent = facesById[id]?.name_he || id;
    p.append(name, " — ", score > 0 ? String(score) : TEXT.bestsEmpty);
    list.appendChild(p);
  }
}

// A mini inked head on a small canvas (talk, spectators) - recipe.js's drawSprite onto a dpr-scaled canvas.
function miniHead(id, w, h, closed = false) {
  const c = document.createElement("canvas");
  const dpr = window.devicePixelRatio || 1;
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  c.className = "aic-mini";
  c.style.width = `${w}px`;
  c.style.height = `${h}px`;
  const g = c.getContext("2d");
  g.scale(dpr, dpr);
  const sp = sprites[id];
  if (sp) R.drawSprite(g, (closed && sp.closed) || sp.normal, w / 2, h / 2);
  return c;
}

function updateStacks() {
  const stacks = document.getElementById("chomp-stacks");
  const n = Math.max(0, run.buyIns);
  if (stacks.childElementCount !== n) {
    stacks.innerHTML = "";
    for (let i = 0; i < n; i++) stacks.appendChild(document.createElement("i"));
  }
}

// A comic bubble: <span class="aic-bubble__who">name</span>text. Built with createElement/textContent, not
// innerHTML, since name/text come from facesById/DEALER_LINES - dynamic content, even if not exploitable
// today (the sanitiser already checks ids against REGULARS), per the review rule against innerHTML with
// dynamic text.
function bubbleEl(name, text, dealer = false) {
  const bubble = document.createElement("div");
  bubble.className = dealer ? "aic-bubble aic-bubble--dealer" : "aic-bubble";
  const who = document.createElement("span");
  who.className = "aic-bubble__who";
  who.textContent = name;
  bubble.append(who, document.createTextNode(text));
  return bubble;
}

// The line on screen (gutter mode, speaker, line), null for none, undefined until the first sync of a run. The
// bubble is built when this changes, not every frame: a fresh bubble restarts its pop-in, and rebuilt every
// frame it never got past the first, invisible keyframe ("the words blink and flash", Nir's phone 2026-10-20;
// reduced motion hid it on desktop).
let talkShown;

function updateTalk() {
  const talkEl = document.getElementById("chomp-talk");
  const bandEl = document.getElementById("chomp-band");
  const wide = document.getElementById("chomp-app").dataset.gutter === "wide";
  const key = run.talk.active ? `${wide}|${run.talk.active.speaker}|${run.talk.active.line}` : null;
  if (key === talkShown) return;
  talkShown = key;
  const target = wide ? talkEl : bandEl;
  const other = wide ? bandEl : talkEl;
  other.hidden = true;
  other.innerHTML = "";
  if (!run.talk.active) {
    target.hidden = true;
    target.innerHTML = "";
    return;
  }
  const { speaker, line } = run.talk.active;
  const isDealer = speaker === "dealer";
  // Dealer line 22 ("ערב No.{N}. ...", talk.js's nightlyStart) is the one line with a placeholder.
  const text = isDealer ? format(DEALER_LINES[line], { N: run.nightNumber }) : facesById[speaker]?.lines_he[line] || "";
  const name = isDealer ? TEXT.dealerName : facesById[speaker]?.name_he || speaker;
  target.hidden = false;
  target.innerHTML = "";
  if (!isDealer) target.appendChild(miniHead(speaker, wide ? 54 : 30, wide ? 58 : 32));
  target.appendChild(bubbleEl(name, text, isDealer));
}

// The catcher on game over (screens.html's over(): R.drawGhost on a chip stack in their own behaviour
// colour, not a bare head - THE-713 D2-F).
function drawCatcher(canvas, id, behaviour) {
  const dpr = window.devicePixelRatio || 1;
  const w = 150, h = 150;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const g = canvas.getContext("2d");
  g.scale(dpr, dpr);
  // screens.html's over(): sprites(catcher, 96) at T=64 - matching those two numbers (not just the 150x150
  // canvas) is what keeps the head inside the canvas; a bigger headPx with the same T overflows the top
  // (THE-713 CTO review r1: the head was clipped at the canvas edge).
  const sp = getSprite(id, Math.round(96 * dpr));
  if (sp) R.drawGhost(g, sp, 75, 88, 64, tokens, tokens.behaviour[BEHAVIOUR_KEY[behaviour]], { t: 0.02 });
}

let gameOverRendered = false;

function updateGameOverScreen() {
  const screen = document.getElementById("chomp-gameover");
  const showOver = run.phase === "over" && !(rot && rot.active()); // the bust moment plays out first (2026-10-19)
  screen.hidden = !showOver;
  if (!showOver) {
    gameOverRendered = false;
    return;
  }
  if (gameOverRendered) return; // static content - no need to rebuild every frame
  gameOverRendered = true;
  document.getElementById("chomp-over-title").textContent = TEXT.gameOver;
  document.getElementById("chomp-over-score").textContent = String(run.score);
  const best = save.best(run.chomper);
  const bestEl = document.getElementById("chomp-over-best");
  bestEl.textContent = format(TEXT.best, { name: facesById[run.chomper]?.name_he || run.chomper, score: best });
  bestEl.classList.toggle("is-new", run.score > 0 && run.score >= best);
  document.getElementById("chomp-over-level").textContent = format(TEXT.reachedLevel, { n: run.level });

  const catcherEl = document.getElementById("chomp-over-catcher");
  catcherEl.innerHTML = "";
  if (run.lastCatcherId) {
    const catcherGhost = run.ghosts.find((g) => g.id === run.lastCatcherId);
    const canvas = document.createElement("canvas");
    catcherEl.appendChild(canvas);
    drawCatcher(canvas, run.lastCatcherId, catcherGhost ? catcherGhost.behaviour : "direct");
    const line = facesById[run.lastCatcherId]?.lines_he[0] || "";
    const name = facesById[run.lastCatcherId]?.name_he || run.lastCatcherId;
    const bubble = bubbleEl(name, line);
    bubble.style.marginTop = "6px";
    catcherEl.appendChild(bubble);
  }
  const bagEl = document.createElement("div");
  bagEl.className = "aic-bagrow";
  let playedCount = 0;
  for (const id of REGULARS) {
    const b = save.best(id);
    if (b > 0) playedCount += 1;
    const fig = document.createElement("figure");
    if (b > 0) fig.classList.add("is-lit");
    fig.appendChild(miniHead(id, 34, 37));
    const cap = document.createElement("figcaption");
    cap.textContent = b > 0 ? String(b) : "—";
    fig.appendChild(cap);
    bagEl.appendChild(fig);
  }
  catcherEl.appendChild(bagEl);
  const countEl = document.createElement("div");
  countEl.className = "aic-bagrow__count";
  countEl.textContent = format(TEXT.playedCount, { k: playedCount, n: REGULARS.length });
  catcherEl.appendChild(countEl);
}

function updateHud() {
  const scoreEl = document.getElementById("chomp-score");
  if (scoreEl.textContent !== String(run.score)) scoreEl.textContent = String(run.score);
  // The level chip (board 2026-10-17): the number, with a bump when the level changes mid-run.
  const roundN = document.getElementById("chomp-round-n");
  if (roundN.textContent !== String(run.level)) {
    roundN.textContent = String(run.level);
    if (prevLevel && run.level !== prevLevel) {
      const chip = document.getElementById("chomp-round");
      chip.classList.remove("is-bump");
      void chip.offsetWidth; // restart the animation
      chip.classList.add("is-bump");
    }
  }
  prevLevel = run.level;
  document.getElementById("chomp-joker").hidden = !run.joker;
  updateStacks();
  updateTalk();
  updateRebuyShouts();
  if (run.phase === "over" && !bestSaved) {
    recordBest(run);
    bestSaved = true;
  }
  updateGameOverScreen();
  updateClearShow();
  if (run.phase === "over" && runWasFirstRun && !firstRunMarked) {
    save.markFirstRunDone();
    firstRunMarked = true;
  }
  // Mid-level reload: write the level-start snapshot once per level-start, not every frame (THE-690 #11: an
  // unconditional write here is ~60 localStorage writes/s). run.rngAtLevelStart changes exactly once per
  // level-start (sim.js) - not on a rebuy, which keeps the same level and the same banked rng/score/buyIns -
  // and levelSnapshot()'s content is otherwise stable for the whole level, so it's a cheap, reliable dedupe
  // key - unlike the old one-shot 'ready'-phase flag, which missed real updates whenever steps advanced
  // faster than renders (the __sim.step(n) hook, a slow device dropping frames), leaving the snapshot stale
  // or (right after boot) entirely unset.
  if (run.phase !== "over" && run.rngAtLevelStart !== snapshotRngAtLevelStart) {
    snapshotRngAtLevelStart = run.rngAtLevelStart;
    const snapshot = levelSnapshot(run);
    // A nightly snapshot needs its own date stamped (THE-690 r2 #4): without it, a snapshot from a previous
    // local day resumes today under today's date but yesterday's night number (boot() has no way to tell
    // it's stale), corrupting the share line. save.js's sanitiser now rejects a nightly snapshot missing
    // this field, and boot() drops one whose date isn't today's.
    if (run.nightly) snapshot.date = todayDate();
    save.saveRunSnapshot(snapshot);
  }
  const shareBtn = document.getElementById("chomp-share");
  if (run.phase === "over") {
    if (!overHandled) {
      overHandled = true;
      save.clearRunSnapshot();
      recordNightResult(run);
    }
  } else {
    overHandled = false;
  }
  shareBtn.hidden = !(run.phase === "over" && run.nightly);
  updateAudioCues();
}

// A face-down card slot in the deal layout (DESIGN.md §4/screens.html's deal()). Filled in by showDealSlot
// once its reveal time has passed; it owns its own mini head + name + role/you tag.
// Lays out 5 cards in a row (4 ghosts + the chomper's own, larger, last in reading order) centred on the
// screen - a simplified stand-in for screens.html's oval-table-and-fan layout (that one also draws a canvas
// table behind the cards; skipped here since this is a transient ~2s screen, not core gameplay).
function dealCardSlotPositions() {
  const W = window.innerWidth, H = window.innerHeight;
  const cw = Math.min(70, W * 0.08), gap = cw * 1.3, meScale = 1.3;
  const totalW = gap * 4 + cw * meScale;
  const x0 = (W - totalW) / 2 + cw / 2;
  const y = H * 0.5;
  return [0, 1, 2, 3].map((i) => ({ x: x0 + i * gap, y, w: cw })).concat([{ x: x0 + 4 * gap + (cw * meScale - cw) / 2, y, w: cw * meScale }]);
}

function dealCardSlot(dataSlot, pos) {
  const el = document.createElement("div");
  el.className = "aic-dealcard";
  el.dataset.slot = dataSlot;
  el.style.left = `${pos.x}px`;
  el.style.top = `${pos.y}px`;
  return el;
}

// The table geometry shared by the title screen and the deal screen (screens.html's title()/deal(): same
// oval formula, a slightly different vertical centre - title() uses 0.52, deal() 0.54).
function pokerTableGeometry(W, H, tyFrac) {
  return { tx: W / 2, ty: H * tyFrac, rx: Math.min(W * 0.36, 300), ry: Math.min(H * 0.33, 128) };
}

let dealCtx = null; // the deal screen's own canvas context, set by layoutDealTable(); null while not dealing

// The face card itself (screens.html's faceCard(), ported): a cream card, the behaviour-colour band at the
// foot, the head (the chomper's own card, jaw animated) clipped inside. Canvas, not DOM (DESIGN.md §4's "the
// 5 cards are canvas"), drawn onto the deal table canvas that layoutDealTable() already set up.
function drawDealFaceCard(g, id, x, y, w, band, rot, you) {
  const h = w * 1.4;
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.shadowColor = "rgba(0,0,0,.45)";
  g.shadowBlur = 10;
  g.shadowOffsetY = 4;
  g.fillStyle = tokens.cream;
  g.beginPath();
  g.roundRect(-w / 2, -h / 2, w, h, w * 0.1);
  g.fill();
  g.shadowColor = "transparent";
  g.strokeStyle = you ? tokens.marigold : tokens.ink;
  g.lineWidth = you ? 5 : 2.5;
  g.stroke();
  g.fillStyle = band;
  g.fillRect(-w / 2 + 4, h / 2 - h * 0.2, w - 8, h * 0.2 - 4);
  g.save();
  g.beginPath();
  g.roundRect(-w / 2 + 4, -h / 2 + 4, w - 8, h * 0.8 - 8, w * 0.06);
  g.clip();
  const dpr = window.devicePixelRatio || 1;
  const sp = getSprite(id, Math.round(h * 0.62 * dpr));
  if (sp) {
    if (you) R.drawChomper(g, sp, 0, -h * 0.02, (h * 0.62) / 1.9, { t: 1 / 24, moving: true });
    else R.drawSprite(g, sp.normal, 0, h * 0.3 - 6, 0.5, 1);
  }
  g.restore();
  g.restore();
}

// Rectangles the deal screen's own text already claims: the header + "the you" line (full width, top)
// and the chomper's own card + its talk bubble (startDealScreen() positions both from the same
// dealCardSlotPositions()). A seated spectator's head is ~70px tall anchored at its own (x, y) foot, so
// these are padded well past the text's own box rather than measuring rendered text width (THE-713 CTO
// review r1: a seat landed behind "the you" line, another under the chomper's bubble).
function dealExclusionZones(W, positions) {
  const me = positions[4];
  const cardH = me.w * 1.4;
  return [
    { x0: 0, x1: W, y0: 0, y1: 110 }, // "the dealer deals..." + "this time you're: <name>"
    { x0: me.x - me.w / 2 - 20, x1: me.x + me.w / 2 + 20, y0: me.y - cardH / 2 - 70, y1: me.y + cardH / 2 + 20 }, // the chomper's own card
    { x0: me.x - 130, x1: me.x + 130, y0: me.y + me.w * 0.95 - 20, y1: me.y + me.w * 0.95 + 110 }, // its talk bubble
  ];
}
function inAnyZone(x, y, zones) {
  return zones.some((z) => x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1);
}

// The felt table + the regulars not in this hand, seated on the rail (screens.html's deal(), minus the 5
// dealt faces - those get their own canvas face cards as fillDealSlot reveals them).
function layoutDealTable() {
  const canvas = document.getElementById("chomp-deal-canvas");
  const W = window.innerWidth, H = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const { tx, ty, rx, ry } = pokerTableGeometry(W, H, 0.54);
  drawPokerTable(g, tx, ty, rx, ry);
  const dealt = new Set([run.chomper, ...run.ghostIds]);
  const zones = dealExclusionZones(W, dealCardSlotPositions());
  const seated = seatPositions(REGULARS.filter((id) => !dealt.has(id)), tx, ty, rx, ry).filter(
    (s) => !inAnyZone(s.x, s.y, zones)
  );
  for (const s of seated) {
    R.stack(g, s.x, s.y - 2, 50 * 0.8, tokens["rail-2"], tokens, { n: 2 });
    const sp = sprites[s.id];
    if (sp) R.drawSprite(g, sp.normal, s.x, s.y + 4, 0.5, 1);
  }
  const plates = document.getElementById("chomp-deal-plates");
  plates.innerHTML = "";
  for (const s of seated) {
    const plate = document.createElement("div");
    plate.className = "aic-plate";
    plate.style.right = `${W - s.x}px`;
    plate.style.top = `${s.y + 6}px`;
    plate.textContent = facesById[s.id]?.name_he || s.id;
    plates.appendChild(plate);
  }
  dealCtx = g;
}

// behaviour = the ghost's behaviour key (its band colour), null for the chomper's own ("me") card. The
// behaviour pills are gone (board 2026-10-17): the colour band is the only link to the stack in the maze.
function fillDealSlot(el, id, behaviour) {
  el.innerHTML = "";
  const you = el.dataset.slot === "me";
  const w = parseFloat(el.dataset.w || "66");
  const h = w * 1.4;
  const x = parseFloat(el.style.left);
  const y = parseFloat(el.style.top);
  const band = you ? tokens.marigold : tokens.behaviour[BEHAVIOUR_KEY[behaviour]];
  const rot = you ? 0.05 : (Number(el.dataset.slot) - 1.5) * 0.06;
  if (dealCtx) drawDealFaceCard(dealCtx, id, x, y, w, band, rot, you);
  // Positioned relative to (x, y) - the card's own centre (DESIGN.md: "names above the cards"): the div
  // itself carries no normal-flow content any more (the head is now part of the canvas card above), so its
  // box has no size for skin.css's translate(50%,-50%) to act on, leaving (x, y) as a plain anchor point.
  const nameEl = document.createElement("div");
  nameEl.className = "aic-dealcard__name";
  nameEl.style.top = `${-(h / 2) - 22}px`;
  nameEl.textContent = facesById[id]?.name_he || id;
  el.appendChild(nameEl);
  el.classList.add("shown");
}

// The deal beat (spec §2a): a UI animation over an already-computed lineup (deal.js already dealt the
// chomper + 4 ghosts before this ever shows), so skipping it changes nothing but time. The sim isn't
// stepped while it's up (reduced-motion/prefers-reduced-motion: all 5 shown at once, 0.8s hold).
function startDealScreen() {
  // A rebuy/nightly deal from the game-over screen must hide it immediately, not wait for the next
  // updateHud() tick - the loop skips updateHud() entirely while `dealing` is true, which this function is
  // about to set, so the old screen would otherwise sit visible (and pointer-event-intercepting) underneath
  // the whole deal beat.
  document.getElementById("chomp-gameover").hidden = true;
  gameOverRendered = false;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  dealDurationMs = reducedMotion ? 800 : 2000;
  dealing = true;
  dealStartTime = performance.now();
  document.getElementById("chomp-deal").hidden = false;
  document.getElementById("chomp-deal-header").textContent = run.nightly
    ? format(TEXT.dealHeaderNightly, { n: run.nightNumber })
    : TEXT.dealHeaderNormal;
  layoutDealTable();
  const youEl = document.getElementById("chomp-deal-you");
  youEl.innerHTML = "";
  youEl.style.top = "40px"; // .aic-deal__you (skin.css) sets left/right but no top of its own
  const cardsEl = document.getElementById("chomp-deal-cards");
  cardsEl.innerHTML = "";
  const positions = dealCardSlotPositions();
  for (let i = 0; i < 4; i++) {
    const slot = dealCardSlot(String(i), positions[i]);
    slot.dataset.w = positions[i].w;
    cardsEl.appendChild(slot);
  }
  const meSlot = dealCardSlot("me", positions[4]);
  meSlot.dataset.w = positions[4].w;
  cardsEl.appendChild(meSlot);
  // "רודפים אחריך" over the four chaser cards (board 2026-10-17: the behaviour pills are gone).
  const chasersEl = document.getElementById("chomp-deal-chasers");
  chasersEl.textContent = TEXT.chasersLabel;
  const cardH = positions[0].w * 1.4;
  chasersEl.style.left = `${positions[0].x - positions[0].w / 2}px`;
  chasersEl.style.width = `${positions[3].x - positions[0].x + positions[0].w}px`;
  chasersEl.style.top = `${positions[0].y - cardH / 2 - 48}px`;
  const talkEl = document.getElementById("chomp-deal-talk");
  talkEl.hidden = true;
  talkEl.innerHTML = "";
  talkEl.style.left = `${positions[4].x - 110}px`;
  talkEl.style.top = `${positions[4].y + positions[4].w * 0.95}px`;
  talkEl.style.width = "220px";
  if (reducedMotion) revealAllDealCards();
}

function revealChomperDealCard() {
  const slots = document.getElementById("chomp-deal-cards").children;
  fillDealSlot(slots[4], run.chomper, null);
  const name = facesById[run.chomper]?.name_he || run.chomper;
  const youEl = document.getElementById("chomp-deal-you");
  youEl.innerHTML = "";
  youEl.append(TEXT.youAre, Object.assign(document.createElement("b"), { textContent: name }));
  const talkEl = document.getElementById("chomp-deal-talk");
  talkEl.hidden = false;
  talkEl.innerHTML = "";
  talkEl.appendChild(bubbleEl(name, facesById[run.chomper]?.lines_he[0] || ""));
}

function revealAllDealCards() {
  const slots = document.getElementById("chomp-deal-cards").children;
  run.ghosts.forEach((g, i) => {
    fillDealSlot(slots[i], run.ghostIds[i], g.behaviour);
  });
  revealChomperDealCard();
}

// 0.5-1.1s: the 4 ghost cards flip, 150ms apart. 1.2s: the chomper's card flips.
function updateDealScreen(now) {
  const elapsed = now - dealStartTime;
  const slots = document.getElementById("chomp-deal-cards").children;
  if (elapsed >= 500) {
    run.ghosts.forEach((g, i) => {
      if (elapsed >= 500 + i * 150 && !slots[i].classList.contains("shown")) {
        fillDealSlot(slots[i], run.ghostIds[i], g.behaviour);
      }
    });
  }
  if (elapsed >= 1200 && !slots[4].classList.contains("shown")) revealChomperDealCard();
  if (elapsed >= dealDurationMs) endDealScreen();
}

function endDealScreen() {
  dealing = false;
  document.getElementById("chomp-deal").hidden = true;
  lastFrameTime = null; // avoid a huge acc jump from the time spent on the deal screen
  if (!save.hintSeen()) showHint();
}

// The first-run hint card (3 lines, spec §5): shown once ever, any tap/key closes it, game time frozen
// while it's up.
function showHint() {
  hintShowing = true;
  document.getElementById("chomp-hint").hidden = false;
}
function closeHint() {
  if (!hintShowing) return;
  hintShowing = false;
  document.getElementById("chomp-hint").hidden = true;
  save.markHintSeen();
  lastFrameTime = null;
}

// The stick's DOM view (input.js's attachStick draws through this): the base ring at the touch point, the
// knob at the clamped offset. .aic-stick's margin centres the ring on left/top.
function stickView() {
  const el = document.getElementById("chomp-stick");
  const knob = el.firstElementChild;
  return {
    show(x, y) {
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      knob.style.transform = "translate(-50%, -50%)";
      el.hidden = false;
    },
    move(dx, dy) {
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    },
    hide() {
      el.hidden = true;
    },
  };
}

function loop(now) {
  requestAnimationFrame(loop);
  if (titleShowing) return; // run is null - nothing below this line has anything to act on
  if (paused) return;
  if (dealing) {
    updateDealScreen(now);
    return;
  }
  if (hintShowing || portraitBlocking) {
    // Don't let the frame clock run while frozen: the next real frame after this clears would otherwise
    // see the entire frozen duration as elapsed time and replay it at the 5-step-per-frame cap (THE-690 #6:
    // rotating back from portrait mid-game fast-forwarded several real seconds, likely costing a buy-in).
    lastFrameTime = null;
    return;
  }
  if (lastFrameTime == null) lastFrameTime = now;
  const dtMs = now - lastFrameTime;
  lastFrameTime = now;
  if (rot && rot.holding()) {
    acc = 0; // the sim holds still while a holding moment plays; no time is banked for later (2026-10-19)
  } else {
    acc += dtMs;
    let steps = 0;
    while (acc >= STEP_MS && steps < MAX_STEPS_PER_FRAME) {
      step(run);
      acc -= STEP_MS;
      steps += 1;
    }
  }
  if (rot) rot.tick(Math.min(dtMs, 100) / 1000);
  drawFrame();
  fxFrame(now, dtMs);
  updateHud();
  drainEvents();
  if (rot) rot.draw();
}

// t = seconds, the recipe's own animation clock (jaw/hop/wobble cycles - see recipe.js's drawChomper/
// drawGhost docs). Driven by the sim's own step count so it's exactly reproducible, not wall-clock time.
function drawFrame() {
  const t = run.step / 60;
  renderer.draw(run, sprites, tile, stageOx, stageOy, mazeKeyForLevel(run.level), t);
}

function ownLineCount(who) {
  return facesById[who]?.lines_he.length ?? 2;
}

function resetRunFlags() {
  bestSaved = false;
  overHandled = false;
  prevRebuyLeft = [];
  prevLevel = 0;
  prevJoker = false;
  talkShown = undefined;
  snapshotRngAtLevelStart = null; // force the new run's first level-start snapshot write
}

// Shared by updateHud()'s own game-over bookkeeping and quitToTitle() (pause's "לשולחן הראשי" ends the run
// the same way, spec §8/design line 82): the score banks for that chomper's best and, if nightly, the night's.
function recordBest(r) {
  save.saveBest(r.chomper, r.score);
}
function recordNightResult(r) {
  if (!r.nightly) return;
  save.saveNightResult(todayDate(), r.nightNumber, { score: r.score, chomper: r.chomper, level: r.level });
}

function seatPositions(ids, tx, ty, rx, ry) {
  return ids
    .map((id) => {
      const i = REGULARS.indexOf(id);
      const t = Math.PI / 2 + ((i + 0.5) / REGULARS.length) * Math.PI * 2;
      return { id, x: tx + Math.cos(t) * (rx + 4), y: ty + Math.sin(t) * (ry + 2) };
    })
    .sort((a, b) => a.y - b.y);
}

// THEME.images.cardBack (image slot): draws the re-skin's art, clipped to the same rounded-card shape, in
// place of recipe.js's drawn card back - the title screen's 2 decorative face-down cards.
function drawCardBack(g, x, y, w, rot) {
  if (!themeImages.cardBack) return R.cardBack(g, x, y, w, tokens, rot);
  const h = w * 1.4;
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.beginPath();
  g.roundRect(-w / 2, -h / 2, w, h, w * 0.16);
  g.clip();
  g.drawImage(themeImages.cardBack, -w / 2, -h / 2, w, h);
  g.restore();
}

// The felt oval itself (screens.html's table()): the wood rail, the baize gradient, the dealt-line stroke.
// Shared by the title screen and the deal screen - same formula, both ported from screens.html.
function drawPokerTable(g, tx, ty, rx, ry) {
  g.fillStyle = tokens.ink;
  g.beginPath(); g.ellipse(tx, ty + 8, rx + 26, ry + 26, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = tokens.rail;
  g.beginPath(); g.ellipse(tx, ty, rx + 24, ry + 24, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = "rgba(255,210,122,.4)"; g.lineWidth = 1.5;
  g.beginPath(); g.ellipse(tx, ty - 3, rx + 18, ry + 18, 0, Math.PI * 1.08, Math.PI * 1.92); g.stroke();
  const felt = g.createRadialGradient(tx, ty - 30, 20, tx, ty, rx);
  felt.addColorStop(0, tokens["baize-hi"]); felt.addColorStop(0.6, tokens.baize); felt.addColorStop(1, tokens["baize-lo"]);
  g.fillStyle = felt;
  g.beginPath(); g.ellipse(tx, ty, rx, ry, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = "rgba(255,244,220,.3)"; g.lineWidth = 1.2; g.setLineDash([5, 4]);
  g.beginPath(); g.ellipse(tx, ty, rx - 26, ry - 22, 0, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
}

// The oval table from above (design/all-in-chomp/screens.html's title() mockup, ported): the title screen's
// felt background with all 8 regulars seated around it. No canvas text (G10) - seat names are DOM .aic-plate
// elements built by layoutTitle() from the returned seat list.
function drawTitleTable(g, W, H) {
  const { tx, ty, rx, ry } = pokerTableGeometry(W, H, 0.52);
  drawPokerTable(g, tx, ty, rx, ry);
  const scatter = [
    [-140, 62, tokens["b-ambush"]], [-128, 54, tokens["b-ambush"]],
    [120, -50, tokens.hot], [108, -40, tokens.cream], [150, 70, tokens["b-shy"]],
  ];
  for (const [dx, dy, col] of scatter) {
    R.chip(g, tx + dx, ty + dy, 9, col, tokens, 6, col === tokens["b-shy"] ? tokens["b-shy-spot"] : tokens.cream);
  }
  drawCardBack(g, tx - 170, ty - 40, 26, -0.4);
  drawCardBack(g, tx - 154, ty - 37, 26, -0.15);
  const seated = seatPositions(REGULARS, tx, ty, rx, ry);
  for (const s of seated) {
    R.stack(g, s.x, s.y - 2, 56 * 0.8, tokens["rail-2"], tokens, { n: 2 });
    const sp = sprites[s.id];
    if (sp) R.drawSprite(g, sp.normal, s.x, s.y + 4, 0.5, 1);
  }
  return { tx, ty, seated };
}

function layoutTitle() {
  const canvas = document.getElementById("chomp-title-canvas");
  const W = window.innerWidth, H = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const { tx, ty, seated } = drawTitleTable(g, W, H);
  document.getElementById("chomp-title-name").style.top = `${ty - 80}px`;
  document.getElementById("chomp-title-tag").style.top = `${ty - 14}px`;
  const dealBtn = document.getElementById("chomp-title-deal");
  dealBtn.style.left = `${tx - 42}px`;
  dealBtn.style.top = `${ty + 14}px`;
  const plates = document.getElementById("chomp-title-plates");
  plates.innerHTML = "";
  for (const s of seated) {
    const plate = document.createElement("div");
    plate.className = "aic-plate";
    plate.style.right = `${W - s.x}px`;
    plate.style.top = `${s.y + 6}px`;
    plate.textContent = facesById[s.id]?.name_he || s.id;
    plates.appendChild(plate);
  }
}

// Shell screens (spec §4/§8): title is shown on a fresh boot (no run to resume) and again from pause's
// "לשולחן הראשי" - never mid-run, so loop() skips straight past every run-dependent step while it's up.
function showTitle() {
  loadFx(); // the fx layer loads while the title shows, so start-up isn't slower (2026-10-19)
  titleShowing = true;
  run = null;
  document.getElementById("chomp-title-night-n").textContent = String(nightNumber(todayDate()));
  document.getElementById("chomp-title").hidden = false;
  layoutTitle();
}
function hideTitle() {
  titleShowing = false;
  document.getElementById("chomp-title").hidden = true;
}

// Pause's "לשולחן הראשי" (spec §8, design line 82): ends the run - the score banks the same way a game over
// would - and returns to the title, not a fresh deal (THE-705; the old behaviour just re-dealt in place).
function quitToTitle() {
  if (rot) rot.cancel();
  if (run) {
    recordBest(run);
    recordNightResult(run);
  }
  save.clearRunSnapshot();
  showTitle();
}

function startNewRun() {
  if (rot) rot.cancel();
  const setupRng = mulberry32(randomSeed());
  const { chomper, bag } = nextChomper(save.loadBag(), setupRng);
  save.saveBag(bag);
  const { ghosts, behaviours } = dealGhosts(setupRng, chomper);
  resetRunFlags();
  // A new deal must drop any stale mid-level snapshot right away, not wait for this run's own first
  // snapshot write - a reload between now and that first write (e.g. a quit-to-rebuy from the pause menu,
  // which calls this directly, skipping game over's own clearRunSnapshot()) would otherwise resume the
  // abandoned previous run instead of dealing fresh (THE-690 #9).
  save.clearRunSnapshot();
  runWasFirstRun = !save.firstRunDone();
  firstRunMarked = false;
  run = createRun({ seed: randomSeed(), chomper, ghosts, behaviours, firstRun: runWasFirstRun, ownLineCount });
  resize(); // cheap to repeat on a rebuy; load-bearing coming off the title, where the stage was never sized
  startDealScreen();
}

// The nightly table (G18): the same lineup and deck for everyone that local day, from the date seed - the
// bag is never touched. Unlimited plays; only the night's best run's share line is kept (save.js).
function startNightlyRun() {
  if (rot) rot.cancel();
  const date = todayDate();
  const n = nightNumber(date);
  const { chomper, ghosts, behaviours, seed } = dealNightly(nightlySeed(date));
  resetRunFlags();
  save.clearRunSnapshot(); // see startNewRun's comment - same stale-snapshot risk on a direct nightly deal
  runWasFirstRun = false; // the free first-20s only applies to free play's first-ever run
  firstRunMarked = false;
  run = createRun({ seed, chomper, ghosts, behaviours, firstRun: false, ownLineCount, nightly: true, nightNumber: n });
  resize(); // see startNewRun's comment
  startDealScreen();
}

async function shareNightly() {
  const date = todayDate();
  const night = save.loadNight(date);
  const url = location.href.split("?")[0].split("#")[0];
  const nightBest = night
    ? {
        nightNumber: night.n,
        chomperNameHe: facesById[night.chomper]?.name_he || night.chomper,
        score: night.best,
        level: night.level,
      }
    : null;
  const text = shareText(nightBest, url, THEME);
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    /* clipboard blocked: nothing to fall back to here, the user can still screenshot */
  }
}

// localStorage access can throw (SecurityError in some private-browsing modes) on the property read itself,
// before save.js's own try/catch around getItem/setItem ever runs. An in-memory stand-in keeps the game
// playable - just without persistence - rather than crashing boot (THE-690 #10).
function storageOrMemoryFallback() {
  try {
    return window.localStorage;
  } catch (e) {
    const mem = new Map();
    return {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, v),
    };
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${src}`));
    img.src = src;
  });
}

// The HTML's static `hidden` attribute on .aic-scrim/.aic-turn elements loses to their own `display: grid`
// rule at parse time too (same specificity-tie issue setHidden() fixes for JS toggles) - sync the inline
// style for every element already marked hidden in the markup before anything else runs.
function syncInitialHidden() {
  for (const el of document.querySelectorAll(".aic-scrim[hidden], .aic-turn[hidden]")) el.style.display = "none";
}

// THEME.colors overrides tokens.css's --aic-* custom properties on :root - set before R.readTokens() (and
// before any drawing) so every recipe.js colour already reflects the re-skin.
function applyThemeColors(colors) {
  for (const [k, v] of Object.entries(colors || {})) document.documentElement.style.setProperty(k, v);
}

// A chip/card button's label, word-wrapped one word per line (skin.css sizes these buttons for exactly
// that), keeping any non-<br> element children already in the button. The markup's own <br>s must go, or
// they stack under the new label and push kept children off the chip (THE-692 D2-1).
function setChipLabel(el, text) {
  const kept = [...el.children].filter((node) => node.tagName !== "BR");
  el.textContent = "";
  text.split(" ").forEach((word, i) => {
    if (i > 0) el.appendChild(document.createElement("br"));
    el.appendChild(document.createTextNode(word));
  });
  for (const node of kept) el.appendChild(node);
}

function byId(id) {
  return document.getElementById(id);
}

// Every static screen word (spec §5) a re-skin can change in theme.js alone. Dynamic/templated strings
// (round number, deal header, game-over best, played count) are applied where they're computed instead.
function applyThemeText() {
  byId("chomp-pot-label").textContent = TEXT.potLabel;
  byId("chomp-joker-label").textContent = TEXT.jokerHeld;
  byId("chomp-pause-btn").setAttribute("aria-label", TEXT.pauseAria);
  byId("chomp-sound-btn").setAttribute("aria-label", TEXT.soundAria);

  byId("chomp-title-name").textContent = THEME.title;
  byId("chomp-title-tag").textContent = THEME.tagline;
  byId("chomp-title-deal").textContent = TEXT.deal;
  byId("chomp-title-about").textContent = TEXT.about;
  setChipLabel(byId("chomp-title-bests"), TEXT.bests);
  setChipLabel(byId("chomp-title-howto"), TEXT.howTo);
  // "No.{N}" sits in an LTR <bdi> on its own line; bare in the RTL chip it rendered as ".No" (THE-692 D2-1).
  const nightN = byId("chomp-title-night-n");
  nightN.remove();
  setChipLabel(byId("chomp-title-nightly"), TEXT.nightlyLabel);
  const nightNo = document.createElement("bdi");
  nightNo.dir = "ltr";
  nightNo.append(TEXT.nightlyNo, nightN);
  byId("chomp-title-nightly").append(document.createElement("br"), nightNo);

  byId("chomp-rebuy").textContent = TEXT.rebuy;
  setChipLabel(byId("chomp-nightly"), TEXT.nightlyLabel);
  byId("chomp-share").textContent = TEXT.share;

  const hint = byId("chomp-hint");
  const hintItems = hint.querySelectorAll("li");
  hintItems[0].textContent = isTouchDevice() ? TEXT.hint1Touch : TEXT.hint1;
  hintItems[1].textContent = TEXT.hint2;
  hintItems[2].textContent = TEXT.hint3;
  hint.querySelector(".aic-hint__tap").textContent = TEXT.hintTap;
  document.querySelector(".aic-deal__skip").textContent = TEXT.dealSkip;

  byId("chomp-portrait").querySelector("p").textContent = TEXT.portraitRotate;
  byId("chomp-portrait").querySelector("small").textContent = TEXT.portraitWaiting;

  const pauseScrim = byId("chomp-pause-scrim");
  pauseScrim.querySelector(".aic-sheet__title").textContent = TEXT.pauseTitle;
  byId("chomp-pause-resume").textContent = TEXT.pauseResume;
  byId("chomp-pause-howto").textContent = TEXT.howTo;
  byId("chomp-pause-sound").textContent = TEXT.pauseSound;
  byId("chomp-pause-about").textContent = TEXT.about;
  byId("chomp-pause-quit").textContent = TEXT.pauseQuit;

  const howtoScrim = byId("chomp-howto-scrim");
  howtoScrim.querySelector(".aic-sheet__title").textContent = TEXT.howTo;
  const howtoBody = howtoScrim.querySelectorAll("p");
  TEXT.howToBody.forEach((line, i) => { if (howtoBody[i]) howtoBody[i].textContent = line; });
  byId("chomp-howto-close").textContent = TEXT.close;

  const aboutScrim = byId("chomp-about-scrim");
  aboutScrim.querySelector(".aic-sheet__title").textContent = TEXT.about;
  aboutScrim.querySelector("p").textContent = TEXT.aboutFonts;
  byId("chomp-about-libs").textContent = TEXT.aboutLibs;
  byId("chomp-about-studio").textContent = TEXT.aboutStudio;
  // the install chip and Chrome's verdict in About (install.js)
  const installBtn = byId("chomp-title-install");
  setChipLabel(installBtn, TEXT.install);
  if (window.GameInstall) {
    window.GameInstall.onChange((s) => {
      installBtn.hidden = s !== "ready";
      byId("chomp-about-install").textContent = `${TEXT.aboutInstall}: ${TEXT.installState[s] || s}`;
    });
    installBtn.addEventListener("click", () => window.GameInstall.prompt());
  }
  buildVersion.then((v) => {
    const el = byId("chomp-about-version");
    el.textContent = `${TEXT.aboutVersion}: `;
    const b = document.createElement("bdi");
    b.textContent = v || TEXT.aboutVersionDev;
    el.appendChild(b);
  });
  byId("chomp-about-close").textContent = TEXT.close;

  const bestsScrim = byId("chomp-bests-scrim");
  bestsScrim.querySelector(".aic-sheet__title").textContent = TEXT.bests;
  byId("chomp-bests-close").textContent = TEXT.close;
}

function loadThemeImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // a bad re-skin path falls back to the built-in art, not a crash
    img.src = src;
  });
}

// Only the image slots actually set in theme.js load; every slot has a drawn default (see drawTitleTable).
async function loadThemeImages() {
  const slots = THEME.images || {};
  await Promise.all(
    Object.entries(slots).map(async ([slot, src]) => {
      if (src) themeImages[slot] = await loadThemeImage(src);
    })
  );
}

// The build this page runs: the service worker's cache name is a hash of the game's files (tools/sw-build.mjs), and a
// new version deletes the old cache when it takes over, so the one cache here at start-up is the one this page came
// from (an update that lands later reloads the page between games). Shown in About so a phone can be checked.
const buildVersion = (async () => {
  try {
    const keys = (await caches.keys()).filter((k) => k.startsWith("all-in-chomp-"));
    if (keys.length) return keys.map((k) => k.slice("all-in-chomp-".length)).join(", ");
  } catch {} // no Cache Storage (file://, private modes)
  // nothing cached yet (a first visit): this page came from the network, the same publish as the server's sw.js
  try {
    const m = (await (await fetch("sw.js", { cache: "no-store" })).text()).match(/CACHE_VERSION = 'all-in-chomp-([0-9a-f]+)'/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
})();

async function boot() {
  syncInitialHidden();
  applyThemeColors(THEME.colors);
  applyThemeText();
  await loadThemeImages();
  const canvas = document.getElementById("chomp-canvas");
  const ctx = canvas.getContext("2d");
  await document.fonts.ready.catch(() => {});
  tokens = R.readTokens();
  renderer = createRenderer(ctx, tokens, THEME.levelLooks || []);
  save = createSave(storageOrMemoryFallback());
  audio = createAudio();
  if (ROT_ON) rot = createRot(document.getElementById("chomp-rot"), document.getElementById("chomp-rotcap"), { reduced: reducedMotion, sfx: audio });
  audio.setMuted(!save.settings().sound);

  const facesRes = await fetch("./faces.json");
  const { faces } = await facesRes.json();
  const regulars = faces.filter((f) => f.group === "regular");
  facesById = Object.fromEntries(faces.map((f) => [f.id, f]));
  await Promise.all(
    regulars.map(async (f) => {
      rawImages[f.id] = {
        normal: await loadImage(f.file),
        closed: f.eyes_closed_file ? await loadImage(f.eyes_closed_file) : null,
      };
    })
  );

  // Mid-level reload (G17/G18): resume the in-progress level (same lineup, the score/buy-ins banked at
  // level start, the same deck/fold-RNG state) instead of a fresh deal. No deal screen - the lineup isn't
  // new, there's nothing to show.
  let snapshot = save.loadRunSnapshot();
  // A nightly snapshot from a previous local day is stale - yesterday's night must never resume as if it
  // were today's (THE-690 r2 #4). Drop it like there was no snapshot at all; a fresh deal starts normally.
  if (snapshot && snapshot.nightly && snapshot.date !== todayDate()) {
    save.clearRunSnapshot();
    snapshot = null;
  }
  if (snapshot) {
    resetRunFlags();
    // Without this, a resumed first-ever run's eventual game over never called markFirstRunDone() -
    // runWasFirstRun stayed at its initial false, since only startNewRun()/startNightlyRun() set it
    // (THE-690 #9).
    runWasFirstRun = snapshot.firstRun;
    firstRunMarked = false;
    run = resumeLevel({ ...snapshot, ownLineCount });
    resize();
    loadFx(); // no title on a resume: load the fx layer now
  } else {
    // A fresh boot with nothing to resume (THE-705): the title, not an immediate deal. "חלק לי" deals.
    updateSpriteCache(); // at the default tile - the title table draws faces before any run ever sizes one
    showTitle();
  }
  window.addEventListener("resize", () => {
    resize();
    if (titleShowing) layoutTitle();
  });

  // Any tap, click or key skips the deal beat from frame 1 - consumed, not used as a direction.
  attachKeyboard(window, (dir) => {
    if (titleShowing) return; // no run to steer; the title's own buttons are plain DOM clicks
    if (dealing) {
      endDealScreen();
      return;
    }
    if (hintShowing) {
      closeHint();
      return;
    }
    input(run, dir);
  });
  // The floating stick (board, 2026-10-17): on the app root, so a thumb resting in a gutter steers too. Taps
  // on buttons, sheets and screens never start a stick (input.js), so the deal skip, the hint close and every
  // button keep their own handlers.
  attachStick(document.getElementById("chomp-app"), (dir) => {
    if (!run || titleShowing || dealing || hintShowing) return;
    input(run, dir);
  }, stickView());
  document.getElementById("chomp-hint").addEventListener("pointerdown", () => closeHint());
  document.getElementById("chomp-deal").addEventListener("pointerdown", () => {
    if (dealing) endDealScreen();
  });

  document.getElementById("chomp-rebuy").addEventListener("click", () => {
    requestPhoneFullscreen();
    startNewRun();
  });
  document.getElementById("chomp-nightly").addEventListener("click", () => {
    startNightlyRun();
  });
  document.getElementById("chomp-share").addEventListener("click", () => {
    shareNightly();
  });

  // Comforts: pause (anywhere), how-to (from the title and pause), a sound toggle, About.
  const pauseScrim = document.getElementById("chomp-pause-scrim");
  const howtoScrim = document.getElementById("chomp-howto-scrim");
  const aboutScrim = document.getElementById("chomp-about-scrim");
  const bestsScrim = document.getElementById("chomp-bests-scrim");

  // Title (THE-705): "חלק לי" deals, the corner button deals the nightly table, the fan reuses the pause
  // scrims (about/how-to) plus the bests sheet.
  document.getElementById("chomp-title-deal").addEventListener("click", () => {
    requestPhoneFullscreen();
    hideTitle();
    startNewRun();
  });
  document.getElementById("chomp-title-nightly").addEventListener("click", () => {
    requestPhoneFullscreen();
    hideTitle();
    startNightlyRun();
  });
  document.getElementById("chomp-title-about").addEventListener("click", () => {
    setHidden(aboutScrim, false);
  });
  document.getElementById("chomp-title-howto").addEventListener("click", () => {
    setHidden(howtoScrim, false);
  });
  document.getElementById("chomp-title-bests").addEventListener("click", () => {
    renderBests();
    setHidden(bestsScrim, false);
  });
  document.getElementById("chomp-bests-close").addEventListener("click", () => {
    setHidden(bestsScrim, true);
  });

  function openPause() {
    paused = true;
    setHidden(pauseScrim, false);
  }
  function closePause() {
    paused = false;
    setHidden(pauseScrim, true);
    lastFrameTime = null;
  }
  document.getElementById("chomp-pause-btn").addEventListener("click", openPause);
  document.getElementById("chomp-pause-resume").addEventListener("click", closePause);
  document.getElementById("chomp-pause-quit").addEventListener("click", () => {
    closePause();
    quitToTitle();
  });
  document.getElementById("chomp-pause-sound").addEventListener("click", () => {
    const next = audio.isMuted();
    audio.setMuted(!next);
    save.setSetting("sound", next);
  });
  document.getElementById("chomp-pause-howto").addEventListener("click", () => {
    setHidden(howtoScrim, false);
  });
  document.getElementById("chomp-howto-close").addEventListener("click", () => {
    setHidden(howtoScrim, true);
  });
  document.getElementById("chomp-pause-about").addEventListener("click", () => {
    setHidden(aboutScrim, false);
  });
  document.getElementById("chomp-about-close").addEventListener("click", () => {
    setHidden(aboutScrim, true);
  });
  document.getElementById("chomp-sound-btn").addEventListener("click", () => {
    const next = audio.isMuted();
    audio.setMuted(!next);
    save.setSetting("sound", next);
  });

  drawPortraitIcon();

  checkPortrait();
  window.addEventListener("orientationchange", checkPortrait);
  window.addEventListener("resize", checkPortrait);

  // Pause sources beyond the button: Esc/P, losing focus, the tab going hidden. None apply on the title -
  // there's no run to pause, and the title has its own how-to/about buttons already.
  window.addEventListener("keydown", (e) => {
    if ((e.key === "Escape" || e.key === "p" || e.key === "P") && !titleShowing && !dealing && !hintShowing) {
      if (paused) closePause();
      else openPause();
    }
  });
  window.addEventListener("blur", () => {
    if (!titleShowing && !dealing && !hintShowing) openPause();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && !titleShowing && !dealing && !hintShowing) openPause();
  });

  window.__sim = {
    step(n = 1) {
      if (titleShowing) return; // no run yet - click chomp-title-deal (or nightly) first
      for (let i = 0; i < n; i++) step(run);
      drawFrame();
      updateHud();
      drainEvents();
    },
    getState() {
      if (titleShowing) return { screen: "title" }; // run is null - nothing else to report
      return {
        screen: "play",
        phase: run.phase,
        mode: run.mode,
        level: run.level,
        step: run.step,
        levelSteps: run.levelSteps,
        chain: run.chain,
        firstRun: run.firstRun,
        nightly: run.nightly,
        nightNumber: run.nightNumber,
        joker: run.joker,
        jokerSlot: run.jokerSlot,
        jokerSpawnedLevel: run.jokerSpawnedLevel,
        player: { x: run.player.x, y: run.player.y, dir: run.player.dir, want: run.player.want },
        ghosts: run.ghosts.map((g, i) => ({
          id: run.ghostIds[i],
          behaviour: g.behaviour,
          active: g.active,
          folded: g.folded,
          foldLeft: g.foldLeft,
          eaten: g.eaten,
          rebuyLeft: g.rebuyLeft,
          x: g.x,
          y: g.y,
          dir: g.dir,
          want: g.want,
        })),
        chipsLeft: run.chipsLeft,
        score: run.score,
        buyIns: run.buyIns,
        chomper: run.chomper,
      };
    },
    hash() {
      return titleShowing ? null : simHash(run);
    },
    pause(on) {
      paused = on;
    },
    // Test/review hook (2026-10-19): play a moment on the current table (sweep|clear|joker|bust); hold it at
    // rt s if given. Returns whether a moment is playing.
    rot(kind, rt = null) {
      if (titleShowing || !rot) return false;
      const type = kind === "joker" ? "jokerSaved" : kind;
      run.events.push({ type, x: run.player.x, y: run.player.y, who: run.ghostIds[0], prize: "joker" });
      drainEvents();
      if (rt != null) rot.hold(rt);
      return rot.active();
    },
    // Review hook (2026-10-19): fire one fx burst at the chomper (chip|allin|eat|caught|jokerTaken|clear).
    fx(type) {
      if (titleShowing || !fx) return false;
      fxBurst(type, screenOf(run.player.x, run.player.y), type === "eat" ? run.ghostIds[0] : null);
      return true;
    },
    // Test hook (2026-10-19): hold (or drop) a joker, to see the held-joker card on the head and in the HUD.
    joker(on = true) {
      if (!titleShowing) run.joker = on;
    },
    input(dir) {
      if (!titleShowing) input(run, dir);
    },
    // Test hook: seat ghost `slot` for `steps` of rebuy wait (as if its eyes had just got home), so the
    // return and its shout can be driven without playing out an ALL IN and an eat.
    seat(slot, steps = 1) {
      if (titleShowing) return;
      const g = run.ghosts[slot];
      const c = { x: run.maze.seat.x * 240 + 120, y: run.maze.seat.y * 240 + 120 }; // move.js's tileCenter, 1 tile = 240 u
      Object.assign(g, { active: true, folded: false, foldLeft: 0, eaten: false, rebuyLeft: steps, x: c.x, y: c.y, dir: null, want: null });
    },
    // Test hook: eat every chip but one and park the chomper on it, so the next step clears the level (the
    // clear show, the next table's look) without playing the table out.
    clear() {
      if (titleShowing || run.phase !== "play") return;
      let last = null;
      for (let y = 0; y < run.maze.h; y++) {
        for (let x = 0; x < run.maze.w; x++) {
          if (run.maze.at(x, y) !== ".") continue;
          const key = `${x},${y}`;
          if (run.eaten.has(key)) continue;
          if (last) run.eaten.add(key);
          else last = { x, y };
        }
      }
      if (!last) return;
      run.chipsLeft = 1;
      Object.assign(run.player, { x: last.x * 240 + 120, y: last.y * 240 + 120, dir: null, want: null });
    },
  };

  if (QS.has("play") || QS.has("rotshow")) {
    if (titleShowing) { hideTitle(); startNewRun(); }
    if (dealing) endDealScreen();
    if (hintShowing) closeHint();
    if (QS.has("steps")) window.__sim.step(Number(QS.get("steps")) || 0);
    if (QS.has("rotshow")) setTimeout(() => window.__sim.rot(QS.get("rotshow"), QS.has("rt") ? Number(QS.get("rt")) : null), 400);
  }

  requestAnimationFrame(loop);
}

boot();
