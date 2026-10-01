#!/usr/bin/env node
'use strict';

// ── Regression test: moving buffer money into a pot to pay a bill ──────────
//
// Runs the REAL client-side logic out of public/debt.html in the shared
// sandbox (scripts/debt-app-sandbox.js). What this pins down:
//
//   1. `moveBufferToPot()` moves money from one account's jar to the SAME
//      account's pot, never more than the jar holds, never across accounts.
//   2. The "Move buffer to a pot" modal moves exactly the typed amount,
//      opens pre-filled with the pot's shortfall, and caps at the jar.
//   3. The button is on the buffer strip whenever the buffer holds money —
//      with a target set or not.
//   4. Inside the Pay modal, a payment bigger than the pot offers a one-tap
//      top-up from the buffer; afterwards the payment comes out of the pot
//      in full and Undo puts it back in the pot (the buffer stays spent —
//      that was a real bank transfer).
//
// USAGE: node scripts/test-buffer-move.js

const { loadDebtApp, makeReset } = require('./debt-app-sandbox');

const pass = [], fail = [];
const check = (name, ok, detail) => (ok ? pass : fail).push(name + (!ok && detail !== undefined ? ' — ' + JSON.stringify(detail) : ''));
const near = (a, b, tol = 0.011) => Math.abs(a - b) <= tol;

const { app, els } = loadDebtApp();
const reset = makeReset(app);

// ── 1. the move itself ────────────────────────────────────────────────────
reset({ bufferBiz: 300, bufferPer: 500, bizPot: 10, perPot: 20 });
let moved = app.moveBufferToPot('personal', 120);
let s = app.state;
check('moves the amount from the personal jar to the personal pot',
  near(moved, 120) && near(s.bufferPer, 380) && near(s.perPot, 140), s);
check('and leaves the business side alone', near(s.bufferBiz, 300) && near(s.bizPot, 10), s);
moved = app.moveBufferToPot('business', 1000);
s = app.state;
check('never more than the jar holds', near(moved, 300) && near(s.bufferBiz, 0) && near(s.bizPot, 310), s);
check('an empty jar moves nothing', app.moveBufferToPot('business', 50) === 0);
check('a negative amount moves nothing', app.moveBufferToPot('personal', -5) === 0 && near(app.state.bufferPer, 380));

// ── 2. the modal ──────────────────────────────────────────────────────────
reset({ bufferBiz: 0, bufferPer: 500, bizPot: 0, perPot: 0 });
app.openBufferMoveModal();
check('opens on the jar that holds money', els.modalRoot.innerHTML.includes('Move buffer to a pot'));
const short = app.potShortfall('personal');
check('pre-fills the pot shortfall, capped at the jar',
  els.modalRoot.innerHTML.includes(`value="${Math.min(short, 500).toFixed(2)}"`), { short });
els.bufferMoveInput.value = '75.50';
app.confirmBufferMove();
s = app.state;
check('confirm moves exactly the typed amount', near(s.bufferPer, 424.5) && near(s.perPot, 75.5), s);
check('and closes the modal', els.modalRoot.innerHTML === '');

reset({ bufferBiz: 200, bufferPer: 0, bizPot: 0, perPot: 0 });
app.openBufferMoveModal('business');
els.bufferMoveInput.value = '999';
app.bufferMovePreview();
check('the preview says it is capped', els.bufferMovePreview.innerHTML.includes('Capped'));
app.confirmBufferMove();
check('a typed amount over the jar moves the whole jar only',
  near(app.state.bufferBiz, 0) && near(app.state.bizPot, 200), app.state);

// ── 3. the strip offers it ────────────────────────────────────────────────
reset({ bufferPer: 100 });
check('no target set: the strip still offers the move', app.renderBufferStrip().includes('openBufferMoveModal'));
reset({ bufferPer: 100, bufferTargetPer: 500 });
check('target set: the strip offers the move', app.renderBufferStrip().includes('openBufferMoveModal'));
reset({ bufferPer: 0, bufferBiz: 0 });
check('empty buffer: nothing to move, no button', !app.renderBufferStrip().includes('openBufferMoveModal'));

// ── 4. topping up from inside the Pay modal ───────────────────────────────
// Currys (personal, id 2): pay £200 with £50 in the pot and £500 buffered.
reset({ perPot: 50, bufferPer: 500 });
app.openCustomPayModal(2);
els.customPayInput.value = '200';
app.customPayPreview();
check('a payment bigger than the pot offers the buffer top-up',
  els.customPayPreview.innerHTML.includes('topUpPotFromBuffer') && els.customPayPreview.innerHTML.includes('£150.00'),
  els.customPayPreview.innerHTML);
app.topUpPotFromBuffer();
s = app.state;
check('the top-up moves just the difference', near(s.perPot, 200) && near(s.bufferPer, 350), s);
check('and the modal stays open on the same payment', els.modalRoot.innerHTML.includes('Pay Currys'));
check('the warning is gone', !els.customPayPreview.innerHTML.includes('more than the pot holds'));
app.confirmCustomPay();
s = app.state;
check('the payment then comes out of the pot in full',
  near(s.perPot, 0) && near(s.appliedPayments[2].potAmt, 200), s.appliedPayments[2]);
app.undoPayment(2);
s = app.state;
check('undo puts the payment back in the pot; the buffer stays moved',
  near(s.perPot, 200) && near(s.bufferPer, 350), s);

// Business debt, empty business jar, full personal jar: no rescue across accounts.
reset({ bizPot: 0, bufferBiz: 0, bufferPer: 1000 });
app.openCustomPayModal(6);
els.customPayInput.value = '205';
app.customPayPreview();
check('the other account\'s buffer is never offered',
  !els.customPayPreview.innerHTML.includes('topUpPotFromBuffer'), els.customPayPreview.innerHTML);

// A partial jar: offers what it holds, and says so.
reset({ perPot: 0, bufferPer: 60 });
app.openCustomPayModal(2);
els.customPayInput.value = '100';
app.customPayPreview();
check('a jar smaller than the gap offers what it holds',
  els.customPayPreview.innerHTML.includes('Move £60.00') && els.customPayPreview.innerHTML.includes('holds £60.00 of it'),
  els.customPayPreview.innerHTML);

console.log(`\n${pass.length} passed, ${fail.length} failed`);
for (const f of fail) console.log('  ✗ ' + f);
process.exit(fail.length ? 1 : 0);
