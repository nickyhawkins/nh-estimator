#!/usr/bin/env node
'use strict';

// ── Regression test: staged invoicing (interim invoices) ─────────────────────
//
// What it pins down (STAGED_INVOICING_SPEC.md):
//
//   1. The builder's preview and the server's record are the SAME maths. The
//      three shared functions exist twice -- lib/invoices.js decides, the copy
//      in public/index.html previews offline -- and the two sources must be
//      identical character for character.
//   2. Labour is a cumulative %: each interim bills only the difference from
//      what was already billed, and billing to 100% over any number of
//      interims comes to exactly the quoted figure, to the penny. Materials
//      are itemised, with billed quantities recorded per product.
//   3. The guards: no going backwards, nothing above 100%, no variation or
//      tin billed twice, nothing issued with nothing to pay.
//   4. The deposit comes off the first interim and only what it can't absorb
//      carries on.
//   5. The line text that goes on the client's invoice.
//   6. The final invoice's "Less: interim" lines take back labour and extras
//      only -- the interims' materials are left off its list instead.
//
// Pure node: no database, no browser, no server.
//
// USAGE
//   node scripts/test-staged-invoicing.js
//   npm run test:staged-invoicing

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// lib/invoices.js requires the db module, which only builds a pg Pool (no
// connection until a query runs) -- safe to load with no DATABASE_URL.
const lib = require('../lib/invoices');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const LIB = fs.readFileSync(path.join(__dirname, '..', 'lib', 'invoices.js'), 'utf8');

const pass = [], fail = [];
const check = (name, ok, detail) =>
  (ok ? pass : fail).push(name + (!ok && detail !== undefined ? '\n      ' + detail : ''));
const eq = (name, got, want) =>
  check(name, JSON.stringify(got) === JSON.stringify(want), 'got:  ' + JSON.stringify(got) + '\n      want: ' + JSON.stringify(want));

function sliceBalanced(src, startIdx, open, close) {
  const from = src.indexOf(open, startIdx);
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close && --depth === 0) return src.slice(startIdx, i + 1);
  }
  throw new Error('unbalanced ' + open + ' from index ' + startIdx);
}
function extractFn(src, name, where) {
  const at = src.indexOf('\nfunction ' + name + '(');
  if (at < 0) throw new Error('function ' + name + ' not found in ' + where);
  return sliceBalanced(src, at + 1, '{', '}');
}

// ── 1. One set of maths ─────────────────────────────────────────────────────
const SHARED = ['fmtInvoicePct', 'interimInvoiceMath', 'interimInvoiceLineItems'];
SHARED.forEach(name => {
  const a = extractFn(LIB, name, 'lib/invoices.js');
  const b = extractFn(SRC, name, 'public/index.html');
  check('identical source in lib and browser: ' + name, a === b,
    'the preview and the record would disagree -- edit both copies together');
});

// The browser copy, run for real, must agree with the lib on live inputs too.
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(SHARED.concat(['interimDeductionLines']).map(n => extractFn(SRC, n, 'public/index.html')).join('\n'), sandbox);

// ── 2. Labour: cumulative percentages ───────────────────────────────────────
const base = { quotedLabour: 4000, depositTotal: 0, depositAppliedSoFar: 0, materials: [], variations: [] };
const TINS = [{ amount: 180 }, { amount: 320 }];
{
  const first = lib.interimInvoiceMath(Object.assign({}, base, { labourPct: 40, prevLabourPct: 0, materials: TINS }));
  eq('first interim: 40% labour', first.labourAmount, 1600);
  eq('first interim: materials are the itemised lines, summed', first.materialsAmount, 500);
  eq('first interim: subtotal', first.subtotal, 2100);
  eq('first interim: no errors', first.errors, []);
  const second = lib.interimInvoiceMath(Object.assign({}, base, { labourPct: 70, prevLabourPct: 40 }));
  eq('second interim bills only the difference (30% labour)', second.labourAmount, 1200);
  eq('no new materials bill nothing', second.materialsAmount, 0);
}
{
  // Thirds of an awkward figure: rounding the DIFFERENCE would leave a penny
  // out or in; the cumulative-rounded approach lands exactly on the quote.
  const q = 1000.01;
  let prev = 0, billed = 0;
  [33.33, 66.67, 100].forEach(pct => {
    const r = lib.interimInvoiceMath({ quotedLabour: q, labourPct: pct, prevLabourPct: prev,
      materials: [], variations: [], depositTotal: 0, depositAppliedSoFar: 0 });
    billed = Math.round((billed + r.labourAmount) * 100) / 100;
    prev = pct;
  });
  eq('three interims to 100% bill exactly the quoted labour', billed, q);
}

