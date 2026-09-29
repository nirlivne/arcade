// Petal Patch board model: one board in play. Pure, no DOM, no timers (game.js owns the clock and the
// timer registry; this file only tracks state + emits cosmetic events for render.js to animate).
//
// `board` = the static board definition from levels.js: { id, n, beds: Uint8Array(n*n), sol: number[n], par }.
// `state` = the live BoardState (see save.mjs for the persisted shape): bugs, red, marks, petals, hints, ms,
// practice, hintUsed, mistakes, solved, wilted, undoStack.
//
// apply(board, state, intent, { showAutoX }) -> { state, events }. Auto-x is derived via rules.autoX, never
// stored; showAutoX (default true, the Settings toggle) only controls whether tap/stroke/toggleX treat an
// auto-x'd cell as ruled-out (nudge) or let the player mark and place on it like a plain empty cell.

import { autoX as rulesAutoX, isSolved, units as unitsOf, unitDone } from "./rules.mjs";

export const MAX_PETALS = 3;

export function initState(board, { practice = false, hints = 3 } = {}) {
  return {
    id: board.id,
    n: board.n,
    bugs: [],
    red: [],
    marks: [],
    petals: MAX_PETALS,
    hints,
    ms: 0,
    practice,
    hintUsed: false,
    mistakes: 0,
    undoStack: [],
    solved: false,
    wilted: false,
  };
}

function autoXCells(state, board) {
  return rulesAutoX(state.bugs, board.n, board.beds);
}

// The kind of a cell for rules purposes: 'bug' | 'red' | 'autoX' | 'mark' | 'empty'. Auto-x is always
// derived here regardless of the player's display setting (spec §2: the setting only hides the mark, it
// never changes what's placeable).
export function cellKind(state, board, cell) {
  if (state.bugs.includes(cell)) return "bug";
  if (state.red.includes(cell)) return "red";
  if (autoXCells(state, board).has(cell)) return "autoX";
  if (state.marks.includes(cell)) return "mark";
  return "empty";
}

// The kind of a cell for display AND input purposes (THE-189/THE-193): with the auto-x setting off, an
// auto-x cell reads as empty -- including to a player mark already sitting on it, so the normal tap/stroke
// cycle (mark, then place) works on it exactly like a plain empty cell. `cellKind` above is untouched and
// always reports the rules kind, for the hint and `deadEndUnits`.
export function displayCellKind(state, board, cell, showAutoX = true) {
  if (state.bugs.includes(cell)) return "bug";
  if (state.red.includes(cell)) return "red";
  if (showAutoX && autoXCells(state, board).has(cell)) return "autoX";
  if (state.marks.includes(cell)) return "mark";
  return "empty";
}

function solCell(board, cell) {
  const r = Math.floor(cell / board.n);
  const c = cell % board.n;
  return board.sol[r] === c;
}

function pushUndo(state, entry) {
  return { ...state, undoStack: [...state.undoStack, entry] };
}

export function setElapsed(state, ms) {
  return { ...state, ms };
}

export function apply(board, state, intent, { showAutoX = true } = {}) {
  if (state.solved || state.wilted) return { state, events: [] };
  switch (intent.type) {
    case "tap": return tap(board, state, intent.cell, showAutoX);
    case "stroke": return stroke(board, state, intent.cells, intent.mode, intent.continue, showAutoX);
    case "place": return place(board, state, intent.cell, showAutoX);
    case "toggleX": return toggleX(board, state, intent.cell, showAutoX);
    case "undo": return undo(board, state);
    case "hint": return hintCharge(board, state);
    case "clearX": return clearX(board, state);
    default: return { state, events: [] };
  }
}

function tap(board, state, cell, showAutoX) {
  const kind = displayCellKind(state, board, cell, showAutoX);
  if (kind === "bug") return { state, events: [{ type: "noop", cell }] };
  if (kind === "autoX" || kind === "red") return { state, events: [{ type: "nudge", cell }] };
  if (kind === "empty") {
    const next = pushUndo({ ...state, marks: [...state.marks, cell] }, { type: "mark", cell });
    return { state: next, events: [{ type: "marked", cell }] };
  }
  return place(board, state, cell, showAutoX); // kind === 'mark': second tap attempts a placement
}

function place(board, state, cell, showAutoX) {
  const kind = displayCellKind(state, board, cell, showAutoX);
  if (kind === "bug") return { state, events: [{ type: "noop", cell }] };
  if (kind === "autoX" || kind === "red") return { state, events: [{ type: "nudge", cell }] };

  const marksAfter = state.marks.filter((m) => m !== cell);

  if (solCell(board, cell)) {
    const bugs = [...state.bugs, cell];
    let next = { ...state, bugs, marks: marksAfter };
    next = pushUndo(next, { type: "place", cell });
    const events = [{ type: "placed", cell }, { type: "autoX", cell, cells: [...rulesAutoX(bugs, board.n, board.beds)] }];
    if (isSolved(bugs, board.n)) {
      next = { ...next, solved: true };
      events.push({ type: "solved" });
    }
    return { state: next, events };
  }

  const red = [...state.red, cell];
  const events = [{ type: "mistake", cell }];
  if (state.practice) {
    events.push({ type: "petalRegrow", cell });
    return { state: { ...state, red, marks: marksAfter }, events };
  }
  const petals = state.petals - 1;
  const mistakes = state.mistakes + 1;
  events.push({ type: "petalLost", petals });
  if (petals <= 0) {
    events.push({ type: "wilt" });
    return { state: { ...state, red, marks: marksAfter, petals: 0, mistakes, wilted: true }, events };
  }
  return { state: { ...state, red, marks: marksAfter, petals, mistakes }, events };
}

