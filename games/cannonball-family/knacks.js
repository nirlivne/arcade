// Knack helmets (THE-449 S2; spec §2). A table of multipliers that the level def sets per rail slot. Nothing here
// reads a family member: a knack belongs to the slot, never to the person who fills it (a unit test pins this).
// THE-523 / spec v2 §B4 amendment r2 (CTO, from QA's THE-524 review): light's power retuned 1.25 -> 1.2 (1.25
// would launch at 1,437 and clip MAX_V 1400); CRACK_IMPULSE (sim.js) retuned 250 -> 320 to match.
export const KNACKS = {
  heavy: { mass: 3, cracks: true }, // cracks a stone it hits hard (sim.js)
  light: { mass: 0.5, power: 1.2 }, // flies far
  bounce: { e: 0.6, bounces: 1 }, // restitution 0.6 for one bounce
};

// The knack name for rail slot k of a level def, or null for a plain helmet.
export function knackFor(def, slot) {
  return (def.slots && def.slots[slot]) || null;
}
