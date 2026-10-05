# Say Cheese!

A customised take on **Bloop Stack** by The Game Company, built from a family photo. Drop the faces into the jar,
merge matching pairs up seven tiers, and get everyone back into the picture. Two of the biggest faces make a
**family photo**.

The first of the studio's custom games: faces cut out of a real photo with the photolab toolkit, plus WebGL shaders
(eyelid blinks, depth parallax, film burn, shockwaves, grain).

Unlisted: it is not in `games.json` and does not appear on the arcade home page. Open it by its link.

- One self-contained `index.html` (images, fonts, sound all inline); works offline once loaded.
- Controls: drag/tap on touch, or mouse; ← → / A D aim, Space/↓ drop, P pause, M sound, N music, R restart.
- Fonts: Permanent Marker, Patrick Hand (SIL OFL).
- Source: `tools/photolab/out/say-cheese` in the studio repo. To update, rebuild `demo.html`, copy it over
  `index.html` (keep the manifest/icon/noindex tags and the `register-sw.js` script) and bump `CACHE_VERSION` in `sw.js`.
