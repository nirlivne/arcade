// Petal Patch demo.js: the scripted 4x4 self-play onboarding demo (spec §8 timeline; DESIGN.md §1.3's
// `.hero` + `.finger`). Run through the game's own timer registry so a real board load (which bumps the
// generation) automatically stops it.
import { buildBoard, drawBoard, playEvents, setChips, renderFlower } from "./render.js";
import { initState, apply } from "./model.mjs";
import { rc, autoX as rulesAutoX } from "./rules.mjs";

let session = null;

export function stopDemo() {
  if (session) session.stopped = true;
  session = null;
}

function positionFinger(fingerEl, board, cell) {
  const [r, c] = rc(cell, board.n);
  fingerEl.style.setProperty("--x", `${((c + 0.5) / board.n) * 100}%`);
  fingerEl.style.setProperty("--y", `${((r + 0.5) / board.n) * 100}%`);
  fingerEl.classList.remove("is-tap");
  void fingerEl.offsetWidth;
  fingerEl.classList.add("is-tap");
}

const CHIP_ORDER = ["row", "col", "bed", "touch"];

export function runDemo(heroEl, timers) {
  stopDemo();
  const pack = window.PETAL_LEVELS;
  const rec = pack.practice[0];
  const board = { id: rec.id, n: rec.n, beds: rec.beds.split("").map(Number), sol: rec.sol.split("").map(Number), par: rec.par };
  let state = initState(board, { practice: false, hints: 0 });

  heroEl.innerHTML = "";

  const hud = document.createElement("div");
  hud.className = "hero-hud";
  heroEl.appendChild(hud);

  const flower = document.createElement("span");
  flower.className = "flower";
  hud.appendChild(flower);
  renderFlower(flower, state.petals, false);

  const chips = document.createElement("ul");
  chips.className = "chips";
  chips.innerHTML = CHIP_ORDER.map((kind) => `<li class="chip" data-rule="${kind}"><span class="vh">${kind}</span></li>`).join("");
  hud.appendChild(chips);
  const A = window.PETAL_ART || {};
  for (const chip of chips.querySelectorAll(".chip[data-rule]")) {
    const glyph = A.chip && A.chip[chip.dataset.rule];
    if (glyph) chip.insertAdjacentHTML("afterbegin", glyph);
  }

  const heroBoard = document.createElement("div");
  heroBoard.className = "hero-board";
  heroEl.appendChild(heroBoard);

  const boardDiv = document.createElement("div");
  boardDiv.className = "board board--hero";
  heroBoard.appendChild(boardDiv);
  buildBoard(boardDiv, board);
  drawBoard(boardDiv, board, state);

  const finger = document.createElement("span");
  finger.className = "finger";
  finger.innerHTML = (window.PETAL_ART && window.PETAL_ART.finger) || "";
  heroBoard.appendChild(finger);

  const s = { stopped: false };
  session = s;

  function tapTwice(cell, onDone) {
    if (s.stopped) return;
    positionFinger(finger, board, cell);
    const r1 = apply(board, state, { type: "tap", cell });
    state = r1.state;
    drawBoard(boardDiv, board, state);
    playEvents(boardDiv, r1.events, board, timers);
    timers.after(260, () => {
      if (s.stopped) return;
      positionFinger(finger, board, cell);
      const r2 = apply(board, state, { type: "tap", cell });
      state = r2.state;
      drawBoard(boardDiv, board, state);
      renderFlower(flower, state.petals, state.wilted);
      playEvents(boardDiv, r2.events, board, timers);
      if (onDone) onDone(r2.events);
    });
  }

  function lightChipsInTurn() {
    let lit = [];
    CHIP_ORDER.forEach((kind, i) => {
      timers.after(i * 180, () => {
        if (s.stopped) return;
        lit = [...lit, kind];
        setChips(chips, lit);
      });
    });
  }

  function firstWrongCell() {
    const dead = rulesAutoX(state.bugs, board.n, board.beds);
    for (let i = 0; i < board.n * board.n; i++) {
      const r = Math.floor(i / board.n), c = i % board.n;
      if (board.sol[r] !== c && !state.bugs.includes(i) && !state.red.includes(i) && !dead.has(i)) return i;
    }
    return 0;
  }

  const solCells = board.sol.map((c, r) => r * board.n + c);
  // 0.8s: a correct placement + ripple, then the row/col/bed/touch chips light in turn (goal, spec §8)
  timers.after(800, () => tapTwice(solCells[0], () => lightChipsInTurn()));
  // 2.6s: 2nd ladybug lands in the only cell left in its bed
  timers.after(2600, () => tapTwice(solCells[1]));
  // 4.0s: a wrong placement -- fly-off, red x, a petal falls (fail rule, spec §8)
  timers.after(4000, () => tapTwice(firstWrongCell()));
  timers.after(5400, () => tapTwice(solCells[2]));
  timers.after(5600, () => tapTwice(solCells[3])); // beds bloom on the 4th (isSolved) placement
  timers.after(7000, () => {
    if (s.stopped) return;
    runDemo(heroEl, timers); // fade and loop
  });

  function onInteract() { stopDemo(); heroEl.removeEventListener("pointerdown", onInteract); }
  heroEl.addEventListener("pointerdown", onInteract, { once: true });
}
