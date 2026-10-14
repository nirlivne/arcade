// The escort + landing beat (design "Escort + landing beat"): hold formation for 20s (bank bump/fail),
// a 1.5s FINAL cut (not clocked, the sim saves a second checkpoint here), then a rudderless approach:
// GEAR by 1,000 ft (fail at 500 ft without it), FLARE below 60 ft, touchdown sink bands, a 4s rollout
// with the runway's half-width. Pure: no DOM, no three.js.
import { FLIGHT, initFlight, stepFlight } from "../flight.js";

export const LANDING = {
  ESCORT_ALT: 15000, ESCORT_V: 250, ESCORT_DURATION: 20, ESCORT_BAND: 1500,
  ESCORT_BUMP_BANK_ON: 30, ESCORT_BUMP_BANK_OFF: 20,
  FINAL_CUT_S: 1.5,
  // Spec amendment A4 (THE-756): the nominal glide (gear down, wings level, no pitch input, speed
  // trimming as today) covers ~4,364 m before touching down (computed from stepFlight, not guessed).
  // 4,000 m puts the nominal touchdown ~364 m past the threshold, inside the 200-500 m band on every
  // seed (side/crosswind/gust never change pitch or speed, so the glide's range is seed-independent).
  APPROACH_START_ALT: 3000, APPROACH_START_V: 160, APPROACH_START_RANGE: 4000, GLIDE_DEG: 3,
  GEAR_OFFER_ALT: 2000, GEAR_REQUIRED_ALT: 1000, GEAR_FAIL_ALT: 500,
  // FLARE is live (button lit, "יישור!" shown) at or below this altitude; pressing it latches a settle
  // toward FLARE_SINK_TARGET_FPM over FLARE_TAU seconds, trimmed +-FLARE_TRIM_FPM by the yoke (pull =
  // less sink). The shown pitch eases toward FLARE_PITCH_TARGET for the look only; it never drives alt.
  FLARE_LIVE_ALT: 80, FLARE_SINK_TARGET_FPM: -300, FLARE_TRIM_FPM: 150, FLARE_TAU: 0.5, FLARE_PITCH_TARGET: 2,
  SINK_SMOOTH_MAX: 360, SINK_FIRM_MAX: 720, // ft/min
  // Arcade-compressed the same as the dive: the approach needs to cover 3,000 ft in ~35 s, same order
  // of magnitude as the dive's compression. The flare (+pulling) has to do real work near the ground.
  APPROACH_ALT_K: 4,
  RUNWAY_HALF_WIDTH: 22, TOUCHDOWN_ZONE: 1800, ROLLOUT_S: 4,
  GUST_BASE: 1, CROSSWIND_MAX: 12,
  PRACTICE_RUDDER: 0.33,
};

