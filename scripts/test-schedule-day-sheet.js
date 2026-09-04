#!/usr/bin/env node
'use strict';

// ── Regression test: the Schedule day sheet ────────────────────────────────
//
// Tapping a day on the calendar opens one sheet that has to do two unrelated
// jobs: put a job in the diary, and take a day OUT of it. The block/unblock
// buttons used to be rendered last, under an uncapped list of every accepted
// job waiting for a date — so on a busy diary the sheet's 70%-of-screen
// scroll box filled with "Start a job here" rows and the buttons fell off the
// bottom. Blocking a day looked impossible exactly when the diary was
// busiest, which is when time off most needs booking.
//
// What this holds still (v2.52.1):
//   1. THE REACHABILITY PROPERTY. However many jobs are waiting, the day's own
//      Block/Unblock buttons come BEFORE the waiting list in the sheet.
//   2. The waiting list is capped, with the remainder behind one tap, and
//      "show all" really does list the lot.
//   3. The old rules still hold: no blocking a past day or a non-working one,
//      unblocking offered on any blocked day, and a multi-day run offering to
//      clear itself whole.
//
// Pure node against the real source: the functions are extracted out of
// public/index.html by name and evaluated with stubs, the same shape as
// scripts/test-scope-text.js. No database, no browser, no server.
//
// USAGE
//   node scripts/test-schedule-day-sheet.js
//   npm run test:day-sheet

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

const pass = [], fail = [];
const check = (name, ok, detail) =>
  (ok ? pass : fail).push(name + (!ok && detail !== undefined ? '\n      ' + detail : ''));
const eq = (name, got, want) =>
  check(name, got === want, 'got:  ' + JSON.stringify(got) + '\n      want: ' + JSON.stringify(want));

// ── Extraction ─────────────────────────────────────────────────────────────
// Brace-matched so a nested function or object literal can't end the slice
// early. Naive about braces inside strings, deliberately: the extracted
// declarations contain none, and an edit that adds one fails loudly here
// rather than silently testing the wrong source.
function sliceBalanced(src, startIdx, open, close) {
  const from = src.indexOf(open, startIdx);
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close && --depth === 0) return src.slice(startIdx, i + 1);
  }
  throw new Error('unbalanced ' + open + ' from index ' + startIdx);
}
function extractFn(name) {
  const at = SRC.indexOf('\nfunction ' + name + '(');
  if (at < 0) throw new Error('function ' + name + ' not found in public/index.html');
  return sliceBalanced(SRC, at + 1, '{', '}');
}
function extractArrayVar(name) {
  const at = SRC.indexOf('\nvar ' + name + ' = ');
  if (at < 0) throw new Error('var ' + name + ' not found in public/index.html');
  return sliceBalanced(SRC, at + 1, '[', ']') + ';';
}
// The cap is a plain number, so it comes across as its own line rather than
// a balanced slice — and the test reads the real value instead of hardcoding
// one, so retuning the cap in the app doesn't fail the suite.
function extractNumberVar(name) {
  const m = SRC.match(new RegExp('\\nvar ' + name + ' = (\\d+);'));
  if (!m) throw new Error('var ' + name + ' not found in public/index.html');
  return 'var ' + name + ' = ' + m[1] + ';';
}

// ── Sandbox ────────────────────────────────────────────────────────────────
// Everything the day sheet reads that isn't worth extracting: the mutable
// app state (jobs, settings, bank holidays) and the two renderers it hands
// its HTML to. openScheduleSheet captures instead of painting.
const sandbox = `
  var jobs = [], settings = {}, bankHolidays = {}, activeJobId = null, lastSummaryTotals = null;
  var SHEET = '';
  function openScheduleSheet(html) { SHEET = html; }
`;

const api = {};
new Function('exports', sandbox + [
  extractFn('escapeHtml'),
  extractFn('isoDate'),
  extractFn('parseIsoDate'),
  extractFn('isWorkingDay'),
  extractFn('workingDaySpan'),
  extractFn('jobWorkSat'),
  extractFn('jobWorkAll'),
  extractFn('jobBookedDays'),
  extractFn('displayScheduledJobs'),
  extractFn('scheduleColour'),
  extractFn('scheduleLabelParts'),
  extractFn('scheduleLabel'),
  extractFn('defaultScheduleDays'),
  extractFn('blockedRun'),
  extractFn('openScheduleDaySheet'),
  extractArrayVar('SCHEDULE_COLOURS'),
  extractNumberVar('SCHEDULE_DAY_SHEET_JOBS'),
  'exports.CAP = SCHEDULE_DAY_SHEET_JOBS;',
  'exports.sheetFor = function(state, iso, showAll) {',
  '  jobs = state.jobs || []; settings = state.settings || {}; bankHolidays = state.bankHolidays || {};',
  '  SHEET = ""; openScheduleDaySheet(iso, showAll); return SHEET;',
  '};'
].join('\n'))(api);

// ── Fixture ────────────────────────────────────────────────────────────────
// Dates are relative to the run: "today" moves, and the sheet's rules are
// today-relative, so a fixed calendar would rot.
function iso(offsetDays) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function dow(isoStr) { const p = isoStr.split('-'); return new Date(+p[0], +p[1] - 1, +p[2], 12).getDay(); }
// The next weekday at least `from` days out — the sheet only offers blocking
// on a would-be working day, and a fixture that landed on a Sunday would test
// nothing.
function nextWeekday(from) {
  for (let i = from; i < from + 7; i++) { const x = iso(i); const d = dow(x); if (d >= 1 && d <= 5) return x; }
  throw new Error('no weekday found');
}
const waiting = (n) => Array.from({ length: n }, (_, i) => ({
  id: 'w' + i, name: 'Waiting job ' + (i + 1), status: 'accepted'
}));

