// One versioned save key, a sanitiser (wrong-shape -> defaults, keeping valid fields) and injected
// storage. Pure: the caller passes in `storage` (window.localStorage in the browser, a fake in tests).
export const SAVE_KEY = "squawk-7700:v1";
const BEAT_NAMES = ["door", "aisle", "dive", "landing"];
const MEDALS = ["bronze", "silver", "gold"];

function isPlainObject(x) { return !!x && typeof x === "object" && !Array.isArray(x); }

function freshSave() {
  return {
    v: 1,
    best: null,
    beats: Object.fromEntries(BEAT_NAMES.map((n) => [n, { cleared: false, medal: null, bestScore: null }])),
    daily: null,
    demoSeen: Object.fromEntries(BEAT_NAMES.map((n) => [n, false])),
    run: null,
    settings: { sound: true, motion: false, haptics: true }, // motion = reduced-motion ON; off by default
  };
}

function sanitiseBeats(raw) {
  const out = {};
  for (const name of BEAT_NAMES) {
    const b = isPlainObject(raw) ? raw[name] : null;
    out[name] = isPlainObject(b)
      ? { cleared: !!b.cleared, medal: MEDALS.includes(b.medal) ? b.medal : null, bestScore: typeof b.bestScore === "number" ? b.bestScore : null }
      : { cleared: false, medal: null, bestScore: null };
  }
  return out;
}

const MEDAL_OR_NULL = (m) => (MEDALS.includes(m) ? m : null);

function sanitiseBest(raw) {
  if (!isPlainObject(raw)) return null;
  if (typeof raw.score !== "number" || typeof raw.clockSteps !== "number" || typeof raw.bumps !== "number" || typeof raw.date !== "string") return null;
  const medals = Array.isArray(raw.medals) && raw.medals.length === 4 ? raw.medals.map(MEDAL_OR_NULL) : [null, null, null, null];
  return { score: raw.score, clockSteps: raw.clockSteps, bumps: raw.bumps, date: raw.date, medals };
}

function sanitiseRun(raw) {
  if (!isPlainObject(raw)) return null;
  if (typeof raw.seed !== "number" || typeof raw.beat !== "string") return null;
  return {
    seed: raw.seed,
    beat: raw.beat,
    checkpoint: raw.checkpoint === "final" ? "final" : "start",
    clockSteps: typeof raw.clockSteps === "number" ? raw.clockSteps : 0,
    fails: typeof raw.fails === "number" ? raw.fails : 0,
    attemptOpen: !!raw.attemptOpen,
    carry: isPlainObject(raw.carry) && typeof raw.carry.rudder === "number" ? { rudder: raw.carry.rudder } : { rudder: 1 },
    final: isPlainObject(raw.final) ? { bumps: typeof raw.final.bumps === "number" ? raw.final.bumps : 0 } : null,
  };
}

function sanitiseDaily(raw) {
  if (!isPlainObject(raw)) return null;
  if (typeof raw.date !== "string" || typeof raw.n !== "number") return null;
  return { date: raw.date, n: raw.n, best: sanitiseBest(raw.best), reachedBeat: BEAT_NAMES.includes(raw.reachedBeat) ? raw.reachedBeat : null };
}

function sanitiseDemoSeen(raw) {
  const out = {};
  for (const name of BEAT_NAMES) out[name] = isPlainObject(raw) ? !!raw[name] : false;
  return out;
}

function sanitiseSettings(raw) {
  const d = { sound: true, motion: false, haptics: true };
  if (!isPlainObject(raw)) return d;
  return {
    sound: typeof raw.sound === "boolean" ? raw.sound : d.sound,
    motion: typeof raw.motion === "boolean" ? raw.motion : d.motion,
    haptics: typeof raw.haptics === "boolean" ? raw.haptics : d.haptics,
  };
}

export function sanitise(raw) {
  if (!isPlainObject(raw) || raw.v !== 1) return freshSave();
  return {
    v: 1,
    best: sanitiseBest(raw.best),
    beats: sanitiseBeats(raw.beats),
    daily: sanitiseDaily(raw.daily),
    demoSeen: sanitiseDemoSeen(raw.demoSeen),
    run: sanitiseRun(raw.run),
    settings: sanitiseSettings(raw.settings),
  };
}

export function createSave(storage, key = SAVE_KEY) {
  let data = null;
  function load() {
    if (data) return data;
    let raw = null;
    try { raw = JSON.parse(storage.getItem(key)); } catch (e) { raw = null; }
    data = sanitise(raw);
    return data;
  }
  function write() {
    try { storage.setItem(key, JSON.stringify(data)); } catch (e) { /* storage blocked: play on, nothing saved */ }
  }
  function get() { return load(); }
  function setBeat(name, patch) { load(); data.beats[name] = { ...data.beats[name], ...patch }; write(); }
  function setBest(best) { load(); data.best = best; write(); }
  function setDaily(daily) { load(); data.daily = daily; write(); }
  function setRun(run) { load(); data.run = run; write(); }
  function setDemoSeen(name) { load(); data.demoSeen[name] = true; write(); }
  function setSettings(patch) { load(); data.settings = { ...data.settings, ...patch }; write(); }
  return { load, get, setBeat, setBest, setDaily, setRun, setDemoSeen, setSettings };
}
