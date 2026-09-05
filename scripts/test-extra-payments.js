#!/usr/bin/env node
'use strict';

// ── Regression test: a second payment in the same cycle (debt app) ──────────
//
// Exercises the REAL client-side logic out of public/debt.html — the script
// block is extracted and run in a vm with a stub DOM (scripts/debt-app-sandbox.js),
// so these are the same functions the phone runs, not a copy of them.
//
// Two faults, one cause: money that moved without being recorded as a payment.
//
//   1. The surplus button ("all bills are paid, send what's left to your
//      current target") wrote the new balance and zeroed the pot by hand. It
//      touched neither applied_payments nor the tick-lists, so the cycle
//      closed with no trace of it — nothing in History's debts-paid, nothing
//      in the total paid, and nothing covering a minimum it had just paid
//      several times over. It also emptied the pot whatever the balance was,
//      so a surplus bigger than the target debt destroyed the difference.
//
//   2. Paying a debt the checklist had already ticked meant unticking it —
//      refunding the balance, the arrears and the pot — and re-entering the
//      two payments added together, against figures the first one had already
//      moved. The modal now takes the top-up directly.
//
// Both routes go through recordPayment() now, which is what makes the checks
// below the same checks: a payment is a payment however it was entered.
//
// USAGE (no database, no browser, no server):
//   node scripts/test-extra-payments.js

const { loadDebtApp, makeReset } = require('./debt-app-sandbox');

const pass = [], fail = [];
const check = (name, ok, detail) => (ok ? pass : fail).push(name + (!ok && detail !== undefined ? ' — ' + JSON.stringify(detail) : ''));
const near = (a, b, tol = 0.011) => Math.abs(a - b) <= tol;

const { app, els } = loadDebtApp();
const reset = makeReset(app);

const debt = id => app.state.debts.find(d => d.id === id);
const row = id => app.getCyclePayments().find(p => p.id === id);
const ledger = id => app.state.appliedPayments[id];
// The user's route in. `mode` is which reading of the box the row's link
// opens: 'add' (what you have just paid, on top of the cycle) or 'total'
// (everything the cycle has paid against this debt).
function payVia(id, mode, amount) {
  app.openCustomPayModal(id, mode);
  els.customPayInput.value = String(amount);
  app.confirmCustomPay();
}

const AMEX = 6;     // business · balance 4065.64 · arrears 65.64 · min 205 · target 270.64
const CURRYS = 2;   // personal · balance 965.72 · no arrears · min 25

// A plan with nothing overdue anywhere: getCurrentTarget() then snowballs the
// smallest balance (Currys) and STAYS there while it is being paid, which is
// what lets the surplus checks name the debt they are about to land on.
const noArrears = () => app.DEBTS_INITIAL.map(d => ({ ...d, arrears: 0 }));

// ── 1. The surplus is recorded as a payment ────────────────────────────────
{
  reset({ bizPot: 1000 });
  const target = app.getCurrentTarget();
  check('the surplus lands on the current target (smallest arrears first)',
    target.id === AMEX, target && target.id);

  app.confirmSurplus();
  check('it comes off the balance', near(debt(AMEX).balance, 4065.64 - 1000), debt(AMEX).balance);
  check('it clears the arrears on the way', near(debt(AMEX).arrears, 0), debt(AMEX).arrears);
  check('and the pot pays for it', near(app.state.bizPot, 0), app.state.bizPot);

  // The bug: all of the above already worked. None of it was a PAYMENT.
  const entry = ledger(AMEX);
  check('the surplus writes a ledger entry', !!entry && near(entry.nominal, 1000), entry);
  check('the debt reads as paid this cycle', app.paymentState(AMEX) === 'custom', app.paymentState(AMEX));
  check('it appears on the checklist at what went out', near(row(AMEX).amount, 1000), row(AMEX).amount);
  check('measured against the target the plan asked for', near(row(AMEX).target, 270.64), row(AMEX).target);

  const payload = app.getCycleArchivePayload();
  const archived = payload.debtsPaid.find(p => p.id === AMEX);
  check('History records it as a payment', !!archived && near(archived.amount, 1000), archived);
  check('and counts it in the cycle total',
    near(payload.debtsPaid.reduce((s, x) => s + x.amount, 0), 1000),
    payload.debtsPaid);
  check('a minimum paid several times over is not left uncovered',
    !app.getCycleStatus().unmet.some(p => p.id === AMEX),
    app.getCycleStatus().unmet);
  check('nor sent to arrears at the close',
    !payload.arrearsAdded.some(a => a.id === AMEX), payload.arrearsAdded);
}

