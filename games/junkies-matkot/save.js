// One versioned save key, a per-field sanitiser (wrong shape -> defaults, field by field, never
// throws) and injected storage so tests can pass a fake one. Saved at `result` and on any settings change.
export const SAVE_KEY = "junkies-matkot.v1";
const HEAD_IDS = ["dagi", "eitan", "saalem", "shaiko", "yontsi", "nir", "ronzo", "even", "daniel", "miki", "koko"];
const TIERS = ["high", "mid", "low"];
const CPU_LEVELS = ["easy", "medium", "hard"]; // THE-1142 S2 (board note 2)
const PLAY_MODES = ["cpu", "friend"]; // THE-1185 B3 (DESIGN.md §13.6): the play sheet's "נגד מי?" row

function isPlainObject(x) { return !!x && typeof x === "object" && !Array.isArray(x); }

function freshSave() {
  return {
    v: 1,
    lastPicks: [null, null],
    soloPick: null,
    wins: {},
    reduceMotion: null, // null = not yet decided; game.js seeds it from prefers-reduced-motion once
    tier: "high",
    muted: false,
    cpuLevel: "medium",
    soloSide: 0, // THE-1142 S3 (board note 3): 0 = left, 1 = right
    impactTipSeen: false, // THE-1184 S6 (DESIGN.md §13.4): the r3 impact-physics teaching banner, once per device
    playMode: "cpu", // THE-1185 B3: the play sheet's last chosen mode; first run defaults to "cpu"
  };
}

function sanitiseHeadId(raw) { return HEAD_IDS.includes(raw) ? raw : null; }

function sanitiseLastPicks(raw) {
  if (!Array.isArray(raw) || raw.length !== 2) return [null, null];
  return [sanitiseHeadId(raw[0]), sanitiseHeadId(raw[1])];
}

function sanitiseWins(raw) {
  const out = {};
  if (!isPlainObject(raw)) return out;
  for (const id of HEAD_IDS) if (typeof raw[id] === "number" && raw[id] >= 0) out[id] = raw[id];
  return out;
}

export function sanitise(raw) {
  if (!isPlainObject(raw) || raw.v !== 1) return freshSave();
  return {
    v: 1,
    lastPicks: sanitiseLastPicks(raw.lastPicks),
    soloPick: sanitiseHeadId(raw.soloPick),
    wins: sanitiseWins(raw.wins),
    reduceMotion: typeof raw.reduceMotion === "boolean" ? raw.reduceMotion : null,
    tier: TIERS.includes(raw.tier) ? raw.tier : "high",
    muted: typeof raw.muted === "boolean" ? raw.muted : false,
    cpuLevel: CPU_LEVELS.includes(raw.cpuLevel) ? raw.cpuLevel : "medium",
    soloSide: raw.soloSide === 0 || raw.soloSide === 1 ? raw.soloSide : 0,
    impactTipSeen: typeof raw.impactTipSeen === "boolean" ? raw.impactTipSeen : false,
    playMode: PLAY_MODES.includes(raw.playMode) ? raw.playMode : "cpu",
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
  function setLastPicks(picks) { load(); data.lastPicks = sanitiseLastPicks(picks); write(); }
  function setSoloPick(headId) { load(); data.soloPick = sanitiseHeadId(headId); write(); }
  function addWin(headId) { load(); data.wins = { ...data.wins, [headId]: (data.wins[headId] || 0) + 1 }; write(); }
  function setReduceMotion(on) { load(); data.reduceMotion = !!on; write(); }
  function setTier(tier) { load(); data.tier = TIERS.includes(tier) ? tier : data.tier; write(); }
  function setMuted(on) { load(); data.muted = !!on; write(); }
  function setCpuLevel(level) { load(); data.cpuLevel = CPU_LEVELS.includes(level) ? level : data.cpuLevel; write(); }
  function setSoloSide(side) { load(); data.soloSide = side === 0 || side === 1 ? side : data.soloSide; write(); }
  function setImpactTipSeen(on) { load(); data.impactTipSeen = !!on; write(); }
  function setPlayMode(mode) { load(); data.playMode = PLAY_MODES.includes(mode) ? mode : data.playMode; write(); }
  return { load, get, setLastPicks, setSoloPick, addWin, setReduceMotion, setTier, setMuted, setCpuLevel, setSoloSide, setImpactTipSeen, setPlayMode };
}
