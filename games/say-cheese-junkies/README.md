# ג׳אנקיס

A poker-night take on **Say Cheese!** (and Bloop Stack) by The Game Company, made for the Junkies: eight friends who
have played Texas Hold'em together for 20+ years. Their faces are clay poker chips: drop them into the photo, merge
matching pairs up eight tiers (youngest to oldest), and deal everyone back into the picture. Two of the biggest chips
make a **FULL HOUSE**.

Unlisted: it is not in `games.json` and does not appear on the arcade home page. Open it by its link.

- One self-contained `index.html` (images, fonts, sound all inline); works offline once loaded.
- Controls: drag/tap on touch, or mouse; ← → / A D aim, Space/↓ drop, P pause, M sound, N music, R restart.
- Fonts: Permanent Marker, Patrick Hand, Rubik Doodle Shadow, Fredoka (SIL OFL).
- Service worker cache names start with `junkies-` (not `say-cheese-`, which Say Cheese's worker cleans up).
- Source: `tools/photolab/out/say-cheese-junkies` in the studio repo. To update, rebuild `demo.html`, copy it over
  `index.html` (keep the manifest/icon/noindex tags and the `register-sw.js` script) and bump `CACHE_VERSION` in `sw.js`.
