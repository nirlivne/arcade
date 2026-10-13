// All-In Chomp re-skin config (Game Standard v2 §2.5, spec THE-684 §8). A classic script, loaded before
// game.js's module, so a re-skin needs only this file: title, tagline, the dealer's 23 lines, the 4 ghost
// behaviour labels, the 9 hand names, the screen words (spec §5), NIGHT_EPOCH, and colour/image overrides.
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
    "קלף ראשון ביד.",
    "ריבר! היד סגורה.",
    "קלף שרוף.",
    "בלי יד הפעם. לשולחן הבא.",
    "וואו. מישהו פה מסדר קלפים?",
    "תראו מי הגיע!",
    "על חשבון הבית. עוד פעם.",
    "שיא חדש לשולחן!",
    "ריבאי על חשבון הדילר.",
    "ערב No.{N}. כולם מקבלים אותם קלפים.",
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

  // The 9 poker hands (cards.js's HAND_INFO key order); rank/payout/weight stay in cards.js (game rules,
  // not re-skin content).
  hands: {
    highCard: "קלף גבוה",
    pair: "זוג",
    twoPair: "שני זוגות",
    trips: "שלישייה",
    straight: "סטרייט",
    flush: "פלאש",
    fullHouse: "פול האוס",
    quads: "רביעייה",
    straightFlush: "סטרייט פלאש",
    royal: "רויאל פלאש",
  },

  // Screen words (spec §5): every player-facing UI string outside the dealer/cast/hand data above.
  // `{name}`/`{score}`/`{k}`/`{n}` placeholders are filled in by game.js.
  text: {
    deal: "חלק לי",
    nightlyLabel: "שולחן הערב", // word-wrapped onto the title-corner and game-over chip buttons
    nightlyNo: "No.",
    handBook: "ספר הידיים",
    howTo: "איך משחקים",
    about: "אודות",
    close: "סגור",

    pauseTitle: "הפסקה",
    pauseResume: "המשך",
    pauseSound: "צליל",
    pauseQuit: "לשולחן הראשי",

    howToBody: [
      "החליקו או לחצו על החצים כדי לנוע במבוך ולאכול צ'יפים.",
      "חברים רודפים אחריכם. חטיפה עולה צ'יפ.",
      "ALL IN בפינה הופך אתכם לרודפים: אכלו את מי שמקפל.",
      "אספו קלפים ליד הדילר לקראת תשלום על היד.",
    ],
    aboutFonts: "גופנים: Rubik Doodle Shadow, Karantina, Fredoka (SIL OFL 1.1), ראו licenses/.",
    aboutStudio: "נוצר על ידי The Game Company.", // release checklist: About names the studio
    bookEmpty: "טרם נפתח",

    hint1: "החליקו או לחצו על החצים: תאכלו את כל הצ'יפים.",
    hint1Touch: "החליקו: תאכלו את כל הצ'יפים.", // touch has no arrow buttons to tap (THE-713 D3)
    hint2: "החברים רודפים אחריכם. נתפסתם? הלך לכם צ'יפ.",
    hint3: "אול-אין בפינה: עכשיו אתם רודפים אותם. תאספו קלפים ליד.",
    hintTap: "הקישו כדי להתחיל",
    dealSkip: "הקש לדלג",

    gameOver: "נגמרו הצ'יפים",
    best: "השיא של {name}: {score}",
    rebuy: "ריבאי",
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
    // {gameOver} 😅" (variant C) or "{title} {shareNight} · {chomper} · {score} · {hand} 🃏" (variant A).
    shareNight: "ערב No.{n}",
  },

  colors: {
    // Overrides of tokens.css's --aic-* custom properties, e.g. "--aic-marigold": "#ffb000".
  },
  images: {
    cardBack: null, // drawn into the title screen's 2 decorative face-down cards instead of the built-in art
  },
};
