// THE-1119 M5: the 1080x1080 result card (offscreen 2D canvas), rebuilt to recipe.js CARD (G14,
// DESIGN.md §5) -- the beach-world photo (render/backdrop.js, no heel line), winner/loser discs on
// the same matka portrait as everywhere else (render/headSprite.js), the megaphone banner, Secular
// JM / Varela JM type (never sans-serif), ctx.direction = "rtl" on the Hebrew lines, scores wrapped
// in LRI/PDI so they never flip. The share chain (G19) below this is unchanged: navigator.share with
// files -> on a non-abort error, download the PNG and copy the link with a toast -> AbortError silent.
import { computeLayout } from "./render/layout.js";
import { paintBackdrop } from "./render/backdrop.js";
import { drawHeadPortrait } from "./render/headSprite.js";
import { COLORS, CARD } from "./render/recipe.js";

const LRI = "⁦", PDI = "⁩";

function hexToRgba(hex, a) {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function drawPoolRing(ctx, x, y, w) {
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = hexToRgba(COLORS.shadow, 0.3); ctx.beginPath(); ctx.ellipse(w * 0.05, w * 0.12, w * 0.55, w * 0.2, 0, 0, 7); ctx.fill();
  const cols = [COLORS.cream, COLORS.p2];
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = cols[i % 2]; ctx.beginPath();
    ctx.ellipse(0, 0, w * 0.52, w * 0.17, 0, (i / 8) * Math.PI * 2, ((i + 1) / 8) * Math.PI * 2); ctx.lineTo(0, 0); ctx.fill();
  }
  ctx.fillStyle = COLORS.sandMid; ctx.beginPath(); ctx.ellipse(0, -w * 0.01, w * 0.22, w * 0.06, 0, 0, 7); ctx.fill();
  ctx.strokeStyle = COLORS.plum; ctx.lineWidth = w * 0.02; ctx.beginPath(); ctx.ellipse(0, 0, w * 0.52, w * 0.17, 0, 0, 7); ctx.stroke();
  ctx.restore();
}

function drawMegaphone(ctx, x, y, size, text, color, rotDeg) {
  const rot = (rotDeg * Math.PI) / 180;
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  ctx.font = `${size}px "Secular JM"`; ctx.direction = "rtl"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const tw = ctx.measureText(text).width, bw = tw + size * 1.8, bh = size * 1.6;
  ctx.fillStyle = hexToRgba(COLORS.shadow, 0.3); ctx.beginPath(); ctx.roundRect(-bw / 2 + size * 0.12, -bh / 2 + size * 0.22, bw, bh, size * 0.2); ctx.fill();
  ctx.fillStyle = COLORS.cream; ctx.beginPath(); ctx.roundRect(-bw / 2, -bh / 2, bw, bh, size * 0.2); ctx.fill();
  ctx.strokeStyle = COLORS.plum; ctx.lineWidth = size * 0.06; ctx.stroke();
  ctx.fillStyle = color || COLORS.plum; ctx.fillText(text, 0, size * 0.03);
  ctx.restore();
}

const CARD_SIZE = CARD.size;

