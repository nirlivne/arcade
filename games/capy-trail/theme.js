// games/capy-trail/theme.js -- edit this file to re-skin the game; no other file changes (html5-game-standards
// Sec2.5). A classic script (games run from file:// too), loaded before ui-kit.js and the game's own scripts.
window.THEME = {
  // THE-1373 (board feedback #4): which hero and chaser render/hero.js builds, and which GLBs it fetches
  // -- "bear" + bees, or "capy" + geese, never both. "bear" is the board's default (2026-11-07 14:40Z); flip
  // to "capy" to bring back the capybara name and copy below, a one-line change. A `?hero=` URL param can
  // override this for local testing (render/hero.js's resolveHeroKind()) without editing this file.
  hero: "bear",
  // ---------------------------------------------------------------- shared (hero-agnostic) strings
  studioName: "The Game Company",
  studioStrap: "small games, made with care",
  dedication: "",
  rotateText: "Turn me sideways",
  text: {
    // THE-1412 (levels/README.md): Levels (new, primary) opens the map; Endless (was "play") is the
    // restyled second button -- the tap/Space/any-key shortcut still starts Endless, unchanged.
    levels: "Levels",
    endless: "Endless",
    howTo: "How to play",
    again: "Again",
    home: "Home",
    share: "Share",
    about: "About",
    paused: "Paused",
    resume: "Resume",
    toppers: "Toppers",
    newBest: "new best",
    // A13.2 (THE-1318 review): the title hint line under the buttons. THE-1407: {best} is the best score
    // now (toLocaleString-formatted), not the best distance. THE-1412: "endless" names which best this is,
    // now that Levels sits right next to it (levels/README.md).
    titleHint: "endless best {best}",
    titleHintNoBest: "Tap, swipe or press any key to start",
    // THE-1408: the shared missions card.
    missions: "Missions",
    missionsReward: "Do all 3:",
    missionsDone: "All 3 done!",
    missionsScoreNow: "Score now",
    // THE-1412: level results/map button copy (levels/README.md).
    nextLevel: "Next level",
    tryAgain: "Try again",
    trailMap: "Trail map",
  },
  // spec §2 cause lines shared by every hero (no animal name in these); "corner" and "caught" name the
  // hero/chaser and live in heroes.<kind>.causeLines below instead. Lagoon/desert are placeholders until
  // S4/S5 ship those biomes.
  causeLines: {
    obstacle: "That log had other plans.",
    forest: "The forest got you.",
    lagoon: "The lagoon got you.",
    desert: "The desert got you.",
  },
  // spec §5 opening-script hints: the persistent JUMP/DUCK touch-button labels (always-on while running,
  // index.html's data-theme-text="hints.jump"/"hints.duck"). Not the in-run coaching toast any more --
  // see inRunLabels below (THE-1372, board 2026-11-07: "I can't read the green toast").
  hints: {
    jump: "JUMP",
    duck: "DUCK",
  },
  // THE-1372: short (1-3 word) in-run coaching lines, shown in a label anchored to the hero's head
  // (ui/in-run-label.js) instead of the UIKit menu toast. Hero-agnostic -- none of these name the chaser,
  // so no per-hero variant is needed.
  inRunLabels: {
    jump: "Jump!",
    duck: "Duck!",
    turnLeft: "← Left!",
    turnRight: "→ Right!",
    // A12.13 C3 (THE-1301) rewritten short (THE-1372): the full sentence named the geese by species; this
    // doesn't name the chaser at all, so both heroes share it. CTO review (THE-1374): "Careful: 1 hit left"
    // was 4 words (board: 1-3) and not quite true (a stumble still doesn't end the run, only a bonk does).
    graceOver: "Careful now!",
    // THE-1391: the Picnic Shield absorbing a hit (never shown on its plain 20 s timeout).
    shieldSaved: "Saved!",
    missionDone: "Mission ✓", // THE-1408: mid-run, queued behind any coaching label
  },
  // THE-1408 (missions.md): the 33-mission pool's texts; {chaser} fills from heroes.<kind>.chaser below.
  missions: {
    "t1-jump-15": "Jump 15 times",
    "t1-duck-10": "Duck 10 times",
    "t1-lane-20": "Change lanes 20 times",
    "t1-turn-5": "Take 5 turns",
    "t1-coins-150": "Collect 150 coins",
    "t1-coinrun-60": "Get 60 coins in a run",
    "t1-reach-300": "Reach 300 m",
    "t1-honey-1": "Grab a Honey Jar",
    "t2-jump-40": "Jump 40 times",
    "t2-hop-15": "Jump over 15 logs",
    "t2-under-10": "Duck under 10 things",
    "t2-close-3": "3 close calls in a run",
    "t2-coinrun-120": "Get 120 coins in a run",
    "t2-reach-600": "Reach 600 m",
    "t2-powerups-3": "Grab 3 power-ups",
    "t2-shield-1": "Grab a Picnic Shield",
    "t3-nohit-500": "No hits for 500 m",
    "t3-reach-1000": "Reach 1 km",
    "t3-coinrun-250": "Get 250 coins in a run",
    "t3-turnrun-10": "Take 10 turns in a run",
    "t3-balloon-2": "Use 2 balloons",
    "t3-spring-2": "Use Spring Paws twice",
    "t3-saved-1": "Let a shield save you",
    "t3-escape-3": "Shake off the {chaser} 3×",
    "t3-powerups-6": "Grab 6 power-ups",
    "t4-nohit-1500": "No hits for 1.5 km",
    "t4-reach-2000": "Reach 2 km",
    "t4-coins-2000": "Get 2,000 coins",
    "t4-hoprun-12": "Hop 12 logs in a run",
    "t4-close-8": "8 close calls in a run",
    "t4-under-25": "Duck under 25 things",
    "t4-mystery-3": "Open 3 Mystery Boxes",
    "t4-sky-30": "Get 30 coins in the sky",
  },
  // spec §3: the orange is owned and equipped from the start; the other 3 toppers arrive with S6.
  toppers: {
    orange: { name: "Orange", price: 0 },
    lilypad: { name: "Lily pad", price: 150 },
    duck: { name: "Rubber duck", price: 400 },
    crown: { name: "Flower crown", price: 900 },
  },
  colors: {},
  images: {},
  // ---------------------------------------------------------------- per-hero copy (THE-1372)
  // Everything that shows a name or mentions the chaser reads the active set here, merged over the shared
  // keys above by theme-active.js's resolveActiveTheme(). Board ruling (2026-11-07 11:35Z): keep every
  // existing capy/goose line in heroes.capy unchanged; the bear/bee lines are new.
  heroes: {
    bear: {
      name: "Bear Trail",
      tagline: "A chill bear, a winding trail and a very rude swarm of bees.",
      aboutText: "A bear gallops a winding trail, collecting coins and dodging whatever the forest throws at it.",
      shareText: "I got {distance} m on Bear Trail!",
      // licenses/bear-model.txt: "CC BY 4.0 attribution; copy this line into About exactly" (short form).
      aboutCredit: "Bear by Polyfork (CC BY 4.0, polyfork.dev/asset/bear-base).",
      chaser: "bees", // THE-1408: fills missions.md's {chaser}
      text: { chaserNear: "The bees are close" },
      causeLines: {
        corner: "The trail turned. The bear did not.",
        caught: "The bees got you.",
      },
      deadpanLines: [
        "The bear has seen worse.",
        "It was humming the whole time.",
        "Unbothered, as a policy.",
        "The fur stayed clean. Mostly.",
        "A dignified tumble.",
        "Ten out of ten, would nap again.",
        "The trail won this round.",
        "Bears do not rush.",
      ],
    },
    capy: {
      name: "Capy Trail",
      tagline: "A chill capybara, a winding trail and three very rude geese.",
      aboutText: "A capybara gallops a winding trail, collecting coins and dodging whatever the forest throws at it.",
      shareText: "I got {distance} m on Capy Trail!",
      aboutCredit: "",
      chaser: "geese", // THE-1408: fills missions.md's {chaser}
      text: { chaserNear: "The geese are close" },
      causeLines: {
        corner: "The trail turned. The capy did not.",
        caught: "The geese got you.", // A12.4 (THE-1301)
      },
      // At least 8 (spec §8); shown one at a time on the results card.
      deadpanLines: [
        "The capy has seen worse.",
        "It was chewing the whole time.",
        "Unbothered, as a policy.",
        "The orange stayed on. Mostly.",
        "A dignified tumble.",
        "Ten out of ten, would nap again.",
        "The trail won this round.",
        "Capybaras do not rush.",
      ],
    },
  },
};
