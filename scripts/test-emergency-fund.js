#!/usr/bin/env node
'use strict';

// ── Regression test: the staged emergency fund (debt app) ──────────────────
//
// Exercises the REAL client-side logic out of public/debt.html — the script
// block is extracted and run in a vm with a stub DOM (scripts/debt-app-sandbox.js),
// so these are the same functions the phone runs, not a copy of them.
//
// Stage one is the month-ahead buffer (Features 13-15) and is UNCHANGED: fund
// this month's commitments, then top the two jars up to one month of them.
// What is staged is everything beyond that:
//
//   1. While ANY debt has arrears, `savingsPct` is suppressed to zero. That
//      money isn't savings yet — it's protection against sliding back — so it
//      goes at the arrears instead.
//   2. The buffer holds at the one-month baseline while arrears remain,
//      whatever the toggle says. Only once every arrear is clear AND the
//      toggle is on does it keep filling toward the 3-6 month target.
//   3. Once that target is reached it stops asking, toggle or no toggle, and
//      everything from then on goes to the snowball.
//
// USAGE (no database, no browser, no server):
//   node scripts/test-emergency-fund.js

const { loadDebtApp, makeReset } = require('./debt-app-sandbox');

const pass = [], fail = [];
const check = (name, ok, detail) => (ok ? pass : fail).push(name + (!ok && detail !== undefined ? ' — ' + JSON.stringify(detail) : ''));
const near = (a, b, tol = 0.011) => Math.abs(a - b) <= tol;

const { app } = loadDebtApp();
const reset = makeReset(app);

// The seeded plan is deep in arrears; `upToDate` is the same plan with every
// debt caught up, which is the gate this whole feature hangs off.
const inArrears = () => app.DEBTS_INITIAL.map(d => ({ ...d }));
const upToDate = () => app.DEBTS_INITIAL.map(d => ({ ...d, arrears: 0 }));
// Pots full enough that this month is already funded, so a pay-in actually
// reaches the buffer/savings steps (this month always comes first).
const COVERED = { bizPot: 9000, perPot: 9000 };

// ── 1. the gate itself ────────────────────────────────────────────────────
reset({ debts: inArrears() });
check('the seeded plan is behind, so the gate is shut', app.anyArrears() && app.savingsSuppressed());
reset({ debts: upToDate() });
check('with every arrear cleared the gate opens', !app.anyArrears() && !app.savingsSuppressed());
// One penny overdue anywhere is enough to shut it — including on a debt that
// has an agreed arrangement, whose arrears count like any other debt's.
reset({ debts: app.DEBTS_INITIAL.map(d => ({ ...d, arrears: d.id === 7 ? 500 : 0, arrangement: d.id === 7 ? 150 : null })) });
check('an arrangement debt\'s arrears still hold the gate shut', app.anyArrears() && app.savingsSuppressed());

// ── 2. savingsPct contributes zero while anything is overdue ──────────────
reset(Object.assign({ debts: inArrears(), savingsPct: 10, sweepPct: 0 }, COVERED));
const behind = app.allocateIncome(1000);
check('savings gets nothing while a debt is in arrears', near(behind.savings, 0), behind.savings);
check('and the money is not simply lost — it goes on down the waterfall',
  near(behind.potRepay.total + behind.biz + behind.per + behind.savings + behind.buffer + behind.keep, 1000), behind);

reset(Object.assign({ debts: upToDate(), savingsPct: 10, sweepPct: 0 }, COVERED));
const ahead = app.allocateIncome(1000);
check('once the arrears are clear it resumes its old behaviour exactly',
  near(ahead.savings, 100), ahead.savings);
check('a 0% setting is still 0% either way', (() => {
  reset(Object.assign({ debts: upToDate(), savingsPct: 0, sweepPct: 0 }, COVERED));
  return near(app.allocateIncome(1000).savings, 0);
})());

// A figure TYPED against the savings line is a decision already made, and the
// suppression does not overrule it.
reset(Object.assign({ debts: inArrears(), savingsPct: 10, sweepPct: 0 }, COVERED));
const pinned = app.allocateIncome(1000, { biz: null, per: null, buffer: null, savings: 75 });
check('a typed savings figure still stands while suppressed', near(pinned.savings, 75), pinned.savings);

