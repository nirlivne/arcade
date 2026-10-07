// Cannonball Family rules (THE-449 S1–S3 rules; design "Rules (sim)"). Pure: the sim advances only by step index
// (DT per step), with no DOM, no clock and no unseeded RNG (the seeded rng from def.seed is the only randomness).
// Phases: aim → flight → bow → aim | won | lost.
import { World } from "./physics.js";
import { launchVelocity } from "./aim.js";
import { KNACKS, knackFor } from "./knacks.js";
import { railMember } from "./family.js";
import { mulberry32 } from "./rng.js";

export const DT = 1 / 120;
export const FIELD = { l: 0, r: 640, floor: 456 };
export const CANNON = { x: 90, y: 400 };
export const TIN_R = 20, FLYER_R = 36;
export const FLIGHT_CAP = 480; // 4 s after launch: a shot always resolves
export const BOW_STEPS = 72; // 600 ms of bow or shrug in the net
export const FUSE_STEPS = 1800; // 15 s of aiming before the cannon fires on its own
export const TARGET_POINTS = 100, UNUSED_POINTS = 250;
export const STAR_MAX = 3;
export const STONE_R = 20, STONE_MASS = 4; // stones are heavy obstacles, never targets
export const CRACK_IMPULSE = 250; // a heavy helmet hit this hard breaks a stone (world units per second)
export const PLANK_IMPULSE = 250; // a plank swings on a hit this hard, or when a tin it holds goes down
export const PLANK_SWING_STEPS = 30; // 0.25 s to swing 90°

const PHASE_CODE = { aim: 1, flight: 2, bow: 3, won: 4, lost: 5 };

// def: { N, seed, ledges: [{ x0, x1, top, h, plank? }], tins: [{ x, y, ledge }], stones?: [{ x, y }],
//        slots?: [knack|null] × N, par? }. A ledge with plank: true is a plank on a pivot at its x0 end.
// Everything spawns asleep. opts: { level, familySize } (the rail start and the member on each slot).
export function createLevel(def, { level = 1, familySize = 5 } = {}) {
  const world = new World(FIELD);
  // Each sim gets its own ledge objects: a plank's state and impact live on them, never on the shared def.
  const ledges = def.ledges.map((L) => world.addLedge({ ...L, state: L.plank ? "rest" : null, swingStart: 0, off: false }));
  const tins = def.tins.map((t) => world.add({ x: t.x, y: t.y, r: TIN_R, sleep: true, ledge: t.ledge, down: false }));
  const stones = (def.stones || []).map((s) => world.add({ x: s.x, y: s.y, r: STONE_R, sleep: true, mass: STONE_MASS, stone: true }));
  const rail = [];
  for (let k = 0; k < def.N; k++) rail.push({ member: railMember(level, k, familySize), knack: knackFor(def, k) });
  return {
    def, world, ledges, tins, stones, rail,
    N: def.N, shotsLeft: def.N,
    cap: def.par === undefined ? STAR_MAX : Math.min(STAR_MAX, def.N - def.par),
    rng: mulberry32(def.seed ?? 1),
    phase: "aim", step: 0, fuse: FUSE_STEPS,
    flyer: null, flightStart: 0, downThisShot: 0, cracked: 0,
    bowUntil: 0, pose: null, poses: [],
    score: 0, stars: 0, shots: [],
  };
}

// One shot from a fire angle and power (0–1). The rail slot's knack changes the flyer, never who fills the slot.
// source is "aim" (the player released), "keys" (keyboard fire), "fuse" / "fuse-held" (the cannon fired on its own)
// or "bot" / "probe" / "hook" (the gate and the test hook). Every shot is logged with the step it fired at (the
// daily's first-attempt resume replays from this log; see fastForwardAim).
export function fire(sim, angle, power, source = "aim") {
  if (sim.phase !== "aim") return false;
  const knack = KNACKS[sim.rail[sim.N - sim.shotsLeft].knack] || {};
  const { vx, vy } = launchVelocity(angle, power * (knack.power ?? 1));
  sim.flyer = sim.world.add({
    x: CANNON.x, y: CANNON.y, r: FLYER_R, vx, vy,
    mass: knack.mass, e: knack.e, bounces: knack.bounces ?? 0, cracks: !!knack.cracks,
  });
  sim.phase = "flight";
  sim.shotsLeft -= 1;
  sim.flightStart = sim.step;
  sim.downThisShot = 0;
  sim.lastSource = source;
  sim.shots.push({ angle, power, step: sim.step, source });
  return true;
}

