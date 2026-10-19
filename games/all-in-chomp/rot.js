// Brain rot (2026-10-19 design §3): four short meme moments over the table, ported from Junkies Pro's js/rot.js.
// A 2D canvas (#chomp-rot) draws the art; the captions are DOM (#chomp-rotcap, G10: every letter is DOM).
// game.js starts a moment from the sim's events, holds the sim while a holding one plays, and ticks and draws
// it every frame. Render only.
//   sweep: all four eaten on one ALL IN - you slam in over gold rays, the hat, the shades, the four orbit, the prize
//   clear: the level clear - rays in the next table's colours, you in the shades (the DOM clear show sits on top)
//   joker: the held joker saves you - a card flips over into your face, the catcher is knocked off the screen
//   bust:  game over - grey, X eyes on you, "<you> בטילט!", the catcher laughing in a corner
// A face is { cv, closed, eyeL, eyeR, hat }: canvases (device px) and points as fractions of cv's size.
const TAU = Math.PI * 2;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const outBack = (x, s = 1.9) => { x = clamp01(x); return 1 + (s + 1) * (x - 1) ** 3 + s * (x - 1) ** 2; };
const outCubic = (x) => 1 - (1 - clamp01(x)) ** 3;
const outExpo = (x) => { x = clamp01(x); return x >= 1 ? 1 : 1 - 2 ** (-10 * x); };
const inQuad = (x) => clamp01(x) ** 2;
const decay = (t, tau) => (t < 0 ? 0 : Math.exp(-t / tau));
const lerp = (a, b, k) => a + (b - a) * k;

export const DUR = { sweep: 2.6, clear: 2.0, joker: 1.7, bust: 1.8 };
export const HOLDS = { sweep: true, clear: false, joker: true, bust: false };
const OUT = 0.22; // the last 0.22 s fade or fly out
const SLAM = 0.24; // sweep: the two copies meet
const FLIP = 0.4; // joker: the card turns over
const PRIZE = 1.3; // sweep: the prize card spins in
const EMOJI_FONT = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
// "deal with it" shades, one string per pixel row: X black, W a white glint
const SHADES = ["XXXXXXXXXXXXXXXXX", "XWWXXXXXXXWWXXXXX", ".WXXXXX...WXXXXX.", "..XXXX.....XXXX.."];
const CAP_STYLE = {
  sweep: { top: ["#FFD23F", "#3a2400"], bottom: ["#7CFF6B", "#0d3a12"] },
  joker: { top: ["#FFE08A", "#2b1a10"], bottom: ["#FFF4DC", "#1d2b5a"] },
  bust: { top: ["#FF5A4E", "#1a0505"], bottom: ["#FF5A4E", "#1a0505"] },
};

// the hat and the X, drawn once into 256 px canvases (Junkies Pro js/poses.js); px, py = the anchor (fraction)
function propCanvas(draw) {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  draw(c.getContext("2d"));
  return c;
}
function makeProps() {
  const hat = propCanvas((x) => {
    x.fillStyle = "#5a3a22"; x.strokeStyle = "#2b1a10"; x.lineWidth = 7;
    x.beginPath(); x.ellipse(128, 196, 122, 28, 0, 0, TAU); x.fill(); x.stroke();
    x.beginPath(); x.moveTo(66, 190); x.bezierCurveTo(60, 140, 76, 108, 104, 105); x.bezierCurveTo(118, 103, 124, 114, 128, 114);
    x.bezierCurveTo(132, 114, 138, 103, 152, 105); x.bezierCurveTo(180, 108, 196, 140, 190, 190); x.closePath(); x.fill(); x.stroke();
    x.fillStyle = "#2b1a10"; x.beginPath(); x.moveTo(66, 174); x.lineTo(190, 174); x.lineTo(191, 190); x.lineTo(65, 190); x.closePath(); x.fill();
    x.fillStyle = "rgba(255,255,255,.12)"; x.beginPath(); x.ellipse(128, 196, 110, 16, 0, 0, TAU); x.fill();
  });
  const xeye = propCanvas((x) => {
    x.beginPath(); x.moveTo(66, 66); x.lineTo(190, 190); x.moveTo(190, 66); x.lineTo(66, 190);
    x.strokeStyle = "#fdf6e3"; x.lineWidth = 64; x.lineCap = "round"; x.stroke();
    x.strokeStyle = "#8c2f2f"; x.lineWidth = 46; x.stroke();
  });
  return { hat: { canvas: hat, px: 0.5, py: 0.76 }, xeye: { canvas: xeye, px: 0.5, py: 0.5 } };
}

