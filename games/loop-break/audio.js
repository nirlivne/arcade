// Loop Break audio.js: WebAudio synth only, no files (design.md, DESIGN.md §8). One master GainNode for
// mute (master .8). The context unlocks on the first gesture and suspends while the tab is hidden; every
// public function is a safe no-op before unlock or when sound is off, so callers never need to check first.
const NOTES = [523.25, 587.33, 659.26, 783.99, 880, 1046.5]; // C5 D5 E5 G5 A5 C6, outer -> inner; use the last n

let ctx = null;
let master = null;
let soundEnabled = true;
let hapticsEnabled = true;

function ensureContext() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.8;
  master.connect(ctx.destination);
  return ctx;
}

// Call once on the first user gesture (pointerdown/keydown), per DESIGN.md "unlocked on the first gesture".
export function unlock() {
  const c = ensureContext();
  if (c && c.state === "suspended") c.resume().catch(() => {});
}

// `sound` and `haptics` are independent settings (save.js's shape); each public sound/vibrate call checks
// only its own flag.
export function setEnabled(sound) {
  soundEnabled = !!sound;
}

export function setHaptics(haptics) {
  hapticsEnabled = !!haptics;
}

document.addEventListener("visibilitychange", () => {
  if (!ctx) return;
  if (document.hidden) ctx.suspend().catch(() => {});
  else if (soundEnabled) ctx.resume().catch(() => {});
});

function live() {
  return soundEnabled && ctx && ctx.state === "running";
}

// A short burst of filtered white noise with a linear-attack, exponential-decay gain envelope.
function noiseBurst({ duration, filterType = "bandpass", freq, Q = 1, gainPeak, attackMs = 1, decayTo = 0.001 }) {
  if (!live()) return;
  const n = Math.max(1, Math.round(duration * ctx.sampleRate));
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = freq;
  filter.Q.value = Q;
  const gain = ctx.createGain();
  const t0 = ctx.currentTime;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(gainPeak, t0 + attackMs / 1000);
  gain.gain.exponentialRampToValueAtTime(decayTo, t0 + duration);
  src.connect(filter).connect(gain).connect(master);
  src.start(t0);
  src.stop(t0 + duration + 0.02);
}

// A sine (optionally frequency-ramped) with a linear-attack, exponential-decay gain envelope.
function tone({ freq, freqEnd, freqTime, gainPeak, attackMs = 2, decayTo = 0.001, decayMs, stopMs, type = "sine" }) {
  if (!live()) return;
  const osc = ctx.createOscillator();
  osc.type = type;
  const t0 = ctx.currentTime;
  osc.frequency.setValueAtTime(freq, t0);
  if (freqEnd != null) osc.frequency.exponentialRampToValueAtTime(freqEnd, t0 + (freqTime || 0.06));
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(gainPeak, t0 + attackMs / 1000);
  gain.gain.exponentialRampToValueAtTime(decayTo, t0 + (decayMs || stopMs || 200) / 1000);
  osc.connect(gain).connect(master);
  osc.start(t0);
  osc.stop(t0 + (stopMs || decayMs || 200) / 1000 + 0.02);
}

function vibrate(pattern) {
  if (hapticsEnabled && navigator.vibrate) navigator.vibrate(pattern);
}

// 12 ms white noise -> 2400 Hz bandpass (+-8% per click) Q4, attack 1ms to .35, decay to .001 at 12ms.
export function detentClick(withHaptic) {
  const jitter = 1 + (Math.random() * 0.16 - 0.08);
  noiseBurst({ duration: 0.012, freq: 2400 * jitter, Q: 4, gainPeak: 0.35, attackMs: 1 });
  if (withHaptic !== false) vibrate(12);
}

// Per-ring pentatonic ting, outer -> inner: use the last n notes. Sine + a 2.76x partial at gain .25.
export function gapTing(ring, ringCount) {
  const idx = NOTES.length - ringCount + ring;
  const freq = NOTES[Math.max(0, Math.min(NOTES.length - 1, idx))];
  tone({ freq, gainPeak: 0.22, attackMs: 3, decayMs: 180, stopMs: 900 });
  tone({ freq: freq * 2.76, gainPeak: 0.22 * 0.25, attackMs: 3, decayMs: 180, stopMs: 900 });
}

// Each ring re-rings its ting as the lume reaches it, 40ms apart, hub -> bezel (innermost ring first).
export function winArpeggio(ringCount) {
  for (let i = 0; i < ringCount; i++) {
    const ring = ringCount - 1 - i; // innermost first
    setTimeout(() => gapTing(ring, ringCount), i * 40);
  }
}

// Sine 110->55Hz exp in 60ms gain .6 (attack 2ms, decay 180ms) + a noise click 1.6kHz Q1 10ms gain .3.
export function thunk() {
  tone({ freq: 110, freqEnd: 55, freqTime: 0.06, gainPeak: 0.6, attackMs: 2, decayMs: 180 });
  noiseBurst({ duration: 0.01, freq: 1600, Q: 1, gainPeak: 0.3, attackMs: 1 });
  vibrate([20, 30, 40]);
}

// Noise bandpass 4.2kHz Q6 8ms gain .18 + a sine chirp 1.8->2.6kHz in 25ms gain .06.
export function tickUp() {
  noiseBurst({ duration: 0.008, freq: 4200, Q: 6, gainPeak: 0.18, attackMs: 1 });
  tone({ freq: 1800, freqEnd: 2600, freqTime: 0.025, gainPeak: 0.06, attackMs: 1, decayMs: 25 });
}

// Sine 320->240Hz in 40ms gain .25 decay 70ms + noise lowpass 900Hz 15ms gain .1.
export function tock() {
  tone({ freq: 320, freqEnd: 240, freqTime: 0.04, gainPeak: 0.25, attackMs: 1, decayMs: 70 });
  noiseBurst({ duration: 0.015, filterType: "lowpass", freq: 900, Q: 1, gainPeak: 0.1, attackMs: 1 });
}

// Two noise bursts lowpass 700Hz, 30ms each, 45ms apart, gains .35/.22 + a sine 90Hz 80ms gain .2.
export function clack() {
  noiseBurst({ duration: 0.03, filterType: "lowpass", freq: 700, Q: 1, gainPeak: 0.35, attackMs: 1 });
  setTimeout(() => noiseBurst({ duration: 0.03, filterType: "lowpass", freq: 700, Q: 1, gainPeak: 0.22, attackMs: 1 }), 45);
  tone({ freq: 90, gainPeak: 0.2, attackMs: 1, decayMs: 80 });
}

// 3 clicks per baton restored, 28ms apart: noise bandpass 3.2kHz Q5 6ms, gain .10 -> .20.
export function ratchet(batons) {
  const n = Math.max(1, batons) * 3;
  for (let i = 0; i < n; i++) {
    const g = 0.1 + (0.2 - 0.1) * (i / Math.max(1, n - 1));
    setTimeout(() => noiseBurst({ duration: 0.006, freq: 3200, Q: 5, gainPeak: g, attackMs: 1 }), i * 28);
  }
}

// The detent click at 1.8kHz, gain .2 -- a UI press, not a ring move.
export function platePress() {
  noiseBurst({ duration: 0.012, freq: 1800, Q: 4, gainPeak: 0.2, attackMs: 1 });
}
