#!/usr/bin/env node
'use strict';

// ── Regression test: the month-ahead buffer (debt app) ─────────────────────
//
// Exercises the REAL client-side logic out of public/debt.html — the script
// block is extracted and run in a vm with a stub DOM (scripts/debt-app-sandbox.js),
// so these are the same functions the phone runs, not a copy of them.
//
// The buffer existed before this: one jar, a target capped at £500 by its own
// slider, filled first out of every pay-in and then never spent by anything.
// It could not do the one job worth having it for. What this pins down:
//
//   1. `monthlyMinimums()` is the target that matters — one month of
//      CONTRACTUAL minimums, split by account. Not the floors: a missed floor
//      writes an inert catch-up entry, a missed minimum becomes arrears.
//      Same "in the plan" rule as getCurrentTarget(), each min capped at its
//      balance, and a debt with neither a minimum nor a due date left out.
//   2. Two jars, because bizPot and perPot are two real bank accounts. They
//      fill in proportion to what each still needs, so a light month cannot
//      brim one while the other — the one with a minimum falling due — is
//      empty. Nothing is lost or invented in the split.
//   3. The buffer can be SPENT. `bufferCover()` moves each jar into its own
//      pot against this cycle's uncovered floors, never across accounts, and
//      never more than the jar holds or the pot is short by.
//   4. The transfer panel routes the business share to the business account.
//      It used to send the whole buffer to the personal one, which for a
//      split jar would put the money in the wrong bank.
//   5. An income entry deleted afterwards puts back exactly what it added,
//      per account — including a pre-split entry, whose buffer was personal.
//
// USAGE (no database, no browser, no server):
//   node scripts/test-buffer-month-ahead.js

const { loadDebtApp, makeReset } = require('./debt-app-sandbox');

const pass = [], fail = [];
const check = (name, ok, detail) => (ok ? pass : fail).push(name + (!ok && detail !== undefined ? ' — ' + JSON.stringify(detail) : ''));
const near = (a, b, tol = 0.011) => Math.abs(a - b) <= tol;

const { app } = loadDebtApp();
const reset = makeReset(app);

// ── 1. the target is a month of minimums, split by account ────────────────
reset();
const mm = app.monthlyMinimums();
const seed = app.state.debts;
const expBiz = seed.filter(d => d.account === 'business' && d.balance > 0.005 && (d.min > 0.005 || d.due))
  .reduce((s, d) => s + Math.min(d.min, d.balance), 0);
const expPer = seed.filter(d => d.account === 'personal' && d.balance > 0.005 && (d.min > 0.005 || d.due))
  .reduce((s, d) => s + Math.min(d.min, d.balance), 0);
check('a month of minimums splits business/personal', near(mm.biz, expBiz) && near(mm.per, expPer), { got: mm, want: { biz: expBiz, per: expPer } });
check('and the total is the two added up', near(mm.total, mm.biz + mm.per));
// HMRC and Van: no minimum AND no due date = not in the payment plan.
check('a debt outside the plan contributes nothing',
  near(mm.total, seed.filter(d => d.min > 0.005 || d.due).reduce((s, d) => s + Math.min(d.min, d.balance), 0)));
// A minimum bigger than what is left owing can't be owed in full.
reset({ debts: app.DEBTS_INITIAL.map(d => d.id === 9 ? { ...d, balance: 100 } : { ...d }) });
check('a minimum is capped at its balance', near(app.monthlyMinimums().per, expPer - 520.01 + 100), app.monthlyMinimums().per);

// The one-tap presets set both jars from that figure.
reset();
app.setBufferPreset(1);
check('"one month ahead" sets both targets from the minimums',
  near(app.state.bufferTargetBiz, mm.biz) && near(app.state.bufferTargetPer, mm.per), app.state);
app.setBufferPreset(0.5);
check('"half a month" halves both', near(app.state.bufferTargetBiz, mm.biz / 2) && near(app.state.bufferTargetPer, mm.per / 2));
app.setBufferPreset(0);
check('"off" clears both', app.state.bufferTargetBiz === 0 && app.state.bufferTargetPer === 0);

// ── 2. the two jars fill together, in proportion to what each needs ───────
reset({ bufferTargetBiz: 400, bufferTargetPer: 800 });
const a1 = app.allocateIncome(300);
check('the buffer is still taken before anything else',
  near(a1.buffer, 300) && near(a1.biz, 0) && near(a1.per, 0) && near(a1.savings, 0), a1);
check('and splits in proportion to each jar\'s need', near(a1.bufferBiz, 100) && near(a1.bufferPer, 200), a1);
check('the split loses nothing', near(a1.bufferBiz + a1.bufferPer, a1.buffer));

// A jar already full stops drawing; the other keeps filling.
reset({ bufferTargetBiz: 400, bufferTargetPer: 800, bufferBiz: 400 });
const a2 = app.allocateIncome(300);
check('a full jar takes nothing more', near(a2.bufferBiz, 0) && near(a2.bufferPer, 300), a2);

