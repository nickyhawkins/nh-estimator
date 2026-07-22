const express = require('express');
const path = require('path');
const db = require('../db');
const { sendNtfy, ntfyConfigured } = require('../lib/debtNotify');
const debtPush = require('../lib/debtPush');
const router = express.Router();

// Multi-device conflict guard shared by the debts/settings/cashflow write
// endpoints (see debt-app-roadmap.md Feature 6). `currentUpdatedAt` is the
// row's (or MAX-of-rows', for debts) updated_at read fresh just before the
// write; `clientUpdatedAt` is what the client last saw. A stale write loses:
// the caller gets the fresh data back with a 409 instead of overwriting.
function isStale(clientUpdatedAt, currentUpdatedAt) {
  if (!clientUpdatedAt || !currentUpdatedAt) return false;
  return new Date(clientUpdatedAt).getTime() < new Date(currentUpdatedAt).getTime();
}

// Serves the debt app's frontend. Mounted at /debt in server.js, ahead of
// the paint app's catch-all so this route isn't swallowed by it.
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'debt.html'));
});

router.get('/api/state', async (req, res) => {
  try {
    const [debts, settings, cashflow, income] = await Promise.all([
      db.query('SELECT * FROM debt_plan_debts ORDER BY id'),
      db.query('SELECT * FROM debt_plan_settings WHERE id = 1'),
      db.query('SELECT * FROM debt_plan_cashflow WHERE id = 1'),
      db.query('SELECT * FROM debt_plan_income_log ORDER BY id')
    ]);
    const s = settings.rows[0];
    const c = cashflow.rows[0];
    const debtsUpdatedAt = debts.rows.reduce((max, d) => (!max || d.updated_at > max ? d.updated_at : max), null);
    res.json({
      debts: debts.rows.map(d => ({
        id: d.id, name: d.name, balance: Number(d.balance), apr: Number(d.apr),
        min: Number(d.min), arrears: Number(d.arrears), due: d.due,
        account: d.account, note: d.note
      })),
      settings: {
        budget: s.budget, sweepPct: s.sweep_pct, savingsPct: s.savings_pct,
        tightThreshold: s.tight_threshold, lastMilestone: s.last_milestone,
        notifyDaysBefore: s.notify_days_before, notificationsEnabled: s.notifications_enabled
      },
      cashflow: {
        bizPot: Number(c.biz_pot), perPot: Number(c.per_pot),
        savingsPot: Number(c.savings_pot), paidThisCycle: c.paid_this_cycle
      },
      incomeLog: income.rows.map(e => ({
        id: e.id, amount: Number(e.amount), bizAmt: Number(e.biz_amt),
        perAmt: Number(e.per_amt), savedAmt: Number(e.saved_amt), date: e.date
      })),
      meta: {
        debtsUpdatedAt, settingsUpdatedAt: s.updated_at, cashflowUpdatedAt: c.updated_at
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/debts', async (req, res) => {
  const { debts, clientUpdatedAt } = req.body;
  if (!Array.isArray(debts)) return res.status(400).json({ error: 'debts array required' });
  try {
    const current = await db.query('SELECT MAX(updated_at) AS max FROM debt_plan_debts');
    if (isStale(clientUpdatedAt, current.rows[0].max)) {
      const fresh = await db.query('SELECT * FROM debt_plan_debts ORDER BY id');
      return res.status(409).json({
        conflict: true,
        message: 'Updated on another device',
        current: fresh.rows.map(d => ({
          id: d.id, name: d.name, balance: Number(d.balance), apr: Number(d.apr),
          min: Number(d.min), arrears: Number(d.arrears), due: d.due,
          account: d.account, note: d.note
        })),
        updatedAt: current.rows[0].max
      });
    }

    // One statement instead of a per-row loop, and rows whose values are
    // unchanged are skipped entirely so their updated_at doesn't move — an
    // untouched row can no longer make another device's later save look
    // stale (the false-409 path in debt-app-efficiency-review.md finding 2).
    const result = await db.query(
      `UPDATE debt_plan_debts d
          SET name=j.name, balance=j.balance, apr=j.apr, min=j."min",
              arrears=j.arrears, due=j.due, account=j.account, note=j.note
         FROM jsonb_to_recordset($1::jsonb)
              AS j(id int, name text, balance numeric, apr numeric, "min" numeric,
                   arrears numeric, due int, account text, note text)
        WHERE d.id = j.id
          AND (d.name, d.balance, d.apr, d.min, d.arrears, d.due, d.account, d.note)
              IS DISTINCT FROM
              (j.name, j.balance, j.apr, j."min", j.arrears, j.due, j.account, j.note)
    RETURNING d.updated_at`,
      [JSON.stringify(debts.map(d => ({ ...d, note: d.note || '' })))]
    );
    // If nothing actually changed, the client's timestamp should stay at the
    // table's current max rather than null.
    let newUpdatedAt = current.rows[0].max;
    for (const row of result.rows) {
      if (!newUpdatedAt || row.updated_at > newUpdatedAt) newUpdatedAt = row.updated_at;
    }
    res.json({ ok: true, updatedAt: newUpdatedAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/settings', async (req, res) => {
  const { budget, sweepPct, savingsPct, tightThreshold, lastMilestone, notifyDaysBefore, notificationsEnabled, clientUpdatedAt } = req.body;
  try {
    const current = await db.query('SELECT * FROM debt_plan_settings WHERE id = 1');
    const s = current.rows[0];
    if (isStale(clientUpdatedAt, s.updated_at)) {
      return res.status(409).json({
        conflict: true,
        message: 'Updated on another device',
        current: {
          budget: s.budget, sweepPct: s.sweep_pct, savingsPct: s.savings_pct,
          tightThreshold: s.tight_threshold, lastMilestone: s.last_milestone,
          notifyDaysBefore: s.notify_days_before, notificationsEnabled: s.notifications_enabled
        },
        updatedAt: s.updated_at
      });
    }

    const result = await db.query(
      `UPDATE debt_plan_settings SET budget=$1, sweep_pct=$2, savings_pct=$3, tight_threshold=$4, last_milestone=$5, notify_days_before=$6, notifications_enabled=$7 WHERE id=1 RETURNING updated_at`,
      [budget, sweepPct, savingsPct, tightThreshold, lastMilestone,
        notifyDaysBefore ?? s.notify_days_before, notificationsEnabled ?? s.notifications_enabled]
    );
    res.json({ ok: true, updatedAt: result.rows[0].updated_at });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/cashflow', async (req, res) => {
  const { bizPot, perPot, savingsPot, paidThisCycle, clientUpdatedAt } = req.body;
  try {
    const current = await db.query('SELECT * FROM debt_plan_cashflow WHERE id = 1');
    const c = current.rows[0];
    if (isStale(clientUpdatedAt, c.updated_at)) {
      return res.status(409).json({
        conflict: true,
        message: 'Updated on another device',
        current: {
          bizPot: Number(c.biz_pot), perPot: Number(c.per_pot),
          savingsPot: Number(c.savings_pot), paidThisCycle: c.paid_this_cycle
        },
        updatedAt: c.updated_at
      });
    }

    const result = await db.query(
      `UPDATE debt_plan_cashflow SET biz_pot=$1, per_pot=$2, savings_pot=$3, paid_this_cycle=$4 WHERE id=1 RETURNING updated_at`,
      [bizPot, perPot, savingsPot, JSON.stringify(paidThisCycle || [])]
    );
    res.json({ ok: true, updatedAt: result.rows[0].updated_at });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/income', async (req, res) => {
  const { amount, bizAmt, perAmt, savedAmt, date } = req.body;
  try {
    const result = await db.query(
      `INSERT INTO debt_plan_income_log (amount, biz_amt, per_amt, saved_amt, date) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [amount, bizAmt || 0, perAmt || 0, savedAmt || 0, date]
    );
    res.json({ id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/api/income/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM debt_plan_income_log WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Archives the closing cycle to debt_plan_cycle_history, then clears the
// cycle (income log + tick-list) and optionally applies synced balances, in
// one database transaction so a crash or deploy mid-transition can't leave
// things half-cleared or the history row unwritten. debtsPaid/bizPotClose/
// perPotClose come from the client because the payoff simulation that
// produces cycle payment amounts is client-side only. The response carries
// the fresh updated_at for every table this touches, so the client can
// adopt them instead of its next save tripping the stale-write guard.
router.post('/api/new-cycle', async (req, res) => {
  const { debts, debtsPaid, bizPotClose, perPotClose } = req.body;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const paidList = Array.isArray(debtsPaid) ? debtsPaid : [];
    const totalPaid = paidList.reduce((s, p) => s + Number(p.amount || 0), 0);

    const incomeResult = await client.query('SELECT COALESCE(SUM(amount),0) AS total FROM debt_plan_income_log');
    const totalIncome = Number(incomeResult.rows[0].total);

    const settingsResult = await client.query('SELECT cycle_started_at FROM debt_plan_settings WHERE id = 1');
    const startedAt = settingsResult.rows[0]?.cycle_started_at || null;

    if (Array.isArray(debts)) {
      // Same skip-unchanged shape as POST /api/debts: only rows whose synced
      // balance/arrears actually differ get written (and updated_at-bumped).
      await client.query(
        `UPDATE debt_plan_debts d
            SET balance=j.balance, arrears=j.arrears
           FROM jsonb_to_recordset($1::jsonb) AS j(id int, balance numeric, arrears numeric)
          WHERE d.id = j.id
            AND (d.balance, d.arrears) IS DISTINCT FROM (j.balance, j.arrears)`,
        [JSON.stringify(debts.map(d => ({ id: d.id, balance: d.balance, arrears: d.arrears })))]
      );
    }

    const snapshotResult = await client.query('SELECT id, name, balance, arrears FROM debt_plan_debts ORDER BY id');
    const debtSnapshot = snapshotResult.rows.map(d => ({
      id: d.id, name: d.name, balance: Number(d.balance), arrears: Number(d.arrears)
    }));

    const cycleNumResult = await client.query('SELECT COALESCE(MAX(cycle_number),0) + 1 AS next FROM debt_plan_cycle_history');
    const cycleNumber = cycleNumResult.rows[0].next;

    await client.query(
      `INSERT INTO debt_plan_cycle_history
        (cycle_number, started_at, total_income, total_paid, biz_pot_close, per_pot_close, debts_paid, debt_snapshot)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [cycleNumber, startedAt, totalIncome, totalPaid, bizPotClose || 0, perPotClose || 0, JSON.stringify(paidList), JSON.stringify(debtSnapshot)]
    );

    await client.query('DELETE FROM debt_plan_income_log');
    const cashflowResult = await client.query(`UPDATE debt_plan_cashflow SET paid_this_cycle = '[]' WHERE id = 1 RETURNING updated_at`);
    const newSettings = await client.query('UPDATE debt_plan_settings SET cycle_started_at = NOW() WHERE id = 1 RETURNING updated_at');
    const debtsMax = await client.query('SELECT MAX(updated_at) AS max FROM debt_plan_debts');
    await client.query('COMMIT');

    res.json({
      ok: true,
      cycleNumber,
      debtsUpdatedAt: debtsMax.rows[0].max,
      cashflowUpdatedAt: cashflowResult.rows[0]?.updated_at || null,
      settingsUpdatedAt: newSettings.rows[0]?.updated_at || null
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.get('/api/history', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM debt_plan_cycle_history ORDER BY closed_at DESC');
    res.json(result.rows.map(r => ({
      id: r.id,
      cycleNumber: r.cycle_number,
      startedAt: r.started_at,
      closedAt: r.closed_at,
      totalIncome: Number(r.total_income),
      totalPaid: Number(r.total_paid),
      bizPotClose: Number(r.biz_pot_close),
      perPotClose: Number(r.per_pot_close),
      debtsPaid: r.debts_paid,
      debtSnapshot: r.debt_snapshot,
      notes: r.notes
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Web Push (Feature 4 extension) -- subscription plumbing for push to the
// installed PWA itself. The VAPID public key is what the browser needs to
// mint a subscription; the private half never leaves the server.
router.get('/api/push/public-key', async (req, res) => {
  try {
    res.json({ publicKey: await debtPush.getPublicKey() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/push/subscribe', async (req, res) => {
  try {
    await debtPush.saveSubscription(req.body && req.body.subscription, req.get('user-agent'));
    res.json({ ok: true });
  } catch (err) {
    res.status(err.badRequest ? 400 : 500).json({ error: err.message });
  }
});

router.post('/api/push/unsubscribe', async (req, res) => {
  const endpoint = req.body && req.body.endpoint;
  if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
  try {
    await debtPush.removeSubscription(endpoint);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Lets the user confirm delivery is wired up correctly before relying on
// the daily cron to ever fire. Tries every transport and 400s (not 500)
// only when NONE is set up, since that's a config gap, not a server error.
router.post('/api/notify-test', async (req, res) => {
  const result = { ntfy: false, webPushSent: 0 };
  const errors = [];
  if (ntfyConfigured()) {
    try {
      await sendNtfy('Test notification from your debt plan app ✓', { title: 'Debt Plan — test', priority: 'default' });
      result.ntfy = true;
    } catch (err) {
      errors.push(`ntfy: ${err.message}`);
    }
  }
  try {
    const pushResult = await debtPush.sendToAll({
      title: 'Debt Plan — test',
      body: 'Test notification from your debt plan app ✓',
      tag: 'debt-test',
      url: '/debt'
    });
    result.webPushSent = pushResult.sent;
  } catch (err) {
    errors.push(`web push: ${err.message}`);
  }
  if (!result.ntfy && result.webPushSent === 0) {
    const detail = errors.length ? errors.join('; ')
      : 'No delivery set up — enable push on this device below, or set NTFY_TOPIC on the server';
    return res.status(errors.length ? 500 : 400).json({ error: detail });
  }
  res.json({ ok: true, ...result });
});

// Backs the in-app amber banner (Feature 5) -- the push version of the same
// 28-day check runs server-side in lib/debtNotify.js's cron job.
router.get('/api/cycle-status', async (req, res) => {
  try {
    const result = await db.query('SELECT cycle_started_at FROM debt_plan_settings WHERE id = 1');
    const startedAt = result.rows[0]?.cycle_started_at;
    if (!startedAt) return res.json({ daysSinceStart: 0, promptReset: false });
    const daysSinceStart = Math.floor((Date.now() - new Date(startedAt).getTime()) / (1000 * 60 * 60 * 24));
    res.json({ daysSinceStart, promptReset: daysSinceStart >= 28 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Borrowed money tab -- see Debt Management App/debt-app-borrowed-money.md.
// Fully standalone: no read/write of debt_plan_cashflow, debt_plan_settings,
// debt_plan_debts, or the income log.
function titleCase(str) {
  return str.trim().replace(/\s+/g, ' ').replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

router.get('/api/borrowed', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM debt_plan_borrowed ORDER BY borrowed_at DESC, id DESC');
    const active = [];
    const repaid = [];
    for (const r of result.rows) {
      const row = {
        id: r.id, source_name: r.source_name, is_savings: r.is_savings,
        amount: Number(r.amount), note: r.note, borrowed_at: r.borrowed_at,
        repaid_at: r.repaid_at
      };
      (r.repaid ? repaid : active).push(row);
    }
    res.json({ active, repaid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/borrowed', async (req, res) => {
  const { source_name, is_savings, amount, note, borrowed_at } = req.body;
  if (!source_name || !source_name.trim()) return res.status(400).json({ error: 'source_name is required' });
  const amt = Number(amount);
  if (!amt || amt <= 0) return res.status(400).json({ error: 'amount must be greater than 0' });
  try {
    const result = await db.query(
      `INSERT INTO debt_plan_borrowed (source_name, is_savings, amount, note, borrowed_at)
       VALUES ($1,$2,$3,$4,COALESCE($5, CURRENT_DATE)) RETURNING *`,
      [titleCase(source_name), !!is_savings, amt, note || null, borrowed_at || null]
    );
    const r = result.rows[0];
    res.json({
      id: r.id, source_name: r.source_name, is_savings: r.is_savings,
      amount: Number(r.amount), note: r.note, borrowed_at: r.borrowed_at
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/borrowed/:id/repay', async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE debt_plan_borrowed SET repaid = true, repaid_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'not found' });
    const r = result.rows[0];
    res.json({
      id: r.id, source_name: r.source_name, is_savings: r.is_savings,
      amount: Number(r.amount), note: r.note, borrowed_at: r.borrowed_at, repaid_at: r.repaid_at
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/api/borrowed/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM debt_plan_borrowed WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
