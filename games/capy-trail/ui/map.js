// THE-1375: secret `0`-key debug overlay for Nir -- "I would also like to see the path we are making ..."
// Read-only from the sim's own patterns (hazards/coins/junctions/closures/pickups) and its s/lane -- no
// game logic, no writes to the sim, never pauses it. Hidden from players (no HUD button, not in About/
// how-to/share card); desktop-only, no touch path. Costs nothing while hidden: onFrame()'s first line is
// the only work done when closed (see map-zero-cost.test.mjs).
import { trailBreakpoints, pointAt } from "../render/map-layout.js";
import { LANE_SPACING } from "../sim/track.js";

const WINDOW_BEHIND = 150; // m, spec: "a window of about 150 m behind to everything generated ahead"
const DRAW_HZ = 15;
const DRAW_INTERVAL_MS = 1000 / DRAW_HZ;
const SAMPLE_STEP = 5; // m, for the bounding-box fit (the strip can fold back on itself after a turn)
const MAX_SCALE = 18; // px/m, so a short window doesn't zoom in absurdly far

const HAZARD_STYLE = {
  low: { color: "#7fd6ff", shape: "triangleUp" }, // jump over
  high: { color: "#ffb74d", shape: "triangleDown" }, // duck under
  block: { color: "#ef5350", shape: "square" }, // change lane
  either: { color: "#ba68c8", shape: "diamond" }, // jump or duck
};

function drawGlyph(ctx, shape, x, y, r, color, alpha) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  if (shape === "square") ctx.rect(x - r, y - r, r * 2, r * 2);
  else if (shape === "diamond") { ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); }
  else if (shape === "triangleUp") { ctx.moveTo(x, y - r); ctx.lineTo(x + r, y + r); ctx.lineTo(x - r, y + r); ctx.closePath(); }
  else { ctx.moveTo(x, y + r); ctx.lineTo(x + r, y - r); ctx.lineTo(x - r, y - r); ctx.closePath(); } // triangleDown
  ctx.fill();
  ctx.globalAlpha = 1;
}

