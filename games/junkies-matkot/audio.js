// WebAudio synth only, no music, no files (spec §7). "tok" on every hit (band-pass noise + a 420 Hz
// sine, +1 semitone every 3 rally hits), a whistle on a point. Lazily creates the AudioContext on the
// first sound (autoplay policies), and every call is a no-op while muted.
export function createAudio() {
  let ctx = null;
  let muted = false;
  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function noiseBuffer(c, seconds) {
    const n = Math.max(1, Math.round(c.sampleRate * seconds));
    const buf = c.createBuffer(1, n, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function tok(rally = 0) {
    if (muted) return;
    const c = getCtx();
    const now = c.currentTime;
    const semitones = Math.floor(Math.max(0, rally - 1) / 3);
    const freq = 420 * Math.pow(2, semitones / 12);

    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    const oscGain = c.createGain();
    oscGain.gain.setValueAtTime(0.18, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc.connect(oscGain).connect(c.destination);
    osc.start(now);
    osc.stop(now + 0.09);

    const noise = c.createBufferSource();
    noise.buffer = noiseBuffer(c, 0.06);
    const bandpass = c.createBiquadFilter();
    bandpass.type = "bandpass";
    bandpass.frequency.value = freq * 1.5;
    bandpass.Q.value = 1.2;
    const noiseGain = c.createGain();
    noiseGain.gain.setValueAtTime(0.12, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    noise.connect(bandpass).connect(noiseGain).connect(c.destination);
    noise.start(now);
  }

  function whistle() {
    if (muted) return;
    const c = getCtx();
    const now = c.currentTime;
    const osc = c.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(1600, now);
    osc.frequency.linearRampToValueAtTime(2100, now + 0.15);
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc.connect(gain).connect(c.destination);
    osc.start(now);
    osc.stop(now + 0.26);
  }

  function drumroll() {
    if (muted) return;
    const c = getCtx();
    const now = c.currentTime;
    for (let i = 0; i < 6; i++) {
      const t = now + i * 0.08;
      const noise = c.createBufferSource();
      noise.buffer = noiseBuffer(c, 0.05);
      const gain = c.createGain();
      gain.gain.setValueAtTime(0.08, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      noise.connect(gain).connect(c.destination);
      noise.start(t);
    }
  }

  function setMuted(on) { muted = !!on; }

  return { tok, whistle, drumroll, setMuted };
}
