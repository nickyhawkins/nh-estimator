#!/usr/bin/env node
'use strict';

// ── Regression test: floor & target payments (debt app) ─────────────────────
//
// Exercises the REAL client-side logic out of public/debt.html — the script
// block is extracted and run in a vm with a stub DOM (scripts/debt-app-sandbox.js),
// so these are the same functions the phone runs, not a copy of them.
//
// What it pins down, in the order the feature's promises matter:
//
//   1. A floor of null ("not agreed yet", e.g. Brewers/HMRC) is NOT a floor
//      of £0. An unset debt is left out of the floors verdict instead of
//      counting as a commitment that is met by paying nothing.
//   2. Floors and targets are judged separately: every floor paid is
//      "floors met" even while targets are outstanding — the whole point of
//      the feature is removing the all-or-nothing month.
//   3. Income is allocated buffer → floors (arrears first) → savings →
//      targets → living, and never loses or invents a penny.
//   4. Floors come OUT OF the ordinary sweep, not on top of it: a month whose
//      floors are already covered splits exactly as it did before floors
//      existed.
//   5. A missed floor is recorded as a shortfall and is NOT rolled into the
//      next cycle's required payment. This is the promise the whole feature
//      rests on — nothing compounds unless the user taps Catch up.
//
// USAGE (no database, no browser, no server):
//   node scripts/test-floor-payments.js

const { loadDebtApp, makeReset } = require('./debt-app-sandbox');

const pass = [], fail = [];
const check = (name, ok, detail) => (ok ? pass : fail).push(name + (!ok && detail !== undefined ? ' — ' + JSON.stringify(detail) : ''));
const near = (a, b, tol = 0.011) => Math.abs(a - b) <= tol;

// The app's own script, loaded into a stub DOM (see scripts/debt-app-sandbox.js).
const { app } = loadDebtApp();
const seed = () => app.DEBTS_INITIAL.map(d => ({ ...d }));
const reset = makeReset(app);

// ── 1. null floor is not a zero floor ──────────────────────────────────────
reset();
check('unset floor reads as null, not 0', app.floorOf({ floorPayment: null }) === null);
check('empty-string floor reads as null', app.floorOf({ floorPayment: '' }) === null);
check('numeric floor reads through', app.floorOf({ floorPayment: 50.73 }) === 50.73);
check('a real floor of 0 is kept as 0', app.floorOf({ floorPayment: 0 }) === 0);

{
  // Brewers has no contractual minimum, so in the seeded plan it takes no
  // month-1 payment at all. Give it one to prove an unset floor stays unset
  // and is surfaced rather than treated as a met commitment of £0.
  const withBrewers = seed().map(d => d.name === 'Brewers' ? { ...d, min: 50 } : d);
  reset({ debts: withBrewers });
  const fs0 = app.getFloorStatus();
  const brewers = fs0.payments.find(p => p.name === 'Brewers');
  check('a paying debt with no floor agreed carries floorDue null',
    !!brewers && brewers.floorDue === null, brewers);
  check('debts with no floor are counted for the "set a floor" nudge', fs0.noFloorSet === 1, fs0.noFloorSet);
  check('an unset floor adds nothing to the floor total',
    near(fs0.floorTotal, app.getFloorStatus().payments.reduce((s, p) => s + (p.floorDue || 0), 0)));
  check('an unset floor does not block the floors verdict',
    fs0.unmet.every(p => p.floorDue !== null));
}

