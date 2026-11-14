// The 60s big-band loop (THE-1561, spec §7, G12): original motifs only, synth only. Swing at
// 132 bpm in E minor; an 8-bar loop where the lead rotates between brass stabs (bars 1-4) and a
// twangy guitar line (bars 5-8) over a walking bass, bongos and a vibes pad. "Tense" (after a
// spot or close call) doubles the bongos. barEvents() is the pure score; createMusic() plays it
// with a short look-ahead from the game's frame loop (no timers of its own).
import { hz, tones, noise, springImpulse } from './synth.js';

export const BPM = 132;
export const BARS = 8;
export const SWING = 2 / 3; // the swung off-beat, as a fraction of the beat
const S = SWING;

// walking bass, one note a beat (E2 = 40)
const BASS = [
  [40, 43, 45, 46], [47, 45, 43, 42], [40, 43, 45, 47], [50, 47, 45, 46],
  [45, 47, 50, 52], [50, 47, 45, 43], [40, 42, 43, 46], [47, 46, 45, 42],
];
// brass stab rhythms for bars 1-4 (beats), each on an Em7 voicing
const BRASS_HITS = [[0, 1 + S], [S, 2], [0, 1 + S, 3], [2 + S]];
const BRASS_CHORD = [64, 67, 71, 74];
// the guitar line for bars 5-8: [beat, midi]
const GUITAR = [
  [[0, 59], [S, 62], [1, 64], [2 + S, 62]],
  [[0, 58], [1, 57], [1 + S, 55], [3, 52]],
  [[0, 64], [S, 62], [1 + S, 59], [2, 58], [3, 57]],
  [[0, 55], [1, 54], [2, 52], [3 + S, 59]],
];
const VIBES = [[64, 67, 71], [62, 66, 69]];
const BONGO_CALM = [[1 + S, 'hi'], [3 + S, 'lo']];
const BONGO_TENSE = [[S, 'hi'], [2 + S, 'lo']];

export function barEvents(bar, tense) {
  const b = ((bar % BARS) + BARS) % BARS;
  const ev = [];
  BASS[b].forEach((midi, beat) => ev.push({ inst: 'bass', beat, midi, dur: 0.9 }));
  if (b < 4) for (const beat of BRASS_HITS[b]) ev.push({ inst: 'brass', beat, midi: BRASS_CHORD, dur: b === 3 ? 1.2 : 0.35 });
  else for (const [beat, midi] of GUITAR[b - 4]) ev.push({ inst: 'guitar', beat, midi, dur: 0.6 });
  ev.push({ inst: 'vibes', beat: 0, midi: VIBES[b % 2], dur: 3.5 });
  for (const [beat, drum] of tense ? [...BONGO_CALM, ...BONGO_TENSE] : BONGO_CALM) ev.push({ inst: 'bongo', beat, drum, dur: 0.15 });
  return ev;
}

const BEAT_S = 60 / BPM;
const LOOKAHEAD_S = 0.3;
const SYNC_TOL_S = 0.03; // ruling 4: re-sync when the music drifts more than 30 ms from the sim beat

// one note of the score, at absolute time t (s). spring: the guitar's reverb send (THE-1568 D2 4)
function play(mixer, e, t, spring) {
  const dur = e.dur * BEAT_S;
  switch (e.inst) {
    case 'bass': return tones(mixer, 'music', [hz(e.midi)], { t, dur, gain: 0.32, a: 0.01, types: ['triangle'], filter: { from: 700, to: 300 } });
    case 'brass': return tones(mixer, 'music', e.midi.map(hz), { t, dur, gain: 0.07, a: 0.03, types: ['sawtooth', 'sawtooth'], detune: 7, filter: { from: 2600, to: 700, q: 2 } });
    case 'guitar': return tones(mixer, 'music', [hz(e.midi)], { t, dur, gain: 0.12, a: 0.004, types: ['sawtooth', 'square'], detune: 4, bend: 0.985, filter: { from: 3200, to: 500, q: 6 }, send: spring });
    case 'vibes': return tones(mixer, 'music', e.midi.map(hz), { t, dur, gain: 0.05, a: 0.005, types: ['sine'] });
    case 'bongo': {
      const f = e.drum === 'hi' ? 330 : 220;
      noise(mixer, 'music', { t, dur: 0.03, gain: 0.08, from: 3000 });
      return tones(mixer, 'music', [f], { t, dur: e.dur, gain: 0.3, a: 0.002, bend: 0.6 });
    }
  }
  return false;
}

// DESIGN §4 "twanged guitar through spring reverb": a generated 1.2 s spring on the guitar alone,
// ~22 % wet, into the music bus (so the music toggle, duck and hush cover it too)
const SPRING_WET = 0.22;

export function createMusic(mixer) {
  const { ctx } = mixer;
  const spring = ctx.createConvolver();
  spring.buffer = springImpulse(ctx);
  const wet = ctx.createGain();
  wet.gain.value = SPRING_WET;
  spring.connect(wet);
  wet.connect(mixer.buses.music);
  let on = false, bar = 0, barAt = 0, tense = false;
  return {
    spring,
    start() { if (on) return; on = true; bar = 0; barAt = ctx.currentTime + 0.05; },
    stop() { on = false; },
    playing: () => on,
    setTense(t) { tense = t; },
    // CTO ruling 4: the music follows the sim's beat clock (never the other way round). beat = the sim's float
    // beat now. Re-anchors the bar clock on the next whole bar when forced (play, resume, respawn) or when the
    // music has drifted more than 30 ms from the sim.
    sync(beat, force = false) {
      if (!on || ctx.state !== 'running') return false;
      const now = ctx.currentTime;
      const musicBeat = bar * 4 - (barAt - now) / BEAT_S;
      if (!force && Math.abs(musicBeat - beat) * BEAT_S <= SYNC_TOL_S) return false;
      const next = Math.floor(beat / 4) + 1;
      bar = next;
      barAt = now + (next * 4 - beat) * BEAT_S;
      return true;
    },
    // the beat the music is on now (tests: |music - sim| <= 30 ms)
    beatNow: () => bar * 4 - (barAt - ctx.currentTime) / BEAT_S,
    // call once a frame: schedules every bar that starts within the look-ahead window
    update() {
      if (!on || ctx.state !== 'running') return;
      // after a long stall (the tab was frozen), restart the bar clock instead of catching up
      if (barAt < ctx.currentTime - 1) barAt = ctx.currentTime + 0.05;
      while (barAt < ctx.currentTime + LOOKAHEAD_S) {
        for (const e of barEvents(bar, tense)) play(mixer, e, barAt + e.beat * BEAT_S, spring);
        bar += 1;
        barAt += 4 * BEAT_S;
      }
    },
  };
}
