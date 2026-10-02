// Captain Fold game.js: the state machine, one timer registry, and the test hook (THE-260 design, THE-264 M3).
// Physics/generation are untouched here: this module only drives them from input, persists progress, and
// renders the result.
import { P, PX_PER_M, generateCourse } from "./core.js";
import { PACK, courseById, dailyCourse } from "./courses.js";
import { pullToPower, startFlight, tick, flightResult, latchReaction } from "./flight.js";
import { drawWorld, drawTitleBackdrop, facePNG, readTokens } from "./render.js";
import { plane as buildPlaneSvg, rasterSVG } from "./sprites.js";
import { attachInput } from "./input.js";
import { loadSave, persistSave } from "./save.js";
import { dailyNumber, mergeCourseBest, mergeDaily, unlockedFolds, courseUnlocked, nextCourseId, shareText, localDateKey } from "./progress.js";
import { runDemo } from "./demo.js";
import * as audio from "./audio.js";

const PULL_MIN_PX = 24;
const PULL_MAX_PX = 120;
const TOUCHDOWN_MS = 900; // spec S2: crumple or slide + stamp, then the result
const RESUME_COUNTDOWN_MS = 900; // spec S2: a "3-2-1" fold-in on resume, the plane holds still until it ends
const TRAIL_S = 3.5; // DESIGN.md S6.6: the pencil-dash flight line shows the last 3.5s of path

// Built-in defaults (CTO review B5): theme.js's own `folds` table overrides these per re-skin; a re-skin that
// doesn't touch `folds` at all still gets sensible, in-context names rather than an empty Hangar.
const DEFAULT_FOLD_NAMES = { notebook: "Notebook", graph: "Graph paper", newspaper: "Newspaper", map: "Map paper", origami: "Origami red", gold: "Gold star paper" };
const DEFAULT_FOLD_HOW = { notebook: "Default", graph: "First landing", newspaper: "50 lucky stars", map: "Finish Chapter 1", origami: "10 courses at 3 stars", gold: "Finish Chapter 3" };

// flight.js's resolveReaction() names the 5 spec faces slightly differently from sprites.js's EXPR keys
// (pilot.js/DESIGN.md 6.3): "nearmiss" -> wince, "newbest"/"newbest_land" -> best, everything else passes through.
const REACTION_TO_EXPR = { neutral: "neutral", strain: "strain", nearmiss: "wince", crash: "crash", newbest: "best", newbest_land: "best" };

function localDateParts(date) {
  return { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() };
}

// THE-309: the title masthead's dateline ("Wed 30 Sep"). Reads straight off the injected `now()` Date's own
// local getters, same as localDateParts() above - never UTC, so the displayed day always matches the day the
// daily number (below) is computed for.
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function formatDateline(date, m, d) {
  return `${WEEKDAYS[date.getDay()]} ${String(d).padStart(2, "0")} ${MONTHS[m - 1]}`;
}

// One timer registry (design.md "Timers and animations"): every callback is tagged with the flight generation
// so a restart or course change (which bumps the generation) makes any in-flight timer a no-op instead of
// firing into stale state.
function createTimers() {
  let generation = 0;
  const pending = new Set();
  return {
    add(ms, fn) {
      const gen = generation;
      const id = setTimeout(() => { pending.delete(id); if (gen === generation) fn(); }, ms);
      pending.add(id);
      return id;
    },
    clear() {
      for (const id of pending) clearTimeout(id);
      pending.clear();
      generation++;
    },
  };
}

// CTO review B6: window.localStorage was read as a bare default-parameter expression, which some browsers
// throw on merely accessing (not just using) when storage is blocked (private browsing, a strict cookie
// policy, an iframe sandbox) - before save.js's own try/catch around getItem/setItem ever got a chance to run,
// so the whole game failed to start. A tiny in-memory fallback keeps createGame() construction itself safe;
// save.js's existing per-call try/catch still handles a storage object that throws on individual calls.
function safeLocalStorage() {
  try {
    return window.localStorage;
  } catch {
    const memory = new Map();
    return { getItem: (k) => (memory.has(k) ? memory.get(k) : null), setItem: (k, v) => { memory.set(k, v); } };
  }
}

