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
app.use(session({
  store: new pgSession({ pool: db.pool, tableName: 'session' }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-this',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    secure: process.env.NODE_ENV === 'production'
  }
}));

// With the debt app off, every /debt path — the route mounts below AND the
// debt-* files inside express.static (debt.html, debt-sw.js, the manifest
// and icons all share the prefix) — 404s before anything else can answer.
if (!DEBT_APP_ENABLED) {
  app.use((req, res, next) => (req.path.startsWith('/debt') ? res.status(404).end() : next()));
}

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
  cron.schedule('0 8 * * *', async () => {
    try {
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
