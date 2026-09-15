// Service worker: makes the app installable (with manifest.json) and able to
// OPEN with no signal -- a dead spot on site used to mean the app might not
// even load, despite all the data being in localStorage.
//
// Strategy is network-first WITH A DEADLINE. Online on a working connection
// the behaviour is what it always was -- every request goes to the network,
// the server's no-cache/ETag semantics still apply, so a deploy shows up on
// the next load and there is no stale-shell risk. What changed (v2) is what
// happens when the network neither succeeds nor fails:
//
//   A phone in a dead spot is usually NOT cleanly offline. It has a bar of
//   signal and no throughput, so fetch() doesn't reject -- it HANGS, for as
//   long as the OS's TCP timeout (tens of seconds, sometimes minutes). The
//   old handler only served the cache from .catch(), which in that state
//   never ran, so the launch sat on a white screen and the app "didn't load".
//   Airplane mode, where fetch rejects instantly, worked fine -- which is
//   exactly why it failed only SOMETIMES.
//
// So every same-origin request now races the network against NET_TIMEOUT_MS,
// and serves the cached copy the moment the deadline passes. The network leg
// is kept alive on waitUntil, so a late reply still refreshes the cache for
// next time. The deadline only applies when there IS something cached to fall
// back to; a first-ever load still waits for the network as long as it takes.
//
// The other three things that could leave a phone with no shell to fall back
// on, all fixed here:
//   · install used cache.addAll, which is ATOMIC -- one flaky icon and the
//     whole precache was abandoned, silently, leaving no offline copy at all.
//     Now each entry is fetched and stored on its own.
//   · the cache writes in the fetch handler were floating promises. respondWith
//     resolves as soon as the response is handed back, and the browser is free
//     to kill the worker at that point -- so on a phone that suspends workers
//     aggressively the put could simply never happen. They're on waitUntil now.
//   · cache.match honours Vary, and compression() puts `Vary: Accept-Encoding`
//     on the shell -- a stored shell could miss on a later request. Every read
//     passes ignoreVary.
//
// Navigations are all keyed to '/' because server.js serves index.html for
// every app route, so there is exactly one shell whatever URL the launch used
// (/?xero=connected, a deep link, anything).
//
// /api, /auth, /login, /healthz, /debt and the client-facing /q/ + /quote/
// pages are never intercepted: the app's own localStorage-first storage layer
// already handles offline data, login needs the server by definition, and the
// client approval pages belong to someone else's phone.

var CACHE = 'nh-estimator-v2';
var SHELL = '/';
var CORE = ['/', '/logo.png', '/apple-touch-icon.png', '/manifest.json', '/icon-192.png', '/icon-512.png'];

// Google Fonts. Cross-origin, so the old worker ignored them entirely and
// every launch went to the network for them -- and until this release the
// stylesheet was RENDER-BLOCKING in index.html, so a hanging font request
// held up first paint on its own, service worker or no service worker. The
// <link> is non-blocking now; caching them here is what makes an offline
// launch look like the app instead of Times New Roman.
var FONT_ORIGINS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];

// How long to let the network have before falling back to a cached copy.
// Generous enough that a slow-but-working connection still wins (the shell is
// no-cache with an ETag, so an unchanged deploy is a ~300-byte 304), short
// enough that a dead spot doesn't read as a broken app.
var NET_TIMEOUT_MS = 4000;

// Paths the worker keeps its hands off entirely.
function bypassed(pathname) {
  return pathname.indexOf('/api') === 0
      || pathname.indexOf('/auth') === 0
      || pathname.indexOf('/debt') === 0
      || pathname.indexOf('/login') === 0
      || pathname.indexOf('/healthz') === 0
      || pathname === '/q' || pathname.indexOf('/q/') === 0
      || pathname === '/quote' || pathname.indexOf('/quote/') === 0;
}

// res.redirected guards the login gate: a logged-out navigation to '/'
// resolves to the login page, which must never be stored as the shell.
function cacheable(res) {
  return !!(res && res.ok && !res.redirected);
}

function putInCache(key, res) {
  return caches.open(CACHE)
    .then(function (c) { return c.put(key, res); })
    .catch(function () { /* quota, private mode -- never fail the response */ });
}

// Read our cache first, then any cache an older version left behind, so an
// upgrade that installs in a dead spot can still find the previous shell.
// ignoreVary because of compression()'s Vary: Accept-Encoding (see header).
function readCache(key) {
  return caches.open(CACHE)
    .then(function (c) { return c.match(key, { ignoreVary: true }); })
    .then(function (hit) { return hit || caches.match(key, { ignoreVary: true }); })
    .catch(function () { return undefined; });
}

