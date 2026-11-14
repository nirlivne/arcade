import * as paper from './engine/paper.js';
import { C } from './engine/paper.js';
import { DT } from './sim/physics.js';
import { RESPAWN_S, SNIP_FREEZE_S, SNIP_STOP_S, snipPhase } from './sim/run.js';
// THE-1648: level 1 is the rework layout on the rework rules (sim/play.js); the released level + its step
// (data/level1.js, sim/run.js) stay in the repo for the later levels
import { newPlayState as newRunState, step as runStep, DEFAULT_VIEW } from './sim/play.js';
import * as level1 from './data/level1-rework.js';
import { theme } from './theme.js';
import { load, write } from './sim/save.js';
import { createInput } from './input.js';
import { drawBackground, drawCheckpointFlag } from './render/world.js';
import { drawHero } from './render/actors.js';
import { drawStandOnShadows, drawStandOns, drawFloorStandOn, drawBackdrops, drawDecorations, drawGoBehinds, drawLampPatch, drawLampFixture, drawWarnMark, eyeStep } from './render/looks.js';
import { makeCamera, followHero, worldTransform, WORLD_H } from './render/camera.js';
import { drawGlint, drawCutBand, drawWipe } from './render/snipGag.js';
import { BODY_H, BODY_W } from './sim/physics.js';
import { createMixer } from './audio/mixer.js';
import { createMusic } from './audio/music.js';
import { createSfx } from './audio/sfx.js';
import { preloadVoice, createVoice, voiceLoaded } from './audio/voice.js';
import { LINES, triggers, newNarration, narrate, tickNarration } from './ui/narration.js';
import { createStrip } from './ui/strip.js';
import { formatTime, applyResult } from './ui/results.js';
import { endingCues, endingDone, canSkip } from './ui/ending.js';
import { drawTitleScreen } from './render/title.js';
import { drawDemo } from './render/demo.js';
import { DEMO_CARDS, demoCard, demoDone, canSkipDemo } from './ui/demo.js';
import { TAGS, newTags, stepTags, visibleTag } from './ui/tags.js';
import { drawScissors, drawTitleLetters, titleLettersFor } from './render/finale.js';
import { drawZoneLine, drawBracket, drawCone, drawGuard, drawRoomBack, drawRoomFront, drawRoomEye, drawCutTag } from './render/hazards.js';
import { beatAt } from './sim/rules.js';

const RESPAWN_TICKS = Math.round(RESPAWN_S / DT);

const QS = new URLSearchParams(location.search);
const QA_STEP = QS.get('qa') === 'step';
const QA_FLAT = QS.get('qa') === 'flat';

// ---- theme.js slots (spec §8): colours, title, names, images ----
// colour overrides replace the --pi-* tokens; then the canvas palette reads the tokens back, so the DOM
// skin and the paper world share one palette (DESIGN §2, S9 Q2)
const TOKEN_OF = { ink: '--pi-ink', paper: '--pi-cream', red: '--pi-lipstick', mus: '--pi-tangerine', inkL: '--pi-ink-2', paperD: '--pi-cream-2', redD: '--pi-lipstick-2', musD: '--pi-tangerine-2' };
for (const [name, value] of Object.entries(theme.colors || {})) document.documentElement.style.setProperty(`--pi-${name}`, value);
{
  const css = getComputedStyle(document.documentElement);
  for (const [key, token] of Object.entries(TOKEN_OF)) { const v = css.getPropertyValue(token).trim(); if (v) C[key] = v; }
}
document.title = theme.title;
document.querySelector('h1.sr-only').textContent = theme.title;
document.querySelector('link[rel="icon"]').href = theme.images.icon;
document.querySelector('link[rel="apple-touch-icon"]').href = theme.images.icon;
document.getElementById('aboutIcon').src = theme.images.icon;
document.getElementById('aboutTitle').textContent = theme.title;
document.getElementById('aboutCast').textContent = `${theme.names.hero} · ${theme.names.editor} · ${theme.names.watchers}`;

const canvas = document.getElementById('c');
paper.init(canvas);

const LEVEL = {
  ground: level1.GROUND,
  solids: level1.solids,
  backdrops: level1.backdrops,
  goBehinds: level1.goBehinds,
  lamps: level1.lamps,
  guards: level1.guards,
  rooms: level1.rooms,
  checkpoints: level1.checkpoints,
};
const END_PIECE = level1.goBehinds.find((gb) => gb.end);
const TITLE_AROUND_I = titleLettersFor(END_PIECE, level1.GROUND_Y); // the finale title assembles around the I of INK
const TITLE_CX = (Math.min(...TITLE_AROUND_I.map((r) => r.x)) + Math.max(...TITLE_AROUND_I.map((r) => r.x + r.w))) / 2;
let lastLayout = null; // __ink.layout()
// S4: the camera's visible world rect, fed to the sim every tick (world u around the hero's x / the floor line)
function simView() {
  if (!lastLayout) return DEFAULT_VIEW;
  const { scale, floorY, viewW, viewH } = lastLayout;
  return { halfW: viewW / 2 / scale, up: floorY / scale, down: (viewH - floorY) / scale };
}
// spec §6 layout row (fix 10, CEO note 4): with the touch buttons on screen, the ground line sits >= 8 css px
// above their tops, so feet and letter bottoms never run under a thumb. Measured from the DOM (the skin
// owns the buttons' size and safe-area padding), cached until the viewport or the button layout changes.
const FLOOR_MARGIN_PX = 8;
let floorCap = { key: '', y: Infinity };
function floorCapY() {
  const touchEl = document.getElementById('touch');
  if (touchEl.hidden) return Infinity;
  const key = `${innerWidth}x${innerHeight}|${touchEl.className}`;
  if (floorCap.key !== key) {
    const tops = [...touchEl.querySelectorAll('.pi-tbtn')].map((b) => b.getBoundingClientRect()).filter((r) => r.height > 0).map((r) => r.top);
    const canvasTop = canvas.getBoundingClientRect().top;
    // buttons below the world band (tablet portrait) don't constrain it
    const y = tops.length ? Math.min(...tops) - canvasTop - FLOOR_MARGIN_PX : Infinity;
    floorCap = { key, y: y < canvas.clientHeight ? y : Infinity };
  }
  return floorCap.y;
}

