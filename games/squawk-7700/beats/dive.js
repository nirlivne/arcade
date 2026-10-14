// The dive beat (design "Dive beat"): trim runaway from t = 3-17 s, pitch capped at -8 deg until the
// runaway ends, overspeed peels the rudder in 3 chunks, pull-out clears. Pure: no DOM, no three.js.
import { FLIGHT, initFlight, stepFlight } from "../flight.js";

export const DIVE = {
  START_FL: 280, START_V: 300, START_PITCH: -8,
  PUSH_RATE: 7, PUSH_START_T: 3, PUSH_END_T: 17, PUSH_RAMP: 1,
  PITCH_CAP: -8, PITCH_CAP_UNTIL: 17,
  CLEAR_HOLD: 1.5, CAP_T: 30,
  TURBULENCE_BASE: 1, // deg/s baseline pitch noise amplitude at a 1x daily multiplier
};

function pushAt(t) {
  if (t < DIVE.PUSH_START_T || t >= DIVE.PUSH_END_T) return 0;
  const ramp = (t - DIVE.PUSH_START_T) / DIVE.PUSH_RAMP;
  return DIVE.PUSH_RATE * Math.min(1, Math.max(0, ramp));
}

// carry: { rudder } carried in from a prior beat (defaults to intact). checkpoint is unused by the
// dive (it has no mid-beat checkpoint), kept in the signature so sim.js can call every beat the same way.
export function create(rngSim, carry = {}, checkpoint = null) {
  return {
    t: 0,
    flight: initFlight({
      alt: DIVE.START_FL * 100,
      v: DIVE.START_V,
      pitch: DIVE.START_PITCH,
      rudder: carry.rudder ?? 1,
    }),
    rngSim,
    turbulenceMul: checkpoint?.turbulenceMul ?? 1,
    clearHoldT: 0,
    bumps: 0,
    events: [],
  };
}

// phase: "intro" | "play" (sim.js only steps a beat during its live phases). dt is the fixed sim step.
export function step(b, input, phase, dt) {
  const t = b.t + dt;
  const hazardsOn = phase !== "intro";
  const noise = hazardsOn ? (b.rngSim() * 2 - 1) * DIVE.TURBULENCE_BASE * b.turbulenceMul : 0;
  const push = hazardsOn ? pushAt(t) : 0;
  const pitchCap = t < DIVE.PITCH_CAP_UNTIL ? DIVE.PITCH_CAP : null;
  const pullRate = t >= DIVE.PUSH_END_T ? FLIGHT.PULL_OUT : FLIGHT.PULL_NORMAL;

  const { state, events } = stepFlight(b.flight, input, { t, dt, pullRate, push, noise, pitchCap });

  const clearHoldT = state.pitch >= 0 && state.climbRate >= 0 ? b.clearHoldT + dt : 0;
  const bumps = b.bumps + events.filter((e) => e.type === "bump").length;

  return { ...b, t, flight: state, clearHoldT, bumps, events };
}

// {cleared, failed, reason, bumps, margin, metric}. reason is one of the spec's fail-reason keys, or
// null. metric = the dive's medal metric (margin, seconds held between VMO and VD).
export function outcome(b) {
  const f = b.flight;
  if (f.v >= FLIGHT.VD) return { cleared: false, failed: true, reason: "overspeed", bumps: b.bumps, margin: f.margin, metric: f.margin };
  if (f.alt <= FLIGHT.FLOOR_ALT) return { cleared: false, failed: true, reason: "floor", bumps: b.bumps, margin: f.margin, metric: f.margin };
  if (Math.abs(f.bank) >= FLIGHT.BANK_FAIL) return { cleared: false, failed: true, reason: "bank", bumps: b.bumps, margin: f.margin, metric: f.margin };
  if (b.clearHoldT >= DIVE.CLEAR_HOLD) return { cleared: true, failed: false, reason: null, bumps: b.bumps, margin: f.margin, metric: f.margin };
  if (b.t >= DIVE.CAP_T) return { cleared: false, failed: true, reason: "timeout", bumps: b.bumps, margin: f.margin, metric: f.margin };
  return { cleared: false, failed: false, reason: null, bumps: b.bumps, margin: f.margin, metric: f.margin };
}

// The level-off altitude callout: the current altitude rounded to the nearest 1,000 ft.
export function levelOffCallout(b) {
  return Math.round(b.flight.alt / 1000) * 1000;
}