// Last resort: the app has never been opened online on this phone, so there
// is no shell to serve. Say so in words rather than handing over the browser's
// "you're not connected" page, which reads as the app being broken.
var OFFLINE_HTML = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width,initial-scale=1">'
  + '<title>NH Estimator — offline</title><style>'
  + 'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;'
  + 'background:#f4f6f9;color:#1a1f2e;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:24px}'
  + '@media(prefers-color-scheme:dark){body{background:#10141a;color:#e9ecf2}}'
  + '.w{max-width:22em;text-align:center}h1{font-size:19px;margin:0 0 10px}'
  + 'p{font-size:15px;line-height:1.5;margin:0 0 18px;opacity:.8}'
  + 'button{font:inherit;font-weight:700;padding:14px 22px;border:none;border-radius:16px;background:#1a5276;color:#fff}'
  + '</style></head><body><div class="w"><h1>No connection</h1>'
  + '<p>This phone hasn\'t saved a copy of the app for offline use yet. Open it once '
  + 'somewhere with signal and it will launch without one from then on.</p>'
  + '<button onclick="location.reload()">Try again</button></div></body></html>';

function offlineFallback(req) {
  if (req.mode !== 'navigate') return Response.error();
  return readCache(SHELL).then(function (shell) {
    return shell || new Response(OFFLINE_HTML, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  });
}

self.addEventListener('install', function (e) {
  e.waitUntil(
    // Deliberately not cache.addAll: it rejects the whole batch if any single
    // entry fails, and a precache that is all-or-nothing is one flaky request
    // away from no offline app at all. cache:'reload' so the precache is the
    // live copy, not whatever the HTTP cache happens to be holding.
    Promise.all(CORE.map(function (url) {
      return fetch(new Request(url, { cache: 'reload', credentials: 'same-origin' }))
        .then(function (res) { if (cacheable(res)) return putInCache(url, res); })
        .catch(function () { /* offline or logged out -- the fetch handler will fill it in */ });
    })).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    // Deliberately OUR cache, not readCache -- readCache falls back to older
    // caches on purpose, which is exactly the copy being asked about here.
    caches.open(CACHE).then(function (c) {
      return c.match(SHELL, { ignoreVary: true });
    }).then(function (shell) {
      // Only bin the previous version's cache once this one actually holds a
      // shell. Otherwise an upgrade that installed with no usable connection
      // would delete the only offline copy the phone had -- and the fetch
      // handler's readCache is happy to keep serving from the old one until
      // the next launch in signal fills this one.
      if (!shell) return;
      return caches.keys().then(function (keys) {
        return Promise.all(keys.filter(function (k) {
          return k !== CACHE && k.indexOf('nh-estimator-') === 0;
        }).map(function (k) { return caches.delete(k); }));
      });
    }).then(function () { return self.clients.claim(); })
  );
});

// Network-first, but only up to NET_TIMEOUT_MS when we hold a fallback.
function networkFirst(e, key) {
  var req = e.request;

  var network = fetch(req).then(function (res) {
    if (cacheable(res)) e.waitUntil(putInCache(key, res.clone()));
    return res;
  });
  // Keep the request alive past respondWith so a reply that lands after the
  // deadline still refreshes the cache for the next launch.
  e.waitUntil(network.catch(function () {}));

  return readCache(key).then(function (cached) {
    if (!cached) {
      // Nothing to fall back to for this one: the network is all there is, so
      // wait it out rather than failing early.
      return network.catch(function () { return offlineFallback(req); });
    }
    return new Promise(function (resolve) {
      var timer = setTimeout(function () { resolve(cached); }, NET_TIMEOUT_MS);
      network.then(
        function (res) { clearTimeout(timer); resolve(res); },
        function () { clearTimeout(timer); resolve(cached); }
      );
    });
  });
}

// Fonts are cache-first: they never change under a given URL, and waiting on
// a third party is the last thing a launch in a dead spot needs.
function fontFirst(e) {
  var req = e.request;
  return readCache(req).then(function (cached) {
    var network = fetch(req).then(function (res) {
      // The <link> and its @font-face requests are no-cors, so what comes back
      // is opaque: status 0, ok false, by design. Store those too -- an opaque
      // response replays perfectly well, it just can't be inspected.
      if (res && (res.ok || res.type === 'opaque')) e.waitUntil(putInCache(req, res.clone()));
      return res;
    });
    if (cached) { e.waitUntil(network.catch(function () {})); return cached; }
    return network.catch(function () {
      return new Response('', { status: 504, statusText: 'Offline' });
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }

  if (FONT_ORIGINS.indexOf(url.origin) !== -1) { e.respondWith(fontFirst(e)); return; }
  if (url.origin !== location.origin) return;
  if (bypassed(url.pathname)) return;

  // One shell for every app route (server.js answers app.get('*') with
  // index.html), so a launch at /?xero=connected falls back to the same
  // cached copy a launch at / does.
  e.respondWith(networkFirst(e, req.mode === 'navigate' ? SHELL : req));
});