const storage = (() => { try { return window.localStorage; } catch { return { getItem: () => null, setItem: () => {} }; } })();
let saveData = load(storage, { osReduceMotion: matchMedia('(prefers-reduced-motion: reduce)').matches });

let screen = 'title'; // title | demo | play | ending | results (design §4)
let demoTick = 0, demoReturn = 'play'; // the demo = How to play: where it goes when it ends (play | title | pause)
let endingTick = 0; // UI ticks since the last-hide tick (the sim has stopped: state.ended)
let lastResult = null; // { clockMs, snips, newBestTime, newBestSnips } for the results strip
let runState = newRunState(LEVEL.checkpoints[0], LEVEL);
let facingLeft = false;
let runPhase = 0;

// ---- in-world tags (THE-1637, re-pinned by THE-1648): RUN / JUMP / FLIP TO MATCH ----
// DOM tags pinned to world x, y through the camera; a hide at FLIP TO MATCH ends the lesson (save.taught)
let tags = newTags(saveData.taught);
const TAG_TOP_MIN_PX = 64; // keep clear of the HUD tags on short screens
let tagPulseTicks = 0; // the rehearsal lamp's snap pulses FLIP TO MATCH
const wtagEls = Object.fromEntries([...document.querySelectorAll('.pi-wtag')].map((el) => [el.dataset.tag, el]));
for (const [id, el] of Object.entries(wtagEls)) {
  el.querySelector('.pi-tag__num').textContent = theme.text.tagKeys[id];
  el.querySelector('.pi-tag__name').textContent = theme.text.tags[id];
}
let shownTag = null;
function tagsStep() {
  const next = stepTags(tags, runState.body.x, runState.hidden === true);
  if (next.taught && !saveData.taught) { saveData.taught = true; write(saveData, storage); }
  tags = next;
}
// a = scale, e/f = the world -> css px offsets of worldTransform
function renderTags(a, e, f) {
  const id = screen === 'play' ? visibleTag(tags, runState.body.x) : null;
  if (id !== shownTag) {
    if (shownTag) wtagEls[shownTag].hidden = true;
    if (id) wtagEls[id].hidden = false; // un-hiding replays the skin's slap-in on twos
    shownTag = id;
    flipBtnCue(id === 'flip');
  }
  if (!id) return;
  const tag = TAGS.find((t) => t.id === id);
  const r = canvas.getBoundingClientRect(); // the world band is not at 0,0 on tablet portrait
  const x = r.left + a * tag.x + e, y = r.top + Math.max(TAG_TOP_MIN_PX, a * tag.y + f);
  wtagEls[id].style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  wtagEls[id].classList.toggle('is-pulse', tagPulseTicks > 0);
}
function flipBtnCue(on) { document.getElementById('flipBtn').classList.toggle('is-cue', on); }
let paused = false;

// ---- sound (THE-1561): the context starts on the first gesture (browsers block it before) ----
let audio = null; // { mixer, music, sfx }
const TENSE_TICKS = Math.round(4 / DT); // the bongos stay doubled 4 s after a spot / close call
let tenseTicks = 0, hushTicks = 0;
function ensureAudio() {
  if (audio) return audio;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  const mixer = createMixer(new AC(), saveData.settings);
  audio = { mixer, music: createMusic(mixer), sfx: createSfx(mixer), voice: createVoice(mixer) };
  return audio;
}

// ---- Hebrew narration (S7 THE-1563, spec §3.5): once-per-run lines, strip held in sim ticks ----
preloadVoice(LINES);
const strip = createStrip(document.getElementById('strip'));
// touch clusters (spec §5): shown only after a touch input (or on a coarse-pointer device from the start);
// html.has-touch is the skin hook that lifts the strip above the right cluster
const touchEl = document.getElementById('touch');
function revealTouch() {
  document.documentElement.classList.add('has-touch');
  touchEl.removeAttribute('hidden');
}
if (matchMedia('(pointer: coarse)').matches) revealTouch();
addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') revealTouch(); }, { capture: true });
const VOICE_RETRY_TICKS = 36; // the context may still be resuming on the PLAY tick: retry 0.3 s
let narration = newNarration();
let voiceRetry = 0;
function resetNarration(spent) {
  narration = newNarration(spent);
  voiceRetry = 0;
  audio?.voice.stop();
  strip.hide();
}
function narrationTick(prev, events) {
  narration = narrate(narration, triggers(prev, runState, events));
  const r = tickNarration(narration);
  narration = r.n;
  if (r.ended) { strip.hide(); voiceRetry = 0; }
  if (r.started) {
    strip.show(theme.lines[r.started], LEVEL.ground !== 'ink'); // level 1's ground is tangerine throughout
    voiceRetry = VOICE_RETRY_TICKS;
  }
  if (voiceRetry > 0) {
    voiceRetry -= 1;
    if (saveData.settings.voice && audio?.voice.play(narration.current)) voiceRetry = 0;
  }
}
const STRIDE_U = 210; // half the run cycle (render runPhase: 420 u per cycle): one foot-fall
let stepDist = 0;
function audioEvent(e) {
  if (!audio) return;
  audio.sfx.onEvent(e);
  if (e.type === 'spotted' || e.type === 'closeCall' || e.type === 'snip') { tenseTicks = TENSE_TICKS; audio.music.setTense(true); }
  // spec: the snip's 0.5 s stop-time is silence + stab
  if (e.type === 'snip') { hushTicks = Math.round(SNIP_STOP_S / DT); audio.mixer.hushMusic(true); }
}
function audioTick() {
  if (!audio) return;
  if (tenseTicks > 0 && --tenseTicks === 0) audio.music.setTense(false);
  if (hushTicks > 0 && --hushTicks === 0) audio.mixer.hushMusic(false);
}
// ---- settings sheet (spec §6/§8 comforts): one checkbox per save setting ----
const settingInputs = [...document.querySelectorAll('[data-setting]')];
for (const el of document.querySelectorAll('[data-setting-label]')) el.textContent = theme.text.settingLabels[el.dataset.settingLabel];
for (const el of document.querySelectorAll('[data-setting-hint]')) el.textContent = theme.text.settingHints[el.dataset.settingHint];
// what each setting changes outside the sim (longGrace rides on the sim state, see doRespawnOrStep)
function applySettings() {
  const s = saveData.settings;
  for (const el of settingInputs) el.checked = !!s[el.dataset.setting];
  document.documentElement.dataset.reduceMotion = String(s.reduceMotion); // skin hook: no slaps/slides
  touchEl.classList.toggle('is-lefty', s.leftHanded);
}
function setSetting(key, on) {
  saveData.settings[key] = on;
  if (key === 'music' || key === 'sfx' || key === 'voice') audio?.mixer.setEnabled(key, on);
  write(saveData, storage);
  applySettings();
}
for (const el of settingInputs) el.addEventListener('change', () => setSetting(el.dataset.setting, el.checked));
applySettings();
const settingsEl = document.getElementById('settingsDialog');
document.getElementById('settingsBtn').addEventListener('click', () => settingsEl.showModal());
document.getElementById('pauseSettingsBtn').addEventListener('click', () => settingsEl.showModal());
document.getElementById('settingsCloseBtn').addEventListener('click', () => settingsEl.close());

