// P1 item 3 (THE-1320, board feedback #2: "trees pop in and out"). Decor is kept per 3 m slot (k, side)
// instead of being thrown away and re-scattered on every ground re-centre:
// - a slot is built once, when it first enters the window (which reaches ~300 m ahead along the trail, past
//   the fog), and always looks the same (render/look.js's decorSlot seeds each slot on its own);
// - a slot that has left the window is removed only once it can't be on screen: behind the camera plane or
//   farther than the fog's visible range. On a winding trail, trees "behind" by path distance are often
//   still in view off to the side after a turn, so a path window alone isn't enough.
// No three.js here: objects only need .position, so the policy can be tested in node with plain objects.
// P6: a slot holds an array of objects (its main prop plus any life: flowers, sheep, a hut).
export function createDecorWindow({ build, add, remove, visibleM }) {
  const slots = new Map(); // key -> { k, objs } (an empty array for an empty slot, so it isn't re-rolled)
  const keyOf = (k, sd) => k * 2 + (sd > 0 ? 1 : 0);

  function mayBeVisible(objs, view) { return objs.some((o) => mayOneBeVisible(o, view)); }
  function mayOneBeVisible(obj, view) {
    const dx = obj.position.x - view.x, dz = obj.position.z - view.z;
    if (Math.hypot(dx, dz) > visibleM) return false;
    return dx * view.fx + dz * view.fz > -8; // in front of (or level with) the camera, with a margin for tree size
  }

  // range = [k0, k1] slot indices that should exist; view = { x, z, fx, fz } camera position + unit forward
  function update([k0, k1], view) {
    for (let k = k0; k <= k1; k++) {
      for (const sd of [-1, 1]) {
        const key = keyOf(k, sd);
        if (slots.has(key)) continue;
        const objs = build(k, sd) || [];
        slots.set(key, { k, objs });
        for (const o of objs) add(o);
      }
    }
    for (const [key, slot] of slots) {
      if (slot.k >= k0 && slot.k <= k1) continue;
      if (mayBeVisible(slot.objs, view)) continue; // out of the window but maybe on screen: keep for now
      for (const o of slot.objs) remove(o);
      slots.delete(key);
    }
  }
  // The trail ahead was reshaped (a new junction): slots from k on stand on the old curve, so rebuild them.
  function dropFrom(kFrom) {
    for (const [key, slot] of slots) if (slot.k >= kFrom) { for (const o of slot.objs) remove(o); slots.delete(key); }
  }
  function clear() { dropFrom(-Infinity); }
  return { update, dropFrom, clear, get size() { return slots.size; }, objects: () => [...slots.values()].flatMap((s) => s.objs) };
}
