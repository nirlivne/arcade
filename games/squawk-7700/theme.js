// Squawk 7700 re-skin config (Game Standard v2 §8, spec THE-729 §8). A classic script, loaded before
// game.js's module, so a re-skin needs only this file: title, tagline, every Hebrew string, the airline,
// flight label, souls count, airfield name, hero colours, per-beat sky palettes, medal names, DAY_EPOCH.
// A theme swap check (title, one line, one colour, the logo) must pass with a clean console (see
// tools/squawk-7700-tests/theme-swap-check.mjs).
window.THEME = {
  title: "Squawk 7700", // stays Latin everywhere (name check: CLEAR); the installed-app name is manifest.json
  tagline: "כולם חוזרים הביתה",

  // The daily seed's local-date epoch (launch day = No.1). theme.js is the re-skin slot; daily.js falls
  // back to this exact literal under node (no window).
  DAY_EPOCH: "2026-10-15",

  FLIGHT_LABEL: "טיסה 180",
  // A Hebrew word immediately before a number reorders under bidi even inside a dir="ltr" wrapper (the
  // number gets drawn into the RTL run); the mockups' Latin-only label sidesteps it (sign-off r1 D2-2).
  FLIGHT_LABEL_LATIN: "FLIGHT 180",
  SOULS: 180,
  AIRLINE: "Dunelark Air",
  AIRFIELD: "שדה דיונה", // Dune Field, runway 27 (fictional)

  // Recipe THE-734 §5: teal-ink Captain, coral-hoodie Passenger, sage-cardigan Off-duty Pilot.
  heroColors: {
    captain: "#173B45",
    passenger: "#E8566E",
    pilot: "#7FA38A",
  },

  // [zenith, mid, horizon, sun, fog] per world.js's skyDome/paint helpers (recipe THE-734 §2).
  skyPalettes: {
    cruise: ["#17143A", "#4B3478", "#C66A86", "#FFD9A8", "#6A4A86"], // title, door, aisle windows (FL340 dusk)
    dive: ["#2A1F5C", "#7E4C8C", "#F2A272", "#FFE1B0", "#9C6A8E"],
    escort: ["#3A3678", "#B0688E", "#F7B878", "#FFF0C8", "#D88E86"],
    land: ["#231D4C", "#7A4A7A", "#FF9A5C", "#FFE6B8", "#B86A6A"],
    dawn: ["#3B4C8A", "#9A86B8", "#FFD2A1", "#FFF4DC", "#D9A894"], // the ending, tarmac at dawn
    aisle: ["#17143A", "#4B3478", "#C66A86", "#FFD9A8", "#6A4A86"],
  },

  medals: { bronze: "ארד", silver: "כסף", gold: "זהב" },

  beatNames: {
    door: "הדלת",
    aisle: "המעבר",
    dive: "הצלילה", // the mockups' and the correct aviation word (sign-off r1 D3, THE-756)
    landing: "הנחיתה",
  },
  // Locative form, for "נפסל ב..." / share variant C.
  beatNamesLocative: {
    door: "בדלת",
    aisle: "במעבר",
    dive: "בצלילה",
    landing: "בנחיתה",
  },

  text: {
    play: "המריאו",
    beatSelect: "תחנות",
    howTo: "איך משחקים",
    about: "אודות",
    settings: "הגדרות",
    heroCaptain: "הקברניט",
    heroPassenger: "הנוסע",
    heroPilot: "הטייס שבחופשה",
    close: "סגור",
    resume: "המשך",
    quitToMenu: "לתפריט",
    restartBeat: "חזרה לתחילת השלב",

    // Cut card: "{label} · {hh}:{mm}" stays Latin/aviation format (game.js fills it from FLIGHT_LABEL
    // and a fixed in-fiction clock); a retry shows attemptLabel.
    attemptLabel: "ניסיון {n}/3",

    // Door prompts, in sequence. Each is a big word plus a small hint (sign-off r1 D2-4, THE-756): the
    // hint carries the rest of the instruction so the big word alone can read at a glance.
    doorPrompt1: "הקישו 7700",
    doorPrompt1Hint: "קוד מצוקה למגדל · אחר כך שדרו והחזיקו את הדלת",
    doorPrompt2: "שדרו",
    doorPrompt2Hint: "דווחו למגדל שאתם זקוקים לעזרה",
    doorPrompt3: "החזיקו את הדלת",
    doorPrompt3Hint: "כפיים ישרות = נעילה מהירה פי 2",
    aislePrompt: "גררו ימינה ושמאלה",
    aislePromptHint: "עגלה עוצרת אתכם · למעלה = ריצה",
    divePrompt: "משכו!",
    divePromptHint: "החזיקו עד שהמחוג יוצא מהאדום",
    escortPrompt: "כנפיים ישרות",
    escortPromptHint: "אין הגה כיוון · הטו נגד הסחיפה",
    approachPrompt1: "על קו המסלול",
    approachPrompt1Hint: "שמרו על כנפיים ישרות",
    approachPrompt2: "גלגלים!",
    approachPrompt2Hint: "הנמיכו לפני 500 רגל",
    approachPrompt3: "יישור!",
    approachPrompt3Hint: "הגלגלים בחוץ · על קו המסלול",

    contextSquawk: "שדר",
    contextDoor: "דלת",
    contextGear: "גלגלים",
    contextFlare: "יישור",

    failReason: {
      overspeed: "מהירות יתר",
      bank: "הטיה חדה מדי",
      floor: "גובה נמוך מדי",
      timeout: "לא הספקתם",
      trolley: "עגלה!",
      "off-structure": "יצאתם מהמבנה",
      "no-gear": "בלי גלגלים",
      "hard-landing": "נחיתה קשה",
      "off-runway": "יצאתם מהמסלול",
    },

    runOverTitle: "לא הפעם. נסו שוב.",
    runOverReached: "הגעתם עד {beat}",
    resultsLine: "כולם בבית.",
    endingContinue: "הקישו כדי להמשיך", // D3 (sign-off r2, THE-767): the ending cut is skippable by a tap/press
    resultsSoulsSub: "נוסעים וצוות על הקרקע",
    dailyLabel: "No.{n}",
    dailyWeather: "WX {wx} · TURB {turb}", // restored on the title (sign-off r1 D2-1, THE-756)

    share: "שתפו",
    again: "טיסה נוספת",
    toTitle: "לתפריט",

    // share.js's three variants (pure, takes theme as a param - launch kit THE-730, link on its own line).
    shareA: "{title} · No.{n} · {time} · {bumps} טלטלות ✈️",
    shareB: "{title} · No.{n} · {time} · זהב בכל התחנות 🥇✈️",
    shareC: "{title} · No.{n} · נפסל {beat} · מנסה שוב ✈️",

    // No repeated beat-name prefix (sign-off r1 D2-10, THE-756): the caption already carries the
    // beatLabel in its own <b>. The door line also no longer claims the door opens -- the bar locks it.
    howToBody: [
      "הקישו 7700, שדרו, והחזיקו את הדלת נעולה.",
      "גררו ימינה ושמאלה במעבר כדי להתחמק מעגלות.",
      "משכו והחזיקו את הידית עד שהמטוס מתאזן.",
      "שמרו על כנפיים ישרות, הנמיכו גלגלים, ויישרו לנחיתה.",
    ],
    aboutCredit: "נוצר על ידי The Game Company.",
    aboutInspired: "Inspired by the crew and passengers of a real flight on 30 Sep 2026, who all came home.",
    aboutFonts: "גופנים: Secular One, IBM Plex Mono, IBM Plex Sans Hebrew (SIL OFL 1.1).",
    aboutThree: "three.js r170 (MIT).",

    settingsSound: "צליל",
    settingsMotion: "תנועה מופחתת",
    settingsHaptics: "רטט",

    portraitRotate: "סובבו את הטלפון 🔄",

    beatLocked: "נעול",
    beatPractice: "תרגול",
  },

  colors: {
    // Overrides of tokens.css's custom properties, filled in S7 with the designer's skin.
  },
  images: {
    // The title screen's lark badge (menu.js, next to the name): a path rendered as an <img>, never an
    // SVG string from theme data. null keeps the drawn default lark mark (THE-761: this slot used to
    // have no consumer at all). The 3D tail decal (scene/airliner.js's larkMark()) is a separate, fixed
    // livery detail baked into the model -- it is not this theme slot and does not re-skin.
    larkLogo: null,
  },
};