const EVENTS = [];
function pushEvents(list) { for (const e of list) { EVENTS.push(e); if (EVENTS.length > 200) EVENTS.shift(); } }

const stats = { frameMs: 0, renderMs: 0, lastFrameAt: 0, cutHere: false };

const root = {
  moveZoneEl: document.getElementById('moveZone'),
  jumpBtnEl: document.getElementById('jumpBtn'),
  flipBtnEl: document.getElementById('flipBtn'),
  pauseBtnEl: document.getElementById('pauseBtn'),
};
const input = createInput(root);

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
}
window.addEventListener('resize', resize);
resize();

function doRespawnOrStep(intent) {
  const prevState = runState;
  const prevBody = runState.body;
  // spec §8 Longer grace: the setting rides on the sim state every tick, so a mid-run toggle counts at once
  if (runState.longGrace !== saveData.settings.longGrace) runState = { ...runState, longGrace: saveData.settings.longGrace };
  runState = { ...runState, view: simView() }; // S4: the real camera rect, this tick
  const r = runStep(runState, intent, LEVEL);
  runState = r.state;
  pushEvents(r.events);
  audioTick();
  narrationTick(prevState, r.events);
  tagsStep();
  if (tagPulseTicks > 0) tagPulseTicks -= 1;
  audio?.sfx.warn(runState.snipping || runState.ended ? 0 : runState.warn); // S2 c: the brass note follows the meter
  if (runState.body.coat !== prevBody.coat) audioEvent({ type: 'flip' });
  if (runState.body.grounded && !prevBody.grounded && !runState.snipping) audioEvent({ type: 'land' });
  // THE-1568 D2 5 foley: jump "shh" on take-off, a card tap every stride (the hidden edge is the sim's
  // rate-limited paperHide / paperShow now, rework H6)
  if (prevBody.grounded && !runState.body.grounded && runState.body.vy < 0) audioEvent({ type: 'jump' });
  if (runState.body.grounded && !runState.snipping) {
    stepDist += Math.abs(runState.body.x - prevBody.x);
    if (stepDist >= STRIDE_U) { stepDist -= STRIDE_U; audioEvent({ type: 'step' }); }
  } else stepDist = 0;
  for (const e of r.events) {
    // the last hide (spec §2.2 last row): the sim already stopped the clock on this tick; the
    // ending owns its chord (played after the sweep, THE-1565 Q6), so no stab here
    if (e.type === 'ended') { enterEnding(); continue; }
    if (e.type === 'respawn') musicResync = true;
    audioEvent(e);
    if (e.type === 'rehearsalSnap') { snapAt = runState.tick; tagPulseTicks = Math.round(1.2 / DT); }
    // saves on a checkpoint (so a reload continues there, spec §8)
    if (e.type === 'checkpoint') {
      saveData.run = { cp: runState.cp, clockMs: runState.clockMs, snips: runState.snips, coat: runState.body.coat, negative: false, framesThisRun: saveData.frames.slice(), resolved: [], graceUsed: runState.graceUsed };
      write(saveData, storage);
    }
  }
  if (Math.abs(runState.body.vx) > 5) facingLeft = runState.body.vx < 0;
  if (runState.body.grounded && Math.abs(runState.body.vx) > 5) runPhase = (runPhase + Math.abs(runState.body.vx) * DT / 420) % 1;
  else runPhase = 0;
}

let manualIntent = { left: false, right: false, jumpHeld: false, jumpPressed: false, flipPressed: false };

let snapAt = -Infinity; // sim tick of the last rehearsal snap (the scissors close on air, render only)
function g2d(fn) { paper.g.save(); try { fn(); } finally { paper.g.restore(); } }
function tick() {
  if (screen === 'ending') { endingStep(); return; }
  if (screen === 'demo') { demoStep(); return; }
  if (screen !== 'play' || paused) return;
  const intent = QA_STEP ? manualIntent : input.sample();
  doRespawnOrStep(intent);
  if (!QA_STEP) { manualIntent.jumpPressed = false; manualIntent.flipPressed = false; }
}

