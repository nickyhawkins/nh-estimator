#!/usr/bin/env node
'use strict';

// ── Regression test: a material you add by hand is BILLED by default ───────
//
// Field report (2026-09-05): a quote went out, the client changed her mind on
// the paint, and the quantities hadn't allowed for the external plastic doors
// or the kitchen. So the calculated materials were deleted and the real ones
// entered by hand on Summary's Add Material form -- and the material cost
// never reached the total. Not on a new Xero quote, not on an update to the
// original one, not in the deposit. Labour was the whole quote.
//
// The cause was one class name. Summary's Chargeable toggle rendered OFF:
//
//     '<div class="toggle" id="add-mat-chargeable" ...>'
//
// and addCustomMaterialLine reads that DOM state straight into the line
// (`chargeable: el.classList.contains('on')`), so every hand-added line was
// written as an explicit `chargeable: false` unless the toggle was noticed
// and tapped. `chargeable === false` is the one value materialsSnapshotTotal()
// and createXeroQuote()'s filter both drop -- deliberately, for tracking-only
// shopping-list entries -- so the money was excluded exactly as designed, by
// a decision the user never made. Every other writer of the flag defaults it
// ON: recalculateMaterialsSnapshot() stamps `chargeable: true` on calculated
// lines, and a line saved before the flag existed reads as chargeable. The
// form was the only place the convention was inverted.
//
// What is asserted here: the rendered default, the two functions that decide
// whether a line's money counts, and the snapshot/form plumbing around them
// (a deliberate switch-OFF must survive the mid-entry re-render, and clearing
// the form after an add must leave the toggle back at its default, not off).
//
// Pure node against the real source -- functions extracted out of
// public/index.html by name, the same shape as test-material-split.js. No
// database, no browser, no Xero connection.
//
// USAGE
//   node scripts/test-material-chargeable.js
//   npm run test:chargeable

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

const pass = [], fail = [];
const check = (name, ok, detail) =>
  (ok ? pass : fail).push(name + (!ok && detail !== undefined ? '\n      ' + detail : ''));
const eq = (name, got, want) =>
  check(name, JSON.stringify(got) === JSON.stringify(want),
    'got:  ' + JSON.stringify(got) + '\n      want: ' + JSON.stringify(want));

// ── Extraction ─────────────────────────────────────────────────────────────
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

// ── 1. The rendered default ────────────────────────────────────────────────
// The bug itself, asserted at the level it lived at: the class list the
// toggle is written with. `toggle on` is the app's default-on convention
// (tog-cu-markup, tog-sprayceil, tog-spraywood all use it).
const toggleTag = (SRC.match(/<div class="([^"]*)" id="add-mat-chargeable"/) || [])[1];
check('Summary\'s Chargeable toggle renders ON by default',
  /(^|\s)on(\s|$)/.test(toggleTag || ''), 'class list: ' + JSON.stringify(toggleTag));

// And the line that reads it still reads the DOM, so the default above is
// what a line actually gets written with (this is the coupling that made a
// class name a pricing bug -- if it is ever replaced by a variable, this
// test's first assertion stops being the whole story and should be revisited).
check('and the added line takes its chargeable flag from that toggle',
  /chargeable\s*=\s*document\.getElementById\('add-mat-chargeable'\)\.classList\.contains\('on'\)/.test(SRC));

// ── 2. What the flag then does to the money ────────────────────────────────
const totalFn = new Function('materialsSnapshot',
  extractFn('materialsSnapshotTotal') + '; return materialsSnapshotTotal();');
const trackingFn = new Function('materialsSnapshot',
  extractFn('materialsTrackingOnlyTotal') + '; return materialsTrackingOnlyTotal();');

const line = (qty, price, chargeable) => {
  const l = { id: 'x', description: 'Paint', quantity: qty, unitAmount: price, custom: true, source: 'manual' };
  if (chargeable !== undefined) l.chargeable = chargeable;
  return l;
};

// The real job: the calculated lines deleted, the doors and kitchen entered
// by hand. Written the way the fixed form writes them, this is £180 of paint
// on the quote; written the way the broken form wrote them, it was £0.
const asFixed = [line(3, 40, true), line(2, 30, true)];
const asBroken = [line(3, 40, false), line(2, 30, false)];
eq('hand-added materials reach the quote total', totalFn(asFixed), 180);
eq('the broken form\'s lines are the regression: none of it counted', totalFn(asBroken), 0);
eq('a tracking-only line still costs something, and is reported', trackingFn(asBroken), 180);
eq('and a billed line is never double-counted as tracking-only', trackingFn(asFixed), 0);

// Lines saved before the flag existed carry no `chargeable` at all, and have
// always read as chargeable. Unchanged by the fix, and asserted so the two
// halves of the split stay a partition of the list.
eq('a line saved before the flag existed still counts', totalFn([line(1, 25)]), 25);
eq('and is not counted as tracking-only either', trackingFn([line(1, 25)]), 0);
const mixed = [line(3, 40, true), line(2, 30, false), line(1, 25)];
eq('the two halves add back up to the whole list',
  Math.round((totalFn(mixed) + trackingFn(mixed)) * 100) / 100, 205);

// The deliberate choice still works: tracking-only is out of the total, which
// is the whole point of the toggle and must not be "fixed" away.
eq('a line switched to tracking-only stays out of the total',
  totalFn([line(3, 40, true), line(4, 12.5, false)]), 120);

