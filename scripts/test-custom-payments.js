#!/usr/bin/env node
'use strict';

// ── Regression test: paying your own amount (debt app) ──────────────────────
//
// Exercises the REAL client-side logic out of public/debt.html — the script
// block is extracted and run in a vm with a stub DOM (scripts/debt-app-sandbox.js),
// so these are the same functions the phone runs, not a copy of them.
//
// The feature: a payment no longer has to be one of the two figures the plan
// computes (the target, or the floor). A lump sum can clear an account's
// arrears outright, and a bad month can send part of one.
//
// What it pins down, in the order the feature's promises matter:
//
//   1. The amount goes where the plan would have put it: the contractual
//      minimum first (which keeps the account current and clears no arrears),
//      everything above it onto the arrears.
//   2. "Clear arrears" does exactly that — nothing overdue is left behind.
//   3. Undo puts back precisely what was taken, pot included, from any
//      amount. This is what makes the ledger trustworthy.
//   4. An amount is judged on what it actually was: under the floor leaves
//      the floor unmet and the shortfall on the catch-up ledger; under the
//      minimum leaves the rest to become arrears at close. Ticking a payment
//      is not the same as covering it.
//   5. A debt with nothing planned this cycle can still be paid — that is
//      the case a lump sum most often lands on (a trade account with no
//      minimum, sitting entirely in arrears).
//   6. A tick with no ledger entry — a cycle that was already open before
//      applied_payments existed — still reads as covered, exactly as it did
//      before. Nothing in a live cycle turns into arrears on deploy.
//
// USAGE (no database, no browser, no server):
//   node scripts/test-custom-payments.js

const { loadDebtApp, makeReset } = require('./debt-app-sandbox');

const pass = [], fail = [];
const check = (name, ok, detail) => (ok ? pass : fail).push(name + (!ok && detail !== undefined ? ' — ' + JSON.stringify(detail) : ''));
const near = (a, b, tol = 0.011) => Math.abs(a - b) <= tol;

const { app, els } = loadDebtApp();
const reset = makeReset(app);

const debt = id => app.state.debts.find(d => d.id === id);
const row = id => app.getCyclePayments().find(p => p.id === id);
// The user's route in: open the modal, type an amount, confirm.
function payCustom(id, amount) {
  app.openCustomPayModal(id);
  els.customPayInput.value = String(amount);
  app.confirmCustomPay();
}

const AMEX = 6;      // balance 4065.64, arrears 65.64, min 205, floor 205
const BREWERS = 5;   // no minimum, no floor, entirely in arrears, no planned payment
const CURRYS = 2;

// ── 1. The split: minimum first, arrears with the rest ─────────────────────
{
  reset({ bizPot: 2000 });
  const before = { ...debt(AMEX) };
  const planned = row(AMEX);
  check('the seeded plan pays Amex its minimum plus its arrears',
    near(planned.minAmt, 205) && near(planned.arrearsAmt, 65.64));

  // Under the minimum: keeps nothing current, catches nothing up.
  reset({ bizPot: 2000 });
  payCustom(AMEX, 50);
  check('a payment below the minimum clears no arrears',
    near(debt(AMEX).arrears, before.arrears), debt(AMEX).arrears);
  check('but it still comes off the balance',
    near(debt(AMEX).balance, before.balance - 50), debt(AMEX).balance);
  check('and out of the account it belongs to', near(app.state.bizPot, 1950), app.state.bizPot);

  // Above the minimum: the surplus is arrears catch-up.
  reset({ bizPot: 2000 });
  payCustom(AMEX, 235); // 205 minimum + 30 towards the 65.64 arrears
  check('everything above the minimum goes onto the arrears',
    near(debt(AMEX).arrears, 35.64), debt(AMEX).arrears);

  // A lump sum: more than the plan ever asked for.
  reset({ bizPot: 2000 });
  payCustom(AMEX, 1000);
  check('a lump sum clears the arrears and keeps going at the balance',
    near(debt(AMEX).arrears, 0) && near(debt(AMEX).balance, before.balance - 1000),
    { arrears: debt(AMEX).arrears, balance: debt(AMEX).balance });
}

