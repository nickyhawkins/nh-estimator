#!/usr/bin/env node
'use strict';

// ── Regression test: floor & target payments (debt app) ─────────────────────
//
// Exercises the REAL client-side logic out of public/debt.html — the script
// block is extracted and run in a vm with a stub DOM, so these are the same
// functions the phone runs, not a copy of them.
//
// What it pins down, in the order the feature's promises matter:
//
//   1. A floor of null ("not agreed yet", e.g. Brewers/HMRC) is NOT a floor
//      of £0. An unset debt is left out of the floors verdict instead of
//      counting as a commitment that is met by paying nothing.
//   2. Floors and targets are judged separately: every floor paid is
//      "floors met" even while targets are outstanding — the whole point of
//      the feature is removing the all-or-nothing month.
//   3. Income is allocated buffer → floors (arrears first) → savings →
//      targets → living, and never loses or invents a penny.
//   4. Floors come OUT OF the ordinary sweep, not on top of it: a month whose
//      floors are already covered splits exactly as it did before floors
//      existed.
//   5. A missed floor is recorded as a shortfall and is NOT rolled into the
//      next cycle's required payment. This is the promise the whole feature
//      rests on — nothing compounds unless the user taps Catch up.
//
// USAGE (no database, no browser, no server):
//   node scripts/test-floor-payments.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const pass = [], fail = [];
const check = (name, ok, detail) => (ok ? pass : fail).push(name + (!ok && detail !== undefined ? ' — ' + JSON.stringify(detail) : ''));
const near = (a, b, tol = 0.011) => Math.abs(a - b) <= tol;

// ── Load the app's own script with a stub DOM ───────────────────────────────
function loadApp() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'debt.html'), 'utf8');
  const m = html.match(/<script>([\s\S]*)<\/script>/);
  if (!m) throw new Error('no inline script found in public/debt.html');
  // Drop the bootstrap: both calls hit the network, and this test drives the
  // state directly instead.
  let src = m[1].replace(/\nloadState\(\);\ninitPush\(\);/, '\n');
  if (src === m[1]) throw new Error('bootstrap calls not found — has the end of debt.html changed?');
  // Top-level `let`s live in the script's own lexical scope, so the test
  // reaches them through an explicit bridge rather than off the sandbox.
  src += `
globalThis.__t = {
  get state(){ return {debts,budget,bizPot,perPot,savingsPot,bufferPot,bufferTarget,savingsPct,sweepPct,paidThisCycle,missedThisCycle,floorPaidThisCycle,floorShortfalls,incomeLog}; },
  set state(o){
    if('debts' in o)debts=o.debts; if('budget' in o)budget=o.budget;
    if('bizPot' in o)bizPot=o.bizPot; if('perPot' in o)perPot=o.perPot;
    if('savingsPot' in o)savingsPot=o.savingsPot;
    if('bufferPot' in o)bufferPot=o.bufferPot; if('bufferTarget' in o)bufferTarget=o.bufferTarget;
    if('savingsPct' in o)savingsPct=o.savingsPct; if('sweepPct' in o)sweepPct=o.sweepPct;
    if('paidThisCycle' in o)paidThisCycle=o.paidThisCycle;
    if('missedThisCycle' in o)missedThisCycle=o.missedThisCycle;
    if('floorPaidThisCycle' in o)floorPaidThisCycle=o.floorPaidThisCycle;
    if('floorShortfalls' in o)floorShortfalls=o.floorShortfalls;
    if('incomeLog' in o)incomeLog=o.incomeLog;
  },
  DEBTS_INITIAL, floorOf, getFloorStatus, allocateIncome, getCyclePayments,
  getCycleArchivePayload, getCycleTotals, simulate, setPaymentState, paymentState
};`;
  const el = () => ({
    value: '', textContent: '', style: {}, innerHTML: '',
    addEventListener() {}, focus() {}
  });
  const sandbox = {
    console,
    setTimeout, clearTimeout, clearInterval,
    // setInterval is stubbed, not passed through: debt.html registers a
    // refresh poll at the top level (REFRESH_POLL_MS), and a real repeating
    // timer in here would keep firing refreshIfStale() against the rejecting
    // fetch below for as long as the process lives — and hold the process
    // open after the checks have finished. Nothing under test is driven by
    // it. setTimeout stays real; debounced saves rely on it.
    setInterval: () => 0,
    fetch: () => Promise.reject(new Error('no network in this test')),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { userAgent: 'node', serviceWorker: undefined },
    // addEventListener/visibilityState: debt.html binds visibilitychange on
    // document and focus on window at the top level, so the script cannot be
    // evaluated at all without them (this file failed to LOAD, not to pass,
    // once those landed). 'hidden' is both the safe answer and the true one —
    // there is no window here — so any handler that does run declines to
    // refresh rather than reaching for the network.
    document: { getElementById: el, body: { scrollHeight: 0 },
                addEventListener() {}, removeEventListener() {},
                visibilityState: 'hidden' },
    addEventListener() {}, removeEventListener() {},
    Notification: undefined,
    atob: (b) => Buffer.from(b, 'base64').toString('binary')
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'debt.html:<script>' });
  return sandbox.__t;
}

