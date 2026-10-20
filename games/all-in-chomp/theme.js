// All-In Chomp re-skin config (Game Standard v2 §2.5, spec THE-684 §8). A classic script, loaded before
// game.js's module, so a re-skin needs only this file: title, tagline, the dealer's 23 lines, the 4 ghost
// behaviour labels, the screen words (spec §5), NIGHT_EPOCH, the table look per level, and colour/image
// overrides.
// The cast (names, portraits, own lines, landmarks) is already themeable on its own in faces.json - not
// duplicated here.
window.THEME = {
  title: "אול-אין!", // the title screen's name; the installed-app name stays in manifest.json
  tagline: "ערב פוקר עם הג׳אנקיס",

  // N = days since NIGHT_EPOCH + 1 (local date, deal.js). Tooling that imports deal.js under node (no
  // window) keeps this exact default, so a re-skin only changes the number shown in-game.
  NIGHT_EPOCH: "2026-10-13",

  // The dealer's 23 lines (spec §3), 1-indexed (index 0 unused) to match talk.js's DEALER_EVENT_LINES.
  dealerLines: [
    null,
    "הדילר מחלק. מי בפנים?",
    "השולחן פתוח. תאכל צ'יפים.",
    "שולחן חדש, אותם פרצופים.",
    "אול-אין! עכשיו אתה הרודף.",
    "הם מקפלים. תתקוף!",
    "פולד! אחד בחוץ.",
    "ניקית את כל השולחן!",
    "הוא יחזור. הם תמיד חוזרים.",
    "סורי. ככה זה בפוקר.",
    "נתפסת. קורה גם לטובים.",
    "צ'יפ אחרון. תשחק חכם.",
    "נגמרו הצ'יפים. עוד יד?",
    "ג'וקר על השולחן!",
    "ג'וקר ביד. שמור אותו.",
    "הג'וקר הציל אותך!",
    "השולחן נקי! לשולחן הבא.",
    "עוד שולחן. יותר מהר.",
    "תראו מי הגיע!",
    "על חשבון הבית. עוד פעם.",
    "שיא חדש לשולחן!",
    "עוד צ'יפ על חשבון הבית!",
    "ערב No.{N}. אותו שולחן לכולם.",
    "בלאף! הם מסתובבים.",
  ],

  // The 4 ghost behaviours' Hebrew labels. Their colours are tokens.css's --aic-b-direct/-ambush/-flank/
  // -shy custom properties - override them via `colors` below, same as every other table colour.
  behaviours: {
    direct: "הלוחץ",
    ambusher: "הקורא",
    flanker: "העוקף",
    shy: "הזהיר",
  },

  // Screen words (spec §5): every player-facing UI string outside the dealer/cast data above.
  // `{name}`/`{score}`/`{k}`/`{n}` placeholders are filled in by game.js.
  text: {
    deal: "חלק לי",
    nightlyLabel: "שולחן הערב", // word-wrapped onto the title-corner and game-over chip buttons
    nightlyNo: "No.",
    bests: "שיאים", // the title's bests sheet (board 2026-10-17, in place of the hand book)
    bestsEmpty: "טרם שיחק",
    howTo: "איך משחקים",
    about: "אודות",
    close: "סגור",

    pauseTitle: "הפסקה",
    pauseResume: "המשך",
    pauseSound: "צליל",
    pauseQuit: "לשולחן הראשי",

    howToBody: [
      "הניחו אצבע על השולחן: ג'ויסטיק מופיע מתחתיה. דחפו לכיוון (או חצים במקלדת) כדי לנוע ולאכול צ'יפים.",
      "חברים רודפים אחריכם. חטיפה עולה צ'יפ.",
      "ALL IN בפינה הופך אתכם לרודפים: אכלו את מי שמקפל.",
      "ג'וקר על השולחן: קחו אותו, והוא מציל אתכם פעם אחת.",
    ],
    aboutFonts: "גופנים: Rubik Doodle Shadow, Karantina, Fredoka (SIL OFL 1.1), ראו licenses/.",
    aboutLibs: "גרפיקה: three.js (MIT) ו-postprocessing (Zlib), ראו licenses/.", // the fx layer (2026-10-19)
    aboutStudio: "נוצר על ידי The Game Company.", // release checklist: About names the studio
    aboutVersion: "גרסה", // + the build's cache hash, to check a phone runs the latest (2026-10-20)
    aboutVersionDev: "פיתוח", // no service worker cache: a local run

    hint1: "החצים במקלדת (או ג'ויסטיק בעכבר): תאכלו את כל הצ'יפים.",
    hint1Touch: "הג'ויסטיק: הניחו אצבע ודחפו לכיוון. תאכלו את כל הצ'יפים.", // the floating stick (2026-10-17)
    hint2: "החברים רודפים אחריכם. נתפסתם? הלך לכם צ'יפ.",
    hint3: "אול-אין בפינה: עכשיו אתם רודפים אותם. ג'וקר מציל פעם אחת.",
    hintTap: "הקישו כדי להתחיל",
    dealSkip: "הקש לדלג",

    gameOver: "נגמרו הצ'יפים",
    best: "השיא של {name}: {score}",
    rebuy: "עוד משחק", // was "ריבאי": poker slang the players don't know (board, 2026-10-17)
    backInGame: "{name} חזר למשחק!", // the dealer's shout over the door when a seated chaser's rebuy wait ends
    jokerShout: "ג'וקר!", // over the chomper when the held joker is spent on a catch
    jokerHeld: "ג'וקר ביד", // under the HUD joker card while one is held (2026-10-19)
    jokerGot: "יש לך ג'וקר!", // over the chomper when a joker is taken (felt or sweep)
    rotSweep: "טרפת את כולם!!", // the clean-sweep moment (2026-10-19)
    rotSweepPoints: "+3,000",
    rotSweepJoker: "+3,000 · ג'וקר!",
    rotSweepBonus: "+3,000 · +1,000",
    rotJoker: "ג'וקר!", // the joker-save moment
    rotJokerMissed: "{name} פספס!",
    rotBust: "{name} בטילט!", // the game-over moment
    reachedLevel: "הגעת לסיבוב {n}", // game over, under the score
    clearShout: "השולחן נקי!", // the level-clear show
    clearNext: "שולחן חדש · החברים מהירים יותר",
    chasersLabel: "רודפים אחריך", // the deal screen, over the four chaser cards
    share: "שתף",
    playedCount: "{k}/{n} כבר שיחקו",

    round: "סיבוב {n}",
    dealHeaderNightly: "ערב No.{n} · אותו שולחן לכולם",
    dealHeaderNormal: "הדילר מחלק…",
    youAre: "הפעם אתה: ",
    dealerName: "הדילר",
    potLabel: "קופה",
    pauseAria: "השהה",
    soundAria: "צליל",

    portraitRotate: "סובבו את הטלפון 🔄",
    portraitWaiting: "המשחק מחכה",

    // share.js (pure - takes `theme` as a parameter, never reads window itself): "{title} {shareNight} ·
    // {gameOver} 😅" (no score) or "{title} {shareNight} · {chomper} · {score} · {round} 🃏".
    shareNight: "ערב No.{n}",
  },

  colors: {
    // Overrides of tokens.css's --aic-* custom properties, e.g. "--aic-marigold": "#ffb000".
  },
  // The table's look per level (board 2026-10-17): index (level - 1) % length. Odd levels are the felt
  // (maze A, the baize tokens), even levels the kitchen table (maze B, the wood tokens); an empty entry keeps
  // tokens.css. Six looks, so the cycle repeats from level 7 with the same parity.
  levelLooks: [
    {}, // L1 green felt (tokens)
    {}, // L2 walnut kitchen (tokens)
    { baize: "#2A5B8F", "baize-hi": "#3A74AD", "baize-lo": "#183A5E" }, // L3 blue felt
    { wood: "#B08B5A", "wood-hi": "#C9A370", "wood-lo": "#7A5E3A" }, // L4 pale pine
    { baize: "#7A2A3A", "baize-hi": "#96394B", "baize-lo": "#4E1A26" }, // L5 burgundy felt
    { wood: "#5C3B22", "wood-hi": "#74502F", "wood-lo": "#3A2314" }, // L6 dark oak
  ],
  images: {
    cardBack: null, // drawn into the title screen's 2 decorative face-down cards instead of the built-in art
  },
};
