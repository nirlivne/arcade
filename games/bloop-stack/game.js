'use strict';
(function () {
  var KEY = 'bloop-stack:';
  var W = 400, H = 720;
  var JAR = { l: 50, r: 350, rim: 240, floor: 640 };
  var LINE_Y = 300, AIM_Y = 190, OVER_TIME = 2, DROP_CD = 0.5, STEP = 1 / 120;
  var OUTLINE = '#2A1F4D';
  var TIERS = [
    { n: 'Dot', r: 14, c: '#7DF9C9', d: '#3FD9A3', pts: 1 },
    { n: 'Blinky', r: 19, c: '#FFD84D', d: '#E6B215', pts: 2 },
    { n: 'Grumble', r: 26, c: '#FF8A5B', d: '#E8602C', pts: 4 },
    { n: 'Wobbo', r: 34, c: '#FF6FB5', d: '#DC3C8E', pts: 8 },
    { n: 'Drip', r: 44, c: '#5BC8FF', d: '#2A98DE', pts: 16 },
    { n: 'Zappy', r: 56, c: '#B07BFF', d: '#8046E0', pts: 32 },
    { n: 'Bulgo', r: 70, c: '#4DDB6B', d: '#25AE45', pts: 64 },
    { n: 'Kingloop', r: 86, c: '#FF4D6A', d: '#D02446', pts: 128 }
  ];
  var MAX_T = TIERS.length - 1, KING_BONUS = 256;

  var canvas = document.getElementById('c'), ctx = canvas.getContext('2d');
  var elStart = document.getElementById('start'), elOver = document.getElementById('over');
  var elPaused = document.getElementById('paused');
  var elFinal = document.getElementById('final'), elBest = document.getElementById('bestline');
  var elBadge = document.getElementById('badge'), elStartBest = document.getElementById('startbest');
  var elMute = document.getElementById('mute');
  var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function load(k, d) { try { var v = localStorage.getItem(KEY + k); return v === null ? d : v; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(KEY + k, String(v)); } catch (e) {} }
  function emit(n, detail) { window.dispatchEvent(new CustomEvent(n, { detail: detail })); }

  var best = parseInt(load('best', '0'), 10) || 0;
  var muted = load('mute', '0') === '1';
  function syncMute() { elMute.textContent = muted ? '🔇' : '🔊'; }
  function syncBest() { elStartBest.textContent = 'Best: ' + best; }
  syncMute(); syncBest();

  // ---------- audio ----------
  var ac = null, master = null;
  function audio() {
    if (!ac) {
      try { ac = new (window.AudioContext || window.webkitAudioContext)(); master = ac.createGain(); master.gain.value = 0.3; master.connect(ac.destination); }
      catch (e) { ac = false; }
    }
    if (ac && ac.state === 'suspended') ac.resume();
    return ac;
  }
  function tone(f0, f1, dur, type, vol, delay) {
    if (muted) return;
    var a = audio(); if (!a) return;
    var t0 = a.currentTime + (delay || 0);
    var o = a.createOscillator(), g = a.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.3, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  var noiseBuf = null;
  function thud(vol) {
    if (muted) return;
    var a = audio(); if (!a) return;
    if (!noiseBuf) {
      noiseBuf = a.createBuffer(1, Math.floor(a.sampleRate * 0.06), a.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    }
    var s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    s.buffer = noiseBuf; f.type = 'lowpass'; f.frequency.value = 500; g.gain.value = vol;
    s.connect(f); f.connect(g); g.connect(master); s.start();
  }
  var sfx = {
    drop: function () { tone(220, 160, 0.08, 'triangle', 0.5); },
    land: function (sp) { thud(Math.min(1, sp / 900) * 0.8); },
    merge: function (tier, chain) {
      var f = (300 + 60 * tier) * Math.pow(1.0595, Math.min(chain, 12) - 1);
      tone(f, f * 1.5, 0.12, 'sine', 0.5);
      if (tier >= 5) { tone(f, f, 0.05, 'square', 0.15, 0.0); tone(f * 1.25, f * 1.25, 0.05, 'square', 0.15, 0.07); tone(f * 1.5, f * 1.5, 0.08, 'square', 0.15, 0.14); }
    },
    king: function () { [392, 494, 587, 784, 988].forEach(function (f, i) { tone(f, f, 0.1, 'triangle', 0.4, i * 0.08); }); },
    warn: function () { tone(440, 440, 0.08, 'sine', 0.25); },
    over: function () { [392, 311, 220].forEach(function (f, i) { tone(f, f, 0.18, 'sine', 0.5, i * 0.17); }); },
    best: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, f, 0.12, 'triangle', 0.35, 0.6 + i * 0.09); }); },
    click: function () { tone(1000, 1000, 0.03, 'sine', 0.3); }
  };

  // ---------- state ----------
  var world = null, score = 0, state = 'start'; // start | play | over
  var paused = false, playTime = 0;
  var aimX = W / 2, cur = 0, next = 0, cooldown = 0, overTimer = 0, shake = 0, overAt = 0;
  var chainN = 0, lastMergeAt = -10, maxTier = 0, warnT = 0, streakT = -1, streakN = 0;
  var fx = [], t = 0, rng = Math.random;
  var pointerDown = false, keys = { left: false, right: false };
  var demo = [];

  function rollTier() {
    var r = rng(), w = playTime > 60 ? [25, 55, 80] : [40, 70, 90], k;
    k = r * 100 < w[0] ? 0 : r * 100 < w[1] ? 1 : r * 100 < w[2] ? 2 : 3;
    if (k === streakT) { if (++streakN >= 4) { k = (k + 1) % 4; streakT = k; streakN = 1; } }
    else { streakT = k; streakN = 1; }
    return k;
  }

  function reset() {
    world = new Physics.World({ l: JAR.l, r: JAR.r, floor: JAR.floor });
    score = 0; playTime = 0; streakT = -1; streakN = 0;
    cur = 0; next = rollTier(); cooldown = 0.3; overTimer = 0; shake = 0; fx = [];
    chainN = 0; lastMergeAt = -10; maxTier = 0; aimX = W / 2; warnT = 0;
  }
  function beginGame() {
    audio(); sfx.click();
    reset(); state = 'play';
    elStart.classList.add('hidden'); elOver.classList.add('hidden');
    emit('game:start');
  }
  function restart() {
    audio();
    reset(); state = 'play'; paused = false;
    elOver.classList.add('hidden'); elPaused.classList.add('hidden');
    emit('game:restart');
    emit('game:start');
  }
  function gameOver() {
    state = 'over'; overAt = performance.now();
    var isBest = score > best && score > 0;
    if (score > best) { best = score; save('best', best); }
    elFinal.textContent = score;
    elBest.textContent = 'Best ' + best;
    elBadge.classList.toggle('hidden', !isBest);
    syncBest();
    elOver.classList.remove('hidden');
    sfx.over(); if (isBest) sfx.best();
    emit('game:over', { score: score });
  }
  function setPaused(p) {
    if (state !== 'play' || p === paused) return;
    paused = p; elPaused.classList.toggle('hidden', !p);
    keys.left = keys.right = false; pointerDown = false;
  }

  function clampAim(x) { var r = TIERS[cur].r; return Math.max(JAR.l + r, Math.min(JAR.r - r, x)); }
  function drop() {
    if (state !== 'play' || paused || cooldown > 0) return;
    var tr = TIERS[cur];
    var b = world.add({ x: clampAim(aimX), y: AIM_Y, r: tr.r, t: cur, sc: 1, sv: 0, vx: 0, vy: 150, ph: rng() * 6.28 });
    b.blink = 2 + rng() * 3;
    sfx.drop();
    cur = next; next = rollTier(); cooldown = DROP_CD;
    aimX = clampAim(aimX);
  }

  function processMerges() {
    var ms = world.merges, did = false;
    for (var i = 0; i < ms.length; i++) {
      var a = ms[i][0], c = ms[i][1];
      if (a.dead || c.dead) continue;
      a.dead = c.dead = true; did = true;
      var x = (a.x + c.x) / 2, y = (a.y + c.y) / 2, vx = (a.vx + c.vx) / 2, vy = (a.vy + c.vy) / 2;
      var nt = a.t + 1;
      chainN = (t - lastMergeAt <= 1) ? chainN + 1 : 1;
      lastMergeAt = t;
      var mult = Math.min(chainN, 5);
      var pts = (nt > MAX_T ? KING_BONUS : TIERS[nt].pts) * mult;
      score += pts;
      var label = '+' + pts + (mult > 1 ? ' x' + mult : '');
      if (nt > MAX_T) {
        popFx(x, y, TIERS[a.t], 30); text(x, y, label); sfx.king(); shake = reduced ? 0 : 8;
      } else {
        var n = world.add({ x: x, y: y, r: TIERS[nt].r, t: nt, sc: 0.6, sv: 0, vx: vx, vy: vy, ph: rng() * 6.28 });
        n.blink = 2 + rng() * 3; n.age = 2; n.pop = 0.22;
        if (nt > maxTier) maxTier = nt;
        popFx(x, y, TIERS[nt], 8 + Math.min(6, nt * 2)); text(x, y, label);
        sfx.merge(nt, chainN);
        if (nt >= 5 && !reduced) shake = Math.max(shake, 3 + (nt - 5) * 2.5);
      }
    }
    if (did) {
      world.bodies = world.bodies.filter(function (b) { return !b.dead; });
      world.wakeAll();
    }
  }

  function popFx(x, y, tr, n) {
    fx.push({ k: 'ring', x: x, y: y, r: tr.r, life: 0.25, max: 0.25, R: tr.r * 1.6 });
    for (var i = 0; i < n; i++) {
      var an = rng() * 6.283, sp = 120 + rng() * 160;
      fx.push({ k: 'dot', x: x, y: y, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp - 40, life: 0.5, max: 0.5, c: rng() < 0.5 ? tr.c : tr.d, s: 3 + rng() * 3 });
    }
  }
  function text(x, y, s) { fx.push({ k: 'txt', x: x, y: y, s: s, life: 0.7, max: 0.7 }); }

  function makeDemo() {
    demo = [];
    [[0, 150], [3, 200], [1, 250]].forEach(function (d, i) { demo.push({ t: d[0], x: JAR.l + 60 + i * 90, ph: i * 2, blink: 3 }); });
  }

  function update(dt) {
    t += dt;
    if (state === 'play') {
      playTime += dt;
      if (cooldown > 0) cooldown -= dt;
      var mv = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      if (mv) aimX = clampAim(aimX + mv * 300 * dt);
      world.step(dt);
      processMerges();
      var over = false, bs = world.bodies, i;
      for (i = 0; i < bs.length; i++) {
        var b = bs[i];
        if (b.hit) { if (b.hit > 250 && b.age > 0.05) { var k = Math.min(0.25, b.hit / 2400); b.sc = 1 + k; b.sv = 0; if (b.hit > 500) sfx.land(b.hit); } b.hit = 0; }
        if (b.age > 1 && b.y - b.r < LINE_Y && Math.hypot(b.vx, b.vy) < 30) over = true;
      }
      overTimer = over ? overTimer + dt : Math.max(0, overTimer - dt * 2);
      if (overTimer > 0) { warnT -= dt; if (warnT <= 0) { sfx.warn(); warnT = 0.5; } } else warnT = 0;
      if (overTimer >= OVER_TIME) gameOver();
    }
    var arr = world ? world.bodies : [];
    for (var j = 0; j < arr.length; j++) {
      var q = arr[j];
      if (q.pop > 0) { q.pop -= dt; q.sc = 0.6 + 0.65 * Math.min(1, (0.22 - q.pop) / 0.11); if (q.pop < 0.11) q.sc = 1.25 - 0.25 * (1 - q.pop / 0.11); q.sv = 0; }
      else { q.sv += (1 - q.sc) * 400 * dt; q.sv *= Math.pow(0.005, dt); q.sc += q.sv * dt; }
      q.blink -= dt; if (q.blink < -0.12) q.blink = 3 + rng() * 2;
    }
    for (var m = fx.length - 1; m >= 0; m--) {
      var f = fx[m]; f.life -= dt;
      if (f.life <= 0) { fx.splice(m, 1); continue; }
      if (f.k === 'dot') { f.vy += 1000 * dt; f.x += f.vx * dt; f.y += f.vy * dt; }
      else if (f.k === 'txt') f.y -= 57 * dt;
    }
    if (shake > 0) shake = Math.max(0, shake - dt * 40);
  }

  // ---------- render ----------
  var view = { s: 1, ox: 0, oy: 0, dpr: 1 };
  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 3), w = window.innerWidth, h = window.innerHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    view.dpr = dpr; view.s = Math.min(w / W, h / H);
    view.ox = (w - W * view.s) / 2; view.oy = (h - H * view.s) / 2;
    elMute.style.left = Math.round(view.ox + 12 * view.s) + 'px';
    elMute.style.top = Math.round(view.oy + 100 * view.s) + 'px';
  }

  function rr(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function disc(x, y, r, fill) { ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill(); }
  function eye(x, y, r, look, blinking, dead) {
    var lw = Math.max(1.5, r * 0.3);
    if (dead) {
      ctx.strokeStyle = OUTLINE; ctx.lineWidth = lw * 0.7; ctx.beginPath();
      ctx.moveTo(x - r * 0.7, y - r * 0.7); ctx.lineTo(x + r * 0.7, y + r * 0.7); ctx.moveTo(x + r * 0.7, y - r * 0.7); ctx.lineTo(x - r * 0.7, y + r * 0.7); ctx.stroke(); return;
    }
    if (blinking) { ctx.strokeStyle = OUTLINE; ctx.lineWidth = lw * 0.6; ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.stroke(); return; }
    disc(x, y, r, '#fff');
    disc(x + look * r * 0.3, y + r * 0.15, r * 0.55, OUTLINE);
  }
  function mouthArc(r, cy, w, up) {
    ctx.strokeStyle = OUTLINE; ctx.lineWidth = Math.max(1.5, r * 0.07); ctx.lineCap = 'round'; ctx.beginPath();
    if (up) ctx.arc(0, cy, w, 0.2, Math.PI - 0.2); else ctx.arc(0, cy + w, w, Math.PI + 0.3, -0.3);
    ctx.stroke();
  }

  function drawBlob(x, y, r, tier, sc, look, blinking, vy, dead, ph) {
    var tr = TIERS[tier], wob = dead ? 0 : Math.sin(t * 7.5 + (ph || 0)) * 0.03;
    var sy = sc + wob;
    ctx.save(); ctx.translate(x, y + r * (1 - sy)); ctx.scale(2 - sy, sy);
    var lw = Math.max(2, r * 0.09);
    // decorations behind body
    if (tier === 3) { ctx.strokeStyle = OUTLINE; ctx.lineWidth = lw * 0.6; ctx.beginPath(); ctx.moveTo(-r * 0.35, -r * 0.9); ctx.lineTo(-r * 0.5, -r * 1.35); ctx.moveTo(r * 0.35, -r * 0.9); ctx.lineTo(r * 0.5, -r * 1.35); ctx.stroke(); disc(-r * 0.5, -r * 1.38, r * 0.11, tr.c); disc(r * 0.5, -r * 1.38, r * 0.11, tr.c); }
    if (tier === 4) { ctx.fillStyle = tr.c; ctx.strokeStyle = OUTLINE; ctx.lineWidth = lw * 0.6; ctx.beginPath(); ctx.moveTo(-r * 0.15, -r * 0.95); ctx.quadraticCurveTo(0, -r * 1.5, r * 0.15, -r * 0.95); ctx.fill(); ctx.stroke(); }
    if (tier === 5) { ctx.fillStyle = tr.d; ctx.strokeStyle = OUTLINE; ctx.lineWidth = lw * 0.6; for (var s = 0; s < 4; s++) { var an = -Math.PI * (0.2 + s * 0.2) - 0.05; ctx.beginPath(); ctx.moveTo(Math.cos(an - 0.14) * r * 0.95, Math.sin(an - 0.14) * r * 0.95); ctx.lineTo(Math.cos(an) * r * 1.3, Math.sin(an) * r * 1.3); ctx.lineTo(Math.cos(an + 0.14) * r * 0.95, Math.sin(an + 0.14) * r * 0.95); ctx.fill(); ctx.stroke(); } }
    if (tier === 6) { ctx.strokeStyle = OUTLINE; ctx.lineWidth = lw * 0.8; for (var q = -1; q <= 1; q += 2) { ctx.beginPath(); ctx.moveTo(q * r * 0.35, -r * 0.85); ctx.lineTo(q * r * 0.4, -r * 1.2); ctx.stroke(); disc(q * r * 0.4, -r * 1.28, r * 0.2, '#fff'); disc(q * r * 0.4 + look * r * 0.05, -r * 1.25, r * 0.1, OUTLINE); } }
    if (tier === 2) { for (var p = -1; p <= 1; p++) disc(p * r * 0.4, -r * 0.92 + Math.abs(p) * r * 0.12, r * 0.14, tr.d); }
    var g = ctx.createRadialGradient(-r * 0.3, -r * 0.4, r * 0.1, 0, 0, r);
    g.addColorStop(0, tr.c); g.addColorStop(1, tr.d);
    ctx.fillStyle = g; ctx.strokeStyle = OUTLINE; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.283); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.beginPath(); ctx.ellipse(-r * 0.4, -r * 0.5, r * 0.22, r * 0.12, -0.6, 0, 6.283); ctx.fill();
    // faces
    var e = r * 0.16;
    switch (tier) {
      case 0: eye(-r * 0.3, -r * 0.05, e * 0.7, look, false, dead); eye(r * 0.3, -r * 0.05, e * 0.7, look, false, dead); break;
      case 1: eye(0, -r * 0.15, r * 0.3, look, blinking, dead); mouthArc(r, r * 0.25, r * 0.22, true); break;
      case 2:
        eye(-r * 0.3, -r * 0.05, e, look, false, dead); eye(r * 0.3, -r * 0.05, e, look, false, dead);
        ctx.strokeStyle = OUTLINE; ctx.lineWidth = lw * 0.7; ctx.beginPath(); ctx.moveTo(-r * 0.55, -r * 0.42); ctx.lineTo(-r * 0.1, -r * 0.25); ctx.moveTo(r * 0.55, -r * 0.42); ctx.lineTo(r * 0.1, -r * 0.25); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-r * 0.3, r * 0.4); ctx.lineTo(r * 0.3, r * 0.4); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(-r * 0.22, r * 0.4); ctx.lineTo(-r * 0.12, r * 0.4); ctx.lineTo(-r * 0.17, r * 0.55); ctx.moveTo(r * 0.22, r * 0.4); ctx.lineTo(r * 0.12, r * 0.4); ctx.lineTo(r * 0.17, r * 0.55); ctx.fill(); break;
      case 3:
        eye(-r * 0.3, -r * 0.1, e * 1.1, look, blinking, dead); eye(r * 0.3, -r * 0.1, e * 1.1, look, blinking, dead);
        ctx.fillStyle = OUTLINE; ctx.beginPath(); ctx.ellipse(0, r * 0.38, r * 0.11, r * 0.15, 0, 0, 6.283); ctx.fill(); break;
      case 4:
        for (var i = -1; i <= 1; i += 2) { var ex = i * r * 0.32; if (dead) eye(ex, -r * 0.1, e, 0, false, true); else { disc(ex, -r * 0.1, e * 1.2, '#fff'); disc(ex, -r * 0.05, e * 0.7, OUTLINE); ctx.fillStyle = tr.c; ctx.fillRect(ex - e * 1.3, -r * 0.1 - e * 1.3, e * 2.6, e * 1.3); ctx.strokeStyle = OUTLINE; ctx.lineWidth = lw * 0.5; ctx.beginPath(); ctx.moveTo(ex - e * 1.2, -r * 0.1); ctx.lineTo(ex + e * 1.2, -r * 0.1); ctx.stroke(); } }
        mouthArc(r, r * 0.3, r * 0.15, true); ctx.fillStyle = '#FF8FA8'; rr(-r * 0.06, r * 0.32, r * 0.14, r * 0.2, r * 0.06); ctx.fill(); ctx.strokeStyle = OUTLINE; ctx.lineWidth = lw * 0.4; ctx.stroke(); break;
      case 5:
        eye(-r * 0.4, -r * 0.15, e * 0.75, look, blinking, dead); eye(0, -r * 0.2, e * 0.75, look, blinking, dead); eye(r * 0.4, -r * 0.15, e * 0.75, look, blinking, dead);
        ctx.strokeStyle = OUTLINE; ctx.lineWidth = lw * 0.6; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(-r * 0.4, r * 0.35); for (var z = 1; z <= 4; z++) ctx.lineTo(-r * 0.4 + z * r * 0.2, r * (z % 2 ? 0.5 : 0.3)); ctx.stroke(); break;
      case 6:
        eye(-r * 0.3, -r * 0.05, e * 0.9, look, blinking, dead); eye(r * 0.3, -r * 0.05, e * 0.9, look, blinking, dead);
        ctx.fillStyle = '#fff'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = lw * 0.5; rr(-r * 0.4, r * 0.28, r * 0.8, r * 0.28, r * 0.06); ctx.fill(); ctx.stroke();
        ctx.beginPath(); for (var b = 1; b < 4; b++) { ctx.moveTo(-r * 0.4 + b * r * 0.2, r * 0.28); ctx.lineTo(-r * 0.4 + b * r * 0.2, r * 0.56); } ctx.stroke(); break;
      case 7:
        eye(-r * 0.3, -r * 0.05, e * 1.1, look, blinking, dead); eye(r * 0.3, -r * 0.05, e * 1.1, look, blinking, dead);
        mouthArc(r, r * 0.15, r * 0.4, true);
        ctx.fillStyle = '#FFE066'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = lw * 0.7; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(-r * 0.45, -r * 0.85); ctx.lineTo(-r * 0.5, -r * 1.35); ctx.lineTo(-r * 0.2, -r * 1.05); ctx.lineTo(0, -r * 1.45); ctx.lineTo(r * 0.2, -r * 1.05); ctx.lineTo(r * 0.5, -r * 1.35); ctx.lineTo(r * 0.45, -r * 0.85); ctx.closePath(); ctx.fill(); ctx.stroke(); break;
    }
    ctx.restore();
  }

  function drawLadder(y, hl) {
    var x = 20;
    for (var i = 0; i < 8; i++) {
      var r = 14 * (0.5 + i * 0.07);
      ctx.globalAlpha = hl < 0 || i <= hl ? 1 : 0.35;
      drawBlob(x + 22, y, r, i, 1, 0, false, 0, false, 0);
      x += 45;
    }
    ctx.globalAlpha = 1;
  }

  function draw() {
    var w = canvas.width, h = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    var bg = ctx.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#1B1740'); bg.addColorStop(1, '#2E2470');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    var k = view.dpr * view.s;
    var sx = shake > 0 ? (Math.random() - 0.5) * shake * 2 : 0, sy = shake > 0 ? (Math.random() - 0.5) * shake * 2 : 0;
    ctx.setTransform(k, 0, 0, k, view.ox * view.dpr + sx * k, view.oy * view.dpr + sy * k);
    var over = state === 'over';

    // jar
    ctx.fillStyle = 'rgba(255,255,255,.12)'; rr(JAR.l, JAR.rim, JAR.r - JAR.l, JAR.floor - JAR.rim, 14); ctx.fill();
    if (over) { ctx.fillStyle = 'rgba(255,77,106,.15)'; rr(JAR.l, JAR.rim, JAR.r - JAR.l, JAR.floor - JAR.rim, 14); ctx.fill(); }
    // danger line
    var danger = overTimer > 0, pulse = danger ? 0.5 + 0.5 * Math.sin(t * Math.PI) : 0;
    ctx.setLineDash([12, 8]); ctx.lineWidth = 3;
    ctx.strokeStyle = danger ? 'rgba(255,77,106,' + (0.6 + 0.4 * pulse) + ')' : 'rgba(255,77,106,.5)';
    ctx.beginPath(); ctx.moveTo(JAR.l, LINE_Y); ctx.lineTo(JAR.r, LINE_Y); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#FF4D6A'; ctx.font = '800 16px system-ui,sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('!', JAR.l - 22, LINE_Y + 6); ctx.fillText('!', JAR.r + 22, LINE_Y + 6);
    if (danger) { ctx.fillRect(JAR.l, LINE_Y - 10, (JAR.r - JAR.l) * Math.min(1, overTimer / OVER_TIME), 5); }

    if (state === 'start') {
      for (var d = 0; d < demo.length; d++) { var o = demo[d], r0 = TIERS[o.t].r; drawBlob(o.x, JAR.floor - r0 + Math.sin(t * 2 + o.ph) * 4 - 4, r0, o.t, 1, 0, false, 0, false, o.ph); }
    } else if (world) {
      for (var i = 0; i < world.bodies.length; i++) {
        var b = world.bodies[i];
        drawBlob(b.x, b.y, b.r, b.t, b.sc, Math.max(-1, Math.min(1, b.vx / 200)), b.blink < 0, b.vy, over, b.ph);
      }
    }
    if (state === 'play' && world) {
      var ax = clampAim(aimX), tr = TIERS[cur];
      ctx.globalAlpha = cooldown > 0 ? 0.25 + 0.25 * (1 - cooldown / DROP_CD) : 0.5;
      ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.setLineDash([4, 8]); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(ax, AIM_Y + tr.r); ctx.lineTo(ax, JAR.floor); ctx.stroke(); ctx.setLineDash([]);
      ctx.globalAlpha = cooldown > 0 ? 0.3 + 0.7 * (1 - cooldown / DROP_CD) : 1;
      drawBlob(ax, AIM_Y, tr.r, cur, 1, 0, false, 0, false, 0);
      ctx.globalAlpha = 1;
    }
    // jar walls
    ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 12; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(JAR.l - 6, JAR.rim - 10); ctx.lineTo(JAR.l - 6, JAR.floor + 6); ctx.lineTo(JAR.r + 6, JAR.floor + 6); ctx.lineTo(JAR.r + 6, JAR.rim - 10); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 12;
    ctx.beginPath(); ctx.moveTo(JAR.l - 6, JAR.rim - 10); ctx.lineTo(JAR.l - 6, JAR.floor + 6); ctx.lineTo(JAR.r + 6, JAR.floor + 6); ctx.lineTo(JAR.r + 6, JAR.rim - 10); ctx.stroke();

    // fx
    for (var j = 0; j < fx.length; j++) {
      var f = fx[j], a = f.life / f.max;
      if (f.k === 'ring') { ctx.globalAlpha = 0.8 * a; ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(f.x, f.y, f.r + (f.R - f.r) * (1 - a), 0, 6.283); ctx.stroke(); }
      else if (f.k === 'dot') { ctx.globalAlpha = a; disc(f.x, f.y, f.s, f.c); }
      else { ctx.globalAlpha = Math.min(1, a * 2); ctx.fillStyle = '#fff'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 4; ctx.font = '800 22px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.strokeText(f.s, f.x, f.y); ctx.fillText(f.s, f.x, f.y); }
    }
    ctx.globalAlpha = 1;

    // HUD
    ctx.textAlign = 'left'; ctx.fillStyle = '#C9C3F5'; ctx.font = '700 14px system-ui,sans-serif'; ctx.fillText('SCORE', 16, 30);
    ctx.fillStyle = '#fff'; ctx.font = '800 36px system-ui,sans-serif'; ctx.fillText(String(score), 16, 66);
    ctx.fillStyle = '#C9C3F5'; ctx.font = '700 14px system-ui,sans-serif'; ctx.fillText('BEST ' + Math.max(best, score), 16, 88);
    ctx.fillStyle = 'rgba(255,255,255,.12)'; rr(300, 20, 72, 72, 14); ctx.fill();
    ctx.fillStyle = '#C9C3F5'; ctx.font = '700 11px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.fillText('NEXT', 336, 33);
    if (state === 'play') { var nr = Math.min(TIERS[next].r, 22); drawBlob(336, 64, nr, next, 1, 0, false, 0, false, 0); }
    if (state !== 'play') drawLadder(690, state === 'over' ? maxTier : -1);
  }

  // ---------- input ----------
  function worldX(e) { return (e.clientX - view.ox) / view.s; }
  canvas.addEventListener('pointerdown', function (e) {
    if (state !== 'play' || paused) return;
    audio();
    var sx = worldX(e), sy = (e.clientY - view.oy) / view.s;
    if (sx < 170 && sy < 96) { setPaused(true); return; }
    pointerDown = true; aimX = clampAim(sx);
    try { canvas.setPointerCapture(e.pointerId); } catch (x) {}
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', function (e) {
    if (state !== 'play' || paused) return;
    if (pointerDown || e.pointerType === 'mouse') aimX = clampAim(worldX(e));
  });
  canvas.addEventListener('pointerup', function (e) {
    if (!pointerDown) return;
    pointerDown = false; aimX = clampAim(worldX(e)); drop();
  });
  canvas.addEventListener('pointercancel', function () { pointerDown = false; });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  elPaused.addEventListener('click', function () { setPaused(false); });

  var elAbout = document.getElementById('about'), elAboutOpen = document.getElementById('about-open'), elAboutClose = document.getElementById('about-close');
  function aboutOpen() { return !elAbout.classList.contains('hidden'); }
  function setAbout(open) {
    if (open && state !== 'start') return;
    elAbout.classList.toggle('hidden', !open);
    keys.left = keys.right = false;
    (open ? elAboutClose : elAboutOpen).focus();
  }
  elAboutOpen.addEventListener('click', function () { setAbout(true); });
  elAboutClose.addEventListener('click', function () { setAbout(false); });
  elAbout.addEventListener('click', function (e) { if (e.target === elAbout) setAbout(false); });

  window.addEventListener('keydown', function (e) {
    var k = e.key;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (aboutOpen()) {
      if (k === 'Escape') { setAbout(false); e.preventDefault(); }
      else if (k === 'Tab') { e.preventDefault(); elAboutClose.focus(); }
      else if (k === ' ' || k === 'Enter') { if (e.target !== elAboutClose) e.preventDefault(); }
      return;
    }
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') { keys.left = true; e.preventDefault(); }
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') { keys.right = true; e.preventDefault(); }
    else if (k === 'm' || k === 'M') { toggleMute(); }
    else if (k === 'Escape' || k === 'p' || k === 'P') { if (state === 'play') setPaused(!paused); }
    else if (k === ' ' || k === 'Enter' || k === 'ArrowDown' || k === 'r' || k === 'R') {
      var restartKey = k === 'r' || k === 'R';
      if (e.target && e.target.tagName === 'BUTTON' && (k === ' ' || k === 'Enter')) return; // let focused button handle it
      if (state === 'start') { if (!restartKey && !e.repeat) beginGame(); }
      else if (state === 'over') { if (!e.repeat && performance.now() - overAt > 400 && k !== 'ArrowDown') restart(); }
      else if (paused) { if (!restartKey && !e.repeat) setPaused(false); }
      else if (restartKey) { if (!e.repeat) restart(); }
      else if (k !== 'Enter' && !e.repeat) drop();
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', function (e) {
    var k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.left = false;
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.right = false;
  });
  window.addEventListener('blur', function () { keys.left = keys.right = false; pointerDown = false; });

  function toggleMute() { muted = !muted; save('mute', muted ? '1' : '0'); syncMute(); }
  elMute.addEventListener('click', function () { toggleMute(); elMute.blur(); });
  document.getElementById('play').addEventListener('click', beginGame);
  document.getElementById('again').addEventListener('click', function () { if (performance.now() - overAt > 400) restart(); });
  document.getElementById('share').addEventListener('click', function () {
    var url = location.href.split('#')[0], text = 'I scored ' + score + ' in Bloop Stack!';
    if (navigator.share) { navigator.share({ title: 'Bloop Stack', text: text, url: url }).catch(function () {}); return; }
    var btn = this, done = function (m) { btn.textContent = m; setTimeout(function () { btn.textContent = 'Share'; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function () { done('Copied!'); }, function () { done('Copy failed'); });
    else done('Copy failed');
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden) setPaused(true); last = 0; });
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);

  // ---------- loop ----------
  var last = 0, acc = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (!last) last = now;
    var dt = Math.min((now - last) / 1000, 0.1); last = now;
    if (!paused) {
      acc += dt;
      while (acc >= STEP) { update(STEP); acc -= STEP; }
    }
    draw();
  }

  // read-only-ish hooks for the smoke-test tool
  window.__bloop = {
    get state() { return state; }, get score() { return score; }, get world() { return world; }, get best() { return best; },
    get paused() { return paused; }, drop: drop, aim: function (x) { aimX = x; }, TIERS: TIERS,
    setRng: function (f) { rng = f; }, forceTier: function (n) { cur = n; cooldown = 0; }, gameOver: gameOver
  };

  reset(); makeDemo(); resize(); requestAnimationFrame(frame);
})();
