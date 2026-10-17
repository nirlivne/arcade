// The share string (G18 + the launch kit, THE-683): from the night's best run only. A score line when the run
// scored, else the commiseration line (board 2026-10-17: the poker hand is gone, the round takes its place).
// The link goes on its own line (bidi-safe: Hebrew text immediately before a URL can scramble the URL's own
// left-to-right digits/slashes in RTL rendering). Pure - `theme` is window.THEME (title, text.shareNight,
// text.gameOver, text.round), passed in rather than read from window, so this stays testable under plain
// node and re-skinnable from theme.js alone.
function formatScore(score) {
  return score.toLocaleString("en-US");
}

// nightBest: { nightNumber, chomperNameHe, score, level } | null. url: the game's share link.
export function shareText(nightBest, url, theme) {
  const night = theme.text.shareNight.replace("{n}", nightBest ? nightBest.nightNumber : "");
  if (!nightBest || nightBest.score <= 0) {
    return `${theme.title} ${night} · ${theme.text.gameOver} 😅\n${url}`;
  }
  const round = theme.text.round.replace("{n}", nightBest.level);
  return `${theme.title} ${night} · ${nightBest.chomperNameHe} · ${formatScore(nightBest.score)} · ${round} 🃏\n${url}`;
}