// ── 3. the buffer holds at one month while arrears remain ────────────────
reset(Object.assign({ debts: inArrears(), bufferTargetPer: 800, emergencyTargetPer: 4800,
  emergencyGrowing: true, savingsPct: 0, sweepPct: 0 }, COVERED));
const held = app.allocateIncome(3000);
check('the buffer stops at the one-month baseline while arrears remain',
  near(held.buffer, 800), held.buffer);
check('and the toggle makes no difference at all while they do', (() => {
  reset(Object.assign({ debts: inArrears(), bufferTargetPer: 800, emergencyTargetPer: 4800,
    emergencyGrowing: false, savingsPct: 0, sweepPct: 0 }, COVERED));
  return near(app.allocateIncome(3000).buffer, 800);
})());
check('flipping it early is allowed and simply does nothing yet', (() => {
  reset({ debts: inArrears(), emergencyTargetPer: 4800, emergencyGrowing: true });
  return !app.emergencyEligible();
})());
check('everything past the baseline falls through to the sweep',
  near(held.potRepay.total + held.biz + held.per + held.savings + held.buffer + held.keep, 3000), held);

// ── 4. the extension only opens once every arrear is zero ────────────────
reset(Object.assign({ debts: upToDate(), bufferTargetPer: 800, emergencyTargetPer: 4800,
  emergencyGrowing: true, savingsPct: 0, sweepPct: 0 }, COVERED));
check('with the arrears clear and the toggle on, the fund is eligible', app.emergencyEligible());
const growing = app.allocateIncome(3000);
check('the buffer now fills past one month toward the 3-6 month target',
  near(growing.buffer, 3000), growing.buffer);
check('and it aims at the extended figure, not the baseline',
  near(app.bufferFillTargets().per, 4800) && near(app.bufferNeededAfter(null).total, 4800),
  { aim: app.bufferFillTargets(), need: app.bufferNeededAfter(null) });
check('while the one-month baseline is still reported as its own figure',
  near(app.baselineNeeded().total, 800), app.baselineNeeded());

// The toggle is what decides where post-baseline money goes.
reset(Object.assign({ debts: upToDate(), bufferTargetPer: 800, emergencyTargetPer: 4800,
  emergencyGrowing: false, savingsPct: 0, sweepPct: 100 }, COVERED));
const snowballing = app.allocateIncome(3000);
check('set to snowball, the buffer takes only its one month',
  near(snowballing.buffer, 800), snowballing.buffer);
check('and the rest goes at the debts instead of the jars',
  snowballing.biz + snowballing.per > growing.biz + growing.per + 0.005,
  { growing: growing.biz + growing.per, snowballing: snowballing.biz + snowballing.per });
check('the same pay-in, both ways, still adds up to exactly what came in',
  near(snowballing.potRepay.total + snowballing.biz + snowballing.per + snowballing.savings + snowballing.buffer + snowballing.keep, 3000));

// ── 5. it stops at the target, toggle or no toggle ───────────────────────
reset(Object.assign({ debts: upToDate(), bufferTargetPer: 800, bufferPer: 4800,
  emergencyTargetPer: 4800, emergencyGrowing: true, savingsPct: 0, sweepPct: 100 }, COVERED));
const full = app.allocateIncome(2000);
check('a fund at its target asks for nothing more, even set to grow',
  near(full.buffer, 0), full.buffer);
check('and the money goes to the snowball instead',
  full.biz + full.per > 0.005, { biz: full.biz, per: full.per });

reset(Object.assign({ debts: upToDate(), bufferTargetPer: 800, bufferPer: 4000,
  emergencyTargetPer: 4800, emergencyGrowing: true, savingsPct: 0, sweepPct: 0 }, COVERED));
const topUp = app.allocateIncome(2000);
check('a part-full fund takes only the gap', near(topUp.buffer, 800), topUp.buffer);

// The extension never SHRINKS the month-ahead float: a smaller (or mistyped)
// extended target can't pull the baseline down under it.
reset(Object.assign({ debts: upToDate(), bufferTargetPer: 800, emergencyTargetPer: 200,
  emergencyGrowing: true, savingsPct: 0, sweepPct: 0 }, COVERED));
