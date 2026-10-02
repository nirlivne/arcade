// Captain Fold demo.js: the first-run demo (spec S5, G6-A10/CTO decision on THE-264: required, on the never-cut
// list). An ~9 s scripted run of course 1-1 through the REAL flight loop (core.js/flight.js, not a fake
// animation), so what it shows is exactly what play looks like. Navigation is the real pilot() bot
// (tools/captain-fold/bots.mjs) - the same "informed but not perfect" policy the engagement gate is built on -
// except for one deliberate forced-climb window (verified against 1-1's fixed seed) that turns what would
// otherwise be a clean landing into a bounce off the first obstacle, so the fail-rule beat actually happens
// on screen. It closes with a real-time (not flight-clock) pan to the blanket, "land here" (THE-311, DESIGN.md
// S4 step 6), since the scripted flight itself never reaches a landing. Any tap skips straight to the end callback.
import { P, obstacleY, newFlight, step, DT } from "./core.js";

const FORCE_CLIMB_FROM_S = 4.5; // verified: this window bounces off the first "hang" obstacle at x=1320
const FORCE_CLIMB_TO_S = 5.8;
const END_AT_S = 7.5; // stop shortly after the bounce settles, before the flight naturally recovers and continues
const PULL_MS = 900; // the pre-flight "pull back" beat (ghost finger only; no physics yet)
const PAN_MS = 1400; // THE-311: the closing "camera pans to the blanket" beat (DESIGN.md S4 step 6)

// CTO review B5: caption text is re-skinnable (theme.text.demoCaption1..4; demoCaption5 is the closing "land
// here" beat, read directly off `captions.landHere` below rather than through this flight-clock-indexed table
// since it plays after the flight's own clock has stopped), with these as the built-in defaults for a re-skin
// that doesn't touch them. demo.js stays a pure module with no window.THEME access of its own - game.js passes
// the resolved strings in via deps.captions.
function buildCaptions(captions = {}) {
  return [
    { atS: -1, text: captions.pull || "Pull back, then let go" }, // -1: during the pre-flight pull beat
    { atS: 0.3, text: captions.holdClimb || "Hold to climb · let go to dive" },
    { atS: FORCE_CLIMB_FROM_S + 0.3, text: captions.crumpleWarning || "After 20 s, a bump crumples the plane" },
    { atS: 5.94, text: captions.bounceInfo || "Before that, a bump just bounces" },
  ];
}

// A minimal copy of tools/captain-fold/bots.mjs's pilot() route-follower, for the demo only. Nothing from
// tools/ ships in a game folder (design-toolkit) - bots.mjs is a QA/dev-only harness, so the ~25 lines the demo
// actually needs are duplicated here rather than imported. Keep in sync by hand if the CTO retunes the bot;
// they're small and rarely change (last touched for the zone-dive fix, THE-264).
function pilotDecide(f, c) {
  const target = demoTargetHeight(f, c);
  const lookT = 0.35;
  const predY = f.y + (f.v * Math.sin(f.a) - P.SINK) * lookT;
  const err = target - predY;
  const want = Math.max(-P.MAX_ANGLE, Math.min(P.MAX_ANGLE, err / 160));
  if (f.v < P.VSTALL * 1.27 && f.a > -0.2) return false;
  return f.a < want;
}

function demoTargetHeight(f, c) {
  if (f.x > c.landStart - 900) {
    const dx = c.bullseye - f.x;
    return f.x < c.landStart ? Math.max(0, Math.min(250, dx * 0.12)) : -60;
  }
  const ahead = c.obstacles.filter((o, i) => o.x + o.w > f.x - 10 && !f.knocked.has(i)).sort((a, b) => a.x - b.x)[0];
  const energy = f.y + (f.v * f.v) / (2 * P.G);
  const up = c.air.find((a) => (a.kind === "up" || a.kind === "fan") && a.x + a.w > f.x && a.x - f.x < 900);
  if (up && energy < 420) return (up.y0 + up.y1) / 2;
  if (!ahead) return up ? (up.y0 + up.y1) / 2 : 300;
  const tArrive = f.t + Math.max(0, ahead.x - f.x) / Math.max(60, f.v);
  const [y0, y1] = obstacleY(ahead, tArrive);
  const lo = ahead.kind === "hang" ? 0 : ahead.y0 === 0 || ahead.kind === "rise" || ahead.kind === "wide" ? y1 : 0;
  const hi = ahead.kind === "hang" ? y0 : P.CEILING;
  if (ahead.kind === "float" || ahead.kind === "bob") {
    const above = P.CEILING - y1, below = y0;
    return above > below ? (y1 + P.CEILING) / 2 : Math.max(60, y0 / 2);
  }
  return (lo + hi) / 2;
}

