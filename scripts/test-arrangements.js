#!/usr/bin/env node
'use strict';

// ── Regression test: agreed arrears payment plans (debt app) ───────────────
//
// Exercises the REAL client-side logic out of public/debt.html — the script
// block is extracted and run in a vm with a stub DOM (scripts/debt-app-sandbox.js),
// so these are the same functions the phone runs, not a copy of them.
//
// An ARRANGEMENT is a fixed monthly instalment a creditor has accepted to
// bring arrears up to date, stored per debt (debt_plan_debts.arrangement_amount,
// nullable — NULL is the only "off" state). What this pins down:
//
//   1. It is a COMMITMENT, not an opportunity. `cycleCommitments()` and
//      `commitmentQueue()` ask for min + arrangement, so a pay-in funds it
//      ahead of the buffer and the sweep, same as a contractual minimum.
//   2. It is OUT of the opportunistic cascade. `simulate()` and
//      `getCurrentTarget()` skip an arrangement debt when handing out the
//      smallest-arrears-first leftover: its catch-up is already funded, so
//      letting it queue as well would pay it twice in one month.
//   3. Paying it splits the way any payment does (Feature 9b): the
//      contractual part keeps the account current, the arrangement part comes
//      off the arrears. No new payment state, no new ledger.
//   4. MISSING it does NOT compound. The arrears simply don't come down —
//      nothing is added on top, because that money is already known to be
//      overdue. What changes is the warning.
//   5. The warning fires only when the ARRANGEMENT PORTION was shorted — not
//      when the debt was overpaid via a "Clear arrears" payment that happens
//      to exceed the instalment.
//
// USAGE (no database, no browser, no server):
//   node scripts/test-arrangements.js

const { loadDebtApp, makeReset } = require('./debt-app-sandbox');

const pass = [], fail = [];
const check = (name, ok, detail) => (ok ? pass : fail).push(name + (!ok && detail !== undefined ? ' — ' + JSON.stringify(detail) : ''));
const near = (a, b, tol = 0.011) => Math.abs(a - b) <= tol;

const { app, els } = loadDebtApp();
const reset = makeReset(app);

// Updraft (id 7): personal, balance 3583.81, min 264.66, arrears 793.98, due 20.
// The realistic shape of an arrangement — a real minimum, real arrears, and a
// creditor who has agreed to £150/mo on top to catch it up.
const UPDRAFT = 7;
const plan = (over = {}) => app.DEBTS_INITIAL.map(d => d.id === UPDRAFT ? { ...d, ...over } : { ...d });
const withArrangement = (amount) => plan({ arrangement: amount });
const rowFor = (id) => app.getCyclePayments().find(p => p.id === id);
const debtFor = (id) => app.state.debts.find(d => d.id === id);

// ── 1. the figures themselves ─────────────────────────────────────────────
reset({ debts: withArrangement(150) });
const d0 = debtFor(UPDRAFT);
check('an arrangement reads back off the debt', near(app.arrangementOf(d0), 150), app.arrangementOf(d0));
check('a debt without one reads as zero, not null', app.arrangementOf(debtFor(3)) === 0);
check('the commitment is the minimum plus the instalment',
  near(app.commitDueOf(d0, 0, 0), 264.66 + 150), app.commitDueOf(d0, 0, 0));
check('the contractual minimum is untouched by it',
  near(app.minDueOf(d0, 0), 264.66), app.minDueOf(d0, 0));

// Capped at what is actually still overdue — you cannot catch up further than
// you are behind.
reset({ debts: plan({ arrangement: 150, arrears: 40 }) });
check('an instalment bigger than the arrears is capped at the arrears',
  near(app.arrangementDueOf(debtFor(UPDRAFT), 0, 0), 40), app.arrangementDueOf(debtFor(UPDRAFT), 0, 0));
reset({ debts: plan({ arrangement: 150, arrears: 0 }) });
check('a debt with no arrears left asks for nothing extra',
  near(app.arrangementDueOf(debtFor(UPDRAFT), 0, 0), 0));
reset({ debts: plan({ arrangement: 150, balance: 300, arrears: 300 }) });
check('and the minimum plus the instalment can never exceed the balance',
  near(app.commitDueOf(debtFor(UPDRAFT), 0, 0), 300), app.commitDueOf(debtFor(UPDRAFT), 0, 0));

