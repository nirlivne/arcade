// Potion Pour re-skin config (Game Standard v2 §2.5; design brief §14). Editing this file is enough to re-skin
// the game: names, text, colours, rune order and image slots. Keep URLs out of it (the publish tool warns on
// them); image paths are relative to the game folder, and every image slot has a drawn default (null). `{n}`
// and other `{name}` placeholders in text values are filled in by game.js's `T()` helper at runtime.
window.THEME = {
  title: "Potion Pour",
  tagline: "Pour. Match. Brew!",
  dedication: "Brewed for every kid who lines up their crayons by colour.",
  names: { hero: "Glub" },
  // Chapter names for the level map (index = a level's "chapter" field in levels.js). Purely cosmetic
  // grouping; the difficulty ladder itself comes from tools/potion-pour/gen-levels.mjs.
  chapters: [
    "Apprentice's Corner",
    "Herbalist's Table",
    "Potion Master's Bench",
    "Alchemist's Guild",
    "Grand Archive",
    "Legendary Cellar",
  ],
  text: {
    play: "Play",
    levelBtn: "Level {n}",
    level: "Level",
    levels: "Map",
    next: "Next",
    replay: "Replay",
    win: "Brewed!",
    newBest: "New best!",
    deadEnd: "No pours left!",
    deadEndExplainFull: "I've nowhere to go",
    deadEndExplainRoom: "I want one of those",
    brewAgain: "Let's brew again",
    daily: "Daily",
    dailyDone: "See you tomorrow!",
    dailyBestLabel: "Best: {n} pours",
    howTo: "How to play",
    howTo1: "Pour onto the same colour, or into an empty vial.",
    howTo2: "Fill a vial with one colour.",
    howTo3: "Stuck? Undo or add a vial.",
    hint: "Hint",
    undo: "Undo",
    extraVial: "Extra vial",
    restart: "Restart",
    pause: "Paused",
    resume: "Resume",
    menu: "Menu",
    settings: "Settings",
    sound: "Sound",
    vibration: "Vibration",
    reduceMotion: "Reduce motion",
    reduceMotionHint: "Calmer pours, no shimmer",
    showFit: "Show where it fits",
    showFitHint: "Glow the vials a lift can pour into",
    replayDemo: "Replay the demo",
    resetProgress: "Reset progress",
    resetProgressConfirm: "Erase all levels, stars and bests? This can't be undone.",
    resetProgressYes: "Erase it",
    about: "About",
    showMe: "Show me",
    share: "Share",
    copied: "Copied!",
    shareText: "Potion Pour {label} \u{1F4A7}{pours} {stars} {emoji}",
    fontCredit: "Font: Baloo 2 (SIL OFL)",
    allClearTitle: "All shelves brewed!",
    allClearBody: "More potions are brewing. Try today's daily potion while you wait.",
    demoHint: "Try it!",
    hintUnavailable: "Hint's still thinking -- try again",
  },
  colors: {
    // Overrides of tokens.css custom properties, e.g. "--color-bg": "#FFD9E8" or "--color-potion-3": "#FF5A7A"
  },
  runes: [
    // Optional re-order of the 12 runes per potion index, e.g. ["heart", "star", ...] (names in render.js)
  ],
  images: {
    hero: null, // Glub's face (a round photo clipped to the drop): title, clear and dead-end panels, how-to
    tag: null, // a small round picture on every finished vial's tag instead of the rune (a birthday edition)
  },
};
