#!/usr/bin/env node
'use strict';

// ── Regression test: a primer that IS the topcoat is not bought twice ──────
//
// Flagged in v2.25.2 and fixed then for fitted units only: when the Settings
// woodwork PRIMER is pointed at the same product as the TOPCOAT (a self-
// priming paint used for both), a room bought a "primer" allocation of the
// very same paint on top of its topcoat -- two Woodwork rows resolving to the
// same tins, each rounded up on its own. The same held for exterior items
// (exterior primer = exterior topcoat) and so for the Windows and doors paint.
//
// The rule, as fitted units already had it: a primer that is the topcoat
// product is treated as self-priming -- one extra topcoat coat, no separate
// primer buy. A DIFFERENT primer product, and primer switched off, are
// untouched, and so is every room whose products differ (nearly all of them).
//
// Plus the balance note (estimating-app-edits.md #5) on the payment terms.
//
// Pure node against the real source, same harness as test-papered-paint.js.
//
// USAGE
//   node scripts/test-same-tin-primer.js
//   npm run test:same-tin

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

const pass = [], fail = [];
const check = (name, ok, detail) =>
  (ok ? pass : fail).push(name + (!ok && detail !== undefined ? '\n      ' + detail : ''));
const near = (name, got, want) =>
  check(name, Math.abs(got - want) < 1e-9, 'got:  ' + got + '\n      want: ' + want);

// ── Extraction ─────────────────────────────────────────────────────────────
// Brace-matched, same helper as test-scope-text.js.
function sliceBalanced(src, startIdx, open, close) {
  const from = src.indexOf(open, startIdx);
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close && --depth === 0) return src.slice(startIdx, i + 1);
  }
  throw new Error('unbalanced ' + open + ' from index ' + startIdx);
}
function fnBody(name) {
  const at = SRC.indexOf('\nfunction ' + name + '(');
  if (at < 0) throw new Error('function ' + name + ' not found in public/index.html');
  return sliceBalanced(SRC, at + 1, '{', '}');
}
function varBody(name, open, close) {
  const at = SRC.indexOf('\nvar ' + name + ' = ');
  if (at < 0) throw new Error('var ' + name + ' not found in public/index.html');
  return sliceBalanced(SRC, at + 1, open, close) + ';';
}

