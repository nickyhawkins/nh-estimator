#!/usr/bin/env node
'use strict';

// ── Regression test: the app still OPENS with no signal ────────────────────
//
// The bug this locks down: a phone in a dead spot on site is not cleanly
// offline. It has a bar of signal and no throughput, so a request neither
// succeeds nor fails -- it HANGS. The service worker was network-first with
// its cache served only from .catch(), so in that state the fallback never
// ran and the launch sat on a white screen. Airplane mode, where fetch
// rejects instantly, worked fine, which is exactly why it only failed
// sometimes and was so hard to pin down.
//
// So the properties held here are about a network that never answers, as
// much as one that refuses:
//
//   1. A hanging network must not hang the launch. Past the deadline the
//      cached shell is served, and the late reply still refreshes the cache.
//   2. A precache must not be all-or-nothing. One unreachable icon used to
//      abandon the whole batch (cache.addAll is atomic), leaving no offline
//      copy at all.
//   3. The login page must never be stored as the app shell -- a logged-out
//      launch redirects to it, and caching that would pin the phone to a
//      login screen it then can't get past offline.
//   4. Every app route falls back to the one shell, since server.js answers
//      app.get('*') with index.html.
//   5. The paths that must stay live -- /api, /auth, /login, /q/ -- are never
//      intercepted, and the previous version's cache is not deleted until
//      this one actually holds a shell.
//
// Pure node against the real public/sw.js: the file is evaluated inside a
// stub ServiceWorkerGlobalScope with an in-memory CacheStorage, so the code
// under test is the code that ships. No browser, no server, no database.
//
// USAGE
//   node scripts/test-offline-shell.js
//   npm run test:offline

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SW_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');

const pass = [], fail = [];
const check = (name, ok, detail) =>
  (ok ? pass : fail).push(name + (!ok && detail !== undefined ? '\n      ' + detail : ''));
const eq = (name, got, want) =>
  check(name, got === want, 'got:  ' + JSON.stringify(got) + '\n      want: ' + JSON.stringify(want));

// ── Minimal Fetch/Cache stubs ──────────────────────────────────────────────
// Only the surface sw.js touches. Bodies are strings; a Response is single
// use in the browser, so clone() hands back a fresh object and the harness
// asserts nothing reads a consumed one.
class Response {
  constructor(body, init) {
    init = init || {};
    this.body = body == null ? '' : String(body);
    this.status = init.status === undefined ? 200 : init.status;
    this.ok = this.status >= 200 && this.status < 300;
    this.redirected = !!init.redirected;
    this.type = init.type || 'basic';
    this.headers = init.headers || {};
    this.tag = init.tag || null;   // harness-only: which copy came back
  }
  clone() { return new Response(this.body, this); }
  static error() { return new Response('', { status: 0, type: 'error' }); }
}
class Request {
  constructor(input, init) {
    init = init || {};
    // Relative like the browser's: resolved against the worker's own origin.
    this.url = new URL(typeof input === 'string' ? input : input.url, 'https://app.test').href;
    this.method = init.method || 'GET';
    this.mode = init.mode || 'no-cors';
    this.cache = init.cache;
    this.credentials = init.credentials;
  }
}
const keyOf = (k) => (typeof k === 'string' ? new URL(k, 'https://app.test').href : k.url);

class Cache {
  constructor() { this.store = new Map(); }
  async put(k, v) { this.store.set(keyOf(k), v); }
  async match(k) { const hit = this.store.get(keyOf(k)); return hit ? hit.clone() : undefined; }
  has(k) { return this.store.has(keyOf(k)); }
}
class CacheStorage {
  constructor() { this.caches = new Map(); }
  async open(name) {
    if (!this.caches.has(name)) this.caches.set(name, new Cache());
    return this.caches.get(name);
  }
  async keys() { return [...this.caches.keys()]; }
  async delete(name) { return this.caches.delete(name); }
  async match(k) {
    for (const c of this.caches.values()) { const hit = await c.match(k); if (hit) return hit; }
    return undefined;
  }
}

