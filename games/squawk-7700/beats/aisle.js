// The aisle beat (design "Aisle beat"): 3 snapping lanes, a seeded row layout from z = 18 m every
// 4-5.5 m up to z <= 115 m (18-25 rows), bags/masks = a bump, a trolley = a fail, every lane gets a
// trolley in z 18-50 m, 2-3 negative-g floats. Pure: no DOM, no three.js.
export const AISLE = {
  TRACK_LEN: 120,
  WALK_V: 4, SPRINT_V: 6,
  LANE_X: [-1, 0, 1],
  LANE_ON: 0.5, LANE_OFF: 0.25,
  SLIDE_WALK: 0.18, SLIDE_SPRINT: 0.3, SLIDE_FLOAT: 0.4,
  ROW_START_Z: 18, ROW_END_Z: 115, ROW_SPACING_MIN: 4, ROW_SPACING_MAX: 5.5,
  TROLLEY_ZONE: [18, 50],
  STUMBLE_V: 2, STUMBLE_S: 0.4,
  FLOAT_S: 2, FLOAT_MIN: 2, FLOAT_MAX: 3,
};

// A row less than this far behind the previous one must leave the current reference lane reachable
// within one slide (a 1-lane hop) -- a mandatory 2-hop (e.g. lane 0 -> lane 2) takes two slide-and-
// rearm cycles, which doesn't reliably fit a short gap at any reasonable reaction cadence.
const TWO_HOP_MIN_GAP = 6;

function openLanesOf(obstacles) { const used = new Set(obstacles.map((o) => o.lane)); return [0, 1, 2].filter((l) => !used.has(l)); }

// Seeded row layout: never blocks all 3 lanes; every lane gets >= 1 trolley in TROLLEY_ZONE; a close
// row never demands a mandatory 2-lane hop. Generation (the obstacle counts/kinds/spacing) and the
// reachability repair are two separate passes: trying to keep both invariants during one pass, with
// the trolley-zone guarantee able to retroactively edit any row, kept re-breaking the other.
function generateRows(rngSim) {
  const rows = [];
  const pickKind = () => { const r = rngSim(); return r < 0.5 ? "bag" : r < 0.75 ? "mask" : "trolley"; };
  const pickLanes = (n) => {
    const idx = [0, 1, 2];
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rngSim() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    return idx.slice(0, n);
  };

  let z = AISLE.ROW_START_Z;
  while (z <= AISLE.ROW_END_Z) {
    const n = rngSim() < 0.65 ? 1 : 2; // 60-70% one lane, else two; never three
    const obstacles = pickLanes(n).map((lane) => ({ lane, kind: pickKind() }));
    rows.push({ z, obstacles });
    z += AISLE.ROW_SPACING_MIN + rngSim() * (AISLE.ROW_SPACING_MAX - AISLE.ROW_SPACING_MIN);
  }

  // Repair pass: walk the row list tracking one reference lane (the lane a sensible player who always
  // moves the minimum necessary is in). If a close row isn't within one hop of it, force that row down
  // to a single blocked lane, picking one that keeps the reference lane itself open (so zero hops are
  // ever needed to survive it); then the reference lane advances to whichever open lane of this row is
  // nearest it (itself, if it's still open). This finalises which lanes every row blocks -- obstacle
  // *kind* (bag/mask/trolley) is untouched here and doesn't affect reachability.
  let ref = 1, prevZ = -Infinity; // the beat always starts centred (lane 1)
  for (const row of rows) {
    const open = openLanesOf(row.obstacles);
    const closeCall = row.z - prevZ < TWO_HOP_MIN_GAP;
    if (closeCall && !open.some((l) => Math.abs(l - ref) <= 1)) {
      const blockFrom = [0, 1, 2].filter((l) => l !== ref);
      const blocked = blockFrom[Math.floor(rngSim() * blockFrom.length)];
      row.obstacles = [{ lane: blocked, kind: pickKind() }];
    }
    const openNow = openLanesOf(row.obstacles);
    ref = openNow.includes(ref) ? ref : openNow.reduce((best, l) => (Math.abs(l - ref) < Math.abs(best - ref) ? l : best), openNow[0]);
    prevZ = row.z;
  }

  // Guarantee: every lane gets >= 1 trolley within the trolley zone. Reassigning an existing slot's
  // *kind* to "trolley" is always safe (the blocked lanes don't change). If no in-zone row blocks a
  // lane at all, add it to a row with room, trying candidates until the whole path re-validates (most
  // rows have 2+ hop-safe neighbours, so this converges fast; a reroll of the attempt is cheap at ~25
  // rows and runs at build time, not per frame).
  const [zoneLo, zoneHi] = AISLE.TROLLEY_ZONE;
  const inZone = rows.filter((r) => r.z >= zoneLo && r.z <= zoneHi);
  for (const lane of pickLanes(3)) {
    if (inZone.some((r) => r.obstacles.some((o) => o.lane === lane && o.kind === "trolley"))) continue;
    const hosts = inZone.filter((r) => r.obstacles.some((o) => o.lane === lane));
    if (hosts.length) {
      hosts[Math.floor(rngSim() * hosts.length)].obstacles.find((o) => o.lane === lane).kind = "trolley";
      continue;
    }
    const candidates = inZone.filter((r) => r.obstacles.length < 2);
    for (const r of candidates) {
      r.obstacles.push({ lane, kind: "trolley" });
      if (pathIsReachable(rows)) break;
      r.obstacles.pop();
    }
  }
  return rows;
}

