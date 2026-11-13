// A12.4 (THE-1301): the geese honks and the stumble thunk, as live Web Audio oscillators (a honk is a nasal
// square wave with a pitch drop). No asset, no library. Read-only sound off the sim's own log entries, same as
// the shake/pop effects in render/scene.js are read-only visuals off the same log.
// P4 (THE-1326): these share render/audio.js's one context and sfx bus. They never create or resume a
// context themselves: before the first gesture audioOut() is null and they stay silent.
// THE-1353: `soundOff` is game.js's own `!data.settings.sound` (not the old single mute flag) -- music
// has no bearing on these.
import { audioOut } from "./audio.js";

// A14 (THE-1351): a BiquadFilter lowpass between the oscillator and the gain -- the resonance (Q 3) keeps
// the nasal "honk" formant while the square wave's fizz above 4 kHz is gone. Deflated honks get a lower
// cutoff (the fallback goose sounds rounder/duller).
export function honk(soundOff, { volume = 0.16, deflated = false } = {}) {
  const o = audioOut();
  if (soundOff || !o) return;
  try {
    const ac = o.ctx;
    const osc = ac.createOscillator();
    const lp = ac.createBiquadFilter();
    const gain = ac.createGain();
    osc.type = "square";
    lp.type = "lowpass"; lp.frequency.value = deflated ? 800 : 1100; lp.Q.value = 3;
    const now = ac.currentTime;
    const startHz = deflated ? 220 : 320, endHz = deflated ? 120 : 180; // A12.4: "a deflated honk" on fall-back
    osc.frequency.setValueAtTime(startHz, now);
    osc.frequency.exponentialRampToValueAtTime(endHz, now + 0.18);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc.connect(lp); lp.connect(gain); gain.connect(o.out);
    osc.start(now); osc.stop(now + 0.24);
  } catch (e) { /* no Web Audio support: the game plays on silently, same as any other sfx fallback */ }
}

// A12.4: "they pounce ... a honk chorus" on caught -- 3 honks a few ms apart read as a gaggle, not 1 goose.
export function honkChorus(soundOff) {
  if (soundOff) return;
  for (let i = 0; i < 3; i++) setTimeout(() => honk(soundOff, { volume: 0.18 }), i * 70);
}

// A12.5 (THE-1301): every stumble plays "a woody thunk plus a capy hrmf". Thunk: a short sine knock with a
// fast pitch drop (a hollow log). Hrmf: a low, breathy triangle grunt through a lowpass, a beat later.
function tone(ac, out, { type, startHz, endHz, dur, volume, at = 0, lowpassHz = null }) {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  const t0 = ac.currentTime + at;
  osc.frequency.setValueAtTime(startHz, t0);
  osc.frequency.exponentialRampToValueAtTime(endHz, t0 + dur);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  let node = osc;
  if (lowpassHz) { const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = lowpassHz; osc.connect(f); node = f; }
  node.connect(gain); gain.connect(out);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
}

export function stumbleThunk(soundOff) {
  const o = audioOut();
  if (soundOff || !o) return;
  try {
    const ac = o.ctx;
    tone(ac, o.out, { type: "sine", startHz: 190, endHz: 70, dur: 0.12, volume: 0.32 });
    tone(ac, o.out, { type: "triangle", startHz: 150, endHz: 105, dur: 0.16, volume: 0.14, at: 0.07, lowpassHz: 600 });
  } catch (e) { /* no Web Audio: silent */ }
}

// THE-1373 (design/capy-trail/bear/SOUND.md): the bees' buzz, replacing the honks when hero: "bear". One
// continuous swarm voice (2 detuned saws + a triangle body through 2 cascaded lowpasses) whose pitch,
// loudness and brightness track `k` = closeness (0 far, 1 close, the same far/close window as
// CHASER_FAR_DIST/CHASER_CLOSE_DIST), plus the one-shots SOUND.md lists for the moments the geese's honks
// used to mark. Everything here is live Web Audio (persistent nodes), unlike the one-shot buffers in
// render/synth.js -- it has to keep playing and re-targeting every frame, not fire-and-forget.
const BEE_FAR = { f0: 196, gain: 0.018, lp: 700, vibRate: 5.5, vibDepth: 4 };
const BEE_CLOSE = { f0: 262, gain: 0.11, lp: 1600, vibRate: 9, vibDepth: 10 };
const expLerp = (a, b, k) => a * Math.pow(b / a, k);
const linLerp = (a, b, k) => a + (b - a) * k;

