// The Game Company brand kit v1 (THE-1246). Reusable by every later game: copy this file's SVG and colours.
// Mark = "the start key": a squircle key cap in Studio Ink with a soft cream play triangle and one mint
// "power-on" dot. Wordmark = Outfit 700, "The Game Company", tracking -0.01em. Two colours + one spark, never more.
export const BRAND = { ink: "#2B2347", inkLo: "#1C1730", cream: "#FFF6EA", spark: "#4FD1B5", font: "'TGC Outfit', 'Outfit', system-ui, sans-serif" };

// badge(size, {on}) → SVG string. on: "ink" (default, cream glyph on ink key), "cream" (ink glyph on cream key), "mono" (currentColor outline-free).
export function badge(size = 48, { on = "ink", shadow = true } = {}) {
  const key = on === "cream" ? BRAND.cream : on === "mono" ? "currentColor" : BRAND.ink, glyph = on === "cream" ? BRAND.ink : on === "mono" ? "transparent" : BRAND.cream, lo = on === "cream" ? "#E3D3BC" : BRAND.inkLo;
  return `<svg class="tgc-badge" width="${size}" height="${size}" viewBox="0 0 100 100" aria-label="The Game Company">
    ${shadow ? `<rect x="6" y="12" width="88" height="86" rx="30" fill="${lo}"/>` : ""}
    <rect x="6" y="4" width="88" height="86" rx="30" fill="${key}"/>
    <path d="M40 30.5 Q40 26 44 28.2 L68 42.6 Q72 45 68 47.4 L44 61.8 Q40 64 40 59.5 Z" fill="${glyph}" ${on === "mono" ? 'stroke="currentColor"' : ""}/>
    <circle cx="74" cy="22" r="7.5" fill="${BRAND.spark}"/>
  </svg>`;
}
// lockup(size): badge + wordmark, horizontal. size = badge height in px; wordmark cap height ≈ 0.42 × size.
// on = text colour context ("ink" text on light grounds, "cream" text on dark/photo grounds); key = the badge's own
// key colour (ink by default; use "cream" on a Studio Ink panel so the key doesn't vanish).
export function lockup(size = 32, { on = "ink", key = "ink", text = "The Game Company", tone } = {}) {
  const col = tone || (on === "cream" ? BRAND.cream : BRAND.ink);
  return `<span class="tgc-lockup" style="display:inline-flex;align-items:center;gap:${Math.round(size * 0.32)}px;color:${col};font:700 ${Math.round(size * 0.56)}px/1 ${BRAND.font};letter-spacing:-0.01em">${badge(size, { on: key })}<span>${text}</span></span>`;
}