// ── 2. Clear arrears means clear arrears ───────────────────────────────────
{
  reset({ bizPot: 3000 });
  const ctx = app.payContext(BREWERS);
  check('a debt with no planned payment still has a context to pay from', !!ctx);
  check('"clear arrears" on a wholly-overdue trade account is its balance',
    near(ctx.clearArrears, 2200.89), ctx.clearArrears);
  app.openCustomPayModal(BREWERS);
  check('the modal opens pre-filled with the arrears-clearing figure',
    els.modalRoot.innerHTML.includes('value="2200.89"'));

  payCustom(BREWERS, ctx.clearArrears);
  check('nothing overdue is left on it', near(debt(BREWERS).arrears, 0), debt(BREWERS).arrears);
  check('and the account is cleared outright', near(debt(BREWERS).balance, 0), debt(BREWERS).balance);
  check('the pot paid for it', near(app.state.bizPot, 3000 - 2200.89), app.state.bizPot);

  // A debt with no month-1 payment drops out of the sim entirely, so the
  // checklist has to keep the row on the strength of the ledger alone.
  const r = row(BREWERS);
  check('the payment appears on this cycle\'s checklist', !!r && near(r.amount, 2200.89));
  check('it is flagged as an amount of your own', !!r && r.custom === true);
  check('and its state reads as custom', app.paymentState(BREWERS) === 'custom');

  const archived = app.getCycleArchivePayload().debtsPaid.find(p => p.id === BREWERS);
  check('it is archived at what actually went out', !!archived && near(archived.amount, 2200.89));
}

// ── 3. Undo puts back exactly what was taken ───────────────────────────────
{
  for (const amount of [50, 235, 1000, 4065.64]) {
    reset({ bizPot: 5000 });
    const before = { ...debt(AMEX) };
    payCustom(AMEX, amount);
    app.undoPayment(AMEX);
    const after = debt(AMEX);
    check(`undoing a ${amount} payment restores the balance, arrears and pot`,
      near(after.balance, before.balance) && near(after.arrears, before.arrears) && near(app.state.bizPot, 5000),
      { balance: after.balance, arrears: after.arrears, pot: app.state.bizPot });
    check(`undoing a ${amount} payment leaves no state behind`,
      app.paymentState(AMEX) === 'unpaid' && !app.state.appliedPayments[AMEX]);
  }

  // Changing your mind about the amount must not charge the pot twice.
  reset({ bizPot: 5000 });
  payCustom(AMEX, 1000);
  payCustom(AMEX, 300);
  check('re-entering an amount replaces the payment rather than stacking on it',
    near(app.state.bizPot, 4700) && near(debt(AMEX).balance, 4065.64 - 300),
    { pot: app.state.bizPot, balance: debt(AMEX).balance });

  // ...and neither must switching to one of the computed states.
  reset({ bizPot: 5000 });
  payCustom(AMEX, 1000);
  app.setPaymentState(AMEX, 'missed');
  check('switching a custom payment to missed refunds it in full',
    near(app.state.bizPot, 5000) && near(debt(AMEX).balance, 4065.64) && near(debt(AMEX).arrears, 65.64),
    { pot: app.state.bizPot, balance: debt(AMEX).balance });

  reset({ bizPot: 5000 });
  payCustom(AMEX, 50);
  app.setPaymentState(AMEX, 'paid');
  check('upgrading a part payment to the full target charges the target, not the sum of both',
    near(app.state.bizPot, 5000 - 270.64) && near(debt(AMEX).balance, 4065.64 - 270.64),
    { pot: app.state.bizPot, balance: debt(AMEX).balance });
}

