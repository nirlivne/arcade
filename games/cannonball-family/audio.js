// Cannonball Family audio.js: Web Audio only, no files (THE-449 S6, DESIGN.md §10). Master gain 0.6; every
// sound respects the mute toggle (save's settings.sound) via the master gain node, so toggling mute mid-sound
// cuts it immediately rather than just gating future sounds. Lazily creates the AudioContext on first use
// (most browsers refuse to start one before a user gesture; the first real pull/tap is always a gesture).
// No unseeded RNG anywhere in game code (AC-D3): the noise buffer is filled from a fixed-seed mulberry32, so it is
// the same every load and the sim's rng is never touched.
import { mulberry32 } from "./rng.js";

const MASTER_GAIN = 0.6;
const NOISE_SEED = 0x7e57a1d;

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
  const noise = mulberry32(NOISE_SEED);
  for (let i = 0; i < len; i++) data[i] = noise() * 2 - 1;
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

// Creates (or resumes) the AudioContext from a real user gesture (CTO review on THE-449, non-blocking but
// cheap: every actual sound call happens from the rAF loop, not from the pointer/key handler itself, which on
// iOS Safari isn't a "real" gesture as far as autoplay policy is concerned — the game could stay silent there
// even though ensureCtx()'s own comment assumed the first pull/tap would unlock it). Safe to call on every
// pointerdown/keydown: a no-op once the context already exists and isn't suspended.
export function unlock() {
  const c = ensureCtx();
  if (c && c.state === "suspended") c.resume();
}

// ---- cannon: a felt "thump" (low sine 70 -> 40 Hz, 120 ms) + "boom" (filtered noise, 300 ms).
export function playCannon() {
  const c = ensureCtx();
  if (!c) return;
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(70, t0);
  osc.frequency.exponentialRampToValueAtTime(40, t0 + 0.12);
  const g = c.createGain();
  g.gain.setValueAtTime(0.5, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + 0.12);

  const src = noiseSource(c);
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 500;
  const g2 = c.createGain();
  g2.gain.setValueAtTime(0.3, t0);
  g2.gain.linearRampToValueAtTime(0, t0 + 0.3);
  src.connect(lp).connect(g2).connect(master);
  src.start(t0);
  src.stop(t0 + 0.3);
}

// ---- fuse fizz: high band-passed noise, quiet, called every frame of the last 5 s (louder as the fuse burns
// down). secsLeft is clamped to 5 for the gain ramp; a fizz callback drives one continuous node graph, started
// on entering the last 5 s and stopped once the shot fires or the fuse resets (a fresh member's full 15 s).
let fizz = null;
export function startFizz() {
  const c = ensureCtx();
  if (!c || fizz) return;
  const src = noiseSource(c);
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 3200;
  bp.Q.value = 1.2;
  const g = c.createGain();
  g.gain.value = 0;
  src.connect(bp).connect(g).connect(master);
  src.start();
  fizz = { src, bp, g };
}
export function updateFizz(secsLeft) {
  if (!fizz || !ctx) return;
  const t = Math.max(0, Math.min(5, secsLeft));
  fizz.g.gain.setTargetAtTime(0.02 + 0.05 * (1 - t / 5), ctx.currentTime, 0.1); // louder as secsLeft -> 0
}
export function stopFizz() {
  if (!fizz) return;
  const t0 = ctx.currentTime;
  fizz.g.gain.setTargetAtTime(0, t0, 0.05);
  fizz.src.stop(t0 + 0.2);
  fizz = null;
}

// ---- tin "tonk": triangle 620-880 Hz, 90 ms. pitch 0-1 gives each tin a slightly different note (its index
// mod something, so a multi-tin shot doesn't sound like one note repeated).
export function playTonk(pitch = 0) {
  const c = ensureCtx();
  if (!c) return;
  const t0 = c.currentTime;
  const freq = 620 + (880 - 620) * Math.max(0, Math.min(1, pitch));
  const osc = c.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(0.3, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.09);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + 0.09);
}

