// Tray Disaster: pure simulation (no DOM, no canvas). Classic script (works from file://) and
// CommonJS for node tests. Fixed-timestep, seeded RNG — see DESIGN.md for the reproducibility model
// and the design brief's dish/hazard/scoring tables this file implements.
var TrayLogic = (function () {
  const STEP = 1 / 60; // fixed simulation timestep (seconds)
  const TOPPLE = 1; // |sway| past this on any dish ends the run
  const STIFFNESS = 10; // spring constant shared by every dish
  const MAX_INPUT = 1; // inputTarget is clamped to [-MAX_INPUT, MAX_INPUT]
  const GAIN_SCALE = 0.62; // scales the brief's "sway gain" column into this spring model's units

  // Destabilising (inverted-pendulum) term, THE-42: a level, untouched tray is no longer a stable
  // rest state. It only engages once a dish has already been knocked past INSTAB_LEAN_LO (so a
  // calm, well-corrected stack under active play essentially never feels it — the tray's own
  // spring alone keeps a small lean in check), then ramps to full strength by INSTAB_LEAN_HI (past
  // the "sweat" threshold), at which point it reliably grows an unanswered lean into a topple
  // within about 1.5s. Gated this way instead of "always on" because an always-on linear term
  // strong enough to crash a hands-off run quickly also fights a reactive player's own correction
  // (the term feeds off the same trayAngle the player is using to recover), making the stack
  // uncontrollable long before it becomes properly perilous — see DESIGN.md's tuning notes.
  const INSTAB = 6; // destabilising accel per radian of sway, once fully engaged
  const INSTAB_IDX_SCALE = 0.35; // each dish higher in the stack is this much twitchier once engaged
  const INSTAB_LEAN_LO = 0.2; // |sway| below this: no destabilising term at all
  const INSTAB_LEAN_HI = 0.5; // |sway| at/above this: destabilising term at full INSTAB strength

  function hashString(s) {
    let h = 1779033703 ^ s.length;
    for (let i = 0; i < s.length; i++) {
      h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^ (h >>> 16)) >>> 0;
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // From the design brief's "five dishes" table: id (matches the style tile's drawDish kinds),
  // price ($, also the bill line item), arrival time (s), sway gain and damping ratio (the
  // developer owns the final numbers; these are the brief's starting feel, scaled by GAIN_SCALE).
  // `fates` are the bill's comic per-dish outcome lines, picked deterministically per run.
  const DISH_TYPES = [
    { id: 'soup', price: 18, at: 0, gain: 1.0, damping: 0.9, fates: ['1 soup (on table 3)', '1 soup (worn as a hat)'] },
    { id: 'spaghetti', price: 42, at: 5, gain: 1.3, damping: 0.75, fates: ['1 spaghetti, airborne', '1 spaghetti (on the lamp)'] },
    { id: 'jelly', price: 27, at: 15, gain: 1.6, damping: 0.55, fates: ['1 jelly (on the wall)', '1 jelly (still wobbling)'] },
    { id: 'lobster', price: 96, at: 25, gain: 1.8, damping: 0.6, asymmetric: true, fates: ['1 lobster (escaped)'] },
    { id: 'cake', price: 250, at: 40, gain: 2.2, damping: 0.7, fates: ['1 wedding cake (the wedding is off)'] },
  ];

  // Chef's closing quip, picked by whichever dish caused the crash.
  const CHEF_QUIPS = {
    soup: "Soup's on. The customer, mostly.",
    spaghetti: 'The lamp had it coming.',
    jelly: 'That jelly had a family.',
    lobster: 'The lobster sends its regards.',
    cake: 'We had one job, and it was cake.',
  };

  // Hazard ids match the style tile's drawHazard kinds. `door`/`grape`/`bucket` are one-shot
  // impulses (bucket lands a second, opposite kick 0.4s later); `puddle` (wet floor) halves every
  // dish's damping for a while; `sneeze` pushes with a steady gust. None of them carry a $ price —
  // per the brief, the bill only itemizes dishes, plates and distance walked.
  const HAZARD_TYPES = [
    { id: 'door' }, { id: 'grape' }, { id: 'bucket' }, { id: 'puddle' }, { id: 'sneeze' },
  ];

  const WALK_SPEED_MPS = 1.3; // base stroll speed; the difficulty table below ramps it over time
  const DOLLARS_PER_METRE = 4.7;
  const DOLLARS_PER_PLATE = 12;

  // From the brief's difficulty table: walk speed multiplier over time.
  function walkSpeedMultiplier(t) {
    if (t < 15) return 1;
    if (t < 25) return 1.1;
    if (t < 40) return 1.2;
    return 1.2 * Math.pow(1.05, Math.floor((t - 40) / 15) + 1);
  }

  function createRun(seed) {
    const rng = mulberry32(hashString(String(seed)));
    return {
      seed: String(seed),
      rng,
      t: 0,
      distanceM: 0,
      trayAngle: 0,
      inputTarget: 0,
      dishes: [],
      dishIndex: 0,
      hazards: [], // recent hazard events, kept briefly for the renderer's vignette
      hazardHits: 0,
      nextHazardAt: 8 + rng() * 3,
      pendingKicks: [], // [{ at, sign, scale }] — the bucket's delayed second beat
      slipperyUntil: 0, // puddle: damping halved until this sim time
      gustUntil: 0, gustSign: 1, // sneeze: steady push until this sim time
      nextLobsterSnapAt: null,
      damage: 0,
      billLines: null,
      billPlates: 0,
      billLobster: false,
      lobsterEscaped: false,
      over: false,
      crashDishId: null,
      log: [], // { t, target } — replay this against the same seed to reproduce a run
    };
  }

  // Record + apply an input target (drag/keyboard produce a value in [-1, 1]).
  function setInputTarget(run, target) {
    const clamped = clamp(target, -MAX_INPUT, MAX_INPUT);
    run.inputTarget = clamped;
    run.log.push({ t: run.t, target: clamped });
  }

  function addDish(run) {
    const type = DISH_TYPES[run.dishIndex];
    if (!type) return;
    const i = run.dishIndex;
    run.dishes.push({
      type,
      index: i,
      sway: 0,
      swayVel: 0,
      gain: type.gain * GAIN_SCALE,
      damping: type.damping,
      phase: run.rng() * Math.PI * 2, // lobster wriggle / ambient wobble phase
      fate: type.fates[Math.floor(run.rng() * type.fates.length)],
    });
    if (type.asymmetric) run.nextLobsterSnapAt = run.t + 2;
    run.dishIndex++;
  }

  // Brief section 8's difficulty ramp: hazards land roughly every 6s, then 5s, 4s, 3.5s, with a
  // 2.5s floor (was a flat 4.5-9s regardless of run time).
  function hazardBaseInterval(t) {
    if (t < 15) return 6;
    if (t < 25) return 5;
    if (t < 40) return 4;
    return 3.5;
  }

  function scheduleNextHazard(run) {
    const base = hazardBaseInterval(run.t);
    run.nextHazardAt = run.t + Math.max(2.5, base + (run.rng() - 0.5) * 2);
  }

  function kickAll(run, sign, scale) {
    run.dishes.forEach((d) => {
      d.swayVel += sign * scale * (0.55 + d.index * 0.18) * (0.7 + run.rng() * 0.6);
    });
  }

  // Spawn a hazard telegraphed at least 1s ahead (brief's Hazards table): it appears at run.t and
  // the impulse lands HAZARD_LEAD_TIME later, once it's reached the waiter.
  const HAZARD_LEAD_TIME = 1.2;

  function spawnHazard(run) {
    const type = HAZARD_TYPES[Math.floor(run.rng() * HAZARD_TYPES.length)];
    const sign = run.rng() < 0.5 ? -1 : 1;
    run.hazards.push({ type, sign, spawnAt: run.t, hitAt: run.t + HAZARD_LEAD_TIME, hit: false });
    scheduleNextHazard(run);
  }

  function applyHazardImpact(run, hz) {
    const { type, sign } = hz;
    if (type.id === 'door') {
      kickAll(run, sign, 1.8);
    } else if (type.id === 'grape') {
      kickAll(run, sign, 1.0);
    } else if (type.id === 'bucket') {
      kickAll(run, sign, 1.2);
      run.pendingKicks.push({ at: run.t + 0.4, sign: -sign, scale: 1.2 });
    } else if (type.id === 'puddle') {
      run.slipperyUntil = run.t + 1.5;
    } else if (type.id === 'sneeze') {
      run.gustUntil = run.t + 0.6;
      run.gustSign = sign;
    }
    run.hazardHits++;
    hz.hit = true;
  }

  // Advance the simulation by exactly one fixed step. Returns true while the run is still live.
  function step(run) {
    if (run.over) return false;
    run.t += STEP;
    run.distanceM += WALK_SPEED_MPS * walkSpeedMultiplier(run.t) * STEP;

    while (run.dishIndex < DISH_TYPES.length && run.t >= DISH_TYPES[run.dishIndex].at) addDish(run);

    if (run.dishIndex >= 2 && run.t >= run.nextHazardAt) spawnHazard(run);

    for (let i = run.hazards.length - 1; i >= 0; i--) {
      const hz = run.hazards[i];
      if (!hz.hit && run.t >= hz.hitAt) applyHazardImpact(run, hz);
    }

    for (let i = run.pendingKicks.length - 1; i >= 0; i--) {
      const k = run.pendingKicks[i];
      if (run.t >= k.at) { kickAll(run, k.sign, k.scale); run.pendingKicks.splice(i, 1); }
    }

    const lobster = run.dishes.find((d) => d.type.asymmetric);
    if (lobster && run.nextLobsterSnapAt !== null && run.t >= run.nextLobsterSnapAt) {
      run.dishes.forEach((d) => { if (d.index >= lobster.index) d.swayVel += 0.5 * (0.7 + run.rng() * 0.6); });
      run.nextLobsterSnapAt = run.t + 2;
    }

    // Tray angle eases toward the player's input — fast but not instant, for a physical feel.
    run.trayAngle += (run.inputTarget - run.trayAngle) * Math.min(1, 14 * STEP);

    const slippery = run.t < run.slipperyUntil;
    const gusting = run.t < run.gustUntil;
    for (const d of run.dishes) {
      let eq = run.trayAngle * d.gain + Math.sin(run.t * 1.7 + d.phase) * 0.04; // ambient wobble
      if (lobster && d.index >= lobster.index) eq += Math.sin(run.t * Math.PI + d.phase) * 0.22; // claw sway, ~2s cycle
      if (gusting && d === run.dishes[run.dishes.length - 1]) eq += run.gustSign * 0.35;
      const damping = slippery ? d.damping * 0.5 : d.damping;
      const leanRamp = clamp((Math.abs(d.sway) - INSTAB_LEAN_LO) / (INSTAB_LEAN_HI - INSTAB_LEAN_LO), 0, 1);
      const instab = INSTAB * (1 + INSTAB_IDX_SCALE * d.index) * d.sway * leanRamp;
      const accel = -STIFFNESS * (d.sway - eq) - damping * 2 * Math.sqrt(STIFFNESS) * d.swayVel + instab;
      d.swayVel += accel * STEP;
      d.sway += d.swayVel * STEP;
      if (!run.over && Math.abs(d.sway) > TOPPLE) {
        run.over = true;
        run.crashDishId = d.type.id;
        if (d.type.asymmetric) run.lobsterEscaped = true;
      }
    }

    if (run.over) finalizeBill(run);
    return !run.over;
  }

  // Score = the bill total: $/metre walked + the price of every dish still on the tray + $12/plate
  // (the lobster escaped rather than broke, so it isn't a "plate"). See DESIGN.md for the formula.
  function finalizeBill(run) {
    let plates = 0, lobster = false, dishTotal = 0;
    const lines = [];
    run.dishes.forEach((d) => {
      dishTotal += d.type.price;
      lines.push({ text: d.fate, price: d.type.price });
      if (d.type.asymmetric) lobster = true; else plates++;
    });
    const plateFee = plates * DOLLARS_PER_PLATE;
    if (plates > 0) lines.push({ text: plates + (plates === 1 ? ' plate' : ' plates'), price: plateFee });
    const walkFee = Math.round(run.distanceM * DOLLARS_PER_METRE);
    lines.push({ text: Math.round(run.distanceM) + ' m of aisle, walked', price: walkFee });
    run.damage = dishTotal + plateFee + walkFee;
    run.billLines = lines;
    run.billPlates = plates;
    run.billLobster = lobster;
    run.chefQuip = CHEF_QUIPS[run.crashDishId] || CHEF_QUIPS.soup;
  }

  // Highest |sway| among live dishes, 0..1+ — drives the waiter's danger state.
  function leanFraction(run) {
    let max = 0;
    for (const d of run.dishes) max = Math.max(max, Math.abs(d.sway));
    return Math.min(1, max / TOPPLE);
  }

  // Signed version of the above (-1..1), from whichever dish leans the most — drives the lean arc
  // needle and the googly eyes' roll direction.
  function signedLean(run) {
    let best = 0, mag = 0;
    for (const d of run.dishes) { if (Math.abs(d.sway) > mag) { mag = Math.abs(d.sway); best = d.sway; } }
    return clamp(best / TOPPLE, -1, 1);
  }

  function danger(run) {
    const f = leanFraction(run);
    if (f < 0.45) return 'calm';
    if (f < 0.75) return 'sweat';
    return 'panic';
  }

  // Re-run a full input log against a fresh run with the same seed. Used by QA to reproduce a
  // reported crash: createRun(seed), then replay(run, log) and compare run.t / run.crashDishId.
  // Note: window.__tray.forceCrash() (a debug shortcut) mutates state directly and is NOT captured
  // in the log, so a forced crash cannot be reproduced this way — see DESIGN.md.
  function replay(seed, log) {
    const run = createRun(seed);
    let li = 0;
    while (!run.over) {
      while (li < log.length && log[li].t <= run.t) { run.inputTarget = clamp(log[li].target, -MAX_INPUT, MAX_INPUT); li++; }
      if (!step(run)) break;
      if (run.t > 600) break; // safety bound for malformed logs
    }
    return run;
  }

  return {
    STEP, TOPPLE, DISH_TYPES, HAZARD_TYPES, WALK_SPEED_MPS, DOLLARS_PER_METRE, DOLLARS_PER_PLATE,
    hashString, mulberry32,
    createRun, setInputTarget, step, leanFraction, signedLean, danger, replay,
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = TrayLogic;