export function createRot(canvas, caps, { reduced, sfx = {}, onEnd = null }) {
  const c = canvas.getContext("2d");
  const [capTop, capBottom] = [caps.querySelector(".aic-rotcap__top"), caps.querySelector(".aic-rotcap__bottom")];
  let P = null; // props, made on first use (needs the document)
  let cur = null, hold = null, W = 1, H = 1, dpr = 1, shown = false;
  const rm = () => reduced();
  const play = (name, ...args) => { if (sfx[name]) sfx[name](...args); };

  function start(kind, o, done) {
    if (cur) finish(); // a moment never stacks: the old one ends now
    P = P || makeProps();
    cur = o; o.kind = kind; o.t = 0; o.dur = DUR[kind]; o.done = done || null; o.cues = {};
    setCap(capTop, null); setCap(capBottom, null);
  }
  function finish() {
    const o = cur;
    cur = null;
    setCap(capTop, null); setCap(capBottom, null);
    if (o && o.done) o.done();
    if (onEnd) onEnd();
  }
  // once, when the moment's clock passes `at`
  function cue(name, at, fn) { const lt = hold !== null ? hold : cur.t; if (lt >= at && !cur.cues[name]) { cur.cues[name] = true; fn(); } }
  function tick(dt) {
    if (!cur || hold !== null) return;
    cur.t += dt;
    if (cur.t >= cur.dur) finish();
  }

  // ---- captions (DOM) ----
  function setCap(el, text, colours) {
    if (!el) return;
    if (!text) { el.hidden = true; el.classList.remove("is-in"); el.textContent = ""; return; }
    el.textContent = text;
    if (colours) { el.style.setProperty("--fill", colours[0]); el.style.setProperty("--ink", colours[1]); }
    el.hidden = false;
    el.classList.remove("is-in"); void el.offsetWidth; el.classList.add("is-in");
  }

  // ---- drawing helpers (CSS px) ----
  function size() {
    const w = window.innerWidth, h = window.innerHeight, r = Math.min(window.devicePixelRatio || 1, 2);
    if (w !== W || h !== H || r !== dpr) { W = w; H = h; dpr = r; canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
  }
  function rays(cx, cy, ang, n, c1, c2) {
    const R = Math.hypot(W, H);
    c.fillStyle = c2; c.fillRect(0, 0, W, H);
    c.fillStyle = c1; c.beginPath();
    for (let i = 0; i < n; i++) { const a0 = ang + (i * TAU) / n; c.moveTo(cx, cy); c.arc(cx, cy, R, a0, a0 + TAU / n / 2); c.closePath(); }
    c.fill();
    const g = c.createRadialGradient(cx, cy, 0, cx, cy, R * 0.6);
    g.addColorStop(0, "rgba(255,240,200,0.25)"); g.addColorStop(0.35, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.55)");
    c.fillStyle = g; c.fillRect(0, 0, W, H);
  }
  const faceW = (f, h, img = f.cv) => (h * img.width) / img.height;
  // a face centred at (x, y), h CSS px tall
  function face(f, x, y, h, ang = 0, o = {}) {
    const img = o.closed && f.closed ? f.closed : f.cv, w = faceW(f, h, img);
    c.save(); c.translate(x, y); c.rotate(ang); c.scale(o.sx || 1, o.sy || 1);
    if (o.alpha !== undefined) c.globalAlpha *= o.alpha;
    if (o.gray) c.filter = `grayscale(${o.gray})`;
    c.shadowColor = "rgba(0,0,0,.45)"; c.shadowBlur = h * 0.06; c.shadowOffsetY = h * 0.04;
    c.drawImage(img, -w / 2, -h / 2, w, h);
    c.restore();
  }
  // a point of the face (fractions of cv) on screen, for a face drawn at x, y, h, ang
  function mark(f, m, x, y, h, ang) {
    const w = faceW(f, h), dx = (m[0] - 0.5) * w, dy = (m[1] - 0.5) * h, cs = Math.cos(ang), sn = Math.sin(ang);
    return [x + cs * dx - sn * dy, y + sn * dx + cs * dy];
  }
  function prop(p, x, y, s, ang = 0, alpha = 1) {
    c.save(); c.globalAlpha *= alpha; c.translate(x, y); c.rotate(ang);
    c.drawImage(p.canvas, -p.px * s, -p.py * s, s, s);
    c.restore();
  }
  function shades(f, x, y, h, ang, drop) {
    const l = mark(f, f.eyeL, x, y, h, ang), r = mark(f, f.eyeR, x, y, h, ang);
    const px = Math.hypot(r[0] - l[0], r[1] - l[1]) / 9, a = Math.atan2(r[1] - l[1], r[0] - l[0]);
    c.save(); c.translate((l[0] + r[0]) / 2, (l[1] + r[1]) / 2 - drop); c.rotate(a);
    for (let j = 0; j < SHADES.length; j++) for (let i = 0; i < 17; i++) {
      const ch = SHADES[j][i];
      if (ch === ".") continue;
      c.fillStyle = ch === "W" ? "#ffffff" : "#0b0b0b";
      c.fillRect((i - 8.5) * px, (j - 1.2) * px, px + 0.6, px + 0.6);
    }
    c.restore();
  }
  function emoji(e, x, y, px, ang = 0) {
    c.save(); c.translate(x, y); c.rotate(ang);
    c.font = `${px}px ${EMOJI_FONT}`; c.textAlign = "center"; c.textBaseline = "middle";
    c.fillStyle = "#000"; // colour emoji take the fill's alpha; a leftover nearly-clear fill would hide them
    c.fillText(e, 0, 0); c.restore();
  }
  // emoji crossing the screen in arcs, side to side, from `at` s, one every `gap` s
  function flyBy(list, lt, at, gap, U) {
    list.forEach((e, k) => {
      const tt = lt - at - k * gap, T = 0.85;
      if (tt < 0 || tt > T) return;
      const u = tt / T, x = k % 2 === 0 ? lerp(-0.15 * W, 1.15 * W, u) : lerp(1.15 * W, -0.15 * W, u);
      emoji(e, x, H * (0.78 - 0.3 * Math.sin(Math.PI * u)) + k * 0.03 * H, 0.16 * U, tt * 7 * (k % 2 ? 1 : -1));
    });
  }
  // a playing card, w CSS px wide: face down (our back) or face up (the joker: cream, marigold star)
  function card(x, y, w, ang, sx, faceUp) {
    const h = w * 1.4;
    c.save(); c.translate(x, y); c.rotate(ang); c.scale(sx, 1);
    c.fillStyle = faceUp ? "#FFF4DC" : "#E2412E"; c.strokeStyle = "#1A1210"; c.lineWidth = Math.max(1.5, w * 0.05);
    c.beginPath(); c.roundRect(-w / 2, -h / 2, w, h, w * 0.12); c.fill(); c.stroke();
    if (faceUp) {
      const r = h * 0.28;
      c.beginPath();
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r; c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      c.closePath(); c.fillStyle = "#FFC233"; c.fill(); c.lineWidth = Math.max(1, w * 0.035); c.stroke();
    } else {
      c.save(); c.beginPath(); c.roundRect(-w * 0.36, -h * 0.4, w * 0.72, h * 0.8, w * 0.06); c.clip();
      c.strokeStyle = "rgba(255,244,220,.55)"; c.lineWidth = Math.max(1, w * 0.03);
      for (let s = -h; s < h; s += w * 0.16) { c.beginPath(); c.moveTo(-w, s); c.lineTo(w, s + w * 1.2); c.moveTo(-w, s + w * 1.2); c.lineTo(w, s); c.stroke(); }
      c.restore();
    }
    c.restore();
  }
  // a card that spins in face down and turns over at `turnAt` s after its start t0
  function flipCard(x, y, w, lt, t0, turnAt, ang) {
    const ct = lt - t0;
    if (ct < 0) return;
    const k = outBack(ct / 0.22, 1.6), turn = clamp01((ct - turnAt + 0.2) / 0.2);
    const sx = Math.max(0.04, Math.abs(Math.cos(turn * Math.PI)));
    card(x, y, w * k, ang + (1 - k) * -0.8, sx, turn > 0.5);
  }

  // ---- the moments ----
  function drawSweep(o, lt, U, cx, cy) {
    const red = rm(), f = o.you, slam = lt - SLAM;
    rays(cx, cy, lt * (red ? 0.6 : 1.6), 18, "#E9C46A", "#8a5a12");
    const d = 0.62 * U, rx = Math.min(0.37 * W, 0.95 * U), ry = Math.min(0.62 * U, 0.26 * H);
    if (slam < 0) {
      const k = inQuad(lt / SLAM);
      for (const s of [-1, 1]) for (let j = red ? 0 : 3; j >= 0; j--) {
        const kk = Math.max(0, k - j * 0.06), x = lerp(cx + s * W * 0.8, cx + s * d * 0.18, red ? 1 : inQuad(kk));
        face(f, x, cy, d * 0.9, s * 0.26, { alpha: j ? 0.22 : 1 });
      }
      return;
    }
    o.others.forEach((g, i) => {
      const a = (TAU * i) / o.others.length + lt * 1.3, rr = outBack(slam / 0.35, 1.6);
      face(g, cx + Math.cos(a) * rx * rr, cy + Math.sin(a) * ry * rr, 0.26 * U, 0.2 * Math.sin(lt * 5 + i), { closed: Math.floor(lt * 4 + i) % 5 === 0 });
    });
    const pulse = 1 + 0.22 * decay(slam, 0.15), bounce = red ? 0 : 0.1 * U * Math.exp(-slam / 0.4) * Math.sin(slam * 16);
    const dd = d * pulse, ang = 0.1 * Math.sin(lt * 4), y = cy - bounce;
    face(f, cx, y, dd, ang, { closed: slam < 0.3, sx: 1 + 0.18 * decay(slam, 0.1), sy: 1 - 0.18 * decay(slam, 0.1) });
    const hk = (slam - 0.15) / 0.32;
    if (hk > 0) { const at = mark(f, f.hat, cx, y, dd, ang); prop(P.hat, at[0], at[1] - (1 - outBack(hk, 2.4)) * H * 0.5, faceW(f, dd) * 1.3, ang - 0.12); }
    const sk = (slam - 0.55) / 0.3;
    if (sk > 0) shades(f, cx, y, dd, ang, (1 - outCubic(sk)) * H * 0.5);
    if (o.prize === "joker" && lt >= PRIZE) {
      const fly = clamp01((lt - (o.dur - OUT - 0.3)) / 0.3);
      const px = lerp(cx + rx * 0.85, o.toHead[0], inQuad(fly)), py = lerp(cy + ry * 0.35, o.toHead[1], inQuad(fly));
      flipCard(px, py, lerp(0.28 * U, 20, outCubic(fly)), lt, PRIZE, 0.35, -0.15);
    }
    flyBy(["🔥", "💯", "🗿", "👑"], lt, SLAM + 0.55, 0.16, U);
  }

  function drawClear(o, lt, U, cx) {
    const red = rm(), y = H * 0.3, h = Math.min(0.34 * H, 0.55 * U);
    const pop = red ? outCubic(lt / 0.2) : outBack(lt / 0.3, 2), ang = red ? 0 : 0.08 * Math.sin(lt * 3);
    face(o.you, cx, y, h * pop, ang);
    const sk = (lt - 0.35) / 0.3;
    if (sk > 0) shades(o.you, cx, y, h * pop, ang, (1 - outCubic(sk)) * H * 0.4);
    flyBy(["✨", "🎉", "✨"], lt, 0.5, 0.18, U);
  }

  function drawJoker(o, lt, U, cx, cy) {
    const red = rm(), out = clamp01((lt - (o.dur - OUT)) / OUT);
    if (lt < FLIP) { flipCard(cx, cy, 0.46 * U, lt, 0, 10, 0.05); return; } // face down until the flip
    const ft = lt - FLIP, ps = outBack(ft / 0.25, 2);
    const x = lerp(cx, o.from[0], inQuad(out)), y = lerp(cy, o.from[1], inQuad(out)), h = lerp(0.62 * U * ps, 0.1 * U, outCubic(out));
    if (out <= 0) { c.save(); c.globalAlpha = 0.5 * (1 - decay(ft, 0.1)); c.fillStyle = "#E9C46A"; c.beginPath(); c.arc(cx, cy, 0.4 * U * ps, 0, TAU); c.fill(); c.restore(); }
    face(o.you, x, y, h, red ? 0 : 0.06 * Math.sin(ft * 6));
    // the catcher comes in from the side, hits the card and is knocked spinning off the top
    const kt = ft - 0.05;
    if (kt > 0) {
      const inK = clamp01(kt / 0.18), offK = clamp01((kt - 0.18) / 0.6);
      const kx = offK > 0 ? lerp(cx + 0.42 * U, -0.25 * W, outCubic(offK)) : lerp(W * 1.15, cx + 0.42 * U, outCubic(inK));
      const ky = offK > 0 ? lerp(cy, -0.25 * H, outCubic(offK)) : cy;
      face(o.catcher, kx, ky, 0.36 * U, red ? 0 : offK * 9);
      if (offK > 0 && offK < 0.35) emoji("💥", cx + 0.34 * U, cy - 0.05 * U, 0.22 * U * (1 - offK), 0);
    }
    flyBy(["🃏", "🎉", "🃏"], lt, FLIP + 0.1, 0.14, U);
  }

  function drawBust(o, lt, U, cx, cy) {
    const red = rm(), f = o.you, out = clamp01((lt - (o.dur - OUT)) / OUT), d = 0.62 * U;
    const k = red ? outCubic(lt / 0.2) : outExpo(lt / 0.2);
    const x = lerp(o.from[0], cx, k), y = lerp(o.from[1], cy, k);
    const h = lerp(0.1 * U, d, k) * (1 + (red ? 0 : 0.08 * Math.sin(Math.min(1, lt / 0.3) * Math.PI)));
    const ang = -0.12 * k;
    face(f, x, y, h, ang, { gray: 0.35 * k, alpha: 1 - out });
    const xs = Math.max(0.25 * faceW(f, h), 0.17 * h);
    [[f.eyeL, 0.4], [f.eyeR, 0.56]].forEach(([eye, at]) => {
      const sk = (lt - at) / 0.12;
      if (sk <= 0) return;
      const p = mark(f, eye, x, y, h, ang);
      prop(P.xeye, p[0], p[1], xs * (1 + 1.3 * (1 - outCubic(sk))), ang, Math.min(1, sk * 2) * (1 - out));
    });
    const ct = lt - 0.7;
    if (ct > 0) {
      const pop = outBack(ct / 0.25, 2), bob = red ? 0 : Math.abs(Math.sin(ct * 14)) * 0.03 * U;
      const lx = Math.max(0.2 * U, W * 0.16), ly = H * 0.78 - bob;
      face(o.catcher, lx, ly, 0.34 * U * pop, -0.15 + (red ? 0 : 0.12 * Math.sin(ct * 18)), { alpha: 1 - out });
      emoji("😂", lx + 0.18 * U, ly - 0.17 * U, 0.12 * U * pop, 0.2);
    }
    for (let i = 0; i < 7; i++) {
      const st = lt - 0.5 - i * 0.09;
      if (st < 0) continue;
      emoji("💀", ((i * 0.37 + 0.08) % 1) * W, -0.1 * H + st * st * H * 1.6 + st * 0.3 * H, 0.1 * U, (i % 2 ? 1 : -1) * st * 3);
    }
  }

  function sounds(o) {
    if (hold !== null) return;
    if (o.kind === "sweep") {
      cue("in", 0, () => play("whoosh", true, 0.8));
      cue("slam", SLAM, () => { play("vine", 1); play("airhorn", 0.9); });
      cue("prize", PRIZE + 0.35, () => play("cardGrab"));
    } else if (o.kind === "clear") {
      cue("in", 0, () => play("vine", 0.5));
    } else if (o.kind === "joker") {
      cue("in", 0, () => play("scratch", 0.9));
      cue("flip", FLIP, () => play("vine", 0.6));
      cue("hit", FLIP + 0.23, () => play("thunk"));
    } else {
      cue("in", 0, () => { play("vine", 1); play("whoosh", true, 0.7); });
      cue("x1", 0.4, () => play("thunk"));
      cue("x2", 0.56, () => play("thunk"));
      cue("bone", 0.62, () => play("trombone"));
    }
  }
  function captions(o) {
    if (o.kind === "sweep") {
      cue("capTop", SLAM, () => setCap(capTop, o.top, CAP_STYLE.sweep.top));
      cue("capBottom", SLAM + 0.35, () => setCap(capBottom, o.bottom, CAP_STYLE.sweep.bottom));
      cue("capPrize", PRIZE + 0.35, () => setCap(capBottom, o.bottomPrize, CAP_STYLE.sweep.bottom));
    } else if (o.kind === "joker") {
      cue("capTop", FLIP + 0.12, () => setCap(capTop, o.top, CAP_STYLE.joker.top));
      cue("capBottom", FLIP + 0.2, () => setCap(capBottom, o.bottom, CAP_STYLE.joker.bottom));
    } else if (o.kind === "bust") {
      cue("capBottom", 0.62, () => setCap(capBottom, o.bottom, CAP_STYLE.bust.bottom));
    }
    if ((hold !== null ? hold : o.t) >= o.dur - OUT && !o.cues.capsOut) { o.cues.capsOut = true; setCap(capTop, null); setCap(capBottom, null); }
  }

  function draw() {
    if (!cur) {
      if (shown) { shown = false; canvas.hidden = true; c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, canvas.width, canvas.height); }
      return;
    }
    size();
    if (!shown) { shown = true; canvas.hidden = false; }
    const o = cur, lt = hold !== null ? hold : o.t, red = rm();
    sounds(o);
    captions(o);
    const U = Math.min(W, H * 0.62), cx = W / 2, cy = H * 0.47;
    const inK = clamp01(lt / 0.16), out = clamp01((lt - (o.dur - OUT)) / OUT);
    const shake = red ? 0 : U * (o.kind === "sweep" ? 0.06 * decay(lt - SLAM, 0.28) : o.kind === "bust" ? 0.045 * decay(lt - 0.18, 0.25) + 0.02 * decay(lt - 0.4, 0.08) + 0.02 * decay(lt - 0.56, 0.08) : o.kind === "joker" ? 0.03 * decay(lt - FLIP, 0.15) : 0);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    c.save();
    // in: the rays open as a circle from where it happened; out: the sweep zooms through, the rest fade
    const opening = () => { c.save(); c.beginPath(); c.arc(o.from[0], o.from[1], Math.hypot(W, H) * outCubic(inK) + 1, 0, TAU); c.clip(); };
    c.globalAlpha = o.kind === "sweep" || o.kind === "clear" ? 1 - out : 1;
    if (o.kind === "sweep" && !red) { const z = 1 + 0.35 * inQuad(out); c.translate(cx, cy); c.scale(z, z); c.translate(-cx, -cy); }
    c.translate(Math.sin(lt * 91) * shake, Math.cos(lt * 77) * shake);
    if (o.kind === "sweep") {
      opening(); drawSweep(o, lt, U, cx, cy); c.restore();
    } else if (o.kind === "clear") {
      opening(); c.globalAlpha *= 0.9; rays(cx, H * 0.3, lt * (red ? 0.3 : 0.8), 16, o.rays[0], o.rays[1]); c.restore();
      drawClear(o, lt, U, cx);
    } else if (o.kind === "joker") {
      opening(); c.globalAlpha = 1 - out; rays(cx, cy, lt * (red ? 0.5 : 1.3), 16, "#E9C46A", "#5a1a2a"); c.restore();
      drawJoker(o, lt, U, cx, cy);
    } else {
      opening(); c.globalAlpha *= 0.88 * (1 - out); rays(cx, cy, lt * 0.4, 14, "#4a0f0f", "#140606"); c.restore();
      drawBust(o, lt, U, cx, cy);
    }
    c.restore();
    // the white flash on the slam and the flip
    const fl = o.kind === "sweep" ? decay(lt - SLAM, 0.1) * (lt >= SLAM ? 1 : 0) : o.kind === "joker" ? 0.5 * decay(lt - FLIP, 0.08) * (lt >= FLIP ? 1 : 0) : 0;
    if (fl > 0.01) { c.fillStyle = `rgba(255,255,255,${fl.toFixed(3)})`; c.fillRect(0, 0, W, H); }
  }
  // how grey the table under a moment should be (the fx layer's grey; the bust greys the whole table)
  function gray() {
    if (!cur || cur.kind !== "bust") return 0;
    const lt = hold !== null ? hold : cur.t, out = clamp01((lt - (cur.dur - OUT)) / OUT);
    return 0.75 * clamp01(lt / 0.12) * (1 - out);
  }

  return {
    // you, others (4 faces), from (screen), toHead (screen), prize, top, bottom, bottomPrize
    sweep: (o, done) => start("sweep", o, done),
    // you, rays [c1, c2], from (screen)
    clear: (o, done) => start("clear", o, done),
    // you, catcher, from (screen), top, bottom
    joker: (o, done) => start("joker", o, done),
    // you, catcher, from (screen), bottom
    bust: (o, done) => start("bust", o, done),
    active: () => !!cur,
    holding: () => !!cur && HOLDS[cur.kind],
    kind: () => (cur ? cur.kind : null),
    cancel() { cur = null; hold = null; setCap(capTop, null); setCap(capBottom, null); draw(); }, // a new game: done() never runs
    tick, draw, gray,
    hold(t) { hold = t; }, // tests and ?rotshow: hold the moment at t s
  };
}
