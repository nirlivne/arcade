// Fixed-step sim (design: 60 Hz, all gameplay timers in sim time, never setTimeout). Track-space only:
// the capy is (s, lane, y); render maps that to world coordinates. No three.js import here, ever.
import { mulberry32 } from "./rng.js";
import { speedAt } from "./speed.js";
import { createPatterns } from "./patterns.js";
import { createLevelPatterns } from "./level-patterns.js";
import { LANE_SPACING } from "./track.js";
import { JUMP_AIR, JUMP_PEAK, COIN_HOVER, jumpHeight, jumpAirFor, jumpPeakFor, SPRING_HEIGHT_MULT, SPRING_AIR_MULT, arcHeightNow } from "./jump.js";
import { POWER_TIME, BALLOON_HEIGHT, BALLOON_RISE_T, BALLOON_FLOAT_T, BALLOON_DESCEND_T, BALLOON_LANDING_T } from "./powerups.js";
import { computeScore } from "./score.js";

export const GRACE_TIME = 20;
export const LANE_STEP_TIME = 0.15;
export { JUMP_AIR, JUMP_PEAK, COIN_HOVER, SPRING_HEIGHT_MULT, SPRING_AIR_MULT, arcHeightNow };
export const DUCK_TIME = 0.6;
export const FAST_DROP_MULT = 3;
export const STUMBLE_TIME = 0.6;
export const ARC_PICKUP_TOL = 0.45; // P2: how far (m) the capy may be off an arc coin's height and still take it
export const CAPY_LEN = 1.0;
export const CAPY_HEIGHT = { stand: 0.75, duck: 0.4 };
export const HAZARD_LEN = { low: 0.5, high: 0.4, block: 1.2, either: 0.3 };
// A12.5 (THE-1301): offset is the lateral gap, in metres, between the capy's own interpolated x and a
// hazard/filler's lane centre -- the single number both _checkHazards and _checkClosures gate on, in place
// of A11/A12.2-3's binary "is this lane occupied" test (_lanesOccupied, deleted). The CTO's own worked
// example (A12.13): capy hit width 0.6 m + hazard width 1.2 m means contact physically ends at 0.90 m of
// offset, so 0-0.45 m is the head-on band and 0.45-0.90 m is the full side-hit band; beyond 0.90 m there's
// no contact at all, same as being in a non-adjacent lane.
export const HEAD_ON_MAX_OFFSET = 0.45, SIDE_HIT_MAX_OFFSET = 0.90;
export const STRIKE_WINDOW_T = 5.0; // A12.4/A12.5: the strike clears, and a 2nd stumble inside it is a catch
export const CHASER_FAR_DIST = 9.0, CHASER_CLOSE_DIST = 2.2; // A12.4
export const CHASER_FAR_TO_CLOSE_T = 0.4, CHASER_CLOSE_TO_FAR_T = 1.5; // A12.4: "ease-out" / "with a deflated honk"
export const CHASER_OPENING_CLOSE_T = 3.0; // A12.4: "close for 0-3.0 s" at run start, no strike involved
// CTO fix item 4 (THE-1259, 2026-11-05 22:43Z): the forest log's jump window reads better at 0.5 m than
// 0.7 m -- still within spec §2's "low <= 0.7 m" (a ceiling, not a fixed value), so no spec amendment.
// A12.1 (THE-1297): "either" (a log on two knee-high stumps) -- a ducking capy (top CAPY_HEIGHT.duck=0.4)
// clears under its 0.45 m floor, a jumping capy clears once its feet (y) pass its 0.80 m top, and a
// standing capy (top CAPY_HEIGHT.stand=0.75) overlaps it -- all already true of bandsOverlap() below with
// no extra logic, given these two bands.
export const HAZARD_BAND = { low: [0, 0.5], high: [0.5, 2.2], block: [0, 1000], either: [0.45, 0.80] };
export const TURN_BEFORE = 1.0; // seconds before the corner centre the window opens
export const TURN_AFTER = -0.25; // seconds after the centre the window closes (negative = already past)
export const TURN_BUFFER = 0.25; // extra lead time a press just before the window still counts
export { POWER_TIME, BALLOON_HEIGHT, BALLOON_RISE_T, BALLOON_FLOAT_T, BALLOON_DESCEND_T, BALLOON_LANDING_T }; // spec Part 1 power-up timings
export const HONEY_RADIUS = 15; // spec Part 1 "Honey Jar": every coin within 15 m ahead, all 3 lanes
export const SHIELD_IFRAME_TIME = 0.6; // spec Part 1 "Picnic Shield": i-frames granted once the bubble pops
// README "sky coins" said every 2.5 m; THE-1377 slice 9 review halved it. No ground coin can be taken while aloft
// (any lane), so at 2.5 m a balloon was a net coin loss -- level 7 "Balloon ride" paid 495 skipping both balloons
// vs 452 taking them. At 1.25 m taking them pays ~528.
export const BALLOON_SKY_COIN_SPACING = 1.25, BALLOON_SKY_COIN_LEAD = 3;
export const LEVEL_FINISH_COAST_T = 1.2; // design/capy-trail/levels/README.md "the moment": coast to 60% speed

