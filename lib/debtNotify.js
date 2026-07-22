const axios = require('axios');
const db = require('../db');
const debtPush = require('./debtPush');

// Push notifications for the debt app (see Debt Management App/
// debt-app-roadmap.md, Feature 4/5), over two transports:
//  - Web Push to the installed PWA itself (lib/debtPush.js) -- delivers to
//    every device that enabled push in the app's Notifications settings.
//  - ntfy.sh, the original transport -- still used whenever NTFY_TOPIC is
//    set, so an existing ntfy setup keeps working unchanged.
// Each send fans out to both; a transport with nothing configured (no
// topic / no subscriptions) is just a no-op, so the cron job in server.js
// can always run.
function ntfyConfigured() {
  return Boolean(process.env.NTFY_TOPIC);
}

async function sendNtfy(body, { title, priority = 'default', tags } = {}) {
  const base = process.env.NTFY_BASE_URL || 'https://ntfy.sh';
  await axios.post(`${base}/${process.env.NTFY_TOPIC}`, body, {
    headers: {
      'Content-Type': 'text/plain',
      ...(title ? { Title: title } : {}),
      Priority: priority,
      ...(tags ? { Tags: tags } : {})
    }
  });
}

// One message, every transport. Per-transport failures are caught and
// logged here so an ntfy outage can't stop web push (or vice versa) --
// callers treat delivery as best-effort, same as before.
async function broadcast(body, { title, priority = 'default', tags, tag } = {}) {
  if (ntfyConfigured()) {
    try {
      await sendNtfy(body, { title, priority, tags });
    } catch (err) {
      console.error('ntfy send failed', err.message);
    }
  }
  try {
    // `tag` collapses repeat notifications: the daily cron re-fires until a
    // debt is ticked off, and a stable tag per debt means day 3's reminder
    // replaces day 2's on the lock screen instead of stacking beside it.
    await debtPush.sendToAll({ title, body, tag, url: '/debt' });
  } catch (err) {
    console.error('Web push broadcast failed', err.message);
  }
}

// Notifies for any debt with a due date within notify_days_before days that
// hasn't been ticked off this cycle yet. `due` is a day-of-month, so "days
// until due" wraps modulo ~31 the same way the roadmap spec'd it.
async function sendDueNotifications() {
  const settingsResult = await db.query('SELECT * FROM debt_plan_settings WHERE id = 1');
  const settings = settingsResult.rows[0];
  if (!settings || !settings.notifications_enabled) return;

  const [debtsResult, cashflowResult] = await Promise.all([
    db.query('SELECT * FROM debt_plan_debts ORDER BY id'),
    db.query('SELECT paid_this_cycle FROM debt_plan_cashflow WHERE id = 1')
  ]);
  const paidIds = cashflowResult.rows[0]?.paid_this_cycle || [];
  const today = new Date().getDate();
  const daysAhead = settings.notify_days_before || 3;

  for (const debt of debtsResult.rows) {
    if (!debt.due || Number(debt.min) <= 0) continue;
    if (paidIds.includes(debt.id)) continue;

    const daysUntilDue = ((debt.due - today + 31) % 31);
    if (daysUntilDue > daysAhead) continue;

    const urgency = daysUntilDue === 0 ? 'DUE TODAY' : `due in ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'}`;
    const body = `${debt.name} — £${Number(debt.min).toFixed(2)} ${urgency}`;
    const priority = daysUntilDue <= 1 ? 'high' : 'default';

    await broadcast(body, {
      title: 'Debt Plan — payment due',
      priority,
      tags: daysUntilDue === 0 ? 'warning' : 'calendar',
      tag: `debt-due-${debt.id}`
    });
  }
}

// Nudges once a cycle has been open 28+ days without being reset, so
// balances don't drift stale. Mirrors GET /debt/api/cycle-status, which the
// frontend polls for the in-app banner version of the same check.
async function checkCycleReset() {
  const settingsResult = await db.query('SELECT cycle_started_at, notifications_enabled FROM debt_plan_settings WHERE id = 1');
  const settings = settingsResult.rows[0];
  if (!settings || !settings.notifications_enabled || !settings.cycle_started_at) return;

  const daysSinceStart = Math.floor((Date.now() - new Date(settings.cycle_started_at).getTime()) / (1000 * 60 * 60 * 24));
  if (daysSinceStart < 28) return;

  await broadcast(
    `Your payment cycle is ${daysSinceStart} days old — time to start a new one and sync your balances.`,
    { title: 'Debt Plan — new cycle due', priority: 'default', tags: 'recycle', tag: 'debt-cycle-reset' }
  );
}

module.exports = { ntfyConfigured, sendNtfy, broadcast, sendDueNotifications, checkCycleReset };
