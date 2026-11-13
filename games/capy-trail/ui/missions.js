// THE-1408: the shared missions card + Results timeline. DOM/timings/sounds: score-missions/README.md.
import { missionById, targetFor } from "../sim/missions.js";
import * as audio from "../render/audio.js";

const POP_GAP_MS = 150, SET_DONE_AT_MS = 1100, NEW_SET_AT_MS = 2300, NEW_SET_CLEAR_MS = 400;

function fmt(n) { return Math.round(n).toLocaleString("en-US"); }

function rowHtml(theme, id, prog, done, mult, isNewDone) {
  const m = missionById(id);
  const target = targetFor(m, mult);
  const shown = Math.min(prog, target);
  const p = target > 0 ? shown / target : 0;
  const text = ((theme.missions && theme.missions[id]) || "").replace("{chaser}", theme.chaser || "");
  const cls = ["ct-mission", done ? "is-done" : "", isNewDone ? "is-new-done" : ""].filter(Boolean).join(" ");
  return `<li class="${cls}"><span class="ct-mission__check" aria-hidden="true"></span>`
    + `<span class="ct-mission__text">${text}</span>`
    + `<span class="ct-mission__count">${fmt(shown)}/${fmt(target)}</span>`
    + `<span class="ct-mission__bar"><span class="ct-mission__fill" style="--p:${p}"></span></span></li>`;
}

// Header + 3 rows, for Title/Pause and every frame of the Results timeline below.
export function renderCard(els, theme, mult, missions, { newDone = [false, false, false] } = {}) {
  els.title.textContent = theme.text.missions;
  els.reward.innerHTML = `${theme.text.missionsReward} <span class="ct-mult">&times;${mult + 1}</span>`;
  els.list.innerHTML = missions.set.map((id, i) => rowHtml(theme, id, missions.prog[i], missions.done[i], mult, newDone[i])).join("");
  els.card.classList.remove("is-set-done", "is-new-set");
}

// Results only. finishMult/finishMissions: sim/missions.js's finishRun() result, already saved by the
// caller ("save first, animate after"). Returns { skip }, null when there's nothing to animate/skip.
export function playResultsTimeline(els, theme, { runStartMult, runStartMissions, runEndMissions, finishMult, finishMissions }, { reduceMotion = false, onDone } = {}) {
  const setDone = finishMult !== runStartMult;
  const newDone = runEndMissions.done.map((d, i) => d && !runStartMissions.done[i]);
  const anyNewDone = newDone.some(Boolean);

  if (!setDone && !anyNewDone) {
    renderCard(els, theme, runStartMult, runEndMissions);
    return { skip: null };
  }

  const timers = [];
  let done = false;

  function clearTimers() { for (const id of timers) clearTimeout(id); timers.length = 0; }
  function finish() { if (done) return; done = true; clearTimers(); onDone?.(); }

  function showEndState() {
    clearTimers();
    if (setDone) renderCard(els, theme, finishMult, finishMissions);
    else renderCard(els, theme, runStartMult, runEndMissions, { newDone });
    finish();
  }

  if (reduceMotion) {
    showEndState();
    audio.play(setDone ? "missionSet" : "missionTick");
    return { skip: null };
  }

  renderCard(els, theme, runStartMult, runStartMissions); // t=0: run-start progress
  timers.push(setTimeout(() => renderCard(els, theme, runStartMult, runEndMissions, { newDone }), 30)); // bars fill
  newDone.forEach((isNew, i) => {
    if (!isNew) return;
    timers.push(setTimeout(() => { els.list.children[i]?.classList.add("is-new-done"); audio.play("missionTick"); }, 600 + i * POP_GAP_MS));
  });
  if (setDone) {
    timers.push(setTimeout(() => {
      els.title.textContent = theme.text.missionsDone;
      els.reward.innerHTML = `${theme.text.missionsScoreNow} <span class="ct-mult">&times;${finishMult}</span>`;
      els.card.classList.add("is-set-done");
      const r = els.card.getBoundingClientRect();
      window.UIKit?.celebrate?.({ x: r.left + r.width / 2, y: r.top, colors: ["--color-primary", "--color-accent", "--color-text"] });
      audio.play("missionSet");
    }, SET_DONE_AT_MS));
    timers.push(setTimeout(() => {
      renderCard(els, theme, finishMult, finishMissions);
      els.card.classList.add("is-new-set");
      timers.push(setTimeout(() => { els.card.classList.remove("is-new-set"); finish(); }, NEW_SET_CLEAR_MS));
    }, NEW_SET_AT_MS));
  } else {
    timers.push(setTimeout(finish, 600 + newDone.length * POP_GAP_MS));
  }
  return { skip: showEndState };
}
