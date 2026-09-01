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

// Gzip responses — index.html is ~450KB of highly compressible text and is
// served on every route, so this is the single biggest transfer saving.
app.use(compression());

// Unauthenticated liveness probe for Render's health checks (render.yaml).
// Deliberately ahead of the login gate and content-free: it answers "is the
// process up", nothing else.
app.get('/healthz', (req, res) => res.type('text').send('ok'));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
