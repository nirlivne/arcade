// The Hebrew subtitle strip (spec §3.5 / §6, S7 THE-1563): a DOM strip, dir="rtl", Secular One,
// bottom-right above the right thumb cluster. Shows one line; game.js times it in sim ticks.
export function createStrip(el) {
  const textEl = el.querySelector('.strip__text');
  return {
    show(text, onLight) {
      textEl.textContent = text;
      el.classList.toggle('strip--ink', onLight);
      el.classList.toggle('pi-strip--ink', onLight); // skin.css hook (S9)
      el.removeAttribute('hidden');
      el.classList.add('is-shown');
    },
    hide() {
      el.classList.remove('is-shown');
      el.setAttribute('hidden', '');
    },
  };
}
