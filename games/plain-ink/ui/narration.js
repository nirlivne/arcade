// The 6 Hebrew lines (spec §3.5, S7 THE-1563): when each fires, how long its strip holds, and the
// once-per-run queue. Pure: game.js feeds it the sim's state edges and events, and plays what starts.
import { DT } from '../sim/physics.js';

export const LINES = ['briefing', 'firstHide', 'closeCall', 'riddleSolved', 'reveal', 'ending'];

// voice length per line, from tools/plain-ink-voice-report.json (THE-1548: all 6 shipped). Baked so
// the hold is the same with voice or sound off (THE-1563 Q5).
const VOICE_SEC = { briefing: 4.66, firstHide: 4.64, closeCall: 4.67, riddleSolved: 4.19, reveal: 4.5, ending: 4.38 };

// on screen >= max(2.2 s, voice + 0.6 s)
export const holdTicks = (id) => Math.ceil(Math.max(2.2, (VOICE_SEC[id] ?? 0) + 0.6) / DT - 1e-9);

const EVENT_LINE = { closeCall: 'closeCall', riddleSolved: 'riddleSolved', ended: 'ending' };

// line ids triggered by one sim step (unfiltered; narrate() drops repeats)
export function triggers(prev, next, events) {
  const ids = [];
  if (next.hidden && !prev.hidden) ids.push('firstHide');
  if (next.revealed && !prev.revealed) ids.push('reveal');
  for (const e of events) if (EVENT_LINE[e.type]) ids.push(EVENT_LINE[e.type]);
  return ids;
}

// a fresh run: the briefing is queued for t = 0 unless already spent (Continue)
export function newNarration(spent = []) {
  return narrate({ fired: [...spent], queue: [], current: null, left: 0 }, ['briefing']);
}

export function narrate(n, ids) {
  const fresh = ids.filter((id, i) => !n.fired.includes(id) && ids.indexOf(id) === i);
  if (!fresh.length) return n;
  return { ...n, fired: [...n.fired, ...fresh], queue: [...n.queue, ...fresh] };
}

// one sim tick: the current strip counts down; when it ends the next queued line starts
export function tickNarration(n) {
  let { queue, current, left } = n;
  let ended = null, started = null;
  if (current && --left <= 0) { ended = current; current = null; }
  if (!current && queue.length) {
    [started, ...queue] = queue;
    current = started;
    left = holdTicks(started); // shown on this tick and the next hold - 1
  }
  return { n: { ...n, queue, current, left }, started, ended };
}

// Continue resumes the same run (THE-1563 Q2): the lines whose beats lie behind the saved
// checkpoint count as spent. A save only exists from cp1 on (past the first hide).
export function continueSpent(cp, resolved, level) {
  const order = level.checkpoints.map((c) => c.id);
  const spent = ['briefing', 'firstHide'];
  if (order.indexOf(cp) >= order.indexOf('cp2')) spent.push('closeCall');
  const riddleIds = level.SEEK_PIECES.filter((p) => p.riddle || p.opens === 'lift').map((p) => p.id);
  if (resolved.some((id) => riddleIds.includes(id))) spent.push('riddleSolved');
  return spent;
}