// ── Harness ────────────────────────────────────────────────────────────────
// Loads sw.js fresh, with a routing function standing in for the network.
// A route may return a Response, throw (a dropped connection), or return the
// string 'HANG' (a dead spot: a promise that never settles).
function loadSW(route) {
  const listeners = {};
  const cacheStorage = new CacheStorage();
  const netLog = [];
  const sandbox = {
    self: {
      addEventListener: (t, fn) => { listeners[t] = fn; },
      skipWaiting: () => Promise.resolve(),
      clients: { claim: () => Promise.resolve() },
    },
    caches: cacheStorage,
    location: { origin: 'https://app.test' },
    fetch: (input) => {
      const req = input instanceof Request ? input : new Request(input);
      netLog.push(req.url);
      const r = route(req);
      if (r === 'HANG') return new Promise(() => {});
      if (r instanceof Error) return Promise.reject(r);
      return Promise.resolve(r);
    },
    Response, Request, URL,
    setTimeout, clearTimeout, Promise, console,
  };
  sandbox.self.addEventListener = sandbox.self.addEventListener.bind(sandbox.self);
  vm.createContext(sandbox);
  vm.runInContext(SW_SRC, sandbox);

  // Collects the waitUntil/respondWith promises the way the browser does, so
  // a test can await the cache writes the worker deferred.
  const mkEvent = (extra) => {
    const held = [];
    return Object.assign({
      waitUntil: (p) => held.push(Promise.resolve(p).catch(() => {})),
      _settle: () => Promise.all(held),
    }, extra);
  };

  return {
    cacheStorage, netLog, listeners,
    async install() {
      const e = mkEvent({});
      listeners.install(e);
      await e._settle();
    },
    async activate() {
      const e = mkEvent({});
      listeners.activate(e);
      await e._settle();
    },
    // Returns { handled, res, settle } -- handled false means the worker
    // passed the request through to the browser untouched.
    request(url, init) {
      const req = new Request(url, init);
      let answered = null;
      const e = mkEvent({ request: req, respondWith: (p) => { answered = p; } });
      listeners.fetch(e);
      return { handled: answered !== null, res: answered, settle: () => e._settle() };
    },
  };
}

const SHELL_HTML = '<!doctype html><title>NH Estimator</title>';
const online = (opts) => (req) => {
  const p = new URL(req.url).pathname;
  if (new URL(req.url).origin !== 'https://app.test') return new Response('@font-face{}', { type: 'opaque', status: 0, tag: 'font' });
  if (p === '/') return new Response(SHELL_HTML, { tag: (opts && opts.shellTag) || 'shell' });
  if ((opts && opts.missing || []).includes(p)) return new Error('net down');
  return new Response('asset:' + p, { tag: p });
};