// The Xero quote filters on the same rule (createXeroQuote's materials
// mapping), so a line that counts on Summary is a line that reaches Xero.
check('the Xero quote drops exactly the same lines Summary does',
  /materialsSnapshot\.filter\(function\s*\(l\)\s*\{ return l\.chargeable !== false; \}\)/.test(SRC.replace(/\s+/g, ' ')));

// ── 3. A quote that is SENT but not accepted still re-prices ──────────────
// Where the bug was actually met: the quote had gone out, the client changed
// her mind, and the materials were re-entered to re-send. Nothing about that
// state pins the total -- `quoted` is deliberately NOT one of the statuses
// the accepted-quote freeze covers, so Summary and the Xero payload are both
// built from the live snapshot every time, and an edit to the materials of a
// sent quote reaches the update-in-place exactly as it reaches a new one.
// The money not moving there was the chargeable flag and nothing else.
const frozenStatuses = JSON.parse(
  (SRC.match(/var FROZEN_QUOTE_STATUSES = (\[[^\]]*\])/) || [])[1].replace(/'/g, '"'));
eq('the freeze covers accepted work only', frozenStatuses, ['accepted', 'completed', 'invoiced']);
check('so a sent-but-unanswered quote re-prices live, materials included',
  frozenStatuses.indexOf('quoted') === -1 && frozenStatuses.indexOf('draft') === -1,
  JSON.stringify(frozenStatuses));
// And the update-in-place path is the same function as a new quote, so there
// is no second materials rule for a re-send to drift from.
check('and "Update quote" is the same builder as "Send to Xero"',
  /var updateQuoteId = !forceNew && quoteIsUpdatable\(activeJob\(\)\) \? activeJob\(\)\.xeroQuoteId : undefined;/.test(SRC));

// ── 4. The form plumbing around the default ────────────────────────────────
// A re-render mid-entry (ticking another row's quantity) rebuilds the form's
// HTML, which now comes back ON. So a deliberate switch-off has to be written
// back as off, not merely "not re-added" -- otherwise the default would
// quietly undo the user's tap and bill a line they marked tracking-only.
const dom = {};
const makeEl = (cls) => {
  const set = new Set(cls ? cls.split(' ') : []);
  return { value: '', classList: {
    contains: (c) => set.has(c),
    add: (c) => set.add(c),
    remove: (c) => set.delete(c),
    toggle: (c, on) => { if (on === undefined) { set.has(c) ? set.delete(c) : set.add(c); } else if (on) set.add(c); else set.delete(c); return set.has(c); }
  } };
};
const sandbox = { document: { getElementById: (id) => dom[id] || null } };
const formFns = new Function('document',
  extractFn('snapshotFields') + '\n' + extractFn('restoreFields') + '\n' +
  SRC.slice(SRC.indexOf('var DEFAULT_ON_TOGGLE_IDS'), SRC.indexOf('\n', SRC.indexOf('var DEFAULT_ON_TOGGLE_IDS'))) + '\n' +
  extractFn('clearFormFields') +
  '; return { snapshotFields: snapshotFields, restoreFields: restoreFields, clearFormFields: clearFormFields };')(sandbox.document);

const IDS = ['add-mat-desc', 'add-mat-chargeable'];
// Switched off by hand, then a re-render: the form comes back ON from its
// markup and the restore has to put it back off.
dom['add-mat-desc'] = makeEl();
dom['add-mat-desc'].value = 'Dust sheets';
dom['add-mat-chargeable'] = makeEl('toggle');      // user tapped it off
let snap = formFns.snapshotFields(IDS);
dom['add-mat-chargeable'] = makeEl('toggle on');   // re-rendered default
dom['add-mat-desc'] = makeEl();
formFns.restoreFields(snap);
check('a deliberate switch-off survives a re-render mid-entry',
  !dom['add-mat-chargeable'].classList.contains('on'));
eq('and the half-typed description survives with it', dom['add-mat-desc'].value, 'Dust sheets');

// Left alone, it stays on through the same re-render.
dom['add-mat-chargeable'] = makeEl('toggle on');
snap = formFns.snapshotFields(IDS);
dom['add-mat-chargeable'] = makeEl('toggle on');
formFns.restoreFields(snap);
check('and a toggle left at its default comes back on',
  dom['add-mat-chargeable'].classList.contains('on'));

// After an add, the form is cleared -- and must clear back to the DEFAULT,
// because the render that follows restores whatever the clear left behind.
// Clearing it to off would mean the second line you add is never billed.
dom['add-mat-chargeable'] = makeEl('toggle on');
dom['add-mat-desc'] = makeEl();
dom['add-mat-desc'].value = 'Dust sheets';
formFns.clearFormFields(IDS);
check('clearing the form after an add leaves Chargeable back on',
  dom['add-mat-chargeable'].classList.contains('on'));
eq('and empties the typed fields', dom['add-mat-desc'].value, '');
snap = formFns.snapshotFields(IDS);
dom['add-mat-chargeable'] = makeEl('toggle on');
formFns.restoreFields(snap);
check('so the next line added after one is entered is billed too',
  dom['add-mat-chargeable'].classList.contains('on'));

// ── Report ─────────────────────────────────────────────────────────────────
pass.forEach(n => console.log('  ok   ' + n));
fail.forEach(n => console.log('  FAIL ' + n));
console.log('\n' + pass.length + ' passed, ' + fail.length + ' failed');
process.exit(fail.length ? 1 : 0);
