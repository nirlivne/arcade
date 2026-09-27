# Tidy Tiles

Drag tile shapes onto an 8x8 grid. Fill a whole row or column and it clears; clear several lines with one shape for a bigger score. The run ends when none of the shapes you are holding fits anywhere.

## How to play

- Each turn you get three shapes in the tray. Drag one onto the grid. Shapes never rotate.
- A ghost shows where the shape will land, and outlines any lines it would complete. On touch screens the shape floats above your finger so you can see it.
- When all three are placed, three new shapes appear. Every set of three has at least one shape that fits.
- Every day has one puzzle: the same shapes and the same board twist for everyone. Play it as often as you like; your streak counts each day you finish it.
- **Endless** is a random run that does not touch your daily streak.
- Board twists you may meet: grey locked tiles that never clear, a gold bonus row that doubles a clear, a pre-patterned start, and a colour goal (clear lines with that colour three times for a bonus).

## Controls

- Mouse or touch: drag a shape from the tray to the grid and release. Release outside the grid to put it back.
- Keyboard: `1`, `2`, `3` pick a shape, arrow keys move it, `Enter` or `Space` places it, `Esc` drops it, `R` restarts.

## Scoring

1 point per cell placed. Clearing lines scores 10 x lines x lines (10, 40, 90, 160...), doubled if the gold bonus row is cleared. A colour goal completed scores 100. Your best score and streak are saved on your device only.

## Run locally

Open `index.html` in a browser, or serve the folder (for example `python -m http.server`) and open it. It works offline once loaded and can be installed as an app.

## Credits

Created by The Game Company. Original art and code, drawn in code. No ads, no tracking, no accounts.

The heading font is Fraunces, Copyright 2018 The Fraunces Project Authors (https://github.com/undercasetype/Fraunces), used under the SIL Open Font License 1.1 (see `licenses/Fraunces-OFL.txt`).

## Known issues

- Play area is tuned for portrait phones and desktop windows; a landscape phone works but the board is small.
