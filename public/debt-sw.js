// Debt app service worker — Web Push plus an offline copy of the app shell.
// The fetch handler is deliberately minimal: navigations (opening the app)
// go network-first with the cached shell as the no-signal fallback, and the
// few static assets the shell needs are cache-first. Everything else — all
// /debt/api calls especially — passes through untouched, so online
// behaviour is unchanged and nothing dynamic is ever served stale; offline
// DATA is the page's job (debt.html keeps a read-only localStorage
// snapshot of the last synced state). Registered from debt.html with scope
// '/debt', which out-specifics the estimator worker's '/' scope for both
// /debt and /debt.html; the estimator's sw.js still never touches /debt.

var SHELL_CACHE = 'debt-shell-v1';
var SHELL_URL = '/debt';
var SHELL_ASSETS = ['/debt', '/debt-manifest.json', '/debt-icon-192.png', '/debt-touch-icon.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(SHELL_CACHE)
      .then(function (cache) { return cache.addAll(SHELL_ASSETS); })
      .catch(function () {}) // a failed precache must not block push setup
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys
        .filter(function (k) { return k.indexOf('debt-shell-') === 0 && k !== SHELL_CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  // Opening the app: network-first so a deploy shows up on the next online
  // load (the fresh copy replaces the cached shell); with no signal the
  // cached shell opens instead of the browser's error page.
  if (e.request.mode === 'navigate') {
    // Only a real shell navigation may refresh the cached copy — someone
    // opening /debt/api/state directly in a tab is also a "navigate", and
    // must not replace the shell with JSON.
    var navPath = new URL(e.request.url).pathname;
    var isShell = navPath === '/debt' || navPath === '/debt.html';
    e.respondWith(
      fetch(e.request).then(function (res) {
        if (isShell && res && res.ok) {
          var copy = res.clone();
          caches.open(SHELL_CACHE).then(function (cache) { cache.put(SHELL_URL, copy); });
        }
        return res;
      }).catch(function () {
        return isShell ? caches.match(SHELL_URL) : Promise.reject(new Error('offline'));
      })
    );
    return;
  }
  var url = new URL(e.request.url);
  if (e.request.method === 'GET' && url.origin === self.location.origin && SHELL_ASSETS.indexOf(url.pathname) !== -1) {
    e.respondWith(
      caches.match(e.request).then(function (hit) { return hit || fetch(e.request); })
    );
  }
});

// Every push MUST show a notification — iOS (and Chrome) penalise "silent"
// pushes by revoking the subscription, so even an unparseable payload gets
// a generic banner rather than being dropped.
self.addEventListener('push', function (e) {
  var data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch (err) {
    data = { body: e.data ? e.data.text() : '' };
  }
  e.waitUntil(self.registration.showNotification(data.title || 'Debt Plan', {
    body: data.body || '',
    tag: data.tag || undefined,
    icon: '/debt-icon-192.png',
    badge: '/debt-icon-192.png',
    data: { url: data.url || '/debt' }
  }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || '/debt';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].url.indexOf('/debt') !== -1 && 'focus' in list[i]) return list[i].focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
