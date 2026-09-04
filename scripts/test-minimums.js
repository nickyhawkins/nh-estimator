#!/usr/bin/env node
'use strict';

// ── Regression test: minimums & targets (debt app) ─────────────────────
//
// Exercises the REAL client-side logic out of public/debt.html — the script
// block is extracted and run in a vm with a stub DOM (scripts/debt-app-sandbox.js),
// so these are the same functions the phone runs, not a copy of them.
//
// What it pins down, in the order the promises matter:
//
//   1. The MINIMUM is the commitment, and 0 means there isn't one. A debt
//      with no minimum (Brewers' trade account, HMRC before a Time to Pay
//      arrangement) is left out of the verdict rather than counted as a
//      promise met by paying nothing. There used to be a separate nullable
//      `floor_payment` for exactly this; `min` already said it, and floors
//      were retired in v2.57.0.
//   2. Minimums and targets are judged separately: every minimum paid is
//      "minimums met" even while targets are outstanding — nothing NEW went
//      overdue, which is the verdict that matters on a light month.
//   3. Income is allocated this month → buffer → savings → targets → living,
//      and never loses or invents a penny.
//   4. This month's money comes OUT OF the ordinary sweep, not on top of it:
//      a month already covered splits exactly as it did before any of this.
//   5. An uncovered minimum becomes arrears at close — a real debt, recorded
//      where real debts go, with no second discretionary ledger beside it.
//
// USAGE (no database, no browser, no server):
//   node scripts/test-minimums.js

const { loadDebtApp, makeReset } = require('./debt-app-sandbox');

const pass = [], fail = [];
const check = (name, ok, detail) => (ok ? pass : fail).push(name + (!ok && detail !== undefined ? ' — ' + JSON.stringify(detail) : ''));
const near = (a, b, tol = 0.011) => Math.abs(a - b) <= tol;

// The app's own script, loaded into a stub DOM (see scripts/debt-app-sandbox.js).
const { app } = loadDebtApp();
const seed = () => app.DEBTS_INITIAL.map(d => ({ ...d }));
const reset = makeReset(app);

// ── 1. the minimum is the commitment, and 0 means there isn't one ─────────
reset();
const BIG = { balance: 10000 };
check('a minimum reads through', app.minDueOf({ ...BIG, min: 50.73 }) === 50.73);
check('no minimum is a commitment of nothing', app.minDueOf({ ...BIG, min: 0 }) === 0);
check('a missing minimum is treated as none', app.minDueOf({ ...BIG }) === 0);
check('a minimum is capped at the balance', app.minDueOf({ balance: 30, min: 205 }) === 30);
check('and at the balance BEFORE an applied payment took its bite',
  app.minDueOf({ balance: 0, min: 205 }, 205) === 205);

{
  // Brewers: a live balance, a due date, and NO contractual minimum. It is on
  // the checklist (its arrears are real) but commits you to nothing.
  reset();
  const fs0 = app.getCycleStatus();
  const brewers = app.getCyclePayments().find(p => p.name === 'Brewers');
  check('a debt with no minimum carries minDue 0', !!brewers && brewers.minDue === 0, brewers && brewers.minDue);
  check('it adds nothing to the minimums total',
    near(fs0.minTotal, fs0.payments.reduce((s, p) => s + p.minDue, 0)));
  check('and it never counts as uncovered — there is nothing to cover',
    fs0.unmet.every(p => p.minDue > 0.005));
}

