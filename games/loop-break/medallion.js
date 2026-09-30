// Loop Break medallion: the reference renderer for the drawing recipe (THE-231, DESIGN.md §6).
// Designer-owned reference, token-driven, no dependencies. A classic script: window.LBMedallion.
// The developer may port it into render.js as-is. It is written to the pre-render split the design doc asks for:
//   static per level + size + skin  -> bg sprite (contact shadow, bezel, plate, perlage), hub sprite, sheen sprite,
//                                      per-ring MATERIAL sprite (lobes + brushing; fixed to the lamp, never rotated),
//                                      per-ring FEATURES sprite (ticks, teeth, bevels, inlay; rotated with the ring),
//                                      per-ring lume sprites (lit slot segment, small glow and burst glow)
//   per frame                        -> clip + blit material, rotate + blit features, slot fill, links (claw/pinion,
//                                      lift), chevrons, selection, index, keyway + bolt, batons, sheen blit.
// Angles: degrees clockwise from 12 o'clock; a ring's angle = pos * 45 + the live drag offset. 0 = gap under the index.
(function (root) {
  'use strict';
  const TAU = Math.PI * 2, D = Math.PI / 180;
  const rad = (deg) => (deg - 90) * D;
  const clamp = (lo, v, hi) => Math.max(lo, Math.min(hi, v));

  const NAMES = ['ring-spec', 'ring-hi', 'ring-light', 'ring-lift', 'ring-base', 'ring-mid', 'ring-deep', 'ring-shade',
    'ring-inlay', 'inlay-w', 'tick', 'bevel', 'brush-a', 'dead-spec', 'dead-light', 'dead-mid', 'dead-deep', 'dead-shade',
    'blue-hi', 'blue', 'blue-deep', 'rhodium-hi', 'rhodium', 'rhodium-lo', 'rhodium-shade', 'enamel-hi', 'enamel',
    'enamel-shade', 'lume', 'lume-glow', 'lume-deep', 'lume-off', 'ruby-hi', 'ruby', 'ruby-deep', 'plate', 'perlage',
    'slot', 'keyway', 'shadow', 'contact', 'lamp', 'ink', 'engrave-hi'];

  function readTokens(el) {
    const cs = getComputedStyle(el || document.documentElement);
    const t = {};
    for (const k of NAMES) t[k] = cs.getPropertyValue('--lb-' + k).trim();
    t.inlayW = parseFloat(t['inlay-w']) || 0;
    t.brushA = parseFloat(t['brush-a']) || 0.07;
    t.fontDisplay = cs.getPropertyValue('--font-display').trim() || 'system-ui, sans-serif';
    t.fontNumeral = cs.getPropertyValue('--font-numeral').trim() || 'Georgia, serif';
    return t;
  }

  // ---- geometry: every number is a fraction of R (the medallion radius; 171.5 px on a 390 px phone) ----
  function geometry(R, n) {
    const bw = 0.17 * R;                    // bezel width: 29 px
    const rIn = R - bw;                     // 142 px: inner edge of the bezel = outer edge of ring 1
    const rHub = 0.23 * R;                  // 39 px
    const band = (rIn - rHub) / n;          // 34 / 26 / 21 / 17 px at 3 / 4 / 5 / 6 rings
    const groove = Math.max(1.5, 0.013 * R);// 2.2 px of plate between rings
    const slotW = 0.13 * R;                 // 22 px: the gap is a parallel-sided slot, so aligned gaps form one channel
    const rings = [];
    for (let i = 0; i < n; i++) { const r1 = rIn - i * band; rings.push({ r1, r0: r1 - band + groove, mid: r1 - band / 2 }); }
    return { R, n, bw, rIn, rHub, band, groove, slotW, rings };
  }

  function canvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }
  // A square sprite of `size` css px centred on the medallion centre; ctx works in css px with (0,0) at the centre.
  function sprite(size, dpr) {
    const px = Math.ceil(size * dpr);
    const c = canvas(px, px);
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, px / 2, px / 2);
    return { c, ctx, size };
  }
  function blit(ctx, s, x, y) { ctx.drawImage(s.c, x - s.size / 2, y - s.size / 2, s.size, s.size); }

  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  // Half-angle of the parallel slot at radius r.
  const half = (w, r) => Math.asin(Math.min(0.999, w / 2 / r));

  // Path: a ring with its slot cut out, slot centred at canvas angle `a` (radians), around (x, y).
  function ringPath(ctx, x, y, r0, r1, a, w) {
    const h1 = half(w, r1), h0 = half(w, r0);
    ctx.beginPath();
    ctx.arc(x, y, r1, a + h1, a - h1 + TAU, false);
    ctx.arc(x, y, r0, a - h0 + TAU, a + h0, true);
    ctx.closePath();
  }
  // Path: just the slot segment of a ring.
  function slotPath(ctx, x, y, r0, r1, a, w) {
    const h1 = half(w, r1), h0 = half(w, r0);
    ctx.beginPath();
    ctx.arc(x, y, r1, a - h1, a + h1, false);
    ctx.arc(x, y, r0, a + h0, a - h0, true);
    ctx.closePath();
  }

  function conic(ctx, stops, r0, r1, startDeg) {
    // Conic lobes (anisotropic brushing). Uses createConicGradient; falls back to 1-degree wedges on old engines.
    if (ctx.createConicGradient) {
      const g = ctx.createConicGradient(startDeg * D, 0, 0);
      stops.forEach(([o, c]) => g.addColorStop(o, c));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, r1, 0, TAU); ctx.arc(0, 0, r0, TAU, 0, true); ctx.fill();
      return;
    }
    for (let d = 0; d < 360; d++) {
      const o = d / 360; let k = 0; while (k < stops.length - 2 && stops[k + 1][0] < o) k++;
      ctx.fillStyle = stops[o - stops[k][0] < stops[k + 1][0] - o ? k : k + 1][1];
      const a0 = startDeg * D + d * D, a1 = a0 + 1.4 * D;
      ctx.beginPath(); ctx.arc(0, 0, r1, a0, a1); ctx.arc(0, 0, r0, a1, a0, true); ctx.fill();
    }
  }
  const lobes = (t, dead) => dead
    ? [[0, t['dead-spec']], [0.08, t['dead-light']], [0.24, t['dead-mid']], [0.36, t['dead-deep']], [0.5, t['dead-light']],
       [0.64, t['dead-deep']], [0.78, t['dead-mid']], [0.92, t['dead-light']], [1, t['dead-spec']]]
    : [[0, t['ring-spec']], [0.05, t['ring-lift']], [0.16, t['ring-deep']], [0.34, t['ring-shade']], [0.47, t['ring-mid']],
       [0.5, t['ring-light']], [0.53, t['ring-mid']], [0.68, t['ring-shade']], [0.86, t['ring-deep']], [0.95, t['ring-lift']],
       [1, t['ring-spec']]];
  const rhodiumLobes = (t) => [[0, t['rhodium-hi']], [0.07, t.rhodium], [0.2, t['rhodium-lo']], [0.36, t['rhodium-shade']],
    [0.5, t['rhodium-lo']], [0.64, t['rhodium-shade']], [0.82, t['rhodium-lo']], [0.94, t.rhodium], [1, t['rhodium-hi']]];

  function brush(ctx, r0, r1, alpha) {
    for (let r = r0 + 0.5; r < r1; r += 0.9) {
      ctx.strokeStyle = `rgba(255,255,255,${(rnd() * alpha).toFixed(3)})`; ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
    }
  }

  function screw(ctx, t, x, y, r, slotAngle, glint) {
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, t['blue-hi']); g.addColorStop(0.35, t.blue); g.addColorStop(1, t['blue-deep']);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.save(); ctx.translate(x, y); ctx.rotate(slotAngle); ctx.fillStyle = 'rgba(5,10,20,.85)';
    ctx.fillRect(-r * 0.8, -r * 0.13, r * 1.6, r * 0.26); ctx.restore();
    if (glint > 0) { // the driver's screw glint (drive-only tock, L3 arrival): 300 ms
      const gg = ctx.createRadialGradient(x, y, 0, x, y, r * 2.4);
      gg.addColorStop(0, `rgba(255,255,255,${0.9 * glint})`); gg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(x, y, r * 2.4, 0, TAU); ctx.fill();
    }
  }
  function jewel(ctx, t, x, y, r) {
    ctx.fillStyle = t['rhodium-lo']; ctx.beginPath(); ctx.arc(x, y, r * 1.45, 0, TAU); ctx.fill(); // chaton
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.05, x, y, r);
    g.addColorStop(0, t['ruby-hi']); g.addColorStop(0.3, t.ruby); g.addColorStop(1, t['ruby-deep']);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }
  function gear(ctx, t, x, y, r, teeth, rot, lift) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    ctx.beginPath();
    for (let i = 0; i < teeth; i++) {
      const a = i / teeth * TAU, w = Math.PI / teeth;
      ctx.lineTo(Math.cos(a - w * 0.55) * r * 0.8, Math.sin(a - w * 0.55) * r * 0.8);
      ctx.lineTo(Math.cos(a - w * 0.3) * r, Math.sin(a - w * 0.3) * r);
      ctx.lineTo(Math.cos(a + w * 0.3) * r, Math.sin(a + w * 0.3) * r);
      ctx.lineTo(Math.cos(a + w * 0.55) * r * 0.8, Math.sin(a + w * 0.55) * r * 0.8);
    }
    ctx.closePath();
    const g = ctx.createLinearGradient(-r, -r, r, r);
    g.addColorStop(0, t['rhodium-hi']); g.addColorStop(0.5, t.rhodium); g.addColorStop(1, t['rhodium-shade']);
    ctx.fillStyle = g; shadow(ctx, t, lift); ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 0.8; ctx.stroke();
    ctx.restore();
  }
  // Fitting shadow: 2/3 px offset, 5 px blur at rest; lifted (L = 0..1 of the 2 px lift): offset + blur grow.
  function shadow(ctx, t, L) {
    ctx.shadowColor = t.contact; ctx.shadowBlur = 5 + 4 * L; ctx.shadowOffsetX = 2 + 2 * L; ctx.shadowOffsetY = 3 + 3 * L;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // create({R, dpr, n, grab:[bool], links:[{from,to,type:'claw'|'pinion'}], tokens})  -> renderer
  // Rebuild (call create again) when the level, the medallion size, the DPR or the skin changes.
  function create(o) {
    const t = o.tokens || readTokens();
    const R = o.R, dpr = o.dpr || 1, n = o.n;
    const G = geometry(R, n);
    const grab = o.grab || new Array(n).fill(true);
    const links = (o.links || []).map((L, k) => {
      const b = Math.min(L.from, L.to);
      let off = (112.5 + 67.5 * b) % 360; if (off < 45 || off > 315) off = (off + 90) % 360; // keep clear of the slot
      return Object.assign({ off, b, k }, L);
    });
    // Toothed edge = "something drives me": on the driven ring, on the edge facing its driver.
    const teeth = new Array(n).fill(null);
    links.forEach((L) => { teeth[L.to] = L.from < L.to ? 'out' : 'in'; });

    seed = 11;
    const pad = 0.5 * R;                                   // room for the contact shadow
    // --- static background: contact shadow, bezel, movement plate + perlage ---
    const bg = sprite(2 * R + 2 * pad, dpr), b = bg.ctx;
    b.save(); b.fillStyle = t.contact; b.filter = `blur(${0.09 * R}px)`;
    b.beginPath(); b.ellipse(0.16 * R, 0.2 * R, 1.02 * R, 0.98 * R, 0, 0, TAU); b.fill(); b.restore();
    conic(b, rhodiumLobes(t), 0, R, -135);
    brush(b, G.rIn, R, 0.06);
    b.strokeStyle = 'rgba(0,0,0,.7)'; b.lineWidth = 1.5; b.beginPath(); b.arc(0, 0, R - 0.75, 0, TAU); b.stroke();
    b.strokeStyle = 'rgba(0,0,0,.55)'; b.lineWidth = 1; b.beginPath(); b.arc(0, 0, G.rIn + 1.5, 0, TAU); b.stroke();
    b.fillStyle = t.plate; b.beginPath(); b.arc(0, 0, G.rIn + 1, 0, TAU); b.fill();
    b.save(); b.beginPath(); b.arc(0, 0, G.rIn, 0, TAU); b.clip();
    for (let i = 0; i < 260; i++) {
      const a = rnd() * TAU, r = Math.sqrt(rnd()) * G.rIn;
      b.strokeStyle = t.perlage; b.lineWidth = 1; b.beginPath(); b.arc(Math.cos(a) * r, Math.sin(a) * r, 0.035 * R, 0, TAU); b.stroke();
    }
    b.restore();

    // --- per ring: material (fixed to the lamp) + features (rotate with the ring) + lume sprites (at angle 0) ---
    const ringArt = G.rings.map((g, i) => {
      const size = 2 * g.r1 + 4, dead = !grab[i];
      const mat = sprite(size, dpr), m = mat.ctx;
      conic(m, lobes(t, dead), g.r0, g.r1, -135);
      m.save(); m.beginPath(); m.arc(0, 0, g.r1, 0, TAU); m.arc(0, 0, g.r0, TAU, 0, true); m.clip();
      brush(m, g.r0, g.r1, dead ? t.brushA * 0.4 : t.brushA);
      const eg = m.createLinearGradient(-R, -R, R, R);
      eg.addColorStop(0, 'rgba(230,240,255,.55)'); eg.addColorStop(0.5, 'rgba(230,240,255,.05)'); eg.addColorStop(1, 'rgba(0,0,0,.4)');
      m.strokeStyle = eg; m.lineWidth = 1.2; m.beginPath(); m.arc(0, 0, g.r1 - 0.8, 0, TAU); m.stroke();       // outer edge light
      m.strokeStyle = 'rgba(0,0,0,.45)'; m.lineWidth = 1; m.beginPath(); m.arc(0, 0, g.r0 + 0.6, 0, TAU); m.stroke(); // inner edge shade
      m.restore();

      const fea = sprite(size, dpr), f = fea.ctx, a0 = rad(0);
      if (!dead && t.inlayW > 0) { // skin 2: white enamel chapter track, cut by the slot
        const ri = g.r1 - 0.32 * G.band, h = half(G.slotW, ri) + 2 * D;
        f.strokeStyle = t['ring-inlay']; f.lineWidth = t.inlayW * R / 171.5;
        f.beginPath(); f.arc(0, 0, ri, a0 + h, a0 - h + TAU); f.stroke();
      }
      if (!dead) for (let k = 1; k < 8; k++) { // 7 engraved detent ticks at the other 7 notches
        const a = rad(k * 45), l = Math.min(0.041 * R, 0.3 * G.band);
        f.strokeStyle = t.tick; f.lineWidth = Math.max(1.2, 0.008 * R); f.lineCap = 'butt';
        f.beginPath(); f.moveTo(Math.cos(a) * (g.r1 - 2), Math.sin(a) * (g.r1 - 2));
        f.lineTo(Math.cos(a) * (g.r1 - l), Math.sin(a) * (g.r1 - l)); f.stroke();
      }
      if (teeth[i]) { // 48 ratchet notches cut into the edge that faces the driver
        const r = teeth[i] === 'out' ? g.r1 : g.r0, depth = Math.min(0.019 * R, 0.14 * G.band);
        const count = 48, hs = half(G.slotW, r) + 1 * D;
        f.fillStyle = 'rgba(4,8,16,.85)';
        for (let k = 0; k < count; k++) {
          const a = a0 + (k + 0.5) / count * TAU, w = Math.PI / count * 0.5;
          if (Math.abs(((a - a0 + Math.PI) % TAU + TAU) % TAU - Math.PI) < hs + w) continue;
          const rb = teeth[i] === 'out' ? r - depth : r + depth;
          f.beginPath();
          f.moveTo(Math.cos(a - w) * r, Math.sin(a - w) * r);
          f.lineTo(Math.cos(a - w * 0.6) * rb, Math.sin(a - w * 0.6) * rb);
          f.lineTo(Math.cos(a + w * 0.6) * rb, Math.sin(a + w * 0.6) * rb);
          f.lineTo(Math.cos(a + w) * r, Math.sin(a + w) * r);
          f.fill();
        }
      }
      // bevelled slot walls: lit wall (faces the lamp) and shaded wall
      const walls = [[+1, t.bevel], [-1, 'rgba(0,0,0,.55)']];
      walls.forEach(([s, col]) => {
        const x = s * G.slotW / 2; f.strokeStyle = col; f.lineWidth = 1.3;
        f.beginPath(); f.moveTo(x, -Math.sqrt(g.r1 * g.r1 - x * x) + 0.5); f.lineTo(x, -Math.sqrt(g.r0 * g.r0 - x * x) - 0.5); f.stroke();
      });

      const lit = sprite(size + 0.3 * R, dpr), l = lit.ctx; // lit slot segment + small glow, at angle 0
      slotPath(l, 0, 0, g.r0 + 0.5, g.r1 - 0.5, a0, G.slotW - 2);
      l.fillStyle = t.lume; l.shadowColor = t['lume-glow']; l.shadowBlur = 0.07 * R; l.fill();
      const burst = sprite(size + 0.5 * R, dpr), u = burst.ctx; // the win's channel burst (bigger bloom)
      slotPath(u, 0, 0, g.r0 - G.groove, g.r1 + 0.5, a0, G.slotW);
      u.fillStyle = t.lume; u.shadowColor = t['lume-glow']; u.shadowBlur = 0.16 * R; u.fill(); u.fill();
      return { mat, fea, lit, burst, dead };
    });

    // --- hub (enamel), static; keyway, bolt and boss are per frame ---
    const hub = sprite(2 * G.rHub + 24, dpr), h = hub.ctx;
    const hg = h.createRadialGradient(-G.rHub * 0.35, -G.rHub * 0.4, G.rHub * 0.1, 0, 0, G.rHub);
    hg.addColorStop(0, t['enamel-hi']); hg.addColorStop(0.7, t.enamel); hg.addColorStop(1, t['enamel-shade']);
    h.save(); h.shadowColor = 'rgba(0,0,0,.6)'; h.shadowBlur = 6; h.shadowOffsetY = 2;
    h.fillStyle = hg; h.beginPath(); h.arc(0, 0, G.rHub - 1, 0, TAU); h.fill(); h.restore();
    h.strokeStyle = t['rhodium-lo']; h.lineWidth = 2; h.beginPath(); h.arc(0, 0, G.rHub - 1, 0, TAU); h.stroke();

    // --- lamp sheen over everything (fixed) ---
    const sheen = sprite(2 * R + 2, dpr), sh = sheen.ctx;
    const lg = sh.createRadialGradient(-0.6 * R, -0.7 * R, 0, -0.6 * R, -0.7 * R, 1.5 * R);
    lg.addColorStop(0, hexA(t.lamp, 0.16)); lg.addColorStop(1, hexA(t.lamp, 0));
    sh.fillStyle = lg; sh.beginPath(); sh.arc(0, 0, R, 0, TAU); sh.fill();

    // ---------------- per frame ----------------
    // s = { angles:[deg], lit:[0..1], burst:[0..1], used, budget, selected, chev:[{ring,dir}], lift:[0..1 per link],
    //       glint:[0..1 per ring], bolt:0..1, shadow:true }
    function draw(ctx, cx, cy, s) {
      if (s.shadow !== false) blit(ctx, bg, cx, cy);
      else { ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.clip(); blit(ctx, bg, cx, cy); ctx.restore(); }
      const lit = s.lit || [], burst = s.burst || [];
      for (let i = 0; i < n; i++) {
        const g = G.rings[i], art = ringArt[i], deg = s.angles[i] || 0, a = rad(deg);
        ctx.save(); ringPath(ctx, cx, cy, g.r0, g.r1, a, G.slotW); ctx.clip(); blit(ctx, art.mat, cx, cy); ctx.restore();
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(deg * D);
        slotPath(ctx, 0, 0, g.r0 + 0.5, g.r1 - 0.5, rad(0), G.slotW - 2); ctx.fillStyle = t['lume-off']; ctx.fill();
        if (lit[i] > 0) { ctx.globalAlpha = lit[i]; blit(ctx, art.lit, 0, 0); }
        if (burst[i] > 0) { ctx.globalAlpha = burst[i]; blit(ctx, art.burst, 0, 0); }
        ctx.globalAlpha = 1; blit(ctx, art.fea, 0, 0); ctx.restore();
      }
      if (s.selected != null && s.selected >= 0) {
        const g = G.rings[s.selected];
        ctx.save(); ctx.strokeStyle = hexA(t.lume, 0.9); ctx.lineWidth = 2; ctx.shadowColor = t['lume-glow']; ctx.shadowBlur = 10;
        [g.r1 - 1, g.r0 + 1].forEach((r) => { ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke(); });
        ctx.restore();
      }
      links.forEach((L, k) => drawLink(ctx, cx, cy, L, s, (s.lift || [])[k] || 0));
      (s.chev || []).forEach((c) => {
        const g = G.rings[c.ring], deg = s.angles[c.ring] || 0;
        [90, 270].forEach((d) => chevron(ctx, cx, cy, g.mid, rad(deg + d), c.dir));
      });
      // hub: enamel, keyway (the channel's last segment), bolt, boss + screw
      blit(ctx, hub, cx, cy);
      const kw = G.slotW, ky = cy - G.rHub + 1, kl = 0.78 * G.rHub, bolt = s.bolt || 0;
      const hubLit = burst[n - 1] || 0;
      ctx.fillStyle = t.keyway; ctx.fillRect(cx - kw / 2, ky, kw, kl);
      if (hubLit > 0) { ctx.save(); ctx.globalAlpha = hubLit; ctx.fillStyle = t.lume; ctx.shadowColor = t['lume-glow']; ctx.shadowBlur = 0.1 * R;
        ctx.fillRect(cx - kw / 2 + 1, ky, kw - 2, kl); ctx.restore(); }
      const top = ky + bolt * (kl - 1);
      if (kl - (top - ky) > 0.5) {
        const bg2 = ctx.createLinearGradient(cx - kw / 2, 0, cx + kw / 2, 0);
        bg2.addColorStop(0, t['rhodium-shade']); bg2.addColorStop(0.45, t['rhodium-lo']); bg2.addColorStop(1, t.keyway);
        ctx.fillStyle = bg2; ctx.fillRect(cx - kw / 2 + 1.5, top, kw - 3, ky + kl - top);
        ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(cx - kw / 2 + 1.5, top, kw - 3, 1.2);
      }
      ctx.beginPath(); ctx.arc(cx, cy, G.rHub * 0.22, 0, TAU); ctx.fillStyle = t.keyway; ctx.fill();
      screw(ctx, t, cx, cy, G.rHub * 0.16, 0.9, 0);
      // 12 o'clock enamel index (glows when the channel is lit)
      const all = burst.length ? Math.min(...burst.slice(0, n).map((v) => v || 0)) : 0;
      ctx.save(); ctx.translate(cx, cy - R + 0.12 * G.bw); ctx.fillStyle = t.enamel;
      ctx.shadowColor = all > 0 ? t['lume-glow'] : 'rgba(0,0,0,.6)'; ctx.shadowBlur = all > 0 ? 14 * all : 3;
      const ti = 0.8 * G.bw; ctx.beginPath(); ctx.moveTo(-ti * 0.45, 0); ctx.lineTo(ti * 0.45, 0); ctx.lineTo(0, ti); ctx.closePath(); ctx.fill();
      ctx.restore();
      if (s.budget) batons(ctx, cx, cy, s.budget, s.used || 0);
      blit(ctx, sheen, cx, cy);
    }

    function drawLink(ctx, cx, cy, L, s, lift) {
      const f = G.rings[L.from], to = G.rings[L.to];
      const ad = s.angles[L.from] || 0, a = rad(ad + L.off), ca = Math.cos(a), sa = Math.sin(a);
      const band = G.band, out = L.from < L.to;           // out = the driver is the outer ring of the pair
      const boundary = out ? f.r0 - G.groove / 2 : f.r1 + G.groove / 2;
      const Lp = 2 * lift, dx = -0.3 * Lp, dy = -Lp;      // the 2 px lift
      const glint = (s.glint || [])[L.from] || 0;
      if (L.type === 'claw') {
        // a pawl: screwed near the driver's far edge, reaching across the boundary and along the ring (tangential
        // run = 1.1 band) so it reads as a lever, with its hooked tip in the driven ring's teeth
        const w = clamp(9, 0.5 * band, 13);
        const rs = out ? f.r1 - 0.32 * band : f.r0 + 0.32 * band;
        const rt = out ? to.r1 - 0.2 * band : to.r0 + 0.2 * band;
        const at = a + 1.1 * band / rt;
        const x0 = cx + ca * rs + dx, y0 = cy + sa * rs + dy, x1 = cx + Math.cos(at) * rt + dx, y1 = cy + Math.sin(at) * rt + dy;
        ctx.save(); shadow(ctx, t, lift);
        ctx.lineCap = 'round'; ctx.lineWidth = w;
        const lg = ctx.createLinearGradient(x0 - w, y0 - w, x1 + w, y1 + w);
        lg.addColorStop(0, t['blue-hi']); lg.addColorStop(0.5, t.blue); lg.addColorStop(1, t['blue-deep']);
        ctx.strokeStyle = lg; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        ctx.shadowColor = 'transparent';
        ctx.fillStyle = t['blue-deep']; ctx.translate(x1, y1); ctx.rotate(at + (out ? 0 : Math.PI)); // hooked tip into the teeth
        ctx.beginPath(); ctx.moveTo(-w * 0.5, 0); ctx.lineTo(0, w * 0.8); ctx.lineTo(w * 0.5, 0); ctx.fill();
        ctx.restore();
        screw(ctx, t, x0, y0, clamp(4.5, 0.5 * w, 7), a, glint);
        jewel(ctx, t, (x0 + x1) / 2, (y0 + y1) / 2, Math.max(2.5, 0.26 * w));
      } else {
        const rp = clamp(10, 0.62 * band, 16);
        const px = cx + ca * boundary + dx, py = cy + sa * boundary + dy;
        const rs = f.mid, as = a + (out ? 1 : 1) * (2.2 * rp / rs);
        const sx = cx + Math.cos(as) * rs + dx, sy = cy + Math.sin(as) * rs + dy;
        ctx.save(); ctx.strokeStyle = t.blue; ctx.lineWidth = clamp(6, 0.3 * band, 9); ctx.lineCap = 'round'; shadow(ctx, t, lift);
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(sx, sy); ctx.stroke(); ctx.restore();
        // the pinion rolls between the two rings: its spin = relative ring travel * boundary / pinion radius
        const rel = ((s.angles[L.from] || 0) - (s.angles[L.to] || 0)) * D;
        gear(ctx, t, px, py, rp, 10, rel * boundary / rp / 2 + a, lift);
        jewel(ctx, t, px, py, rp * 0.26);
        screw(ctx, t, sx, sy, clamp(4.5, 0.22 * band, 6.5), a, glint);
      }
    }

    function chevron(ctx, cx, cy, r, a, dir) {
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r, sz = clamp(4.5, 0.26 * G.band, 7);
      ctx.save(); ctx.translate(x, y); ctx.rotate(a + (dir > 0 ? 1 : -1) * Math.PI / 2);
      ctx.strokeStyle = t.lume; ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.shadowColor = t['lume-glow']; ctx.shadowBlur = 8;
      for (const o of [0, -1.2 * sz]) { ctx.beginPath(); ctx.moveTo(o - sz * 0.6, -sz); ctx.lineTo(o + sz * 0.5, 0); ctx.lineTo(o - sz * 0.6, sz); ctx.stroke(); }
      ctx.restore();
    }

    function batons(ctx, cx, cy, budget, used) {
      const span = Math.min(150, budget * 16);
      const ra = G.rIn + 0.22 * G.bw, rb = R - 0.22 * G.bw;
      for (let k = 0; k < budget; k++) {
        const a = rad(180 + span / 2 - (k + 0.5) * span / budget), spent = k >= budget - used;
        const c = Math.cos(a), s2 = Math.sin(a);
        ctx.save(); ctx.lineCap = 'butt'; ctx.lineWidth = Math.max(2.5, 0.018 * R);
        if (spent) { // an engraved slot: dark, with a 1 px lit lower lip
          ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.beginPath();
          ctx.moveTo(cx + c * ra + 0.7, cy + s2 * ra + 1); ctx.lineTo(cx + c * rb + 0.7, cy + s2 * rb + 1); ctx.stroke();
          ctx.strokeStyle = t.slot;
        } else { ctx.strokeStyle = t.enamel; ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 2; ctx.shadowOffsetY = 1; }
        ctx.beginPath(); ctx.moveTo(cx + c * ra, cy + s2 * ra); ctx.lineTo(cx + c * rb, cy + s2 * rb); ctx.stroke();
        ctx.restore();
      }
    }

    // The open dial under the lid (win beat 4) with the result engraved: {kicker, big, sub, stars (0-3), engraving}.
    function drawDial(ctx, cx, cy, res) {
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.clip(); blit(ctx, bg, cx, cy); ctx.restore();
      const eg = ctx.createRadialGradient(cx - 0.33 * R, cy - 0.37 * R, 4, cx, cy, 0.86 * R);
      eg.addColorStop(0, t['enamel-hi']); eg.addColorStop(1, t['enamel-shade']);
      ctx.fillStyle = eg; ctx.beginPath(); ctx.arc(cx, cy, 0.84 * R, 0, TAU); ctx.fill();
      ctx.strokeStyle = t['rhodium-lo']; ctx.lineWidth = 2; ctx.stroke();
      if (!res) return;
      ctx.save(); ctx.fillStyle = t.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      track(ctx, `500 ${0.07 * R}px ${t.fontDisplay}`, (res.kicker || 'OPENED').toUpperCase(), cx, cy - 0.3 * R, 0.3);
      ctx.font = `700 ${0.4 * R}px ${t.fontNumeral}`; ctx.fillText(String(res.big), cx, cy + 0.12 * R);
      track(ctx, `500 ${0.058 * R}px ${t.fontDisplay}`, (res.sub || '').toUpperCase(), cx, cy + 0.3 * R, 0.24);
      if (res.stars != null) stars(ctx, cx, cy + 0.5 * R, 0.075 * R, res.stars);
      if (res.engraving) track(ctx, `italic 400 ${0.055 * R}px ${t.fontNumeral}`, res.engraving, cx, cy - 0.5 * R, 0.05);
      ctx.restore();
    }
    function stars(ctx, x, y, r, k) {
      for (let i = 0; i < 3; i++) {
        const sx = x + (i - 1) * r * 2.8; ctx.save(); ctx.translate(sx, y); ctx.beginPath();
        for (let j = 0; j < 10; j++) { const rr = j % 2 ? r * 0.45 : r, a = -Math.PI / 2 + j * Math.PI / 5; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
        ctx.closePath();
        if (i < k) { ctx.fillStyle = t['lume-glow']; ctx.fill(); } else { ctx.strokeStyle = t['rhodium-lo']; ctx.lineWidth = 1.2; ctx.stroke(); }
        ctx.restore();
      }
    }

    // The lid swing (win beat 4). `lid` = a sprite of the closed medallion (use snapshot()); phi in degrees, 0 = shut.
    // Hinge on the left edge; the lid swings toward the viewer. Drawn in 2 px strips for a true perspective taper.
    function drawLid(ctx, cx, cy, lid, phi) {
      const p = phi * D, f = 8 * R, x0 = cx - R, W = 2 * R;
      if (Math.cos(p) < 0) return; // past 90 degrees the lid has left the frame (the game cross-fades to the caseback)
      // two tinted copies of the lid sprite: its edge (the thickness, dark rhodium) and its face, shaded as it turns
      const tint = (col, a) => {
        const c = canvas(lid.c.width, lid.c.height), g = c.getContext('2d');
        g.drawImage(lid.c, 0, 0); g.globalCompositeOperation = 'source-atop'; g.globalAlpha = a; g.fillStyle = col;
        g.fillRect(0, 0, c.width, c.height); return { c, size: lid.size };
      };
      const strips = (img, dx) => {
        const px = img.c.width / img.size, strip = 2;
        for (let u = 0; u < W; u += strip) {
          const X = cx + ((x0 + u * Math.cos(p)) - cx) * f / (f - u * Math.sin(p));
          const X2 = cx + ((x0 + (u + strip) * Math.cos(p)) - cx) * f / (f - (u + strip) * Math.sin(p));
          const H = img.size * f / (f - u * Math.sin(p));
          ctx.drawImage(img.c, (u + (img.size - W) / 2) * px, 0, strip * px, img.c.height, Math.min(X, X2) + dx, cy - H / 2, Math.abs(X2 - X) + 0.6, H);
        }
      };
      strips(tint(t['rhodium-shade'], 1), 0.05 * R * Math.sin(p));
      strips(tint('#000', 0.3 * Math.sin(p)), 0);
    }
    // A sprite of the closed medallion in state s (no contact shadow), for the lid.
    function snapshot(s) {
      const sp = sprite(2 * R + 4, dpr);
      draw(sp.ctx, 0, 0, Object.assign({}, s, { shadow: false }));
      return sp;
    }

    return { G, links, draw, drawDial, drawLid, snapshot, tokens: t };
  }

  function track(ctx, font, text, x, y, em) { // centred text with letter-spacing (em), engraved: dark copy 1 px above
    ctx.font = font; const size = parseFloat(/([\d.]+)px/.exec(font)[1]); const sp = em * size;
    const chars = [...text]; const w = chars.reduce((a, c) => a + ctx.measureText(c).width + sp, -sp);
    let xx = x - w / 2; const fill = ctx.fillStyle;
    for (const c of chars) {
      ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillText(c, xx, y - 1);
      ctx.fillStyle = fill; ctx.fillText(c, xx, y); xx += ctx.measureText(c).width + sp;
    }
    ctx.textAlign = 'center';
  }
  function hexA(hex, a) {
    const h = hex.replace('#', ''); const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    return `rgba(${parseInt(v.slice(0, 2), 16)},${parseInt(v.slice(2, 4), 16)},${parseInt(v.slice(4, 6), 16)},${a})`;
  }

  root.LBMedallion = { create, readTokens, geometry, track, hexA };
})(typeof window !== 'undefined' ? window : globalThis);
