// The mixer (THE-1561, spec §7 / §8 comforts): one AudioContext, three buses (music, effects,
// voice) each with its own on/off toggle, a -7 dB duck on the music bus for the voice, and
// suspend/resume for pause and tab-away. Every one-shot goes through voice(): its nodes are
// disconnected when its last source ends, so nothing piles up across respawns.
// The context is injected, so node tests can drive it with a fake (audio.test.mjs).

// THE-1568 D2 1: voice within ±3 LU of the bed. Measured in real time (tools/plain-ink-rt-capture.mjs):
// music +4.4 dB over S6 (0.6), effects +8 dB (0.8), voice -2 dB, so the bed sits ~3 dB under the limiter
// and the spotted/closeCall stabs keep room to rise ≥ +6 dB over it; the limiter holds the peaks
export const LEVELS = { music: 1.0, sfx: 2.0, voice: 0.8 };
export const DUCK_DB = -7; // spec: music -7 dB under the voice
const DUCK = Math.pow(10, DUCK_DB / 20);
const DIP = Math.pow(10, -6 / 20); // THE-1568 D2 2: the loop dips -6 dB for 0.4 s under the spotted/closeCall stabs
const RAMP_S = 0.08;

const CLIP_KNEE = 0.7, CLIP_CEIL = 0.84; // -1.5 dBFS, under the -1 dBFS true-peak target
export function softClip(x) {
  const a = Math.abs(x);
  if (a <= CLIP_KNEE) return x;
  const room = CLIP_CEIL - CLIP_KNEE;
  return Math.sign(x) * (CLIP_KNEE + room * Math.tanh((a - CLIP_KNEE) / room));
}
function softClipCurve(n = 2049) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = softClip((i / (n - 1)) * 2 - 1);
  return c;
}

export function createMixer(ctx, settings = { music: true, sfx: true, voice: true }) {
  const master = ctx.createGain();
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -4; // 20:1 with a 1 ms attack: a near brick wall for the peaks
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.12;
  // the compressor has no look-ahead, so a stab's first ms can overshoot it: a soft clipper after it
  // (linear to 0.7, then a tanh knee that never passes 0.84) catches only those overs
  const clip = ctx.createWaveShaper();
  clip.curve = softClipCurve();
  clip.oversample = 'none'; // '4x' resampling overshot the ceiling by ~1 dB on hard attacks
  master.connect(limiter);
  limiter.connect(clip);
  clip.connect(ctx.destination);
  const buses = {};
  for (const name of Object.keys(LEVELS)) {
    buses[name] = ctx.createGain();
    buses[name].gain.value = settings[name] ? LEVELS[name] : 0;
    buses[name].connect(master);
  }
  let ducked = false, hush = 1;
  let live = 0; // one-shot groups still sounding

  const musicTarget = () => (settings.music ? LEVELS.music : 0) * (ducked ? DUCK : 1) * hush;
  function ramp(bus, value) {
    const g = buses[bus].gain;
    const t = ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(value, t + RAMP_S);
  }

  return {
    ctx,
    master,
    limiter,
    out: clip, // the final node: tapped by the captures via __ink.audioMaster()
    buses,
    // A one-shot: build(out) creates its nodes into `out` (a fresh gain on the bus) and returns
    // its sources (already started, with stop() scheduled). When the last one ends, the whole
    // group is disconnected.
    voice(bus, build) {
      if (!settings[bus] || ctx.state !== 'running') return false;
      const out = ctx.createGain();
      out.connect(buses[bus]);
      const nodes = [out];
      const make = (node) => { nodes.push(node); return node; };
      const sources = build(out, make);
      let left = sources.length;
      live += 1;
      for (const s of sources) {
        s.onended = () => {
          left -= 1;
          if (left === 0) { for (const n of nodes) n.disconnect(); live -= 1; }
        };
      }
      return true;
    },
    liveVoices: () => live,
    setEnabled(bus, on) {
      settings[bus] = on;
      ramp(bus, bus === 'music' ? musicTarget() : (on ? LEVELS[bus] : 0));
    },
    enabled: (bus) => !!settings[bus],
    // the voice hook: music down 7 dB while a line plays
    duck(on) { ducked = on; ramp('music', musicTarget()); },
    // the snip's stop-time: music silent for its 0.5 s, then back
    hushMusic(on) { hush = on ? 0 : 1; ramp('music', musicTarget()); },
    // a short -6 dB dip under a stab, then back to wherever the music should be
    dip(seconds = 0.3) {
      const g = buses.music.gain, t = ctx.currentTime, to = musicTarget();
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(to * DIP, t + 0.02);
      g.setValueAtTime(to * DIP, t + seconds);
      g.linearRampToValueAtTime(to, t + seconds + RAMP_S);
    },
    suspend() { return ctx.state === 'running' ? ctx.suspend() : Promise.resolve(); },
    resume() { return ctx.state === 'suspended' ? ctx.resume() : Promise.resolve(); },
  };
}