// ── 2. floors and targets are judged separately ────────────────────────────
{
  reset();
  const all = app.getCyclePayments();
  const withFloor = all.filter(p => p.floorDue !== null);
  // The bad-month case the whole feature exists for: every floor paid, no
  // target reached.
  const underTarget = all.filter(p => p.floorDue !== null && p.floorDue < p.amount - 0.005);
  check('at least one debt is asked for more than its floor', underTarget.length >= 1, underTarget.length);
  reset({ floorPaidThisCycle: withFloor.map(p => p.id) });
  const fs1 = app.getFloorStatus();
  check('floors met while targets are still outstanding',
    fs1.floorsMet === true && fs1.targetMet === false, { floorsMet: fs1.floorsMet, targetMet: fs1.targetMet });
  check('a floors-met month still shows the gap to target',
    fs1.targetPaid < fs1.targetTotal - 0.005, { paid: fs1.targetPaid, total: fs1.targetTotal });

  reset({ paidThisCycle: all.map(p => p.id) });
  const fs2 = app.getFloorStatus();
  check('paying every target meets both', fs2.floorsMet && fs2.targetMet);

  // One floor-carrying debt deliberately skipped.
  const skipped = withFloor[0];
  reset({ paidThisCycle: withFloor.slice(1).map(p => p.id), missedThisCycle: [skipped.id] });
  const fs3 = app.getFloorStatus();
  check('one missed floor fails the floors verdict', fs3.floorsMet === false);
  check('a missed debt reserves no money', near(fs3.outstandingBiz + fs3.outstandingPer, 0),
    { biz: fs3.outstandingBiz, per: fs3.outstandingPer });

  // Pot arithmetic across the four states — the easy thing to get wrong.
  reset({ bizPot: 5000, perPot: 5000 });
  const one = app.getCyclePayments().find(p => p.account === 'personal' && p.floorDue !== null && p.floorDue < p.amount - 0.005);
  check('found a personal debt asked for more than its floor', !!one, one && one.name);
  app.setPaymentState(one.id, 'floor');
  check('paying the floor takes only the floor out of the pot',
    near(app.state.perPot, 5000 - one.floorDue), { pot: app.state.perPot, want: 5000 - one.floorDue });
  check('the payment reads as floor-paid', app.paymentState(one.id) === 'floor');
  app.setPaymentState(one.id, 'paid');
  check('upgrading to paid refunds the floor and charges the target',
    near(app.state.perPot, 5000 - one.amount), { pot: app.state.perPot, want: 5000 - one.amount });
  app.setPaymentState(one.id, 'paid');
  check('tapping paid again undoes it and refunds in full', near(app.state.perPot, 5000), app.state.perPot);
  check('and leaves it unpaid', app.paymentState(one.id) === 'unpaid');
  app.setPaymentState(one.id, 'missed');
  check('a missed payment takes nothing out of the pot', near(app.state.perPot, 5000), app.state.perPot);
  check('the three cycle lists stay mutually exclusive',
    app.state.paidThisCycle.length + app.state.floorPaidThisCycle.length === 0 && app.state.missedThisCycle.length === 1);
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
  const fsAll = app.getFloorStatus();
  const totalFloors = fsAll.outstandingBiz + fsAll.outstandingPer;
  const d = app.allocateIncome(300);
  check('a light month puts income into floors, not the sweep percentage',
    d.floorFunded > 300 * 0.5, { floorFunded: d.floorFunded });
  check('a light month cannot fund every floor', totalFloors > 300);
  check('floor money still balances', near(d.buffer + d.biz + d.per + d.savings + d.keep, 300));

  // SMALLEST arrears first (v2.48.4, was largest-first): Amex's £65.64 outranks
  // NatWest Loan's £2,662.97. The plan clears the small arrears first, so those
  // are the floors worth funding when income is short — funding the floor of a
  // debt whose arrears nothing will touch for ten months buys nothing.
  // Derived from the seed rather than hardcoded, so it stays true if the
  // starting board changes.
  reset();
  const arrearsWithFloor = seed().filter(x => x.arrears > 0.005 && app.floorOf(x) !== null);
  const smallest = arrearsWithFloor.slice().sort((x, y) => x.arrears - y.arrears)[0];
  const largest = arrearsWithFloor.slice().sort((x, y) => y.arrears - x.arrears)[0];
  check('the seeded smallest-arrears debt (with a floor) is Amex', smallest.name === 'Amex', smallest.name);
  check('and it is on a different account from the largest, so the split is telling',
    smallest.account !== largest.account, { smallest: smallest.account, largest: largest.account });
  const short = app.allocateIncome(400);
  const toSmallest = smallest.account === 'business' ? short.floorBiz : short.floorPer;
  const toLargest = smallest.account === 'business' ? short.floorPer : short.floorBiz;
  check('the first floors funded are on the smallest-arrears debt\'s account',
    toSmallest > toLargest, { toSmallest, toLargest });
}