export function createGame(root, { storage = safeLocalStorage(), now = () => new Date() } = {}) {
  const canvas = root.querySelector(".cf-world");
  const ctx = canvas.getContext("2d");
  const timers = createTimers();
  const theme = window.THEME || {};

  let save = loadSave(storage);
  let autoHowToShown = false; // the first-run demo stand-in (see renderTitle) fires at most once per page load
  let justEquippedFold = null; // the Hangar swatch's one-shot equip pop (reuses .cf-tag's cf-pop keyframe)
  let held = false; // input.js's own hold state, mirrored here for frame()'s tick() call; reset in loadCourse/beginThrow (CTO review B1)

  // THE-305: the pencil-dash flight line (DESIGN.md S6.6) - one world point per physics step, pruned to the
  // last TRAIL_S of flight time. trailDropped accumulates the world-px length trimmed off the front so
  // render.js's dash offset keeps marching instead of resetting every time a point ages out.
  let trail = [];
  let trailDropped = 0;
  function resetTrail() { trail = []; trailDropped = 0; }
  function pushTrailPoint(f) {
    trail.push([f.x, f.y, f.t]);
    while (trail.length > 1 && f.t - trail[0][2] > TRAIL_S) {
      const [x0, y0] = trail.shift();
      const [x1, y1] = trail[0];
      trailDropped += Math.hypot(x1 - x0, y1 - y0);
    }
  }

  const G = {
    screen: "title", // title | ledge | flight | touchdown | result | hangar
    mode: "pack", // "pack" | "daily" | "probe" (an arbitrary QA seed, never persisted)
    courseId: null,
    course: null,
    flight: null,
    bestX: 0,
    reaction: "neutral",
    reactionSince: 0, // ms timestamp G.reaction last changed (THE-306 latch: see latchReaction())
    result: null,
    pullPx: 0,
    paused: false,
    resuming: false,
    dailyDate: null, // CTO review B6: the daily's y/m/d, captured once in startDaily() - a flight started at
    // 23:59 and shared after midnight must still read/share under the day it was actually played, not
    // whatever now() happens to return when the button is clicked.
  };

  function persist() { persistSave(storage, save); }

  let themeImages = { pilot: null, cover: null }; // resolved by UIKit.loadImageSlots(); null = drawn default
  function applyTheme() {
    // CTO review B5: this hand-rolled version only ever covered 3 of the slots the html5-game-standards theme
    // contract promises (title/credit/dailyLabel) and never ran UIKit.applyTheme at all - theme.colors and every
    // other text.* key (now wired via data-theme-text in index.html) were silently ignored, and the image slots
    // were never loaded or drawn anywhere. ui-kit.js is loaded in index.html now (it previously wasn't, despite
    // being precached and the comment above the script tags claiming it was).
    window.UIKit?.applyTheme(theme);
    if (theme.title) { const el = root.querySelector("#cf-title-text"); if (el) el.textContent = theme.title; }
    if (theme.text?.credit) { const el = root.querySelector("#cf-credit"); if (el) el.textContent = theme.text.credit; }
    if (theme.text?.dailyLabel) { const el = root.querySelector("#cf-btn-daily-label"); if (el) el.textContent = theme.text.dailyLabel; }
    window.UIKit?.loadImageSlots(theme).then((images) => { themeImages = images; });
  }

  function resizeCanvas() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resizeCanvas);

  function showScreen(name) {
    G.screen = name;
    for (const el of root.querySelectorAll(".cf-screen")) {
      el.classList.toggle("is-active", el.id === `cf-${name === "flight" || name === "ledge" || name === "touchdown" ? "play" : name}`);
    }
    if (name === "title") renderTitle();
    if (name === "hangar") renderHangar();
    if (name === "result") fillResultPass(); // CTO review B2: once per screen, not every frame (see updateHud)
    updateHud();
  }

  let heroPlaneImg = null;
  let heroRequested = false;
  let heroGen = 0; // bumped when the fold changes, so a raster still in flight for the old fold is dropped

  // The effective reduced-motion choice (THE-308): the Settings toggle, else the OS setting (UIKit reads both
  // from <html data-reduce-motion>, which applyMotion only sets when the toggle is on).
  const motionReduced = () => !!window.UIKit?.reduceMotion?.();
  function applyMotion() {
    if (save.settings.motion) document.documentElement.dataset.reduceMotion = "true";
    else delete document.documentElement.dataset.reduceMotion; // off = follow the OS, not force motion on
  }

  // The equipped fold repaints the plane (THE-307): tokens.css swaps the fold-* tokens on <html data-fold>,
  // render.js re-reads its token cache and plane frames when this attribute changes, and the hero re-rasterises.
  function applyFold() {
    if (document.documentElement.dataset.fold === save.fold) return;
    document.documentElement.dataset.fold = save.fold;
    heroGen++;
    heroPlaneImg = null;
    heroRequested = false;
  }
  const HERO_BOB_PX = 2, HERO_BOB_S = 1.6; // DESIGN.md S6.2: "idle bob on the title: 2 px, 1.6 s sine"
  function drawHero(ts) {
    const heroCanvas = root.querySelector("#cf-hero-canvas");
    if (!heroCanvas) return;
    const T = readTokens();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = heroCanvas.clientWidth || 320, cssH = heroCanvas.clientHeight || 200;
    const dispW = cssW * 0.72, dispH = (dispW * 76) / 146; // the plane's own aspect ratio (sprites.js: 146x76)
    if (!heroPlaneImg && !heroRequested) {
      heroRequested = true;
      const fold = { paper: T["fold-paper"], rule: T["fold-rule"], margin: T["fold-margin"], shade: T["fold-shade"], far: T["fold-far"], kind: T["fold-kind"] };
      const rasterW = Math.round(dispW * dpr * 2); // rasterise above display size for a crisp hero image
      const gen = heroGen;
      rasterSVG(buildPlaneSvg({ width: rasterW, pitch: -6, expr: "wave", fold }), rasterW, (rasterW * 76) / 146).then((cv) => { if (gen === heroGen) heroPlaneImg = cv; });
    }
    heroCanvas.width = Math.round(cssW * dpr);
    heroCanvas.height = Math.round(cssH * dpr);
    const hctx = heroCanvas.getContext("2d");
    hctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // CTO review B5: theme.images.cover, when set, replaces the whole drawn hero (the plane art + pencil loop
    // are a single composition, not independently overridable) with the re-skin's own image, letter-boxed to
    // fit. Both slots are null today (no board photo yet, THE-255 privacy hold) so this path is wired but
    // untested against a real image - the null branch below is what every build has actually exercised so far.
    if (themeImages.cover) {
      const img = themeImages.cover;
      const scale = Math.min(cssW / img.width, cssH / img.height);
      const dw = img.width * scale, dh = img.height * scale;
      hctx.drawImage(img, (cssW - dw) / 2, (cssH - dh) / 2, dw, dh);
      return;
    }
    // The pencil-dash loop behind the plane (spec S5 "mid-screen: the hero plane ... with the pencil loop
    // behind"): a single dashed ellipse in ink, at 50% alpha, matching the flight-line style.
    hctx.save();
    hctx.globalAlpha = 0.5;
    hctx.strokeStyle = T.ink;
    hctx.lineWidth = 2.4;
    hctx.setLineDash([7, 7]);
    hctx.beginPath();
    hctx.ellipse(cssW * 0.52, cssH * 0.55, cssW * 0.38, cssH * 0.3, -0.15, 0, Math.PI * 2);
    hctx.stroke();
    hctx.restore();
    if (heroPlaneImg) {
      const bobY = motionReduced() ? 0 : Math.sin(((ts || 0) / 1000 / HERO_BOB_S) * 2 * Math.PI) * HERO_BOB_PX;
      hctx.drawImage(heroPlaneImg, cssW * 0.14, cssH * 0.5 - dispH / 2 + bobY, dispW, dispH);
    }
  }

  // THE-310: the 3 how-to picture cards (DESIGN.md S9), each a static scene drawn with the same drawWorld()
  // the real flight uses, on a flight/course snapshot built just to pose that one beat - never the live state.
  function drawHowToCard(selector, course, flight, opts) {
    const cv = root.querySelector(selector);
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = cv.clientWidth || 380, cssH = cv.clientHeight || 238;
    cv.width = Math.round(cssW * dpr);
    cv.height = Math.round(cssH * dpr);
    drawWorld(cv.getContext("2d"), cssW, cssH, course, flight, opts);
  }
  function howToFlight(x, y, a, t, v) {
    return { f: { x, y, a, t, v, bounces: 0, stalled: false, over: false, result: null, knocked: new Set(), starsTaken: new Set() } };
  }
  function drawHowToArt() {
    // 1. pull: the plane on the ledge, the dotted throw arc showing where a pull sends it.
    drawHowToCard("#cf-howto-art-1", { air: [], obstacles: [], stars: [], L: 2000 },
      howToFlight(60, P.LAUNCH_Y, P.LAUNCH_ANGLE, 0, 0), { throwArcPower: 0.7 });
    // 2. hold-let go: riding a mint updraft, the pencil-dash trail showing the climb.
    drawHowToCard("#cf-howto-art-2", { air: [{ kind: "up", x: 260, w: 160, y0: 80, y1: 480 }], obstacles: [], stars: [{ x: 340, y: 340 }], L: 2000 },
      howToFlight(300, 260, 0.5, 3, 200), { trail: [[120, 180], [180, 210], [240, 245], [280, 258], [300, 260]] });
    // 3. land on the blanket: the plane on final approach to the bullseye, late in the grace clock.
    drawHowToCard("#cf-howto-art-3", { air: [], obstacles: [], stars: [], L: 900 },
      howToFlight(750, 40, -0.2, 20, 150), {});
  }

  function renderTitle() {
    const nowDate = now();
    const { y, m, d } = localDateParts(nowDate);
    const noteEl = root.querySelector("#cf-daily-note");
    if (noteEl) noteEl.textContent = `No. ${dailyNumber(y, m, d)}`;
    // THE-309: the masthead dateline was never filled in - index.html shipped the empty span.
    const dateEl = root.querySelector("#cf-dateline-text");
    if (dateEl) dateEl.textContent = `${formatDateline(nowDate, m, d)} · Flight No. ${dailyNumber(y, m, d)}`;
    // THE-309: THROW!'s course subline. No chapter-name data exists yet (PACK only carries numeric chapters,
    // see courses.js/progress.js) - this reads the real next-course id and nothing invented past it.
    const throwNoteEl = root.querySelector("#cf-btn-throw-note");
    if (throwNoteEl) throwNoteEl.textContent = `Course ${nextCourseId(save.courses)}`;
    const hintEl = root.querySelector("#cf-hint-first");
    if (hintEl) hintEl.hidden = !!save.seenHowTo;
    // spec S5's first-run demo: plays once, the first time a brand-new save reaches the title. Never fires
    // again once seenHowTo is set (the demo itself sets it, same as closing the how-to dialog does).
    if (!save.seenHowTo && !autoHowToShown) {
      autoHowToShown = true;
      startDemo();
    }
  }

  let activeDemo = null;
  function startDemo() {
    timers.clear();
    showScreen("demo");
    const ghostEl = root.querySelector("#cf-ghost");
    const captionEl = root.querySelector("#cf-demo-caption");
    activeDemo = runDemo({
      course: courseById("1-1"),
      drawWorld: (c, w, h, course, flight, opts = {}) => drawWorld(c, w, h, course, flight, { ...opts, reduceMotion: motionReduced() }),
      ctx,
      getViewSize: () => ({ viewW: canvas.clientWidth, viewH: canvas.clientHeight }),
      ghostEl,
      captionEl,
      captions: {
        pull: theme.text?.demoCaption1,
        holdClimb: theme.text?.demoCaption2,
        crumpleWarning: theme.text?.demoCaption3,
        bounceInfo: theme.text?.demoCaption4,
        landHere: theme.text?.demoCaption5,
      },
      onDone: () => {
        activeDemo = null;
        save.seenHowTo = true;
        persist();
        showScreen("title");
      },
    });
  }

  function renderHangar() {
    const chapters = root.querySelector("#cf-chapters");
    if (chapters) {
      chapters.innerHTML = "";
      for (const chapterNum of [1, 2, 3]) {
        const section = document.createElement("section");
        section.className = "cf-chapter";
        const title = document.createElement("h3");
        title.className = "cf-chapter__title";
        title.textContent = `${theme.text?.chapterLabel || "Chapter"} ${chapterNum}`;
        section.appendChild(title);
        const row = document.createElement("div");
        row.className = "cf-courses";
        for (const c of PACK.filter((p) => p.chapter === chapterNum)) {
          const btn = document.createElement("button");
          const entry = save.courses[c.id];
          const unlocked = courseUnlocked(save.courses, c.id);
          btn.className = `cf-course${unlocked ? "" : " is-locked"}`;
          btn.disabled = !unlocked;
          const idEl = document.createElement("span");
          idEl.className = "cf-course__id";
          idEl.textContent = c.id;
          const starsEl = document.createElement("span");
          starsEl.className = "cf-course__stars";
          starsEl.textContent = entry ? "★".repeat(entry.stars) + "☆".repeat(3 - entry.stars) : "";
          const bestEl = document.createElement("span");
          bestEl.className = "cf-course__best";
          // CTO review item 4: a crash-only entry has stars 0 and best = the crash's distance score, which read
          // as a landing's "pts" - only a real landing (stars > 0) has a score worth labelling that way.
          bestEl.textContent = entry && entry.stars > 0 ? `${entry.best} pts` : "";
          btn.append(idEl, starsEl, bestEl);
          if (unlocked) btn.addEventListener("click", () => { startCourse(c.id); });
          row.appendChild(btn);
        }
        section.appendChild(row);
        chapters.appendChild(section);
      }
    }
    const patterns = root.querySelector("#cf-patterns");
    if (patterns) {
      patterns.innerHTML = "";
      const unlocked = unlockedFolds(save);
      for (const id of Object.keys(DEFAULT_FOLD_NAMES)) {
        const name = theme.folds?.[id]?.name || DEFAULT_FOLD_NAMES[id];
        const how = theme.folds?.[id]?.how || DEFAULT_FOLD_HOW[id];
        const btn = document.createElement("button");
        const isUnlocked = unlocked.includes(id);
        const justEquipped = id === save.fold && id === justEquippedFold;
        btn.className = `cf-pattern${isUnlocked ? "" : " is-locked"}${save.fold === id ? " is-equipped" : ""}${justEquipped ? " is-pop" : ""}`;
        btn.disabled = !isUnlocked;
        const swatch = document.createElement("span");
        swatch.className = "cf-pattern__swatch";
        swatch.dataset.fold = id;
        const nameEl = document.createElement("span");
        nameEl.className = "cf-pattern__name";
        nameEl.textContent = name;
        const howEl = document.createElement("span");
        howEl.className = "cf-pattern__how";
        howEl.textContent = how;
        btn.append(swatch, nameEl, howEl);
        if (isUnlocked) btn.addEventListener("click", () => { save.fold = id; justEquippedFold = id; persist(); applyFold(); audio.playTabTk(); renderHangar(); });
        patterns.appendChild(btn);
      }
      justEquippedFold = null; // the pop plays once per equip, not on every re-render while it's still equipped
    }
  }

  function startCourse(id) {
    G.mode = "pack";
    loadCourse(id, courseById(id));
  }

  // The test hook's loadCourse accepts either a pack id (design.md's normal path) or an arbitrary {seed, d} -
  // QA's real-pointer probes (tools/captain-fold-qa.mjs) need to drive seeds outside the shipped pack. This
  // never touches save.courses (there's no pack id to key it by), matching "daily" mode's own save handling.
  function startArbitrary(seedAndD) {
    G.mode = "probe";
    loadCourse(`probe-${seedAndD.seed}-${seedAndD.d}`, generateCourse(seedAndD.seed, seedAndD.d));
  }

  function startDaily() {
    G.mode = "daily";
    const { y, m, d } = localDateParts(now());
    G.dailyDate = { y, m, d };
    loadCourse(`daily-${y}-${m}-${d}`, dailyCourse(y, m, d));
  }

  function loadCourse(id, course) {
    timers.clear(); // cancels any pending resume countdown - reset G.resuming directly, its own timer won't fire now
    audio.stopSwish(); // a restart/next-course abandons any in-progress flight without a natural tick(); over check
    // CTO review B1: a hold that outlived its flight (a finger lifted on the result screen, after the mode had
    // already left "flight") used to stay latched into the next throw. Belt and braces: reset both input.js's
    // own pointer bookkeeping and this module's held copy on every course (re)load, not just on a real release.
    inputHandle.releaseAll();
    held = false;
    resetTrail();
    G.courseId = id;
    G.course = course;
    G.flight = null;
    G.pullPx = 0;
    // bestX persists in metres (G6-A10); flight.js/core.js work in world px, so convert at this boundary. A
    // daily's bestX only applies to TODAY's daily (a stale save.daily from a previous day is a different course
    // entirely - its best-flag position would be meaningless here). In daily mode this reads G.dailyDate (set
    // once in startDaily(), CTO review B6) rather than calling now() again, so a flight that started right
    // before midnight is still judged against the day it was actually started on.
    const { y, m, d } = G.mode === "daily" && G.dailyDate ? G.dailyDate : localDateParts(now());
    const dailyMatchesToday = G.mode === "daily" && save.daily?.date === localDateKey(y, m, d);
    const bestXMetres = G.mode === "pack" ? save.courses[id]?.bestX : dailyMatchesToday ? save.daily.bestX : 0;
    G.bestX = (bestXMetres || 0) * PX_PER_M;
    G.paused = false;
    G.resuming = false;
    showScreen("ledge");
  }

  const FLIGHT_HINT_MS = 4000; // THE-311: DESIGN.md S4 - the first flight's hint plate, until the first hold or 4s
  // THE-311: separate from the demo/how-to's seenHowTo (set by watching the demo, not by flying) - this is the
  // player's actual first flight, which previously started with no on-screen hint at all once the demo had
  // already flipped seenHowTo.
  function markFlightHintSeen() {
    if (save.seenFlightHint) return;
    save.seenFlightHint = true;
    persist();
    const el = root.querySelector("#cf-hint-flight");
    if (el) el.hidden = true;
  }

  let insideAir = new Set(); // indexes of course.air the plane is currently inside, for enter/exit whoosh/fan sounds
  function beginThrow(power) {
    inputHandle.releaseAll(); // CTO review B1: a throw is never a hold, even if one somehow carried over
    held = false;
    resetTrail();
    G.flight = startFlight(G.course, power, G.bestX);
    G.reaction = "neutral";
    G.reactionSince = 0; // far enough in the past that the first tick's reaction is never held back
    recentEvents = [];
    insideAir = new Set();
    touchdownAt = null;
    audio.playThrowSnap();
    audio.startSwish();
    showScreen("flight");
    if (!save.seenFlightHint) {
      const hintEl = root.querySelector("#cf-hint-flight");
      if (hintEl) hintEl.hidden = false;
      timers.add(FLIGHT_HINT_MS, markFlightHintSeen);
    }
    dispatchEvent(new CustomEvent("game:start", { detail: { courseId: G.courseId, mode: G.mode } }));
  }

  function onPullStart() { G.pullPx = 0; }
  function onPullMove(dx) { G.pullPx = Math.max(0, dx); }
  function onPullEnd(pullPx) {
    if (pullPx == null) { G.pullPx = 0; return; } // under the minimum: springs back, nothing counted
    const power = pullToPower(pullPx, PULL_MIN_PX, PULL_MAX_PX);
    G.pullPx = 0;
    if (power != null) beginThrow(power);
  }

  let recentEvents = []; // the current/last flight's events, for the test hook (design.md's events())
  function onHold(v) {
    if (!G.paused && !G.resuming) held = v;
    if (v && G.screen === "flight") markFlightHintSeen(); // THE-311: the first hold dismisses the flight hint early
  }

  // CTO review R1: the canvas sits BELOW the full-viewport `.cf-screen` sections (#cf-play included) in z-order,
  // so a real press during flight hit #cf-play and never reached a listener on the canvas itself - the hook's
  // hold(true)/hold(false) calls worked fine, which is why this didn't show up until a real-pointer probe did.
  // `root` (#cf-app) sits above everything and is present for the whole game lifetime, so one attach covers
  // every screen; data-hud-control on the pause tab (the only other clickable thing under #cf-play) keeps a
  // press there from starting a hold.
  const inputHandle = attachInput(root, {
    pullStart: onPullStart, pullMove: onPullMove, pullEnd: onPullEnd, hold: onHold,
  }, () => (G.paused || G.resuming ? "none" : G.screen === "flight" ? "flight" : G.screen === "ledge" ? "ledge" : "none"));

  function onFlightEnd() {
    const result = flightResult(G.flight);
    G.result = result;
    G.bestX = Math.max(G.bestX, G.flight.f.maxX);
    const landed = result.kind === "land";
    dispatchEvent(new CustomEvent("game:over", { detail: { score: result.score } }));
    // "probe" mode (QA's real-pointer engagement probes, an arbitrary seed via the test hook) never touches the
    // save at all - it isn't a pack course or a real daily, and must never overwrite the player's actual record.
    if (G.mode !== "probe") {
      save.lucky += result.luckyStars;
      if (landed) save.landings++;
      if (G.mode === "pack") {
        save.courses = mergeCourseBest(save.courses, G.courseId, result.stars, result.score, result.distanceM, landed);
      } else {
        // CTO review B6: reads G.dailyDate (captured once in startDaily()), not now() - a flight that started
        // at 23:59 and finished after midnight must still save under the day it was actually played, not
        // whichever day now() returns by the time the flight ends (up to ~45s later, a real crossing risk).
        const { y, m, d } = G.dailyDate || localDateParts(now());
        save.daily = mergeDaily(save.daily, y, m, d, result, result.score, result.distanceM);
      }
      save.folds = unlockedFolds(save);
      persist();
    }
    touchdownAt = performance.now();
    showScreen("touchdown");
    timers.add(TOUCHDOWN_MS, () => {
      showScreen("result");
      if (result.kind === "land") audio.playLandingStars(result.stars);
      if (result.isNewBest) audio.playNewBestStamp();
    });
  }

  // CTO review R2: theme.images.pilot, when set, replaces every rasterised pilot.js face (porthole + the result
  // pass stub) with the re-skin's own art - a circular crop matches the porthole/pass stub's own clip-path, so
  // the same drawn image works in both spots without per-call-site cropping logic.
  function drawFaceInto(canvas, expr, size) {
    if (themeImages.pilot) {
      canvas.width = size;
      canvas.height = size;
      canvas.getContext("2d").drawImage(themeImages.pilot, 0, 0, size, size);
      return;
    }
    facePNG(expr, size).then((cv) => {
      canvas.width = cv.width;
      canvas.height = cv.height;
      canvas.getContext("2d").drawImage(cv, 0, 0);
    });
  }

  const faceCanvas = root.querySelector("#cf-porthole-face");
  let lastFaceExpr = null;
  let lastFacePilotImg = null; // forces one redraw when theme.images.pilot resolves after the first paint
  function updatePortholeFace() {
    const expr = REACTION_TO_EXPR[G.reaction] || "neutral";
    if (expr === lastFaceExpr && themeImages.pilot === lastFacePilotImg) return;
    if (!faceCanvas) return;
    lastFaceExpr = expr;
    lastFacePilotImg = themeImages.pilot;
    const size = Math.round((faceCanvas.clientWidth || 134) * Math.min(2, window.devicePixelRatio || 1)) || 134;
    drawFaceInto(faceCanvas, expr, size);
  }

  function fillResultPass() {
    const r = G.result;
    if (!r) return;
    const headline = root.querySelector("#cf-result-headline");
    if (headline) headline.textContent = r.kind === "land" ? (theme.text?.resultLanded || "What a landing!") : (theme.text?.resultCrashed || "Crumpled!");
    const courseEl = root.querySelector("#cf-result-course");
    if (courseEl) courseEl.textContent = G.mode === "daily" ? (theme.text?.dailyLabel || "Daily flight") : G.mode === "probe" ? "Test flight" : `Course ${G.courseId}`;
    const nameEl = root.querySelector("#cf-result-name");
    if (nameEl) nameEl.textContent = theme.text?.captainName || "THE CAPTAIN";
    const metricLabel = root.querySelector("#cf-result-metric-label");
    const valueEl = root.querySelector("#cf-result-value");
    if (metricLabel && valueEl) {
      valueEl.textContent = "";
      const small = document.createElement("small");
      if (r.kind === "land") {
        metricLabel.textContent = "Score";
        valueEl.append(String(r.score));
        small.textContent = "pts";
      } else {
        metricLabel.textContent = "Distance";
        valueEl.append(String(r.distanceM));
        small.textContent = "m";
      }
      valueEl.append(small);
    }
    const starsEl = root.querySelector("#cf-result-stars");
    if (starsEl) {
      starsEl.innerHTML = "";
      const stars = r.kind === "land" ? r.stars : 0;
      for (let i = 0; i < 3; i++) {
        const star = document.createElement("span");
        star.className = i < stars ? "cf-star is-lit" : "cf-star";
        starsEl.appendChild(star);
      }
    }
    const luckyEl = root.querySelector("#cf-result-lucky");
    if (luckyEl) luckyEl.textContent = String(r.luckyStars);
    const bestEl = root.querySelector("#cf-result-best");
    if (bestEl) {
      // THE-312: course/daily best, not a duplicate of the Score field above - save.courses/save.daily was
      // already merged with this run's result in onFlightEnd(), so its best is this run's own score when
      // isNewBest is true. "probe" mode (QA's test hook) never touches the save, so fall back to this run's score.
      const best = G.mode === "pack" ? save.courses[G.courseId]?.best : G.mode === "daily" ? save.daily?.best : null;
      bestEl.textContent = String(best ?? r.score);
    }
    const passEl = root.querySelector("#cf-result-pass");
    if (passEl) passEl.dataset.fold = save.fold;
    const nextNote = root.querySelector("#cf-result-next-note");
    if (nextNote) {
      nextNote.textContent = "";
      const strong = document.createElement("strong");
      strong.textContent = r.isNewBest ? "New best!" : "Fly again?";
      nextNote.appendChild(strong);
    }
    const stamp = root.querySelector("#cf-stamp");
    if (stamp) stamp.classList.toggle("is-in", !!r.isNewBest);
    const stubFace = root.querySelector("#cf-result-face");
    if (stubFace) {
      const expr = r.isNewBest ? "best" : r.kind === "land" ? "wave" : "crash";
      const size = Math.round((stubFace.clientWidth || 84) * Math.min(2, window.devicePixelRatio || 1)) || 84;
      drawFaceInto(stubFace, expr, size);
    }
  }

  function updateHud() {
    const distEl = root.querySelector(".cf-tape__num");
    if (distEl && G.flight) distEl.textContent = String(Math.round(Math.min(G.flight.f.maxX, G.course.L) / PX_PER_M));
    const tapeEl = root.querySelector("#cf-tape");
    if (tapeEl && G.flight) tapeEl.style.setProperty("--tape-m", String(Math.round(Math.min(G.flight.f.maxX, G.course.L) / PX_PER_M)));
    const tagEl = root.querySelector(".cf-tag__num");
    if (tagEl && G.flight) tagEl.textContent = String(G.flight.f.starsTaken.size);
    const nextBtn = root.querySelector("#cf-btn-next");
    // CTO review non-blocking item: no pack-complete screen for launch - on the last course, hiding "Next
    // course" (FLY AGAIN and the Hangar are still there) beats it silently replaying the same course.
    const isLastCourse = G.courseId === PACK[PACK.length - 1]?.id;
    const showNext = G.mode === "pack" && G.result?.kind === "land" && !isLastCourse;
    if (nextBtn) nextBtn.hidden = !showNext;
    // THE-312: the result screen's secondary row is a 2-up pair (Next course|Share or Home|Share) - Home only
    // fills that second slot when there's no next course to show, never stacked alongside it.
    const homeBtn = root.querySelector("#cf-btn-home");
    if (homeBtn) homeBtn.hidden = showNext;
    const porthole = root.querySelector("#cf-porthole");
    if (porthole) {
      porthole.dataset.reaction = G.reaction;
      if (faceSwapPending) {
        // THE-306: force a reflow between remove/add so the squash keyframes (skin.css .is-swap) replay on
        // every real swap, not just the first one - adding an already-present class doesn't restart a CSS
        // animation.
        porthole.classList.remove("is-swap");
        void porthole.offsetWidth;
        porthole.classList.add("is-swap");
        faceSwapPending = false;
      }
      // THE-304: the grace clock ring (DESIGN.md S6.3) - sweeps 0 to 1 over the first GRACE_S of flight time,
      // then turns ink. G.flight is null outside "flight" (title/ledge/touchdown/result), so reset to 0 there.
      const grace = G.flight ? Math.min(1, G.flight.f.t / P.GRACE_S) : 0;
      porthole.style.setProperty("--grace", String(grace));
      porthole.classList.toggle("is-spent", grace >= 1);
    }
    updatePortholeFace();
  }

  let lastTs = 0;
  let faceSwapPending = false; // THE-306: set when latchReaction() actually changes G.reaction, consumed by
  // updateHud() to retrigger the porthole's .is-swap squash (DESIGN.md 6.3) exactly once per real swap.
  let touchdownAt = null; // performance.now() at the moment onFlightEnd() fires; drives the crumple-bounce/
  // touchdown-slide animation's elapsed time, since the flight's own clock (f.t) freezes once f.over is set.
  // CTO review B3: frame() used to be called directly by both the real rAF loop AND the test hook's step() -
  // but frame() itself always called requestAnimationFrame(frame) again regardless of who invoked it, so every
  // step() call left one more real rAF callback running in the background (step(200) left ~200 loops alive:
  // HUD writes went from 16 to 201 per 500ms). update() is the actual per-frame work and schedules nothing;
  // frame() is the real rAF loop's own entry point, calling update() then rescheduling itself; step() calls
  // update() directly and never touches requestAnimationFrame at all.
  function update(ts) {
    const dt = lastTs ? (ts - lastTs) / 1000 : 0;
    lastTs = ts;
    if (G.screen === "flight" && G.flight && !G.paused && !G.resuming) {
      const { reaction, events } = tick(G.flight, held, dt, ts, pushTrailPoint);
      const latched = latchReaction(G.reaction, G.reactionSince, reaction, ts);
      if (latched.reaction !== G.reaction) faceSwapPending = true;
      G.reaction = latched.reaction;
      G.reactionSince = latched.since;
      if (events.length) recentEvents.push(...events);
      for (const ev of events) {
        if (ev === "star") audio.playLuckyStar();
        else if (ev === "bounce") audio.playBounce();
        else if (ev === "crash") audio.playCrumple();
      }
      const f = G.flight.f;
      audio.updateSwish(f.v, f.stalled);
      const nowInside = new Set();
      for (let i = 0; i < G.course.air.length; i++) {
        const a = G.course.air[i];
        if (f.x < a.x || f.x > a.x + a.w || f.y < a.y0 || f.y > a.y1) continue;
        nowInside.add(i);
        if (!insideAir.has(i)) { if (a.kind === "up") audio.playUpdraftWhoosh(); else if (a.kind === "fan") audio.playFan(); }
      }
      insideAir = nowInside;
      if (G.flight.f.over) {
        audio.stopSwish();
        if (G.flight.f.result?.kind === "land") audio.playTouchdownSlide();
        onFlightEnd();
      }
    }
    if ((G.screen === "flight" || G.screen === "ledge" || G.screen === "touchdown") && G.course) {
      // "touchdown" (the TOUCHDOWN_MS window between a flight ending and the result screen) must keep drawing:
      // the crash crumple-bounce and the landing touchdown-slide (DESIGN.md S6.2/S9) both animate across exactly
      // this window. core.js's step() returns immediately once f.over is set, so f.t freezes at the moment of
      // crash/landing - it can't drive this animation. opts.touchdownElapsedS is wall-clock time since
      // showScreen("touchdown"), tracked separately below.
      const pullPower = G.screen === "ledge" && save.settings.arc ? pullToPower(G.pullPx, PULL_MIN_PX, PULL_MAX_PX) : null;
      const touchdownElapsedS = G.screen === "touchdown" && touchdownAt != null ? (ts - touchdownAt) / 1000 : null;
      drawWorld(ctx, canvas.clientWidth, canvas.clientHeight, G.course, G.flight || { f: { x: 60, y: P.LAUNCH_Y, a: P.LAUNCH_ANGLE, t: 0, stalled: false, knocked: new Set(), starsTaken: new Set() } }, { throwArcPower: pullPower, bestX: G.bestX, touchdownElapsedS, trail, trailDropped, reduceMotion: motionReduced() });
    }
    if (G.screen === "title") {
      // THE-309: redraw a fresh backdrop every frame - without this the canvas under the title kept whatever
      // the demo or last flight had drawn (a washing line, an updraft column, a half-drawn star).
      drawTitleBackdrop(ctx, canvas.clientWidth, canvas.clientHeight);
      drawHero(ts); // the idle bob (DESIGN.md S6.2) needs a redraw every frame, not once
    }
    updateHud();
  }

  function frame(ts) {
    update(ts);
    requestAnimationFrame(frame);
  }

  // --- comforts: pause anywhere + auto-pause on tab-away, no stuck hold, restart from pause ---
  const pauseDialog = root.querySelector("#cf-pause");
  function pause() {
    if (G.screen !== "flight" && G.screen !== "ledge") return;
    if (G.paused || G.resuming) return; // mid-countdown: let it finish rather than overlapping a second one
    G.paused = true;
    held = false;
    audio.updateSwish(0, false); // silence the in-flight bed while paused; resume's own ticks restore it
    pauseDialog?.showModal?.();
  }
  // The dialog's own "close" event is the single source of truth for leaving the paused state - it fires
  // whether the dialog closed via the Resume button, Escape (the browser's native dialog behavior), or
  // .close() from Restart/Hangar. Driving resume() from a second, hand-rolled Escape check race-loses against
  // the browser: opening the dialog with showModal() from inside the same "Escape" keydown handler that
  // triggered pause() lets the browser's native Escape-closes-the-topmost-dialog behavior close it again in the
  // same pass, before the modal ever renders (found while smoke-testing M3: `state().paused` flips true but the
  // dialog's `open` attribute never does).
  function resume() {
    if (!G.paused) return;
    G.paused = false;
    G.resuming = true;
    const countdown = root.querySelector("#cf-countdown");
    const stepMs = RESUME_COUNTDOWN_MS / 3; // a real 3-2-1 tick-down, not one static digit for the whole window
    const showCount = (n) => { if (countdown) { countdown.hidden = false; countdown.textContent = String(n); countdown.dataset.n = String(n); } audio.playResumeCount(n); };
    showCount(3);
    timers.add(stepMs, () => showCount(2));
    timers.add(stepMs * 2, () => showCount(1));
    timers.add(RESUME_COUNTDOWN_MS, () => { G.resuming = false; if (countdown) countdown.hidden = true; });
  }
  pauseDialog?.addEventListener("close", () => { if (G.paused) resume(); });
  window.addEventListener("keydown", (e) => {
    if (e.code === "Escape") {
      // Deferred: calling showModal() synchronously inside the same Escape keydown still races the browser's
      // own "Escape closes the open dialog" handling for <dialog> (a close-watcher, not a plain event listener -
      // preventDefault() on this event does not stop it), so the dialog we just opened closes itself again in
      // the same pass. Pushing the open to a fresh task lets that native handling (which finds nothing open at
      // dispatch time) finish first.
      if (!G.paused) setTimeout(pause, 0);
    } else if (e.key === "p" || e.key === "P") { if (G.paused) pauseDialog?.close?.(); else pause(); }
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
  window.addEventListener("blur", () => pause());

  // Restart/Hangar leave the paused screen entirely rather than resuming flight - clearing G.paused directly
  // (instead of going through the dialog's "close" -> resume() path) skips the 3-2-1 countdown, which has
  // nothing to count into since loadCourse()/showScreen() are about to tear the flight down anyway.
  function leavePause(then) { G.paused = false; pauseDialog?.close?.(); then(); }
  root.querySelector("#cf-btn-pause")?.addEventListener("click", pause);
  root.querySelector("#cf-btn-resume")?.addEventListener("click", () => pauseDialog?.close?.());
  root.querySelector("#cf-btn-restart")?.addEventListener("click", () => leavePause(() => { dispatchEvent(new CustomEvent("game:restart")); loadCourse(G.courseId, G.course); }));
  root.querySelector("#cf-btn-pause-hangar")?.addEventListener("click", () => leavePause(() => showScreen("hangar")));

  // --- how-to and settings dialogs ---
  // THE-310: the sheet is the kit's step-through carousel (ui-kit.js howTo()) now, not a static text list, so
  // opening it just shows/advances cards - there's no separate "got it" handler to also mark seenHowTo.
  const howToDialog = root.querySelector("#cf-howto");
  const howTo = window.UIKit?.howTo(howToDialog, { onClose: () => { save.seenHowTo = true; persist(); renderTitle(); } });
  // drawWorld's plane-frame rasterisation is async and only warms up once a real flight has reached the
  // ledge/flight screen (render.js ensurePlaneFrames) - opening How to fly before that (e.g. straight from a
  // fresh title screen) draws the flat placeholder dart on the first pass. One retry past that window is enough
  // to pick up the real folded-paper plane without redrawing 3 static cards every frame for as long as the
  // sheet stays open.
  function openHowTo() { howTo?.open(); drawHowToArt(); timers.add(400, drawHowToArt); }
  root.querySelector("#cf-btn-howto")?.addEventListener("click", openHowTo);
  root.querySelector("#cf-btn-pause-howto")?.addEventListener("click", openHowTo);

  // Any tap anywhere skips the demo (spec S5).
  const demoScreen = root.querySelector("#cf-demo");
  demoScreen?.addEventListener("pointerdown", () => activeDemo?.skip());
  root.querySelector("#cf-btn-demo-skip")?.addEventListener("click", (e) => { e.stopPropagation(); activeDemo?.skip(); });

  const settingsDialog = root.querySelector("#cf-settings");
  const soundInput = root.querySelector("#cf-setting-sound");
  const arcInput = root.querySelector("#cf-setting-arc");
  const motionInput = root.querySelector("#cf-setting-motion");
  root.querySelector("#cf-btn-settings")?.addEventListener("click", () => {
    if (soundInput) soundInput.checked = save.settings.sound;
    if (arcInput) arcInput.checked = save.settings.arc;
    if (motionInput) motionInput.checked = save.settings.motion;
    settingsDialog?.showModal?.();
  });
  root.querySelector("#cf-btn-settings-close")?.addEventListener("click", () => {
    save.settings = { sound: !!soundInput?.checked, arc: !!arcInput?.checked, motion: !!motionInput?.checked, shake: save.settings.shake };
    persist();
    applyMotion();
    audio.setMuted(!save.settings.sound);
    settingsDialog?.close?.();
  });

  // --- title, hangar, result actions ---
  root.querySelector("#cf-btn-throw")?.addEventListener("click", () => startCourse(nextCourseId(save.courses)));
  root.querySelector("#cf-btn-daily")?.addEventListener("click", startDaily);
  root.querySelector("#cf-btn-hangar")?.addEventListener("click", () => showScreen("hangar"));
  root.querySelector("#cf-btn-hangar-back")?.addEventListener("click", () => showScreen("title"));
  root.querySelector("#cf-btn-again")?.addEventListener("click", () => { dispatchEvent(new CustomEvent("game:restart")); loadCourse(G.courseId, G.course); });
  root.querySelector("#cf-btn-next")?.addEventListener("click", () => {
    // Always the next course in pack order (the Hangar/title "continue" logic is a different button's job).
    const i = PACK.findIndex((c) => c.id === G.courseId);
    const next = PACK[Math.min(PACK.length - 1, i + 1)];
    if (next) startCourse(next.id);
  });
  root.querySelector("#cf-btn-home")?.addEventListener("click", () => showScreen("title"));
  root.querySelector("#cf-btn-share")?.addEventListener("click", async () => {
    // CTO review B6: reads G.dailyDate (the day the daily was actually played), not now() - sharing after
    // midnight must not silently relabel the result under the new day's number.
    const { y, m, d } = G.dailyDate || localDateParts(now());
    // Pack courses share the same "No. / line / url" format as the daily (CTO review follow-up) - "No." is the
    // course id (e.g. "1-4") rather than a daily sequence number, since pack courses have no day to count from.
    const text = G.mode === "daily" && save.daily
      ? shareText(dailyNumber(y, m, d), save.daily)
      : shareText(G.courseId, { result: G.result?.kind, stars: G.result?.stars, best: G.result?.distanceM });
    try { await navigator.clipboard.writeText(text); } catch { /* clipboard may be unavailable (no permission, insecure context); the text is still on screen */ }
  });

  // A single delegated listener for the tab "tk" (DESIGN.md S7): every .cf-tab/.cf-link press, anywhere in the
  // app, gets the same short click - cheaper and harder to miss one of than wiring it into each button handler.
  root.addEventListener("pointerdown", (e) => {
    if (e.target?.closest?.(".cf-tab, .cf-link")) audio.playTabTk();
  });

  applyTheme();
  applyMotion();
  applyFold();
  audio.setMuted(!save.settings.sound);
  resizeCanvas();
  requestAnimationFrame(frame);
  showScreen("title");

  // Test hook (design.md): drives the game headlessly for the engagement-gate probes and QA scripts.
  window.__captainFold = {
    seed: () => G.course?.seed ?? null,
    loadCourse: (idOrSeedD) => (typeof idOrSeedD === "string" ? startCourse(idOrSeedD) : startArbitrary(idOrSeedD)),
    loadDaily: (y, m, d) => { G.mode = "daily"; G.dailyDate = { y, m, d }; loadCourse(`daily-${y}-${m}-${d}`, dailyCourse(y, m, d)); },
    throw(power) { if (G.screen === "ledge") beginThrow(power); },
    hold(v) { held = v; },
    step(n = 1) { for (let i = 0; i < n; i++) update((lastTs || 0) + 1000 / 120); },
    events: () => recentEvents.slice(),
    state() {
      const f = G.flight?.f;
      return {
        screen: G.screen,
        t: f?.t ?? 0, x: f?.x ?? 0, y: f?.y ?? 0, v: f?.v ?? 0, a: f?.a ?? 0,
        stalled: f?.stalled ?? false, bounces: f?.bounces ?? 0, over: f?.over ?? false,
        knocked: f ? [...f.knocked] : [], // an external bot (QA's real-pointer probes) needs this for pilot()'s obstacle logic
        result: G.result, reaction: G.reaction, paused: G.paused,
      };
    },
    score() { return G.result?.score ?? null; },
    save() { return save; },
    setSpeed() { /* the sim scale is handled by the reaction-cadence probes directly stepping the game; no-op here */ },
  };

  return { loadCourse: startCourse, showScreen };
}

createGame(document.getElementById("cf-app"));
