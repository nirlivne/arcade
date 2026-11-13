// Track-space constants shared by the generator (sim/patterns.js) and the renderer (render/scene.js).
// The sim never sees world coordinates -- a tile is just a type and a length along the trail (design ->
// "Track space"). LANE_X turns a lane index into a sideways offset for both hit-testing and rendering.
export const TILE_LENGTH = 10; // metres, approx (design: "tiles about 10 m")
export const LANE_SPACING = 1.6; // metres between lane centres (spec §2)
export const LANES = [-1, 0, 1];

export function laneX(lane) { return lane * LANE_SPACING; }
