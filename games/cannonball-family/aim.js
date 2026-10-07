// Pull-back aim (THE-449 S1; spec §5 and O12). Pure: CSS px in, fire angle (degrees) and power (0-1) out.
import { GRAVITY } from "./physics.js";

export const CANCEL_PX = 20; // a release closer than this to the pull start cancels the shot
export const FULL_POWER_PX = 160; // power is linear with pull length up to here, then flat
export const SPEED_MIN = 300, SPEED_MAX = 900; // launch speed, world units per second

// The pull's drag vector (dx, dy) = now - start, in screen px (y down). Pulling down-left fires up-right:
// θ = atan2(dy, -dx). θ in [10, 80] is used as is. Otherwise it snaps to the nearer clamp, split at -135°:
// down, right and up-right pulls give 80°, left and up pulls give 10°.
export function angleOf(dx, dy) {
  const t = Math.atan2(dy, -dx) * 180 / Math.PI;
  if (t >= 10 && t <= 80) return t;
  if (t > 80 || t <= -135) return 80;
  return 10;
}

// null when the release is within CANCEL_PX of the start (no shot), else { angle, power }.
export function aimFrom(start, now) {
  const dx = now.x - start.x, dy = now.y - start.y;
  const len = Math.hypot(dx, dy);
  if (len < CANCEL_PX) return null;
  return { angle: angleOf(dx, dy), power: Math.min(1, len / FULL_POWER_PX) };
}

export function launchVelocity(angle, power) {
  const speed = SPEED_MIN + (SPEED_MAX - SPEED_MIN) * power;
  const rad = angle * Math.PI / 180;
  return { vx: speed * Math.cos(rad), vy: -speed * Math.sin(rad) };
}

// The running-stitch preview: `count` points of the ballistic arc from `origin` (no collisions), 0.05 s apart.
export function arcPoints(origin, angle, power, count) {
  const { vx, vy } = launchVelocity(angle, power);
  const pts = [];
  for (let i = 1; i <= count; i++) {
    const t = i * 0.05;
    pts.push({ x: origin.x + vx * t, y: origin.y + vy * t + 0.5 * GRAVITY * t * t });
  }
  return pts;
}
