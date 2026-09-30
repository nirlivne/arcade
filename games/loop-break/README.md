# Loop Break

A watchmaker's puzzle: work out which ring drives which, then open the lock. Drag a ring (or its crown) and
every ring it's linked to turns with it, live. Line up every gap before your batons run out, and the lid
springs open.

**Age band:** family 10+. No reading needed to play — the demo and the how-to are pictures.

## How to play

- Drag a ring, or drag its crown sideways. A **claw** link turns the next ring the same way; a **pinion**
  link turns it the other way, and links cascade — dragging one ring can turn several.
- A **grey ring** has no crown of its own: it only turns when its driver does.
- Each gap that lands under the top notch lights up with a "ting". Every drag spends one of your batons
  (shown on the bezel); run out before every gap is aligned and the lock stays shut.
- **Take-back** (once per attempt) undoes your last move exactly and refunds the baton. **Restart** is free
  and instant.
- Clear all 24 levels across 3 packs — Claws, Pinions, Blanks — for stars, or open the **daily medallion**,
  the same puzzle for everyone that day, with a streak and a shareable result.

## Controls

- Mouse or touch: drag a ring band, or drag its crown.
- Keyboard: 1–6 picks a ring (outer = 1), ←/→ turns it one notch, Z takes back, R restarts, Esc pauses.

## Comforts

Take-back, free restart, pause (auto-pauses if you switch tabs), mute, haptics and shake toggles, reduced
motion, full keyboard play, and two finishes — Blued steel and Gunmetal (the second unlocks on finishing the
first pack). Your progress and today's medallion are saved automatically.

## Run locally

Loop Break's game code loads as ES modules, which Chrome blocks from a plain `file://` page — serve the
folder with any static file server (for example `python -m http.server`) and open it from `http://` instead.
It works offline once loaded and can be installed as an app.

## Known issues

- The first-run demo's medallion sometimes turns in one jump rather than a smooth spin — the ghost fingertip
  still eases through every notch, only the rings themselves cut straight to the result on a couple of beats.
- Reduced-motion mode shortens the win reveal's lid swing to a brief pause instead of a cross-fade.

## Credits

Created by The Game Company.
