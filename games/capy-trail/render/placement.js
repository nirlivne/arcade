// Extracted from render/scene.js's inner placeAt() (THE-1259 CTO fix F1, 2026-11-05 22:38Z) so it's a
// pure, directly node-testable function: it always set y=0, clobbering a coin's own baked hover offset
// and leaving the high-hazard (bird/heron) pool at ground level with no offset at all. `kind` picks the
// render-layer height; the sim's own hitbox band (sim/sim.js HAZARD_BAND) is the gameplay source of
// truth and is unaffected either way.
import { laneX } from "../sim/track.js";

// coin: spec §3 "hover height of 0.5 m". high: a render-only pick inside the spec's abstract hitbox band
// (sim/sim.js HAZARD_BAND.high = [0.5, 2.2]) -- above the capy's 0.75 m standing height so it reads as
// "duck under", below the jump-peak(1.4 m)-ish range so it doesn't look jumpable. either: A12.1 (THE-1297)
// -- a log on stumps stands on the ground; look.js's logOnStumps lifts the log itself into the hit band
// (sim/sim.js HAZARD_BAND.either = [0.45, 0.80]), so no extra hover here (THE-1298: 0.45 floated it).
// branch: the merged 2-3 lane branch bar (look.js branchBar) also authors its own heights, so it stands on
// the ground too (THE-1298: the high hover lifted its bar to 1.7 m, which read as "run under").
export const HOVER_Y = { coin: 0.5, high: 1.0, either: 0, branch: 0 };

export function placeAt(obj, trail, s, lane, kind = "ground") {
  const clamped = Math.min(trail.len, s); // s < 0 is fine: trail.at extends straight back past the start
  const { p, t, side } = trail.at(clamped);
  const x = laneX(lane);
  const y = HOVER_Y[kind] ?? 0;
  obj.position.set(p.x + side.x * x, y, p.z + side.z * x);
  obj.rotation.y = Math.atan2(t.x, t.z);
}
