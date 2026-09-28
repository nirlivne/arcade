# Rush Lane

Tap an arrow to send it sliding off the board along its lane. If another arrow is in the way, it bumps back and costs a heart. Clear every arrow to win the level; the hearts you have left become your stars.

**Age band:** kids 6-10 / family 10+. No reading needed to play: every screen is pictures, icons and big buttons.

## How to play

- Tap (or click) an arrow. If the path from its head to the edge of the board is clear, it slides all the way out.
- If another arrow blocks the way, it bumps forward to the blocker, then springs back — and you lose one heart.
- You start each level with 3 hearts. Run out and you retry the same level. Clear the board before that happens to win; your stars are however many hearts you have left.
- The first two levels can't cost you a heart at all, so there's no way to lose while you're still learning the ropes.
- Stuck? The hint button (the lightbulb) highlights an arrow that's free to go.
- A new **daily board** appears every day, the same puzzle for everyone; share your result (hearts, no words needed) with a friend.

## Controls

- Mouse or touch: tap an arrow.
- Keyboard: arrow keys (or Tab) cycle through the arrows on the board, Enter or Space taps the highlighted one, `P` or Esc pauses, `?` opens how to play.

## Comforts

Pause (top corner; it also happens automatically if you switch tabs), restart, a hint and mute (the play bar at the bottom), and settings for sound and reduced motion (in the pause menu). Progress (the level you've reached and your stars) is saved on your device automatically.

## Run locally

Open `index.html` in a browser, or serve the folder (for example `python -m http.server`) and open it. It works offline once loaded and can be installed as an app.

## What's new in v1.1: the neon maze

- Every level is now a picture: the arrows are packed inside a shape (a heart, a cat, an umbrella, letters and more), drawn as thin neon lines so a full board looks like a maze.
- Arrows move like snakes: the head leads and the body follows its own bent path out of the board. A blocked arrow snakes up to the blocker and back.
- Much bigger boards: late levels have up to about 125 arrows on boards up to 24 x 32, and you'll need to plan the order you clear them in.
- A new daily board built the same way.
- **Your progress starts fresh.** Every level was rebuilt, so levels and daily bests saved before this update start over. Your old star total is kept on your device.

## Credits

Created by The Game Company. Original art and code, drawn in code and shapes, no copied art.

The heading font is Fredoka, Copyright 2020 The Fredoka Project Authors (github.com/googlefonts/fredoka), used under the SIL Open Font License 1.1 (see `licenses/Fredoka-OFL.txt`).

Adapted from the classic sliding-arrow puzzle idea; Rush Lane's board, art, code and title are all our own.

## Known issues

- The colour-coded exit-gate twist mentioned in early pitches is not in this build; the first chapters are the plain slide-and-bump mechanic only.
- On a phone held sideways (landscape), the board is drawn quite small. Portrait works best on phones.
- There's no pinch-zoom. The board always fits the screen; if you're unsure you've got the right arrow, press and hold to see which one is highlighted, slide your finger to adjust, and release.
- Smooth on the phones we tested, but not yet tested on very old, low-end phones with the biggest boards.
- A new board appears all at once (no animation as it loads), and there's only the neon board style for now.
- A few of the letter-shaped levels are a little less densely packed than the rest.
- Stars earned before v1.1 aren't shown anywhere yet.
