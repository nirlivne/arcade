// Tidy Tiles: rendering, input, screens, storage and share. Rules live in logic.js (TidyLogic).
(function () {
  'use strict';
  var L = TidyLogic;
  var SIZE = L.SIZE;
  var css = getComputedStyle(document.documentElement);
  var token = function (n) { return css.getPropertyValue(n).trim(); };
  var num = function (n) { return parseFloat(token(n)) || 0; };

  var $ = function (id) { return document.getElementById(id); };
  var canvas = $('c'), ctx = canvas.getContext('2d');
  var reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- tokens read once ----
  var T = {};
  var GLAZE_NAMES = [null, 'cobalt', 'celadon', 'terra', 'ochre'];
  function withAlpha(hex, a) {
    var h = String(hex).trim().replace('#', '');
    if (h.length === 3) h = h.replace(/./g, '$&$&');
    return 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16) + ',' + a + ')';
  }
  function readTokens() {
    T.glaze = GLAZE_NAMES.map(function (n) {
      return n && { fill: token('--color-glaze-' + n), deep: token('--color-glaze-' + n + '-deep'), motif: token('--color-glaze-' + n + '-motif') };
    });
    ['cell', 'grout', 'grout-gold', 'frame', 'frame-motif', 'gloss', 'heritage', 'heritage-paint', 'bisque', 'bisque-crackle',
      'danger', 'accent', 'surface', 'text', 'text-muted', 'outline', 'bg-2'].forEach(function (n) { T[n] = token('--color-' + n); });
    T.inset = num('--tile-inset'); T.radius = num('--tile-radius'); T.frameW = num('--frame-w'); T.boardMax = num('--board-max');
    T.trayCell = num('--tray-cell') || 0.55; T.lift = num('--drag-lift') || 1.5; T.safeBottom = num('--safe-bottom') || 60;
    T.glossAlpha = num('--gloss-alpha'); T.pool = num('--pool-alpha'); T.shake = num('--shake-px');
    T.fast = num('--dur-fast'); T.med = num('--dur-med'); T.slow = num('--dur-slow'); T.stagger = num('--stagger');
    T.radiusMd = num('--radius-md'); T.radiusLg = num('--radius-lg');
    T.fontDisplay = token('--font-display');
  }

  // ---- storage (localStorage may be blocked or corrupt) ----
  var mem = {};
  var store = {
    get: function (k) {
      try { var v = localStorage.getItem('tidy-tiles:' + k); if (v !== null) return v; } catch (e) { /* blocked */ }
      return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null;
    },
    set: function (k, v) {
      mem[k] = String(v);
      try { localStorage.setItem('tidy-tiles:' + k, String(v)); } catch (e) { /* blocked */ }
    }
  };
  function getScore(k) {
    var v = Number(store.get(k));
    return isFinite(v) && v >= 0 && v <= 1e9 && Math.floor(v) === v ? v : 0;
  }
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  function getStreak() {
    try {
      var s = JSON.parse(store.get('streak'));
      if (s && DATE_RE.test(s.last) && Math.floor(s.count) === s.count && s.count >= 1 && s.count <= 99999) return { last: s.last, count: s.count };
    } catch (e) { /* corrupt */ }
    return null;
  }
  function liveStreak() {
    var s = getStreak(), today = L.localDate();
    return s && (s.last === today || s.last === L.prevDate(today)) ? s.count : 0;
  }
  function getDaily() {
    try {
      var d = JSON.parse(store.get('daily'));
      if (d && DATE_RE.test(d.date) && isFinite(d.score) && d.score >= 0 && d.score <= 1e9) return d;
    } catch (e) { /* corrupt */ }
    return null;
  }

  // ---- state ----
  var g = null;            // logic game
  var screen = 'start';    // start | play | over | paused
  var drag = null;         // { id, idx, x, y, touch }
  var kb = null;           // { idx, r, c }
  var fx = [];
  var heritage = {};       // cell index -> true for pre-patterned tiles still on the board
  var lay = null;
  var runDate = '';
  var lockUntil = 0, overTimer = 0, shakeUntil = 0, shakeAmt = 0, overAt = 0;
  var lastResult = null;
  var paramSeed = null;
  try {
    var q = new URLSearchParams(location.search).get('seed');
    if (q && /^[\w-]{1,40}$/.test(q)) paramSeed = q;
  } catch (e) { /* no search params */ }

  function now() { return performance.now(); }
  function emit(name, detail) { window.dispatchEvent(new CustomEvent(name, { detail: detail || {} })); }
  function say(t) { $('status').textContent = t; }

  function randomSeed() {
    var a = new Uint32Array(2);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a);
    else { a[0] = (Math.random() * 4294967296) >>> 0; a[1] = (Math.random() * 4294967296) >>> 0; }
    return a[0].toString(36) + a[1].toString(36);
  }

  // ---- screens ----
  function show(id, on) { $(id).classList.toggle('hidden', !on); }
  function setScreen(s) {
    screen = s;
    show('start', s === 'start');
    show('paused', s === 'paused');
    if (s !== 'over') show('over', false);
    show('hud', s !== 'start');
    if (s !== 'start') show('about', false);
  }

  function bestKey() { return g && g.mode === 'endless' ? 'best-endless' : 'best-daily'; }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function shortDate(d) { return MONTHS[Number(d.slice(5, 7)) - 1] + ' ' + Number(d.slice(8)); }

  function updateHud() {
    if (!g) return;
    $('score').textContent = g.score;
    $('best').textContent = Math.max(getScore(bestKey()), g.score);
    var st = liveStreak();
    $('modeline').textContent = (g.mode === 'endless' ? 'Endless' : 'Daily ' + shortDate(runDate)) + (st ? '  🔥 ' + st : '');
  }

  function updateStartInfo() {
    var d = getDaily(), st = liveStreak(), parts = [];
    if (d && d.date === L.localDate()) parts.push('Today: ' + d.score);
    var b = getScore('best-daily'); if (b) parts.push('Best: ' + b);
    if (st) parts.push('🔥 ' + st + (st === 1 ? ' day' : ' days'));
    $('startinfo').textContent = parts.join('  ·  ');
  }

  function startGame(mode, seedOverride) {
    var wasStart = screen === 'start';
    var seed = seedOverride || (mode === 'daily' ? (paramSeed || L.localDate()) : 'endless-' + randomSeed());
    clearTimeout(overTimer);
    g = L.createGame(seed, mode);
    runDate = DATE_RE.test(seed) ? seed : L.localDate();
    heritage = {};
    g.mut.pattern.forEach(function (p) { heritage[p[0]] = true; });
    fx = []; drag = null; kb = null; lastResult = null;
    setScreen('play');
    layout();
    updateHud();
    say(mode === 'daily' ? 'Daily puzzle started' : 'Endless run started');
    emit(wasStart ? 'game:start' : 'game:restart', { mode: mode, seed: seed });
  }

  function restart() {
    if (!g) return;
    startGame(g.mode, g.mode === 'daily' ? g.seed : null);
  }

  function finish() {
    var best = getScore(bestKey());
    var isBest = g.score > best;
    if (isBest) store.set(bestKey(), g.score);
    var streak = null;
    if (g.mode === 'daily') {
      streak = L.nextStreak(getStreak(), runDate);
      store.set('streak', JSON.stringify(streak));
      var d = getDaily();
      if (!d || d.date !== runDate || g.score > d.score) store.set('daily', JSON.stringify({ date: runDate, score: g.score }));
    }
    lastResult = { score: g.score, best: Math.max(best, g.score), isBest: isBest, streak: streak ? streak.count : 0 };
    screen = 'over';
    drag = null; kb = null;
    overAt = now();
    updateHud();
    say('No move fits. Final score ' + g.score);
    emit('game:over', { score: g.score, mode: g.mode });
    var mine = g;
    clearTimeout(overTimer);
    overTimer = setTimeout(function () { if (screen === 'over' && g === mine) showOver(); }, reduceMotion ? 300 : 900);
  }

  function showOver() {
    $('final').textContent = lastResult.score;
    $('bestline').textContent = 'Best ' + lastResult.best + (g.mode === 'endless' ? ' (endless)' : '');
    show('badge', lastResult.isBest && lastResult.score > 0);
    show('endless2', g.mode === 'daily');
    $('sharemsg').textContent = '';
    show('sharetext', false);
    show('over', true);
    lockUntil = now() + 500;
    $('again').focus();
  }

  // ---- share ----
  function shareText() {
    var head = g.mode === 'daily' ? 'Tidy Tiles ' + runDate : 'Tidy Tiles endless';
    var lines = [head, 'Score ' + g.score + (lastResult && lastResult.streak > 1 ? '  🔥 ' + lastResult.streak : ''), L.shareGrid(g.history)];
    return lines.filter(Boolean).join('\n');
  }
  function shareResult() {
    if (!g) return;
    var text = shareText(), msg = $('sharemsg');
    function manual() {
      var ta = $('sharetext'); ta.value = text; show('sharetext', true); ta.focus(); ta.select();
      msg.textContent = 'Copy your result from the box.';
    }
    function viaShare() {
      if (navigator.share) {
        navigator.share({ text: text }).then(function () { msg.textContent = 'Shared!'; }, function (e) {
          if (e && e.name === 'AbortError') return;
          manual();
        });
      } else manual();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      var p; try { p = navigator.clipboard.writeText(text); } catch (e) { viaShare(); return; }
      p.then(function () { msg.textContent = 'Copied to clipboard!'; }, viaShare);
    } else viaShare();
  }

  // ---- layout ----
  var dpr = 1;
  function layout() {
    var W = window.innerWidth, H = window.innerHeight;
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    var hudEl = $('hud');
    var top = screen === 'start' || hudEl.classList.contains('hidden') ? 56 : hudEl.getBoundingClientRect().bottom;
    var fw = T.frameW, pad = 16, tc = T.trayCell, safe = T.safeBottom;
    var landscape = W > H * 1.15;
    var cell, bx, by, slots = [], goal, trayCellPx;
    if (!landscape) {
      var fixed = top + safe + 2 * fw + 12 + 12 + 2 * 12; // gaps and frame
      cell = Math.min((W - 2 * pad - 2 * fw) / SIZE, T.boardMax / SIZE, (H - fixed) / (SIZE + 0.9 + tc * 5 + 0.4));
      cell = Math.max(16, Math.floor(cell));
      var outer = cell * SIZE + 2 * fw, goalH = cell * 0.9, trayH = cell * tc * 5 + 24;
      var group = goalH + outer + 12 + trayH, avail = H - top - safe;
      var gy = top + Math.max(0, (avail - group) / 2);
      bx = Math.round((W - outer) / 2) + fw; by = Math.round(gy + goalH) + fw;
      goal = { x: bx - fw, y: gy + goalH * 0.05, s: goalH * 0.85 };
      var ty = by - fw + outer + 12, sw = outer / 3;
      for (var i = 0; i < 3; i++) slots.push({ x: bx - fw + sw * i, y: ty, w: sw, h: trayH });
    } else {
      var fixedH = top + 2 * fw + 16;
      cell = Math.max(16, Math.floor(Math.min((H - fixedH) / (SIZE + 0.9), T.boardMax / SIZE)));
      var outerL = cell * SIZE + 2 * fw, goalHL = cell * 0.9, trayW = Math.max(cell * tc * 5 + 24, 96);
      var totalW = outerL + 20 + trayW, x0 = (W - totalW) / 2;
      var gyL = top + Math.max(0, (H - top - 8 - goalHL - outerL) / 2);
      bx = Math.round(x0) + fw; by = Math.round(gyL + goalHL) + fw;
      goal = { x: bx - fw, y: gyL + goalHL * 0.05, s: goalHL * 0.85 };
      var sh = outerL / 3;
      for (var j = 0; j < 3; j++) slots.push({ x: x0 + outerL + 20, y: by - fw + sh * j, w: trayW, h: sh });
    }
    trayCellPx = cell * tc;
    lay = { W: W, H: H, cell: cell, bx: bx, by: by, fw: fw, size: cell * SIZE, slots: slots, goal: goal, tc: trayCellPx };
  }

  // ---- drawing helpers ----
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    r = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function leaf(cx, cy, dx, dy, s) {
    var len = s * 0.3, w = s * 0.07, ex = cx + dx * len, ey = cy + dy * len, mx = (cx + ex) / 2, my = (cy + ey) / 2, px = -dy * w, py = dx * w;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.quadraticCurveTo(mx + px, my + py, ex, ey); ctx.quadraticCurveTo(mx - px, my - py, cx, cy); ctx.fill();
  }

  // Centre mark per glaze so colour is never the only cue: circle, diamond, plus, triangle.
  function mark(color, cx, cy, s) {
    var m = s * 0.11;
    ctx.beginPath();
    if (color === 1) ctx.arc(cx, cy, m, 0, Math.PI * 2);
    else if (color === 2) { ctx.moveTo(cx, cy - m * 1.2); ctx.lineTo(cx + m * 1.2, cy); ctx.lineTo(cx, cy + m * 1.2); ctx.lineTo(cx - m * 1.2, cy); ctx.closePath(); }
    else if (color === 3) { var t = m * 0.45; ctx.rect(cx - m * 1.2, cy - t, m * 2.4, t * 2); ctx.rect(cx - t, cy - m * 1.2, t * 2, m * 2.4); }
    else { ctx.moveTo(cx, cy - m * 1.2); ctx.lineTo(cx + m * 1.2, cy + m); ctx.lineTo(cx - m * 1.2, cy + m); ctx.closePath(); }
    ctx.fill();
  }

  // kind: colour 1..4, 'heritage' (with colour), 'stone'. alpha < 1 draws a ghost (no gloss).
  function drawTile(x, y, s, color, kind, alpha) {
    alpha = alpha === undefined ? 1 : alpha;
    var inset = s * T.inset, r = s * T.radius, tx = x + inset, ty = y + inset, ts = s - inset * 2;
    ctx.save();
    ctx.globalAlpha = alpha;
    var gl = T.glaze[color] || T.glaze[1], fill, deep, motif;
    if (kind === 'heritage') { fill = T.heritage; deep = T.grout; motif = T['heritage-paint']; }
    else if (kind === 'stone') { fill = T.bisque; deep = T.bisque; motif = null; }
    else { fill = gl.fill; deep = gl.deep; motif = gl.motif; }
    rr(tx, ty, ts, ts, r); ctx.fillStyle = fill; ctx.fill(); ctx.clip();
    if (kind === 'stone') {
      ctx.strokeStyle = T['bisque-crackle']; ctx.lineWidth = Math.max(1, s * 0.03); ctx.globalAlpha = alpha * 0.8;
      ctx.beginPath();
      ctx.moveTo(tx + ts * 0.15, ty + ts * 0.3); ctx.lineTo(tx + ts * 0.45, ty + ts * 0.45); ctx.lineTo(tx + ts * 0.55, ty + ts * 0.8);
      ctx.moveTo(tx + ts * 0.45, ty + ts * 0.45); ctx.lineTo(tx + ts * 0.85, ty + ts * 0.35);
      ctx.stroke(); ctx.restore(); return;
    }
    var gr = ctx.createLinearGradient(tx, ty, tx + ts, ty + ts);
    gr.addColorStop(0.45, withAlpha(deep, 0)); gr.addColorStop(1, deep);
    ctx.globalAlpha = alpha * (kind === 'heritage' ? 0.35 : T.pool * 3);
    ctx.fillStyle = gr; ctx.fillRect(tx, ty, ts, ts);
    ctx.globalAlpha = alpha; ctx.fillStyle = motif;
    leaf(x, y, 1, 1, s); leaf(x + s, y, -1, 1, s); leaf(x, y + s, 1, -1, s); leaf(x + s, y + s, -1, -1, s);
    if (kind === 'heritage') {
      ctx.strokeStyle = motif; ctx.lineWidth = s * 0.06;
      ctx.beginPath(); ctx.arc(x + s / 2, y + s / 2, s * 0.24, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = gl.fill;
    }
    mark(color, x + s / 2, y + s / 2, s);
    if (alpha === 1) {
      var sp = ctx.createRadialGradient(tx + ts * 0.3, ty + ts * 0.25, 0, tx + ts * 0.3, ty + ts * 0.25, ts * 0.45);
      sp.addColorStop(0, withAlpha(T.gloss, T.glossAlpha)); sp.addColorStop(1, withAlpha(T.gloss, 0));
      ctx.fillStyle = sp; ctx.fillRect(tx, ty, ts, ts);
      ctx.strokeStyle = T.gloss; ctx.globalAlpha = 0.45; ctx.lineWidth = Math.max(1, s * 0.035);
      ctx.beginPath(); ctx.moveTo(tx + r, ty + ts * 0.05 + 1); ctx.lineTo(tx + ts * 0.7, ty + ts * 0.05 + 1); ctx.stroke();
    }
    ctx.restore();
  }

  function cellTile(i, x, y, s, alpha) {
    var v = g.cells[i];
    if (v === L.STONE) drawTile(x, y, s, 0, 'stone', alpha);
    else drawTile(x, y, s, v, heritage[i] ? 'heritage' : 'glaze', alpha);
  }

  function drawPiece(shape, color, ox, oy, s, alpha) {
    for (var k = 0; k < shape.cells.length; k++) drawTile(ox + shape.cells[k][1] * s, oy + shape.cells[k][0] * s, s, color, 'glaze', alpha);
  }

  function drawBoard() {
    var bx = lay.bx, by = lay.by, cs = lay.cell, fw = lay.fw, size = lay.size, n = SIZE;
    var ox = bx - fw, oy = by - fw, outer = size + 2 * fw;
    rr(ox, oy, outer, outer, T.radiusMd); ctx.fillStyle = T.frame; ctx.fill();
    ctx.fillStyle = T['frame-motif'];
    for (var i = 0; i < n; i++) {
      var pts = [[bx + cs * (i + 0.5), oy + fw / 2], [bx + cs * (i + 0.5), oy + outer - fw / 2], [ox + fw / 2, by + cs * (i + 0.5)], [ox + outer - fw / 2, by + cs * (i + 0.5)]];
      for (var p = 0; p < 4; p++) { ctx.beginPath(); ctx.arc(pts[p][0], pts[p][1], 1.6, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.fillStyle = T.grout; ctx.fillRect(bx, by, size, size);
    var br = g.mut.bonusRow;
    if (br !== null) {
      ctx.fillStyle = T['grout-gold']; ctx.fillRect(bx, by + cs * br, size, cs);
      var py = by + cs * (br + 0.5);
      [ox + fw / 2, ox + outer - fw / 2].forEach(function (px) {
        var d = Math.max(5, fw * 0.5);
        ctx.beginPath(); ctx.moveTo(px, py - d); ctx.lineTo(px + d * 0.8, py); ctx.lineTo(px, py + d); ctx.lineTo(px - d * 0.8, py); ctx.closePath(); ctx.fill();
      });
    }
    var gap = Math.max(1, cs * 0.05);
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
      ctx.fillStyle = T.cell; ctx.fillRect(bx + c * cs + gap / 2, by + r * cs + gap / 2, cs - gap, cs - gap);
    }
    for (var k = 0; k < n * n; k++) if (g.cells[k]) {
      cellTile(k, bx + (k % n) * cs, by + Math.floor(k / n) * cs, cs, 1);
    }
    // goal indicator: a glaze tile with three pips, above the board
    if (g.mut.goalColor) {
      var gl = lay.goal, s = gl.s;
      drawTile(gl.x, gl.y, s, g.mut.goalColor, 'glaze', 1);
      var filled = g.goalCount % L.GOAL_TARGET;
      for (var q = 0; q < L.GOAL_TARGET; q++) {
        var cx = gl.x + s + s * 0.45 + q * s * 0.5, cy = gl.y + s / 2;
        ctx.beginPath(); ctx.arc(cx, cy, s * 0.17, 0, Math.PI * 2);
        if (q < filled) { ctx.fillStyle = T.accent; ctx.fill(); }
        else { ctx.strokeStyle = T['text-muted']; ctx.lineWidth = 2; ctx.stroke(); }
      }
    }
  }

  function drawTray() {
    for (var i = 0; i < 3; i++) {
      var sl = lay.slots[i];
      ctx.save();
      rr(sl.x + 3, sl.y, sl.w - 6, sl.h, T.radiusMd); ctx.fillStyle = T['bg-2']; ctx.globalAlpha = 0.7; ctx.fill(); ctx.restore();
      var p = g.hand[i];
      if (!p) continue;
      var sh = L.SHAPES[p.shape], s = lay.tc;
      var alpha = (drag && drag.idx === i) || (kb && kb.idx === i) ? 0.3 : (screen === 'over' ? 0.55 : 1);
      var ox = sl.x + sl.w / 2 - sh.w * s / 2, oy = sl.y + sl.h / 2 - sh.h * s / 2;
      drawPiece(sh, p.color, ox, oy, s, alpha);
      if (screen === 'over') {
        ctx.strokeStyle = T.danger; ctx.lineWidth = 2;
        for (var k = 0; k < sh.cells.length; k++) { rr(ox + sh.cells[k][1] * s + 2, oy + sh.cells[k][0] * s + 2, s - 4, s - 4, 4); ctx.stroke(); }
      }
      if (kb && kb.idx === i) { rr(sl.x + 3, sl.y, sl.w - 6, sl.h, T.radiusMd); ctx.strokeStyle = T.accent; ctx.lineWidth = 3; ctx.stroke(); }
    }
  }

  // Board position a piece would snap to for a drag.
  function snapFor(d) {
    var p = g.hand[d.idx], sh = L.SHAPES[p.shape], cs = lay.cell;
    var cx = d.x, cy = d.y - (d.touch ? T.lift * cs : 0);
    var col = Math.round((cx - sh.w * cs / 2 - lay.bx) / cs), row = Math.round((cy - sh.h * cs / 2 - lay.by) / cs);
    return { r: row, c: col, cx: cx, cy: cy, sh: sh, p: p, valid: L.canPlace(g.cells, sh, row, col) };
  }

  function drawGhost(sh, color, r, c, valid) {
    var cs = lay.cell;
    for (var k = 0; k < sh.cells.length; k++) {
      var x = lay.bx + (c + sh.cells[k][1]) * cs, y = lay.by + (r + sh.cells[k][0]) * cs;
      if (valid) drawTile(x, y, cs, color, 'glaze', 0.45);
      else { ctx.strokeStyle = T.danger; ctx.lineWidth = 3; rr(x + 3, y + 3, cs - 6, cs - 6, 5); ctx.stroke(); }
    }
    if (valid) {
      // preview which lines this placement completes
      var sim = g.cells.slice();
      sh.cells.forEach(function (q) { sim[(r + q[0]) * SIZE + c + q[1]] = 1; });
      var fl = L.fullLines(sim);
      ctx.strokeStyle = T['grout-gold']; ctx.lineWidth = 3;
      fl.rows.forEach(function (rw) { rr(lay.bx + 1, lay.by + rw * cs + 1, lay.size - 2, cs - 2, 4); ctx.stroke(); });
      fl.cols.forEach(function (cl) { rr(lay.bx + cl * cs + 1, lay.by + 1, cs - 2, lay.size - 2, 4); ctx.stroke(); });
    }
  }

  function drawHeld() {
    if (drag && g.hand[drag.idx]) {
      var s = snapFor(drag), cs = lay.cell;
      var overBoard = s.cx > lay.bx - cs && s.cx < lay.bx + lay.size + cs && s.cy > lay.by - cs && s.cy < lay.by + lay.size + cs;
      if (overBoard) drawGhost(s.sh, s.p.color, s.r, s.c, s.valid);
      drawPiece(s.sh, s.p.color, s.cx - s.sh.w * cs / 2, s.cy - s.sh.h * cs / 2, cs, 0.95);
    } else if (kb && g.hand[kb.idx]) {
      var p = g.hand[kb.idx], sh = L.SHAPES[p.shape];
      drawGhost(sh, p.color, kb.r, kb.c, L.canPlace(g.cells, sh, kb.r, kb.c));
    }
  }

  function cellXY(i) { return [lay.bx + (i % SIZE) * lay.cell, lay.by + Math.floor(i / SIZE) * lay.cell]; }

  function drawFx(t) {
    var cs = lay.cell, alive = [];
    for (var f = 0; f < fx.length; f++) {
      var e = fx[f], age = t - e.t0;
      if (e.type === 'pop') {
        if (age < T.fast) {
          alive.push(e);
          var k = 1 + 0.08 * Math.sin(Math.PI * age / T.fast);
          e.cells.forEach(function (i) {
            var xy = cellXY(i);
            if (g.cells[i]) { ctx.save(); ctx.translate(xy[0] + cs / 2, xy[1] + cs / 2); ctx.scale(k, k); ctx.translate(-cs / 2, -cs / 2); cellTile(i, 0, 0, cs, 1); ctx.restore(); }
          });
        }
      } else if (e.type === 'clear') {
        var life = e.delay + T.med;
        if (age < life) {
          alive.push(e);
          if (age >= e.delay) {
            var u = (age - e.delay) / T.med, xy2 = cellXY(e.i);
            ctx.save(); ctx.translate(xy2[0] + cs / 2, xy2[1] + cs / 2); ctx.scale(1 - u * 0.9, 1 - u * 0.9); ctx.globalAlpha = 1 - u; ctx.translate(-cs / 2, -cs / 2);
            drawTile(0, 0, cs, e.color, e.heritage ? 'heritage' : 'glaze', 1); ctx.restore();
          } else {
            var xy3 = cellXY(e.i); drawTile(xy3[0], xy3[1], cs, e.color, e.heritage ? 'heritage' : 'glaze', 1);
          }
        }
      } else if (e.type === 'glint') {
        if (age < T.slow) {
          alive.push(e);
          var v = age / T.slow, band = cs * 1.4;
          ctx.save(); ctx.globalAlpha = 0.5 * Math.sin(Math.PI * v); ctx.fillStyle = T.gloss;
          if (e.row !== undefined) {
            var gx = lay.bx - band + (lay.size + band * 2) * v;
            ctx.beginPath(); ctx.rect(lay.bx, lay.by + e.row * cs, lay.size, cs); ctx.clip();
            ctx.fillRect(gx, lay.by + e.row * cs, band, cs);
          } else {
            var gy = lay.by - band + (lay.size + band * 2) * v;
            ctx.beginPath(); ctx.rect(lay.bx + e.col * cs, lay.by, cs, lay.size); ctx.clip();
            ctx.fillRect(lay.bx + e.col * cs, gy, cs, band);
          }
          ctx.restore();
        }
      } else if (e.type === 'text') {
        var life2 = T.slow * 1.6;
        if (age < life2) {
          alive.push(e);
          var w2 = age / life2;
          ctx.save(); ctx.globalAlpha = 1 - w2 * w2; ctx.fillStyle = T.accent; ctx.strokeStyle = T.surface; ctx.lineWidth = 4; ctx.lineJoin = 'round';
          ctx.font = '800 ' + Math.round(cs * 0.7) + 'px ' + T.fontDisplay; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          var ty = e.y - w2 * cs * 1.2;
          ctx.strokeText(e.str, e.x, ty); ctx.fillText(e.str, e.x, ty); ctx.restore();
        }
      }
    }
    fx = alive;
  }

  function draw(t) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, lay.W, lay.H);
    if (!g) return;
    ctx.save();
    if (t < shakeUntil && shakeAmt) ctx.translate((Math.random() - 0.5) * 2 * shakeAmt, (Math.random() - 0.5) * 2 * shakeAmt);
    drawBoard();
    drawFx(t);
    drawTray();
    drawHeld();
    ctx.restore();
  }

  var raf = 0;
  function frame(t) { raf = requestAnimationFrame(frame); draw(t); }
  function startLoop() { if (!raf) raf = requestAnimationFrame(frame); }
  function stopLoop() { cancelAnimationFrame(raf); raf = 0; }

  // ---- placing ----
  function doPlace(idx, r, c) {
    if (screen !== 'play' || !g.hand[idx]) return false;
    var piece = g.hand[idx], sh = L.SHAPES[piece.shape];
    var res = L.place(g, idx, r, c);
    if (!res) return false;
    var t = now(), placed = sh.cells.map(function (q) { return (r + q[0]) * SIZE + c + q[1]; });
    if (T.fast > 0) fx.push({ type: 'pop', t0: t, cells: placed });
    if (res.lines && T.med > 0) {
      var mr = r + sh.h / 2, mc = c + sh.w / 2;
      res.cells.forEach(function (q) {
        var dist = Math.abs(Math.floor(q.i / SIZE) + 0.5 - mr) + Math.abs((q.i % SIZE) + 0.5 - mc);
        fx.push({ type: 'clear', t0: t, i: q.i, color: q.color, heritage: !!heritage[q.i], delay: dist * T.stagger });
      });
      res.rows.forEach(function (rw) { fx.push({ type: 'glint', t0: t, row: rw }); });
      res.cols.forEach(function (cl) { fx.push({ type: 'glint', t0: t, col: cl }); });
      fx.push({ type: 'text', t0: t, str: '+' + res.points, x: lay.bx + lay.size / 2, y: lay.by + lay.size / 2 });
      if (res.lines >= 3 && T.shake > 0) { shakeUntil = t + 200; shakeAmt = T.shake; }
    }
    res.cells.forEach(function (q) { delete heritage[q.i]; });
    updateHud();
    say('Score ' + g.score + (res.lines ? ', ' + res.lines + (res.lines === 1 ? ' line' : ' lines') + ' cleared' : ''));
    if (g.over) finish();
    return true;
  }

  // ---- input ----
  function pointerPos(e) { var b = canvas.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; }
  function slotAt(p) {
    for (var i = 0; i < 3; i++) {
      var s = lay.slots[i];
      if (p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y - 8 && p.y <= s.y + s.h + 8) return i;
    }
    return -1;
  }
  canvas.addEventListener('pointerdown', function (e) {
    if (screen !== 'play' || drag) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    var p = pointerPos(e), i = slotAt(p);
    if (i < 0 || !g.hand[i]) return;
    kb = null;
    drag = { id: e.pointerId, idx: i, x: p.x, y: p.y, touch: e.pointerType !== 'mouse' };
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var p = pointerPos(e); drag.x = p.x; drag.y = p.y;
    e.preventDefault();
  });
  canvas.addEventListener('pointerup', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var p = pointerPos(e); drag.x = p.x; drag.y = p.y;
    var d = drag; drag = null;
    if (screen === 'play' && g.hand[d.idx]) {
      var s = snapFor(d);
      if (s.valid) doPlace(d.idx, s.r, s.c);
    }
    e.preventDefault();
  });
  function cancelDrag(e) { if (drag && (!e || e.pointerId === drag.id)) drag = null; }
  canvas.addEventListener('pointercancel', cancelDrag);
  canvas.addEventListener('lostpointercapture', cancelDrag);
  window.addEventListener('blur', function () { cancelDrag(); });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  function kbPick(i) {
    if (!g.hand[i]) return;
    var sh = L.SHAPES[g.hand[i].shape];
    kb = { idx: i, r: Math.max(0, Math.floor((SIZE - sh.h) / 2)), c: Math.max(0, Math.floor((SIZE - sh.w) / 2)) };
  }
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key;
    if (!$('about').classList.contains('hidden')) { if (k === 'Escape') closeAbout(); return; }
    if (screen === 'paused') { if (k === ' ' || k === 'Enter') { e.preventDefault(); resume(); } return; }
    if (screen === 'over') {
      if ((k === 'r' || k === 'R' || (k === 'Enter' && document.activeElement === document.body)) && !$('over').classList.contains('hidden') && now() > lockUntil) { e.preventDefault(); restart(); }
      return;
    }
    if (screen !== 'play') return;
    if (k === 'r' || k === 'R') { restart(); return; }
    if (k >= '1' && k <= '3') { kbPick(Number(k) - 1); e.preventDefault(); return; }
    if (k === 'Escape') { kb = null; return; }
    var dr = 0, dc = 0;
    if (k === 'ArrowUp') dr = -1; else if (k === 'ArrowDown') dr = 1; else if (k === 'ArrowLeft') dc = -1; else if (k === 'ArrowRight') dc = 1;
    if (dr || dc) {
      e.preventDefault();
      if (!kb) { for (var i = 0; i < 3; i++) if (g.hand[i]) { kbPick(i); break; } return; }
      var sh = L.SHAPES[g.hand[kb.idx].shape];
      kb.r = Math.min(SIZE - sh.h, Math.max(0, kb.r + dr)); kb.c = Math.min(SIZE - sh.w, Math.max(0, kb.c + dc));
      return;
    }
    if ((k === 'Enter' || k === ' ') && kb) {
      e.preventDefault();
      var idx = kb.idx, r = kb.r, c = kb.c;
      if (doPlace(idx, r, c)) { kb = null; }
    }
  });

  // ---- pause ----
  function pause() {
    if (screen !== 'play') return;
    drag = null; kb = null;
    setScreen('paused');
    $('resume').focus();
  }
  function resume() { if (screen === 'paused') { setScreen('play'); layout(); } }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { pause(); stopLoop(); }
    else startLoop();
  });

  // ---- about ----
  var aboutOpener = null;
  function openAbout() { aboutOpener = document.activeElement; show('about', true); $('about-close').focus(); }
  function closeAbout() { show('about', false); if (aboutOpener) aboutOpener.focus(); }

  // ---- wiring ----
  $('play').addEventListener('click', function () { startGame('daily'); });
  $('endless').addEventListener('click', function () { startGame('endless'); });
  $('endless2').addEventListener('click', function () { if (now() > lockUntil) startGame('endless'); });
  $('again').addEventListener('click', function () { if (now() > lockUntil) restart(); });
  $('restart').addEventListener('click', function () { restart(); });
  $('share').addEventListener('click', shareResult);
  $('resume').addEventListener('click', resume);
  $('paused').addEventListener('pointerdown', function (e) { if (e.target === $('paused')) resume(); });
  $('about-open').addEventListener('click', openAbout);
  $('about-close').addEventListener('click', closeAbout);
  window.addEventListener('resize', function () { if (lay) layout(); });

  // ---- test hook (read-only view plus the actions a script needs) ----
  function boardRows() {
    var out = [];
    for (var r = 0; r < SIZE; r++) out.push(g.cells.slice(r * SIZE, r * SIZE + SIZE));
    return out;
  }
  function firstMove() {
    for (var i = 0; i < 3; i++) {
      var p = g.hand[i]; if (!p) continue;
      var sh = L.SHAPES[p.shape];
      for (var r = 0; r <= SIZE - sh.h; r++) for (var c = 0; c <= SIZE - sh.w; c++) if (L.canPlace(g.cells, sh, r, c)) return [i, r, c];
    }
    return null;
  }
  var hook = {
    start: function (mode, seed) { startGame(mode || 'daily', seed); },
    place: function (i, r, c) { return doPlace(i, r, c); },
    // play first-fit moves until the run ends (or `max` moves)
    autoplay: function (max) {
      var n = 0;
      while (screen === 'play' && n < (max || 10000)) { var m = firstMove(); if (!m || !doPlace(m[0], m[1], m[2])) break; n++; }
      return n;
    },
    move: function () { return g && screen === 'play' ? firstMove() : null; }
  };
  ['board', 'tray', 'score', 'mutator', 'seed', 'over', 'mode', 'moves', 'screen', 'layout'].forEach(function (name) {
    Object.defineProperty(hook, name, {
      enumerable: true,
      get: function () {
        if (!g) return name === 'screen' ? screen : null;
        switch (name) {
          case 'board': return boardRows();
          case 'tray': return g.hand.map(function (p) { return p ? p.shape : null; });
          case 'score': return g.score;
          case 'mutator': return JSON.parse(JSON.stringify(g.mut));
          case 'seed': return g.seed;
          case 'over': return g.over;
          case 'mode': return g.mode;
          case 'moves': return g.moves;
          case 'layout': return JSON.parse(JSON.stringify({ cell: lay.cell, bx: lay.bx, by: lay.by, size: lay.size, slots: lay.slots }));
          default: return screen;
        }
      }
    });
  });
  Object.defineProperty(window, '__tidy', { value: hook });

  // ---- boot ----
  readTokens();
  var fontReady = document.fonts && document.fonts.load ? document.fonts.load('800 32px Fraunces').catch(function () {}) : Promise.resolve();
  layout();
  // Preview the daily board behind the start screen.
  g = L.createGame(paramSeed || L.localDate(), 'daily');
  runDate = DATE_RE.test(g.seed) ? g.seed : L.localDate();
  heritage = {}; g.mut.pattern.forEach(function (p) { heritage[p[0]] = true; });
  updateStartInfo();
  startLoop();
  fontReady.then(function () { layout(); });
  $('play').focus();
})();
