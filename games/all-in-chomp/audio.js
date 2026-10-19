// Web Audio, generated, no files, no recorded voices, no "wakka" (DESIGN.md §6). Lazily creates its
// AudioContext on the first cue (autoplay policies require a user gesture first anyway). Render only.
const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16]; // semitones above the root, chip clicks climb this scale
const CHIP_RESET_MS = 400;

export function createAudio() {
  let ctx = null;
  let muted = false;
  let chipStep = 0;
  let lastChipAt = 0;

  function ac() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  }

  function tone(freq, { duration = 0.12, type = "sine", gain = 0.2, delay = 0, slideTo = null } = {}) {
    if (muted) return;
    const c = ac();
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, c.currentTime + delay);
    if (slideTo) osc.frequency.linearRampToValueAtTime(slideTo, c.currentTime + delay + duration);
    g.gain.setValueAtTime(gain, c.currentTime + delay);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + delay + duration);
    osc.connect(g).connect(c.destination);
    osc.start(c.currentTime + delay);
    osc.stop(c.currentTime + delay + duration + 0.02);
  }

  function noiseBurst({ duration = 0.15, gain = 0.2, delay = 0, lowpass = 2000 } = {}) {
    if (muted) return;
    const c = ac();
    const bufferSize = Math.floor(c.sampleRate * duration);
    const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buffer;
    const filter = c.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = lowpass;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, c.currentTime + delay);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + delay + duration);
    src.connect(filter).connect(g).connect(c.destination);
    src.start(c.currentTime + delay);
  }

  let noiseBuf = null;
  function noiseBuffer(c) {
    if (!noiseBuf) {
      noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }
  // a filtered noise sweep (whoosh, thump tails): type = biquad type, f0 -> f1 Hz over dur s
  function noiseSweep(dur, type, f0, f1, q, gain, delay = 0) {
    if (muted) return;
    const c = ac(), t0 = c.currentTime + delay;
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = noiseBuffer(c); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0); if (f1) f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f).connect(g).connect(c.destination); s.start(t0); s.stop(t0 + dur + 0.05);
  }
  const satCurves = {};
  function satCurve(k) {
    if (satCurves[k]) return satCurves[k];
    const curve = new Float32Array(1024), n = Math.tanh(k);
    for (let i = 0; i < 1024; i++) curve[i] = Math.tanh(k * (i / 511.5 - 1)) / n;
    return (satCurves[k] = curve);
  }
  const midi = (n) => 440 * 2 ** ((n - 69) / 12);

  return {
    setMuted(on) {
      muted = on;
    },
    isMuted() {
      return muted;
    },
    // Rising pentatonic as you eat; resets after 400ms without a chip.
    chip() {
      const now = performance.now();
      if (now - lastChipAt > CHIP_RESET_MS) chipStep = 0;
      lastChipAt = now;
      const semis = PENTATONIC[Math.min(chipStep, PENTATONIC.length - 1)];
      chipStep += 1;
      tone(440 * 2 ** (semis / 12), { duration: 0.08, type: "square", gain: 0.12 });
    },
    allin() {
      noiseBurst({ duration: 0.25, gain: 0.25, lowpass: 3000 });
      tone(90, { duration: 0.3, type: "sine", gain: 0.3, delay: 0.05 });
    },
    foldEaten() {
      tone(260, { duration: 0.22, type: "sawtooth", gain: 0.15, slideTo: 160 });
      tone(200, { duration: 0.25, type: "sawtooth", gain: 0.12, delay: 0.12, slideTo: 110 });
    },
    cardGrab() {
      noiseBurst({ duration: 0.05, gain: 0.18, lowpass: 5000 });
    },
    handBeat(bigHand) {
      const root = bigHand ? 523.25 : 392;
      tone(root, { duration: 0.4, gain: 0.15 });
      tone(root * 1.25, { duration: 0.4, gain: 0.12, delay: 0.05 });
      tone(root * 1.5, { duration: 0.45, gain: 0.12, delay: 0.1 });
    },
    caught() {
      tone(180, { duration: 0.3, type: "triangle", gain: 0.2, slideTo: 80 });
    },
    // ---- the brain-rot moments (rot.js, 2026-10-19), ported from Junkies Pro ----
    // the vine boom: a deep, saturated thump that falls from 113 to 43 Hz
    vine(vol = 1) {
      if (muted) return;
      const c = ac(), t0 = c.currentTime, sh = c.createWaveShaper();
      sh.curve = satCurve(3); sh.connect(c.destination);
      for (const [f0, f1, gain, tau] of [[113, 43, 0.9, 0.42], [227, 86, 0.45, 0.2]]) {
        const o = c.createOscillator(), g = c.createGain();
        o.frequency.setValueAtTime(f0, t0); o.frequency.setTargetAtTime(f1, t0, 0.09);
        g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain * vol * 0.6, t0 + 0.004); g.gain.setTargetAtTime(0.0001, t0 + 0.004, tau);
        o.connect(g).connect(sh); o.start(t0); o.stop(t0 + 1.8);
      }
      noiseSweep(0.3, "lowpass", 400, 90, 0.7, 0.3 * vol);
    },
    // the air horn: four blasts of a detuned saw chord in A
    airhorn(vol = 1) {
      if (muted) return;
      const c = ac();
      for (const [at, len] of [[0, 0.2], [0.27, 0.12], [0.43, 0.12], [0.6, 0.7]]) {
        const t0 = c.currentTime + at, f = c.createBiquadFilter(), g = c.createGain(), sh = c.createWaveShaper();
        f.type = "bandpass"; f.frequency.value = 1400; f.Q.value = 0.6; sh.curve = satCurve(2);
        g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.12 * vol, t0 + 0.012);
        g.gain.setValueAtTime(0.12 * vol, t0 + len); g.gain.exponentialRampToValueAtTime(0.0001, t0 + len + 0.07);
        f.connect(sh).connect(g).connect(c.destination);
        for (const [hz, amp] of [[440, 1], [443.5, 0.8], [659.3, 0.6], [880, 0.35]]) {
          const o = c.createOscillator(), og = c.createGain();
          o.type = "sawtooth"; o.frequency.setValueAtTime(hz * 0.94, t0); o.frequency.setTargetAtTime(hz, t0, 0.03);
          og.gain.value = amp; o.connect(og).connect(f); o.start(t0); o.stop(t0 + len + 0.1);
        }
      }
    },
    // a record scratch: a scrubbed noise band and a buzzy saw, forward and back
    scratch(vol = 1) {
      if (muted) return;
      const c = ac(), t0 = c.currentTime, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      s.buffer = noiseBuffer(c); f.type = "bandpass"; f.Q.value = 2.5;
      const o = c.createOscillator(), og = c.createGain(); o.type = "sawtooth";
      for (const [at, ff, fo] of [[0, 300, 140], [0.09, 2800, 700], [0.2, 500, 160], [0.28, 2400, 600], [0.36, 400, 120]]) {
        const m = at ? "linearRampToValueAtTime" : "setValueAtTime";
        f.frequency[m](ff, t0 + at); o.frequency[m](fo, t0 + at);
      }
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.4 * vol, t0 + 0.02); g.gain.setValueAtTime(0.4 * vol, t0 + 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
      og.gain.setValueAtTime(0.0001, t0); og.gain.exponentialRampToValueAtTime(0.06 * vol, t0 + 0.02); og.gain.setValueAtTime(0.06 * vol, t0 + 0.3); og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
      s.connect(f).connect(g).connect(c.destination); o.connect(og).connect(f);
      s.start(t0); s.stop(t0 + 0.45); o.start(t0); o.stop(t0 + 0.45);
    },
    whoosh(up = true, vol = 1) { noiseSweep(0.32, "bandpass", up ? 350 : 4500, up ? 4500 : 350, 1.3, 0.3 * vol); },
    // an X stamped on an eye
    thunk() { tone(190, { duration: 0.14, type: "sine", gain: 0.45, slideTo: 60 }); noiseSweep(0.05, "lowpass", 1400, 300, 1, 0.25); },
    // the sad trombone: wah, wah, wah, waaaah (the last one wobbles)
    trombone(delay = 0) {
      if (muted) return;
      const c = ac();
      [[62, 0.3], [61, 0.3], [60, 0.3], [59, 1.0]].forEach(([note, len], i) => {
        const t0 = c.currentTime + delay + i * 0.34, fr = midi(note), end = t0 + len;
        const o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
        o.type = "sawtooth"; o.frequency.setValueAtTime(fr * 1.03, t0); o.frequency.setTargetAtTime(fr, t0, 0.04);
        if (i === 3) {
          const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = 5.5;
          lg.gain.setValueAtTime(0, t0); lg.gain.linearRampToValueAtTime(fr * 0.035, t0 + 0.3);
          l.connect(lg).connect(o.frequency); l.start(t0); l.stop(end + 0.1);
        }
        f.type = "lowpass"; f.Q.value = 4; f.frequency.setValueAtTime(fr * 1.5, t0); f.frequency.linearRampToValueAtTime(fr * 6, t0 + 0.1); f.frequency.linearRampToValueAtTime(fr * 2, end);
        g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.04); g.gain.setValueAtTime(0.16, end - 0.06); g.gain.exponentialRampToValueAtTime(0.0001, end + 0.05);
        o.connect(f).connect(g).connect(c.destination); o.start(t0); o.stop(end + 0.1);
      });
    },
  };
}