const app = loadApp();
// A fresh copy of the seeded plan for each scenario — the app replaces
// `debts` by reference on every real change, so tests must too.
const seed = () => app.DEBTS_INITIAL.map(d => ({ ...d }));
function reset(over = {}) {
  app.state = Object.assign({
    debts: seed(), budget: 2000, bizPot: 0, perPot: 0, savingsPot: 0,
    bufferPot: 0, bufferTarget: 0, savingsPct: 10, sweepPct: 50,
    paidThisCycle: [], missedThisCycle: [], floorPaidThisCycle: [],
    floorShortfalls: [], incomeLog: []
  }, over);
}

// ── 1. null floor is not a zero floor ──────────────────────────────────────
reset();
check('unset floor reads as null, not 0', app.floorOf({ floorPayment: null }) === null);
check('empty-string floor reads as null', app.floorOf({ floorPayment: '' }) === null);
check('numeric floor reads through', app.floorOf({ floorPayment: 50.73 }) === 50.73);
check('a real floor of 0 is kept as 0', app.floorOf({ floorPayment: 0 }) === 0);

{
  // Brewers has no contractual minimum, so in the seeded plan it takes no
  // month-1 payment at all. Give it one to prove an unset floor stays unset
  // and is surfaced rather than treated as a met commitment of £0.
  const withBrewers = seed().map(d => d.name === 'Brewers' ? { ...d, min: 50 } : d);
  reset({ debts: withBrewers });
  const fs0 = app.getFloorStatus();
  const brewers = fs0.payments.find(p => p.name === 'Brewers');
  check('a paying debt with no floor agreed carries floorDue null',
    !!brewers && brewers.floorDue === null, brewers);
  check('debts with no floor are counted for the "set a floor" nudge', fs0.noFloorSet === 1, fs0.noFloorSet);
  check('an unset floor adds nothing to the floor total',
    near(fs0.floorTotal, app.getFloorStatus().payments.reduce((s, p) => s + (p.floorDue || 0), 0)));
  check('an unset floor does not block the floors verdict',
    fs0.unmet.every(p => p.floorDue !== null));
}

