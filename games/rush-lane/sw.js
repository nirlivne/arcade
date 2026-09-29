// Hand-written service worker: precache the game's own files, serve cache-first.
// Bump CACHE_VERSION whenever any shipped file changes.
var CACHE_VERSION = 'rush-lane-v6';
var FILES = [
  './', 'index.html', 'style.css', 'tokens.css', 'ui-kit.css',
  'theme.js', 'ui-kit.js', 'board.js', 'save.js', 'levels.js', 'daily-shapes.js', 'game.js', 'register-sw.js',
  'fonts/Fredoka-latin.woff2',
  'manifest.json', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE_VERSION).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('rush-lane-') === 0 && k !== CACHE_VERSION; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(function (hit) { return hit || fetch(e.request); }));
});
