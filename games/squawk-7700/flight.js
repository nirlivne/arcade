// The arcade 5-number flight model (design "Flight model" table), shared by the dive and the landing.
// Pure: no DOM, no three.js, no Math.random (noise/gust/side come from the caller's rngSim stream).
// 1 step = 1/60 s. Values here are the S1 knobs; the S1 feel-check tuning rule may move the feel
// constants (PULL, push, ALT_K, the speed/curve coefficients); VMO/VD/floor/chunk doses/65°/4g move
// only through a spec amendment logged on THE-729.

export const FLIGHT = {
  PULL_NORMAL: 6, // deg/s per full pull, before the pull-out
  PULL_OUT: 9, // deg/s per full pull, once the runaway ends
  PITCH_MIN: -45, PITCH_MAX: 20,

  BANK_TARGET_MAX: 45, BANK_RATE: 60, // deg/s approach rate toward 45·ix
  BANK_FAIL: 65,
  DUTCH_ROLL_AMP: 8, DUTCH_ROLL_PERIOD: 4, // s

  DRIFT_HEADING_K: 0.15, DRIFT_RUDDER_K: 1.5, DRIFT_CROSSWIND_K: 0.3,

  SPEED_K_PITCH: 0.5, SPEED_K_DRAG: 0.05, SPEED_TRIM: 280, SPEED_CAP: 480,
  VMO: 340, VD: 440,

  ALT_K: 4, FLOOR_ALT: 9000,

  G_SMOOTH_TAU: 0.2, G_BUMP_ON: 4.0, G_BUMP_OFF: 3.5,

  CHUNK_DOSES: [40, 120, 240], // kt·s
  RUDDER_LEVELS: [1, 0.67, 0.33, 0],

  BANK_FAIL_DIVE: 65,
};

function clampNum(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
function approach(cur, target, maxDelta) {
  const d = target - cur;
  if (d > maxDelta) return cur + maxDelta;
  if (d < -maxDelta) return cur - maxDelta;
  return target;
}

// Rudder is always derived from chunksLost (the source of truth); pass either in overrides and the
// other is resolved so a carried-in `rudder` (e.g. from save data) seeds the right chunk count.
export function rudderToChunksLost(rudder) {
  const idx = FLIGHT.RUDDER_LEVELS.indexOf(rudder);
  return idx >= 0 ? idx : 0;
}

export function initFlight(overrides = {}) {
  const chunksLost = overrides.chunksLost ?? (overrides.rudder != null ? rudderToChunksLost(overrides.rudder) : 0);
  return {
    pitch: 0, bankBase: 0, bank: 0, v: 0, alt: 0,
    heading: 0, y: 0, g: 1, dose: 0, bumpArmed: true,
    margin: 0, climbRate: 0,
    ...overrides,
    chunksLost,
    rudder: FLIGHT.RUDDER_LEVELS[chunksLost],
  };
}

// input: { ix, iy } in [-1, 1] (iy = +1 is full pull, nose up).
// env: { t (s, since the beat's attempt started), dt (s), pullRate, push (deg/s), noise (deg/s pitch
//   noise this step, from rngSim), pitchCap (max pitch this step, or null), side (+-1 seeded drift
//   side), crosswind (kt), gust (deg bank offset this step, from rngSim), speedTrim (kt, the speed the
//   beat trims toward absent pitch input; defaults to the dive's 280) }.
// Returns { state, events }: events is an array of { type: "rudderChunk" | "bump", data }.
export function stepFlight(f, input, env) {
  const dt = env.dt;
  const ix = clampNum(input.ix || 0, -1, 1), iy = clampNum(input.iy || 0, -1, 1);
  const pull = env.pullRate ?? FLIGHT.PULL_NORMAL;
  const push = env.push || 0;
  const noise = env.noise || 0;

  let pitch = f.pitch + (pull * iy - push + noise) * dt;
  pitch = clampNum(pitch, FLIGHT.PITCH_MIN, FLIGHT.PITCH_MAX);
  if (env.pitchCap != null) pitch = Math.min(pitch, env.pitchCap);

  const bankTarget = FLIGHT.BANK_TARGET_MAX * ix;
  const bankBase = approach(f.bankBase, bankTarget, FLIGHT.BANK_RATE * dt);
  const dutch = FLIGHT.DUTCH_ROLL_AMP * (1 - f.rudder) * Math.sin((2 * Math.PI * env.t) / FLIGHT.DUTCH_ROLL_PERIOD);
  const gust = env.gust || 0;
  const bank = bankBase + dutch + gust;

  const side = env.side || 0, crosswind = env.crosswind || 0;
  const headingRate = FLIGHT.DRIFT_HEADING_K * bank - FLIGHT.DRIFT_RUDDER_K * (1 - f.rudder) * side - FLIGHT.DRIFT_CROSSWIND_K * crosswind;
  const heading = f.heading + headingRate * dt;
  const y = f.y + f.v * 0.514 * Math.sin((heading * Math.PI) / 180) * dt;

  const speedTrim = env.speedTrim ?? FLIGHT.SPEED_TRIM;
  const dvdt = -FLIGHT.SPEED_K_PITCH * pitch - FLIGHT.SPEED_K_DRAG * (f.v - speedTrim);
  const v = clampNum(f.v + dvdt * dt, 0, FLIGHT.SPEED_CAP);

  const altK = env.altK ?? FLIGHT.ALT_K;
  const climbRate = v * 1.688 * Math.sin((pitch * Math.PI) / 180) * altK;
  const alt = f.alt + climbRate * dt;

  const pitchRateRad = ((pitch - f.pitch) / dt) * (Math.PI / 180);
  const gRaw = 1 + (pitchRateRad * (v * 0.514)) / 9.81;
  const smoothAlpha = clampNum(dt / FLIGHT.G_SMOOTH_TAU, 0, 1);
  const g = f.g + (gRaw - f.g) * smoothAlpha;

  const events = [];
  let bumpArmed = f.bumpArmed;
  if (bumpArmed && g >= FLIGHT.G_BUMP_ON) { events.push({ type: "bump", data: { reason: "g", g } }); bumpArmed = false; }
  else if (!bumpArmed && g <= FLIGHT.G_BUMP_OFF) bumpArmed = true;

  const over = Math.max(0, v - FLIGHT.VMO);
  const dose = f.dose + over * dt;
  let chunksLost = f.chunksLost;
  while (chunksLost < FLIGHT.CHUNK_DOSES.length && dose >= FLIGHT.CHUNK_DOSES[chunksLost]) {
    chunksLost++;
    events.push({ type: "rudderChunk", data: { chunk: chunksLost } });
  }
  const rudder = FLIGHT.RUDDER_LEVELS[chunksLost];

  const margin = f.margin + (v > FLIGHT.VMO && v < FLIGHT.VD ? (v - FLIGHT.VMO) / (FLIGHT.VD - FLIGHT.VMO) * dt : 0);

  return {
    state: { pitch, bankBase, bank, v, alt, rudder, heading, y, g, dose, chunksLost, bumpArmed, margin, climbRate },
    events,
  };
}
