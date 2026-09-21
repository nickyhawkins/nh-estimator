#!/usr/bin/env node
'use strict';

// ── Regression test: what the invoice's Xero line descriptions actually say ─
//
// Two things went out on a real invoice (2026-09-21) and are held here:
//
//   1. "Sundries & Consumables - same as above". On a frozen job the labour
//      lines ARE the accepted snapshot's work rows, and those include the
//      rows that are not measured work at all -- sundries (a stated % of
//      labour), typed-in custom lines, the rounding adjustment. The compose
//      loop handed every line after the first a "- same as above", so a
//      percentage line claimed to be the same painting work as the Lounge.
//   2. The room's name printed twice. The block describes the ONE line it
//      sits on and opens by naming it ("Painting — Lounge"), so prefixing
//      that line with the bare label as well read "Lounge / Painting —
//      Lounge …" on the client's document.
//
// Pure node against the real source: the helpers and the compose loop itself
// are extracted out of public/index.html and run, so this tests the shipping
// code rather than a copy of it.
//
// USAGE
//   node scripts/test-invoice-line-text.js
//   npm run test:invoice-lines

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

const pass = [], fail = [];
const check = (name, ok, detail) =>
  (ok ? pass : fail).push(name + (!ok && detail !== undefined ? '\n      ' + detail : ''));
const eq = (name, got, want) =>
  check(name, got === want, 'got:  ' + JSON.stringify(got) + '\n      want: ' + JSON.stringify(want));

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
function extractAssigned(name) {
  const at = SRC.indexOf('\n  var ' + name + ' = function(');
  if (at < 0) throw new Error('var ' + name + ' not found in public/index.html');
  return '(' + sliceBalanced(SRC, SRC.indexOf('function(', at), '{', '}') + ')';
}
// The compose loop verbatim, from the block's first statement to the
// 4,000-character guard that follows it.
function extractComposeLoop() {
  const from = SRC.indexOf('  var invBlock = (s.invoiceText || \'\').trim();');
  const to = SRC.indexOf('\n  if (lines.some(function(l) { return (l.description || \'\').length > 4000; }))', from);
  if (from < 0 || to < 0) throw new Error('invoice compose loop not found in public/index.html');
  return SRC.slice(from, to);
}

const ctx = {};
vm.createContext(ctx);
vm.runInContext(extractFn('blockNamesItsLine'), ctx);
vm.runInContext(extractFn('blockLineDescription'), ctx);
const frozenRowOwnText = vm.runInContext(extractAssigned('frozenRowOwnText'), ctx);
const COMPOSE = extractComposeLoop();

// ── 1. The block's line names itself ───────────────────────────────────────
const QUOTE_BLOCK = 'Painting of Lounge:\n\nPROTECTION & PREPARATION\nAll furniture…';
const INV_BLOCK = 'Painting — Lounge\nSurfaces prepared including filling, sanding…';

eq('the invoice block\'s line drops the label it already names',
  ctx.blockLineDescription('Lounge', INV_BLOCK), INV_BLOCK);
eq('the quote block\'s line drops it too, colon and all',
  ctx.blockLineDescription('Lounge', QUOTE_BLOCK), QUOTE_BLOCK);
eq('a block that does not name the line keeps the label above it',
  ctx.blockLineDescription('Lounge', 'Exterior Woodwork\n\nPROTECTION…'),
  'Lounge\n\nExterior Woodwork\n\nPROTECTION…');
eq('a hand-edited block naming nothing keeps the label',
  ctx.blockLineDescription('Bedroom 1', 'As discussed on site.\n\nTwo coats throughout.'),
  'Bedroom 1\n\nAs discussed on site.\n\nTwo coats throughout.');
// The block moved (its room was dropped from the invoice): the header names
// a DIFFERENT room, so the label is the only thing saying what this line is.
eq('a block whose line moved keeps the new line\'s label',
  ctx.blockLineDescription('Bedroom 1', INV_BLOCK), 'Bedroom 1\n\n' + INV_BLOCK);
check('a label that is only part of the name it ends with is not a match',
  ctx.blockLineDescription('Bedroom', 'Painting — Bedroom 1\nSurfaces prepared…')
    === 'Bedroom\n\nPainting — Bedroom 1\nSurfaces prepared…');
eq('a dotted label still matches', ctx.blockLineDescription('W.C.', 'Painting of W.C.:\n\nPROTECTION…'),
  'Painting of W.C.:\n\nPROTECTION…');
eq('case is not a reason to print the name twice',
  ctx.blockLineDescription('lounge', INV_BLOCK), INV_BLOCK);
eq('the kitchen\'s scope limit is not a name the header carries',
  ctx.blockLineDescription('Kitchen Cabinet Spraying (outside faces only)', INV_BLOCK),
  'Kitchen Cabinet Spraying (outside faces only)\n\n' + INV_BLOCK);

// ── 2. Which frozen rows are measured work ─────────────────────────────────
const ownText = (sourceKey, description) => frozenRowOwnText({ sourceKey, description });
check('a frozen room row carries the block', ownText('room:ab12', 'Lounge') === false);
check('a frozen exterior row carries the block', ownText('ext:cd34', 'Fascias') === false);
check('the kitchen row carries the block', ownText('kitchen:kitchen', 'Kitchen Cabinet Spraying') === false);
check('a fitted unit row carries the block', ownText('fittedunit:ef56', 'Alcove unit') === false);
check('the sundries row describes itself', ownText('sundries', 'Sundries & Consumables') === true);
check('a custom line describes itself', ownText('custom:gh78', 'Scaffold hire') === true);
// Snapshots frozen before sourceKey existed carry no key at all.
check('a legacy sundries row is still recognised', ownText('', 'Sundries & Consumables') === true);
check('a legacy rounding row is still recognised', ownText('', 'Price adjustment') === true);
check('a legacy standalone row is still recognised',
  ownText('', 'Standalone job — full diary days') === true);
