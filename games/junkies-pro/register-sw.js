if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', function () {
    // true on a page the previous worker already serves: a published update, with stale files on screen
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js', { scope: './' }).catch(function () {});
    // sw.js skips waiting and claims the page as soon as the new version is cached, but the old code is already
    // running (2026-10-20: a phone kept showing v17's About after v18 was live). Reload once to get the new files,
    // between games only (the start screen or the end card), never mid-game.
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController) return; // first install: nothing stale on screen
      reloadBetweenGames();
    });
  });
}

function reloadBetweenGames() {
  function shown(id) { var el = document.getElementById(id); return !!el && !el.classList.contains('hidden'); }
  if (shown('start') || shown('over')) location.reload();
  else setTimeout(reloadBetweenGames, 2000);
}
