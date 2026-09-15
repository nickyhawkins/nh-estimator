#!/usr/bin/env node
'use strict';

// ── Regression test: every arrear is accounted for (debt app) ──────────────
//
// Exercises the REAL client-side logic out of public/debt.html — the script
// block is extracted and run in a vm with a stub DOM (scripts/debt-app-sandbox.js),
// so these are the same functions the phone runs, not a copy of them.
//
// Reported as "not all the arrears are being taken into account". They were
// all in the header total; what went missing was everything below it.
//
//   1. A debt with arrears and NO contractual minimum (Brewers' trade
//      account, whole balance overdue) takes money only through the arrears
//      queue. In a month the queue never reaches it, its planned payment is
//      £0 — and `p.total > 0.005` dropped it off the cycle checklist
//      altogether. £0 is the honest allocation; the silence was the bug.
//      It now appears as an `unfunded` row: visible, still payable, asking
//      for nothing.
//   2. The ARREARS badge used to mean "this month's payment contains arrears
//      catch-up", so a debt £3,751.74 overdue that could only afford its
//      minimum showed no arrears at all. It now means what it means
//      everywhere else in the app: this debt is overdue, by `arrearsLeft`.
//   3. An unfunded row moves no money and changes no verdict — the floors
//      total, the pot needs and the target total are penny-identical to what
//      they were when the row was missing.
//   4. minDue is capped at the BALANCE, not at the month's planned
//      payment. The old cap zeroed the floor of any debt the budget didn't
//      reach, and quietly shrank a floor set ABOVE the minimum back down to
//      it — both of which made the app's "floors met" disagree with the
//      cycle close in lib/debtCycle.js, which caps at the balance.
//
// USAGE (no database, no browser, no server):
//   node scripts/test-arrears-visibility.js

const { loadDebtApp, makeReset } = require('./debt-app-sandbox');

const pass = [], fail = [];
const check = (name, ok, detail) => (ok ? pass : fail).push(name + (!ok && detail !== undefined ? ' — ' + JSON.stringify(detail) : ''));
const near = (a, b, tol = 0.011) => Math.abs(a - b) <= tol;

const { app } = loadDebtApp();
const reset = makeReset(app);

// The reported plan, near enough: a trade account wholly in arrears and no
// minimum to put it in the sim, alongside a loan far too big for the spare to
// reach. Budget 2950 — the arrears queue empties on Updraft and never gets
// as far as either.
const PLAN = [
  { id: 2,  name: 'Currys',       balance: 645.22,   apr: 39.9, min: 101.46, arrears: 0,       due: 15,   account: 'personal', min: 50.73 },
  { id: 3,  name: 'Natwest CC',   balance: 1039.13,  apr: 26.9, min: 40.03,  arrears: 0,       due: 10,   account: 'personal', min: 40.03 },
  { id: 4,  name: 'PayPal',       balance: 1896.23,  apr: 0,    min: 93.44,  arrears: 0,       due: 11,   account: 'personal', min: 93.44 },
  { id: 5,  name: 'Brewers',      balance: 1700.89,  apr: 0,    min: 0,      arrears: 1700.89, due: 1,    account: 'business', min: null },
  { id: 6,  name: 'Amex',         balance: 3966.56,  apr: 30.4, min: 205,    arrears: 205,     due: 28,   account: 'business', min: 205 },
  { id: 7,  name: 'Updraft',      balance: 3874.99,  apr: 0,    min: 150,    arrears: 1631.94, due: 7,    account: 'personal', min: 150 },
  { id: 8,  name: 'Bounce Back',  balance: 7608.25,  apr: 2.5,  min: 182.08, arrears: 349.55,  due: 14,   account: 'business', min: 182.08 },
  { id: 9,  name: 'NatWest Loan', balance: 17483.41, apr: 19,   min: 520.01, arrears: 3751.74, due: 15,   account: 'personal', min: 520.01 },
  { id: 10, name: 'Van',          balance: 20600,    apr: 0,    min: 0,      arrears: 0,       due: null, account: 'business', min: null },
  { id: 11, name: 'HMRC',         balance: 31510.32, apr: 0,    min: 0,      arrears: 0,       due: null, account: 'business', min: null },
];
const plan = (over = []) => PLAN.map(d => ({ ...d, ...(over.find(o => o.id === d.id) || {}) }));
const load = (debts, budget = 2950) => reset({ debts, budget });
const row = (name) => app.getCyclePayments().find(p => p.name === name);

// ── 1. an unreached arrear is on the checklist, not missing from it ────────
load(plan());
const brewers = row('Brewers');
check('a debt in arrears with no minimum still gets a cycle row', !!brewers);
if (brewers) {
  check('and it is marked unfunded', brewers.unfunded === true);
  check('and it asks for nothing', near(brewers.amount, 0) && near(brewers.target, 0));
  check('and it carries the arrears flag', brewers.arrears === true);
  check('and it says how much is overdue', near(brewers.arrearsLeft, 1700.89), brewers.arrearsLeft);
}
// Debts with no minimum AND no due date are not in the payment plan at all;
// they belong on "Pay another debt", not the checklist.
check('a debt outside the plan stays off the checklist', !row('Van') && !row('HMRC'));