reset({ bufferTargetBiz: 400, bufferTargetPer: 800, bufferBiz: 400, bufferPer: 800 });
const a3 = app.allocateIncome(1000);
check('a buffer at a month ahead takes nothing at all', near(a3.buffer, 0), a3);
check('and the pay-in splits exactly as it would with no buffer',
  near(a3.buffer + a3.biz + a3.per + a3.savings + a3.keep, 1000));

reset({ bufferTargetBiz: 400, bufferTargetPer: 800 });
const a4 = app.allocateIncome(2000);
check('the buffer never takes more than it still needs', near(a4.buffer, 1200), a4);
check('nothing is lost or invented across the whole allocation',
  near(a4.buffer + a4.biz + a4.per + a4.savings + a4.keep, 2000),
  { sum: a4.buffer + a4.biz + a4.per + a4.savings + a4.keep });

// ── 3. the buffer can be spent, and only into its own account ────────────
// Nothing paid, so every floor is outstanding and both pots are empty.
reset({ bufferTargetBiz: 400, bufferTargetPer: 800, bufferBiz: 400, bufferPer: 800 });
const fs = app.getFloorStatus();
const shortBefore = fs.shortBy;
const c = app.bufferCover();
check('the cover is capped at what each pot is short by',
  near(c.biz, Math.min(400, fs.outstandingBiz)) && near(c.per, Math.min(800, fs.outstandingPer)),
  { cover: c, out: { biz: fs.outstandingBiz, per: fs.outstandingPer } });
app.confirmBufferCover();
const after = app.state;
check('the money leaves the buffer', near(after.bufferBiz, 400 - c.biz) && near(after.bufferPer, 800 - c.per), after);
check('and lands in the matching pot', near(after.bizPot, c.biz) && near(after.perPot, c.per), after);
check('the shortfall drops by exactly what was moved',
  near(app.getFloorStatus().shortBy, shortBefore - c.total),
  { before: shortBefore, after: app.getFloorStatus().shortBy, moved: c.total });

// A buffer that holds a whole month closes the gap outright.
reset({ bufferTargetBiz: 2000, bufferTargetPer: 2000, bufferBiz: 2000, bufferPer: 2000 });
app.confirmBufferCover();
check('a full month in the buffer covers every floor', app.getFloorStatus().shortBy <= 0.005, app.getFloorStatus().shortBy);
check('and there is nothing left to cover', app.bufferCover().total <= 0.005);

// A jar that can't reach says so, and never borrows from the other side.
reset({ bufferTargetBiz: 400, bufferTargetPer: 800, bufferBiz: 10, bufferPer: 800 });
const c2 = app.bufferCover();
check('a short jar covers only what it holds', near(c2.biz, 10), c2);
check('and the remainder is reported, not taken from the other account', c2.stillShort > 0.005, c2);
app.confirmBufferCover();
check('the personal jar was not raided for a business floor',
  near(app.state.bizPot, 10) && app.state.bufferBiz <= 0.005, app.state);

// Pots already covering the floors need nothing from the buffer.
reset({ bufferTargetBiz: 400, bufferTargetPer: 800, bufferBiz: 400, bufferPer: 800, bizPot: 5000, perPot: 5000 });
check('a covered cycle draws nothing', app.bufferCover().total <= 0.005);

// ── 4. the business share is transferred to the business account ─────────
reset({ bufferTargetBiz: 400, bufferTargetPer: 800 });
const a5 = app.allocateIncome(600);
const toBiz = a5.biz + a5.bufferBiz, toPer = a5.per + a5.savings + a5.bufferPer + a5.keep;
check('the buffer\'s business share goes to the business account', near(a5.bufferBiz, 200) && near(toBiz, a5.biz + 200), { a5, toBiz });
check('the two transfers still account for every penny', near(toBiz + toPer, 600), { toBiz, toPer });

// ── 5. deleting an income entry reverses both jars exactly ───────────────
reset({ bufferTargetBiz: 400, bufferTargetPer: 800 });
app.state = Object.assign(app.state, { incomeLog: [] });
const before = { biz: app.state.bufferBiz, per: app.state.bufferPer };
app.state = Object.assign(app.state, {
  bufferBiz: 100, bufferPer: 200,
  incomeLog: [{ id: 1, amount: 300, bizAmt: 0, perAmt: 0, savedAmt: 0, bufferAmt: 300, bufferBizAmt: 100, bufferPerAmt: 200, date: '1 Sep' }]
});
app.deleteIncome(0);
check('deleting a pay-in empties both jars by what it put in',
  near(app.state.bufferBiz, before.biz) && near(app.state.bufferPer, before.per), app.state);
// A pre-split entry carries only the legacy total, and that money was personal.
app.state = Object.assign(app.state, {
  bufferBiz: 0, bufferPer: 250,
  incomeLog: [{ id: 2, amount: 250, bizAmt: 0, perAmt: 0, savedAmt: 0, bufferAmt: 250, date: '1 Aug' }]
});
app.deleteIncome(0);
check('a pre-split entry reverses off the personal jar',
  near(app.state.bufferPer, 0) && near(app.state.bufferBiz, 0), app.state);

// ── report ─────────────────────────────────────────────────────────────────
pass.forEach(n => console.log('  ✓ ' + n));
fail.forEach(n => console.log('  ✗ ' + n));
console.log(`\n${pass.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