// ── 3. Guards ───────────────────────────────────────────────────────────────
{
  const back = lib.interimInvoiceMath(Object.assign({}, base, { labourPct: 30, prevLabourPct: 40, materials: TINS }));
  check('labour below what was already invoiced is refused', back.errors.some(e => /cannot go below the 40%/.test(e)), back.errors);
  const over = lib.interimInvoiceMath(Object.assign({}, base, { labourPct: 101, prevLabourPct: 0 }));
  check('above 100% is refused', over.errors.some(e => /above 100%/.test(e)), over.errors);
  const nothing = lib.interimInvoiceMath(Object.assign({}, base, { labourPct: 40, prevLabourPct: 40 }));
  check('nothing new to bill is refused', nothing.errors.some(e => /Nothing to bill/.test(e)), nothing.errors);
  const matsOnly = lib.interimInvoiceMath(Object.assign({}, base, { labourPct: 40, prevLabourPct: 40, materials: TINS }));
  eq('an interim of materials alone is allowed', matsOnly.errors, []);
}

// ── 4. Deposit ──────────────────────────────────────────────────────────────
{
  const r = lib.interimInvoiceMath(Object.assign({}, base, { labourPct: 40, prevLabourPct: 0, materials: TINS, depositTotal: 500 }));
  eq('deposit comes off the first interim', r.depositApplied, 500);
  eq('amount due is subtotal less deposit', r.amountDue, 1600);
  const later = lib.interimInvoiceMath(Object.assign({}, base, { labourPct: 70, prevLabourPct: 40, depositTotal: 500, depositAppliedSoFar: 500 }));
  eq('an applied deposit is not applied again', later.depositApplied, 0);
  const covers = lib.interimInvoiceMath(Object.assign({}, base, { labourPct: 5, prevLabourPct: 0, depositTotal: 500 }));
  eq('a deposit larger than the invoice is applied only up to the subtotal', covers.depositApplied, 200);
  check('...and the zero-due invoice is blocked', covers.errors.some(e => /covers this whole invoice/.test(e)), covers.errors);
  const carried = lib.interimInvoiceMath(Object.assign({}, base, { labourPct: 20, prevLabourPct: 0, depositTotal: 1000, depositAppliedSoFar: 700 }));
  eq('an unallocated remainder carries to the next invoice', carried.depositApplied, 300);
}

// ── Browser copy agrees on live inputs ──────────────────────────────────────
[
  { labourPct: 40, prevLabourPct: 0, materials: TINS, depositTotal: 500 },
  { labourPct: 33.33, prevLabourPct: 10, materials: [{ amount: 41.99 }], variations: [{ amount: 320.5 }] },
  { labourPct: 30, prevLabourPct: 40 }
].forEach((c, i) => {
  const input = Object.assign({}, base, c);
  eq('browser preview matches the server record, case ' + (i + 1),
    JSON.parse(JSON.stringify(sandbox.interimInvoiceMath(input))), lib.interimInvoiceMath(input));
});

