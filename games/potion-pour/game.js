(function () {
  "use strict";

  const K = window.UIKit;
  const R = window.PotionRender;
  const Shelf = window.PotionPourShelf;
  const Save = window.PotionPourSave;
  const LEVELS = window.POTION_POUR_LEVELS;
  const theme = K.applyTheme(window.THEME);
  const store = K.store("potion-pour");
  const $ = (id) => document.getElementById(id);
  const CHAPTER_NAMES = (theme.chapters && theme.chapters.length) ? theme.chapters : ["Chapter 1"];

  // Fills `{name}` placeholders in a theme.text value with the given vars (all player-facing copy that needs
  // runtime numbers still comes from theme.js; only the templating lives in code).
  function T(key, vars) {
    let s = (theme.text && theme.text[key]) || key;
    if (vars) for (const k in vars) s = s.split("{" + k + "}").join(vars[k]);
    return s;
  }

  function now() {
    return performance.now();
  }
  function easeOut(p) {
    return 1 - Math.pow(1 - p, 3);
  }
  function easeSpring(p) {
    // matches --ease-spring's overshoot closely enough for a canvas-side interpolation
    const c4 = (2 * Math.PI) / 3;
    return p <= 0 ? 0 : p >= 1 ? 1 : Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * c4) + 1;
  }
  function easeInOut(p) {
    return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
  }
  function clamp01(p) {
    return Math.max(0, Math.min(1, p));
  }

  const canvas = $("shelf");
  const ctx = canvas.getContext("2d");
  const demoCanvas = $("demo-overlay");
  const demoCtx = demoCanvas.getContext("2d");
  const hudEl = $("hud");
  const cornerEl = $("corner");
  const levelLabelEl = $("levellabel");
  const pourscountEl = $("pourscount");
  const starsChipEls = Array.from(document.querySelectorAll("#starschip .hud-star"));
  const restartBtn = $("restart-btn");
  const hintBtn = $("hint-btn");
  const hintCountEl = $("hint-count");
  const undoBtn = $("undo-btn");
  const undoCountEl = $("undo-count");
  const extraVialBtn = $("extra-vial-btn");
  const extraVialCountEl = $("extra-vial-count");
  const dailyBestEl = $("daily-best");
  const playLevelEl = $("play-level");
  const deadendDialog = $("deadend");
  const deadendUndoCountEl = $("deadend-undo-count");
  const deadendVialCountEl = $("deadend-vial-count");
  const deadendLoopBadgeEl = $("deadend-loop-badge");

  // ---------- tokens (read once; canvas code never hard-codes a colour, size or duration) ----------

  function readTokens() {
    const css = getComputedStyle(document.documentElement);
    const t = (name) => css.getPropertyValue(name).trim();
    const num = (name) => parseFloat(t(name)) || 0;
    return {
      lift: num("--lift") || 0.24,
      liftDur: num("--lift-dur") || 140,
      carryDur: num("--carry-dur") || 220,
      tiltMin: num("--tilt-min") || 70,
      tiltMax: num("--tilt-max") || 115,
      streamBase: num("--stream-base") || 160,
      streamPerLayer: num("--stream-per-layer") || 90,
      returnDur: num("--return-dur") || 200,
      sloshDur: num("--slosh-dur") || 420,
      nopeDur: num("--nope-dur") || 300,
      corkDur: num("--cork-dur") || 260,
      shimmerDur: num("--shimmer-dur") || 700,
      popDur: num("--pop-dur") || 520,
      dealStagger: num("--deal-stagger") || 60,
      vialWMax: num("--vial-w-max") || 72,
      shakePx: num("--shake-px") || 0,
      clearHushDur: num("--clear-hush-dur") || 200,
      clearWaveStagger: num("--clear-wave-stagger") || 60,
      clearShimmerDur: num("--clear-shimmer-dur") || 260,
      clearHoldDur: num("--clear-hold-dur") || 900,
      clearShakeDur: num("--clear-shake-dur") || 140,
      accent: t("--color-accent"),
      danger: t("--color-danger"),
      ink: t("--color-outline"),
      cream: t("--color-surface"),
      rune: t("--color-rune"),
      textOnBg: t("--color-text-on-bg"),
    };
  }
  let TOK = readTokens();

  // Potion colours never change mid-session (theme.js overrides, if any, are applied once at boot via
  // K.applyTheme before this runs), so they're read from the CSS once and cached, not on every call -- this is
  // called per vial, per frame, during draw().
  const potionColorCache = [];
  function colorForPotion(id) {
    const idx = id % 12;
    if (potionColorCache[idx] === undefined) {
      const css = getComputedStyle(document.documentElement);
      potionColorCache[idx] = css.getPropertyValue(`--color-potion-${idx + 1}`).trim();
    }
    return potionColorCache[idx];
  }

  // ---------- game state ----------

  const G = {
    screen: "start", // "start" | "play" | "demo"
    levelNumber: null,
    isDaily: false,
    lvlMeta: null, // { colors, capacity, par, chapter, unlimitedUndo }
    initialVials: null,
    shelfState: null,
    selected: null,
    focusIndex: 0,
    history: [],
    pours: 0,
    undosLeft: 2,
    hintsLeft: 3,
    extraVialLeft: 1,
    anims: [], // pour animations: { a, b, color, amount, preA, preB, capacity, t0, tiltDur, streamDur, sloshDur, returnDur }
    wobbles: [], // { vial, t0, dur }
    liftT: {}, // vialIndex -> { t0, dir: 'up'|'down' }
    pops: [], // { vial, t0, colorIdx }
    ripples: [], // { x, y, t0 }
    dealT0: 0,
    deadEndReveal: null, // { stuckIdxs, t0 }
    hint: null, // { a, b, t0 }
    clearWave: null, // { t0 } set by onLevelClear: drives the tag shimmer wave + clink nudge on the finished
    // shelf during the "clear-pending" hold, before the level-clear card slides up (THE-125)
    paused: false,
    speedMul: 1,
    showFit: true,
    settleTimers: [], // pending afterPourSettles() timeout ids, tagged with the shelfGen they belong to
    shelfGen: 0, // bumped by loadLevelData/resetCurrentLevel/backToMenu/playGhostDemo so a settle timer whose
    // shelf has since been replaced (a new level, a reset, the menu, the demo) can tell it's stale and no-op,
    // without also silencing the *current* demo's own legitimate pop/cork/bell timers (CTO review THE-111).
  };

  // ---------- audio (generated, Web Audio; one master gain; all off with mute) ----------

  let audioCtx = null;
  function ensureAudio() {
    if (audioCtx) return audioCtx;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtx = new Ctx();
    } catch (e) {
      audioCtx = null;
    }
    return audioCtx;
  }
  // Cached instead of re-parsed from localStorage on every call (playGlug alone calls soundOn() roughly every
  // 110ms while a stream runs); refreshed by refreshSettingsCache() whenever a settings toggle actually changes.
  let settingsCache = null;
  function refreshSettingsCache() {
    settingsCache = Save.sanitizeSettings(store.get("settings", null));
    return settingsCache;
  }
  function soundOn() {
    return (settingsCache || refreshSettingsCache()).sound !== false;
  }
  function vibrationOn() {
    return (settingsCache || refreshSettingsCache()).vibration === true;
  }
  function haptic(ms) {
    if (vibrationOn() && navigator.vibrate) {
      try { navigator.vibrate(ms); } catch (e) {}
    }
  }

  function tone(ac, freq, startAt, dur, gainPeak, type, freqEnd) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freq, startAt);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), startAt + dur);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(gainPeak, startAt + Math.min(dur * 0.3, 0.02));
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + dur);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(startAt);
    osc.stop(startAt + dur + 0.02);
  }
  // A short burst of band-passed noise, for the glug and the undo slurp.
  function noiseBurst(ac, startAt, dur, gainPeak, freq, q) {
    const bufSize = Math.max(1, Math.floor(ac.sampleRate * dur));
    const buf = ac.createBuffer(1, bufSize, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource();
    src.buffer = buf;
    const filt = ac.createBiquadFilter();
    filt.type = "bandpass";
    filt.frequency.value = freq;
    filt.Q.value = q || 4;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(gainPeak, startAt + Math.min(dur * 0.2, 0.01));
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + dur);
    src.connect(filt);
    filt.connect(gain);
    gain.connect(ac.destination);
    src.start(startAt);
    src.stop(startAt + dur + 0.02);
  }

  function playTink() {
    if (!soundOn()) return;
    const ac = ensureAudio();
    if (!ac) return;
    const t0 = ac.currentTime + 0.005;
    tone(ac, 1320, t0, 0.07, 0.1, "sine");
    tone(ac, 2640, t0, 0.06, 0.05, "sine");
  }
  // One glug pulse; `fillFrac` (0..1, how full the target already is) raises the band-pass centre, "like a real
  // bottle filling" (design brief §13).
  function playGlug(fillFrac) {
    if (!soundOn()) return;
    const ac = ensureAudio();
    if (!ac) return;
    const t0 = ac.currentTime + 0.005;
    noiseBurst(ac, t0, 0.06, 0.14, 300 + 480 * clamp01(fillFrac), 4);
    tone(ac, 380, t0, 0.09, 0.06, "sine", 220);
  }
  function playPlip() {
    if (!soundOn()) return;
    const ac = ensureAudio();
    if (!ac) return;
    tone(ac, 900, ac.currentTime + 0.005, 0.05, 0.1, "sine", 1400);
  }
  function playUhUh() {
    if (!soundOn()) return;
    const ac = ensureAudio();
    if (!ac) return;
    const t0 = ac.currentTime + 0.005;
    tone(ac, 392, t0, 0.08, 0.05, "triangle", 330); // G4 -> E4
    tone(ac, 392, t0 + 0.1, 0.08, 0.05, "triangle", 330);
  }
  function playPopCorkBell() {
    if (!soundOn()) return;
    const ac = ensureAudio();
    if (!ac) return;
    const t0 = ac.currentTime + 0.005;
    const n = 5;
    for (let i = 0; i < n; i++) tone(ac, 600 + Math.random() * 600, t0 + i * 0.05, 0.03, 0.07, "sine");
    tone(ac, 180, t0 + 0.3, 0.05, 0.12, "triangle");
    noiseBurst(ac, t0 + 0.3, 0.03, 0.08, 900, 2);
    [1046.5, 1318.5, 1568].forEach((f, i) => tone(ac, f, t0 + 0.4 + i * 0.02, 1.2, 0.09, "sine")); // C6 E6 G6
  }
  function playLevelClear() {
    if (!soundOn()) return;
    const ac = ensureAudio();
    if (!ac) return;
    const t0 = ac.currentTime + 0.005;
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone(ac, f, t0 + i * 0.06, 0.18, 0.1, "sine"));
  }
  function playStarDing(i) {
    if (!soundOn()) return;
    const ac = ensureAudio();
    if (!ac) return;
    const freqs = [783.99, 987.77, 1174.66]; // G5 B5 D6
    tone(ac, freqs[i % 3], ac.currentTime + 0.005, 0.22, 0.1, "sine");
  }
  function playUndo() {
    if (!soundOn()) return;
    const ac = ensureAudio();
    if (!ac) return;
    noiseBurst(ac, ac.currentTime + 0.005, 0.2, 0.1, 700, 1.2);
  }
  function playExtraVial() {
    if (!soundOn()) return;
    const ac = ensureAudio();
    if (!ac) return;
    const t0 = ac.currentTime + 0.005;
    tone(ac, 2100, t0, 0.12, 0.08, "sine");
    tone(ac, 3150, t0, 0.1, 0.05, "sine");
  }
  function playHint() {
    if (!soundOn()) return;
    const ac = ensureAudio();
    if (!ac) return;
    const t0 = ac.currentTime + 0.005;
    [1318.5, 1568, 2093].forEach((f, i) => tone(ac, f, t0 + i * 0.05, 0.06, 0.05, "sine"));
  }
  function playHmm() {
    if (!soundOn()) return;
    const ac = ensureAudio();
    if (!ac) return;
    tone(ac, 330, ac.currentTime + 0.005, 0.25, 0.07, "sine", 290);
  }
  function playBrewAgain() {
    if (!soundOn()) return;
    const ac = ensureAudio();
    if (!ac) return;
    const t0 = ac.currentTime + 0.005;
    noiseBurst(ac, t0, 0.18, 0.06, 500, 1);
    tone(ac, 1320, t0 + 0.1, 0.07, 0.08, "sine");
  }

  // ---------- layout ----------

  // The rectangle left for the shelf after the HUD (design brief §4): a top bar + counter row in portrait, a
  // right rail instead of a bottom bar once the viewport turns landscape (matches the CSS media query on
  // .hud__helpers so the reserved space and the visible chrome always agree).
  function reservedArea() {
    const w = innerWidth, h = innerHeight;
    const landscape = w / h >= 1.2;
    if (landscape) return { x: 16, y: 88, w: w - 16 - 104, h: h - 88 - 16 };
    return { x: 16, y: 132, w: w - 32, h: h - 132 - 148 };
  }

  function computeLayout() {
    const n = G.shelfState ? G.shelfState.vials.length : 0;
    if (!n) return { W: 0, rects: [] };
    const area = reservedArea();
    const { W, rows } = R.layout(n, area, { wMax: TOK.vialWMax });
    const rects = [];
    for (const row of rows) for (const x of row.xs) rects.push({ x, y: row.y, W });
    return { W, rects };
  }

  function hitTest(px, py) {
    const { W, rects } = computeLayout();
    if (!W) return null;
    const H = R.vialH() * W;
    const halfCol = Math.max(W * 0.71, 22);
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (px >= r.x - halfCol && px <= r.x + halfCol && py >= r.y - H * 1.3 && py <= r.y + 10) return i;
    }
    return null;
  }

  // ---------- lift / busy tracking ----------

  function currentLiftFraction(idx) {
    const lt = G.liftT[idx];
    if (!lt) return idx === G.selected ? 1 : 0;
    const p = clamp01((now() - lt.t0) / (lt.dir === "up" ? TOK.liftDur : TOK.returnDur));
    const eased = lt.dir === "up" ? easeSpring(p) : 1 - easeOut(p);
    return eased;
  }

  // A vial is locked from new taps only while its pour animation is in the tilt+stream sub-phase (design brief
  // §1 "input during a pour" / feel-check item 8): once the stream ends, both source and target are tappable
  // again even though the source is still visually flying back -- pours are allowed to overlap.
  function isVialBusy(idx) {
    for (const a of G.anims) {
      if (a.a === idx || a.b === idx) {
        const elapsed = now() - a.t0;
        if (elapsed < a.tiltDur + a.streamDur) return true;
      }
    }
    return false;
  }

  // ---------- drawing ----------

  function drawSky(t, w, h) {
    // The starry dusk is the page background (style.css gradient); this just adds a few fixed cream stars and
    // a crescent moon so the cabinet doesn't float on an empty gradient. Kept static under reduced motion.
    ctx.save();
    ctx.fillStyle = TOK.textOnBg;
    ctx.globalAlpha = 0.8;
    const stars = [[0.08, 0.06], [0.85, 0.1], [0.15, 0.18], [0.92, 0.22], [0.5, 0.05]];
    for (const [fx, fy] of stars) {
      ctx.beginPath();
      ctx.arc(fx * w, fy * h, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(w * 0.88, h * 0.08, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(w * 0.88 + 7, h * 0.08 - 4, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function ringAt(c, x, y, r, alpha, color) {
    c.save();
    c.globalAlpha = alpha;
    c.setLineDash([r * 0.35, r * 0.28]);
    c.lineWidth = 3;
    c.strokeStyle = color;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.stroke();
    c.restore();
  }

  // The loop-case dead-end reveal (design brief §6): one circular-arrow badge, centred over the whole cabinet
  // and gently bobbing, fading in over the same ~300ms a per-vial ring would otherwise take.
  function drawLoopBadge(ctx, t, rects, W, Hh) {
    if (!rects.length || !G.deadEndReveal) return;
    const dt = t - G.deadEndReveal.t0;
    if (dt <= 0) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity;
    for (const r of rects) {
      minX = Math.min(minX, r.x - W * 0.8);
      maxX = Math.max(maxX, r.x + W * 0.8);
      minY = Math.min(minY, r.y - Hh);
    }
    const cx = (minX + maxX) / 2;
    const bob = Math.sin(dt / 480) * Hh * 0.06;
    const cy = minY - Hh * 0.55 + bob;
    R.drawLoopBadge(ctx, cx, cy, W * 0.55, clamp01(dt / 300));
  }

  function draw(t) {
    const w = innerWidth, h = innerHeight;
    ctx.clearRect(0, 0, w, h);
    // "clear-pending" and "clear" keep drawing the just-solved shelf (corked, tagged) through the level-clear
    // hold and behind the card once it's up, so the win reads as a win instead of the card covering it at once
    // (THE-125) -- the shelf stays the backdrop, with the top of it still visible around the panel.
    if ((G.screen !== "play" && G.screen !== "demo" && G.screen !== "clear-pending" && G.screen !== "clear") || !G.shelfState) return;

    // the level-clear "clink": a brief screen nudge right as the tag shimmer wave starts (DESIGN.md §16 item 10).
    let shakeX = 0;
    if (G.clearWave && TOK.shakePx > 0) {
      const dt = t - G.clearWave.t0 - TOK.clearHushDur;
      const shakeDur = TOK.clearShakeDur;
      if (dt >= 0 && dt < shakeDur) shakeX = Math.sin((dt / shakeDur) * Math.PI * 3) * TOK.shakePx * (1 - dt / shakeDur);
    }
    ctx.save();
    ctx.translate(shakeX, 0);
    drawSky(t, w, h);

    const { W, rects } = computeLayout();
    if (!W) { ctx.restore(); return; }
    const Hh = R.vialH() * W;
    // Design brief §6: the loop case (legal pours exist but the solver proves none leads anywhere) gets one
    // circular-arrow badge floating over the cabinet INSTEAD of the per-vial dashed-ring/bubble/ghost-rune
    // reveal below -- a plain "no-moves" dead end still gets the per-vial treatment.
    const isLoopReveal = !!(G.deadEndReveal && G.deadEndReveal.reason === "unsolvable");

    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      R.drawShelf(ctx, r.x - W * 0.8, r.x + W * 0.8, r.y + Hh * 0.02, W);
    }

    for (let i = 0; i < rects.length; i++) {
      const rect = rects[i];
      const vial = G.shelfState.vials[i];
      const anim = G.anims.find((a) => a.a === i || a.b === i);
      const wobble = G.wobbles.find((wb) => wb.vial === i);
      let x = rect.x, y = rect.y, tiltDeg = 0, liftFrac = 0, layers = vial.slice(), opts = {};

      // deal-in: vials drop onto the shelf one after another when a level starts/resets.
      const dealDelay = i * TOK.dealStagger;
      const dealElapsed = t - G.dealT0 - dealDelay;
      if (dealElapsed < 260) {
        const p = clamp01(dealElapsed / 260);
        y -= (1 - easeOut(Math.max(0, p))) * Hh * 0.6;
        if (dealElapsed < 0) continue; // not dealt in yet
      }

      if (anim && anim.a === i) {
        const elapsed = t - anim.t0;
        const target = rects[anim.b] || rect;
        if (elapsed < anim.tiltDur) {
          const p = clamp01(elapsed / anim.tiltDur);
          const ep = easeInOut(p);
          const px0 = { px: rect.x, py: rect.y - Hh * TOK.lift };
          const px1 = { px: target.x + Math.sign(target.x - rect.x || 1) * -W * 0.55, py: target.y - Hh * 0.55 };
          x = px0.px + (px1.px - px0.px) * ep;
          y = px0.py + (px1.py - px0.py) * ep;
          tiltDeg = Math.sign(target.x - rect.x || 1) * TOK.tiltMin * ep;
          liftFrac = 1;
          layers = vial.slice();
        } else if (elapsed < anim.tiltDur + anim.streamDur) {
          const p = clamp01((elapsed - anim.tiltDur) / anim.streamDur);
          const target = rects[anim.b] || rect;
          x = target.x + Math.sign(target.x - rect.x || 1) * -W * 0.55;
          y = target.y - Hh * 0.55;
          const dir = Math.sign(target.x - rect.x || 1);
          tiltDeg = dir * (TOK.tiltMin + (TOK.tiltMax - TOK.tiltMin) * p);
          liftFrac = 1;
          opts.drain = p;
          layers = anim.preA.slice();
          if (soundOn() && (!anim.lastGlugAt || t - anim.lastGlugAt >= 110)) {
            playGlug((anim.preB.length + anim.amount * p) / anim.capacity);
            anim.lastGlugAt = t;
          }
        } else {
          // return: fly back to the shelf, upright.
          const p = clamp01((elapsed - anim.tiltDur - anim.streamDur) / anim.returnDur);
          const ep = easeOut(p);
          const target = rects[anim.b] || rect;
          const flyX = target.x + Math.sign(target.x - rect.x || 1) * -W * 0.55;
          const flyY = target.y - Hh * 0.55;
          const dir = Math.sign(target.x - rect.x || 1);
          x = flyX + (rect.x - flyX) * ep;
          y = flyY + (rect.y - Hh * TOK.lift - flyY) * ep;
          tiltDeg = dir * TOK.tiltMax * (1 - ep);
          liftFrac = 1 - ep;
          layers = G.shelfState.vials[i].slice();
        }
      } else if (anim && anim.b === i) {
        const elapsed = t - anim.t0;
        if (elapsed < anim.tiltDur) {
          layers = vial.slice();
        } else if (elapsed < anim.tiltDur + anim.streamDur) {
          const p = clamp01((elapsed - anim.tiltDur) / anim.streamDur);
          layers = anim.preB.slice();
          opts.fill = { idx: anim.color, amount: p, layers: anim.amount };
        } else {
          const p = clamp01((elapsed - anim.tiltDur - anim.streamDur) / anim.sloshDur);
          layers = G.shelfState.vials[i].slice();
          opts.slosh = 1 - p;
          if (!anim.rippled) {
            anim.rippled = true;
            G.ripples.push({ x: rect.x, y: rect.y - Hh * 0.55, t0: t });
            playPlip();
          }
        }
      } else if (wobble) {
        const elapsed = t - wobble.t0;
        const p = clamp01(elapsed / wobble.dur);
        tiltDeg = Math.sin(p * Math.PI * 3) * 7 * (1 - p);
        liftFrac = 1;
        opts.nope = true;
      } else if (i === G.selected) {
        liftFrac = currentLiftFraction(i);
      } else if (G.liftT[i]) {
        liftFrac = currentLiftFraction(i);
      }

      opts.lift = liftFrac;
      opts.tilt = tiltDeg;
      if (i === G.selected && !wobble) opts.glow = true;
      if (G.hint && (i === G.hint.a || i === G.hint.b)) opts.hint = true;
      if (G.showFit && G.selected !== null && G.selected !== i && !anim && Shelf.canPour(G.shelfState, G.selected, i)) opts.hint = true;

      // a completed vial gets a cork + rune tag once, and stays corked at rest.
      const solvedFull = Shelf.isVialSolved(vial, G.shelfState.capacity) && vial.length === G.shelfState.capacity;
      if (solvedFull && !anim) {
        opts.cork = 1;
        opts.tag = vial[0];
        // level clear: the tags shimmer in a wave, left to right, once the hush ends (THE-125).
        if (G.clearWave) {
          const start = G.clearWave.t0 + TOK.clearHushDur + i * TOK.clearWaveStagger;
          const sk = (t - start) / TOK.clearShimmerDur;
          if (sk >= 0 && sk < 1) opts.shimmer = sk;
        }
      }
      if (!isLoopReveal && G.deadEndReveal && G.deadEndReveal.stuckIdxs.includes(i)) {
        const dt = t - G.deadEndReveal.t0 - G.deadEndReveal.stuckIdxs.indexOf(i) * 120;
        if (dt > 0) {
          opts.hint = true;
          const full = vial.length === G.shelfState.capacity;
          ringAt(ctx, x, y - Hh * 0.9, W * 0.42, 0.9, TOK.accent);
          if (full) {
            ctx.save();
            ctx.globalAlpha = clamp01(dt / 300);
            R.drawRune(ctx, vial[vial.length - 1], x, y - Hh * 1.15, W * 0.34, TOK.rune, TOK.accent);
            ctx.restore();
          } else {
            ctx.save();
            ctx.globalAlpha = 0.5 * clamp01(dt / 300);
            R.drawRune(ctx, vial[vial.length - 1] !== undefined ? vial[vial.length - 1] : 0, x, y - Hh * (0.3 + 0.78 * vial.length), W * 0.3, TOK.rune, TOK.accent);
            ctx.restore();
          }
        }
      }

      R.drawVial(ctx, x, y, W, layers, opts);

      const pop = G.pops.find((pp) => pp.vial === i);
      if (pop) {
        const k = clamp01((t - pop.t0) / TOK.popDur);
        R.drawPop(ctx, x, y - Hh, W, pop.colorIdx, k);
        if (k >= 1) G.pops.splice(G.pops.indexOf(pop), 1);
      }
    }

    if (isLoopReveal) drawLoopBadge(ctx, t, rects, W, Hh);

    // pour streams (world space, drawn after every vial so they sit on top of the glassware)
    for (const anim of G.anims) {
      const elapsed = t - anim.t0;
      if (elapsed >= anim.tiltDur && elapsed < anim.tiltDur + anim.streamDur) {
        const a = rects[anim.a], b = rects[anim.b];
        if (!a || !b) continue;
        const dir = Math.sign(b.x - a.x || 1);
        const x0 = b.x + dir * -W * 0.55, y0 = b.y - Hh * 0.55 - Hh * 0.12;
        const fillP = clamp01((elapsed - anim.tiltDur) / anim.streamDur);
        const targetVials = anim.preB.length + anim.amount * fillP;
        const y1 = b.y - Hh * (0.06 + 0.78 * targetVials / anim.capacity) - Hh * 0.12;
        R.drawStream(ctx, x0, y0, b.x, y1, W, anim.color, (elapsed % 300) / 300);
      }
    }

    // landing ripples
    for (let i = G.ripples.length - 1; i >= 0; i--) {
      const rp = G.ripples[i];
      const p = (t - rp.t0) / 380;
      if (p >= 1) { G.ripples.splice(i, 1); continue; }
      ctx.save();
      ctx.globalAlpha = (1 - p) * 0.7;
      ctx.strokeStyle = TOK.cream;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, 4 + p * (W || 30) * 0.6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore(); // the shake translate
  }

  function renderDemoHand(t) {
    demoCtx.clearRect(0, 0, innerWidth, innerHeight);
    if (!demoHand.active || !demoHand.target) return;
    const p = clamp01((t - demoHand.start) / 650);
    const px = demoHand.from.px + (demoHand.target.px - demoHand.from.px) * easeOut(p);
    const py = demoHand.from.py + (demoHand.target.py - demoHand.from.py) * easeOut(p);
    const pressed = p >= 1 && Math.floor((t - demoHand.start) / 260) % 2 === 0;
    const { W } = computeLayout();
    const rr = (W || 40) * (pressed ? 0.5 : 0.44);
    demoCtx.save();
    demoCtx.beginPath();
    demoCtx.arc(px, py, rr, 0, Math.PI * 2);
    demoCtx.fillStyle = TOK.cream;
    demoCtx.globalAlpha = 0.9;
    demoCtx.fill();
    demoCtx.globalAlpha = 1;
    demoCtx.lineWidth = 3;
    demoCtx.strokeStyle = TOK.ink;
    demoCtx.stroke();
    if (pressed) {
      demoCtx.globalAlpha = 0.5;
      demoCtx.beginPath();
      demoCtx.arc(px, py, rr * 1.5, 0, Math.PI * 2);
      demoCtx.stroke();
    }
    demoCtx.restore();
  }

  function frame(t) {
    draw(t);
    if (G.screen === "demo") renderDemoHand(t);
    // retire finished pour anims / wobbles
    G.anims = G.anims.filter((a) => t - a.t0 < a.tiltDur + a.streamDur + Math.max(a.sloshDur, a.returnDur) + 40);
    G.wobbles = G.wobbles.filter((wb) => t - wb.t0 < wb.dur);
    requestAnimationFrame(frame);
  }

  // ---------- pour / interaction ----------

  function starsFor(pours, par) {
    if (pours <= par + 2) return 3;
    if (pours <= par + Math.ceil(par / 2)) return 2;
    return 1;
  }

  // The state-mutation half of a pour, shared by the real tap-driven commitPour() below and the test hook's
  // pour() (which skips the animation entirely): validate, snapshot for undo, apply, score. Returns the pour
  // result (for the caller to animate) or null if illegal.
  function applyPour(a, b) {
    if (!Shelf.canPour(G.shelfState, a, b)) return null;
    clearDeadEndTimers();
    G.deadEndReveal = null;
    const pre = G.shelfState;
    const res = Shelf.pour(pre, a, b);
    G.history.push({ vials: pre.vials.map((v) => v.slice()), capacity: pre.capacity });
    G.shelfState = res.state;
    G.pours++;
    updateCounters();
    return { pre, res };
  }

  function commitPour(a, b) {
    const applied = applyPour(a, b);
    if (!applied) return false;
    const { pre, res } = applied;
    G.anims = G.anims.filter((an) => an.a !== a && an.b !== b);
    G.anims.push({
      a, b, color: res.color, amount: res.amount, capacity: pre.capacity,
      preA: pre.vials[a].slice(), preB: pre.vials[b].slice(),
      t0: now(),
      tiltDur: TOK.carryDur / (G.speedMul || 1),
      streamDur: (TOK.streamBase + TOK.streamPerLayer * res.amount) / (G.speedMul || 1),
      sloshDur: TOK.sloshDur / (G.speedMul || 1),
      returnDur: TOK.returnDur / (G.speedMul || 1),
    });
    playTink();
    const gen = G.shelfGen;
    const id = setTimeout(() => {
      G.settleTimers = G.settleTimers.filter((t) => t !== id);
      afterPourSettles(a, b, gen);
    }, (TOK.carryDur + TOK.streamBase + TOK.streamPerLayer * res.amount) / (G.speedMul || 1) + 10);
    G.settleTimers.push(id);
    return true;
  }

  function afterPourSettles(a, b, gen) {
    // The shelf this timer was scheduled for may since have been replaced -- a new level, a reset, the menu, or
    // a fresh demo -- by the time it fires. `gen` pins it to that exact shelf, so a stale timer can never act on
    // (or throw on) a shelf that's no longer this one, while still letting a *current* demo's own pop/cork/bell
    // timers run (unlike gating on G.screen === "play", which would also silence the demo's own reward beats;
    // CTO review THE-111: double game:over, throw indexing a since-shrunk shelf).
    if (gen !== G.shelfGen || (G.screen !== "play" && G.screen !== "demo")) return;
    const vial = G.shelfState.vials[b];
    if (vial && Shelf.isVialSolved(vial, G.shelfState.capacity) && vial.length === G.shelfState.capacity) {
      G.pops.push({ vial: b, t0: now(), colorIdx: vial[0] });
      playPopCorkBell();
      haptic(10);
    }
    afterCommit();
  }

  // Mid-level save (design brief §11): a shelf can take up to 2 minutes, so progress within a level survives a
  // reload too, not just between levels. Saved after every settled pour; cleared on clear/reset since both
  // already leave nothing worth resuming (a cleared level has no "mid" state, and a reset already put the
  // player back at the level's own fresh start, which loadLevelData produces anyway with no save present).
  function saveMidLevel() {
    store.set("midLevel", {
      level: G.levelNumber,
      isDaily: G.isDaily,
      capacity: G.shelfState.capacity,
      vials: G.shelfState.vials,
      pours: G.pours,
      undosLeft: Number.isFinite(G.undosLeft) ? G.undosLeft : "inf",
      hintsLeft: G.hintsLeft,
      extraVialLeft: G.extraVialLeft,
    });
  }
  function clearMidLevel() {
    store.set("midLevel", null);
  }

  function afterCommit() {
    if (G.screen !== "play") return; // demo / clear-pending / clear / start: nothing here should act
    if (Shelf.isSolved(G.shelfState)) {
      clearMidLevel();
      onLevelClear();
      return;
    }
    saveMidLevel();
    // Capped tight (8ms per internal solve, worst case ~16ms total for the two-solve extra-vial-rescue path):
    // this runs on the main thread right as the slosh/cork/pop land, and a capped-out search already reads as
    // "not a dead end" (isDeadEnd treats a time-cap hit as solvable), so a small budget costs almost nothing.
    // CTO review THE-111, blocking item 2: measured 90-104ms average (worst 182-204ms) per pour in chapters
    // 5-6 at the previous 80ms-per-solve default -- a 6-12 frame hitch on the signature moment.
    const dead = Shelf.isDeadEnd(G.shelfState, { extraVialAvailable: G.extraVialLeft > 0, maxTimeMs: 8 });
    if (dead.deadEnd) {
      // Hint only ever points at Undo when stuck (design brief §12) -- it isn't its own way out of a dead end,
      // so a player with hints but no undo/extra vial left still gets the full "both spent" panel.
      const canRecover = G.undosLeft > 0 || G.extraVialLeft > 0;
      if (canRecover) beginDeadEndReveal(dead, false);
      else if (G.lvlMeta && G.lvlMeta.canReset) beginDeadEndReveal(dead, true);
    } else {
      G.deadEndReveal = null;
    }
    updateHelperUI();
  }

  function handleTap(idx) {
    if (G.paused || isVialBusy(idx)) return;
    G.hint = null;
    G.focusIndex = idx;
    if (G.selected === null) {
      if (G.shelfState.vials[idx].length > 0) {
        G.selected = idx;
        G.liftT[idx] = { t0: now(), dir: "up" };
        playTink();
      }
      return;
    }
    if (idx === G.selected) {
      G.liftT[idx] = { t0: now(), dir: "down" };
      G.selected = null;
      return;
    }
    const source = G.selected;
    if (Shelf.canPour(G.shelfState, source, idx)) {
      G.selected = null;
      delete G.liftT[source];
      commitPour(source, idx);
    } else {
      G.wobbles = G.wobbles.filter((wb) => wb.vial !== source);
      G.wobbles.push({ vial: source, t0: now(), dur: TOK.nopeDur / (G.speedMul || 1) });
      playUhUh();
    }
  }

  function useHint() {
    if (G.screen !== "play" || G.paused || !G.shelfState || G.hintsLeft <= 0) return;
    const dead = Shelf.isDeadEnd(G.shelfState, { extraVialAvailable: G.extraVialLeft > 0, maxTimeMs: 8 });
    if (dead.deadEnd && dead.needsExtraVial && G.extraVialLeft > 0) {
      // The solver only found a path once the extra vial is in play (THE-127) -- Hint points there instead of
      // Undo, since undo's effect on a shelf with zero legal moves left hasn't been proven either way.
      extraVialBtn.classList.add("is-pulsing");
      playHint();
      return;
    }
    if (dead.deadEnd && G.undosLeft > 0) {
      // "In a dead end with helpers left, Hint points at Undo instead" (design brief §12).
      undoBtn.classList.add("is-pulsing");
      playHint();
      return;
    }
    const result = Shelf.solve(G.shelfState, { maxTimeMs: 900 });
    if (result.capped) {
      // The solve hit its time budget with no answer either way (`solvable: null`) -- rather than Hint silently
      // doing nothing, say so, so the player knows to just tap it again instead of assuming it's broken (CTO
      // re-review of THE-111, non-blocking item 5; L66 measured ~470ms here).
      K.toast(T("hintUnavailable"));
      return;
    }
    if (!result.solvable || !result.path || !result.path.length) return;
    const [a, b] = result.path[0];
    G.hint = { a, b, t0: now() };
    G.hintsLeft--;
    updateHelperUI();
    playHint();
  }

  function doUndo() {
    if (G.screen !== "play" || G.paused || !(G.undosLeft > 0) || G.history.length === 0) return false;
    const entry = G.history.pop();
    G.shelfState = { vials: entry.vials.map((v) => v.slice()), capacity: entry.capacity };
    if (Number.isFinite(G.undosLeft)) G.undosLeft--;
    if (G.pours > 0) G.pours--; // undone pours don't count toward the score (design brief §6)
    G.selected = null;
    // The reverted shelf may have been mid-pour or mid-lift: drop every in-flight animation and lift transition
    // so nothing keeps drawing against a state that just got replaced (CTO review THE-111, blocking item 3 --
    // a vial undone while lifted used to stay floating with no glow, and a pour undone mid-animation kept
    // playing over the reverted shelf).
    clearSettleTimers();
    G.anims = [];
    G.wobbles = [];
    G.liftT = {};
    G.clearWave = null;
    clearDeadEndTimers();
    G.deadEndReveal = null;
    updateCounters();
    updateHelperUI();
    playUndo();
    // Otherwise a reload right after an undo restores the pre-undo shelf with the undo refunded, since the mid-
    // level save on disk still reflects the pour that was just undone (CTO re-review of THE-111, non-blocking
    // item 3).
    if (G.screen === "play") saveMidLevel();
    return true;
  }

  function doExtraVial() {
    if (G.screen !== "play" || G.paused || G.extraVialLeft <= 0) return false;
    G.shelfState = Shelf.addVial(G.shelfState);
    G.extraVialLeft = 0;
    clearDeadEndTimers();
    G.deadEndReveal = null;
    updateHelperUI();
    playExtraVial();
    // Same as doUndo() above: keep the mid-level save in step so a reload doesn't hand back the extra vial (CTO
    // re-review of THE-111, non-blocking item 3).
    if (G.screen === "play") saveMidLevel();
    return true;
  }

  function doRestart() {
    if (G.screen !== "play" || !G.lvlMeta) return false;
    resetCurrentLevel();
    return true;
  }

  // ---------- dead-end explained (design brief §6 / signature item 8) ----------

  let deadEndTimers = [];
  function clearDeadEndTimers() {
    for (const id of deadEndTimers) clearTimeout(id);
    deadEndTimers = [];
  }

  // Cancels every pending pour-settle timer and bumps the shelf generation, so any that still somehow fire
  // recognise themselves as stale (see afterPourSettles). Call this whenever the current shelf stops being
  // "the" shelf: a new level, a reset, the menu, or a fresh demo (CTO review THE-111, blocking item 1).
  function clearSettleTimers() {
    for (const id of G.settleTimers) clearTimeout(id);
    G.settleTimers = [];
    G.shelfGen++;
  }

  function stuckVialIndexes(stuckColors) {
    const idxs = [];
    for (let i = 0; i < G.shelfState.vials.length; i++) {
      const run = Shelf.topRun(G.shelfState.vials[i]);
      if (run && stuckColors.includes(run.color) && !idxs.includes(i)) idxs.push(i);
    }
    return idxs;
  }

  function beginDeadEndReveal(dead, bothSpent) {
    clearDeadEndTimers();
    const stuckIdxs = stuckVialIndexes(dead.tops);
    G.deadEndReveal = { stuckIdxs, t0: now() + 400, reason: dead.reason };
    playHmm();
    if (!bothSpent) {
      deadEndTimers.push(
        setTimeout(() => {
          // THE-127: when the solver only found a way out via the extra vial, pulse that instead of Undo --
          // Undo's effect here is unproven, the extra vial's isn't.
          if (dead.needsExtraVial && !extraVialBtn.disabled) extraVialBtn.classList.add("is-pulsing");
          else if (undoBtn.disabled) extraVialBtn.classList.add("is-pulsing");
          else undoBtn.classList.add("is-pulsing");
          updateHelperUI();
        }, 400 + stuckIdxs.length * 120 + 400)
      );
      return;
    }
    deadEndTimers.push(
      setTimeout(() => {
        undoBtn.classList.add("is-wiggling");
        extraVialBtn.classList.add("is-wiggling");
        hintBtn.classList.add("is-wiggling");
        setTimeout(() => {
          undoBtn.classList.remove("is-wiggling");
          extraVialBtn.classList.remove("is-wiggling");
          hintBtn.classList.remove("is-wiggling");
        }, 450);
      }, 1400)
    );
    deadEndTimers.push(setTimeout(() => openDeadEndPanel(), 1800));
  }

  function renderDeadEndHelpers() {
    // Both spent by definition here (afterCommit only opens this panel when !canRecover) -- Hint is left out
    // per design brief §6/THE-126, since it only ever points at Undo and isn't its own way out.
    deadendUndoCountEl.textContent = String(G.undosLeft);
    deadendVialCountEl.textContent = String(G.extraVialLeft);
  }

  let deadEndResolved = true;

  function openDeadEndPanel() {
    deadEndResolved = false;
    renderDeadEndHelpers();
    const gc = $("deadend-glub").getContext("2d");
    gc.clearRect(0, 0, 60, 60);
    R.drawGlub(gc, 30, 32, 22, "think", colorForPotion(1));
    // The cabinet's circular-arrow badge (design brief §6 loop case) has already faded out by the time this panel
    // opens -- keep a small copy of it here so the reason doesn't vanish along with the reveal (THE-131).
    deadendLoopBadgeEl.hidden = !(G.deadEndReveal && G.deadEndReveal.reason === "unsolvable");
    if (!deadendDialog.open) deadendDialog.showModal();
  }

  // Fires exactly once per dead-end sequence, however the panel goes away: the "Let's brew again" button (which
  // just closes the dialog) or the player dismissing the native <dialog> with Escape -- both end up here via the
  // dialog's own 'close' event, guarded by deadEndResolved so a stray double-close can't reset twice.
  deadendDialog.addEventListener("close", () => resolveDeadEnd());
  $("deadend-again").addEventListener("click", () => deadendDialog.close());

  function resolveDeadEnd() {
    if (deadEndResolved) return;
    deadEndResolved = true;
    clearDeadEndTimers();
    G.deadEndReveal = null;
    playBrewAgain();
    dispatchEvent(new CustomEvent("game:over", { detail: { score: G.pours } }));
    resetCurrentLevel();
  }

  // ---------- helper / counters UI ----------

  function updateHelperUI() {
    const finiteUndo = Number.isFinite(G.undosLeft);
    undoCountEl.textContent = finiteUndo ? String(G.undosLeft) : "∞";
    undoBtn.disabled = finiteUndo && G.undosLeft <= 0;
    hintCountEl.textContent = String(G.hintsLeft);
    hintBtn.disabled = G.hintsLeft <= 0;
    extraVialCountEl.textContent = String(G.extraVialLeft);
    extraVialBtn.disabled = G.extraVialLeft <= 0;
    if (!G.deadEndReveal) {
      undoBtn.classList.remove("is-pulsing");
      extraVialBtn.classList.remove("is-pulsing");
    }
    levelLabelEl.textContent = G.isDaily ? "☀" : String(G.levelNumber);
  }

  function updateCounters() {
    pourscountEl.textContent = String(G.pours);
    const par = G.lvlMeta ? G.lvlMeta.par : 0;
    const stars = par ? starsFor(G.pours, par) : 3;
    starsChipEls.forEach((el, i) => el.classList.toggle("is-lit", i < stars));
  }

  // ---------- level flow ----------

  // A mid-level save that's merely the right shape (Save.sanitizeMidLevel's job) can still be impossible for
  // *this* level -- a stale save left over from a future levels.js regeneration, or a hand-edited one. Compares
  // the sorted flat colour multiset (so a solved-away layout can't sneak past as "unsolved") and the vial count
  // (the level's own count, or +1 when the extra vial has already been used) against the level being loaded
  // (CTO re-review of THE-111, non-blocking item 2).
  function flatSortedLayers(vials) {
    const flat = [];
    for (const v of vials) for (const c of v) flat.push(c);
    return flat.sort((a, b) => a - b);
  }
  function midLevelMatchesLevel(mid, levelData) {
    const expectedVialCount = levelData.vials.length + (mid.extraVialLeft === 0 ? 1 : 0);
    if (mid.vials.length !== expectedVialCount) return false;
    const midLayers = flatSortedLayers(mid.vials);
    const levelLayers = flatSortedLayers(levelData.vials);
    if (midLayers.length !== levelLayers.length) return false;
    for (let i = 0; i < midLayers.length; i++) {
      if (midLayers[i] !== levelLayers[i]) return false;
    }
    return true;
  }

  function loadLevelData(levelData, isDaily) {
    clearDeadEndTimers();
    clearSettleTimers();
    G.levelNumber = levelData.level;
    G.isDaily = !!isDaily;
    G.lvlMeta = {
      colors: levelData.colors,
      capacity: levelData.capacity,
      par: levelData.minMoves,
      chapter: levelData.chapter,
      unlimitedUndo: !!levelData.unlimitedUndo,
      canReset: true,
    };
    G.initialVials = levelData.vials.map((v) => v.slice());
    G.shelfState = { vials: G.initialVials.map((v) => v.slice()), capacity: levelData.capacity };
    G.selected = null;
    G.focusIndex = 0;
    G.history = [];
    G.pours = 0;
    G.undosLeft = G.lvlMeta.unlimitedUndo ? Infinity : 2;
    G.hintsLeft = isDaily ? 1 : 3;
    G.extraVialLeft = 1;
    // Resume mid-level progress if there's a save for this exact level (design brief §11). G.initialVials stays
    // the level's own fresh layout regardless -- Restart and the dead-end reset both need the *real* start, not
    // wherever the player happened to reload from.
    const mid = Save.sanitizeMidLevel(store.get("midLevel", null), LEVELS.length);
    if (
      mid &&
      mid.isDaily === !!isDaily &&
      String(mid.level) === String(levelData.level) &&
      mid.capacity === levelData.capacity &&
      midLevelMatchesLevel(mid, levelData)
    ) {
      G.shelfState = { vials: mid.vials.map((v) => v.slice()), capacity: mid.capacity };
      G.pours = mid.pours;
      G.undosLeft = G.lvlMeta.unlimitedUndo ? Infinity : mid.undosLeft;
      G.hintsLeft = mid.hintsLeft;
      G.extraVialLeft = mid.extraVialLeft;
    }
    G.anims = [];
    G.wobbles = [];
    G.liftT = {};
    G.clearWave = null;
    G.pops = [];
    G.ripples = [];
    G.hint = null;
    G.deadEndReveal = null;
    G.dealT0 = now();
    updateHelperUI();
    updateCounters();
  }

  function generateDaily(dateStr) {
    const date = dateStr ? Save.parseLocalDateKey(dateStr) : new Date();
    const seed = K.dailySeed(date, "potion-pour");
    const rand = Shelf.rng(seed);
    // The daily uses chapter 3's band (design brief §9): fair for kids, enough for adults.
    const colors = 5 + Math.floor(rand() * 2);
    const capacity = 4;
    const record = Shelf.generate({
      colors, capacity, extraEmpty: 2, rand,
      scrambleSteps: colors * 6, maxAttempts: 300, solveOpts: { maxTimeMs: 800 },
    });
    return {
      level: "daily-" + K.dateKey(date),
      colors, capacity,
      vials: record.state.vials,
      minMoves: record.metrics.minMoves,
      unlimitedUndo: false,
      chapter: 2,
    };
  }

  function showPlayScreen() {
    G.screen = "play";
    K.showScreen("play-screen");
    hudEl.classList.remove("hidden");
    hudEl.inert = false;
    cornerEl.classList.add("hidden");
    canvas.focus({ preventScroll: true });
  }

  function startPlay(levelData, isDaily) {
    clearTimeout(introDemoTimer);
    loadLevelData(levelData, isDaily);
    showPlayScreen();
    dispatchEvent(new CustomEvent("game:start", { detail: isDaily ? { daily: levelData.level } : { level: levelData.level } }));
  }

  function startLevelNumber(n) {
    const data = LEVELS[n - 1];
    if (!data) return false;
    startPlay(data, false);
    return true;
  }

  function resetCurrentLevel() {
    recordPendingClearIfAny();
    clearDeadEndTimers();
    clearSettleTimers();
    clearMidLevel();
    G.shelfState = { vials: G.initialVials.map((v) => v.slice()), capacity: G.lvlMeta.capacity };
    G.history = [];
    G.selected = null;
    G.pours = 0;
    G.anims = [];
    G.wobbles = [];
    G.liftT = {};
    G.clearWave = null;
    G.pops = [];
    G.hint = null;
    G.deadEndReveal = null;
    G.undosLeft = G.lvlMeta.unlimitedUndo ? Infinity : 2;
    G.hintsLeft = G.isDaily ? 1 : 3;
    G.extraVialLeft = 1;
    G.dealT0 = now();
    updateHelperUI();
    updateCounters();
    dispatchEvent(new CustomEvent("game:restart"));
  }

  function renderDailyBest() {
    const best = Save.sanitizeDailyBest(store.get("dailyBest", null));
    const n = best[K.dateKey(new Date())];
    if (n) {
      dailyBestEl.textContent = T("dailyBestLabel", { n: String(n) });
      dailyBestEl.classList.remove("hidden");
    } else {
      dailyBestEl.classList.add("hidden");
    }
  }

  function backToMenu() {
    recordPendingClearIfAny();
    clearDeadEndTimers();
    clearSettleTimers();
    G.screen = "start";
    hudEl.classList.add("hidden");
    cornerEl.classList.remove("hidden");
    const progress = Save.sanitizeProgress(store.get("progress", null), LEVELS.length);
    playLevelEl.textContent = String(Math.min(progress.currentLevel, LEVELS.length));
    renderDailyBest();
    drawTitleGlub();
    K.showScreen("start");
  }

  function drawTitleGlub() {
    const c = $("title-glub").getContext("2d");
    c.clearRect(0, 0, 96, 96);
    R.drawGlub(c, 48, 52, 40, "cheer", colorForPotion(1));
  }

  // The store-writing half of a level clear (progress/bestPours/stars, or dailyBest), split out of onLevelClear
  // so recordPendingClearIfAny() below can record a genuinely-solved shelf even when the player leaves before
  // onLevelClear's own settle timer would have run it.
  function recordLevelClear() {
    const par = G.lvlMeta.par;
    const stars = starsFor(G.pours, par);
    let isBest = false;
    if (!G.isDaily) {
      const progress = Save.sanitizeProgress(store.get("progress", null), LEVELS.length);
      progress.currentLevel = Math.max(progress.currentLevel, Math.min(LEVELS.length + 1, G.levelNumber + 1));
      const prevBest = progress.bestPours[G.levelNumber];
      isBest = !prevBest || G.pours < prevBest;
      if (isBest) progress.bestPours[G.levelNumber] = G.pours;
      if (!progress.stars[G.levelNumber] || stars > progress.stars[G.levelNumber]) progress.stars[G.levelNumber] = stars;
      store.set("progress", progress);
    } else {
      const best = Save.sanitizeDailyBest(store.get("dailyBest", null));
      const key = String(G.levelNumber).replace("daily-", "");
      isBest = !best[key] || G.pours < best[key];
      if (isBest) best[key] = G.pours;
      store.set("dailyBest", best);
    }
    dispatchEvent(new CustomEvent("game:over", { detail: { score: G.pours } }));
    return { par, stars, isBest };
  }

  // A pour that already solved the shelf (G.shelfState is updated synchronously in applyPour) but whose settle
  // timer hasn't landed yet -- so onLevelClear hasn't run -- is about to have that timer cancelled by whichever
  // caller invoked this (backToMenu, a restart or the demo, all of which call clearSettleTimers()). Left alone,
  // the clear would never be recorded and the last saveMidLevel() from the prior pour would resume the level one
  // pour short of solved (CTO re-review of THE-111, non-blocking item 1).
  function recordPendingClearIfAny() {
    if (G.screen === "play" && G.shelfState && Shelf.isSolved(G.shelfState)) {
      clearMidLevel();
      recordLevelClear();
    }
  }

  function onLevelClear() {
    G.screen = "clear-pending";
    // The HUD (restart/undo/hint/extra-vial/pause) must not be reachable while the shelf behind it is mid-hold
    // -- a restart/undo/pause tapped here used to mutate a shelf the pending timers below still think is solved
    // (CTO re-review of THE-125). `showPlayScreen()` clears this the moment play actually resumes.
    hudEl.inert = true;
    const { par, stars, isBest } = recordLevelClear();

    // Hold on the finished shelf -- corked, tagged, still drawn by draw() while G.screen is "clear-pending" --
    // so the win reads before the card covers it (THE-125, DESIGN.md §16 item 10): a hush, then the tags
    // shimmer in a wave with a clink nudge, then confetti while the shelf is still the whole screen, then the
    // card slides up. A big shelf's wave can outrun the base hold, so the hold stretches to let it finish.
    const vialCount = G.shelfState.vials.length;
    const waveEnd = TOK.clearHushDur + Math.max(0, vialCount - 1) * TOK.clearWaveStagger + TOK.clearShimmerDur;
    const holdDur = Math.max(TOK.clearHoldDur, waveEnd + 150);
    const speedMul = G.speedMul || 1;
    // Both hold timers below must recognise a shelf that moved on without them (a restart/undo during the hold,
    // guarded off in the HUD but still reachable via the test hook's direct doRestart()/doUndo() calls) --
    // shelfGen is bumped by clearSettleTimers(), which every one of those paths already calls (CTO re-review).
    const gen = G.shelfGen;
    G.clearWave = { t0: now() };
    setTimeout(
      () => {
        if (gen !== G.shelfGen || G.screen !== "clear-pending") return; // a reset/undo/backToMenu already moved on
        haptic(10);
        K.celebrate({ colors: ["--color-potion-1", "--color-potion-3", "--color-potion-6", "--color-accent"] });
      },
      TOK.clearHushDur / speedMul
    );
    setTimeout(
      () => {
        if (gen !== G.shelfGen || G.screen !== "clear-pending") return; // a reset/undo/backToMenu already moved on
        G.clearWave = null;
        $("clear-level").textContent = G.isDaily ? T("daily") : "Level " + G.levelNumber;
        $("clear-moves").textContent = "Brewed in " + G.pours + " pours (par " + par + ")";
        const starsEl = $("clear-stars");
        starsEl.textContent = "";
        for (let i = 0; i < 3; i++) {
          const s = document.createElement("span");
          s.className = "hud-star";
          s.textContent = "★";
          starsEl.appendChild(s);
        }
        Array.from(starsEl.children).forEach((el, i) => {
          setTimeout(() => {
            if (i < stars) {
              el.classList.add("is-lit");
              playStarDing(i);
            }
          }, i * 180);
        });
        $("clear-newbest").classList.toggle("hidden", !isBest);
        const nextBtn = $("next");
        const shareBtn = $("clear-share");
        if (G.isDaily) {
          nextBtn.classList.add("hidden");
          shareBtn.classList.remove("hidden");
        } else {
          nextBtn.classList.remove("hidden");
          nextBtn.textContent = G.levelNumber < LEVELS.length ? T("next") : T("menu");
          shareBtn.classList.add("hidden");
        }
        const gc = $("clear-glub").getContext("2d");
        gc.clearRect(0, 0, 88, 88);
        R.drawGlub(gc, 44, 48, 36, "cheer", colorForPotion(G.shelfState.vials.find((v) => v.length)?.[0] || 0));
        G.screen = "clear";
        hudEl.classList.add("hidden");
        K.showScreen("clear");
        playLevelClear();
        haptic(20);
      },
      holdDur / speedMul
    );
  }

  function shareResult() {
    const label = G.isDaily ? T("daily") + " " + K.dateKey(new Date()) : "Level " + G.levelNumber;
    const par = G.lvlMeta.par;
    const stars = starsFor(G.pours, par);
    const emoji = "⭐".repeat(stars) + "\u{1FA76}".repeat(3 - stars);
    const text = T("shareText", { label, pours: String(G.pours), stars: "★".repeat(stars), emoji });
    if (navigator.share) {
      navigator.share({ text }).catch(() => {});
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => K.toast(T("copied"))).catch(() => K.toast(text));
    } else {
      K.toast(text);
    }
  }

  // ---------- level map ----------

  function drawLevelTile(canvasEl, lvl, state) {
    const c = canvasEl.getContext("2d");
    const W = 26;
    c.clearRect(0, 0, canvasEl.width, canvasEl.height);
    c.save();
    c.translate(canvasEl.width / 2, canvasEl.height - 6);
    if (state === "locked") {
      R.drawVial(c, 0, 0, W, [], { ghost: true });
    } else {
      const colors = [];
      for (let i = 0; i < Math.min(4, lvl.colors); i++) colors.push(i % 12);
      const opts = {};
      if (state === "current") opts.glow = true;
      else opts.cork = 1, (opts.tag = colors[0] || 0);
      R.drawVial(c, 0, 0, W, state === "current" ? [colors[0]] : colors, opts);
    }
    c.restore();
  }

  function populateLevelGrid() {
    const grid = $("levelgrid");
    grid.textContent = "";
    const progress = Save.sanitizeProgress(store.get("progress", null), LEVELS.length);
    let chapterIndex = -1;
    let chapterGridEl = null;
    let currentTileEl = null;
    LEVELS.forEach((lvl) => {
      if (lvl.chapter !== chapterIndex) {
        chapterIndex = lvl.chapter;
        const section = document.createElement("div");
        section.className = "levelmap__chapter";
        const title = document.createElement("h3");
        title.className = "levelmap__chapter-title";
        const chStars = LEVELS.filter((l) => l.chapter === chapterIndex).reduce((s, l) => s + (progress.stars[l.level] || 0), 0);
        title.textContent = (CHAPTER_NAMES[chapterIndex] || "Chapter " + (chapterIndex + 1)) + " ★ " + chStars;
        section.appendChild(title);
        chapterGridEl = document.createElement("div");
        chapterGridEl.className = "levelmap__grid";
        section.appendChild(chapterGridEl);
        grid.appendChild(section);
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "level-tile";
      const locked = lvl.level > progress.currentLevel;
      const state = locked ? "locked" : lvl.level === progress.currentLevel ? "current" : "done";
      if (state === "current") btn.classList.add("is-current");
      const tileCanvas = document.createElement("canvas");
      tileCanvas.width = 40;
      tileCanvas.height = 56;
      tileCanvas.style.width = "28px";
      tileCanvas.style.height = "40px";
      btn.appendChild(tileCanvas);
      const num = document.createElement("span");
      num.className = "level-tile__num";
      num.textContent = String(lvl.level);
      btn.appendChild(num);
      const stars = progress.stars[lvl.level] || 0;
      if (!locked && stars) {
        const starsEl = document.createElement("span");
        starsEl.className = "level-tile__stars";
        starsEl.textContent = "★".repeat(stars) + "☆".repeat(3 - stars);
        btn.appendChild(starsEl);
      }
      const best = progress.bestPours[lvl.level];
      btn.disabled = locked;
      btn.setAttribute("aria-label", "Level " + lvl.level + (locked ? " (locked)" : best ? ", best " + best + " pours" : ""));
      btn.addEventListener("click", () => startLevelNumber(lvl.level));
      chapterGridEl.appendChild(btn);
      if (state === "current") currentTileEl = btn;
      requestAnimationFrame(() => drawLevelTile(tileCanvas, lvl, state));
    });
    if (currentTileEl) requestAnimationFrame(() => currentTileEl.scrollIntoView({ block: "center" }));
  }

  // ---------- ghost-hand onboarding demo (design brief §10, exact script) ----------

  // A = [sun, sky] (sky on top), B = [sky, sky, sky], C = [sun, sun, sun]. Colour 0 stands in for "sun", 1 for
  // "sky" (the brief's names are illustrative; the runes drawn are just colour 0 and colour 1's own runes).
  function demoShelfState() {
    return { vials: [[0, 1], [1, 1, 1], [0, 0, 0]], capacity: 4 };
  }

  const demoHand = { active: false, start: 0, from: null, target: null };
  function demoHandPos(t) {
    const p = clamp01((t - demoHand.start) / 650);
    return {
      px: demoHand.from.px + (demoHand.target.px - demoHand.from.px) * easeOut(p),
      py: demoHand.from.py + (demoHand.target.py - demoHand.from.py) * easeOut(p),
    };
  }
  function aimDemoHand(idx) {
    const { rects } = computeLayout();
    const r = rects[idx];
    if (!r) return;
    const target = { px: r.x, py: r.y - R.vialH() * (rects[0] ? rects[0].W : 30) * 0.55 };
    const tNow = now();
    demoHand.from = demoHand.active && demoHand.target ? demoHandPos(tNow) : { px: innerWidth * 0.85, py: innerHeight * 0.85 };
    demoHand.active = true;
    demoHand.start = tNow;
    demoHand.target = target;
  }

  let demoTimer = null;
  let demoCelebrateTimer = null; // kept separate from demoTimer so the last two demo timeouts don't clobber each other
  let introDemoTimer = 0;
  let demoOnDone = backToMenu;
  const DEMO_STEP_MS = 1300;

  function playGhostDemo(onDone) {
    recordPendingClearIfAny();
    clearTimeout(introDemoTimer);
    clearTimeout(demoTimer);
    clearTimeout(demoCelebrateTimer);
    clearDeadEndTimers();
    clearSettleTimers();
    demoOnDone = onDone || backToMenu;
    G.screen = "demo";
    G.shelfState = demoShelfState();
    G.selected = null;
    G.anims = [];
    G.wobbles = [];
    G.liftT = {};
    G.clearWave = null;
    G.hint = null;
    hudEl.classList.add("hidden");
    cornerEl.classList.add("hidden");
    K.showScreen("play-screen");
    demoCanvas.classList.remove("hidden");
    G.dealT0 = now() - 400;
    aimDemoHand(0);
    demoTimer = setTimeout(() => {
      handleTap(0); // lift A
      aimDemoHand(2); // aim at C -- sky (A's top) can't go on sun
      demoTimer = setTimeout(() => {
        handleTap(2); // A shakes its head
        demoTimer = setTimeout(() => {
          aimDemoHand(1); // aim at B -- sky matches
          demoTimer = setTimeout(() => {
            handleTap(1); // A pours onto B, sky completes B
            demoTimer = setTimeout(() => {
              handleTap(0); // lift A's remaining sun
              aimDemoHand(2);
              demoTimer = setTimeout(() => {
                handleTap(2); // sun completes C -- shelf clear
                demoCelebrateTimer = setTimeout(() => {
                  if (!K.reduceMotion()) K.celebrate({ count: 40, duration: 700 });
                }, 650);
                demoTimer = setTimeout(finishDemo, 1400);
              }, DEMO_STEP_MS);
            }, 900);
          }, DEMO_STEP_MS);
        }, 700);
      }, DEMO_STEP_MS);
    }, DEMO_STEP_MS);
  }

  function finishDemo() {
    demoHand.active = false;
    const onDone = demoOnDone;
    cancelDemo();
    onDone();
  }
  function cancelDemo() {
    clearTimeout(demoTimer);
    clearTimeout(demoCelebrateTimer);
    demoHand.active = false;
    demoCanvas.classList.add("hidden");
  }

  // ---------- how-to art ----------

  function drawHowToArt() {
    const scenes = [
      { id: "howto-art-1", vials: [[0], [0, 0]], lift: 0, tilt: -60, glow: 1 },
      { id: "howto-art-2", vials: [[], [0, 0, 0, 0]], cork: 1, tag: 0 },
      { id: "howto-art-3", vials: [[1], [0]], nope: true },
    ];
    for (const scene of scenes) {
      const el = $(scene.id);
      if (!el) continue;
      const c = el.getContext("2d");
      c.clearRect(0, 0, 160, 100);
      const W = 20;
      scene.vials.forEach((v, i) => {
        const x = 55 + i * 50;
        const opts = {};
        if (i === 0 && scene.tilt) opts.tilt = scene.tilt, opts.lift = 1, opts.glow = true;
        if (i === 1 && scene.cork) opts.cork = 1, (opts.tag = scene.tag);
        if (i === 0 && scene.nope) opts.nope = true, (opts.lift = 1);
        R.drawVial(c, x, 84, W, v, opts);
      });
    }
  }

  // ---------- how-to, settings, about, pause ----------

  const howTo = K.howTo($("howto"));
  $("howto-btn").addEventListener("click", () => { drawHowToArt(); howTo.open(); });
  $("pause-howto").addEventListener("click", () => {
    $("pause").close();
    drawHowToArt();
    howTo.open();
  });

  $("about-btn").addEventListener("click", () => $("about").showModal());
  $("about-close").addEventListener("click", () => $("about").close());

  function renderSoundBtn(on) {
    const btn = $("sound-btn");
    btn.setAttribute("aria-pressed", String(on));
    btn.setAttribute("aria-label", on ? "Sound: on" : "Sound: off");
  }

  const settingsStore = {
    get(key, fallback) {
      const s = Save.sanitizeSettings(store.get("settings", null));
      return key in s ? s[key] : fallback;
    },
    set(key, value) {
      const s = Save.sanitizeSettings(store.get("settings", null));
      s[key] = value;
      store.set("settings", s);
      refreshSettingsCache();
    },
  };
  refreshSettingsCache();
  K.bindToggle($("opt-sound"), settingsStore, "sound", true, renderSoundBtn);
  $("sound-btn").addEventListener("click", () => {
    const on = !soundOn();
    settingsStore.set("sound", on);
    $("opt-sound").checked = on;
    renderSoundBtn(on);
  });
  if (!navigator.vibrate) $("opt-vibration-row").classList.add("hidden");
  K.bindToggle($("opt-vibration"), settingsStore, "vibration", false, () => {});
  K.bindToggle($("opt-motion"), settingsStore, "reduceMotion", false, (checked) => {
    document.documentElement.setAttribute("data-reduce-motion", checked ? "true" : "false");
  });
  K.bindToggle($("opt-showfit"), settingsStore, "showFit", true, (checked) => {
    G.showFit = checked;
  });
  G.showFit = settingsStore.get("showFit", true);

  $("settings-close").addEventListener("click", () => $("settings").close());
  $("settings-replay-demo").addEventListener("click", () => {
    $("settings").close();
    $("pause").close();
    playGhostDemo(backToMenu);
  });
  $("settings-reset").addEventListener("click", () => {
    $("settings").close();
    $("reset-confirm").showModal();
  });
  $("reset-confirm-cancel").addEventListener("click", () => $("reset-confirm").close());
  $("reset-confirm-yes").addEventListener("click", () => {
    store.set("progress", { currentLevel: 1, bestPours: {}, stars: {} });
    store.set("dailyBest", {});
    $("reset-confirm").close();
    backToMenu();
  });

  function togglePause() {
    if ($("pause").open) {
      $("pause").close();
    } else {
      if (G.screen !== "play") return;
      G.paused = true;
      $("pause").showModal();
    }
  }
  $("pause-btn").addEventListener("click", togglePause);
  $("pause-close").addEventListener("click", () => $("pause").close());
  $("pause-resume").addEventListener("click", () => $("pause").close());
  $("pause").addEventListener("close", () => {
    G.paused = false;
  });
  $("pause-restart").addEventListener("click", () => {
    $("pause").close();
    doRestart();
  });
  $("pause-menu").addEventListener("click", () => {
    $("pause").close();
    backToMenu();
  });
  $("pause-settings").addEventListener("click", () => {
    $("pause").close();
    $("settings").showModal();
  });

  // ---------- input wiring ----------

  canvas.setAttribute("tabindex", "0");

  canvas.addEventListener("pointerdown", (e) => {
    ensureAudio();
    // Tap-to-skip: a returning player on a new device (no local save yet) shouldn't be stuck sitting through the
    // ~8s ghost-hand demo every time (CTO re-review of THE-111, non-blocking item 4).
    if (G.screen === "demo") {
      finishDemo();
      return;
    }
    if (G.screen !== "play") return;
    const rect = canvas.getBoundingClientRect();
    const idx = hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (idx !== null) handleTap(idx);
  });

  canvas.addEventListener("keydown", (e) => {
    if (G.screen !== "play" || G.paused || document.querySelector("dialog[open]")) return;
    const count = G.shelfState ? G.shelfState.vials.length : 0;
    if (e.key === "ArrowRight") {
      G.focusIndex = (G.focusIndex + 1) % count;
      e.preventDefault();
    } else if (e.key === "ArrowLeft") {
      G.focusIndex = (G.focusIndex - 1 + count) % count;
      e.preventDefault();
    } else if (e.key === "Enter" || e.key === " ") {
      handleTap(G.focusIndex);
      e.preventDefault();
    } else if (e.key.toLowerCase() === "u") {
      doUndo();
    } else if (e.key.toLowerCase() === "h") {
      useHint();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (document.querySelector("dialog[open]")) return;
    if (e.key === "Escape" || e.key.toLowerCase() === "p") {
      if (G.screen === "play") togglePause();
    } else if (e.key === "?") {
      drawHowToArt();
      howTo.open();
    }
  });

  // Any dialog (pause, how-to, settings, reset-confirm, about, dead-end) can be the last
  // thing focused before it closes, since clicking its opener button focuses that button
  // first. The browser's default close-focus-restore then leaves focus there instead of
  // on the shelf, silently breaking keyboard play. Restore it ourselves once the dialog
  // stack has settled (queued so chained closes, e.g. pause -> settings, resolve first).
  document.addEventListener(
    "close",
    () => {
      queueMicrotask(() => {
        if (G.screen === "play" && !document.querySelector("dialog[open]")) {
          canvas.focus({ preventScroll: true });
        }
      });
    },
    true,
  );

  $("play").addEventListener("click", () => {
    const progress = Save.sanitizeProgress(store.get("progress", null), LEVELS.length);
    const n = Math.min(progress.currentLevel, LEVELS.length);
    startLevelNumber(n);
  });
  $("levels-btn").addEventListener("click", () => {
    populateLevelGrid();
    K.showScreen("levelmap");
  });
  $("levelmap-menu").addEventListener("click", backToMenu);
  $("daily-btn").addEventListener("click", () => startPlay(generateDaily(), true));
  $("showme-btn").addEventListener("click", () => playGhostDemo(backToMenu));
  $("next").addEventListener("click", () => {
    if (G.isDaily || G.levelNumber >= LEVELS.length) backToMenu();
    else startLevelNumber(G.levelNumber + 1);
  });
  $("clear-replay").addEventListener("click", () => {
    if (G.isDaily) startPlay(generateDaily(String(G.levelNumber).replace("daily-", "")), true);
    else startLevelNumber(G.levelNumber);
  });
  $("clear-menu").addEventListener("click", backToMenu);
  $("clear-share").addEventListener("click", shareResult);

  restartBtn.addEventListener("click", doRestart);
  undoBtn.addEventListener("click", doUndo);
  extraVialBtn.addEventListener("click", doExtraVial);
  hintBtn.addEventListener("click", useHint);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && G.screen === "play" && !document.querySelector("dialog[open]")) togglePause();
  });

  function resizeCanvas() {
    const d = Math.min(devicePixelRatio || 1, 2);
    const w = innerWidth, h = innerHeight;
    canvas.width = Math.round(w * d);
    canvas.height = Math.round(h * d);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.setTransform(d, 0, 0, d, 0, 0);
    demoCanvas.width = canvas.width;
    demoCanvas.height = canvas.height;
    demoCanvas.style.width = w + "px";
    demoCanvas.style.height = h + "px";
    demoCtx.setTransform(d, 0, 0, d, 0, 0);
  }
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();
  requestAnimationFrame(frame);

  // First run: the title shows for ~1s, then the ghost-hand demo plays once and hands off straight into level
  // 1. Replayable any time via "Show me" or Settings -> Replay the demo.
  drawTitleGlub();
  renderDailyBest();
  K.showScreen("start");
  {
    const progress = Save.sanitizeProgress(store.get("progress", null), LEVELS.length);
    playLevelEl.textContent = String(Math.min(progress.currentLevel, LEVELS.length));
  }
  if (K.firstRun(store, "seenDemo")) {
    introDemoTimer = setTimeout(() => {
      introDemoTimer = 0;
      if ($("start").classList.contains("is-active") && !document.querySelector("dialog[open]")) {
        playGhostDemo(() => startLevelNumber(1));
      }
    }, 900);
  }

  // ---------- test hook (QA / designer screenshot scripts) ----------

  window.__potionPour = {
    state() {
      const dead = G.deadEndReveal ? { active: true, reason: G.deadEndReveal.reason } : { active: false, reason: null };
      return {
        level: G.levelNumber,
        isDaily: G.isDaily,
        vials: G.shelfState ? G.shelfState.vials.map((v) => v.slice()) : null,
        capacity: G.shelfState ? G.shelfState.capacity : null,
        undosLeft: G.undosLeft,
        hintsLeft: G.hintsLeft,
        extraVialLeft: G.extraVialLeft,
        par: G.lvlMeta ? G.lvlMeta.par : null,
        chapter: !G.isDaily && LEVELS[G.levelNumber - 1] ? LEVELS[G.levelNumber - 1].chapter : null,
        pours: G.pours,
        stars: G.lvlMeta ? starsFor(G.pours, G.lvlMeta.par) : null,
        selected: G.selected,
        screen: G.screen,
        deadEnd: dead,
        deadEndDialogOpen: deadendDialog.open,
        hint: G.hint ? { a: G.hint.a, b: G.hint.b } : null,
        animCount: G.anims.length,
      };
    },
    pour(a, b) {
      if (!applyPour(a, b)) return false;
      afterCommit(); // no animation to wait for -- the state is already final, so settle immediately
      return true;
    },
    tap(i) {
      handleTap(i);
      return true;
    },
    loadLevel(n) {
      return startLevelNumber(n);
    },
    loadDaily(dateStr) {
      startPlay(generateDaily(dateStr), true);
      return true;
    },
    // Loads an arbitrary hand-built shelf, bypassing the ladder entirely -- for QA/CTO review to construct and
    // exercise scenarios the generator rarely produces by chance (a genuine dead end is hard to reach by random
    // play with the brief's 2-empty-vial ladder; see the THE-110 hand-off). `opts`: { capacity, undos, hints,
    // extraVial, par, colors, level }, all optional. Runs the same afterCommit() a real pour would, so a stuck
    // shelf with no helpers shows the real dead-end panel.
    loadState(vials, opts) {
      const o = opts || {};
      clearSettleTimers();
      clearDeadEndTimers();
      const capacity = o.capacity || 4;
      G.levelNumber = o.level || 9999;
      G.isDaily = false;
      G.lvlMeta = { colors: o.colors || 2, capacity, par: o.par || 1, chapter: null, unlimitedUndo: false, canReset: true };
      G.initialVials = vials.map((v) => v.slice());
      G.shelfState = { vials: vials.map((v) => v.slice()), capacity };
      G.selected = null;
      G.focusIndex = 0;
      G.history = [];
      G.pours = 0;
      G.undosLeft = o.undos !== undefined ? o.undos : 0;
      G.hintsLeft = o.hints !== undefined ? o.hints : 0;
      G.extraVialLeft = o.extraVial !== undefined ? o.extraVial : 0;
      G.anims = [];
      G.wobbles = [];
      G.liftT = {};
      G.clearWave = null;
      G.pops = [];
      G.ripples = [];
      G.hint = null;
      G.deadEndReveal = null;
      G.dealT0 = now();
      updateHelperUI();
      updateCounters();
      showPlayScreen();
      afterCommit();
      return true;
    },
    setSpeed(k) {
      G.speedMul = k > 0 ? k : 1;
    },
    solve() {
      if (!G.shelfState) return null;
      const result = Shelf.solve(G.shelfState, { maxTimeMs: 3000 });
      return result.path;
    },
    undo() {
      return doUndo();
    },
    addExtraVial() {
      return doExtraVial();
    },
    restart() {
      return doRestart();
    },
    hint() {
      useHint();
      return G.hint ? { a: G.hint.a, b: G.hint.b } : null;
    },
    playDemo() {
      playGhostDemo(backToMenu);
      return true;
    },
    resolveDeadEnd() {
      if (!deadendDialog.open) return false;
      deadendDialog.close();
      return true;
    },
  };
})();
