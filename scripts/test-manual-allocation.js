#!/usr/bin/env node
'use strict';

// ── Regression test: typing your own figure into "Log money in" ────────────
//
// Exercises the REAL client-side logic out of public/debt.html — the script
// block is extracted and run in a vm with a stub DOM (scripts/debt-app-sandbox.js),
// so these are the same functions the phone runs, not a copy of them.
//
// The bug this pins down: the four override boxes under "Override any amount
// below if this week needs adjusting" used to be SUBSTITUTED into a plan that
// had already been worked out without them. Nothing then checked the result
// against the money that came in.
//
// £325.64 in, with £302.29 owed back to the pots, leaves £23.35 to allocate.
// Typing £182.08 into Business pot replaced that £23.35 with £182.08 and the
// modal printed transfer instructions for £484.37 — £158.73 that was never in
// the account — which Allocate then added to real pot balances.
//
// What it pins down now:
//
//   1. A pay-in conserves whatever is typed into it: repaid + allocated +
//      kept is exactly what came in, never more.
//   2. An override bigger than the week can fund is trimmed to what is left,
//      and the modal says by how much rather than inventing the difference.
//   3. An override is the line's WHOLE share, so a smaller one doesn't leave
//      the money stranded in living money — it flows on down the waterfall to
//      the buffer, savings and the other pot.
//   4. A pinned pot counts toward this month's commitments, so the account is
//      not funded twice, and the sweep doesn't top it up behind the user's
//      back.
//   5. The repayment is not overridable: it comes off the top whatever is
//      typed below it.
//   6. What the modal shows is what Allocate commits — pots gain exactly the
//      trimmed figures.
//   7. The minimums note answers for the allocation actually being made,
//      overrides and repayment included.
//   8. With nothing typed, every figure is exactly what it was before any of
//      this existed.
//
// USAGE (no database, no browser, no server):
//   node scripts/test-manual-allocation.js

const { loadDebtApp, makeReset } = require('./debt-app-sandbox');

const pass = [], fail = [];
const check = (name, ok, detail) => (ok ? pass : fail).push(name + (!ok && detail !== undefined ? ' — ' + JSON.stringify(detail) : ''));
const near = (a, b, tol = 0.011) => Math.abs(a - b) <= tol;

const { app, els } = loadDebtApp();
const reset = makeReset(app);

// The user's route in: open the modal, type an amount and any overrides, and
// read back what the modal is showing. The stub DOM mints an element on first
// getElementById and openLogModal only writes an HTML string, so one preview
// pass has to create the fields before anything can be typed into them.
function typeIn(amount, over = {}) {
  app.openLogModal();
  app.updateSweepPreview();
  for (const id of ['logBiz', 'logPer', 'logSaved', 'logBuffer']) els[id].value = '';
  els.logAmount.value = String(amount);
  if (over.biz !== undefined) els.logBiz.value = String(over.biz);
  if (over.per !== undefined) els.logPer.value = String(over.per);
  if (over.savings !== undefined) els.logSaved.value = String(over.savings);
  if (over.buffer !== undefined) els.logBuffer.value = String(over.buffer);
  app.updateSweepPreview();
  return app.currentAllocation();
}
const handedOut = a => a.potRepay.total + a.biz + a.per + a.savings + a.buffer + a.keep;
const shown = id => Number(String(els[id].textContent).replace(/[^0-9.]/g, ''));
const loan = (over = {}) => Object.assign({
  id: 1, source_name: 'Personal Pot', is_savings: false, amount: 200,
  note: null, borrowed_at: '2026-09-01', pot: 'per', repaid_amount: 0
}, over);
// The week off the screenshot: two pot loans owed back, and far more owed to
// this month's minimums than the pay-in can cover.
const screenshotWeek = () => ({
  bizPot: 20, perPot: 25, savingsPct: 10, sweepPct: 50,
  borrowedActive: [
    loan({ id: 1, amount: 265.21, pot: 'per', borrowed_at: '2026-08-01' }),
    loan({ id: 2, amount: 37.08, pot: 'biz', borrowed_at: '2026-08-02', source_name: 'Business Pot' })
  ]
});