// Fast-forwards the aim phase by n steps without going through step(): nothing physical happens during aim (bodies
// stay asleep, nothing collides), so advancing the step and fuse counters directly is exactly equivalent to calling
// step() n times, as long as the caller fires its own shot instead of letting the fuse auto-fire. The fuse value
// isn't part of hash(), so it only needs to be a counter, never exactly right. Throws outside the aim phase.
export function fastForwardAim(sim, n) {
  if (sim.phase !== "aim") throw new Error("fastForwardAim: not in the aim phase");
  sim.step += n;
  sim.fuse -= n;
}

// A shot from the level's rng: angle uniform 10–80°, power uniform 0–1 (the same rule as the gate's random bot).
export function randomShot(sim) {
  return { angle: 10 + 70 * sim.rng(), power: sim.rng() };
}

// held() returns the current aim while a pull of 20 px or more is down (or null). The fuse fires at that aim if
// there is one, otherwise a random shot; the later real release is a no-op because the game drops the pull.
export function step(sim, n = 1, held = null) {
  for (let i = 0; i < n; i++) stepOne(sim, held);
}

function stepOne(sim, held) {
  sim.step += 1;
  if (sim.phase === "aim") {
    sim.fuse -= 1;
    if (sim.fuse <= 0) {
      const aim = held ? held() : null;
      const shot = aim || randomShot(sim);
      fire(sim, shot.angle, shot.power, aim ? "fuse-held" : "fuse");
    }
  } else if (sim.phase === "flight") {
    sim.world.step(DT);
    const f = sim.flyer;
    if (f.bounces > 0 && f.impact > 0) {
      f.bounces -= 1;
      if (f.bounces === 0) f.e = undefined; // the bounce knack lasts for one bounce only
    }
    if (f.cracks) crackStones(sim);
    touchLedges(sim);
    markDown(sim);
    updatePlanks(sim, true);
    const settled = sim.world.bodies.every((b) => b.sleep);
    if (settled || sim.step - sim.flightStart >= FLIGHT_CAP) resolve(sim);
  } else if (sim.phase === "bow" && sim.step >= sim.bowUntil) {
    afterBow(sim);
  }
  updatePlanks(sim, false); // a swing keeps its 30 steps going in every phase, the world only moves in flight
}

// A touch ledge (level data, spec §2 "topple from any touch") gives way when the flyer reaches a standing tin on it:
// its collider goes and its tins wake, so they fall and count down through the normal tin-down rule.
function touchLedges(sim) {
  const f = sim.flyer;
  for (const t of sim.tins) {
    if (t.down) continue;
    const L = sim.ledges[t.ledge];
    if (!L.touch || L.off) continue;
    if (Math.hypot(f.x - t.x, f.y - t.y) <= f.r + t.r + 1) {
      L.off = true;
      sim.world.wakeAll();
    }
  }
}

// A heavy helmet hit hard enough breaks a stone it touches: the stone leaves the world (chips are drawn in S6).
function crackStones(sim) {
  const f = sim.flyer;
  for (const s of sim.stones) {
    if (Math.hypot(s.x - f.x, s.y - f.y) <= f.r + s.r + 1 && s.impact > CRACK_IMPULSE) {
      sim.world.remove(s);
      sim.stones = sim.stones.filter((x) => x !== s);
      sim.cracked += 1;
    }
  }
}

// Planks: a plank swings 90° about its pivot (x0) by rule when a hit passes the threshold or a tin it holds goes
// down. Its collider goes at the first swing step, so what sits on it wakes and falls. After 30 steps it has fallen.
// triggers is true only in flight: the impacts and tin-downs that start a swing happen there.
function updatePlanks(sim, triggers) {
  for (const [i, L] of sim.ledges.entries()) {
    if (!L.plank) continue;
    if (L.state === "rest" && triggers) {
      const tinDown = sim.tins.some((t) => t.ledge === i && t.down);
      if (L.impact > PLANK_IMPULSE || tinDown) {
        L.state = "swing";
        L.swingStart = sim.step;
        L.off = true;
        sim.world.wakeAll();
      }
    } else if (L.state === "swing" && sim.step - L.swingStart >= PLANK_SWING_STEPS) {
      L.state = "fallen";
    }
  }
}