// Pure hit-box helpers (spec §2), independently testable from the stateful sim below.
export function capyBand({ airborne, y, ducking }) {
  if (airborne) return [y, y + CAPY_HEIGHT.stand];
  if (ducking) return [0, CAPY_HEIGHT.duck];
  return [0, CAPY_HEIGHT.stand];
}
export function hazardBand(kind) { return HAZARD_BAND[kind]; }
export function bandsOverlap([a0, a1], [b0, b1]) { return a0 < b1 && a1 > b0; }
// A12.5: the capy's own lateral world position while mid-lane-step (linear over the 0.15 s step, per
// A12.2's own worked formula), and the gap from that to any lane's centre. Pure/exported so Q12's offset
// matrix (stepT 0.30/0.50/0.70/0.80) can be driven straight off these, same as capyBand/bandsOverlap above.
export function capyX(lane, stepLane, stepT) { return stepLane === null ? LANE_SPACING * lane : LANE_SPACING * (lane + (stepLane - lane) * stepT); }
export function lateralOffset(x, hazardLane) { return Math.abs(x - LANE_SPACING * hazardLane); }
export function inTurnWindow(tToCorner) { return tToCorner <= TURN_BEFORE + TURN_BUFFER && tToCorner >= TURN_AFTER; }
export function newLogEntriesSince(log, afterT) { return log.filter((e) => e.t > afterT); }
export function biomeAt(s) { return s < 700 ? "forest" : s < 1600 ? "lagoon" : "desert"; }

// Vertical clearance for a near miss (spec §2): capy feet above a low hazard's top, or the gap under a
// high hazard's bottom. Lateral clearance (adjacent-lane block) is the lane spacing minus half-widths.
export function clearanceOf(capyState, hazardKind, laneDelta = 0) {
  if (laneDelta !== 0) return Math.abs(laneDelta) * LANE_SPACING - 1.2 / 2 - 0.6 / 2;
  const [cBottom, cTop] = capyBand(capyState);
  const [hBottom, hTop] = HAZARD_BAND[hazardKind];
  return hazardKind === "high" ? hBottom - cTop : cBottom - hTop;
}

class Sim {
  // THE-1412: `level` (a sim/levels.js entry, or null for Endless) switches the whole generator -- the
  // level's own fixed layout (sim/level-patterns.js) instead of the endless schedulers, the speed curve
  // read at level.t0 + t instead of t, and (catch: false) grace forced on for the whole level.
  constructor(seed, scoreMult = 1, level = null) {
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.level = level;
    this.levelT0 = level ? level.t0 : 0;
    this.patterns = level ? createLevelPatterns(level) : createPatterns(this.rng);
    this.hits = 0; // THE-1412: every logged "stumble" (a shield absorb never logs one) -- level star 3
    this.levelFinished = false; this.levelFinishT = null;
    this.scoreMult = scoreMult; // save-owned (spec Part 2): fixed for this run, always 1 until slice 7
    this.t = 0; this.s = 0; this.v = speedAt(this.levelT0);
    this.lane = 0; this.stepLane = null; this.stepT = 0; this.pendingDir = null;
    this.y = 0; this.airborne = false; this.jumpT = null; this.pendingJump = false; this.dropping = false;
    this.jumpSpring = false; // THE-1398: spring active at this jump's own take-off, fixed for the flight
    this.ducking = false; this.duckT = 0;
    this.stumbleT = 0;
    this.coins = 0;
    this.nearMissWindow = []; // sim times of recent near misses, for the 3-within-5s chain (spec §2)
    this.coinMultiplier = 1;
    this.chainT = 0; // seconds left on an active 2x chain
    this.power = { kind: null, t: 0 }; // active timed power-up (spec Part 1); null kind = none active
    this.shieldIFrameT = 0; // THE-1391: the 0.6 s of i-frames granted once the shield pops (absorb or timeout)
    this._balloonPrevPhase = null; // last step's phase, so "balloonDescend" logs exactly once at the edge
    this._balloonCoinSeq = 0; // sky-coin id counter, separate from patterns.js's own `c{n}` coin ids
    this._balloonPickupT = null; // absolute sim.t of the last pickup; the phase clock runs off this, not power.t
    this.crashed = false; this.crashCause = null; this.crashDetail = null;
    this.pose = "gallop";
    this.log = [];
    this.speedOverride = null; // test hook (__capy.setSpeed)
    // A12.4: the geese start close (the title screen's own chase already had them right behind) and fall
    // back to far at CHASER_OPENING_CLOSE_T with no strike involved -- fallbackAt drives that one time-only
    // transition the same way a real strike's fallbackAt (armed by _armStrike) drives its own recovery.
    this.chaser = { mode: "close", dist: CHASER_CLOSE_DIST, strikeActive: false, strikeAt: null, fallbackAt: CHASER_OPENING_CLOSE_T, transition: null };
  }

