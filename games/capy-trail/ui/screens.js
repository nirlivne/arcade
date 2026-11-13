// Title, results, pause and rotate screens (spec §6). Restart follows THE-774's "armed at press-down"
// rule: only a press that starts after the card is shown counts, so a key or finger held through the
// crash transition can't auto-restart the next run.
import { buildShareCard, shareCard } from "./share-card.js";
import { renderCard as renderMissionsCard, playResultsTimeline } from "./missions.js";
import * as audio from "../render/audio.js";

export function createScreens({ els, theme, isTouch = false }, { onStart, onRestart, onHome, onResume, onOpenLevels, onRetryLevel, onLevelMap } = {}) {
  let phase = "title";
  let armedAt = 0;
  // THE-1408: while the Results missions timeline runs, the first press only skips it (README). THE-1412:
  // a level's own star stamp is a 2nd, independent skippable animation that can run on the same screen
  // (missions keep counting in a level) -- resultsSkip becomes a composite of whichever are pending.
  const missionsEls = { card: els.missions, title: els.missionsTitle, reward: els.missionsReward, list: els.missionsList };
  let resultsSkip = null;

  function arm() { armedAt = performance.now(); }

  // CTO fix (THE-1259, 2026-11-05 22:43Z): JUMP/DUCK were shown for the whole session on any touch device
  // (game.js set `hidden = !isTouch` once at boot), so they sat over the title and results screens too.
  // They're gameplay controls -- show them only while actually running.
  function setTouchControlsVisible(visible) {
    const show = isTouch && visible;
    els.jumpBtn.hidden = !show;
    els.duckBtn.hidden = !show;
  }

  function show(id) {
    phase = id;
    window.UIKit.showScreen(id);
    setTouchControlsVisible(false);
    arm();
  }

  // THE-1408: showScreen focuses Again, so Enter/Space would also fire its native click -- same gate here.
  function consumeResultsSkip() { if (!resultsSkip) return false; const skip = resultsSkip; resultsSkip = null; skip(); return true; }
  els.playBtn.addEventListener("click", () => onStart?.());
  els.againBtn.addEventListener("click", () => { if (!consumeResultsSkip()) onRestart?.(); });
  els.homeBtn.addEventListener("click", () => { if (!consumeResultsSkip()) onHome?.(); });
  els.resumeBtn.addEventListener("click", () => onResume?.());
  els.pauseHomeBtn.addEventListener("click", () => onHome?.());
  // THE-1412: Levels opens the map from Title; the map's own Back goes to Title (same destination as
  // every other Home); in level results, Retry replays this level and Map opens the map (next level
  // selected) in place of Home.
  els.levelsBtn.addEventListener("click", () => onOpenLevels?.());
  els.mapBackBtn.addEventListener("click", () => onHome?.());
  els.retryBtn.addEventListener("click", () => { if (!consumeResultsSkip()) onRetryLevel?.(); });
  els.mapBtn.addEventListener("click", () => { if (!consumeResultsSkip()) onLevelMap?.(); });

  // P5 (THE-1328): the About sheet, from the title and the pause menu. While it's open the title's "any
  // key / any tap starts" stays out of the way, and closing it re-arms (the closing tap or Escape never
  // also starts a run).
  function openAbout() { if (!els.aboutDialog.open) els.aboutDialog.showModal(); }
  els.aboutBtn.addEventListener("click", openAbout);
  els.pauseAboutBtn.addEventListener("click", openAbout);
  els.aboutClose.addEventListener("click", () => els.aboutDialog.close());
  els.aboutDialog.addEventListener("click", (e) => { if (e.target === els.aboutDialog) els.aboutDialog.close(); }); // tap on the backdrop
  els.aboutDialog.addEventListener("close", () => arm());
  const aboutOwns = (e) => els.aboutDialog.open || (e.target instanceof Node && (els.aboutBtn.contains(e.target) || els.aboutDialog.contains(e.target))); // a key event can target window
  // A13.2.C3 (THE-1318 review), board leftover (a): a real-pointer tap on the title's own i/Music/Sound
  // pebbles, or the M/N/P keys, must only do that pebble's own action -- never also start the run. A
  // keydown's target is whichever element has focus (usually Play itself, not the key's real origin), so
  // the M/N/P/Escape keys are excluded by key, not by hit-testing; a tap is excluded by its real target.
  // THE-1412: #levelsBtn is a 2nd actionable title button -- excluded the same way #playBtn already is
  // (tap: by hit-testing; Enter/Space: by being the focused target), so opening the map never also starts
  // Endless underneath it.
  const titleUtilTapOwns = (e) => e.target instanceof Node && (els.titleUtil.contains(e.target) || els.playBtn.contains(e.target) || els.levelsBtn.contains(e.target));
  // CTO review (THE-1374): the secret map key (THE-1375) is a utility key too -- it toggles the map, never starts a run
  // THE-1412: only Enter/Space while #levelsBtn is focused are excluded (its own native activation would
  // otherwise double-fire alongside onStart) -- any OTHER key reaching a focused #levelsBtn (e.g. a plain
  // ArrowUp, if the browser auto-focused the first title button) must still start Endless as normal.
  const titleUtilKeyOwns = (e) => ["m", "M", "n", "N", "p", "P", "Escape", "0"].includes(e.key) || e.code === "Numpad0"
    || (e.target === els.levelsBtn && (e.key === "Enter" || e.key === " "));

  window.addEventListener("keydown", (e) => {
    if (e.repeat || e.timeStamp < armedAt || aboutOwns(e)) return;
    if (phase === "title") { if (!titleUtilKeyOwns(e)) onStart?.(); }
    else if (phase === "results") {
      if (consumeResultsSkip()) return;
      if (e.key === "Enter" || e.key === " ") onRestart?.();
      else if (e.key === "Escape") onHome?.();
    } else if (phase === "levels" && e.key === "Escape") onHome?.(); // README: "Back (#mapBackBtn, Escape) -> Title"
  });
  window.addEventListener("pointerdown", (e) => {
    if (e.timeStamp < armedAt || aboutOwns(e)) return;
    if (phase === "title") { if (!titleUtilTapOwns(e)) onStart?.(); return; } // any other tap starts (game.js ignores a repeat call)
    if (phase === "results") {
      if (els.resultsPanel.contains(e.target)) return; // Again/Home/Share/Toppers gate it themselves
      if (consumeResultsSkip()) return;
      onRestart?.();
    }
  });

  let lastDistance = 0, lastCoins = 0;
  // THE-1407 slice 6: the big number is the score now (was distance); `best` here is the best SCORE
  // (score-missions/README.md). Distance/coins/best share one line under it; share card keeps distance.
  function fillResults({ s, coins, score, scoreMult, best, crashCause, crashDetail, isNewBest }) {
    // A12.4 (THE-1301): "caught" gets its own line ("The geese got you.") rather than falling into the
    // generic obstacle line every other non-corner cause (closure included) still shares.
    const cause = theme.causeLines[crashCause] || theme.causeLines[crashCause === "corner" ? "corner" : "obstacle"] || theme.causeLines.forest;
    els.resultCause.textContent = cause;
    els.resultScore.textContent = score.toLocaleString("en-US");
    els.resultMult.hidden = scoreMult === 1;
    if (!els.resultMult.hidden) els.resultMult.textContent = `×${scoreMult}`;
    els.resultDistance.textContent = `${Math.round(s)} m`;
    els.resultCoins.textContent = String(coins);
    els.resultBest.textContent = isNewBest ? "new best!" : `best ${Math.round(best).toLocaleString("en-US")}`;
    els.resultBest.classList.toggle("ct-new-best", !!isNewBest);
    const lines = theme.deadpanLines || [];
    els.resultDeadpan.textContent = lines.length ? lines[Math.floor(Math.random() * lines.length)] : "";
    lastDistance = s; lastCoins = coins;
  }

  // THE-1412 (levels/README.md "Level results"): the line "coins this run · time · hit count" and the
  // cause line (level name, or "Caught at X of Y m" on a failure); Home becomes Map, Retry replaces the
  // bare Again action with "play this level again" specifically. Deadpan stays empty in a level.
  function fillLevelResults({ level, failed, coinsThisRun, timeS, hits, caughtAtS, levelLengthM, isLastLive }) {
    els.resultsPanel.classList.add("is-level");
    els.resultsPanel.classList.toggle("is-failed", !!failed);
    els.resultCause.textContent = failed
      ? `Caught at ${Math.round(caughtAtS).toLocaleString("en-US")} of ${Math.round(levelLengthM).toLocaleString("en-US")} m`
      : `${level.n} · ${level.name}`;
    els.resultLine.hidden = true;
    els.levelResultLine.hidden = false;
    els.levelResultCoins.textContent = String(coinsThisRun);
    const mm = Math.floor(timeS / 60), ss = Math.round(timeS % 60);
    els.levelResultTime.textContent = `${mm}:${String(ss).padStart(2, "0")}`;
    els.levelResultHits.textContent = hits === 0 ? "no hits" : hits === 1 ? "1 hit" : `${hits} hits`;
    els.resultDeadpan.textContent = "";
    els.homeBtn.hidden = true;
    els.mapBtn.hidden = false;
    els.retryBtn.hidden = !!failed; // README: "not when failed"
    els.levelStars.hidden = false;
    els.againBtn.textContent = failed ? theme.text.tryAgain : isLastLive ? theme.text.trailMap : theme.text.nextLevel;
  }
  // Undoes fillLevelResults's DOM state for the next (Endless) results screen -- fillResults/showResults
  // otherwise never touch these, so a stale level-mode look would leak into the very next Endless run.
  function clearLevelResults() {
    els.resultsPanel.classList.remove("is-level", "is-failed");
    els.resultLine.hidden = false;
    els.levelResultLine.hidden = true;
    els.homeBtn.hidden = false;
    els.mapBtn.hidden = true;
    els.retryBtn.hidden = true;
    els.levelStars.hidden = true;
    els.againBtn.textContent = theme.text.again;
  }
  const LEVEL_STAR_IDS = [els.levelStar0, els.levelStar1, els.levelStar2];
  // Stars finish instantly in their saved/earned state (CSS's own stagger reads off each span's --i, no
  // JS timing needed for the visual); only the levelStar0/1/2 dings need real timers, 280 ms apart after a
  // 300 ms beat -- same contract as the missions celebration, including onDone firing exactly once
  // whether the dings finish naturally or skip() cuts them short.
  function showLevelStars(finalMask, isNew, onDone) {
    const total = (finalMask & 1) + ((finalMask >> 1) & 1) + ((finalMask >> 2) & 1);
    els.levelStars.setAttribute("aria-label", `${total} of 3 stars`);
    LEVEL_STAR_IDS.forEach((el, i) => {
      const on = !!(finalMask & (1 << i));
      el.classList.toggle("is-on", on);
      el.classList.toggle("is-new", on && !!isNew[i]);
    });
    const anyNew = isNew.some(Boolean);
    if (!anyNew) { onDone?.(); return { skip: null }; }
    if (window.UIKit.reduceMotion()) { isNew.forEach((n, i) => { if (n) audio.play(`levelStar${i}`); }); onDone?.(); return { skip: null }; }
    const timers = [];
    let done = false;
    function finish() { if (done) return; done = true; for (const id of timers) clearTimeout(id); onDone?.(); }
    isNew.forEach((n, i) => { if (n) timers.push(setTimeout(() => audio.play(`levelStar${i}`), 300 + i * 280)); });
    timers.push(setTimeout(finish, 300 + isNew.filter(Boolean).length * 280 + 50));
    return { skip: finish };
  }

  // S7 (THE-1303): the share card (ui/share-card.js) -- a 2D canvas image (no photo compositing needed,
  // unlike game #13's: Capy Trail has no player portraits), shared via navigator.share with files
  // when possible. A13.4.C1's fallback chain still applies: download + clipboard text, else a toast with
  // the text itself, so the tap never does nothing.
  els.shareBtn.addEventListener("click", async () => {
    const text = theme.shareText.replace("{distance}", Math.round(lastDistance));
    const canvas = await buildShareCard({ theme, distance: lastDistance, coins: lastCoins });
    await shareCard(canvas, { text, toast });
  });

  // A13.2 (THE-1318 review): "best {N}" once a save exists, else a plain how-to-start line. THE-1407:
  // `best` is the best SCORE now (data.bestScore), not the best distance. THE-1412: the star total next
  // to Levels, hidden at 0 (README: "first run reads just 'Levels'").
  function showTitle(best = 0, missionsView, totalStars = 0) {
    els.titleHint.textContent = best > 0
      ? theme.text.titleHint.replace("{best}", best.toLocaleString("en-US"))
      : theme.text.titleHintNoBest;
    els.titleStars.hidden = totalStars <= 0;
    els.titleStarsCount.textContent = String(totalStars);
    if (missionsView) renderMissionsCard(missionsEls, theme, missionsView.mult, missionsView.missions);
    show("title");
  }
  function showLevels() { show("levels"); }
  // levelResult is null for an Endless run (unchanged behavior); set for a level run (THE-1412), with
  // isNew as the 3-bool array of which bits finalMask just earned for the first time. Both animations
  // (missions timeline, level star stamp) can be pending together (missions keep counting in a level) --
  // resultsSkip must clear itself once every pending one is actually done, natural or skipped, or a
  // real key/tap after both finish would get silently eaten as a stale skip instead of restarting/advancing.
  function showResults(data, missionsTimeline, levelResult) {
    if (levelResult) fillLevelResults(levelResult); else { clearLevelResults(); fillResults(data); }
    show("results"); // focuses Again
    resultsSkip = null;
    const skips = [];
    let pending = 0;
    function markDone() { pending--; if (pending <= 0) resultsSkip = null; }
    if (missionsTimeline) {
      const { skip } = playResultsTimeline(missionsEls, theme, missionsTimeline, { reduceMotion: window.UIKit.reduceMotion(), onDone: markDone });
      if (skip) { pending++; skips.push(skip); }
    }
    if (levelResult) {
      const { skip } = showLevelStars(levelResult.finalMask, levelResult.isNew, markDone);
      if (skip) { pending++; skips.push(skip); }
    }
    if (skips.length) {
      resultsSkip = () => { for (const skip of skips) skip(); };
      document.activeElement?.blur?.(); // no native Enter/Space button-activation mid-skip
    }
  }
  function showPause(missionsView) {
    if (missionsView) renderMissionsCard(missionsEls, theme, missionsView.mult, missionsView.missions);
    show("pause");
  }
  function showRotate() { show("rotate"); }
  // S7 (THE-1303): a lost WebGL context can't be resumed into mid-run (sim state keeps running but
  // nothing renders), so "Tap to reload" is a full reload -- the simplest recovery that's always correct.
  function showContextLost() { show("contextLost"); }
  els.contextLostScreen.addEventListener("click", () => location.reload());
  function showRunning() { phase = "running"; window.UIKit.showScreen("__none__"); setTouchControlsVisible(true); arm(); }
  function toast(text) { window.UIKit.toast(text); }

  return { showTitle, showLevels, showResults, showPause, showRotate, showContextLost, showRunning, toast, get phase() { return phase; } };
}
