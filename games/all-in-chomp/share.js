// The share string (G18 + the launch kit, THE-683): from the night's best run only. Variant A when that run
// made a pair or better; otherwise variant C. Variant B (no hand yet, buy-ins left) is unreachable in v1 -
// every run ends at game over - and isn't built. The link goes on its own line (bidi-safe: Hebrew text
// immediately before a URL can scramble the URL's own left-to-right digits/slashes in RTL rendering).
// Pure - `theme` is window.THEME (title, text.shareNight, text.gameOver), passed in rather than read from
// window, so this stays testable under plain node and re-skinnable from theme.js alone.
function formatScore(score) {
  return score.toLocaleString("en-US");
}

// nightBest: { nightNumber, chomperNameHe, score, handNameHe, handRank } | null (handRank from cards.js's
// HAND_INFO; >=1 means at least a pair). url: the game's share link.
export function shareText(nightBest, url, theme) {
  const night = theme.text.shareNight.replace("{n}", nightBest ? nightBest.nightNumber : "");
  if (!nightBest || nightBest.handRank < 1) {
    return `${theme.title} ${night} · ${theme.text.gameOver} 😅\n${url}`;
  }
  const line = `${theme.title} ${night} · ${nightBest.chomperNameHe} · ${formatScore(nightBest.score)} · ${nightBest.handNameHe} 🃏`;
  return `${line}\n${url}`;
}