function render() {
  updateGoalTag();
  updateHudSet();
  if (document.body.dataset.screen !== screen) document.body.dataset.screen = screen; // CSS: touch UI only in play
  if (screen === 'title') { // S8: the title is the set (brief 01-title); the DOM tickets sit over it
    drawTitleScreen(canvas.width, canvas.height);
    if (!QA_FLAT) paper.paperFinish();
    return;
  }
  if (screen === 'demo') { drawDemo(canvas.width, canvas.height, demoTick); if (!QA_FLAT) paper.paperFinish(); return; }
  const dpr = canvas.width / canvas.clientWidth;
  const cam = makeCamera();
  followHero(cam, runState.body.x); // the sim's S4 view rect assumes this straight follow
  // the ending (no sim, no S4): the camera eases over to frame the title assembling around the I
  if (screen === 'ending' || (screen === 'results' && runState.ended)) { const k = screen === 'results' ? 1 : Math.min(1, endingTick * DT / 0.8); cam.x += (TITLE_CX - cam.x) * (1 - (1 - k) ** 3); }
  const [a, b, c, d, e, f] = worldTransform(cam, canvas.clientWidth, canvas.clientHeight, screen === 'play' ? floorCapY() : Infinity);
  lastLayout = { floorY: f + level1.GROUND_Y * d, scale: a, camX: cam.x, viewW: canvas.clientWidth, viewH: canvas.clientHeight };
  renderTags(a, e, f);

  drawBackground(canvas.width, canvas.height, cam, 'mus'); // tangerine ground: open ground matches no coat (H4)
  paper.g.setTransform(a * dpr, b * dpr, c * dpr, d * dpr, e * dpr, f * dpr);
  // only the pieces near the camera
  const halfView = canvas.clientWidth / 2 / a + 400;
  const near = (p) => p.x + p.w > cam.x - halfView && p.x < cam.x + halfView;
  const pieces = level1.standOns.filter(near);
  const walls = [level1.LEFT_WALL, level1.RIGHT_WALL].filter(near);
  // draw order (spec-rework §2): ground -> decoration -> backdrops -> lamp patches -> stand-on shadows ->
  // stand-ons (+ tape) -> guards -> hero -> go-behinds (+ cut-here) -> the hero's outline behind one -> warning
  drawDecorations(level1.decorations.filter(near), LEVEL.ground === 'tangerine' ? 'tangerine' : LEVEL.ground);
  drawBackdrops(level1.backdrops.filter(near));
  for (const r of runState.rooms) if (near(r.rect)) drawRoomBack(r, level1.GROUND_Y); // ruling 11: the lit room's cream wash
  // the floor band first, so a beam's landing (the band's top 24 u in cream) paints over its tape
  drawFloorStandOn(cam.x - halfView - 400, cam.x + halfView + 400, level1.GROUND_Y);
  for (const l of runState.lamps) drawLampPatch(l.poly, level1.GROUND_Y);
  for (const l of runState.lamps) drawZoneLine(l.zone, level1.GROUND_Y); // ruling 10: what a swinging lamp watches
  drawStandOnShadows(pieces);
  drawStandOns(pieces);
  drawStandOns(walls);
  for (const cp of LEVEL.checkpoints) drawCheckpointFlag({ triggerX: cp.x - 30, triggerW: 60, triggerY: level1.GROUND_Y - 1, triggerH: 1 }, isPastCheckpoint(cp.id));
  for (const r of runState.rooms) {
    if (!near(r.rect)) continue;
    drawRoomFront(r, runState.tick, 0, level1.GROUND_Y);
    drawRoomEye(r, Math.min(r.rect.x + r.rect.w - 300, Math.max(r.rect.x + 300, cam.x)), runState.eyeBy === r.id ? eyeStep(runState.warn) : 0);
  }
  for (const l of runState.lamps) {
    const def = LEVEL.lamps.find((k) => k.id === l.id);
    if (def.bracket) drawBracket(l.bulb);
    drawLampFixture(l, { lit: l.lit, glow: l.glow, eye: runState.eyeBy === l.id ? eyeStep(runState.warn) : 0, /* open while w > 0, hold included, like the "!" and the note */ tag: def.tag || null });
  }

  // guards: the cone (always drawn: it is what he sees), then the puppet; his eye opens with the meter
  for (const gd of runState.guards) {
    drawCone(gd);
    drawGuard(gd, runState.eyeBy === gd.id ? eyeStep(runState.warn) : 0, level1.GROUND_Y);
  }

  stats.cutHere = runState.hidden === true; // F1 done-when: stats().cutHere <=> state().hidden
  const heroArgs = { x: runState.body.x, y: runState.body.y, coat: runState.body.coat, hidden: runState.hidden, facingLeft, runPhase, grounded: runState.body.grounded, rework: true };
  drawHero(heroArgs);
  drawGoBehinds(level1.goBehinds.filter(near));
  // H6: behind a go-behind, the dashed outline goes on top of the letter, in the colour opposite its fill
  const behind = runState.hidden && level1.goBehinds.find((gb) => near(gb) && runState.body.x + BODY_W / 2 > gb.x && runState.body.x - BODY_W / 2 < gb.x + gb.w && runState.body.y - BODY_H < gb.y + gb.h && runState.body.y > gb.y);
  if (behind) drawHero({ ...heroArgs, dashOnly: true, dashCol: behind.ink === 'cream' ? C.ink : C.paper });
  // the rehearsal lamp's snap: the scissors cut-out closes on empty air beside the hero (0.3 s)
  const snapT = (runState.tick - snapAt) / 120;
  if (snapT >= 0 && snapT < 0.6) {
    g2d(() => { paper.g.translate(runState.body.x + 70, runState.body.y - 90); paper.g.scale(0.45, 0.45); drawScissors(0, Math.max(0, 1 - snapT / 0.3), 0); });
  }
  // the flashing room's tags: its rule on the door, and "LIGHTS!" pulsing over the room on the warning beat
  for (const r of runState.rooms) {
    if (!near(r.rect)) continue;
    drawCutTag(r.rect.x + 230, -500, theme.text.room.rule, { size: 34 });
    if (r.warn && Math.floor(runState.tick / 10) % 2 === 0) drawCutTag(Math.min(r.rect.x + r.rect.w - 200, Math.max(r.rect.x + 200, cam.x)), -440, theme.text.room.warn, { size: 64, hot: true, rot: 0.03 });
  }
  if (screen === 'ending' || (screen === 'results' && runState.ended)) {
    const t = endingTick * DT;
    // a cream card fades in behind the title so the ink letters read over the room's letters and blocks
    const xs = TITLE_AROUND_I.map((r) => r.x), ys = TITLE_AROUND_I.map((r) => r.y);
    const x0 = Math.min(...xs) - 60, x1 = Math.max(...TITLE_AROUND_I.map((r) => r.x + r.w)) + 60, y0 = Math.min(...ys) - 60;
    g2d(() => { paper.g.globalAlpha = Math.min(1, t / 0.4); paper.g.fillStyle = C.paper; paper.g.fillRect(x0, y0, x1 - x0, level1.GROUND_Y - y0); });
    drawGoBehinds([END_PIECE]);
    drawTitleLetters(t, saveData.settings.reduceMotion, TITLE_AROUND_I);
  }
  if (!runState.snipping) drawWarnMark(runState.body.x, runState.body.y - BODY_H, runState.warn);

  // the snip beat: freeze (+ a glint on the lamp that saw) -> cut band -> screen wipe
  if (runState.snipping) {
    const elapsedS = (RESPAWN_TICKS - runState.respawnTicksLeft) * DT;
    const phase = snipPhase(elapsedS);
    const lampBy = runState.lamps.find((l) => l.id === runState.seenBy);
    const guardBy = runState.guards.find((gd) => gd.id === runState.seenBy);
    const roomBy = runState.rooms.find((r) => r.id === runState.seenBy);
    const glintAt = lampBy ? lampBy.bulb : guardBy ? guardBy.eye : roomBy ? { x: runState.body.x, y: -630 } : null;
    if (phase === 'freeze' && glintAt) drawGlint(glintAt.x, glintAt.y);
    // reduce motion (spec §8): a static band, and the wipe is a cut (drawn whole) instead of a slide
    const still = saveData.settings.reduceMotion;
    if (phase === 'cut') drawCutBand(runState.body.x, runState.body.y, still ? 0 : (elapsedS - SNIP_FREEZE_S) / (SNIP_STOP_S - SNIP_FREEZE_S));
    if (phase === 'wipe') drawWipe(canvas.width, canvas.height, still ? 1 : (elapsedS - SNIP_STOP_S) / (RESPAWN_S - SNIP_STOP_S));
  }

  if (!QA_FLAT) paper.paperFinish();
}