// ── 2. minimums and targets are judged separately ─────────────────────────
{
  reset();
  const all = app.getCyclePayments();
  const withMin = all.filter(p => p.minDue > 0.005);
  // The light-month case this exists for: every minimum paid, no target hit.
  const underTarget = all.filter(p => p.minDue > 0.005 && p.minDue < p.amount - 0.005);
  check('at least one debt is asked for more than its minimum', underTarget.length >= 1, underTarget.length);
  reset({ minPaidThisCycle: withMin.map(p => p.id) });
  const fs1 = app.getCycleStatus();
  check('floors met while targets are still outstanding',
    fs1.minsMet === true && fs1.targetMet === false, { minsMet: fs1.minsMet, targetMet: fs1.targetMet });
  check('a floors-met month still shows the gap to target',
    fs1.targetPaid < fs1.targetTotal - 0.005, { paid: fs1.targetPaid, total: fs1.targetTotal });

  reset({ paidThisCycle: all.map(p => p.id) });
  const fs2 = app.getCycleStatus();
  check('paying every target meets both', fs2.minsMet && fs2.targetMet);

  // One debt with a minimum deliberately skipped.
  const skipped = withMin[0];
  reset({ paidThisCycle: withMin.slice(1).map(p => p.id), missedThisCycle: [skipped.id] });
  const fs3 = app.getCycleStatus();
  check('one missed minimum fails the minimums verdict', fs3.minsMet === false);
  check('a missed debt reserves no money', near(fs3.outstandingBiz + fs3.outstandingPer, 0),
    { biz: fs3.outstandingBiz, per: fs3.outstandingPer });

  // Pot arithmetic across the four states — the easy thing to get wrong.
  reset({ bizPot: 5000, perPot: 5000 });
  const one = app.getCyclePayments().find(p => p.account === 'personal' && p.minDue > 0.005 && p.minDue < p.amount - 0.005);
  check('found a personal debt asked for more than its minimum', !!one, one && one.name);
  app.setPaymentState(one.id, 'min');
  check('paying the minimum takes only the minimum out of the pot',
    near(app.state.perPot, 5000 - one.minDue), { pot: app.state.perPot, want: 5000 - one.minDue });
  check('the payment reads as minimum-paid', app.paymentState(one.id) === 'min');
  app.setPaymentState(one.id, 'paid');
  check('upgrading to paid refunds the floor and charges the target',
    near(app.state.perPot, 5000 - one.amount), { pot: app.state.perPot, want: 5000 - one.amount });
  app.setPaymentState(one.id, 'paid');
  check('tapping paid again undoes it and refunds in full', near(app.state.perPot, 5000), app.state.perPot);
  check('and leaves it unpaid', app.paymentState(one.id) === 'unpaid');
  app.setPaymentState(one.id, 'missed');
  check('a missed payment takes nothing out of the pot', near(app.state.perPot, 5000), app.state.perPot);
  check('the three cycle lists stay mutually exclusive',
    app.state.paidThisCycle.length + app.state.minPaidThisCycle.length === 0 && app.state.missedThisCycle.length === 1);
}

// ── 3. allocation order and conservation ───────────────────────────────────
{
  // THIS MONTH comes first, then the buffer (v2.56.0 — it used to be the other
  // way round, which built next month's cushion by putting this month's
  // minimums into arrears).
  reset({ bufferTargetPer: 200 });
  const a = app.allocateIncome(150);
  check('this month is funded before the buffer', near(a.buffer, 0) && near(a.biz + a.per, 150), a);

  // Pots already covering this month: now the buffer is next in line, ahead
  // of savings and the sweep.
  reset({ bufferTargetPer: 200, bizPot: 5000, perPot: 5000 });
  const b = app.allocateIncome(150);
  check('with the month covered, the buffer is next', near(b.buffer, 150) && near(b.savings, 0), b);

  reset({ bufferTargetPer: 200, bufferPer: 200, bizPot: 5000, perPot: 5000 });
  const bf = app.allocateIncome(150);
  check('a full buffer takes nothing', near(bf.buffer, 0), bf);

  reset({ bufferTargetPer: 200, bufferPer: 50, bizPot: 5000, perPot: 5000 });
  const c = app.allocateIncome(1000);
  check('buffer takes only what it still needs', near(c.buffer, 150), c);
  check('nothing is lost or invented', near(c.buffer + c.biz + c.per + c.savings + c.keep, 1000),
    { sum: c.buffer + c.biz + c.per + c.savings + c.keep });

  // Income too small for every floor: the arrears-first order decides.
  reset();
  const fsAll = app.getCycleStatus();
  const totalFloors = fsAll.outstandingBiz + fsAll.outstandingPer;
  const d = app.allocateIncome(300);
  check('a light month puts income into floors, not the sweep percentage',
    d.dueFunded > 300 * 0.5, { dueFunded: d.dueFunded });
  check('a light month cannot fund every floor', totalFloors > 300);
  check('floor money still balances', near(d.buffer + d.biz + d.per + d.savings + d.keep, 300));

  // SMALLEST arrears first (v2.48.4, was largest-first): Amex's £65.64 outranks
  // NatWest Loan's £2,662.97. The plan clears the small arrears first, so those
  // are the floors worth funding when income is short — funding the floor of a
  // debt whose arrears nothing will touch for ten months buys nothing.
  // Derived from the seed rather than hardcoded, so it stays true if the
  // starting board changes.
  reset();
  const arrearsWithFloor = seed().filter(x => x.arrears > 0.005 && Number(x.min) > 0.005);
  const smallest = arrearsWithFloor.slice().sort((x, y) => x.arrears - y.arrears)[0];
  const largest = arrearsWithFloor.slice().sort((x, y) => y.arrears - x.arrears)[0];
  check('the seeded smallest-arrears debt (with a floor) is Amex', smallest.name === 'Amex', smallest.name);
  check('and it is on a different account from the largest, so the split is telling',
    smallest.account !== largest.account, { smallest: smallest.account, largest: largest.account });
  const short = app.allocateIncome(400);
  const toSmallest = smallest.account === 'business' ? short.dueBiz : short.duePer;
  const toLargest = smallest.account === 'business' ? short.duePer : short.dueBiz;
  check('the first floors funded are on the smallest-arrears debt\'s account',
    toSmallest > toLargest, { toSmallest, toLargest });
}

