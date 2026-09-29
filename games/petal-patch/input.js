// Petal Patch input: pointer + keyboard -> intents (model.mjs's apply() shape). Knows no rules -- it never
// reads solution state, only the DOM `data-mark` attribute (DESIGN.md §1.5) to decide a drag's paint/erase
// mode. Browser-only ES module (not imported by node --test).

const STROKE_PX = 6;

// attachBoardInput(boardEl, dispatch): dispatch(intent) is called for every user gesture. `intent.cells`
// on a 'stroke' always has exactly one new cell (input.js reports live, per spec §2 "one stroke = one undo
// step" is a model.mjs concern via `continue`).
export function attachBoardInput(boardEl, dispatch) {
  let down = null; // { pointerId, startCell, x, y, strokeMode, stroked:Set }

  function cellOf(e) {
    const el = e.target.closest(".cell");
    return el ? Number(el.dataset.cell) : null;
  }
  // pointerdown sets capture on boardEl, so every later pointermove has e.target === boardEl regardless of
  // where the pointer actually is -- read the real element under the pointer instead.
  function cellAtPoint(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el) return null;
    const cellEl = el.closest(".cell");
    if (!cellEl || !boardEl.contains(cellEl)) return null;
    return Number(cellEl.dataset.cell);
  }
  function markOf(cell) {
    const el = boardEl.querySelector(`[data-cell="${cell}"]`);
    return el ? el.dataset.mark : "none";
  }

  boardEl.addEventListener("pointerdown", (e) => {
    const cell = cellOf(e);
    if (cell === null) return;
    down = { pointerId: e.pointerId, startCell: cell, x: e.clientX, y: e.clientY, strokeMode: null, stroked: new Set() };
    try { boardEl.setPointerCapture(e.pointerId); } catch { /* touch/pen without capture support: still works via move/up */ }
  });

  boardEl.addEventListener("pointermove", (e) => {
    if (!down || down.pointerId !== e.pointerId) return;
    const cell = cellAtPoint(e);
    if (down.strokeMode === null) {
      const dist = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const crossedCell = cell !== null && cell !== down.startCell;
      if (dist < STROKE_PX && !crossedCell) return;
      const startMark = markOf(down.startCell);
      down.strokeMode = startMark === "x" ? "erase" : "paint";
      down.stroked.add(down.startCell);
      dispatch({ type: "stroke", cells: [down.startCell], mode: down.strokeMode, continue: false });
    }
    if (cell !== null && !down.stroked.has(cell)) {
      down.stroked.add(cell);
      dispatch({ type: "stroke", cells: [cell], mode: down.strokeMode, continue: true });
    }
  });

  function endPointer(e) {
    if (!down || down.pointerId !== e.pointerId) return;
    if (down.strokeMode === null) dispatch({ type: "tap", cell: down.startCell });
    down = null;
  }
  boardEl.addEventListener("pointerup", endPointer);
  boardEl.addEventListener("pointercancel", endPointer);
}

// attachKeyboardInput(boardEl, dispatch): arrows move a focus ring over cells (n read from the board's
// data-size), Space = mark cycle, X = toggle x, Enter = place directly, Z/Ctrl+Z = undo, H = hint,
// Esc = pause/back.
export function attachKeyboardInput(boardEl, dispatch) {
  let focus = 0;
  function n() { return Number(boardEl.dataset.size || 0); }
  function setFocus(i) {
    focus = Math.max(0, Math.min(n() * n() - 1, i));
    const el = boardEl.querySelector(`[data-cell="${focus}"]`);
    if (el) el.focus({ preventScroll: true });
  }
  boardEl.addEventListener("focusin", (e) => {
    const el = e.target.closest(".cell");
    if (el) focus = Number(el.dataset.cell);
  });
  boardEl.addEventListener("keydown", (e) => {
    const N = n();
    if (!N) return;
    switch (e.key) {
      case "ArrowUp": setFocus(focus - N); e.preventDefault(); break;
      case "ArrowDown": setFocus(focus + N); e.preventDefault(); break;
      case "ArrowLeft": setFocus(focus - 1); e.preventDefault(); break;
      case "ArrowRight": setFocus(focus + 1); e.preventDefault(); break;
      case " ": case "Spacebar": dispatch({ type: "tap", cell: focus }); e.preventDefault(); break;
      case "x": case "X": dispatch({ type: "toggleX", cell: focus }); e.preventDefault(); break;
      case "Enter": dispatch({ type: "place", cell: focus }); e.preventDefault(); break;
      case "z": case "Z": if (e.ctrlKey || e.metaKey || e.key === "z") dispatch({ type: "undo" }); e.preventDefault(); break;
      case "h": case "H": dispatch({ type: "hint" }); e.preventDefault(); break;
      case "Escape": dispatch({ type: "pause" }); e.preventDefault(); break;
      default: return;
    }
  });
  return { setFocus, getFocus: () => focus };
}
