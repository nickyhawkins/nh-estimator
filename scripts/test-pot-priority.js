#!/usr/bin/env node
'use strict';

// ── Regression test: which pot the money goes into, and correcting one by hand ─
//
// Exercises the REAL client-side logic out of public/debt.html — the script
// block is extracted and run in a vm with a stub DOM (scripts/debt-app-sandbox.js),
// so these are the same functions the phone runs, not a copy of them.
//
// Two things, both asked for directly:
//
// 1. *"The pots need to fill up to cover the bills due soonest. No point
//    adding more to the personal pot if the business pot has a bill due."*
//
//    Minimums were already funded in due order. The sweep that tops the pots
//    up toward their TARGETS was not: it divided itself between the two pots
//    in proportion to what each was short, which ignores the calendar
//    completely — a business bill due on the 3rd and a personal one due on the
//    28th filled at the same rate. Now the sweep follows the same queue the
//    minimums do (arrears first, then earliest due), and stops at what each
//    payment still wants.
//
//    A sweep bigger than every bill this cycle is a real surplus, and that is
//    deliberately still swept into a pot rather than kept: a pot with money
//    left when the checklist is done is what the surplus button sends at the
//    current target. It goes to the account of the debt the plan is clearing,
//    because that is the only pot that button can spend.
//
// 2. *"Should manually adjusting the pot totals adjust any money owed to the
//    pot?"* — yes, when the pot is being RAISED and something is owed to it.
//    Putting money back by hand is the same act a pay-in performs when it
//    repays a pot loan. Leaving the loan open meant the next pay-in took the
//    same money off the top a second time. It is asked rather than assumed,
//    because a correction and a repayment look identical in the balance.
//
// USAGE (no database, no browser, no server):
//   node scripts/test-pot-priority.js

const { loadDebtApp, makeReset } = require('./debt-app-sandbox');

const pass = [], fail = [];
const check = (name, ok, detail) => (ok ? pass : fail).push(name + (!ok && detail !== undefined ? ' — ' + JSON.stringify(detail) : ''));
const near = (a, b, tol = 0.011) => Math.abs(a - b) <= tol;

const { app, els } = loadDebtApp();
const reset = makeReset(app);

// Two bills, one per account. Equal arrears on both by default, because that
// is the case where the ordering can actually be seen: in the snowball phase
// the plan aims its whole discretionary spend at ONE debt, so only that
// debt's account ever wants money above its minimum and no ordering rule has
// anything to choose between. Equal arrears leaves the due date as the only
// thing separating them, which is exactly what is under test. `due` is the
// day of the month.
const twoBills = (bizDue, perDue, over = {}) => Object.assign({
  debts: [
    { id: 1, name: 'Biz card', balance: 4000, apr: 20, min: 100, arrears: 200, due: bizDue, account: 'business', note: '' },
    { id: 2, name: 'Per card', balance: 4000, apr: 20, min: 100, arrears: 200, due: perDue, account: 'personal', note: '' }
  ],
  budget: 900, savingsPct: 0, sweepPct: 100, bizPot: 0, perPot: 0
}, over);
// The stub DOM keeps whatever a previous scenario typed into a field, where
// the real modal re-renders each input at the pot's current balance — so
// prime them the way the markup does before typing.
function openPots(){
  app.openPotsModal();
  const now = { biz: app.state.bizPot, per: app.state.perPot,
    bufferBiz: app.state.bufferBiz, bufferPer: app.state.bufferPer };
  for (const [key, val] of Object.entries(now)) els[({biz:'bizPotVal',per:'perPotVal',bufferBiz:'bufferBizVal',bufferPer:'bufferPerVal'})[key]].value = val.toFixed(2);
  app.renderPotOwedPanel();
}
function openSavings(){
  app.openSavingsAdjust();
  els.savingsVal.value = app.state.savingsPot.toFixed(2);
  app.renderPotOwedPanel();
}

const loan = (over = {}) => Object.assign({
  id: 1, source_name: 'Personal Pot', is_savings: false, amount: 200,
  note: null, borrowed_at: '2026-09-01', pot: 'per', repaid_amount: 0
}, over);