function isPastCheckpoint(id) {
  const order = LEVEL.checkpoints.map((c) => c.id);
  return order.indexOf(id) <= order.indexOf(runState.cp);
}

let musicResync = true; // the next frame re-anchors the music on the sim beat (play, resume, respawn)
let accumulator = 0;
let lastT = performance.now();
function frame(t) {
  const frameStart = performance.now();
  let dtMs = t - lastT; lastT = t;
  if (dtMs > 250) dtMs = 250;
  accumulator += dtMs;
  if (!QA_STEP) {
    while (accumulator >= DT * 1000) { tick(); accumulator -= DT * 1000; }
  }
  // the pause toggle (Escape/P key, or a tap on the touch pauseBtn, both collected by input.js)
  // must drain every frame, not just while screen === 'play' && !paused -- otherwise it could
  // never be seen while already paused, and Resume would have no way back in.
  if (input.samplePause() && screen === 'play') setPaused(!paused);
  // M (spec G10): one key mutes everything; pressed again, everything comes back on
  if (input.sampleMute()) {
    const buses = ['music', 'sfx', 'voice'];
    const anyOn = buses.some((bus) => saveData.settings[bus]);
    for (const bus of buses) setSetting(bus, !anyOn);
  }
  // ruling 4: the music follows the sim beat -- forced on play / resume / respawn, else when > 30 ms off
  if (screen === 'play' && !paused && audio && audio.music.sync(beatAt(runState.tick), musicResync)) musicResync = false;
  audio?.music.update();
  const roughBefore = paper.roughCount;
  render();
  stats.roughPerFrame = paper.roughCount - roughBefore; // spec §8 gate: 0 for the static cut pieces
  stats.frameMs = performance.now() - frameStart;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

const pauseScreenEl = document.getElementById('pauseScreen');
// the pause sheet is a modal <dialog>: its own Esc "cancel" is swallowed, because Esc/P already
// reach input.js and toggle the pause there (closing it twice would resume and re-pause)
function showPauseSheet(show) {
  if (show && !pauseScreenEl.open) pauseScreenEl.showModal();
  if (!show && pauseScreenEl.open) { settingsEl.close(); pauseScreenEl.close(); }
}
pauseScreenEl.addEventListener('cancel', (e) => e.preventDefault());
// a paused-while-backgrounded tab must not build up a tick backlog to burn through on resume
// (spec: the visibilitychange freeze). Pausing always drops the accumulator and resyncs lastT.
function setPaused(p) {
  paused = p;
  if (!p) musicResync = true;
  accumulator = 0;
  lastT = performance.now();
  showPauseSheet(p);
  // spec §2: pause and tab-away suspend the audio (the whole context, so nothing scheduled plays);
  // the voice is stopped for good, the strip finishes its remaining time on resume (THE-1563 Q6)
  if (p) { voiceRetry = 0; audio?.voice.stop(); }
  if (p) audio?.mixer.suspend(); else if (!document.hidden) audio?.mixer.resume();
}

function startRun(spawn, overrides) {
  // the PLAY / CONTINUE press is the first gesture: start the sound there, with the title stab
  if (ensureAudio()) {
    audio.mixer.hushMusic(false); // the ending hushed it (Replay)
    audio.mixer.resume().then(() => { audio.sfx.onEvent({ type: 'title' }); audio.music.start(); });
  }
  runState = newRunState(spawn, LEVEL, overrides);
  musicResync = true;
  tags = newTags(saveData.taught);
  snapAt = -Infinity;
  // a new run arms the lines; Continue resumes the saved run (THE-1563 Q1/Q2). Level 1 only saves at part
  // starts, and firstHide (W1) comes after the part-2 flag, so a Continue has only spent the briefing.
  // riddleSolved and reveal are parked (spec-rework §5): never armed in level 1.
  resetNarration(overrides ? ['briefing', 'riddleSolved', 'reveal'] : ['riddleSolved', 'reveal']);
  screen = 'play';
  document.getElementById('titleScreen')?.setAttribute('hidden', '');
  resultsEl.setAttribute('hidden', '');
  goalTagEl?.removeAttribute('hidden');
  updateGoalTag();
}

// ---- the ending + results (S8 THE-1565; spec §3.6, §2.2 last row; design §4) ----
// Entered from the sim's `ended` event only (no second end check). The bests are written here, on
// the last-hide tick, so a reload during the ending still keeps them.
const resultsEl = document.getElementById('resultsScreen');
function enterEnding() {
  screen = 'ending';
  endingTick = 0;
  goalTagEl?.setAttribute('hidden', '');
  const r = applyResult(saveData, { clockMs: runState.clockMs, snips: runState.snips });
  saveData = r.save;
  write(saveData, storage);
  lastResult = { clockMs: runState.clockMs, snips: runState.snips, newBestTime: r.newBestTime, newBestSnips: r.newBestSnips, graceUsed: runState.graceUsed };
  endingCue(0);
}
function endingCue(t) {
  for (const c of endingCues) {
    if (c.tick !== t) continue;
    // stop() halts scheduling; the hush also silences bars already queued in the look-ahead
    if (c.type === 'musicStop') { audio?.music.stop(); audio?.mixer.hushMusic(true); }
    if (c.type === 'chord') audio?.sfx.onEvent({ type: 'ended' });
    if (c.type === 'bongo') audio?.sfx.onEvent({ type: 'bongo' });
  }
}
function endingStep() {
  endingTick += 1;
  narrationTick(runState, []); // line 6's strip hold keeps counting while the sim is stopped
  endingCue(endingTick);
  if (endingDone(endingTick)) {
    if (!saveData.seenEnding) { saveData.seenEnding = true; write(saveData, storage); }
    showResults();
  }
}
function skipEnding() {
  if (screen === 'ending' && canSkip(saveData.seenEnding)) showResults();
}
// tap / any key skips after the first full view (spec §2.2); listeners check the screen first
window.addEventListener('pointerdown', skipEnding);
window.addEventListener('keydown', skipEnding);

function showResults() {
  screen = 'results';
  strip.hide();
  audio?.voice.stop();
  const t = theme.text.results;
  const best = saveData.best;
  resultsEl.querySelector('[data-r="time"]').textContent = formatTime(lastResult.clockMs);
  resultsEl.querySelector('[data-r="snips"]').textContent = String(lastResult.snips);
  resultsEl.querySelector('[data-r="best"]').textContent = `${t.best} ${formatTime(best.timeMs)}`;
  resultsEl.querySelector('[data-r="fewest"]').textContent = `${t.fewest} ${best.snips}`;
  resultsEl.querySelector('[data-r="newBest"]').toggleAttribute('hidden', !(lastResult.newBestTime || lastResult.newBestSnips));
  resultsEl.querySelector('[data-r="grace"]').toggleAttribute('hidden', !lastResult.graceUsed);
  resultsEl.removeAttribute('hidden');
}
function toTitle() {
  screen = 'title';
  resultsEl.setAttribute('hidden', '');
  showTitle();
  document.getElementById('titleScreen')?.removeAttribute('hidden');
}
document.getElementById('replayBtn').addEventListener('click', () => startRun(LEVEL.checkpoints[0]));
document.getElementById('toTitleBtn').addEventListener('click', toTitle);
for (const el of resultsEl.querySelectorAll('[data-label]')) el.textContent = theme.text.results[el.dataset.label];

// The HUD goal tag (rework spec §5): "GET TO THE I OF INK". Text from theme.js.
const goalTagEl = document.getElementById('goalTag');
let goalTagDone = null;
function updateGoalTag() {
  if (!goalTagEl || goalTagDone === false) return;
  goalTagDone = false;
  goalTagEl.querySelector('.pi-goal__text').textContent = theme.text.goal;
}

// HUD part tag + app ground (DESIGN §2: #app[data-ground] flips the tags to cream on ink) + FLIP disc
// state (.is-cream when the coat is cream). Written only on change.
const setTagEl = document.getElementById('setTag');
const flipBtnEl = document.getElementById('flipBtn');
let hudSet = 0;
function updateHudSet() {
  if (screen !== 'play' || !runState) return;
  if (document.body.dataset.ground !== level1.GROUND) document.body.dataset.ground = level1.GROUND;
  flipBtnEl.classList.toggle('is-cream', runState.body.coat === 'cream');
  const part = level1.partAt(runState.body.x);
  if (part === hudSet) return;
  hudSet = part;
  setTagEl.querySelector('.pi-tag__num').textContent = `PART ${part}/${level1.PARTS}`;
  setTagEl.querySelector('.pi-tag__name').textContent = theme.text.parts[part - 1] ?? '';
  setTagEl.classList.remove('is-new');
  void setTagEl.offsetWidth; // restart the skin's set-entry slap
  setTagEl.classList.add('is-new');
}

function showTitle() {
  const run = saveData.run;
  const continueBtnEl = document.getElementById('continueBtn');
  const playBtnEl = document.getElementById('playBtn');
  if (run) {
    const cpDef = LEVEL.checkpoints.find((c) => c.id === run.cp);
    continueBtnEl?.removeAttribute('hidden');
    if (continueBtnEl) continueBtnEl.textContent = `CONTINUE (PART ${cpDef?.part ?? 1}/${level1.PARTS})`;
    if (playBtnEl) playBtnEl.textContent = 'NEW RUN';
  } else {
    continueBtnEl?.setAttribute('hidden', '');
    if (playBtnEl) playBtnEl.textContent = 'PLAY';
  }
  // the return loop on the title (spec §8): best time + fewest snips, once there is a finish
  const bestEl = document.getElementById('titleBest');
  const best = saveData.best, t = theme.text.results;
  bestEl.toggleAttribute('hidden', !best);
  if (best) bestEl.textContent = `${t.best} ${formatTime(best.timeMs)} · ${t.fewest} ${best.snips}`;
}
showTitle();

document.getElementById('playBtn')?.addEventListener('click', () => {
  // New run abandons any saved progress -- otherwise quitting before the next checkpoint would
  // still offer the stale CONTINUE (SET n/6) on the next load.
  if (saveData.run) { saveData.run = null; write(saveData, storage); }
  // first run: the onboarding demo plays first (spec §8). The context resumes on this gesture,
  // since the run itself then starts from a tick, not a gesture.
  if (!saveData.seenDemo) { if (ensureAudio()) audio.mixer.resume(); startDemo('play'); return; }
  startRun(LEVEL.checkpoints[0]);
});

// ---- the demo = How to play (S8; spec §8 onboarding script, THE-1565 Q10) ----
const demoEl = document.getElementById('demoScreen');
const demoCaptionEl = document.getElementById('demoCaption');
const demoSkipEl = document.getElementById('demoSkip');
demoSkipEl.textContent = theme.captions.skip;
let demoShownCard = -1;
function startDemo(ret) {
  demoReturn = ret;
  demoTick = 0;
  demoShownCard = -1;
  screen = 'demo';
  document.getElementById('titleScreen').setAttribute('hidden', '');
  showPauseSheet(false);
  demoEl.removeAttribute('hidden');
  demoStep(0);
}
function demoStep(dt = 1) {
  demoTick += dt;
  if (demoDone(demoTick)) return endDemo();
  const i = demoCard(demoTick);
  if (i !== demoShownCard) { demoShownCard = i; demoCaptionEl.textContent = theme.captions.demo[DEMO_CARDS[i].id]; }
  demoSkipEl.toggleAttribute('hidden', !canSkipDemo(demoTick));
}
function endDemo() {
  demoEl.setAttribute('hidden', '');
  if (!saveData.seenDemo) { saveData.seenDemo = true; write(saveData, storage); }
  if (demoReturn === 'play') return startRun(LEVEL.checkpoints[0]);
  if (demoReturn === 'pause') { screen = 'play'; showPauseSheet(true); return; }
  screen = 'title';
  document.getElementById('titleScreen').removeAttribute('hidden');
}
// tap / any key skips after 1 s; listeners check the screen first
const skipDemo = () => { if (screen === 'demo' && canSkipDemo(demoTick)) endDemo(); };
window.addEventListener('pointerdown', skipDemo);
window.addEventListener('keydown', skipDemo);
document.getElementById('howtoBtn').addEventListener('click', () => startDemo('title'));
document.getElementById('pauseHowtoBtn').addEventListener('click', () => startDemo('pause'));

// ---- PWA (spec §8): offline via sw.js (built by tools/sw-build.mjs) + our own install button ----
// glyphs.js has a top-level await, so this module can finish after `load` has already fired: register
// now if it has (a bare load listener then never ran, and the game never went offline-capable)
// (not under ?qa=...: the test modes must always run the files on disk, never a cached copy)
if ('serviceWorker' in navigator && location.protocol !== 'file:' && !new URLSearchParams(location.search).has('qa')) {
  const registerSw = () => navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
  if (document.readyState === 'complete') registerSw(); else addEventListener('load', registerSw);
}
const installBtnEl = document.getElementById('installBtn');
let installPrompt = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; installBtnEl.hidden = false; });
addEventListener('appinstalled', () => { installPrompt = null; installBtnEl.hidden = true; });
installBtnEl.addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => null);
  installPrompt = null;
  installBtnEl.hidden = true;
});