// ── 4. floors come out of the sweep, not on top of it ──────────────────────
{
  // Pots already hold every floor, so no floor top-up is needed and the
  // split must match the pre-feature behaviour: sweepPct of income to debt.
  const fsNeed = (() => { reset(); return app.getCycleStatus(); })();
  reset({ bizPot: fsNeed.outstandingBiz, perPot: fsNeed.outstandingPer });
  const e = app.allocateIncome(1000);
  check('with floors covered, the debt sweep is exactly sweepPct of income',
    near(e.biz + e.per, 500), { toDebt: e.biz + e.per });
  check('with floors covered, savings is exactly savingsPct of income', near(e.savings, 100), e.savings);
  check('the rest is living money', near(e.keep, 400), e.keep);
  check('no top-up for this month was needed', near(e.dueFunded, 0));
}

// ── 5. an uncovered minimum becomes arrears, and nothing else does ────────
// There is no second, discretionary ledger any more. A minimum that goes
// unpaid is a real debt and goes where real debts go; a target that is merely
// missed produces nothing at all, because the plan simply re-plans.
{
  reset();
  const before = app.getCyclePayments();
  const withMin = before.filter(p => p.minDue > 0.005);
  const target = withMin[0];

  // Every minimum paid: nothing overdue, even though no target was reached.
  reset({ minPaidThisCycle: withMin.map(p => p.id) });
  const metPayload = app.getCycleArchivePayload();
  check('a minimums-met cycle sends nothing to arrears', metPayload.arrearsAdded.length === 0, metPayload.arrearsAdded);
  check('and is archived as minimums-met, target-missed',
    metPayload.minsMet === true && metPayload.targetMet === false);
  check('minimum-only payments are archived at what actually went out',
    near(metPayload.debtsPaid.reduce((s, d) => s + d.amount, 0),
      withMin.reduce((s, p) => s + p.minDue, 0)));
  check('the archive carries no floor ledger at all',
    metPayload.floorShortfalls === undefined && metPayload.cycleFloorShortfalls === undefined,
    Object.keys(metPayload));

  // Close having paid nothing: every minimum goes overdue.
  reset({ paidThisCycle: [] });
  const payload = app.getCycleArchivePayload();
  check('closing with nothing paid sends every minimum to arrears',
    payload.arrearsAdded.length === withMin.length, payload.arrearsAdded.length);
  check('the cycle verdict is archived', payload.minsMet === false && payload.targetMet === false);
  const entry = payload.arrearsAdded.find(a => a.id === target.id);
  check('what goes overdue is the minimum, not the target payment',
    !!entry && near(entry.amount, target.minDue), { entry, minDue: target.minDue, amount: target.amount });

  // Arrears already at the balance can't grow further.
  const capped = seed().map(d => d.name === 'Brewers' ? { ...d, min: 100 } : d);
  reset({ debts: capped, paidThisCycle: [] });
  const brewersOverdue = app.getCycleArchivePayload().arrearsAdded.find(a => a.name === 'Brewers');
  check('a debt already fully overdue adds nothing more', !brewersOverdue, brewersOverdue);

  // Applying the roll moves it onto the debts, once, and only by that much.
  reset({ paidThisCycle: [] });
  const roll = app.getUnpaidMinimums();
  const beforeArrears = app.state.debts.find(d => d.id === target.id).arrears;
  app.applyUnpaidMinimums(roll);
  const afterArrears = app.state.debts.find(d => d.id === target.id).arrears;
  check('applying the roll adds exactly the uncovered minimum',
    near(afterArrears - beforeArrears, target.minDue), { beforeArrears, afterArrears, minDue: target.minDue });
  check('and never takes arrears past the balance',
    app.state.debts.every(d => d.arrears <= d.balance + 0.005));
}

// ── report ─────────────────────────────────────────────────────────────────
pass.forEach(n => console.log('  ✓ ' + n));
fail.forEach(n => console.log('  ✗ ' + n));
console.log(`\n${pass.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