export function createMapPanel({ canvas }) {
  let open = false;
  let lastDrawT = -Infinity;
  let drawCount = 0; // test hook only (window.__capyDebug.mapDrawCount)

  function toggle() {
    open = !open;
    canvas.hidden = !open;
  }
  function isOpen() { return open; }

  // The only work done per frame while hidden: two property reads and a branch. No canvas, no allocation.
  function onFrame(sim, now) {
    if (!open || !sim) return;
    const t = now ?? performance.now();
    if (t - lastDrawT < DRAW_INTERVAL_MS) return;
    lastDrawT = t;
    draw(sim);
  }

  function aheadMaxS(sim) {
    let max = sim.s;
    const p = sim.patterns;
    for (const h of p.hazards) if (h.s > max) max = h.s;
    for (const c of p.coins) if (c.s > max) max = c.s;
    for (const c of p.closures) if (c.sEnd > max) max = c.sEnd;
    for (const j of p.junctions) if (j.s > max) max = j.s;
    for (const m of p.pickups) if (m.s > max) max = m.s;
    return max;
  }

  function draw(sim) {
    drawCount++;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
    const ctx = canvas.getContext("2d");
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(14, 17, 26, 0.6)";
    ctx.fillRect(0, 0, w, h);

    const bp = trailBreakpoints(sim.patterns.junctions);
    const sStart = Math.max(0, sim.s - WINDOW_BEHIND);
    const sEnd = Math.max(sim.s + 1, aheadMaxS(sim));
    const heroLane = sim.stepLane === null ? sim.lane : sim.lane + (sim.stepLane - sim.lane) * sim.stepT;
    const hero = pointAt(bp, sim.s, heroLane);

    let minX = hero.x, maxX = hero.x, minY = hero.y, maxY = hero.y;
    for (let s = sStart; s <= sEnd; s += SAMPLE_STEP) {
      const p = pointAt(bp, s, 0);
      if (p.x < minX) minX = p.x; else if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; else if (p.y > maxY) maxY = p.y;
    }
    const margin = 10;
    const spanX = Math.max(1, maxX - minX + margin * 2), spanY = Math.max(1, maxY - minY + margin * 2);
    const scale = Math.min((w - 16) / spanX, (h - 16) / spanY, MAX_SCALE);
    const cx = w / 2, cy = h / 2;
    const toScreen = (p) => ({ x: cx + (p.x - hero.x) * scale, y: cy - (p.y - hero.y) * scale });

    // the centerline: dimmed behind the hero, bright ahead
    function strokeCenterline(from, to, alpha) {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = "#e8e3d8";
      ctx.lineWidth = Math.max(1, LANE_SPACING * 2 * scale * 0.06);
      ctx.beginPath();
      let first = true;
      for (let s = from; s <= to; s += SAMPLE_STEP) {
        const pt = toScreen(pointAt(bp, s, 0));
        if (first) { ctx.moveTo(pt.x, pt.y); first = false; } else ctx.lineTo(pt.x, pt.y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    strokeCenterline(sStart, sim.s, 0.35);
    strokeCenterline(sim.s, sEnd, 0.85);

    // closures (filler bars, incl. corridor narrowings): a thick bar across the closed lane's own span
    ctx.lineCap = "butt";
    for (const c of sim.patterns.closures) {
      if (c.sEnd < sStart || c.sStart > sEnd) continue;
      const behind = c.sEnd < sim.s;
      const a = pointAt(bp, Math.max(c.sStart, sStart), c.lane), b = pointAt(bp, Math.min(c.sEnd, sEnd), c.lane);
      const pa = toScreen(a), pb = toScreen(b);
      ctx.globalAlpha = behind ? 0.3 : 0.9;
      ctx.strokeStyle = "#a1662f";
      ctx.lineWidth = Math.max(3, LANE_SPACING * scale * 0.5);
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // junctions: a small dot + an L/R chevron, green once taken, red once missed, amber while pending
    for (const j of sim.patterns.junctions) {
      if (j.s < sStart || j.s > sEnd) continue;
      const pt = toScreen(pointAt(bp, j.s, 0));
      const color = j.resolved === "taken" ? "#66bb6a" : j.resolved === "missed" ? "#ef5350" : "#ffd54f";
      ctx.globalAlpha = j.s < sim.s ? 0.4 : 1;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#14161a";
      ctx.font = "bold 8px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(j.dir, pt.x, pt.y);
      ctx.globalAlpha = 1;
    }

    // hazard rows, by kind
    for (const hz of sim.patterns.hazards) {
      if (hz.s < sStart || hz.s > sEnd) continue;
      const style = HAZARD_STYLE[hz.kind] || HAZARD_STYLE.block;
      const pt = toScreen(pointAt(bp, hz.s, hz.lane));
      const passed = hz.hit || hz.cleared;
      drawGlyph(ctx, style.shape, pt.x, pt.y, 4, style.color, passed ? 0.3 : 0.95);
    }

    // coins: small gold dots (skip ones already taken and well behind, to keep the behind trail legible)
    for (const c of sim.patterns.coins) {
      if (c.s < sStart || c.s > sEnd) continue;
      if (c.s < sim.s && c.taken) continue;
      const pt = toScreen(pointAt(bp, c.s, c.lane));
      ctx.globalAlpha = c.s < sim.s ? 0.35 : 0.9;
      ctx.fillStyle = "#ffd54f";
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }

    // pickups
    for (const m of sim.patterns.pickups) {
      if (m.s < sStart || m.s > sEnd) continue;
      const pt = toScreen(pointAt(bp, m.s, m.lane));
      ctx.globalAlpha = m.taken ? 0.3 : 0.95;
      ctx.strokeStyle = "#ff7043"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // the hero: a small triangle pointing in its current heading
    const heroHeading = pointAt(bp, sim.s + 0.5, heroLane);
    const heroScreen = toScreen(hero), headScreen = toScreen(heroHeading);
    const ang = Math.atan2(headScreen.y - heroScreen.y, headScreen.x - heroScreen.x);
    ctx.save();
    ctx.translate(heroScreen.x, heroScreen.y);
    ctx.rotate(ang);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, 4); ctx.lineTo(-4, -4); ctx.closePath(); ctx.fill();
    ctx.restore();

    // legend
    ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.font = "9px sans-serif";
    const legend = [
      ["#7fd6ff", "low (jump)"], ["#ffb74d", "high (duck)"], ["#ef5350", "block"], ["#ba68c8", "either"],
      ["#ffd54f", "coin"], ["#ff7043", "honey"], ["#a1662f", "filler"], ["#66bb6a", "turn taken"],
    ];
    let ly = 6;
    for (const [color, label] of legend) {
      ctx.fillStyle = color; ctx.fillRect(6, ly, 6, 6);
      ctx.fillStyle = "#e8e3d8"; ctx.fillText(label, 16, ly - 1);
      ly += 11;
    }

    ctx.restore();
  }

  function debugDrawCount() { return drawCount; }

  return { toggle, isOpen, onFrame, debugDrawCount };
}
