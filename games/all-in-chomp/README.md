# All-In Chomp (אול-אין!)

A maze chase on poker night. The dealer deals you one of the eight regulars as your chomper and four others as
your chasers. Eat every chip on the felt while your friends hunt you; grab an ALL IN chip in a corner and they fold,
so now you hunt them. Cards dealt near the dealer's seat build a poker hand that pays out when you clear the table.

The game is in Hebrew and plays in landscape. It is a link-only game made for one poker group: it is not listed
on the arcade home page and asks search engines not to index it.

**Age band:** adults, 12+ content (no real money, alcohol or swearing).

## How to play

- Rest a finger anywhere on the screen: a joystick appears under it. Push it toward a direction, or use the arrow
  keys. Your chomper keeps moving until a wall stops it.
- Caught by a friend = one buy-in lost. You start with three.
- An ALL IN chip in a corner makes the chasers fold for a few seconds: eat them for a chain bonus.
- Pick up the cards that appear below the dealer's seat. At the clear, your best poker hand pays out.
- **שולחן הערב No.N**, the nightly table: the same lineup and deck for everyone that night, with a share line.
- **ספר הידיים**, the hand book: every hand you have made, from a pair to a royal flush, stamped the first time.

## Controls

- Touch: a floating joystick. Rest a finger anywhere, push it toward a direction, keep pushing to steer through
  corners. A mouse drag works the same way.
- Keyboard: arrow keys or WASD. `Esc` or `P` pauses; the game also pauses when you switch tabs or turn the
  phone to portrait.

## Comforts

Pause, mute, a how-to screen reachable from the title and the pause menu, a first-20-seconds safety net on your
first run, and reduced motion when your system asks for it. Best scores, the nightly result and the hand book are
saved on this device only. It works offline once loaded and can be installed as an app.

## Run locally

The game code loads as ES modules, which browsers block from a plain `file://` page. Serve the folder with any
static file server (for example `python -m http.server`) and open it over `http://`.

## Known issues

- The rail beside the maze does not yet show the waiting regulars.
- How-to is text, not pictures, and free play has no share card.

## Credits

Made by The Game Company. Fonts: Rubik Doodle Shadow, Karantina and Fredoka, under the SIL Open Font License 1.1
(see `licenses/`).
