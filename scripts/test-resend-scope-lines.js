#!/usr/bin/env node
'use strict';

// ── Regression test: re-sending a quote keeps the per-room scope lines ─────
//
// Sending a quote stamps the exact block onto job.quoteText so the sent
// wording stops drifting. The per-room scope lines ("Bathroom — walls in
// Optiva 5, 2 coats. Preparation and completion as above.") switch off once
// the text is HAND-edited — and the send path used to read "quoteText is
// set" as hand-edited. So the first send was right and every update after
// it turned each later room into a bare "same as above". Held here:
//
//   1. A stamp from a send is not an edit; a typed edit is; a reset clears.
//   2. Jobs stamped before the flag existed: text still matching a fresh
//      render counts as untouched, text that differs counts as edited.
//   3. Both send paths (quote + final invoice) decide with the helper and
//      record the flag when they stamp, and the flags persist.
//
// Pure node against the real source: templateTextHandEdited() is extracted
// out of public/index.html by name; activeJob/renderJobTemplate are stubbed.
//
// USAGE
//   node scripts/test-resend-scope-lines.js
//   npm run test:resend-scope

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

const pass = [], fail = [];
const check = (name, ok, detail) =>
  (ok ? pass : fail).push(name + (!ok && detail !== undefined ? '\n      ' + detail : ''));

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
  let at = SRC.indexOf('\nfunction ' + name + '(');
  if (at < 0) at = SRC.indexOf('\nasync function ' + name + '(');
  if (at < 0) throw new Error('function ' + name + ' not found in public/index.html');
  return sliceBalanced(SRC, at + 1, '{', '}');
}

const RENDER = { quote: 'Painting of Lounge:\n\nPROTECTION…', invoice: 'Painting — Lounge\nSurfaces prepared…' };
const ctx = { job: null };
ctx.activeJob = () => ctx.job;
ctx.renderJobTemplate = (mode) => RENDER[mode];
vm.createContext(ctx);
vm.runInContext(extractFn('templateTextHandEdited'), ctx);
const edited = (job, mode) => { ctx.job = job; return ctx.templateTextHandEdited(mode); };

// 1. Flag semantics.
check('untouched job (no saved text) is not hand-edited', edited({ quoteText: null }, 'quote') === false);
check('stamped by a send (flag false) is not hand-edited',
  edited({ quoteText: RENDER.quote, quoteTextEdited: false }, 'quote') === false);
check('stamped by a send stays un-edited even after rooms change the render',
  edited({ quoteText: 'Painting of Old Lounge:', quoteTextEdited: false }, 'quote') === false);
check('typed edit (flag true) is hand-edited',
  edited({ quoteText: RENDER.quote, quoteTextEdited: true }, 'quote') === true);
check('invoice flag is independent of the quote flag',
  edited({ quoteText: 'x', quoteTextEdited: true, invoiceText: RENDER.invoice, invoiceTextEdited: false }, 'invoice') === false);

// 2. Legacy jobs (stamped before the flag existed).
check('legacy stamp matching a fresh render is not hand-edited',
  edited({ quoteText: RENDER.quote }, 'quote') === false);
check('legacy stamp matching apart from surrounding whitespace is not hand-edited',
  edited({ quoteText: '  ' + RENDER.quote + '\n' }, 'quote') === false);
check('legacy text that differs from the render is hand-edited',
  edited({ quoteText: 'My own wording' }, 'quote') === true);
check('legacy invoice text matching the render is not hand-edited',
  edited({ invoiceText: RENDER.invoice }, 'invoice') === false);

// 3. Wiring in the send paths and persistence.
const quoteSend = extractFn('createXeroQuote');
check('quote send decides hand-edited with the helper',
  /var handEdited = templateTextHandEdited\('quote'\)/.test(quoteSend));
check('quote send no longer treats any saved quoteText as hand-edited',
  !/quoteText != null\)/.test(quoteSend));
check('quote send records the flag when it stamps',
  /quoteJob\.quoteText = quoteBlock;[\s\S]{0,120}quoteJob\.quoteTextEdited = handEdited;/.test(quoteSend));
check('final invoice decides hand-edited with the helper',
  /var invHandEdited = templateTextHandEdited\('invoice'\)/.test(SRC));
check('final invoice records the flag when it stamps',
  /job\.invoiceText = invBlock; job\.invoiceTextEdited = invHandEdited;/.test(SRC));
check('typing in the quote box sets the flag',
  /job\.quoteText = ta\.value;\s*job\.quoteTextEdited = true;/.test(extractFn('onQuoteTextChange')));
check('typing in the invoice box sets the flag',
  /job\.invoiceTextEdited = true/.test(extractFn('onInvoiceTextChange')));
check('reset clears the quote flag', /job\.quoteTextEdited = null/.test(extractFn('resetQuoteText')));
check('reset clears the invoice flag', /job\.invoiceTextEdited = null/.test(extractFn('resetInvoiceText')));
check('switching template clears both flags',
  /job\.quoteTextEdited = null;\s*job\.invoiceTextEdited = null;/.test(extractFn('onTemplatePick')));
check('both flags are in the persisted job fields',
  /apiPut\('\/api\/jobs\/'\+job\.id, \{[^\n]*quoteTextEdited:[^\n]*invoiceTextEdited:/.test(SRC));

console.log('\n' + pass.length + ' passed, ' + fail.length + ' failed');
fail.forEach((f) => console.log('  ✗ ' + f));
if (fail.length) process.exit(1);