check('a legacy room row still carries the block', ownText('', 'Lounge') === false);

// ── 3. The compose loop, run as it ships ───────────────────────────────────
function compose(model, handEdited) {
  const c = { s: model, lines: [], blockLineDescription: ctx.blockLineDescription,
              templateTextHandEdited: () => !!handEdited };
  vm.createContext(c);
  vm.runInContext(COMPOSE, c);
  return c.lines.map(l => l.description);
}
// The invoice from the bug report: a frozen job whose work rows are Lounge,
// Bedroom and the agreed sundries line.
const FROZEN = {
  invoiceText: INV_BLOCK,
  labour: [
    { id: 'fz0', desc: 'Lounge', amount: 561.35 },
    { id: 'fz1', desc: 'Bedroom', amount: 136.95 },
    { id: 'fz2', desc: 'Sundries & Consumables', amount: 20.94, ownText: true }
  ]
};
const frozenOut = compose(FROZEN, false);
eq('the block rides the first work line, naming the room once', frozenOut[0], INV_BLOCK);
eq('the second work line points back at it', frozenOut[1], 'Bedroom - same as above');
eq('the sundries line says only what it is', frozenOut[2], 'Sundries & Consumables');
check('every line still reaches the invoice', frozenOut.length === 3, frozenOut.join(' | '));

// A sundries row FIRST (a dropped Lounge, or a snapshot ordered differently)
// must not swallow the block: it lands on the first line that is work.
const SUNDRIES_FIRST = {
  invoiceText: INV_BLOCK,
  labour: [
    { id: 'fz0', desc: 'Sundries & Consumables', amount: 20.94, ownText: true },
    { id: 'fz1', desc: 'Lounge', amount: 561.35 },
    { id: 'fz2', desc: 'Bedroom', amount: 136.95 }
  ]
};
eq('a sundries line first never takes the block',
  compose(SUNDRIES_FIRST, false).join(' ¶ '),
  'Sundries & Consumables ¶ ' + INV_BLOCK + ' ¶ Bedroom - same as above');

// Live (unfrozen) jobs: scope lines still work, and the baseline is the
// first WORK line's scope even when a self-describing line precedes it.
const LIVE = {
  invoiceText: INV_BLOCK,
  labour: [
    { id: 'r0', desc: 'Lounge', amount: 561.35, scope: 'Ceilings, walls and woodwork, 2 coats throughout.' },
    { id: 'r1', desc: 'Bedroom', amount: 136.95, scope: 'Ceilings, walls and woodwork, 2 coats throughout.' },
    { id: 'r2', desc: 'Bathroom', amount: 90, scope: 'Walls in Tikkurila Optiva 5, 2 coats throughout.' },
    { id: 'cu0', desc: 'Scaffold hire (fixed price)', amount: 120, ownText: true },
    { id: 'adjustment', desc: 'Price adjustment', amount: 3.4, ownText: true }
  ]
};
const liveOut = compose(LIVE, false);
eq('a matching room still collapses', liveOut[1], 'Bedroom - same as above');
eq('a differing room still states its own scope', liveOut[2],
  'Bathroom\n\nWalls in Tikkurila Optiva 5, 2 coats throughout.\n\nPreparation and completion as above.');
eq('a typed-in custom line keeps its own text', liveOut[3], 'Scaffold hire (fixed price)');
eq('the rounding line keeps its own text', liveOut[4], 'Price adjustment');

// Hand-edited text switches the generated scope sentences off, as before —
// and still must not put "same as above" on a percentage line.
const editedOut = compose(LIVE, true);
eq('hand-edited: the block still names its line once', editedOut[0], INV_BLOCK);
eq('hand-edited: later rooms go back to "same as above"', editedOut[2], 'Bathroom - same as above');
eq('hand-edited: the custom line is still left alone', editedOut[3], 'Scaffold hire (fixed price)');

// A job with no description block at all: every line is its bare label.
eq('no block, no generated text anywhere',
  compose(Object.assign({}, FROZEN, { invoiceText: '' }), false).join(' ¶ '),
  'Lounge ¶ Bedroom ¶ Sundries & Consumables');

// Dropping the block's own room moves the block to the next line, which
// then keeps its label: the header names the Lounge and this line is not it.
eq('a dropped line is not billed, and the block moves down labelled',
  compose({ invoiceText: INV_BLOCK, labour: [
    { id: 'r0', desc: 'Lounge', amount: 561.35, dropped: true },
    { id: 'r1', desc: 'Bedroom', amount: 136.95 }
  ] }, false).join(' ¶ '), 'Bedroom\n\n' + INV_BLOCK);

// ── Report ─────────────────────────────────────────────────────────────────
pass.forEach(n => console.log('  ok   ' + n));
fail.forEach(n => console.log('  FAIL ' + n));
console.log('\n' + pass.length + ' passed, ' + fail.length + ' failed');
process.exit(fail.length ? 1 : 0);
