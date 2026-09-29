// Petal Patch render: builds/updates the board and HUD DOM per the designer's class contract
// (DESIGN.md §1). State lives in attributes; skin.css does every visual rule. This file never decides
// game rules -- only draws what model.mjs/game.js tell it to. Browser-only ES module.

import { bedColors, rc } from "./rules.mjs";
import { displayCellKind } from "./model.mjs";

const MARK_MAP = { empty: "none", mark: "x", autoX: "auto", red: "red", bug: "bug" };

function art() { return window.PETAL_ART || {}; }

// theme.js image slots are paths in the game folder, never SVG strings (DESIGN.md §1.1 amendment, THE-180
// review fix 4): a set slot renders as an <img>, never through innerHTML. `null`/unset falls back to the
// drawn PETAL_ART default.
function themeImagePath(slot) {
  const v = window.THEME && window.THEME.images && window.THEME.images[slot];
  return typeof v === "string" && v ? v : null;
}

export function buildBoard(boardEl, board) {
  boardEl.innerHTML = "";
  boardEl.dataset.size = String(board.n);
  boardEl.style.setProperty("--n", board.n);
  boardEl.removeAttribute("data-wilted");
  boardEl.removeAttribute("data-locked");
  const colors = bedColors(board.n, board.beds);
  for (let i = 0; i < board.n * board.n; i++) {
    const [r, c] = rc(i, board.n);
    const bed = board.beds[i];
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "cell";
    cell.dataset.cell = String(i);
    cell.dataset.bed = String(colors[bed]);
    let h = "";
    if (r > 0 && board.beds[i - board.n] !== bed) h += "t";
    if (c < board.n - 1 && board.beds[i + 1] !== bed) h += "r";
    if (r < board.n - 1 && board.beds[i + board.n] !== bed) h += "b";
    if (c > 0 && board.beds[i - 1] !== bed) h += "l";
    if (h) cell.dataset.h = h;
    cell.dataset.mark = "none";
    cell.tabIndex = i === 0 ? 0 : -1;
    boardEl.appendChild(cell);
  }
}

function describeCell(r, c, mark) {
  const suffix = mark === "bug" ? ", a ladybug" : mark === "x" || mark === "auto" ? ", ruled out" : mark === "red" ? ", a mistake" : "";
  return `Row ${r + 1}, column ${c + 1}${suffix}`;
}

export function drawBoard(boardEl, board, state, showAutoX = true) {
  const bloomOrder = state.bugs.map((cell) => board.beds[cell]);
  for (let i = 0; i < board.n * board.n; i++) {
    const el = boardEl.querySelector(`[data-cell="${i}"]`);
    if (!el) continue;
    const kind = displayCellKind(state, board, i, showAutoX);
    const mark = MARK_MAP[kind];
    el.dataset.mark = mark;
    el.tabIndex = -1;
    const [r, c] = rc(i, board.n);
    el.setAttribute("aria-label", describeCell(r, c, mark));
    if (mark === "bug") {
      if (!el.querySelector(".bug")) {
        const pieceSrc = themeImagePath("pieceSvg");
        if (pieceSrc) {
          const img = document.createElement("img");
          img.className = "bug";
          img.src = pieceSrc;
          img.alt = "";
          el.appendChild(img);
        } else {
          el.innerHTML = `<span class="bug">${art().bug || ""}</span>`;
        }
      }
    } else if (!el.classList.contains("is-flyoff-hold")) {
      el.innerHTML = "";
    }
    const bedIdx = board.beds[i];
    if (state.solved) {
      el.dataset.bloom = "";
      el.style.setProperty("--bloom", String(bloomOrder.indexOf(bedIdx)));
    } else {
      el.removeAttribute("data-bloom");
      el.style.removeProperty("--bloom");
    }
    if (state.wilted && board.sol[r] === c && mark !== "bug") el.dataset.ghost = "";
    else el.removeAttribute("data-ghost");
  }
  const first = boardEl.querySelector('[data-cell="0"]');
  if (first && ![...boardEl.querySelectorAll(".cell")].some((c) => c.tabIndex === 0)) first.tabIndex = 0;
  boardEl.toggleAttribute("data-wilted", !!state.wilted);
  boardEl.toggleAttribute("data-locked", !!state.wilted || !!state.solved);
}

export function setFocusable(boardEl, cell) {
  for (const el of boardEl.querySelectorAll(".cell")) el.tabIndex = Number(el.dataset.cell) === cell ? 0 : -1;
}