// ── 4. An amount is judged on what it actually was ─────────────────────────
{
  reset({ bizPot: 2000 });
  payCustom(AMEX, 50); // floor is 205
  const fsUnder = app.getFloorStatus();
  check('a payment under the floor leaves that floor unmet',
    fsUnder.floorsMet === false && fsUnder.unmet.some(p => p.id === AMEX),
    fsUnder.unmet.map(p => p.id));
  check('the row still knows what the target was', near(row(AMEX).target, 270.64), row(AMEX).target);
  check('the floor it is judged against is the plan\'s, not the amount paid',
    near(row(AMEX).floorDue, 205), row(AMEX).floorDue);
  check('the target is not met by an underpayment', fsUnder.targetMet === false);

  const unpaidMin = app.getUnpaidMinimums().find(a => a.id === AMEX);
  check('the uncovered part of the minimum is what becomes arrears',
    !!unpaidMin && near(unpaidMin.amount, 155), unpaidMin);

  const payload = app.getCycleArchivePayload();
  const shortfall = payload.cycleFloorShortfalls.find(f => f.id === AMEX);
  check('closing the cycle puts the whole floor on the catch-up ledger',
    !!shortfall && near(shortfall.amount, 205), shortfall);
  check('and the payment is archived at what went out, not at the target',
    near(payload.debtsPaid.find(p => p.id === AMEX).amount, 50));

  // Reaching the floor settles it, whatever route the money took.
  reset({ bizPot: 2000 });
  payCustom(AMEX, 205);
  check('a payment that reaches the floor meets it',
    !app.getFloorStatus().unmet.some(p => p.id === AMEX));
  check('and covers the contractual minimum with it',
    !app.getUnpaidMinimums().some(a => a.id === AMEX));

  // Overpaying is not a shortfall on anything.
  reset({ bizPot: 2000 });
  payCustom(AMEX, 1000);
  check('a lump sum meets both the floor and the target for that debt',
    !app.getFloorStatus().unmet.some(p => p.id === AMEX) &&
    near(app.paidAmountOf(row(AMEX)), 1000));
}

// ── 4b. The ledger records what every payment was measured against ─────────
{
  // Not just custom ones: a floor payment now knows the target it fell short
  // of, which the row could only ever report as "£0.00 under target" while
  // the only figure kept was the one that went out.
  reset({ bizPot: 2000 });
  app.setPaymentState(AMEX, 'floor');
  const entry = app.state.appliedPayments[AMEX];
  check('a floor payment records the target it fell short of',
    !!entry && near(entry.target, 270.64) && near(entry.nominal, 205), entry);
  check('and the row can say how far under it landed',
    near(row(AMEX).target - row(AMEX).floorDue, 65.64));

  // ...so changing one to an amount of your own is still judged against the
  // plan's target rather than against the floor it is replacing.
  payCustom(AMEX, 300);
  check('a floor payment changed to your own amount keeps the plan\'s target',
    near(row(AMEX).target, 270.64), row(AMEX).target);
  check('and the pot is charged once, for the new amount only',
    near(app.state.bizPot, 1700), app.state.bizPot);
}

// ── 5. You cannot pay more than is owed ────────────────────────────────────
{
  reset({ perPot: 5000 });
  const owed = app.payContext(CURRYS).balance;
  payCustom(CURRYS, owed + 500);
  check('an amount above the balance is capped at the balance',
    near(debt(CURRYS).balance, 0) && near(app.state.perPot, 5000 - owed),
    { balance: debt(CURRYS).balance, pot: app.state.perPot });
}

// ── 6. Ticks made before the ledger existed still read as covered ──────────
{
  // A cycle that was open before applied_payments shipped carries ids in the
  // tick-lists with nothing in the ledger. Reading those as "paid nothing"
  // would turn a settled cycle into a pile of arrears at close.
  reset({ paidThisCycle: [AMEX], appliedPayments: {} });
  check('a ledger-less "paid" tick still covers its floor',
    !app.getFloorStatus().unmet.some(p => p.id === AMEX));
  check('a ledger-less "paid" tick still covers its minimum',
    !app.getUnpaidMinimums().some(a => a.id === AMEX));
  check('and it is not mistaken for a custom amount', app.paymentState(AMEX) === 'paid');

  reset({ floorPaidThisCycle: [AMEX], appliedPayments: {} });
  check('a ledger-less "floor paid" tick still covers its floor',
    !app.getFloorStatus().unmet.some(p => p.id === AMEX));
}

// ── Report ─────────────────────────────────────────────────────────────────
for (const p of pass) console.log('  ✓ ' + p);
for (const f of fail) console.log('  ✗ ' + f);
console.log(`\n${pass.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
