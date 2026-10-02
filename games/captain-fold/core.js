// Captain Fold rules core (THE-260/THE-264 M1). Pure: no DOM, no clock, no Math.random.
//
// World: x to the right, y = height above the lawn, 10 px = 1 m. The plane is a point with a small hitbox
// radius. Flight is a heading-angle energy model: hold turns the nose up, release turns it down, speed trades
// with height, and a constant sink plus drag bleed energy that only air currents give back. A hard stall
// forces the nose down and ignores input until speed recovers, which is what stops "hold forever".

export const PX_PER_M = 10;
export const DT = 1 / 120; // fixed physics step (s); render interpolates, logic never depends on frame rate

// Physics clock (G6, THE-260): the prototype values slowed by k = 0.61 (speeds x k, accelerations x k^2), so
// the top speed is VMAX 28 m/s and flights last ~30-45 s. Course geometry is unchanged.
export const P = {
  G: 97, // px/s², speed lost per unit sin(angle) climbing
  TURN: 1.46, // rad/s, nose turn rate while held / released
  MAX_ANGLE: 0.8, // rad, nose clamp both ways
  SINK: 12, // px/s, constant sink
  DRAG: 0.018, // 1/s, linear speed drag
  VSTALL: 67, // px/s, below this the plane stalls
  VRECOVER: 104, // px/s, a stall ends once speed is back above this
  STALL_TURN: 1.95, // rad/s, forced nose-drop rate in a stall
  VMAX: 280, // px/s, speed cap (28 m/s: the camera lookahead rule is 2 s x VMAX)
  CEILING: 600, // px, top of the flyable band (hanging obstacles hang from here)
  CLOUD_Y: 540, // px, the top 6 m cloud band: inside it the nose is forced down (like a stall), not a crash
  HIT_R: 9, // px, plane hitbox radius (the 64 px art is much bigger: forgiving on purpose)
  LAUNCH_Y: 330, // px, start ledge height
  LAUNCH_ANGLE: 0.3, // rad, fixed throw angle (the pull sets power only)
  V_THROW_MIN: 140, // px/s at the weakest accepted pull
  V_THROW_MAX: 220, // px/s at a full pull
  GRACE_S: 20, // s, paper-bounce window: crashes bounce instead of ending the flight
  BOUNCE_V: 130, // px/s, speed after a paper bounce: a hop back into the air (G6-A7, feel check THE-265)
  BOUNCE_Y: 110, // px, a ground bounce pops the plane back up to this height
  BOUNCE_ANGLE: 0.2, // rad, nose angle after a bounce
  UPDRAFT: 160, // px/s, extra climb speed while inside an updraft
  FAN: 63, // px/s², forward push while inside a fan / window draft
  DOWNDRAFT: 73, // px/s, extra sink while inside a downdraft
  LAND_ZONE: 400, // px, the 40 m landing zone at the course end; a house wall stands at its far end
  RING_3: 25, // px from the bullseye centre for 3 stars (spec: +-2.5 m)
  RING_2: 60, // px for 2 stars (the blanket, +-6 m); anywhere else in the zone = 1 star
  HARD_VY: 30, // px/s, unused by scoring (G6-A8 dropped the penalty); kept for a later soft-landing bonus
  STAR_R: 24, // px, lucky-star pickup radius
};

// ---------- seeded RNG ----------
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function dateSeed(y, m, d) {
  return (y * 10000 + m * 100 + d) * 2654435761 >>> 0;
}

