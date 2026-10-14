// HUD instruments as SVG (THE-728/THE-734, lifted from the designer's recipe hud.js verbatim, same
// geometry/formulas): 7-segment squawk digits, speed/altitude tapes with the overspeed barber pole,
// the g-meter, the centreline scale, the ghost hand, glyphs. Colours = tokens.css values. Render only:
// no game logic.
//
// tape/gmeter/locScale build their SVG DOM once and expose `update(...)` to mutate only the attributes
// that actually change frame to frame (THE-759: rebuilding a full SVG string and reassigning it via
// `innerHTML` every rAF -- reparsing markup, discarding the old subtree, laying out fresh <text> nodes,
// up to 3x a frame during the dive -- was the main-thread cost that held desktop fps to ~55-59 instead
// of the spec's >=60 floor; a 2-second rolling window dipped as low as 35.7fps). `createSeg` follows the
// same create-once/update-in-place shape for the two digit displays that redraw every frame (XPDR, the
// door keypad's read-out).
const SEG = { a: "8,0 50,0 42,8 16,8", b: "52,2 58,8 58,46 52,50 46,44 46,10", c: "52,52 58,56 58,94 52,98 46,90 46,58",
  d: "8,100 50,100 42,92 16,92", e: "6,52 12,58 12,90 6,98 0,94 0,56", f: "6,2 12,10 12,44 6,50 0,46 0,8", g: "8,50 14,45 44,45 50,50 44,55 14,55" };
const DIG = { 0: "abcdef", 1: "bc", 2: "abdeg", 3: "abcdg", 4: "bcfg", 5: "acdfg", 6: "acdefg", 7: "abc", 8: "abcdefg", 9: "abcdfg", "-": "g", " ": "", _: "d" };
const NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs) => {
  const n = document.createElementNS(NS, tag);
  if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
};

// One-off string render (menu.js's static XPDR mock-ups -- never called per frame).
export function seg(text, color) {
  const digits = [...String(text)].map((ch) => `<svg viewBox="0 0 58 100">${Object.entries(SEG).map(([k, p]) =>
    `<polygon class="${DIG[ch]?.includes(k) ? "on" : "off"}" points="${p}"/>`).join("")}</svg>`).join("");
  return `<span class="sq-seg"${color ? ` style="--seg:${color}"` : ""}>${digits}</span>`;
}

// Mounted digit display for a value that redraws every frame (XPDR, keypad read-out): builds each
// digit's 7 segment polygons once and just flips their on/off class on `update`, instead of
// re-parsing a fresh SVG string into `host` every call. `host` becomes the `.sq-seg` flex row itself.
export function createSeg(host, color) {
  host.classList.add("sq-seg");
  if (color) host.style.setProperty("--seg", color);
  const digits = [];
  function ensure(n) {
    while (digits.length < n) {
      const svg = el("svg", { viewBox: "0 0 58 100" });
      const polys = {};
      for (const [k, p] of Object.entries(SEG)) {
        const poly = el("polygon", { points: p, class: "off" });
        svg.appendChild(poly);
        polys[k] = poly;
      }
      host.appendChild(svg);
      digits.push(polys);
    }
    while (digits.length > n) { host.lastChild.remove(); digits.pop(); }
  }
  function update(text) {
    const chars = [...String(text)];
    ensure(chars.length);
    for (let i = 0; i < chars.length; i++) {
      const on = DIG[chars[i]] || "";
      const polys = digits[i];
      for (const k in polys) polys[k].setAttribute("class", on.includes(k) ? "on" : "off");
    }
  }
  return { update };
}