// Walks the row list the same way the repair pass does, returning false if any close row ever strands
// the reference lane (no open lane within one hop). Used to re-validate after the trolley guarantee.
function pathIsReachable(rows) {
  let ref = 1, prevZ = -Infinity;
  for (const row of rows) {
    const open = openLanesOf(row.obstacles);
    if (row.z - prevZ < TWO_HOP_MIN_GAP && !open.some((l) => Math.abs(l - ref) <= 1)) return false;
    ref = open.includes(ref) ? ref : open.reduce((best, l) => (Math.abs(l - ref) < Math.abs(best - ref) ? l : best), open[0]);
    prevZ = row.z;
  }
  return true;
}

function generateFloats(rngSim) {
  const n = Math.floor(AISLE.FLOAT_MIN + rngSim() * (AISLE.FLOAT_MAX - AISLE.FLOAT_MIN + 1));
  const floats = [];
  for (let i = 0; i < n; i++) floats.push({ z: AISLE.ROW_START_Z + rngSim() * (AISLE.ROW_END_Z - AISLE.ROW_START_Z), active: false, consumed: false });
  return floats.sort((a, b) => a.z - b.z);
}

export function create(rngSim, carry = {}, checkpoint = "start") {
  return {
    t: 0, z: 0, lane: 1, targetLane: 1, slideT: 0, armed: true,
    rows: generateRows(rngSim), floats: generateFloats(rngSim),
    hitRows: new Set(),
    stumbleT: 0, sprinting: false,
    inFloat: false,
    bumps: 0,
    events: [],
  };
}

// phase: "intro" (3s, hazards off -- the generator never places a row before z = 18 m, and 3s of
// forward walking covers only ~12 m, so the hazard-free window holds by construction) | "play".
export function step(b, input, phase, dt) {
  const t = b.t + dt;
  const ix = input.ix || 0, iy = input.iy || 0;
  let lane = b.lane, targetLane = b.targetLane, slideT = b.slideT;
  let armed = b.armed;
  if (armed && ix >= AISLE.LANE_ON && targetLane < 2) { targetLane++; armed = false; slideT = 0; }
  else if (armed && ix <= -AISLE.LANE_ON && targetLane > 0) { targetLane--; armed = false; slideT = 0; }
  else if (!armed && Math.abs(ix) < AISLE.LANE_OFF) armed = true;

  const sprinting = iy <= -0.5;
  const inFloat = b.floats.some((f) => f.active);
  const slideDur = inFloat ? AISLE.SLIDE_FLOAT : sprinting ? AISLE.SLIDE_SPRINT : AISLE.SLIDE_WALK;
  if (lane !== targetLane) {
    slideT += dt;
    if (slideT >= slideDur) { lane = targetLane; slideT = 0; }
  }

  let stumbleT = Math.max(0, b.stumbleT - dt);
  const v = stumbleT > 0 ? AISLE.STUMBLE_V : sprinting ? AISLE.SPRINT_V : AISLE.WALK_V;
  const z = b.z + v * dt;

  // Floats: activate/deactivate by z, each lasting FLOAT_S once triggered.
  const floats = b.floats.map((f) => ({ ...f }));
  for (const f of floats) {
    if (!f.consumed && z >= f.z) { f.active = true; f.consumed = true; f.endZ = z + v * AISLE.FLOAT_S; }
    if (f.active && z >= (f.endZ ?? Infinity)) f.active = false;
  }

  // Collisions: any row within the distance just covered, at the CURRENT lane (post-slide).
  const hitRows = new Set(b.hitRows);
  const events = [];
  let bumps = b.bumps;
  let failed = null;
  for (const row of b.rows) {
    if (hitRows.has(row.z)) continue;
    if (row.z > b.z && row.z <= z) {
      const hit = row.obstacles.find((o) => AISLE.LANE_X[o.lane] === AISLE.LANE_X[lane]);
      hitRows.add(row.z);
      if (hit) {
        if (hit.kind === "trolley") { failed = "trolley"; }
        else { bumps++; stumbleT = AISLE.STUMBLE_S; events.push({ type: "bump", data: { reason: hit.kind } }); }
      }
    }
  }

  return { ...b, t, z, lane, targetLane, slideT, armed, sprinting, inFloat, stumbleT, floats, hitRows, bumps, events, failed };
}

export function outcome(b) {
  if (b.failed) return { cleared: false, failed: true, reachedFinal: false, reason: b.failed, bumps: b.bumps, margin: 0, metric: b.t };
  if (b.z >= AISLE.TRACK_LEN) return { cleared: true, failed: false, reachedFinal: false, reason: null, bumps: b.bumps, margin: 0, metric: b.t };
  return { cleared: false, failed: false, reachedFinal: false, reason: null, bumps: b.bumps, margin: 0, metric: b.t };
}
