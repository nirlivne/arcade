(function () {
  'use strict';
  var Logic = TrayLogic;
  var STEP = Logic.STEP;
  var clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };

  var canvas = document.getElementById('c');
  var ctx = canvas.getContext('2d');

  function $(id) { return document.getElementById(id); }
  function now() { return performance.now(); }
  function emit(name, detail) { window.dispatchEvent(new CustomEvent(name, { detail: detail || {} })); }
  function say(t) { $('status').textContent = t; }

  // ---- tokens (design-toolkit contract: canvas code reads tokens.css via getComputedStyle) ----
  var css = getComputedStyle(document.documentElement);
  var tok = function (n) { return css.getPropertyValue(n).trim(); };
  var num = function (n) { return parseFloat(tok(n)); };
  var C = {};
  ['bg', 'bg-2', 'outline', 'surface', 'primary', 'primary-text', 'accent', 'accent-deep', 'danger', 'danger-ink',
    'lean-safe', 'lean-warn', 'lean-needle', 'floor-a', 'floor-b', 'booth', 'booth-deep', 'chrome', 'chrome-deep',
    'door', 'door-window', 'shine', 'skin', 'shirt', 'trousers', 'bowtie', 'sweat', 'panic-flush',
    'plate', 'plate-rim', 'soup', 'soup-deep', 'noodle', 'noodle-deep', 'sauce', 'jelly', 'jelly-deep',
    'lobster', 'lobster-deep', 'cake', 'cake-deep', 'frosting', 'grape', 'bucket', 'mop', 'puddle', 'sign', 'text'
  ].forEach(function (k) { C[k] = tok('--color-' + k); });
  var BOIL_FPS = num('--boil-fps'), BOIL_PX = num('--boil-px'), SHINE = num('--shine-alpha'),
    SHADE = num('--shade-alpha'), JELLY_A = num('--jelly-alpha');
  var SHAKE_PX = num('--shake-px'), CRASH_SLOWMO = num('--crash-slowmo'), CRASH_TOTAL_MS = num('--crash-dur');

  var reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function randomSeed() {
    var a = new Uint32Array(2);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a);
    else { a[0] = (Math.random() * 4294967296) >>> 0; a[1] = (Math.random() * 4294967296) >>> 0; }
    return a[0].toString(36) + a[1].toString(36);
  }

  // ---- storage ----
  function loadBest() { try { return parseInt(localStorage.getItem('tray-disaster-best') || '0', 10) || 0; } catch (e) { return 0; } }
  function saveBest(v) { try { localStorage.setItem('tray-disaster-best', String(v)); } catch (e) {} }
  function loadMuted() { try { return localStorage.getItem('tray-disaster-muted') === '1'; } catch (e) { return false; } }
  function saveMuted(v) { try { localStorage.setItem('tray-disaster-muted', v ? '1' : '0'); } catch (e) {} }
  var best = loadBest();
  var muted = loadMuted();

  // ---- audio: small generated Web Audio stings, no files ----
  var Audio = (function () {
    var AC = window.AudioContext || window.webkitAudioContext;
    var actx = null;
    function ctxReady() { if (!actx && AC) actx = new AC(); return actx; }
    function tone(freq0, freq1, dur, type, gain) {
      if (muted) return;
      var ac = ctxReady(); if (!ac) return;
      var osc = ac.createOscillator(), g = ac.createGain();
      osc.type = type || 'sine'; osc.frequency.setValueAtTime(freq0, ac.currentTime);
      osc.frequency.linearRampToValueAtTime(freq1, ac.currentTime + dur);
      g.gain.setValueAtTime(gain || 0.12, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
      osc.connect(g); g.connect(ac.destination);
      osc.start(); osc.stop(ac.currentTime + dur);
    }
    function noiseBurst(dur, gain) {
      if (muted) return;
      var ac = ctxReady(); if (!ac) return;
      var buf = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      var src = ac.createBufferSource(); src.buffer = buf;
      var g = ac.createGain(); g.gain.value = gain || 0.1;
      src.connect(g); g.connect(ac.destination); src.start();
    }
    return {
      dishLand: function () { tone(600, 200, 0.22, 'sine', 0.1); },
      hazard: function () { tone(500, 300, 0.12, 'triangle', 0.08); },
      crash: function () { tone(1200, 150, 1.1, 'sine', 0.14); noiseBurst(0.4, 0.08); },
      bill: function () { tone(1500, 1500, 0.08, 'sine', 0.1); setTimeout(function () { tone(1900, 1900, 0.12, 'sine', 0.1); }, 90); },
    };
  })();

  // ---- canvas sizing ----
  var W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---- state ----
  var screen = 'start'; // start | play | crash | over | paused
  var prevScreen = null;
  var run = null;
  var lockUntil = 0;
  var lastDishCount = 0;
  var crash = null; // { elapsed, hitStopUntil, pieces }
  var billTable = 7;
  var HIT_STOP_MS = 80; // real-time freeze at the moment of tip, before the slow-motion launch
  var CRASH_HOLD_S = Math.max(0, CRASH_TOTAL_MS - HIT_STOP_MS) / 1000; // real seconds from hit-stop to the bill
  var SHAKE_DECAY_S = 0.4; // real seconds for the crash shake to decay to nothing

  function show(id, on) { $(id).classList.toggle('hidden', !on); }
  function setScreen(s) {
    screen = s;
    show('start', s === 'start');
    show('paused', s === 'paused');
    show('over', s === 'over');
    show('hud', s === 'play' || s === 'crash' || s === 'paused');
    if (s !== 'start') show('about', false);
    $('mute-toggle').textContent = 'Sound: ' + (muted ? 'off' : 'on');
  }

  function startInfo() {
    $('startinfo').textContent = best > 0 ? 'Best shift: $' + best : 'No shifts on the books yet.';
  }

  function startRun(seed) {
    run = Logic.createRun(seed || randomSeed());
    lastDishCount = 0; crash = null;
    // A separate, non-gameplay RNG: drawing from run.rng here would shift every later hazard/dish-fate
    // roll by one and break seed+log reproducibility (see DESIGN.md).
    billTable = 1 + Math.floor(Logic.mulberry32(Logic.hashString(run.seed + '|table'))() * 20);
    setScreen('play');
    say('Shift started');
    emit('game:start');
  }

  function restart() {
    if (now() < lockUntil) return;
    emit('game:restart');
    startRun();
  }

  // ---- input: relative horizontal drag (Pointer Events), plus A/D and arrow keys ----
  var dragging = false, lastX = 0;
  var DRAG_SENS = 1 / 140;
  var keyLeft = false, keyRight = false;

  canvas.addEventListener('pointerdown', function (e) {
    if (screen === 'start') { startRun(); return; }
    if (screen === 'crash') { skipCrash(); return; }
    if (screen !== 'play') return;
    dragging = true; lastX = e.clientX;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!dragging || !run) return;
    var dx = e.clientX - lastX; lastX = e.clientX;
    if (dx) Logic.setInputTarget(run, run.inputTarget + dx * DRAG_SENS);
  });
  window.addEventListener('pointerup', function () { dragging = false; });
  window.addEventListener('pointercancel', function () { dragging = false; });

  window.addEventListener('keydown', function (e) {
    var k = e.key;
    if (!$('about').classList.contains('hidden')) { if (k === 'Escape') closeAbout(); return; }
    if (screen === 'crash') { if (!e.repeat) { e.preventDefault(); skipCrash(); } return; }
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') { keyLeft = true; e.preventDefault(); }
    if (k === 'ArrowRight' || k === 'd' || k === 'D') { keyRight = true; e.preventDefault(); }
    if (screen === 'paused') { if (k === ' ' || k === 'Enter') { e.preventDefault(); resume(); } return; }
    if (screen === 'start') { if (k === ' ' || k === 'Enter') { e.preventDefault(); startRun(); } return; }
    if (screen === 'over') { if (k === 'r' || k === 'R' || k === ' ' || k === 'Enter') { e.preventDefault(); restart(); } return; }
    if (k === 'r' || k === 'R') restart();
  });
  window.addEventListener('keyup', function (e) {
    var k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') keyLeft = false;
    if (k === 'ArrowRight' || k === 'd' || k === 'D') keyRight = false;
  });

  var KEY_RATE = 2.4, IDLE_DECAY = 1.6;
  function applyInput(dt) {
    if (keyLeft && !keyRight) Logic.setInputTarget(run, run.inputTarget - KEY_RATE * dt);
    else if (keyRight && !keyLeft) Logic.setInputTarget(run, run.inputTarget + KEY_RATE * dt);
    else if (!dragging && run.inputTarget !== 0) Logic.setInputTarget(run, run.inputTarget * Math.max(0, 1 - IDLE_DECAY * dt));
  }

  // ---- crash sequence (visual only; the simulation itself is already frozen at topple) ----
  // Brief section 6: 80ms hit-stop at the tip, then slow motion, per-dish landing gags (at least
  // lobster/soup/jelly), decaying shake, skippable on tap/key (THE-44).
  function enterCrash() {
    setScreen('crash');
    Audio.crash();
    var rng = Logic.mulberry32(Logic.hashString(run.seed + '|crash'));
    var waiterX = W * 0.36, s = clamp(W * 0.34, 90, 150), floorY = H * 0.84;
    var originY = floorY - s * 1.55; // the point pieces are drawn relative to (tray height)
    crash = {
      elapsed: 0, // real seconds since hit-stop ended; drives shake decay + the auto-advance to the bill
      hitStopUntil: now() + HIT_STOP_MS,
      waiterX: waiterX, s: s, floorY: floorY,
      floorPieceY: floorY - s * 0.15 - originY,
      wallPieceY: floorY - H * 0.2 - originY,
      dinerY: floorY * 0.5 - originY - 10,
      dinerX: { '1': W * 0.9 - waiterX, '-1': W * 0.08 - waiterX },
      pieces: run.dishes.map(function (d) {
        return {
          kind: d.type.id, x: 0, y: 0, vx: (rng() - 0.5) * 220, vy: -70 - rng() * 60,
          rot: d.sway, rotVel: (rng() - 0.5) * 9, landed: false, gag: null, gagT: 0,
        };
      }),
    };
  }

  // Landing/gravity is tuned so pieces reach the floor around real ~600-900ms (brief's "Launch")
  // and every gag has time to read before CRASH_HOLD_S cuts to the bill (brief's "Gags", 600-1400ms).
  var CRASH_GRAVITY = 2600;
  var HAT_TWEEN_S = 0.22, SPLAT_RISE_S = 0.2, SPLAT_SLIDE_PX_S = 70, SCUTTLE_PX_S = 260;
  function landPiece(p) {
    p.landed = true; p.vx = 0; p.vy = 0; p.rotVel = 0; p.gagT = 0;
    if (p.kind === 'lobster') {
      p.gag = 'scuttle'; p.rot = 0; p.dir = p.x >= 0 ? 1 : -1; // scuttles off the near edge: "(escaped)"
    } else if (p.kind === 'soup') {
      p.gag = 'hat'; // lands upside down on the nearer diner's head
      var side = p.x >= 0 ? '1' : '-1';
      p.startX = p.x; p.startY = p.y; p.targetX = crash.dinerX[side]; p.targetY = crash.dinerY;
      p.rotStart = p.rot; p.rotTarget = Math.PI;
    } else if (p.kind === 'jelly') {
      p.gag = 'splat'; // splats up on the wall, then slides slowly down
      p.startX = p.x; p.startY = p.y; p.targetY = crash.wallPieceY;
      p.rotStart = p.rot;
    } else {
      p.gag = 'rest';
    }
  }
  function updateGag(p, dt) {
    p.gagT += dt;
    if (p.gag === 'scuttle') {
      p.x += p.dir * SCUTTLE_PX_S * dt;
    } else if (p.gag === 'hat') {
      var f = clamp(p.gagT / HAT_TWEEN_S, 0, 1), e = 1 - Math.pow(1 - f, 3);
      p.x = p.startX + (p.targetX - p.startX) * e;
      p.y = p.startY + (p.targetY - p.startY) * e;
      p.rot = p.rotStart + (p.rotTarget - p.rotStart) * e;
    } else if (p.gag === 'splat') {
      if (p.gagT <= SPLAT_RISE_S) {
        var f2 = clamp(p.gagT / SPLAT_RISE_S, 0, 1), e2 = 1 - Math.pow(1 - f2, 3);
        p.y = p.startY + (p.targetY - p.startY) * e2; p.rot = p.rotStart * (1 - e2);
      } else {
        p.y = Math.min(crash.floorPieceY, p.y + SPLAT_SLIDE_PX_S * dt);
      }
    }
  }
  function updateCrash(dtReal) {
    crash.elapsed += dtReal;
    var dt = dtReal * CRASH_SLOWMO;
    crash.pieces.forEach(function (p) {
      if (p.landed) { updateGag(p, dt); return; }
      p.vy += CRASH_GRAVITY * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.rotVel * dt;
      if (p.y >= crash.floorPieceY) { p.y = crash.floorPieceY; landPiece(p); }
    });
    if (crash.elapsed >= CRASH_HOLD_S) enterOver();
  }
  function skipCrash() { if (screen === 'crash') enterOver(); }

  function enterOver() {
    var dmg = run.damage;
    var isBest = dmg > best;
    if (isBest) { best = dmg; saveBest(best); }
    show('badge', isBest);
    $('final').textContent = '$' + dmg;
    $('bill-table').textContent = 'Table ' + billTable;
    var ol = $('bill-lines');
    ol.innerHTML = '';
    run.billLines.forEach(function (line) {
      var li = document.createElement('li');
      var span = document.createElement('span'); span.textContent = line.text;
      var b = document.createElement('b'); b.textContent = '$' + line.price;
      li.appendChild(span); li.appendChild(b); ol.appendChild(li);
    });
    $('bestline').textContent = 'Best shift: $' + best;
    $('quip').textContent = '“' + run.chefQuip + '” — Chef';
    $('sharemsg').textContent = '';
    lockUntil = now() + 500;
    setScreen('over');
    Audio.bill();
    say('Damages: $' + dmg);
    emit('game:over', { score: dmg });
  }

  function shareBill() {
    var lines = run.billLines.map(function (l) { return l.text; }).join(' · ');
    var text = 'Tray Disaster: my bill was $' + run.damage + ' · ' + lines + '. Beat my shift?';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        $('sharemsg').textContent = 'Copied to clipboard!';
      }, function () { $('sharemsg').textContent = ''; });
    }
  }

  // ---- pause on visibilitychange ----
  var raf = 0;
  function startLoop() { if (!raf) raf = requestAnimationFrame(frame); }
  function stopLoop() { cancelAnimationFrame(raf); raf = 0; }
  function pause() {
    if (screen !== 'play' && screen !== 'crash') return;
    prevScreen = screen;
    dragging = false; keyLeft = false; keyRight = false;
    setScreen('paused');
  }
  function resume() { if (prevScreen) { setScreen(prevScreen); prevScreen = null; last = 0; } }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { pause(); stopLoop(); } else startLoop();
  });

  // ---- fixed-timestep loop ----
  var last = 0, acc = 0;
  function frame(t) {
    raf = requestAnimationFrame(frame);
    if (!last) last = t;
    var dt = Math.min((t - last) / 1000, 0.1); last = t;
    if (screen === 'play') {
      acc += dt;
      while (acc >= STEP) {
        applyInput(STEP);
        var alive = Logic.step(run);
        acc -= STEP;
        if (run.dishes.length > lastDishCount) { lastDishCount = run.dishes.length; Audio.dishLand(); }
        if (!alive) { enterCrash(); acc = 0; break; }
      }
      for (var hi = run.hazards.length - 1; hi >= 0; hi--) {
        var h = run.hazards[hi];
        if (h.hit && !h.hitSoundPlayed) { Audio.hazard(); h.hitSoundPlayed = true; }
      }
      updateHud();
    }
    if (screen === 'crash' && now() >= crash.hitStopUntil) updateCrash(dt);
    draw(t / 1000);
  }

  function estimateLiveDamage(r) {
    var plates = 0, lobster = false, total = 0;
    r.dishes.forEach(function (d) { total += d.type.price; if (d.type.asymmetric) lobster = true; else plates++; });
    return total + plates * Logic.DOLLARS_PER_PLATE + Math.round(r.distanceM * Logic.DOLLARS_PER_METRE);
  }

  function updateHud() {
    $('hud-bill').textContent = '$' + estimateLiveDamage(run);
    $('hud-dishes').textContent = String(run.dishes.length);
  }

  // ================= rendering (reference renderer from design/tray-disaster/styletile.html) =================
  var shapeId = 0;
  function h(a, b, c) { var x = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; x = (x ^ (x >>> 13)) * 1274126177; return (((x ^ (x >>> 16)) >>> 0) / 4294967295) * 2 - 1; }
  function boilFrame() { return Math.floor((run ? run.t : now() / 1000) * BOIL_FPS); }
  function boil(pts) { var id = shapeId++, bf = boilFrame(); return pts.map(function (p, i) { return [p[0] + h(bf, id, i * 2) * BOIL_PX, p[1] + h(bf, id, i * 2 + 1) * BOIL_PX]; }); }
  function ellipsePts(cx, cy, rx, ry, n) { n = n || 18; var p = []; for (var i = 0; i < n; i++) { var a = i / n * Math.PI * 2; p.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); } return p; }
  function boxPts(x, y, w, hh, r) {
    var p = [], k = 3, cs = [[x + w - r, y + r, -Math.PI / 2], [x + w - r, y + hh - r, 0], [x + r, y + hh - r, Math.PI / 2], [x + r, y + r, Math.PI]];
    cs.forEach(function (c) { for (var i = 0; i <= k; i++) { var a = c[2] + i / k * Math.PI / 2; p.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]); } });
    return p;
  }
  function smooth(pts, closed) {
    var n = pts.length; ctx.beginPath();
    var mid = function (a, b) { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; };
    if (closed !== false) {
      var m = mid(pts[n - 1], pts[0]); ctx.moveTo(m[0], m[1]);
      for (var i = 0; i < n; i++) { var q = mid(pts[i], pts[(i + 1) % n]); ctx.quadraticCurveTo(pts[i][0], pts[i][1], q[0], q[1]); }
      ctx.closePath();
    } else {
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (var j = 1; j < n - 1; j++) { var q2 = mid(pts[j], pts[j + 1]); ctx.quadraticCurveTo(pts[j][0], pts[j][1], q2[0], q2[1]); }
      ctx.lineTo(pts[n - 1][0], pts[n - 1][1]);
    }
  }
  var INK = 4.5;
  function blob(pts, fill, deep, opts) {
    opts = opts || {};
    var p = boil(pts), xs = p.map(function (q) { return q[0]; }), ys = p.map(function (q) { return q[1]; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    var w = x1 - x0, hh = y1 - y0;
    ctx.save(); smooth(p); ctx.globalAlpha = opts.alpha != null ? opts.alpha : 1; ctx.fillStyle = fill; ctx.fill(); ctx.clip();
    if (deep) {
      ctx.globalAlpha = opts.alpha ? SHADE * 2 : SHADE * 2.2; ctx.fillStyle = deep;
      ctx.beginPath(); ctx.ellipse(x0 + w * 0.2, y0 + hh * 0.05, w * 0.95, hh * 0.85, 0, 0, Math.PI * 2);
      ctx.rect(x1 + 50, y0 - 50, -w - 100, hh + 100); ctx.fill('evenodd');
    }
    if (opts.shine !== false) {
      ctx.globalAlpha = SHINE; ctx.fillStyle = C.shine;
      ctx.beginPath(); ctx.ellipse(x0 + w * 0.27, y0 + hh * 0.3, Math.max(2, w * 0.09), Math.max(1.5, hh * 0.1), -0.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore(); ctx.save(); smooth(p); ctx.lineWidth = opts.ink || INK; ctx.lineJoin = 'round'; ctx.strokeStyle = C.outline; ctx.stroke(); ctx.restore();
  }
  function inkLine(pts, w, color) {
    var p = boil(pts); ctx.save(); smooth(p, false); ctx.lineWidth = w || INK; ctx.lineCap = 'round'; ctx.strokeStyle = color || C.outline; ctx.stroke(); ctx.restore();
  }
  function googly(x, y, r, lean, jig, closed) {
    if (closed) { inkLine([[x - r, y + r * 0.1], [x, y - r * 0.5], [x + r, y + r * 0.1]], Math.max(2, INK * 0.7)); return; }
    jig = jig || 0;
    blob(ellipsePts(x, y, r, r, 12), C.shine, null, { shine: false, ink: Math.max(2, INK * 0.6) });
    var a = Math.PI / 2 - lean * 1.35 + jig, d = r * 0.48;
    ctx.fillStyle = C.outline; ctx.beginPath(); ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, r * 0.46, 0, Math.PI * 2); ctx.fill();
  }
  function drop(x, y, r) { blob([[x, y - r * 1.8], [x + r, y], [x + r * 0.6, y + r * 0.8], [x - r * 0.6, y + r * 0.8], [x - r, y]], C.sweat, null, { ink: INK * 0.5 }); }

  function plate(x, y, w) { blob(ellipsePts(x, y, w * 0.55, w * 0.1, 16), C.plate, C['plate-rim'], { shine: false }); }
  function drawDish(kind, x, y, w, lean, t, squint) {
    var hgt = w * 0.55;
    if (kind === 'soup') {
      plate(x, y, w);
      blob([[x - w * 0.42, y - hgt * 0.62], [x + w * 0.42, y - hgt * 0.62], [x + w * 0.34, y - hgt * 0.2], [x + w * 0.16, y - hgt * 0.02], [x - w * 0.16, y - hgt * 0.02], [x - w * 0.34, y - hgt * 0.2]], C.plate, C['plate-rim']);
      var s = Math.sin(t * 6) * w * 0.05 + lean * w * 0.12;
      blob(ellipsePts(x + s * 0.3, y - hgt * 0.62, w * 0.4, w * 0.07 + Math.abs(s) * 0.25, 14), C.soup, C['soup-deep'], { ink: INK * 0.7 });
      googly(x - w * 0.1, y - hgt * 0.35, w * 0.09, lean, 0, squint); googly(x + w * 0.1, y - hgt * 0.37, w * 0.1, lean, 0, squint);
      return hgt * 0.72;
    }
    if (kind === 'spaghetti') {
      plate(x, y, w); var tall = w * 0.95, sw = Math.sin(t * 5) * 0.08 + lean * 0.35, pts = [];
      for (var i = 0; i <= 8; i++) { var f = i / 8, bx = Math.sin(f * 9) * w * 0.08 + sw * f * f * w; pts.push([x - w * 0.36 * (1 - f * 0.75) + bx, y - w * 0.04 - tall * f]); }
      for (var j = 8; j >= 0; j--) { var f2 = j / 8, bx2 = Math.sin(f2 * 9 + 1) * w * 0.08 + sw * f2 * f2 * w; pts.push([x + w * 0.36 * (1 - f2 * 0.75) + bx2, y - w * 0.04 - tall * f2]); }
      blob(pts, C.noodle, C['noodle-deep']);
      for (var k = 1; k < 5; k++) inkLine([[x - w * 0.26 + sw * k * 3, y - tall * k * 0.2], [x + sw * k * 5, y - tall * k * 0.2 + w * 0.05], [x + w * 0.24 + sw * k * 3, y - tall * k * 0.2 - w * 0.02]], INK * 0.45);
      var tx = x + sw * w, ty = y - tall - w * 0.02;
      blob(ellipsePts(tx, ty, w * 0.2, w * 0.12, 12), C.sauce, C['soup-deep']);
      blob(ellipsePts(tx + w * 0.02, ty - w * 0.1, w * 0.08, w * 0.08, 10), C.sauce, C['soup-deep']);
      googly(x - w * 0.09 + sw * w * 0.4, y - tall * 0.55, w * 0.1, lean, 0, squint); googly(x + w * 0.11 + sw * w * 0.4, y - tall * 0.58, w * 0.1, lean, 0, squint);
      return tall + w * 0.12;
    }
    if (kind === 'jelly') {
      plate(x, y, w); var jj = Math.sin(t * 9) * 0.1, sq = 1 + jj, sk = lean * 0.5 + Math.sin(t * 7) * 0.08;
      var hh = w * 0.7 * sq, ww = w * 0.42 / Math.sqrt(sq);
      var jp = [[x - ww, y - w * 0.05], [x - ww * 0.95 + sk * hh * 0.3, y - hh * 0.5], [x - ww * 0.8 + sk * hh, y - hh], [x + sk * hh, y - hh * 1.06], [x + ww * 0.8 + sk * hh, y - hh], [x + ww * 0.95 + sk * hh * 0.3, y - hh * 0.5], [x + ww, y - w * 0.05], [x, y]];
      blob(jp, C.jelly, C['jelly-deep'], { alpha: JELLY_A });
      inkLine([[x - ww * 0.8 + sk * hh * 0.5, y - hh * 0.55], [x + sk * hh * 0.5, y - hh * 0.5], [x + ww * 0.8 + sk * hh * 0.5, y - hh * 0.55]], INK * 0.45);
      googly(x - w * 0.12 + sk * hh * 0.7, y - hh * 0.75, w * 0.12, lean, jj * 3, squint); googly(x + w * 0.13 + sk * hh * 0.7, y - hh * 0.77, w * 0.13, lean, -jj * 3, squint);
      return hh + w * 0.04;
    }
    if (kind === 'lobster') {
      plate(x, y, w); var wave = Math.sin(t * 4), cy = y - w * 0.28;
      blob(ellipsePts(x, cy, w * 0.42, w * 0.22, 16), C.lobster, C['lobster-deep']);
      [-1, 1].forEach(function (sgn) {
        var up = sgn * wave, ax = x + sgn * w * 0.4, ay = cy - w * 0.08;
        inkLine([[ax, ay], [ax + sgn * w * 0.14, ay - w * (0.18 + up * 0.14)], [ax + sgn * w * 0.2, ay - w * (0.3 + up * 0.2)]], INK * 1.6, C.outline);
        inkLine([[ax, ay], [ax + sgn * w * 0.14, ay - w * (0.18 + up * 0.14)], [ax + sgn * w * 0.2, ay - w * (0.3 + up * 0.2)]], INK * 0.7, C.lobster);
        var px = ax + sgn * w * 0.22, py = ay - w * (0.38 + up * 0.2);
        blob([[px - w * 0.1, py + w * 0.06], [px - w * 0.12, py - w * 0.1], [px - w * 0.01, py - w * 0.13], [px - w * 0.02, py - w * 0.02], [px + w * 0.05, py - w * 0.12], [px + w * 0.12, py - w * 0.04], [px + w * 0.08, py + w * 0.07]], C.lobster, C['lobster-deep']);
      });
      inkLine([[x - w * 0.06, cy - w * 0.2], [x - w * 0.18, cy - w * 0.5], [x - w * 0.3, cy - w * 0.62]], INK * 0.5);
      inkLine([[x + w * 0.06, cy - w * 0.2], [x + w * 0.2, cy - w * 0.52], [x + w * 0.34, cy - w * 0.6]], INK * 0.5);
      googly(x - w * 0.1, cy - w * 0.22, w * 0.1, lean, 0, squint); googly(x + w * 0.1, cy - w * 0.24, w * 0.1, lean, 0, squint);
      return w * 0.52;
    }
    if (kind === 'cake') {
      plate(x, y, w); var yy = y - w * 0.02, nod = lean * 0.4 + Math.sin(t * 3) * 0.05;
      var tiers = [[0.46, 0.3], [0.34, 0.26], [0.22, 0.24]];
      tiers.forEach(function (tr, i) {
        var rw = tr[0], rh = tr[1], off = nod * w * i * i * 0.18, tw = w * rw, th = w * rh;
        blob(boxPts(x - tw + off, yy - th, tw * 2, th, w * 0.05), C.cake, C['cake-deep']);
        var drip = []; for (var kk = 0; kk <= 8; kk++) { var f3 = kk / 8; drip.push([x - tw + off + f3 * tw * 2, yy - th + (kk % 2 ? w * 0.07 : w * 0.03)]); }
        blob([[x - tw + off, yy - th - w * 0.015], [x + tw + off, yy - th - w * 0.015]].concat(drip.reverse()), C.frosting, C['booth-deep'], { shine: false, ink: INK * 0.6 });
        yy -= th;
      });
      var offc = nod * w * 4 * 0.18;
      blob(ellipsePts(x + offc, yy - w * 0.06, w * 0.06, w * 0.06, 10), C.danger, C['soup-deep']);
      googly(x - w * 0.14 + nod * w * 0.1, y - w * 0.18, w * 0.1, lean, 0, squint); googly(x + w * 0.14 + nod * w * 0.1, y - w * 0.19, w * 0.1, lean, 0, squint);
      return y - yy + w * 0.12;
    }
    return hgt;
  }

  function drawFace(x, y, r, state, lean, t, crossEyed) {
    blob(ellipsePts(x, y, r, r * 1.08, 16), C.skin, C['noodle-deep']);
    if (state === 'panic') {
      ctx.save(); ctx.globalAlpha = 0.7; ctx.fillStyle = C['panic-flush'];
      [-1, 1].forEach(function (s) { ctx.beginPath(); ctx.ellipse(x + s * r * 0.55, y + r * 0.3, r * 0.2, r * 0.13, 0, 0, Math.PI * 2); ctx.fill(); });
      ctx.restore();
    }
    var hair = state === 'panic'
      ? [[x - r * 0.7, y - r * 0.7], [x - r * 0.55, y - r * 1.55], [x - r * 0.25, y - r * 0.95], [x, y - r * 1.7], [x + r * 0.25, y - r * 0.95], [x + r * 0.55, y - r * 1.5], [x + r * 0.7, y - r * 0.7]]
      : [[x - r * 0.85, y - r * 0.55], [x - r * 0.6, y - r * 1.12], [x + r * 0.3, y - r * 1.2], [x + r * 0.95, y - r * 0.95], [x + r * 0.8, y - r * 0.55], [x, y - r * 0.8]];
    blob(hair, C.trousers, null, { shine: false });
    var ex = r * 0.36, ey = y - r * 0.12;
    if (crossEyed) {
      // Grape gag (brief's Hazards table): eyes cross toward the nose for ~0.3s on impact.
      [-1, 1].forEach(function (s) {
        blob(ellipsePts(x + s * ex, ey, r * 0.2, r * 0.2, 10), C.shine, null, { shine: false, ink: INK * 0.6 });
        ctx.fillStyle = C.outline; ctx.beginPath(); ctx.arc(x + s * ex - s * r * 0.13, ey, r * 0.1, 0, Math.PI * 2); ctx.fill();
      });
      inkLine([[x - r * 0.3, y + r * 0.42], [x, y + r * 0.5], [x + r * 0.3, y + r * 0.42]], INK * 0.6);
    } else if (state === 'calm') {
      [-1, 1].forEach(function (s) {
        blob(ellipsePts(x + s * ex, ey, r * 0.2, r * 0.2, 10), C.shine, null, { shine: false, ink: INK * 0.6 });
        ctx.fillStyle = C.outline; ctx.beginPath(); ctx.arc(x + s * ex, ey + r * 0.05, r * 0.1, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = C.skin; ctx.fillRect(x + s * ex - r * 0.24, ey - r * 0.24, r * 0.48, r * 0.2);
        inkLine([[x + s * ex - r * 0.22, ey - r * 0.04], [x + s * ex + r * 0.22, ey - r * 0.04]], INK * 0.6);
      });
      inkLine([[x - r * 0.35, y + r * 0.38], [x, y + r * 0.55], [x + r * 0.38, y + r * 0.35]], INK * 0.7);
    } else if (state === 'sweat') {
      [-1, 1].forEach(function (s) {
        googly(x + s * ex, ey, r * 0.25, lean);
        inkLine([[x + s * ex - r * 0.2 * s, ey - r * 0.36], [x + s * ex + r * 0.2 * s, ey - r * 0.48]], INK * 0.6);
      });
      inkLine([[x - r * 0.35, y + r * 0.45], [x - r * 0.18, y + r * 0.38], [x, y + r * 0.46], [x + r * 0.18, y + r * 0.38], [x + r * 0.35, y + r * 0.45]], INK * 0.6);
      if (!reduceMotion) drop(x + r * 1.05, y - r * 0.55 - (t * 30 % 10), r * 0.2);
    } else {
      var pop = 1.3;
      [-1, 1].forEach(function (s) {
        blob(ellipsePts(x + s * ex * 1.1, ey - r * 0.12, r * 0.28 * pop, r * 0.32 * pop, 12), C.shine, null, { shine: false, ink: INK * 0.6 });
        ctx.fillStyle = C.outline; ctx.beginPath(); ctx.arc(x + s * ex * 1.1, ey - r * 0.12, r * 0.06, 0, Math.PI * 2); ctx.fill();
      });
      blob(ellipsePts(x, y + r * 0.55, r * 0.2, r * 0.26, 10), C.outline, null, { shine: false });
      if (!reduceMotion) { drop(x - r * 1.1, y - r * 0.4, r * 0.2); drop(x + r * 1.15, y - r * 0.7, r * 0.22); drop(x + r * 0.9, y + r * 0.15, r * 0.17); }
    }
  }

  function drawLeanArc(x, y, r, lean) {
    var span = Math.PI * 0.7, a0 = -Math.PI / 2 - span / 2;
    var zone = function (f0, f1, col) { ctx.beginPath(); ctx.arc(x, y, r, a0 + span * (0.5 + f0 / 2), a0 + span * (0.5 + f1 / 2)); ctx.strokeStyle = col; ctx.lineWidth = 12; ctx.stroke(); };
    ctx.save(); ctx.lineCap = 'butt'; ctx.beginPath(); ctx.arc(x, y, r, a0, a0 + span); ctx.strokeStyle = C.outline; ctx.lineWidth = 12 + INK * 1.2; ctx.lineCap = 'round'; ctx.stroke(); ctx.lineCap = 'butt';
    zone(-1, -0.75, C.danger); zone(-0.75, -0.45, C['lean-warn']); zone(-0.45, 0.45, C['lean-safe']); zone(0.45, 0.75, C['lean-warn']); zone(0.75, 1, C.danger);
    var a = a0 + span * (0.5 + lean / 2);
    inkLine([[x + Math.cos(a) * (r - 16), y + Math.sin(a) * (r - 16)], [x + Math.cos(a) * (r + 16), y + Math.sin(a) * (r + 16)]], INK * 1.1, C['lean-needle']);
    ctx.restore();
  }

  function drawWaiter(x, feetY, s, tilt, state, t, dishes, arcLean, crossEyed, sneezeGag) {
    var bob = reduceMotion ? 0 : Math.abs(Math.sin(t * 6)) * s * 0.04, hipY = feetY - s * 0.62 - bob, neckY = hipY - s * 0.5;
    [0, Math.PI].forEach(function (ph) {
      var a = reduceMotion ? 0 : Math.sin(t * 6 + ph) * s * 0.14;
      inkLine([[x, hipY], [x + a * 0.6, hipY + s * 0.3], [x + a, feetY - s * 0.02]], s * 0.1, C.outline);
      inkLine([[x, hipY], [x + a * 0.6, hipY + s * 0.3], [x + a, feetY - s * 0.02]], s * 0.06, C.trousers);
      blob(ellipsePts(x + a + s * 0.05, feetY, s * 0.1, s * 0.045, 10), C.outline, null, { shine: false });
    });
    blob(boxPts(x - s * 0.2, neckY, s * 0.4, s * 0.55, s * 0.12), C.shirt, C['chrome-deep']);
    blob([[x, neckY + s * 0.06], [x - s * 0.13, neckY - s * 0.02], [x - s * 0.13, neckY + s * 0.14], [x, neckY + s * 0.06], [x + s * 0.13, neckY + s * 0.14], [x + s * 0.13, neckY - s * 0.02]], C.bowtie, null, { shine: false, ink: INK * 0.7 });
    var trayY = neckY - s * 0.72, tw = s * 0.95;
    var tl = [x - Math.cos(tilt) * tw / 2, trayY - Math.sin(tilt) * tw / 2], tr = [x + Math.cos(tilt) * tw / 2, trayY + Math.sin(tilt) * tw / 2];
    [[-1, tl], [1, tr]].forEach(function (pair) {
      var sx = pair[0], end = pair[1], sh = [x + sx * s * 0.18, neckY + s * 0.12];
      var m = [sh[0] + sx * s * 0.28, (sh[1] + end[1]) / 2 + s * 0.05];
      inkLine([sh, m, [end[0] - sx * s * 0.05, end[1] + s * 0.05]], s * 0.1, C.outline);
      inkLine([sh, m, [end[0] - sx * s * 0.05, end[1] + s * 0.05]], s * 0.055, C.shirt);
      blob(ellipsePts(end[0] - sx * s * 0.05, end[1] + s * 0.04, s * 0.06, s * 0.06, 8), C.shine, null, { shine: false, ink: INK * 0.6 });
    });
    drawFace(x, neckY - s * 0.22, s * 0.2, state, tilt * 2, t, crossEyed);
    if (arcLean !== null) drawLeanArc(x, trayY, tw * 0.62, arcLean);
    ctx.save(); ctx.translate(x, trayY); ctx.rotate(tilt);
    blob(boxPts(-tw / 2, -s * 0.03, tw, s * 0.06, s * 0.03), C.chrome, C['chrome-deep']);
    var yy = -s * 0.04, lx = 0;
    dishes.forEach(function (d, i) {
      var rot = clamp(d.sway, -1.4, 1.4);
      ctx.save(); ctx.translate(lx, yy); ctx.rotate(rot);
      var squint = sneezeGag && i === dishes.length - 1;
      var hgt = drawDish(d.kind, 0, 0, s * 0.48, d.sway, t + i, squint);
      ctx.restore();
      lx += Math.sin(rot) * hgt; yy -= Math.cos(rot) * hgt;
    });
    ctx.restore();
  }

  // preP: telegraph progress 0..1 (spawnAt -> hitAt). postP: post-impact gag progress 0..1
  // (hitAt -> hitAt+GAG), 0 while still telegraphing. Each kind uses whichever phase its gag needs.
  function drawHazard(kind, x, y, s, t, preP, postP) {
    if (kind === 'door') {
      var shakeAmt = postP > 0 ? 0 : 0.12 + preP * 0.35;
      var sw = Math.sin(t * (16 + preP * 10)) * shakeAmt;
      blob([[x - s * 0.35, y], [x - s * 0.35, y - s * 1.2], [x + s * 0.35 * (1 - sw), y - s * 1.2 - s * sw * 0.1], [x + s * 0.35 * (1 - sw), y + s * sw * 0.1]], C.door, C.outline);
      if (postP > 0) {
        blob(ellipsePts(x - s * 0.02, y - s * 0.85, s * 0.17, s * 0.17, 12), C.skin, C['noodle-deep']);
        ctx.fillStyle = C.outline;
        ctx.beginPath(); ctx.arc(x - s * 0.08, y - s * 0.88, s * 0.035, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(x + s * 0.04, y - s * 0.88, s * 0.035, 0, Math.PI * 2); ctx.fill();
        ctx.font = num('--weight-display') + ' ' + (s * 0.16) + 'px ' + tok('--font-display'); ctx.textAlign = 'left'; ctx.fillText('OW!', x + s * 0.22, y - s * 0.9);
      } else {
        blob(ellipsePts(x - s * 0.02, y - s * 0.85, s * 0.16, s * 0.16, 12), C['door-window'], null);
        if (Math.sin(t * 14) > 0.2) {
          ctx.fillStyle = C.outline; ctx.font = num('--weight-display') + ' ' + (s * 0.16) + 'px ' + tok('--font-display'); ctx.textAlign = 'left'; ctx.fillText('BANG!', x - s * 0.42, y - s * 1.3);
        }
      }
    } else if (kind === 'grape') {
      var rr = s * 0.16; blob(ellipsePts(x, y - rr, rr, rr, 12), C.grape, C.outline);
      if (postP > 0) {
        [[-1, -0.7], [1, -0.7], [-1, 0.35], [1, 0.35], [0, -1.1]].forEach(function (dir) {
          var len = s * (0.14 + postP * 0.3);
          inkLine([[x, y - rr], [x + dir[0] * len, y - rr + dir[1] * len]], INK * 0.9, C.grape);
        });
      }
    } else if (kind === 'bucket') {
      blob([[x - s * 0.3, y - s * 0.5], [x + s * 0.3, y - s * 0.5], [x + s * 0.24, y], [x - s * 0.24, y]], C.bucket, C['noodle-deep']);
      var pivotX = x + s * 0.05, pivotY = y - s * 0.45;
      ctx.save(); ctx.translate(pivotX, pivotY); ctx.rotate(postP * Math.PI * 6);
      inkLine([[0, 0], [s * 0.15, -s * 0.45], [s * 0.27, -s * 0.85]], INK * 1.3, C.outline);
      blob([[-s * 0.1, 0], [s * 0.13, -s * 0.17], [-s * 0.03, -s * 0.27], [-s * 0.25, -s * 0.13]], C.mop, null, { shine: false });
      ctx.restore();
    } else if (kind === 'puddle') {
      blob(ellipsePts(x, y - s * 0.04, s * 0.45, s * 0.08, 16), C.puddle, null);
      blob([[x + s * 0.1, y - s * 0.05], [x + s * 0.28, y - s * 0.7], [x + s * 0.46, y - s * 0.05]], C.sign, C['noodle-deep'], { shine: false });
      ctx.fillStyle = C.outline; ctx.font = num('--weight-display') + ' ' + (s * 0.3) + 'px ' + tok('--font-display'); ctx.textAlign = 'center'; ctx.fillText('!', x + s * 0.28, y - s * 0.16);
    } else if (kind === 'sneeze') {
      blob(boxPts(x - s * 0.45, y - s * 0.7, s * 0.3, s * 0.7, s * 0.1), C.booth, C['booth-deep']);
      blob(ellipsePts(x - s * 0.1, y - s * 0.72, s * 0.16, s * 0.17, 12), C.cake, C['cake-deep']);
      ctx.fillStyle = C.outline; ctx.textAlign = 'left';
      if (postP > 0) {
        ctx.font = num('--weight-display') + ' ' + (s * 0.2) + 'px ' + tok('--font-display'); ctx.fillText('CHOO!', x + s * 0.08, y - s * 0.78);
      } else {
        var grow = 0.35 + preP * 0.85;
        var bx = x + s * 0.05, by = y - s * (0.98 + preP * 0.18);
        blob(ellipsePts(bx, by, s * 0.3 * grow, s * 0.18 * grow, 12), C.surface, null, { shine: false, ink: INK * 0.7 });
        ctx.font = num('--weight-strong') + ' ' + (s * (0.1 + preP * 0.06)) + 'px ' + tok('--font-body'); ctx.textAlign = 'center';
        ctx.fillText(preP > 0.5 ? 'AH... AH...' : 'ah...', bx, by + s * 0.05);
      }
    }
  }

  function scene(t) {
    var floorY = H * 0.84;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, floorY);
    ctx.fillStyle = C['bg-2']; ctx.fillRect(0, floorY - H * 0.2, W, H * 0.2);
    inkLine([[0, floorY - H * 0.2], [W / 2, floorY - H * 0.2], [W, floorY - H * 0.2]], INK * 0.8);
    var off = -((t * 60) % 190);
    for (var bx = off; bx < W + 190; bx += 190) {
      blob(boxPts(bx - 8, floorY - H * 0.24, 52, H * 0.24, 14), C.booth, C['booth-deep']);
      blob(boxPts(bx + 120, floorY - H * 0.24, 40, H * 0.24, 14), C.booth, C['booth-deep']);
      blob(boxPts(bx + 44, floorY - H * 0.13, 72, 12, 5), C.surface, C.chrome);
      inkLine([[bx + 80, floorY - H * 0.12], [bx + 80, floorY - 2]], INK * 1.2, C['chrome-deep']);
    }
    var tile = 26, fo = (t * 100) % (tile * 2);
    for (var r = 0; r * tile < H - floorY; r++) for (var c = -2; c * tile < W + tile * 2; c++) {
      ctx.fillStyle = (r + c) % 2 ? C['floor-b'] : C['floor-a']; ctx.fillRect(c * tile - fo, floorY + r * tile, tile, tile);
    }
    ctx.fillStyle = C.outline; ctx.fillRect(0, floorY - 2, W, INK);
    return floorY;
  }

  // Diners seated in booths, not floating heads (THE-44): a booth back, a torso, then the head.
  function drawDiners(floorY, t, gasping) {
    [[W * 0.08, -1], [W * 0.9, 1]].forEach(function (pair, i) {
      var x = pair[0], sign = pair[1], headY = floorY * 0.5, boothTop = headY - 34;
      blob(boxPts(x - 34, boothTop, 68, floorY - boothTop, 16), C.booth, C['booth-deep'], { shine: false });
      blob(boxPts(x - 20, headY + 12, 40, floorY - (headY + 12) - 6, 14), C.shirt, C['chrome-deep'], { shine: false });
      blob(ellipsePts(x, headY, 16, 16, 14), C.skin, C['noodle-deep']);
      if (gasping) {
        var openH = reduceMotion ? 6 : 4 + Math.abs(Math.sin(t * 10 + i)) * 5;
        ctx.fillStyle = C.outline; ctx.beginPath(); ctx.ellipse(x, headY + 7, 4, openH * 0.5, 0, 0, Math.PI * 2); ctx.fill();
        drawGaspBubble(x, headY, -sign); // toward the aisle/centre, so the bubble stays on-screen
      }
    });
  }

  function drawGaspBubble(x, y, sign) {
    var bx = x + sign * 34, by = y - 38;
    blob(ellipsePts(bx, by, 30, 20, 14), C.surface, null, { shine: false, ink: INK * 0.8 });
    inkLine([[x + sign * 12, y - 12], [bx - sign * 16, by + 12]], INK * 0.6);
    ctx.fillStyle = C.outline; ctx.font = num('--weight-display') + ' 14px ' + tok('--font-display');
    ctx.textAlign = 'center'; ctx.fillText('GASP!', bx, by + 5);
  }

  // The chef pops through the kitchen door's porthole and facepalms (brief section 6, "Reactions").
  function drawChefFacepalm(floorY) {
    var x = W * 0.65, y = floorY * 0.32; // clear of the right diner's booth (W * 0.9)
    ctx.save(); ctx.globalAlpha = Math.min(1, crash.elapsed * 2);
    blob(ellipsePts(x, y + 6, 27, 31, 14), C.door, C['booth-deep'], { shine: false });
    blob(ellipsePts(x, y + 6, 20, 24, 12), C['door-window'], null, { shine: false });
    blob(ellipsePts(x, y + 18, 15, 15, 12), C.shirt, C['chrome-deep']);
    blob(ellipsePts(x, y, 15, 15, 12), C.skin, C['noodle-deep']);
    var tilt = reduceMotion ? 0.3 : Math.min(0.6, crash.elapsed);
    ctx.save(); ctx.translate(x, y); ctx.rotate(-0.4 * tilt);
    blob(ellipsePts(6, -2, 8, 5, 10), C.skin, null, { shine: false });
    ctx.restore(); ctx.restore();
  }

  function draw(t) {
    shapeId = 0;
    ctx.clearRect(0, 0, W, H);
    var shaking = screen === 'crash' && now() >= crash.hitStopUntil;
    if (shaking) {
      var shakeMag = SHAKE_PX * Math.max(0, 1 - crash.elapsed / SHAKE_DECAY_S);
      if (shakeMag > 0.02) { ctx.save(); ctx.translate(Math.sin(crash.elapsed * 55) * shakeMag, Math.cos(crash.elapsed * 47) * shakeMag); }
      else shaking = false;
    }
    var floorY = scene(t);

    if (screen === 'about') return;

    var waiterX = W * 0.36, s = clamp(W * 0.34, 90, 150);
    if (screen === 'start') {
      // Idle beat (brief section 4): walking in place with one googly soup, no lean HUD, no hazards.
      var idleTilt = reduceMotion ? 0 : Math.sin(t * 0.8) * 0.12;
      var idleDish = [{ kind: 'soup', sway: reduceMotion ? 0 : Math.sin(t * 1.1) * 0.18 }];
      drawWaiter(waiterX, floorY, s, idleTilt, 'calm', t, idleDish, null);
      var trayY = floorY - s * 0.62 - s * 0.5 - s * 0.72;
      var hintY = trayY - s * 0.7;
      // On short/wide viewports (e.g. desktop landscape) the card can reach as far down as the hint
      // would sit; skip the hint rather than let it collage behind the card (the soup still clears it).
      var startPanel = $('start').querySelector('.panel');
      var panelBottom = startPanel ? startPanel.getBoundingClientRect().bottom : 0;
      if (hintY - 24 > panelBottom) drawDragHint(waiterX, hintY, t);
      return;
    }

    var tilt = run ? clamp(run.trayAngle, -1.4, 1.4) * 0.5 : 0;
    var dangerState = run ? Logic.danger(run) : 'calm';
    var arcLean = run ? Logic.signedLean(run) : 0;
    var dishes = run ? run.dishes.map(function (d) { return { kind: d.type.id, sway: d.sway }; }) : [];

    if (screen === 'crash') drawDiners(floorY, t, true);
    drawHazardVignette(floorY, t);

    if (screen === 'crash') {
      drawWaiter(waiterX, floorY, s, tilt, 'panic', t, [], null);
      crash.pieces.forEach(function (p) { ctx.save(); ctx.translate(waiterX + p.x, floorY - s * 1.55 + p.y); ctx.rotate(p.rot); drawDish(p.kind, 0, 0, s * 0.48, 0, t); ctx.restore(); });
      drawChefFacepalm(floorY);
    } else {
      var crossEyed = hazardGagActive('grape', 0.3);
      var sneezeGag = hazardGagActive('sneeze', 0.4);
      drawWaiter(waiterX, floorY, s, tilt, dangerState, t, dishes, arcLean, crossEyed, sneezeGag);
    }
    if (shaking) ctx.restore();
  }

  // "Drag to tilt" (brief section 4): a ghost hand swipes between two chevrons over the tray, with a
  // short label riding along; both freeze in the middle when reduced motion is on.
  function drawDragHint(cx, cy, t) {
    var range = reduceMotion ? 0 : 30;
    var hx = cx + Math.sin(t * 1.6) * range;
    ctx.save();
    ctx.globalAlpha = 0.55;
    [-1, 1].forEach(function (sgn) {
      var ax = cx + sgn * 50;
      inkLine([[ax - sgn * 8, cy - 8], [ax, cy], [ax - sgn * 8, cy + 8]], INK * 0.9, C.outline);
    });
    ctx.globalAlpha = 1;
    blob(ellipsePts(hx, cy, 15, 12, 12), C.skin, C['noodle-deep'], { shine: false });
    blob(ellipsePts(hx - 12, cy - 5, 6, 5, 8), C.skin, C['noodle-deep'], { shine: false });
    ctx.font = num('--weight-strong') + ' ' + num('--text-min') + 'px ' + tok('--font-body');
    ctx.textAlign = 'center'; ctx.fillStyle = C.outline;
    ctx.fillText('drag to tilt', cx, cy - 22);
    ctx.restore();
  }

  // Telegraph: the hazard sprite approaches from spawnAt to hitAt (the brief's Hazards table wants
  // it visible >=1s before the impulse lands), then holds for a short gag beat before fading.
  function drawHazardVignette(floorY, t) {
    if (!run) return;
    var GAG = 0.5;
    var waiterX = W * 0.36;
    for (var i = run.hazards.length - 1; i >= 0; i--) {
      var hz = run.hazards[i];
      var lead = hz.hitAt - hz.spawnAt;
      var age = run.t - hz.spawnAt;
      if (age > lead + GAG) continue;
      var x, alpha, preP, postP;
      if (age <= lead) {
        preP = age / lead;
        postP = 0;
        var startX = hz.sign > 0 ? -W * 0.15 : W * 1.15;
        x = startX + (waiterX - startX) * preP;
        alpha = Math.min(1, preP * 3);
      } else {
        preP = 1;
        postP = (age - lead) / GAG;
        x = waiterX + (hz.sign > 0 ? 1 : -1) * 16;
        alpha = 1 - postP;
      }
      ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      drawHazard(hz.type.id, x, floorY, 70, t, preP, postP);
      ctx.restore();
    }
  }

  // Grape/sneeze gags land on the waiter/dish itself, not the vignette sprite, so they're driven
  // straight off the hazard's hit time rather than the vignette's fading approach/gag phase.
  function hazardGagActive(kindId, dur) {
    if (!run) return false;
    for (var i = 0; i < run.hazards.length; i++) {
      var hz = run.hazards[i];
      if (hz.type.id === kindId && hz.hit && run.t - hz.hitAt < dur) return true;
    }
    return false;
  }

  // ---- about modal ----
  function openAbout() { show('about', true); }
  function closeAbout() { show('about', false); }

  // ---- wiring ----
  $('play').addEventListener('click', function () { startRun(); });
  $('again').addEventListener('click', function () { if (now() > lockUntil) restart(); });
  $('pause-btn').addEventListener('click', pause);
  $('share').addEventListener('click', shareBill);
  $('resume').addEventListener('click', resume);
  $('mute-toggle').addEventListener('click', function () { muted = !muted; saveMuted(muted); $('mute-toggle').textContent = 'Sound: ' + (muted ? 'off' : 'on'); });
  $('paused').addEventListener('pointerdown', function (e) { if (e.target === $('paused')) resume(); });
  $('about-open').addEventListener('click', openAbout);
  $('about-close').addEventListener('click', closeAbout);
  $('about').addEventListener('pointerdown', function (e) { if (e.target === $('about')) closeAbout(); });

  startInfo();
  setScreen('start');
  startLoop();

  // ---- QA test hook (design-toolkit contract) ----
  window.__tray = {
    get state() { return run; },
    get screen() { return screen; },
    get best() { return best; },
    setSeed: function (seed) { startRun(seed); },
    forceCrash: function () { if (run) { run.dishes.forEach(function (d) { d.sway = 1.1; }); Logic.step(run); } },
    getInputLog: function () { return run ? run.log.slice() : []; },
    replay: function (seed, log) { return Logic.replay(seed, log); },
    restart: restart,
  };
})();