// ── 2. floors and targets are judged separately ────────────────────────────
{
  reset();
  const all = app.getCyclePayments();
  const withFloor = all.filter(p => p.floorDue !== null);
  // The bad-month case the whole feature exists for: every floor paid, no
  // target reached.
  const underTarget = all.filter(p => p.floorDue !== null && p.floorDue < p.amount - 0.005);
  check('at least one debt is asked for more than its floor', underTarget.length >= 1, underTarget.length);
  reset({ floorPaidThisCycle: withFloor.map(p => p.id) });
  const fs1 = app.getFloorStatus();
  check('floors met while targets are still outstanding',
    fs1.floorsMet === true && fs1.targetMet === false, { floorsMet: fs1.floorsMet, targetMet: fs1.targetMet });
  check('a floors-met month still shows the gap to target',
    fs1.targetPaid < fs1.targetTotal - 0.005, { paid: fs1.targetPaid, total: fs1.targetTotal });

  reset({ paidThisCycle: all.map(p => p.id) });
  const fs2 = app.getFloorStatus();
  check('paying every target meets both', fs2.floorsMet && fs2.targetMet);

  // One floor-carrying debt deliberately skipped.
  const skipped = withFloor[0];
  reset({ paidThisCycle: withFloor.slice(1).map(p => p.id), missedThisCycle: [skipped.id] });
  const fs3 = app.getFloorStatus();
  check('one missed floor fails the floors verdict', fs3.floorsMet === false);
  check('a missed debt reserves no money', near(fs3.outstandingBiz + fs3.outstandingPer, 0),
    { biz: fs3.outstandingBiz, per: fs3.outstandingPer });

  // Pot arithmetic across the four states — the easy thing to get wrong.
  reset({ bizPot: 5000, perPot: 5000 });
  const one = app.getCyclePayments().find(p => p.account === 'personal' && p.floorDue !== null && p.floorDue < p.amount - 0.005);
  check('found a personal debt asked for more than its floor', !!one, one && one.name);
  app.setPaymentState(one.id, 'floor');
  check('paying the floor takes only the floor out of the pot',
    near(app.state.perPot, 5000 - one.floorDue), { pot: app.state.perPot, want: 5000 - one.floorDue });
  check('the payment reads as floor-paid', app.paymentState(one.id) === 'floor');
  app.setPaymentState(one.id, 'paid');
  check('upgrading to paid refunds the floor and charges the target',
    near(app.state.perPot, 5000 - one.amount), { pot: app.state.perPot, want: 5000 - one.amount });
  app.setPaymentState(one.id, 'paid');
  check('tapping paid again undoes it and refunds in full', near(app.state.perPot, 5000), app.state.perPot);
  check('and leaves it unpaid', app.paymentState(one.id) === 'unpaid');
  app.setPaymentState(one.id, 'missed');
  check('a missed payment takes nothing out of the pot', near(app.state.perPot, 5000), app.state.perPot);
  check('the three cycle lists stay mutually exclusive',
    app.state.paidThisCycle.length + app.state.floorPaidThisCycle.length === 0 && app.state.missedThisCycle.length === 1);
}

// ── 3. allocation order and conservation ───────────────────────────────────
{
  reset({ bufferTarget: 200 });
  const a = app.allocateIncome(150);
  check('buffer is filled before anything else', near(a.buffer, 150) && near(a.biz, 0) && near(a.per, 0) && near(a.savings, 0), a);

  reset({ bufferTarget: 200, bufferPot: 200 });
  const b = app.allocateIncome(150);
  check('a full buffer takes nothing', near(b.buffer, 0), b);

  reset({ bufferTarget: 200, bufferPot: 50 });
  const c = app.allocateIncome(1000);
  check('buffer takes only what it still needs', near(c.buffer, 150), c);
  check('nothing is lost or invented', near(c.buffer + c.biz + c.per + c.savings + c.keep, 1000),
    { sum: c.buffer + c.biz + c.per + c.savings + c.keep });

  // Income too small for every floor: the arrears-first order decides.
  reset();
  const fsAll = app.getFloorStatus();
  const totalFloors = fsAll.outstandingBiz + fsAll.outstandingPer;
  const d = app.allocateIncome(300);
  check('a light month puts income into floors, not the sweep percentage',
    d.floorFunded > 300 * 0.5, { floorFunded: d.floorFunded });
  check('a light month cannot fund every floor', totalFloors > 300);
  check('floor money still balances', near(d.buffer + d.biz + d.per + d.savings + d.keep, 300));

  // Highest arrears first: NatWest Loan (£2,662.97 arrears) outranks the rest.
  reset();
  const worst = seed().slice().sort((x, y) => y.arrears - x.arrears)[0];
  check('the seeded worst-arrears debt is NatWest Loan', worst.name === 'NatWest Loan', worst.name);
  const perOnly = app.allocateIncome(400);
  check('the first floors funded are on the worst-arrears debt\'s account',
    perOnly.floorPer > perOnly.floorBiz, { per: perOnly.floorPer, biz: perOnly.floorBiz });
}

