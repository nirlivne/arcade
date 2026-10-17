if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', function () {
    // true on a page the previous worker already serves: a published update, with stale files on screen
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js', { scope: './' }).catch(function () {});
    // sw.js skips waiting and claims the page as soon as the new version is cached, but the old files are
    // already running (2026-10-17: the board saw the previous build the evening after a publish). Reload once
    // to get the new ones, between games only (title or game over), never mid-play or mid-deal.
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController) return; // first install: nothing stale on screen
      reloadBetweenGames();
    });
  });
}

function reloadBetweenGames() {
  var title = document.getElementById('chomp-title');
  var over = document.getElementById('chomp-gameover');
  var between = (title && !title.hidden) || (over && !over.hidden);
  if (between) location.reload();
  else setTimeout(reloadBetweenGames, 2000);
}