  // THE-1412 (levels.md "Bees"): catch: false (levels 1-9) means the whole level is grace, no matter `t` --
  // a hit there is always a stumble, never a strike. catch: true (levels 10-12) uses the normal 20 s rule.
  get grace() { return (this.level && !this.level.catch) ? true : this.t < GRACE_TIME; }

  // Rise -> float at y ~= 4 m -> gentle descent -> 1 s landing protection, derived from power.t (one
  // clock, like every power-up). null when no flight is active. "Aloft" (the caller's own rule) is
  // rising/floating/descending; landing is back on the ground but still immune for the spec's 1 s.
  _balloonFlight() {
    if (this.power.kind !== "balloon" || this.power.t <= 0) return null;
    // A direct `sim.power = {...}` assignment (the __capyDebug.givePower hook) skips _checkPickups and
    // never sets _balloonPickupT -- treat the first frame noticed as "just picked up", not NaN elapsed.
    if (this._balloonPickupT === null) this._balloonPickupT = this.t;
    const elapsed = this.t - this._balloonPickupT;
    if (elapsed < BALLOON_RISE_T) return { phase: "rising", y: BALLOON_HEIGHT * (elapsed / BALLOON_RISE_T) };
    if (elapsed < BALLOON_RISE_T + BALLOON_FLOAT_T) return { phase: "floating", y: BALLOON_HEIGHT };
    if (elapsed < BALLOON_RISE_T + BALLOON_FLOAT_T + BALLOON_DESCEND_T) {
      const d = (elapsed - BALLOON_RISE_T - BALLOON_FLOAT_T) / BALLOON_DESCEND_T;
      return { phase: "descending", y: BALLOON_HEIGHT * (1 - d) };
    }
    return { phase: "landing", y: 0 };
  }
  _balloonAloft() { const f = this._balloonFlight(); return !!f && f.phase !== "landing"; }

  _log(type, data) {
    this.log.push({ t: this.t, type, ...data });
    if (this.log.length > 512) this.log.shift();
  }

  press(action) {
    if (this.crashed) return;
    if (action === "left") this._pressDirection(-1);
    else if (action === "right") this._pressDirection(1);
    else if (action === "jump") this._pressJump();
    else if (action === "duck") this._pressDuck();
  }

  _activeJunction() {
    for (const j of this.patterns.junctions) {
      if (j.resolved) continue;
      const tToCorner = (j.s - this.s) / this.v;
      if (inTurnWindow(tToCorner)) return j;
    }
    return null;
  }

  _pressDirection(dir) {
    const j = this._activeJunction();
    if (j) {
      const jDir = j.dir === "L" ? -1 : 1;
      if (dir === jDir) {
        j.resolved = "taken";
        this._log("turn", { id: j.id, dir: j.dir });
        return; // lane kept through the corner, no lane step
      }
      // opposite direction inside the window: a normal lane step (spec §2, confirmed)
    }
    this._laneStep(dir);
  }

  _laneStep(dir) {
    if (this.stepLane !== null) { this.pendingDir = dir; return; } // buffered, 1 deep, latest wins
    const target = this.lane + dir;
    if (target < -1 || target > 1) { this.wobbleT = 0.15; this._log("wobble", { dir }); return; }
    // A12.2/A12.5 flank (THE-1301, L3): a step toward a filler-closed lane is a stumble that bounces back
    // to the origin lane -- no step is ever started here, so "bounces back" is just never stepping. Before
    // L3 this was A11/A12.2's free edge bump; narrowing.test.mjs's pre-L3 case is updated for this slice.
    // Fillers are skipped while aloft too (lane changes are still allowed, spec Part 1).
    const filler = !this._balloonAloft() && this.patterns.closures.find((f) => f.lane === target && this.s >= f.sStart && this.s <= f.sEnd);
    if (filler) {
      // during the 0.6 s i-frames no filler contact counts (A12.5): the tap just bounces off, no 2nd
      // strike -- THE-1391: the shield's own post-pop i-frames (shieldIFrameT) are the same kind of window
      if (this.stumbleT > 0 || this.shieldIFrameT > 0) { this.wobbleT = 0.15; this._log("wobble", { dir }); return; }
      this._stumble("flank", { dir, lane: target, filler: filler.kind }); return;
    }
    this.stepLane = target; this.stepT = 0;
    this._log("lane", { from: this.lane, to: target });
  }

  _springActive() { return this.power.kind === "spring" && this.power.t > 0; }
  // Are arc coins at their spring-scaled height right now? Mid-air, follow the jump in progress (jumpSpring,
  // fixed at take-off), not the power's current state (THE-1377 review: expiry or pickup mid-flight).
  // One answer for _checkCoins and the render (snapshot `arcSpring`).
  _arcSpring() { return this.airborne ? this.jumpSpring : this._springActive(); }

