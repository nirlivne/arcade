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

  const pick = h(`<div class="jm-screen jm-pick">
    ${halfMarkup(0)}
    <div class="jm-pick__center">
      <h1 class="jm-title">
        <span class="jm-sign jm-title__small">${theme.title.split(" ")[0] || ""}</span>
        <span class="jm-sign jm-sign--sun jm-title__big" data-text="${theme.title.split(" ").slice(1).join(" ") || theme.title}">${theme.title.split(" ").slice(1).join(" ") || theme.title}</span>
      </h1>
      <p class="jm-pick__hint">מתחילים כששניכם מוכנים · הראשון ל-7 לוקח</p>
      <div class="jm-sign jm-countdown"></div>
      <button class="jm-tube jm-tube--gold jm-solo" tabindex="0">נגד המחשב</button>
      <div class="jm-pick__utils">
        <button class="jm-tube jm-tube--cream jm-tube--small jm-about" tabindex="0">אודות</button>
        <button class="jm-tube jm-tube--cream jm-tube--small jm-install" tabindex="0" hidden>התקנה</button>
        <button class="jm-tube jm-tube--cream jm-tube--small jm-sound" tabindex="0" aria-pressed="true">צליל</button>
        <button class="jm-tube jm-tube--cream jm-tube--small jm-pick-fullscreen" tabindex="0" aria-pressed="false">מסך מלא</button>
      </div>
    </div>
    ${halfMarkup(1)}
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
  const installBtn = pick.querySelector(".jm-install");
  const pickFullscreenBtn = pick.querySelector(".jm-pick-fullscreen");

  for (const btn of pick.querySelectorAll(".jm-prev")) btn.addEventListener("click", () => cb("cycle", Number(btn.dataset.side), -1));
  for (const btn of pick.querySelectorAll(".jm-next")) btn.addEventListener("click", () => cb("cycle", Number(btn.dataset.side), 1));
  for (const btn of pick.querySelectorAll(".jm-dice")) btn.addEventListener("click", () => cb("randomize", Number(btn.dataset.side)));
  for (const btn of readyBtns) btn.addEventListener("click", () => cb("toggleReady", Number(btn.dataset.side)));
  soloBtn.addEventListener("click", () => cb("openSoloSheet"));
  aboutBtn.addEventListener("click", () => cb("about"));
  soundBtn.addEventListener("click", () => cb("toggleSound"));
  installBtn.addEventListener("click", () => cb("install"));
  pickFullscreenBtn.addEventListener("click", () => cb("toggleFullscreen"));

  // THE-1142 S5b (board note 7): both toggle buttons (pick screen + HUD) share one state, kept in sync
  // with the real Fullscreen API -- including a change the game didn't initiate itself (Esc, the
  // back gesture). Hidden entirely where the API doesn't exist (iPhone Safari).
  function setFullscreenState(supported, active) {
    pickFullscreenBtn.hidden = !supported;
    hudFullscreenBtn.hidden = !supported;
    pickFullscreenBtn.setAttribute("aria-pressed", String(active));
    hudFullscreenBtn.setAttribute("aria-pressed", String(active));
    pickFullscreenBtn.textContent = active ? "יציאה ממסך מלא" : "מסך מלא";
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
    soundBtn.textContent = muted ? "🔇" : "צליל";
    soundBtn.setAttribute("aria-pressed", String(!muted));
  }

  function setCountdown(secondsLeft) {
    countdownEl.innerHTML = secondsLeft != null ? `מתחילים בעוד <span class="jm-num">${Math.ceil(secondsLeft)}</span>` : "";
  }

  function setInstallVisible(on) { installBtn.hidden = !on; }
  function setCpuHalf(side, on) { halves[side]?.classList.toggle("is-cpu", on); }

  // ---- solo setup sheet (THE-1141 DESIGN.md §11.2, design/junkies-matkot/r1/solo-sheet.html) --------
  // Side tubes are DOM-order == physical order inside their own `direction: ltr` group (skin.css
  // .jm-seg--side), independent of the page's RTL, per the designer's "the left tube is the left side,
  // whatever the text direction" rule. Each side tube's head image is repainted from whichever head is
  // currently on that physical half of the pick screen (renderSoloSheet), so the choice reads as
  // "I play as <head> on the left/right", not a static placeholder.
  const soloSheet = h(`<div class="jm-scrim" hidden><div class="jm-towel jm-sheet jm-solo-sheet" role="dialog" aria-label="נגד המחשב">
    <div class="jm-sign jm-sign--p2 jm-sheet__title">נגד המחשב</div>
    <div class="jm-sheet__row"><span>באיזה צד אתם?</span>
      <div class="jm-seg jm-seg--side" role="group" aria-label="צד">
        <button class="jm-tube" data-side="0" aria-pressed="false"><span class="jm-seg__head"><img alt=""></span>שמאל</button>
        <button class="jm-tube" data-side="1" aria-pressed="false"><span class="jm-seg__head"><img alt=""></span>ימין</button>
      </div>
    </div>
    <div class="jm-sheet__row"><span>רמה</span>
      <div class="jm-seg jm-seg--level" role="group" aria-label="רמה">
        <button class="jm-tube" data-level="easy" aria-pressed="false">תייר<span class="jm-seg__plain">קל</span></button>
        <button class="jm-tube" data-level="medium" aria-pressed="false">מקומי<span class="jm-seg__plain">בינוני</span></button>
        <button class="jm-tube" data-level="hard" aria-pressed="false">אלוף החוף<span class="jm-seg__plain">קשה</span></button>
      </div>
    </div>
    <div class="jm-sheet__actions"><button class="jm-tube jm-tube--big jm-soloGo">יאללה!</button><button class="jm-tube jm-tube--cream jm-tube--small jm-soloBack">חזרה</button></div>
  </div></div>`);
  const soloSheetScrim = soloSheet; // the scrim itself is the outer element
  const soloSideTubes = [...soloSheet.querySelectorAll(".jm-seg--side > .jm-tube")];
  const soloLevelTubes = [...soloSheet.querySelectorAll(".jm-seg--level > .jm-tube")];
  const soloGoBtn = soloSheet.querySelector(".jm-soloGo");
  const soloBackBtn = soloSheet.querySelector(".jm-soloBack");
  for (const btn of soloSideTubes) btn.addEventListener("click", () => cb("setSoloSide", Number(btn.dataset.side)));
  for (const btn of soloLevelTubes) btn.addEventListener("click", () => cb("setCpuLevel", btn.dataset.level));
  soloGoBtn.addEventListener("click", () => cb("soloGo"));
  soloBackBtn.addEventListener("click", () => cb("soloBack"));

  function renderSoloSheet(ids, side, level) {
    for (const btn of soloSideTubes) {
      const s = Number(btn.dataset.side);
      const on = s === side;
      btn.setAttribute("aria-pressed", String(on));
      const head = headById(ids[s]);
      if (head) btn.querySelector(".jm-seg__head > img").src = head.image;
    }
    for (const btn of soloLevelTubes) btn.setAttribute("aria-pressed", String(btn.dataset.level === level));
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
  function showGuides(isTouch, solo = false, humanSide = 0) {
    guides[0].innerHTML = isTouch
      ? `<div class="jm-guide__arrow"></div><div class="jm-guide__thumb"></div>`
      : `<span class="jm-keycap">W</span><span class="jm-keycap">S</span>`;
    guides[1].innerHTML = isTouch
      ? `<div class="jm-guide__arrow"></div><div class="jm-guide__thumb"></div>`
      : `<span class="jm-keycap jm-keycap--sym">↑</span><span class="jm-keycap jm-keycap--sym">↓</span>`;
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
    <div class="jm-sheet__actions"><button class="jm-tube jm-aboutClose">חזרה למשחק</button><button class="jm-tube jm-tube--cream jm-tube--small jm-install2" hidden>התקנה</button></div>
  </div></div>`);
  aboutSheet.querySelector(".jm-aboutClose").addEventListener("click", () => cb("about", false));
  aboutSheet.querySelector(".jm-aboutSound").addEventListener("click", () => cb("toggleSound"));
  const aboutReduceMotionToggle = aboutSheet.querySelector(".jm-aboutReduceMotion");
  aboutReduceMotionToggle.addEventListener("click", () => cb("toggleReduceMotion"));
  aboutSheet.querySelector(".jm-install2").addEventListener("click", () => cb("install"));

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
      soloSheet: soloSheetScrim, soloGoBtn, soloBackBtn, soloSideTubes, soloLevelTubes,
      rotateTitle: rotate.querySelector(".jm-rotateTitle"),
      startBtn: null,
      rematchBtn: result.querySelector(".jm-rematch"),
      changeHeadsBtn: result.querySelector(".jm-changeHeads"),
      replayAgainBtn: result.querySelector(".jm-replayAgain"),
      soloBtn, aboutBtn, soundBtn, installBtn,
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
    setPauseState,
    showGuides,
    fadeGuide,
    hideGuides,
  };
}
