// P4 sound (THE-1326): every SFX in Capy Trail is synthesised here, by our own code: no samples, no
// third-party audio, so nothing to license (games/capy-trail/licenses/sounds.txt says so). Pure JS:
// renders mono Float32Array buffers at SR, which render/audio.js hands to Web Audio as AudioBuffers.
// No Web Audio and no DOM in this file, so node tests can check levels.
// A14 (THE-1351/THE-1354): the music loop above was replaced by a CC0 track (render/audio.js decodes
// games/capy-trail/assets/audio/music-happy-beat.*); this file now covers SFX only. The SFX themselves
// were retuned per THE-1351's measurements (lowpass + lower pitches: less energy above 4 kHz).

export const SR = 22050;
// mix levels, shared with render/audio.js (the node streak test mixes with the same numbers)
export const MUSIC_GAIN = 0.25, SFX_GAIN = 0.5, COIN_GAIN = 0.22, COIN_VOICES = 3;

const TAU = Math.PI * 2;
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function normalize(a, to) {
  let p = 0; for (const x of a) p = Math.max(p, Math.abs(x));
  if (p > 0) for (let i = 0; i < a.length; i++) a[i] *= to / p;
  return a;
}
// fade the very edges so a one-shot never clicks on or off
function edges(a, inMs = 3, outMs = 6) {
  const ni = Math.max(1, Math.round(SR * inMs / 1000)), no = Math.max(1, Math.round(SR * outMs / 1000));
  for (let i = 0; i < ni && i < a.length; i++) a[i] *= i / ni;
  for (let i = 0; i < no && i < a.length; i++) a[a.length - 1 - i] *= i / no;
  return a;
}

// ---------------------------------------------------------------- one-shot effects
// A tone with an exponential pitch glide and decay; `harm` adds a soft upper partial.
// THE-1412: `attack` (seconds) defaults to the original hardcoded 0.004, so every earlier call is
// unaffected; levelFinish's own whistle note is the first to pass a slower one (sfx-levels.mjs).
function glide(a, { from, to, at = 0, dur, decay, gain = 1, harm = 0, harmMul = 2, wave = "sine", attack = 0.004 }) {
  const o = Math.round(at * SR), n = Math.round(dur * SR);
  let ph = 0, ph2 = 0;
  for (let i = 0; i < n && o + i < a.length; i++) {
    const t = i / SR, k = i / n;
    const f = from * Math.pow(to / from, k);
    ph += TAU * f / SR; ph2 += TAU * f * harmMul / SR;
    const env = Math.min(1, t / attack) * Math.exp(-t / decay);
    const base = wave === "tri" ? (2 / Math.PI) * Math.asin(Math.sin(ph)) : Math.sin(ph);
    a[o + i] += gain * env * (base + harm * Math.sin(ph2));
  }
}
// THE-1412 (design/capy-trail/levels/sfx-levels.mjs): one star ding -- a soft bell on `f` over a body an
// octave down (the body keeps the >4 kHz share under 1%). Shared by levelStar0/1/2 below.
function ding(a, f, at = 0) {
  glide(a, { from: f, to: f, at, dur: 0.3, decay: 0.09, gain: 0.45 });
  glide(a, { from: f / 2, to: f / 2, at, dur: 0.3, decay: 0.11, gain: 0.85, harm: 0.12, wave: "tri" });
}
// Filtered noise burst: a one-pole lowpass whose cutoff glides from `from` to `to` Hz.
function noise(a, { at = 0, dur, decay, from = 4000, to = 800, gain = 1, seed = 1, high = false }) {
  const r = rng(seed), o = Math.round(at * SR), n = Math.round(dur * SR);
  let lp = 0, prev = 0;
  for (let i = 0; i < n && o + i < a.length; i++) {
    const t = i / SR, fc = from * Math.pow(to / from, i / n);
    const alpha = 1 - Math.exp(-TAU * fc / SR);
    const x = r() * 2 - 1;
    lp += alpha * (x - lp);
    const y = high ? lp - prev : lp; prev = lp;
    a[o + i] += gain * y * Math.min(1, t / 0.002) * Math.exp(-t / decay);
  }
}
// A14 (THE-1351): two cascaded one-pole lowpasses at `hz` (12 dB/oct), run over the finished buffer, before
// normalize/edges -- this is what pulled the shrill SFX (duck, lane, step) below the "pierces on a phone
// speaker" band (>4 kHz) without changing their basic shape.
function lowpass(a, hz) {
  const alpha = 1 - Math.exp(-TAU * hz / SR); let y1 = 0, y2 = 0;
  for (let i = 0; i < a.length; i++) { y1 += alpha * (a[i] - y1); y2 += alpha * (y1 - y2); a[i] = y2; }
  return a;
}