const MAX_FRAME_DT_S = 0.1; // matches flight.js's MAX_FRAME_DT: a stalled tab never causes a catch-up burst

// Runs the demo. `deps`: { course, drawWorld, ctx, getViewSize, ghostEl, captionEl, onDone(), onEvent(ev),
// captions }. `captions` is optional (theme.text.demoCaption1..5, see buildCaptions and LAND_HERE_TEXT below)
// and falls back to the built-in English copy. `onEvent` is optional (tests use it to confirm the scripted
// bounce actually happens; the game itself doesn't need it since demo.js drives its own rendering). `raf` is
// injected (defaults to requestAnimationFrame) so tests can drive it deterministically.
export function runDemo({ course, drawWorld, ctx, getViewSize, ghostEl, captionEl, onDone, onEvent, captions }, raf = requestAnimationFrame) {
  const CAPTIONS = buildCaptions(captions);
  const LAND_HERE_TEXT = captions?.landHere || "Land here";
  let stopped = false;
  let phase = "pull"; // "pull" | "flight" | "pan" | "done"
  let f = null;
  let n = 0;
  let pullStartTs = null;
  let lastFrameTs = null;
  let panStartTs = null;
  let panFromX = 0;
  let acc = 0; // CTO review B4: a real fixed-step accumulator (as flight.js uses), not a fixed step count per
  // rAF callback - the old code advanced the same ~6 physics steps every callback regardless of how much real
  // time had actually passed, so the scripted bounce and its caption drifted out of sync with the frame rate
  // (covering too little flight time at 30Hz, too much at 120Hz) instead of running at a fixed real-time pace.

  function setCaption(text) {
    if (captionEl) captionEl.textContent = text || "";
  }

  function setGhost(held) {
    if (ghostEl) ghostEl.classList.toggle("is-down", !!held);
  }

  function currentCaption(tS) {
    let text = "";
    for (const c of CAPTIONS) if (tS >= c.atS) text = c.text;
    return text;
  }

  function finish() {
    if (stopped) return;
    stopped = true;
    phase = "done";
    setCaption("");
    setGhost(false);
    onDone();
  }

  function frame(ts) {
    if (stopped) return;
    if (phase === "pull") {
      if (pullStartTs == null) pullStartTs = ts;
      setCaption(currentCaption(-1));
      setGhost(true);
      if (ts - pullStartTs >= PULL_MS) {
        phase = "flight";
        f = newFlight(course, 1);
        setGhost(false);
      }
      raf(frame);
      return;
    }
    if (phase === "pan") {
      // THE-311: a real-time pan (not keyed to f.t, which is frozen here) from wherever the flight ended to the
      // blanket's centre, so the demo closes on the goal instead of stopping cold on the bounce.
      const tRaw = panStartTs == null ? 0 : Math.min(1, (ts - panStartTs) / PAN_MS);
      const te = 1 - (1 - tRaw) * (1 - tRaw); // ease-out: fast start, settles into the blanket
      const camX = panFromX + (course.bullseye - panFromX) * te;
      const { viewW, viewH } = getViewSize();
      drawWorld(ctx, viewW, viewH, course, { f }, { camX });
      if (tRaw >= 1) { finish(); return; }
      raf(frame);
      return;
    }
    const frameDt = lastFrameTs == null ? 0 : Math.min(MAX_FRAME_DT_S, Math.max(0, (ts - lastFrameTs) / 1000));
    lastFrameTs = ts;
    acc += frameDt;
    const every = Math.round(280 / 1000 / DT);
    let held = f._lastHeld ?? false;
    while (acc >= DT && !f.over) {
      // f.t is the flight's own clock (core.js advances it by exactly DT per step()) - every scripted beat
      // (the forced-climb window, the captions, the end time) is keyed off it, not wall-clock ts, so the demo
      // plays at a fixed real-time pace regardless of the actual frame rate (CTO review B4).
      if (f.t >= END_AT_S) break;
      if (f.t >= FORCE_CLIMB_FROM_S && f.t < FORCE_CLIMB_TO_S) held = true;
      else if (n % every === 0) held = pilotDecide(f, course);
      f._lastHeld = held;
      const ev = step(f, course, held);
      if (ev) onEvent?.(ev);
      n++;
      acc -= DT;
    }
    setGhost(held);
    setCaption(currentCaption(f.t));
    const { viewW, viewH } = getViewSize();
    drawWorld(ctx, viewW, viewH, course, { f });
    if (f.over || f.t >= END_AT_S) {
      phase = "pan";
      panStartTs = ts;
      panFromX = f.x;
      setCaption(LAND_HERE_TEXT);
      raf(frame);
      return;
    }
    raf(frame);
  }

  function skip(e) {
    e?.preventDefault?.();
    finish();
  }

  raf(frame);
  return { skip };
}
