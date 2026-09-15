const db = require('../db');
const { broadcast } = require('./debtNotify');

// Automatic monthly cycle rollover for the debt app.
//
// Before this, a cycle only ever ended when someone pressed "Start new
// cycle", so an app left alone sat frozen on a months-old cycle with stale
// balances and a payoff projection anchored to a date that had long passed.
// Here the cycle closes itself a calendar month after it opened.
//
// The governing rule: an automatic close does EXACTLY what the manual close
// (POST /api/new-cycle) does, and nothing more. Same history row, same
// verdict, same arrears roll, same things left alone -- pots and buffer carry
// over. It is the button pressing itself, not a second policy.
//
// One number moves at a close. The MINIMUM (debt_plan_debts.min) is
// contractual: whatever of it goes unpaid is genuinely overdue, so it is added
// to arrears. That is simply true, and the plan should say so.
//
// There used to be a second, discretionary FLOOR alongside it with its own
// verdict and its own catch-up ledger. It was retired (v2.57.0) because across
// the whole live plan it was set equal to the minimum on every debt but one
// and never above it -- it never said anything `min` did not already say.
//
// The one thing this cannot borrow from the manual path is the payoff
// simulation, which is client-side only. Everything it needs instead comes
// from stored state: min per debt, the three tick-lists, and applied_payments
// (what each tick actually took off a balance, and what it was measured
// against).
//
// Since a payment can be for any amount the user typed, a tick is no longer a
// promise that the commitment was met: an entry flagged `custom` is judged on
// its amount, against the target and minimum recorded with it. A tick with NO
// ledger entry -- a cycle already open before applied_payments existed -- is
// still taken at its word, exactly as it was before.

const ROLL_LIMIT = 12; // backstop if the app has been offline for a year

