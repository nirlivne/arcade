(function () {
  "use strict";

  const K = window.UIKit;
  const B = window.RushLaneBoard;
  const S = window.RushLaneSave;
  const LEVELS = window.RUSH_LANE_LEVELS;
  const theme = K.applyTheme(window.THEME);
  const store = K.store("rush-lane");
  const $ = (id) => document.getElementById(id);

  // Fills `{name}` placeholders in a theme.text value with the given vars (all player-facing copy that needs
  // runtime numbers still comes from theme.js; only the templating lives in code).
  function T(key, vars) {
    let s = (theme.text && theme.text[key]) || "";
    if (vars) for (const k in vars) s = s.split("{" + k + "}").join(vars[k]);
    return s;
  }

  const canvas = $("board");
  const ctx = canvas.getContext("2d");
  const demoCanvas = $("demo-overlay");
  const demoCtx = demoCanvas.getContext("2d");
  const hud = $("hud");
  const hudBottomEl = document.querySelector(".hud__bottom");
  const cornerEl = $("corner"); // About/how-to/settings: must not be reachable once play has started
  const heartsEl = $("hearts");
  const levelLabelEl = $("levellabel");
  const hudPipCanvas = $("hud-pip");

  // ---------- tokens (read once; canvas code never hard-codes a color, size or duration) ----------

  function readTokens() {
    const css = getComputedStyle(document.documentElement);
    const t = (name) => css.getPropertyValue(name).trim();
    const num = (name) => parseFloat(t(name)) || 0;
    return {
      bg: t("--color-bg"),
      surface: t("--color-surface"),
      surface2: t("--color-surface-2") || t("--color-surface"),
      outline: t("--color-outline"),
      text: t("--color-text"),
      textMuted: t("--color-text-muted"),
      primary: t("--color-primary"),
      accent: t("--color-accent"),
      accentDeep: t("--color-accent-deep") || t("--color-accent"),
      danger: t("--color-danger"),
      dot: t("--color-dot") || t("--color-text-muted"),
      laneHint: t("--color-lane-hint") || t("--color-accent"),
      heart: t("--color-heart") || t("--color-danger"),
      heartEmpty: t("--color-heart-empty") || t("--color-text-muted"),
      arrowGloss: t("--color-arrow-gloss") || "#FFFFFF",
      durFast: num("--dur-fast"),
      durMed: num("--dur-med"),
      durSlow: num("--dur-slow"),
      arrowStroke: num("--arrow-stroke") || 0.42,
      arrowKeyline: num("--arrow-keyline") || 0.08,
      headW: num("--arrow-head-w") || 0.86,
      headLen: num("--arrow-head-len") || 0.52,
      corner: num("--arrow-corner") || 0.5,
      lift: num("--arrow-lift") || 0.09,
      liftPress: num("--arrow-lift-press") || 0.16,
      glossAlpha: num("--arrow-gloss-alpha") || 0.4,
      hitPad: num("--arrow-hit-pad") || 0.2,
      dotR: num("--dot-r") || 0.07,
      exitSpeed: num("--exit-speed") || 26,
      exitRamp: num("--exit-ramp") || 90,
      bumpSpeed: num("--bump-speed") || 26,
      bumpHold: num("--bump-hold") || 50,
      bumpReturn: num("--bump-return") || 160,
      bumpFlash: num("--bump-flash") || 520,
      shakePx: num("--shake-px") || 0,
      streakLife: num("--streak-life") || 420,
      space3: num("--space-3") || 12,
    };
  }
  let TOK = readTokens();

  const ARROW_COLORS = ["--color-arrow-1", "--color-arrow-2", "--color-arrow-3", "--color-arrow-4", "--color-arrow-5"];
  function colorFor(id) {
    const css = getComputedStyle(document.documentElement);
    const name = ARROW_COLORS[id % ARROW_COLORS.length];
    return css.getPropertyValue(name).trim() || TOK.primary;
  }

  // Pip's face photo, if the theme supplies one (theme.js images.hero); null keeps the drawn default.
  let heroImg = null;

  // Sizes a small canvas for the device's pixel ratio (capped at 2x, matching `layout()`) and returns its 2d
  // context already scaled to CSS pixels, for the little Pip canvases outside the main board (HUD, clear, retry).
  function hidpi(canvas, w, h) {
    const d = Math.min(devicePixelRatio || 1, 2);
    canvas.width = w * d;
    canvas.height = h * d;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    const c = canvas.getContext("2d");
    c.setTransform(d, 0, 0, d, 0, 0);
    return c;
  }

  // Rush streaks, the signature: three candy speed lines trailing behind an exiting arrow, fading over
  // --streak-life. Ported from design/rush-lane/render.js drawStreaks (THE-79).
  function drawStreaks(c, at, dir, colorIdx, cell, life) {
    const [dx, dy] = dir, px = -dy, py = dx, fill = colorFor(colorIdx);
    c.save();
    c.lineCap = "round";
    c.globalAlpha = life;
    [[-0.28, 1.6, 0.1], [0, 2.6, 0.0], [0.28, 1.2, 0.35]].forEach(([off, L, lag]) => {
      const sx = at[0] - dx * cell * (0.3 + lag) + px * off * cell;
      const sy = at[1] - dy * cell * (0.3 + lag) + py * off * cell;
      const ex = sx - dx * cell * L, ey = sy - dy * cell * L;
      c.strokeStyle = TOK.outline;
      c.lineWidth = cell * 0.13;
      c.beginPath(); c.moveTo(sx, sy); c.lineTo(ex, ey); c.stroke();
      c.strokeStyle = fill;
      c.lineWidth = cell * 0.07;
      c.beginPath(); c.moveTo(sx, sy); c.lineTo(ex, ey); c.stroke();
    });
    c.restore();
  }

  // Heart: candy fill, ink keyline, hard shadow. state: "full" | "empty" | "breaking". Ported from
  // design/rush-lane/render.js drawHeart (THE-84).
  function heartPath(c, x, y, s) {
    c.beginPath();
    c.moveTo(x, y + s * 0.32);
    c.bezierCurveTo(x - s * 0.55, y - s * 0.05, x - s * 0.42, y - s * 0.5, x, y - s * 0.22);
    c.bezierCurveTo(x + s * 0.42, y - s * 0.5, x + s * 0.55, y - s * 0.05, x, y + s * 0.32);
    c.closePath();
  }
  function drawHeart(c, x, y, s, heartState) {
    const ink = TOK.outline, k = Math.max(2, s * 0.08);
    c.save();
    c.lineJoin = "round";
    if (heartState !== "empty") {
      c.fillStyle = ink;
      heartPath(c, x + s * 0.06, y + s * 0.06, s);
      c.fill();
    }
    heartPath(c, x, y, s);
    c.fillStyle = heartState === "empty" ? TOK.heartEmpty : TOK.heart;
    c.fill();
    c.lineWidth = k;
    c.strokeStyle = heartState === "empty" ? TOK.textMuted : ink;
    c.stroke();
    if (heartState === "full") {
      c.globalAlpha = 0.6;
      c.fillStyle = TOK.arrowGloss;
      c.beginPath();
      c.ellipse(x - s * 0.2, y - s * 0.15, s * 0.09, s * 0.06, -0.6, 0, 7);
      c.fill();
    }
    if (heartState === "breaking") {
      c.globalAlpha = 1;
      c.strokeStyle = ink;
      c.lineWidth = k;
      c.beginPath();
      c.moveTo(x, y - s * 0.2);
      c.lineTo(x - s * 0.08, y);
      c.lineTo(x + s * 0.06, y + s * 0.08);
      c.lineTo(x, y + s * 0.3);
      c.stroke();
    }
    c.restore();
  }

  // Bonk burst at a bump contact: a small ink-outlined white starburst (not red: funny, not shaming). Ported
  // from design/rush-lane/render.js drawBonk (THE-84).
  function drawBonk(c, x, y, s) {
    c.save();
    c.lineJoin = "round";
    c.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8, rad = i % 2 ? s * 0.45 : s;
      c.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
    }
    c.closePath();
    c.fillStyle = TOK.arrowGloss;
    c.fill();
    c.lineWidth = Math.max(2, s * 0.12);
    c.strokeStyle = TOK.outline;
    c.stroke();
    c.restore();
  }

  // Tap puff: a soft ring at the tap point, expanding over --dur-med. Ported from design/rush-lane/render.js
  // drawPuff (THE-84).
  function drawPuff(c, x, y, s, t) {
    c.save();
    c.globalAlpha = 1 - t;
    c.lineWidth = s * 0.12 * (1 - t) + 1;
    c.strokeStyle = TOK.arrowGloss;
    c.beginPath();
    c.arc(x, y, s * (0.3 + 0.5 * t), 0, Math.PI * 2);
    c.stroke();
    c.restore();
  }

  // Pip, the hero: a round gold buddy with an arrow-shaped tuft. mood: "happy" | "wince" | "cheer". `img`
  // (theme.js images.hero) replaces the face disc, clipped to the circle; the tuft and keyline stay. Ported
  // from design/rush-lane/render.js drawPip (THE-79).
  function drawPip(c, x, y, R, mood, img) {
    const ink = TOK.outline, k = Math.max(2, R * 0.09);
    c.save();
    c.lineCap = "round";
    c.lineJoin = "round";
    c.save();
    c.translate(x + R * 0.15, y - R * 0.92);
    c.rotate(-0.5);
    c.fillStyle = colorFor(0);
    c.strokeStyle = ink;
    c.lineWidth = k;
    c.beginPath();
    c.moveTo(0, -R * 0.42);
    c.lineTo(R * 0.26, -R * 0.05);
    c.lineTo(R * 0.08, -R * 0.05);
    c.lineTo(R * 0.08, R * 0.2);
    c.lineTo(-R * 0.08, R * 0.2);
    c.lineTo(-R * 0.08, -R * 0.05);
    c.lineTo(-R * 0.26, -R * 0.05);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();
    c.fillStyle = ink;
    c.beginPath(); c.arc(x + R * 0.1, y + R * 0.1, R, 0, 7); c.fill();
    c.fillStyle = TOK.accent;
    c.beginPath(); c.arc(x, y, R, 0, 7); c.fill();
    if (img) {
      c.save();
      c.beginPath(); c.arc(x, y, R, 0, 7); c.clip();
      c.drawImage(img, x - R, y - R, R * 2, R * 2);
      c.restore();
    }
    c.lineWidth = k;
    c.strokeStyle = ink;
    c.beginPath(); c.arc(x, y, R, 0, 7); c.stroke();
    if (!img) {
      c.fillStyle = colorFor(0);
      c.globalAlpha = 0.45;
      c.beginPath(); c.ellipse(x - R * 0.52, y + R * 0.22, R * 0.17, R * 0.11, 0, 0, 7); c.fill();
      c.beginPath(); c.ellipse(x + R * 0.52, y + R * 0.22, R * 0.17, R * 0.11, 0, 0, 7); c.fill();
      c.globalAlpha = 1;
      c.fillStyle = ink;
      c.strokeStyle = ink;
      c.lineWidth = k;
      if (mood === "wince") {
        [[-1, 1], [1, -1]].forEach(([s]) => {
          c.beginPath();
          c.moveTo(x + s * R * 0.48, y - R * 0.3);
          c.lineTo(x + s * R * 0.25, y - R * 0.18);
          c.lineTo(x + s * R * 0.48, y - R * 0.06);
          c.stroke();
        });
        c.beginPath();
        c.moveTo(x - R * 0.22, y + R * 0.38);
        c.quadraticCurveTo(x - R * 0.11, y + R * 0.28, x, y + R * 0.38);
        c.quadraticCurveTo(x + R * 0.11, y + R * 0.48, x + R * 0.22, y + R * 0.38);
        c.stroke();
      } else {
        c.beginPath(); c.ellipse(x - R * 0.32, y - R * 0.16, R * 0.1, R * 0.15, 0, 0, 7); c.fill();
        c.beginPath(); c.ellipse(x + R * 0.32, y - R * 0.16, R * 0.1, R * 0.15, 0, 0, 7); c.fill();
        if (mood === "cheer") {
          c.beginPath();
          c.moveTo(x - R * 0.34, y + R * 0.16);
          c.quadraticCurveTo(x, y + R * 0.78, x + R * 0.34, y + R * 0.16);
          c.closePath();
          c.fillStyle = TOK.danger;
          c.fill();
          c.stroke();
        } else {
          c.beginPath(); c.arc(x, y + R * 0.1, R * 0.3, 0.2 * Math.PI, 0.8 * Math.PI); c.stroke();
        }
      }
    }
    c.restore();
  }

  // ---------- sound (generated Web Audio, muted respects settings) ----------

  let actx = null;
  function audio() {
    if (!actx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) actx = new Ctx();
    }
    return actx;
  }
  function soundOn() {
    return store.get("sound", true);
  }
  function tone(freq, duration, opts) {
    if (!soundOn()) return;
    const ctxA = audio();
    if (!ctxA) return;
    const o = opts || {};
    const osc = ctxA.createOscillator();
    const gain = ctxA.createGain();
    osc.type = o.type || "sine";
    const t0 = ctxA.currentTime;
    osc.frequency.setValueAtTime(freq, t0);
    if (o.sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.sweepTo), t0 + duration);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(o.volume || 0.18, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(ctxA.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }
  function sndTap() {
    tone(880, 0.025, { type: "triangle", volume: 0.08 });
  }
  // A band-passed noise sweep (DESIGN.md §12 "zip"): a short burst of noise run through a bandpass filter
  // swept low-to-high reads as a "whoosh", unlike a plain oscillator sweep.
  function noiseSweep(fromHz, toHz, duration) {
    if (!soundOn()) return;
    const ctxA = audio();
    if (!ctxA) return;
    const t0 = ctxA.currentTime;
    const buffer = ctxA.createBuffer(1, Math.ceil(ctxA.sampleRate * duration), ctxA.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctxA.createBufferSource();
    noise.buffer = buffer;
    const filter = ctxA.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 1;
    filter.frequency.setValueAtTime(fromHz, t0);
    filter.frequency.exponentialRampToValueAtTime(toHz, t0 + duration);
    const gain = ctxA.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.16, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    noise.connect(filter).connect(gain).connect(ctxA.destination);
    noise.start(t0);
    noise.stop(t0 + duration + 0.02);
  }
  // Each exit in a row plays the next note of the C-major pentatonic (DESIGN.md §12), so a clean streak
  // sounds like it's climbing; reset on a bump or a new level (state.exitStreak).
  const EXIT_NOTES = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5]; // C5 D5 E5 G5 A5 C6
  function sndExit() {
    noiseSweep(400, 2000, 0.16);
    tone(EXIT_NOTES[state.exitStreak % EXIT_NOTES.length], 0.1, { type: "triangle", volume: 0.16 });
    state.exitStreak++;
  }
  function sndBump() {
    tone(160, 0.09, { type: "square", volume: 0.16 });
    setTimeout(() => tone(260, 0.08, { type: "sine", sweepTo: 380, volume: 0.1 }), 90);
  }
  function sndWin() {
    [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.16, { type: "triangle", volume: 0.14 }), i * 90));
  }
  // Level clear, each star socket popping in: a rising ding at G5, B5, D6 (DESIGN.md §12).
  const STAR_DING_FREQS = [784, 988, 1175];
  function sndStarDing(i) {
    tone(STAR_DING_FREQS[i] || STAR_DING_FREQS[STAR_DING_FREQS.length - 1], 0.14, { type: "triangle", volume: 0.15 });
  }
  // Out of hearts: a gentle "wah-wah" slide A4 -> F4 (DESIGN.md §12), never a sad sting.
  function sndLose() {
    tone(440, 0.18, { type: "sine", sweepTo: 415, volume: 0.12 });
    setTimeout(() => tone(415, 0.18, { type: "sine", sweepTo: 349, volume: 0.12 }), 180);
  }

  // ---------- state ----------

  const state = {
    screen: "start", // 'start' | 'demo' | 'levelmap' | 'play' | 'clear' | 'retry' | 'allclear'
    levelNumber: 1,
    isDaily: false,
    isDemo: false,
    dailyDate: null,
    board: null,
    hearts: 3,
    anims: new Map(), // arrowId -> { type: 'slide'|'bump', ... } -- concurrent, so other arrows stay tappable
    presses: new Map(), // pointerId -> { id, downX, downY } while an arrow is lifted but not yet committed
    flash: new Map(), // arrowId -> flash start time (ms)
    shake: null, // { start, dir: [dx, dy] }
    exitStreaks: [], // rush streaks left behind by exiting arrows: { at: [px,py], dir: [dx,dy], colorIdx, start }
    exitStreak: 0, // consecutive clean exits, for the rising pentatonic "zip" (DESIGN.md §12); resets on a bump
    tapPuffs: [], // { at: [px,py], start } -- the pointerdown tap puff ring
    bumpBursts: [], // { at: [px,py], start } -- the white bonk burst at a bump's contact point
    heartBreak: null, // { index, start, until } -- the lost heart's "breaking" crack, before its socket empties
    heartWobble: null, // { index, start, until } -- levels 1-2: the heart wobbles on a bump but isn't lost
    heartFlights: [], // { from:[px,py], to:[px,py], start, duration } -- a small heart flying to the HUD on loss
    pipWinceUntil: 0, // HUD Pip winces for a moment after a bump
    hintId: null,
    hintUntil: 0,
    paused: false,
    speedMul: 1,
    kbdIndex: 0,
    kbdActive: false,
    introPulseId: null, // id of Level 1's free arrow while the ghost hand pulses over it post-demo (DESIGN.md §9 step 4)
    lastExitCell: null, // [x, y] of the most recent arrow exit, the origin for the level-clear dot ripple (DESIGN.md §3)
    clearRipple: null, // { rippleStart, origin } while the post-hush dot ripple plays before the clear panel shows
    clearTimer: 0, // setTimeout id for the hush + ripple before handleClear(), so navigating away can cancel it
  };
  let geo = null;

  function loadProgress() {
    return S.sanitizeProgress(store.get("progress", null), LEVELS.length);
  }
  function saveProgress(levelNumber, stars) {
    const p = loadProgress();
    p.stars[levelNumber] = Math.max(p.stars[levelNumber] || 0, stars);
    p.currentLevel = Math.max(p.currentLevel, Math.min(LEVELS.length, levelNumber + 1));
    store.set("progress", p);
    return p;
  }
  function loadDailyBest() {
    return S.sanitizeDailyBest(store.get("dailyBest", null));
  }
  function saveDailyBest(dateKey, hearts) {
    const best = loadDailyBest();
    best[dateKey] = Math.max(best[dateKey] || 0, hearts);
    store.set("dailyBest", best);
    return best[dateKey];
  }

  function cloneArrows(list) {
    return list.map((a) => a);
  }

  // ---------- layout ----------

  function layout() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    demoCanvas.width = canvas.width;
    demoCanvas.height = canvas.height;
    demoCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!state.board) {
      geo = { width: rect.width, height: rect.height, cell: 0, originX: 0, originY: 0 };
      return;
    }
    const topPad = state.screen === "play" ? 96 : 24;
    const pad = 20;
    const bottomPad = state.screen === "play" ? hudBottomEl.getBoundingClientRect().height + TOK.space3 : pad;
    const availW = rect.width - pad * 2;
    const availH = rect.height - topPad - bottomPad;
    const cell = Math.max(8, Math.floor(Math.min(availW / state.board.w, availH / state.board.h)));
    const boardW = cell * state.board.w;
    const boardH = cell * state.board.h;
    geo = {
      width: rect.width,
      height: rect.height,
      cell,
      originX: (rect.width - boardW) / 2,
      originY: topPad + (availH - boardH) / 2,
    };
  }
  addEventListener("resize", layout);
  addEventListener("orientationchange", layout);

  // ---------- drawing ----------

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function drawBoardPlate() {
    const b = state.board;
    const w = b.w * geo.cell;
    const h = b.h * geo.cell;
    const r = Math.min(24, geo.cell * 0.4);
    ctx.fillStyle = TOK.outline;
    roundRect(ctx, geo.originX + 3, geo.originY + 3, w, h, r);
    ctx.fill();
    ctx.fillStyle = TOK.surface;
    roundRect(ctx, geo.originX, geo.originY, w, h, r);
    ctx.fill();
  }

  // Empty cells show a faint dot, so cleared space visibly reads as space. On a level clear, the dots also carry
  // the outward ripple (DESIGN.md §3): a ring every RIPPLE_RING_MS from the last exit point, each dot popping
  // once as the wavefront passes it.
  function drawEmptyDots(occ, now) {
    const b = state.board;
    const ripple = state.clearRipple;
    ctx.fillStyle = TOK.dot;
    for (let y = 0; y < b.h; y++) {
      for (let x = 0; x < b.w; x++) {
        if (occ.has(B.cellKey(x, y))) continue;
        const cx = geo.originX + (x + 0.5) * geo.cell;
        const cy = geo.originY + (y + 0.5) * geo.cell;
        let scale = 1;
        if (ripple && now >= ripple.rippleStart) {
          const dist = Math.hypot(x - ripple.origin[0], y - ripple.origin[1]);
          const ringElapsed = now - ripple.rippleStart - dist * RIPPLE_RING_MS;
          const pulseLife = 220;
          if (ringElapsed >= 0 && ringElapsed < pulseLife) scale = 1 + 1.4 * Math.sin((ringElapsed / pulseLife) * Math.PI);
        }
        ctx.beginPath();
        ctx.arc(cx, cy, geo.cell * TOK.dotR * scale, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function cellCenter(x, y) {
    return { px: geo.originX + (x + 0.5) * geo.cell, py: geo.originY + (y + 0.5) * geo.cell };
  }

  // The arrow's path can have any number of bends (snakes, spirals); reduce it to its corner points (tail,
  // [bend, bend, ...], head) so each bend can be drawn as a real quarter-circle arc via arcTo, matching the
  // design brief, regardless of how many cells make up each straight run.
  function cornerCells(cells) {
    if (cells.length <= 2) return [cells[0], cells[cells.length - 1]];
    const corners = [cells[0]];
    let prevDir = [cells[1][0] - cells[0][0], cells[1][1] - cells[0][1]];
    for (let i = 2; i < cells.length; i++) {
      const dir = [cells[i][0] - cells[i - 1][0], cells[i][1] - cells[i - 1][1]];
      if (dir[0] !== prevDir[0] || dir[1] !== prevDir[1]) {
        corners.push(cells[i - 1]);
        prevDir = dir;
      }
    }
    corners.push(cells[cells.length - 1]);
    return corners;
  }

  // Traces a rounded polyline through any number of points: a straight line for a single segment, or a
  // chain of arcTo calls (one per interior corner) for a bent or multi-bend path.
  function tracePath(c, points, radius) {
    c.beginPath();
    c.moveTo(points[0].px, points[0].py);
    if (points.length === 2) {
      c.lineTo(points[1].px, points[1].py);
      return;
    }
    for (let i = 1; i < points.length - 1; i++) {
      c.arcTo(points[i].px, points[i].py, points[i + 1].px, points[i + 1].py, radius);
    }
    c.lineTo(points[points.length - 1].px, points[points.length - 1].py);
  }

  function drawArrow(arrow, offsetCells, color, opts) {
    const o = opts || {};
    const [dx, dy] = B.DIRS[arrow.dir];
    const ox = dx * offsetCells * geo.cell;
    const oy = dy * offsetCells * geo.cell;
    const corners = cornerCells(arrow.cells).map(([x, y]) => {
      const c = cellCenter(x, y);
      return { px: c.px + ox, py: c.py + oy };
    });
    const radius = geo.cell * TOK.corner;
    const strokeW = geo.cell * TOK.arrowStroke;
    const keylineW = strokeW + geo.cell * TOK.arrowKeyline * 2;
    const lift = geo.cell * (o.pressed ? TOK.liftPress : TOK.lift);

    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // 1. hard offset shadow (down-right), 2. ink keyline, 3. colour fill.
    ctx.save();
    ctx.translate(lift, lift);
    tracePath(ctx, corners, radius);
    ctx.lineWidth = keylineW;
    ctx.strokeStyle = TOK.outline;
    ctx.stroke();
    ctx.restore();

    tracePath(ctx, corners, radius);
    ctx.lineWidth = keylineW;
    ctx.strokeStyle = TOK.outline;
    ctx.stroke();

    tracePath(ctx, corners, radius);
    ctx.lineWidth = strokeW;
    ctx.strokeStyle = color;
    ctx.stroke();

    // 4. a thin gloss stripe along the top-left edge of the body.
    ctx.save();
    ctx.translate(-strokeW * 0.18, -strokeW * 0.18);
    tracePath(ctx, corners, radius * 0.9);
    ctx.lineWidth = strokeW * 0.22;
    ctx.strokeStyle = TOK.arrowGloss;
    ctx.globalAlpha = TOK.glossAlpha;
    ctx.stroke();
    ctx.restore();

    // arrowhead: a triangle beyond the head end, pointing further in `dir`.
    const head = corners[corners.length - 1];
    const headLen = geo.cell * TOK.headLen;
    const half = geo.cell * TOK.headW * 0.5;
    const tip = { px: head.px + dx * (strokeW * 0.3 + headLen), py: head.py + dy * (strokeW * 0.3 + headLen) };
    const base = { px: head.px + dx * strokeW * 0.3, py: head.py + dy * strokeW * 0.3 };
    const perpX = -dy;
    const perpY = dx;
    function headPath(c, ox2, oy2) {
      c.beginPath();
      c.moveTo(tip.px + ox2, tip.py + oy2);
      c.lineTo(base.px + perpX * half + ox2, base.py + perpY * half + oy2);
      c.lineTo(base.px - perpX * half + ox2, base.py - perpY * half + oy2);
      c.closePath();
    }
    headPath(ctx, lift, lift);
    ctx.fillStyle = TOK.outline;
    ctx.fill();
    headPath(ctx, 0, 0);
    ctx.lineWidth = geo.cell * TOK.arrowKeyline * 2;
    ctx.strokeStyle = TOK.outline;
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fill();

    // danger-flash overlay: both the tapped arrow and its blocker keyline-flash on a bump.
    if (o.flashAlpha > 0) {
      tracePath(ctx, corners, radius);
      ctx.lineWidth = keylineW * 1.15;
      ctx.strokeStyle = TOK.danger;
      ctx.globalAlpha = o.flashAlpha;
      ctx.stroke();
      headPath(ctx, 0, 0);
      ctx.lineWidth = geo.cell * TOK.arrowKeyline * 3;
      ctx.strokeStyle = TOK.danger;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // hint glow: a dashed line down the free lane, plus a soft pulsing outline on the arrow.
    if (o.hint) {
      tracePath(ctx, corners, radius);
      ctx.lineWidth = keylineW * 1.3;
      ctx.strokeStyle = TOK.laneHint;
      ctx.globalAlpha = 0.55 + 0.35 * Math.sin(performance.now() / 130);
      ctx.stroke();
      ctx.globalAlpha = 1;
      const lane = B.laneOf(state.board, arrow.id);
      if (lane.length) {
        const laneHead = cellCenter(lane[0][0], lane[0][1]);
        const laneTail = cellCenter(lane[lane.length - 1][0], lane[lane.length - 1][1]);
        ctx.beginPath();
        ctx.moveTo(laneHead.px, laneHead.py);
        ctx.lineTo(laneTail.px, laneTail.py);
        ctx.setLineDash([geo.cell * 0.18, geo.cell * 0.22]);
        ctx.lineWidth = Math.max(3, geo.cell * 0.08);
        ctx.strokeStyle = TOK.laneHint;
        ctx.globalAlpha = 0.8;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
    }

    // keyboard focus ring, shown only once the player has used the keyboard this session.
    if (o.focused) {
      tracePath(ctx, corners, radius);
      ctx.lineWidth = keylineW * 1.4;
      ctx.strokeStyle = TOK.accentDeep;
      ctx.setLineDash([geo.cell * 0.12, geo.cell * 0.1]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function easeOutBack(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  // Constant-acceleration ramp up to `speed` (cells/s) over `rampMs`, then constant speed: a simple physical
  // stand-in for the brief's "ease-in ramp, then full speed", expressed directly in the feel tokens' units.
  function kinematicDuration(distance, rampMs, speed) {
    if (distance <= 0) return 1;
    const rampSec = rampMs / 1000;
    const rampDist = 0.5 * speed * rampSec;
    if (distance <= rampDist) return rampMs * Math.sqrt(distance / rampDist);
    return rampMs + ((distance - rampDist) / speed) * 1000;
  }
  function kinematicPos(elapsedMs, distance, rampMs, speed) {
    if (distance <= 0) return 0;
    const rampSec = rampMs / 1000;
    const rampDist = Math.min(distance, 0.5 * speed * rampSec);
    const rampTime = rampDist === 0.5 * speed * rampSec ? rampMs : rampMs * Math.sqrt(rampDist / (0.5 * speed * rampSec));
    if (elapsedMs <= rampTime) {
      const a = speed / rampSec;
      const t = elapsedMs / 1000;
      return Math.min(distance, 0.5 * a * t * t);
    }
    const remaining = elapsedMs - rampTime;
    return Math.min(distance, rampDist + (remaining / 1000) * speed);
  }

  function render(now) {
    // Transparent, not an opaque fill: the page's peach gradient and drifting clouds (style.css .sky) show
    // through everywhere the canvas isn't actively drawing the board (design brief §6).
    if (geo) ctx.clearRect(0, 0, geo.width, geo.height);
    const showBoard = (state.screen === "play" || state.screen === "demo") && state.board && geo.cell > 0;
    if (showBoard) {
      ctx.save();
      if (state.shake && !K.reduceMotion()) {
        const elapsed = now - state.shake.start;
        const life = 220;
        if (elapsed < life) {
          const amp = TOK.shakePx * (1 - elapsed / life);
          const wobble = Math.sin(elapsed / 18) * amp;
          ctx.translate(state.shake.dir[0] * wobble, state.shake.dir[1] * wobble);
        } else {
          state.shake = null;
        }
      } else if (state.shake) {
        state.shake = null;
      }

      drawBoardPlate();
      const occ = B.occupancyMap(state.board);
      drawEmptyDots(occ, now);

      const kbdIds = state.kbdActive ? kbdArrowIds() : [];
      const focusedId = kbdIds.length ? kbdIds[state.kbdIndex % kbdIds.length] : null;
      for (const arrow of state.board.arrows.values()) {
        if (state.anims.has(arrow.id)) continue;
        const flashStart = state.flash.get(arrow.id);
        const flashAlpha = flashStart !== undefined ? Math.max(0, 1 - (now - flashStart) / TOK.bumpFlash) : 0;
        if (flashStart !== undefined && flashAlpha <= 0) state.flash.delete(arrow.id);
        drawArrow(arrow, 0, colorFor(arrow.id), {
          flashAlpha,
          hint: arrow.id === state.hintId && now < state.hintUntil,
          focused: arrow.id === focusedId,
          pressed: isPressed(arrow.id),
        });
      }
      // Animations run concurrently (one per arrow id), so tapping another arrow while one slides out or
      // bumps doesn't have to wait; only the animating arrow itself ignores new taps (see onArrowTap).
      const finishedSlides = [];
      const finishedBumps = [];
      for (const anim of state.anims.values()) {
        const elapsed = now - anim.start;
        if (anim.type === "slide") {
          const dist = kinematicPos(elapsed, anim.distanceCells, TOK.exitRamp, TOK.exitSpeed);
          drawArrow(anim.arrow, dist, colorFor(anim.arrow.id), {});
          if (elapsed >= anim.duration) finishedSlides.push(anim);
        } else {
          const dist = bumpPos(elapsed, anim);
          const flashStart = state.flash.get(anim.id);
          const flashAlpha = flashStart !== undefined ? Math.max(0, 1 - (now - flashStart) / TOK.bumpFlash) : 0;
          drawArrow(anim.arrow, dist, colorFor(anim.arrow.id), { pressed: elapsed < anim.advanceDuration, flashAlpha });
          if (elapsed >= anim.duration) finishedBumps.push(anim);
        }
      }
      for (const a of finishedSlides) finishSlide(a);
      for (const a of finishedBumps) finishBump(a);
      for (let i = state.exitStreaks.length - 1; i >= 0; i--) {
        const s = state.exitStreaks[i];
        const life = 1 - (now - s.start) / TOK.streakLife;
        if (life <= 0) {
          state.exitStreaks.splice(i, 1);
          continue;
        }
        drawStreaks(ctx, s.at, s.dir, s.colorIdx, geo.cell, life);
      }
      for (let i = state.bumpBursts.length - 1; i >= 0; i--) {
        const b = state.bumpBursts[i];
        const t = (now - b.start) / TOK.durMed;
        if (t >= 1) {
          state.bumpBursts.splice(i, 1);
          continue;
        }
        drawBonk(ctx, b.at[0], b.at[1], geo.cell * (0.32 + 0.22 * t));
      }
      for (let i = state.tapPuffs.length - 1; i >= 0; i--) {
        const p = state.tapPuffs[i];
        const t = (now - p.start) / TOK.durMed;
        if (t >= 1) {
          state.tapPuffs.splice(i, 1);
          continue;
        }
        drawPuff(ctx, p.at[0], p.at[1], geo.cell * 0.5, t);
      }
      for (let i = state.heartFlights.length - 1; i >= 0; i--) {
        const f = state.heartFlights[i];
        const t = (now - f.start) / f.duration;
        if (t >= 1) {
          state.heartFlights.splice(i, 1);
          continue;
        }
        const ease = 1 - Math.pow(1 - t, 2);
        const x = f.from[0] + (f.to[0] - f.from[0]) * ease;
        const y = f.from[1] + (f.to[1] - f.from[1]) * ease - Math.sin(t * Math.PI) * geo.cell * 0.4;
        ctx.save();
        ctx.globalAlpha = t > 0.7 ? Math.max(0, 1 - (t - 0.7) / 0.3) : 1;
        drawHeart(ctx, x, y, geo.cell * 0.22, "full");
        ctx.restore();
      }
      ctx.restore();
    }
    if (state.screen === "demo" || (state.screen === "play" && state.introPulseId != null)) renderDemoHand(now);
    if (!hud.classList.contains("hidden")) {
      hudPipCtx.clearRect(0, 0, 26, 26);
      drawPip(hudPipCtx, 13, 15, 9, now < state.pipWinceUntil ? "wince" : "happy", heroImg);
      drawHeartsHUD(now);
    }
    requestAnimationFrame(render);
  }
  const hudPipCtx = hidpi(hudPipCanvas, 26, 26);

  // The HUD's three hearts (DESIGN.md §3): drawn, not text glyphs, so a lost one can crack and a safe bump
  // (levels 1-2) can wobble it without loss. Sized to read at a glance (THE-99: ~22px drawn, matching the
  // retry panel's hearts) rather than the old ~8px footprint; the HUD's icon buttons (fixed width,
  // flex-shrink not disabled) don't get squeezed below --hit-min by the wider canvas.
  const HEART_S = 24;
  const HEARTS_W = 84;
  const HEARTS_H = 30;
  const HEART_CX = [14, 42, 70];
  const HEART_CY = 15;
  const heartsCtx = hidpi(heartsEl, HEARTS_W, HEARTS_H);
  function drawHeartsHUD(now) {
    heartsCtx.clearRect(0, 0, HEARTS_W, HEARTS_H);
    for (let i = 0; i < 3; i++) {
      let heartState = i < state.hearts ? "full" : "empty";
      let angle = 0;
      if (state.heartBreak && state.heartBreak.index === i && now < state.heartBreak.until) heartState = "breaking";
      if (state.heartWobble && state.heartWobble.index === i && now < state.heartWobble.until) {
        const t = (now - state.heartWobble.start) / (state.heartWobble.until - state.heartWobble.start);
        angle = Math.sin(t * Math.PI * 3) * (1 - t) * 0.3;
      }
      heartsCtx.save();
      heartsCtx.translate(HEART_CX[i], HEART_CY);
      if (angle) heartsCtx.rotate(angle);
      drawHeart(heartsCtx, 0, 0, HEART_S, heartState);
      heartsCtx.restore();
    }
  }
  // The landing point (canvas coords) of a specific HUD heart, for the small heart that flies there on loss.
  function heartHudPoint(index) {
    const rect = heartsEl.getBoundingClientRect();
    return { px: rect.left + HEART_CX[index], py: rect.top + HEART_CY };
  }
  requestAnimationFrame(render);

  function bumpPos(elapsed, anim) {
    const advanceDuration = anim.advanceDuration;
    const hold = anim.bumpHold !== undefined ? anim.bumpHold : TOK.bumpHold;
    const speed = anim.bumpSpeed !== undefined ? anim.bumpSpeed : TOK.bumpSpeed;
    const holdEnd = advanceDuration + hold;
    if (elapsed <= advanceDuration) return kinematicPos(elapsed, anim.advanceDist, TOK.exitRamp, speed);
    if (elapsed <= holdEnd) return anim.advanceDist;
    const p = Math.min(1, (elapsed - holdEnd) / TOK.bumpReturn);
    return Math.max(0, anim.advanceDist * (1 - easeOutBack(p)));
  }

  // ---------- input ----------

  function kbdArrowIds() {
    return state.board ? [...state.board.arrows.keys()].sort((a, b) => a - b) : [];
  }

  function hitTest(clientX, clientY) {
    if (!state.board || !geo || geo.cell <= 0) return null;
    const rect = canvas.getBoundingClientRect();
    const localX = (clientX - rect.left - geo.originX) / geo.cell;
    const localY = (clientY - rect.top - geo.originY) / geo.cell;
    const pad = TOK.hitPad;
    let best = null;
    let bestDist = Infinity;
    for (const arrow of state.board.arrows.values()) {
      for (const [cx, cy] of arrow.cells) {
        const ddx = Math.max(0, Math.abs(localX - (cx + 0.5)) - (0.5 + pad));
        const ddy = Math.max(0, Math.abs(localY - (cy + 0.5)) - (0.5 + pad));
        if (ddx === 0 && ddy === 0) {
          const dist = Math.hypot(localX - (cx + 0.5), localY - (cy + 0.5));
          if (dist < bestDist) {
            bestDist = dist;
            best = arrow.id;
          }
        }
      }
    }
    return best;
  }

  function isPressed(id) {
    for (const p of state.presses.values()) if (p.id === id) return true;
    return false;
  }

  // DESIGN.md §1 "tap response": the arrow lifts at once on pointerdown plus a tap puff; the move only
  // commits on pointerup over the same arrow (~10 px slop), so a slide-off cancels it. The moving arrow
  // itself ignores new taps (state.anims), but every other arrow stays tappable in the meantime.
  const TAP_SLOP_PX = 10;
  canvas.addEventListener("pointerdown", (e) => {
    if (state.screen !== "play" || state.paused) return;
    const id = hitTest(e.clientX, e.clientY);
    if (id === null || state.anims.has(id)) return;
    state.presses.set(e.pointerId, { id, downX: e.clientX, downY: e.clientY });
    state.tapPuffs.push({ at: [e.clientX, e.clientY], start: performance.now() });
    sndTap();
  });
  canvas.addEventListener("pointerup", (e) => {
    const p = state.presses.get(e.pointerId);
    state.presses.delete(e.pointerId);
    if (!p || state.screen !== "play" || state.paused) return;
    if (Math.hypot(e.clientX - p.downX, e.clientY - p.downY) <= TAP_SLOP_PX) onArrowTap(p.id);
  });
  canvas.addEventListener("pointercancel", (e) => state.presses.delete(e.pointerId));
  canvas.addEventListener("pointerleave", (e) => state.presses.delete(e.pointerId));

  addEventListener("keydown", (e) => {
    // A modal <dialog> (pause, how-to, settings, about) handles its own keys; without this guard, Space/Enter
    // typed at a dialog's own controls (e.g. the sound toggle) bubbles up and is replayed as game input too.
    if (document.querySelector("dialog[open]")) return;
    if (e.key === "?") {
      e.preventDefault();
      pauseGame(); // a no-op outside "play"; keeps the game from running on underneath the how-to sheet
      howTo.open();
      return;
    }
    if (state.screen !== "play") return;
    if (e.key === "p" || e.key === "P" || e.key === "Escape") {
      e.preventDefault();
      pauseGame();
      return;
    }
    if (state.paused) return;
    const ids = kbdArrowIds();
    if (!ids.length) return;
    if (["ArrowRight", "ArrowDown", "Tab"].includes(e.key)) {
      e.preventDefault();
      state.kbdActive = true;
      state.kbdIndex = (state.kbdIndex + 1) % ids.length;
    } else if (["ArrowLeft", "ArrowUp"].includes(e.key)) {
      e.preventDefault();
      state.kbdActive = true;
      state.kbdIndex = (state.kbdIndex - 1 + ids.length) % ids.length;
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      state.kbdActive = true;
      onArrowTap(ids[state.kbdIndex % ids.length]);
    }
  });

  // THE-98: the onboarding demo's bump ran at play speed (~80ms approach, 50ms hold) -- too fast for a
  // fresh-eyes 6-year-old to read as "blocked", per DESIGN.md §9 step 2. In the demo only, slow the approach
  // to 0.4x and hold four times as long at contact so the bump, flash and heart wobble are all visible.
  const DEMO_BUMP_SPEED_MUL = 0.4;
  const DEMO_BUMP_HOLD = 250;

  function onArrowTap(id) {
    if (state.introPulseId != null) endIntroPulse();
    if ((state.screen !== "play" && state.screen !== "demo") || state.paused || !state.board) return;
    if (!state.board.arrows.has(id) || state.anims.has(id)) return;
    const lane = B.laneOf(state.board, id);
    const occ = B.occupancyMap(state.board);
    let blockerIndex = -1;
    for (let i = 0; i < lane.length; i++) {
      const [x, y] = lane[i];
      if (occ.has(B.cellKey(x, y))) {
        blockerIndex = i;
        break;
      }
    }
    if (blockerIndex === -1) {
      sndExit();
      const arrow = B.remove(state.board, id);
      const [edx, edy] = B.DIRS[arrow.dir];
      const exitCell = lane.length ? lane[lane.length - 1] : arrow.cells[arrow.cells.length - 1];
      const exitPt = cellCenter(exitCell[0], exitCell[1]);
      state.lastExitCell = exitCell;
      state.exitStreaks.push({ at: [exitPt.px, exitPt.py], dir: [edx, edy], colorIdx: arrow.id, start: performance.now() });
      const distanceCells = lane.length + arrow.cells.length;
      state.anims.set(arrow.id, {
        type: "slide",
        arrow,
        distanceCells,
        start: performance.now(),
        duration: kinematicDuration(distanceCells, TOK.exitRamp, TOK.exitSpeed) / state.speedMul,
      });
    } else {
      const arrow = state.board.arrows.get(id);
      const blockerId = occ.get(B.cellKey(lane[blockerIndex][0], lane[blockerIndex][1]));
      const heartSafe = state.isDemo || (!state.isDaily && state.levelNumber <= 2);
      // A tap can land after hearts already hit 0 but before finishBump() ends the run (the bump anim is
      // still playing out). Without this, lostIndex goes to -1 and the heart flight animates to nowhere.
      if (!heartSafe && state.hearts <= 0) return;
      const now = performance.now();
      const [dx, dy] = B.DIRS[arrow.dir];
      const headCell = arrow.cells[arrow.cells.length - 1];
      const headCenter = cellCenter(headCell[0], headCell[1]);
      const contactPt = { px: headCenter.px + dx * blockerIndex * geo.cell, py: headCenter.py + dy * blockerIndex * geo.cell };
      state.bumpBursts.push({ at: [contactPt.px, contactPt.py], start: now });
      if (heartSafe) {
        state.heartWobble = { index: state.hearts - 1, start: now, until: now + TOK.bumpFlash };
      } else {
        const lostIndex = state.hearts - 1;
        state.hearts = Math.max(0, state.hearts - 1);
        state.heartBreak = { index: lostIndex, start: now, until: now + TOK.bumpFlash };
        const hudPt = heartHudPoint(lostIndex);
        state.heartFlights.push({ from: [contactPt.px, contactPt.py], to: [hudPt.px, hudPt.py], start: now, duration: TOK.bumpFlash });
      }
      renderHearts();
      sndBump();
      state.exitStreak = 0;
      state.pipWinceUntil = now + 600;
      state.flash.set(id, now);
      if (blockerId !== undefined) state.flash.set(blockerId, now);
      if (!K.reduceMotion()) state.shake = { start: now, dir: [dx, dy] };
      const bumpSpeed = state.isDemo ? TOK.bumpSpeed * DEMO_BUMP_SPEED_MUL : TOK.bumpSpeed;
      const bumpHold = state.isDemo ? DEMO_BUMP_HOLD : TOK.bumpHold;
      const advanceDuration = kinematicDuration(blockerIndex, TOK.exitRamp, bumpSpeed) / state.speedMul;
      state.anims.set(id, {
        type: "bump",
        id,
        arrow,
        advanceDist: blockerIndex,
        advanceDuration,
        bumpSpeed,
        bumpHold,
        start: now,
        duration: (advanceDuration + bumpHold + TOK.bumpReturn) / state.speedMul,
      });
    }
  }

  function finishSlide(anim) {
    state.anims.delete(anim.arrow.id);
    if (state.isDemo) {
      if (state.board.arrows.size === 0) finishDemo();
      return;
    }
    // Guard against firing twice when several arrows finish sliding out in the same frame: only the finish
    // that empties the last of the concurrent animations should start the clear sequence.
    if (state.board.arrows.size === 0 && state.anims.size === 0) startClearSequence();
  }
  function finishBump(anim) {
    state.anims.delete(anim.id);
    if (!state.isDemo && state.hearts <= 0 && state.screen === "play") handleOutOfHearts();
  }

  // DESIGN.md §3: last arrow gone -> a 200 ms hush -> the empty dots ripple outward from the last exit point
  // (a ring every 30 ms) -> then the clear panel. cancelClearSequence() lets a restart/menu tap mid-hush skip
  // straight there instead of a stray handleClear() firing later on a screen the player already left.
  const HUSH_MS = 200;
  const RIPPLE_RING_MS = 30;
  function cancelClearSequence() {
    clearTimeout(state.clearTimer);
    state.clearTimer = 0;
    state.clearRipple = null;
  }
  function startClearSequence() {
    if (K.reduceMotion()) {
      handleClear();
      return;
    }
    const origin = state.lastExitCell || [0, 0];
    const b = state.board;
    const maxDist = Math.max(
      Math.hypot(origin[0], origin[1]),
      Math.hypot(b.w - 1 - origin[0], origin[1]),
      Math.hypot(origin[0], b.h - 1 - origin[1]),
      Math.hypot(b.w - 1 - origin[0], b.h - 1 - origin[1])
    );
    const rippleMs = (maxDist + 1) * RIPPLE_RING_MS;
    state.clearRipple = { rippleStart: performance.now() + HUSH_MS, origin };
    state.clearTimer = setTimeout(() => {
      state.clearTimer = 0;
      handleClear();
    }, HUSH_MS + rippleMs);
  }

  function resolveAnimInstantly() {
    if (!state.anims.size) return;
    state.anims.clear();
    if (state.board.arrows.size === 0) handleClear();
    else if (state.hearts <= 0) handleOutOfHearts();
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pauseGame();
  });

  // ---------- pause ----------

  const pauseDialog = $("pause");
  function pauseGame() {
    // A pause (or a tab hide, via visibilitychange) landing inside the ~200ms hush + ripple would otherwise
    // leave state.screen === "play" with the pause dialog open on top, and the clearTimer would still fire
    // handleClear() underneath it later. Resolve the clear immediately instead of pausing through it.
    if (state.clearTimer) {
      cancelClearSequence();
      handleClear();
      return;
    }
    if (state.screen !== "play" || state.paused) return;
    resolveAnimInstantly();
    if (state.screen !== "play") return;
    state.paused = true;
    if (!pauseDialog.open) pauseDialog.showModal();
  }
  function resumeGame() {
    state.paused = false;
    if (pauseDialog.open) pauseDialog.close();
  }
  // Closing the pause dialog to make room for a sub-dialog (how-to/settings) must NOT resume the game --
  // it stays paused until that sub-dialog itself closes, then the pause dialog reopens underneath it.
  let closingPauseForSubdialog = false;
  function closePauseForSubdialog() {
    closingPauseForSubdialog = true;
    if (pauseDialog.open) pauseDialog.close();
  }
  function reopenPauseIfStillPaused() {
    if (state.paused && state.screen === "play" && !pauseDialog.open) pauseDialog.showModal();
  }
  pauseDialog.addEventListener("close", () => {
    if (closingPauseForSubdialog) {
      closingPauseForSubdialog = false;
      return;
    }
    state.paused = false;
  });

  // ---------- hint ----------

  function useHint() {
    if (state.screen !== "play" || state.paused || !state.board) return;
    const free = B.freeIds(state.board);
    if (!free.length) return;
    state.hintId = free[0];
    state.hintUntil = performance.now() + 1600;
  }

  // ---------- HUD ----------

  // The HUD hearts themselves are drawn every frame by drawHeartsHUD() (crack/wobble need per-frame timing);
  // this just keeps the accessible label in sync with the current count.
  function renderHearts() {
    heartsEl.setAttribute("aria-label", state.hearts + " of 3 hearts left");
  }

  // DESIGN.md §3: the stars pop in one by one, 180 ms apart, each with a rising ding (earned ones fill gold,
  // missing ones stay as grey sockets). `animate` is false for any non-celebratory redraw (there is none today,
  // but the flag keeps this reusable without a silent surprise pop-in).
  function renderStars(container, filled, animate) {
    container.innerHTML = "";
    const spans = [];
    for (let i = 0; i < 3; i++) {
      const span = document.createElement("span");
      span.className = "star " + (i < filled ? "is-filled" : "is-empty");
      span.textContent = "★";
      if (animate && !K.reduceMotion()) span.classList.add("star--pending");
      container.appendChild(span);
      spans.push(span);
    }
    container.setAttribute("aria-label", filled + " of 3 stars");
    if (animate && !K.reduceMotion()) {
      spans.forEach((span, i) => {
        setTimeout(() => {
          span.classList.remove("star--pending");
          span.classList.add("uk-pop");
          sndStarDing(i);
        }, i * 180);
      });
    }
  }

  // DESIGN.md §7: the out-of-hearts panel's three hearts refill one by one instead of appearing full at once.
  function renderRetryHearts(container) {
    container.innerHTML = "";
    const hearts = [];
    for (let i = 0; i < 3; i++) {
      const span = document.createElement("span");
      span.className = "heart is-empty";
      span.textContent = "♡";
      container.appendChild(span);
      hearts.push(span);
    }
    container.setAttribute("aria-label", "3 of 3 hearts refilling");
    const fill = (span) => {
      span.classList.remove("is-empty");
      span.classList.add("is-full");
      span.textContent = "♥";
    };
    if (K.reduceMotion()) {
      hearts.forEach(fill);
    } else {
      hearts.forEach((span, i) => {
        setTimeout(() => {
          fill(span);
          span.classList.add("uk-pop");
        }, 180 + i * 180);
      });
    }
  }

  // ---------- level map ----------

  function renderLevelMap() {
    const grid = $("levelgrid");
    grid.innerHTML = "";
    const progress = loadProgress();
    let chapter = null;
    let chapterGrid = null;
    for (const level of LEVELS) {
      if (level.chapterName !== chapter) {
        chapter = level.chapterName;
        const h = document.createElement("h3");
        h.className = "levelmap__chapter";
        h.textContent = chapter;
        grid.appendChild(h);
        chapterGrid = document.createElement("div");
        chapterGrid.className = "levelmap__grid";
        grid.appendChild(chapterGrid);
      }
      const locked = level.level > progress.currentLevel;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "levelmap__btn";
      btn.disabled = locked;
      btn.setAttribute("aria-current", String(level.level === progress.currentLevel));
      btn.setAttribute("aria-label", "Level " + level.level + (locked ? ", locked" : ""));
      const num = document.createElement("span");
      num.textContent = String(level.level);
      btn.appendChild(num);
      const stars = document.createElement("span");
      stars.className = "levelmap__stars";
      const filled = progress.stars[level.level] || 0;
      stars.textContent = locked ? "" : "★".repeat(filled) + "☆".repeat(3 - filled);
      btn.appendChild(stars);
      if (!locked) btn.addEventListener("click", () => startPlay(level.level));
      chapterGrid.appendChild(btn);
    }
  }

  function showLevelMap() {
    clearTimeout(introDemoTimer);
    state.screen = "levelmap";
    hud.classList.add("hidden");
    hud.setAttribute("aria-hidden", "true");
    cornerEl.classList.remove("hidden");
    renderLevelMap();
    K.showScreen("levelmap");
  }

  // ---------- screens / flow ----------

  function showStart() {
    cancelClearSequence();
    state.screen = "start";
    state.paused = false;
    hud.classList.add("hidden");
    hud.setAttribute("aria-hidden", "true");
    cornerEl.classList.remove("hidden");
    const p = loadProgress();
    const atEnd = p.currentLevel > LEVELS.length;
    $("startinfo").textContent = atEnd ? T("allDone", { total: LEVELS.length }) : T("levelInfo", { n: p.currentLevel, total: LEVELS.length });
    K.showScreen("start");
    layout();
  }

  // Shared by beginLevel, startDaily and playGhostDemo: clears every per-run animation/FX list so a fresh
  // board never shows leftover streaks, bursts or a stale heart-loss flight from the previous run.
  function resetRunFx() {
    state.anims.clear();
    state.presses.clear();
    state.flash.clear();
    state.shake = null;
    state.exitStreaks.length = 0;
    state.exitStreak = 0;
    state.tapPuffs.length = 0;
    state.bumpBursts.length = 0;
    state.heartBreak = null;
    state.heartWobble = null;
    state.heartFlights.length = 0;
    state.pipWinceUntil = 0;
  }

  function beginLevel(levelNumber) {
    cancelDemo();
    endIntroPulse();
    cancelClearSequence();
    const data = LEVELS[levelNumber - 1];
    state.screen = "play";
    state.isDemo = false;
    state.levelNumber = levelNumber;
    state.isDaily = false;
    state.dailyDate = null;
    state.board = B.createBoard(data.w, data.h, cloneArrows(data.arrows));
    state.hearts = 3;
    resetRunFx();
    state.hintId = null;
    state.kbdIndex = 0;
    state.kbdActive = false;
    levelLabelEl.textContent = T("levelLabel", { n: levelNumber });
    hud.classList.remove("hidden");
    hud.setAttribute("aria-hidden", "false");
    cornerEl.classList.add("hidden");
    renderHearts();
    K.showScreen("play-screen");
    layout();
    dispatchEvent(new CustomEvent("game:start", { detail: { level: levelNumber } }));
  }

  function startPlay(levelNumber) {
    clearTimeout(introDemoTimer);
    const n = S.clampInt(levelNumber, 1, LEVELS.length + 1, 1);
    if (n > LEVELS.length) {
      K.showScreen("allclear");
      state.screen = "allclear";
      return;
    }
    beginLevel(n);
  }

  function startDaily(dateStr) {
    clearTimeout(introDemoTimer);
    cancelDemo();
    endIntroPulse();
    cancelClearSequence();
    const date = dateStr ? S.parseLocalDateKey(dateStr) : new Date();
    const seed = K.dailySeed(date, "rush-lane");
    const rand = B.rng(seed);
    const w = 6;
    const h = 6;
    const result = B.generate({ w, h, rand, density: 0.6, maxAttempts: 800, accept: (m) => m.depth >= 3 });
    state.screen = "play";
    state.isDemo = false;
    state.levelNumber = 0;
    state.isDaily = true;
    state.dailyDate = K.dateKey(date);
    state.board = result.board;
    state.hearts = 3;
    resetRunFx();
    state.hintId = null;
    state.kbdIndex = 0;
    state.kbdActive = false;
    levelLabelEl.textContent = T("dailyLabel", { date: state.dailyDate });
    hud.classList.remove("hidden");
    hud.setAttribute("aria-hidden", "false");
    cornerEl.classList.add("hidden");
    renderHearts();
    K.showScreen("play-screen");
    layout();
    dispatchEvent(new CustomEvent("game:start", { detail: { daily: state.dailyDate } }));
  }

  function shareResult() {
    const hearts = state.hearts;
    const emoji = "❤️".repeat(hearts) + "🤍".repeat(3 - hearts);
    const text = T("shareText", { date: state.dailyDate, hearts: String(hearts), emoji });
    if (navigator.share) {
      navigator.share({ text }).catch(() => {});
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => K.toast(T("copied")))
        .catch(() => K.toast(text));
    } else {
      K.toast(text);
    }
  }

  function handleClear() {
    state.clearRipple = null;
    state.screen = "clear";
    hud.classList.add("hidden");
    hud.setAttribute("aria-hidden", "true");
    cornerEl.classList.remove("hidden");
    const stars = state.hearts;
    let isBest = false;
    if (state.isDaily) {
      const prevBest = loadDailyBest()[state.dailyDate] || 0;
      saveDailyBest(state.dailyDate, stars);
      isBest = stars > prevBest;
    } else {
      saveProgress(state.levelNumber, stars);
    }
    $("clear-level").textContent = state.isDaily ? T("dailyLabel", { date: state.dailyDate }) : T("levelLabel", { n: state.levelNumber });
    renderStars($("clear-stars"), stars, true);
    const nextBtn = $("next");
    const shareBtn = $("clear-share");
    if (state.isDaily) {
      // Daily has no "next level" to go to, so Share (not a second Menu button) is the primary action.
      nextBtn.classList.add("hidden");
      shareBtn.classList.remove("hidden");
      shareBtn.classList.remove("uk-btn--secondary");
      shareBtn.classList.add("uk-btn--lg");
    } else {
      nextBtn.classList.remove("hidden");
      nextBtn.textContent = state.levelNumber < LEVELS.length ? T("next") : T("menu");
      shareBtn.classList.add("hidden");
      shareBtn.classList.remove("uk-btn--lg");
      shareBtn.classList.add("uk-btn--secondary");
    }
    $("clear-badge").textContent = T("win");
    $("clear-newbest").classList.toggle("hidden", !isBest);
    drawPip(hidpi($("clear-pip"), 92, 92), 46, 50, 40, "cheer", heroImg);
    K.showScreen("clear");
    if (!K.reduceMotion()) K.celebrate();
    sndWin();
    dispatchEvent(new CustomEvent("game:over", { detail: { score: stars } }));
  }

  function handleOutOfHearts() {
    state.screen = "retry";
    hud.classList.add("hidden");
    hud.setAttribute("aria-hidden", "true");
    cornerEl.classList.remove("hidden");
    $("retry-info").textContent = state.isDaily ? T("retryInfoDaily") : T("retryInfoLevel", { n: state.levelNumber });
    drawPip(hidpi($("retry-pip"), 92, 92), 46, 50, 40, "happy", heroImg);
    renderRetryHearts($("retry-hearts"));
    K.showScreen("retry");
    sndLose();
    dispatchEvent(new CustomEvent("game:over", { detail: { score: 0 } }));
  }

  // ---------- ghost-hand onboarding demo ----------

  // 3x4, per DESIGN.md §9 (THE-98: B is now 2 cells, not the game's last 1-cell stub -- the extra row keeps
  // one empty cell between B's head and A's tail, so the bump still has a short approach to animate). A (id
  // 1, tomato) points right with a clear lane; B (id 2, sky) points up into A's body -- the bump teaching moment.
  function demoBoard() {
    return B.createBoard(3, 4, [
      { id: 1, cells: [[0, 0], [1, 0]], dir: "right" },
      { id: 2, cells: [[1, 3], [1, 2]], dir: "up" },
    ]);
  }

  // THE-98: glides from the hand's current (possibly mid-flight) position instead of always restarting from
  // the corner, so it doesn't visibly teleport away from an arrow the moment a new target is aimed.
  function aimDemoHand(x, y) {
    const now = performance.now();
    demoHand.from = demoHand.active && demoHand.target ? demoHandPos(now) : { px: geo.width * 0.85, py: geo.height * 0.85 };
    demoHand.active = true;
    demoHand.start = now;
    demoHand.target = cellCenter(x, y);
  }

  let demoTimer = null;
  // id of the auto-fired first-run ghost-hand demo timeout (see the K.firstRun block near init); cancelled by
  // any real navigation away from "start" so it can't yank a level the player already jumped into.
  let introDemoTimer = 0;
  // How long the demo's slowed bump (DEMO_BUMP_SPEED_MUL approach + DEMO_BUMP_HOLD) plus its heart wobble
  // take to read, before the hand is allowed to glide off to the next target (THE-98: it used to leave the
  // instant the tap landed, so it was never on screen for the bump it had just caused).
  const DEMO_BUMP_WATCH_MS = 650;
  const DEMO_STEP_MS = 900;
  // Scripts the full DESIGN.md §9 sequence: tap B (blocked by A -> bump, bonk, Pip winces, heart wobbles but
  // stays, §9 step 2), tap A (clear lane -> zip, streaks, §9 step 3), tap B again (A is gone now, so B's lane
  // is clear too -> zip, board empties, confetti), then hand off into real play. `onDone` is what runs after
  // the clear puff -- Level 1 for the automatic first-run demo (with `intro: true`, so §9 step 4's pulse-until-
  // first-tap hand-off follows), back to Start for a player who asked to see it again via "Show me".
  function playGhostDemo(onDone, opts) {
    clearTimeout(demoTimer);
    demoOnDone = onDone || showStart;
    demoIsIntro = Boolean(opts && opts.intro);
    state.screen = "demo";
    state.isDemo = true;
    state.board = demoBoard();
    resetRunFx();
    state.hearts = 3;
    renderHearts();
    // HUD stays visible (unlike a hidden overlay) so the bump's Pip wince and heart wobble actually read;
    // hud--demo just hides the pause/hint/restart buttons, which the ghost hand never touches.
    hud.classList.remove("hidden");
    hud.classList.add("hud--demo");
    hud.setAttribute("aria-hidden", "false");
    cornerEl.classList.add("hidden");
    K.showScreen("play-screen"); // transparent screen, so the demo board itself is what's visible
    demoCanvas.classList.remove("hidden");
    layout();
    aimDemoHand(1, 2); // B's head -- blocked by A
    demoTimer = setTimeout(() => {
      onArrowTap(2); // bump
      demoTimer = setTimeout(() => {
        aimDemoHand(1, 0); // A's head -- clear lane; only glide away once the bump above has been watched
        demoTimer = setTimeout(() => {
          onArrowTap(1);
          aimDemoHand(1, 2); // back to B -- now free
          demoTimer = setTimeout(() => {
            onArrowTap(2);
          }, DEMO_STEP_MS);
        }, DEMO_STEP_MS);
      }, DEMO_BUMP_WATCH_MS);
    }, DEMO_STEP_MS);
  }

  let demoOnDone = showStart;
  let demoIsIntro = false;
  function finishDemo() {
    demoHand.active = false;
    const onDone = demoOnDone;
    const intro = demoIsIntro;
    if (!K.reduceMotion()) {
      K.celebrate({ count: 28, duration: 700 }).then(() => {
        cancelDemo();
        onDone();
        if (intro) startIntroPulse();
      });
    } else {
      cancelDemo();
      onDone();
      if (intro) startIntroPulse();
    }
  }

  // §9 step 4: Level 1 has dealt in (via onDone above); the ghost hand hovers and pulses over its one free
  // arrow, and "Try it!" appears for the first time, only now that the player can actually act.
  function startIntroPulse() {
    if (!state.board) return;
    const freeIds = B.freeIds(state.board);
    if (!freeIds.length) return;
    const arrow = state.board.arrows.get(freeIds[0]);
    const head = arrow.cells[arrow.cells.length - 1];
    state.introPulseId = freeIds[0];
    demoCanvas.classList.remove("hidden");
    aimDemoHand(head[0], head[1]);
    $("demo-caption").classList.remove("hidden");
  }

  function endIntroPulse() {
    state.introPulseId = null;
    demoHand.active = false;
    demoCanvas.classList.add("hidden");
    $("demo-caption").classList.add("hidden");
  }

  // Cleans up the ghost-hand overlay without touching what screen is shown next -- used both when the demo
  // finishes on its own and when a real level starts mid-demo (for example a test hook call), so the overlay
  // and caption never get left behind.
  function cancelDemo() {
    clearTimeout(demoTimer);
    demoHand.active = false;
    demoCanvas.classList.add("hidden");
    $("demo-caption").classList.add("hidden");
    hud.classList.remove("hud--demo");
    state.isDemo = false;
  }

  const demoHand = { active: false, phase: "approach", start: 0, from: null, target: null };
  // The hand's interpolated position at `now`, mid-glide from `demoHand.from` to `demoHand.target`. Shared by
  // aimDemoHand (to capture a mid-flight position as the next leg's start) and renderDemoHand (to draw it).
  function demoHandPos(now) {
    const t = Math.min(1, (now - demoHand.start) / 700);
    const ease = 1 - Math.pow(1 - t, 3);
    return {
      px: demoHand.from.px + (demoHand.target.px - demoHand.from.px) * ease,
      py: demoHand.from.py + (demoHand.target.py - demoHand.from.py) * ease,
    };
  }
  function renderDemoHand(now) {
    demoCtx.clearRect(0, 0, geo.width, geo.height);
    if (!demoHand.active || !demoHand.target || !geo.cell) return;
    const t = Math.min(1, (now - demoHand.start) / 700);
    const { px, py } = demoHandPos(now);
    const pressed = t >= 1 && Math.floor((now - demoHand.start) / 260) % 2 === 0;
    const r = geo.cell * (pressed ? 0.42 : 0.38);
    demoCtx.beginPath();
    demoCtx.arc(px, py, r, 0, Math.PI * 2);
    demoCtx.fillStyle = TOK.outline;
    demoCtx.globalAlpha = 0.28;
    demoCtx.fill();
    demoCtx.globalAlpha = 1;
    demoCtx.lineWidth = 3;
    demoCtx.strokeStyle = TOK.outline;
    demoCtx.stroke();
  }

  // ---------- how-to, settings, about ----------

  const howTo = K.howTo($("howto"), { onClose: reopenPauseIfStillPaused });
  $("howto-btn").addEventListener("click", () => howTo.open());
  $("pause-howto").addEventListener("click", () => {
    closePauseForSubdialog();
    howTo.open();
  });

  const soundBtn = $("sound-btn");
  const soundIconOn = '<path d="M4 9v6h4l5 5V4L8 9H4z"/><path d="M17 8a5 5 0 0 1 0 8M19.5 5.5a8 8 0 0 1 0 13"/>';
  const soundIconOff = '<path d="M4 9v6h4l5 5V4L8 9H4z"/><path d="M16 9l6 6M22 9l-6 6"/>';
  function renderSoundBtn(on) {
    soundBtn.setAttribute("aria-pressed", String(on));
    soundBtn.setAttribute("aria-label", on ? "Sound: on" : "Sound: off");
    soundBtn.querySelector("svg").innerHTML = on ? soundIconOn : soundIconOff;
  }
  K.bindToggle($("opt-sound"), store, "sound", true, renderSoundBtn);
  soundBtn.addEventListener("click", () => {
    const on = !soundOn();
    store.set("sound", on);
    $("opt-sound").checked = on;
    renderSoundBtn(on);
  });
  K.bindToggle($("opt-motion"), store, "reduceMotion", K.reduceMotion(), (on) =>
    document.documentElement.setAttribute("data-reduce-motion", String(on))
  );
  $("settings-btn").addEventListener("click", () => $("settings").showModal());
  $("settings-close").addEventListener("click", () => $("settings").close());
  $("settings").addEventListener("close", reopenPauseIfStillPaused);
  $("pause-settings").addEventListener("click", () => {
    closePauseForSubdialog();
    $("settings").showModal();
  });

  $("about-btn").addEventListener("click", () => $("about").showModal());
  $("about-close").addEventListener("click", () => $("about").close());

  // ---------- wiring ----------

  $("play").addEventListener("click", () => {
    const p = loadProgress();
    startPlay(p.currentLevel);
  });
  $("levels-btn").addEventListener("click", showLevelMap);
  $("showme-btn").addEventListener("click", () => playGhostDemo());
  $("levelmap-menu").addEventListener("click", showStart);
  $("daily-btn").addEventListener("click", () => startDaily());
  $("restart").addEventListener("click", () => {
    if (state.screen !== "play") return;
    dispatchEvent(new CustomEvent("game:restart"));
    if (state.isDaily) startDaily(state.dailyDate);
    else beginLevel(state.levelNumber);
  });
  $("hint-btn").addEventListener("click", useHint);
  $("pause-btn").addEventListener("click", pauseGame);
  $("pause-resume").addEventListener("click", resumeGame);
  $("pause-close").addEventListener("click", resumeGame);
  $("pause-menu").addEventListener("click", () => {
    resumeGame();
    showStart();
  });
  $("next").addEventListener("click", () => {
    if (state.isDaily || state.levelNumber >= LEVELS.length) showStart();
    else startPlay(state.levelNumber + 1);
  });
  $("clear-share").addEventListener("click", shareResult);
  $("clear-menu").addEventListener("click", showStart);
  $("retry-again").addEventListener("click", () => {
    dispatchEvent(new CustomEvent("game:restart"));
    if (state.isDaily) startDaily(state.dailyDate);
    else beginLevel(state.levelNumber);
  });
  $("retry-menu").addEventListener("click", showStart);
  $("allclear-daily").addEventListener("click", () => startDaily());
  $("allclear-menu").addEventListener("click", showStart);

  if (K.firstRun(store, "seenDemo")) {
    // §9 step 1: the title shows for about 1 s before the ghost hand takes over, so a brand-new player
    // gets a beat to read the title instead of being dropped straight into a moving board. If the player
    // already acted (Play/Levels/Daily, each of which clears introDemoTimer) or opened a dialog before this
    // fires, skip the demo instead of yanking them out of whatever they started (THE-87).
    showStart();
    introDemoTimer = setTimeout(() => {
      introDemoTimer = 0;
      if (state.screen === "start" && !document.querySelector("dialog[open]")) {
        playGhostDemo(() => startPlay(1), { intro: true });
      }
    }, 900);
  } else showStart();

  // ---------- test hook (QA / designer screenshot scripts) ----------

  window.__rushLane = {
    state() {
      const arrows = state.board
        ? [...state.board.arrows.values()].map((a) => ({ id: a.id, cells: a.cells, dir: a.dir }))
        : [];
      return {
        screen: state.screen,
        level: state.levelNumber,
        isDaily: state.isDaily,
        dailyDate: state.dailyDate,
        hearts: state.hearts,
        w: state.board ? state.board.w : 0,
        h: state.board ? state.board.h : 0,
        arrows,
        freeIds: state.board ? B.freeIds(state.board) : [],
        animating: state.anims.size > 0,
        paused: state.paused,
        progress: loadProgress(),
        dailyBest: loadDailyBest(),
      };
    },
    tap(id) {
      onArrowTap(id);
    },
    loadLevel(n) {
      startPlay(n);
    },
    loadDaily(dateStr) {
      startDaily(dateStr);
    },
    setSpeed(k) {
      state.speedMul = k > 0 ? k : 1;
    },
    hint() {
      useHint();
    },
    pause() {
      pauseGame();
    },
    resume() {
      resumeGame();
    },
    showLevelMap() {
      showLevelMap();
    },
    showStart() {
      showStart();
    },
    playDemo() {
      playGhostDemo();
    },
    boardBox() {
      if (!geo || !state.board) return null;
      return { x: geo.originX, y: geo.originY, width: state.board.w * geo.cell, height: state.board.h * geo.cell };
    },
  };

  // ---------- lockup (RUSH cream / LANE gold, split from theme.title so a re-skin stays data-driven) ----------

  (function renderLockup() {
    const words = (theme.title || "Rush Lane").split(" ");
    $("lockup-w1").textContent = words[0] || "";
    $("lockup-w2").textContent = words.slice(1).join(" ");
    $("lockup").setAttribute("aria-label", theme.title || "Rush Lane");
  })();

  // ---------- mascot (start screen: Pip, the hero, riding under the lockup) ----------

  K.loadImageSlots(theme).then((slots) => {
    heroImg = slots.hero;
    const c = $("mascot").getContext("2d");
    c.clearRect(0, 0, 120, 120);
    drawPip(c, 60, 66, 44, "happy", heroImg);
  });
})();
