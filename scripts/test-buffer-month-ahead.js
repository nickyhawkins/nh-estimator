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

const { app, els } = loadDebtApp(); // els: the stub DOM the modals write into
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

// ── 2. this month first, THEN the two jars, together ─────────────────────
// The order was the other way round until v2.56.0, and on a light month that
// poured the whole pay-in into next month's cushion while this month's
// minimums went into arrears — the cushion built out of the very thing it
// exists to prevent.
reset({ bufferTargetBiz: 400, bufferTargetPer: 800 });
const need0 = app.cycleCommitments();
const a0 = app.allocateIncome(600);
check('a light month funds this month, not the buffer',
  near(a0.buffer, 0) && near(a0.biz + a0.per, 600), a0);
check('and it goes to the pots that owe money', a0.dueFunded > 0 && near(a0.dueFunded, 600), a0);
check('a pay-in bigger than the month funds the month first, then the buffer',
  (() => { const a = app.allocateIncome(need0.total + 300); return near(a.dueFunded, need0.total) && near(a.buffer, 300); })(),
  { need: need0.total, got: app.allocateIncome(need0.total + 300) });

// The steady state: month already funded from the buffer on day one, so the
// pots cover this cycle and income flows straight back into the jars.
const COVERED = { bizPot: 5000, perPot: 5000 };
reset({ bufferTargetBiz: 400, bufferTargetPer: 800, ...COVERED });
const a1 = app.allocateIncome(300);
check('with the month covered, the buffer refills before savings and the sweep',
  near(a1.buffer, 300) && near(a1.savings, 0), a1);
check('and splits in proportion to each jar\'s need', near(a1.bufferBiz, 100) && near(a1.bufferPer, 200), a1);
check('the split loses nothing', near(a1.bufferBiz + a1.bufferPer, a1.buffer));

// A jar already full stops drawing; the other keeps filling.
reset({ bufferTargetBiz: 400, bufferTargetPer: 800, bufferBiz: 400, ...COVERED });
const a2 = app.allocateIncome(300);
check('a full jar takes nothing more', near(a2.bufferBiz, 0) && near(a2.bufferPer, 300), a2);

reset({ bufferTargetBiz: 400, bufferTargetPer: 800, bufferBiz: 400, bufferPer: 800, ...COVERED });
const a3 = app.allocateIncome(1000);
check('a buffer at a month ahead takes nothing at all', near(a3.buffer, 0), a3);
check('and the pay-in splits exactly as it would with no buffer',
  near(a3.buffer + a3.biz + a3.per + a3.savings + a3.keep, 1000));

reset({ bufferTargetBiz: 400, bufferTargetPer: 800, ...COVERED });
const a4 = app.allocateIncome(2000);
check('the buffer never takes more than it still needs', near(a4.buffer, 1200), a4);
check('nothing is lost or invented across the whole allocation',
  near(a4.buffer + a4.biz + a4.per + a4.savings + a4.keep, 2000),
  { sum: a4.buffer + a4.biz + a4.per + a4.savings + a4.keep });

// ── 3. the buffer can be spent, and only into its own account ────────────
// Nothing paid, so every floor is outstanding and both pots are empty.
reset({ bufferTargetBiz: 400, bufferTargetPer: 800, bufferBiz: 400, bufferPer: 800 });
const fs = app.getCycleStatus();
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
  near(app.getCycleStatus().shortBy, shortBefore - c.total),
  { before: shortBefore, after: app.getCycleStatus().shortBy, moved: c.total });

// A buffer that holds a whole month closes the gap outright.
reset({ bufferTargetBiz: 2000, bufferTargetPer: 2000, bufferBiz: 2000, bufferPer: 2000 });
app.confirmBufferCover();
check('a full month in the buffer covers every floor', app.getCycleStatus().shortBy <= 0.005, app.getCycleStatus().shortBy);
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

// ── 3b. funding is measured against the contractual minimum ─────────────
// The buffer is SIZED on contractual minimums, because those are what become
// arrears, and it is now FUNDED against the same number. (There used to be a
// separate discretionary floor that could sit below the minimum, so this had
// to take the higher of the two; floors were retired in v2.57.0 and `min` is
// the only commitment there is.)
{
  reset({ bufferTargetBiz: 2000, bufferTargetPer: 2000, bufferBiz: 2000, bufferPer: 2000 });
  const need = app.cycleCommitments();
  const status = app.getCycleStatus();
  check('what must be funded is exactly this cycle\'s uncovered minimums',
    near(need.biz, status.outstandingBiz) && near(need.per, status.outstandingPer),
    { need, out: { biz: status.outstandingBiz, per: status.outstandingPer } });
  // A debt with no minimum (Brewers' trade account) commits you to nothing.
  const brewers = app.getCyclePayments().find(p => p.name === 'Brewers');
  check('a debt with no minimum asks the buffer for nothing', !brewers || brewers.minDue <= 0.005, brewers && brewers.minDue);
  app.confirmBufferCover();
  check('and the pots then hold every minimum',
    app.state.perPot >= need.per - 0.005 && app.state.bizPot >= need.biz - 0.005,
    { pots: { biz: app.state.bizPot, per: app.state.perPot }, need });
  check('with nothing left for the buffer to fund', app.bufferCover().total <= 0.005);
}
// Money already paid is not funded twice.
{
  const split = app.DEBTS_INITIAL.map(d => ({ ...d }));
  reset({ debts: split, bufferTargetBiz: 2000, bufferTargetPer: 2000, bufferBiz: 2000, bufferPer: 2000 });
  const before = app.cycleCommitments().biz;
  app.setPaymentState(6, 'paid'); // Amex, a business debt
  check('a payment already made drops out of what must still be funded',
    app.cycleCommitments().biz < before - 0.005, { before, after: app.cycleCommitments().biz });
  // A deliberately missed debt sets no money aside, exactly as the pots don't.
  reset({ debts: app.DEBTS_INITIAL.map(d => ({ ...d })), bufferTargetBiz: 2000, bufferTargetPer: 2000, bufferBiz: 2000, bufferPer: 2000 });
  const b2 = app.cycleCommitments().biz;
  app.setPaymentState(6, 'missed');
  check('a missed debt is not funded', app.cycleCommitments().biz < b2 - 0.005);
}