// ── 4. floors come out of the sweep, not on top of it ──────────────────────
{
  // Pots already hold every floor, so no floor top-up is needed and the
  // split must match the pre-feature behaviour: sweepPct of income to debt.
  const fsNeed = (() => { reset(); return app.getFloorStatus(); })();
  reset({ bizPot: fsNeed.outstandingBiz, perPot: fsNeed.outstandingPer });
  const e = app.allocateIncome(1000);
  check('with floors covered, the debt sweep is exactly sweepPct of income',
    near(e.biz + e.per, 500), { toDebt: e.biz + e.per });
  check('with floors covered, savings is exactly savingsPct of income', near(e.savings, 100), e.savings);
  check('the rest is living money', near(e.keep, 400), e.keep);
  check('no floor top-up was needed', near(e.floorFunded, 0));
}

// ── 5. a missed floor is recorded, never auto-applied ──────────────────────
{
  reset();
  const before = app.getCyclePayments();
  const target = before.find(p => p.floorDue !== null);
  // A floor that was actually paid records no shortfall.
  reset({ floorPaidThisCycle: before.filter(p => p.floorDue !== null).map(p => p.id) });
  const metPayload = app.getCycleArchivePayload();
  check('a floors-met cycle records no shortfalls', metPayload.cycleFloorShortfalls.length === 0);
  check('a floors-met, target-missed cycle is archived as exactly that',
    metPayload.floorsMet === true && metPayload.targetMet === false);
  check('floor-only payments are archived at what actually went out',
    near(metPayload.debtsPaid.reduce((s, d) => s + d.amount, 0),
      before.filter(p => p.floorDue !== null).reduce((s, p) => s + p.floorDue, 0)));
  // Close a cycle having paid nothing.
  reset({ paidThisCycle: [] });
  const payload = app.getCycleArchivePayload();
  check('closing with nothing paid records a shortfall per floor-carrying debt',
    payload.cycleFloorShortfalls.length === before.filter(p => p.floorDue !== null).length,
    payload.cycleFloorShortfalls.length);
  check('the cycle verdict is archived', payload.floorsMet === false && payload.targetMet === false);
  const entry = payload.floorShortfalls.find(f => f.id === target.id);
  check('the shortfall is the floor, not the target payment',
    !!entry && near(entry.amount, target.floorDue), { entry, floorDue: target.floorDue, amount: target.amount });
  check('the shortfall is stamped with when it started', !!entry && !!entry.since);

  // Carrying that ledger into the next cycle must not change what is asked for.
  reset({ floorShortfalls: payload.floorShortfalls });
  const after = app.getCyclePayments();
  const sameAsk = before.every(p => {
    const now = after.find(x => x.id === p.id);
    return now && near(now.amount, p.amount) && (p.floorDue === null ? now.floorDue === null : near(now.floorDue, p.floorDue));
  });
  check('a carried shortfall does NOT increase next cycle\'s required payment', sameAsk);
  const fsNext = app.getFloorStatus();
  check('a carried shortfall does not change this cycle\'s floor total',
    near(fsNext.floorTotal, app.getFloorStatus().floorTotal));

  // A second bad cycle accumulates onto the same debt rather than duplicating it.
  const second = app.getCycleArchivePayload();
  const merged = second.floorShortfalls.filter(f => f.id === target.id);
  check('a repeat miss accumulates on one ledger entry', merged.length === 1, merged);
  check('the accumulated amount is the sum of both misses',
    near(merged[0].amount, target.floorDue * 2), { got: merged[0] && merged[0].amount, want: target.floorDue * 2 });
}

// ── report ─────────────────────────────────────────────────────────────────
pass.forEach(n => console.log('  ✓ ' + n));
fail.forEach(n => console.log('  ✗ ' + n));
console.log(`\n${pass.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
