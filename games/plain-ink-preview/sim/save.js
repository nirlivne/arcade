// Save shape and sanitiser (design §6, spec §8 Standard v2 "Return loop"). Storage is injected
// (localStorage normally) so this stays node-testable and never throws on a blocked store.

export const KEY = 'plain-ink-preview:v1'; // preview slot only: never shares the live game's save

export function defaults() {
  return {
    v: 1,
    best: null,
    frames: [false, false, false],
    run: null,
    settings: { music: true, sfx: true, voice: true, reduceMotion: false, longGrace: false, leftHanded: false },
    seenEnding: false,
    seenDemo: false,
    taught: false, // THE-1637: the first-10-s tags are done (first hide reached)
  };
}

const isBool = (x) => typeof x === 'boolean';
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const VALID_CPS = new Set(Array.from({ length: 12 }, (_, i) => `cp${i + 1}`));

function sanitizeBest(best) {
  if (!best || typeof best !== 'object') return null;
  if (!isNum(best.timeMs) || !isNum(best.snips)) return null;
  return { timeMs: best.timeMs, snips: best.snips };
}

function sanitizeFrames(frames) {
  const d = [false, false, false];
  if (!Array.isArray(frames)) return d;
  return d.map((_, i) => isBool(frames[i]) ? frames[i] : false);
}

function sanitizeRun(run) {
  if (!run || typeof run !== 'object') return null;
  if (!VALID_CPS.has(run.cp)) return null;
  if (!isNum(run.clockMs) || !isNum(run.snips)) return null;
  if (run.coat !== 'ink' && run.coat !== 'cream') return null;
  return {
    cp: run.cp, clockMs: run.clockMs, snips: run.snips, coat: run.coat,
    negative: isBool(run.negative) ? run.negative : false,
    framesThisRun: sanitizeFrames(run.framesThisRun),
    resolved: Array.isArray(run.resolved) ? run.resolved.filter((id) => typeof id === 'string') : [],
    graceUsed: run.graceUsed === true,
  };
}

function sanitizeSettings(settings) {
  const d = defaults().settings;
  if (!settings || typeof settings !== 'object') return d;
  const out = { ...d };
  for (const k of Object.keys(d)) if (isBool(settings[k])) out[k] = settings[k];
  return out;
}

export function sanitize(obj) {
  const d = defaults();
  if (!obj || typeof obj !== 'object') return d;
  return {
    v: 1,
    best: sanitizeBest(obj.best),
    frames: sanitizeFrames(obj.frames),
    run: sanitizeRun(obj.run),
    settings: sanitizeSettings(obj.settings),
    seenEnding: isBool(obj.seenEnding) ? obj.seenEnding : false,
    seenDemo: isBool(obj.seenDemo) ? obj.seenDemo : false,
    taught: isBool(obj.taught) ? obj.taught : false,
  };
}

// osReduceMotion: the OS prefers-reduced-motion, used only to seed a first-run save (S9 Q4)
export function load(storage, { osReduceMotion = false } = {}) {
  const fresh = () => { const d = defaults(); d.settings.reduceMotion = osReduceMotion; return d; };
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return fresh();
    return sanitize(JSON.parse(raw));
  } catch {
    return fresh();
  }
}

export function write(data, storage) {
  try {
    storage.setItem(KEY, JSON.stringify(data));
  } catch {
    // private mode / storage blocked: play continues with in-memory state only
  }
}
