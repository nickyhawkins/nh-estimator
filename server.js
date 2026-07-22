require('dotenv').config();
const express = require('express');
const compression = require('compression');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');
const cron = require('node-cron');
const db = require('./db');
const { sendDueNotifications, checkCycleReset, ntfyConfigured } = require('./lib/debtNotify');

const app = express();
const PORT = process.env.PORT || 3000;

// Gzip responses — index.html is ~450KB of highly compressible text and is
// served on every route, so this is the single biggest transfer saving.
app.use(compression());

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
app.use('/debt', require('./routes/debt'));

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

// Start server
app.listen(PORT, () => {
  console.log(`NH Estimator running on port ${PORT}`);
});
