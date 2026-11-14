// The first-run demo = How to play (spec §8 onboarding script, THE-1565 Q10): a paper puppet stage,
// 4 cards x 1.5 s on the 120 Hz tick; a tap or any key skips after 1 s. Captions come from
// theme.captions.demo[id]. Pure.
export const DEMO_CARDS = [{ id: 'hide' }, { id: 'light' }, { id: 'snip' }, { id: 'goal' }];
export const CARD_TICKS = 180;
const SKIP_AFTER = 120;

export const demoCard = (t) => Math.min(DEMO_CARDS.length - 1, Math.floor(t / CARD_TICKS));
export const demoDone = (t) => t >= DEMO_CARDS.length * CARD_TICKS;
export const canSkipDemo = (t) => t >= SKIP_AFTER;