export function renderFlower(flowerEl, petals, wilted) {
  if (!flowerEl.firstElementChild) {
    const lifeSrc = themeImagePath("lifeSvg");
    if (lifeSrc) {
      const img = document.createElement("img");
      img.className = "flower-img";
      img.src = lifeSrc;
      img.alt = "";
      flowerEl.appendChild(img);
    } else {
      flowerEl.innerHTML = art().flower || "";
    }
  }
  flowerEl.dataset.petals = String(petals);
  flowerEl.setAttribute("aria-label", `${petals} petals`);
  flowerEl.toggleAttribute("data-wilted", !!wilted);
  const petalEls = flowerEl.querySelectorAll(".petal[data-i]");
  petalEls.forEach((p) => {
    const i = Number(p.dataset.i);
    p.classList.toggle("is-lost", i >= petals);
  });
}

export function renderClock(clockEl, ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  clockEl.textContent = `${m}:${String(s).padStart(2, "0")}`;
}

export function renderStarTargets(el, stars, maxStars = 3) {
  const spans = el.querySelectorAll(".star");
  spans.forEach((s, i) => s.toggleAttribute("data-on", i < stars));
}

export function renderPar(el, par) {
  el.textContent = par ? `par ${Math.floor(par / 60)}:${String(par % 60).padStart(2, "0")}` : "";
}

export function renderHintCount(el, hints) {
  el.textContent = hints > 0 ? String(hints) : "";
}

export function setChips(chipRowEl, litKinds) {
  for (const chip of chipRowEl.querySelectorAll(".chip")) chip.classList.toggle("is-lit", litKinds.includes(chip.dataset.rule));
}

export function wiggleChip(chipRowEl, kind) {
  const chip = chipRowEl.querySelector(`[data-rule="${kind}"]`);
  if (!chip) return;
  chip.classList.remove("is-wiggle");
  void chip.offsetWidth;
  chip.classList.add("is-wiggle");
}

export function nudgeCell(boardEl, cell) {
  const el = boardEl.querySelector(`[data-cell="${cell}"]`);
  if (!el) return;
  el.classList.remove("is-nudge");
  void el.offsetWidth;
  el.classList.add("is-nudge");
}

export function hintHighlight(boardEl, chipRowEl, unitCells, cells, ruleKind) {
  for (const el of boardEl.querySelectorAll(".is-hint-unit, .is-hint-cell")) el.classList.remove("is-hint-unit", "is-hint-cell");
  for (const c of unitCells || []) boardEl.querySelector(`[data-cell="${c}"]`)?.classList.add("is-hint-unit");
  for (const c of cells || []) boardEl.querySelector(`[data-cell="${c}"]`)?.classList.add("is-hint-cell");
  if (ruleKind) wiggleChip(chipRowEl, ruleKind);
  if (ruleKind) setChips(chipRowEl, [ruleKind]);
}

export function deadEndPulse(boardEl, cells) {
  for (const c of cells) {
    const el = boardEl.querySelector(`[data-cell="${c}"]`);
    if (!el) continue;
    el.classList.remove("is-deadend");
    void el.offsetWidth;
    el.classList.add("is-deadend");
  }
}

// Cosmetic-only: draws model events (ripple order, fly-off) as CSS animation classes. Never changes the
// model. `timers` is the game.js timer registry (`after(ms, fn)`), so every animation step re-checks the
// board generation and safely no-ops if the board changed underneath it.
export function playEvents(boardEl, events, board, timers) {
  for (const ev of events) {
    if (ev.type === "nudge") nudgeCell(boardEl, ev.cell);
    if (ev.type === "placed") {
      const el = boardEl.querySelector(`[data-cell="${ev.cell}"]`);
      el?.querySelector(".bug")?.classList.add("is-landing");
    }
    if (ev.type === "autoX" && ev.cells) {
      const [pr, pc] = rc(ev.cell, board.n);
      for (const cell of ev.cells) {
        const [r, cc] = rc(cell, board.n);
        const ring = Math.max(Math.abs(r - pr), Math.abs(cc - pc));
        const el = boardEl.querySelector(`[data-cell="${cell}"]`);
        if (!el) continue;
        el.style.setProperty("--ring", String(ring));
        el.classList.remove("is-new-x");
        void el.offsetWidth;
        el.classList.add("is-new-x");
      }
    }
    if (ev.type === "mistake") {
      const el = boardEl.querySelector(`[data-cell="${ev.cell}"]`);
      if (!el) continue;
      el.classList.add("is-flyoff-hold");
      const pieceSrc = themeImagePath("pieceSvg");
      if (pieceSrc) {
        el.innerHTML = "";
        const img = document.createElement("img");
        img.className = "bug is-flyoff";
        img.src = pieceSrc;
        img.alt = "";
        el.appendChild(img);
      } else {
        el.innerHTML = `<span class="bug is-flyoff">${art().bug || ""}</span>`;
      }
      timers.after(320, () => { el.innerHTML = ""; el.classList.remove("is-flyoff-hold"); });
    }
  }
}
