# Potion Pour

A lit apothecary cabinet at dusk: tap a glass vial to lift it, tap another to pour. The whole top run of one
potion flows onto a matching colour or into an empty vial, as much as fits. Fill every vial with one pure
colour (four layers) to brew the shelf.

**Age band:** kids 6-10 / family 10+. No reading needed to play: every potion also carries its own rune, so
colour is never the only clue. Big tap targets, no timers, no fail shaming.

## How to play

- Tap a vial to lift it, then tap another vial to pour into it. A pour only works onto an empty vial or one
  whose top colour matches.
- Tapping the lifted vial again puts it back down. Tapping a vial you can't legally pour into makes it shake
  its head — it stays lifted so you can pick another target.
- Fill every vial with one pure colour (or leave it empty) to brew the shelf. You're scored 1-3 stars by how
  many pours you used against the solver's minimum.
- **Restart**, **Undo** (2 per shelf, unlimited on the first three), **Hint** (3 per shelf — glows the solver's
  next suggested pour) and **Extra vial** (1 per shelf) are always at hand.
- If a shelf runs out of moves (or the solver proves it can no longer be finished) with a helper still left,
  that helper's button pulses to nudge you toward it — nothing resets. If every helper is spent, a screen
  explains why in pictures (which potions are stuck and why) and waits for your tap on "Let's brew again"
  before the shelf resets. Chapter progress, stars and bests are always kept.
- The first three shelves have unlimited undos and never reset, so there's no way to lose while you're still
  learning the ropes.
- 70 shelves across 6 chapters, climbing from a gentle 2-colour warm-up up to a 12-vial shelf, always with two
  spare empty vials. A new **Potion of the day** shelf also appears every day, generated and solver-verified on
  the spot from that day's date, with its own best score and a share button.
- The first time you play, a ghost hand shows a lift, an invalid pour, a completed vial and a cleared shelf
  before handing off into level 1. Replay it any time from "Show me" on the title screen, or Settings.

## Controls

- Mouse or touch: tap a vial.
- Keyboard: Left/Right arrow keys move the highlight between vials, Enter or Space taps the highlighted one,
  `U` undoes, `H` uses a hint, `P` or Esc pauses, `?` opens how to play.

## Comforts

Pause (top-left; also automatic if you switch tabs), Restart/Undo/Hint/Extra vial (bottom of the screen in
portrait, a right-hand rail in landscape, each with its remaining count), and settings for sound, vibration,
reduced motion, "show where a lifted vial fits", replaying the demo and resetting progress. Progress (the
shelf you've reached, your best pour count and stars per shelf) is saved on your device automatically.

## Known issues

- Pressing Enter or Space right after opening Pause closes it again, because the close button is focused first.
  Tap Pause again to reopen it.
- When a shelf is cleared, the card covers the whole shelf; the top row doesn't stay visible behind it.
- Slower devices may pause briefly just after a shelf is cleared.

## Run locally

Open `index.html` in a browser, or serve the folder (for example `python -m http.server`) and open it. Works
offline once visited once (installable as an app via the browser's "Add to Home Screen").

## Credits

Created by The Game Company. Every potion, vial, rune and sound is drawn or generated in code — no copied art.
Font: Baloo 2 (SIL Open Font License 1.1).