// A tin is down once its centre drops more than its radius below its ledge top, leaves the ledge's x-span,
// touches the floor, or its own shelf has given way (`L.off`, which also covers a plank's swing). Counted
// once; the tin stays in the world as a body.
//
// THE-465 / spec v4d (the CTO's call per the designer's own routing of feel-check item 4, THE-450): the old
// rule (no `L.off` check) was itself the bug, not a safe default — the CTO traced the random bot on L8 seed
// 800 and found most of its "losses" were a tin that fell with its given-way shelf onto a heap, settling just
// above the other thresholds: no shelf drawn under it, still counted as standing. That can't ship. Keeping
// `L.off` fixes that at the cost of widening chapter 1's random-clear band to ≤ 40 % for levels 8–10
// (RANDOM_BAND in the solver lib) — the old ≤ 20 % band was only being met by the undercounting bug, not by
// tower design. Levels 1–3's random clears are unaffected (the engagement gate doesn't need re-tuning).
function markDown(sim) {
  for (const t of sim.tins) {
    if (t.down) continue;
    const L = sim.ledges[t.ledge];
    if (L.off || t.y > L.top + t.r || t.x < L.x0 || t.x > L.x1 || t.y + t.r >= FIELD.floor - 1e-6) {
      t.down = true;
      sim.downThisShot += 1;
    }
  }
}

// The shot is over when every body sleeps or at the 4 s cap; a tin still teetering counts as standing.
function resolve(sim) {
  sim.world.remove(sim.flyer);
  sim.flyer = null;
  sim.pose = sim.downThisShot > 0 ? "bow" : "shrug";
  sim.poses.push(sim.pose);
  sim.phase = "bow";
  sim.bowUntil = sim.step + BOW_STEPS;
}

function afterBow(sim) {
  if (sim.tins.every((t) => t.down)) {
    sim.phase = "won";
    sim.stars = Math.min(sim.shotsLeft, sim.cap); // stars = unused members, up to the cap
    sim.score = tinsDown(sim) * TARGET_POINTS + sim.shotsLeft * UNUSED_POINTS;
  } else if (sim.shotsLeft === 0) {
    sim.phase = "lost";
    sim.stars = 0;
    sim.score = tinsDown(sim) * TARGET_POINTS;
  } else {
    sim.phase = "aim";
    sim.fuse = FUSE_STEPS;
  }
}

export function tinsDown(sim) {
  return sim.tins.filter((t) => t.down).length;
}

// A copy a probe can fire without touching the real sim: bodies, ledges (planks and touch shelves keep state on
// them), tins, stones and the flyer are all copied. The rng is shared, which is safe because a probe runs one shot
// and stops at the next aim, before any fuse can draw from it.
export function cloneSim(sim) {
  const copyOf = new Map();
  const world = Object.create(Object.getPrototypeOf(sim.world));
  world.b = sim.world.b;
  const ledges = sim.world.ledges.map((L) => { const c = { ...L }; copyOf.set(L, c); return c; });
  world.ledges = ledges;
  world.bodies = sim.world.bodies.map((b) => { const c = { ...b }; copyOf.set(b, c); return c; });
  return {
    ...sim,
    world,
    ledges,
    tins: sim.tins.map((t) => copyOf.get(t)),
    stones: sim.stones.map((s) => copyOf.get(s)),
    flyer: sim.flyer ? copyOf.get(sim.flyer) : null,
    rail: sim.rail.map((r) => ({ ...r })),
    poses: sim.poses.slice(),
    shots: sim.shots.slice(),
  };
}

// FNV-1a over every body's position and velocity (rounded to 1e-3), the phase, the step index and the rng
// state. The rng state matters (CTO review on THE-449): two sims can agree on every body and still be about to
// diverge, if a resumed run's replay never drew the rng for a fuse-fired shot (randomShot(sim) draws it twice)
// while an unbroken run did — this makes that class of bug show up as a hash mismatch right away, rather than
// only at the next fuse shot after the one the test happens to check.
export function hash(sim) {
  let h = 0x811c9dc5;
  const mix = (v) => { h ^= v | 0; h = Math.imul(h, 0x01000193); };
  for (const b of sim.world.bodies) {
    mix(Math.round(b.x * 1000));
    mix(Math.round(b.y * 1000));
    mix(Math.round(b.vx * 1000));
    mix(Math.round(b.vy * 1000));
    mix(b.sleep ? 1 : 0);
  }
  mix(PHASE_CODE[sim.phase]);
  mix(sim.step);
  mix(sim.rng.state);
  return h >>> 0;
}