async function main(){

// ── 1. The pay-in adds up, whatever is typed into it ───────────────────────
{
  reset(screenshotWeek());
  const a = typeIn(325.64, { biz: 182.08 });
  check('an override never hands out more than came in',
    near(handedOut(a), 325.64),
    { in: 325.64, out: handedOut(a), repay: a.potRepay.total, biz: a.biz, per: a.per,
      savings: a.savings, buffer: a.buffer, keep: a.keep });
  check('the two bank transfers add up to the pay-in, not past it',
    near(shown('transferBiz') + shown('transferPer'), 325.64),
    { biz: shown('transferBiz'), per: shown('transferPer') });
  check('and each transfer is exactly its own destinations',
    near(shown('transferBiz'), shown('transferBizPot') + shown('transferBizRepay'))
    && near(shown('transferPer'), shown('transferPerPot') + shown('transferSavings')
      + shown('transferPerRepay') + shown('transferKeep')),
    { biz: shown('transferBiz'), per: shown('transferPer') });

  // Every combination of the four boxes, on a week with nothing spare.
  for (const over of [{ biz: 900 }, { per: 900 }, { savings: 900 }, { buffer: 900 },
    { biz: 400, per: 400 }, { biz: 100, per: 100, savings: 100, buffer: 100 },
    { biz: 0, per: 0, savings: 0, buffer: 0 }]) {
    reset(screenshotWeek());
    const b = typeIn(325.64, over);
    check('it still adds up with ' + JSON.stringify(over),
      near(handedOut(b), 325.64) && b.biz >= 0 && b.per >= 0 && b.savings >= 0 && b.buffer >= 0,
      { out: handedOut(b), b });
  }
}

// ── 2. What can't be funded is trimmed, and said out loud ──────────────────
{
  reset(screenshotWeek());
  const a = typeIn(325.64, { biz: 182.08 });
  check('an override is capped at what the week has left',
    near(a.biz, 23.35), { biz: a.biz, repay: a.potRepay.total });
  check('and the shortfall is reported rather than conjured',
    near(a.unfunded, 158.73), a.unfunded);
  check('the modal warns, naming the gap and what there is to share out',
    els.overrideTrimNote.style.display === 'block'
    && /£158\.73/.test(els.overrideTrimNote.innerHTML)
    && /£23\.35/.test(els.overrideTrimNote.innerHTML),
    els.overrideTrimNote.innerHTML);

  // Two overrides over budget are trimmed from the bottom of the waterfall
  // up: this month's pots keep what they asked for before savings does.
  reset({ bizPot: 5000, perPot: 5000, savingsPct: 0, sweepPct: 0 });
  const b = typeIn(300, { biz: 250, savings: 100 });
  check('the earlier line in the waterfall is funded first',
    near(b.biz, 250) && near(b.savings, 50), { biz: b.biz, savings: b.savings });
  check('and only the part that outran the pay-in is unfunded',
    near(b.unfunded, 50) && near(handedOut(b), 300), { unfunded: b.unfunded, out: handedOut(b) });

  // Nothing typed, nothing to warn about.
  reset(screenshotWeek());
  const c = typeIn(325.64);
  check('an automatic allocation never reports a shortfall', near(c.unfunded, 0), c.unfunded);
  check('and the warning stays hidden', els.overrideTrimNote.style.display === 'none');

  // A negative figure is not a withdrawal. The modal's boxes go through
  // parseNum, which has always read "-100" as 100, so the guard that matters
  // is the allocation's own: a pin below zero takes nothing out.
  reset({ bizPot: 5000, perPot: 5000, savingsPct: 10, sweepPct: 0 });
  const d = app.allocateIncome(400, { biz: -100, per: null, savings: null, buffer: null });
  check('a negative override is read as nothing, not as money coming back',
    near(d.biz, 0) && near(d.potRepay.total + d.biz + d.per + d.savings + d.buffer + d.keep, 400),
    { biz: d.biz, keep: d.keep });
  reset({ bizPot: 5000, perPot: 5000, savingsPct: 10, sweepPct: 0 });
  const e = typeIn(400, { biz: -100 });
  check('and no line of a typed week can come out negative',
    e.biz >= 0 && e.per >= 0 && e.savings >= 0 && e.buffer >= 0 && e.keep >= 0
    && near(handedOut(e), 400), e);
}

// ── 3. A smaller override sends the rest on down the waterfall ─────────────
{
  // The month is covered by the pots, so an automatic pay-in fills the buffer
  // and then saves. Pinning the buffer low must not park the difference in
  // living money — the steps below it get their turn.
  const week = { bizPot: 5000, perPot: 5000, bufferTargetPer: 450, savingsPct: 10, sweepPct: 0 };
  reset(week);
  const auto = typeIn(500);
  check('automatically, the buffer takes what it needs and savings follows',
    near(auto.buffer, 450) && near(auto.savings, 50), { buffer: auto.buffer, savings: auto.savings });
  reset(week);
  const a = typeIn(500, { buffer: 100 });
  check('a smaller buffer override leaves savings its full percentage',
    near(a.buffer, 100) && near(a.savings, 50), { buffer: a.buffer, savings: a.savings });
  check('and the rest reaches living money, with nothing lost on the way',
    near(a.keep, 350) && near(handedOut(a), 500), { keep: a.keep, out: handedOut(a) });

  // The same thing one step earlier: hold this month's business funding back
  // and the money must reach the personal pot's own commitments, not stop.
  reset({ bizPot: 0, perPot: 0, savingsPct: 0, sweepPct: 0 });
  const full = typeIn(600);
  reset({ bizPot: 0, perPot: 0, savingsPct: 0, sweepPct: 0 });
  const held = typeIn(600, { biz: 0 });
  check('holding one pot back funds the other one further',
    held.per > full.per + 0.005 || near(full.per + full.biz, held.per),
    { autoBiz: full.biz, autoPer: full.per, heldPer: held.per });
  check('and the held-back week still adds up', near(handedOut(held), 600), handedOut(held));
}

// ── 4. A pinned pot is not funded twice ────────────────────────────────────
{
  // Typing this month's whole business commitment in means the automatic
  // steps have no business gap left to fund, and the sweep has only the
  // personal pot to top up.
  reset({ bizPot: 0, perPot: 0, savingsPct: 0, sweepPct: 100 });
  const auto = typeIn(2000);
  reset({ bizPot: 0, perPot: 0, savingsPct: 0, sweepPct: 100 });
  const pinned = typeIn(2000, { biz: auto.biz });
  check('pinning a pot at its automatic figure changes nothing else',
    near(pinned.biz, auto.biz) && near(pinned.per, auto.per) && near(pinned.keep, auto.keep),
    { auto: { biz: auto.biz, per: auto.per, keep: auto.keep },
      pinned: { biz: pinned.biz, per: pinned.per, keep: pinned.keep } });

  reset({ bizPot: 0, perPot: 0, savingsPct: 0, sweepPct: 100 });
  const over = typeIn(2000, { biz: auto.biz + 200 });
  check('and paying a pot MORE than the plan asked takes it from the rest',
    near(over.biz, auto.biz + 200) && near(handedOut(over), 2000),
    { biz: over.biz, out: handedOut(over) });

  // Both pots pinned: the sweep has nowhere to go, so living money keeps it
  // rather than the sweep quietly overriding the override.
  reset({ bizPot: 0, perPot: 0, savingsPct: 0, sweepPct: 100 });
  const both = typeIn(2000, { biz: 100, per: 200 });
  check('with both pots pinned, neither is swept into',
    near(both.biz, 100) && near(both.per, 200), { biz: both.biz, per: both.per });
  check('and what the sweep would have moved stays as living money',
    near(both.keep, 1700) && near(handedOut(both), 2000), { keep: both.keep, out: handedOut(both) });
}

// ── 5. The repayment comes off the top, whatever is typed ──────────────────
{
  reset(screenshotWeek());
  const a = typeIn(325.64, { biz: 500, per: 500, savings: 500, buffer: 500 });
  check('overrides cannot take money owed back to a pot',
    near(a.potRepay.total, 302.29), a.potRepay);
  check('they share out only what is left after it',
    near(a.biz + a.per + a.savings + a.buffer + a.keep, 23.35),
    { biz: a.biz, per: a.per, savings: a.savings, buffer: a.buffer, keep: a.keep });
  check('and the unfunded figure is the whole of the rest',
    near(a.unfunded, 1976.65), a.unfunded);
}

// ── 6. What the modal shows is what Allocate commits ───────────────────────
{
  reset(screenshotWeek());
  const a = typeIn(325.64, { biz: 182.08 });
  const before = { biz: app.state.bizPot, per: app.state.perPot };
  await app.confirmLog();
  check('the business pot gains the trimmed figure, not the typed one',
    near(app.state.bizPot, before.biz + a.biz + 37.08),
    { before: before.biz, after: app.state.bizPot, allocated: a.biz });
  check('the personal pot gains only what went back into it',
    near(app.state.perPot, before.per + 265.21 + a.per),
    { before: before.per, after: app.state.perPot });
  const pots = app.state.bizPot + app.state.perPot + app.state.savingsPot
    + app.state.bufferBiz + app.state.bufferPer;
  check('so the pots between them gain no more than the pay-in',
    pots - (before.biz + before.per) <= 325.64 + 0.011,
    { gained: pots - (before.biz + before.per) });
  check('and the entry records what was actually allocated',
    near(app.state.incomeLog[0].bizAmt, a.biz) && near(app.state.incomeLog[0].amount, 325.64),
    app.state.incomeLog[0]);
}

// ── 7. The minimums note answers for the week being allocated ──────────────
{
  reset(screenshotWeek());
  typeIn(325.64);
  const autoNote = els.minCoverNote.textContent;
  typeIn(325.64, { biz: 0, per: 0, savings: 300 });
  check('putting the week into savings instead shows a bigger shortfall',
    /short of this cycle/.test(els.minCoverNote.textContent)
    && els.minCoverNote.textContent !== autoNote,
    { auto: autoNote, saved: els.minCoverNote.textContent });

  // Money going back into a spending pot funds that pot's minimums like any
  // other money — the note used to ignore it and overstate the gap.
  reset({ bizPot: 0, perPot: 0, savingsPct: 0, sweepPct: 0,
    borrowedActive: [loan({ id: 3, amount: 400, pot: 'per' })] });
  const withRepay = typeIn(400);
  const noted = Number((String(els.minCoverNote.textContent).match(/£([\d,.]+?)(?=\s|$)/) || [0, '0'])[1].replace(/,/g, ''));
  const fs = app.getCycleStatus();
  const truth = Math.max(0, fs.outstandingBiz - (withRepay.potRepay.byPot.biz || 0) - withRepay.biz)
    + Math.max(0, fs.outstandingPer - (withRepay.potRepay.byPot.per || 0) - withRepay.per);
  check('a repayment into a pot counts toward that pot’s minimums',
    near(noted, truth), { noted, truth, repay: withRepay.potRepay.byPot });

  // Every minimum covered reads as covered, not as a shortfall.
  reset({ bizPot: 50000, perPot: 50000, savingsPct: 0, sweepPct: 0 });
  typeIn(100, { savings: 100 });
  check('a fully covered cycle still reads as covered with an override typed',
    /Every minimum/.test(els.minCoverNote.textContent), els.minCoverNote.textContent);
}

// ── 8. With nothing typed, nothing has changed ─────────────────────────────
{
  for (const amount of [120, 325.64, 1200, 5000]) {
    reset({ bizPot: 40, perPot: 60, bufferTargetBiz: 300, bufferTargetPer: 600,
      savingsPct: 10, sweepPct: 50, borrowedActive: [loan({ id: 4, amount: 150, pot: 'savings' })] });
    const a = app.allocateIncome(amount);
    const b = app.allocateIncome(amount, { biz: null, per: null, savings: null, buffer: null });
    check('an allocation with no overrides is untouched at ' + amount,
      near(a.biz, b.biz) && near(a.per, b.per) && near(a.savings, b.savings)
      && near(a.buffer, b.buffer) && near(a.bufferBiz, b.bufferBiz)
      && near(a.bufferPer, b.bufferPer) && near(a.keep, b.keep)
      && near(a.potRepay.total, b.potRepay.total),
      { auto: a, pinned: b });
    check('and it hands out exactly what came in at ' + amount,
      near(a.potRepay.total + a.biz + a.per + a.savings + a.buffer + a.keep, amount),
      { out: a.potRepay.total + a.biz + a.per + a.savings + a.buffer + a.keep });
  }

  // An overridden buffer lands in both jars, and the two halves are the whole.
  reset({ bizPot: 5000, perPot: 5000, bufferTargetBiz: 400, bufferTargetPer: 800, savingsPct: 0 });
  const a = typeIn(600, { buffer: 300 });
  check('a typed buffer is split across both jars',
    near(a.bufferBiz + a.bufferPer, 300) && a.bufferBiz > 0.005 && a.bufferPer > 0.005,
    { biz: a.bufferBiz, per: a.bufferPer });
  check('in proportion to what each still needs',
    near(a.bufferBiz, 100) && near(a.bufferPer, 200), { biz: a.bufferBiz, per: a.bufferPer });
}

}

// ── Report ─────────────────────────────────────────────────────────────────
main().then(()=>{
for (const p of pass) console.log('  ✓ ' + p);
for (const f of fail) console.log('  ✗ ' + f);
console.log(`\n${pass.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
}).catch(err=>{ console.error(err); process.exit(1); });