// ── 2. It goes ON TOP of what the cycle already paid ───────────────────────
{
  // The surplus prompt only appears once the checklist is done, so the debt
  // it lands on has usually been ticked already. Overwriting that entry would
  // lose the first payment and refund a pot that never got the money back.
  reset({ debts: noArrears(), perPot: 500 });
  const target = app.getCurrentTarget();
  check('with nothing overdue the target is the smallest balance',
    target.id === CURRYS, target && target.id);

  // With nothing overdue anywhere the whole personal budget snowballs onto
  // the target, so its planned payment is well above the 25.00 minimum.
  const planned = row(CURRYS).amount;
  app.setPaymentState(CURRYS, 'paid');
  check('the planned payment goes out first', near(app.state.perPot, 500 - planned),
    { pot: app.state.perPot, planned });

  app.confirmSurplus();
  check('the surplus adds to the payment rather than replacing it',
    near(ledger(CURRYS).nominal, 500), ledger(CURRYS));
  check('the balance moves once, by the two together',
    near(debt(CURRYS).balance, 965.72 - 500), debt(CURRYS).balance);
  check('and the pot is charged once, for the two together',
    near(app.state.perPot, 0), app.state.perPot);

  // Undo is the promise that makes the ledger trustworthy — it has to put
  // back the whole of it, not just the part the surplus added.
  app.undoPayment(CURRYS);
  check('undo restores the balance and the pot in full',
    near(debt(CURRYS).balance, 965.72) && near(app.state.perPot, 500),
    { balance: debt(CURRYS).balance, pot: app.state.perPot });
}

// ── 3. A surplus bigger than the debt keeps the change ─────────────────────
{
  reset({ debts: noArrears(), perPot: 1500 });
  const target = app.getCurrentTarget();
  app.confirmSurplus();
  check('the surplus clears the target outright', near(debt(target.id).balance, 0), debt(target.id).balance);
  check('and the money it did not need stays in the pot',
    near(app.state.perPot, 1500 - 965.72), app.state.perPot);
  check('the payment is recorded at what the debt actually took',
    near(ledger(target.id).nominal, 965.72), ledger(target.id));
}

// ── 4. Paying more on a row that is already ticked ─────────────────────────
{
  reset({ bizPot: 2000 });
  app.setPaymentState(AMEX, 'paid'); // 205 minimum + 65.64 arrears = 270.64
  check('the planned payment is what the pot loses first',
    near(app.state.bizPot, 2000 - 270.64), app.state.bizPot);

  payVia(AMEX, 'add', 100);
  check('a top-up is added to the cycle, not swapped for it',
    near(ledger(AMEX).nominal, 370.64), ledger(AMEX));
  check('the balance is down by both payments',
    near(debt(AMEX).balance, 4065.64 - 370.64), debt(AMEX).balance);
  check('the pot has paid for both, once each',
    near(app.state.bizPot, 2000 - 370.64), app.state.bizPot);
  check('the row still knows what the plan asked for',
    near(row(AMEX).target, 270.64), row(AMEX).target);
  check('and reads as an amount of your own now it is over the target',
    app.paymentState(AMEX) === 'custom');

  // ...and undo still puts back every penny of it.
  app.undoPayment(AMEX);
  check('undo after a top-up restores balance, arrears and pot',
    near(debt(AMEX).balance, 4065.64) && near(debt(AMEX).arrears, 65.64) && near(app.state.bizPot, 2000),
    { balance: debt(AMEX).balance, arrears: debt(AMEX).arrears, pot: app.state.bizPot });
}

// ── 5. "Change the total" still means the total ────────────────────────────
{
  // The old reading of the box, unchanged: re-entering an amount replaces the
  // payment. Both readings exist because both are things people mean.
  reset({ bizPot: 2000 });
  app.setPaymentState(AMEX, 'paid');
  payVia(AMEX, 'total', 100);
  check('changing the total replaces the payment',
    near(ledger(AMEX).nominal, 100), ledger(AMEX));
  check('the pot is refunded for the payment it replaced',
    near(app.state.bizPot, 1900), app.state.bizPot);
  check('and an amount back under the minimum puts the arrears back',
    near(debt(AMEX).arrears, 65.64), debt(AMEX).arrears);
  check('which leaves the minimum uncovered again',
    app.getCycleStatus().unmet.some(p => p.id === AMEX));
}

// ── 6. A top-up on a minimum-only payment ──────────────────────────────────
{
  // The most ordinary case of all: the minimum went out on payday, the rest
  // when the money landed. The second payment must catch up the arrears the
  // first one deliberately did not touch.
  reset({ bizPot: 2000 });
  app.setPaymentState(AMEX, 'min'); // 205, clears no arrears
  check('a minimum payment leaves the arrears where they were',
    near(debt(AMEX).arrears, 65.64), debt(AMEX).arrears);

  payVia(AMEX, 'add', 65.64);
  check('topping it up to the target clears them',
    near(debt(AMEX).arrears, 0), debt(AMEX).arrears);
  check('the cycle has paid the target between the two',
    near(ledger(AMEX).nominal, 270.64), ledger(AMEX));
  check('and the row leaves the minimum-only state behind',
    !app.state.minPaidThisCycle.includes(AMEX) && app.state.paidThisCycle.includes(AMEX));
}

