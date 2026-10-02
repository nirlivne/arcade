// Captain Fold audio.js: Web Audio only, no files (THE-264 M5, DESIGN.md S7). Master gain 0.6; every sound
// respects the mute toggle (save.settings.sound) via the master gain node, so toggling mute mid-sound cuts it
// immediately rather than just gating future sounds. Lazily creates the AudioContext on first use (most
// browsers refuse to start one before a user gesture; the first real pull/throw is always a gesture).
const MASTER_GAIN = 0.6;

let ctx = null;
let master = null;
let muted = false;
let noiseBuffer = null;

function ensureCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : MASTER_GAIN;
  master.connect(ctx.destination);
  return ctx;
}

function getNoiseBuffer() {
  if (noiseBuffer) return noiseBuffer;
  const c = ensureCtx();
  if (!c) return null;
  const len = c.sampleRate * 1; // 1 s of white noise, looped/sliced as needed
  noiseBuffer = c.createBuffer(1, len, c.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

function noiseSource(c) {
  const src = c.createBufferSource();
  src.buffer = getNoiseBuffer();
  src.loop = true;
  return src;
}

export function setMuted(v) {
  muted = !!v;
  if (master) master.gain.setTargetAtTime(muted ? 0 : MASTER_GAIN, ctx.currentTime, 0.02);
}

// ---- throw snap: a highpassed noise burst + a falling sine chirp.
export function playThrowSnap() {
  const c = ensureCtx();
  if (!c) return;
  const t0 = c.currentTime;
  const src = noiseSource(c);
  const hp = c.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 1800;
  const g = c.createGain();
  g.gain.setValueAtTime(0.35, t0);
  g.gain.linearRampToValueAtTime(0, t0 + 0.035);
  src.connect(hp).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + 0.04);

  const osc = c.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(180, t0);
  osc.frequency.exponentialRampToValueAtTime(90, t0 + 0.06);
  const g2 = c.createGain();
  g2.gain.setValueAtTime(0.2, t0);
  g2.gain.linearRampToValueAtTime(0, t0 + 0.06);
  osc.connect(g2).connect(master);
  osc.start(t0);
  osc.stop(t0 + 0.06);
}

// ---- tab "tk": a short bandpassed noise click, for any UI tab press.
export function playTabTk() {
  const c = ensureCtx();
  if (!c) return;
  const t0 = c.currentTime;
  const src = noiseSource(c);
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 2400;
  bp.Q.value = 3;
  const g = c.createGain();
  g.gain.setValueAtTime(0.18, t0);
  g.gain.linearRampToValueAtTime(0, t0 + 0.018);
  src.connect(bp).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + 0.02);
}

// ---- lucky star: a C-major-pentatonic arpeggio from C5, one step per star in a streak (resets after 1.5 s).
const PENTATONIC = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5]; // C5 D5 E5 G5 A5 C6
let starStreak = 0;
let lastStarAt = 0;
export function playLuckyStar() {
  const c = ensureCtx();
  if (!c) return;
  const t0 = c.currentTime;
  if (t0 - lastStarAt > 1.5) starStreak = 0;
  lastStarAt = t0;
  const note = PENTATONIC[Math.min(starStreak, PENTATONIC.length - 1)];
  starStreak++;
  const osc = c.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = note;
  const g = c.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.22, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.225);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + 0.23);

  const osc2 = c.createOscillator();
  osc2.type = "sine";
  osc2.frequency.value = note * 2;
  const g2 = c.createGain();
  g2.gain.setValueAtTime(0, t0);
  g2.gain.linearRampToValueAtTime(0.06, t0 + 0.005);
  g2.gain.exponentialRampToValueAtTime(0.001, t0 + 0.225);
  osc2.connect(g2).connect(master);
  osc2.start(t0);
  osc2.stop(t0 + 0.23);
}

// ---- updraft whoosh: noise through a lowpass sweeping 300->1400 Hz, gain 0->0.14->0 over 600 ms.
export function playUpdraftWhoosh() {
  const c = ensureCtx();
  if (!c) return;
  const t0 = c.currentTime;
  const src = noiseSource(c);
  const pre = c.createBiquadFilter(); // "pink-ish": noise through a lowpass at 3 kHz first
  pre.type = "lowpass";
  pre.frequency.value = 3000;
  const sweep = c.createBiquadFilter();
  sweep.type = "lowpass";
  sweep.frequency.setValueAtTime(300, t0);
  sweep.frequency.linearRampToValueAtTime(1400, t0 + 0.45);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.14, t0 + 0.2);
  g.gain.linearRampToValueAtTime(0, t0 + 0.6);
  src.connect(pre).connect(sweep).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + 0.6);
}

// ---- fan: noise through a bandpass, a 350 ms swell.
export function playFan() {
  const c = ensureCtx();
  if (!c) return;
  const t0 = c.currentTime;
  const src = noiseSource(c);
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 900;
  bp.Q.value = 1.5;
  const g = c.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.1, t0 + 0.15);
  g.gain.linearRampToValueAtTime(0, t0 + 0.35);
  src.connect(bp).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + 0.35);
}