// ── 2. funded as a commitment, ahead of the buffer and the sweep ──────────
reset();
const needPlain = app.cycleCommitments();
reset({ debts: withArrangement(150) });
const needArr = app.cycleCommitments();
check('the cycle commits to £150 more once the plan is agreed',
  near(needArr.total, needPlain.total + 150), { plain: needPlain.total, arranged: needArr.total });
check('and it lands on the account the debt is paid from',
  near(needArr.per, needPlain.per + 150) && near(needArr.biz, needPlain.biz), needArr);

const queued = app.commitmentQueue().find(q => q.id === UPDRAFT);
const queuedPlain = (() => { reset(); const q = app.commitmentQueue().find(x => x.id === UPDRAFT); reset({ debts: withArrangement(150) }); return q; })();
check('the funding queue asks for the whole commitment',
  near(queued.amount, queuedPlain.amount + 150), { plain: queuedPlain.amount, arranged: queued.amount });

// A month of commitments — what the buffer target is built from — counts it
// too, or "a month ahead" would be short by the arrangements every month.
reset();
const mmPlain = app.monthlyMinimums();
reset({ debts: withArrangement(150) });
check('a month of commitments includes the instalment',
  near(app.monthlyMinimums().total, mmPlain.total + 150), app.monthlyMinimums());

// The whole point: a pay-in funds it BEFORE the buffer gets a penny.
reset({ debts: withArrangement(150), bufferTargetPer: 800 });
const light = app.allocateIncome(needArr.total);
check('a pay-in that exactly covers the month leaves nothing for the buffer',
  near(light.buffer, 0) && near(light.dueFunded, needArr.total), light);
reset({ debts: withArrangement(150), bufferTargetPer: 800 });
const ample = app.allocateIncome(needArr.total + 200);
check('only what the month did not need reaches the buffer',
  near(ample.dueFunded, needArr.total) && near(ample.buffer, 200), ample);

// ── 3. out of the opportunistic arrears cascade ───────────────────────────
// Updraft has the arrears the cascade would reach first among personal debts;
// with a plan agreed it stops competing for the leftover.
reset({ debts: withArrangement(150) });
const m1 = app.simulate(app.state.debts, app.state.budget)[0];
const pay = m1.payments.find(p => p.id === UPDRAFT);
check('the sim pays exactly the minimum plus the instalment',
  near(pay.total, 264.66 + 150), { total: pay.total, min: pay.minPaid, arrears: pay.arrearsPaid });
check('the instalment is the arrears part of that payment',
  near(pay.minPaid, 264.66) && near(pay.arrearsPaid, 150), pay);
check('and nothing from the cascade is added on top',
  near(pay.arrearsPaid, 150), pay.arrearsPaid);
check('the arrears come down by exactly the instalment',
  near(pay.remainingArrears, 793.98 - 150), pay.remainingArrears);

// Without the plan the same debt takes whatever the cascade reaches it with,
// which on this plan is more than £150 — that is the double-pay being avoided.
reset();
const plainPay = app.simulate(app.state.debts, app.state.budget)[0].payments.find(p => p.id === UPDRAFT);
check('without a plan the same debt does queue for the leftover',
  plainPay.arrearsPaid > 0.005, plainPay.arrearsPaid);

// getCurrentTarget() follows the same rule.
reset({ debts: withArrangement(150) });
const targetArranged = app.getCurrentTarget();
check('the current target is never an arrangement debt while others are behind',
  targetArranged && targetArranged.id !== UPDRAFT, targetArranged && targetArranged.id);
// Every debt in arrears has a plan → the cascade is empty and the app
// snowballs the smallest balance instead.
reset({ debts: app.DEBTS_INITIAL.map(d => d.arrears > 0.005 ? { ...d, arrangement: 50 } : { ...d }) });
const allArranged = app.getCurrentTarget();
check('with every overdue debt on a plan, the target is the snowball one',
  allArranged && allArranged.arrears <= 0.005, allArranged && { id: allArranged.id, arrears: allArranged.arrears });