// ---- About (spec §6: credits + licences) ----
const aboutEl = document.getElementById('aboutDialog');
document.getElementById('aboutBtn').addEventListener('click', () => aboutEl.showModal());
document.getElementById('aboutCloseBtn').addEventListener('click', () => aboutEl.close());
for (const el of document.querySelectorAll('[data-t]')) el.textContent = theme.text[el.dataset.t]; // title + About labels
document.getElementById('continueBtn')?.addEventListener('click', () => {
  const run = saveData.run;
  if (!run) return;
  const cpDef = LEVEL.checkpoints.find((c) => c.id === run.cp);
  // the hazard clock resumes from the run clock (tick = clockMs at 120 Hz), so the beat lines up again
  if (cpDef) startRun(cpDef, { clockMs: run.clockMs, snips: run.snips, coat: run.coat, graceUsed: run.graceUsed, longGrace: saveData.settings.longGrace });
});

// no click listener on pauseBtn itself: input.js's pointerdown binding already feeds pauseEdge,
// drained once per frame above -- a second click-driven toggle here would double-fire and cancel.
document.getElementById('resumeBtn')?.addEventListener('click', () => setPaused(false));
document.getElementById('restartFlagBtn')?.addEventListener('click', () => {
  const cpDef = LEVEL.checkpoints.find((c) => c.id === runState.cp);
  // graceUsed carries over (THE-1569): a FROM FLAG restart is the same run, so the results' grace tag must stay
  if (cpDef) runState = newRunState(cpDef, LEVEL, { tick: runState.tick, clockMs: runState.clockMs, snips: runState.snips, graceUsed: runState.graceUsed, longGrace: saveData.settings.longGrace });
  setPaused(false);
});
document.getElementById('restartLevelBtn')?.addEventListener('click', () => {
  runState = newRunState(LEVEL.checkpoints[0], LEVEL);
  tags = newTags(saveData.taught);
  resetNarration(['riddleSolved', 'reveal']);
  setPaused(false);
});

