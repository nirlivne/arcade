// Keyboard + touch input (spec §5). Intent is sampled once per sim tick; jumpPressed/flipPressed
// are one-shot edges, cleared by sample(). Touch clusters track pointerId so both thumbs register
// at once with no cross-talk (spec §5, §10.7).
const KEY_LEFT = new Set(['ArrowLeft', 'KeyA']);
const KEY_RIGHT = new Set(['ArrowRight', 'KeyD']);
const KEY_JUMP = new Set(['Space', 'ArrowUp', 'KeyW', 'KeyZ']);
const KEY_FLIP = new Set(['KeyX', 'ShiftLeft', 'ShiftRight', 'KeyJ']);
const KEY_PAUSE = new Set(['Escape', 'KeyP']);
const KEY_MUTE = new Set(['KeyM']);

export function createInput(root) {
  const held = { left: false, right: false, jumpHeld: false, flipHeld: false };
  let jumpEdge = false, flipEdge = false, pauseEdge = false, muteEdge = false;

  function onKeyDown(e) {
    if (e.repeat) return;
    if (KEY_LEFT.has(e.code)) held.left = true;
    else if (KEY_RIGHT.has(e.code)) held.right = true;
    else if (KEY_JUMP.has(e.code)) { held.jumpHeld = true; jumpEdge = true; }
    else if (KEY_FLIP.has(e.code)) { held.flipHeld = true; flipEdge = true; }
    else if (KEY_PAUSE.has(e.code)) pauseEdge = true;
    else if (KEY_MUTE.has(e.code)) muteEdge = true;
    else return;
    e.preventDefault();
  }
  function onKeyUp(e) {
    if (KEY_LEFT.has(e.code)) held.left = false;
    else if (KEY_RIGHT.has(e.code)) held.right = false;
    else if (KEY_JUMP.has(e.code)) held.jumpHeld = false;
    else if (KEY_FLIP.has(e.code)) held.flipHeld = false;
    else return;
    e.preventDefault();
  }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  // touch clusters, one active pointerId per button/zone
  const moveZone = { pointerId: null, dir: 0 };
  const jumpBtn = { pointerId: null };
  const flipBtn = { pointerId: null };

  function rectOf(el) { return el.getBoundingClientRect(); }
  function dirFromX(el, clientX) {
    const r = rectOf(el);
    return clientX < r.left + r.width / 2 ? -1 : 1;
  }

  function bindMoveZone(el) {
    // the skin's pressed look (.is-down) on the ◀ / ▶ disc under the finger
    const discs = { '-1': el.querySelector?.('.pi-tbtn--left'), 1: el.querySelector?.('.pi-tbtn--right') };
    const showDir = () => { discs['-1']?.classList.toggle('is-down', moveZone.dir < 0); discs[1]?.classList.toggle('is-down', moveZone.dir > 0); };
    el.addEventListener('pointerdown', (e) => {
      if (moveZone.pointerId !== null) return; // a spare finger is ignored
      moveZone.pointerId = e.pointerId;
      moveZone.dir = dirFromX(el, e.clientX);
      el.setPointerCapture(e.pointerId);
      showDir();
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== moveZone.pointerId) return;
      moveZone.dir = dirFromX(el, e.clientX);
      showDir();
    });
    const release = (e) => {
      if (e.pointerId !== moveZone.pointerId) return;
      moveZone.pointerId = null; moveZone.dir = 0;
      showDir();
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('pointerleave', (e) => { if (e.pointerId === moveZone.pointerId) release(e); });
  }

  function bindHoldButton(el, state, onEdge) {
    el.addEventListener('pointerdown', (e) => {
      if (state.pointerId !== null) return;
      state.pointerId = e.pointerId;
      onEdge();
      el.setPointerCapture(e.pointerId);
      el.classList?.add('is-down');
    });
    const release = (e) => { if (e.pointerId === state.pointerId) { state.pointerId = null; el.classList?.remove('is-down'); } };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
  }

  if (root.moveZoneEl) bindMoveZone(root.moveZoneEl);
  if (root.jumpBtnEl) bindHoldButton(root.jumpBtnEl, jumpBtn, () => { jumpEdge = true; });
  if (root.flipBtnEl) bindHoldButton(root.flipBtnEl, flipBtn, () => { flipEdge = true; });
  if (root.pauseBtnEl) root.pauseBtnEl.addEventListener('pointerdown', () => { pauseEdge = true; });

  return {
    sample() {
      const left = held.left || moveZone.dir < 0;
      const right = held.right || moveZone.dir > 0;
      const jumpHeld = held.jumpHeld || jumpBtn.pointerId !== null;
      const flipHeld = held.flipHeld || flipBtn.pointerId !== null;
      const intent = { left, right, jumpHeld, jumpPressed: jumpEdge, flipPressed: flipEdge };
      jumpEdge = false; flipEdge = false;
      return intent;
    },
    samplePause() { const p = pauseEdge; pauseEdge = false; return p; },
    sampleMute() { const m = muteEdge; muteEdge = false; return m; },
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    },
  };
}
