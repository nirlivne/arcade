// The "Our family" sheet (THE-449 S5–S6; spec §6; DESIGN.md's class contract for the bottom sheet). A thin
// DOM layer over family.js: names, seats, looks, a photo per seat, and Clear photos. Photos are read on this
// device, cropped to a 192 px JPEG and kept in localStorage only. They never leave the device and never
// appear in a share line. The crop itself has no drag/zoom step (cut-list item 2 — DESIGN.md's .cbf-crop
// guide circle is cut): just a face-weighted default (THE-474/THE-453), not a plain centre crop.
import { addMember, removeMember, sanitiseCast, COLOURS, LOOKS, NAME_MAX, FAMILY_NAME_MAX, MAX_MEMBERS } from "./family.js";
import { CBF } from "./troupe.js";
import { readyPhoto } from "./render.js";

const PHOTO_PX = 192;
const HEAD_PX = 48; // .cbf-member__head's own CSS size

// A face-weighted default crop (THE-474: a plain centre crop of a normal portrait puts the forehead and eyes
// under the die-cut sticker's own brow band). A portrait (taller than wide) crops a square 0.65x its short
// side (the midpoint of the spec's 0.6-0.7 range), centred at x 50%/y 38% (the midpoint of 36-40%) of the
// source — roughly a head-and-shoulders box, not the torso a true centre crop would catch. A landscape or
// square photo has no "up" to weight toward, so it stays a plain centre crop. Pure (no canvas/bitmap), so it's
// unit-testable on its own; photoFromFile below is the only caller, with the real decoded image's own size.
export function faceCrop(width, height) {
  const portrait = height > width;
  const shortSide = Math.min(width, height);
  const side = portrait ? shortSide * 0.65 : shortSide;
  const cx = width * 0.5, cy = portrait ? height * 0.38 : height * 0.5;
  // Clamped so the crop box never reaches past the source image's own edges, even near a corner.
  const sx = Math.min(Math.max(cx - side / 2, 0), width - side);
  const sy = Math.min(Math.max(cy - side / 2, 0), height - side);
  return { sx, sy, side };
}

async function photoFromFile(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const { sx, sy, side } = faceCrop(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = PHOTO_PX;
  canvas.height = PHOTO_PX;
  canvas.getContext("2d").drawImage(bmp, sx, sy, side, side, 0, 0, PHOTO_PX, PHOTO_PX);
  bmp.close();
  return canvas.toDataURL("image/jpeg", 0.8);
}

// Draws a member's head at CSS size px on a freshly-sized canvas (devicePixelRatio-aware, matching the rail
// chips' own pattern), through the same reference renderer the rest of the game uses. photo (optional): a
// decoded Image for this row, same as game.js's own loadPhotos() builds for the rest of the game (THE-474:
// the row preview is itself one of the "everywhere the member's face is" spots).
function drawHead(canvas, m, px, photo = null) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = px * dpr;
  canvas.height = px * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  CBF.tokens();
  CBF.head(ctx, px / 2, px / 2, { m: { colour: m.colour, look: m.look }, size: px * 0.86, expr: "ready", photo: readyPhoto(photo) });
}

