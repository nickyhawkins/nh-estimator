const express = require('express');
const path = require('path');
const db = require('../db');
const { sendNtfy, ntfyConfigured } = require('../lib/debtNotify');
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

    let newUpdatedAt = null;
    for (const d of debts) {
      const result = await db.query(
        `UPDATE debt_plan_debts SET name=$2, balance=$3, apr=$4, min=$5, arrears=$6, due=$7, account=$8, note=$9 WHERE id=$1 RETURNING updated_at`,
        [d.id, d.name, d.balance, d.apr, d.min, d.arrears, d.due, d.account, d.note || '']
      );
      const rowUpdatedAt = result.rows[0]?.updated_at;
      if (rowUpdatedAt && (!newUpdatedAt || rowUpdatedAt > newUpdatedAt)) newUpdatedAt = rowUpdatedAt;
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
// cycle (income log + tick-list) and optionally applies synced balances,
// all in one round trip so a page refresh mid-transition can't leave things
// half-cleared or the history row unwritten. debtsPaid/bizPotClose/
// perPotClose come from the client because the payoff simulation that
// produces cycle payment amounts is client-side only.
router.post('/api/new-cycle', async (req, res) => {
  const { debts, debtsPaid, bizPotClose, perPotClose } = req.body;
  try {
    const paidList = Array.isArray(debtsPaid) ? debtsPaid : [];
    const totalPaid = paidList.reduce((s, p) => s + Number(p.amount || 0), 0);

    const incomeResult = await db.query('SELECT COALESCE(SUM(amount),0) AS total FROM debt_plan_income_log');
    const totalIncome = Number(incomeResult.rows[0].total);

    const settingsResult = await db.query('SELECT cycle_started_at FROM debt_plan_settings WHERE id = 1');
    const startedAt = settingsResult.rows[0]?.cycle_started_at || null;

    if (Array.isArray(debts)) {
      for (const d of debts) {
        await db.query('UPDATE debt_plan_debts SET balance=$2, arrears=$3 WHERE id=$1', [d.id, d.balance, d.arrears]);
      }
    }

    const snapshotResult = await db.query('SELECT id, name, balance, arrears FROM debt_plan_debts ORDER BY id');
    const debtSnapshot = snapshotResult.rows.map(d => ({
      id: d.id, name: d.name, balance: Number(d.balance), arrears: Number(d.arrears)
    }));

    const cycleNumResult = await db.query('SELECT COALESCE(MAX(cycle_number),0) + 1 AS next FROM debt_plan_cycle_history');
    const cycleNumber = cycleNumResult.rows[0].next;

    await db.query(
      `INSERT INTO debt_plan_cycle_history
        (cycle_number, started_at, total_income, total_paid, biz_pot_close, per_pot_close, debts_paid, debt_snapshot)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [cycleNumber, startedAt, totalIncome, totalPaid, bizPotClose || 0, perPotClose || 0, JSON.stringify(paidList), JSON.stringify(debtSnapshot)]
    );

    await db.query('DELETE FROM debt_plan_income_log');
    await db.query(`UPDATE debt_plan_cashflow SET paid_this_cycle = '[]' WHERE id = 1`);
    await db.query('UPDATE debt_plan_settings SET cycle_started_at = NOW() WHERE id = 1');

    res.json({ ok: true, cycleNumber });
  } catch (err) {
    res.status(500).json({ error: err.message });
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

// Lets the user confirm ntfy is wired up correctly before relying on the
// daily cron to ever fire. 400s (not 500) when NTFY_TOPIC isn't set, since
// that's a config gap, not a server error.
router.post('/api/notify-test', async (req, res) => {
  if (!ntfyConfigured()) {
    return res.status(400).json({ error: 'NTFY_TOPIC is not configured on the server' });
  }
  try {
    await sendNtfy('Test notification from your debt plan app ✓', { title: 'Debt Plan — test', priority: 'default' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

module.exports = router;