// Vertical tape. side "l" (speed, labels on the left of the ticks) or "r" (altitude). vmo: barber pole
// from vmo up. vd: a solid red band from vd up (the fail line). bug: magenta target bug. fs: label
// size, rs: readout size. Static per gauge (span/step/major/vmo/vd/side/...); only `value` (and
// optionally a warn colour override) change per `update` call.
export function createTape({ span, step, major, vmo, vd, bug, side = "l", w = 64, h = 230, fmt = (v) => v, unit = "", fs = 13, rs = 19, id = side }) {
  const px = h / span;
  const y = (top, v) => (top - v) * px;

  const svg = el("svg", { viewBox: `-8 -4 ${w + 16} ${h + 26}` });

  const defs = el("defs");
  const pattern = el("pattern", { id: `barber-${id}`, width: "7", height: "14", patternUnits: "userSpaceOnUse", patternTransform: "skewY(-30)" });
  pattern.append(el("rect", { width: "7", height: "14", fill: "#FFFFFF" }), el("rect", { width: "7", height: "7", fill: "#E01E37" }));
  const clip = el("clipPath", { id: `clip-${id}` });
  clip.appendChild(el("rect", { x: "0", y: "0", width: String(w), height: String(h), rx: "5" }));
  defs.append(pattern, clip);

  const bg = el("rect", { x: "0", y: "0", width: String(w), height: String(h), rx: "5", fill: "rgba(8,10,14,.62)", stroke: "#313945" });

  const g = el("g", { "clip-path": `url(#clip-${id})` });
  const CAP = Math.ceil(span / step) + 2; // tick pool: enough slots for the widest window plus boundary rounding
  const ticks = [];
  for (let i = 0; i < CAP; i++) {
    const line = el("line", { stroke: "#C9D2DC" });
    const text = el("text", { fill: "#C9D2DC", "font-family": "Squawk Mono, monospace", "font-weight": "500", "font-size": String(fs), "text-anchor": side === "l" ? "end" : "start" });
    g.append(line, text);
    ticks.push({ line, text });
  }
  const pole = el("rect", { x: String(side === "l" ? w - 7 : 0), width: "7", fill: `url(#barber-${id})` });
  const red = el("rect", { x: String(side === "l" ? w - 7 : 0), width: "7", fill: "#FF3344" });
  const redLine = el("line", { x1: "0", x2: String(w), stroke: "#FF3344", "stroke-width": "2" });
  const bugEl = el("path", { fill: "none", stroke: "#F25CD0", "stroke-width": "3" });
  if (vmo == null) pole.style.display = "none";
  if (vd == null) red.style.display = redLine.style.display = "none";
  if (bug == null) bugEl.style.display = "none";
  g.append(pole, red, redLine, bugEl);

  const bw = w + 6, bx = side === "l" ? -4 : -2, mid = h / 2, bh = rs + 14;
  const box = el("path", {
    d: side === "l" ? `M${bx} ${mid - bh / 2} h${bw - 10} l10 ${bh / 2} l-10 ${bh / 2} h-${bw - 10} z` : `M${bx + 10} ${mid - bh / 2} h${bw - 10} v${bh} h-${bw - 10} l-10 -${bh / 2} z`,
    fill: "#06080B", "stroke-width": "2.2",
  });
  const boxText = el("text", { x: String(side === "l" ? bw / 2 - 8 : bw / 2 + 4), y: String(mid + rs * 0.36), "text-anchor": "middle", "font-family": "Squawk Mono, monospace", "font-weight": "700", "font-size": String(rs) });
  const unitText = el("text", { x: String(w / 2), y: String(h + 17), "text-anchor": "middle", fill: "#9AA6B4", "font-family": "Squawk Mono, monospace", "font-weight": "500", "font-size": "11", "letter-spacing": "2" });
  unitText.textContent = unit;

  svg.append(defs, bg, g, box, boxText, unitText);

  function update(value, warnColor) {
    const top = value + span / 2;
    let i = 0;
    for (let v = Math.ceil((value - span / 2) / step) * step; v <= top && i < CAP; v += step, i++) {
      const big = v % major === 0;
      const yy = y(top, v);
      const { line, text } = ticks[i];
      line.style.display = "";
      line.setAttribute("x1", String(side === "l" ? w - (big ? 13 : 7) : 0));
      line.setAttribute("x2", String(side === "l" ? w : big ? 13 : 7));
      line.setAttribute("y1", String(yy));
      line.setAttribute("y2", String(yy));
      line.setAttribute("stroke-width", big ? "2" : "1.2");
      if (big) {
        text.style.display = "";
        text.setAttribute("x", String(side === "l" ? w - 17 : 17));
        text.setAttribute("y", String(yy + fs * 0.36));
        text.textContent = String(fmt(v));
      } else text.style.display = "none";
    }
    for (; i < CAP; i++) { ticks[i].line.style.display = "none"; ticks[i].text.style.display = "none"; }

    if (vmo != null) { pole.setAttribute("y", String(y(top, top))); pole.setAttribute("height", String(Math.max(0, y(top, vmo) - y(top, top)))); }
    if (vd != null) {
      const yTop = y(top, top), yVd = y(top, vd);
      red.setAttribute("y", String(yTop)); red.setAttribute("height", String(Math.max(0, yVd - yTop)));
      redLine.setAttribute("y1", String(yVd)); redLine.setAttribute("y2", String(yVd));
    }
    if (bug != null) {
      const yb = y(top, bug);
      bugEl.setAttribute("d", side === "l" ? `M${w} ${yb - 8} h-7 v16 h7` : `M0 ${yb - 8} h7 v16 h-7`);
    }

    const over = vmo != null && value > vmo;
    const col = warnColor || (over ? "#FF3344" : "#EEF2F6");
    box.setAttribute("stroke", col);
    boxText.setAttribute("fill", col);
    boxText.textContent = String(fmt(Math.round(value)));
  }

  return { el: svg, update };
}

