// The daily seed, No.N counter, and the share text (launch kit THE-730, spec §2d). Pure: no DOM, no
// three.js; `theme` is passed in (never read from window) so this stays testable under plain node and
// re-skinnable from theme.js alone. Two RNG streams for a run come from rng.js's createStreams; this
// file only turns a local calendar date into the one seed every player gets that day.
import { seedFromDate, dayNumber, mulberry32 } from "./rng.js";

const DEFAULT_EPOCH = (typeof window !== "undefined" && window.THEME && window.THEME.DAY_EPOCH) || "2026-10-15";

// The player's own local calendar date as YYYY-MM-DD, from getFullYear/getMonth/getDate - never
// toISOString(), which is UTC and names the wrong day for part of every day off UTC.
export function localDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export { dayNumber };

export function dailyRunSeed(localYMD) {
  return seedFromDate(localYMD);
}

export function todaySeed(date = new Date(), epoch = DEFAULT_EPOCH) {
  const ymd = localDateString(date);
  // Clamp to No.1 (sign-off r1 D3, THE-756): a local date before DAY_EPOCH (a clock set wrong, or
  // testing ahead of launch day) must never show "No.0" or lower.
  return { seed: dailyRunSeed(ymd), n: Math.max(1, dayNumber(ymd, epoch)), date: ymd };
}

// A deterministic "weather" line from the daily seed (sign-off r1 D2-1, THE-756): a fictional wind
// heading/speed and turbulence reading, the same for every player on a given day. Cosmetic only.
export function dailyWeather(seed) {
  const r = mulberry32((seed ^ 0x51a7f3d2) >>> 0);
  const heading = Math.round(r() * 35) * 10; // 0-350, step 10
  const speed = 3 + Math.round(r() * 12); // 3-15 kt
  const turb = Math.round((0.4 + r() * 1.6) * 10) / 10; // 0.4-2.0
  return { wx: `${String(heading).padStart(3, "0")}/${String(speed).padStart(2, "0")}`, turb: turb.toFixed(1) };
}

export function formatClock(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

// run: { n, clockSteps, bumps, medals } for a completed run, or { n, reachedBeat } when none completed
// today (variant C). url: the arcade link. theme: window.THEME-shaped (title, text.shareA/B/C,
// beatNamesLocative). The link goes on its own line (bidi-safe: an RTL line ending right at a URL can
// scramble the URL's own digits/slashes - the #10/THE-683 lesson).
export function shareText(run, url, theme) {
  const n = String(run.n);
  if (!run.clockSteps) {
    const beat = theme.beatNamesLocative[run.reachedBeat] || "";
    const line = theme.text.shareC.replace("{title}", theme.title).replace("{n}", n).replace("{beat}", beat);
    return `${line}\n${url}`;
  }
  const time = formatClock(run.clockSteps / 60);
  const allGold = Array.isArray(run.medals) && run.medals.length === 4 && run.medals.every((m) => m === "gold");
  const template = allGold ? theme.text.shareB : theme.text.shareA;
  const line = template.replace("{title}", theme.title).replace("{n}", n).replace("{time}", time).replace("{bumps}", String(run.bumps));
  return `${line}\n${url}`;
}