// Test hook (THE-1374): how many swarm voices are live across every world, so a test can catch one left
// playing on a screen that never renders, or orphaned by a quality-tier switch (dispose + recreate).
let liveBeeVoices = 0;
export function liveBeeVoiceCount() { return liveBeeVoices; }

export function createBeeSwarm() {
  let n = null; // lazily-built node graph (null until the first gesture unlocks audio)
  let k = 0, releaseUntil = 0, pulseUntil = 0;

  function build(ac, out) {
    const oscA = ac.createOscillator(), oscB = ac.createOscillator(), oscC = ac.createOscillator();
    oscA.type = "sawtooth"; oscB.type = "sawtooth"; oscC.type = "triangle";
    const gainC = ac.createGain(); gainC.gain.value = 0.25;
    const sum = ac.createGain();
    const lp1 = ac.createBiquadFilter(); lp1.type = "lowpass"; lp1.Q.value = 0.7;
    const lp2 = ac.createBiquadFilter(); lp2.type = "lowpass"; lp2.Q.value = 0.7;
    const env = ac.createGain(); env.gain.value = 0.0001;
    const vibrato = ac.createOscillator(); vibrato.type = "sine"; vibrato.frequency.value = BEE_FAR.vibRate;
    const vibDepth = ac.createGain(); vibDepth.gain.value = BEE_FAR.vibDepth;
    const swirl = ac.createOscillator(); swirl.type = "sine"; swirl.frequency.value = 0.7;
    const swirlDepth = ac.createGain(); swirlDepth.gain.value = 0;
    oscA.connect(sum); oscB.connect(sum); oscC.connect(gainC); gainC.connect(sum);
    sum.connect(lp1); lp1.connect(lp2); lp2.connect(env); env.connect(out);
    vibrato.connect(vibDepth);
    vibDepth.connect(oscA.frequency); vibDepth.connect(oscB.frequency); vibDepth.connect(oscC.frequency);
    swirl.connect(swirlDepth); swirlDepth.connect(env.gain);
    oscA.frequency.value = BEE_FAR.f0; oscB.frequency.value = BEE_FAR.f0 * 1.012; oscC.frequency.value = BEE_FAR.f0 * 2;
    lp1.frequency.value = lp2.frequency.value = BEE_FAR.lp;
    const now = ac.currentTime;
    oscA.start(now); oscB.start(now); oscC.start(now); vibrato.start(now); swirl.start(now);
    return { ac, out, oscA, oscB, oscC, gainC, sum, lp1, lp2, env, vibrato, vibDepth, swirl, swirlDepth, f0: BEE_FAR.f0, gain: BEE_FAR.gain };
  }

  function ensure() {
    const o = audioOut();
    if (!o) return null;
    if (!n || n.ac !== o.ctx) { try { n = build(o.ctx, o.out); liveBeeVoices++; } catch (e) { n = null; } }
    return n;
  }

  function targetsFor(kk) {
    return {
      f0: expLerp(BEE_FAR.f0, BEE_CLOSE.f0, kk),
      gain: linLerp(BEE_FAR.gain, BEE_CLOSE.gain, kk * kk), // SOUND.md: gain follows k^2
      lp: expLerp(BEE_FAR.lp, BEE_CLOSE.lp, kk),
      vibRate: linLerp(BEE_FAR.vibRate, BEE_CLOSE.vibRate, kk),
      vibDepth: linLerp(BEE_FAR.vibDepth, BEE_CLOSE.vibDepth, kk),
    };
  }

  return {
    // Starts silent and ramps to the far level over 0.8 s (SOUND.md "1. The swarm voice").
    start() {
      const nd = ensure();
      if (!nd) return;
      const now = nd.ac.currentTime;
      nd.env.gain.cancelScheduledValues(now);
      nd.env.gain.setValueAtTime(0.0001, now);
      nd.env.gain.exponentialRampToValueAtTime(Math.max(BEE_FAR.gain, 0.0001), now + 0.8);
    },
    // soundOff mutes toward 0 (a ramp, never a hard cut); k is the sim's own far(0)/close(1) closeness.
    update(kk, soundOff) {
      k = Math.max(0, Math.min(1, kk));
      const nd = ensure();
      if (!nd) return;
      const now = nd.ac.currentTime;
      const t = targetsFor(k);
      nd.f0 = t.f0; nd.gain = t.gain;
      if (now >= releaseUntil) {
        nd.oscA.frequency.setTargetAtTime(t.f0, now, 0.05);
        nd.oscB.frequency.setTargetAtTime(t.f0 * 1.012, now, 0.05);
        nd.oscC.frequency.setTargetAtTime(t.f0 * 2, now, 0.05);
        nd.lp1.frequency.setTargetAtTime(t.lp, now, 0.05);
        nd.lp2.frequency.setTargetAtTime(t.lp, now, 0.05);
        nd.vibrato.frequency.setTargetAtTime(t.vibRate, now, 0.05);
        nd.vibDepth.gain.setTargetAtTime(t.vibDepth, now, 0.05);
      }
      if (now >= pulseUntil) nd.env.gain.setTargetAtTime(soundOff ? 0 : t.gain, now, 0.05);
      nd.swirlDepth.gain.setTargetAtTime(soundOff ? 0 : t.gain * 0.2, now, 0.1);
    },
    // SOUND.md "2. Close in: the stumble swell" -- a real (post-grace) stumble arrival: a noise swell plus
    // a pitch kick on the voice ("zzzZZT" of the swarm surging).
    stumbleSwell(soundOff) {
      const nd = ensure();
      if (soundOff || !nd) return;
      const ac = nd.ac, now = ac.currentTime;
      const dur = 0.35, len = Math.round(ac.sampleRate * dur);
      const buf = ac.createBuffer(1, len, ac.sampleRate);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
      const src = ac.createBufferSource(); src.buffer = buf;
      const bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1200; bp.Q.value = 4;
      const g = ac.createGain(); g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.09, now + 0.05);
      g.gain.setValueAtTime(0.09, now + 0.15);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      src.connect(bp); bp.connect(g); g.connect(nd.out);
      src.start(now); src.stop(now + dur);
      nd.oscA.frequency.setTargetAtTime(nd.f0 * 1.12, now, 0.02);
      nd.oscB.frequency.setTargetAtTime(nd.f0 * 1.12 * 1.012, now, 0.02);
      nd.oscC.frequency.setTargetAtTime(nd.f0 * 1.12 * 2, now, 0.02);
      nd.oscA.frequency.setTargetAtTime(nd.f0, now + 0.04, 0.3);
      nd.oscB.frequency.setTargetAtTime(nd.f0 * 1.012, now + 0.04, 0.3);
      nd.oscC.frequency.setTargetAtTime(nd.f0 * 2, now + 0.04, 0.3);
    },
    // SOUND.md "while close: an angry pulse" at the chaser's own cadence (HONK_EVERY).
    cadencePulse(soundOff) {
      const nd = ensure();
      if (soundOff || !nd) return;
      const now = nd.ac.currentTime;
      pulseUntil = now + 0.18;
      nd.oscA.frequency.setTargetAtTime(nd.f0 * 1.19, now, 0.03);
      nd.oscB.frequency.setTargetAtTime(nd.f0 * 1.19 * 1.012, now, 0.03);
      nd.oscC.frequency.setTargetAtTime(nd.f0 * 1.19 * 2, now, 0.03);
      nd.oscA.frequency.setTargetAtTime(nd.f0, now + 0.18, 0.15);
      nd.oscB.frequency.setTargetAtTime(nd.f0 * 1.012, now + 0.18, 0.15);
      nd.oscC.frequency.setTargetAtTime(nd.f0 * 2, now + 0.18, 0.15);
      nd.env.gain.setTargetAtTime(Math.min(0.2, nd.gain * 1.4), now, 0.02);
      nd.env.gain.setTargetAtTime(nd.gain, now + 0.18, 0.15);
    },
    // SOUND.md "3. Catch: the sting" -- replaces honkChorus() on the catch.
    catchSting(soundOff) {
      const nd = ensure();
      if (soundOff || !nd) return;
      const ac = nd.ac, now = ac.currentTime;
      [0, 0.06, 0.12].forEach((at, i) => {
        const osc = ac.createOscillator(), lp = ac.createBiquadFilter(), g = ac.createGain();
        osc.type = "sawtooth"; osc.detune.value = i === 1 ? 50 : i === 2 ? -40 : 0;
        lp.type = "lowpass"; lp.frequency.value = 1800; lp.Q.value = 2;
        const t0 = now + at;
        osc.frequency.setValueAtTime(330, t0);
        osc.frequency.exponentialRampToValueAtTime(520, t0 + 0.12);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.14, t0 + 0.008);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.14);
        osc.connect(lp); lp.connect(g); g.connect(nd.out);
        osc.start(t0); osc.stop(t0 + 0.16);
      });
      releaseUntil = now + 0.6;
      nd.oscA.frequency.setValueAtTime(BEE_CLOSE.f0, now);
      nd.oscB.frequency.setValueAtTime(BEE_CLOSE.f0 * 1.012, now);
      nd.oscC.frequency.setValueAtTime(BEE_CLOSE.f0 * 2, now);
      nd.env.gain.setTargetAtTime(0.13, now, 0.02);
      nd.oscA.frequency.setTargetAtTime(180, now + 0.6, 0.4);
      nd.oscB.frequency.setTargetAtTime(180 * 1.012, now + 0.6, 0.4);
      nd.oscC.frequency.setTargetAtTime(180 * 2, now + 0.6, 0.4);
      nd.env.gain.setTargetAtTime(0.0001, now + 0.6, 0.4);
    },
    // SOUND.md "4. Bees fall back: the release" -- on close -> far (scene.js's own mode-change edge).
    fallBackRelease(soundOff) {
      const nd = ensure();
      if (soundOff || !nd) return;
      const now = nd.ac.currentTime;
      releaseUntil = now + 1.8;
      nd.oscA.frequency.setTargetAtTime(185, now, 0.4);
      nd.oscB.frequency.setTargetAtTime(185 * 1.012, now, 0.4);
      nd.oscC.frequency.setTargetAtTime(185 * 2, now, 0.4);
      nd.lp1.frequency.setTargetAtTime(700, now, 0.2);
      nd.lp2.frequency.setTargetAtTime(700, now, 0.2);
      nd.vibrato.frequency.setTargetAtTime(4, now, 0.2);
      nd.oscA.frequency.setTargetAtTime(BEE_FAR.f0, now + 1.2, 0.2);
      nd.oscB.frequency.setTargetAtTime(BEE_FAR.f0 * 1.012, now + 1.2, 0.2);
      nd.oscC.frequency.setTargetAtTime(BEE_FAR.f0 * 2, now + 1.2, 0.2);
    },
    stop() {
      if (!n) return;
      liveBeeVoices--;
      const nd = n, now = nd.ac.currentTime;
      nd.env.gain.setTargetAtTime(0.0001, now, 0.05);
      const stopAt = now + 0.2;
      try { nd.oscA.stop(stopAt); nd.oscB.stop(stopAt); nd.oscC.stop(stopAt); nd.vibrato.stop(stopAt); nd.swirl.stop(stopAt); } catch (e) { /* already stopped */ }
      n = null;
    },
  };
}
