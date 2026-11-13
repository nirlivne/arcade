// P4 sound (THE-1326): the Web Audio side. SFX buffers come from render/synth.js (our own synthesis, no
// samples). One AudioContext, created on the first user gesture only (unlock(), called from game.js's
// gesture listener), never before. Graph: voices -> sfx / music gains -> master (limiter only) -> out.
// Coins are capped at COIN_VOICES at once (a new one cuts the oldest), so a coin streak can't pile up.
// THE-1353: music and sound are two separate saved toggles on their own buses (musicBus/sfxBus); master
// never mutes anything itself, it only feeds the limiter.
// A14 (THE-1354): the music loop is no longer synthesised -- it's the CC0 track in assets/audio/,
// fetched and decoded lazily (after unlock, same as the old per-frame render pump) so it never slows
// first paint. Opus is tried first (smaller); AAC is the fallback for browsers decodeAudioData can't
// decode Opus on (older Safari/iOS). Loop points come from the Designer's measurement (THE-1351): the
// whole 32.000 s file, no seam.
import { SR, renderSfx, SFX_NAMES, MUSIC_GAIN, SFX_GAIN, COIN_GAIN, COIN_VOICES } from "./synth.js";

const MUSIC_BASE = "./assets/audio/music-happy-beat", MUSIC_LOOP_END = 32.0;

let ctx = null, master = null, sfxBus = null, musicBus = null, musicSrc = null;
let musicEnabled = true, soundEnabled = true, musicOn = false, musicLevel = 1;
const buffers = {}, coinBuffers = [], coinVoices = [];

function toBuffer(arr) { const b = ctx.createBuffer(1, arr.length, SR); b.copyToChannel(arr, 0); return b; }

function canPlayOpus() {
  try { return !!new Audio().canPlayType('audio/ogg; codecs="opus"'); } catch (e) { return false; }
}
function decodeMusic(ext) {
  return fetch(`${MUSIC_BASE}.${ext}`).then((r) => r.arrayBuffer()).then((buf) => ctx.decodeAudioData(buf));
}
function loadMusic() {
  const first = canPlayOpus() ? "opus.ogg" : "m4a", second = first === "opus.ogg" ? "m4a" : "opus.ogg";
  decodeMusic(first).catch(() => decodeMusic(second)).then((decoded) => {
    buffers.music = decoded;
    if (musicOn) { startMusicSource(); music(true, musicLevel); }
  }).catch(() => { /* neither format decoded: the game plays on without music */ });
}

export function unlock() {
  if (ctx) { if (ctx.state === "suspended") ctx.resume().catch(() => {}); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try {
    ctx = new AC();
    const limiter = ctx.createDynamicsCompressor(); // a brick-wall-ish limiter: catches anything the gains miss
    limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.12;
    limiter.connect(ctx.destination);
    master = ctx.createGain(); master.gain.value = 1; master.connect(limiter);
    // A14 safety net (THE-1351): one lowpass at 5 kHz/Q 0.7 between sfxBus and master, so a later sound
    // can't bring the old fizz back. Music doesn't go through it.
    const sfxLowpass = ctx.createBiquadFilter(); sfxLowpass.type = "lowpass"; sfxLowpass.frequency.value = 5000; sfxLowpass.Q.value = 0.7;
    sfxLowpass.connect(master);
    sfxBus = ctx.createGain(); sfxBus.gain.value = soundEnabled ? 1 : 0; sfxBus.connect(sfxLowpass);
    musicBus = ctx.createGain(); musicBus.gain.value = 0; musicBus.connect(master);
    for (const name of SFX_NAMES) if (name !== "coin") buffers[name] = toBuffer(renderSfx(name));
    for (let step = 0; step < 8; step++) coinBuffers.push(toBuffer(renderSfx("coin", { step })));
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    loadMusic();
  } catch (e) { ctx = null; /* no Web Audio: the game plays on silently */ }
}

export function audioState() { return ctx ? ctx.state : "none"; }
// for the oscillator-based honks/thunk in render/sfx.js: the context and the bus they connect to (null
// until the first gesture, so nothing ever creates or resumes a context early)
export function audioOut() { return ctx ? { ctx, out: sfxBus } : null; }

// THE-1353: music and sound are independent saved toggles. setMusicEnabled gates musicBus (combined with
// whatever music(on) last asked for, so a toggle mid-fade doesn't fight the fade); setSoundEnabled gates
// sfxBus directly -- every one-shot (coin, click, honk, thunk) shares that one bus.
export function setMusicEnabled(on) {
  musicEnabled = !!on;
  if (musicBus) musicBus.gain.setTargetAtTime(musicOn && musicEnabled ? MUSIC_GAIN * musicLevel : 0, ctx.currentTime, 0.12);
}
export function setSoundEnabled(on) {
  soundEnabled = !!on;
  if (sfxBus) sfxBus.gain.setTargetAtTime(soundEnabled ? 1 : 0, ctx.currentTime, 0.015);
}

function startMusicSource() {
  if (musicSrc || !ctx || !buffers.music) return; // not decoded yet: loadMusic() starts it when it lands
  musicSrc = ctx.createBufferSource();
  musicSrc.buffer = buffers.music; musicSrc.loop = true; musicSrc.loopStart = 0; musicSrc.loopEnd = MUSIC_LOOP_END;
  musicSrc.connect(musicBus); musicSrc.start();
}
// on: the music plays (fades in); off: it fades out but keeps its place, so a resume picks up mid-phrase.
// musicEnabled (the saved toggle) gates the result either way, same as setMusicEnabled above.
export function music(on, level = 1) {
  musicOn = on; musicLevel = level;
  if (!ctx) return;
  startMusicSource();
  musicBus.gain.setTargetAtTime(on && musicEnabled ? MUSIC_GAIN * level : 0, ctx.currentTime, on ? 0.25 : 0.12);
}

export function play(name, { gain = 1, rate = 1 } = {}) {
  if (!ctx || !buffers[name] || !soundEnabled) return;
  const src = ctx.createBufferSource(), g = ctx.createGain();
  src.buffer = buffers[name]; src.playbackRate.value = rate;
  g.gain.value = SFX_GAIN * gain;
  src.connect(g); g.connect(sfxBus); src.start();
}

export function playCoin(step = 0) {
  if (!ctx || !soundEnabled) return;
  while (coinVoices.length >= COIN_VOICES) { const old = coinVoices.shift(); try { old.stop(); } catch (e) { /* already ended */ } }
  const src = ctx.createBufferSource(), g = ctx.createGain();
  src.buffer = coinBuffers[Math.max(0, Math.min(7, step))];
  g.gain.value = COIN_GAIN;
  src.connect(g); g.connect(sfxBus); src.start();
  coinVoices.push(src);
  src.onended = () => { const i = coinVoices.indexOf(src); if (i >= 0) coinVoices.splice(i, 1); };
}

// tab hidden: stop the clock entirely; back: carry on
export function suspend() { if (ctx && ctx.state === "running") ctx.suspend().catch(() => {}); }
export function resume() { if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {}); }