// A14 targets (THE-1351): retuned lower/softer, each finished with its own lowpass cutoff.
const SFX = {
  // coin: a bright two-note "ding", a semitone higher per chain step (the coin multiplier)
  coin: ({ step = 0 } = {}) => {
    const a = new Float32Array(Math.round(SR * 0.24)), k = Math.pow(2, step / 12);
    glide(a, { from: 659.26 * k, to: 659.26 * k, dur: 0.07, decay: 0.03, harm: 0.12 });
    glide(a, { from: 987.77 * k, to: 987.77 * k, at: 0.055, dur: 0.18, decay: 0.06, harm: 0.1 });
    return a;
  },
  jump: () => { const a = new Float32Array(Math.round(SR * 0.22)); glide(a, { from: 220, to: 520, dur: 0.2, decay: 0.08, harm: 0.1, wave: "tri" }); return a; },
  duck: () => { const a = new Float32Array(Math.round(SR * 0.22)); noise(a, { dur: 0.2, decay: 0.06, from: 2200, to: 400, seed: 3 }); return a; },
  // lane / turn: its own short swish (used to be duck played at rate 1.6, which pushed the hiss to ~8 kHz)
  lane: () => { const a = new Float32Array(Math.round(SR * 0.13)); noise(a, { dur: 0.12, decay: 0.04, from: 1600, to: 500, seed: 11 }); return a; },
  land: () => { const a = new Float32Array(Math.round(SR * 0.14)); glide(a, { from: 110, to: 60, dur: 0.12, decay: 0.04 }); noise(a, { dur: 0.05, decay: 0.015, from: 1500, to: 400, gain: 0.5, seed: 5 }); return a; },
  step: () => { const a = new Float32Array(Math.round(SR * 0.05)); noise(a, { dur: 0.045, decay: 0.012, from: 1200, to: 400, seed: 7 }); return a; },
  crash: () => {
    const a = new Float32Array(Math.round(SR * 0.5));
    glide(a, { from: 150, to: 42, dur: 0.45, decay: 0.14, harm: 0.3, harmMul: 1.5 });
    noise(a, { dur: 0.16, decay: 0.05, from: 1800, to: 250, gain: 0.8, seed: 9 });
    glide(a, { from: 520, to: 260, at: 0.1, dur: 0.3, decay: 0.08, gain: 0.25, wave: "tri" }); // the cartoon "boing" fall
    return a;
  },
  click: () => { const a = new Float32Array(Math.round(SR * 0.05)); glide(a, { from: 700, to: 560, dur: 0.045, decay: 0.012, harm: 0.1 }); return a; },
  // THE-1391 power-up sounds (recipes designed in design/capy-trail/powerups/sfx-powerups.mjs; see that
  // file's own node --test for the A14 measurements). Honey Jar pickup: a warm "glug" into a sweet 2-note plink.
  honeyPickup: () => {
    const a = new Float32Array(Math.round(SR * 0.34));
    glide(a, { from: 300, to: 440, dur: 0.09, decay: 0.05, harm: 0.2 });
    glide(a, { from: 523.25, to: 523.25, at: 0.07, dur: 0.2, decay: 0.08, harm: 0.15 });
    glide(a, { from: 783.99, to: 783.99, at: 0.13, dur: 0.2, decay: 0.07, gain: 0.55, harm: 0.1 });
    return a;
  },
  // Picnic Shield pickup: the bubble forming round the hero, a rising "bwoomp" with a glassy shimmer on top.
  shieldUp: () => {
    const a = new Float32Array(Math.round(SR * 0.36));
    glide(a, { from: 180, to: 520, dur: 0.24, decay: 0.12, harm: 0.15 });
    glide(a, { from: 784, to: 1046.5, at: 0.1, dur: 0.22, decay: 0.07, gain: 0.35, wave: "tri" });
    return a;
  },
  // Picnic Shield pop (absorbs the hit / runs out): a quick wet "plip" down, a puff of air and one droplet.
  shieldPop: () => {
    const a = new Float32Array(Math.round(SR * 0.17));
    glide(a, { from: 900, to: 250, dur: 0.07, decay: 0.022 });
    noise(a, { dur: 0.05, decay: 0.012, from: 1800, to: 500, gain: 0.6, seed: 21 });
    glide(a, { from: 1200, to: 1500, at: 0.065, dur: 0.06, decay: 0.016, gain: 0.3 });
    return a;
  },
  // Balloon Ride pickup: a rubbery squeak of a balloon blown up (a triangle with a fifth above it, rising).
  balloonPickup: () => {
    const a = new Float32Array(Math.round(SR * 0.3));
    glide(a, { from: 300, to: 700, dur: 0.26, decay: 0.2, harm: 0.3, harmMul: 1.5, wave: "tri" });
    return a;
  },
  // Balloon lift-off (play at pickup, alongside balloonPickup): an airy whoosh rising under a C -> G swell.
  balloonFloat: () => {
    const a = new Float32Array(Math.round(SR * 0.78));
    noise(a, { dur: 0.72, decay: 0.32, from: 500, to: 1600, gain: 0.55, seed: 23 });
    glide(a, { from: 261.63, to: 392, at: 0.04, dur: 0.6, decay: 0.3, gain: 0.5, harm: 0.1 });
    glide(a, { from: 523.25, to: 523.25, at: 0.36, dur: 0.38, decay: 0.15, gain: 0.25 });
    return a;
  },
  // Balloon descent (play when the descent starts): a slow falling whistle on a soft breeze.
  balloonDescend: () => {
    const a = new Float32Array(Math.round(SR * 0.76));
    glide(a, { from: 523.25, to: 329.63, dur: 0.72, decay: 0.34, harm: 0.08 });
    noise(a, { dur: 0.62, decay: 0.25, from: 1400, to: 450, gain: 0.35, seed: 29 });
    return a;
  },
  // THE-1398 Spring Paws pickup: a real "boi-oi-oing", a triangle bouncing between pitches as it rings down.
  springPickup: () => {
    const a = new Float32Array(Math.round(SR * 0.36));
    const hops = [[220, 520, 0, 0.06], [520, 330, 0.05, 0.06], [330, 470, 0.1, 0.06], [470, 370, 0.15, 0.07], [370, 430, 0.21, 0.09]];
    hops.forEach(([from, to, at, dur], i) => glide(a, { from, to, at, dur, decay: 0.06, gain: 1 - i * 0.16, harm: 0.15, wave: "tri" }));
    return a;
  },
  // Spring Paws jump (replaces `jump` on take-off while active): a shorter, lower boing, so 30 jumps don't grate.
  springBoing: () => {
    const a = new Float32Array(Math.round(SR * 0.22));
    glide(a, { from: 160, to: 440, dur: 0.055, decay: 0.05, harm: 0.12, wave: "tri" });
    glide(a, { from: 440, to: 300, at: 0.045, dur: 0.065, decay: 0.045, gain: 0.8, harm: 0.12, wave: "tri" });
    glide(a, { from: 300, to: 380, at: 0.1, dur: 0.09, decay: 0.04, gain: 0.55, wave: "tri" });
    return a;
  },
  // Mystery Box open (at pickup): a three-tap rattle, then the lid's "pop" up.
  mysteryOpen: () => {
    const a = new Float32Array(Math.round(SR * 0.27));
    [0, 0.045, 0.085].forEach((at, i) => noise(a, { at, dur: 0.04, decay: 0.01, from: 1500, to: 400, gain: 0.7, seed: 31 + i }));
    glide(a, { from: 220, to: 660, at: 0.11, dur: 0.13, decay: 0.05, harm: 0.15 });
    return a;
  },
  // Mystery Box prize (0.15 s after the open): a little "ta-da", C5 E5 G5 up to C6 held.
  mysteryPrize: () => {
    const a = new Float32Array(Math.round(SR * 0.52));
    [[523.25, 0], [659.26, 0.06], [783.99, 0.12]].forEach(([from, at]) => glide(a, { from, to: from, at, dur: 0.1, decay: 0.05, gain: 0.7, harm: 0.15 }));
    glide(a, { from: 1046.5, to: 1046.5, at: 0.18, dur: 0.32, decay: 0.12, gain: 0.45 });
    glide(a, { from: 523.25, to: 523.25, at: 0.18, dur: 0.32, decay: 0.14, gain: 0.8 });
    glide(a, { from: 659.26, to: 659.26, at: 0.18, dur: 0.32, decay: 0.13, gain: 0.45 });
    return a;
  },
  // THE-1408 (design/capy-trail/score-missions/sfx-missions.mjs). A soft two-note "tick-ding".
  missionTick: () => {
    const a = new Float32Array(Math.round(SR * 0.3));
    glide(a, { from: 783.99, to: 783.99, dur: 0.08, decay: 0.035, gain: 0.6, harm: 0.1, wave: "tri" });
    glide(a, { from: 523.25, to: 523.25, at: 0.07, dur: 0.22, decay: 0.08, gain: 0.8, harm: 0.15 });
    glide(a, { from: 1046.5, to: 1046.5, at: 0.07, dur: 0.2, decay: 0.06, gain: 0.35 });
    return a;
  },
  // The set is done (Results, with the x N stamp + confetti): a clay-warm fanfare, C-E-G up to a held C6.
  missionSet: () => {
    const a = new Float32Array(Math.round(SR * 0.78));
    [[392, 0], [523.25, 0.08], [659.26, 0.16], [783.99, 0.24]].forEach(([f, at]) => glide(a, { from: f, to: f, at, dur: 0.12, decay: 0.06, gain: 0.7, harm: 0.15, wave: "tri" }));
    glide(a, { from: 1046.5, to: 1046.5, at: 0.32, dur: 0.44, decay: 0.16, gain: 0.4 });
    glide(a, { from: 523.25, to: 523.25, at: 0.32, dur: 0.44, decay: 0.2, gain: 0.85, harm: 0.1 });
    glide(a, { from: 392, to: 392, at: 0.32, dur: 0.44, decay: 0.2, gain: 0.55 });
    return a;
  },
  // THE-1412 (design/capy-trail/levels/sfx-levels.mjs): passing under the finish arch -- a woody "tock"
  // (the posts), a whistle slide up a fifth, then a two-bell "ding-dong" landing on G. Built from
  // different parts than missionSet's C-E-G, so the two never blur on the same Results screen.
  levelFinish: () => {
    const a = new Float32Array(Math.round(SR * 0.78));
    glide(a, { from: 330, to: 300, dur: 0.06, decay: 0.018, gain: 0.9, harm: 0.5, harmMul: 2.76 }); // the tock
    glide(a, { from: 392, to: 587.33, at: 0.05, dur: 0.2, decay: 0.12, gain: 0.55, wave: "tri", attack: 0.03 }); // whistle G4 -> D5
    ding(a, 783.99, 0.26); // G5 (body G4)
    glide(a, { from: 587.33, to: 587.33, at: 0.42, dur: 0.36, decay: 0.14, gain: 0.5 }); // D5 bell
    glide(a, { from: 392, to: 392, at: 0.42, dur: 0.36, decay: 0.18, gain: 0.8, harm: 0.1, wave: "tri" }); // G4 body
    return a;
  },
  // A star stamping in on the level results: one ding per star, rising E5/G5/B5 (index 0/1/2), 280 ms apart.
  levelStar0: () => { const a = new Float32Array(Math.round(SR * 0.32)); ding(a, 659.25); return a; },
  levelStar1: () => { const a = new Float32Array(Math.round(SR * 0.32)); ding(a, 783.99); return a; },
  levelStar2: () => { const a = new Float32Array(Math.round(SR * 0.32)); ding(a, 987.77); return a; },
};
const SFX_LOWPASS = {
  coin: 2500, jump: 2500, duck: 1800, lane: 1800, land: 2000, step: 1800, crash: 2500, click: 3000,
  honeyPickup: 2500, shieldUp: 2500, shieldPop: 2400, balloonPickup: 2500, balloonFloat: 2200, balloonDescend: 2000,
  springPickup: 2500, springBoing: 2500, mysteryOpen: 2500, mysteryPrize: 2400,
  levelFinish: 2400, levelStar0: 2500, levelStar1: 2500, levelStar2: 2500,
  missionTick: 2500, missionSet: 2400,
};
export const SFX_NAMES = Object.keys(SFX);
export function renderSfx(name, opts) {
  const a = SFX[name](opts);
  if (SFX_LOWPASS[name]) lowpass(a, SFX_LOWPASS[name]);
  return edges(normalize(a, 0.9));
}
