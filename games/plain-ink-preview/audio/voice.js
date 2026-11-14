// The 6 baked Hebrew voice files (S7 THE-1563, design §8): fetched and decoded at load with an
// OfflineAudioContext (no gesture needed, no live context before PLAY), then played on the mixer's
// voice bus with the music ducked -7 dB while a line plays. The game never calls Gemini.
const loaded = {};

export function preloadVoice(ids, base = 'voice/') {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OAC) return Promise.resolve();
  const dec = new OAC(1, 1, 44100);
  return Promise.all(ids.map((id) => fetch(`${base}${id}.mp3`)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then((b) => dec.decodeAudioData(b))
    .then((buf) => { loaded[id] = buf; })
    .catch(() => {}))); // a missing file = strip only for that line
}

export function createVoice(mixer) {
  let src = null;
  function stop() {
    if (!src) return;
    const s = src;
    src = null;
    mixer.duck(false);
    try { s.stop(); } catch { /* already ended */ }
  }
  return {
    // true if the line started (voice on, context running, file decoded)
    play(id) {
      stop();
      const buf = loaded[id];
      if (!buf) return false;
      let s = null;
      const ok = mixer.voice('voice', (out, make) => {
        s = make(mixer.ctx.createBufferSource());
        s.buffer = buf;
        s.connect(out);
        s.start();
        return [s];
      });
      if (!ok) return false;
      src = s;
      mixer.duck(true);
      s.addEventListener('ended', () => { if (src === s) { src = null; mixer.duck(false); } });
      return true;
    },
    stop,
    playing: () => !!src,
  };
}

export const voiceLoaded = () => Object.keys(loaded);
