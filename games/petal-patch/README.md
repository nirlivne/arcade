# Petal Patch

A logic garden: work out where the one ladybug of every bed must sit. One per row, one per column, one per
bed, and no two touching, not even diagonally.

**Age band:** family 10+. No reading needed to play — every rule is shown in pictures.

## How to play

- Tap a cell to mark it with an × (ruling it out), tap again to place a ladybug there.
- Drag across cells to paint or erase × marks in one stroke.
- Placing a correct ladybug auto-marks its row, column, bed and neighbours — that often leaves another bed
  with only one open cell.
- A ladybug on the wrong cell flies off, leaves a red ×, and costs one of your 3 petals. Lose all 3 and the
  board wilts.
- Clear a board to move to the next, slightly harder one. The **endless run** climbs from a 4×4 garden to a
  9×9 one — your score is boards cleared in a row, one wilt away from ending.
- The **daily garden** is one shared board a day, the same for everyone, with a shareable result.

## Controls

- Mouse or touch: tap the mark cycle, drag to paint ×.
- Keyboard: arrow keys move the focus ring, Space cycles a mark, X toggles ×, Enter places a ladybug
  directly, Z (or Ctrl+Z) undoes, H asks for a hint, Esc pauses.

## Comforts

Undo, a limited hint (3 per run, 3 per daily), auto-× on/off, pause (auto-pauses if you switch tabs),
reduced motion and full keyboard play. Your run and today's garden are saved automatically
and pick up where you left off.

## Run locally

Petal Patch's game code loads as ES modules, which Chrome blocks from a plain `file://` page — serve the
folder with any static file server (for example `python -m http.server`) and open it from `http://`
instead. It works offline once loaded and can be installed as an app.

## Known issues

- Before launch day (1 October 2026) the daily garden is always No. 1.
- On portrait phones there is an empty band above the rule chips.
- The warm-up board regrows a lost petal too quickly to notice.
- The hint chip can stay lit on later boards.
- The share line can wrap its link mid-word, and a 1-day streak reads "1 days".
- Reloading just after clearing a board opens the next board unpaused, and the start screen's "Continue run"
  shows the cleared board's number rather than the next one.

## Credits

Created by The Game Company.
