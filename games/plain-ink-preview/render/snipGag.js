// The "spotted beat" (CTO on THE-1551, D2 #2; spec "Snip gag"): a lens glint on the watcher who
// spotted the hero during the freeze, a 30-degree lipstick-coloured cut band across the hero during
// the cut phase, and a full-screen ink wipe during the wipe phase, all before the respawn.
import { g, C, piece } from '../engine/paper.js';

// a small 4-point sparkle at the spotting watcher's eye (world space, camera transform active).
export function drawGlint(x, y) {
  const r = 14;
  const pts = [[x, y - r], [x + r * 0.28, y - r * 0.28], [x + r, y], [x + r * 0.28, y + r * 0.28], [x, y + r], [x - r * 0.28, y + r * 0.28], [x - r, y], [x - r * 0.28, y - r * 0.28]];
  piece(pts, C.paper, { gap: 0, shadow: false });
}

// a 30-degree lipstick band swept across the hero (world space; t in [0,1) within the cut phase).
export function drawCutBand(x, y, t) {
  const len = 420, w = 26 + t * 10;
  const ang = (30 * Math.PI) / 180;
  const dx = Math.cos(ang) * len, dy = Math.sin(ang) * len;
  const nx = -Math.sin(ang) * w, ny = Math.cos(ang) * w;
  const cx = x, cy = y - 90; // centred on the torso, not the feet
  const pts = [
    [cx - dx / 2 - nx / 2, cy - dy / 2 - ny / 2],
    [cx + dx / 2 - nx / 2, cy + dy / 2 - ny / 2],
    [cx + dx / 2 + nx / 2, cy + dy / 2 + ny / 2],
    [cx - dx / 2 + nx / 2, cy - dy / 2 + ny / 2],
  ];
  piece(pts, C.red, { gap: 0, shadow: false });
}

// a full-screen ink wipe sliding in from the left (screen space; t in [0,1) within the wipe phase).
export function drawWipe(canvasW, canvasH, t) {
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = C.ink;
  g.fillRect(0, 0, canvasW * Math.min(1, t * 1.1), canvasH);
  g.restore();
}
