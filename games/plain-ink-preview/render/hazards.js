// THE-1651: drawing the rework's timing hazards (spec-rework §2 cone tokens, §4 guard, rulings 10-11). World
// units under the camera transform. Everything drawn here is read off the sim state (sim/play.js), so the
// cone that is drawn IS the cone that sees, and the zone line is the zone that watches.
import { g, C, piece } from '../engine/paper.js';
import { agentSide, AGENT_POSE } from '../engine/chars.js';
import { WATCHER_SCALE } from './actors.js';
import { tok } from './looks.js';
import { pointInPoly } from '../sim/rules.js';
import { BODY_H } from '../sim/physics.js';

const ZONE_DASH = [18, 12], ZONE_W = 4; // ruling 10: the swing zone's dashed lipstick floor line
const coneTok = () => {
  const css = getComputedStyle(document.documentElement);
  return { line: css.getPropertyValue('--pi-cone-line').trim() || C.red, hatch: css.getPropertyValue('--pi-cone-hatch').trim() || C.redD };
};
let CT = null;

// the x span where the zone can touch a standing or jumping hero (hero heights above the floor), cached
const spans = new WeakMap();
function zoneSpan(zone) {
  if (spans.has(zone)) return spans.get(zone);
  const xs = zone.map((p) => p.x);
  let x0 = Infinity, x1 = -Infinity;
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += 5) {
    for (let y = -2; y >= -BODY_H; y -= 20) if (pointInPoly({ x, y }, zone)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); break; }
  }
  const s = x1 >= x0 ? { x0, x1 } : null;
  spans.set(zone, s);
  return s;
}

// the dashed lipstick line on the floor under a swinging lamp: "this lamp watches from here to here"
export function drawZoneLine(zone, floorY = 0) {
  if (!zone) return;
  const s = zoneSpan(zone);
  if (!s) return;
  g.save();
  g.strokeStyle = C.red; g.lineWidth = ZONE_W; g.setLineDash(ZONE_DASH); g.lineCap = 'butt';
  g.beginPath(); g.moveTo(s.x0, floorY + 4); g.lineTo(s.x1, floorY + 4); g.stroke();
  // short end ticks, so the line reads as a span, not a crack in the tape
  g.setLineDash([]);
  g.beginPath(); g.moveTo(s.x0, floorY - 10); g.lineTo(s.x0, floorY + 14); g.moveTo(s.x1, floorY - 10); g.lineTo(s.x1, floorY + 14); g.stroke();
  g.restore();
}

// SL's mount: a decoration bracket above the bulb (never pure ink or cream)
export function drawBracket(bulb) {
  piece([[[bulb.x - 20, bulb.y - 190], [bulb.x + 20, bulb.y - 190], [bulb.x + 20, bulb.y - 70], [bulb.x - 20, bulb.y - 70]]], tok().decor.tangerine, { gap: 0, shadow: false });
}

// ---- the guard's sight cone: two lipstick edges, 45 deg hatching clipped to the wedge, no fill, a dashed far end ----
export function drawCone(gd) {
  CT = CT || coneTok();
  const poly = gd.cone;
  if (!poly || poly.length < 3) return;
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  g.save();
  g.beginPath(); poly.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); g.clip();
  g.strokeStyle = CT.hatch; g.lineWidth = 3;
  g.beginPath();
  // world-anchored 45 deg lines every 28 u, so the hatching doesn't crawl as he walks
  const k0 = Math.floor((x0 + y0) / 28) - 1, k1 = Math.ceil((x1 + y1) / 28) + 1;
  for (let k = k0; k <= k1; k++) { const c = k * 28; g.moveTo(c - y0 + 10, y0 - 10); g.lineTo(c - y1 - 10, y1 + 10); }
  g.stroke();
  g.restore();
  g.save();
  g.strokeStyle = CT.line; g.lineWidth = 4; g.lineJoin = 'round';
  const eye = poly[0], first = poly[1], last = poly[poly.length - 1];
  g.beginPath(); g.moveTo(first.x, first.y); g.lineTo(eye.x, eye.y); g.lineTo(last.x, last.y); g.stroke();
  g.setLineDash(ZONE_DASH);
  g.beginPath(); for (let i = 1; i < poly.length; i++) (i === 1 ? g.moveTo(poly[i].x, poly[i].y) : g.lineTo(poly[i].x, poly[i].y)); g.stroke();
  g.restore();
}

