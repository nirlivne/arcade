// Petal Patch logic solver, human-style, L1-L4 in that order (spec §3). One file used by the generator
// (tools/petal-gen.mjs), the in-game hint, the QA "thinker" bot and the tests. L0 (auto-x after a
// placement) isn't a step here -- it's folded into `dead` by the caller via rules.autoX.
//
// A board is only shippable if grade() reaches `solved` using L1-L4 alone: no lookahead, no guessing.

import { attackSet, units as unitsOf, unitDone, liveCells } from "./rules.mjs";

function* combos(arr, k, start = 0, pick = []) {
  if (pick.length === k) { yield pick; return; }
  for (let i = start; i < arr.length; i++) yield* combos(arr, k, i + 1, [...pick, arr[i]]);
}

// nextStep(n, beds, bugs, dead) -> the single next forced deduction, or null if the board is solved or stuck
// (needs a guess/lookahead beyond L4). `bugs` = placed correct ladybugs (array of cell indices). `dead` =
// cells already known not to hold the solution (typically rules.autoX(bugs), plus any extra the caller has
// accumulated, e.g. the QA bot's own prior L2-L4 marks).
//
// Returns one of:
//   { rule: 'contradiction', unit }                          a unit has zero live cells and isn't done
//   { rule: 'L1', unit, cells: [cell], action: 'place' }      unit has exactly one live cell -> place there
//   { rule: 'L2', unit, confinesTo, cells, action: 'mark' }   unit's candidates confined to another unit -> x the rest of that unit
//   { rule: 'L3', unit, cells: [cell], action: 'mark' }       placing at cell would empty unit -> x that cell
//   { rule: 'L4', units: [...], cells, action: 'mark' }       k beds confined to k lines (or vice versa) -> x the rest
export function nextStep(n, beds, bugs, dead) {
  const bugSet = new Set(bugs);
  const live = liveCells(n, bugs, dead);
  const U = unitsOf(n, beds);
  const done = (u) => unitDone(u, bugSet);
  const cands = (u) => u.cells.filter((i) => live[i]);

  for (const u of U) {
    if (done(u)) continue;
    const cs = cands(u);
    if (cs.length === 0) return { rule: "contradiction", unit: u };
  }

  // L1 single: a unit with exactly one live cell -> place.
  for (const u of U) {
    if (done(u)) continue;
    const cs = cands(u);
    if (cs.length === 1) return { rule: "L1", unit: u, cells: [cs[0]], action: "place" };
  }

  // L2 confinement: unit u's candidates all lie inside a different-kind unit v -> x v's other candidates.
  for (const u of U) {
    if (done(u)) continue;
    const cs = cands(u);
    for (const v of U) {
      if (v === u || v.kind === u.kind || done(v)) continue;
      if (!cs.every((i) => v.cells.includes(i))) continue;
      const clear = cands(v).filter((i) => !u.cells.includes(i));
      if (clear.length) return { rule: "L2", unit: u, confinesTo: v, cells: clear, action: "mark" };
    }
  }

  // L3 attack: a live cell x whose attack set would empty some other undone unit -> x is out.
  for (let x = 0; x < n * n; x++) {
    if (!live[x]) continue;
    const atk = attackSet(x, n, beds);
    for (const u of U) {
      if (done(u) || u.cells.includes(x)) continue;
      const cs = cands(u);
      if (cs.length && cs.every((i) => atk.has(i))) return { rule: "L3", unit: u, cells: [x], action: "mark" };
    }
  }

  // L4 subset, k = 2..4: k beds (or k rows/cols) whose live cells fit inside exactly k lines (or beds) ->
  // x the rest of those k lines/beds.
  const pairs = [["bed", "row"], ["bed", "col"], ["row", "bed"], ["col", "bed"]];
  for (const [ka, kb] of pairs) {
    const A = U.filter((u) => u.kind === ka && !done(u));
    const Bs = U.filter((u) => u.kind === kb);
    const idxB = (i) => Bs.findIndex((b) => b.cells.includes(i));
    for (let k = 2; k <= 4 && k <= A.length; k++) {
      for (const combo of combos(A, k)) {
        const inside = new Set(combo.flatMap(cands));
        if (!inside.size) continue;
        const bset = new Set([...inside].map(idxB));
        if (bset.size !== k) continue;
        const clear = [...bset].flatMap((b) => cands(Bs[b])).filter((i) => !inside.has(i));
        if (clear.length) return { rule: "L4", k, units: combo, confinesTo: [...bset].map((b) => Bs[b]), cells: clear, action: "mark" };
      }
    }
  }

  return null;
}

