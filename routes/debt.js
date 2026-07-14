const express = require('express');
const path = require('path');
const db = require('../db');
const router = express.Router();

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
    res.json({
      debts: debts.rows.map(d => ({
        id: d.id, name: d.name, balance: Number(d.balance), apr: Number(d.apr),
        min: Number(d.min), arrears: Number(d.arrears), due: d.due,
        account: d.account, note: d.note
      })),
      settings: {
        budget: s.budget, sweepPct: s.sweep_pct, savingsPct: s.savings_pct,
        tightThreshold: s.tight_threshold, lastMilestone: s.last_milestone
      },
      cashflow: {
        bizPot: Number(c.biz_pot), perPot: Number(c.per_pot),
        savingsPot: Number(c.savings_pot), paidThisCycle: c.paid_this_cycle
      },
      incomeLog: income.rows.map(e => ({
        id: e.id, amount: Number(e.amount), bizAmt: Number(e.biz_amt),
        perAmt: Number(e.per_amt), savedAmt: Number(e.saved_amt), date: e.date
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/debts', async (req, res) => {
  const { debts } = req.body;
  if (!Array.isArray(debts)) return res.status(400).json({ error: 'debts array required' });
  try {
    for (const d of debts) {
      await db.query(
        `UPDATE debt_plan_debts SET name=$2, balance=$3, apr=$4, min=$5, arrears=$6, due=$7, account=$8, note=$9 WHERE id=$1`,
        [d.id, d.name, d.balance, d.apr, d.min, d.arrears, d.due, d.account, d.note || '']
      );
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/settings', async (req, res) => {
  const { budget, sweepPct, savingsPct, tightThreshold, lastMilestone } = req.body;
  try {
    await db.query(
      `UPDATE debt_plan_settings SET budget=$1, sweep_pct=$2, savings_pct=$3, tight_threshold=$4, last_milestone=$5 WHERE id=1`,
      [budget, sweepPct, savingsPct, tightThreshold, lastMilestone]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/cashflow', async (req, res) => {
  const { bizPot, perPot, savingsPot, paidThisCycle } = req.body;
  try {
    await db.query(
      `UPDATE debt_plan_cashflow SET biz_pot=$1, per_pot=$2, savings_pot=$3, paid_this_cycle=$4 WHERE id=1`,
      [bizPot, perPot, savingsPot, JSON.stringify(paidThisCycle || [])]
    );
    res.json({ ok: true });
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

// Clears the cycle (income log + tick-list) and optionally applies synced
// balances in one round trip, so a page refresh mid-transition can't leave
// the cycle half-cleared.
router.post('/api/new-cycle', async (req, res) => {
  const { debts } = req.body;
  try {
    await db.query('DELETE FROM debt_plan_income_log');
    await db.query(`UPDATE debt_plan_cashflow SET paid_this_cycle = '[]' WHERE id = 1`);
    if (Array.isArray(debts)) {
      for (const d of debts) {
        await db.query('UPDATE debt_plan_debts SET balance=$2, arrears=$3 WHERE id=$1', [d.id, d.balance, d.arrears]);
      }
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
