// S3 Challenge: the chunk picker (plan: "weighted by distance tier, never repeats the last 2 chunks").
// Spec §3 difficulty mix table by distance band, read left-to-right as the exact boundary semantics
// ("0-500 m" is [0, 500), "500-1200 m" is [500, 1200), etc. -- each band starts where the previous ends).
import { CHUNKS } from "./chunks.js";

const BANDS = [
  { from: 0, mix: { easy: 1, medium: 0, hard: 0 } },
  { from: 500, mix: { easy: 0.4, medium: 0.6, hard: 0 } },
  { from: 1200, mix: { easy: 0, medium: 0.6, hard: 0.4 } },
  { from: 2000, mix: { easy: 0, medium: 0.3, hard: 0.7 } },
];

export function difficultyMixAt(s) {
  let mix = BANDS[0].mix;
  for (const b of BANDS) if (s >= b.from) mix = b.mix;
  return mix;
}

const BY_TIER = { easy: CHUNKS.filter((c) => c.tier === "easy"), medium: CHUNKS.filter((c) => c.tier === "medium"), hard: CHUNKS.filter((c) => c.tier === "hard") };

function pickTier(rng, mix) {
  const r = rng();
  let acc = 0;
  for (const tier of ["easy", "medium", "hard"]) {
    acc += mix[tier];
    if (r < acc) return tier;
  }
  return "hard"; // floating-point edge: r landed exactly on/past the accumulated total
}

// `lastTwoIds` is [secondToLast, last] (oldest first), matching how the caller slides its own window --
// a fresh array each call is fine, this has no state of its own (the caller owns picking history).
export function pickChunk(rng, s, lastTwoIds) {
  const mix = difficultyMixAt(s);
  for (let attempt = 0; attempt < 50; attempt++) {
    const tier = pickTier(rng, mix);
    const pool = BY_TIER[tier];
    const c = pool[Math.floor(rng() * pool.length)];
    if (!lastTwoIds.includes(c.id)) return c;
  }
  // Exhausted retries (pathological: a tier's pool is too small to avoid both of the last 2) -- fall back
  // to any chunk across all tiers that isn't one of the last 2, so the picker never actually repeats.
  const anyOk = CHUNKS.find((c) => !lastTwoIds.includes(c.id));
  return anyOk ?? CHUNKS[0];
}
