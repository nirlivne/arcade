// Loads the head images and pre-scales each once to an offscreen canvas at 2 tiles. S1: normal heads only
// (no jaw split, no eyes-closed frame - those arrive in S5). Rebuilt on resize by the caller. Render only.
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${src}`));
    img.src = src;
  });
}

export async function loadFaces(cast) {
  const images = {};
  await Promise.all(
    cast.map(async (f) => {
      images[f.id] = await loadImage(f.file);
    })
  );
  return images;
}

// Fits a (usually tall) portrait image into a `size`x`size` square, centred, aspect preserved. If
// `mouthY` (the source image's own pixel y, typically the midpoint of mouth_top/mouth_bottom from
// faces.json's landmarks) is given, also returns where that landmark lands in the OUTPUT canvas, so the
// chomp jaw (render.js) can split the head there without redoing this scale/offset math itself.
export function prescale(img, size, mouthY = null) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  const scale = Math.min(size / img.width, size / img.height);
  const w = img.width * scale, h = img.height * scale;
  const offY = (size - h) / 2;
  ctx.drawImage(img, (size - w) / 2, offY, w, h);
  const mouthSplitPx = mouthY == null ? null : offY + mouthY * scale;
  return { canvas, mouthSplitPx };
}

// `landmarks` maps id -> the source mouth y (callers pass the faces.json midpoint); omit for a plain scale.
export function prescaleAll(images, size, landmarks = {}) {
  const out = {};
  for (const [id, img] of Object.entries(images)) out[id] = prescale(img, size, landmarks[id] ?? null);
  return out;
}
