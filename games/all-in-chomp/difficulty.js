// The gentle start (board 2026-10-19, docs/superpowers/specs/2026-10-19-all-in-chomp-gentle-start-and-magic-
// design.md §1): one row per level for levels 1-4; from level 5 the game is the 2026-10-17 game. Pure.
//   share:     the chasers' speed as a share of the chomper's (null = the old +7 %/level chaser speed, 93 %)
//   wrongTurn: the chance a chasing chaser takes a random open way at a junction (0 = never)
//   release:   seconds of level time before release slots 0-3 leave the seat (null = the old formula)
//   calm:      true = CALM_SCHEDULE_SEC instead of ghosts.js's MODE_SCHEDULE_SEC
export const CALM_SCHEDULE_SEC = [10, 12, 10, 15, 7, 20, 5, Infinity];

const ROWS = [
  { share: 0.7, wrongTurn: 0.35, release: [3, 10, 20, 32], calm: true },
  { share: 0.76, wrongTurn: 0.25, release: [3, 8, 14, 22], calm: true },
  { share: 0.82, wrongTurn: 0.12, release: null, calm: true },
  { share: 0.88, wrongTurn: 0.05, release: null, calm: false },
];
const FULL = Object.freeze({ share: null, wrongTurn: 0, release: null, calm: false });

export function levelTuning(level) {
  return ROWS[level - 1] || FULL;
}
