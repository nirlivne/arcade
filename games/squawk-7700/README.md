# Squawk 7700

A three-minute 3D rescue on a Dunelark Air airliner at dusk. Someone is trying to get into the cockpit. The
Captain squawks 7700 and holds the door, the Passenger runs the aisle, the Captain pulls the airliner out of a
dive, and the Off-duty Pilot flies it home under a fighter escort and lands it. Everyone comes home.

The game is in Hebrew and plays in landscape. It is a link-only game: it is not listed on the arcade home page and
asks search engines not to index it.

**Age band:** 12+ (peril and tension; no blood, no weapons shown, and the attacker is never shown).

## How to play

- **Door:** key in 7700, press SQUAWK, then hold the yoke wings-level to lock the door.
- **Aisle:** drag left and right to dodge the trolleys; push up to run.
- **Dive:** pull and hold the yoke until the needle leaves the red.
- **Escort and landing:** keep the wings level, lower the GEAR before 500 ft, and FLARE just above the runway.
- A mistake rewinds a few seconds and costs time. Three mistakes in one stage end the flight.
- **Daily flight No.N:** the same weather and turbulence for everyone that day, with a share line.
- **Stations:** a medal for each of the four stages, kept between visits; replay any cleared stage from the title.

## Controls

- Touch or mouse: drag anywhere to move the yoke; tap the context button (SQUAWK, DOOR, GEAR, FLARE).
- Keyboard: arrow keys or WASD move the yoke; digit keys type the code; `Space` or `Enter` presses the context
  button.
- The pause button sits in the corner of the screen; the game also pauses when you switch tabs or turn the phone
  to portrait.

## Comforts

Pause, sound and vibration switches, reduced motion, a how-to screen on the title, and a first-run demo for each
stage. Best times, medals and the daily result are saved on this device only. It works offline once loaded and can
be installed as an app.

## Run locally

The game code loads as ES modules, which browsers block from a plain `file://` page. Serve the folder with any
static file server (for example `python -m http.server`) and open it over `http://`.

## Known issues

- The FLARE moment is short (about half a second); a missed landing replays the whole approach.
- The runway comes into view at about 1,000 ft on the approach.
- The SQUAWK reminder is easy to miss on a first run.

## Credits

Made by The Game Company. Inspired by the crew and passengers of a real flight on 30 Sep 2026, who all came home.
Fonts: Secular One, IBM Plex Mono and IBM Plex Sans Hebrew, under the SIL Open Font License 1.1 (see `licenses/`).
3D engine: three.js r170, MIT license (see `vendor/LICENSE`).
