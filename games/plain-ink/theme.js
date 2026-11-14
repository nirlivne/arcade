// Player-facing text, colours and images (Game Standard v2, spec §8 "theme.js slots"). Change a value
// here and reload: no code change. The in-world letters (the title set, the credit lines) are level
// geometry -- floors, hide spots, riddle pieces -- so `title` and `credits` name them everywhere else
// (page title, heading, About, the HUD set tag), not the letter shapes (S9 Q14).
export const theme = {
  title: 'Hide in Plain Ink',
  // the six set lines (spec §3.2); the HUD set tag shows the current one
  credits: ['A GAME COMPANY PICTURE', 'STARRING THE UNDERSTUDY', 'WITH THE PROOFREADERS', 'COSTUMES BY NOBODY', 'EDITED BY THE EDITOR', 'THE CUTTING ROOM'],
  names: { hero: 'The Understudy', editor: 'The Editor', watchers: 'The Proofreaders' },
  // colour overrides: any of ink, cream, lipstick, tangerine (and the -2 shades) replace the --pi-* token;
  // the canvas reads the tokens back at boot, so the DOM and the paper world swap together
  colors: {},
  // image slots: cover (share card) and icon (install icon, favicon, About)
  images: { cover: 'cover.jpg', icon: 'icon-192.png' },
  text: {
    goal: 'FIND THE NEGATIVE', // HUD goal tag (spec §6), until the Negative is taken
    goalDone: 'GOT THE NEGATIVE', // the same tag, ticked, once it is (spec beat 19)
    // settings sheet rows (spec §6/§8 comforts), keyed by the save's settings keys
    settingLabels: { music: 'MUSIC', sfx: 'EFFECTS', voice: 'VOICE', reduceMotion: 'REDUCE MOTION', longGrace: 'LONGER GRACE', leftHanded: 'LEFT-HANDED' },
    settingHints: { longGrace: 'Watchers take longer to spot you' },
    // pause sheet
    paused: 'PAUSED', resume: 'RESUME', restartFlag: 'FROM FLAG', restartLevel: 'RESTART', settings: 'SETTINGS',
    // turn your phone card (spec §5)
    turnTitle: 'TURN YOUR PHONE', turnCaption: 'The credits run sideways',
    // results strip + title best line (spec §3.6 / §6; THE-1565 Q1: no FRAMES, film frames are cut)
    results: { time: 'TIME', snips: 'SNIPS', best: 'BEST', fewest: 'FEWEST SNIPS', newBest: 'NEW BEST', grace: 'GRACE', replay: 'REPLAY', title: 'TITLE' },
    // title screen (spec §6, brief 01-title)
    kicker: 'THE GAME COMPANY PRESENTS',
    level: 'LEVEL 1 · OPENING NIGHT',
    howto: 'HOW TO PLAY',
    about: 'ABOUT',
    // touch button labels (CEO S1 look note 4: each disc carries a label)
    jump: 'JUMP',
    flip: 'FLIP',
    // first-10-s in-world tags (spec §5, THE-1637) and the key each one shows on a keyboard (none on touch)
    tags: { run: 'RUN', jump: 'JUMP', flip: 'FLIP TO MATCH + FREEZE' },
    tagKeys: { run: '→', jump: 'SPACE', flip: 'X' },
  },
  // the onboarding demo's cards (spec §8 script, English UI <= 4 words per caption)
  captions: {
    demo: { hide: 'MATCH THE INK. FREEZE.', light: 'LIGHT? WEAR CREAM.', snip: 'SEEN = SNIPPED.', goal: 'FIND THE NEGATIVE.' },
    skip: 'TAP TO SKIP',
  },
  // the 6 Hebrew narration lines (spec §3.5, ≤ 40 chars); voice files share the ids (voice/<id>.mp3)
  lines: {
    briefing: 'בוקר טוב, מחליף. תמצא לי את הנגטיב.',
    firstHide: 'שחור על שחור. אפילו אני לא רואה אותך.',
    closeCall: 'קרוב. תנשום, אבל בשקט.',
    riddleSolved: 'יפה. אפילו העורך לא היה מוצא את זה.',
    reveal: 'כן, הקול בקלטת. זה הייתי אני.',
    ending: 'רגע. איפה הוא? הוא היה פה.',
  },
};
