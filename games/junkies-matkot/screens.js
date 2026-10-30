// DOM screens, matching the Designer's skin.css class contract (THE-1107 DESIGN.md §6; markup
// reference design/junkies-matkot/screens.html). Physical left/right boxes use `direction: ltr`
// (`.jm-screen`); only text runs RTL. The score is wrapped in LRI...PDI (U+2066/9) so it reads e.g.
// 7-4, never flipped by bidi. A1: Tab/Shift+Tab walks the centre tubes with a visible focus ring
// (skin.css); `C` = solo. Rendering/DOM wiring only -- not TDD-covered.
import { HEADS, headById } from "./faces.js";
import { drawHeadPortrait } from "./render/headSprite.js";

const LRI = "⁦", PDI = "⁩";
const h = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };

// THE-1119 M6: the pick-screen carousel head, loaded once per src and cached (see headSprite.js's
// own tint cache for the die-cut/glow copies it derives from the same Image).
const portraitImgCache = new Map();
function loadPortraitImg(src) {
  if (portraitImgCache.has(src)) return portraitImgCache.get(src);
  const img = new Image();
  const ready = new Promise((resolve) => {
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
  });
  img.src = src;
  portraitImgCache.set(src, ready);
  return ready;
}

export function createScreens(root, theme, callbacks = {}) {
  const cb = (name, ...args) => { if (callbacks[name]) callbacks[name](...args); };

  // ---- pick (= title, G7) -------------------------------------------------
  function halfMarkup(side) {
    const s = side === 0 ? "l" : "r";
    return `
      <section class="jm-half jm-half--${s}" data-side="${side}" aria-label="${side === 0 ? "שחקן שמאל" : "שחקן ימין"}">
        <div class="jm-sign jm-half__name" data-side="${side}"></div>
        <div class="jm-carousel">
          <button class="jm-iconbtn jm-prev" data-side="${side}" aria-label="הקודם" tabindex="-1"><span class="jm-icon-prev"></span></button>
          <div class="jm-carousel__head" data-side="${side}"><canvas width="300" height="300"></canvas></div>
          <button class="jm-iconbtn jm-next" data-side="${side}" aria-label="הבא" tabindex="-1"><span class="jm-icon-next"></span></button>
        </div>
        <div class="jm-half__line" data-side="${side}"></div>
        <div class="jm-strip" aria-hidden="true" data-side="${side}">
          ${HEADS.map((hd) => `<span class="jm-strip__face" data-id="${hd.id}"><img src="${hd.image}" alt=""></span>`).join("")}
        </div>
        <div class="jm-half__actions">
          <button class="jm-tube jm-tube--cream jm-tube--icon jm-dice" data-side="${side}" aria-label="ראש אקראי" tabindex="-1"><span class="jm-tube__sym">🎲</span></button>
          <button class="jm-tube jm-ready" data-side="${side}" tabindex="-1">מוכן?</button>
        </div>
      </section>`;
  }

  // THE-1184 S6/THE-1185 B3 (CTO review r3, DESIGN.md §13.6, board note 4): the calm main screen.
  // jm-pick--calm is scoped CSS (skin.css) that hides .jm-strip/.jm-half__line/.jm-half__actions/
  // .jm-pick__utils and resizes the carousel/primary -- the markup below just adds the class, the new
  // icon row, and reorders title -> primary -> hint per the designer's spacing note; the old r2
  // elements stay in the DOM (now hidden by that CSS) rather than being deleted, so nothing else that
  // queries them needs to change.
  const pick = h(`<div class="jm-screen jm-pick jm-pick--calm">
    ${halfMarkup(0)}
    <div class="jm-pick__center">
      <h1 class="jm-title">
        <span class="jm-sign jm-title__small">${theme.title.split(" ")[0] || ""}</span>
        <span class="jm-sign jm-sign--sun jm-title__big" data-text="${theme.title.split(" ").slice(1).join(" ") || theme.title}">${theme.title.split(" ").slice(1).join(" ") || theme.title}</span>
      </h1>
      <button class="jm-tube jm-tube--gold jm-solo jm-play" tabindex="0">${theme.text.play}</button>
      <p class="jm-pick__hint">הראשון ל-7 לוקח</p>
      <div class="jm-sign jm-countdown"></div>
    </div>
    ${halfMarkup(1)}
    <div class="jm-pick__icons">
      <button class="jm-iconbtn jm-about" tabindex="0" aria-label="אודות והגדרות"><span class="jm-icon-menu"></span></button>
      <button class="jm-iconbtn jm-sound" tabindex="0" aria-pressed="true" aria-label="צליל"><span class="jm-icon-sound"></span></button>
      <button class="jm-iconbtn jm-pick-fullscreen" tabindex="0" aria-pressed="false" aria-label="מסך מלא"><span class="jm-icon-fullscreen"></span></button>
    </div>
  </div>`);

  const sides = [0, 1];
  const headCanvases = sides.map((s) => pick.querySelector(`.jm-carousel__head[data-side="${s}"] canvas`));
  const headNames = sides.map((s) => pick.querySelector(`.jm-half__name[data-side="${s}"]`));
  const headLines = sides.map((s) => pick.querySelector(`.jm-half__line[data-side="${s}"]`));
  const strips = sides.map((s) => pick.querySelector(`.jm-strip[data-side="${s}"]`));
  const readyBtns = sides.map((s) => pick.querySelector(`.jm-ready[data-side="${s}"]`));
  const halves = sides.map((s) => pick.querySelector(`.jm-half[data-side="${s}"]`));
  const countdownEl = pick.querySelector(".jm-countdown");
  const soloBtn = pick.querySelector(".jm-solo");
  const aboutBtn = pick.querySelector(".jm-about");
  const soundBtn = pick.querySelector(".jm-sound");
  const pickFullscreenBtn = pick.querySelector(".jm-pick-fullscreen");

  for (const btn of pick.querySelectorAll(".jm-prev")) btn.addEventListener("click", () => cb("cycle", Number(btn.dataset.side), -1));
  for (const btn of pick.querySelectorAll(".jm-next")) btn.addEventListener("click", () => cb("cycle", Number(btn.dataset.side), 1));
  for (const btn of pick.querySelectorAll(".jm-dice")) btn.addEventListener("click", () => cb("randomize", Number(btn.dataset.side)));
  for (const btn of readyBtns) btn.addEventListener("click", () => cb("toggleReady", Number(btn.dataset.side)));
  soloBtn.addEventListener("click", () => cb("openSoloSheet"));
  aboutBtn.addEventListener("click", () => cb("about"));
  soundBtn.addEventListener("click", () => cb("toggleSound"));
  pickFullscreenBtn.addEventListener("click", () => cb("toggleFullscreen"));

  // THE-1142 S5b (board note 7): both toggle buttons (pick screen + HUD) share one state, kept in sync
  // with the real Fullscreen API -- including a change the game didn't initiate itself (Esc, the
  // back gesture). Hidden entirely where the API doesn't exist (iPhone Safari).
  function setFullscreenState(supported, active) {
    pickFullscreenBtn.hidden = !supported;
    hudFullscreenBtn.hidden = !supported;
    pickFullscreenBtn.setAttribute("aria-pressed", String(active));
    hudFullscreenBtn.setAttribute("aria-pressed", String(active));
  }

  function paintPortrait(side, head) {
    const canvas = headCanvases[side];
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const d = Math.min(canvas.width, canvas.height) * 0.72;
    loadPortraitImg(head.image).then((img) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawHeadPortrait(ctx, img, canvas.width / 2, canvas.height / 2, d, theme.playerColors[side], { side: side === 0 ? -1 : 1 });
    });
  }

  // youSide: THE-1141 DESIGN.md §11.2 -- a gold "אתם" tag beside the human's name, solo only, during
  // the CPU's dice spin (shown on the pick screen while that's happening).
  function renderPick(ids, ready, muted, youSide = null) {
    for (const side of sides) {
      const head = headById(ids[side]);
      if (!head) continue;
      paintPortrait(side, head);
      headNames[side].innerHTML = "";
      headNames[side].textContent = head.name;
      if (side === youSide) headNames[side].insertAdjacentHTML("beforeend", '<span class="jm-you">אתם</span>');
      headLines[side].textContent = head.lines[0];
      readyBtns[side].innerHTML = ready[side] ? 'מוכן <span class="jm-tube__sym">✓</span>' : "מוכן?";
      readyBtns[side].classList.toggle("is-ready", ready[side]);
      for (const face of strips[side].children) face.setAttribute("aria-current", String(face.dataset.id === ids[side]));
    }
    // THE-1185 B3: the sound button is icon-only now (.jm-icon-sound's ::after draws the muted slash
    // off aria-pressed, skin.css), no text content to swap.
    soundBtn.setAttribute("aria-pressed", String(!muted));
  }

  function setCountdown(secondsLeft) {
    countdownEl.innerHTML = secondsLeft != null ? `מתחילים בעוד <span class="jm-num">${Math.ceil(secondsLeft)}</span>` : "";
  }

  // THE-1185 B3 (DESIGN.md §13.6): the pick screen's own install button moved out under the calm
  // layout -- the About sheet's .jm-install2 (already wired below) is the only entry point now.
  function setInstallVisible(on) { aboutInstallBtn.hidden = !on; }
  function setCpuHalf(side, on) { halves[side]?.classList.toggle("is-cpu", on); }

  // ---- solo setup sheet (THE-1141 DESIGN.md §11.2, design/junkies-matkot/r1/solo-sheet.html) --------
  // Side tubes are DOM-order == physical order inside their own `direction: ltr` group (skin.css
  // .jm-seg--side), independent of the page's RTL, per the designer's "the left tube is the left side,
  // whatever the text direction" rule. Each side tube's head image is repainted from whichever head is
  // currently on that physical half of the pick screen (renderSoloSheet), so the choice reads as
  // "I play as <head> on the left/right", not a static placeholder.
  // THE-1185 B3 (DESIGN.md §13.6): the old solo-only sheet becomes the play sheet, one tap deeper from
  // the calm main screen's single primary. A new "נגד מי?" mode row picks CPU vs. a friend on this
  // screen; friend mode hides the side/level rows (skin.css, keyed off [data-mode="friend"]) since
  // neither applies to a local 2-player match. The element/class names (soloSheet, jm-soloGo, etc.)
  // stay as-is so QA/test scripts that already look for them keep working.
  const soloSheet = h(`<div class="jm-scrim" hidden><div class="jm-towel jm-sheet jm-solo-sheet" role="dialog" aria-label="משחק חדש" data-mode="cpu">
    <div class="jm-sign jm-sign--p2 jm-sheet__title">משחק חדש</div>
    <div class="jm-sheet__row"><span>נגד מי?</span>
      <div class="jm-seg jm-seg--mode" role="group" aria-label="נגד מי">
        <button class="jm-tube" data-mode="cpu" aria-pressed="true">המחשב</button>
        <button class="jm-tube" data-mode="friend" aria-pressed="false">חבר על המסך</button>
      </div>
    </div>
    <div class="jm-sheet__row jm-sheet__row--side"><span>באיזה צד אתם?</span>
      <div class="jm-seg jm-seg--side" role="group" aria-label="צד">
        <button class="jm-tube" data-side="0" aria-pressed="false"><span class="jm-seg__head"><img alt=""></span>שמאל</button>
        <button class="jm-tube" data-side="1" aria-pressed="false"><span class="jm-seg__head"><img alt=""></span>ימין</button>
      </div>
    </div>
    <div class="jm-sheet__row jm-sheet__row--level"><span>רמה</span>
      <div class="jm-seg jm-seg--level" role="group" aria-label="רמה">
        <button class="jm-tube" data-level="easy" aria-pressed="false">תייר<span class="jm-seg__plain">קל</span></button>
        <button class="jm-tube" data-level="medium" aria-pressed="false">מקומי<span class="jm-seg__plain">בינוני</span></button>
        <button class="jm-tube" data-level="hard" aria-pressed="false">אלוף החוף<span class="jm-seg__plain">קשה</span></button>
      </div>
    </div>
    <p class="jm-sheet__fine jm-sheet__fine--point"></p>
    <p class="jm-sheet__fine">הכו חזק = כדור מהיר · ליטוף = כדור איטי</p>
    <p class="jm-sheet__fine jm-sheet__fine--keys" hidden></p>
    <div class="jm-sheet__actions"><button class="jm-tube jm-tube--big jm-soloGo">יאללה!</button><button class="jm-tube jm-tube--cream jm-tube--small jm-soloBack">חזרה</button></div>
  </div></div>`);
  const soloSheetScrim = soloSheet; // the scrim itself is the outer element
  const soloSheetDialog = soloSheet.querySelector(".jm-solo-sheet");
  const soloModeTubes = [...soloSheet.querySelectorAll(".jm-seg--mode > .jm-tube")];
  const soloSideTubes = [...soloSheet.querySelectorAll(".jm-seg--side > .jm-tube")];
  const soloLevelTubes = [...soloSheet.querySelectorAll(".jm-seg--level > .jm-tube")];
  const soloFinePoint = soloSheet.querySelector(".jm-sheet__fine--point");
  const soloFineKeys = soloSheet.querySelector(".jm-sheet__fine--keys");
  const soloGoBtn = soloSheet.querySelector(".jm-soloGo");
  const soloBackBtn = soloSheet.querySelector(".jm-soloBack");
  for (const btn of soloModeTubes) btn.addEventListener("click", () => cb("setPlayMode", btn.dataset.mode));
  for (const btn of soloSideTubes) btn.addEventListener("click", () => cb("setSoloSide", Number(btn.dataset.side)));
  for (const btn of soloLevelTubes) btn.addEventListener("click", () => cb("setCpuLevel", btn.dataset.level));
  soloGoBtn.addEventListener("click", () => cb("soloGo"));
  soloBackBtn.addEventListener("click", () => cb("soloBack"));

  // THE-1185 B3 (DESIGN.md §13.3/§13.4): mode is "cpu" | "friend"; isKeyboard is a coarse-pointer check
  // (the caller already computes this for the first-match guides, so it's passed in rather than
  // re-detected here).
  function renderSoloSheet(ids, side, level, mode = "cpu", isKeyboard = false) {
    soloSheetDialog.dataset.mode = mode;
    for (const btn of soloModeTubes) btn.setAttribute("aria-pressed", String(btn.dataset.mode === mode));
    for (const btn of soloSideTubes) {
      const s = Number(btn.dataset.side);
      const on = s === side;
      btn.setAttribute("aria-pressed", String(on));
      const head = headById(ids[s]);
      if (head) btn.querySelector(".jm-seg__head > img").src = head.image;
    }
    for (const btn of soloLevelTubes) btn.setAttribute("aria-pressed", String(btn.dataset.level === level));
    soloFinePoint.textContent = mode === "friend"
      ? "כדור שעובר את הקו שלכם = נקודה לצד השני · הראשון ל-7 לוקח"
      : "כדור שעובר את הקו שלכם = נקודה למחשב · הראשון ל-7 לוקח";
    soloFineKeys.hidden = !isKeyboard;
    soloFineKeys.textContent = mode === "friend" ? "שמאל: W A S D · ימין: החיצים" : "W A S D או החיצים";
  }
  function showSoloSheet() { soloSheetScrim.hidden = false; soloGoBtn.focus(); } // designer: focus starts on "יאללה!"
  function hideSoloSheet() { soloSheetScrim.hidden = true; }

  // ---- match HUD ------------------------------------------------------
  const hud = h(`<div class="jm-screen jm-hud">
    <div class="jm-sign jm-name jm-name--l"></div>
    <div class="jm-sign jm-name jm-name--r"></div>
    <div class="jm-sign jm-score jm-score--l"><span class="jm-num"></span></div>
    <div class="jm-sign jm-score jm-score--r"><span class="jm-num"></span></div>
    <button class="jm-iconbtn jm-pause" aria-label="השהיה"><span class="jm-icon-pause"></span></button>
    <button class="jm-iconbtn jm-fullscreen" aria-label="מסך מלא" aria-pressed="false"><span class="jm-icon-fullscreen"></span></button>
    <div class="jm-sign jm-rally"></div>
    <div class="jm-guide jm-guide--l" hidden></div>
    <div class="jm-guide jm-guide--r" hidden></div>
  </div>`);
  const nameLeft = hud.querySelector(".jm-name--l");
  const nameRight = hud.querySelector(".jm-name--r");
  const scoreLeft = hud.querySelector(".jm-score--l .jm-num");
  const scoreRight = hud.querySelector(".jm-score--r .jm-num");
  const rallyLabel = hud.querySelector(".jm-rally");
  const guides = [hud.querySelector(".jm-guide--l"), hud.querySelector(".jm-guide--r")];
  const hudFullscreenBtn = hud.querySelector(".jm-fullscreen");

  // THE-1119 M4: first-match guides (design/junkies-matkot/screens.html's two markup variants --
  // touch gets a dotted drag arrow + ghost thumb, keyboard gets two keycaps). Shown once per side on
  // the very first match, faded on that side's first touch or key (fadeGuide). Solo: left side only.
  // THE-1184 S6 (DESIGN.md §13.3): the zone adds a 2nd axis, so touch gets a 4-way cross (two arrows,
  // the second rotated 90deg) instead of one, and keyboard gets 4 keycaps in an inverted T
  // (.jm-guide__keys, skin.css) -- W/A/S/D on the left, the arrow cluster on the right -- plus one
  // .jm-guide__words line under each, per side.
  function showGuides(isTouch, solo = false, humanSide = 0) {
    if (isTouch) {
      // THE-1185 N3 (CTO review r3): the x arrow uses the designer's own class (skin.css
      // .jm-guide__arrow--x, THE-1187 B4 follow-up), not an inline rotate style.
      const cross = `<div class="jm-guide__arrow"></div><div class="jm-guide__arrow jm-guide__arrow--x"></div><div class="jm-guide__thumb"></div>`;
      guides[0].innerHTML = `${cross}<div class="jm-guide__words">גוררים לכל כיוון</div>`;
      guides[1].innerHTML = `${cross}<div class="jm-guide__words">גוררים לכל כיוון</div>`;
    } else {
      guides[0].innerHTML = `<div class="jm-guide__keys"><span class="jm-keycap">W</span><span class="jm-keycap">A</span><span class="jm-keycap">S</span><span class="jm-keycap">D</span></div><div class="jm-guide__words">W A S D: לכל הכיוונים</div>`;
      guides[1].innerHTML = `<div class="jm-guide__keys"><span class="jm-keycap jm-keycap--sym">↑</span><span class="jm-keycap jm-keycap--sym">←</span><span class="jm-keycap jm-keycap--sym">↓</span><span class="jm-keycap jm-keycap--sym">→</span></div><div class="jm-guide__words">החיצים: לכל הכיוונים</div>`;
    }
    for (const g of guides) { g.hidden = false; g.classList.remove("is-gone"); }
    if (solo) guides[1 - humanSide].hidden = true; // THE-1142 S3: hide the CPU side's guide, whichever side that is
  }
  function fadeGuide(side) { guides[side]?.classList.add("is-gone"); }
  function hideGuides() { for (const g of guides) { g.hidden = true; g.classList.remove("is-gone"); g.innerHTML = ""; } }
  hud.querySelector(".jm-pause").addEventListener("click", () => cb("pause"));
  hudFullscreenBtn.addEventListener("click", () => cb("toggleFullscreen"));

  // ---- meme moments (G13) ---------------------------------------------
  const memeLayer = h(`<div class="jm-meme-layer"></div>`);
  function showMoment(fired, content) {
    for (const el of memeLayer.children) el.remove();
    let el;
    if (fired.type === "smash") {
      // B6/THE-1117: content.name/content.line are head data (faces.js), not static markup -- build
      // with textContent rather than interpolating them into the HTML string.
      el = h(`<div class="jm-meme jm-meme--smash" data-side="${fired.side === 0 ? "l" : "r"}">
        <div class="jm-meme__veil"></div>
        <div class="jm-sunburst"></div>
        <div class="jm-meme__face"></div>
        <div class="jm-megaphone"><span class="jm-megaphone__text"></span></div>
        <div class="jm-sign jm-sign--p${fired.side === 0 ? 1 : 2} jm-meme__caption"><span class="jm-meme__name"></span> · סמאש <span class="jm-num"></span> קמ״ש</div>
      </div>`);
      el.querySelector(".jm-megaphone__text").textContent = content.line || "";
      el.querySelector(".jm-meme__name").textContent = content.name || "";
      el.querySelector(".jm-num").textContent = String(Math.round(content.speedKmh || 0));
      const faceImg = document.createElement("img");
      faceImg.src = content.image || "";
      el.querySelector(".jm-meme__face").appendChild(faceImg);
    } else if (fired.type === "comeback") {
      el = h(`<div class="jm-meme jm-meme--comeback"><div class="jm-megaphone"><span class="jm-megaphone__text"></span></div></div>`);
      el.querySelector(".jm-megaphone__text").textContent = `${content.name || ""}!!!`;
    } else if (fired.type === "matchPoint") {
      el = h(`<div class="jm-meme jm-meme--matchpoint"><div class="jm-megaphone"><span class="jm-megaphone__text">נקודת משחק!</span></div></div>`);
    }
    if (el) memeLayer.appendChild(el);
  }
  function clearMoment() { for (const el of memeLayer.children) el.remove(); }

  // THE-1156 S4 (board note 4, DESIGN.md §12.3): the "point!" moment, on the sim's "point" event. Lives
  // in .jm-hud per the designer's spec; the game removes it on a timer (--jm-t-point, 1100ms), never on
  // animationend. x/y are CSS px, already computed by the caller (the crossing point on the conceder's line).
  function showPointMoment(x, y, side, whoName) {
    clearPointMoment();
    const el = h(`<div class="jm-point jm-point--p${side === 0 ? 1 : 2}" style="--x:${x}px;--y:${y}px">
      <span class="jm-point__word jm-sign">נקודה!</span>
      <span class="jm-point__who">ל<bdi></bdi></span>
    </div>`);
    el.querySelector(".jm-point__who bdi").textContent = whoName || "";
    hud.appendChild(el);
  }
  function clearPointMoment() { for (const el of hud.querySelectorAll(".jm-point")) el.remove(); }

  // THE-1162 (DESIGN.md §12.5): a crowd entry speech bubble, shown once per distraction crossing the
  // court's interior band. Lives in .jm-hud, same timer-not-animationend removal rule as showPointMoment
  // above. x/y are CSS px, set by the caller each frame while the bubble is up (the sprite keeps moving).
  function showBubble(text, x, y, below) {
    clearBubble();
    const el = h(`<div class="jm-bubble${below ? " jm-bubble--below" : ""}" style="--x:${x}px;--y:${y}px"></div>`);
    el.textContent = text;
    hud.appendChild(el);
  }
  function updateBubblePosition(x, y, below) {
    const el = hud.querySelector(".jm-bubble");
    if (!el) return;
    el.style.setProperty("--x", `${x}px`);
    el.style.setProperty("--y", `${y}px`);
    el.classList.toggle("jm-bubble--below", !!below);
  }
  function setBubbleOut() { hud.querySelector(".jm-bubble")?.classList.add("is-out"); }
  function clearBubble() { for (const el of hud.querySelectorAll(".jm-bubble")) el.remove(); }

  // THE-1156 S4 (board note 4, DESIGN.md §12.4): the first-serve teaching banner, shown once per device
  // (the same flag as the first-match guides). The game removes it on a timer (--jm-t-teach + 300ms).
  function showTeachBanner() {
    if (hud.querySelector(".jm-teach")) return;
    const el = h(`<div class="jm-teach"><div class="jm-megaphone"><span class="jm-megaphone__text">
      <span class="jm-teach__big">מחזירים עם המטקה!</span>
      <span class="jm-teach__small">כדור שעובר את הקו שלכם = נקודה לצד השני</span>
    </span></div></div>`);
    hud.appendChild(el);
  }
  function clearTeachBanner() { for (const el of hud.querySelectorAll(".jm-teach")) el.remove(); }

  // THE-1184 S6 (DESIGN.md §13.4): the impact-physics teaching banner, once per device
  // (save.impactTipSeen) -- never on the same serve as showTeachBanner() above, so game.js queues this
  // for the serve after this match's first point instead when the r2 banner also showed. Same markup
  // class and clear path (clearTeachBanner) as the r2 banner, just different copy.
  // THE-1189: returns whether it actually rendered, so game.js only spends the one-shot
  // impactTipSeen flag on a serve where the banner wasn't blocked by an older .jm-teach.
  function showImpactTeachBanner() {
    if (hud.querySelector(".jm-teach")) return false;
    const el = h(`<div class="jm-teach"><div class="jm-megaphone"><span class="jm-megaphone__text">
      <span class="jm-teach__big">הכו חזק = כדור מהיר!</span>
      <span class="jm-teach__small">ליטוף = כדור איטי · אפשר לרוץ קדימה עד הקו בחול</span>
    </span></div></div>`);
    hud.appendChild(el);
    return true;
  }

  // THE-1141 DESIGN.md §11.3: a "נגיעה מדלגת" pill fades in once a moment becomes skippable (keyboard-
  // only devices read "כל מקש מדלג" instead).
  const skipHint = h(`<div class="jm-skip-hint" hidden>נגיעה מדלגת</div>`);
  function setSkipHintVisible(on, keyboardOnly = false) {
    skipHint.hidden = !on;
    if (on) skipHint.textContent = keyboardOnly ? "כל מקש מדלג" : "נגיעה מדלגת";
  }

  // ---- result (G14) -----------------------------------------------------
  const result = h(`<div class="jm-screen jm-result">
    <div class="jm-print"></div>
    <div class="jm-towel jm-result__panel">
      <div class="jm-sign jm-sign--sun jm-result__head"></div>
      <div class="jm-sign jm-result__score"><span class="jm-num"></span></div>
      <button class="jm-tube jm-rematch">${theme.text.rematch}</button>
      <p class="jm-result__hint">אותם ראשים, מחליפים צדדים</p>
      <button class="jm-tube jm-tube--p1 jm-share">שתפו את הכרטיס</button>
      <button class="jm-tube jm-tube--gold jm-replayAgain">▶ הנקודה המנצחת</button>
      <button class="jm-tube jm-tube--cream jm-tube--small jm-changeHeads">ראשים אחרים</button>
    </div>
  </div>`);
  result.querySelector(".jm-share").addEventListener("click", () => cb("share"));
  result.querySelector(".jm-replayAgain").addEventListener("click", () => cb("replayAgain"));
  const resultHead = result.querySelector(".jm-result__head");
  const resultScore = result.querySelector(".jm-result__score .jm-num");
  const cardSlot = result.querySelector(".jm-print");

  // ---- replay (B1/G14; DESIGN.md §6 "Replay" row) -------------------------
  const replay = h(`<div class="jm-screen jm-letterbox" hidden>
    <div class="jm-replaytag"><span class="jm-replaytag__dot"></span><span>הנקודה המנצחת · הילוך איטי</span></div>
    <div class="jm-replay-skip">נגיעה מדלגת</div>
  </div>`);

  // ---- rotate (G21) -------------------------------------------------------
  const rotate = h(`<div class="jm-screen jm-rotate" role="alert" hidden>
    <div class="jm-rotate__phone"></div>
    <div class="jm-sign jm-rotate__title jm-rotateTitle">${theme.text.rotate || "סובבו את הטלפון"}</div>
    <p class="jm-rotate__sub">מטקות משחקים לרוחב, אגודל לכל שחקן</p>
  </div>`);

  // ---- pause / about sheets -----------------------------------------------
  const pauseSheet = h(`<div class="jm-scrim" hidden><div class="jm-towel jm-sheet" role="dialog" aria-label="השהיה">
    <div class="jm-sign jm-sign--p2 jm-sheet__title">הפסקה</div>
    <div class="jm-sheet__row"><span>צליל</span><button class="jm-toggle jm-pauseSound" role="switch" aria-checked="true" aria-label="צליל"></button></div>
    <div class="jm-sheet__row"><span>הפחתת תנועה<small>בלי רעידות, הבזקים וגלים</small></span><button class="jm-toggle jm-pauseReduceMotion" role="switch" aria-checked="false" aria-label="הפחתת תנועה"></button></div>
    <div class="jm-sheet__actions"><button class="jm-tube jm-tube--big jm-resume">המשך</button><button class="jm-tube jm-tube--cream jm-tube--small jm-pauseToPick">למסך הפתיחה</button></div>
  </div></div>`);
  pauseSheet.querySelector(".jm-resume").addEventListener("click", () => cb("resume"));
  pauseSheet.querySelector(".jm-pauseToPick").addEventListener("click", () => cb("pauseToPick"));
  pauseSheet.querySelector(".jm-pauseSound").addEventListener("click", () => cb("toggleSound"));
  const pauseReduceMotionToggle = pauseSheet.querySelector(".jm-pauseReduceMotion");
  pauseReduceMotionToggle.addEventListener("click", () => cb("toggleReduceMotion"));

  const aboutSheet = h(`<div class="jm-scrim" hidden><div class="jm-towel jm-sheet" role="dialog" aria-label="אודות">
    <div class="jm-sign jm-sign--p2 jm-sheet__title">אודות והגדרות</div>
    <div class="jm-sheet__row"><span>צליל</span><button class="jm-toggle jm-aboutSound" role="switch" aria-checked="true" aria-label="צליל"></button></div>
    <div class="jm-sheet__row"><span>הפחתת תנועה<small>בלי רעידות, הבזקים וגלים</small></span><button class="jm-toggle jm-aboutReduceMotion" role="switch" aria-checked="false" aria-label="הפחתת תנועה"></button></div>
    <p class="jm-sheet__fine">משחק של <bdi>The Game Company</bdi> לג'אנקיס. הפרצופים באישור החבר'ה, למשחק הזה בלבד. גופנים: <bdi>Secular One</bdi>, <bdi>Varela Round</bdi> (<bdi>OFL</bdi>).</p>
    <p class="jm-sheet__version">גרסה <bdi></bdi></p>
    <div class="jm-sheet__actions"><button class="jm-tube jm-aboutClose">חזרה למשחק</button><button class="jm-tube jm-tube--cream jm-tube--small jm-install2" hidden>התקנה</button></div>
  </div></div>`);
  const versionBdi = aboutSheet.querySelector(".jm-sheet__version bdi");
  function setVersion(text) { versionBdi.textContent = text; }
  aboutSheet.querySelector(".jm-aboutClose").addEventListener("click", () => cb("about", false));
  aboutSheet.querySelector(".jm-aboutSound").addEventListener("click", () => cb("toggleSound"));
  const aboutReduceMotionToggle = aboutSheet.querySelector(".jm-aboutReduceMotion");
  aboutReduceMotionToggle.addEventListener("click", () => cb("toggleReduceMotion"));
  const aboutInstallBtn = aboutSheet.querySelector(".jm-install2");
  aboutInstallBtn.addEventListener("click", () => cb("install"));

  root.appendChild(pick);
  root.appendChild(hud);
  root.appendChild(memeLayer);
  root.appendChild(skipHint);
  root.appendChild(result);
  root.appendChild(replay);
  root.appendChild(rotate);
  root.appendChild(soloSheet);
  root.appendChild(pauseSheet);
  root.appendChild(aboutSheet);

  function setSelectValues(ids) { cb("_setIds", ids); }

  function show(name) {
    pick.hidden = name !== "pick";
    hud.hidden = name !== "match";
    result.hidden = name !== "result";
    replay.hidden = name !== "replay";
    if (name !== "match") { clearMoment(); setSkipHintVisible(false); }
  }

  // youSide: THE-1141 -- the "אתם" tag beside the human's name in the HUD, solo only, until the first
  // point ends (the caller decides when that window has closed).
  function updateHud(score, rally, names, youSide = null) {
    scoreLeft.textContent = `${LRI}${score[0]}${PDI}`;
    scoreRight.textContent = `${LRI}${score[1]}${PDI}`;
    if (names) {
      nameLeft.innerHTML = ""; nameLeft.textContent = names[0];
      nameRight.innerHTML = ""; nameRight.textContent = names[1];
      if (youSide === 0) nameLeft.insertAdjacentHTML("beforeend", '<span class="jm-you">אתם</span>');
      else if (youSide === 1) nameRight.insertAdjacentHTML("beforeend", '<span class="jm-you">אתם</span>');
    }
    rallyLabel.textContent = rally >= 2 ? `${theme.text.rally} ${LRI}${rally}${PDI}` : "";
    rallyLabel.classList.toggle("is-hot", rally >= 8 && rally < 12);
    rallyLabel.classList.toggle("is-fire", rally >= 12);
  }

  function updateResult(winnerSide, score, headIds) {
    const winner = headById(headIds[winnerSide]);
    const line2 = winner ? winner.lines[1] ?? winner.lines[0] : "";
    resultHead.textContent = `${winner ? winner.name : ""} לקח!`;
    resultHead.setAttribute("data-text", resultHead.textContent);
    resultScore.innerHTML = `<span>${LRI}${score[0]}${PDI}</span><span>-</span><span>${LRI}${score[1]}${PDI}</span>`;
    if (line2) result.querySelector(".jm-result__hint").textContent = line2;
  }

  function setPauseState(reduceMotion, muted) {
    for (const t of [pauseReduceMotionToggle, aboutReduceMotionToggle]) t.setAttribute("aria-checked", String(reduceMotion));
    for (const t of [pauseSheet.querySelector(".jm-pauseSound"), aboutSheet.querySelector(".jm-aboutSound")]) t.setAttribute("aria-checked", String(!muted));
  }

  return {
    el: {
      pick, hud, result, replay, rotate, pauseSheet, aboutSheet,
      soloSheet: soloSheetScrim, soloGoBtn, soloBackBtn, soloModeTubes, soloSideTubes, soloLevelTubes,
      rotateTitle: rotate.querySelector(".jm-rotateTitle"),
      startBtn: null,
      rematchBtn: result.querySelector(".jm-rematch"),
      changeHeadsBtn: result.querySelector(".jm-changeHeads"),
      replayAgainBtn: result.querySelector(".jm-replayAgain"),
      soloBtn, aboutBtn, soundBtn, installBtn: aboutInstallBtn,
      shareBtn: result.querySelector(".jm-share"),
      cardSlot,
    },
    setSelectValues,
    show,
    updateHud,
    updateResult,
    renderPick,
    renderSoloSheet,
    showSoloSheet,
    hideSoloSheet,
    setSkipHintVisible,
    setCountdown,
    setInstallVisible,
    setFullscreenState,
    setCpuHalf,
    showMoment,
    clearMoment,
    showPointMoment,
    clearPointMoment,
    showBubble,
    updateBubblePosition,
    setBubbleOut,
    clearBubble,
    showTeachBanner,
    showImpactTeachBanner,
    clearTeachBanner,
    setVersion,
    setPauseState,
    showGuides,
    fadeGuide,
    hideGuides,
  };
}