// ── 4. paying it: the ordinary min/arrears split, no new state ────────────
reset({ debts: withArrangement(150), perPot: 5000 });
const before = debtFor(UPDRAFT);
app.setPaymentState(UPDRAFT, 'paid');
const after = debtFor(UPDRAFT);
const led = app.state.appliedPayments[UPDRAFT];
check('paying in full clears the instalment off the arrears',
  near(before.arrears - after.arrears, 150), { before: before.arrears, after: after.arrears });
check('and takes the whole commitment off the balance',
  near(before.balance - after.balance, led.nominal) && led.nominal >= 264.66 + 150 - 0.011,
  { paid: led.nominal, balance: before.balance - after.balance });
check('it is an ordinary paid tick — no new payment state',
  app.paymentState(UPDRAFT) === 'paid', app.paymentState(UPDRAFT));
app.setPaymentState(UPDRAFT, 'paid'); // tapping again undoes it
check('un-ticking puts the arrears back exactly',
  near(debtFor(UPDRAFT).arrears, before.arrears) && near(debtFor(UPDRAFT).balance, before.balance),
  { arrears: debtFor(UPDRAFT).arrears, balance: debtFor(UPDRAFT).balance });

// The minimum on its own keeps the account current and clears NO arrears.
reset({ debts: withArrangement(150), perPot: 5000 });
app.setPaymentState(UPDRAFT, 'min');
check('paying the minimum alone clears no arrears at all',
  near(debtFor(UPDRAFT).arrears, 793.98), debtFor(UPDRAFT).arrears);
check('and it still covers the contractual minimum',
  app.getCycleStatus().unmet.every(u => u.id !== UPDRAFT));

// ── 5. missing it does not compound ───────────────────────────────────────
reset({ debts: withArrangement(150), perPot: 5000 });
app.setPaymentState(UPDRAFT, 'min'); // minimum paid, instalment shorted
const rolled = app.getUnpaidMinimums();
check('a shorted instalment adds NOTHING to arrears at close',
  rolled.every(r => r.id !== UPDRAFT), rolled);
const arrearsAtClose = debtFor(UPDRAFT).arrears;
app.applyUnpaidMinimums(rolled);
check('so the arrears simply stay where they were',
  near(debtFor(UPDRAFT).arrears, arrearsAtClose), debtFor(UPDRAFT).arrears);
check('and the minimums verdict still reads as met',
  app.getCycleStatus().unmet.every(u => u.id !== UPDRAFT));

// A missed MINIMUM on an arrangement debt still becomes arrears, exactly as
// on any other debt — the instalment changes nothing about that.
reset({ debts: withArrangement(150) });
const unpaid = app.getUnpaidMinimums().find(r => r.id === UPDRAFT);
check('an unpaid minimum on an arrangement debt still rolls into arrears',
  !!unpaid && near(unpaid.amount, 264.66), unpaid);

// ── 6. the warning, and only when the instalment was shorted ─────────────
const atRisk = () => app.getCycleStatus().arrangementsAtRisk;
reset({ debts: withArrangement(150), perPot: 5000 });
check('nothing paid yet: the instalment is outstanding, so the plan is at risk',
  atRisk().some(a => a.id === UPDRAFT), atRisk());
app.setPaymentState(UPDRAFT, 'min');
check('minimum only: still at risk, and by the instalment',
  atRisk().length === 1 && near(atRisk()[0].amount, 150), atRisk());
check('the warning names the cancellation risk, not the arrears',
  /Arrangement at risk/.test(app.arrangementRiskNote()) && !/into arrears/.test(app.arrangementRiskNote()));

reset({ debts: withArrangement(150), perPot: 5000 });
app.setPaymentState(UPDRAFT, 'paid');
check('paid in full: no warning', atRisk().length === 0, atRisk());

// A "Clear arrears" lump — more than the instalment — must NOT raise it.
reset({ debts: withArrangement(150), perPot: 5000 });
const ctx = app.payContext(UPDRAFT);
app.recordPayment(UPDRAFT, ctx.clearArrears, ctx, false);
check('a clear-arrears payment is an overpayment, not a shortfall',
  atRisk().length === 0, { atRisk: atRisk(), paid: ctx.clearArrears });
check('and it really did clear the arrears', near(debtFor(UPDRAFT).arrears, 0), debtFor(UPDRAFT).arrears);

