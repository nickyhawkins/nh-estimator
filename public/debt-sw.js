// Debt app service worker — exists for Web Push only. Deliberately NO fetch
// handler: the estimator's sw.js explicitly never intercepts /debt (its
// comment says the debt app manages itself), and this file keeps that true
// by not adding its own offline layer either — online behaviour is exactly
// as if no service worker existed. Registered from debt.html with scope
// '/debt', which out-specifics the estimator worker's '/' scope for both
// /debt and /debt.html.

self.addEventListener('install', function (e) {
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(self.clients.claim());
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
