// Service worker: makes the app installable (with manifest.json) and able to
// OPEN with no signal -- a dead spot on site used to mean the app might not
// even load, despite all the data being in localStorage.
//
// Strategy is deliberately network-first for everything: online behaviour is
// IDENTICAL to having no service worker at all (every request goes to the
// network; ETag/no-cache semantics from the server still apply), and the
// cache is only ever read when the network fails. So there is no
// stale-deploy risk -- a new index.html shows up on the next online load,
// same as before this file existed.
//
// /api, /auth and /debt requests are never intercepted: the app's own
// localStorage-first storage layer already handles offline data, and the
// debt app is a separate tool that manages itself.

var CACHE = 'nh-estimator-v1';
var CORE = ['/', '/logo.png', '/apple-touch-icon.png', '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(CORE); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.indexOf('/api') === 0 || url.pathname.indexOf('/auth') === 0 || url.pathname.indexOf('/debt') === 0) return;

  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      // Offline. Serve the cached copy; for navigations (any URL the user
      // opens, including /?xero=connected etc.) fall back to the cached
      // app shell.
      return caches.match(req).then(function (m) {
        if (m) return m;
        if (req.mode === 'navigate') return caches.match('/');
        return Response.error();
      });
    })
  );
});