const RULE_RANK = { L1: 1, L2: 2, L3: 3, L4: 4 };

// grade(n, beds) -> { solved, grade, steps, cascades, dead } by solving from empty with L1-L4 only.
// `grade` = highest rule rank used (0 if solved with L1 only... actually L1 itself ranks 1, so a
// pure-singles board grades 1, matching spec's "P practice L0-L1"). `steps` = number of L2+ deductions.
// `cascades` = number of placements after which >= 2 fresh L1 singles become available at once.
export function grade(n, beds) {
  let bugs = [];
  let dead = new Set();
  let steps = 0;
  let cascades = 0;
  let maxRule = 0;
  let maxK = 0;
  const oneCellBeds = countOneCellBeds(n, beds);

  for (;;) {
    if (bugs.length === n) return { solved: true, grade: maxRule, steps, cascades, oneCellBeds, maxK };
    const step = nextStep(n, beds, bugs, dead);
    if (!step || step.rule === "contradiction") return { solved: false, grade: maxRule, steps, cascades, oneCellBeds, maxK };

    if (step.rule === "L1") {
      const cell = step.cells[0];
      bugs = [...bugs, cell];
      // recompute dead from scratch: autoX of all bugs, union with prior extra dead marks (L2-L4 x's)
      const extra = [...dead].filter((d) => !bugs.includes(d));
      dead = new Set([...extra, ...autoXOf(bugs, n, beds)]);
      if (countL1Opportunities(n, beds, bugs, dead) >= 2) cascades++;
      continue;
    }

    steps++;
    maxRule = Math.max(maxRule, RULE_RANK[step.rule]);
    if (step.rule === "L4") maxK = Math.max(maxK, step.k);
    dead = new Set([...dead, ...step.cells]);
  }
}

function autoXOf(bugs, n, beds) {
  const out = new Set();
  for (const b of bugs) for (const k of attackSet(b, n, beds)) out.add(k);
  return out;
}

function countL1Opportunities(n, beds, bugs, dead) {
  const bugSet = new Set(bugs);
  const live = liveCells(n, bugs, dead);
  const U = unitsOf(n, beds);
  let count = 0;
  for (const u of U) {
    if (unitDone(u, bugSet)) continue;
    if (u.cells.filter((i) => live[i]).length === 1) count++;
  }
  return count;
}

function countOneCellBeds(n, beds) {
  const sizes = new Array(n).fill(0);
  for (const b of beds) sizes[b]++;
  return sizes.filter((s) => s === 1).length;
}

// Backtracking uniqueness counter, capped at 2 (we only need to know "1" vs "more than 1").
export function countSolutions(n, beds, cap = 2) {
  let count = 0;
  const colUsed = new Array(n).fill(false);
  const bedUsed = new Array(n).fill(false);
  const go = (r, prevCol) => {
    if (r === n) { count++; return count >= cap; }
    for (let c = 0; c < n; c++) {
      if (colUsed[c] || (r > 0 && Math.abs(prevCol - c) <= 1)) continue;
      const g = beds[r * n + c];
      if (bedUsed[g]) continue;
      colUsed[c] = bedUsed[g] = true;
      if (go(r + 1, c)) return true;
      colUsed[c] = bedUsed[g] = false;
    }
    return false;
  };
  go(0, -9);
  return count;
}
