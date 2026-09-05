'use strict';

// ── Shared test harness: the debt app's own script, in a vm ─────────────────
//
// Both debt-app regression suites (floors/targets, custom amounts) exercise
// the REAL client-side logic out of public/debt.html rather than a copy of
// it: the inline script block is extracted and run against a stub DOM, so
// what the checks call is what the phone runs.
//
// Top-level `let`s live in the script's own lexical scope, so tests reach
// them through the explicit bridge built below rather than off the sandbox.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// One stub element per id, kept rather than minted fresh on every lookup, so
// a test can put a value in an input (`els.customPayInput.value = '900'`) and
// have the app read it back — the modals take their figures from the DOM.
function stubElement() {
  return {
    value: '', textContent: '', style: {}, innerHTML: '',
    addEventListener() {}, focus() {}
  };
}

function loadDebtApp() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'debt.html'), 'utf8');
  const m = html.match(/<script>([\s\S]*)<\/script>/);
  if (!m) throw new Error('no inline script found in public/debt.html');
  // Drop the bootstrap: both calls hit the network, and these tests drive the
  // state directly instead.
  let src = m[1].replace(/\nloadState\(\);\ninitPush\(\);/, '\n');
  if (src === m[1]) throw new Error('bootstrap calls not found — has the end of debt.html changed?');
  src += `
globalThis.__t = {
  get state(){ return {debts,budget,bizPot,perPot,savingsPot,bufferBiz,bufferPer,bufferTargetBiz,bufferTargetPer,savingsPct,sweepPct,paidThisCycle,missedThisCycle,minPaidThisCycle,appliedPayments,incomeLog}; },
  set state(o){
    if('debts' in o)debts=o.debts; if('budget' in o)budget=o.budget;
    if('bizPot' in o)bizPot=o.bizPot; if('perPot' in o)perPot=o.perPot;
    if('savingsPot' in o)savingsPot=o.savingsPot;
    if('bufferBiz' in o)bufferBiz=o.bufferBiz; if('bufferPer' in o)bufferPer=o.bufferPer;
    if('bufferTargetBiz' in o)bufferTargetBiz=o.bufferTargetBiz;
    if('bufferTargetPer' in o)bufferTargetPer=o.bufferTargetPer;
    if('savingsPct' in o)savingsPct=o.savingsPct; if('sweepPct' in o)sweepPct=o.sweepPct;
    if('paidThisCycle' in o)paidThisCycle=o.paidThisCycle;
    if('missedThisCycle' in o)missedThisCycle=o.missedThisCycle;
    if('minPaidThisCycle' in o)minPaidThisCycle=o.minPaidThisCycle;
    if('appliedPayments' in o)appliedPayments=o.appliedPayments;
    if('incomeLog' in o)incomeLog=o.incomeLog;
  },
  DEBTS_INITIAL, minDueOf, getCycleStatus, allocateIncome, getCyclePayments,
  getCycleArchivePayload, getCycleTotals, simulate, setPaymentState, paymentState,
  paidAmountOf, getUnpaidMinimums, applyUnpaidMinimums, payContext,
  openCustomPayModal, customPayPreview, confirmCustomPay, undoPayment,
  setCustomPayMode, customPayTotal, recordPayment, getCurrentTarget,
  applySurplus, confirmSurplus,
  monthlyMinimums, bufferCover, confirmBufferCover, setBufferPreset, setBufferTargetFor,
  confirmLog, deleteIncome, currentAllocation, openLogModal, updateSweepPreview,
  cycleCommitments, bufferDrift, renderBufferRescue, startNewCycle
};`;
  const els = {};
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
    // evaluated at all without them. 'hidden' is both the safe answer and the
    // true one — there is no window here — so any handler that does run
    // declines to refresh rather than reaching for the network.
    document: {
      getElementById: id => els[id] || (els[id] = stubElement()),
      body: { scrollHeight: 0 },
      addEventListener() {}, removeEventListener() {},
      visibilityState: 'hidden'
    },
    addEventListener() {}, removeEventListener() {},
    Notification: undefined,
    atob: (b) => Buffer.from(b, 'base64').toString('binary')
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'debt.html:<script>' });
  return { app: sandbox.__t, els };
}

// A fresh copy of the seeded plan for each scenario — the app replaces
// `debts` by reference on every real change, so tests must too.
function makeReset(app) {
  return function reset(over = {}) {
    app.state = Object.assign({
      debts: app.DEBTS_INITIAL.map(d => ({ ...d })), budget: 2000,
      bizPot: 0, perPot: 0, savingsPot: 0,
      bufferBiz: 0, bufferPer: 0, bufferTargetBiz: 0, bufferTargetPer: 0,
      savingsPct: 10, sweepPct: 50,
      paidThisCycle: [], missedThisCycle: [], minPaidThisCycle: [],
      appliedPayments: {}, incomeLog: []
    }, over);
  };
}

module.exports = { loadDebtApp, makeReset };
