// Small synth helpers shared by music.js and sfx.js (THE-1561, G12: synth only, no samples).
// Each helper is one mixer voice: its nodes are disconnected when its sources end.

export const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

const noiseBuffers = new WeakMap();
function noiseBuffer(ctx) {
  let b = noiseBuffers.get(ctx);
  if (!b) {
    const len = Math.round(ctx.sampleRate * 1);
    b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    let seed = 1234567; // fixed noise, so every take sounds the same
    for (let i = 0; i < len; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; d[i] = seed / 0x3fffffff - 1; }
    noiseBuffers.set(ctx, b);
  }
  return b;
}

// A spring-reverb impulse (THE-1568 D2 4), generated, no samples: decaying noise with a metallic
// ~33 ms "drip" echo and a darker tail, 1.2 s. Fixed seed, so every take sounds the same.
export function springImpulse(ctx, seconds = 1.2) {
  const len = Math.round(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(2, len, ctx.sampleRate);
  const drip = Math.round(ctx.sampleRate * 0.033);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let seed = 7654321 + ch * 99, lp = 0;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      lp += 0.35 * ((seed / 0x3fffffff - 1) - lp); // a one-pole lowpass: the spring's dark tail
      const k = i / ctx.sampleRate;
      d[i] = lp * Math.exp(-k / 0.32) * (i % drip < drip * 0.15 ? 1.8 : 1);
    }
  }
  return b;
}

// attack-decay envelope on a gain param: up to `peak` in `a` s, down to silence by t + dur
function env(param, t, peak, a, dur) {
  param.setValueAtTime(0.0001, t);
  param.linearRampToValueAtTime(peak, t + a);
  param.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, a + 0.01));
}

// Oscillator stack: freqs (Hz) x types, through an optional filter sweep, one shared envelope.
// opts: { t, dur, gain, a, types, detune, filter: { type, from, to, q }, bend: ratio at the end,
//         send: a node (e.g. a reverb input) that also gets the voice's output }
export function tones(mixer, bus, freqs, opts) {
  const { ctx } = mixer;
  const { t = ctx.currentTime, dur = 0.3, gain = 0.2, a = 0.01, types = ['sine'], detune = 0, filter, bend, send } = opts;
  return mixer.voice(bus, (out, make) => {
    const amp = make(ctx.createGain());
    env(amp.gain, t, gain, a, dur);
    let head = amp;
    if (filter) {
      const f = make(ctx.createBiquadFilter());
      f.type = filter.type || 'lowpass';
      f.Q.value = filter.q ?? 1;
      f.frequency.setValueAtTime(filter.from, t);
      f.frequency.exponentialRampToValueAtTime(filter.to ?? filter.from, t + dur);
      f.connect(amp);
      head = f;
    }
    amp.connect(out);
    if (send) amp.connect(send);
    const srcs = [];
    for (const fq of freqs) {
      types.forEach((type, i) => {
        const o = make(ctx.createOscillator());
        o.type = type;
        o.frequency.setValueAtTime(fq, t);
        if (bend) o.frequency.exponentialRampToValueAtTime(fq * bend, t + dur);
        o.detune.value = i % 2 ? detune : -detune;
        o.connect(head);
        o.start(t);
        o.stop(t + dur + 0.02);
        srcs.push(o);
      });
    }
    return srcs;
  });
}

// Filtered noise burst (paper foley, bongo slap): opts { t, dur, gain, a, type, from, to, q }
export function noise(mixer, bus, opts) {
  const { ctx } = mixer;
  const { t = ctx.currentTime, dur = 0.1, gain = 0.3, a = 0.003, type = 'bandpass', from = 2000, to, q = 1 } = opts;
  return mixer.voice(bus, (out, make) => {
    const src = make(ctx.createBufferSource());
    src.buffer = noiseBuffer(ctx);
    const f = make(ctx.createBiquadFilter());
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to ?? from, t + dur);
    const amp = make(ctx.createGain());
    env(amp.gain, t, gain, a, dur);
    src.connect(f); f.connect(amp); amp.connect(out);
    src.start(t, (t * 7.31) % 0.5); // a different slice of the noise each time
    src.stop(t + dur + 0.02);
    return [src];
  });
}