// ---------- course generation ----------
// Obstacle kinds by geometry (the art maps onto them): hang (from the ceiling), rise (from the lawn),
// float (mid-air block), bob (mid-air, moves up/down), wide (long low block you must go over).
// Air kinds: up (updraft), fan (forward push), down (downdraft).
// `d` in [0, 1] is difficulty; the spec's ladder picks it per course.
export function generateCourse(seed, d = 0.5, opts = {}) {
  const rnd = makeRng(seed);
  const r = (a, b) => a + (b - a) * rnd();
  const lengthM = opts.lengthM ?? Math.round(500 + 700 * d);
  const L = lengthM * PX_PER_M;
  const kinds = opts.kinds ?? (d < 0.2 ? ["hang", "rise"] : d < 0.45 ? ["hang", "rise", "wide"] : d < 0.7 ? ["hang", "rise", "wide", "float"] : ["hang", "rise", "wide", "float", "bob"]);
  const gap = 230 - 80 * d; // vertical gap a route must fit through
  const obstacles = [];
  const air = [];
  let x = 1300; // first obstacle ~5 s in: inside the grace window, a bounce teaches it
  let prevCentre = P.LAUNCH_Y;
  const landStart = L - P.LAND_ZONE;
  while (x < landStart - 700) {
    // Alternate low and high gaps so a route needs a dive, then a climb. A low gap is always blocked from
    // above and a high gap from below, so no single cruising height (the hold-forever stall loop) gets through.
    const low = prevCentre > 300;
    const centre = low ? r(110 + gap / 2, 260) : r(340, P.CLOUD_Y - 20 - gap / 2);
    const fits = kinds.filter((k) => (low ? k !== "rise" && k !== "wide" : k !== "hang"));
    const kind = fits[Math.floor(rnd() * fits.length)];
    if (kind === "hang") {
      obstacles.push({ kind, x, w: 56, y0: centre + gap / 2, y1: P.CEILING });
    } else if (kind === "rise") {
      obstacles.push({ kind, x, w: 50, y0: 0, y1: centre - gap / 2 });
    } else if (kind === "wide") {
      obstacles.push({ kind, x, w: r(260, 420), y0: 0, y1: centre - gap / 2 });
    } else if (kind === "float") {
      // a block on the lazy side of the gap, with a narrow risky passage past its far edge
      const y0 = low ? centre + gap / 2 : 70;
      const y1 = low ? P.CEILING - 70 : centre - gap / 2;
      obstacles.push({ kind, x, w: 80, y0, y1 });
    } else {
      const amp = r(40, 70);
      const mid = low ? centre + gap / 2 + 30 + amp : Math.max(30 + amp, centre - gap / 2 - 30 - amp);
      const h = 2 * amp + 60; // sweeps its whole band, so the bob changes where the gap edge is, not whether it exists
      obstacles.push({ kind, x, w: 60, h: 60, mid, amp, period: r(3.6, 5.6), phase: rnd() * Math.PI * 2, y0: mid - h / 2, y1: mid + h / 2 });
    }
    // Air before the next obstacle: an updraft most of the time, sometimes a fan, off the lazy line.
    const ax = x + r(260, 420);
    const roll = rnd();
    if (roll < 0.62) air.push({ kind: "up", x: ax, w: r(150, 220), y0: r(40, 180), y1: r(300, 470) });
    else if (roll < 0.87) air.push({ kind: "fan", x: ax, w: r(220, 320), y0: r(220, 330), y1: r(400, 520) });
    else if (d >= 0.45) air.push({ kind: "down", x: ax, w: r(160, 240), y0: r(260, 360), y1: P.CEILING });
    else air.push({ kind: "up", x: ax, w: 180, y0: 60, y1: 380 });
    prevCentre = centre;
    x += r(620, 900) - 180 * d;
  }
  // Lucky stars on the good routes: through the next updraft and through each gap.
  const stars = [];
  for (const a of air) if (a.kind === "up") stars.push({ x: a.x + a.w / 2, y: (a.y0 + a.y1) / 2 });
  return { seed, d, lengthM, L, landStart, bullseye: L - P.LAND_ZONE / 2, obstacles, air, stars };
}

// ---------- flight ----------
export function throwSpeed(power) {
  const p = Math.max(0, Math.min(1, power));
  return P.V_THROW_MIN + (P.V_THROW_MAX - P.V_THROW_MIN) * p;
}

export function newFlight(course, power = 1) {
  return {
    t: 0, x: 60, y: P.LAUNCH_Y, v: throwSpeed(power), a: P.LAUNCH_ANGLE,
    held: false, stalled: false, bounces: 0, over: false, result: null, maxX: 60,
    starsTaken: new Set(), knocked: new Set(), // obstacle indexes a grace bounce knocked aside (flight state, never the course)
  };
}

function obstacleY(o, t) {
  if (o.kind !== "bob") return [o.y0, o.y1];
  const c = o.mid + o.amp * Math.sin((2 * Math.PI * t) / o.period + o.phase);
  return [c - o.h / 2, c + o.h / 2];
}

