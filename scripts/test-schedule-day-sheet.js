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
// What this holds still (v2.53.1):
//   1. THE REACHABILITY PROPERTY. However many jobs are waiting, the day's own
//      Block/Unblock buttons come BEFORE the waiting list in the sheet.
//   2. The waiting list is capped, with the remainder behind one tap, and
//      "show all" really does list the lot.
//   3. THE OFFERED-EVERYWHERE PROPERTY (v2.53.2). Blocking used to be gated on
//      the day being a working one under the GLOBAL rule, so a Saturday a job
//      actually works — via its own "+ Saturdays"/"Every day" override — was
//      offered no button at all, and the reporter read the missing button as
//      a sheet that wouldn't scroll. Every day from today forward offers it
//      now, and the tapped day is really stored: the old range fill skipped
//      non-working days, so blocking one Saturday wrote nothing whatsoever.
//   4. And the range fill still doesn't spray chips over weekends it merely
//      swept past, which is what that rule was always for.
//   5. The old rules that still hold: no blocking a past day, unblocking
//      offered on any blocked day, a multi-day run offering to clear itself
//      whole.
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
// Ordering, stated so a MISSING needle fails rather than passing on -1 — the
// whole bug here was a button that wasn't rendered at all.
const before = (html, a, b) =>
  html.includes(a) && html.includes(b) && html.indexOf(a) < html.indexOf(b);

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
  // confirmScheduleBlock reads the form's two fields and then hands off to
  // persistBlockedDays (localStorage + a PUT + four re-renders) — none of
  // which is what this file is about, so the fields are a plain object and
  // the hand-off is counted rather than performed.
  var FIELDS = {}, PERSISTED = 0;
  var document = { getElementById: function(id) { return FIELDS[id] || null; } };
  function persistBlockedDays() { PERSISTED++; }
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
  extractFn('fmtShortDate'),
  extractFn('scheduledJobs'),
  extractFn('bookedDaySet'),
  extractFn('openScheduleBlockForm'),
  extractFn('confirmScheduleBlock'),
  extractFn('openScheduleDaySheet'),
  extractArrayVar('SCHEDULE_COLOURS'),
  extractNumberVar('SCHEDULE_DAY_SHEET_JOBS'),
  'exports.CAP = SCHEDULE_DAY_SHEET_JOBS;',
  'exports.sheetFor = function(state, iso, showAll) {',
  '  jobs = state.jobs || []; settings = state.settings || {}; bankHolidays = state.bankHolidays || {};',
  '  SHEET = ""; openScheduleDaySheet(iso, showAll); return SHEET;',
  '};',
  // The block form, and the write behind its Block button. Returns what the
  // range actually stored, which is the half that used to do nothing.
  'exports.formFor = function(state, iso) {',
  '  jobs = state.jobs || []; settings = state.settings || {}; bankHolidays = state.bankHolidays || {};',
  '  SHEET = ""; openScheduleBlockForm(iso); return SHEET;',
  '};',
  'exports.blockFor = function(state, fromIso, toIso, label) {',
  '  jobs = state.jobs || []; settings = state.settings || {}; bankHolidays = state.bankHolidays || {};',
  '  FIELDS = { "block-to": { value: toIso || "" }, "block-label": { value: label || "" } };',
  '  PERSISTED = 0; confirmScheduleBlock(fromIso);',
  '  return { days: settings.blockedDays || {}, persisted: PERSISTED };',
  '};'
].join('\n'))(api);

// ── Fixture ────────────────────────────────────────────────────────────────
// Dates are relative to the run: "today" moves, and the sheet's rules are
// today-relative, so a fixed calendar would rot.
function isoOf(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function iso(offsetDays) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return isoOf(d);
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
  before(busy, 'Block day(s)', 'Start a job here'),
  'block at ' + busy.indexOf('Block day(s)') + ', list at ' + busy.indexOf('Start a job here') +
  ' (-1 means it never rendered)');
check('the waiting list is still offered, not dropped to make room',
  busy.includes('Start a job here') && busy.includes('Waiting job 1'), busy);

const blockedBusy = api.sheetFor(
  { jobs: waiting(12), settings: { blockedDays: { [DAY]: 'Holiday' } }, bankHolidays: {} }, DAY);
check('a blocked day offers Unblock this day', blockedBusy.includes('Unblock this day'), blockedBusy);
check('and Unblock comes before the waiting list too',
  before(blockedBusy, 'Unblock this day', 'Start a job here'), blockedBusy);

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
  before(all, 'Block day(s)', 'Start a job here'), all);

const few = api.sheetFor({ jobs: waiting(api.CAP), settings: {}, bankHolidays: {} }, DAY);
eq('a list at exactly the cap lists them all', rows(few), api.CAP);
check('and offers no "more waiting" row', !few.includes('more waiting'), few);

// ── 3. Past days, and stale blocks ─────────────────────────────────────────
const past = api.sheetFor(BUSY, iso(-7));
check('a past day offers no blocking', !past.includes('Block day(s)'), past);
check('and no "start a job here" list either', !past.includes('Start a job here'), past);

const stale = api.sheetFor(
  { jobs: [], settings: { blockedDays: { [iso(-7)]: 'Holiday' } }, bankHolidays: {} }, iso(-7));
check('but a stale block in the past can still be cleared',
  stale.includes('Unblock this day'), stale);