function toggleX(board, state, cell, showAutoX) {
  const kind = displayCellKind(state, board, cell, showAutoX);
  if (kind === "bug") return { state, events: [{ type: "noop", cell }] };
  if (kind === "autoX" || kind === "red") return { state, events: [{ type: "nudge", cell }] };
  if (kind === "mark") {
    const next = pushUndo({ ...state, marks: state.marks.filter((m) => m !== cell) }, { type: "unmark", cell });
    return { state: next, events: [{ type: "unmarked", cell }] };
  }
  const next = pushUndo({ ...state, marks: [...state.marks, cell] }, { type: "mark", cell });
  return { state: next, events: [{ type: "marked", cell }] };
}

// One drag gesture = one undo step (spec §2 "Drag (stroke)"): input.js dispatches one 'stroke' intent per
// newly-crossed cell for live feedback, marking every call after the gesture's first with `continue: true`
// so it merges into the same undo entry instead of pushing a new one per cell.
function stroke(board, state, cells, mode, continueStroke, showAutoX) {
  let marks = state.marks;
  const touched = [];
  for (const cell of cells) {
    const kind = displayCellKind({ ...state, marks }, board, cell, showAutoX);
    if (kind === "bug" || kind === "autoX" || kind === "red") continue;
    if (mode === "paint" && kind === "empty") { marks = [...marks, cell]; touched.push(cell); }
    if (mode === "erase" && kind === "mark") { marks = marks.filter((m) => m !== cell); touched.push(cell); }
  }
  if (!touched.length) return { state, events: [] };
  const top = state.undoStack[state.undoStack.length - 1];
  let undoStack;
  if (continueStroke && top && top.type === "stroke" && top.mode === mode) {
    undoStack = [...state.undoStack.slice(0, -1), { ...top, cells: [...top.cells, ...touched] }];
  } else {
    undoStack = [...state.undoStack, { type: "stroke", mode, cells: touched }];
  }
  return { state: { ...state, marks, undoStack }, events: [{ type: "stroked", mode, cells: touched }] };
}

function undo(board, state) {
  if (!state.undoStack.length) return { state, events: [] };
  const entry = state.undoStack[state.undoStack.length - 1];
  const undoStack = state.undoStack.slice(0, -1);
  let next = { ...state, undoStack };
  if (entry.type === "mark") next.marks = next.marks.filter((m) => m !== entry.cell);
  else if (entry.type === "unmark") next.marks = [...next.marks, entry.cell];
  else if (entry.type === "clearX") next.marks = [...next.marks, ...entry.cells];
  else if (entry.type === "stroke") {
    next.marks = entry.mode === "paint"
      ? next.marks.filter((m) => !entry.cells.includes(m))
      : [...next.marks, ...entry.cells];
  } else if (entry.type === "place") {
    next.bugs = next.bugs.filter((b) => b !== entry.cell);
    next.solved = false;
  }
  return { state: next, events: [{ type: "undone", entry }] };
}

function hintCharge(board, state) {
  if (state.hints <= 0) return { state, events: [{ type: "noHints" }] };
  return { state: { ...state, hints: state.hints - 1, hintUsed: true }, events: [{ type: "hintUsed" }] };
}

function clearX(board, state) {
  if (!state.marks.length) return { state, events: [] };
  const next = pushUndo({ ...state, marks: [] }, { type: "clearX", cells: state.marks });
  return { state: next, events: [{ type: "clearedX" }] };
}

// Units with zero cells left open to the player (covered by bugs/red/autoX/marks) but not yet solved --
// a dead end that can only come from the player's own x's (spec §2 "Dead end"). UI-only, no penalty.
export function deadEndUnits(board, state) {
  const bugSet = new Set(state.bugs);
  const blocked = new Set([...state.bugs, ...state.red, ...autoXCells(state, board), ...state.marks]);
  return unitsOf(board.n, board.beds).filter((u) => !unitDone(u, bugSet) && u.cells.every((i) => blocked.has(i)));
}

// ★ solved, ★★ + no mistakes and no hint, ★★★ + at or under par (spec §2 "Stars"). Practice boards have
// no par, so they cap at ★★.
export function starsFor(state, board) {
  if (!state.solved) return 0;
  if (state.mistakes > 0 || state.hintUsed) return 1;
  if (board.par && state.ms <= board.par * 1000) return 3;
  return 2;
}
