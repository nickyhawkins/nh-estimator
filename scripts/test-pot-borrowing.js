#!/usr/bin/env node
'use strict';

// ── Regression test: borrowing from a pot (debt app) ───────────────────────
//
// Exercises the REAL client-side logic out of public/debt.html — the script
// block is extracted and run in a vm with a stub DOM (scripts/debt-app-sandbox.js),
// so these are the same functions the phone runs, not a copy of them.
//
// The feature: the Borrowed tab began as notes about money owed to people,
// with no interaction with pot balances at all. A loan can now name one of the
// app's OWN pots, and then it is not a note — the money comes out of that pot
// when it is logged, and goes back off the top of the next pay-in, BEFORE this
// month's payments, the buffer, savings and the sweep.
//
// What it pins down:
//
//   1. A pot loan is money that has actually left a pot, and what is owed
//      back is the amount less anything already repaid.
//   2. The next pay-in repays it first, oldest borrowing first, and a pay-in
//      too small to clear it repays what it can and leaves the rest.
//   3. The repayment is not double-counted. Every step downstream is computed
//      as if the pot were already whole again — this month's funding, the
//      buffer's gap, the savings percentage — so the same pound is never
//      allocated twice.
//   4. A pay-in still conserves: what is repaid, allocated and kept adds up
//      to what came in.
//   5. Deleting the pay-in reverses BOTH halves — the money comes back out of
//      the pot and the loan re-opens.
//   6. A note-only loan (a person, an outside savings pot) moves nothing,
//      exactly as before.
//
// USAGE (no database, no browser, no server):
//   node scripts/test-pot-borrowing.js

const { loadDebtApp, makeReset } = require('./debt-app-sandbox');

const pass = [], fail = [];
const check = (name, ok, detail) => (ok ? pass : fail).push(name + (!ok && detail !== undefined ? ' — ' + JSON.stringify(detail) : ''));
const near = (a, b, tol = 0.011) => Math.abs(a - b) <= tol;

const { app, els } = loadDebtApp();
const reset = makeReset(app);

let nextId = 1;
// A loan as the server hands it back: `pot` names one of the app's own pots,
// or is absent for the tab's original notes-about-people rows.
const loan = (over = {}) => Object.assign({
  id: nextId++, source_name: 'Savings Pot', is_savings: false, amount: 200,
  note: null, borrowed_at: '2026-09-01', pot: 'savings', repaid_amount: 0
}, over);
// The user's route in: type an amount into Log money in and allocate it.
async function payIn(amount) {
  app.openLogModal();
  // The stub DOM mints an element on first getElementById, and openLogModal
  // only writes an HTML string — so run one preview pass to create the
  // fields before typing into them.
  app.updateSweepPreview();
  els.logAmount.value = String(amount);
  await app.confirmLog();
}
const owed = () => app.potLoansOwed();
const loanById = id => app.state.borrowedActive.find(b => b.id === id);

