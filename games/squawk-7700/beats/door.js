// The door beat (design "Door beat"): tap 7-7-0-0, press SQUAWK, hold DOOR. Can't fail by design (G1
// invariant) -- the gate just confirms it. Pure: no DOM, no three.js.
export const DOOR = {
  CODE: [7, 7, 0, 0],
  FILL_TIME: 2.5, // s, at 1.0x
  FILL_RATE_LEVEL: 1 / 2.5, // per second, |bank| < BANK_LEVEL_DEG
  FILL_RATE_HALF: 0.5 / 2.5, // per second, otherwise
  FILL_DECAY: 1, // per second, released
  BANK_LEVEL_DEG: 10,
  BANK_MAX: 20, // the wander's envelope
  IDLE_HINT_S: 20,
  GOLD_S: 8, SILVER_S: 12,
};

export function create(rngSim) {
  return {
    t: 0,
    step: "keypad", // "keypad" | "squawk" | "door"
    entered: [],
    squawked: false,
    fill: 0,
    holding: false,
    idleT: 0,
    w1: 0.6 + rngSim() * 0.5, p1: rngSim() * Math.PI * 2, a1: DOOR.BANK_MAX * (0.5 + rngSim() * 0.2),
    w2: 1.3 + rngSim() * 0.7, p2: rngSim() * Math.PI * 2, a2: DOOR.BANK_MAX * (0.2 + rngSim() * 0.2),
    bank: 0,
    events: [],
  };
}

function wander(b, t) {
  const raw = b.a1 * Math.sin(b.w1 * t + b.p1) + b.a2 * Math.sin(b.w2 * t + b.p2);
  const maxAmp = b.a1 + b.a2;
  return maxAmp > 0 ? (raw / maxAmp) * DOOR.BANK_MAX : 0;
}

// input: { ix, digit (0-9 or null, edge-triggered by the caller), button (held, for the DOOR step) }.
export function step(b, input, phase, dt) {
  const t = b.t + dt;
  const bank = wander(b, t) + 25 * (input.ix || 0);
  const events = [];
  let { step: s, entered, squawked, fill, holding, idleT } = b;
  let progressed = false;

  if (s === "keypad" && input.digit != null) {
    const expect = DOOR.CODE[entered.length];
    if (input.digit === expect) {
      entered = [...entered, input.digit];
      progressed = true;
      if (entered.length === DOOR.CODE.length) { s = "squawk"; }
    } else {
      entered = [];
      events.push({ type: "wrongDigit" });
    }
  } else if (s === "squawk" && input.button) {
    squawked = true; s = "door"; progressed = true;
    events.push({ type: "squawk" });
  } else if (s === "door") {
    holding = !!input.button;
    const rate = holding ? (Math.abs(bank) < DOOR.BANK_LEVEL_DEG ? DOOR.FILL_RATE_LEVEL : DOOR.FILL_RATE_HALF) : -DOOR.FILL_DECAY / DOOR.FILL_TIME;
    const nextFill = clamp01(fill + rate * dt);
    if (nextFill > fill) progressed = true;
    fill = nextFill;
  }

  idleT = progressed ? 0 : idleT + dt;

  return { ...b, t, step: s, entered, squawked, fill, holding, idleT, bank, events };
}

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

// {cleared, failed, reachedFinal, reason, bumps, margin, metric}. The door can't fail; metric = the
// intro+play clock time (the medal metric, gold <= 8s / silver <= 12s).
export function outcome(b) {
  const cleared = b.step === "door" && b.fill >= 1;
  return { cleared, failed: false, reachedFinal: false, reason: null, bumps: 0, margin: 0, metric: b.t };
}
