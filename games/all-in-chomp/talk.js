// Table talk (G9/G10): 1 line at a time, 2.2s on, >=6s cooldown, event-fired. Faces say only their own
// lines_he (the chomper at the deal, the catcher on a catch at 50% via the fx stream, else the dealer; a
// guest when it walks in); every other line is the dealer's 23. Priority when two are due the same step:
// caught > gameOver > allIn > hand > the rest; the lower one is dropped, not queued. Pure.
export const LINE_STEPS = 132; // 2.2s
export const COOLDOWN_STEPS = 360; // 6s, counted from when the line ends

// Lower number = higher priority. Unlisted events fall in "the rest" (lowest). "hand" covers both clear
// outcomes (a hand was made, or not) - spec's "ALL IN > hand > the rest" tier.
const PRIORITY = { caught: 0, gameOver: 1, allin: 2, hand: 3, clearNoHand: 3, clearBigHand: 3 };
function priorityOf(event) {
  return PRIORITY[event] ?? 4;
}

// Dealer line indices match the spec's numbered list 1-23 (kept 1-based so the content can be swapped via
// theme.js without renumbering code). event -> one or more dealer line numbers (fx picks among them).
export const DEALER_EVENT_LINES = {
  deal: [1],
  ready1: [1], // "deal" already covers the deal beat; readyFirstLevel kept distinct per spec row 2/3
  readyFirstLevel: [2],
  readyLevel: [3],
  allin: [4, 5],
  firstEat: [6],
  chainMax: [7],
  afterEat: [8],
  caught: [9, 10],
  lastBuyIn: [11],
  gameOver: [12],
  firstCard: [13],
  fifthCard: [14],
  cardMissed: [15],
  clearNoHand: [16],
  clearBigHand: [17],
  guestIn: [18],
  freeRedeal: [19],
  newBest: [20],
  bonusBuyIn: [21],
  nightlyStart: [22],
  modeChange: [23],
};

// Events where the face involved (the chomper, the catcher, or a guest) might speak its own line instead
// of the dealer. "caught" is 50/50 via the fx stream; "deal" and "guestIn" are always the face's own line.
const OWN_LINE_EVENTS = new Set(["deal", "caught", "guestIn"]);

export function createTalkState() {
  return { active: null, stepsLeft: 0, cooldownLeft: 0 };
}

// Called once per step. `candidates`: array of {event, who} due this step (who = a face id, or null for
// the dealer). `fxRng`: the cosmetics RNG stream (never the sim stream - a talk pick must not move it).
// `ownLineCount(who)`: how many of that face's own lines_he exist (theme data) - talk.js never sees the
// actual Hebrew text, only which face is speaking and which of their lines (by index) to show; the caller
// (game.js, which has theme/faces data) resolves `line` to real text only when `speaker !== "dealer"`.
export function updateTalk(state, candidates, fxRng, ownLineCount) {
  if (state.active) {
    state.stepsLeft -= 1;
    if (state.stepsLeft <= 0) {
      state.active = null;
      state.cooldownLeft = COOLDOWN_STEPS;
    }
    return state;
  }
  if (state.cooldownLeft > 0) {
    state.cooldownLeft -= 1;
    return state;
  }
  if (!candidates || candidates.length === 0) return state;

  let best = candidates[0];
  for (const c of candidates) if (priorityOf(c.event) < priorityOf(best.event)) best = c;

  let speaker = "dealer";
  let line;
  if (OWN_LINE_EVENTS.has(best.event) && best.who) {
    const useOwn = best.event !== "caught" || fxRng() < 0.5;
    if (useOwn) {
      speaker = best.who;
      const count = ownLineCount(best.who);
      line = count > 0 ? Math.floor(fxRng() * count) : null;
    }
  }
  if (line == null) {
    const options = DEALER_EVENT_LINES[best.event] || [];
    line = options.length > 0 ? options[Math.floor(fxRng() * options.length)] : null;
    speaker = "dealer";
  }
  if (line == null) return state;

  state.active = { event: best.event, speaker, line };
  state.stepsLeft = LINE_STEPS;
  return state;
}
