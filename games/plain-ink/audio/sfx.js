// Effects (THE-1561, spec §7 juice): paper foley (cut, slide, card slap, flip flick) and the brass
// stabs on spotted / checkpoint / riddle solved / the Negative / the title. onEvent() takes the
// sim's events (plus the game's own 'flip', 'land' and 'title') and returns whether anything played.
import { hz, tones, noise } from './synth.js';

export function createSfx(mixer) {
  const now = () => mixer.ctx.currentTime;
  const stab = (midis, { t = now(), dur = 0.35, gain = 0.09, bright = 2800 } = {}) =>
    tones(mixer, 'sfx', midis.map(hz), { t, dur, gain, a: 0.015, types: ['sawtooth', 'sawtooth'], detune: 9, filter: { from: bright, to: 600, q: 2 } });

  const foley = {
    // scissors: two quick blade snips
    cut: (t = now()) => noise(mixer, 'sfx', { t, dur: 0.05, gain: 0.5, type: 'highpass', from: 4500 }) && noise(mixer, 'sfx', { t: t + 0.09, dur: 0.07, gain: 0.55, type: 'highpass', from: 3800 }),
    // paper sliding over paper
    slide: (t = now(), gain = 0.25) => noise(mixer, 'sfx', { t, dur: 0.28, gain, a: 0.06, from: 2400, to: 700, q: 0.8 }),
    // a card slapped on the table
    slap: (t = now()) => noise(mixer, 'sfx', { t, dur: 0.09, gain: 0.7, type: 'lowpass', from: 1400, to: 300 }),
    // a corner flicked
    flick: (t = now()) => noise(mixer, 'sfx', { t, dur: 0.035, gain: 0.45, from: 5200, q: 3 }),
    // THE-1568 D2 5, the rest of the DESIGN §4 set:
    // step: a card tapped on the table (soft, short, low-mid)
    tap: (t = now()) => noise(mixer, 'sfx', { t, dur: 0.03, gain: 0.16, from: 900, q: 2 }),
    // jump: a "shh" of paper lifting off
    shh: (t = now()) => noise(mixer, 'sfx', { t, dur: 0.16, gain: 0.22, a: 0.03, type: 'highpass', from: 3000, to: 5500 }),
    // hidden: a palm patting the paper flat
    pat: (t = now()) => noise(mixer, 'sfx', { t, dur: 0.06, gain: 0.4, type: 'lowpass', from: 700, to: 200 }),
    // a door: a venetian blind flipped (a quick run of slat ticks)
    blind: (t = now()) => [0, 0.025, 0.05, 0.075, 0.1].every((d, i) => noise(mixer, 'sfx', { t: t + d, dur: 0.02, gain: 0.3 - i * 0.03, from: 2600 + i * 300, q: 4 })),
    // a clue: sticky tape pulled and clicked down
    tape: (t = now()) => noise(mixer, 'sfx', { t, dur: 0.12, gain: 0.18, a: 0.02, type: 'highpass', from: 2000, to: 6000 }) && noise(mixer, 'sfx', { t: t + 0.13, dur: 0.015, gain: 0.5, from: 3500, q: 6 }),
  };

  // THE-1568 D2 2: spotted / closeCall cut through the loop with timbres the loop never uses: a high
  // square+triangle "trumpet" octave and a cymbal swell, louder than the loop's saw brass
  const trumpet = (midis, t, dur, gain) => tones(mixer, 'sfx', midis.map(hz), { t, dur, gain, a: 0.008, types: ['square', 'triangle'], detune: 6, filter: { from: 6000, to: 2000, q: 1 } });
  const cymbal = (t, dur, gain) => noise(mixer, 'sfx', { t, dur, gain, a: dur * 0.25, type: 'highpass', from: 6000, to: 9000 });

  const on = {
    // both dip the loop -6 dB for 0.4 s so the stab sits ≥ +6 dB over it (measured in real time)
    spotted: () => { mixer.dip(0.4); return stab([64, 65, 70], { gain: 0.2, bright: 3500 }) && trumpet([76, 77], now(), 0.4, 0.22) && cymbal(now(), 0.4, 0.5); },
    closeCall: () => { mixer.dip(0.4); return stab([64, 70], { dur: 0.35, gain: 0.18 }) && trumpet([76], now(), 0.4, 0.26) && cymbal(now(), 0.4, 0.5); },
    // THE-1568 D2 3: an octave up (E3-Bb3-E4) and a brighter filter, so a phone speaker plays it in the hush
    snip: () => foley.cut() && stab([52, 58, 64], { dur: 0.5, gain: 0.13, bright: 2500 }),
    respawn: () => foley.slide(),
    checkpoint: () => foley.slap() && stab([64, 68, 71, 76], { t: now() + 0.05 }),
    riddleSolved: () => stab([62, 66, 69], { dur: 0.2 }) && stab([64, 68, 71, 76], { t: now() + 0.18, dur: 0.5 }),
    negative: () => stab([64, 67, 71, 74], { dur: 0.6, gain: 0.1 }) && tones(mixer, 'sfx', [hz(88), hz(91)], { t: now() + 0.15, dur: 0.8, gain: 0.06 }),
    ended: () => stab([52, 64, 68, 71, 76], { dur: 1.2, gain: 0.11 }),
    // the ending's last note (spec §3.6, THE-1568 item 6): one bongo, a beat after the 'ended' chord
    bongo: () => tones(mixer, 'sfx', [330], { t: now(), dur: 0.15, gain: 0.3, a: 0.002, bend: 0.6 }),
    // spec beat 0: brass chord, one beat of silence, one bongo
    title: () => stab([52, 64, 67, 71, 74], { dur: 0.6, gain: 0.1 }) && tones(mixer, 'sfx', [330], { t: now() + 0.9, dur: 0.15, gain: 0.3, a: 0.002, bend: 0.6 }),
    seek: () => foley.tape(), // a seek piece flipped right: the clue tape click
    rattle: () => foley.flick() && foley.flick(now() + 0.07) && foley.flick(now() + 0.14),
    closet: () => foley.slap(),
    door: () => foley.blind(), // game.js: a seek on an R2 door
    liftArrived: () => foley.blind(),
    closetExit: () => foley.blind(),
    flip: () => foley.flick(),
    land: () => noise(mixer, 'sfx', { dur: 0.09, gain: 0.35, type: 'lowpass', from: 1400, to: 300 }), // the slap at half gain
    step: () => foley.tap(),
    jump: () => foley.shh(),
    hidden: () => foley.pat(),
  };

  return {
    foley,
    onEvent(e) { const f = on[e.type]; return f ? !!f() : false; },
  };
}
