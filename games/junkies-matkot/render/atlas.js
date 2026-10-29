// Builds one texture atlas canvas from the 11 head images (G20: copies already under assets/faces/,
// never a live path elsewhere) plus, optionally, the pre-baked beach-crowd sprites (THE-1141 §11.5,
// render/crowd.js), so the whole game stays inside gl.js's single instanced-quad batch instead of one
// draw call per head/sprite -- there is only one `uAtlas` texture slot (render/gl.js), so crowd sprites
// have to live in this same canvas, not a separate texture. Browser-only (loads <img> / draws canvases),
// not node-tested (TDD skill's "rendering" exclusion); faces.js and recipe.js (the data) are.
const CELL = 256;
const COLS = 4;

export function loadAtlas(heads, crowdSprites = null) {
  const canvas = document.createElement("canvas");
  const headRows = Math.ceil(heads.length / COLS);

  // Crowd sprites are non-square and sized per their own recipe (CROWD.*.sizeOfD), unlike the heads'
  // fixed square cells, so they're shelf-packed below the head grid instead of forced into COLS*CELL
  // cells. bakeCrowd() bakes at one fixed reference size (CELL) regardless of the court's on-screen
  // scale -- same as the heads, the renderer scales the quad instance to whatever size it needs at draw
  // time, so there's no need to re-bake this on resize.
  const crowdEntries = [];
  let crowdW = 0, crowdH = 0;
  if (crowdSprites) {
    let x = 0, y = 0, rowH = 0;
    for (const kind of Object.keys(crowdSprites)) {
      for (let frame = 0; frame < crowdSprites[kind].length; frame++) {
        const c = crowdSprites[kind][frame];
        if (x + c.width > COLS * CELL) { x = 0; y += rowH; rowH = 0; }
        crowdEntries.push({ kind, frame, canvas: c, x, y });
        x += c.width;
        rowH = Math.max(rowH, c.height);
        crowdW = Math.max(crowdW, x);
      }
    }
    crowdH = y + rowH;
  }

  canvas.width = COLS * CELL;
  canvas.height = headRows * CELL + crowdH;
  const ctx = canvas.getContext("2d");
  const uvs = {};
  const aspects = {};

  const loads = heads.map((head, i) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const col = i % COLS, row = Math.floor(i / COLS);
      const x = col * CELL, y = row * CELL;
      ctx.drawImage(img, x, y, CELL, CELL);
      uvs[head.id] = [x / canvas.width, y / canvas.height, (x + CELL) / canvas.width, (y + CELL) / canvas.height];
      resolve();
    };
    img.onerror = () => { uvs[head.id] = null; resolve(); }; // falls back to a flat colour disc
    img.src = head.image;
  }));

  const crowdY0 = headRows * CELL;
  for (const e of crowdEntries) {
    const y = crowdY0 + e.y;
    ctx.drawImage(e.canvas, e.x, y);
    const key = `${e.kind}_${e.frame}`;
    uvs[key] = [e.x / canvas.width, y / canvas.height, (e.x + e.canvas.width) / canvas.width, (y + e.canvas.height) / canvas.height];
    aspects[key] = e.canvas.width / e.canvas.height;
  }

  return Promise.all(loads).then(() => ({
    canvas,
    uvOf: (id) => uvs[id] || null,
    crowdUvOf: (kind, frame) => uvs[`${kind}_${frame}`] || null,
    crowdAspectOf: (kind, frame) => aspects[`${kind}_${frame}`] ?? 1,
  }));
}