check('an extension below the baseline leaves the baseline standing',
  near(app.bufferFillTargets().per, 800) && near(app.allocateIncome(2000).buffer, 800),
  app.bufferFillTargets());

// Two jars, still: an extension fills them in proportion to what each needs.
reset(Object.assign({ debts: upToDate(), bufferTargetBiz: 400, bufferTargetPer: 800,
  emergencyTargetBiz: 1200, emergencyTargetPer: 2400, emergencyGrowing: true,
  savingsPct: 0, sweepPct: 0 }, COVERED));
const split = app.allocateIncome(900);
check('the extension still splits between the two real bank accounts',
  near(split.bufferBiz, 300) && near(split.bufferPer, 600), split);
check('and the split loses nothing', near(split.bufferBiz + split.bufferPer, split.buffer));

// ── 6. an extension nobody set changes nothing ───────────────────────────
reset(Object.assign({ debts: upToDate(), bufferTargetPer: 800, savingsPct: 10, sweepPct: 50 }, COVERED));
const noExt = app.allocateIncome(2000);
check('with no extended target set, the fund is not eligible', !app.emergencyEligible());
check('and the pay-in splits exactly as it did before this feature',
  near(noExt.buffer, 800) && near(noExt.savings, 200), noExt);

// ── 7. the settings controls ─────────────────────────────────────────────
reset({ debts: upToDate() });
const mm = app.monthlyMinimums();
app.setEmergencyMonths(4);
check('the preset sets both jars to N months of commitments',
  near(app.state.emergencyTargetBiz, mm.biz * 4) && near(app.state.emergencyTargetPer, mm.per * 4), app.state);
app.setEmergencyMonths(6);
check('and 6 months is six of them',
  near(app.state.emergencyTargetBiz, mm.biz * 6) && near(app.state.emergencyTargetPer, mm.per * 6));
app.setEmergencyMonths(0);
check('"off" clears both', app.state.emergencyTargetBiz === 0 && app.state.emergencyTargetPer === 0);
app.setEmergencyTargetFor('business', '1500');
check('a typed figure sets one jar on its own', near(app.state.emergencyTargetBiz, 1500) && app.state.emergencyTargetPer === 0);
// The typed field reads like every other money field in the app: parseNum()
// strips anything that isn't a digit, so a target can never come out negative.
app.setEmergencyTargetFor('business', '-50');
const negEmergency = app.state.emergencyTargetBiz;
app.setBufferTargetFor('business', '-50');
check('a negative target is impossible, and reads the same as the buffer\'s own field',
  negEmergency >= 0 && near(negEmergency, app.state.bufferTargetBiz),
  { emergency: negEmergency, buffer: app.state.bufferTargetBiz });
app.setEmergencyTargetFor('business', '');
check('and an empty box means no extension', app.state.emergencyTargetBiz === 0);
const was = app.state.emergencyGrowing;
app.toggleEmergencyGrowing();
check('the toggle flips', app.state.emergencyGrowing === !was);
app.toggleEmergencyGrowing();
check('and flips back — it persists until changed, it does not reset itself',
  app.state.emergencyGrowing === was);

// ── 8. stage one is untouched ────────────────────────────────────────────
// The whole point of the staging: nothing about funding this month, or the
// one-month float, changes because of any of the above.
reset({ debts: inArrears(), bufferTargetBiz: 400, bufferTargetPer: 800 });
const need = app.cycleCommitments();
const light = app.allocateIncome(600);
check('a light month still funds this month, not the buffer',
  near(light.buffer, 0) && near(light.dueFunded, 600), light);
const ample = app.allocateIncome(need.total + 300);
check('and the month still comes first, with the baseline built out of the rest',
  near(ample.dueFunded, need.total) && near(ample.buffer, 300), ample);

// ── report ─────────────────────────────────────────────────────────────────
console.log('\n── The staged emergency fund ──\n');
for (const p of pass) console.log('  ✓ ' + p);
for (const f of fail) console.log('  ✗ ' + f);
console.log(`\n${pass.length} passed, ${fail.length} failed\n`);
process.exit(fail.length ? 1 : 0);