  _pressJump() {
    if (this._balloonAloft()) return; // THE-1394: "jump/duck input is ignored aloft"
    if (this.ducking) { this.ducking = false; this.duckT = 0; this._startJump(); return; } // cancels the slide
    if (this.airborne) {
      if (this.jumpT !== null && jumpAirFor(this.jumpSpring) - this.jumpT <= 0.10) this.pendingJump = true;
      return; // no double jump otherwise
    }
    this._startJump();
  }
  // THE-1398: springBoing replaces jump on take-off while Spring Paws is active (README "3. Spring Paws").
  // jumpSpring is captured once, here, not re-read every frame -- see its own field comment.
  _startJump() {
    this.airborne = true; this.jumpT = 0; this.dropping = false;
    this.jumpSpring = this._springActive();
    this._log("jump", { spring: this.jumpSpring });
  }

  _pressDuck() {
    if (this._balloonAloft()) return; // THE-1394: "jump/duck input is ignored aloft"
    if (this.airborne) { this.dropping = true; this._log("drop", {}); return; }
    this.ducking = true; this.duckT = 0; this._log("duck", {}); // repress mid-slide restarts the 0.6 s
  }
  _startSlide() { this.ducking = true; this.duckT = 0; }

  step(dt) {
    if (this.crashed) return;
    this.t += dt;
    const baseV = this.speedOverride ?? speedAt(this.levelT0 + this.t);
    // THE-1412: "the hero runs on for 1.2 s while the speed eases to 60%" (levels/README.md "the moment").
    this.v = this.levelFinished ? baseV * (1 - 0.4 * Math.min(1, (this.t - this.levelFinishT) / LEVEL_FINISH_COAST_T)) : baseV;
    this.s += this.v * dt;
    this.patterns.ensureAhead(this.t, this.s, this.v);
    if (this.level && !this.levelFinished && this.s >= this.patterns.finishS) {
      this.levelFinished = true; this.levelFinishT = this.t;
      this._log("levelFinish", {});
      // the bees drop back to "far", the same eased transition the opening's own fallback uses
      this.chaser.strikeActive = false; this.chaser.fallbackAt = null;
      this.chaser.transition = { to: "far", startT: this.t, dur: CHASER_CLOSE_TO_FAR_T, fromDist: this.chaser.dist };
      this.chaser.mode = "far";
    }

    if (this.stepLane !== null) {
      this.stepT += dt / LANE_STEP_TIME;
      if (this.stepT >= 1) {
        this.lane = this.stepLane; this.stepLane = null; this.stepT = 0;
        if (this.pendingDir !== null) { const d = this.pendingDir; this.pendingDir = null; this._laneStep(d); }
      }
    }
    if (this.wobbleT > 0) this.wobbleT = Math.max(0, this.wobbleT - dt);

    if (this.airborne) {
      this.jumpT += dt * (this.dropping ? FAST_DROP_MULT : 1);
      const p = Math.min(this.jumpT / jumpAirFor(this.jumpSpring), 1);
      this.y = jumpHeight(p, jumpPeakFor(this.jumpSpring));
      if (p >= 1) {
        this.airborne = false; this.y = 0; this.jumpT = null; this.jumpSpring = false;
        const wasDropping = this.dropping; this.dropping = false;
        this._log("land", {});
        if (this.pendingJump) { this.pendingJump = false; this._startJump(); }
        else if (wasDropping) { this._startSlide(); }
      }
    } else {
      this.y = 0;
    }

    // The flight owns `y` for its whole window, overriding the jump block above (jump is already ignored
    // aloft); the float-to-descend edge logs once for the render/audio cue (lift-off piggybacks "pickup").
    const balloonFlight = this._balloonFlight();
    if (balloonFlight) this.y = balloonFlight.y;
    const balloonPhase = balloonFlight ? balloonFlight.phase : null;
    if (balloonPhase === "descending" && this._balloonPrevPhase !== "descending") this._log("balloonDescend", {});
    this._balloonPrevPhase = balloonPhase;

    if (this.ducking) {
      this.duckT += dt;
      if (this.duckT >= DUCK_TIME) { this.ducking = false; this.duckT = 0; }
    }

    // Nothing hits the hero while aloft or during landing protection (the generator guarantees no
    // junction ever falls in the window either); any leftover i-frame clock just decays cosmetically.
    if (balloonFlight) {
      if (this.stumbleT > 0) this.stumbleT = Math.max(0, this.stumbleT - dt);
      if (this.shieldIFrameT > 0) this.shieldIFrameT = Math.max(0, this.shieldIFrameT - dt);
    } else if (this.stumbleT > 0) {
      this.stumbleT = Math.max(0, this.stumbleT - dt);
    } else if (this.shieldIFrameT > 0) {
      // THE-1391: the shield's own post-pop i-frames gate hazard/closure contact exactly like a stumble's
      // own stumbleT does above -- no 2nd contact counts while either window is open.
      this.shieldIFrameT = Math.max(0, this.shieldIFrameT - dt);
    } else if (!this.levelFinished) {
      this._checkHazards();
      if (!(this.stumbleT > 0 || this.shieldIFrameT > 0 || this.crashed)) this._checkClosures(); // a hazard stumble (or an absorb) this frame starts its own i-frames
    }
    // A12.5: "junction checks keep running" through the 0.6 s i-frames (unlike hazard/filler contact) --
    // rows are already banned near a corner (A12.8), so this rarely differs in practice, but it's still the
    // stated rule, not an incidental side effect of the i-frame gate above.
    // THE-1412: "from then nothing can hit" -- same i-frame-style exclusion, once the level's finish line
    // has passed (the gag; see LEVEL_FINISH_COAST_T above).
    if (!this.levelFinished) this._checkJunctions();
    this._updateChaser();
    if (this.chainT > 0) { this.chainT = Math.max(0, this.chainT - dt); if (this.chainT === 0) this.coinMultiplier = 1; }
    if (this.power.t > 0) {
      const poppingKind = this.power.kind;
      this.power.t = Math.max(0, this.power.t - dt);
      // THE-1391: a plain timeout also pops the shield (render/sound), just with no i-frames -- nothing
      // was absorbed, so there's nothing to protect against.
      if (this.power.t === 0) { this.power.kind = null; if (poppingKind === "shield") this._log("shieldPop", { reason: "expire" }); }
    }
    this._checkPickups();
    this._checkCoins();
    if (this.power.kind === "honey" && this.power.t > 0) this._applyHoney();
    this._updatePose();
  }