// ---- paper bounce "boing" (grace): a pitch-bent sine plus a short noise tick.
export function playBounce() {
  const c = ensureCtx();
  if (!c) return;
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(220, t0);
  osc.frequency.linearRampToValueAtTime(330, t0 + 0.09);
  osc.frequency.linearRampToValueAtTime(247, t0 + 0.18);
  const g = c.createGain();
  g.gain.setValueAtTime(0.25, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.25);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + 0.25);

  const src = noiseSource(c);
  const g2 = c.createGain();
  g2.gain.setValueAtTime(0.15, t0);
  g2.gain.linearRampToValueAtTime(0, t0 + 0.015);
  src.connect(g2).connect(master);
  src.start(t0);
  src.stop(t0 + 0.015);
}

// ---- crumple (crash): 14 random noise grains over 380 ms, then a soft low boing.
export function playCrumple() {
  const c = ensureCtx();
  if (!c) return;
  const t0 = c.currentTime;
  let t = t0;
  for (let i = 0; i < 14; i++) {
    const dur = (8 + Math.random() * 12) / 1000;
    const src = noiseSource(c);
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1500 + Math.random() * 3000;
    bp.Q.value = 2;
    const g = c.createGain();
    const gain = 0.12 + Math.random() * 0.18;
    g.gain.setValueAtTime(gain, t);
    g.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(bp).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur);
    t += dur + Math.random() * (0.38 / 14);
  }
  const osc = c.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(110, t0);
  osc.frequency.linearRampToValueAtTime(70, t0 + 0.3);
  const g2 = c.createGain();
  g2.gain.setValueAtTime(0.2, t0);
  g2.gain.linearRampToValueAtTime(0, t0 + 0.3);
  osc.connect(g2).connect(master);
  osc.start(t0);
  osc.stop(t0 + 0.3);
}

// ---- touchdown slide: noise through a lowpass, 600 ms linear fade.
export function playTouchdownSlide() {
  const c = ensureCtx();
  if (!c) return;
  const t0 = c.currentTime;
  const src = noiseSource(c);
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 700;
  const g = c.createGain();
  g.gain.setValueAtTime(0.12, t0);
  g.gain.linearRampToValueAtTime(0, t0 + 0.6);
  src.connect(lp).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + 0.6);
}

// ---- landing stars: a short triangle arpeggio, C5/E5/G5 (+C6 on a 3-star landing).
const LANDING_NOTES = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
export function playLandingStars(stars) {
  const c = ensureCtx();
  if (!c) return;
  const t0 = c.currentTime;
  const notes = LANDING_NOTES.slice(0, stars === 3 ? 4 : stars);
  notes.forEach((freq, i) => {
    const t = t0 + i * 0.18;
    const osc = c.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.2, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.18);
  });
}

// ---- NEW BEST stamp thunk: a low sine hit plus a lowpassed noise burst.
export function playNewBestStamp() {
  const c = ensureCtx();
  if (!c) return;
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  osc.type = "sine";
  osc.frequency.value = 90;
  const g = c.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.5, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.145);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + 0.15);

  const src = noiseSource(c);
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 800;
  const g2 = c.createGain();
  g2.gain.setValueAtTime(0.3, t0);
  g2.gain.linearRampToValueAtTime(0, t0 + 0.03);
  src.connect(lp).connect(g2).connect(master);
  src.start(t0);
  src.stop(t0 + 0.03);
}

// ---- resume 3-2-1: three 660 Hz blips, "go" at 880 Hz. Call once per count (n = 3,2,1,0 where 0 is "go").
export function playResumeCount(n) {
  const c = ensureCtx();
  if (!c) return;
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  osc.type = "sine";
  osc.frequency.value = n === 0 ? 880 : 660;
  const g = c.createGain();
  g.gain.setValueAtTime(0.12, t0);
  g.gain.linearRampToValueAtTime(0, t0 + 0.06);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + 0.06);
}

// ---- paper swish: the continuous in-flight bed. One persistent node graph, started on the first flight frame
// and stopped when the flight ends; updateSwish() is called every frame with the live speed/stall state.
let swish = null;
export function startSwish() {
  const c = ensureCtx();
  if (!c || swish) return;
  const src = noiseSource(c);
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 0.9;
  const g = c.createGain();
  g.gain.value = 0;
  const lfo = c.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 12;
  const lfoGain = c.createGain();
  lfoGain.gain.value = 0; // depth, enabled only while stalled
  lfo.connect(lfoGain).connect(g.gain);
  src.connect(bp).connect(g).connect(master);
  src.start();
  lfo.start();
  swish = { src, bp, g, lfo, lfoGain };
}
export function updateSwish(v, stalled) {
  if (!swish || !ctx) return;
  const freq = 400 + 9 * v;
  const gain = 0.02 + 0.1 * (v / 280);
  swish.bp.frequency.setTargetAtTime(freq, ctx.currentTime, 0.06);
  swish.g.gain.setTargetAtTime(gain, ctx.currentTime, 0.06);
  swish.lfoGain.gain.setTargetAtTime(stalled ? gain * 0.6 : 0, ctx.currentTime, 0.06);
}
export function stopSwish() {
  if (!swish) return;
  const t0 = ctx.currentTime;
  swish.g.gain.setTargetAtTime(0, t0, 0.05);
  swish.src.stop(t0 + 0.2);
  swish.lfo.stop(t0 + 0.2);
  swish = null;
}
