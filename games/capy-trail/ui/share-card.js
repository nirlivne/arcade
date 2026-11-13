// S7 (THE-1303): the share card -- a 1080x1080 offscreen 2D canvas, the clay palette from tokens.css,
// reused for both navigator.share's files and (if that's unavailable) a direct download. No photo
// compositing is needed here (no player portraits, unlike game #13's share.js): the active hero's own
// head silhouette, drawn with the same shapes as tools/capy-trail-make-icons.mjs, the distance and coin
// count, and the studio's brand lockup.
// THE-1383: per-hero head (board feedback #4's bear swap) -- headDrawerFor() picks drawBearHead or
// drawCapyHead off theme.hero (theme-active.js's resolved kind, so a `?hero=` override is honoured too).
const CREAM = "#FFF3E0", CREAM_HI = "#FFFAF2", COCOA = "#3A2418", COCOA_2 = "#6B4A36";
const ORANGE = "#FF8A2A", ORANGE_HI = "#FFB061";
const FUR = "#B87A4A", FUR_LO = "#8F5C35", SNOUT = "#D9A36E";
const CARD_SIZE = 1080;

function drawCapyHead(ctx, cx, cy, u) {
  ctx.save();
  ctx.fillStyle = FUR_LO;
  ctx.beginPath(); ctx.ellipse(cx - u * 0.62, cy - u * 0.58, u * 0.22, u * 0.22, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx + u * 0.62, cy - u * 0.58, u * 0.22, u * 0.22, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = FUR;
  ctx.beginPath(); ctx.ellipse(cx, cy, u * 0.92, u * 0.78, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = FUR_LO;
  ctx.beginPath(); ctx.ellipse(cx + u * 0.3, cy - u * 0.28, u * 0.42, u * 0.3, -0.4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = SNOUT;
  ctx.beginPath(); ctx.ellipse(cx, cy + u * 0.42, u * 0.52, u * 0.34, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = COCOA;
  ctx.beginPath(); ctx.ellipse(cx - u * 0.14, cy + u * 0.38, u * 0.06, u * 0.045, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx + u * 0.14, cy + u * 0.38, u * 0.06, u * 0.045, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx - u * 0.32, cy - u * 0.12, u * 0.07, u * 0.07, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx + u * 0.32, cy - u * 0.12, u * 0.07, u * 0.07, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// Simple flat silhouette (round head, two round ears, a lighter muzzle) -- kept small, the code budget
// has little headroom left (THE-1383).
// CTO review (THE-1374): drawn 0.08u higher and 0.06u shorter, so the chin clears the title's cap height
// (it sat ~15 px into "Bear Trail" at 1080 px).
function drawBearHead(ctx, cx, cy, u) {
  cy -= u * 0.08;
  ctx.save();
  ctx.fillStyle = FUR_LO;
  ctx.beginPath(); ctx.ellipse(cx - u * 0.66, cy - u * 0.6, u * 0.24, u * 0.24, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx + u * 0.66, cy - u * 0.6, u * 0.24, u * 0.24, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = FUR;
  ctx.beginPath(); ctx.ellipse(cx, cy, u * 0.86, u * 0.76, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = SNOUT;
  ctx.beginPath(); ctx.ellipse(cx, cy + u * 0.3, u * 0.42, u * 0.32, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = COCOA;
  ctx.beginPath(); ctx.ellipse(cx, cy + u * 0.36, u * 0.06, u * 0.045, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx - u * 0.28, cy - u * 0.08, u * 0.06, u * 0.06, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx + u * 0.28, cy - u * 0.08, u * 0.06, u * 0.06, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// THE-1383: pure selection, no canvas -- lets a plain node:test (hero-copy.test.mjs's browser check does
// the end-to-end version) assert the picked drawing without needing a DOM.
export function headDrawerFor(hero) { return hero === "capy" ? drawCapyHead : drawBearHead; }

// theme: the active (resolved) theme, for theme.hero plus the title/studio name; distance/coins: this
// run's results.
export async function buildShareCard({ theme, distance, coins }) {
  try { await document.fonts.ready; } catch (e) { /* draw with fallback fonts rather than block the card */ }

  const canvas = document.createElement("canvas");
  canvas.width = CARD_SIZE; canvas.height = CARD_SIZE;
  const ctx = canvas.getContext("2d");
  const S = CARD_SIZE;

  const grad = ctx.createRadialGradient(S * 0.3, S * 0.25, S * 0.1, S * 0.5, S * 0.5, S * 0.8);
  grad.addColorStop(0, CREAM_HI); grad.addColorStop(1, CREAM);
  ctx.fillStyle = grad; ctx.fillRect(0, 0, S, S);

  headDrawerFor(theme?.hero)(ctx, S * 0.5, S * 0.34, S * 0.22);

  const display = `"CT Bagel", ui-rounded, system-ui, sans-serif`, body = `"CT Nunito", ui-rounded, system-ui, sans-serif`;

  ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  ctx.fillStyle = COCOA;
  ctx.font = `400 ${S * 0.1}px ${display}`;
  ctx.fillText(theme?.title || "Capy Trail", S * 0.5, S * 0.58);

  ctx.font = `400 ${S * 0.16}px ${display}`;
  ctx.fillStyle = ORANGE;
  ctx.fillText(`${Math.round(distance)} m`, S * 0.5, S * 0.74);

  ctx.font = `800 ${S * 0.045}px ${body}`;
  ctx.fillStyle = COCOA_2;
  ctx.fillText(`${Math.round(coins)} coins`, S * 0.5, S * 0.8);

  ctx.font = `800 ${S * 0.03}px ${body}`;
  ctx.fillStyle = COCOA_2;
  ctx.fillText(theme?.studioName || "The Game Company", S * 0.5, S * 0.92);

  return canvas;
}

function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// A13.4.C1 (THE-1318 review): navigator.share with the card image when possible, else download the
// image and copy the share text, else (no clipboard permission) show the share text in a toast -- the
// tap never does nothing.
export async function shareCard(canvas, { text, toast }) {
  const blob = await canvasToBlob(canvas);
  const file = new File([blob], "capy-trail.png", { type: "image/png" });

  if (navigator.share) {
    try {
      const payload = { text };
      if (navigator.canShare && navigator.canShare({ files: [file] })) payload.files = [file];
      await navigator.share(payload);
      return;
    } catch (err) {
      if (err && err.name === "AbortError") return; // user cancelled: silent
      // fall through to the download + clipboard fallback below
    }
  }

  downloadBlob(blob, "capy-trail.png");
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); toast?.("Copied"); return; } catch (e) { /* no clipboard permission; fall through */ }
  }
  toast?.(text);
}
