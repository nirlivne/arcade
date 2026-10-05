# ג׳אנקיס

A poker-night take on **Say Cheese!** (and Bloop Stack) by The Game Company, made for the Junkies: eight friends who
have played Texas Hold'em together for 20+ years. The whole game is in Hebrew, right to left.

- **How it plays:** drop their faces (die-cut head stickers) into the photo and merge matching pairs up eight tiers.
  Two of the biggest make a full house. Everyone who gets dealt in comes back into the picture.
- **Order:** a new random order of who is which size every game. The ⚙ settings on the start screen can set a fixed
  order instead.
- **Table talk:** the group's own lines pop up in speech bubbles.

Unlisted: it is not in `games.json` and does not appear on the arcade home page. Open it by its link.

- One self-contained `index.html` (images, fonts, sound all inline); works offline once loaded.
- Controls: drag/tap on touch, or mouse; ← → / A D aim, Space/↓ drop, P pause, M sound, N music, R restart.
- **Fonts and licences:**
  - Rubik Doodle Shadow, Karantina, Fredoka and Patrick Hand are SIL OFL 1.1.
  - Permanent Marker is Apache 2.0.
  - Their licence texts are in `licenses/`.
- Service worker cache names start with `junkies-` (not `say-cheese-`, which Say Cheese's worker cleans up).
- **Source:** `tools/photolab/out/say-cheese-junkies` in the studio repo.
- **To update:**
  1. Rebuild `demo.html`.
  2. Run `scripts/publish_index.py`. It writes `index.html` here with the noindex/manifest/icon tags and `register-sw.js`.
  3. Bump `CACHE_VERSION` in `sw.js`.
