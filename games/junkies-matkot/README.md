# Junkies Matkot (ג׳אנקיס מטקות)

Matkot at Gordon Beach at sunset, starring the Junkies' heads. Each player's head sits on a matka and is the
paddle. Keep the rubber ball in play: where it meets the matka sets its angle, every hit makes it faster, and a
long rally catches fire. Miss and the other side scores. First to 7 wins, then the winning point plays again and
you get a result card to send to the group.

The game is in Hebrew and plays in landscape. It is a link-only game: it is not listed on the arcade home page
and asks search engines not to index it.

**Age band:** adults (made for the Junkies group); the content is family-safe.

## How to play

- **Two players, one screen:** each player picks a head on their half (swipe the carousel or tap 🎲), then taps
  ready. Each player drags anywhere on their own half to move their matka.
- **Solo:** tap "נגד המחשב" to play the computer, which picks a random head.
- Where the ball hits the matka sets the angle it leaves at; a flick adds spin.
- A player who falls 3 points behind gets a bigger head until the score is close again.
- Rematch keeps the same heads. Each head keeps its own win tally between visits.

## Controls

- **Touch:** drag on your own half. Two players can play at the same time with one finger each.
- **Keyboard:** left player `W` / `S`, right player `↑` / `↓`. On the pick screen: `W` / `S` and `↑` / `↓`
  browse, `D` and `←` are ready, `Enter` starts with both ready.
- `Esc` or `P` pauses, `M` mutes. `Space` or `Enter` skips the winning-point replay, and on the result screen
  starts a rematch.
- The game pauses when you switch tabs or turn the phone to portrait.

## Comforts

Pause, sound switch, reduced motion (no shake, flashes or ripples), instant rematch, and on-screen guides in the
first match of a visit. Picks, win tallies and settings are saved on this device only. It works offline once
loaded and can be installed as an app.

## Credits

Made by The Game Company for the Junkies. The faces are used with the group's permission, for this game only.
Fonts: Secular One and Varela Round, both under the SIL Open Font License (license texts in `fonts/`). Sound is
synthesised in the browser.

## Known issues

- Sharing the result card on iPhone has not been tested on a real device; if the share sheet does not open, the
  card is saved as an image instead.

## Run locally

The game code loads as ES modules, which browsers block from a plain `file://` page. Serve the folder with any
static file server (for example `python -m http.server`) and open it over `http://`.