// ---- jar "clink": two sines 1.6/2.4 kHz, 60 ms.
export function playClink() {
  const c = ensureCtx();
  if (!c) return;
  const t0 = c.currentTime;
  for (const freq of [1600, 2400]) {
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(0.15, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.06);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + 0.06);
  }
}

// ---- net "boing": sine 180 -> 320 Hz, 220 ms.
export function playBoing() {
  const c = ensureCtx();
  if (!c) return;
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(180, t0);
  osc.frequency.exponentialRampToValueAtTime(320, t0 + 0.22);
  const g = c.createGain();
  g.gain.setValueAtTime(0.2, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + 0.22);
}

// ---- bow: a 3-note circus fanfare (C-E-G square, soft) + a crowd "ooh" (formant-filtered noise).
export function playBow() {
  const c = ensureCtx();
  if (!c) return;
  const t0 = c.currentTime;
  [523.25, 659.25, 783.99].forEach((freq, i) => { // C5 E5 G5
    const t = t0 + i * 0.09;
    const osc = c.createOscillator();
    osc.type = "square";
    osc.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.1, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.15);
  });
  // Crowd "ooh": noise through two formant-ish bandpasses (a vowel's rough shape), a soft swell.
  const src = noiseSource(c);
  const bp1 = c.createBiquadFilter();
  bp1.type = "bandpass";
  bp1.frequency.value = 500;
  bp1.Q.value = 4;
  const bp2 = c.createBiquadFilter();
  bp2.type = "bandpass";
  bp2.frequency.value = 900;
  bp2.Q.value = 6;
  const g2 = c.createGain();
  g2.gain.setValueAtTime(0, t0);
  g2.gain.linearRampToValueAtTime(0.1, t0 + 0.15);
  g2.gain.linearRampToValueAtTime(0, t0 + 0.5);
  src.connect(bp1).connect(bp2).connect(g2).connect(master);
  src.start(t0);
  src.stop(t0 + 0.5);
}

// ---- shrug: a muted trombone "wah-wah" (saw through a closing low-pass, two falling notes) — it laughs
// *with* them, not at them: soft, not mocking.
export function playShrug() {
  const c = ensureCtx();
  if (!c) return;
  const t0 = c.currentTime;
  [311.13, 277.18].forEach((freq, i) => { // Eb4, Db4: a falling "wah-wah"
    const t = t0 + i * 0.22;
    const osc = c.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(freq * 1.15, t);
    osc.frequency.exponentialRampToValueAtTime(freq, t + 0.18);
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(1400, t);
    lp.frequency.exponentialRampToValueAtTime(350, t + 0.2);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.14, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc.connect(lp).connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.2);
  });
}

// ---- curtain call: drum roll (noise bursts 30 Hz) + cymbal (high noise, 600 ms).
export function playCurtainCall() {
  const c = ensureCtx();
  if (!c) return;
  const t0 = c.currentTime;
  const rollDur = 0.5, burstEvery = 1 / 30;
  for (let t = t0; t < t0 + rollDur; t += burstEvery) {
    const src = noiseSource(c);
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 220;
    bp.Q.value = 2;
    const g = c.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.linearRampToValueAtTime(0, t + burstEvery * 0.8);
    src.connect(bp).connect(g).connect(master);
    src.start(t);
    src.stop(t + burstEvery * 0.8);
  }
  const cymbalT = t0 + rollDur;
  const src2 = noiseSource(c);
  const hp = c.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 4000;
  const g2 = c.createGain();
  g2.gain.setValueAtTime(0.22, cymbalT);
  g2.gain.exponentialRampToValueAtTime(0.001, cymbalT + 0.6);
  src2.connect(hp).connect(g2).connect(master);
  src2.start(cymbalT);
  src2.stop(cymbalT + 0.6);
}
