// Builds one texture atlas canvas from the 11 head images (G20: copies already under assets/faces/,
// never a live path elsewhere), so the whole game stays inside gl.js's single instanced-quad batch
// instead of one draw call per head. Browser-only (loads <img>), not node-tested (TDD skill's
// "rendering" exclusion); faces.js (the data) is.
const CELL = 256;
const COLS = 4;

export function loadAtlas(heads) {
  const canvas = document.createElement("canvas");
  const rows = Math.ceil(heads.length / COLS);
  canvas.width = COLS * CELL;
  canvas.height = rows * CELL;
  const ctx = canvas.getContext("2d");
  const uvs = {};

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

  return Promise.all(loads).then(() => ({ canvas, uvOf: (id) => uvs[id] || null }));
}
