require('dotenv').config();
const express = require('express');
const compression = require('compression');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');
const cron = require('node-cron');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Render terminates TLS at its edge and forwards to this process over plain
// HTTP, with the original scheme in X-Forwarded-Proto. Without this line
// Express believes every request is insecure — and express-session, seeing
// cookie.secure = true (which NODE_ENV=production sets below) against an
// apparently-insecure request, SILENTLY DECLINES TO SEND THE COOKIE.
//
// That is not a subtle degradation, it is a total lockout, and it is the bug
// that kept APP_PASSWORD unusable: the password is accepted, the redirect to
// / is issued, no session cookie ever reaches the browser, requireAuth bounces
// straight back to /login, and round it goes forever. Nothing is logged,
// because from the server's point of view nothing went wrong.
//
// '1' rather than `true`: trust exactly one hop, the platform's own proxy.
// `true` would trust whatever any client puts in X-Forwarded-For, which is the
// header BOTH throttles in this app key off — the failed-password lockout in
// routes/appLogin.js and the abuse throttle in routes/publicQuote.js. Spoofing
// it would let one caller lock out every other, or evade their own lockout.
//
// This also fixes req.ip generally, which until now was Render's proxy address
// for every visitor alike — so those two throttles were counting the whole
// world as a single client.
app.set('trust proxy', 1);

// The bundled personal Debt Management App is opt-in per instance
// (MULTI_INSTANCE_PILOT_SPEC.md WS2): only the owner's own instance sets
// DEBT_APP_ENABLED=true. Default OFF so a customer instance can never
// expose it — routes, static files and the notification cron all key off
// this one flag, and its tables live in db/setup-debt.sql which customer
// databases never run.
const DEBT_APP_ENABLED = process.env.DEBT_APP_ENABLED === 'true';

// NOTHING in this application belongs in a search result — not the app (one
// business's private jobs, prices and clients), not the sign-in page, and
// least of all the client approval pages under /q/, which are reached by an
// unguessable link texted to one person. An indexed one would hand a client's
// prices to anyone who searched the right words.
//
// Set here, before everything, so it covers every response this process can
// make — the login page, the app shell, static files, API replies and any
// route added later without anyone remembering to think about it.
// public/robots.txt is the polite request that a well-behaved crawler reads
// first; this header is what holds when one doesn't, and the <meta> tags on
// login.html and index.html are the third layer for anything that parses HTML
// but ignores headers. routes/publicQuote.js sets the same value again on its
// own responses, which is harmless and keeps that file readable on its own.
app.use((req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  next();
});

// Gzip responses — index.html is ~450KB of highly compressible text and is
// served on every route, so this is the single biggest transfer saving.
app.use(compression());

// Unauthenticated liveness probe for Render's health checks (render.yaml).
// Deliberately ahead of the login gate and content-free: it answers "is the
// process up", nothing else.
app.get('/healthz', (req, res) => res.type('text').send('ok'));

// Body parsing.
//
// NOT the 100kb default, which was too small for two of this app's real
// payloads and had silently broken one of them outright:
//
//   · POST /api/backup/import carries the WHOLE backup file as JSON. The
//     colour library alone is ~80KB of a 100kb budget on EVERY instance (1,221
//     seeded Farrow & Ball / Little Greene entries), before a single job, so
//     import failed on any database with more than a couple of tiny jobs --
//     i.e. all of them. Worse, the failure arrived as body-parser's HTML error
//     page, which the client then tried to JSON.parse, so the user saw a
//     syntax error rather than "too big". Backup is the disaster-recovery
//     path: it has to be able to read back what export just wrote, and the
//     ceiling here should never be the reason a restore fails.
//   · POST /api/quote-snapshots and the bulk collection PUTs (rooms, colours,
//     materials) scale with the SIZE OF THE JOB. A snapshot runs a few KB per
//     room, so a large house lands within a whisker of 100kb -- and the thing
//     that would fail is accepting a quote.
//
// So: a generous ceiling on the import route, mounted ahead of the general
// parser (body-parser skips a request another parser has already read), and
// enough headroom on everything else that the size of a job can't trip it.
app.use('/api/backup/import', express.json({ limit: '64mb' }));
app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: true, limit: '4mb' }));

// Session with PostgreSQL store
// rolling: the 30-day cookie is re-sent on every response, so its expiry
// moves forward with use instead of counting down from the login.
//
// This is what makes the login gate ONCE PER PHONE rather than once a month,
// and that distinction decides whether the gate gets switched on at all.
// Without it, a phone used every day still gets thrown back to the password
// screen thirty days after signing in — which reads as "this app asks for a
// password" and is exactly the friction that keeps APP_PASSWORD unset. An
// unused control protects nothing, and since v2.41.0 there is a real reason
// to want it on: the client-facing approval link (routes/publicQuote.js)
// points at THIS origin, so a client who trims the link back to the domain
// arrives at the app's front door. The gate is what makes that a login
// screen rather than every job and every client's prices.
//
// Safe with saveUninitialized:false — a client reading /q/<token> has no
// session, so nothing is created and no cookie is ever sent to them. Only a
// signed-in device carries one, and only that device's expiry rolls.
app.use(session({
  store: new pgSession({ pool: db.pool, tableName: 'session' }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-this',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days, refreshed on every request
    secure: process.env.NODE_ENV === 'production'
  }
}));

// With the debt app off, every /debt path — the route mounts below AND the
// debt-* files inside express.static (debt.html, debt-sw.js, the manifest
// and icons all share the prefix) — 404s before anything else can answer.
if (!DEBT_APP_ENABLED) {
  app.use((req, res, next) => (req.path.startsWith('/debt') ? res.status(404).end() : next()));
}

