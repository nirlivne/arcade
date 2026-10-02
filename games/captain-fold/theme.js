// Captain Fold re-skin config (Game Standard v2 S2.5, THE-260 spec S8). Loaded as a classic script before
// game.js. Editing this file must be enough to re-skin the game: names, text, colours and image slots. Keep
// URLs out of it; image paths are relative to the game folder, and every image slot has a drawn default (null).
window.THEME = {
  title: "Captain Fold",
  text: {
    // The board didn't name the Captain on THE-255, so it ships as the title "THE CAPTAIN" (THE-325). If the CEO
    // relays a name later, the CTO swaps this one string. NEVER default this to a real name or the board's
    // photo/likeness details (privacy, THE-260 DoD 4: the reference photo never ships, only the illustrated
    // likeness this string labels).
    captainName: "THE CAPTAIN",
    credit: "The Game Company",
    dailyLabel: "Daily flight",
    hintFirst: "Hold to climb · let go to dive.",
    hintFlight: "hold to climb · let go to dive",
    howToTitle: "How to fly",
    howToStep1: "Pull back the plane and let go to throw it.",
    howToStep2: "Hold anywhere to climb. Let go to dive.",
    howToStep3: "Land on the blanket. After the clock runs out, a bump crumples the plane.",
    resultLanded: "What a landing!",
    resultCrashed: "Crumpled!",
    demoCaption1: "Pull back, then let go",
    demoCaption2: "Hold to climb · let go to dive",
    demoCaption3: "After 20 s, a bump crumples the plane",
    demoCaption4: "Before that, a bump just bounces",
    demoCaption5: "Land here",
    chapterLabel: "Chapter",
  },
  // CTO review B5: these are the collection's fixed identity (names/unlock copy), not freely rewritable player
  // text - a re-skin may still want different words for them, so they live here rather than as literals in
  // game.js, but unlike `text` there's no sensible single default string per key (each fold needs its own).
  folds: {
    notebook: { name: "Notebook", how: "Default" },
    graph: { name: "Graph paper", how: "First landing" },
    newspaper: { name: "Newspaper", how: "50 lucky stars" },
    map: { name: "Map paper", how: "Finish Chapter 1" },
    origami: { name: "Origami red", how: "10 courses at 3 stars" },
    gold: { name: "Gold star paper", how: "Finish Chapter 3" },
  },
  colors: {
    // Overrides of tokens.css custom properties once the Designer's tokens.css lands at M4, e.g. "--cf-sky-1": "#..."
  },
  images: {
    // CTO review R2: a "plane" slot used to be declared here with nothing ever drawing it - removed rather than
    // wired, since overriding the notebook-paper plane means rotating a re-skinned image with the live bank
    // angle in render.js, and there's no real image to build and verify that against yet (THE-255 privacy hold).
    pilot: null, // e.g. "captain.png": drawn instead of the default pilot.js Captain in the porthole + result pass stub
    cover: null, // e.g. "cover.png": drawn instead of the default title/hero art
  },
};
