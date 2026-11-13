// Power-up timing constants shared between sim.js (runtime behaviour) and patterns.js (generator
// placement rules) -- a separate leaf module avoids a sim.js <-> patterns.js import cycle (sim.js already
// imports patterns.js for createPatterns).
export const POWER_TIME = { honey: 8, shield: 20, balloon: 6, spring: 10 }; // spec Part 1: seconds per power-up kind
// THE-1394 "Balloon Ride": rise -> float at y ~= 4 m -> gentle descent -> 1 s landing protection, totalling
// POWER_TIME.balloon. Float is whatever's left of the 6 s once the other three fixed legs are subtracted.
export const BALLOON_HEIGHT = 4;
export const BALLOON_RISE_T = 0.8;
export const BALLOON_DESCEND_T = 0.8;
export const BALLOON_LANDING_T = 1.0; // spec Part 1: "gets 1 s of landing protection"
export const BALLOON_FLOAT_T = POWER_TIME.balloon - BALLOON_RISE_T - BALLOON_DESCEND_T - BALLOON_LANDING_T;
