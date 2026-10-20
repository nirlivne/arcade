// The game's own install button (2026-10-20). Chrome fires beforeinstallprompt when it judges the game installable; we
// keep that event and show a button that calls prompt(), so nobody has to find Chrome's menu entry (on Nir's Android
// the menu said "already installed" and couldn't open it, while this button installed the game). Loaded before the
// game so an early event is not missed. The About window shows GameInstall.state():
//   'none' never offered, 'ready' offered (the button shows), 'installed' installed on this device, 'dismissed' the
//   prompt was cancelled, 'app' running as the installed app.
// Chrome can offer installation for a game that is already installed (Nir's phone again), so the offer alone doesn't
// show the button: the game remembers an install on this device (installed through the button, or opened as the app
// once; the app and the browser share storage) and asks Chrome where it can (getInstalledRelatedApps, with the
// manifest's related_applications pointing at itself). Uninstalling doesn't clear the memory; ?install=reset does.
(function () {
  var KEY = 'installed:' + location.pathname.replace(/index\.html$/, ''); // per game: the arcade games share an origin
  var ev = null, subs = [];
  function load() { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } }
  function remember() { try { localStorage.setItem(KEY, '1'); } catch (e) {} }
  if (/[?&]install=reset\b/.test(location.search)) { try { localStorage.removeItem(KEY); } catch (e) {} }
  var app = (window.matchMedia && matchMedia('(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)').matches) || navigator.standalone === true;
  if (app) remember();
  var known = load();
  var state = app ? 'app' : known ? 'installed' : 'none';
  function set(s) { state = s; subs.forEach(function (f) { try { f(state); } catch (e) {} }); }
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); ev = e;
    if (state === 'none' || state === 'dismissed') set('ready');
  });
  window.addEventListener('appinstalled', function () { ev = null; remember(); known = true; if (state !== 'app') set('installed'); });
  if (!app && navigator.getInstalledRelatedApps) {
    navigator.getInstalledRelatedApps().then(function (apps) {
      if (apps && apps.length) { remember(); known = true; if (state !== 'app') set('installed'); }
    }, function () {});
  }
  window.GameInstall = {
    state: function () { return state; },
    // f(state) now and on every change
    onChange: function (f) { subs.push(f); try { f(state); } catch (e) {} },
    // from a click: Chrome's install dialog; resolves 'accepted' | 'dismissed' | 'none'
    prompt: function () {
      if (!ev) return Promise.resolve('none');
      var e = ev; ev = null;
      return Promise.resolve(e.prompt()).then(function () { return e.userChoice; }).then(function (c) {
        if (c && c.outcome === 'accepted') { remember(); known = true; set('installed'); } else set('dismissed'); // Chrome may offer again later
        return c ? c.outcome : 'none';
      }, function () { set('dismissed'); return 'none'; });
    }
  };
})();