// Under the minimum is both things at once: arrears AND a shorted instalment.
reset({ debts: withArrangement(150), perPot: 5000 });
const ctx2 = app.payContext(UPDRAFT);
app.recordPayment(UPDRAFT, 100, ctx2, false);
check('an under-minimum payment shorts the instalment too',
  atRisk().some(a => a.id === UPDRAFT), atRisk());
check('and the uncovered minimum still becomes arrears',
  app.getUnpaidMinimums().some(r => r.id === UPDRAFT));

// A debt with no arrangement never raises the warning however little is paid.
reset({ perPot: 5000 });
check('a debt without a plan can never be "at risk"', atRisk().length === 0, atRisk());
check('and the close-cycle note is empty when nothing is arranged',
  app.arrangementRiskNote() === '');

// A deliberately missed arrangement is at risk too — that is exactly the case
// worth shouting about — but no money is set aside for it.
reset({ debts: withArrangement(150) });
const outBefore = app.getCycleStatus().outstandingPer;
app.setPaymentState(UPDRAFT, 'missed');
check('a missed arrangement is flagged at risk', atRisk().some(a => a.id === UPDRAFT && a.missed), atRisk());
check('but no pot money is reserved for a debt you chose to skip',
  app.getCycleStatus().outstandingPer < outBefore - 0.005,
  { before: outBefore, after: app.getCycleStatus().outstandingPer });

// ── 7. the checklist row, and editing the figure ─────────────────────────
reset({ debts: withArrangement(150) });
const row = rowFor(UPDRAFT);
check('the checklist row carries the combined commitment',
  near(row.commitDue, 264.66 + 150) && near(row.arrangementDue, 150), row);
check('and it is one row, not a separate arrears line',
  app.getCyclePayments().filter(p => p.id === UPDRAFT).length === 1);
app.setView('cashflow');
app.renderAll();
const cashflowHtml = els.tabContent.innerHTML;
check('the row is badged so the combined figure is not read as a plain minimum',
  /ARRANGEMENT/.test(cashflowHtml));
check('and it says what missing it costs',
  /Arrangement at risk/.test(cashflowHtml));

// Edit Debts: clearing the box ends the plan, and zero is not an arrangement.
reset({ debts: withArrangement(150) });
app.updateDraft(UPDRAFT, 'arrangement', '');
app.applyEdits();
check('clearing the field ends the arrangement (null, not 0)',
  debtFor(UPDRAFT).arrangement === null, debtFor(UPDRAFT).arrangement);
reset({ debts: withArrangement(150) });
app.updateDraft(UPDRAFT, 'arrangement', '0');
app.applyEdits();
check('and typing 0 means the same thing — no agreement',
  debtFor(UPDRAFT).arrangement === null, debtFor(UPDRAFT).arrangement);
reset();
app.updateDraft(UPDRAFT, 'arrangement', '175.50');
app.applyEdits();
check('typing a figure starts one', near(app.arrangementOf(debtFor(UPDRAFT)), 175.5), debtFor(UPDRAFT).arrangement);
check('and it changes nothing else about the debt',
  near(debtFor(UPDRAFT).min, 264.66) && near(debtFor(UPDRAFT).arrears, 793.98));

// ── 8. nothing changes for a plan with no arrangements at all ─────────────
const shape = () => JSON.stringify({
  c: app.cycleCommitments(), q: app.commitmentQueue(),
  t: app.getCurrentTarget() && app.getCurrentTarget().id,
  m: app.monthlyMinimums(), risk: app.getCycleStatus().arrangementsAtRisk
});
reset();
const baseline = shape();
reset({ debts: app.DEBTS_INITIAL.map(d => ({ ...d, arrangement: null })) });
check('an explicit null is identical to no column at all', shape() === baseline,
  { withNull: shape(), without: baseline });
reset({ debts: app.DEBTS_INITIAL.map(d => ({ ...d, arrangement: 0 })) });
check('and so is a stored zero — only a real figure is an agreement', shape() === baseline);

// ── report ─────────────────────────────────────────────────────────────────
console.log('\n── Agreed arrangements ──\n');
for (const p of pass) console.log('  ✓ ' + p);
for (const f of fail) console.log('  ✗ ' + f);
console.log(`\n${pass.length} passed, ${fail.length} failed\n`);
process.exit(fail.length ? 1 : 0);
