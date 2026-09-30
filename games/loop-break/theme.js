// Loop Break re-skin config (Game Standard v2 §2.5, spec §8). Editing this file must be enough to re-skin
// the game: no other file changes. Loaded as a classic script before ui-kit.js and the game's own scripts.
window.THEME = {
  title: "LOOP BREAK",
  tagline: "Work out which ring goes first.",
  dedication: "",
  lidEngraving: "", // shown inside the lid at spring-open; "" -> the win result only (spec §8)
  hubEmblem: null, // image slot: drawn default is an enamel hub with a keyway
  defaultSkin: "blued", // "blued" | "gunmetal"
  shareUrl: "https://nirlivne.github.io/arcade/games/loop-break/",
  text: {
    play: "Play",
    daily: "Daily",
    howTo: "How to play",
    win: "Opened.",
    lose: "Can't open in the moves left.",
    next: "Next medallion",
    replay: "Replay",
    retry: "Retry",
    takeBack: "Take back",
    restart: "Restart",
    levels: "Levels",
    share: "Share",
    settings: "Settings",
    resume: "Resume",
    watchDemo: "Watch the demo",
    packs: ["Claws", "Pinions", "Blanks"],
    howToSteps: [
      "Drag a ring or its crown. A gap under the top notch lights up.",
      "A claw turns its neighbour the same way. A little gear turns it the other way.",
      "Drag the toothed ring alone and its driver's claw lifts -- the driver doesn't move.",
      "Batons are your moves. A grey ring only moves when its driver does.",
    ],
    howToBack: "Back",
    howToClose: "Close",
    howToNext: "Next",
    howToDone: "Done",
    credit: "Made by The Game Company",
  },
  colors: {},
  images: { hubEmblem: null },
};
