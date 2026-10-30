// Every numbered rule from the approved spec (THE-1098 doc "spec" rev 46f0940b, A1-A4 applied) in one
// frozen object, so sim.js and later slices read one source instead of scattered literals. S5 may
// retune the CPU block to hit the §3 targets; copy the final numbers into DESIGN.md and QA's doc then.
export const C = Object.freeze({
  COURT_W: 1600,
  COURT_H: 900,

  BALL_R: 14,

  CAPSULE_LEN: 220, // along y
  CAPSULE_THICK: 72, // along x
  PADDLE_CENTER_X: [90, 1510], // [left, right]; the legacy (opts.zone omitted) fixed x, also each
  // zone's starting x below
  FRONT_FACE_X: [126, 1474], // [left, right]; legacy-path front face (PADDLE_CENTER_X +- half-thickness)
  PADDLE_Y_MIN: 110,
  PADDLE_Y_MAX: 790,

  // THE-1184 S1 (board note 1, opt-in via createMatch(seed, {zone:true})): each paddle's centre-x range,
  // [near the own goal line, forward toward the net]. Right mirrors left (1600 - x). The no-cross line
  // (can't camp at the net) isn't a separate constant: it falls straight out of this clamp -- the front
  // face at the zone's forward-most x is already 436u off the net (zone max 400 + CAPSULE_THICK/2 36),
  // mirrored 1164 on the right, and C.PADDLE_CENTER_X sits inside both ranges so the legacy fixed x
  // (opts.zone omitted) is always a valid in-zone value too.
  PADDLE_X_ZONE: [[60, 400], [1540, 1200]], // [left [back,fwd]], [right [back,fwd]]
  X_TOUCH_SPEED_CAP: 1800, // touch/finger x-axis rate cap (note 1); TOUCH_SPEED_CAP below stays the y cap
  BIG_HEAD_SCALE: 1.15, // capsule 253 x 83 u, tweened 220 ms (G6)
  BIG_HEAD_TWEEN_MS: 220,
  BIG_HEAD_TRAIL_ON: 3, // trailing by >= 3 turns big head on
  BIG_HEAD_TRAIL_OFF: 2, // first serve trailing by <= 2 turns it back off

  TOUCH_SPEED_CAP: 2600,
  KEYS_SPEED_CAP: 1300,
  KEYS_RAMP_MS: 80, // 0 -> full speed
  DRAG_GAIN_SHORT: 1.3, // viewport <= 500 CSS px tall
  DRAG_GAIN_NORMAL: 1.0,
  SHORT_VIEWPORT_H: 500,

  SERVE_SPEED: 560, // A5 (S1 feel check D1-1): 59% of the first-touch speed
  FIRST_TOUCH_SPEED: 950,
  RAMP_MULT: 1.07, // per hit after the first touch
  SPEED_CAP: 1900, // reached at hit 11 (A5)
  SERVE_ANGLE_MIN_DEG: 15,
  SERVE_ANGLE_MAX_DEG: 38,

  CONTACT_ANGLE_MAX_DEG: 55,
  CONTACT_OFFSET_U: 110, // half the capsule length; contact offset clamps to +-this
  SPIN_FACTOR: 0.2, // legacy (opts.impact omitted) path only: vy += SPIN_FACTOR * paddleVy

  // THE-1184 S2 (board note 2, opt-in via createMatch(seed, {impact:true}), sim/impact.js): outgoing
  // speed = clamp(rampBase + SWING_GAIN * u_n, SPEED_MIN, SPEED_MAX), where rampBase is today's ramp
  // (FIRST_TOUCH_SPEED, then x RAMP_MULT per hit, capped at SPEED_CAP) and u_n is the paddle's own
  // per-tick velocity projected onto the outgoing contact normal (+ = swinging into the ball toward the
  // opponent, - = retreating -- a drop shot). SPIN_FACTOR here (sideways/tangential paddle motion ->
  // angle) is independently tunable from the legacy SPIN_FACTOR above.
  IMPACT: Object.freeze({
    SWING_GAIN: 0.55,
    SPEED_MIN: 420,
    SPEED_MAX: 2300,
    SPIN_FACTOR: 0.3,
  }),

  SMASH_BALL_SPEED: 1250,
  SMASH_FLICK_PADDLE_SPEED: 1400,
  KMH_PER_US: 0.075,

  HEAT_HOT: 8,
  HEAT_FIRE: 12,

  POINT_PAUSE_S: 0.6,
  SERVE_COUNT_S: 0.8,

  WIN_SCORE: 7,
  MATCH_POINT_AT: 6, // first serve after a player first reaches this score is match point
  MATCH_POINT_SCALE: 0.4,
  MATCH_POINT_DURATION_S: 0.5,
  FINAL_HIT_SCALE: 0.3,
  FINAL_HIT_FREEZE_S: 0.2,

  REPLAY_MAX_SIM_S: 4.0,
  REPLAY_SLOWMO_LAST_S: 1.2,
  REPLAY_SLOWMO_SCALE: 0.4,

  STEP_HZ: 120,
  SUBSTEP_MAX_TRAVEL: 7, // sub-step the ball's motion when a step would move it farther than this

  // Solo CPU (G16, spec §3). Not consumed by sim.js until S5 (cpu.js); numbers kept here per the
  // design's module table so S5 retunes one object instead of hunting for literals.
  CPU: Object.freeze({
    REACTION_LAG_MS: { base: 220, leading: 300, trailing: 170 },
    RETARGET_MS: 100,
    AIM_ERROR_U_BASE: 25,
    AIM_ERROR_SPEED_FACTOR: 0.05,
    AIM_ERROR_MULT: { leading: 1.4, trailing: 0.75 },
    MAX_PADDLE_SPEED: { base: 1900, leading: 1600, trailing: 2200 },
    CONTACT_OFFSET_RATIO: { base: 0.6, afterRally: 0.9, afterRallyHit: 8 },
    DRIFT_Y: 450,
    DRIFT_SPEED: 400,
    RUBBER_BAND_LEAD: 3,
    RUBBER_BAND_TRAIL: 3,
  }),

  // THE-1142 S2 (board note 2): the player-selectable difficulty level. Unrelated to the CPU block
  // above, which stays exactly as it was (every existing gate/test that calls Cpu.create/knobsFor
  // without a level argument keeps getting those unmodified numbers -- G16's solo gates in particular
  // were already tuned against them). Each level scales the CPU block's reaction lag (additive ms),
  // aim-error multiplier and max paddle speed. Originally tuned (tools/junkies-matkot-gate.mjs's
  // runLevelVsDecentHuman, 200 seeds/level) against a scripted "decent human" (250ms reaction, keyboard
  // paddle speed, human aim noise) to hit: easy 5-20%, medium 30-50%, hard 55-75% CPU win rate --
  // measured 8.0% / 39.5% / 63.0%.
  //
  // THE-1156 S1 (board note 1, "hard is still easy: a bank shot off the wall beats it every time"):
  // medium/hard now predict the wall-folded intercept (sim/cpu.js predictInterceptY) instead of just
  // chasing the lagged ball y, which removes most of reaction lag's old side effect of positional
  // inaccuracy -- a straight-line prediction is correct whether or not the sample is stale, as long as
  // the ball hasn't been hit again since. aimErrorMult had to grow a lot to reintroduce real miss
  // chances, which pushed the decent-human win rate up too.
  //
  // THE-1157 r1 code review: the first retune (medium 66%/hard 71% vs decent human) was too strong. CTO's
  // binding targets: medium <= 55% vs decent human, hard <= 85%; medium 40-50% vs bank shots, hard
  // clearly >= 58%. Medium's two targets trade off against the same aimErrorMult knob (see
  // junkies-matkot-gate.mjs's sweep notes) -- pushing its decent-human rate down below 55% also drags its
  // bank-shot rate down with it, below the original 40% ask. Per the review, the decent-human ceiling
  // wins; the shortfall is reported here rather than hidden. easy's aimErrorMult also had to move up (3.5
  // -> 4.0) so it stays noisier than the retuned medium (cpu.test.mjs's level-ordering gate). Re-measured,
  // 200 seeds/level:
  // vs decent human: easy 5.0%, medium 51.5%, hard 78.5% (targets: 5-20%, <=55%, <=85%).
  // vs the bank-shot player (straight/1-bounce/2-bounce aimed returns, tools/junkies-matkot-gate.mjs's
  // runLevelVsBankShotPlayer): easy 3.5%, medium 36.0%, hard 65.0% (targets: low, 40-50%, >=58%).
  // Medium's bank-shot number (36.0%) is below the 40-50% target -- the tradeoff above.
  // THE-1184 S4 (board note 0, top priority -- "hard must be much harder"): offence knobs, read only
  // once the match has the 2D zone + impact physics on (opts.zone/opts.impact) and this CPU has a
  // level. aimProb: chance per incoming shot it attempts an aimed return at all (vs. just blocking
  // toward the predicted intercept). bankProb: of an aimed shot, the chance it's a wall-bank (1 or 2
  // bounces) rather than straight. swingProb: the chance it also steps forward to swing for extra pace.
  // xSpeedMult scales how fast it moves in its zone (relative to this level's own maxPaddleSpeed).
  // Starting guesses; THE-1184 S5's adaptive-player gate retunes these to the win-rate targets.
  // offenceErrorMult (S4/S5): the aimError noise term is tuned for *defensive* positional tracking
  // (knobs.aimErrorMult above) -- applying that same magnitude to the solver's precisely-aimed offence
  // shots would make "near-perfect read, rare misplacement only" (hard) impossible even with a correct
  // solver, since a single large error term can blow a bank shot's angle wide open. offenceErrorMult
  // scales aimError down specifically for the offence adjustment, independent of defence.
  // zoneDefenceMult (S4/S5): scales the *defensive* aimError noise, but only in a zone+impact match
  // (sim/cpu.js gates it on match.zoneEnabled) -- the r1/r2-era non-zone continuity gates (THE-1142 S2,
  // THE-1156 S1) read the same reactionLagAddMs/aimErrorMult/maxPaddleSpeedMult numbers above and must
  // keep their own tuned bands, so a zone-only knob is how r3's "much harder" defence gets applied
  // without moving those existing gates.
  // THE-1181 (CTO, after QA THE-1186's real-input run went 6/10 on hard): the S5 adaptive player tracked
  // the lagged *current* ball y and never predicted the intercept, so it defended far worse than a real
  // player -- and hard/medium had been loosened (zoneDefenceMult 1.6/1.1) to hit the targets against that
  // weak defender. Against an adaptive player that predicts the wall-folded intercept (the gate's player
  // now does), those numbers gave hard 41% / medium 73% human wins. Retuned, 200 matches each:
  // easy 93%, medium 42.5% (0.8), hard 10.5% (1.0) -- hard sits at the low end of 10-25% on purpose,
  // since a real pointer out-moves the gate's player (QA's browser runs won more than the headless gate).
  CPU_LEVELS: Object.freeze({
    easy: { reactionLagAddMs: 300, aimErrorMult: 4.0, maxPaddleSpeedMult: 0.35, aimProb: 0.15, bankProb: 0.1, swingProb: 0.1, xSpeedMult: 0.5, offenceErrorMult: 1.0, zoneDefenceMult: 1.0 },
    medium: { reactionLagAddMs: 100, aimErrorMult: 3.75, maxPaddleSpeedMult: 0.5, aimProb: 0.42, bankProb: 0.3, swingProb: 0.32, xSpeedMult: 0.78, offenceErrorMult: 0.6, zoneDefenceMult: 0.8 },
    hard: { reactionLagAddMs: 70, aimErrorMult: 3.0, maxPaddleSpeedMult: 0.75, aimProb: 0.7, bankProb: 0.45, swingProb: 0.5, xSpeedMult: 1.1, offenceErrorMult: 0.4, zoneDefenceMult: 1.0 },
  }),
});