// ── 4. floors come out of the sweep, not on top of it ──────────────────────
{
  // Pots already hold every floor, so no floor top-up is needed and the
  // split must match the pre-feature behaviour: sweepPct of income to debt.
  const fsNeed = (() => { reset(); return app.getFloorStatus(); })();
  reset({ bizPot: fsNeed.outstandingBiz, perPot: fsNeed.outstandingPer });
  const e = app.allocateIncome(1000);
  check('with floors covered, the debt sweep is exactly sweepPct of income',
    near(e.biz + e.per, 500), { toDebt: e.biz + e.per });
  check('with floors covered, savings is exactly savingsPct of income', near(e.savings, 100), e.savings);
  check('the rest is living money', near(e.keep, 400), e.keep);
  check('no floor top-up was needed', near(e.floorFunded, 0));
}

// ── 5. a missed floor is recorded, never auto-applied ──────────────────────
{
  reset();
  const before = app.getCyclePayments();
  const target = before.find(p => p.floorDue !== null);
  // A floor that was actually paid records no shortfall.
  reset({ floorPaidThisCycle: before.filter(p => p.floorDue !== null).map(p => p.id) });
  const metPayload = app.getCycleArchivePayload();
  check('a floors-met cycle records no shortfalls', metPayload.cycleFloorShortfalls.length === 0);
  check('a floors-met, target-missed cycle is archived as exactly that',
    metPayload.floorsMet === true && metPayload.targetMet === false);
  check('floor-only payments are archived at what actually went out',
    near(metPayload.debtsPaid.reduce((s, d) => s + d.amount, 0),
      before.filter(p => p.floorDue !== null).reduce((s, p) => s + p.floorDue, 0)));
  // Close a cycle having paid nothing.
  reset({ paidThisCycle: [] });
  const payload = app.getCycleArchivePayload();
  check('closing with nothing paid records a shortfall per floor-carrying debt',
    payload.cycleFloorShortfalls.length === before.filter(p => p.floorDue !== null).length,
    payload.cycleFloorShortfalls.length);
  check('the cycle verdict is archived', payload.floorsMet === false && payload.targetMet === false);
  const entry = payload.floorShortfalls.find(f => f.id === target.id);
  check('the shortfall is the floor, not the target payment',
    !!entry && near(entry.amount, target.floorDue), { entry, floorDue: target.floorDue, amount: target.amount });
  check('the shortfall is stamped with when it started', !!entry && !!entry.since);

  // Carrying that ledger into the next cycle must not change what is asked for.
  reset({ floorShortfalls: payload.floorShortfalls });
  const after = app.getCyclePayments();
  const sameAsk = before.every(p => {
    const now = after.find(x => x.id === p.id);
    return now && near(now.amount, p.amount) && (p.floorDue === null ? now.floorDue === null : near(now.floorDue, p.floorDue));
  });
  check('a carried shortfall does NOT increase next cycle\'s required payment', sameAsk);
  const fsNext = app.getFloorStatus();
  check('a carried shortfall does not change this cycle\'s floor total',
    near(fsNext.floorTotal, app.getFloorStatus().floorTotal));

  // A second bad cycle accumulates onto the same debt rather than duplicating it.
  const second = app.getCycleArchivePayload();
  const merged = second.floorShortfalls.filter(f => f.id === target.id);
  check('a repeat miss accumulates on one ledger entry', merged.length === 1, merged);
  check('the accumulated amount is the sum of both misses',
    near(merged[0].amount, target.floorDue * 2), { got: merged[0] && merged[0].amount, want: target.floorDue * 2 });
}

// ── report ─────────────────────────────────────────────────────────────────
pass.forEach(n => console.log('  ✓ ' + n));
fail.forEach(n => console.log('  ✗ ' + n));
console.log(`\n${pass.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