// Every scenario below awaits (a pay-in commits over the network before it
// settles), so they run inside one async main rather than at the top level.
async function main(){

// ── 1. What a pot loan owes ────────────────────────────────────────────────
{
  reset({ savingsPot: 500, borrowedActive: [loan({ id: 101, amount: 200 })] });
  check('a pot loan is owed back to the pot it names',
    near(owed().total, 200) && near(owed().byPot.savings, 200), owed());
  check('and it is the only kind of row that owes a pot anything',
    app.potLoans().length === 1);

  // Part-repaid: what is owed is what is left, not what was borrowed.
  reset({ savingsPot: 500, borrowedActive: [loan({ id: 102, amount: 200, repaid_amount: 75 })] });
  check('a part-repaid loan owes only the rest', near(owed().total, 125), owed());
  check('and the row reports it', near(app.loanOutstanding(loanById(102)), 125));

  // A note about money owed to a person is not a pot loan and never was.
  reset({ savingsPot: 500, borrowedActive: [loan({ id: 103, pot: null, source_name: 'Dave' })] });
  check('a loan from a person owes no pot anything', near(owed().total, 0), owed());
  // Neither is a row naming a pot this version doesn't have.
  reset({ savingsPot: 500, borrowedActive: [loan({ id: 104, pot: 'holiday_fund' })] });
  check('nor does a row naming a pot the app does not hold', near(owed().total, 0), owed());
}

// ── 2. A pot cannot go negative ────────────────────────────────────────────
{
  reset({ savingsPot: 80 });
  const moved = app.potMove('savings', -200);
  check('taking more than a pot holds takes what it holds',
    near(moved, -80) && near(app.state.savingsPot, 0),
    { moved, pot: app.state.savingsPot });
}

// ── 3. The next pay-in repays it, before anything else ─────────────────────
{
  reset({ savingsPot: 300, borrowedActive: [loan({ id: 201, amount: 200 })] });
  const plan = app.potRepayPlan(1000);
  check('a pay-in big enough repays the loan in full',
    near(plan.total, 200) && plan.loans.length === 1 && near(plan.loans[0].amount, 200), plan);

  const a = app.allocateIncome(1000);
  check('the allocation puts it back before anything else',
    near(a.potRepay.total, 200), a.potRepay);
  check('and a pay-in still adds up to what came in',
    near(a.potRepay.total + a.biz + a.per + a.savings + a.buffer + a.keep, 1000),
    { repay: a.potRepay.total, biz: a.biz, per: a.per, savings: a.savings, buffer: a.buffer, keep: a.keep });

  await payIn(1000);
  check('the money is back in the pot it came out of',
    near(app.state.savingsPot, 500), app.state.savingsPot);
  check('nothing is owed any more', near(owed().total, 0), owed());
  check('and the loan is recorded as repaid in full',
    near(loanById(201).repaid_amount, 200), loanById(201));
  const entry = app.state.incomeLog[0];
  check('the pay-in keeps what it repaid, so it can be undone',
    !!entry.potRepay && near(entry.potRepay.total, 200), entry.potRepay);
}

// ── 4. Too small a pay-in repays what it can ───────────────────────────────
{
  reset({ savingsPot: 0, borrowedActive: [loan({ id: 301, amount: 500 })] });
  await payIn(120);
  check('a pay-in smaller than the loan repays all of itself',
    near(app.state.savingsPot, 120), app.state.savingsPot);
  check('and the rest is still owed', near(owed().total, 380), owed());
  check('with nothing left over to allocate or keep',
    near(app.state.bizPot, 0) && near(app.state.perPot, 0), 
    { biz: app.state.bizPot, per: app.state.perPot });

  await payIn(500);
  check('the pay-in after it finishes the job', near(owed().total, 0), owed());
  check('the pot has the whole 500 back', near(app.state.savingsPot, 500), app.state.savingsPot);
  check('and only what was left of the loan came out of the second pay-in',
    near(app.state.incomeLog[1].potRepay.total, 380), app.state.incomeLog[1].potRepay);
}

// ── 5. Oldest borrowing first, across pots ─────────────────────────────────
{
  reset({ savingsPot: 0, bufferPer: 0, borrowedActive: [
    loan({ id: 401, amount: 100, pot: 'savings', borrowed_at: '2026-08-02' }),
    loan({ id: 402, amount: 100, pot: 'bufferPer', borrowed_at: '2026-07-01' })
  ] });
  const plan = app.potRepayPlan(150);
  check('the oldest borrowing is repaid first',
    plan.loans[0].id === 402 && near(plan.loans[0].amount, 100), plan.loans);
  check('and what is left goes to the next one',
    plan.loans[1].id === 401 && near(plan.loans[1].amount, 50), plan.loans);
  check('the per-pot split is what actually moves',
    near(plan.byPot.bufferPer, 100) && near(plan.byPot.savings, 50), plan.byPot);

  await payIn(150);
  check('both pots get their share', near(app.state.bufferPer, 100) && near(app.state.savingsPot, 50),
    { buffer: app.state.bufferPer, savings: app.state.savingsPot });
  check('and 50 is still owed', near(owed().total, 50), owed());
}

// ── 6. The same pound is never allocated twice ─────────────────────────────
{
  // A savings-pot loan being repaid IS this week's saving — setting the
  // percentage aside again on top would take it out of living money twice.
  // The pots start full so this month is already covered and the pay-in
  // actually reaches the savings step (this month comes first, always).
  const covered = { bizPot: 5000, perPot: 5000, savingsPot: 0, savingsPct: 10 };
  reset(covered);
  const noLoan = app.allocateIncome(1000);
  check('10% of a covered month goes to savings when nothing is borrowed',
    near(noLoan.savings, 100), noLoan.savings);
  reset(Object.assign({}, covered, { borrowedActive: [loan({ id: 501, amount: 50, pot: 'savings' })] }));
  const a = app.allocateIncome(1000);
  check('repaying the savings pot counts toward the savings percentage',
    near(a.potRepay.total + a.savings, 100), { repay: a.potRepay.total, savings: a.savings });
  check('so the savings pot ends up in the same place either way',
    near(a.potRepay.total + a.savings, noLoan.savings));
  check('and living money is not squeezed for it twice',
    near(a.keep, noLoan.keep), { withLoan: a.keep, without: noLoan.keep });

  // A buffer loan being repaid closes the buffer's gap; the pay-in must not
  // fund the same gap a second time.
  reset({ bufferPer: 0, bufferTargetPer: 300, savingsPct: 0,
    borrowedActive: [loan({ id: 502, amount: 300, pot: 'bufferPer' })] });
  const b = app.allocateIncome(5000);
  check('repaying a buffer jar fills the buffer, so the pay-in does not refill it',
    near(b.potRepay.total, 300) && near(b.buffer, 0), { repay: b.potRepay.total, buffer: b.buffer });

  // ...and money going back into a spending pot funds this month's payments,
  // so the pay-in does not have to send it there twice. The statement is an
  // equivalence: borrowing 400 from the business pot and paying it straight
  // back leaves the plan exactly where never borrowing at all would have.
  reset({ bizPot: 0, savingsPct: 0, sweepPct: 0,
    borrowedActive: [loan({ id: 503, amount: 400, pot: 'biz' })] });
  const withLoan = app.allocateIncome(2000);
  await payIn(2000);
  const borrowedThenRepaid = { pot: app.state.bizPot };
  reset({ bizPot: 400, savingsPct: 0, sweepPct: 0 });
  const whole = app.allocateIncome(2000);
  await payIn(2000);
  const neverBorrowed = { pot: app.state.bizPot };
  check('the month is funded by the same new money either way',
    near(withLoan.biz, whole.biz), { withLoan: withLoan.biz, whole: whole.biz });
  check('and a borrowed-then-repaid pot ends exactly where an untouched one does',
    JSON.stringify(borrowedThenRepaid) === JSON.stringify(neverBorrowed),
    { borrowedThenRepaid, neverBorrowed });
  // Where it is NOT equivalent, and shouldn't be: living money. The 400 was
  // spent when it was borrowed, so this week's pay-in has 400 less to live on
  // — the cost of the loan landing where the loan actually put it.
  check('the borrowing is paid for out of living money, once',
    near(whole.keep - withLoan.keep, 400), { withLoan: withLoan.keep, whole: whole.keep });
}

// ── 7. Undoing the pay-in undoes the repayment ─────────────────────────────
{
  reset({ savingsPot: 0, borrowedActive: [loan({ id: 601, amount: 200 })] });
  await payIn(1000);
  check('the loan is closed by the pay-in', near(owed().total, 0), owed());
  const potAfter = app.state.savingsPot;

  await app.deleteIncome(0);
  check('deleting the pay-in takes the repayment back out of the pot',
    near(app.state.savingsPot, potAfter - 200), app.state.savingsPot);
  check('and the loan is owed again', near(owed().total, 200), owed());
  check('the pay-in is gone from the log', app.state.incomeLog.length === 0);
}

// ── 8. Repaying by hand does the same thing, now ───────────────────────────
{
  reset({ savingsPot: 100, borrowedActive: [loan({ id: 701, amount: 200, repaid_amount: 50 })] });
  await app.confirmRepay(701);
  check('marking a pot loan repaid puts the outstanding money straight back',
    near(app.state.savingsPot, 250), app.state.savingsPot);

  // A note about money owed to a person still moves nothing at all.
  reset({ savingsPot: 100, perPot: 40, borrowedActive: [loan({ id: 702, pot: null, source_name: 'Dave' })] });
  await app.confirmRepay(702);
  check('marking a note-only loan repaid moves no money',
    near(app.state.savingsPot, 100) && near(app.state.perPot, 40),
    { savings: app.state.savingsPot, per: app.state.perPot });
}

// ── 9. A pay-in with nothing borrowed is untouched ─────────────────────────
{
  reset({ bizPot: 0, perPot: 0, savingsPct: 10 });
  const before = app.allocateIncome(1200);
  reset({ bizPot: 0, perPot: 0, savingsPct: 10, borrowedActive: [loan({ id: 801, pot: null, source_name: 'Dave', amount: 300 })] });
  const after = app.allocateIncome(1200);
  check('a loan from a person changes no allocation figure',
    JSON.stringify(before) === JSON.stringify(after));
  check('and repays nothing', near(after.potRepay.total, 0), after.potRepay);
}

}

// ── Report ─────────────────────────────────────────────────────────────────
main().then(()=>{
for (const p of pass) console.log('  ✓ ' + p);
for (const f of fail) console.log('  ✗ ' + f);
console.log(`\n${pass.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
}).catch(err=>{ console.error(err); process.exit(1); });
