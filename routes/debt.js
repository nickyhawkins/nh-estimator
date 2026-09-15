const express = require('express');
const path = require('path');
const db = require('../db');
const { sendNtfy, ntfyConfigured } = require('../lib/debtNotify');
const debtPush = require('../lib/debtPush');
const debtCycle = require('../lib/debtCycle');
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

// One place for the debt row -> API shape (used by /api/state, the 409
// conflict bodies, and the add/archive responses, which must all match).
function mapDebt(d) {
  return {
    id: d.id, name: d.name, balance: Number(d.balance), apr: Number(d.apr),
    min: Number(d.min), arrears: Number(d.arrears), due: d.due,
    account: d.account, note: d.note
  };
}

// Serves the debt app's frontend. Mounted at /debt in server.js, ahead of
// the paint app's catch-all so this route isn't swallowed by it.
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'debt.html'));
});

// Columns added after launch are applied lazily here (same pattern as
// lib/debtPush.js's table creation) because db/setup.sql is not run
// automatically on deploy. Both statements are idempotent; the promise is
// reset on failure so a transient DB blip doesn't poison later requests.
let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await db.query(`ALTER TABLE debt_plan_cashflow ADD COLUMN IF NOT EXISTS missed_this_cycle JSONB NOT NULL DEFAULT '[]'`);
      await db.query(`ALTER TABLE debt_plan_debts ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE`);
      await db.query(`ALTER TABLE debt_plan_settings ADD COLUMN IF NOT EXISTS buffer_target NUMERIC NOT NULL DEFAULT 0`);
      await db.query(`ALTER TABLE debt_plan_cashflow ADD COLUMN IF NOT EXISTS buffer_pot NUMERIC NOT NULL DEFAULT 0`);
      await db.query(`ALTER TABLE debt_plan_cashflow ADD COLUMN IF NOT EXISTS floor_paid_this_cycle JSONB NOT NULL DEFAULT '[]'`);
      await db.query(`ALTER TABLE debt_plan_income_log ADD COLUMN IF NOT EXISTS buffer_amt NUMERIC NOT NULL DEFAULT 0`);
      // The buffer, split by account. bizPot and perPot are two real bank
      // accounts and neither can rescue the other, so a cushion that is meant
      // to cover a month of minimums has to be held per account too. Every
      // legacy penny migrates to the PERSONAL side, which is where it
      // physically was — the Log-money-in transfer panel has always sent the
      // buffer to the personal account. See db/setup-debt.sql.
      await db.query(`DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
             WHERE table_name = 'debt_plan_cashflow' AND column_name = 'buffer_per'
          ) THEN
            ALTER TABLE debt_plan_cashflow ADD COLUMN buffer_biz NUMERIC NOT NULL DEFAULT 0;
            ALTER TABLE debt_plan_cashflow ADD COLUMN buffer_per NUMERIC NOT NULL DEFAULT 0;
            UPDATE debt_plan_cashflow SET buffer_per = buffer_pot;
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
             WHERE table_name = 'debt_plan_settings' AND column_name = 'buffer_target_per'
          ) THEN
            ALTER TABLE debt_plan_settings ADD COLUMN buffer_target_biz NUMERIC NOT NULL DEFAULT 0;
            ALTER TABLE debt_plan_settings ADD COLUMN buffer_target_per NUMERIC NOT NULL DEFAULT 0;
            UPDATE debt_plan_settings SET buffer_target_per = buffer_target;
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
             WHERE table_name = 'debt_plan_income_log' AND column_name = 'buffer_per_amt'
          ) THEN
            ALTER TABLE debt_plan_income_log ADD COLUMN buffer_biz_amt NUMERIC NOT NULL DEFAULT 0;
            ALTER TABLE debt_plan_income_log ADD COLUMN buffer_per_amt NUMERIC NOT NULL DEFAULT 0;
            UPDATE debt_plan_income_log SET buffer_per_amt = buffer_amt;
          END IF;
        END $$`);
      // Ledger of what a live "paid"/"min" tick actually took off each
      // balance, so un-ticking can put back exactly what it removed
      // (recomputing from the now-reduced balances would give a different,
      // wrong figure). See lib/debtCycle.js and db/setup-debt.sql.
      await db.query(`ALTER TABLE debt_plan_cashflow ADD COLUMN IF NOT EXISTS applied_payments JSONB NOT NULL DEFAULT '{}'`);
      // Borrowing from one of the app's own pots (v2.60.0). `pot` names which
      // one the money came out of -- NULL keeps the original meaning of a row
      // on this tab, a note about money owed to a person, which moves nothing.
      // `repaid_amount` is what has gone back so far, because a pay-in too
      // small to clear the loan repays what it can and leaves the rest.
      await db.query(`ALTER TABLE debt_plan_borrowed ADD COLUMN IF NOT EXISTS pot TEXT`);
      await db.query(`ALTER TABLE debt_plan_borrowed ADD COLUMN IF NOT EXISTS repaid_amount NUMERIC NOT NULL DEFAULT 0`);
      // What a pay-in put back into which pot, kept on the income row so that
      // deleting the row can undo the repayment as well as the allocation.
      await db.query(`ALTER TABLE debt_plan_income_log ADD COLUMN IF NOT EXISTS pot_repay JSONB`);
    })().catch(err => { schemaReady = null; throw err; });
  }
  return schemaReady;
}
router.use('/api', async (req, res, next) => {
  try {
    await ensureSchema();
    // Catch up on any cycle that fell due while the app was closed, before
    // the request reads state -- otherwise opening the app would show a
    // months-old cycle until the next 8am cron. Throttled to one check per
    // five minutes across all requests (see lib/debtCycle.js).
    await debtCycle.rollDueCyclesThrottled();
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
    // updated_at max spans ALL rows (archived included) to match the
    // MAX(updated_at) the write endpoints compare against.
    const debtsUpdatedAt = debts.rows.reduce((max, d) => (!max || d.updated_at > max ? d.updated_at : max), null);
    res.json({
      // `debts` stays the live list: everything downstream (simulation,
      // cycle payments, edit/overview tabs, the header chart) reads it
      // unchanged and so hides archived debts with no per-view filtering.
      debts: debts.rows.filter(d => !d.archived).map(mapDebt),
      archivedDebts: debts.rows.filter(d => d.archived).map(mapDebt),
      settings: {
        budget: s.budget, sweepPct: s.sweep_pct, savingsPct: s.savings_pct,
        tightThreshold: s.tight_threshold, lastMilestone: s.last_milestone,
        notifyDaysBefore: s.notify_days_before, notificationsEnabled: s.notifications_enabled,
        bufferTargetBiz: Number(s.buffer_target_biz), bufferTargetPer: Number(s.buffer_target_per)
      },
      cashflow: {
        bizPot: Number(c.biz_pot), perPot: Number(c.per_pot),
        savingsPot: Number(c.savings_pot), paidThisCycle: c.paid_this_cycle,
        missedThisCycle: c.missed_this_cycle,
        minPaidThisCycle: c.floor_paid_this_cycle,
        bufferBiz: Number(c.buffer_biz), bufferPer: Number(c.buffer_per),
        appliedPayments: c.applied_payments || {}
      },
      incomeLog: income.rows.map(e => ({
        id: e.id, amount: Number(e.amount), bizAmt: Number(e.biz_amt),
        perAmt: Number(e.per_amt), savedAmt: Number(e.saved_amt),
        bufferAmt: Number(e.buffer_amt),
        bufferBizAmt: Number(e.buffer_biz_amt), bufferPerAmt: Number(e.buffer_per_amt),
        potRepay: e.pot_repay || null,
        date: e.date
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
      const fresh = await db.query('SELECT * FROM debt_plan_debts WHERE NOT archived ORDER BY id');
      return res.status(409).json({
        conflict: true,
        message: 'Updated on another device',
        current: fresh.rows.map(mapDebt),
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

// Adds one debt. debt_plan_debts.id is a plain INTEGER PRIMARY KEY (no
// sequence — the seed rows carry explicit ids), so the next id is assigned
// here as MAX(id)+1, atomically inside the INSERT ... SELECT. Uses the same
// stale-write guard as /api/debts: without it, an add from a device holding
// stale rows would adopt the fresh updated_at and its next full save could
// silently overwrite another device's edits.
router.post('/api/debts/add', async (req, res) => {
  const { debt, clientUpdatedAt } = req.body;
  if (!debt || !debt.name || !String(debt.name).trim()) return res.status(400).json({ error: 'debt name required' });
  try {
    const current = await db.query('SELECT MAX(updated_at) AS max FROM debt_plan_debts');
    if (isStale(clientUpdatedAt, current.rows[0].max)) {
      const fresh = await db.query('SELECT * FROM debt_plan_debts WHERE NOT archived ORDER BY id');
      return res.status(409).json({
        conflict: true,
        message: 'Updated on another device',
        current: fresh.rows.map(mapDebt),
        updatedAt: current.rows[0].max
      });
    }
    const due = debt.due == null || debt.due === '' ? null : parseInt(debt.due, 10) || null;
    const result = await db.query(
      `INSERT INTO debt_plan_debts (id, name, balance, apr, min, arrears, due, account, note)
       SELECT COALESCE(MAX(id), 0) + 1, $1, $2, $3, $4, $5, $6, $7, $8 FROM debt_plan_debts
       RETURNING *`,
      [String(debt.name).trim(), Number(debt.balance) || 0, Number(debt.apr) || 0,
        Number(debt.min) || 0, Number(debt.arrears) || 0, due,
        debt.account === 'business' ? 'business' : 'personal', debt.note || '']
    );
    const row = result.rows[0];
    // The inserted row's updated_at (DEFAULT NOW()) is the table's new max.
    res.json({ ok: true, debt: mapDebt(row), updatedAt: row.updated_at });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Debts are never hard-deleted — debt_plan_cycle_history's debt_snapshot and
// debts_paid reference their ids — so this flags the row out of the live
// views instead, keeping the row and its history intact. { archived: false }
// restores an archived debt.
router.post('/api/debts/:id/archive', async (req, res) => {
  const { archived, clientUpdatedAt } = req.body || {};
  try {
    const current = await db.query('SELECT MAX(updated_at) AS max FROM debt_plan_debts');
    if (isStale(clientUpdatedAt, current.rows[0].max)) {
      const fresh = await db.query('SELECT * FROM debt_plan_debts WHERE NOT archived ORDER BY id');
      return res.status(409).json({
        conflict: true,
        message: 'Updated on another device',
        current: fresh.rows.map(mapDebt),
        updatedAt: current.rows[0].max
      });
    }
    const result = await db.query(
      'UPDATE debt_plan_debts SET archived = $1 WHERE id = $2 RETURNING *',
      [archived !== false, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'not found' });
    const row = result.rows[0];
    // The trigger bumped this row's updated_at, making it the new max.
    res.json({ ok: true, debt: mapDebt(row), updatedAt: row.updated_at });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/settings', async (req, res) => {
  const { budget, sweepPct, savingsPct, tightThreshold, lastMilestone, notifyDaysBefore,
    notificationsEnabled, bufferTargetBiz, bufferTargetPer, clientUpdatedAt } = req.body;
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
          notifyDaysBefore: s.notify_days_before, notificationsEnabled: s.notifications_enabled,
          bufferTargetBiz: Number(s.buffer_target_biz), bufferTargetPer: Number(s.buffer_target_per)
        },
        updatedAt: s.updated_at
      });
    }

    const result = await db.query(
      `UPDATE debt_plan_settings SET budget=$1, sweep_pct=$2, savings_pct=$3, tight_threshold=$4, last_milestone=$5, notify_days_before=$6, notifications_enabled=$7, buffer_target_biz=$8, buffer_target_per=$9 WHERE id=1 RETURNING updated_at`,
      [budget, sweepPct, savingsPct, tightThreshold, lastMilestone,
        notifyDaysBefore ?? s.notify_days_before, notificationsEnabled ?? s.notifications_enabled,
        bufferTargetBiz ?? s.buffer_target_biz, bufferTargetPer ?? s.buffer_target_per]
    );
    res.json({ ok: true, updatedAt: result.rows[0].updated_at });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/cashflow', async (req, res) => {
  const { bizPot, perPot, savingsPot, bufferBiz, bufferPer, paidThisCycle, missedThisCycle,
    minPaidThisCycle, appliedPayments, clientUpdatedAt } = req.body;
  try {
    const current = await db.query('SELECT * FROM debt_plan_cashflow WHERE id = 1');
    const c = current.rows[0];
    if (isStale(clientUpdatedAt, c.updated_at)) {
      return res.status(409).json({
        conflict: true,
        message: 'Updated on another device',
        current: {
          bizPot: Number(c.biz_pot), perPot: Number(c.per_pot),
          savingsPot: Number(c.savings_pot), paidThisCycle: c.paid_this_cycle,
          missedThisCycle: c.missed_this_cycle,
          minPaidThisCycle: c.floor_paid_this_cycle,
          bufferBiz: Number(c.buffer_biz), bufferPer: Number(c.buffer_per),
          appliedPayments: c.applied_payments || {}
        },
        updatedAt: c.updated_at
      });
    }

    const result = await db.query(
      `UPDATE debt_plan_cashflow SET biz_pot=$1, per_pot=$2, savings_pot=$3, paid_this_cycle=$4,
              missed_this_cycle=COALESCE($5, missed_this_cycle),
              buffer_biz=COALESCE($6, buffer_biz),
              buffer_per=COALESCE($7, buffer_per),
              floor_paid_this_cycle=COALESCE($8, floor_paid_this_cycle),
              applied_payments=COALESCE($9, applied_payments)
         WHERE id=1 RETURNING updated_at`,
      [bizPot, perPot, savingsPot, JSON.stringify(paidThisCycle || []),
        missedThisCycle === undefined ? null : JSON.stringify(missedThisCycle),
        bufferBiz === undefined ? null : bufferBiz,
        bufferPer === undefined ? null : bufferPer,
        minPaidThisCycle === undefined ? null : JSON.stringify(minPaidThisCycle),
        appliedPayments === undefined ? null : JSON.stringify(appliedPayments)]
    );
    res.json({ ok: true, updatedAt: result.rows[0].updated_at });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/income', async (req, res) => {
  const { amount, bizAmt, perAmt, savedAmt, bufferBizAmt, bufferPerAmt, potRepay, date } = req.body;
  try {
    // buffer_amt stays the total of the two, so the legacy column keeps
    // meaning what it always meant for anything still reading it.
    const bufBiz = bufferBizAmt || 0, bufPer = bufferPerAmt || 0;
    const result = await db.query(
      `INSERT INTO debt_plan_income_log (amount, biz_amt, per_amt, saved_amt, buffer_amt, buffer_biz_amt, buffer_per_amt, pot_repay, date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [amount, bizAmt || 0, perAmt || 0, savedAmt || 0, bufBiz + bufPer, bufBiz, bufPer,
        potRepay && potRepay.total > 0.005 ? JSON.stringify(potRepay) : null, date]
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
  const { debts, debtsPaid, debtsMissed, bizPotClose, perPotClose,
    minsMet, targetMet, arrearsAdded } = req.body;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const paidList = Array.isArray(debtsPaid) ? debtsPaid : [];
    const totalPaid = paidList.reduce((s, p) => s + Number(p.amount || 0), 0);
    // Debts deliberately skipped this cycle, archived into the history row's
    // notes column as structured JSON (not free text) so the History tab can
    // render "N missed" later without a schema change.
    const missedList = (Array.isArray(debtsMissed) ? debtsMissed : []).map(Number).filter(Number.isFinite);
    // The closing cycle's verdict on BOTH numbers, archived alongside the
    // missed ids so the History tab can show "minimums met, target missed"
    // rather than one all-or-nothing pass/fail. Older rows carry `floorsMet`
    // from before floors were retired; the client reads either.
    const noteData = {};
    if (missedList.length) noteData.missed = missedList;
    if (typeof minsMet === 'boolean') noteData.minsMet = minsMet;
    if (typeof targetMet === 'boolean') noteData.targetMet = targetMet;
    // Contractual minimums this cycle left uncovered, which the client has
    // already folded into the arrears it sends up in `debts`. Archived so
    // History can say what moved -- the same key the auto-roller writes.
    if (Array.isArray(arrearsAdded) && arrearsAdded.length) {
      noteData.arrearsAdded = arrearsAdded.map(a => ({
        id: Number(a.id), name: String(a.name || ''), amount: Number(a.amount) || 0
      }));
    }
    const notes = Object.keys(noteData).length ? JSON.stringify(noteData) : null;

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

    // Archived debts stay out of the snapshot: it feeds the History tab's
    // balance-at-close totals, which should reflect the live plan only.
    // (Rows in PAST snapshots keep referencing archived ids — that's why
    // archive is a flag, not a delete.)
    const snapshotResult = await client.query('SELECT id, name, balance, arrears FROM debt_plan_debts WHERE NOT archived ORDER BY id');
    const debtSnapshot = snapshotResult.rows.map(d => ({
      id: d.id, name: d.name, balance: Number(d.balance), arrears: Number(d.arrears)
    }));

    const cycleNumResult = await client.query('SELECT COALESCE(MAX(cycle_number),0) + 1 AS next FROM debt_plan_cycle_history');
    const cycleNumber = cycleNumResult.rows[0].next;

    await client.query(
      `INSERT INTO debt_plan_cycle_history
        (cycle_number, started_at, total_income, total_paid, biz_pot_close, per_pot_close, debts_paid, debt_snapshot, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [cycleNumber, startedAt, totalIncome, totalPaid, bizPotClose || 0, perPotClose || 0, JSON.stringify(paidList), JSON.stringify(debtSnapshot), notes]
    );

    await client.query('DELETE FROM debt_plan_income_log');
    // paid/missed reset with the cycle; the buffer jars are untouched, because
    // a cash cushion spans cycles — that is the whole point of it.
    const cashflowResult = await client.query(
      `UPDATE debt_plan_cashflow
          SET paid_this_cycle = '[]', missed_this_cycle = '[]', floor_paid_this_cycle = '[]',
              applied_payments = '{}'
        WHERE id = 1 RETURNING updated_at`);
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
    // Carries cycleStartedAt/nextRollAt as well as the day counts: the
    // frontend anchors its whole payoff calendar to the cycle's start month,
    // so "month 1" tracks reality instead of a hardcoded date.
    res.json(debtCycle.cycleStatusFor(result.rows[0]?.cycle_started_at));
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

// The pots a loan can be taken out of. NULL/absent is the tab's original
// meaning -- money owed to a person, which moves nothing anywhere.
const LOAN_POTS = ['biz', 'per', 'savings', 'bufferBiz', 'bufferPer'];
const mapLoan = r => ({
  id: r.id, source_name: r.source_name, is_savings: r.is_savings,
  amount: Number(r.amount), note: r.note, borrowed_at: r.borrowed_at,
  pot: r.pot || null, repaid_amount: Number(r.repaid_amount || 0),
  repaid_at: r.repaid_at
});

router.get('/api/borrowed', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM debt_plan_borrowed ORDER BY borrowed_at DESC, id DESC');
    const active = [];
    const repaid = [];
    for (const r of result.rows) (r.repaid ? repaid : active).push(mapLoan(r));
    res.json({ active, repaid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/borrowed', async (req, res) => {
  const { source_name, is_savings, amount, note, borrowed_at, pot } = req.body;
  if (!source_name || !source_name.trim()) return res.status(400).json({ error: 'source_name is required' });
  const amt = Number(amount);
  if (!amt || amt <= 0) return res.status(400).json({ error: 'amount must be greater than 0' });
  if (pot && !LOAN_POTS.includes(pot)) return res.status(400).json({ error: 'unknown pot: ' + pot });
  try {
    const result = await db.query(
      `INSERT INTO debt_plan_borrowed (source_name, is_savings, amount, note, borrowed_at, pot)
       VALUES ($1,$2,$3,$4,COALESCE($5, CURRENT_DATE),$6) RETURNING *`,
      [titleCase(source_name), !!is_savings, amt, note || null, borrowed_at || null, pot || null]
    );
    res.json(mapLoan(result.rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/borrowed/:id/repay', async (req, res) => {
  try {
    // Repaid by hand is repaid in full: repaid_amount catches up to the
    // amount so the two can never disagree about what is still owed.
    const result = await db.query(
      `UPDATE debt_plan_borrowed
          SET repaid = true, repaid_at = NOW(), repaid_amount = amount
        WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'not found' });
    res.json(mapLoan(result.rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Part-repayments from a pay-in, applied as DELTAS in one transaction: a
// pay-in too small to clear a pot loan repays what it can, and the same
// endpoint runs in reverse (negative amounts) when the income entry that made
// the repayment is deleted. `repaid` is derived from the running total rather
// than set independently, so a reversal re-opens a loan that had been closed.
router.post('/api/borrowed/repay', async (req, res) => {
  const list = Array.isArray(req.body && req.body.repayments) ? req.body.repayments : [];
  if (!list.length) return res.json({ updated: [] });
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const updated = [];
    for (const item of list) {
      const delta = Number(item && item.amount);
      if (!delta || !isFinite(delta)) continue;
      const r = await client.query(
        `UPDATE debt_plan_borrowed
            SET repaid_amount = LEAST(amount, GREATEST(0, repaid_amount + $2)),
                repaid = LEAST(amount, GREATEST(0, repaid_amount + $2)) >= amount - 0.005,
                repaid_at = CASE WHEN LEAST(amount, GREATEST(0, repaid_amount + $2)) >= amount - 0.005
                                 THEN COALESCE(repaid_at, NOW()) ELSE NULL END
          WHERE id = $1 RETURNING *`,
        [item.id, delta]
      );
      if (r.rows[0]) updated.push(mapLoan(r.rows[0]));
    }
    await client.query('COMMIT');
    res.json({ updated });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
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