  _checkPickups() {
    // CTO call: nothing replaces the balloon mid-flight, including its own 1 s landing protection.
    if (this.power.kind === "balloon" && this.power.t > 0) return;
    for (const p of this.patterns.pickups) {
      if (p.taken) continue;
      if (p.lane === this.lane && Math.abs(p.s - this.s) <= 0.6) {
        p.taken = true;
        if (p.kind === "mystery") { this._openMystery(p); continue; }
        this._log("pickup", { id: p.id, kind: p.kind });
        this._grantPower(p.kind, p);
      }
    }
  }

  _grantPower(kind, p) { // shared by a direct pickup and a Mystery Box prize alike
    this.power = { kind, t: POWER_TIME[kind] };
    if (kind === "balloon") { this._balloonPickupT = this.t; this._spawnBalloonSkyCoins(p); }
  }

  _openMystery(p) { // the prize was rolled at placement (patterns.js), never here
    this._log("pickup", { id: p.id, kind: "mystery", prize: p.prize });
    if (p.prize.coins !== undefined) this.coins += p.prize.coins;
    else { this._log("pickup", { id: p.id, kind: p.prize.kind }); this._grantPower(p.prize.kind, p); }
  }

  // README "sky coins": a flat line in the pickup's own lane at flight height, spanning the aloft legs
  // (not landing). `c.y` uses the jump-arc coin convention (COIN_HOVER + height), so _checkCoins picks these up unchanged.
  _spawnBalloonSkyCoins(p) {
    const aloftT = POWER_TIME.balloon - BALLOON_LANDING_T;
    const n = Math.max(1, Math.floor((this.v * aloftT - BALLOON_SKY_COIN_LEAD) / BALLOON_SKY_COIN_SPACING) + 1);
    const y = COIN_HOVER + BALLOON_HEIGHT;
    // "the ground lane under them stays empty" -- only once the balloon is actually taken (THE-1377 review:
    // doing it at generation emptied that lane for players who skipped the balloon, guide coins included)
    // (spliced in place: patterns.js's generator keeps pushing into this same array)
    const coins = this.patterns.coins, endS = p.s + this.v * aloftT;
    for (let i = coins.length - 1; i >= 0; i--) {
      const c = coins[i];
      if (c.y === undefined && c.lane === p.lane && c.s >= p.s && c.s <= endS) coins.splice(i, 1);
    }
    for (let i = 0; i < n; i++) {
      this.patterns.coins.push({ id: `bsc${this._balloonCoinSeq++}`, s: p.s + BALLOON_SKY_COIN_LEAD + i * BALLOON_SKY_COIN_SPACING, lane: p.lane, y, arc: true, taken: false, passed: false });
    }
  }

  // spec Part 1 "Honey Jar": "for 8 s every coin in all 3 lanes within 15 m ahead flies to the capy" -- the
  // sim auto-collects any coin that comes within range while honey is active; the "flies to the capy"
  // motion itself is a render-layer-only animation (render never writes sim state), driven off this collection.
  _applyHoney() {
    for (const c of this.patterns.coins) {
      if (c.taken || c.passed) continue;
      const ahead = c.s - this.s;
      if (ahead >= 0 && ahead <= HONEY_RADIUS) { c.taken = true; this.coins += this.coinMultiplier; this._log("coin", { id: c.id, flyToCapy: true }); }
    }
  }