const DAY = nextWeekday(1);
const BUSY = { jobs: waiting(12), settings: {}, bankHolidays: {} };

// ── 1. Reachability: the day's own actions come first ──────────────────────
const busy = api.sheetFor(BUSY, DAY);
check('a busy diary still offers Block day(s)', busy.includes('Block day(s)'), busy);
check('with twelve jobs waiting, Block comes BEFORE the waiting list',
  busy.indexOf('Block day(s)') < busy.indexOf('Start a job here'),
  'block at ' + busy.indexOf('Block day(s)') + ', list at ' + busy.indexOf('Start a job here'));
check('the waiting list is still offered, not dropped to make room',
  busy.includes('Start a job here') && busy.includes('Waiting job 1'), busy);

const blockedBusy = api.sheetFor(
  { jobs: waiting(12), settings: { blockedDays: { [DAY]: 'Holiday' } }, bankHolidays: {} }, DAY);
check('a blocked day offers Unblock this day', blockedBusy.includes('Unblock this day'), blockedBusy);
check('and Unblock comes before the waiting list too',
  blockedBusy.indexOf('Unblock this day') < blockedBusy.indexOf('Start a job here'), blockedBusy);

// ── 2. The cap, and the tap that lifts it ──────────────────────────────────
const rows = (html) => (html.match(/scheduleJobFromDay\(/g) || []).length;
eq('the waiting list stops at the cap', rows(busy), api.CAP);
check('and says how many more there are',
  busy.includes((12 - api.CAP) + ' more waiting'), busy);
check('the "more waiting" row reopens the same day, expanded',
  busy.includes('openScheduleDaySheet(\'' + DAY + '\',true)'), busy);

const all = api.sheetFor(BUSY, DAY, true);
eq('expanded, every waiting job is listed', rows(all), 12);
check('and nothing is left behind the tap', !all.includes('more waiting'), all);
check('expanded, Block is STILL above the list',
  all.indexOf('Block day(s)') < all.indexOf('Start a job here'), all);

const few = api.sheetFor({ jobs: waiting(api.CAP), settings: {}, bankHolidays: {} }, DAY);
eq('a list at exactly the cap lists them all', rows(few), api.CAP);
check('and offers no "more waiting" row', !few.includes('more waiting'), few);

// ── 3. The rules that were already there ───────────────────────────────────
const past = api.sheetFor(BUSY, iso(-7));
check('a past day offers no blocking', !past.includes('Block day(s)'), past);
check('and no "start a job here" list either', !past.includes('Start a job here'), past);

const stale = api.sheetFor(
  { jobs: [], settings: { blockedDays: { [iso(-7)]: 'Holiday' } }, bankHolidays: {} }, iso(-7));
check('but a stale block in the past can still be cleared',
  stale.includes('Unblock this day'), stale);

// A Sunday is never a working day, so there is nothing to block.
let sunday = null;
for (let i = 1; i <= 7; i++) if (dow(iso(i)) === 0) sunday = iso(i);
check('a Sunday offers no blocking', !api.sheetFor(BUSY, sunday).includes('Block day(s)'),
  api.sheetFor(BUSY, sunday));

// A bank holiday is off already — same reasoning.
const bhDay = nextWeekday(1);
const bh = api.sheetFor({ jobs: [], settings: {}, bankHolidays: { [bhDay]: 'Spring bank holiday' } }, bhDay);
check('a bank holiday offers no blocking', !bh.includes('Block day(s)'), bh);
check('and names itself', bh.includes('Spring bank holiday'), bh);

// A run of blocked days offers to clear the lot. Five consecutive weekdays
// from a Monday keeps the run inside one week whatever day the test runs.
let monday = null;
for (let i = 1; i <= 7; i++) if (dow(iso(i)) === 1) monday = iso(i);
const runDays = {};
for (let i = 0; i < 5; i++) {
  const p = monday.split('-');
  const d = new Date(+p[0], +p[1] - 1, +p[2] + i, 12);
  runDays[d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')] = 'Holiday';
}
const run = api.sheetFor({ jobs: waiting(12), settings: { blockedDays: runDays }, bankHolidays: {} }, monday);
check('a five-day run offers to unblock all five', run.includes('Unblock all 5 days (Holiday)'), run);
check('and that button is above the waiting list as well',
  run.indexOf('Unblock all 5 days') < run.indexOf('Start a job here'), run);

// A day with work booked on it can still be blocked (Nicky moves the job).
const booked = api.sheetFor({
  jobs: waiting(12).concat([{ id: 'b1', name: 'Booked job', status: 'accepted', startDate: DAY, scheduledDays: 2 }]),
  settings: {}, bankHolidays: {}
}, DAY);
check('a day with a job on it still offers blocking', booked.includes('Block day(s)'), booked);
check('and lists the booked job above the block button',
  booked.indexOf('Booked job') < booked.indexOf('Block day(s)'), booked);

// ── Report ─────────────────────────────────────────────────────────────────
pass.forEach(n => console.log('  ok   ' + n));
fail.forEach(n => console.log('  FAIL ' + n));
console.log('\n' + pass.length + ' passed, ' + fail.length + ' failed');
process.exit(fail.length ? 1 : 0);
