// Hand-written service worker: precache the game's own files, serve cache-first.
// Bump CACHE_VERSION whenever any shipped file changes.
var CACHE_VERSION = 'junkies-v2';
var FILES = [
  './', 'index.html', 'register-sw.js', 'favicon-32.png',
  'manifest.json', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png',
  'licenses/Fredoka-OFL.txt', 'licenses/Karantina-OFL.txt', 'licenses/PatrickHand-OFL.txt',
  'licenses/PermanentMarker-Apache-2.0.txt', 'licenses/RubikDoodleShadow-OFL.txt'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE_VERSION).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('junkies-') === 0 && k !== CACHE_VERSION; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(function (hit) { return hit || fetch(e.request); }));
});
