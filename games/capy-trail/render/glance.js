// CTO D1 fix (THE-1259 S3, THE-1272, 2026-11-06 02:16Z): "the capy reads as a teddy from behind." The
// Designer's chosen fix is a deadpan glance (head.rotation.y) over the shoulder, every 8-12 s or on a near
// miss, suppressed outside gallop pose or when a hazard/junction is under 1.2 s ahead, cancelled fast on
// input. Pure trigger/timer/envelope logic here (testable without three.js, per the tdd skill); the actual
// angle/easing application to head.rotation.y lives in render/scene.js, which has the capy mesh.
import { rnd } from "./look.js";

const ONBOARDING_FLOOR_T = 5; // spec: first glance no earlier than 5 s into a run
const GLANCE_INTERVAL_MIN = 8, GLANCE_INTERVAL_MAX = 12;
const SUPPRESS_LEAD_T = 1.2; // skip if a hazard/sign is < 1.2 s ahead
export const EASE_IN_T = 0.18, HOLD_T = 0.6, EASE_OUT_T = 0.25; // ~1.0 s total
export const CANCEL_EASE_OUT_T = 0.1; // fast ease-out on input

export function createGlanceState(seed) {
  return {
    r: rnd(seed),
    nextAt: null, // set on first update once we know t (so ONBOARDING_FLOOR_T applies cleanly)
    phase: "idle", // idle | easeIn | hold | easeOut | cancelling
    phaseT: 0,
  };
}

function scheduleNext(g, fromT) {
  g.nextAt = fromT + GLANCE_INTERVAL_MIN + g.r() * (GLANCE_INTERVAL_MAX - GLANCE_INTERVAL_MIN);
}

// Returns { active, cancelling, phase, phaseT } -- `active` means a glance is currently playing (any phase
// except idle); the caller (render/scene.js) uses `phase`/`phaseT` to compute the actual eased angle.
export function updateGlance(g, { t, dt, pose, nearMissJustNow, nextHazardOrJunctionT, inputJustPressed }) {
  if (g.nextAt === null) scheduleNext(g, Math.max(t, ONBOARDING_FLOOR_T));

  if (g.phase !== "idle" && g.phase !== "cancelling" && inputJustPressed) {
    g.phase = "cancelling"; g.phaseT = 0;
  }

  if (g.phase === "idle") {
    const suppressed = pose !== "gallop" || nextHazardOrJunctionT < SUPPRESS_LEAD_T || t < ONBOARDING_FLOOR_T;
    const timerDue = t >= g.nextAt;
    if (!suppressed && (timerDue || nearMissJustNow)) {
      g.phase = "easeIn"; g.phaseT = 0;
      scheduleNext(g, t); // spec: "a trigger resets the 8-12 s timer"
    }
  } else {
    g.phaseT += dt;
    if (g.phase === "easeIn" && g.phaseT >= EASE_IN_T) { g.phase = "hold"; g.phaseT = 0; }
    else if (g.phase === "hold" && g.phaseT >= HOLD_T) { g.phase = "easeOut"; g.phaseT = 0; }
    else if (g.phase === "easeOut" && g.phaseT >= EASE_OUT_T) { g.phase = "idle"; g.phaseT = 0; }
    else if (g.phase === "cancelling" && g.phaseT >= CANCEL_EASE_OUT_T) { g.phase = "idle"; g.phaseT = 0; }
  }

  return { active: g.phase !== "idle", cancelling: g.phase === "cancelling", phase: g.phase, phaseT: g.phaseT };
}
