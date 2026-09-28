// Re-skin config (Game Standard v2 section 2.5). Editing this file is enough to re-skin Rush Lane: names, text,
// colours and image slots. Keep URLs out of it (the publish tool warns on them); image paths are relative to the
// game folder, and every image slot has a drawn default (null). `{n}`, `{total}` and `{date}` in text values are
// filled in by game.js at runtime (see its `T()` helper).
window.THEME = {
  title: "Rush Lane",
  tagline: "Tap an arrow. Clear the way.",
  dedication: "",
  names: { hero: "Pip" },
  text: {
    play: "Play",
    levels: "Levels",
    howTo: "How to play",
    settings: "Settings",
    about: "About",
    pause: "Paused",
    resume: "Resume",
    menu: "Menu",
    hint: "Hint",
    sound: "Sound",
    reduceMotion: "Reduce motion",
    reduceMotionHint: "No shake, no confetti",
    win: "Cleared!",
    lose: "Try again!",
    newBest: "New best!",
    daily: "Daily board",
    dailyLabel: "Daily · {date}",
    levelLabel: "Level {n}",
    next: "Next level",
    retry: "Retry",
    levelInfo: "Level {n} of {total}",
    allDone: "All {total} levels cleared!",
    retryInfoLevel: "Have another go at level {n}.",
    retryInfoDaily: "Have another go at today's board.",
    allClearTitle: "All levels clear!",
    allClearBody: "More lanes are on the way. Try today's daily board while you wait.",
    howToGoal: "Clear the board: every arrow has to leave.",
    howToTap: "Tap an arrow. If its lane is clear, it slides straight out.",
    howToBump: "Blocked? It bumps back and costs a heart. Lose all 3 and you retry.",
    demoHint: "Try it!",
    showMe: "Show me",
    share: "Share result",
    copied: "Copied!",
    shareText: "Rush Lane daily {date}: cleared with {hearts} hearts! {emoji}",
  },
  colors: {
    // Overrides of tokens.css custom properties, e.g. "--color-primary": "#FF7A59"
  },
  images: {
    hero: null, // Pip's face disc (clipped to a circle): the title rider, the HUD chip, the clear and retry panels
  },
};