// turn your phone (spec §5, S9 Q5): the skin shows the card on this same query; play pauses behind it,
// and turning back leaves the pause sheet up (no auto-resume mid-wedge)
const PORTRAIT_PHONE = matchMedia('(orientation: portrait) and (max-width: 600px)');
const pauseIfTurned = () => { if (PORTRAIT_PHONE.matches && screen === 'play' && !paused) setPaused(true); };
PORTRAIT_PHONE.addEventListener('change', pauseIfTurned);

document.addEventListener('visibilitychange', () => {
  if (document.hidden && screen === 'play') setPaused(true);
  else if (document.hidden) audio?.mixer.suspend();
  else if (!paused) audio?.mixer.resume();
});

window.__ink = {
  state() {
    return {
      screen, paused, cp: runState.cp, clockMs: runState.clockMs, snips: runState.snips,
      ended: !!runState.ended, endingTick, // S8: the last hide + the ending's own UI tick count
      hero: { x: runState.body.x, y: runState.body.y, vx: runState.body.vx, vy: runState.body.vy, coat: runState.body.coat, grounded: runState.body.grounded },
      hidden: runState.hidden === true,
      // THE-1648 rework rules: matched + covered points of 45 (H1), the S2 meter, who sees, the lamps' state
      count: runState.count, cover: runState.count / 45,
      warn: runState.warn, warnUnseen: runState.warnUnseen, eyeBy: runState.eyeBy, held: runState.held, seenBy: runState.seenBy, tick: runState.tick,
      lamps: runState.lamps.map((l) => ({ id: l.id, bulb: { ...l.bulb }, angleDeg: l.angleDeg, lit: l.lit, glow: l.glow, poly: l.poly ? l.poly.map((p) => ({ ...p })) : null, zone: l.zone ? l.zone.map((p) => ({ ...p })) : null })),
      // THE-1651: the walking guards (where, which way, phase, the clipped cone) and the flashing room
      guards: runState.guards.map((gd) => ({ id: gd.id, x: gd.x, dir: gd.dir, phase: gd.phase, frame: gd.frame, eye: { ...gd.eye }, cone: gd.cone.map((p) => ({ ...p })) })),
      rooms: runState.rooms.map((r) => ({ id: r.id, lit: r.lit, warn: r.warn, rect: { ...r.rect } })),
      beat: beatAt(runState.tick),
      snipping: runState.snipping,
      longGrace: !!runState.longGrace, graceUsed: !!runState.graceUsed, // spec §8 Longer grace
      view: { ...runState.view },
    };
  },
  events() { return EVENTS.slice(); },
  stats() { return { ...stats }; },
  palette: () => ({ ...C }), // the canvas inks after theme.js colour slots (swap check)
  // the last play frame's world->screen mapping, css px (layout check, spec §6): floorY = the ground line
  layout: () => ({ ...lastLayout }),
  // every piece the world draws standing on the floor, world units, for the layout check
  layoutPieces: () => [...level1.standOns, ...level1.backdrops, ...level1.goBehinds, ...level1.decorations]
    .map((p) => ({ x: p.x, y: p.y - level1.GROUND_Y, w: p.w, h: p.h })),
  level: LEVEL,
  // THE-1648 review: a test lamp for the real-input S2 check (a lamp that can snip, placed by the test).
  // def: { bulb: { x, y }, halfAngleDeg, throw }; it sits fixed, always lit, and snips at w = 1
  addTestLamp(def) {
    LEVEL.lamps = [...LEVEL.lamps, { id: 'TEST', angleAt: () => 0, litAt: () => true, canSnip: true, ...def }];
    runState = { ...runState, lamps: [] }; // the next step rebuilds the lamps from LEVEL
  },
  save: () => saveData,
  setIntent(i) { manualIntent = { ...manualIntent, ...i }; },
  step(n = 1) { for (let i = 0; i < n; i++) tick(); },
  // tick: the beat clock to start from (the hazards' phase), default 0
  loadCheckpoint(id, tick) {
    const cpDef = LEVEL.checkpoints.find((c) => c.id === id);
    if (cpDef) runState = newRunState(cpDef, LEVEL, tick !== undefined ? { tick } : {});
  },
  startPlay() { startRun(LEVEL.checkpoints[0]); },
  continueRun() { document.getElementById('continueBtn')?.click(); },
  setPaused,
  input,
  // THE-1561: sound state for the lifecycle check, and the voice duck hook (music -7 dB)
  audio() {
    if (!audio) return null;
    return { state: audio.mixer.ctx.state, live: audio.mixer.liveVoices(), music: audio.music.playing(), settings: { ...saveData.settings } };
  },
  duck: (on) => audio?.mixer.duck(on),
  audioEvent, // fire one sound event by type (the Designer's listen-pass capture)
  audioMaster: () => audio?.mixer.out ?? null, // the last node before the speakers
  // THE-1563: the narration queue, and one line forced onto the strip (the layout test)
  narration: () => ({ ...narration, voicePlaying: !!audio?.voice.playing(), voiceLoaded: voiceLoaded() }),
  showLine: (id) => strip.show(theme.lines[id], false),
  // THE-1637: the in-world tag on screen now (run | jump | flip | null) and whether the lesson is done
  tags: () => ({ shown: shownTag, taught: tags.taught }),
};
