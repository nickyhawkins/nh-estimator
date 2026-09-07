// App-level login gate (MULTI_INSTANCE_PILOT_SPEC.md WS1). One password per
// instance: an instance IS one user's business, so this is deliberately a
// single shared password rather than user accounts. If the pilot ever grows
// into multi-tenant SaaS, this file is replaced wholesale, not extended.
//
// Where the password lives — and the three states an instance can be in — is
// lib/appAuth.js. This file is the routing and the abuse throttle only.
//
// The session (Postgres-backed, 30-day rolling cookie) makes it a
// once-per-phone login rather than a daily one.
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const db = require('../db');
const appAuth = require('../lib/appAuth');

const router = express.Router();

const gateEnabled = () => appAuth.gateEnabled();

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
// - /robots.txt has to be readable by a crawler, which by definition has no
//   session. Behind the gate it would 401, and a crawler that cannot read the
//   file telling it to stay out is a crawler that indexes the login page.
const OPEN_PATHS = new Set([
  '/login', '/login.html', '/auth/login', '/auth/logout',
  '/api/schedule.ics', '/api/branding',
  '/logo.png', '/manifest.json', '/sw.js', '/robots.txt',
  '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png',
]);

// The setup link is open by necessity — its whole job is to let someone in
// who has no password yet. The token in the path is the credential, checked
// against the database on both the GET and the POST; an absent or expired one
// renders a dead-end page and sets nothing.
//
// MATCHED BY REGEX, NOT startsWith. A prefix test opens every path that
// merely BEGINS with /claim/, and req.path is not normalised — so
// `/claim/../api/jobs` passed the gate and fell through to the SPA shell on
// an instance that was supposed to answer with a sign-in screen and nothing
// else. These patterns allow exactly one more segment, in the base64url
// alphabet the tokens are generated from, which has no `.`, `/` or `%` in it.
const CLAIM_PAGE = /^\/claim\/[A-Za-z0-9_-]+$/;
const CLAIM_STATUS = /^\/auth\/claim-status\/[A-Za-z0-9_-]+$/;

function isOpenPath(p) {
  return OPEN_PATHS.has(p)
    || p === '/auth/state'
    || p === '/auth/claim'
    || CLAIM_STATUS.test(p)
    || CLAIM_PAGE.test(p);
}

function requireAuth(req, res, next) {
  if (!gateEnabled() || req.session.appAuthed || isOpenPath(req.path)) return next();
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

// Lets the login page say "this app hasn't been set up yet — open your setup
// link" instead of asking for a password that does not exist. Open by the
// same reasoning as /api/branding: it reveals only whether setup has happened.
router.get('/auth/state', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  // `gated` says only whether this instance asks for a password at all —
  // which anyone can discover by loading the app and being redirected. It
  // lets Settings show a change-password card on a gated instance and hide
  // it on an ungated one, rather than offering to change nothing.
  res.json({ awaitingClaim: appAuth.awaitingClaim(), gated: appAuth.gateEnabled() });
});

router.post('/auth/login', (req, res) => {
  if (!gateEnabled()) return res.redirect('/');
  const ip = req.ip;
  if (throttled(ip)) return res.redirect('/login?error=locked');
  if (!appAuth.passwordMatches(req.body.password)) {
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

// ── Setup link ─────────────────────────────────────────────────────────────
//
// The page a new customer is sent. It asks for their business name and a
// password of their choosing, and those two answers are the whole of what the
// owner used to do for them by hand: generate a password, send it, then talk
// them through Settings → Business before they quote anyone. Getting the name
// in here also closes the trap where an unconfigured instance puts the app
// author's branding on a customer's client-facing quote.
router.get('/claim/:token', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, '..', 'public', 'claim.html'));
});

router.post('/auth/claim', async (req, res) => {
  const ip = req.ip;
  // Same throttle as the login form: the token is long and random, but a
  // setup link is still a credential in a URL and deserves the same rate cap.
  if (throttled(ip)) return res.status(429).json({ error: 'Too many attempts — wait 15 minutes and try again.' });

  const { token, password, businessName } = req.body || {};
  try {
    const result = await appAuth.redeemClaim(token, password);
    if (!result.ok) {
      if (result.reason === 'invalid') {
        recordFail(ip);
        return res.status(400).json({ error: 'invalid-link' });
      }
      return res.status(400).json({ error: result.reason });
    }
    fails.delete(ip);

    // Merge rather than replace: a reset link issued against an instance that
    // has been in use for months must not blank its settings.
    const name = String(businessName || '').trim();
    if (name) {
      await db.query(
        `UPDATE settings SET data = data || jsonb_build_object('businessName', $1::text),
                             updated_at = NOW()
          WHERE id = 1`,
        [name]
      );
    }

    // Sign them straight in — they have just proved they hold the link and
    // chosen the password; a login form here would only ask them to retype it.
    req.session.regenerate((err) => {
      if (err) {
        console.error('Claim succeeded but the session store rejected the write', err);
        // The password IS set, so pointing them at the login page is honest
        // and recoverable, unlike failing the whole claim.
        return res.json({ ok: true, signedIn: false });
      }
      req.session.appAuthed = true;
      res.json({ ok: true, signedIn: true });
    });
  } catch (err) {
    console.error('Claim failed', err);
    res.status(500).json({ error: 'Something went wrong setting up this app.' });
  }
});

// Whether a setup link is still good, so the page can show a dead-end message
// instead of a password form it will refuse to accept.
router.get('/auth/claim-status/:token', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    res.json({ valid: await appAuth.claimTokenValid(req.params.token) });
  } catch (err) {
    res.status(500).json({ valid: false });
  }
});

// ── Changing the password from inside the app ──────────────────────────────
//
// Behind the gate, so a signed-in session is required, and the current
// password is required on top of that: a phone left unlocked on a worktop
// should not be enough to lock its owner out of their own instance.
router.post('/auth/change-password', async (req, res) => {
  if (!req.session.appAuthed && gateEnabled()) {
    return res.status(401).json({ error: 'login required' });
  }
  const { currentPassword, newPassword } = req.body || {};
  if (!appAuth.passwordMatches(currentPassword)) {
    return res.status(400).json({ error: 'That current password is not right.' });
  }
  const problem = appAuth.passwordProblem(newPassword);
  if (problem) return res.status(400).json({ error: problem });
  try {
    await appAuth.setPassword(newPassword);
    req.session.appAuthed = true;
    res.json({ ok: true });
  } catch (err) {
    console.error('Password change failed', err);
    res.status(500).json({ error: 'Could not save the new password.' });
  }
});

module.exports = { router, requireAuth };
