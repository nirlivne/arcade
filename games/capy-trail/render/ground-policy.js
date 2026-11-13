// CTO fix B8 r3 (THE-1259 S2 review, 2026-11-06 00:45Z): "there's still no ground between rebuilds (at
// 420 m there's none). Ground and decor only re-centre when the ribbon grows (every 300 m), but the plane
// covers only +-120 m. Give them their own trigger, centred about 60 m ahead."
// Pure decision logic (plain-node testable, no three.js): render/scene.js used to only re-centre ground/
// decor as a side effect of a full ribbon rebuild (trailMesh + ground + decor together), which only
// happens every RIBBON_GROW (300 m) of travel -- far less often than the ground's own ~240 m-wide window
// needs to stay ahead of the capy. This gives ground/decor their own, more frequent trigger, decoupled
// from the ribbon's own (expensive, rarer) rebuild.
export const GROUND_LEAD = 60; // ground/decor centred this far ahead of the capy
export const GROUND_RECENTER_AT = 50; // re-centre once the capy has moved this far from the last basis
export const GROUND_WINDOW_RADIUS = 240 / 2 + 40; // matches groundMesh's own size/2 + GROUND_WINDOW_MARGIN

// `lastBasisS` is the capy's own `s` at the point the ground was last centred (not the centre itself,
// which is `lastBasisS + GROUND_LEAD`) -- null means "never centred yet". Returns the new basis to centre
// on, or null if the current centring still covers the capy.
export function nextGroundBasis(currentS, lastBasisS) {
  if (lastBasisS === null || Math.abs(currentS - lastBasisS) > GROUND_RECENTER_AT) return currentS;
  return null;
}