  _checkHazards() {
    const x = capyX(this.lane, this.stepLane, this.stepT);
    for (const h of this.patterns.hazards) {
      if (h.hit || h.cleared) continue;
      const half = CAPY_LEN / 2 + HAZARD_LEN[h.kind] / 2;
      if (this.s - h.s > half) {
        h.cleared = true;
        // THE-1408: "jump over/duck under" -- only a hazard in the hero's own lane, not one passing by.
        if (h.lane === this.lane) this._log("clear", { hazard: h.kind, how: this.airborne ? "jump" : "duck" });
        this._maybeNearMiss(h);
        continue;
      }
      if (Math.abs(h.s - this.s) >= half) continue;
      const offset = lateralOffset(x, h.lane);
      if (offset > SIDE_HIT_MAX_OFFSET) {
        // out of lateral reach entirely -- track the lateral clearance for a block-hazard near miss (spec
        // §2's "lateral gap to a hazard in the adjacent lane"), same as the vertical track below
        if (h.kind === "block") this._trackClearance(h, clearanceOf(this, h.kind, this.lane - h.lane));
        continue;
      }
      if (!bandsOverlap(capyBand(this), HAZARD_BAND[h.kind])) {
        // in lateral reach, not overlapping vertically (jump/duck cleared it) -- track the vertical clearance
        this._trackClearance(h, clearanceOf(this, h.kind));
        continue;
      }
      h.hit = true;
      if (offset <= HEAD_ON_MAX_OFFSET) this._onHazardHit(h);
      else this._onSideHit(h.lane, "obstacle", h.kind); // A12.5 side hit: 0.45-0.90 m offset
      // the i-frames start now, not next frame: a 2nd object touched in this same frame doesn't count
      // (THE-1391: an absorbed hit starts shieldIFrameT instead of stumbleT -- same early-return rule)
      if (this.stumbleT > 0 || this.shieldIFrameT > 0 || this.crashed) return;
    }
  }

  _trackClearance(h, c) {
    if (h.minClearance === undefined || c < h.minClearance) h.minClearance = c;
  }

  // spec §2 near miss: "clearance < 0.3 m and no hit, or a jump that leaves in the last 0.15 s before a
  // low hazard" -- 'close!' pop, whoosh, 40 ms hit stop, +3 coins; 3 within 5 s -> 2x coins for 5 s.
  _maybeNearMiss(h) {
    if (h.hit) return;
    const lateJump = h.kind === "low" && this.airborne && this.jumpT !== null && jumpAirFor(this.jumpSpring) - this.jumpT <= 0.15;
    const closeClearance = h.minClearance !== undefined && h.minClearance >= 0 && h.minClearance < 0.3;
    if (!lateJump && !closeClearance) return;
    this.coins += 3;
    this._log("nearMiss", { id: h.id, hazard: h.kind });
    this.nearMissWindow.push(this.t);
    this.nearMissWindow = this.nearMissWindow.filter((nt) => this.t - nt <= 5);
    if (this.nearMissWindow.length >= 3) {
      this.coinMultiplier = 2;
      this.chainT = 5;
      this.nearMissWindow = [];
      this._log("chain", {});
    }
  }

  _onHazardHit(h) {
    if (this.grace) this._stumble("obstacle", { hazard: h.kind });
    else this._crash("obstacle", h.kind);
  }

  // A12.5 side hit (any non-empty row cell, or a filler's front corner): a stumble that ends in the lane
  // away from the object it clipped, plus (post-grace) a chaser strike. Shared by _checkHazards (ordinary
  // row cells) and _checkClosures (a filler's front face hit at an angle, mid-step).
  _onSideHit(hazardLane, cause, kind) {
    this._stumble(cause, { hazard: kind });
    if (!this.crashed) this._resolveStumbleLane(hazardLane);
  }

  // A12.5: "it always finishes in the lane away from the object it clipped. If the object is in the target
  // lane, it bounces back to the origin lane. If the object is in the origin lane (a late dodge), the step
  // completes." Resolved immediately rather than left to the step's own stepT timer, since letting a
  // bounce-back finish on that timer would walk it straight into the lane it's supposed to avoid.
  _resolveStumbleLane(hazardLane) {
    if (this.stepLane === null) return; // a side hit's offset only lands in-band while actually stepping
    if (hazardLane === this.stepLane) { this.stepLane = null; this.stepT = 0; this.pendingDir = null; return; } // bounce back
    this.lane = this.stepLane; this.stepLane = null; this.stepT = 0; // late dodge: the step completes now
    this.pendingDir = null; // a stumble interrupts input: a buffered step is dropped, not replayed into the i-frames
  }

