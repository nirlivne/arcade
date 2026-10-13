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
  };
}
