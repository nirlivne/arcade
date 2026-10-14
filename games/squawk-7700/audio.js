// WebAudio synth only (spec §7): no samples, no recordings. Lazily creates an AudioContext on the
// first user gesture (autoplay policies). All gains feed one master bus so `setMuted` silences everything.
export function createAudio() {
  let ctx = null, master = null, wind = null, windGain = null, clacker = null, heartbeatTimer = 0;
  let nearSilenceT = 0, mutedByNearSilence = false;
  let enabled = true;

  function ensure() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);

    // Wind roar: filtered noise, level driven by speed.
    const bufSize = 2 * ctx.sampleRate;
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
    const filter = ctx.createBiquadFilter(); filter.type = "lowpass"; filter.frequency.value = 400;
    windGain = ctx.createGain(); windGain.gain.value = 0;
    noise.connect(filter); filter.connect(windGain); windGain.connect(master);
    noise.start();
    wind = { filter };
  }

  function setMuted(off) { enabled = !off; if (master) master.gain.value = enabled ? 0.5 : 0; }

  // v: airspeed (kt), g: current g, dt: seconds since last call.
  function tick(v, g, dt) {
    if (!ctx) return;
    if (windGain) windGain.gain.value = Math.min(0.5, v / 900);
    if (wind) wind.filter.frequency.value = 300 + Math.min(1, v / 480) * 900;

    // Overspeed clacker: 8 Hz click train while v > VMO (340).
    const over = v > 340;
    clacker = clacker || { phase: 0 };
    if (over) {
      clacker.phase += dt * 8;
      if (clacker.phase >= 1) { clacker.phase -= 1; click(900, 0.04); }
    } else clacker.phase = 0;

    // Heartbeat: a soft double-thump, rate rises with g above 3.
    if (g > 3) {
      heartbeatTimer -= dt;
      if (heartbeatTimer <= 0) {
        const bpm = 70 + Math.min(1, (g - 3) / 2) * 60;
        heartbeatTimer = 60 / bpm;
        thump();
      }
    } else heartbeatTimer = 0;
  }

  // A 1 s near-silence beat at the pull-out peak (master bus ducked, then restored).
  function nearSilence() {
    if (!ctx || mutedByNearSilence) return;
    mutedByNearSilence = true;
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(0.03, now + 0.08);
    master.gain.setValueAtTime(0.03, now + 1.0);
    master.gain.linearRampToValueAtTime(enabled ? 0.5 : 0, now + 1.3);
    nearSilenceT = 1.3;
  }

  function click(freq, dur) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "square"; o.frequency.value = freq;
    g.gain.setValueAtTime(0.15, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g); g.connect(master); o.start(); o.stop(ctx.currentTime + dur);
  }
  function thump() {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine"; o.frequency.value = 55;
    g.gain.setValueAtTime(0.25, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    o.connect(g); g.connect(master); o.start(); o.stop(ctx.currentTime + 0.18);
  }
  // Two-tone caution chime (master caution on/off).
  function caution() {
    if (!ctx) return;
    for (const [freq, at] of [[880, 0], [660, 0.12]]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = freq;
      g.gain.setValueAtTime(0.12, ctx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + at + 0.1);
      o.connect(g); g.connect(master); o.start(ctx.currentTime + at); o.stop(ctx.currentTime + at + 0.1);
    }
  }

  return { ensure, tick, nearSilence, caution, setMuted };
}