// ---- the guard: the cut-paper Watcher puppet with an 8-drawing walk (§4) ----
// drawing 0 contact R, 1 down, 2 passing, 3 up, 4 contact L, 5 down, 6 passing, 7 up; bob -6 down / +6 up
const BOB = [0, 6, 0, -6, 0, 6, 0, -6]; // y down: "down" sinks (+), "up" rises (-)
function walkPose(frame) {
  const side = frame < 4 ? 1 : -1; // which leg leads
  const k = frame % 4;
  const swingAmt = [0.38, 0.22, 0, 0.2][k];
  const th = side * swingAmt;
  const arm = 0.31 * [1, 0.6, 0, 0.55][k]; // +-18 deg, opposite the legs
  return {
    ...AGENT_POSE.stand,
    bob: BOB[frame], lean: 0.04,
    thF: th, knF: k === 2 ? 0.45 : 0.08, ftF: 0,
    thB: -th, knB: k === 0 ? 0.25 : 0.1, ftB: 0,
    shF: -side * arm, elF: 0.15, shB: side * arm, elB: 0.15,
  };
}
export function guardPose(gd) {
  if (gd.phase === 'walk') return walkPose(gd.frame);
  if (gd.phase === 'stop') return { ...AGENT_POSE.stand, lean: gd.sub < 0.5 ? -0.07 : 0 }; // feet together, a 4 deg lean back
  if (gd.phase === 'look') return gd.frame === 0 ? { ...AGENT_POSE.stand, head: -0.17 } : { ...AGENT_POSE.stand, headFlip: true }; // look up, then the glance back
  return { ...AGENT_POSE.stand };
}
// eye: 0 shut .. 3 wide (the warning steps, S2 b) -- drawn over the rig's eye slit
export function drawGuard(gd, eye = 0, floorY = 0) {
  const pose = guardPose(gd);
  const squash = gd.phase === 'turn' ? [0.7, 0.35, 0.7][gd.frame] : 1; // 3/4, front, 3/4
  g.save();
  g.translate(gd.x, floorY); g.scale(squash, 1); g.translate(-gd.x, -floorY);
  agentSide(gd.x, floorY, WATCHER_SCALE, pose, { col: C.ink, accent: C.red, flip: gd.dir < 0, eye: 'alert' });
  g.restore();
  if (eye > 0) {
    const open = [0, 3, 7, 12][eye];
    const ex = gd.eye.x + gd.dir * 10, ey = gd.eye.y + 4;
    g.fillStyle = C.paper; g.beginPath(); g.ellipse(ex, ey, 14, Math.max(2, open), 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = C.ink; g.beginPath(); g.arc(ex + gd.dir * 3, ey, Math.min(6, open), 0, Math.PI * 2); g.fill();
  }
}

// ---- the flashing room (ruling 11) ----
// lit: a cream wash over the whole room, every ceiling bulb on, the ceiling eye-slot wide. dark: the bulbs are
// ink, the eye shut. Beat 5 (the warning): the bulbs flicker on dim. The door frames are always dashed lipstick.
const ROOM_TOP = -720;
export function drawRoomBack(room, floorY = 0) {
  if (!room.lit) return;
  const r = room.rect;
  g.fillStyle = C.paper;
  g.fillRect(r.x, -1400, r.w, 1400 + floorY);
}
export function drawRoomFront(room, tick, eye = 0, floorY = 0) {
  const r = room.rect;
  // door frames: dashed lipstick, floor to the lintel, so the player sees where the rule starts
  g.save();
  g.strokeStyle = C.red; g.lineWidth = 6; g.setLineDash(ZONE_DASH);
  g.beginPath();
  for (const x of [r.x, r.x + r.w]) { g.moveTo(x, floorY); g.lineTo(x, ROOM_TOP); }
  g.moveTo(r.x, ROOM_TOP); g.lineTo(r.x + r.w, ROOM_TOP);
  g.stroke();
  g.restore();
  // ceiling bulbs every 250 u on short rods
  const flicker = room.warn && Math.floor(tick / 6) % 2 === 0;
  for (let x = r.x + 125; x < r.x + r.w; x += 250) {
    g.fillStyle = C.ink;
    g.fillRect(x - 3, ROOM_TOP - 200, 6, 200);
    piece([[[x - 34, ROOM_TOP + 30], [x + 34, ROOM_TOP + 30], [x + 16, ROOM_TOP], [x - 16, ROOM_TOP]]], C.ink, { gap: 0, shadow: false });
    g.fillStyle = room.lit ? C.paper : flicker ? C.paperD : C.inkL;
    g.beginPath(); g.arc(x, ROOM_TOP + 34, 12, 0, Math.PI); g.fill();
    if (room.lit) { // on: an ink rim and short ink rays, so a cream bulb still reads as lit on the cream wash
      g.strokeStyle = C.ink; g.lineWidth = 3;
      g.beginPath(); g.arc(x, ROOM_TOP + 34, 12, 0, Math.PI); g.stroke();
      g.beginPath();
      for (const a of [-0.5, 0, 0.5]) { g.moveTo(x + Math.sin(a) * 22, ROOM_TOP + 34 + Math.cos(a) * 22); g.lineTo(x + Math.sin(a) * 40, ROOM_TOP + 34 + Math.cos(a) * 40); }
      g.stroke();
    }
  }
}
// the ceiling eye-slot over the room, wide while lit (and with the meter while it is the one that saw you)
export function drawRoomEye(room, cx, eye = 0) {
  const open = room.lit ? Math.max(16, [0, 3, 9, 16][eye]) : room.warn ? 3 : 0;
  const y = ROOM_TOP + 90;
  piece([[[cx - 60, y - 24], [cx + 60, y - 24], [cx + 60, y + 24], [cx - 60, y + 24]]], C.ink, { gap: 0, shadow: false });
  g.fillStyle = C.paper;
  g.beginPath(); g.ellipse(cx, y, 44, Math.max(1.5, open), 0, 0, Math.PI * 2); g.fill();
  if (open > 2) { g.fillStyle = C.ink; g.beginPath(); g.arc(cx, y, Math.min(12, open), 0, Math.PI * 2); g.fill(); }
}

// a cut-paper tag (cream, ink edge, display font): the room's rule and its "LIGHTS!" warning
export function drawCutTag(x, y, text, { size = 40, hot = false, rot = -0.04 } = {}) {
  g.save();
  g.translate(x, y); g.rotate(rot);
  g.font = `400 ${size}px ${tok().font}`;
  g.letterSpacing = '2px';
  const w = g.measureText(text).width + 28, h = size * 1.35;
  g.fillStyle = hot ? C.red : C.paper; g.fillRect(-w / 2, -h, w, h);
  g.strokeStyle = C.ink; g.lineWidth = 3; g.strokeRect(-w / 2, -h, w, h);
  g.fillStyle = hot ? C.paper : C.ink; g.textBaseline = 'middle'; g.textAlign = 'center';
  g.fillText(text, 0, -h / 2 + 2);
  g.restore();
}
