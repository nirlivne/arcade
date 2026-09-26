# Bloop Stack

Drop goo creatures into the jar. Two of the same kind that touch merge into the next one up (8 tiers, Dot to Kingloop). Two Kingloops burst for a big bonus. If the pile stays over the dashed line for 2 seconds, the jar is full.

## Run
Open `index.html` in a browser (no build, no server, no network). Served over http(s) (e.g. `npx serve .` from the workspace) it is also an installable PWA and plays offline after the first load (`manifest.json`, `sw.js`; bump `CACHE_VERSION` in `sw.js` whenever shipped files change).

## Controls
- Mouse: move to aim, click to drop.
- Touch: drag to aim, lift to drop.
- Keyboard: Left/Right (or A/D) to aim, Space or Down to drop; R restart; P/Esc pause; M mute.
- Game over: R, Enter, Space or the Play again button.

## Scoring
Merge score = new tier (2, 4, 8 ... 128). Chain merges within 1 s multiply by the chain count (max x5). Kingloop + Kingloop = 256. Best score is stored in localStorage (`bloop-stack:best`).

## Credits
Created by The Game Company. Also shown in the in-game About dialog (ℹ️ About on the start screen). All art is drawn in code and all sound is generated with WebAudio.

## Known issues
- Spikes/antennae/crown of large blobs can visually poke through the jar wall (collision is the body circle only).
- Pausing on tab hide requires a tap/Space to resume.
- Physics is a custom circle solver; blobs do not rotate.