  // A11.2/A12.2: reaching a closed lane's front face head-on is a crash; A12.5 adds the front-corner split
  // (a mid-step arrival, offset 0.45-0.90 m, is a stumble instead -- L3 only; before this slice ANY
  // occupancy of the closing lane crashed, which is why this used to be a flat occupied-lane check).
  // THE-1414 (level 4 bug: narrowings are this slice's first grace-level content to exercise this path) --
  // grace-gated the same as _onHazardHit's ordinary row hit, so a catch:false level's narrowing head-on
  // stumbles like everything else there instead of ending the run (levels.md "Bees": "those levels can't
  // be lost, only a star can").
  _checkClosures() {
    const x = capyX(this.lane, this.stepLane, this.stepT);
    for (const c of this.patterns.closures) {
      if (c.hit || c.cleared) continue;
      if (this.s < c.sStart) continue;
      const offset = lateralOffset(x, c.lane);
      if (offset > SIDE_HIT_MAX_OFFSET) { c.cleared = true; continue; }
      c.hit = true;
      if (offset <= HEAD_ON_MAX_OFFSET) { if (this.grace) this._stumble("closure", { hazard: c.kind }); else this._crash("closure", c.kind); }
      else this._onSideHit(c.lane, "closure", c.kind);
      if (this.stumbleT > 0 || this.shieldIFrameT > 0 || this.crashed) return; // same i-frame rule as _checkHazards
    }
  }

  _checkJunctions() {
    for (const j of this.patterns.junctions) {
      if (j.resolved) continue;
      const tToCorner = (j.s - this.s) / this.v;
      if (tToCorner < TURN_AFTER) {
        j.resolved = "missed";
        if (this.grace) this._stumble("corner", { dir: j.dir });
        else this._crash("corner", j.dir);
      }
    }
  }

  _checkCoins() {
    const aloft = this._balloonAloft(); // THE-1377 review: no ground coins from 4 m up, in any lane
    const spring = this._arcSpring(); // THE-1398: arc coins ahead scale with the bigger spring jump
    for (const c of this.patterns.coins) {
      if (c.taken || c.passed) continue;
      // P2: an arc coin (c.y set) is only picked up at its own height, so the arc rewards a well-timed jump
      const atHeight = c.y === undefined ? !aloft : Math.abs(arcHeightNow(c, spring) - (COIN_HOVER + this.y)) <= ARC_PICKUP_TOL;
      if (c.lane === this.lane && Math.abs(c.s - this.s) <= 0.6 && atHeight) { c.taken = true; this.coins += this.coinMultiplier; this._log("coin", { id: c.id }); }
      else if (this.s - c.s > 2) c.passed = true;
    }
  }

  _crash(cause, detail) {
    if (this.crashed) return;
    // THE-1391: the shield absorbs any crash-level hazard/closure hit (never a missed corner -- CTO call).
    if (cause !== "corner" && this._absorbShield()) return;
    this.crashed = true; this.crashCause = cause; this.crashDetail = detail;
    this.pose = "bonk"; // forest-only in S1; lagoon/desert gags arrive with S4/S5
    this._log("hit", { cause, detail });
  }

  // A12.4/A12.5: the one entry point every stumble (obstacle, flank, corner-during-grace) goes through.
  // Grace never arms a strike (this.grace gates it below, same as it always gated the crash-vs-stumble
  // split); outside grace, a stumble either arms the chaser's first strike or -- if one's already active
  // inside its 5.0 s window -- ends the run as "caught" instead of stumbling at all.
  _stumble(cause, extra = {}) {
    if (this.crashed) return; // a simultaneous 2nd contact in the same frame that already crashed/caught
    // THE-1391: the shield absorbs any stumble-level hazard/flank/closure hit, same exclusion as _crash --
    // checked before the strike window (THE-1377 review), so a hit that would have been the catch is
    // absorbed too ("no bees closing in").
    if (cause !== "corner" && this._absorbShield()) return;
    if (!this.grace && this._withinStrikeWindow()) { this._caught(); return; }
    this.stumbleT = STUMBLE_TIME;
    this.hits++; // THE-1412 (levels.md "Stars"): any stumble is a hit; a shield absorb returned above already
    this._log("stumble", { cause, ...extra });
    if (!this.grace) this._armStrike();
  }

  // THE-1391 spec Part 1 "Picnic Shield": "the next hit is absorbed: no stumble, no bees closing in, 0.6 s
  // of i-frames." Consumes the shield and starts its own i-frame window instead of a normal stumble/crash;
  // callers (_stumble/_crash) exclude "corner" themselves (CTO call on THE-1391). _stumble calls this
  // before its strike-window check, so the hit that would have been a catch is absorbed (THE-1377 review).
  _absorbShield() {
    if (this.power.kind !== "shield" || this.power.t <= 0) return false;
    this.power = { kind: null, t: 0 };
    this.shieldIFrameT = SHIELD_IFRAME_TIME;
    this._log("shieldPop", { reason: "hit" });
    return true;
  }

  _withinStrikeWindow() {
    const c = this.chaser;
    return c.strikeActive && this.t - c.strikeAt <= STRIKE_WINDOW_T;
  }

  _armStrike() {
    const c = this.chaser;
    c.strikeActive = true; c.strikeAt = this.t; c.fallbackAt = this.t + STRIKE_WINDOW_T;
    if (c.mode !== "close") { c.transition = { to: "close", startT: this.t, dur: CHASER_FAR_TO_CLOSE_T, fromDist: c.dist }; c.mode = "close"; }
  }

