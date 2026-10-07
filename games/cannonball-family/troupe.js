// Cannonball Family: the troupe renderer (THE-449 S6; ported from design/cannonball-family/troupe.js, THE-447).
// Render only: every function here draws, none of them touch the sim. Logic is unchanged from the reference; only
// the module wrapper differs (an ES module export instead of window.CBF). DESIGN.md section 6 is the prose guide.

  // ---------------------------------------------------------------- palette (mirrors tokens.css; tokens() refreshes)
  const T = {
    tent: '#8A3324', tentDeep: '#5A1E16', tentLight: '#A84A34', tentDark: '#3C120C', canvas: '#E3CFA8', canvasDeep: '#C4A97C',
    sawdust: '#D6B07A', sawdustDeep: '#B08850', curb: '#B8342A', spot: '#FFECBE',
    wood: '#B57A44', woodDeep: '#7E5028', woodLight: '#D7A46C', woodDark: '#5E3A1C',
    cream: '#FFF4E0', white: '#FFFFFF', ink: '#2A1A12', ink2: '#6E5446', navy: '#26345A', navyDeep: '#172240', navyLight: '#3B4C7A',
    star: '#EDB22C', starDeep: '#A87410', needle: '#D9D4CC', iron: '#4B4643', ironLight: '#6E6863', lens: '#A9D3CF',
    cheek: '#EE8A86', mouth: '#6E1F2E', tongue: '#E8727A', tooth: '#FFFBF2', jamRed: '#B8344F',
    tinPea: '#6E9A55', tinTomato: '#C8553D', tinMustard: '#D9A43B', tinRobin: '#5F9EA6', tinCream: '#EDE2CC',
    tinRim: '#D8D2C6', tinRimDeep: '#8E877C', jam1: '#B8344F', jam2: '#E58F3E', jam3: '#6E8A2E', jamLid: '#D9483B',
    stone: '#8C8379', stoneDeep: '#615A52', net: '#FFF4E0', netPole: '#D9483B', smoke: '#FFF4E0',
  };
  const SEAT_IDS = ['poppy', 'cobalt', 'violet', 'moss', 'sun', 'teal'];
  const SEATS = {
    poppy: { fill: '#D9483B', deep: '#9E2C24' }, cobalt: { fill: '#2E5BA6', deep: '#1D3C73' }, violet: { fill: '#8A5BB0', deep: '#5E3A7E' },
    moss: { fill: '#4C8A3C', deep: '#2F5E25' }, sun: { fill: '#EDB22C', deep: '#A87410' }, teal: { fill: '#1E9E9A', deep: '#12696A' },
  };
  // the six looks (theme.js `look` 0-5). key = the silhouette; skin/hair are part of the look, never of the colour.
  const LOOKS = [
    { key: 'bun', skin: '#E8B58F', hair: '#8A3B22' },     // 0 bun + pencil, fringe, hoops        (default Ma)
    { key: 'crest', skin: '#C88A63', hair: '#3B2A20' },   // 1 flat-top crest, big moustache       (default Pa)
    { key: 'curls', skin: '#F0C7A6', hair: '#E4DEEA' },   // 2 curls, felt flower, cat-eye glasses (default Nan)
    { key: 'tweed', skin: '#A8693F', hair: '#EFE9DC' },   // 3 tweed shell, cap peak, brows, beard (default Gramps)
    { key: 'prop', skin: '#DDA27A', hair: '#5A3A22' },    // 4 propeller, freckles, gap tooth      (default Kid)
    { key: 'phones', skin: '#7A4A30', hair: '#1F1A1F' },  // 5 headphones, swoop fringe            (default Teen)
  ];
  // theme.js defaults: 5 active, Teen addable
  const CAST = [
    { name: 'Ma', colour: 'poppy', look: 0 }, { name: 'Pa', colour: 'cobalt', look: 1 }, { name: 'Nan', colour: 'violet', look: 2 },
    { name: 'Gramps', colour: 'moss', look: 3 }, { name: 'Kid', colour: 'sun', look: 4 }, { name: 'Teen', colour: 'teal', look: 5 },
  ];
  const KNACK_WORDS = { heavy: 'Heavy helmet: cracks stones', light: 'Light helmet: flies far', bounce: 'Bounce helmet: bounces once' };

  const kebab = (k) => k.replace(/([A-Z])/g, '-$1').replace(/([a-z])(\d)/g, '$1-$2').toLowerCase();
  function tokens(root = document.documentElement) {
    const cs = getComputedStyle(root), get = (n) => cs.getPropertyValue(n).trim();
    for (const k of Object.keys(T)) { const v = get('--cbf-' + (k === 'ink2' ? 'ink-2' : kebab(k))); if (v) T[k] = v; }
    for (const s of SEAT_IDS) { const f = get(`--cbf-seat-${s}`), d = get(`--cbf-seat-${s}-deep`); if (f) SEATS[s].fill = f; if (d) SEATS[s].deep = d; }
    LOOKS.forEach((L, i) => { const s = get(`--cbf-look${i}-skin`), h = get(`--cbf-look${i}-hair`); if (s) L.skin = s; if (h) L.hair = h; });
    return T;
  }
  const tins = () => [T.tinPea, T.tinTomato, T.tinMustard, T.tinRobin, T.tinCream];
  const jams = () => [T.jam1, T.jam2, T.jam3];

  // ---------------------------------------------------------------- felt + stitch helpers
  function shade(hex, f) { // f < 0 darker, > 0 lighter
    const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const t = f < 0 ? 0 : 255, p = Math.abs(f);
    r = Math.round(r + (t - r) * p); g = Math.round(g + (t - g) * p); b = Math.round(b + (t - b) * p);
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }
  function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  let fibreTile = null;
  function fibres() { // a 72 px tile of short light and dark strokes, laid over felt fills at >= 56 px
    if (fibreTile) return fibreTile;
    const c = document.createElement('canvas'); c.width = c.height = 72; const x = c.getContext('2d'), r = rng(7);
    for (let i = 0; i < 520; i++) { const a = r() * Math.PI * 2, l = 2 + r() * 5, px = r() * 72, py = r() * 72;
      x.strokeStyle = r() < 0.5 ? 'rgba(255,255,255,.16)' : 'rgba(0,0,0,.13)'; x.lineWidth = 0.6 + r() * 0.5;
      x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke(); }
    return (fibreTile = c);
  }
  // a scissor-cut wobbly ellipse (deterministic per seed)
  function blob(ctx, cx, cy, rx, ry, seed, amp = 0.7, n = 22) {
    const r = rng(seed), pts = [];
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, w = 1 + (r() - 0.5) * amp * 2 / Math.max(rx, ry); pts.push([cx + Math.cos(a) * rx * w, cy + Math.sin(a) * ry * w]); }
    ctx.beginPath();
    for (let i = 0; i <= n; i++) { const p = pts[i % n], q = pts[(i + 1) % n], mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2; if (i === 0) ctx.moveTo(mx, my); else ctx.quadraticCurveTo(p[0], p[1], mx, my); }
    ctx.closePath();
  }
  // fill the current path as a felt piece: 1-2 px thickness shadow, flat dye, fibres when k >= 1 (>= 56 px faces)
  function felt(ctx, color, k = 1, opt = {}) {
    ctx.save();
    if (opt.shadow !== false) { ctx.shadowColor = 'rgba(30,8,4,.32)'; ctx.shadowBlur = 2.2 * k; ctx.shadowOffsetY = 1.3 * k; }
    ctx.fillStyle = color; ctx.fill(); ctx.restore();
    if (opt.fibre ?? k >= 1) { ctx.save(); const p = ctx.createPattern(fibres(), 'repeat'); p.setTransform(new DOMMatrix().scale(1 / k / 1.4)); ctx.fillStyle = p; ctx.fill(); ctx.restore(); }
  }
  function stitch(ctx, color, k = 1, w = 1.6, dash = [4, 3]) { // running stitch along the current path
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = Math.max(w, 0.9 / k); ctx.lineCap = 'round';
    ctx.setLineDash(dash.map((d) => Math.max(d, (d > 3 ? 2.5 : 1.6) / k))); ctx.stroke(); ctx.restore();
  }
  function line(ctx, color, w, k = 1) { ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = Math.max(w, 0.9 / k); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(); ctx.restore(); }
  function starPath(ctx, x, y, r, inner = 0.45) { ctx.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * inner : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } ctx.closePath(); }
  // a felt star: filled = earned (star dye + cream stitch), hollow = could be earned (dark felt + cream stitch)
  function feltStar(ctx, x, y, r, filled = true, k = 1, onLight = false) {
    starPath(ctx, x, y, r);
    if (filled) { felt(ctx, T.star, k, { fibre: false }); starPath(ctx, x, y, r * 0.72); stitch(ctx, onLight ? T.starDeep : T.cream, k, 1.2, [2, 2]); }
    else { ctx.fillStyle = onLight ? 'rgba(42,26,18,.12)' : 'rgba(20,6,4,.3)'; ctx.fill(); stitch(ctx, onLight ? 'rgba(42,26,18,.5)' : 'rgba(255,244,224,.8)', k, 1.6, [3, 2.5]); }
  }

  // ---------------------------------------------------------------- the face (drawn default), four expressions
  // expr: ready (loaded) | whee (in flight) | bow (after a hit) | shrug (after a miss). Never pain, never a tear.
  function face(ctx, look, expr, k) {
    const L = LOOKS[look], key = L.key, prop = key === 'prop';
    const [rx, ry] = prop ? [27, 29] : [27, 31], ey = prop ? 5 : 2, my = prop ? 18 : 16;
    [-1, 1].forEach((d) => { blob(ctx, d * rx, 6, 6, 7, 90 + d, 0.4, 12); felt(ctx, L.skin, k); });
    blob(ctx, 0, 2, rx, ry, 99, 0.6); felt(ctx, L.skin, k);
    ctx.beginPath(); ctx.ellipse(-15, my - 4, 5, 3.6, 0, 0, 7); ctx.ellipse(15, my - 4, 5, 3.6, 0, 0, 7); ctx.globalAlpha = 0.55; ctx.fillStyle = T.cheek; ctx.fill(); ctx.globalAlpha = 1;
    const browCol = key === 'curls' || key === 'tweed' ? shade(L.hair, -0.25) : L.hair;
    const thick = key === 'tweed' ? 4.6 : key === 'crest' ? 3.6 : 2.6;
    [-10, 10].forEach((x) => {
      const s = Math.sign(x);
      if (expr === 'bow') { ctx.beginPath(); ctx.arc(x, ey + 3, 4.6, Math.PI * 1.12, Math.PI * 1.88); line(ctx, T.ink, 2.8, k); }
      else if (expr === 'whee') { blob(ctx, x, ey - 1, 6.4, 7, 3 + x, 0.3); felt(ctx, T.tooth, k, { shadow: false }); ctx.beginPath(); ctx.arc(x + 1, ey - 1.5, 3.5, 0, 7); ctx.fillStyle = T.ink; ctx.fill(); ctx.beginPath(); ctx.arc(x, ey - 3, 1.1, 0, 7); ctx.fillStyle = T.cream; ctx.fill(); }
      else { const px = expr === 'shrug' ? 2.4 : 0; ctx.beginPath(); ctx.arc(x + px, ey, 4.3, 0, 7); ctx.fillStyle = T.ink; ctx.fill(); ctx.beginPath(); ctx.arc(x + px - 1.4, ey - 1.5, 1.35, 0, 7); ctx.fillStyle = 'rgba(255,244,224,.9)'; ctx.fill(); }
      let y = ey - 9, tilt = 0; // brows: up for whee, one raised for shrug
      if (expr === 'whee') y -= 4; if (expr === 'bow') y -= 1.5; if (expr === 'shrug' && s > 0) { y -= 4; tilt = -1.2; } if (expr === 'shrug' && s < 0) tilt = 0.8;
      ctx.beginPath(); ctx.moveTo(x - 5 * s, y + tilt); ctx.quadraticCurveTo(x, y - 2.2, x + 5 * s, y - tilt * 0.4); line(ctx, browCol, thick, k);
    });
    const [nx, ny] = key === 'tweed' ? [4.6, 4.4] : [3.4, 3]; ctx.beginPath(); ctx.ellipse(0, ey + 7, nx, ny, 0, 0, 7); felt(ctx, shade(L.skin, -0.14), k, { fibre: false });
    if (expr === 'whee' || expr === 'bow') { // open grin
      const h = expr === 'whee' ? 15 : 12;
      ctx.beginPath(); ctx.moveTo(-10, my - 2); ctx.quadraticCurveTo(0, my + 1, 10, my - 2); ctx.quadraticCurveTo(9, my + h, 0, my + h); ctx.quadraticCurveTo(-9, my + h, -10, my - 2); ctx.closePath();
      ctx.fillStyle = T.mouth; ctx.fill(); ctx.save(); ctx.clip();
      ctx.beginPath(); ctx.ellipse(0, my + h, 7, 5, 0, 0, 7); ctx.fillStyle = T.tongue; ctx.fill();
      ctx.fillStyle = T.tooth; ctx.fillRect(-10, my - 3, 20, 4.6); if (prop) { ctx.fillStyle = T.mouth; ctx.fillRect(-1.2, my - 3, 2.6, 4.8); }
      ctx.restore();
    } else if (expr === 'shrug') { ctx.beginPath(); ctx.moveTo(-7, my + 1); ctx.quadraticCurveTo(0, my + 3, 8, my - 2); line(ctx, T.ink, 2.4, k); } // flat "eh"
    else { ctx.beginPath(); ctx.arc(0, my - 4, 8, Math.PI * 0.2, Math.PI * 0.8); line(ctx, T.ink, 2.4, k); } // small ready smile
    // per-look face details
    if (key === 'crest') { const y = expr === 'bow' || expr === 'whee' ? 11 : 13; ctx.beginPath(); ctx.moveTo(0, y - 3); ctx.bezierCurveTo(-6, y - 6, -15, y - 4, -15, y + 2); ctx.bezierCurveTo(-10, y + 1, -5, y + 3, 0, y + 1); ctx.bezierCurveTo(5, y + 3, 10, y + 1, 15, y + 2); ctx.bezierCurveTo(15, y - 4, 6, y - 6, 0, y - 3); ctx.closePath(); felt(ctx, L.hair, k); }
    if (key === 'curls') { [-10, 10].forEach((x) => { const s = Math.sign(x); ctx.beginPath(); ctx.moveTo(x - 7.5 * s, ey - 4); ctx.quadraticCurveTo(x, ey - 6.5, x + 9 * s, ey - 7.5); ctx.quadraticCurveTo(x + 8 * s, ey + 6.5, x, ey + 6.5); ctx.quadraticCurveTo(x - 8 * s, ey + 6, x - 7.5 * s, ey - 4); ctx.closePath(); line(ctx, T.jamRed, 2.4, k); }); ctx.beginPath(); ctx.moveTo(-3, ey - 2); ctx.quadraticCurveTo(0, ey - 4, 3, ey - 2); line(ctx, T.jamRed, 2.2, k); }
    if (key === 'tweed') { ctx.save(); ctx.beginPath(); ctx.ellipse(0, 2, 27, 31, 0, 0, 7); ctx.clip(); ctx.beginPath(); ctx.moveTo(-28, 8); ctx.quadraticCurveTo(-24, 36, 0, 36); ctx.quadraticCurveTo(24, 36, 28, 8); ctx.lineTo(28, 22); ctx.quadraticCurveTo(20, 28, 0, 28); ctx.quadraticCurveTo(-20, 28, -28, 22); ctx.closePath(); felt(ctx, L.hair, k, { shadow: false }); ctx.restore();
      if (expr === 'ready' || expr === 'shrug') { ctx.beginPath(); ctx.moveTo(-9, 18); ctx.quadraticCurveTo(0, 14, 9, 18); ctx.quadraticCurveTo(0, 22, -9, 18); ctx.closePath(); felt(ctx, L.hair, k); } }
    if (prop) [[-17, 13], [-13, 16], [-20, 16], [17, 13], [13, 16], [20, 16]].forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 1, 0, 7); ctx.fillStyle = '#9A5A3A'; ctx.fill(); });
    if (key === 'phones') { ctx.beginPath(); ctx.moveTo(-14, -18); ctx.bezierCurveTo(4, -20, 26, -18, 30, -6); ctx.bezierCurveTo(31, 2, 29, 8, 26, 10); ctx.bezierCurveTo(22, 0, 12, -6, 2, -8); ctx.bezierCurveTo(-4, -10, -10, -12, -14, -18); ctx.closePath(); felt(ctx, L.hair, k); ctx.beginPath(); ctx.moveTo(-6, -15); ctx.bezierCurveTo(8, -16, 22, -12, 27, 2); stitch(ctx, 'rgba(255,244,224,.35)', k, 1.2, [3, 3]); }
  }

  // ---------------------------------------------------------------- the helmet
  // Seat-colour felt dome (shell circle centre (0,-6), r 37), cream racing stripe, seat-deep rim + cream running stitch,
  // goggles PUSHED UP (never over the eyes), chin strap. Drawn back to front around the face.
  const A0 = Math.atan2(-6, 36), A1 = Math.atan2(-6, -36);
  function browPath(ctx) { ctx.beginPath(); ctx.moveTo(36, -12); ctx.arc(0, -6, 37, A0, A1, true); ctx.quadraticCurveTo(0, -24, 36, -12); ctx.closePath(); }
  // per-look helmet pieces: every member keeps their own silhouette on the helmet (identity never by colour alone)
  //   back: behind the shell, dropped with a photo (hair) | backAlways: behind, kept with a photo (helmet-level item)
  //   underBrow: hair under the rim, dropped with a photo | shell: on the shell (clipped) | peak/top: over the rim
  const FX = {
    bun: { back(ctx, L, k) { blob(ctx, 24, -40, 12, 11, 12, 0.8); felt(ctx, L.hair, k); ctx.save(); ctx.translate(24, -42); ctx.rotate(-0.5); ctx.fillStyle = T.star; ctx.fillRect(-22, -2.4, 34, 4.8); ctx.fillStyle = T.cheek; ctx.fillRect(-25, -2.4, 4, 4.8); ctx.beginPath(); ctx.moveTo(12, -2.4); ctx.lineTo(18, 0); ctx.lineTo(12, 2.4); ctx.fillStyle = T.wood; ctx.fill(); ctx.restore(); },
      underBrow(ctx, L, k) { ctx.beginPath(); ctx.moveTo(-27, -4); ctx.quadraticCurveTo(-22, -22, 0, -20); ctx.quadraticCurveTo(14, -20, 22, -10); ctx.quadraticCurveTo(6, -12, -27, -4); felt(ctx, L.hair, k); },
      front(ctx, L, k) { [-28, 28].forEach((x) => { ctx.beginPath(); ctx.arc(x, 22, 4.6, 0, 7); line(ctx, T.star, 2.4, k); }); } },
    crest: { backAlways(ctx, L, k) { ctx.beginPath(); ctx.moveTo(-16, -38); ctx.lineTo(-14, -56); ctx.quadraticCurveTo(0, -60, 14, -56); ctx.lineTo(16, -38); ctx.closePath(); felt(ctx, L.hair, k); ctx.beginPath(); ctx.moveTo(-9, -52); ctx.lineTo(9, -52); stitch(ctx, 'rgba(255,244,224,.5)', k, 1.4, [2.5, 2]); } },
    curls: { back(ctx, L, k) { [[-33, 6, 8], [-34, 18, 8], [-30, 28, 7], [33, 6, 8], [34, 18, 8], [30, 28, 7]].forEach(([x, y, r], i) => { blob(ctx, x, y, r, r, 30 + i, 0.6, 14); felt(ctx, L.hair, k); }); },
      underBrow(ctx, L, k) { [[-18, -14, 7], [-7, -17, 7], [5, -17, 7], [16, -14, 7]].forEach(([x, y, r], i) => { blob(ctx, x, y, r, r, 50 + i, 0.6, 12); felt(ctx, L.hair, k); }); },
      top(ctx, L, k) { flower(ctx, -27, -34, 8, k); } },
    tweed: { shell(ctx, L, s, k) { if (k * 54 < 56) return; for (let x = -40; x < 42; x += 8) { ctx.beginPath(); ctx.moveTo(x, -46); ctx.lineTo(x + 4, -8); stitch(ctx, 'rgba(255,244,224,.45)', k, 1.1, [2, 2]); } for (let y = -40; y < -10; y += 8) { ctx.beginPath(); ctx.moveTo(-40, y); ctx.lineTo(40, y + 2); stitch(ctx, 'rgba(42,26,18,.35)', k, 1.1, [2, 2]); } },
      peak(ctx, L, k) { ctx.beginPath(); ctx.moveTo(-28, -14); ctx.quadraticCurveTo(2, -26, 32, -13); ctx.quadraticCurveTo(10, -6, -28, -14); ctx.closePath(); felt(ctx, '#6E5E46', k); },
      back(ctx, L, k) { [-1, 1].forEach((d) => { blob(ctx, d * 31, 12, 6, 9, 60 + d, 0.8, 12); felt(ctx, L.hair, k); }); } },
    prop: { top(ctx, L, k) { ctx.beginPath(); ctx.moveTo(0, -42); ctx.lineTo(0, -52); line(ctx, T.ink, 2.4, k); ctx.beginPath(); ctx.ellipse(-10, -53, 10, 3.6, -0.12, 0, 7); felt(ctx, SEATS.teal.fill, k); ctx.beginPath(); ctx.ellipse(10, -53, 10, 3.6, 0.12, 0, 7); felt(ctx, SEATS.poppy.fill, k); ctx.beginPath(); ctx.arc(0, -52.5, 2.8, 0, 7); felt(ctx, T.star, k, { fibre: false }); } },
    phones: { back(ctx, L, k) { blob(ctx, 0, 14, 36, 22, 80, 1.4); felt(ctx, L.hair, k); },
      top(ctx, L, k) { ctx.beginPath(); ctx.arc(0, -6, 42, Math.PI * 1.06, Math.PI * 1.94); line(ctx, T.ink, 5.5, k); [-1, 1].forEach((d) => { ctx.beginPath(); ctx.roundRect(d * 39 - 7.5, -6, 15, 24, 6); felt(ctx, T.navy, k); ctx.beginPath(); ctx.roundRect(d * 39 - 3.5, -2, 7, 16, 3); felt(ctx, SEATS.teal.fill, k, { fibre: false }); }); } },
  };
  function flower(ctx, x, y, r, k) { for (let i = 0; i < 5; i++) { const a = i * Math.PI * 2 / 5; ctx.beginPath(); ctx.arc(x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6, r * 0.5, 0, 7); felt(ctx, T.cheek, k, { fibre: false }); } ctx.beginPath(); ctx.arc(x, y, r * 0.35, 0, 7); felt(ctx, T.star, k, { fibre: false }); }
  function helmetBack(ctx, L, s, k, o) {
    const F = FX[L.key]; if (F.back && !o.photo) F.back(ctx, L, k); if (F.backAlways) F.backAlways(ctx, L, k);
    if (o.knack === 'light') wings(ctx, k);
    ctx.beginPath(); ctx.arc(0, -6, 37, 0, 7); felt(ctx, o.knack === 'heavy' ? shade(s.fill, -0.18) : s.fill, k); // shell + side flaps
    if (o.knack === 'heavy') [-1, 1].forEach((d) => { ctx.beginPath(); ctx.arc(d * 35, 4, 9.5, 0, 7); felt(ctx, T.iron, k); ctx.beginPath(); ctx.moveTo(d * 35 - 4, 0); ctx.lineTo(d * 35 + 4, 8); ctx.moveTo(d * 35 + 4, 0); ctx.lineTo(d * 35 - 4, 8); line(ctx, T.ironLight, 1.8, k); });
  }
  function helmetFront(ctx, L, s, k, o) {
    const F = FX[L.key], shellCol = o.knack === 'heavy' ? shade(s.fill, -0.18) : s.fill;
    if (F.underBrow && !o.photo) F.underBrow(ctx, L, k);
    browPath(ctx); felt(ctx, shellCol, k);
    ctx.save(); browPath(ctx); ctx.clip(); ctx.fillStyle = T.cream; ctx.fillRect(-5, -50, 10, 40); if (F.shell) F.shell(ctx, L, s, k); ctx.restore(); // racing stripe
    ctx.beginPath(); ctx.moveTo(-36, -12); ctx.quadraticCurveTo(0, -24, 36, -12); line(ctx, s.deep, 3, k);
    ctx.beginPath(); ctx.moveTo(-32, -16.5); ctx.quadraticCurveTo(0, -27.5, 32, -16.5); stitch(ctx, T.cream, k, 1.5, [3.5, 2.8]);
    if (o.knack === 'heavy') { ctx.beginPath(); ctx.moveTo(-36, -12); ctx.quadraticCurveTo(0, -24, 36, -12); line(ctx, T.iron, 6.5, k); for (let i = -2; i <= 2; i++) { const t = (i + 2) / 4, x = -32 + 64 * t, y = -13 - 9.5 * (1 - (2 * t - 1) ** 2); ctx.beginPath(); ctx.arc(x, y, 1.7, 0, 7); ctx.fillStyle = T.ironLight; ctx.fill(); } }
    if (F.peak) F.peak(ctx, L, k);
    ctx.beginPath(); ctx.moveTo(-34, -24); ctx.quadraticCurveTo(0, -36, 34, -24); line(ctx, T.ink, 4.2, k); // goggle strap
    [-11, 11].forEach((x) => { ctx.beginPath(); ctx.arc(x, -30, 8.2, 0, 7); felt(ctx, T.lens, k, { fibre: false }); ctx.beginPath(); ctx.arc(x, -30, 8.2, 0, 7); line(ctx, T.cream, 2.6, k); ctx.beginPath(); ctx.arc(x - 2.6, -32.5, 2.2, 0, 7); ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fill(); });
    if (o.knack === 'bounce') bumper(ctx, k);
    if (F.top) F.top(ctx, L, k);
    [-1, 1].forEach((d) => { ctx.beginPath(); ctx.moveTo(d * 33, 8); ctx.quadraticCurveTo(d * 30, 32, d * 6, 36); line(ctx, T.ink, 2.2, k); }); // chin strap
    ctx.beginPath(); ctx.roundRect(-6, 33, 12, 6, 2); ctx.fillStyle = T.cream; ctx.fill();
    if (F.front && !o.photo) F.front(ctx, L, k);
  }
  // knack add-ons (never tied to a member: whoever is in the cannon wears them)
  function wings(ctx, k) { [-1, 1].forEach((d) => { ctx.save(); ctx.scale(d, 1); ctx.beginPath(); ctx.moveTo(30, -6); ctx.bezierCurveTo(44, -16, 52, -34, 50, -48); ctx.bezierCurveTo(46, -38, 40, -36, 44, -30); ctx.bezierCurveTo(38, -28, 36, -24, 40, -20); ctx.bezierCurveTo(36, -18, 34, -14, 31, -12); ctx.closePath(); felt(ctx, T.cream, k); ctx.beginPath(); ctx.moveTo(32, -9); ctx.quadraticCurveTo(42, -22, 48, -44); stitch(ctx, T.canvasDeep, k, 1.3, [2.5, 2]); ctx.restore(); }); }
  function bumper(ctx, k) { ctx.beginPath(); ctx.arc(0, -6, 39, Math.PI * 0.86, Math.PI * 2.14); line(ctx, T.cream, 7.5, k); ctx.save(); ctx.setLineDash([7, 7]); ctx.beginPath(); ctx.arc(0, -6, 39, Math.PI * 0.86, Math.PI * 2.14); ctx.strokeStyle = SEATS.poppy.fill; ctx.lineWidth = 7.5; ctx.stroke(); ctx.restore(); ctx.beginPath(); ctx.arc(0, -6, 35, Math.PI * 0.9, Math.PI * 2.1); line(ctx, 'rgba(42,26,18,.35)', 1.2, k); }

  // ---------------------------------------------------------------- the die-cut photo sticker (full colour)
  // photo: a canvas/ImageBitmap (192 px); crop: {cx, cy, r} = the guide circle chosen in the sheet (photo px).
  function sticker(ctx, photo, crop, k) {
    const R = 31, sc = R / crop.r;
    ctx.save(); ctx.shadowColor = 'rgba(30,8,4,.35)'; ctx.shadowBlur = 3 * k; ctx.shadowOffsetY = 1.6 * k;
    ctx.beginPath(); ctx.arc(0, 2, R + 3.6, 0, 7); ctx.fillStyle = T.white; ctx.fill(); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.arc(0, 2, R, 0, 7); ctx.clip();
    ctx.drawImage(photo, -crop.cx * sc, 2 - crop.cy * sc, photo.width * sc, photo.height * sc); ctx.restore();
    ctx.beginPath(); ctx.arc(0, 2, R + 3.6, 0, 7); line(ctx, 'rgba(42,26,18,.18)', 0.8, k);
  }

  // ---------------------------------------------------------------- head + body
  const mem = (o) => o.m || CAST[0];
  // head unit: o = { m, size (face px), expr, knack, photo, crop, tilt }. The face is never rotated in flight.
  function head(ctx, x, y, o) {
    const m = mem(o), L = LOOKS[m.look], s = SEATS[m.colour], k = o.size / 54, photo = o.photo ?? m.photo;
    ctx.save(); ctx.translate(x, y); ctx.rotate(o.tilt || 0); ctx.scale(k, k);
    const oo = { ...o, photo };
    helmetBack(ctx, L, s, k, oo);
    if (photo) sticker(ctx, photo, o.crop || m.crop || { cx: photo.width / 2, cy: photo.height / 2, r: photo.width * 0.3 }, k); else face(ctx, m.look, o.expr || 'ready', k);
    helmetFront(ctx, L, s, k, oo);
    ctx.restore();
  }
  function limb(ctx, pts, col, w, k) { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); line(ctx, col, w, k); }
  function dot(ctx, x, y, r, col, k) { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); felt(ctx, col, k, { fibre: false }); }
  // stunt suit: seat-colour felt, cream star on the chest, seat-deep belt with a cream stitch
  function torso(ctx, a, b, s, k) {
    ctx.save(); ctx.shadowColor = 'rgba(30,8,4,.3)'; ctx.shadowBlur = 2 * k; ctx.shadowOffsetY = 1.2 * k; limb(ctx, [a, b], s.fill, 30, k); ctx.restore();
    const ux = b[0] - a[0], uy = b[1] - a[1], Ln = Math.hypot(ux, uy), nx = -uy / Ln, ny = ux / Ln;
    const bx = a[0] + ux * 0.78, by = a[1] + uy * 0.78; ctx.beginPath(); ctx.moveTo(bx - nx * 14, by - ny * 14); ctx.lineTo(bx + nx * 14, by + ny * 14); line(ctx, s.deep, 5, k);
    ctx.beginPath(); ctx.moveTo(bx - nx * 13, by - ny * 13); ctx.lineTo(bx + nx * 13, by + ny * 13); stitch(ctx, T.cream, k, 1.2, [2.4, 2]);
    starPath(ctx, a[0] + ux * 0.38, a[1] + uy * 0.38, 7.5); felt(ctx, T.cream, k, { fibre: false });
  }
  // pose: loaded | flight | bow | shrug. (x, y) is always the FACE centre, so face sizes compare across poses.
  //   o.va = flight direction (radians, screen), o.trail = draw the short stitch trail, o.muzzle = draw the muzzle lip
  //   o.pinStar = pin a felt star on the chest (curtain call: this member didn't need to fly)
  function flyer(ctx, x, y, o) {
    const m = mem(o), s = SEATS[m.colour], k = o.size / 54, pose = o.pose || 'loaded';
    const expr = o.expr || { loaded: 'ready', flight: 'whee', bow: 'bow', shrug: 'shrug' }[pose];
    ctx.save(); ctx.translate(x, y); ctx.scale(k, k);
    const glove = T.cream, boot = T.ink; let tilt = 0, chest = [0, 47];
    if (pose === 'flight') {
      const va = o.va ?? -0.5, vx = Math.cos(va), vy = Math.sin(va), n = [0, 34], hip = [n[0] - vx * 46, n[1] - vy * 46 + 6];
      if (o.trail !== false) for (let i = 0; i < 3; i++) { const off = (i - 1) * 14; ctx.beginPath(); ctx.moveTo(hip[0] - vx * 30 + vy * off, hip[1] - vy * 30 - vx * off + 20); ctx.lineTo(hip[0] - vx * 70 + vy * off, hip[1] - vy * 70 - vx * off + 20); stitch(ctx, 'rgba(255,244,224,.8)', k, 2, [6, 5]); }
      [-0.16, 0.16].forEach((sp) => { const c = Math.cos(va + sp), d = Math.sin(va + sp); const knee = [hip[0] - c * 22, hip[1] - d * 22 + 4], ft = [hip[0] - c * 42, hip[1] - d * 42 + 8]; limb(ctx, [hip, knee, ft], s.deep, 12, k); dot(ctx, ft[0], ft[1], 7.5, boot, k); });
      torso(ctx, n, hip, s, k);
      [[-6, 0.1], [6, 0.32]].forEach(([dy, sp]) => { const sh = [n[0] + 6, n[1] + 2 + dy * 0.3], h = [sh[0] + Math.cos(va + sp) * 66, sh[1] + Math.sin(va + sp) * 66 + dy]; limb(ctx, [sh, h], s.fill, 10, k); dot(ctx, h[0], h[1], 6.5, glove, k); });
    } else if (pose === 'loaded') { // shoulders out of the muzzle, one glove waving
      const n = [0, 34]; torso(ctx, n, [0, 70], s, k);
      limb(ctx, [[14, 42], [36, 22], [40, -6]], s.fill, 10, k); dot(ctx, 40, -8, 6.5, glove, k);
      limb(ctx, [[-14, 42], [-30, 52]], s.fill, 10, k);
      if (o.muzzle !== false) { ctx.beginPath(); ctx.ellipse(0, 56, 42, 13, 0, 0, 7); felt(ctx, T.navy, k); ctx.beginPath(); ctx.ellipse(0, 56, 42, 13, 0, 0, 7); line(ctx, T.cream, 3, k); ctx.beginPath(); ctx.ellipse(0, 56, 36, 9, 0, 0, 7); stitch(ctx, T.cream, k, 1.4, [3, 2.6]); ctx.beginPath(); ctx.rect(-42, 56, 84, 26); felt(ctx, T.navy, k); }
    } else if (pose === 'bow') { // leans into a bow: one arm across the waist, one out
      tilt = 0.45; const n = [-Math.sin(tilt) * 34, Math.cos(tilt) * 34], hip = [n[0] - 30, n[1] + 34]; chest = [n[0] - 11, n[1] + 13];
      [-7, 7].forEach((d) => { const ft = [hip[0] + d, hip[1] + 46]; limb(ctx, [hip, [hip[0] + d * 0.6, hip[1] + 24], ft], s.deep, 12, k); dot(ctx, ft[0] + 3, ft[1] + 2, 7.5, boot, k); });
      limb(ctx, [[n[0] - 10, n[1] + 6], [n[0] - 40, n[1] + 6], [n[0] - 58, n[1] - 10]], s.fill, 10, k); dot(ctx, n[0] - 60, n[1] - 12, 6.5, glove, k);
      torso(ctx, n, hip, s, k);
      limb(ctx, [[n[0] - 2, n[1] + 8], [n[0] - 4, n[1] + 30], [n[0] - 16, n[1] + 34]], s.fill, 10, k); dot(ctx, n[0] - 16, n[1] + 34, 6.5, glove, k);
    } else if (pose === 'shrug') { // palms up, shoulders up
      tilt = -0.12; const n = [-2, 32], hip = [-2, 76]; chest = [-2, 49];
      [-8, 8].forEach((d) => { const ft = [hip[0] + d * 1.4, hip[1] + 46]; limb(ctx, [hip, [hip[0] + d, hip[1] + 24], ft], s.deep, 12, k); dot(ctx, ft[0], ft[1] + 2, 7.5, boot, k); });
      torso(ctx, n, hip, s, k);
      [-1, 1].forEach((d) => { const sh = [n[0] + d * 12, n[1] + 2], el = [n[0] + d * 30, n[1] + 26], h = [n[0] + d * 44, n[1] + 6]; limb(ctx, [sh, el, h], s.fill, 10, k); dot(ctx, h[0], h[1], 6.5, glove, k); });
    }
    if (o.pinStar) feltStar(ctx, chest[0] + 6, chest[1] - 2, 13, true, k);
    ctx.restore();
    head(ctx, x, y, { ...o, m, expr, tilt: pose === 'flight' ? 0 : tilt }); // face upright in flight, always
  }

  // ---------------------------------------------------------------- targets (all circles in the physics)
  // TINS are drawn END-ON so they don't read as balls: a light rolled metal rim, a painted lid with a pressed rib ring,
  // a ring-pull, a flat highlight on the rim only (a ball would have a round glossy spot; a tin never does).
  // o.band = the fallback if the S1 feel check says "balls": a cream side label band across the lid.
  function tin(ctx, x, y, r, col, k = 1, o = {}) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(o.rot || 0); const kk = k * r / 16;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); felt(ctx, T.tinRim, kk, { fibre: false });                   // rolled rim
    ctx.beginPath(); ctx.arc(0, 0, r, Math.PI * 1.08, Math.PI * 1.62); line(ctx, 'rgba(255,255,255,.75)', r * 0.08, k); // flat rim highlight
    ctx.beginPath(); ctx.arc(0, 0, r * 0.8, 0, 7); felt(ctx, col, kk, { shadow: false });                     // painted lid
    ctx.beginPath(); ctx.arc(0, 0, r * 0.8, 0, 7); line(ctx, T.tinRimDeep, r * 0.06, k);                      // the seam
    ctx.beginPath(); ctx.arc(0, r * 0.03, r * 0.56, 0, 7); line(ctx, 'rgba(255,255,255,.35)', r * 0.05, k);   // pressed rib (lit edge)
    ctx.beginPath(); ctx.arc(0, -r * 0.02, r * 0.56, 0, 7); line(ctx, shade(col, -0.3), r * 0.05, k);        //   ... and its shadow edge
    if (o.band) { ctx.save(); ctx.beginPath(); ctx.arc(0, 0, r * 0.8, 0, 7); ctx.clip(); ctx.fillStyle = T.cream; ctx.fillRect(-r, -r * 0.2, 2 * r, r * 0.4); ctx.beginPath(); ctx.moveTo(-r, -r * 0.13); ctx.lineTo(r, -r * 0.13); ctx.moveTo(-r, r * 0.13); ctx.lineTo(r, r * 0.13); stitch(ctx, col, k, r * 0.04, [r * 0.12, r * 0.08]); ctx.restore(); }
    // ring-pull: a rivet near the centre, the loop lying toward the top of the lid
    ctx.beginPath(); ctx.ellipse(0, -r * 0.3, r * 0.17, r * 0.26, 0, 0, 7); line(ctx, T.tinRim, r * 0.1, k);
    ctx.beginPath(); ctx.ellipse(0, -r * 0.3, r * 0.17, r * 0.26, 0, 0, 7); line(ctx, 'rgba(42,26,18,.3)', r * 0.025, k);
    ctx.beginPath(); ctx.arc(0, r * 0.02, r * 0.1, 0, 7); ctx.fillStyle = T.tinRim; ctx.fill(); ctx.beginPath(); ctx.arc(0, r * 0.02, r * 0.1, 0, 7); line(ctx, T.tinRimDeep, r * 0.03, k);
    ctx.restore();
  }
  // JAM JARS: jam-dye glass body, a gingham felt lid with a frilled edge and a tied string, a cream label patch.
  // Everything sits inside r (the collider), so stacked jars never overlap visually.
  function jar(ctx, x, y, r, col, k = 1, o = {}) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(o.rot || 0); const kk = k * r / 16;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); felt(ctx, col, kk);
    ctx.beginPath(); ctx.arc(0, 0, r * 0.82, Math.PI * 0.62, Math.PI * 1.02); line(ctx, 'rgba(255,255,255,.45)', r * 0.1, k); // glass shine (a vertical streak)
    ctx.save(); ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.clip();
    const lidY = -r * 0.42; ctx.fillStyle = T.cream; ctx.fillRect(-r, -r, 2 * r, r + lidY);
    ctx.fillStyle = T.jamLid; ctx.globalAlpha = 0.85; for (let i = -4; i <= 4; i += 2) ctx.fillRect(i * r * 0.18, -r, r * 0.18, r + lidY);
    ctx.globalAlpha = 0.45; for (let j = 0; j < 4; j += 2) ctx.fillRect(-r, -r + j * r * 0.16 + r * 0.04, 2 * r, r * 0.16); ctx.globalAlpha = 1;
    ctx.restore();
    ctx.beginPath(); const n = 7; for (let i = 0; i <= n; i++) { const t = i / n, px = -r * 0.92 + t * r * 1.84; ctx.arc(px, lidY + Math.abs(px) * 0.08, r * 0.14, 0, Math.PI, false); } // frill
    ctx.fillStyle = T.cream; ctx.fill();
    ctx.beginPath(); ctx.moveTo(-r * 0.93, lidY - r * 0.02); ctx.quadraticCurveTo(0, lidY + r * 0.06, r * 0.93, lidY - r * 0.02); stitch(ctx, T.ink, k, r * 0.05, [r * 0.1, r * 0.07]); // string
    ctx.beginPath(); ctx.roundRect(-r * 0.42, r * 0.02, r * 0.84, r * 0.48, r * 0.1); felt(ctx, T.cream, kk, { fibre: false, shadow: false }); // label
    ctx.beginPath(); ctx.arc(0, r * 0.26, r * 0.12, 0, 7); ctx.fillStyle = col; ctx.fill();
    ctx.restore();
  }
  // STONES: obstacles, never targets. A lumpy grey felt pebble with a stitched crack and specks.
  function stone(ctx, x, y, r, seed = 5, k = 1) {
    ctx.save(); const kk = k * r / 16; blob(ctx, x, y, r, r * 0.94, seed, r * 0.18, 14); felt(ctx, T.stone, kk);
    blob(ctx, x + r * 0.08, y + r * 0.12, r * 0.78, r * 0.7, seed + 1, r * 0.1, 12); ctx.fillStyle = 'rgba(97,90,82,.35)'; ctx.fill();
    const rr = rng(seed); for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(x + (rr() - 0.5) * r, y + (rr() - 0.5) * r, r * 0.05, 0, 7); ctx.fillStyle = 'rgba(42,26,18,.35)'; ctx.fill(); }
    ctx.beginPath(); ctx.moveTo(x - r * 0.4, y - r * 0.3); ctx.lineTo(x - r * 0.05, y); ctx.lineTo(x + r * 0.3, y - r * 0.1); stitch(ctx, 'rgba(42,26,18,.5)', k, r * 0.08, [r * 0.15, r * 0.12]);
    ctx.restore();
  }
  // a stone cracked by the Heavy helmet: 3 felt chips flying apart, t = 0..1 over ~0.5 s (then they leave the world)
  function chips(ctx, x, y, r, t, seed = 5, k = 1) {
    const rr = rng(seed); ctx.save(); ctx.globalAlpha = 1 - Math.max(0, t - 0.6) / 0.4;
    for (let i = 0; i < 3; i++) { const a = -Math.PI / 2 + (i - 1) * 1.1 + (rr() - 0.5) * 0.3, d = r * (0.3 + t * 1.6), g = r * 2.2 * t * t;
      ctx.save(); ctx.translate(x + Math.cos(a) * d, y + Math.sin(a) * d + g); ctx.rotate(t * (i - 1) * 3); blob(ctx, 0, 0, r * 0.5, r * 0.4, seed + 10 + i, r * 0.2, 8); felt(ctx, i === 1 ? T.stoneDeep : T.stone, k); ctx.restore(); }
    ctx.restore();
  }

  // ---------------------------------------------------------------- wood: ledges, planks
  function woodRect(ctx, x, y, w, h, r, k = 1) {
    ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.shadowColor = 'rgba(20,6,4,.45)'; ctx.shadowBlur = 8 * k; ctx.shadowOffsetY = 3 * k; ctx.fillStyle = T.wood; ctx.fill(); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.clip(); const rr = rng(Math.round(x * 7 + y));
    for (let i = 0; i < (w + h) / 9; i++) { const yy = y + rr() * h, xx = x + rr() * w; ctx.strokeStyle = rr() < 0.5 ? 'rgba(126,80,40,.35)' : 'rgba(215,164,108,.35)'; ctx.lineWidth = Math.max(1, 1 / k); ctx.beginPath(); if (w > h) { ctx.moveTo(xx - 40, yy); ctx.bezierCurveTo(xx - 10, yy - 2, xx + 10, yy + 2, xx + 50, yy); } else { ctx.moveTo(xx, yy - 40); ctx.bezierCurveTo(xx - 2, yy - 10, xx + 2, yy + 10, xx, yy + 50); } ctx.stroke(); }
    ctx.restore();
  }
  // a LEDGE: a wooden plank (top at y, 12 thick) on two posts down to floorY. Tins rest on y.
  function ledge(ctx, x, y, w, floorY, k = 1) {
    if (floorY > y + 12) [x + 12, x + w - 22].forEach((px) => woodRect(ctx, px, y + 8, 10, floorY - y - 8, 3, k));
    woodRect(ctx, x, y, w, 12, 4, k); ctx.beginPath(); ctx.moveTo(x + 6, y + 6); ctx.lineTo(x + w - 6, y + 6); stitch(ctx, 'rgba(255,244,224,.6)', k, 1.4, [5, 4]);
  }
  // a PLANK: a ledge on a pivot. (px, py) = the pivot (top surface level), w = length, dir = +1 extends right, -1 left,
  // ang = 0 flat .. PI/2 swung down (the 0.25 s rule swing). The navy-and-cream end band + the iron hinge say "this one
  // moves" before it ever does.
  function plank(ctx, px, py, w, dir = 1, ang = 0, floorY = null, k = 1) {
    if (floorY != null) woodRect(ctx, px - 5, py + 6, 10, floorY - py - 6, 3, k);
    ctx.save(); ctx.translate(px, py); ctx.rotate(dir * ang); ctx.scale(dir, 1);
    woodRect(ctx, -6, 0, w + 6, 12, 4, k);
    ctx.save(); ctx.beginPath(); ctx.roundRect(-6, 0, w + 6, 12, 4); ctx.clip(); for (let i = 0; i < 4; i++) { ctx.fillStyle = i % 2 ? T.cream : T.navy; ctx.fillRect(w - 28 + i * 7, 0, 7, 12); } ctx.restore();
    ctx.beginPath(); ctx.moveTo(4, 6); ctx.lineTo(w - 32, 6); stitch(ctx, 'rgba(255,244,224,.6)', k, 1.4, [5, 4]);
    ctx.restore();
    ctx.beginPath(); ctx.arc(px, py + 6, 7.5, 0, 7); felt(ctx, T.iron, k, { fibre: false }); ctx.beginPath(); ctx.arc(px, py + 6, 3, 0, 7); ctx.fillStyle = T.ironLight; ctx.fill(); // hinge pin
  }

  // ---------------------------------------------------------------- the cannon + the 15 s fuse
  // (x, y) = the wheel axle. ang = barrel angle (screen radians, -0.17 .. -1.4 for 10..80 deg), len = barrel length.
  // o.fuse = 0..1 left (null = no fuse shown), o.t = seconds (spark flicker), o.k = world->px scale.
  // The fuse is a cream cord ring on the breech that burns down clockwise from 12 o'clock, with a short cord tail and a
  // spark at the burning end. Last third (5 s): the spark grows and fizzes (6 felt sparks).
  function muzzle(x, y, ang, len) { return [x + Math.cos(ang) * (len + 10), y + Math.sin(ang) * (len + 10)]; }
  function cannon(ctx, x, y, ang, len, o = {}) {
    const k = o.k || 1; ctx.save(); ctx.translate(x, y);
    ctx.save(); ctx.rotate(ang); const bw = 46;
    ctx.beginPath(); ctx.moveTo(-14, -bw / 2 + 4); ctx.lineTo(len, -bw / 2); ctx.lineTo(len, bw / 2); ctx.lineTo(-14, bw / 2 - 4); ctx.quadraticCurveTo(-34, 0, -14, -bw / 2 + 4); ctx.closePath(); felt(ctx, T.navy, k);
    ctx.beginPath(); ctx.moveTo(-14, bw / 2 - 4); ctx.lineTo(len, bw / 2); ctx.lineTo(len, bw / 2 - 10); ctx.lineTo(-14, bw / 2 - 12); ctx.closePath(); ctx.fillStyle = 'rgba(23,34,64,.6)'; ctx.fill(); // shadow side
    [len * 0.35, len * 0.7].forEach((bx) => { ctx.beginPath(); ctx.rect(bx, -bw / 2 - 1, 9, bw + 2); felt(ctx, T.cream, k, { fibre: false }); });
    ctx.beginPath(); ctx.roundRect(len - 6, -bw / 2 - 5, 16, bw + 10, 5); felt(ctx, T.navyLight, k); ctx.beginPath(); ctx.roundRect(len - 3, -bw / 2 - 2, 10, bw + 4, 3); stitch(ctx, T.cream, k, 1.4, [3, 2.5]);
    starPath(ctx, len * 0.53, 0, 9); felt(ctx, T.star, k, { fibre: false });
    ctx.beginPath(); ctx.moveTo(-10, -bw / 2 + 8); ctx.lineTo(len - 8, -bw / 2 + 5); stitch(ctx, 'rgba(255,244,224,.5)', k, 1.4, [5, 4]);
    ctx.restore();
    woodRect(ctx, -40, 18, 74, 22, 8, k); // carriage + wheel
    ctx.beginPath(); ctx.arc(-6, 40, 24, 0, 7); felt(ctx, T.woodDeep, k); ctx.beginPath(); ctx.arc(-6, 40, 18, 0, 7); line(ctx, T.wood, 3, k);
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; ctx.beginPath(); ctx.moveTo(-6, 40); ctx.lineTo(-6 + Math.cos(a) * 18, 40 + Math.sin(a) * 18); line(ctx, T.wood, 2.6, k); }
    ctx.beginPath(); ctx.arc(-6, 40, 5, 0, 7); felt(ctx, T.cream, k, { fibre: false });
    if (o.fuse != null) fuse(ctx, -30, -14, 14, o.fuse, o.t || 0, k);
    ctx.restore();
  }
  // the LOADED member in a real (angled) barrel: shoulders out of the muzzle along the barrel axis, one glove
  // waving, the head upright on top, the muzzle lip drawn over the suit so they sit IN the cannon. Draw after cannon().
  // o = flyer options (m, size >= 56, knack, photo, crop). Returns the face centre (for the face-size checks).
  function loaded(ctx, x, y, ang, len, o) {
    const m = mem(o), s = SEATS[m.colour], k = o.size / 54, d = [Math.cos(ang), Math.sin(ang)], M = muzzle(x, y, ang, len - 4);
    const N = [M[0] + d[0] * 20 * k, M[1] + d[1] * 20 * k], F = [N[0], N[1] - 34 * k];
    ctx.save(); ctx.shadowColor = 'rgba(30,8,4,.3)'; ctx.shadowBlur = 2 * k; ctx.shadowOffsetY = 1.2 * k;
    ctx.beginPath(); ctx.moveTo(N[0], N[1]); ctx.lineTo(M[0] - d[0] * 8, M[1] - d[1] * 8); line(ctx, s.fill, 30 * k, 1); ctx.restore();
    starPath(ctx, N[0] + d[0] * -6 * k, N[1] + d[1] * -6 * k + 6 * k, 7.5 * k); felt(ctx, T.cream, 1, { fibre: false });
    ctx.save(); ctx.translate(M[0], M[1]); ctx.rotate(ang + Math.PI / 2);                                  // the muzzle lip
    ctx.beginPath(); ctx.ellipse(0, 0, 26, 8, 0, 0, Math.PI); felt(ctx, T.navyLight, 1); ctx.beginPath(); ctx.ellipse(0, 0, 26, 8, 0, 0, Math.PI); line(ctx, T.cream, 2.4, 1); ctx.restore();
    const S = [N[0] + 12 * k, N[1] + 4 * k]; ctx.beginPath(); ctx.moveTo(S[0], S[1]); ctx.lineTo(S[0] + 22 * k, S[1] - 16 * k); ctx.lineTo(S[0] + 27 * k, S[1] - 44 * k); line(ctx, s.fill, 10 * k, 1); // waving arm
    ctx.beginPath(); ctx.arc(S[0] + 27 * k, S[1] - 46 * k, 6.5 * k, 0, 7); felt(ctx, T.cream, 1, { fibre: false });
    head(ctx, F[0], F[1], { ...o, m, expr: o.expr || 'ready' });
    return F;
  }
  function fuse(ctx, fx, fy, R, left, t, k = 1) {
    const a0 = -Math.PI / 2, ea = a0 + Math.PI * 2 * (1 - left);
    ctx.beginPath(); ctx.arc(fx, fy, R + 4, 0, 7); felt(ctx, T.navyDeep, k, { fibre: false });               // the breech boss
    ctx.beginPath(); ctx.arc(fx, fy, R, a0, ea); ctx.strokeStyle = 'rgba(42,26,18,.85)'; ctx.lineWidth = 4.2; ctx.setLineDash([2, 3]); ctx.stroke(); ctx.setLineDash([]); // burnt: charred dashes
    if (left > 0) { ctx.beginPath(); ctx.arc(fx, fy, R, ea, a0 + Math.PI * 2); line(ctx, T.cream, 4.2, k);       // unburnt cord
      ctx.beginPath(); ctx.arc(fx, fy, R, ea, a0 + Math.PI * 2); stitch(ctx, T.canvasDeep, k, 1.3, [2, 3]); }  //   with its twist
    ctx.beginPath(); ctx.moveTo(fx - R * 0.7, fy - R * 0.7); ctx.quadraticCurveTo(fx - R * 1.5, fy - R * 1.2, fx - R * 1.4, fy - R * 2); line(ctx, left > 0 ? T.cream : 'rgba(42,26,18,.8)', 3, k); // cord tail
    if (left > 0) { const fizz = left < 1 / 3, fl = 0.85 + 0.15 * Math.sin(t * 40), r = (fizz ? 8.5 : 6) * fl;
      const sx = fx + Math.cos(ea) * R, sy = fy + Math.sin(ea) * R; spark(ctx, sx, sy, r, t);
      if (fizz) { const rr = rng(Math.floor(t * 20) + 3); for (let i = 0; i < 6; i++) { const a = rr() * Math.PI * 2, d = 6 + rr() * 12; ctx.beginPath(); ctx.arc(sx + Math.cos(a) * d, sy + Math.sin(a) * d, 1.2 + rr() * 1.4, 0, 7); ctx.fillStyle = rr() < 0.5 ? T.star : T.cream; ctx.fill(); } } }
  }
  function spark(ctx, x, y, r, t = 0) { ctx.save(); ctx.translate(x, y); ctx.rotate(t * 6); ctx.beginPath(); for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6, rr = i % 2 ? r * 0.45 : r; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } ctx.closePath(); ctx.fillStyle = T.star; ctx.fill(); ctx.beginPath(); ctx.arc(0, 0, r * 0.32, 0, 7); ctx.fillStyle = T.cream; ctx.fill(); ctx.restore(); }
  // the felt smoke puff from the muzzle (t = 0..1 over ~0.4 s; cut item 2)
  function puff(ctx, x, y, t, k = 1) { ctx.save(); ctx.globalAlpha = 1 - t; [[0, 0, 14], [14, -8, 10], [-10, -10, 9], [6, 10, 8]].forEach(([dx, dy, r], i) => { blob(ctx, x + dx * (1 + t), y + dy * (1 + t) - t * 10, r * (0.6 + t * 0.7), r * (0.55 + t * 0.6), 40 + i, 2); felt(ctx, 'rgba(255,244,224,.88)', k, { fibre: false }); }); ctx.restore(); }

  // ---------------------------------------------------------------- THE SIGNATURE: the running-stitch aim line
  // Cream thread in running stitches over the first frac of the arc (0.35-0.40; 1.0 on levels 1-3) with a felt
  // needle and a loose thread tail at the leading end. pts = [[x, y], ...] (the arc samples, world units).
  // k = world->CSS-px scale: the stitch is 6 px wide, 11 on / 7 off, in SCREEN px at every scale.
  function aimStitch(ctx, pts, frac, o = {}) {
    const k = o.k || 1, n = Math.max(2, Math.round(pts.length * frac)), seg = pts.slice(0, n);
    ctx.save(); ctx.lineCap = 'round';
    ctx.beginPath(); seg.forEach(([x, y], i) => (i ? ctx.lineTo(x + 1 / k, y + 2 / k) : ctx.moveTo(x + 1 / k, y + 2 / k))); ctx.setLineDash([11 / k, 7 / k]); ctx.strokeStyle = 'rgba(20,6,4,.45)'; ctx.lineWidth = 6 / k; ctx.stroke();
    ctx.beginPath(); seg.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.strokeStyle = o.col || T.cream; ctx.lineWidth = 6 / k; ctx.stroke();
    ctx.setLineDash([]); ctx.restore();
    const [ax, ay] = seg[n - 2], [bx, by] = seg[n - 1], a = Math.atan2(by - ay, bx - ax);
    ctx.save(); ctx.translate(bx, by); ctx.rotate(a); ctx.scale(1.5 / k, 1.5 / k);
    ctx.beginPath(); ctx.moveTo(4, -2.6); ctx.lineTo(30, -0.8); ctx.lineTo(38, 0); ctx.lineTo(30, 0.8); ctx.lineTo(4, 2.6); ctx.quadraticCurveTo(0, 0, 4, -2.6); ctx.closePath();
    ctx.shadowColor = 'rgba(20,6,4,.4)'; ctx.shadowBlur = 3; ctx.shadowOffsetY = 1.5; ctx.fillStyle = T.needle; ctx.fill(); ctx.shadowColor = 'transparent';
    ctx.beginPath(); ctx.ellipse(8, 0, 3.2, 1.1, 0, 0, 7); ctx.fillStyle = T.ink; ctx.fill(); // the eye
    ctx.beginPath(); ctx.moveTo(4, -1.5); ctx.lineTo(30, -0.5); ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 0.8; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(8, 0); ctx.bezierCurveTo(2, 10, -10, 12, -16, 6); ctx.strokeStyle = o.col || T.cream; ctx.lineWidth = 2; ctx.stroke(); // thread tail
    ctx.restore();
  }
  // the sewn trail: stitches itself in behind the flyer and stays until the next member loads (3 px, 9 on / 7 off)
  function trail(ctx, pts, o = {}) { const k = o.k || 1; if (pts.length < 2) return; ctx.save(); ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.lineCap = 'round'; ctx.setLineDash([9 / k, 7 / k]); ctx.lineDashOffset = o.offset || 0; ctx.strokeStyle = 'rgba(255,244,224,.92)'; ctx.lineWidth = 3 / k; ctx.stroke(); ctx.restore(); }
  function arc(x0, y0, ang, v, g, steps, dt) { const pts = []; let x = x0, y = y0, vx = Math.cos(ang) * v, vy = Math.sin(ang) * v; for (let i = 0; i < steps; i++) { pts.push([x, y]); x += vx * dt; y += vy * dt; vy += g * dt; } return pts; }
  // the pull-back cue: the dotted start ring, the dotted pull thread and the felt finger ring (demo + live drag)
  function pullCue(ctx, s0, f, k = 1) {
    ctx.beginPath(); ctx.arc(s0[0], s0[1], 18 / k, 0, 7); stitch(ctx, 'rgba(255,244,224,.75)', k, 2 / k, [4 / k, 4 / k]);
    ctx.beginPath(); ctx.moveTo(...s0); ctx.lineTo(...f); stitch(ctx, 'rgba(255,244,224,.6)', k, 2 / k, [3 / k, 5 / k]);
    ctx.beginPath(); ctx.arc(f[0], f[1], 22 / k, 0, 7); ctx.fillStyle = 'rgba(255,244,224,.28)'; ctx.fill(); ctx.beginPath(); ctx.arc(f[0], f[1], 22 / k, 0, 7); line(ctx, T.cream, 2.4 / k, k);
  }

  // the first-run demo's felt hand: a cream felt mitten, index finger out, pressed (down = true) or lifted
  function hand(ctx, x, y, down = false, k = 1) {
    ctx.save(); ctx.translate(x, y); ctx.scale(1 / k, 1 / k); ctx.rotate(-0.35); const s = down ? 0.92 : 1; ctx.scale(s, s);
    ctx.beginPath(); ctx.roundRect(-5, -2, 10, 26, 5); felt(ctx, T.cream, 1, { fibre: false });               // finger
    blob(ctx, 4, 30, 15, 14, 21, 1.2, 14); felt(ctx, T.cream, 1, { fibre: false });                            // mitten
    ctx.beginPath(); ctx.ellipse(-10, 28, 5, 8, -0.5, 0, 7); felt(ctx, T.cream, 1, { fibre: false });          // thumb
    ctx.beginPath(); ctx.roundRect(-9, 40, 26, 9, 3); felt(ctx, T.tent, 1, { fibre: false });                   // cuff
    ctx.beginPath(); ctx.moveTo(-7, 44.5); ctx.lineTo(15, 44.5); stitch(ctx, T.cream, 1, 1.2, [2.5, 2]);
    ctx.beginPath(); blob(ctx, 4, 30, 11, 10, 22, 0.8, 12); stitch(ctx, 'rgba(138,51,36,.45)', 1, 1, [2.5, 2]);
    if (down) { ctx.beginPath(); ctx.arc(0, -6, 12, 0, 7); line(ctx, 'rgba(255,244,224,.7)', 2, 1); }
    ctx.restore();
  }

  // ---------------------------------------------------------------- the safety net (always on screen)
  // cream thread diamonds sagging between two striped poles. sag = the dip at the middle (rest 10-16, hit up to 34,
  // then a damped rebound: sag(t) = rest + A e^(-6t) cos(14t)). hitX = where the flyer landed (0..1) for an off-centre dip.
  function net(ctx, x0, x1, y, sag, o = {}) {
    const k = o.k || 1, hx = o.hitX ?? 0.5;
    [x0 + 6, x1 - 6].forEach((px) => { ctx.save(); ctx.beginPath(); ctx.roundRect(px - 5, y - 26, 10, 56, 4); felt(ctx, T.cream, k, { fibre: false }); ctx.clip(); ctx.fillStyle = T.netPole; for (let i = 0; i < 6; i++) ctx.fillRect(px - 6, y - 26 + i * 12, 12, 6); ctx.restore(); });
    const D = (t) => (t < hx ? t / hx : (1 - t) / (1 - hx)), Y = (t) => y + sag * Math.sin(Math.PI / 2 * D(t)) ** 1.4 * (t > 0 && t < 1 ? 1 : 0), N = Math.max(12, Math.round((x1 - x0) / 22));
    ctx.save(); ctx.strokeStyle = 'rgba(255,244,224,.85)'; ctx.lineWidth = Math.max(1.6, 1.2 / k); const depth = 26;
    for (let r = 1; r < 4; r++) { ctx.beginPath(); for (let i = 0; i <= N; i++) { const t = i / N, px = x0 + (x1 - x0) * t, py = Y(t) + r * depth / 3 * (0.6 + 0.4 * D(t)); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.stroke(); }
    for (let i = 0; i <= N; i++) { const t = i / N, px = x0 + (x1 - x0) * t, py = Y(t); ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + ((i % 2) ? 7 : -7), py + depth * (0.6 + 0.4 * D(t))); ctx.stroke(); }
    ctx.lineWidth = Math.max(3, 2 / k); ctx.beginPath(); for (let i = 0; i <= N; i++) { const t = i / N; i ? ctx.lineTo(x0 + (x1 - x0) * t, Y(t)) : ctx.moveTo(x0, Y(0)); } ctx.stroke(); ctx.restore();
  }

  // ---------------------------------------------------------------- the big top (full-bleed, screen space)
  // radiating canvas stripes above, fading into the rust wall; a sawdust ring floor from floorY down with a striped
  // curb; a spotlight on the tower ([x, y, r]) and a vignette. Returns floorY.
  function tent(ctx, W, H, o = {}) {
    const floorY = o.floorY ?? H - 150;
    ctx.fillStyle = T.tentDeep; ctx.fillRect(0, 0, W, H);
    const cx = W * (o.peakX ?? 0.5), cy = -120, N = 18;
    for (let i = 0; i < N; i++) { const a0 = Math.PI * (0.08 + 0.84 * i / N), a1 = Math.PI * (0.08 + 0.84 * (i + 1) / N); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a0) * 3000, cy + Math.sin(a0) * 3000); ctx.lineTo(cx + Math.cos(a1) * 3000, cy + Math.sin(a1) * 3000); ctx.closePath(); ctx.fillStyle = i % 2 ? T.tent : T.canvasDeep; ctx.fill(); }
    let g = ctx.createLinearGradient(0, 0, 0, floorY); g.addColorStop(0, 'rgba(90,30,22,0)'); g.addColorStop(0.35, 'rgba(90,30,22,.35)'); g.addColorStop(0.75, 'rgba(70,22,16,.85)'); g.addColorStop(1, 'rgba(60,18,12,.95)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, floorY);
    ctx.fillStyle = ctx.createPattern(fibres(), 'repeat'); ctx.fillRect(0, 0, W, H);
    if (o.valance !== false) for (let x = -10; x < W + 40; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 40, 0); ctx.lineTo(x + 40, 14); ctx.quadraticCurveTo(x + 20, 40, x, 14); ctx.closePath(); felt(ctx, Math.round((x + 10) / 40) % 2 ? T.tent : T.cream, 1); }
    sawdust(ctx, 0, floorY, W, H - floorY);
    ctx.save(); ctx.beginPath(); ctx.rect(0, floorY - 10, W, 16); ctx.fillStyle = T.cream; ctx.fill(); ctx.clip(); ctx.fillStyle = T.curb; for (let x = -20; x < W + 20; x += 36) { ctx.beginPath(); ctx.moveTo(x, floorY - 10); ctx.lineTo(x + 18, floorY - 10); ctx.lineTo(x + 26, floorY + 6); ctx.lineTo(x + 8, floorY + 6); ctx.closePath(); ctx.fill(); } ctx.restore();
    ctx.fillStyle = 'rgba(20,6,4,.3)'; ctx.fillRect(0, floorY + 6, W, 4);
    if (o.spot) { const [sx, sy, sr] = o.spot; g = ctx.createRadialGradient(sx, sy, 10, sx, sy, sr); g.addColorStop(0, 'rgba(255,236,190,.32)'); g.addColorStop(1, 'rgba(255,236,190,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
    g = ctx.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.35, W / 2, H * 0.45, Math.max(W, H) * 0.75); g.addColorStop(0, 'rgba(20,6,4,0)'); g.addColorStop(1, 'rgba(20,6,4,.5)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    return floorY;
  }
  // sawdust: flat dye + seeded light and dark flecks (pre-render once into a tile for the build)
  function sawdust(ctx, x, y, w, h) { ctx.fillStyle = T.sawdust; ctx.fillRect(x, y, w, h); const rr = rng(11); for (let i = 0; i < w * h / 60; i++) { ctx.fillStyle = rr() < 0.5 ? 'rgba(176,136,80,.55)' : 'rgba(255,240,210,.5)'; ctx.fillRect(x + rr() * w, y + rr() * h, 1.5 + rr() * 2.5, 1 + rr()); } }
  // stage drapes (the curtain call): swagged rust drapes, gold-felt tie-backs, a scalloped pelmet. open = 0 shut .. 1 wide
  function drapes(ctx, W, H, open) {
    [-1, 1].forEach((d) => { const x0 = d < 0 ? 0 : W, w = W * (0.5 - open / 2); ctx.save(); ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x0 - d * (w + 30), 0); ctx.quadraticCurveTo(x0 - d * (w - 10), H * 0.35, x0 - d * 40, H * 0.55); ctx.lineTo(x0 - d * 30, H); ctx.lineTo(x0, H); ctx.closePath(); ctx.fillStyle = T.tent; ctx.fill(); ctx.clip();
      for (let x = 0; x < w + 60; x += 22) { const gx = x0 - d * x, gr = ctx.createLinearGradient(gx, 0, gx - d * 22, 0); gr.addColorStop(0, 'rgba(0,0,0,.25)'); gr.addColorStop(0.45, 'rgba(255,220,200,.08)'); gr.addColorStop(1, 'rgba(0,0,0,.25)'); ctx.fillStyle = gr; ctx.fillRect(Math.min(gx, gx - d * 22), 0, 22, H); }
      ctx.fillStyle = ctx.createPattern(fibres(), 'repeat'); ctx.fillRect(0, 0, W, H); ctx.restore();
      ctx.beginPath(); ctx.moveTo(x0 - d * 40, H * 0.55); ctx.quadraticCurveTo(x0 - d * 58, H * 0.56, x0 - d * 48, H * 0.6); line(ctx, T.star, 3, 1);
      ctx.beginPath(); ctx.arc(x0 - d * 44, H * 0.61, 6, 0, 7); felt(ctx, T.star, 1, { fibre: false }); });
    for (let x = -10; x < W + 40; x += 48) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 48, 0); ctx.lineTo(x + 48, 30); ctx.quadraticCurveTo(x + 24, 62, x, 30); ctx.closePath(); felt(ctx, T.tentDeep, 1); ctx.beginPath(); ctx.moveTo(x + 4, 34); ctx.quadraticCurveTo(x + 24, 58, x + 44, 34); stitch(ctx, T.star, 1, 1.6, [4, 3]); }
  }

  // ---------------------------------------------------------------- small felt pieces
  // "+100": a cream felt tag that pops (scale 0.6 -> 1.1 -> 1, 240 ms) and floats up 18 px while fading (700 ms)
  function tag(ctx, x, y, text, o = {}) { const k = o.k || 1; ctx.save(); ctx.translate(x, y); ctx.scale(1 / k, 1 / k); ctx.rotate(o.rot ?? -0.08); ctx.globalAlpha = o.alpha ?? 1; ctx.beginPath(); ctx.roundRect(-26, -13, 52, 26, 8); felt(ctx, T.cream, 1, { fibre: false }); ctx.beginPath(); ctx.roundRect(-22, -9, 44, 18, 5); stitch(ctx, 'rgba(138,51,36,.5)', 1, 1, [2.5, 2]); ctx.font = '15px "Alfa Slab One"'; ctx.fillStyle = T.tent; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 0, 1); ctx.restore(); }
  // the knack as a tiny helmet (rail tag, caption pill, how-to). size = diameter in px.
  function knackTag(ctx, x, y, kind, size = 22) {
    ctx.save(); ctx.translate(x, y); ctx.scale(size / 22, size / 22);
    ctx.beginPath(); ctx.arc(0, 0, 11, 0, 7); felt(ctx, T.cream, 1, { fibre: false });
    ctx.beginPath(); ctx.arc(0, 2, 6.5, Math.PI, 0); ctx.closePath(); ctx.fillStyle = kind === 'heavy' ? T.iron : T.navy; ctx.fill();
    if (kind === 'heavy') { ctx.fillStyle = T.ironLight; ctx.fillRect(-7, 1, 14, 3); }
    if (kind === 'light') [-1, 1].forEach((d) => { ctx.beginPath(); ctx.moveTo(d * 5, 0); ctx.quadraticCurveTo(d * 10, -4, d * 9, -9); ctx.quadraticCurveTo(d * 7, -4, d * 4, -2); ctx.closePath(); ctx.fillStyle = T.canvasDeep; ctx.fill(); });
    if (kind === 'bounce') { ctx.beginPath(); ctx.arc(0, 2, 8, Math.PI, 0); ctx.strokeStyle = SEATS.poppy.fill; ctx.lineWidth = 2.4; ctx.setLineDash([2.5, 2.5]); ctx.stroke(); ctx.setLineDash([]); }
    ctx.restore();
  }
  // the name patch: a merrowed felt oval with the name in slab serif (the curtain call row, the sheet)
  function namePatch(ctx, x, y, name, colour, h, opt = {}) {
    const s = SEATS[colour] || { deep: colour }; ctx.save(); ctx.font = `${h * 0.5}px "Alfa Slab One"`;
    const w = Math.max(h * 1.9, ctx.measureText(name).width + h * 1.1), k = h / 40;
    ctx.translate(x, y); ctx.rotate(opt.rot || 0);
    ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, h / 2.2); felt(ctx, opt.fill || T.cream, k, { fibre: false });
    ctx.beginPath(); ctx.roundRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4, h / 2.3); line(ctx, s.deep, h * 0.11, 1);
    ctx.save(); ctx.setLineDash([1.1, 1.3]); ctx.strokeStyle = 'rgba(255,244,224,.38)'; ctx.lineWidth = h * 0.11; ctx.stroke(); ctx.restore();
    ctx.fillStyle = opt.ink || T.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(name, 0, h * 0.04);
    ctx.restore(); return w;
  }
  // the title banner (canvas version, for the cover; the game uses the SVG banner in skin.css): a cream felt
  // swallowtail ribbon bent on an arc of radius R (centre below), the title set along it in one line.
  function banner(ctx, cx, cy, R, half, band, label, size) {
    const a0 = -Math.PI / 2 - half, a1 = -Math.PI / 2 + half;
    [[a0, -1], [a1, 1]].forEach(([a, d]) => { const ix = cx + Math.cos(a) * R, iy = cy + Math.sin(a) * R, tx = Math.cos(a + d * Math.PI / 2), ty = Math.sin(a + d * Math.PI / 2), nx = Math.cos(a), ny = Math.sin(a);
      const p = (u, v) => [ix + tx * u + nx * v, iy + ty * u + ny * v];
      ctx.beginPath(); ctx.moveTo(...p(-6, band / 2 - 10)); ctx.lineTo(...p(band * 0.62, band / 2)); ctx.lineTo(...p(band * 0.42, 4)); ctx.lineTo(...p(band * 0.62, -band / 2 + 16)); ctx.lineTo(...p(-6, -band / 2 + 10)); ctx.closePath(); felt(ctx, shade(T.canvas, -0.06), 1); });
    ctx.beginPath(); ctx.arc(cx, cy, R + band / 2, a0, a1); ctx.arc(cx, cy, R - band / 2, a1, a0, true); ctx.closePath(); felt(ctx, T.cream, 1);
    ctx.beginPath(); ctx.arc(cx, cy, R + band / 2 - 6, a0 + 0.012, a1 - 0.012); stitch(ctx, T.tent, 1, 1.8, [5, 4]);
    ctx.beginPath(); ctx.arc(cx, cy, R - band / 2 + 6, a0 + 0.012, a1 - 0.012); stitch(ctx, T.tent, 1, 1.8, [5, 4]);
    ctx.save(); ctx.font = `${size}px "Alfa Slab One"`; ctx.fillStyle = T.tent; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const total = ctx.measureText(label).width; let a = -Math.PI / 2 - total / R / 2;
    for (const chr of label) { const w = ctx.measureText(chr).width, m = a + (w / 2) / R; ctx.save(); ctx.translate(cx + Math.cos(m) * R, cy + Math.sin(m) * R + 1); ctx.rotate(m + Math.PI / 2); ctx.fillText(chr, 0, 0); ctx.restore(); a += w / R; }
    ctx.restore();
  }
  // a felt patch button drawn on canvas (cover + how-to art only; the game's buttons are DOM .cbf-patch)
  function patch(ctx, x, y, w, h, o = {}) {
    const face = o.face || T.cream, ink = o.ink || T.tent;
    ctx.beginPath(); ctx.roundRect(x - 2, y - 2, w + 4, h + 4, 14); felt(ctx, o.back || shade(face, -0.45), 1, { fibre: false });
    ctx.save(); ctx.shadowColor = 'rgba(20,6,4,.38)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 3; ctx.beginPath(); ctx.roundRect(x, y, w, h, 12); ctx.fillStyle = face; ctx.fill(); ctx.restore();
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 12); felt(ctx, face, 1, { shadow: false, fibre: true });
    ctx.beginPath(); ctx.roundRect(x + 6, y + 6, w - 12, h - 12, 8); stitch(ctx, ink, 1, 1.8, [5, 4]);
    if (o.label) { ctx.font = o.font || '26px "Alfa Slab One"'; ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(o.label, x + w / 2, y + h / 2 + 1.5); }
  }

  // ---------------------------------------------------------------- a generated placeholder "photo" (no real person)
  function placeholderPhoto() {
    const c = document.createElement('canvas'); c.width = c.height = 192; const x = c.getContext('2d');
    let g = x.createLinearGradient(0, 0, 0, 192); g.addColorStop(0, '#9FB2C4'); g.addColorStop(1, '#5E7183'); x.fillStyle = g; x.fillRect(0, 0, 192, 192);
    x.fillStyle = '#3A2A22'; x.beginPath(); x.ellipse(96, 84, 62, 70, 0, 0, 7); x.fill();
    g = x.createLinearGradient(0, 150, 0, 192); g.addColorStop(0, '#3E6A8A'); g.addColorStop(1, '#2B4D66'); x.fillStyle = g; x.beginPath(); x.ellipse(96, 205, 80, 50, 0, 0, 7); x.fill();
    x.fillStyle = '#B98468'; x.fillRect(80, 128, 32, 34);
    g = x.createRadialGradient(84, 80, 6, 96, 96, 62); g.addColorStop(0, '#F3CDB0'); g.addColorStop(0.6, '#D9A585'); g.addColorStop(1, '#A87158'); x.fillStyle = g; x.beginPath(); x.ellipse(96, 96, 44, 54, 0, 0, 7); x.fill();
    x.fillStyle = '#3A2A22'; x.beginPath(); x.moveTo(50, 84); x.bezierCurveTo(52, 30, 140, 30, 142, 84); x.bezierCurveTo(128, 60, 96, 52, 70, 58); x.bezierCurveTo(60, 64, 54, 72, 50, 84); x.fill();
    [[78, 94], [114, 94]].forEach(([ex, ey]) => { x.fillStyle = '#F7F1EA'; x.beginPath(); x.ellipse(ex, ey, 9, 5.5, 0, 0, 7); x.fill(); x.fillStyle = '#4B3426'; x.beginPath(); x.arc(ex + 1, ey, 4.3, 0, 7); x.fill(); x.fillStyle = '#111'; x.beginPath(); x.arc(ex + 1, ey, 2, 0, 7); x.fill(); x.fillStyle = '#fff'; x.beginPath(); x.arc(ex - 0.5, ey - 1.5, 1.2, 0, 7); x.fill();
      x.strokeStyle = '#3A2A22'; x.lineWidth = 3; x.beginPath(); x.moveTo(ex - 11, ey - 11); x.quadraticCurveTo(ex, ey - 15, ex + 11, ey - 10); x.stroke(); });
    g = x.createLinearGradient(96, 96, 104, 122); g.addColorStop(0, 'rgba(150,95,70,0)'); g.addColorStop(1, 'rgba(150,95,70,.6)'); x.fillStyle = g; x.beginPath(); x.moveTo(94, 98); x.lineTo(104, 120); x.lineTo(90, 122); x.closePath(); x.fill();
    x.fillStyle = '#B5564E'; x.beginPath(); x.moveTo(80, 132); x.quadraticCurveTo(96, 146, 112, 132); x.quadraticCurveTo(96, 138, 80, 132); x.fill();
    x.fillStyle = '#fff'; x.beginPath(); x.moveTo(83, 133); x.quadraticCurveTo(96, 139, 109, 133); x.quadraticCurveTo(96, 136, 83, 133); x.fill();
    const d = x.getImageData(0, 0, 192, 192), r = rng(3); for (let i = 0; i < d.data.length; i += 4) { const n = (r() - 0.5) * 16; d.data[i] += n; d.data[i + 1] += n; d.data[i + 2] += n; } x.putImageData(d, 0, 0);
    return c;
  }

export const CBF = { T, SEAT_IDS, SEATS, LOOKS, CAST, KNACK_WORDS, tokens, tins, jams, shade, rng, fibres, blob, felt, stitch, line, starPath, feltStar,
  face, head, flyer, sticker, tin, jar, stone, chips, woodRect, ledge, plank, cannon, muzzle, loaded, fuse, spark, puff, aimStitch, trail, arc, pullCue, hand,
    net, tent, sawdust, drapes, tag, knackTag, namePatch, banner, patch, flower, placeholderPhoto };