// ── 7. You still cannot pay more than is owed ──────────────────────────────
{
  reset({ bizPot: 5000 });
  payVia(AMEX, 'total', 4000);
  payVia(AMEX, 'add', 500); // 4500 against a 4065.64 balance
  check('a top-up past the balance is capped at the balance',
    near(debt(AMEX).balance, 0) && near(ledger(AMEX).nominal, 4065.64),
    { balance: debt(AMEX).balance, nominal: ledger(AMEX).nominal });
  check('and the pot is only charged what was owed',
    near(app.state.bizPot, 5000 - 4065.64), app.state.bizPot);
}

// ── 8. The modal says which reading it is on ───────────────────────────────
{
  reset({ bizPot: 2000 });
  app.openCustomPayModal(AMEX, 'add');
  check('nothing paid yet means there is nothing to add to — it opens on the total',
    els.modalRoot.innerHTML.includes('Amount paid') && !els.modalRoot.innerHTML.includes('Change the total'));

  app.setPaymentState(AMEX, 'paid');
  app.openCustomPayModal(AMEX, 'add');
  const html = els.modalRoot.innerHTML;
  check('a paid row opens on the top-up reading', html.includes('Extra payment'));
  check('and says what the cycle has already paid', html.includes('270.64 already paid this cycle'));
  check('with both readings offered', html.includes('Change the total') && html.includes('Pay more'));
  check('the box starts empty rather than repeating the payment', html.includes('value=""'));

  // Switching reading carries the figure across rather than starting again.
  // (The stub input keeps its own value — the browser's is re-rendered from
  // the markup, so the markup is what these check.)
  els.customPayInput.value = '100';
  app.setCustomPayMode('total');
  check('100 more reads as a 370.64 total', els.modalRoot.innerHTML.includes('value="370.64"'),
    els.modalRoot.innerHTML.match(/value="[\d.]*"/g));
  els.customPayInput.value = '370.64';
  app.setCustomPayMode('add');
  check('and back the other way', els.modalRoot.innerHTML.includes('value="100.00"'),
    els.modalRoot.innerHTML.match(/value="[\d.]*"/g));

  // The preview reads the box the same way the confirm does.
  els.customPayInput.value = '100';
  app.customPayPreview();
  check('the preview counts the top-up against what is still owed',
    els.customPayPreview.innerHTML.includes('£3,795.00') && els.customPayPreview.innerHTML.includes('£3,695.00'),
    els.customPayPreview.innerHTML);
  check('and shows the cycle total the payment adds up to',
    els.customPayPreview.innerHTML.includes('£370.64'), els.customPayPreview.innerHTML);
  check('customPayTotal() is the figure that gets recorded',
    near(app.customPayTotal(), 370.64), app.customPayTotal());
}

// ── 9. The surplus is the same act as typing the amount in ─────────────────
{
  // The strongest statement of the fix: after the button and after the modal,
  // the plan is in the SAME state. It also pins the third fault the surplus
  // had — it moved money without splitting it, so arrears the payment had
  // covered several times over stayed on the debt and stayed in the queue.
  const run = how => {
    reset({ bizPot: 3000, perPot: 3000 });
    for (const p of app.getCyclePayments()) if (!p.unfunded) app.setPaymentState(p.id, 'paid');
    const t = app.getCurrentTarget();
    const surplus = t.account === 'business' ? app.state.bizPot : app.state.perPot;
    if (how === 'button') app.confirmSurplus();
    else payVia(t.id, 'add', surplus);
    return { id: t.id, balance: debt(t.id).balance, arrears: debt(t.id).arrears,
      pot: t.account === 'business' ? app.state.bizPot : app.state.perPot,
      nominal: ledger(t.id).nominal,
      paid: app.getCycleArchivePayload().debtsPaid.reduce((s, x) => s + x.amount, 0) };
  };
  const button = run('button'), typed = run('modal');
  check('the surplus button and the same amount typed in agree exactly',
    JSON.stringify(button) === JSON.stringify(typed), { button, typed });
  check('and the surplus catches up the arrears it more than covers',
    near(button.arrears, 0), button);
}

// ── Report ─────────────────────────────────────────────────────────────────
for (const p of pass) console.log('  ✓ ' + p);
for (const f of fail) console.log('  ✗ ' + f);
console.log(`\n${pass.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
