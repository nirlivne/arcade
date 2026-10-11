# Cannonball Family

Your family as a circus stunt troupe. Pick your people, load them into the felt cannon, and fire them a long
way across a landscape big top at forts full of fairground tins, drums and crates. The safety net is always there.

**v2 (board revision):** a much longer cannon-to-target distance (Angry Birds/Tanks range), 8 different fort
layouts, drums that take 2 hits and crates that break open, landscape-only play, and a WebGL post-pass (shockwave
rings, chromatic aberration, flash, grain, vignette) over the same felt renderer, with a full 2D fallback.

**Age band:** family 6+, from kids to grandparents. The demo and the how-to are pictures; no reading is needed to play.

## How to play

- **Pull back from anywhere, then let go** to fire. The dotted aim line, and the camera following the shot out
  to the fort, show the way.
- Knock down every tin. Drums take two hits (dent, then burst); crates break open after one or two hits and
  drop whatever's on them.
- **Peek:** hold the binoculars patch, or the `V` key, to look ahead at the fort before you aim.
- Stars come from your score, not from who stayed home - each level has its own 2-star and 3-star threshold.
- Pick the family in **Our family**: names, seats and looks are yours. Photos stay on this device only.
- The daily shot is the same level for everyone that day, with its own share line.

## Controls

- Mouse or touch: pull back anywhere and let go; hold the binoculars patch to peek.
- Keyboard: Left / Right to aim, Up / Down for power, Space or Enter to fire, hold `V` to peek.
- `R` restarts the level. `Esc` pauses; the game also pauses when you switch tabs.
- `?gl=0` in the URL forces the 2D-only fallback (no WebGL post pass); the game plays identically either way.

## Comforts

Pause, mute, a reduced-motion setting, a how-to screen reachable at any time, instant retry, and a
first-20-seconds safety net. Your level progress, best scores, daily record and family are saved automatically
on this device.

## Run locally

Cannonball Family's game code loads as ES modules, which Chrome blocks from a plain `file://` page. Serve the
folder with any static file server (for example `python -m http.server`) and open it from `http://` instead.
It works offline once loaded and can be installed as an app.

## Known issues

- On level 1 the top tin slightly overlaps the curtain edge.
- When you peek from far away, the twin-tower, bridge and trapeze forts can look alike until the camera gets closer.
- On a few levels the fewest-shots score means sending some of the family out first to reach the light or heavy
  member.
- Whether an installed app stays locked to landscape depends on the phone; use "Play upright" if it doesn't.

## Credits

Created by The Game Company.

Fonts: Alfa Slab One and Atkinson Hyperlegible (both SIL Open Font License 1.1). The licence texts ship in
`fonts/` next to the font files.
