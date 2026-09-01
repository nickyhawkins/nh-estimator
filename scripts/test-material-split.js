#!/usr/bin/env node
'use strict';

// ── Regression test: splitting a consolidated materials row ────────────────
//
// Summary shows ONE row per product + tin size, but the record underneath is
// still one line per colour. So a total typed on the row has to be divided
// back across those colours, and for a while it was divided badly enough to
// send Nicky to the merchant with the wrong paint (2026-09-01):
//
//   • it spread the total proportionally and put the ROUNDING REMAINDER on
//     the LARGEST line. Coming down, that remainder is always negative, so
//     the colour needing the MOST paint was the one reliably gutted --
//     2/1/1 tins typed down to 2 wrote 0/1/1, no paint at all for the
//     biggest wall, and the shopping list said so.
//   • the same line was then clamped at 0 and the leftover thrown away, so
//     four colours at 1 tin typed down to 2 wrote THREE tins, not 2.
//
// Both of those are asserted below as named regressions, so neither can come
// back quietly. The rule they were replaced with (Nicky's, same day): take
// the reduction off the largest colour first, and never leave a colour that
// still holds paint with none -- a wall missing from the list is a second
// trip, which costs more than a spare tin. Below the point where every
// colour can keep something the split refuses to guess and reports a floor,
// and the row's per-colour boxes are the way past it.
//
// The two properties swept exhaustively at the end are the ones the bugs
// broke, and they are what this file is really for:
//   1. the total written is EXACTLY the total typed (or exactly the floor
//      the split reported holding at -- never a third number);
//   2. no colour holding paint is ever silently taken to zero.
//
// Pure node against the real source: splitMaterialGroupQuantity is extracted
// out of public/index.html by name, the same shape as test-scope-text.js. No
// database, no browser, no server.
//
// USAGE
//   node scripts/test-material-split.js
//   npm run test:split

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
// Brace-matched, so a nested function or object literal can't end the slice
// early (same helper as test-scope-text.js).
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

const split = new Function(extractFn('splitMaterialGroupQuantity') +
  '; return splitMaterialGroupQuantity;')();

const sum = a => Math.round(a.reduce((x, y) => x + y, 0) * 100) / 100;

// ── The two original bugs, as named cases ──────────────────────────────────
// The real job: one product, three colours, 2 + 1 + 1 tins, typed down to 2.
const threeColours = [2, 1, 1];
check('the biggest wall is never the one left with no paint',
  split(threeColours, 2).quantities[0] > 0,
  JSON.stringify(split(threeColours, 2).quantities));
eq('and every colour keeps a tin instead', split(threeColours, 2).quantities, [1, 1, 1]);
check('a total it cannot honour is reported, not silently invented',
  split(threeColours, 2).floor === 3, JSON.stringify(split(threeColours, 2)));
check('and the floor names how many colours it is covering',
  split(threeColours, 2).covering === 3, JSON.stringify(split(threeColours, 2)));

// Four colours at a tin each, typed down to 2: the old code wrote 3 tins.
const fourColours = [1, 1, 1, 1];
eq('four colours at a tin each cannot go below four tins', split(fourColours, 2).quantities, fourColours);
check('and the row says so rather than writing a number nobody typed',
  split(fourColours, 2).floor === 4, JSON.stringify(split(fourColours, 2)));

// ── The rule itself ────────────────────────────────────────────────────────
eq('the reduction comes off the largest colour first', split([3, 1], 2).quantities, [1, 1]);
eq('and off the largest again when there is further to go', split([4, 1], 3).quantities, [2, 1]);
eq('a big colour is levelled down to the others, not past them',
  split([4, 2, 2], 5).quantities, [2, 1, 2]);
eq('so the colour needing most is never left holding least',
  split([6, 3, 1], 5).quantities, [2, 2, 1]);
eq('typing 0 means none of this product at all', split([2, 1, 1], 0).quantities, [0, 0, 0]);
eq('a colour already at zero is left at zero', split([0, 2, 1], 2).quantities, [0, 1, 1]);
eq('raising the total is proportional to what each colour holds',
  split([2, 1, 1], 8).quantities, [4, 2, 2]);
eq('and the odd tin on a raise goes to the biggest fraction',
  split([2, 1, 1], 6).quantities, [3, 2, 1]);
eq('a group of one is just that line', split([5], 2).quantities, [2]);
eq('a group sitting at nothing is dealt from the top', split([0, 0], 3).quantities, [2, 1]);

// Per-litre lines (ceiling, woodwork, mist) are sold by the litre, so they
// step in tenths and their floor is a tenth of a litre, not a whole tin.
eq('per-litre lines split in tenths of a litre', split([2, 1], 1.2, true).quantities, [0.6, 0.6]);
check('and a per-litre reduction still comes off the larger first',
  split([2, 1], 2.4, true).quantities[0] < 2, JSON.stringify(split([2, 1], 2.4, true).quantities));
check('a per-litre split lands on exactly the litres typed',
  sum(split([1.5, 0.5], 1.3, true).quantities) === 1.3,
  JSON.stringify(split([1.5, 0.5], 1.3, true)));

// ── The sweep ──────────────────────────────────────────────────────────────
// Every three-colour group up to 6 tins each, against every typed total up to
// 14. Both bugs were arithmetic that looked fine in the case that was tried,
// so the properties are asserted over the whole space rather than sampled.
let badTotal = null, zeroed = null, combos = 0;
for (let a = 0; a <= 6; a++) for (let b = 0; b <= 6; b++) for (let c = 0; c <= 6; c++) {
  for (let typed = 0; typed <= 14; typed++) {
    const cur = [a, b, c];
    const res = split(cur, typed);
    const want = res.floor == null ? typed : res.floor;
    if (Math.abs(sum(res.quantities) - want) > 1e-9) {
      badTotal = badTotal || { cur, typed, res };
    }
    // Typing 0 is the one case where emptying a colour IS what was asked.
    if (typed > 0) cur.forEach((q, i) => {
      if (q > 0 && res.quantities[i] === 0) zeroed = zeroed || { cur, typed, got: res.quantities };
    });
    combos++;
  }
}
check('every split writes exactly the total typed, or exactly the floor it reports',
  !badTotal, JSON.stringify(badTotal));
check('and no colour holding paint is ever taken to zero unless 0 was typed',
  !zeroed, JSON.stringify(zeroed));
console.log('  ..   swept ' + combos + ' colour/total combinations');

// ── Report ─────────────────────────────────────────────────────────────────
pass.forEach(n => console.log('  ok   ' + n));
fail.forEach(n => console.log('  FAIL ' + n));
console.log('\n' + pass.length + ' passed, ' + fail.length + ' failed');
process.exit(fail.length ? 1 : 0);