// ── 3c. the close warns rather than spending the buffer itself ──────────
{
  reset({ bufferTargetBiz: 2000, bufferTargetPer: 2000, bufferBiz: 2000, bufferPer: 2000 });
  const warn = app.renderBufferRescue();
  check('an unfunded cycle with a full buffer is warned about', warn.includes('still unfunded'), warn.slice(0, 80));
  check('and the warning offers the transfer', warn.includes('openBufferCoverModal'));
  // The close itself must never move the money — it is a real bank transfer.
  const held = { biz: app.state.bufferBiz, per: app.state.bufferPer };
  app.getCycleArchivePayload();
  check('closing does not spend the buffer by itself',
    near(app.state.bufferBiz, held.biz) && near(app.state.bufferPer, held.per), app.state);
  // Funded up front, there is nothing to warn about.
  app.confirmBufferCover();
  check('a funded cycle raises no warning', app.renderBufferRescue() === '');
}

// ── 3d. the target is a snapshot, and says so when it drifts ────────────
{
  reset();
  app.setBufferPreset(1);
  check('a freshly set target has not drifted', !app.bufferDrift().matters, app.bufferDrift());
  // Clearing debts makes a month cost less than the stored target.
  app.state = Object.assign(app.state, { debts: app.state.debts.map(d => [2, 3].includes(d.id) ? { ...d, balance: 0 } : d) });
  const d1 = app.bufferDrift();
  check('clearing debts shows the target as over-held', d1.matters && d1.drift > 0, d1);
  check('and names what a month costs now', near(d1.mm.total, app.monthlyMinimums().total));
  app.setBufferPreset(1);
  check('re-tapping the preset clears the drift', !app.bufferDrift().matters, app.bufferDrift());
  // A minimum going UP leaves the target short, which is the dangerous way.
  app.state = Object.assign(app.state, { debts: app.state.debts.map(d => d.id === 9 ? { ...d, min: d.min + 200 } : d) });
  const d2 = app.bufferDrift();
  check('a risen minimum shows the target as short', d2.matters && d2.drift < 0, d2);
}

// ── 4. the business share is transferred to the business account ─────────
reset({ bufferTargetBiz: 400, bufferTargetPer: 800, bizPot: 5000, perPot: 5000 });
const a5 = app.allocateIncome(600);
const toBiz = a5.biz + a5.bufferBiz, toPer = a5.per + a5.savings + a5.bufferPer + a5.keep;
check('the buffer\'s business share goes to the business account', near(a5.bufferBiz, 200) && near(toBiz, a5.biz + 200), { a5, toBiz });
check('the two transfers still account for every penny', near(toBiz + toPer, 600), { toBiz, toPer });

// The Log-money-in modal must name all four destinations, not just the two
// bank totals: with the buffer as a real savings space, "£600 to the personal
// account" is not an instruction you can act on.
reset({ bufferTargetBiz: 400, bufferTargetPer: 800 });
reset({ bufferTargetBiz: 400, bufferTargetPer: 800, bizPot: 5000, perPot: 5000 });
app.openLogModal();
// The stub DOM mints an element on first getElementById, and openLogModal
// only writes an HTML string — so prime the fields with one preview pass
// before typing into them, then run it again for real.
app.updateSweepPreview();
els.logAmount.value = '600';
app.updateSweepPreview();
const shown = id => Number(String(els[id].textContent).replace(/[^0-9.]/g, ''));
const a6 = app.currentAllocation();
check('the panel names the business pot and its buffer separately',
  near(shown('transferBizPot'), a6.biz) && near(shown('transferBizBuffer'), a6.bufferBiz),
  { pot: shown('transferBizPot'), buffer: shown('transferBizBuffer'), a6 });
check('and the personal pot, its buffer, savings and living money',
  near(shown('transferPerPot'), a6.per) && near(shown('transferPerBuffer'), a6.bufferPer)
  && near(shown('transferSavings'), a6.savings) && near(shown('transferKeep'), a6.keep),
  { pot: shown('transferPerPot'), buffer: shown('transferPerBuffer'), sav: shown('transferSavings'), keep: shown('transferKeep') });
check('each headline total is exactly its own destinations added up',
  near(shown('transferBiz'), shown('transferBizPot') + shown('transferBizBuffer'))
  && near(shown('transferPer'), shown('transferPerPot') + shown('transferPerBuffer') + shown('transferSavings') + shown('transferKeep')),
  { biz: shown('transferBiz'), per: shown('transferPer') });
check('and the four destinations account for the whole pay-in',
  near(shown('transferBiz') + shown('transferPer'), 600));

// ── 5. deleting an income entry reverses both jars exactly ───────────────
reset({ bufferTargetBiz: 400, bufferTargetPer: 800, bizPot: 5000, perPot: 5000 });
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