// Client-facing variation approval (CLIENT_APPROVAL_SPEC.md). Mounted
// DELIBERATELY AHEAD of the login gate below: the reader is a customer
// holding a link that was texted to them, not a user of this app, and there
// is no account for them to sign into. The token in the URL is the whole
// credential — see routes/publicQuote.js for how it's checked and what the
// page will and won't show. Everything it serves is scoped to one job by
// that token; nothing else on the instance is reachable through it.
app.use(require('./routes/publicQuote'));

// App login gate (MULTI_INSTANCE_PILOT_SPEC.md WS1). Mounted after the
// session (it needs req.session) and before EVERYTHING else that serves
// data — including express.static, which would otherwise hand out
// index.html itself. No APP_PASSWORD env var = no gate.
const { router: loginRouter, requireAuth } = require('./routes/appLogin');
app.use(loginRouter);
app.use(requireAuth);

// Dynamic PWA manifest (WS3 white-labelling): the installed app's name
// follows the instance's business name. Must sit ahead of express.static,
// which would otherwise serve the checked-in manifest.json verbatim.
// The static file stays as the template so icons/colours live in one place.
const manifestTemplate = require('./public/manifest.json');
app.get('/manifest.json', async (req, res) => {
  let name = null;
  try {
    const result = await db.query('SELECT data FROM settings WHERE id = 1');
    name = result.rows[0]?.data?.businessName || null;
  } catch (err) { /* fall back to the stock name — installability beats freshness */ }
  res.setHeader('Cache-Control', 'no-cache');
  res.json({
    ...manifestTemplate,
    name: name || manifestTemplate.name,
    short_name: name || manifestTemplate.short_name,
  });
});

// Static files. Images get a long cache lifetime (they change rarely and the
// filename can be bumped if they ever do); HTML stays no-cache so a deploy
// shows up on the next load — no-cache still allows ETag revalidation, so an
// unchanged index.html is a cheap 304, not a full re-download.
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '30d',
  setHeaders: (res, filePath) => {
    // sw.js must revalidate every load too — a long-cached service worker
    // would pin users to an old app shell long after a deploy.
    if (filePath.endsWith('.html') || filePath.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
  }
}));

// Routes
app.use('/auth', require('./routes/xero'));
app.use('/api', require('./routes/api'));
if (DEBT_APP_ENABLED) app.use('/debt', require('./routes/debt'));

// Serve the app for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Every /api failure answers in JSON, whatever raised it.
//
// Without this, an error thrown BEFORE a route ran -- body-parser rejecting an
// oversized or malformed body is the one that actually bit -- fell through to
// Express's default handler, which sends an HTML stack trace. The client's API
// helpers all read the response as JSON, so the user got a parse error about
// an unexpected '<' instead of the reason. The limits above mean a legitimate
// backup no longer trips this; it is here so that if anything ever does, it
// says so in words.
app.use('/api', (err, req, res, next) => {
  if (res.headersSent) return next(err);
  const tooLarge = err.type === 'entity.too.large' || err.status === 413;
  const badJson = err.type === 'entity.parse.failed';
  if (!tooLarge && !badJson) console.error('Unhandled /api error', err);
  // Say the useful thing for the route that actually failed: naming the
  // backup limit on a room save would send someone looking in the wrong place.
  const isImport = req.path.indexOf('/backup/import') === 0;
  res.status(tooLarge ? 413 : badJson ? 400 : 500).json({
    error: tooLarge
      ? (isImport
          ? 'That backup file is too large to import — it is over the 64MB limit.'
          : 'That request was too large for the server to accept.')
      : badJson
        ? (isImport
            ? 'That file could not be read as a backup — it may be truncated, or not a backup file.'
            : 'That request was not valid JSON.')
        : (err.message || 'Something went wrong on the server.')
  });
});

// Debt app: due-date push notifications + the 28-day cycle-reset nudge
// (see Debt Management App/debt-app-roadmap.md, Feature 4/5), delivered
// over Web Push to the installed PWA and/or ntfy.sh. Always scheduled --
// devices subscribe to Web Push at runtime (rows in
// debt_push_subscriptions), so unlike the old ntfy-only gate there's no
// env var that decides at startup whether notifications can ever fire.
// With no topic AND no subscriptions the morning run is a cheap no-op.
// Timezone pinned so "8am" means 8am UK year-round — the server runs UTC,
// which would otherwise drift the reminders to 9am through BST.
if (DEBT_APP_ENABLED) {
  const { sendDueNotifications, checkCycleReset, ntfyConfigured } = require('./lib/debtNotify');
  const { rollDueCycles, notifyRolled } = require('./lib/debtCycle');
  cron.schedule('0 8 * * *', async () => {
    try {
      // Roll first: a cycle that fell due overnight closes here, and the
      // reminders below then reflect the new cycle rather than the dead one.
      const rolled = await rollDueCycles();
      if (rolled.length) await notifyRolled(rolled);
      await sendDueNotifications();
      await checkCycleReset();
    } catch (err) {
      console.error('Debt app notification cron failed', err);
    }
  }, { timezone: 'Europe/London' });
  if (!ntfyConfigured()) {
    console.log('NTFY_TOPIC not set — debt app notifications will use Web Push subscriptions only');
  }
}

// Start server
app.listen(PORT, () => {
  console.log(`NH Estimator running on port ${PORT}`);
});