(async () => {
  // ── 1. A network that HANGS still opens the app ──────────────────────────
  {
    const sw = loadSW(online());
    await sw.install();
    await sw.activate();
    // Back on site, no throughput: every request hangs rather than failing.
    const dead = loadSW(() => 'HANG');
    dead.cacheStorage.caches = sw.cacheStorage.caches;   // same phone, same cache
    const r = dead.request('/', { mode: 'navigate' });
    const raced = await Promise.race([
      r.res.then((x) => x.body),
      new Promise((res) => setTimeout(() => res('STILL HANGING'), 6000)),
    ]);
    eq('a hanging network serves the cached shell rather than hanging the launch', raced, SHELL_HTML);
  }

  // ── 2. A network that REFUSES serves the shell too, and instantly ────────
  {
    const sw = loadSW(online());
    await sw.install();
    const t0 = Date.now();
    const r = sw.request('/', { mode: 'navigate' });
    // Re-route to a dead connection by reloading against the same cache.
    const off = loadSW(() => new Error('Failed to fetch'));
    off.cacheStorage.caches = sw.cacheStorage.caches;
    await r.res;
    const r2 = off.request('/', { mode: 'navigate' });
    const body = (await r2.res).body;
    eq('a dropped connection serves the cached shell', body, SHELL_HTML);
    check('and does not wait out the deadline to do it', Date.now() - t0 < 3000, (Date.now() - t0) + 'ms');
  }

  // ── 3. Precache is not all-or-nothing ────────────────────────────────────
  {
    const sw = loadSW(online({ missing: ['/icon-512.png'] }));
    await sw.install();
    const c = await sw.cacheStorage.open('nh-estimator-v2');
    check('one unreachable precache entry does not abandon the rest', c.has('/'), [...c.store.keys()].join(', '));
    check('and the entry that failed is simply absent', !c.has('/icon-512.png'));
    const r = sw.request('/', { mode: 'navigate' });
    check('so the app still opens offline after a partial precache', r.handled);
  }

  // ── 4. The login redirect is never stored as the shell ───────────────────
  {
    // Logged out: '/' resolves to the login page, and the response says so.
    const loggedOut = (req) => new URL(req.url).pathname === '/'
      ? new Response('<title>Sign in</title>', { redirected: true, tag: 'login' })
      : new Response('asset', {});
    const sw = loadSW(loggedOut);
    await sw.install();
    const c = await sw.cacheStorage.open('nh-estimator-v2');
    check('a logged-out precache does not store the login page as the shell', !c.has('/'));

    const sw2 = loadSW(loggedOut);
    const r = sw2.request('/', { mode: 'navigate' });
    await r.res; await r.settle();
    const c2 = await sw2.cacheStorage.open('nh-estimator-v2');
    check('nor does a logged-out navigation through the fetch handler', !c2.has('/'));
  }

  // ── 5. One shell answers every app route ─────────────────────────────────
  {
    const sw = loadSW(online());
    await sw.install();
    const off = loadSW(() => new Error('Failed to fetch'));
    off.cacheStorage.caches = sw.cacheStorage.caches;
    for (const url of ['/?xero=connected', '/#measure', '/anything']) {
      const r = off.request(url, { mode: 'navigate' });
      eq('offline, ' + url + ' falls back to the cached shell', (await r.res).body, SHELL_HTML);
    }
  }

  // ── 6. Never intercepted ─────────────────────────────────────────────────
  {
    const sw = loadSW(online());
    await sw.install();
    for (const p of ['/api/rooms?job_id=1', '/auth/contacts', '/login', '/login?error=1',
                     '/healthz', '/debt', '/q/abc123', '/quote/j1/tok']) {
      check(p + ' is passed straight through to the network', !sw.request(p).handled);
    }
    check('a POST is passed through', !sw.request('/api/rooms', { method: 'POST' }).handled);
    check('a navigation to an app route IS handled', sw.request('/', { mode: 'navigate' }).handled);
  }

  // ── 7. A late reply still refreshes the cache ────────────────────────────
  {
    const sw = loadSW(online({ shellTag: 'old' }));
    await sw.install();
    const fresh = loadSW(online({ shellTag: 'new' }));
    fresh.cacheStorage.caches = sw.cacheStorage.caches;
    const r = fresh.request('/', { mode: 'navigate' });
    await r.res;
    await r.settle();
    const c = await fresh.cacheStorage.open('nh-estimator-v2');
    eq('an online launch refreshes the cached shell for the next one',
      (await c.match('/')).tag, 'new');
  }

  // ── 8. The old cache survives an upgrade that installs with no signal ────
  {
    const sw = loadSW(online());
    await sw.install();
    // Pretend the shipped cache name is a previous version's.
    const old = sw.cacheStorage.caches.get('nh-estimator-v2');
    sw.cacheStorage.caches.delete('nh-estimator-v2');
    sw.cacheStorage.caches.set('nh-estimator-v1', old);

    const upgrading = loadSW(() => new Error('Failed to fetch'));
    upgrading.cacheStorage.caches = sw.cacheStorage.caches;
    await upgrading.install();     // every precache fetch fails
    await upgrading.activate();
    check('an upgrade with no signal keeps the previous shell rather than binning it',
      upgrading.cacheStorage.caches.has('nh-estimator-v1'),
      [...upgrading.cacheStorage.caches.keys()].join(', '));
    const r = upgrading.request('/', { mode: 'navigate' });
    eq('and the app still opens from it', (await r.res).body, SHELL_HTML);

    // Back in signal: the new cache fills, and only then is the old one binned.
    const back = loadSW(online());
    back.cacheStorage.caches = upgrading.cacheStorage.caches;
    await back.install();
    await back.activate();
    check('once the new cache holds a shell the old one is cleaned up',
      !back.cacheStorage.caches.has('nh-estimator-v1'),
      [...back.cacheStorage.caches.keys()].join(', '));
  }

  // ── 9. Fonts come from the cache, so a dead spot doesn't wait on Google ──
  {
    const sw = loadSW(online());
    const r = sw.request('https://fonts.googleapis.com/css2?family=DM+Sans');
    check('the font stylesheet is handled, not left to the network', r.handled);
    await r.res; await r.settle();

    const off = loadSW(() => 'HANG');
    off.cacheStorage.caches = sw.cacheStorage.caches;
    const r2 = off.request('https://fonts.googleapis.com/css2?family=DM+Sans');
    const raced = await Promise.race([
      r2.res.then((x) => x.tag),
      new Promise((res) => setTimeout(() => res('STILL HANGING'), 6000)),
    ]);
    eq('and is served from cache without touching the network', raced, 'font');
    // One background request, issued behind the already-returned response:
    // the refresh that keeps the cached face current, never a wait.
    eq('the refresh happens behind the response, not in front of it', off.netLog.length, 1);
  }

  // ── 10. Nothing cached, no signal: a page in words, not the browser's ────
  {
    const off = loadSW(() => new Error('Failed to fetch'));
    const r = off.request('/', { mode: 'navigate' });
    const res = await r.res;
    check('a first-ever launch with no signal explains itself', /No connection/.test(res.body), res.body.slice(0, 120));
    eq('and answers 200 so the browser renders it', res.status, 200);
  }

  // ── Report ───────────────────────────────────────────────────────────────
  pass.forEach((n) => console.log('  ok   ' + n));
  fail.forEach((n) => console.log('  FAIL ' + n));
  console.log('\n' + pass.length + ' passed, ' + fail.length + ' failed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