// Every top-level function public/index.html declares -- the vocabulary the
// closure walk below recognises.
const DECLARED = new Set();
{
  const re = /\nfunction ([A-Za-z0-9_$]+)\s*\(/g;
  let m; while ((m = re.exec(SRC))) DECLARED.add(m[1]);
}

// ...and its top-level CONSTANTS, which the walk has to pick up for the
// same reason it picks up functions. calcRoom's closure reaches several
// (SKIRTING_HEIGHT_M, the wallpaper-strip tier table) and a hand-listed set
// goes stale the moment the engine gains another -- silently, as a
// ReferenceError in a test nobody reads until it fires. Screaming-case
// only: that is how this file names the fixed tables, and it keeps the
// match off ordinary mutable state like `rooms` or `settings`.
const DECLARED_CONSTS = new Set();
{
  const re = /\nvar ([A-Z][A-Z0-9_]*[A-Za-z0-9_$]*) = /g;
  let m; while ((m = re.exec(SRC))) DECLARED_CONSTS.add(m[1]);
}
// From `var NAME = ` to the semicolon that ends the statement, ignoring any
// inside a nested literal or a string -- one extractor for the scalars, the
// arrays and the object tables alike.
function constBody(name) {
  const at = SRC.indexOf('\nvar ' + name + ' = ');
  if (at < 0) throw new Error('const ' + name + ' not found in public/index.html');
  let depth = 0, inStr = null;
  for (let i = at + 1; i < SRC.length; i++) {
    const ch = SRC[i];
    if (inStr) { if (ch === '\\') i++; else if (ch === inStr) inStr = null; continue; }
    if (ch === '"' || ch === "'") { inStr = ch; continue; }
    if (ch === '[' || ch === '{' || ch === '(') depth++;
    else if (ch === ']' || ch === '}' || ch === ')') depth--;
    else if (ch === ';' && depth === 0) return SRC.slice(at + 1, i + 1);
  }
  throw new Error('unterminated const ' + name);
}

// calcRoom's dependency closure, walked rather than hand-listed: the calc
// engine gets refactored constantly and a hand-listed set goes stale
// silently (a missing name is a ReferenceError, but a name that MOVED into
// a new helper is a test quietly running against less than it thinks).
// Comments are stripped first -- this file's comments name functions with
// their parens, and counting those pulls in half the app.
function closureFrom(root) {
  const strip = s => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const seen = new Set(), order = [], consts = new Set();
  (function walk(name) {
    if (seen.has(name)) return;
    seen.add(name); order.push(name);
    const body = strip(fnBody(name));
    // Whole-word, not "name(" -- a helper can be PASSED rather than called
    // (doorFrameLabourCost picks doorMins vs an inline function by kind),
    // and a closure that only follows call sites misses those entirely.
    const re = /[A-Za-z0-9_$]+/g;
    let m; while ((m = re.exec(body))) {
      if (DECLARED.has(m[0]) && m[0] !== name) walk(m[0]);
      else if (DECLARED_CONSTS.has(m[0])) consts.add(m[0]);
    }
  })(root);
  return { fns: order, consts: [...consts] };
}

const api = {};
const roomClosure = closureFrom('calcRoom');
const extW = closureFrom('extWoodworkLitres');
const extP = closureFrom('extPrimerLitres');
const terms = closureFrom('buildPaymentTermsText');
const fns = [...new Set([].concat(roomClosure.fns, extW.fns, extP.fns, terms.fns))];
const consts = [...new Set([].concat(roomClosure.consts, extW.consts, extP.consts, terms.consts, ['BALANCE_MATERIALS_NOTE']))];
new Function('exports', 'Windoors', [
  varBody('SETTINGS_FIELDS', '[', ']'),
  varBody('KITCHEN_RATE_DEFAULTS', '{', '}'),
  fnBody('mergeSettings'),
  'var settings = mergeSettings(null);',
  ...consts.map(constBody),
  ...fns.map(fnBody),
  'exports.calcRoom = calcRoom; exports.extWoodworkLitres = extWoodworkLitres; exports.extPrimerLitres = extPrimerLitres;',
  'exports.buildPaymentTermsText = buildPaymentTermsText; exports.NOTE = BALANCE_MATERIALS_NOTE;',
  'exports.settings = settings;'
].join('\n'))(api, require('../public/windoors'));

const S = api.settings;
const setProducts = (m) => { S.materials = m; };
// A room with real woodwork: skirting, a door and a frame, bare.
const ROOM = { l: 4, w: 3, h: 2.4, wc: 2, cc: 2, xc: 2, shapeMode: 'box', doorQty: 1, frameQty: 1, doorCoats: 2, frameCoats: 2 };
const room = (extra) => api.calcRoom(Object.assign({}, ROOM, extra || {}));

// ── Rooms ──────────────────────────────────────────────────────────────────
setProducts({ topcoat: { range: 'Satinwood' }, primer: { range: 'Wood Primer' } });
const diff = room();
check('different primer product: the room buys primer as before', diff.primerL > 0);

setProducts({ topcoat: { range: 'One Can' }, primer: { range: 'One Can' } });
const same = room();
near('primer IS the topcoat: no separate primer buy', same.primerL, 0);
check('...but one extra coat of the topcoat instead', same.glossL > diff.glossL);

setProducts({ topcoat: { range: 'Satinwood' }, primer: { range: 'Wood Primer' } });
const overrideSame = room({ primerRangeOverride: 'Satinwood' });
near('a room override pointing primer at its topcoat counts too', overrideSame.primerL, 0);
const overrideDiff = room({ topcoatRangeOverride: 'Eggshell' });
check('a room whose topcoat differs from the Settings primer still buys primer', overrideDiff.primerL > 0);

setProducts({ topcoat: { range: 'One Can' }, primer: { range: 'One Can' } });
const off = room({ primerNone: true });
near('primer switched off stays off', off.primerL, 0);
check('...and gets no extra topcoat coat from the guard', off.glossL < same.glossL);
check('labour never moves: the guard is litres only', Math.abs(same.total - diff.total) < 1e-9);

// ── Exterior items ─────────────────────────────────────────────────────────
const EXT = { fascia: 20, doorQty: 1, frameQty: 1, coats: {} };
setProducts({ extTopcoat: { range: 'Weathershield Gloss' }, extPrimer: { range: 'Exterior Primer' } });
const eDiff = { top: api.extWoodworkLitres(Object.assign({}, EXT)), primer: api.extPrimerLitres(Object.assign({}, EXT)) };
check('exterior: a different primer is still bought', eDiff.primer > 0);
setProducts({ extTopcoat: { range: 'Weathershield Gloss' }, extPrimer: { range: 'Weathershield Gloss' } });
const eSame = { top: api.extWoodworkLitres(Object.assign({}, EXT)), primer: api.extPrimerLitres(Object.assign({}, EXT)) };
near('exterior: primer IS the topcoat, no separate primer', eSame.primer, 0);
check('exterior: one extra topcoat coat instead', eSame.top > eDiff.top);

// ── The balance note ───────────────────────────────────────────────────────
const plan = { depositRequired: true, deposit: 250, depositBasis: '25% of labour', balance: 750, paymentType: 'single', weeklyRows: [] };
const withMats = api.buildPaymentTermsText(plan, null, true);
const noMats = api.buildPaymentTermsText(plan, null, false);
check('terms carry the balance note when there are materials', withMats.indexOf(api.NOTE) >= 0 && /\*Material costs are estimated/.test(withMats));
check('...and not on a labour-only quote', noMats.indexOf('Material costs') < 0);
check('the note is Nicky\'s wording', /discussed and agreed with you in advance\.$/.test(api.NOTE));
check('the client quote marks the balance and prints the note under it',
  /label: r\.label \+ ' \*'/.test(SRC) && /note: '\* ' \+ BALANCE_MATERIALS_NOTE/.test(SRC));

// ── Windows and doors paint, same rule ─────────────────────────────────────
check('the windows and doors paint applies the same guard',
  /var sameTin = !!primerRange && primerRange === topRange;/.test(SRC) && /primerL: sameTin \? 0 : top \* 0\.8/.test(SRC));

console.log(pass.length + ' passed, ' + fail.length + ' failed');
fail.forEach(f => console.log('  ✗ ' + f));
process.exit(fail.length ? 1 : 0);
