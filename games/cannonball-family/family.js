// The family (THE-449 S2 rail, S5 cast; spec §2, §6, §8; design "Save and seed"). Pure model + a thin store.
// Rail: N = shots = rail slots, independent of the family size F. Level L starts at member (L−1) mod F, and slot k
// carries member (start + k) mod F, so every member opens a level equally often.
// Photos never leave the device and are never in the repo or in a share line: one localStorage key per slot.

export const COLOURS = ["poppy", "cobalt", "violet", "moss", "sun", "teal"]; // the six seat colours (tokens)
export const LOOKS = 6; // the six felt looks, 0–5
export const MIN_MEMBERS = 2, MAX_MEMBERS = 6;
export const NAME_MAX = 10, FAMILY_NAME_MAX = 16;
export const PHOTO_MAX_CHARS = 48 * 1024; // the stored data URL, at most 48 KB
export const CAST_KEY = "cannonball-family:cast:v1";
const PHOTO_PREFIX = "data:image/jpeg;base64,";
const DEFAULT_FAMILY_NAME = "Bells";

// The six drawn defaults, one per seat. Five are active by default; Teen can be added (the cast sheet, S5).
export const DEFAULT_MEMBERS = [
  { name: "Ma", colour: "poppy", look: 0 },
  { name: "Pa", colour: "cobalt", look: 1 },
  { name: "Nan", colour: "violet", look: 2 },
  { name: "Gramps", colour: "moss", look: 3 },
  { name: "Kid", colour: "sun", look: 4 },
  { name: "Teen", colour: "teal", look: 5 },
];
export const DEFAULT_CAST = DEFAULT_MEMBERS.slice(0, 5);

// A proper modulo, not JS's remainder: a level before the epoch (dayIndex < 0) can make level ≤ 0, and the % operator
// would return a negative index for that (a crash waiting to happen the moment "today" is early), never a valid slot.
export function railMember(level, slot, familySize) {
  const n = (level - 1 + slot) % familySize;
  return n < 0 ? n + familySize : n;
}

// familyName is theme.js's own default ("Bells" unless the theme says otherwise); a saved family always wins.
export function defaultFamily(familyName = DEFAULT_FAMILY_NAME) {
  return { family: familyName, members: DEFAULT_CAST.map((m) => ({ ...m, photo: false })) };
}

// A name is at most 10 characters (code points, so an emoji is one), trimmed; an empty name keeps the seat's default.
function sanitiseMember(m, slot) {
  const base = DEFAULT_MEMBERS[slot];
  const src = m && typeof m === "object" ? m : {};
  const name = typeof src.name === "string" && src.name.trim() ? [...src.name.trim()].slice(0, NAME_MAX).join("") : base.name;
  const colour = COLOURS.includes(src.colour) ? src.colour : base.colour;
  const look = Number.isInteger(src.look) && src.look >= 0 && src.look < LOOKS ? src.look : base.look;
  return { name, colour, look, photo: src.photo === true };
}

// Anything that isn't a valid family (wrong version, a count outside 2–6) is the defaults. A bad member keeps its
// seat's default and the rest of the family stays.
export function sanitiseCast(raw, familyName = DEFAULT_FAMILY_NAME) {
  if (!raw || typeof raw !== "object" || raw.v !== 1 || !Array.isArray(raw.members)) return defaultFamily(familyName);
  if (raw.members.length < MIN_MEMBERS || raw.members.length > MAX_MEMBERS) return defaultFamily(familyName);
  const name = typeof raw.family === "string" && raw.family.trim() ? [...raw.family.trim()].slice(0, FAMILY_NAME_MAX).join("") : familyName;
  return { family: name, members: raw.members.map((m, i) => sanitiseMember(m, i)) };
}

// The sheet's "+ Add member": a seventh is refused with the message "6 of 6"; the new member takes the next seat.
export function addMember(cast) {
  if (cast.members.length >= MAX_MEMBERS) return { ...cast, error: "6 of 6" };
  const base = DEFAULT_MEMBERS[cast.members.length];
  return { ...cast, members: [...cast.members, { ...base, photo: false }], error: undefined };
}

export function removeMember(cast, index) {
  if (cast.members.length <= MIN_MEMBERS) return { ...cast, error: "At least 2 members" };
  return { ...cast, members: cast.members.filter((_, i) => i !== index), error: undefined };
}

// A photo is a small JPEG data URL (the crop is 192 px, JPEG 0.8). Anything else is dropped, and the member is drawn.
export function sanitisePhoto(p) {
  if (typeof p !== "string" || !p.startsWith(PHOTO_PREFIX) || p.length > PHOTO_MAX_CHARS) return null;
  return p;
}

const photoKey = (slot) => `cannonball-family:photo:${slot}`;

// The cast and the photos in storage. Every access is in try/catch: blocked or full storage plays on with defaults.
export function createCastStore(storage, familyName = DEFAULT_FAMILY_NAME) {
  function loadCast() {
    try { return sanitiseCast(JSON.parse(storage.getItem(CAST_KEY)), familyName); } catch (e) { return defaultFamily(familyName); }
  }
  function saveCast(cast) {
    try { storage.setItem(CAST_KEY, JSON.stringify({ v: 1, ...sanitiseCast({ v: 1, ...cast }) })); } catch (e) { /* not saved */ }
  }
  function setPhoto(slot, dataUrl) {
    const p = sanitisePhoto(dataUrl);
    if (!p) return false;
    try { storage.setItem(photoKey(slot), p); return true; } catch (e) { return false; }
  }
  function getPhoto(slot) {
    try { return sanitisePhoto(storage.getItem(photoKey(slot))); } catch (e) { return null; }
  }
  function removePhoto(slot) {
    try { storage.removeItem(photoKey(slot)); } catch (e) { /* nothing to clear */ }
  }
  function clearPhotos() {
    for (let slot = 0; slot < MAX_MEMBERS; slot++) removePhoto(slot);
  }
  return { loadCast, saveCast, setPhoto, getPhoto, removePhoto, clearPhotos };
}