// ── 4. Offered on every day from today, not just the usual working ones ────
// The reported case: a Saturday a booked job actually works, on a diary whose
// Saturdays are globally off. The old rule withheld the button here, which is
// indistinguishable from a sheet that won't scroll to it.
let saturday = null;
for (let i = 1; i <= 7; i++) if (dow(iso(i)) === 6) saturday = iso(i);
const satMonday = (() => { const p = saturday.split('-'); const d = new Date(+p[0], +p[1] - 1, +p[2] - 5, 12); return isoOf(d); })();
const OVERRIDE_JOB = {
  id: 'wh', name: 'Whole House', xeroClient: 'Lauren McDonald', status: 'accepted',
  startDate: satMonday, scheduledDays: 14, workAllDays: true
};
const satState = { jobs: waiting(2).concat([OVERRIDE_JOB]), settings: { workSaturdays: false }, bankHolidays: {} };
const satSheet = api.sheetFor(satState, saturday);
check('the reported case: the job really does book that Saturday',
  satSheet.includes('Whole House'), satSheet);
check('and the Saturday offers blocking, though Saturdays are globally off',
  satSheet.includes('Block day(s)'), satSheet);
check('with the button above the waiting list, as everywhere else',
  before(satSheet, 'Block day(s)', 'Start a job here'), satSheet);

// A Sunday and a bank holiday with nothing on them: no longer withheld
// either. A day off in the usual week can still be a day a job works.
let sunday = null;
for (let i = 1; i <= 7; i++) if (dow(iso(i)) === 0) sunday = iso(i);
check('a Sunday offers blocking too', api.sheetFor(BUSY, sunday).includes('Block day(s)'),
  api.sheetFor(BUSY, sunday));

const bhDay = nextWeekday(1);
const bh = api.sheetFor({ jobs: [], settings: {}, bankHolidays: { [bhDay]: 'Spring bank holiday' } }, bhDay);
check('a bank holiday offers blocking', bh.includes('Block day(s)'), bh);
check('and names itself', bh.includes('Spring bank holiday'), bh);

// The form says what blocking an already-off day is for, and doesn't
// clutter an ordinary weekday with it.
const satForm = api.formFor(satState, saturday);
check('the form explains blocking a day the usual week has off',
  satForm.includes('isn\u2019t one of your usual working days'), satForm);
check('and says nothing of the sort on a weekday',
  !api.formFor(satState, nextWeekday(1)).includes('usual working days'),
  api.formFor(satState, nextWeekday(1)));

// ── 5. What the range actually writes ──────────────────────────────────────
// The half that used to do nothing: the old fill stored working days only,
// so blocking a single Saturday wrote no key at all and the day came back
// unblocked.
const oneSat = api.blockFor({ jobs: [OVERRIDE_JOB], settings: { workSaturdays: false }, bankHolidays: {} },
  saturday, saturday, 'Family thing');
eq('blocking one Saturday stores that Saturday', oneSat.days[saturday], 'Family thing');
eq('and stores nothing else', Object.keys(oneSat.days).length, 1);
eq('and saves once', oneSat.persisted, 1);

// An unlabelled block still gets a label to draw and to group a run by.
const bare = api.blockFor({ jobs: [], settings: {}, bankHolidays: {} }, saturday, saturday, '');
eq('an unlabelled block falls back to "Blocked"', bare.days[saturday], 'Blocked');

// A range from a Monday across a weekend: the weekend is off anyway and
// stays unstored — the noise-chip rule the fill was written for.
const mon = (() => { for (let i = 1; i <= 7; i++) if (dow(iso(i)) === 1) return iso(i); throw new Error('no Monday'); })();
const plus = (isoStr, n) => { const p = isoStr.split('-'); return isoOf(new Date(+p[0], +p[1] - 1, +p[2] + n, 12)); };
const fortnight = api.blockFor({ jobs: [], settings: { workSaturdays: false }, bankHolidays: {} },
  mon, plus(mon, 11), 'Holiday');
eq('a Mon-to-Fri-next-week range stores its ten working days',
  Object.keys(fortnight.days).length, 10);
check('and leaves the weekend it swept past alone',
  !fortnight.days[plus(mon, 5)] && !fortnight.days[plus(mon, 6)], Object.keys(fortnight.days).sort());

// Unless a job is working that weekend, in which case it is a day off to
// take, not a day already off.
const workedWeekend = api.blockFor(
  { jobs: [{ id: 'wh2', name: 'Whole House', status: 'accepted', startDate: mon, scheduledDays: 14, workAllDays: true }],
    settings: { workSaturdays: false }, bankHolidays: {} },
  mon, plus(mon, 11), 'Holiday');
check('a weekend a job actually works IS blocked by the range',
  workedWeekend.days[plus(mon, 5)] === 'Holiday' && workedWeekend.days[plus(mon, 6)] === 'Holiday',
  Object.keys(workedWeekend.days).sort());

// A backwards range is read as the single day tapped, not as nothing.
const backwards = api.blockFor({ jobs: [], settings: {}, bankHolidays: {} }, mon, plus(mon, -3), 'Oops');
eq('an end date before the start blocks just the tapped day',
  Object.keys(backwards.days).join(), mon);

// ── 6. The rules that were already there ───────────────────────────────────

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
  before(run, 'Unblock all 5 days', 'Start a job here'), run);

// A day with work booked on it can still be blocked (Nicky moves the job).
const booked = api.sheetFor({
  jobs: waiting(12).concat([{ id: 'b1', name: 'Booked job', status: 'accepted', startDate: DAY, scheduledDays: 2 }]),
  settings: {}, bankHolidays: {}
}, DAY);
check('a day with a job on it still offers blocking', booked.includes('Block day(s)'), booked);
check('and lists the booked job above the block button',
  before(booked, 'Booked job', 'Block day(s)'), booked);

// ── Report ─────────────────────────────────────────────────────────────────
pass.forEach(n => console.log('  ok   ' + n));
fail.forEach(n => console.log('  FAIL ' + n));
console.log('\n' + pass.length + ' passed, ' + fail.length + ' failed');
process.exit(fail.length ? 1 : 0);