// ── 5. Line text and layout ─────────────────────────────────────────────────
{
  const lines = lib.interimInvoiceLineItems({
    labourPct: 40, prevLabourPct: 0, labourAmount: 1600,
    variations: [{ description: 'Variation: Bedroom 3', amount: 320 }],
    materials: [{ itemCode: 'TIK-OPT7-10', description: 'Tikkurila Optiva 7 10L — Hague Blue', quantity: 2, unitAmount: 90 },
                { itemCode: '', description: 'Masking tape', quantity: 3, unitAmount: 4.5 }]
  });
  eq('labour line text', lines[0].description, 'Labour: 40% of quoted works (previously invoiced 0%)');
  eq('labour posts to 201', lines[0].accountCode, '201');
  eq('a variation keeps its own description, at 201', [lines[1].description, lines[1].accountCode], ['Variation: Bedroom 3', '201']);
  eq('materials sit under a MATERIALS heading, as on the final invoice', lines[2], { description: 'MATERIALS' });
  eq('each product is its own line: quantity, sell price, item code, 202', lines[3],
    { description: 'Tikkurila Optiva 7 10L — Hague Blue', quantity: 2, unitAmount: 90, accountCode: '202', itemCode: 'TIK-OPT7-10' });
  eq('a free-text product carries no item code', lines[4].itemCode, undefined);
  eq('no deposit line on the Xero invoice', lines.length, 5);
  const noMats = lib.interimInvoiceLineItems({ labourPct: 70, prevLabourPct: 40, labourAmount: 1200, materials: [], variations: [] });
  eq('no materials, no MATERIALS heading', noMats.map(l => l.description), ['Labour: 70% of quoted works (previously invoiced 40%)']);
  eq('percentages print as people write them', [lib.fmtInvoicePct(33.333), lib.fmtInvoicePct(40), lib.fmtInvoicePct(12.5)], ['33.33', '40', '12.5']);
}

// ── Server-side planning (what the route records) ───────────────────────────
{
  const tin = { key: 'code:TIK-OPT7-10', itemCode: 'TIK-OPT7-10', description: 'Optiva 7 10L', quantity: 2, unitAmount: 90, billedBefore: 0 };
  const body = { idempotencyKey: 'abcdef0123456789', quotedLabour: 4000, labourPct: 40, materials: [tin],
                 variations: [{ kind: 'room', sourceId: 'r1', description: 'Variation: Bedroom 3', amount: 320 }] };
  const first = lib.planInterimInvoice({ existing: [], depositTotal: 500, body });
  eq('plan: first interim is sequence 1', first.row && first.row.sequence, 1);
  eq('plan: subtotal = labour + tins + variation', first.row && first.row.subtotal, 1600 + 180 + 320);
  eq('plan: the billed quantity is recorded per product', first.row && first.row.materialLines.map(m => [m.key, m.quantity, m.amount]), [['code:TIK-OPT7-10', 2, 180]]);
  eq('plan: deposit applied', first.row && first.row.depositApplied, 500);
  const existing = [Object.assign({ id: 'x', jobId: 'j' }, first.row)];
  const so = lib.billingSoFar(existing);
  eq('billed quantities add up per product', so.billedQty, { 'code:TIK-OPT7-10': 2 });
  const again = lib.planInterimInvoice({ existing, depositTotal: 500, body: Object.assign({}, body, { idempotencyKey: 'bcdef01234567890', labourPct: 70, materials: [] }) });
  check('plan: a variation already billed cannot be billed again', /already been billed/.test(again.error || ''), again.error);
  // A third tin bought since: the builder offers 1, stating 2 were billed before.
  const second = lib.planInterimInvoice({ existing, depositTotal: 500, body: Object.assign({}, body,
    { idempotencyKey: 'bcdef01234567890', labourPct: 70, variations: [], materials: [Object.assign({}, tin, { quantity: 1, billedBefore: 2 })] }) });
  eq('plan: second interim is sequence 2', second.row && second.row.sequence, 2);
  eq('plan: second interim bills the 30% difference only', second.row && second.row.labourAmount, 1200);
  eq('plan: ...and just the extra tin', second.row && second.row.materialsAmount, 90);
  eq('plan: its line says what was billed before', second.row && second.row.lineItems[0].description, 'Labour: 70% of quoted works (previously invoiced 40%)');
  eq('plan: no second deposit deduction', second.row && second.row.depositApplied, 0);
  // Built from a stale view (another device billed the two tins meanwhile).
  const stale = lib.planInterimInvoice({ existing, depositTotal: 500, body: Object.assign({}, body,
    { idempotencyKey: 'cdef012345678901', labourPct: 70, variations: [] }) });
  check('plan: materials billed since the builder opened are refused as a conflict', stale.conflict === true && /reopen the builder/.test(stale.error || ''), stale);
  const unpriced = lib.planInterimInvoice({ existing: [], depositTotal: 0, body: Object.assign({}, body, { materials: [Object.assign({}, tin, { unitAmount: 0 })] }) });
  check('plan: an unpriced material is refused', /price/.test(unpriced.error || ''), unpriced.error);
  const afterFinal = lib.planInterimInvoice({ existing: existing.concat([{ type: 'final', sequence: 2, depositApplied: 0, variationLines: [], materialLines: [] }]), depositTotal: 0, body });
  check('plan: no interim after the final invoice', /already has its final invoice/.test(afterFinal.error || ''), afterFinal.error);
  const noKey = lib.planInterimInvoice({ existing: [], depositTotal: 0, body: Object.assign({}, body, { idempotencyKey: '' }) });
  check('plan: an idempotency key is required', /idempotencyKey/.test(noKey.error || ''), noKey.error);
}

