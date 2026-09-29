// games/petal-patch/theme.js -- edit this file to re-skin the game; no other file changes (Standard v2 §2.5).
// A classic script (games run from file:// too), loaded before the game's own scripts.
window.THEME = {
  title: "Petal Patch",
  dek: "One ladybug to every bed.",
  pieceName: "ladybug",
  pieceNamePlural: "ladybugs",
  lifeName: "petal",
  dedication: "", // optional personal line; shown in the footer and under the clipping, never in the share text
  shareUrl: "https://nirlivne.github.io/arcade/games/petal-patch/",
  text: {
    howto: [
      "One per row and column.",
      "One ladybug in every bed.",
      "Ladybugs never touch.",
      "Tap twice. Wrong costs a petal.",
    ],
    solvedIn: "Solved in",
    clippingSolved: "Today's garden, solved.",
    clippingWilted: "Today's garden wilted.",
    runoverHeadline: "The patch wilted.",
  },
  colors: {}, // optional overrides of tokens.css custom properties, e.g. "--color-bed-borage": "#..."
  images: {
    // A path in the game folder (e.g. "art/my-piece.png"), rendered as an <img> -- never an SVG string
    // (DESIGN.md §1.1 amendment). null = the built-in drawn default.
    pieceSvg: null, // null = the built-in drawn ladybug
    lifeSvg: null, // null = the built-in drawn petal
    beds: null, // null = the built-in 9 {hex, textureId} defaults from the art brief
  },
};
