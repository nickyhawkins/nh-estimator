// App-level login gate (MULTI_INSTANCE_PILOT_SPEC.md WS1). One password per
// instance via APP_PASSWORD. Unset means no gate at all — identical to the
// app's historical behaviour — so an existing instance is untouched until
// its owner opts in.
//
// This is deliberately a single shared password, not user accounts: an
// instance IS one user's business, and the session (Postgres-backed,
// 30-day cookie) makes it a once-per-phone login. If the pilot ever grows
// into multi-tenant SaaS, this file is replaced wholesale, not extended.
const express = require('express');
const crypto = require('crypto');
const path = require('path');

const router = express.Router();

function gateEnabled() { return !!process.env.APP_PASSWORD; }

// Constant-time compare via digests — timingSafeEqual demands equal-length
// inputs, and hashing both sides gives that without leaking length.
function passwordMatches(attempt) {
  const a = crypto.createHash('sha256').update(String(attempt || '')).digest();
  const b = crypto.createHash('sha256').update(process.env.APP_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

// Failed-attempt throttle, in memory. Single-process app (one Render
// instance), single legitimate user — a Map by IP is proportionate, and a
// process restart clearing it is acceptable.
const MAX_FAILS = 8;
const LOCKOUT_MS = 15 * 60 * 1000;
const fails = new Map(); // ip -> { count, lockedUntil }

function throttled(ip) {
  const f = fails.get(ip);
  return !!(f && f.lockedUntil && f.lockedUntil > Date.now());
}
function recordFail(ip) {
  const f = fails.get(ip) || { count: 0, lockedUntil: 0 };
  f.count++;
  if (f.count >= MAX_FAILS) { f.lockedUntil = Date.now() + LOCKOUT_MS; f.count = 0; }
  fails.set(ip, f);
}

// Paths that must work without a session. Kept to exactly what the login
// page and an installed PWA need — everything else sits behind the gate:
// - /api/schedule.ics has its own ?key= auth (phone calendars can't log in)
//   and 404s without a valid key.
// - manifest/icons/sw.js keep an installed-but-logged-out PWA from breaking
//   its install or service-worker update cycle; none of them expose data.
const OPEN_PATHS = new Set([
  '/login', '/login.html', '/auth/login', '/auth/logout',
  '/api/schedule.ics', '/api/branding',
  '/logo.png', '/manifest.json', '/sw.js',
  '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png',
]);

function requireAuth(req, res, next) {
  if (!gateEnabled() || req.session.appAuthed || OPEN_PATHS.has(req.path)) return next();
  // Browsers navigating get the login page; everything else (the SPA's
  // fetch calls, curl) gets a 401 the client helpers recognise.
  if (req.method === 'GET' && (req.headers.accept || '').includes('text/html')) {
    return res.redirect('/login');
  }
  return res.status(401).json({ error: 'login required' });
}

router.get('/login', (req, res) => {
  if (!gateEnabled() || req.session.appAuthed) return res.redirect('/');
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});

router.post('/auth/login', (req, res) => {
  if (!gateEnabled()) return res.redirect('/');
  const ip = req.ip;
  if (throttled(ip)) return res.redirect('/login?error=locked');
  if (!passwordMatches(req.body.password)) {
    recordFail(ip);
    return res.redirect('/login?error=1');
  }
  fails.delete(ip);
  // Fresh session id on login — standard fixation hygiene.
  req.session.regenerate((err) => {
    // A store failure here (the session table missing, the database refusing
    // SSL, Postgres down) used to land on ?error=1 — "Wrong password, try
    // again" — which is the most misleading thing it could possibly say: the
    // password was right, and no amount of retyping it will help. It sends
    // whoever is debugging it hunting for a typo instead of a broken store.
    // Its own message now, and the real reason goes to the server log.
    if (err) {
      console.error('Login failed: the session store rejected the write', err);
      return res.redirect('/login?error=store');
    }
    req.session.appAuthed = true;
    res.redirect('/');
  });
});

router.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = { router, requireAuth };