export async function buildCard({ theme, winnerName, winnerLine2, loserName, score, rallyHits = 0, winnerImage, loserImage, winnerColor, loserColor, trail }) {
  try { await document.fonts.ready; } catch (e) { /* draw with fallback fonts rather than block the card */ }

  const canvas = document.createElement("canvas");
  canvas.width = CARD_SIZE; canvas.height = CARD_SIZE;
  const ctx = canvas.getContext("2d");
  const S = CARD_SIZE;

  ctx.fillStyle = CARD.paper; ctx.fillRect(0, 0, S, S);

  // photo: the beach world (no heel line) at photo size, winner + loser on their matkas
  const pad = CARD.pad * S, photoW = S - 2 * pad, photoH = S - pad - CARD.foot * S;
  ctx.save();
  ctx.translate(pad, pad);
  ctx.beginPath(); ctx.rect(0, 0, photoW, photoH); ctx.clip();
  const photoLayout = computeLayout(photoW, photoH);
  paintBackdrop(ctx, photoLayout, { heelLine: false });

  const ph = CARD.photo;
  if (trail && trail.length > 1) {
    ctx.save();
    ctx.strokeStyle = COLORS.heat[1].edge || "#FF8A2E";
    ctx.lineWidth = Math.max(2, photoH * 0.006);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath();
    trail.forEach(([wx, wy], i) => {
      const x = photoLayout.l + wx * photoLayout.scale, y = photoLayout.t + wy * photoLayout.scale;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.globalAlpha = 0.6;
    ctx.stroke();
    ctx.restore();
  }
  if (loserImage) {
    drawPoolRing(ctx, ph.poolRing.x * photoW, ph.poolRing.y * photoH, ph.poolRing.wOfH * photoH);
    drawHeadPortrait(ctx, loserImage, ph.loser.x * photoW, ph.loser.y * photoH, ph.loser.discOfH * photoH, loserColor || COLORS.p2, {
      side: 1, tilt: (ph.loser.tiltDeg * Math.PI) / 180, squash: ph.loser.squash,
    });
  }
  if (winnerImage) {
    drawHeadPortrait(ctx, winnerImage, ph.winner.x * photoW, ph.winner.y * photoH, ph.winner.discOfH * photoH, winnerColor || COLORS.p1, { side: -1 });
  }

  // score signs, flanking the tower (two signs, like the in-match HUD -- winner's colour on the left)
  ctx.font = `700 ${ph.scoreSizeOfH * photoH}px "Secular JM"`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.direction = "ltr";
  ctx.lineWidth = ph.scoreSizeOfH * photoH * 0.12;
  const scoreY = ph.scoreY * photoH, dx = ph.scoreDx * photoW;
  for (const [txt, x, color] of [[String(score[0]), photoW / 2 - dx, winnerColor || COLORS.p1], [String(score[1]), photoW / 2 + dx, loserColor || COLORS.p2]]) {
    ctx.strokeStyle = COLORS.plum; ctx.strokeText(txt, x, scoreY);
    ctx.fillStyle = color; ctx.fillText(txt, x, scoreY);
  }

  drawMegaphone(ctx, ph.megaphone.x * photoW, ph.megaphone.y * photoH, ph.megaphone.sizeOfH * photoH, winnerLine2 || "", COLORS.plum, ph.megaphone.rotDeg);

  // date stamp, bottom-right of the photo (LTR)
  const ds = CARD.dateStamp;
  const now = new Date();
  const dateText = `${String(now.getDate()).padStart(2, "0")} ${String(now.getMonth() + 1).padStart(2, "0")} ${String(now.getFullYear()).slice(2)}`;
  ctx.font = `${ds.size * photoH}px "Varela JM"`; ctx.direction = "ltr"; ctx.textAlign = "right"; ctx.textBaseline = "alphabetic";
  ctx.fillStyle = ds.color; ctx.shadowColor = ds.glow; ctx.shadowBlur = ds.size * photoH * 0.4;
  ctx.fillText(dateText, photoW - photoW * 0.03, photoH - photoH * 0.03);
  ctx.shadowBlur = 0;
  ctx.restore();

  // foot: headline (RTL, plum, right-aligned), sub, url, logo (red, left-aligned)
  const hl = CARD.headline, sub = CARD.sub, url = CARD.url, logo = CARD.logo;
  const footY = (y) => y * S; // headline/sub/url/logo y values are fractions of the full card side S
  ctx.direction = "rtl"; ctx.textBaseline = "alphabetic";
  ctx.font = `${hl.size * S}px "Secular JM"`; ctx.textAlign = "right"; ctx.fillStyle = hl.color;
  const headlineText = `${winnerName} ניצח את ${loserName} ${LRI}${score[0]}–${score[1]}${PDI}`;
  ctx.fillText(headlineText, S - pad, footY(hl.y));

  ctx.font = `${sub.size * S}px "Varela JM"`; ctx.textAlign = "right"; ctx.fillStyle = hl.color; ctx.globalAlpha = sub.alpha;
  ctx.fillText(`${theme.place || ""} · ראלי מנצח: ${rallyHits} מכות`, S - pad, footY(sub.y));
  ctx.globalAlpha = 1;

  ctx.direction = "ltr"; ctx.textAlign = "left";
  ctx.font = `${url.size * S}px "Varela JM"`; ctx.fillStyle = hl.color; ctx.globalAlpha = url.alpha;
  ctx.fillText((theme.shareUrl || location.href).replace(/^https?:\/\//, ""), pad, footY(url.y));
  ctx.globalAlpha = 1;

  ctx.direction = "rtl"; ctx.textAlign = "left";
  ctx.font = `${logo.size * S}px "Secular JM"`; ctx.fillStyle = logo.color;
  ctx.fillText(logo.text, pad, footY(logo.y));

  return canvas;
}

function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function showToast(root, text) {
  const toast = document.createElement("div");
  toast.className = "jm-toast";
  toast.textContent = text;
  root.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

export async function shareResult(canvas, { theme, root, text, url }) {
  const blob = await canvasToBlob(canvas);
  const file = new File([blob], "junkies-matkot.png", { type: "image/png" });

  if (navigator.share) {
    try {
      const payload = { text, url };
      if (navigator.canShare && navigator.canShare({ files: [file] })) payload.files = [file];
      await navigator.share(payload);
      return;
    } catch (err) {
      if (err && err.name === "AbortError") return; // user cancelled: silent
      // fall through to the download + copy-link fallback below
    }
  }

  downloadBlob(blob, "junkies-matkot.png");
  try {
    await navigator.clipboard.writeText(url);
    showToast(root, "הקישור הועתק");
  } catch (e) {
    showToast(root, url);
  }
}
