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

  for (const btn of pick.querySelectorAll(".jm-prev")) btn.addEventListener("click", () => cb("cycle", Number(btn.dataset.side), -1));
  for (const btn of pick.querySelectorAll(".jm-next")) btn.addEventListener("click", () => cb("cycle", Number(btn.dataset.side), 1));
  for (const btn of pick.querySelectorAll(".jm-dice")) btn.addEventListener("click", () => cb("randomize", Number(btn.dataset.side)));
  for (const btn of readyBtns) btn.addEventListener("click", () => cb("toggleReady", Number(btn.dataset.side)));
  soloBtn.addEventListener("click", () => cb("solo"));
  aboutBtn.addEventListener("click", () => cb("about"));
  soundBtn.addEventListener("click", () => cb("toggleSound"));
  installBtn.addEventListener("click", () => cb("install"));

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

  function renderPick(ids, ready, muted) {
    for (const side of sides) {
      const head = headById(ids[side]);
      if (!head) continue;
      paintPortrait(side, head);
      headNames[side].textContent = head.name;
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

  // ---- match HUD ------------------------------------------------------
  const hud = h(`<div class="jm-screen jm-hud">
    <div class="jm-sign jm-name jm-name--l"></div>
    <div class="jm-sign jm-name jm-name--r"></div>
    <div class="jm-sign jm-score jm-score--l"><span class="jm-num"></span></div>
    <div class="jm-sign jm-score jm-score--r"><span class="jm-num"></span></div>
    <button class="jm-iconbtn jm-pause" aria-label="השהיה"><span class="jm-icon-pause"></span></button>
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

  // THE-1119 M4: first-match guides (design/junkies-matkot/screens.html's two markup variants --
  // touch gets a dotted drag arrow + ghost thumb, keyboard gets two keycaps). Shown once per side on
  // the very first match, faded on that side's first touch or key (fadeGuide). Solo: left side only.
  function showGuides(isTouch, solo = false) {
    guides[0].innerHTML = isTouch
      ? `<div class="jm-guide__arrow"></div><div class="jm-guide__thumb"></div>`
      : `<span class="jm-keycap">W</span><span class="jm-keycap">S</span>`;
    guides[1].innerHTML = isTouch
      ? `<div class="jm-guide__arrow"></div><div class="jm-guide__thumb"></div>`
      : `<span class="jm-keycap jm-keycap--sym">↑</span><span class="jm-keycap jm-keycap--sym">↓</span>`;
    for (const g of guides) { g.hidden = false; g.classList.remove("is-gone"); }
    if (solo) guides[1].hidden = true;
  }
  function fadeGuide(side) { guides[side]?.classList.add("is-gone"); }
  function hideGuides() { for (const g of guides) { g.hidden = true; g.classList.remove("is-gone"); g.innerHTML = ""; } }
  hud.querySelector(".jm-pause").addEventListener("click", () => cb("pause"));

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
  root.appendChild(result);
  root.appendChild(replay);
  root.appendChild(rotate);
  root.appendChild(pauseSheet);
  root.appendChild(aboutSheet);

  function setSelectValues(ids) { cb("_setIds", ids); }

  function show(name) {
    pick.hidden = name !== "pick";
    hud.hidden = name !== "match";
    result.hidden = name !== "result";
    replay.hidden = name !== "replay";
    if (name !== "match") clearMoment();
  }

  function updateHud(score, rally, names) {
    scoreLeft.textContent = `${LRI}${score[0]}${PDI}`;
    scoreRight.textContent = `${LRI}${score[1]}${PDI}`;
    if (names) { nameLeft.textContent = names[0]; nameRight.textContent = names[1]; }
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
    setCountdown,
    setInstallVisible,
    setCpuHalf,
    showMoment,
    clearMoment,
    setPauseState,
    showGuides,
    fadeGuide,
    hideGuides,
  };
}
