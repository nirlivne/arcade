// THE-1412 (levels/README.md "Level map"): builds the 12 <li> nodes from sim/levels.js + the save's own
// stars/unlock state -- nothing here is hand-written per level in index.html. CSS-only states/animation
// (is-current/is-selected/is-locked, the stamp) already ship in skin.css's "slice 8" block.
import { LEVELS, LEVELS_LIVE } from "../sim/levels.js";
import { isUnlocked, totalStars as sumStars } from "../sim/level-stars.js";

function bitCount(n) { return (n & 1) + ((n >> 1) & 1) + ((n >> 2) & 1); }
const STAR_I = [0, 1, 2]; // finish, coins, no-hits -- README's stated order

export function createLevelMap({ trailEl, totalEl, totalTextEl, goalNameEl, goalsEl, playBtn }, { onPlay } = {}) {
  let stars = new Array(12).fill(0);
  let selected = 0;

  function currentIndex() {
    const i = stars.findIndex((m) => !(m & 1));
    return i === -1 ? 11 : i;
  }

  function nodeHtml(i) {
    const level = LEVELS[i];
    const live = i < LEVELS_LIVE;
    const unlocked = isUnlocked(stars, i);
    // THE-1412 (CTO call, THE-1412 description): a level past this slice's LEVELS_LIVE reads distinctly
    // from an earned-but-not-yet-unlocked one -- same sunken/disabled .is-locked look (so it never reads
    // as tappable), but "soon" in place of its number and in its label, not a padlock implying "almost
    // there". Flagged for CTO review in the hand-off: no new CSS class exists for a 3rd node state.
    const locked = !live || !unlocked;
    const current = i === currentIndex();
    const isSelected = i === selected;
    const n = bitCount(stars[i]);
    const label = !live ? `Level ${i + 1}, coming soon` : !unlocked ? `Level ${i + 1}, locked` : `Level ${i + 1}, ${level.name}, ${n} of 3 stars`;
    const cls = ["ct-node", current && !locked ? "is-current" : "", isSelected && !locked ? "is-selected" : "", locked ? "is-locked" : "", !live ? "is-soon" : ""].filter(Boolean).join(" ");
    const numText = !live ? "soon" : String(i + 1);
    const starsHtml = STAR_I.map((b) => `<i class="ct-star${stars[i] & (1 << b) ? " is-on" : ""}" aria-hidden="true"></i>`).join("");
    return `<li><button class="${cls}" data-level="${i}" aria-label="${label}"${locked ? " disabled" : ""}>`
      + `<span class="ct-node__num">${numText}</span></button>`
      + `<span class="ct-stars" aria-hidden="true">${starsHtml}</span></li>`;
  }

  function renderFooter() {
    const level = LEVELS[selected];
    const live = selected < LEVELS_LIVE;
    const unlocked = isUnlocked(stars, selected);
    const mask = stars[selected];
    goalNameEl.textContent = `${level.n} · ${level.name}`;
    const goal = (on, label) => `<span class="ct-goal${on ? " is-on" : ""}"><i class="ct-star${on ? " is-on" : ""}" aria-hidden="true"></i>${label}</span>`;
    goalsEl.innerHTML = goal(!!(mask & 1), "Finish") + goal(!!(mask & 2), `${level.coinTarget} coins`) + goal(!!(mask & 4), "No hits");
    const playable = live && unlocked;
    playBtn.disabled = !playable;
    playBtn.textContent = playable ? "Play" : !live ? "Soon" : "Locked";
  }

  function render() {
    trailEl.innerHTML = LEVELS.map((_, i) => nodeHtml(i)).join("");
    const total = sumStars(stars);
    totalTextEl.textContent = `${total}/36`;
    totalEl.setAttribute("aria-label", `${total} of 36 stars`);
    renderFooter();
    for (const btn of trailEl.querySelectorAll(".ct-node")) {
      btn.addEventListener("click", () => {
        const i = Number(btn.dataset.level);
        if (i === selected) { if (!btn.disabled) onPlay?.(i); return; } // tap again -> play (README)
        selected = i;
        render();
        btn.focus();
      });
    }
  }

  // show(savedStars): open the map against the latest save; selection resets to the current (next-to-beat)
  // level every time the map opens (README: "Selecting doesn't change is-current", starts there).
  function show(savedStars) {
    stars = savedStars.slice();
    selected = currentIndex();
    render();
  }

  playBtn.addEventListener("click", () => { if (!playBtn.disabled) onPlay?.(selected); });

  return { show, totalStars: () => sumStars(stars) };
}
