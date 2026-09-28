// Potion Pour reference renderer (THE-106, Game Designer). Draws the vial, the potion layers with their runes, the
// shelf, the pour stream, the landing ripple, the cork + rune tag of a finished vial, and Glub (the hero). Used by
// the style tile and the mockups; the developer may copy it into the game (it reads tokens only, no hard-coded
// palette). Classic script: exposes window.PotionRender. All sizes are in multiples of the vial width W.
(function (root) {
  'use strict';
  let T = null;
  function tokens() {
    if (T) return T;
    const css = getComputedStyle(document.documentElement);
    const s = (n) => css.getPropertyValue(n).trim();
    const f = (n) => parseFloat(s(n));
    T = {
      ink: s('--color-outline'), cream: s('--color-surface'), cream2: s('--color-surface-2'), gold: s('--color-accent'),
      goldDeep: s('--color-accent-deep'), danger: s('--color-danger'), wood: s('--color-wood'), woodDark: s('--color-wood-dark'),
      cork: s('--color-cork'), glass: s('--color-glass'), shine: s('--color-glass-shine'), rune: s('--color-rune'),
      mint: s('--color-primary'),
      potions: Array.from({ length: 12 }, (_, i) => s(`--color-potion-${i + 1}`)),
      layerH: f('--vial-layer-h'), headroom: f('--vial-headroom'), lip: f('--vial-lip'), keyline: f('--vial-keyline'),
      glassA: f('--glass-alpha'), shineA: f('--shine-alpha'), hi: f('--potion-hi'), lo: f('--potion-lo'),
      runeSize: f('--rune-size'), meniscus: f('--meniscus'), shelfH: f('--shelf-h'), lift: f('--lift'),
    };
    return T;
  }

  // ---------- colour helpers (mix in sRGB, good enough for shading) ----------
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => { const A = hex(a), B = hex(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`; };
  const potionHi = (c) => mix(c, '#FFFFFF', tokens().hi);
  const potionLo = (c) => mix(c, tokens().ink, tokens().lo);
  const potionDeep = (c) => mix(c, tokens().ink, tokens().lo * 2.4);

  // ---------- geometry ----------
  // Full vial height (lip to the bottom of the round), in W.
  const vialH = () => { const t = tokens(); return 4 * t.layerH + t.headroom + t.lip; };

  // The glass silhouette: a test tube with a round bottom, straight sides and a flared lip. Origin = bottom centre.
  function tubePath(ctx, W) {
    const H = vialH() * W, r = W / 2;
    ctx.beginPath();
    ctx.moveTo(-r, -H);
    ctx.lineTo(-r, -r);
    ctx.arc(0, -r, r, Math.PI, 0, true);
    ctx.lineTo(r, -H);
  }

  // ---------- runes: unit shapes in a box of -1..1 ----------
  const RUNES = {
    sun(c) { c.moveTo(0.45, 0); c.arc(0, 0, 0.45, 0, Math.PI * 2); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; c.moveTo(Math.cos(a) * 0.62, Math.sin(a) * 0.62); c.lineTo(Math.cos(a) * 0.95, Math.sin(a) * 0.95); } },
    drop(c) { c.moveTo(0, -0.95); c.bezierCurveTo(0.35, -0.4, 0.7, 0, 0.7, 0.3); c.arc(0, 0.3, 0.7, 0, Math.PI); c.bezierCurveTo(-0.7, 0, -0.35, -0.4, 0, -0.95); },
    heart(c) { c.moveTo(0, 0.9); c.bezierCurveTo(-1.1, 0.1, -0.85, -0.95, 0, -0.45); c.bezierCurveTo(0.85, -0.95, 1.1, 0.1, 0, 0.9); },
    moon(c) { c.arc(0, 0, 0.9, 0.55 * Math.PI, 1.95 * Math.PI, false); c.arc(0.3, -0.25, 0.68, 1.85 * Math.PI, 0.65 * Math.PI, true); c.closePath(); },
    flower(c) { for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / 5; const x = Math.cos(a) * 0.5, y = Math.sin(a) * 0.5; c.moveTo(x + 0.42, y); c.arc(x, y, 0.42, 0, Math.PI * 2); } },
    star(c) { for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.42 : 1; i ? c.lineTo(Math.cos(a) * r, Math.sin(a) * r) : c.moveTo(Math.cos(a) * r, Math.sin(a) * r); } c.closePath(); },
    leaf(c) { c.moveTo(-0.75, 0.75); c.bezierCurveTo(-0.9, -0.3, -0.1, -0.95, 0.85, -0.85); c.bezierCurveTo(0.9, 0.1, 0.2, 0.9, -0.75, 0.75); },
    snowflake(c) { for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; c.moveTo(0, 0); c.lineTo(Math.cos(a) * 0.95, Math.sin(a) * 0.95); } },
    wave(c) { for (const y of [-0.35, 0.35]) { c.moveTo(-0.95, y); c.bezierCurveTo(-0.55, y - 0.45, -0.35, y + 0.45, 0, y); c.bezierCurveTo(0.35, y - 0.45, 0.55, y + 0.45, 0.95, y); } },
    acorn(c) { c.moveTo(-0.75, -0.2); c.bezierCurveTo(-0.75, -0.8, 0.75, -0.8, 0.75, -0.2); c.closePath(); c.moveTo(-0.6, -0.15); c.bezierCurveTo(-0.6, 0.55, -0.2, 0.9, 0, 0.95); c.bezierCurveTo(0.2, 0.9, 0.6, 0.55, 0.6, -0.15); c.closePath(); c.moveTo(0, -0.62); c.lineTo(0.08, -0.95); },
    clover(c) { for (const [x, y] of [[0, -0.45], [-0.45, 0.02], [0.45, 0.02]]) { c.moveTo(x + 0.4, y); c.arc(x, y, 0.4, 0, Math.PI * 2); } c.moveTo(0, 0.1); c.lineTo(0.15, 0.95); },
    cloud(c) { c.moveTo(-0.85, 0.45); c.arc(-0.5, 0.1, 0.38, Math.PI * 0.6, Math.PI * 1.5); c.arc(0.02, -0.2, 0.5, Math.PI * 1.1, Math.PI * 1.95); c.arc(0.55, 0.12, 0.36, Math.PI * 1.5, Math.PI * 0.45); c.closePath(); },
  };
  const RUNE_ORDER = ['sun', 'drop', 'heart', 'moon', 'flower', 'star', 'leaf', 'snowflake', 'wave', 'acorn', 'clover', 'cloud'];
  const STROKE_RUNES = { sun: 1, snowflake: 1, wave: 1, clover: 0 };

  function drawRune(ctx, idx, cx, cy, size, fill, stroke) {
    const name = RUNE_ORDER[idx];
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(size / 2, size / 2);
    ctx.beginPath();
    RUNES[name](ctx);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (STROKE_RUNES[name]) {
      ctx.lineWidth = 0.62; ctx.strokeStyle = stroke; ctx.stroke();
      ctx.lineWidth = 0.3; ctx.strokeStyle = fill; ctx.stroke();
      if (name === 'sun') { ctx.beginPath(); ctx.arc(0, 0, 0.42, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); }
    } else {
      ctx.lineWidth = 0.34; ctx.strokeStyle = stroke; ctx.stroke();
      ctx.fillStyle = fill; ctx.fill();
    }
    ctx.restore();
  }

  // ---------- the vial ----------
  // layers: array of potion indexes (0-based), bottom first; up to 4. opts: { lift (0..1 of --lift), tilt (deg,
  // + = pour to the right), glow, hint, cork, tag, nope, slosh (0..1 phase), drain (0..1 of the top run leaving),
  // fill {idx, amount} (0..1 of the incoming run in the target), ghost }
  function drawVial(ctx, x, y, W, layers, opts = {}) {
    const t = tokens();
    const H = vialH() * W, r = W / 2, kl = Math.max(2.5, t.keyline * W), L = t.layerH * W;
    ctx.save();
    ctx.translate(x, y - (opts.lift || 0) * t.lift * H);
    if (opts.tilt) { ctx.translate(0, -H * 0.5); ctx.rotate(opts.tilt * Math.PI / 180); ctx.translate(0, H * 0.5); }
    if (opts.ghost) { // the spot a lifted vial left on the shelf: a dashed outline
      tubePath(ctx, W); ctx.setLineDash([W * 0.16, W * 0.12]); ctx.lineWidth = kl * 0.8; ctx.globalAlpha = 0.35;
      ctx.strokeStyle = t.ink; ctx.stroke(); ctx.restore(); return;
    }

    // glow ring behind a lifted / hinted vial
    if (opts.glow || opts.hint) {
      ctx.save();
      tubePath(ctx, W);
      ctx.lineWidth = kl + W * 0.28; ctx.strokeStyle = opts.hint ? mix(t.gold, '#FFFFFF', 0.35) : t.gold;
      ctx.globalAlpha *= opts.hint ? 0.75 : 0.9; ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.restore();
    }
    // hard ink shadow (sticker), offset down-right
    ctx.save(); ctx.translate(W * 0.07, W * 0.07); tubePath(ctx, W); ctx.lineTo(r, -H); ctx.closePath();
    ctx.fillStyle = t.ink; ctx.fill(); ctx.restore();
    // glass back
    tubePath(ctx, W); ctx.closePath();
    ctx.fillStyle = t.cream; ctx.fill();
    ctx.save(); ctx.globalAlpha *= t.glassA; ctx.fillStyle = t.glass; ctx.fill(); ctx.restore();

    // liquid, clipped to the inside of the glass. In a tilted vial the potion stays level with the world: the layers
    // become horizontal bands stacked from the glass's lowest point, each band as thick as its volume needs there.
    const list = layers.slice();
    const drain = opts.drain || 0;
    const topRun = runLength(list);
    const vols = list.map((_, i) => (i >= list.length - topRun ? L * (1 - drain) : L));
    if (opts.fill) { list.push(opts.fill.idx); vols.push(L * opts.fill.amount * (opts.fill.layers || 1)); }
    const th = (opts.tilt || 0) * Math.PI / 180;
    const glassTone = mix(t.cream, t.glass, t.glassA);
    ctx.save();
    tubePath(ctx, W); ctx.closePath(); ctx.clip();
    let scale = 1, axisX = () => 0;
    if (th) {
      const c = Math.cos(th), s = Math.abs(Math.sin(th)), tn = Math.tan(th);
      // the glass's lowest point below the pivot (the vial's middle): the round bottom, or past 90° the lip corner
      const base = Math.max((H / 2 - r) * c + r, r * s - (H / 2) * c);
      ctx.translate(0, -H / 2); ctx.rotate(-th); ctx.translate(0, base); // world axes, origin = lowest point
      // the tube is wider across when tilted, so each band is thinner; clamped so a tilted layer still reads and
      // shows its rune (a stylisation: the potion bunches toward the lip, as in the genre's originals)
      scale = Math.max(0.6, W / Math.min(W / Math.max(0.2, Math.abs(c)), (H - r) / Math.max(0.2, s)));
      axisX = (yy) => -(yy + base) * tn;
    }
    const x0 = th ? -H * 2 : -r - 2, wFill = th ? H * 4 : W + 4;
    let top = 0;
    for (let i = 0; i < list.length; i++) {
      const h = vols[i] * scale; if (h <= 0.5) continue;
      const c = t.potions[list[i]];
      const y0 = -top, y1 = -top - h;
      const g = ctx.createLinearGradient(0, y1, 0, y0);
      g.addColorStop(0, potionHi(c)); g.addColorStop(0.55, c); g.addColorStop(1, potionLo(c));
      ctx.fillStyle = g;
      ctx.fillRect(x0, y1 - (i === list.length - 1 ? t.meniscus * W : 1), wFill, h + 1 + t.meniscus * W + (i === 0 ? W : 0));
      // seam: a thin light line between two layers, so layers can be counted
      if (i > 0) { ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillRect(x0, y0 - 1, wFill, 1.6); }
      // one rune per layer (a merged run shows one per layer); none on a partial layer under half height
      const n = Math.max(1, Math.round(vols[i] / L));
      if (vols[i] > L * 0.5) for (let k = 0; k < n; k++) {
        const cy = y0 - (h / n) * (k + 0.5) + (i === 0 && k === 0 && !th ? -W * 0.05 : 0);
        drawRune(ctx, list[i], axisX(cy), cy, Math.min(W * t.runeSize, Math.max((h / n) * 0.68, W * 0.3)), t.rune, potionDeep(c));
      }
      top += h;
    }
    // the top surface: a meniscus (a smile) upright, a flat bright line when tilted; plus slosh and the landing ripple
    if (top > 1) {
      const c = t.potions[list[list.length - 1]];
      const sy = -top, m = th ? 0 : t.meniscus * W;
      const wave = opts.slosh ? Math.sin(opts.slosh * Math.PI * 6) * (1 - opts.slosh) * W * 0.12 : 0;
      const curve = () => { ctx.moveTo(x0, sy - m); ctx.lineTo(-r, sy - m); ctx.bezierCurveTo(-r * 0.4, sy + m * 0.6 + wave, r * 0.4, sy + m * 0.6 - wave, r, sy - m); ctx.lineTo(x0 + wFill, sy - m); };
      ctx.beginPath(); curve(); ctx.lineTo(x0 + wFill, sy - m - W); ctx.lineTo(x0, sy - m - W); ctx.closePath();
      ctx.fillStyle = glassTone; ctx.fill(); // the glass above the curved surface
      ctx.beginPath(); curve();
      ctx.lineWidth = Math.max(1.5, W * 0.05); ctx.strokeStyle = potionHi(potionHi(c)); ctx.stroke();
      if (opts.slosh && opts.slosh < 0.8) {
        ctx.save(); ctx.globalAlpha = 0.8 * (1 - opts.slosh / 0.8);
        ctx.beginPath(); ctx.ellipse(0, sy, W * (0.12 + 0.4 * opts.slosh), W * (0.04 + 0.08 * opts.slosh), 0, 0, Math.PI * 2);
        ctx.lineWidth = 2; ctx.strokeStyle = '#FFFFFF'; ctx.stroke(); ctx.restore();
      }
    }
    ctx.restore();

    // shine stripe + dot
    ctx.save(); ctx.globalAlpha *= t.shineA; ctx.fillStyle = t.shine;
    roundRect(ctx, -r + W * 0.14, -H + W * 0.36, W * 0.13, H * 0.55, W * 0.065); ctx.fill();
    ctx.beginPath(); ctx.arc(-r + W * 0.205, -H * 0.3 + W * 0.2, W * 0.065, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // keyline (danger keyline while saying "nope")
    tubePath(ctx, W);
    ctx.lineWidth = kl * (opts.nope ? 1.4 : 1); ctx.strokeStyle = opts.nope ? t.danger : t.ink; ctx.lineJoin = 'round'; ctx.stroke();
    // lip ring
    roundRect(ctx, -r - kl * 0.9, -H - t.lip * W * 0.5, W + kl * 1.8, t.lip * W, t.lip * W * 0.5);
    ctx.fillStyle = t.cream; ctx.fill(); ctx.lineWidth = kl * 0.9; ctx.strokeStyle = opts.nope ? t.danger : t.ink; ctx.stroke();
    // cork + rune tag on a finished vial
    if (opts.cork) drawCork(ctx, W, H, opts.cork === true ? 1 : opts.cork);
    if (opts.tag != null) drawTag(ctx, W, H, opts.tag);
    if (opts.tag != null && opts.shimmer != null) drawTagShimmer(ctx, W, H, opts.shimmer);
    ctx.restore();
  }

  function runLength(list) { let n = 0; for (let i = list.length - 1; i >= 0 && list[i] === list[list.length - 1]; i--) n++; return n; }

  function drawCork(ctx, W, H, k) {
    const t = tokens(), kl = Math.max(2.5, t.keyline * W);
    const drop = (1 - k) * W * 1.2;
    ctx.save(); ctx.translate(0, -H - drop);
    ctx.beginPath();
    ctx.moveTo(-W * 0.36, 0); ctx.lineTo(-W * 0.44, -W * 0.42); ctx.quadraticCurveTo(0, -W * 0.56, W * 0.44, -W * 0.42); ctx.lineTo(W * 0.36, 0); ctx.closePath();
    ctx.fillStyle = t.cork; ctx.fill(); ctx.lineWidth = kl * 0.85; ctx.strokeStyle = t.ink; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.fillStyle = mix(t.cork, t.ink, 0.35);
    for (const [px, py] of [[-0.15, -0.2], [0.14, -0.28], [0.05, -0.12]]) { ctx.beginPath(); ctx.arc(px * W, py * W, W * 0.035, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }

  // The gold-rimmed round rune tag stuck on a finished vial (the signature sticker).
  function drawTag(ctx, W, H, idx) {
    const t = tokens(), kl = Math.max(2, t.keyline * W * 0.8);
    const cy = -H * 0.5, R = W * 0.36;
    ctx.save(); ctx.translate(0, cy); ctx.rotate(-0.12);
    ctx.beginPath(); ctx.arc(W * 0.05, W * 0.05, R, 0, Math.PI * 2); ctx.fillStyle = t.ink; ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fillStyle = t.cream; ctx.fill();
    ctx.lineWidth = kl * 1.4; ctx.strokeStyle = t.goldDeep; ctx.stroke();
    ctx.lineWidth = kl * 0.6; ctx.strokeStyle = t.ink; ctx.beginPath(); ctx.arc(0, 0, R + kl * 0.9, 0, Math.PI * 2); ctx.stroke();
    drawRune(ctx, idx, 0, 0, R * 1.25, t.potions[idx], potionDeep(t.potions[idx]));
    ctx.restore();
  }

  // The loop-case dead end's badge (design brief §6): "if the solver found the loop case (pours exist but none
  // leads anywhere), one circular-arrow badge floats over the cabinet instead" of the per-vial dashed-ring/
  // bubble/ghost-rune reveal. Same gold-rimmed round tag styling as drawTag, with a circular-arrow rune in the
  // middle instead of a potion rune. alpha fades the badge in as it appears.
  function drawLoopBadge(ctx, cx, cy, R, alpha) {
    const t = tokens(), kl = Math.max(2, t.keyline * R * 1.6);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.globalAlpha = alpha * 0.35;
    ctx.beginPath(); ctx.arc(R * 0.08, R * 0.1, R, 0, Math.PI * 2); ctx.fillStyle = t.ink; ctx.fill();
    ctx.globalAlpha = alpha;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fillStyle = t.cream; ctx.fill();
    ctx.lineWidth = kl * 1.4; ctx.strokeStyle = t.goldDeep; ctx.stroke();
    ctx.lineWidth = kl * 0.6; ctx.strokeStyle = t.ink;
    ctx.beginPath(); ctx.arc(0, 0, R + kl * 0.9, 0, Math.PI * 2); ctx.stroke();

    // the circular-arrow rune itself: an open ring with an arrowhead at one end.
    const r = R * 0.48, start = -Math.PI * 0.6, end = Math.PI * 0.55;
    ctx.lineCap = 'round';
    ctx.strokeStyle = t.ink;
    ctx.fillStyle = t.ink;
    ctx.lineWidth = Math.max(1.5, r * 0.26);
    ctx.beginPath(); ctx.arc(0, 0, r, start, end); ctx.stroke();
    const tipAngle = end + Math.PI / 2, tipX = Math.cos(end) * r, tipY = Math.sin(end) * r, headLen = r * 0.7;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - headLen * Math.cos(tipAngle - Math.PI / 6), tipY - headLen * Math.sin(tipAngle - Math.PI / 6));
    ctx.lineTo(tipX - headLen * Math.cos(tipAngle + Math.PI / 6), tipY - headLen * Math.sin(tipAngle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Level clear: a gold sparkle that blooms and fades over a finished vial's tag as the wave passes over it
  // (k = 0..1 of --clear-shimmer-dur; DESIGN.md §16 item 10, "the tags shimmer in a wave").
  function drawTagShimmer(ctx, W, H, k) {
    const p = Math.min(1, Math.max(0, k));
    const env = Math.sin(p * Math.PI);
    if (env <= 0.02) return;
    ctx.save();
    ctx.globalAlpha = env;
    drawSparkle(ctx, 0, -H * 0.5, W * (0.3 + 0.34 * env));
    ctx.restore();
  }

  // ---------- pour stream: from the source lip to the target surface ----------
  // A fat ribbon with a narrowing neck, a highlight line and 3 bubbles riding down it; wobble = 0..1 phase.
  function drawStream(ctx, x0, y0, x1, y1, W, idx, wobble = 0) {
    const t = tokens(), c = t.potions[idx];
    const w = W * 0.2;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x0, y0);
    ctx.bezierCurveTo(x0 + (x1 - x0) * 0.7, y0 - W * 0.08, x1 + Math.sin(wobble * 6.28) * W * 0.03, y0 + (y1 - y0) * 0.35, x1, y1);
    ctx.lineWidth = w + Math.max(2.5, t.keyline * W) * 1.6; ctx.strokeStyle = t.ink; ctx.stroke();
    ctx.lineWidth = w; ctx.strokeStyle = c; ctx.stroke();
    ctx.lineWidth = w * 0.28; ctx.strokeStyle = potionHi(potionHi(c)); ctx.globalAlpha = 0.8;
    ctx.beginPath(); ctx.moveTo(x1 - w * 0.2, y0 + (y1 - y0) * 0.25); ctx.lineTo(x1 - w * 0.2, y1 - W * 0.2); ctx.stroke();
    ctx.globalAlpha = 1;
    for (let i = 0; i < 3; i++) {
      const k = (wobble + i / 3) % 1;
      ctx.beginPath(); ctx.arc(x1 + w * 0.1, y0 + (y1 - y0) * (0.3 + 0.65 * k), w * 0.16, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fill();
    }
    ctx.restore();
  }

  // Splash drops + bubbles popping out of a finished vial's mouth (k = 0..1 of --pop-dur).
  function drawPop(ctx, x, yTop, W, idx, k) {
    const t = tokens(), c = t.potions[idx];
    for (let i = 0; i < 8; i++) {
      const a = -Math.PI / 2 + (i - 3.5) * 0.32, d = W * (0.3 + 1.3 * k) * (0.7 + (i % 3) * 0.2);
      const px = x + Math.cos(a) * d, py = yTop + Math.sin(a) * d + k * k * W * 0.6;
      const rr = W * (0.11 - 0.05 * (i % 2)) * (1 - k * 0.5);
      ctx.beginPath(); ctx.arc(px, py, rr, 0, Math.PI * 2);
      ctx.fillStyle = i % 2 ? t.gold : potionHi(c); ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = t.ink; ctx.stroke();
    }
  }

  // 4-point sparkle (hint, shimmer, celebrations)
  function drawSparkle(ctx, x, y, s, color) {
    const t = tokens();
    ctx.save(); ctx.translate(x, y);
    ctx.beginPath();
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, r = i % 2 ? s * 0.28 : s; i ? ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.moveTo(r, 0); }
    ctx.closePath(); ctx.fillStyle = color || t.gold; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = t.ink; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.restore();
  }

  // ---------- the shelf: a honey plank with a front edge and two brackets ----------
  function drawShelf(ctx, x0, x1, y, W) {
    const t = tokens(), h = t.shelfH * W, kl = Math.max(2.5, t.keyline * W);
    ctx.save();
    ctx.fillStyle = t.ink; roundRect(ctx, x0 + 4, y + 4, x1 - x0, h * 1.7, 6); ctx.fill();
    ctx.fillStyle = t.wood; roundRect(ctx, x0, y, x1 - x0, h * 0.7, 6); ctx.fill();
    ctx.fillStyle = t.woodDark; roundRect(ctx, x0, y + h * 0.6, x1 - x0, h * 1.1, 6); ctx.fill();
    ctx.lineWidth = kl; ctx.strokeStyle = t.ink; roundRect(ctx, x0, y, x1 - x0, h * 1.7, 6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x0 + 4, y + h * 0.65); ctx.lineTo(x1 - 4, y + h * 0.65); ctx.lineWidth = kl * 0.6; ctx.stroke();
    ctx.restore();
  }

  // ---------- Glub: the hero, a round potion drop with a face (theme image slot: images.hero) ----------
  // mood: 'happy' | 'cheer' | 'think' | 'oops'
  function drawGlub(ctx, x, y, R, mood = 'happy', color) {
    const t = tokens(), c = color || t.potions[1], kl = Math.max(2.5, R * 0.1);
    ctx.save(); ctx.translate(x, y);
    const body = () => { ctx.beginPath(); ctx.moveTo(0, -R * 1.35); ctx.bezierCurveTo(R * 0.45, -R * 0.75, R, -R * 0.45, R, R * 0.1); ctx.arc(0, R * 0.1, R, 0, Math.PI); ctx.bezierCurveTo(-R, -R * 0.45, -R * 0.45, -R * 0.75, 0, -R * 1.35); ctx.closePath(); };
    ctx.save(); ctx.translate(R * 0.12, R * 0.12); body(); ctx.fillStyle = t.ink; ctx.fill(); ctx.restore();
    body(); const g = ctx.createLinearGradient(0, -R * 1.3, 0, R * 1.1); g.addColorStop(0, potionHi(c)); g.addColorStop(1, potionLo(c)); ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = kl; ctx.strokeStyle = t.ink; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.beginPath(); ctx.ellipse(-R * 0.5, -R * 0.35, R * 0.13, R * 0.28, 0.4, 0, Math.PI * 2); ctx.fill();
    // eyes
    ctx.fillStyle = t.ink;
    const ey = R * 0.02, ex = R * 0.36;
    if (mood === 'cheer') { ctx.lineWidth = kl * 0.9; ctx.lineCap = 'round'; for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(s * ex, ey + R * 0.08, R * 0.16, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); } }
    else { for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(s * ex, ey, R * 0.12, R * 0.17, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.arc(s * ex + R * 0.04, ey - R * 0.06, R * 0.05, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = t.ink; } }
    // cheeks
    ctx.fillStyle = 'rgba(255,120,150,0.45)'; for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(s * R * 0.62, R * 0.3, R * 0.16, R * 0.1, 0, 0, Math.PI * 2); ctx.fill(); }
    // mouth
    ctx.lineWidth = kl * 0.85; ctx.lineCap = 'round'; ctx.strokeStyle = t.ink; ctx.beginPath();
    if (mood === 'cheer') { ctx.moveTo(-R * 0.25, R * 0.3); ctx.quadraticCurveTo(0, R * 0.75, R * 0.25, R * 0.3); ctx.closePath(); ctx.fillStyle = t.ink; ctx.fill(); }
    else if (mood === 'think') { ctx.moveTo(-R * 0.2, R * 0.36); ctx.quadraticCurveTo(R * 0.02, R * 0.52, R * 0.22, R * 0.3); ctx.stroke(); } // lopsided, curious smile (never sad)
    else if (mood === 'oops') { ctx.ellipse(0, R * 0.42, R * 0.1, R * 0.13, 0, 0, Math.PI * 2); ctx.fillStyle = t.ink; ctx.fill(); }
    else { ctx.arc(0, R * 0.28, R * 0.2, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke(); }
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // ---------- shelf layout (DESIGN.md §4): the biggest vial width that fits n vials in the free rectangle ----------
  // area = { x, y, w, h } after the HUD has been reserved. Returns { W, rows: [{ y, xs: [...] }] }, y = shelf top.
  function layout(n, area, opts = {}) {
    const t = tokens();
    const gap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--vial-gap'));
    const wMax = opts.wMax || 72, vh = vialH();
    let best = null;
    for (let r = 1; r <= 4; r++) {
      const per = Math.ceil(n / r);
      const W = Math.min(area.w / (per + (per - 1) * gap), area.h / (r * (vh + t.shelfH * 1.7 + 0.25) + t.lift * vh), wMax);
      if (!best || W > best.W + 0.01) best = { W, r, per };
    }
    const { W, r } = best;
    const rowH = W * (vh + t.shelfH * 1.7 + 0.25);
    const top = area.y + (area.h - (r * rowH + t.lift * vh * W)) / 2 + t.lift * vh * W;
    const rows = [];
    let left = n;
    for (let i = 0; i < r; i++) {
      const k = Math.ceil(left / (r - i)); left -= k;
      const span = k * W + (k - 1) * gap * W;
      const x0 = area.x + (area.w - span) / 2 + W / 2;
      rows.push({ y: top + (i + 1) * rowH - W * (t.shelfH * 1.7 + 0.25), xs: Array.from({ length: k }, (_, j) => x0 + j * W * (1 + gap)) });
    }
    return { W, rows, gap };
  }

  root.PotionRender = { tokens, vialH, drawVial, drawRune, drawStream, drawPop, drawSparkle, drawShelf, drawGlub, drawTag, drawLoopBadge, drawCork, roundRect, layout, mix, RUNE_ORDER };
})(typeof window !== 'undefined' ? window : globalThis);