function clampNum(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
function notDone(b) { return { cleared: false, failed: false, reachedFinal: false, reason: null, bumps: b.bumps, margin: 0, metric: 0 }; }
function fail(reason, b) { return { cleared: false, failed: true, reachedFinal: false, reason, bumps: b.bumps, margin: 0, metric: 0 }; }

// carry: { rudder, escortBumps } (escortBumps only meaningful when checkpoint === "final").
export function create(rngSim, carry = {}, checkpoint = "start") {
  const side = rngSim() < 0.5 ? -1 : 1;
  const gustMul = 0.5 + rngSim();
  const crosswind = rngSim() * LANDING.CROSSWIND_MAX;
  const rudder = carry.rudder ?? LANDING.PRACTICE_RUDDER;

  if (checkpoint === "final") {
    return {
      sub: "approach", t: 0,
      flight: initFlight({ alt: LANDING.APPROACH_START_ALT, v: LANDING.APPROACH_START_V, pitch: -LANDING.GLIDE_DEG, rudder }),
      range: LANDING.APPROACH_START_RANGE, distPastThreshold: 0,
      gearDown: false, flareActive: false, flareClimbRate: 0, prevButton: false,
      touchedDown: false, rolloutT: 0, sinkAtTouchdown: 0, rangeAtTouchdown: 0,
      rngSim, side, gustMul, crosswind,
      bumps: carry.escortBumps ?? 0,
      escortT: carry.escortT ?? 0, // the escort's elapsed time, so the results strip's clock covers the whole beat (THE-768)
      events: [],
    };
  }
  return {
    sub: "escort", t: 0,
    flight: initFlight({ alt: LANDING.ESCORT_ALT, v: LANDING.ESCORT_V, pitch: 0, rudder }),
    rngSim, side, gustMul, crosswind,
    bankBumpArmed: true,
    bumps: 0,
    events: [],
  };
}

export function step(b, input, phase, dt) {
  const t = b.t + dt;
  const hazardsOn = phase !== "intro";
  const gust = hazardsOn ? (b.rngSim() * 2 - 1) * LANDING.GUST_BASE * b.gustMul : 0;
  const side = hazardsOn ? b.side : 0, crosswind = hazardsOn ? b.crosswind : 0;

  if (b.sub === "escort") {
    const { state } = stepFlight(b.flight, input, { t, dt, pullRate: FLIGHT.PULL_NORMAL, push: 0, noise: 0, side, crosswind, gust, speedTrim: LANDING.ESCORT_V });
    let bankBumpArmed = b.bankBumpArmed;
    const events = [];
    if (bankBumpArmed && Math.abs(state.bank) > LANDING.ESCORT_BUMP_BANK_ON) { events.push({ type: "bump", data: { reason: "bank" } }); bankBumpArmed = false; }
    else if (!bankBumpArmed && Math.abs(state.bank) < LANDING.ESCORT_BUMP_BANK_OFF) bankBumpArmed = true;
    const bumps = b.bumps + events.filter((e) => e.type === "bump").length;
    return { ...b, t, flight: state, bankBumpArmed, bumps, events };
  }

  // approach / rollout: FLARE no longer kicks the pitch (ALT_K would float or balloon it); once live
  // and pressed it latches a settle, easing the climb rate toward a sink target with a yoke trim.
  const { state } = stepFlight(b.flight, input, { t, dt, pullRate: FLIGHT.PULL_NORMAL, push: 0, noise: 0, side, crosswind, gust, speedTrim: LANDING.APPROACH_START_V, altK: LANDING.APPROACH_ALT_K });

  const pressed = !!input.button && !b.prevButton;
  let gearDown = b.gearDown;
  let flareActive = b.flareActive;
  let flareClimbRate = b.flareClimbRate;
  if (b.sub === "approach" && pressed) {
    if (!flareActive && b.flight.alt <= LANDING.FLARE_LIVE_ALT) { flareActive = true; flareClimbRate = b.flight.climbRate; }
    else if (!gearDown) gearDown = true;
  }

  let alt = state.alt, climbRate = state.climbRate, pitch = state.pitch;
  if (flareActive) {
    const iy = clampNum(input.iy || 0, -1, 1); // pull = less sink
    const targetFps = (LANDING.FLARE_SINK_TARGET_FPM + LANDING.FLARE_TRIM_FPM * iy) / 60;
    const alpha = clampNum(dt / LANDING.FLARE_TAU, 0, 1);
    flareClimbRate = flareClimbRate + (targetFps - flareClimbRate) * alpha;
    climbRate = flareClimbRate;
    alt = b.flight.alt + flareClimbRate * dt;
    pitch = b.flight.pitch + (LANDING.FLARE_PITCH_TARGET - b.flight.pitch) * alpha; // the look only, never fed back into alt
  }
  alt = Math.max(0, alt);

  const events = [];
  let sub = b.sub, touchedDown = b.touchedDown, sinkAtTouchdown = b.sinkAtTouchdown, rolloutT = b.rolloutT, rangeAtTouchdown = b.rangeAtTouchdown;
  let bumps = b.bumps;
  if (b.sub === "approach" && !touchedDown && alt <= 0) {
    touchedDown = true;
    sinkAtTouchdown = Math.abs(climbRate) * 60; // ft/min
    rangeAtTouchdown = b.range;
    sub = "rollout"; rolloutT = 0;
    if (sinkAtTouchdown > LANDING.SINK_SMOOTH_MAX && sinkAtTouchdown <= LANDING.SINK_FIRM_MAX) {
      bumps += 1; events.push({ type: "bump", data: { reason: "sink" } });
    }
  } else if (sub === "rollout") {
    rolloutT = b.rolloutT + dt;
  }

  const range = b.range - state.v * 0.514 * dt;
  const distPastThreshold = range < 0 ? b.distPastThreshold + state.v * 0.514 * dt : 0;

  return {
    ...b, t, sub, flight: { ...state, alt, climbRate, pitch }, range, distPastThreshold,
    gearDown, flareActive, flareClimbRate, prevButton: !!input.button,
    touchedDown, sinkAtTouchdown, rolloutT, rangeAtTouchdown, bumps, events,
  };
}

// {cleared, failed, reachedFinal, reason, bumps, margin, metric}. metric = |y| at touchdown (the
// medal metric); `sink` is attached for the medal's sink-band check. reachedFinal signals the sim to
// cut to the FINAL checkpoint instead of a normal beat clear.
export function outcome(b) {
  const f = b.flight;
  if (Math.abs(f.bank) >= FLIGHT.BANK_FAIL) return fail("bank", b);

  if (b.sub === "escort") {
    if (Math.abs(f.alt - LANDING.ESCORT_ALT) > LANDING.ESCORT_BAND) return fail("off-structure", b);
    if (b.t >= LANDING.ESCORT_DURATION) return { cleared: false, failed: false, reachedFinal: true, reason: null, bumps: b.bumps, margin: 0, metric: 0 };
    return notDone(b);
  }

  if (!b.touchedDown) {
    if (f.alt <= LANDING.GEAR_FAIL_ALT && !b.gearDown) return fail("no-gear", b);
    if (b.distPastThreshold > LANDING.TOUCHDOWN_ZONE) return fail("off-runway", b);
    return notDone(b);
  }

  // A touchdown before the threshold (spec amendment A4): the desert, not the runway.
  if (b.rangeAtTouchdown > 0) return fail("short", b);
  if (b.sinkAtTouchdown > LANDING.SINK_FIRM_MAX) return fail("hard-landing", b);
  if (Math.abs(f.y) > LANDING.RUNWAY_HALF_WIDTH) return fail("off-runway", b);
  if (b.rolloutT >= LANDING.ROLLOUT_S) {
    const margin = 3 * (1 - Math.abs(f.y) / LANDING.RUNWAY_HALF_WIDTH);
    return { cleared: true, failed: false, reachedFinal: false, reason: null, bumps: b.bumps, margin, metric: Math.abs(f.y), sink: b.sinkAtTouchdown };
  }
  return notDone(b);
}