// g-meter: an arc from -1 g to +5 g. Red below 0 (floating), amber 3-4 (the grey-out starts at 3 g),
// red from 4 (a bump each time g rises through 4.0, spec §2b). The arcs/ticks/dial never depend on
// `g` -- only the needle and the readout do, so those are the only pieces `update` touches.
export function createGmeter() {
  const size = 100, lo = -1, hi = 5, span = hi - lo, sweep = 240;
  const a = (v) => (-210 + ((v - lo) / span) * sweep) * Math.PI / 180, r = 36, cx = 50, cy = 52;
  const P = (v, rr = r) => [cx + Math.cos(a(v)) * rr, cy + Math.sin(a(v)) * rr];

  const svg = el("svg", { viewBox: `0 0 ${size} ${size}` });
  svg.appendChild(el("circle", { cx: String(cx), cy: String(cy), r: String(r + 9), fill: "rgba(8,10,14,.62)", stroke: "#313945" }));

  for (const [v1, v2, col, wdt] of [[lo, 0, "#FF3344", 4], [0, 3, "#3A4452", 4], [3, 4, "#FFB224", 4], [4, hi, "#FF3344", 4]]) {
    const [x1, y1] = P(v1), [x2, y2] = P(v2);
    const large = (v2 - v1) / span * sweep > 180 ? 1 : 0;
    svg.appendChild(el("path", { d: `M${x1} ${y1} A${r} ${r} 0 ${large} 1 ${x2} ${y2}`, stroke: col, "stroke-width": String(wdt), fill: "none" }));
  }
  for (let v = lo; v <= hi; v++) {
    const [x1, y1] = P(v, r - 7), [x2, y2] = P(v, r + 1), [tx, ty] = P(v, r - 16);
    svg.appendChild(el("line", { x1: String(x1), y1: String(y1), x2: String(x2), y2: String(y2), stroke: "#C9D2DC", "stroke-width": "1.6" }));
    const text = el("text", { x: String(tx), y: String(ty + 3.5), fill: "#9AA6B4", "font-family": "Squawk Mono, monospace", "font-size": "9.5", "text-anchor": "middle" });
    text.textContent = String(v);
    svg.appendChild(text);
  }

  const needle = el("line", { x1: String(cx), y1: String(cy), "stroke-width": "3", "stroke-linecap": "round" });
  const hub = el("circle", { cx: String(cx), cy: String(cy), r: "4" });
  svg.append(needle, hub);
  const readout = el("text", { x: String(cx), y: String(size - 3), "text-anchor": "middle", "font-family": "Squawk Mono, monospace", "font-weight": "700", "font-size": "14" });
  svg.appendChild(readout);

  function update(g) {
    const col = g < 0 || g >= 4 ? "#FF3344" : g >= 3 ? "#FFB224" : "#EEF2F6";
    const [nx, ny] = P(Math.max(lo, Math.min(hi, g)), r - 3);
    needle.setAttribute("x2", String(nx)); needle.setAttribute("y2", String(ny)); needle.setAttribute("stroke", col);
    hub.setAttribute("fill", col);
    readout.setAttribute("fill", col);
    readout.textContent = `${g > 0 ? "+" : ""}${g.toFixed(1)} G`;
  }

  return { el: svg, update };
}

