const webpush = require('web-push');
const db = require('../db');

// Web Push transport for the debt app -- standard Push API delivery to the
// installed PWA itself (iOS 16.4+ home-screen web apps, plus any desktop/
// Android browser), running alongside the ntfy transport in debtNotify.js.
//
// Zero-config by design: the VAPID keypair is generated on first use and
// persisted in debt_push_vapid, so no Render env vars are needed (env
// VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT still win if set, for
// key rotation or moving hosts). Tables are created lazily here too --
// db/setup.sql documents them, but it is NOT run automatically on deploy
// (see FEATURES.md's material_actuals gotcha), and this feature shouldn't
// 500 on the live database waiting for a manual psql run.

let readyPromise = null;

async function init() {
  await db.query(`CREATE TABLE IF NOT EXISTS debt_push_vapid (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    public_key TEXT NOT NULL,
    private_key TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS debt_push_subscriptions (
    id SERIAL PRIMARY KEY,
    endpoint TEXT UNIQUE NOT NULL,
    subscription JSONB NOT NULL,
    user_agent TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`);

  let publicKey = process.env.VAPID_PUBLIC_KEY;
  let privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    const existing = await db.query('SELECT public_key, private_key FROM debt_push_vapid WHERE id = 1');
    if (existing.rows[0]) {
      publicKey = existing.rows[0].public_key;
      privateKey = existing.rows[0].private_key;
    } else {
      const keys = webpush.generateVAPIDKeys();
      // ON CONFLICT + re-read instead of trusting our generated pair: two
      // server instances starting at once must converge on ONE keypair, or
      // subscriptions minted against the loser's public key can never be
      // pushed to.
      await db.query(
        'INSERT INTO debt_push_vapid (id, public_key, private_key) VALUES (1, $1, $2) ON CONFLICT (id) DO NOTHING',
        [keys.publicKey, keys.privateKey]
      );
      const fresh = await db.query('SELECT public_key, private_key FROM debt_push_vapid WHERE id = 1');
      publicKey = fresh.rows[0].public_key;
      privateKey = fresh.rows[0].private_key;
    }
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:nickyhawkins@gmail.com', publicKey, privateKey);
  return { publicKey };
}

function ready() {
  if (!readyPromise) {
    // Reset on failure so a transient DB blip doesn't poison every later
    // call with the same cached rejection.
    readyPromise = init().catch(err => { readyPromise = null; throw err; });
  }
  return readyPromise;
}

async function getPublicKey() {
  return (await ready()).publicKey;
}

// Upsert by endpoint: re-subscribing from the same device (same endpoint,
// possibly fresh keys after iOS rotates them) updates in place rather than
// accumulating dead rows.
async function saveSubscription(subscription, userAgent) {
  if (!subscription || typeof subscription.endpoint !== 'string' || !subscription.endpoint ||
      !subscription.keys || !subscription.keys.p256dh || !subscription.keys.auth) {
    const err = new Error('invalid subscription');
    err.badRequest = true;
    throw err;
  }
  await ready();
  await db.query(
    `INSERT INTO debt_push_subscriptions (endpoint, subscription, user_agent) VALUES ($1, $2, $3)
     ON CONFLICT (endpoint) DO UPDATE SET subscription = EXCLUDED.subscription, user_agent = EXCLUDED.user_agent`,
    [subscription.endpoint, JSON.stringify(subscription), userAgent || null]
  );
}

async function removeSubscription(endpoint) {
  if (!endpoint) return;
  await ready();
  await db.query('DELETE FROM debt_push_subscriptions WHERE endpoint = $1', [endpoint]);
}

async function countSubscriptions() {
  await ready();
  const result = await db.query('SELECT COUNT(*)::int AS n FROM debt_push_subscriptions');
  return result.rows[0].n;
}

// Fans one payload out to every stored device. 404/410 from the push
// service means the subscription is dead (app removed from the home screen,
// or iOS expired it) -- those rows are deleted rather than retried forever.
// Other failures are logged and skipped so one bad endpoint can't block the
// rest of the morning's notifications.
async function sendToAll(payload) {
  await ready();
  const subs = await db.query('SELECT id, subscription FROM debt_push_subscriptions');
  const body = JSON.stringify(payload);
  let sent = 0;
  for (const row of subs.rows) {
    try {
      await webpush.sendNotification(row.subscription, body);
      sent++;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await db.query('DELETE FROM debt_push_subscriptions WHERE id = $1', [row.id]);
      } else {
        console.error('Web push send failed', err.statusCode || err.message);
      }
    }
  }
  return { sent, total: subs.rows.length };
}

module.exports = { getPublicKey, saveSubscription, removeSubscription, countSubscriptions, sendToAll };