  _caught() {
    if (this.crashed) return;
    this.crashed = true; this.crashCause = "caught"; this.crashDetail = null;
    this.pose = "bonk";
    const c = this.chaser; c.mode = "caught"; c.dist = 0; c.strikeActive = false; c.transition = null;
    this._log("hit", { cause: "caught" });
  }

  // A12.4: "5.0 s after a stumble with no further stumble, the strike clears and the geese fall back ...
  // close -> far in 1.5 s." The strike itself (the catch-window flag) clears the instant fallbackAt passes,
  // independent of how long the eased dist transition then takes to actually reach CHASER_FAR_DIST -- a
  // stumble arriving during that 1.5 s ease is a fresh first strike, per A12.4's own note, which falls
  // straight out of strikeActive already being false by the time that stumble's check runs.
  _updateChaser() {
    const c = this.chaser;
    if (c.mode === "caught") return;
    // THE-1408: the strike's own time-out, no 2nd stumble (a catch goes through _caught() instead).
    if (c.strikeActive && this.t - c.strikeAt >= STRIKE_WINDOW_T) { c.strikeActive = false; this._log("escape", {}); }
    if (c.mode === "close" && c.fallbackAt !== null && this.t >= c.fallbackAt && !c.transition) {
      c.mode = "far";
      c.transition = { to: "far", startT: this.t, dur: CHASER_CLOSE_TO_FAR_T, fromDist: c.dist };
      c.fallbackAt = null;
    }
    if (c.transition) {
      const { to, startT, dur, fromDist } = c.transition;
      // A tiny epsilon on the completion check, not just the clamp: a caller landing exactly on `dur`
      // (a test driving sim.t directly, or float error after many small accumulated dt's) must still
      // finish the transition and clear it -- a p of 0.999999999998 would otherwise linger forever and
      // block the next transition (e.g. the close->far fall-back) from ever starting.
      const elapsed = this.t - startT;
      const p = elapsed >= dur - 1e-9 ? 1 : elapsed / dur;
      const target = to === "far" ? CHASER_FAR_DIST : CHASER_CLOSE_DIST;
      const eased = 1 - (1 - p) * (1 - p); // A12.4: "ease-out" (the deflated fall-back reads fine eased the same way)
      c.dist = fromDist + (target - fromDist) * eased;
      if (p >= 1) { c.dist = target; c.transition = null; }
    }
  }

  _updatePose() {
    if (this.crashed) { this.pose = "bonk"; return; }
    if (this.stumbleT > 0) { this.pose = "stumble"; return; }
    if (this.airborne) { this.pose = "jump"; return; }
    if (this.ducking) { this.pose = "duck"; return; }
    this.pose = "gallop";
  }

  state() {
    const near = (x) => Math.abs(x - this.s) < 150;
    return {
      seed: this.seed, t: this.t, s: this.s, v: this.v,
      lane: this.lane, stepLane: this.stepLane, stepT: this.stepT,
      y: this.y, airborne: this.airborne, ducking: this.ducking,
      pose: this.pose, grace: this.grace,
      coins: this.coins, coinMultiplier: this.coinMultiplier,
      score: computeScore(this.s, this.scoreMult, this.coins), scoreMult: this.scoreMult,
      crashed: this.crashed, crashCause: this.crashCause, crashDetail: this.crashDetail,
      // A12.4 testability hook: mode/dist drive the render; strikeT is the pip ring's own drain (0 when
      // no strike is active), not "time since armed" -- a render-facing countdown, not a sim internal.
      chaser: { mode: this.chaser.mode, dist: this.chaser.dist, strikeT: this.chaser.strikeActive ? Math.max(0, STRIKE_WINDOW_T - (this.t - this.chaser.strikeAt)) : 0 },
      biome: biomeAt(this.s),
      hazards: this.patterns.hazards.filter((h) => near(h.s)),
      closures: this.patterns.closures.filter((c) => near(c.sStart) || near(c.sEnd)),
      coinsList: this.patterns.coins.filter((c) => near(c.s)),
      pickupsList: this.patterns.pickups.filter((p) => near(p.s)), power: { ...this.power }, arcSpring: this._arcSpring(),
      // Unfiltered: the renderer needs every junction ever placed to reconstruct the trail's heading
      // from s=0 (each turn permanently changes it). The list only ever grows, and stays small (one
      // roughly every 4-10 s of play), so this is cheap.
      junctions: this.patterns.junctions,
      log: this.log,
      // THE-1412: the level HUD's progress-to-finish bar + coin-target chip read this; null in Endless.
      level: this.level ? { finishS: this.patterns.finishS, coinTarget: this.level.coinTarget, finished: this.levelFinished } : null,
      hits: this.hits,
    };
  }
}

export function createSim(seed, scoreMult = 1, level = null) { return new Sim(seed, scoreMult, level); }
