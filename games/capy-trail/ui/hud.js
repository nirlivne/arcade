import { STRIKE_WINDOW_T } from "../sim/sim.js";

const CHASER_RING_CIRCUMFERENCE = 2 * Math.PI * 15; // matches style.css's ct-chaser-ring-fill r=15

// The running HUD: coin pebble, score + distance (THE-1407 slice 6; was distance + best) or the level
// progress bar in a level run (THE-1412), pause pebble (spec §6), and the A12.4 chaser pip. Reads sim
// state; never writes it.
export function createHud({ hudEl, coinsEl, coinPebbleEl, scoreWrapEl, scoreEl, multEl, scoreSubEl, levelHudProgressEl, pauseBtn, chaserPipEl, chaserRingFillEl }, { onPause, theme } = {}) {
  pauseBtn.addEventListener("click", () => onPause?.());

  // THE-1407 (score-missions/README.md): "the first frame score > bestScore, add is-best to .ct-score
  // once (one pop)" -- once per run, reset whenever the HUD is shown for a fresh run.
  let poppedBest = false;

  function show(on) {
    hudEl.hidden = !on;
    if (on) { poppedBest = false; scoreWrapEl.classList.remove("is-best"); coinPebbleEl.classList.remove("is-target-met"); }
  }
  function update(state, bestScore) {
    coinsEl.textContent = String(state.coins);
    if (state.level) {
      // THE-1412 (levels/README.md "Level HUD"): progress to the finish, and the coin chip turns leaf
      // green once this run's coins reach the level's star-2 target (fires once, no sound -- the CSS ring
      // alone is the read, same as the designer's note).
      const p = Math.max(0, Math.min(1, state.s / state.level.finishS));
      levelHudProgressEl.style.setProperty("--p", String(p));
      levelHudProgressEl.setAttribute("aria-valuenow", String(Math.round(p * 100)));
      coinPebbleEl.classList.toggle("is-target-met", state.coins >= state.level.coinTarget);
    } else {
      scoreEl.textContent = state.score.toLocaleString("en-US");
      multEl.hidden = state.scoreMult === 1;
      if (!multEl.hidden) multEl.textContent = `×${state.scoreMult}`;
      if (!poppedBest && state.score > bestScore) { poppedBest = true; scoreWrapEl.classList.add("is-best"); }
      const distText = `${Math.round(state.s)} m`;
      // README "The HUD sub-line's 'new best' reuses the existing theme.text.newBest."
      scoreSubEl.innerHTML = poppedBest ? `<span id="hudDistance">${distText}</span> · ${theme.text.newBest}` : `<span id="hudDistance">${distText}</span>`;
    }
    // A12.4: the pip (and its draining ring) tracks an active strike only -- the run-start opening's own
    // 0-3 s close period has no strike (state.chaser.strikeT stays 0 through it), so it stays hidden there.
    const chasing = state.chaser.strikeT > 0;
    if (chaserPipEl) chaserPipEl.hidden = !chasing;
    if (chasing && chaserRingFillEl) {
      const progress = Math.max(0, Math.min(1, state.chaser.strikeT / STRIKE_WINDOW_T));
      chaserRingFillEl.style.strokeDashoffset = String(CHASER_RING_CIRCUMFERENCE * (1 - progress));
    }
  }
  return { show, update };
}