// Binds the sheet in dialog. store is createCastStore(...). onSave(cast) runs after the family is saved.
//
// Photos are keyed by seat in storage (family.js), but a member's own seat can move within one sheet session
// (remove shifts everyone after it down one) or never be committed at all (Close without Save). Both were bugs
// the CTO found on THE-449: a removed member's old seat's photo silently became the next member's photo, and a
// freshly-picked photo was already written to storage even if the sheet was then closed without Save. Fixing
// both means a picked photo is staged in memory (origin, the open-time seat index it was picked at) rather than
// written immediately, and the stage follows its member object (not its seat) through adds/removes, so Save can
// resolve "this member's photo" by identity, however much the seats have shuffled by then.
export function bindFamilySheet({ dialog, store, text, onSave }) {
  let cast = store.loadCast();
  // One object per member, carrying its already-saved photo (if any, read once at open) and this session's own
  // pick (undefined = unchanged, null = picked-then-removed-is-moot, a data URL = a fresh pick to commit on Save).
  // cast.members and this array are always kept the same length and in the same order (every mutation below
  // updates both together), so index i always means "the same member" in either.
  let photoStage = cast.members.map((m, i) => ({ saved: m.photo ? store.getPhoto(i) : null, picked: undefined }));
  let openIndex = -1; // which member row (if any) has its colour/look pickers expanded

  // A decoded Image per data URL, so render() (called on every keystroke and pick) doesn't re-decode the same
  // photo every time (THE-474: the row's own head preview is one of the "everywhere the member's face is"
  // spots). Keyed by the data URL itself, not the member index: a removed member's cached Image is simply
  // never looked up again, nothing to evict by hand.
  const imageCache = new Map();
  function imageFor(url) {
    if (!url) return null;
    let img = imageCache.get(url);
    if (!img) {
      img = new Image();
      img.addEventListener("load", () => render(), { once: true }); // picks up a slow decode once it's ready
      img.src = url;
      imageCache.set(url, img);
    }
    return img;
  }

  const list = dialog.querySelector("[data-family-list]");
  const message = dialog.querySelector("[data-family-message]");
  const familyName = dialog.querySelector("[data-family-name]");
  const addBtn = dialog.querySelector("[data-family-add]");
  const countEl = dialog.querySelector("[data-family-count]");

  // Without this, render() (called after every add/colour/look change) always resets the field from cast.family,
  // which nothing else ever updates while typing (CTO review on THE-449: typing a family name, then tapping
  // "+ Add member" or a colour/look swatch, threw the typed name away back to the saved one).
  familyName.addEventListener("input", () => { cast.family = familyName.value; });

  function say(t) { message.textContent = t || ""; }

  function render() {
    familyName.value = cast.family;
    familyName.maxLength = FAMILY_NAME_MAX;
    list.replaceChildren(...cast.members.map((m, i) => row(m, i)));
    const full = cast.members.length >= MAX_MEMBERS;
    addBtn.disabled = full;
    addBtn.textContent = full ? text.sixOfSix : text.addMember;
    countEl.textContent = `${cast.members.length} ${text.of6}`;
  }

  function pickerFieldset(legendText, options, render1 /* (value) => Node */, current, name, onChange) {
    const fs = document.createElement("fieldset");
    fs.className = "cbf-pick";
    const legend = document.createElement("legend");
    legend.textContent = legendText;
    fs.append(legend);
    for (const v of options) {
      fs.append(render1(v, v === current, name, onChange));
    }
    return fs;
  }

  function colourSwatch(v, checked, name, onChange) {
    const label = document.createElement("label");
    label.className = "cbf-swatch";
    label.dataset.colour = v;
    const input = document.createElement("input");
    input.type = "radio";
    input.name = name;
    input.value = v;
    input.checked = checked;
    input.setAttribute("aria-label", v);
    input.addEventListener("change", () => onChange(v));
    const dot = document.createElement("i");
    label.append(input, dot);
    return label;
  }

  function lookSwatch(v, checked, name, onChange, colour) {
    const label = document.createElement("label");
    label.className = "cbf-look";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = name;
    input.value = v;
    input.checked = checked;
    input.setAttribute("aria-label", `${text.look} ${Number(v) + 1}`);
    input.addEventListener("change", () => onChange(v));
    const canvas = document.createElement("canvas");
    drawHead(canvas, { colour, look: Number(v) }, 40);
    label.append(input, canvas);
    return label;
  }

  function row(m, i) {
    const li = document.createElement("li");
    li.className = "cbf-member" + (openIndex === i ? " is-open" : "");
    li.dataset.colour = m.colour;

    const stage = photoStage[i];
    const photoUrl = stage.picked !== undefined ? stage.picked : stage.saved;
    const head = document.createElement("canvas");
    head.className = "cbf-member__head";
    drawHead(head, m, HEAD_PX, imageFor(photoUrl));

    const name = document.createElement("input");
    name.className = "cbf-member__name";
    name.type = "text";
    name.maxLength = NAME_MAX; // the store trims a longer paste to 10 as well
    name.value = m.name;
    name.setAttribute("aria-label", `${text.name} ${i + 1}`);
    name.addEventListener("input", () => { cast.members[i].name = name.value; });

    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "cbf-member__dot";
    dot.setAttribute("aria-label", text.more);
    dot.setAttribute("aria-expanded", String(openIndex === i));
    dot.addEventListener("click", () => { openIndex = openIndex === i ? -1 : i; render(); });

    li.append(head, name, dot);

    if (openIndex === i) {
      const more = document.createElement("div");
      more.className = "cbf-member__more";
      const colourName = `cb-colour-${i}`, lookName = `cb-look-${i}`;
      more.append(
        pickerFieldset(text.colour, COLOURS, colourSwatch, m.colour, colourName, (v) => { cast.members[i].colour = v; render(); }),
        pickerFieldset(text.look, [...Array(LOOKS).keys()].map(String), (v, checked, name_, onChange) => lookSwatch(v, checked, name_, onChange, m.colour), String(m.look), lookName, (v) => { cast.members[i].look = Number(v); render(); }),
      );

      const photoRow = document.createElement("div");
      photoRow.className = "cb-row";
      const photo = document.createElement("input");
      photo.type = "file";
      photo.accept = "image/*";
      photo.setAttribute("aria-label", `${text.photo} ${i + 1}`);
      photo.addEventListener("change", async () => {
        const file = photo.files && photo.files[0];
        if (!file) return;
        try {
          const url = await photoFromFile(file);
          // Staged only: not written to storage until Save (CTO review on THE-449 — picking a photo then
          // closing without Save used to leave it in storage anyway). store.setPhoto() is what actually
          // validates size/shape, at Save time, where the real write happens; here just hold the candidate
          // for the preview. photoFromFile's own 192 px/0.8-quality JPEG is always well under the size cap,
          // so this can't actually fail here — text.photoTooBig only ever shows from the Save-time check.
          photoStage[i].picked = url;
          cast.members[i].photo = true;
          say("");
        } catch (e) { say(text.photoFailed); }
        render();
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "uk-btn cbf-link";
      remove.textContent = text.remove;
      remove.addEventListener("click", () => {
        cast = removeMember(cast, i);
        if (!cast.error) photoStage = photoStage.filter((_, j) => j !== i); // follow the member, not the seat
        openIndex = -1;
        say(cast.error);
        render();
      });
      photoRow.append(photo, remove);
      more.append(photoRow);

      li.append(more);
    }
    return li;
  }

  addBtn.addEventListener("click", () => {
    cast = addMember(cast);
    if (!cast.error) photoStage.push({ saved: null, picked: undefined }); // the new seat starts with no photo
    openIndex = cast.members.length - 1;
    say(cast.error || "");
    render();
  });
  // Clear photos is itself an explicit, named action (unlike a picked-then-abandoned photo), so it stays
  // immediate rather than staged — but it must also drop any pending pick, or Save right after would write a
  // picked photo back in and "Clear photos" would look like it silently didn't work.
  dialog.querySelector("[data-family-clear]").addEventListener("click", () => {
    store.clearPhotos();
    cast.members.forEach((m) => { m.photo = false; });
    photoStage.forEach((p) => { p.saved = null; p.picked = undefined; });
    say(text.photosCleared);
    render();
    // Storage is already cleared (the line above), whether or not Save is tapped after this — so the game's
    // own cached photos must refresh now too, not just on the next Save (CTO review r2 on THE-449: "Photos
    // cleared" showed, but a photo already loaded in the game kept showing until the next reload). onSave is
    // the same refresh Save itself triggers; here it's a sync, not a claim that anything new was written.
    onSave(cast);
  });
  dialog.querySelector("[data-family-save]").addEventListener("click", () => {
    cast = sanitiseCast({ v: 1, family: familyName.value, members: cast.members });
    // Commit this session's staged photos now, by member (photoStage[i] always matches cast.members[i]: every
    // add/remove above kept them in lockstep, so this is "this member's photo", not "whatever is in this
    // seat's key" — the seat-shift-on-remove bug this replaced). A fresh pick is validated for real (size/
    // shape) here, where it's actually written; a pick that previewed fine but was too big to save falls back
    // to no photo rather than silently keeping the old one.
    let anyTooBig = false;
    cast.members.forEach((m, i) => {
      const stage = photoStage[i];
      const toWrite = stage.picked !== undefined ? stage.picked : stage.saved;
      if (!toWrite) { store.removePhoto(i); m.photo = false; return; }
      m.photo = store.setPhoto(i, toWrite);
      if (!m.photo) anyTooBig = true;
    });
    // A seat past the new, shorter family's own end can still hold a photo from before a remove shrank the
    // array (CTO review r2 on THE-449: the loop above only ever visits 0..members.length-1, so that trailing
    // photo was never cleaned up and just sat in storage, orphaned, until Clear photos or a reload-then-pick
    // happened to reuse that same seat index for someone else).
    for (let i = cast.members.length; i < MAX_MEMBERS; i++) store.removePhoto(i);
    if (anyTooBig) say(text.photoTooBig);
    store.saveCast(cast);
    onSave(cast);
    dialog.close();
  });
  dialog.querySelector("[data-family-close]").addEventListener("click", () => dialog.close());

  return {
    open() {
      cast = store.loadCast();
      photoStage = cast.members.map((m, i) => ({ saved: m.photo ? store.getPhoto(i) : null, picked: undefined }));
      openIndex = -1;
      say("");
      render();
      dialog.showModal();
    },
    current: () => cast,
  };
}
