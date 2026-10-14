// DOM screens: title, beat select, how-to, settings, About, pause sheet, run-over, results, and the
// portrait turn-screen. Markup matches design/squawk-7700/screens.html (THE-734 skin.css contract)
// exactly, with every string from `theme` (window.THEME) so a theme swap only changes text/colours.
// Render + wiring only: no sim logic, no three.js. `callbacks` is a plain object of the actions below.
import { seg, ghost, GLYPH } from "./hud-widgets.js";
import { dailyWeather } from "./daily.js";

const BEAT_ORDER = ["door", "aisle", "dive", "landing"];

// theme.images.larkLogo (spec §8 image slot): a path, rendered as an <img>, never an SVG string built
// from theme data (same convention as games/petal-patch/render.js's themeImagePath). null keeps this
// drawn default, a flat copy of scene/airliner.js's larkMark() tail decal so the swapped-out badge and
// the 3D livery agree when no re-skin overrides it.
const DEFAULT_LARK_SVG = `<svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">` +
  `<circle cx="58" cy="50" r="30" fill="#F2994A"/>` +
  `<polygon points="10,56 50,34 92,16 70,38 88,42 58,48 40,64 34,54" fill="#F7E7C4"/></svg>`;

function themeImagePath(theme, slot) {
  const v = theme.images && theme.images[slot];
  return typeof v === "string" && v ? v : null;
}

