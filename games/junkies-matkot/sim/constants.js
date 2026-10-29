// Every numbered rule from the approved spec (THE-1098 doc "spec" rev 46f0940b, A1-A4 applied) in one
// frozen object, so sim.js and later slices read one source instead of scattered literals. S5 may
// retune the CPU block to hit the §3 targets; copy the final numbers into DESIGN.md and QA's doc then.
export const C = Object.freeze({
  COURT_W: 1600,
  COURT_H: 900,

  BALL_R: 14,

  CAPSULE_LEN: 220, // along y
  CAPSULE_THICK: 72, // along x
  PADDLE_CENTER_X: [90, 1510], // [left, right]
  FRONT_FACE_X: [126, 1474], // [left, right]
  PADDLE_Y_MIN: 110,
  PADDLE_Y_MAX: 790,
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
  SPIN_FACTOR: 0.2, // vy += SPIN_FACTOR * paddleVy, then renormalise + reclamp angle

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
  // aim-error multiplier and max paddle speed. Tuned (tools/junkies-matkot-gate.mjs's
  // runLevelVsDecentHuman, 200 seeds/level) against a scripted "decent human" (250ms reaction, keyboard
  // paddle speed, human aim noise) to hit: easy 5-20%, medium 30-50%, hard 55-75% CPU win rate --
  // measured 8.0% / 39.5% / 63.0%.
  CPU_LEVELS: Object.freeze({
    easy: { reactionLagAddMs: 300, aimErrorMult: 3.5, maxPaddleSpeedMult: 0.35 },
    medium: { reactionLagAddMs: 170, aimErrorMult: 2.0, maxPaddleSpeedMult: 0.5 },
    hard: { reactionLagAddMs: 70, aimErrorMult: 1.5, maxPaddleSpeedMult: 0.75 },
  }),
});