// Centreline / heading scale: +-22 m (runway half-width) with the magenta caret at the lateral offset
// y (m). `half` is fixed per gauge (the one caller never varies it); only the caret moves per update.
export function createLocScale(half = 22) {
  const w = 180;
  const x = (v) => w / 2 + (Math.max(-half, Math.min(half, v)) / half) * (w / 2 - 6);
  const svg = el("svg", { viewBox: `0 0 ${w} 18` });
  svg.appendChild(el("rect", { x: "0", y: "3", width: String(w), height: "9", rx: "4", fill: "rgba(8,10,14,.62)", stroke: "#313945" }));
  for (let v = -20; v <= 20; v += 5) {
    const isZero = v === 0;
    svg.appendChild(el("line", {
      x1: String(x(v)), x2: String(x(v)), y1: String(isZero ? 0 : 5), y2: String(isZero ? 14 : 10),
      stroke: isZero ? "#EEF2F6" : "#9AA6B4", "stroke-width": String(isZero ? 2.4 : 1.4),
    }));
  }
  const caret = el("path", { fill: "#F25CD0" });
  svg.appendChild(caret);

  function update(y) {
    const cx = x(y);
    caret.setAttribute("d", `M${cx - 7} 18 L${cx} 6 L${cx + 7} 18 Z`);
  }
  return { el: svg, update };
}

// Ghost hand: a translucent touch disc + the drag path + an arrowhead (drawn, no hand photo, reads at 60 px).
// dir: "down" (pull), "lr" (lanes / roll), "up" (sprint), "tap".
export function ghost(dir = "down") {
  const path = { down: "M60 26 V104", up: "M60 112 V36", lr: "M18 70 H102", tap: "" }[dir];
  const head = { down: "M48 94 L60 110 L72 94", up: "M48 46 L60 30 L72 46", lr: "M90 58 L106 70 L90 82 M30 58 L14 70 L30 82", tap: "" }[dir];
  const at = { down: [60, 26], up: [60, 112], lr: [60, 70], tap: [60, 70] }[dir];
  return `<svg viewBox="0 0 120 140" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke="#EEF2F6" stroke-linecap="round" stroke-linejoin="round">
    ${path ? `<path d="${path}" stroke-width="5" stroke-dasharray="2 9" opacity=".85"/><path d="${head}" stroke-width="5"/>` : `<circle cx="60" cy="70" r="30" stroke-width="3" opacity=".5"/>`}
    <circle cx="${at[0]}" cy="${at[1]}" r="17" fill="rgba(238,242,246,.28)" stroke-width="3"/><circle cx="${at[0]}" cy="${at[1]}" r="6" fill="#EEF2F6" stroke="none"/></g></svg>`;
}

// Small glyphs (stroke = currentColor): pause, how-to, settings, About, sound, share, door.
export const GLYPH = {
  pause: `<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>`,
  howto: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.6 2.6 0 1 1 3.6 2.4c-.8.4-1.1.9-1.1 1.7M12 17h.01"/></svg>`,
  settings: `<svg viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>`,
  about: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/></svg>`,
  sound: `<svg viewBox="0 0 24 24"><path d="M4 10v4h4l5 4V6L8 10z"/><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11"/></svg>`,
  share: `<svg viewBox="0 0 24 24"><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 13v6h14v-6"/></svg>`,
  door: `<svg viewBox="0 0 20 22"><g fill="none" stroke="#EEF2F6" stroke-width="1.8"><rect x="3" y="1.5" width="14" height="19" rx="1.5"/><circle cx="13.5" cy="11.5" r="1.2" fill="#FFB224" stroke="none"/></g></svg>`,
};