async function main(){

// ── 1. The bill due soonest is the pot that fills ──────────────────────────
{
  reset(twoBills(3, 27));
  const q = app.targetQueue();
  check('the top-up queue is ordered by due date, like the minimums queue',
    q.length === 2 && q[0].account === 'business' && q[1].account === 'personal', q);

  const a = app.allocateIncome(500);
  check('both minimums are funded first, whichever account they are on',
    near(a.dueBiz, 100) && near(a.duePer, 100), { biz: a.dueBiz, per: a.duePer });
  check('and the top-up goes to the pot whose bill lands first',
    a.biz > a.per, { biz: a.biz, per: a.per });

  // The same week with the due dates the other way round has to flip, or the
  // ordering isn't doing anything.
  reset(twoBills(27, 3));
  check('the queue flips with the due dates', app.targetQueue()[0].account === 'personal');
  const b = app.allocateIncome(500);
  check('swap the due dates and the other pot fills instead',
    b.per > b.biz && near(b.biz + b.per, a.per + a.biz), { biz: b.biz, per: b.per });

  // In the snowball phase the plan pays extra on ONE debt, so there is only
  // ever one account wanting money above its minimums — say so, rather than
  // leaving a reader to wonder why the ordering looks inert there.
  reset(twoBills(3, 27, { debts: [
    { id: 1, name: 'Biz card', balance: 4000, apr: 20, min: 100, arrears: 0, due: 3, account: 'business', note: '' },
    { id: 2, name: 'Per card', balance: 9000, apr: 20, min: 100, arrears: 0, due: 27, account: 'personal', note: '' }
  ] }));
  check('with no arrears, only the snowball target wants topping up at all',
    app.targetQueue().length === 1 && app.targetQueue()[0].account === 'business',
    app.targetQueue());
}

// ── 2. A pot is not topped up past the bill it is kept for ─────────────────
{
  // Business bill first and small; the personal one is bigger and later. Once
  // the business payment is fully funded the money has to move on rather than
  // pile up in a pot with nothing left to cover.
  reset({
    debts: [
      { id: 1, name: 'Biz card', balance: 300, apr: 0, min: 100, arrears: 0, due: 2, account: 'business', note: '' },
      { id: 2, name: 'Per card', balance: 9000, apr: 30, min: 200, arrears: 150, due: 26, account: 'personal', note: '' }
    ],
    budget: 900, savingsPct: 0, sweepPct: 100, bizPot: 0, perPot: 0
  });
  const pay = app.getCyclePayments();
  const biz = pay.find(p => p.account === 'business');
  const a = app.allocateIncome(900);
  check('the business pot gets exactly what its payment asks for, no more',
    a.biz <= biz.target + 0.011, { got: a.biz, wants: biz.target });
  check('and the rest of the week reaches the personal pot',
    a.per > 0.005 && near(a.biz + a.per + a.keep + a.savings + a.buffer, 900),
    { biz: a.biz, per: a.per, keep: a.keep });
}

// ── 3. A genuine surplus still goes where it can be spent ──────────────────
{
  // Far more income than the cycle can use. The leftover is not kept back —
  // it is what the surplus button sends at the current target — but it has to
  // land in the pot that button actually reads, which is the target's own
  // account.
  reset(twoBills(3, 27, { budget: 400 }));
  const target = app.getCurrentTarget();
  const a = app.allocateIncome(20000);
  const surplusPot = target.account === 'business' ? a.biz : a.per;
  const otherPot = target.account === 'business' ? a.per : a.biz;
  check('the surplus lands in the pot the current target is paid from',
    surplusPot > otherPot, { target: target.account, biz: a.biz, per: a.per });
  check('and the sweep is still the whole percentage, not a trimmed one',
    near(a.biz + a.per, 20000 * 100 / 100 - a.savings - a.buffer - a.keep),
    { biz: a.biz, per: a.per, keep: a.keep });
  check('a pay-in that big still adds up',
    near(a.potRepay.total + a.biz + a.per + a.savings + a.buffer + a.keep, 20000));
}

// ── 4. Arrears still come before a nearer due date ─────────────────────────
{
  // The order is the plan's own: arrears first (smallest first), then the
  // calendar. A debt already overdue IS the bill due soonest.
  reset({
    debts: [
      { id: 1, name: 'Biz card', balance: 4000, apr: 20, min: 100, arrears: 0, due: 2, account: 'business', note: '' },
      { id: 2, name: 'Per card', balance: 4000, apr: 20, min: 100, arrears: 300, due: 28, account: 'personal', note: '' }
    ],
    budget: 900, savingsPct: 0, sweepPct: 100, bizPot: 0, perPot: 0
  });
  const q = app.targetQueue();
  check('the overdue debt is first in the queue even though it is due last',
    q.length > 0 && q[0].account === 'personal', q);
  const a = app.allocateIncome(600);
  check('and the catch-up money goes to its pot',
    a.per > a.biz, { biz: a.biz, per: a.per });
}

// ── 5. Raising a pot by hand repays what was borrowed from it ──────────────
{
  reset({ perPot: 0, savingsPct: 0, borrowedActive: [loan({ id: 11, amount: 200, pot: 'per' })] });
  check('the loan is owed before the correction', near(app.potLoansOwed().total, 200));
  openPots();
  els.perPotVal.value = '200';
  app.updatePotOwedPreview();
  check('the modal says what saving it will settle',
    /paid back/.test(els.potOwedPreview.textContent) && /£200\.00/.test(els.potOwedPreview.textContent),
    els.potOwedPreview.textContent);
  await app.confirmPots();
  check('the balance is exactly what was typed — the money is not added twice',
    near(app.state.perPot, 200), app.state.perPot);
  check('and the borrowing is settled', near(app.potLoansOwed().total, 0), app.potLoansOwed());

  // Which is the whole point: the next pay-in must not repay it again.
  const a = app.allocateIncome(500);
  check('so the next pay-in has nothing to put back',
    near(a.potRepay.total, 0), a.potRepay);
}

// ── 6. ...but only if you say that is what it was ──────────────────────────
{
  reset({ perPot: 0, savingsPct: 0, borrowedActive: [loan({ id: 12, amount: 200, pot: 'per' })] });
  openPots();
  els.perPotVal.value = '200';
  app.setPotEditRepays(false);
  app.updatePotOwedPreview();
  check('told it is only a correction, the modal says the money stays owed',
    /stays owed/.test(els.potOwedPreview.textContent), els.potOwedPreview.textContent);
  await app.confirmPots();
  check('the balance is corrected', near(app.state.perPot, 200), app.state.perPot);
  check('and the borrowing is still owed', near(app.potLoansOwed().total, 200), app.potLoansOwed());
}

// ── 7. Only the rise counts, only up to what is owed, only that pot ────────
{
  // A partial correction settles a partial repayment.
  reset({ perPot: 50, savingsPct: 0, borrowedActive: [loan({ id: 21, amount: 200, pot: 'per' })] });
  openPots();
  els.perPotVal.value = '130';
  await app.confirmPots();
  check('raising a pot part way repays that much of the loan',
    near(app.potLoansOwed().total, 120) && near(app.state.perPot, 130),
    { owed: app.potLoansOwed().total, pot: app.state.perPot });

  // More than was ever borrowed is not a bigger repayment.
  reset({ perPot: 0, savingsPct: 0, borrowedActive: [loan({ id: 22, amount: 200, pot: 'per' })] });
  openPots();
  els.perPotVal.value = '1000';
  await app.confirmPots();
  check('a rise past what is owed settles only what is owed',
    near(app.potLoansOwed().total, 0) && near(app.state.perPot, 1000),
    { owed: app.potLoansOwed().total, pot: app.state.perPot });

  // Lowering a pot is a correction and nothing else — it does not invent a
  // loan, and it does not repay one either.
  reset({ perPot: 300, savingsPct: 0, borrowedActive: [loan({ id: 23, amount: 200, pot: 'per' })] });
  openPots();
  els.perPotVal.value = '100';
  await app.confirmPots();
  check('lowering a pot settles nothing',
    near(app.potLoansOwed().total, 200) && near(app.state.perPot, 100),
    { owed: app.potLoansOwed().total, pot: app.state.perPot });

  // One pot's correction is not another pot's repayment.
  reset({ perPot: 0, bizPot: 0, savingsPct: 0, borrowedActive: [loan({ id: 24, amount: 200, pot: 'per' })] });
  openPots();
  els.bizPotVal.value = '500';
  await app.confirmPots();
  check('raising the business pot leaves the personal pot’s borrowing owed',
    near(app.potLoansOwed().total, 200) && near(app.state.bizPot, 500),
    { owed: app.potLoansOwed().total, biz: app.state.bizPot });

  // Two pots corrected at once settle their own loans, oldest first.
  reset({ perPot: 0, bufferPer: 0, savingsPct: 0, borrowedActive: [
    loan({ id: 25, amount: 100, pot: 'per', borrowed_at: '2026-08-02' }),
    loan({ id: 26, amount: 100, pot: 'bufferPer', borrowed_at: '2026-07-01' })
  ] });
  openPots();
  els.perPotVal.value = '100';
  els.bufferPerVal.value = '60';
  await app.confirmPots();
  check('each pot settles its own borrowing, by what it was raised by',
    near(app.potLoansOwed().byPot.bufferPer, 40) && !app.potLoansOwed().byPot.per,
    app.potLoansOwed());
}

// ── 8. The savings pot has its own modal, and behaves the same ─────────────
{
  reset({ savingsPot: 0, savingsPct: 0, borrowedActive: [loan({ id: 31, amount: 150, pot: 'savings', source_name: 'Savings Pot' })] });
  openSavings();
  els.savingsVal.value = '150';
  app.updatePotOwedPreview();
  check('the savings modal offers the same choice',
    /paid back/.test(els.potOwedPreview.textContent), els.potOwedPreview.textContent);
  await app.confirmSavings();
  check('and settles the savings pot’s borrowing',
    near(app.state.savingsPot, 150) && near(app.potLoansOwed().total, 0),
    { pot: app.state.savingsPot, owed: app.potLoansOwed() });
}

// ── 9. Nothing borrowed, nothing said ──────────────────────────────────────
{
  reset({ bizPot: 10, perPot: 20, bufferBiz: 30, bufferPer: 40 });
  openPots();
  check('with no pot loans the modal asks nothing', els.potOwedPanel.innerHTML === '',
    els.potOwedPanel.innerHTML);
  els.bizPotVal.value = '111';
  els.perPotVal.value = '222';
  els.bufferBizVal.value = '333';
  els.bufferPerVal.value = '444';
  await app.confirmPots();
  check('and every balance is set to exactly what was typed',
    near(app.state.bizPot, 111) && near(app.state.perPot, 222)
    && near(app.state.bufferBiz, 333) && near(app.state.bufferPer, 444),
    app.state);
}

}

// ── Report ─────────────────────────────────────────────────────────────────
main().then(()=>{
for (const p of pass) console.log('  ✓ ' + p);
for (const f of fail) console.log('  ✗ ' + f);
console.log(`\n${pass.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
}).catch(err=>{ console.error(err); process.exit(1); });