function hitsRect(px, py, r, x0, x1, y0, y1) {
  const cx = Math.max(x0, Math.min(px, x1));
  const cy = Math.max(y0, Math.min(py, y1));
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

// Advance one fixed step. Returns an event name or null ("bounce", "crash", "land", "stall", "star").
export function step(f, course, held) {
  if (f.over) return null;
  const dt = DT;
  f.held = held;
  f.t += dt;
  let ev = null;
  if (f.stalled) {
    f.a = Math.max(-P.MAX_ANGLE, f.a - P.STALL_TURN * dt);
    if (f.v >= P.VRECOVER) f.stalled = false;
  } else {
    const up = held && f.y < P.CLOUD_Y; // the cloud band pushes the nose down whatever the input
    f.a += (up ? P.TURN : -P.TURN) * dt;
    f.a = Math.max(-P.MAX_ANGLE, Math.min(P.MAX_ANGLE, f.a));
  }
  f.v += (-P.G * Math.sin(f.a) - P.DRAG * f.v) * dt;
  let lift = 0;
  for (const c of course.air) {
    if (f.x < c.x || f.x > c.x + c.w || f.y < c.y0 || f.y > c.y1) continue;
    if (c.kind === "up") lift += P.UPDRAFT;
    else if (c.kind === "fan") f.v += P.FAN * dt;
    else lift -= P.DOWNDRAFT;
  }
  f.v = Math.min(P.VMAX, Math.max(20, f.v));
  if (!f.stalled && f.v < P.VSTALL) { f.stalled = true; ev = "stall"; }
  f.x += f.v * Math.cos(f.a) * dt;
  f.y += (f.v * Math.sin(f.a) - P.SINK + lift) * dt;
  if (f.y > P.CEILING) { f.y = P.CEILING; f.a = Math.min(f.a, 0); }
  f.maxX = Math.max(f.maxX, f.x);

  for (let i = 0; i < course.stars.length; i++) {
    const s = course.stars[i];
    if (!f.starsTaken.has(i) && (f.x - s.x) ** 2 + (f.y - s.y) ** 2 < P.STAR_R * P.STAR_R) { f.starsTaken.add(i); ev = ev || "star"; }
  }

  const grace = f.t < P.GRACE_S;
  if (f.y <= 0) {
    if (f.x >= course.landStart) return land(f, course);
    if (grace) return bounce(f, P.BOUNCE_Y);
    return crash(f);
  }
  for (let i = 0; i < course.obstacles.length; i++) {
    const o = course.obstacles[i];
    if (f.knocked.has(i) || f.x + P.HIT_R < o.x || f.x - P.HIT_R > o.x + o.w) continue;
    const [y0, y1] = obstacleY(o, f.t);
    if (hitsRect(f.x, f.y, P.HIT_R, o.x, o.x + o.w, y0, y1)) {
      if (grace) { f.knocked.add(i); return bounce(f, f.y); }
      return crash(f);
    }
  }
  // The house wall ends the zone: a miss is a crash, except in the grace window, where the plane slides down
  // the wall onto the zone edge (a 1-star landing), since the first 20 s can't be lost.
  if (f.x >= course.L) { if (grace) { f.x = course.L; return land(f, course); } return crash(f); }
  return ev;
}

function bounce(f, y) {
  f.bounces++;
  f.y = Math.max(y, 1);
  f.v = P.BOUNCE_V;
  f.a = P.BOUNCE_ANGLE;
  f.stalled = false;
  return "bounce";
}

function crash(f) {
  f.over = true;
  f.result = { kind: "crash", x: f.x, t: f.t };
  return "crash";
}

function land(f, course) {
  f.over = true;
  const dx = Math.abs(f.x - course.bullseye); // px from the bullseye centre
  const vy = -(f.v * Math.sin(f.a) - P.SINK); // touch-down sink rate, px/s
  // Stars are rings only (G6-A8, feel check THE-265): a hard-landing penalty would dock nearly every landing
  // (measured touch-down sink rate p10 6.2 / median 10.5 / p90 20.6 m/s across 130 pilot landings). vy stays on
  // the result for a possible later soft-landing bonus.
  const stars = dx <= P.RING_3 ? 3 : dx <= P.RING_2 ? 2 : 1;
  f.result = { kind: "land", x: Math.min(f.x, course.L), t: f.t, off: Math.min(1, dx / (P.LAND_ZONE / 2)), vy, stars };
  return "land";
}

// The flight's single score (spec §2, the engagement gate's number). A crash scores the metres flown, capped
// at the zone start; a landing scores the course length + 100 + 50 per landing star + 5 per lucky star, so any
// landing beats any crash on the same course. Lucky stars count only on a landing.
export function score(f, course) {
  if (f.result?.kind === "land") return course.lengthM + 100 + 50 * f.result.stars + 5 * f.starsTaken.size;
  return Math.floor(Math.min(f.maxX, course.landStart) / PX_PER_M);
}

// Landing stars (0-3, spec S2 as amended G6-A8): 0 for a crash; rings at touchdown, no hard-landing penalty.
export function starsFor(f) {
  return f.result?.kind === "land" ? f.result.stars : 0;
}

export { obstacleY };