export function createMenu(root, theme, save, callbacks) {
  root.innerHTML = `
    <section class="sq-screen sq-title" id="sq-scr-title" hidden>
      <div class="sq-title__lock"><div class="sq-xpdr" data-ring="amber"><div class="sq-xpdr__glass"><span class="sq-label">XPDR</span>${seg("7700")}</div></div>
        <div class="sq-title__name" style="display:flex; align-items:center; gap:8px; justify-content:flex-end;">
          <span id="sq-title-lark" class="sq-title__lark" style="width:22px; height:22px; flex:none;" aria-hidden="true"></span>${esc(theme.title.toUpperCase())}
        </div><div class="sq-title__tag">${esc(theme.tagline)}</div></div>
      <div class="sq-title__tools">
        <button class="sq-key" data-act="howTo" aria-label="${esc(theme.text.howTo)}">${GLYPH.howto}</button>
        <button class="sq-key" data-act="settings" aria-label="${esc(theme.text.settings)}">${GLYPH.settings}</button>
        <button class="sq-key" data-act="about" aria-label="${esc(theme.text.about)}">${GLYPH.about}</button>
        <button class="sq-key" data-act="toggleSound" id="sq-title-sound" aria-label="${esc(theme.text.settingsSound)}">${GLYPH.sound}</button>
      </div>
      <div class="sq-title__go"><button class="sq-btn sq-btn--lg" data-act="play">${esc(theme.text.play)}<small>${esc(theme.FLIGHT_LABEL_LATIN)} · 4 BEATS</small></button></div>
      <div class="sq-title__day">
        <div class="sq-wx" id="sq-daily-line"></div>
        <div class="sq-best" id="sq-best-line"></div>
        <div class="sq-beatsel" id="sq-beatsel"></div>
      </div>
    </section>

    <div class="sq-card" id="sq-scr-card" hidden>
      <div class="sq-card__plate">
        <div class="sq-card__fl" id="sq-card-fl"></div>
        <div class="sq-card__beat" id="sq-card-beat"></div>
        <div class="sq-card__who" id="sq-card-who"></div>
        <div class="sq-card__try" id="sq-card-try" hidden></div>
      </div>
    </div>

    <section class="sq-screen sq-howto" id="sq-scr-howto" hidden style="display:grid; place-items:center; background:rgba(13,16,21,.78);">
      <div style="display:grid; gap:14px; max-width:720px; padding:18px;">
        <div class="sq-howto" id="sq-howto-body"></div>
        <button class="sq-btn" data-act="close" style="justify-self:center;">${esc(theme.text.close)}</button>
      </div>
    </section>

    <div class="sq-scrim" id="sq-scr-settings" hidden></div>
    <div class="sq-sheet is-in" id="sq-settings-sheet" hidden>
      <div class="sq-sheet__glass">
        <h2 class="sq-sheet__title">${esc(theme.text.settings)}</h2>
        <div class="sq-toggle">${esc(theme.text.settingsSound)}<span class="sq-switch" role="switch" data-setting="sound"></span></div>
        <div class="sq-toggle">${esc(theme.text.settingsMotion)}<span class="sq-switch" role="switch" data-setting="motion"></span></div>
        <div class="sq-toggle">${esc(theme.text.settingsHaptics)}<span class="sq-switch" role="switch" data-setting="haptics"></span></div>
        <div class="sq-sheet__row"><button class="sq-btn" data-act="close">${esc(theme.text.close)}</button></div>
      </div>
    </div>

    <div class="sq-scrim" id="sq-scr-about" hidden></div>
    <div class="sq-sheet is-in sq-about" id="sq-about-sheet" hidden>
      <div class="sq-sheet__glass">
        <h2 class="sq-sheet__title" dir="ltr">${esc(theme.title)}</h2>
        <p>${esc(theme.text.aboutCredit)}</p>
        <p class="sq-en">${esc(theme.text.aboutInspired)}</p>
        <p>${esc(theme.text.aboutFonts)}</p>
        <p class="sq-en">${esc(theme.text.aboutThree)}</p>
        <div class="sq-sheet__row"><button class="sq-btn" data-act="close">${esc(theme.text.close)}</button></div>
      </div>
    </div>

    <div class="sq-scrim" id="sq-scr-pause" hidden></div>
    <div class="sq-sheet is-in" id="sq-pause-sheet" hidden>
      <div class="sq-sheet__glass">
        <h2 class="sq-sheet__title">הטיסה מושהית</h2>
        <div class="sq-toggle">${esc(theme.text.settingsSound)}<span class="sq-switch" role="switch" data-setting="sound"></span></div>
        <div class="sq-toggle">${esc(theme.text.settingsMotion)}<span class="sq-switch" role="switch" data-setting="motion"></span></div>
        <div class="sq-toggle">${esc(theme.text.settingsHaptics)}<span class="sq-switch" role="switch" data-setting="haptics"></span></div>
        <div class="sq-sheet__row">
          <button class="sq-btn" data-act="resume">${esc(theme.text.resume)}<small>RESUME</small></button>
          <button class="sq-btn sq-btn--alarm sq-btn--sm" data-act="restartBeat">${esc(theme.text.restartBeat)}<small>COSTS 1 TRY</small></button>
          <button class="sq-btn sq-btn--cyan sq-btn--sm" data-act="quit">${esc(theme.text.quitToMenu)}<small>MENU</small></button>
        </div>
      </div>
    </div>

    <section class="sq-screen sq-over" id="sq-scr-runover" hidden>
      <div class="sq-over__line">${esc(theme.text.runOverTitle)}</div>
      <div class="sq-over__where" id="sq-runover-reached"></div>
      <div class="sq-actions">
        <button class="sq-btn" data-act="again">${esc(theme.text.again)}<small>AGAIN</small></button>
        <button class="sq-btn sq-btn--cyan" data-act="share">${esc(theme.text.share)}<small>SHARE</small></button>
      </div>
    </section>

    <section class="sq-screen sq-results" id="sq-scr-results" hidden>
      <div class="sq-rack sq-panel" id="sq-results-strips">
        <div class="sq-rack__head"><span class="sq-label">${esc(theme.FLIGHT_LABEL_LATIN)} · STRIPS</span><span class="sq-label" id="sq-results-no"></span></div>
      </div>
      <div class="sq-home">
        <div class="sq-home__line" id="sq-results-title"></div>
        <div class="sq-home__souls"><b id="sq-results-souls"></b><span id="sq-results-souls-sub"></span></div>
        <div class="sq-stats" id="sq-results-stats"></div>
        <div class="sq-actions">
          <button class="sq-btn" data-act="share">${esc(theme.text.share)}<small id="sq-results-share-no">SHARE</small></button>
          <button class="sq-btn sq-btn--cyan" data-act="again">${esc(theme.text.again)}<small>AGAIN</small></button>
        </div>
      </div>
    </section>

    <section class="sq-screen sq-turn" id="sq-scr-portrait" hidden>
      <svg viewBox="0 0 150 150"><g class="sq-turn__phone" style="transform:rotate(-40deg)">
        <rect x="47" y="15" width="56" height="120" rx="10" fill="#0D1015" stroke="#EEF2F6" stroke-width="4"/>
        <rect x="54" y="28" width="42" height="92" rx="3" fill="#2A1F5C"/><path d="M58 92 Q75 70 92 78" stroke="#F2A272" stroke-width="3" fill="none"/></g>
        <path d="M118 46 a52 52 0 0 1 -6 62" fill="none" stroke="#FFB224" stroke-width="4" stroke-linecap="round"/>
        <path d="M104 104 l9 6 l3 -11" fill="none" stroke="#FFB224" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <div class="sq-turn__line">${esc(theme.text.portraitRotate.replace(" 🔄", ""))}</div>
      <div class="sq-turn__sub">הטיסה ממתינה. היא ממשיכה כשהמסך לרוחב.</div>
      <div class="sq-xpdr" data-ring="amber"><div class="sq-xpdr__glass"><span class="sq-label">XPDR</span>${seg("7700")}</div></div>
    </section>
  `;

  const larkSrc = themeImagePath(theme, "larkLogo");
  root.querySelector("#sq-title-lark").innerHTML = larkSrc
    ? `<img src="${esc(larkSrc)}" alt="" style="width:100%; height:100%; object-fit:contain;">`
    : DEFAULT_LARK_SVG;

  function screens() { return root.querySelectorAll(".sq-screen, .sq-scrim, .sq-sheet, .sq-card"); }
  function show(...ids) {
    for (const el of screens()) el.hidden = !ids.includes(el.id);
    root.classList.add("is-active");
  }
  function hideAll() {
    for (const el of screens()) el.hidden = true;
    root.classList.remove("is-active");
  }

  root.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (btn) { const act = btn.dataset.act; if (callbacks[act]) callbacks[act](btn.dataset); return; }
    const strip = e.target.closest("[data-beat]");
    if (strip && !strip.disabled) callbacks.practice && callbacks.practice(strip.dataset.beat);
    const toggle = e.target.closest("[data-setting]");
    if (toggle) {
      const next = toggle.getAttribute("aria-checked") !== "true";
      toggle.setAttribute("aria-checked", String(next));
      callbacks.setSetting && callbacks.setSetting(toggle.dataset.setting, next);
    }
  });

  function beatLabel(name) { return theme.beatNames[name]; }
  function medalWord(m) { return m ? theme.medals[m] : null; }
  const HERO_BY_BEAT = { door: theme.text.heroCaptain, aisle: theme.text.heroPassenger, dive: theme.text.heroPassenger, landing: theme.text.heroPilot };

  function showTitle(daily) {
    const wx = dailyWeather(daily.seed);
    const wxLine = esc(theme.text.dailyWeather.replace("{wx}", wx.wx).replace("{turb}", wx.turb));
    root.querySelector("#sq-daily-line").innerHTML = `<b>${esc(theme.text.dailyLabel.replace("{n}", daily.n))}</b> · <span dir="ltr">${wxLine}</span>`;
    const soundBtn = root.querySelector("#sq-title-sound");
    if (soundBtn) soundBtn.classList.toggle("is-off", !save.get().settings.sound);
    const best = save.get().best;
    const bestLine = root.querySelector("#sq-best-line");
    if (best) {
      const s = Math.round(best.clockSteps / 60);
      bestLine.innerHTML = `השיא: <span class="sq-ltr">${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}</span> · <span class="sq-ltr">${best.bumps}</span> טלטלות`;
    } else bestLine.innerHTML = "";
    renderBeatSel();
    show("sq-scr-title");
  }

  function renderBeatSel() {
    const data = save.get();
    const el = root.querySelector("#sq-beatsel");
    el.innerHTML = BEAT_ORDER.map((name, i) => {
      const b = data.beats[name];
      const unlocked = i === 0 || data.beats[BEAT_ORDER[i - 1]].cleared;
      const medal = b.cleared ? medalWord(b.medal) : null;
      // An unlocked, uncleared beat shows an empty slot, not "locked" (sign-off r1 D2-3, THE-756): the
      // door is open from the start and used to say "נעול" anyway. Only a truly locked beat says it.
      const slotText = medal || (unlocked ? "—" : theme.text.beatLocked);
      return `<button data-beat="${name}" ${unlocked ? "" : "disabled"}>
        <b>${esc(beatLabel(name))}</b>
        <span class="sq-medal sq-medal--${b.cleared ? b.medal : "none"}">${esc(slotText)}</span>
        <i>${esc(name.toUpperCase())}</i>
      </button>`;
    }).join("");
  }

  function showHowTo() {
    root.querySelector("#sq-howto-body").innerHTML = BEAT_ORDER.map((name, i) => `
      <figure>${ghost(["tap", "lr", "down", "down"][i])}<figcaption><b>${esc(beatLabel(name))}</b>${esc(theme.text.howToBody[i])}</figcaption></figure>
    `).join("");
    show("sq-scr-howto");
  }

  function applySettingInputs() {
    const s = save.get().settings;
    for (const sw of root.querySelectorAll("[data-setting]")) sw.setAttribute("aria-checked", String(!!s[sw.dataset.setting]));
  }

  function showSettings() { applySettingInputs(); show("sq-scr-settings", "sq-settings-sheet"); }
  function showAbout() { show("sq-scr-about", "sq-about-sheet"); }
  function showPause() { applySettingInputs(); show("sq-scr-pause", "sq-pause-sheet"); }

  function showRunOver(reachedBeatName) {
    root.querySelector("#sq-runover-reached").textContent =
      `נעצרתם ${theme.beatNamesLocative[reachedBeatName] || ""} · שלב ${BEAT_ORDER.indexOf(reachedBeatName) + 1} מתוך 4`;
    show("sq-scr-runover");
  }

  function formatClock(totalSeconds) {
    const s = Math.max(0, Math.round(totalSeconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  // run: { beatResults: {name: {medal, metric, time, bumps}}, clockSteps, best: {clockSteps} | null }
  function showResults(run, daily) {
    const rack = root.querySelector("#sq-results-strips");
    const strips = BEAT_ORDER.map((name, i) => {
      const r = run.beatResults[name];
      const t = r ? formatClock(r.time) : "--:--";
      const bumps = r ? r.bumps : 0;
      const medal = r ? r.medal : "bronze";
      return `<div class="sq-strip is-drop" style="--i:${i}"><span class="sq-strip__n">${i + 1}</span>
        <span class="sq-strip__name">${esc(beatLabel(name))}<small>${esc(HERO_BY_BEAT[name])}</small></span>
        <span class="sq-strip__t">${esc(t)}</span><span class="sq-strip__b"><b>${bumps}</b>טלטלות</span>
        <span class="sq-medal sq-medal--${medal}">${esc(theme.medals[medal])}</span></div>`;
    }).join("");
    const noLabel = esc(theme.text.dailyLabel.replace("{n}", daily.n));
    rack.innerHTML = `<div class="sq-rack__head"><span class="sq-label">${esc(theme.FLIGHT_LABEL_LATIN)} · STRIPS</span><span class="sq-label" id="sq-results-no">${noLabel}</span></div>${strips}`;

    root.querySelector("#sq-results-title").textContent = theme.text.resultsLine;
    root.querySelector("#sq-results-souls").textContent = `${theme.SOULS}/${theme.SOULS}`;
    root.querySelector("#sq-results-souls-sub").textContent = theme.text.resultsSoulsSub;
    const shareNo = root.querySelector("#sq-results-share-no");
    if (shareNo) shareNo.textContent = `${noLabel} · SHARE`;

    const totalBumps = BEAT_ORDER.reduce((n, name) => n + (run.beatResults[name] ? run.beatResults[name].bumps || 0 : 0), 0);
    const totalMargin = BEAT_ORDER.reduce((n, name) => n + (run.beatResults[name] ? run.beatResults[name].margin || 0 : 0), 0);
    const isBest = run.best && run.best.clockSteps === run.clockSteps;
    const stats = [
      ["זמן", formatClock(run.clockSteps / 60)],
      ["טלטלות", String(totalBumps)],
      ["מרווח", `${totalMargin.toFixed(1)}s`],
    ];
    if (isBest) stats.push(["שיא חדש", formatClock(run.clockSteps / 60)]);
    root.querySelector("#sq-results-stats").innerHTML = stats.map(([label, val], i) =>
      `<div class="sq-stat${i === 3 ? " is-best" : ""}"><i>${esc(label)}</i><b>${esc(val)}</b></div>`).join("");
    show("sq-scr-results");
  }

  // fl: a flight-level/time string e.g. "FL280 · 07:52". beatName: "door"|"aisle"|"dive"|"landing".
  function showCard(fl, beatName, attemptNumber) {
    root.querySelector("#sq-card-fl").innerHTML = fl.replace(" · ", ` <span>·</span> `);
    root.querySelector("#sq-card-beat").textContent = `${BEAT_ORDER.indexOf(beatName) + 1} · ${beatLabel(beatName)}`;
    root.querySelector("#sq-card-who").textContent = HERO_BY_BEAT[beatName] || "";
    // Always shown, even on the first card (sign-off r1 D2-8, THE-756): a fresh run couldn't tell how
    // you lose (25% onboarding confidence) with this hidden until a retry.
    const tryEl = root.querySelector("#sq-card-try");
    tryEl.hidden = false;
    tryEl.textContent = `ניסיון ${attemptNumber}/3`;
    show("sq-scr-card");
  }

  function showPortraitTurn() { show("sq-scr-portrait"); }

  function checkOrientation() {
    const portrait = matchMedia("(orientation: portrait)").matches && matchMedia("(pointer: coarse)").matches;
    const portraitScreen = root.querySelector("#sq-scr-portrait");
    portraitScreen.hidden = !portrait;
    if (portrait) root.classList.add("is-active");
    return portrait;
  }

  return {
    hideAll, show, showTitle, showBeatSelect: () => { renderBeatSel(); show("sq-scr-title"); }, showHowTo, showSettings, showAbout, showPause,
    showRunOver, showResults, showCard, showPortraitTurn, checkOrientation, applySettingInputs,
  };
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