// Stamped the first time the roller ever runs against a database, and read
// back to recognise that first run (see the grace in rollOnce). Applied here
// rather than in routes/debt.js's ensureSchema because the 8am cron calls
// rollDueCycles directly and can fire before any API request has been served.
let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = db.query(
      `ALTER TABLE debt_plan_settings ADD COLUMN IF NOT EXISTS auto_roll_started_at TIMESTAMP`
    ).catch(err => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

// Calendar-month arithmetic that survives month ends: 31 Jan + 1 month is
// 28/29 Feb, not 2/3 March (which is what setMonth alone would give).
function addMonths(date, n) {
  const d = new Date(date);
  const day = d.getDate();
  d.setMonth(d.getMonth() + n);
  if (d.getDate() < day) d.setDate(0);
  return d;
}

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;


// The single source of truth for "when does this cycle end", shared by the
// roller and GET /api/cycle-status so the banner and the actual rollover can
// never disagree.
function cycleStatusFor(startedAt) {
  if (!startedAt) return { cycleStartedAt: null, nextRollAt: null, daysSinceStart: 0, daysToRoll: null, promptReset: false };
  const start = new Date(startedAt);
  const next = addMonths(start, 1);
  const now = Date.now();
  const daysSinceStart = Math.floor((now - start.getTime()) / 86400000);
  return {
    cycleStartedAt: start.toISOString(),
    nextRollAt: next.toISOString(),
    daysSinceStart,
    daysToRoll: Math.ceil((next.getTime() - now) / 86400000),
    promptReset: daysSinceStart >= 28
  };
}

// Closes one overdue cycle, or returns null if none is due. Everything
// happens in a single transaction under a row lock on debt_plan_settings, so
// the cron and a concurrent API request can't both roll the same cycle.
async function rollOnce() {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const settings = await client.query(
      'SELECT cycle_started_at, auto_roll_started_at FROM debt_plan_settings WHERE id = 1 FOR UPDATE'
    );
    const startedAt = settings.rows[0] && settings.rows[0].cycle_started_at;
    const autoRollFrom = settings.rows[0] && settings.rows[0].auto_roll_started_at;
    if (!autoRollFrom || !startedAt) {
      // First run against this database. The cycle open right now predates
      // the roller -- it has been running long past a month precisely because
      // nothing existed to close it, and its balances and arrears have since
      // been put right by hand. Closing it retroactively would record a whole
      // month of unpaid minimums against figures that are already correct, so
      // adopt today as the start of the first auto-managed cycle and touch
      // nothing else: no ledger entries, no history row, no tick-lists. Also
      // covers a fresh install, where there is no cycle to roll either.
      await client.query('UPDATE debt_plan_settings SET cycle_started_at = NOW(), auto_roll_started_at = NOW() WHERE id = 1');
      await client.query('COMMIT');
      return null;
    }
    const dueAt = addMonths(startedAt, 1);
    if (Date.now() < dueAt.getTime()) {
      await client.query('ROLLBACK');
      return null;
    }

    const cashflow = await client.query('SELECT * FROM debt_plan_cashflow WHERE id = 1');
    const c = cashflow.rows[0] || {};
    const asIds = v => (Array.isArray(v) ? v : []).map(Number);
    const paidIds = asIds(c.paid_this_cycle);
    const minPaidIds = asIds(c.floor_paid_this_cycle); // column name predates the rename
    const missedIds = asIds(c.missed_this_cycle);
    const applied = c.applied_payments && typeof c.applied_payments === 'object' ? c.applied_payments : {};
    // A payment can be for any amount the user typed, so which tick-list an
    // id sits in no longer settles whether the minimum was covered
    // -- the amount does. Mirrors paidAmountOf() in public/debt.html.
    const entryFor = id => applied[String(id)] || null;
    const paidAmount = id => { const a = entryFor(id); return a ? Number(a.nominal) || 0 : 0; };
    const isCustom = id => { const a = entryFor(id); return !!(a && a.custom); };

    const debtsResult = await client.query(
      'SELECT id, name, balance, arrears, min, due FROM debt_plan_debts WHERE NOT archived ORDER BY id'
    );
    // Debts actually in the payment plan, matching getCurrentTarget()'s rule:
    // a live balance and either a minimum or a due date. HMRC pre-Time-to-Pay
    // (no minimum, no due date) is in the list but not in the plan.
    const inPlan = debtsResult.rows.filter(d =>
      Number(d.balance) > 0.005 && (Number(d.min) > 0.005 || d.due != null));

    // The minimums verdict, computed the way getCycleStatus() does: a minimum
    // is met by paying the target in full OR the minimum on its own, and by a
    // custom amount only if it reaches. Capped at the balance -- you can't owe
    // more than is left -- which is the cap the client uses too, so the app's
    // verdict and this one cannot disagree.
    const withMin = [];
    const unmet = [];
    // Contractual minimums left uncovered, which become arrears below.
    const arrearsAdded = [];
    for (const d of inPlan) {
      const balance = Number(d.balance);
      const minDue = Math.min(Number(d.min) || 0, balance);
      // No minimum = no commitment (a trade account, HMRC pre-arrangement).
      if (minDue <= 0.005) continue;
      withMin.push(d);

      // How much of it actually went out. Paying the target in full always
      // covers it (the plan's payment is built on top of the minimum); a
      // minimum-only tick covers exactly it; a custom amount covers exactly
      // itself, and no further.
      const coveredByPayment = isCustom(d.id) ? Math.min(minDue, paidAmount(d.id))
        : paidIds.includes(d.id) ? minDue
        : minPaidIds.includes(d.id) ? minDue
        : 0;
      const unpaidMin = Math.max(0, minDue - coveredByPayment);
      if (unpaidMin > 0.005) unmet.push({ id: d.id, name: d.name, amount: round2(unpaidMin) });
      if (unpaidMin <= 0.005) continue;
      const arrears = Number(d.arrears);
      const newArrears = Math.min(balance, arrears + unpaidMin);
      if (newArrears - arrears <= 0.005) continue; // already fully overdue
      arrearsAdded.push({ id: d.id, name: d.name, amount: round2(newArrears - arrears) });
      await client.query('UPDATE debt_plan_debts SET arrears = $1 WHERE id = $2', [newArrears, d.id]);
    }
    const minsMet = withMin.length > 0 && unmet.length === 0;
    // Stricter, as on the client: every debt in the plan paid in full. A
    // custom payment counts only if it reached the target it replaced.
    const targetMet = inPlan.length > 0 && inPlan.every(d => {
      if (!paidIds.includes(d.id)) return false;
      const a = entryFor(d.id);
      if (!a || !a.custom) return true;
      const target = a.target == null ? Number(a.nominal) || 0 : Number(a.target);
      return paidAmount(d.id) >= target - 0.005;
    });

    // The manual path gets payment amounts from the client's simulation; here
    // they come from applied_payments, the ledger each tick writes when it
    // applies a payment to a balance.
    const debtsPaid = [...paidIds, ...minPaidIds].map(id => {
      const debt = debtsResult.rows.find(x => x.id === id);
      const a = applied[String(id)] || {};
      return { id, name: debt ? debt.name : `Debt ${id}`, amount: round2(a.nominal || 0) };
    }).filter(p => p.amount > 0.005);
    const totalPaid = debtsPaid.reduce((s, p) => s + p.amount, 0);

    const incomeResult = await client.query('SELECT COALESCE(SUM(amount),0) AS total FROM debt_plan_income_log');
    const totalIncome = Number(incomeResult.rows[0].total);

    const snapshot = await client.query('SELECT id, name, balance, arrears FROM debt_plan_debts WHERE NOT archived ORDER BY id');
    const debtSnapshot = snapshot.rows.map(d => ({
      id: d.id, name: d.name, balance: Number(d.balance), arrears: Number(d.arrears)
    }));

    const cycleNumResult = await client.query('SELECT COALESCE(MAX(cycle_number),0) + 1 AS next FROM debt_plan_cycle_history');
    const cycleNumber = cycleNumResult.rows[0].next;

    // Same note shape as the manual close, plus autoRolled so the app can
    // tell you the cycle turned over without you.
    const noteData = { autoRolled: true, minsMet, targetMet };
    const missedInPlan = missedIds.filter(id => inPlan.some(d => d.id === id));
    if (missedInPlan.length) noteData.missed = missedInPlan;
    if (arrearsAdded.length) noteData.arrearsAdded = arrearsAdded;

    await client.query(
      `INSERT INTO debt_plan_cycle_history
        (cycle_number, started_at, total_income, total_paid, biz_pot_close, per_pot_close, debts_paid, debt_snapshot, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [cycleNumber, startedAt, totalIncome, totalPaid, Number(c.biz_pot) || 0, Number(c.per_pot) || 0,
        JSON.stringify(debtsPaid), JSON.stringify(debtSnapshot), JSON.stringify(noteData)]
    );

    await client.query('DELETE FROM debt_plan_income_log');
    // Exactly the manual close's reset: the three tick-lists and the applied
    // ledger clear; the pots and the buffer carry over untouched.
    await client.query(
      `UPDATE debt_plan_cashflow
          SET paid_this_cycle='[]', missed_this_cycle='[]', floor_paid_this_cycle='[]',
              applied_payments='{}'
        WHERE id = 1`
    );
    // Advance to the boundary that was crossed, not NOW() -- otherwise every
    // late rollover would push the next one further out and the cycle would
    // drift off its day of the month.
    await client.query('UPDATE debt_plan_settings SET cycle_started_at = $1 WHERE id = 1', [dueAt]);
    await client.query('COMMIT');

    return { cycleNumber, closedAt: dueAt, totalPaid, minsMet, unmet, arrearsAdded };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Rolls every cycle that has fallen due -- more than one if the app has been
// untouched for months, so History gets a row per month rather than one
// giant gap.
async function rollDueCycles() {
  await ensureSchema();
  const rolled = [];
  for (let i = 0; i < ROLL_LIMIT; i++) {
    const result = await rollOnce();
    if (!result) break;
    rolled.push(result);
  }
  return rolled;
}

// Opening the app should catch up instantly rather than waiting for the 8am
// cron, but the check shouldn't run on every single API call. One shared
// in-flight promise per window means concurrent requests (the app fires
// /api/state, /api/history, /api/cycle-status and /api/borrowed together)
// all await the same roll instead of racing it.
let lastCheck = { at: 0, promise: null };
const CHECK_WINDOW_MS = 5 * 60 * 1000;
function rollDueCyclesThrottled() {
  const now = Date.now();
  if (lastCheck.promise && now - lastCheck.at < CHECK_WINDOW_MS) return lastCheck.promise;
  lastCheck = {
    at: now,
    promise: rollDueCycles().catch(err => {
      lastCheck.at = 0; // let the next request retry rather than wait out the window
      console.error('Debt cycle auto-roll failed', err.message);
      return [];
    })
  };
  return lastCheck.promise;
}

// Cron-path only: someone with the app open sees the in-app banner instead.
async function notifyRolled(rolled) {
  for (const r of rolled) {
    const owed = r.arrearsAdded.reduce((s, a) => s + a.amount, 0);
    const body = owed > 0.005
      ? `Cycle ${r.cycleNumber} closed. £${owed.toFixed(2)} of unpaid minimums went into arrears — open the app to sync your balances.`
      : `Cycle ${r.cycleNumber} closed with every minimum covered. Open the app to sync your balances.`;
    await broadcast(body, {
      title: 'Debt Plan — new cycle started',
      priority: owed > 0.005 ? 'high' : 'default',
      tags: 'recycle',
      tag: `debt-cycle-rolled-${r.cycleNumber}`
    });
  }
}

module.exports = { addMonths, cycleStatusFor, rollDueCycles, rollDueCyclesThrottled, notifyRolled };