// ── 2. the badge means the debt is overdue, not the payment ────────────────
const nwl = row('NatWest Loan');
check('a debt whose payment is only its minimum still reads as in arrears', !!nwl && nwl.arrears === true);
check('and the row carries the full outstanding arrears', !!nwl && near(nwl.arrearsLeft, 3751.74), nwl && nwl.arrearsLeft);
check('the minimum on its own clears none of the arrears', !!nwl && near(nwl.arrearsAmt, 0));
const updraft = row('Updraft');
check('a partly funded arrear reports only what is left after the payment',
  !!updraft && near(updraft.arrearsLeft, 1631.94 - updraft.arrearsAmt), updraft && { left: updraft.arrearsLeft, paid: updraft.arrearsAmt });
const paypal = row('PayPal');
check('a debt with no arrears carries no arrears flag', !!paypal && paypal.arrears === false && near(paypal.arrearsLeft, 0));

// ── 3. the new row moves no money and changes no verdict ──────────────────
const withRow = app.getCycleStatus();
const totalsWith = app.getCycleTotals();
// The same plan with Brewers cleared to nothing — i.e. the world before the
// row existed. Every money figure has to match.
load(plan([{ id: 5, balance: 0, arrears: 0 }]));
const without = app.getCycleStatus();
const totalsWithout = app.getCycleTotals();
check('the unfunded row leaves the minimums total untouched', near(withRow.minTotal, without.minTotal), { with: withRow.minTotal, without: without.minTotal });
check('and the target total untouched', near(withRow.targetTotal, without.targetTotal), { with: withRow.targetTotal, without: without.targetTotal });
check('and the business pot need untouched', near(totalsWith.businessTotal, totalsWithout.businessTotal));
check('and the personal pot need untouched', near(totalsWith.personalTotal, totalsWithout.personalTotal));
check('and it is not counted as uncovered (it has no minimum)',
  !withRow.unmet.some(p => p.name === 'Brewers'));

// ── 4. minDue is capped at the balance, not at the planned payment ──────
// A floor agreed ABOVE the contractual minimum, in a month with no spare to
// lift the payment above that minimum. The commitment is £400, and it stays
// £400: the old cap read it back as the £40.03 minimum and called it met.
load(plan([{ id: 3, min: 400 }]), 1300);
const cc = row('Natwest CC');
check('a floor above the minimum survives a month with no spare',
  !!cc && near(cc.minDue, 400), cc && { minDue: cc.minDue, target: cc.target });
check('and paying only the minimum leaves that floor unmet',
  app.getCycleStatus().unmet.some(p => p.name === 'Natwest CC'));

// An unfunded row with a floor agreed on it is a real commitment and is
// funded like any other — the money the arrears queue couldn't reach is not
// the same thing as a promise you didn't make.
load(plan([{ id: 5, min: 250 }]));
const brewersFloor = row('Brewers');
check('a floor agreed on an unfunded arrear is not zeroed', !!brewersFloor && near(brewersFloor.minDue, 250), brewersFloor && brewersFloor.minDue);
const fsFloor = app.getCycleStatus();
check('and it counts as an unmet floor until it is paid', fsFloor.unmet.some(p => p.name === 'Brewers'));
check('and the business pot is asked to cover it',
  near(fsFloor.outstandingBiz, without.outstandingBiz + 250), { got: fsFloor.outstandingBiz, want: without.outstandingBiz + 250 });

// The floor can never exceed what is actually left owing.
load(plan([{ id: 2, balance: 30, min: 50.73 }]));
const small = row('Currys');
check('a floor is still capped at the balance', !small || near(small.minDue, 30), small && small.minDue);

// An unfunded row must not hold shut anything gated on "everything paid".
// It asks for £0 and refuses the tick, so counting it as outstanding would
// mean the surplus prompt never appeared again on a plan carrying one.
load(plan());
const fundedIds = app.getCyclePayments().filter(p => !p.unfunded && !p.missed).map(p => p.id);
for (const id of fundedIds) app.setPaymentState(id, 'paid');
const stuck = fundedIds.filter(id => app.paymentState(id) !== 'paid');
check('every fundable row can reach paid with an unfunded row present', stuck.length === 0, stuck);
check('and the unfunded row is not among them — it was never ticked',
  !fundedIds.includes(5) && app.paymentState(5) === 'unpaid', app.paymentState(5));
// Paying the others frees budget, and Brewers stops being unfunded — which is
// the plan working, not the row leaking: it is now a real payment to make.
check('clearing the others moves the budget onto the starved arrears',
  row('Brewers') && row('Brewers').unfunded === false, row('Brewers'));

// ── 5. an unfunded row cannot be ticked into a payment of nothing ─────────
load(plan());
app.setPaymentState(5, 'paid');
check('ticking an unfunded row paid records nothing', app.paymentState(5) === 'unpaid', app.paymentState(5));
check('and leaves the arrears where they were', near(app.state.debts.find(d => d.id === 5).arrears, 1700.89));
// Paying it with your own amount still works, and clears arrears as it goes.
load(plan());
app.state = Object.assign(app.state, {});
const ctx = app.payContext(5);
check('an unfunded row has no plan target to be under', ctx && ctx.target === null, ctx && ctx.target);
check('and "clear arrears" on it is the whole overdue balance', ctx && near(ctx.clearArrears, 1700.89), ctx && ctx.clearArrears);

// ── report ─────────────────────────────────────────────────────────────────
pass.forEach(n => console.log('  ✓ ' + n));
fail.forEach(n => console.log('  ✗ ' + n));
console.log(`\n${pass.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
