// Knack helmets (THE-449 S2; spec §2). A table of multipliers that the level def sets per rail slot. Nothing here
// reads a family member: a knack belongs to the slot, never to the person who fills it (a unit test pins this).
export const KNACKS = {
  heavy: { mass: 3, cracks: true }, // cracks a stone it hits hard (sim.js)
  light: { mass: 0.5, power: 1.25 }, // flies far
  bounce: { e: 0.6, bounces: 1 }, // restitution 0.6 for one bounce
};

// The knack name for rail slot k of a level def, or null for a plain helmet.
export function knackFor(def, slot) {
  return (def.slots && def.slots[slot]) || null;
}
