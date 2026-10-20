// The game's own install button (2026-10-20). Chrome fires beforeinstallprompt when it judges the game installable and
// not yet installed; we keep that event and show a button that calls prompt(), so nobody has to find Chrome's menu
// entry. Loaded before the game so an early event is not missed. The About window shows what Chrome decided
// (GameInstall.state()), to check a phone: 'none' never offered (not installable here, or Chrome thinks it is installed),
// 'ready' offered, 'installed' just installed, 'dismissed' the prompt was cancelled, 'app' running as the installed app.
(function () {
  var ev = null, subs = [];
  var app = (window.matchMedia && matchMedia('(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)').matches) || navigator.standalone === true;
  var state = app ? 'app' : 'none';
  function set(s) { state = s; subs.forEach(function (f) { try { f(state); } catch (e) {} }); }
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); ev = e; set('ready'); });
  window.addEventListener('appinstalled', function () { ev = null; set('installed'); });
  window.GameInstall = {
    state: function () { return state; },
    // f(state) now and on every change
    onChange: function (f) { subs.push(f); try { f(state); } catch (e) {} },
    // from a click: Chrome's install dialog; resolves 'accepted' | 'dismissed' | 'none'
    prompt: function () {
      if (!ev) return Promise.resolve('none');
      var e = ev; ev = null;
      return Promise.resolve(e.prompt()).then(function () { return e.userChoice; }).then(function (c) {
        if (c && c.outcome === 'accepted') set('installed'); else set('dismissed'); // Chrome may offer again later
        return c ? c.outcome : 'none';
      }, function () { set('dismissed'); return 'none'; });
    }
  };
})();