// ── 6. The final invoice's deductions ───────────────────────────────────────
{
  const lines = JSON.parse(JSON.stringify(sandbox.interimDeductionLines([
    { sequence: 1, number: 'INV-0042', work: 1920 },
    { sequence: 2, number: 'INV-0047', work: 0 },
    { sequence: 3, number: 'INV-0051', work: 1200 }
  ])));
  eq('one labour-and-extras deduction per interim, none for materials, none for a materials-only interim', lines, [
    { description: 'Less: interim invoice INV-0042', quantity: 1, unitAmount: -1920, accountCode: '201' },
    { description: 'Less: interim invoice INV-0051', quantity: 1, unitAmount: -1200, accountCode: '201' }
  ]);
}

// ── The Xero payload ────────────────────────────────────────────────────────
{
  const payload = lib.buildInterimXeroInvoice({ xeroContactId: 'c-1', xeroReference: 'Smith — interim 1',
    lineItems: [{ description: 'Labour: 40% of quoted works (previously invoiced 0%)', quantity: 1, unitAmount: 1600, accountCode: '201' },
                { description: 'MATERIALS' },
                { description: 'Optiva 7 10L', quantity: 2, unitAmount: 90, accountCode: '202', itemCode: 'TIK-OPT7-10' }] });
  const inv = payload.Invoices[0];
  eq('ACCREC, like the completion invoice', inv.Type, 'ACCREC');
  eq('always a DRAFT', inv.Status, 'DRAFT');
  eq('not VAT registered: NoTax', inv.LineAmountTypes, 'NoTax');
  eq('the linked contact', inv.Contact, { ContactID: 'c-1' });
  eq('the MATERIALS heading is a description-only row', inv.LineItems[1], { Description: 'MATERIALS' });
  eq('a product line carries its item code', inv.LineItems[2], { Description: 'Optiva 7 10L', Quantity: 2, UnitAmount: 90, AccountCode: '202', ItemCode: 'TIK-OPT7-10' });
}

pass.forEach(n => console.log('  ✓ ' + n));
fail.forEach(n => console.log('  ✗ ' + n));
console.log('\n' + pass.length + ' passed, ' + fail.length + ' failed');
process.exit(fail.length ? 1 : 0);
