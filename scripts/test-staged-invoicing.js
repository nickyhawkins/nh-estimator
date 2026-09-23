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
//   2. Cumulative %: each interim bills only the difference from what was
//      already billed, and billing to 100% over any number of interims comes
//      to exactly the quoted figure, to the penny.
//   3. The guards: no going backwards, nothing above 100%, nothing billed
//      twice, nothing issued with nothing to pay.
//   4. The deposit comes off the first interim and only what it can't absorb
//      carries on.
//   5. The line text that goes on the client's invoice.
//   6. The final invoice's "Less: interim" lines net each account back out.
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

// ── 2. Cumulative percentages ───────────────────────────────────────────────
const base = { quotedLabour: 4000, quotedMaterials: 1000, depositTotal: 0, depositAppliedSoFar: 0, variations: [] };
{
  const first = lib.interimInvoiceMath(Object.assign({}, base, { labourPct: 40, materialsPct: 50, prevLabourPct: 0, prevMaterialsPct: 0 }));
  eq('first interim: 40% labour', first.labourAmount, 1600);
  eq('first interim: 50% materials at the QUOTED price', first.materialsAmount, 500);
  eq('first interim: subtotal', first.subtotal, 2100);
  eq('first interim: no errors', first.errors, []);
  const second = lib.interimInvoiceMath(Object.assign({}, base, { labourPct: 70, materialsPct: 50, prevLabourPct: 40, prevMaterialsPct: 50 }));
  eq('second interim bills only the difference (30% labour)', second.labourAmount, 1200);
  eq('materials unchanged since last time bill nothing', second.materialsAmount, 0);
}
{
  // Thirds of an awkward figure: rounding the DIFFERENCE would leave a penny
  // out or in; the cumulative-rounded approach lands exactly on the quote.
  const q = 1000.01;
  let prev = 0, billed = 0;
  [33.33, 66.67, 100].forEach(pct => {
    const r = lib.interimInvoiceMath({ quotedLabour: q, quotedMaterials: 0, labourPct: pct, materialsPct: 0,
      prevLabourPct: prev, prevMaterialsPct: 0, variations: [], depositTotal: 0, depositAppliedSoFar: 0 });
    billed = Math.round((billed + r.labourAmount) * 100) / 100;
    prev = pct;
  });
  eq('three interims to 100% bill exactly the quoted labour', billed, q);
}

// ── 3. Guards ───────────────────────────────────────────────────────────────
{
  const back = lib.interimInvoiceMath(Object.assign({}, base, { labourPct: 30, materialsPct: 50, prevLabourPct: 40, prevMaterialsPct: 50 }));
  check('labour below what was already invoiced is refused', back.errors.some(e => /cannot go below the 40%/.test(e)), back.errors);
  const over = lib.interimInvoiceMath(Object.assign({}, base, { labourPct: 101, materialsPct: 0, prevLabourPct: 0, prevMaterialsPct: 0 }));
  check('above 100% is refused', over.errors.some(e => /above 100%/.test(e)), over.errors);
  const nothing = lib.interimInvoiceMath(Object.assign({}, base, { labourPct: 40, materialsPct: 50, prevLabourPct: 40, prevMaterialsPct: 50 }));
  check('nothing new to bill is refused', nothing.errors.some(e => /Nothing to bill/.test(e)), nothing.errors);
}

// ── 4. Deposit ──────────────────────────────────────────────────────────────
{
  const r = lib.interimInvoiceMath(Object.assign({}, base, { labourPct: 40, materialsPct: 50, prevLabourPct: 0, prevMaterialsPct: 0, depositTotal: 500 }));
  eq('deposit comes off the first interim', r.depositApplied, 500);
  eq('amount due is subtotal less deposit', r.amountDue, 1600);
  const later = lib.interimInvoiceMath(Object.assign({}, base, { labourPct: 70, materialsPct: 50, prevLabourPct: 40, prevMaterialsPct: 50, depositTotal: 500, depositAppliedSoFar: 500 }));
  eq('an applied deposit is not applied again', later.depositApplied, 0);
  const covers = lib.interimInvoiceMath(Object.assign({}, base, { labourPct: 5, materialsPct: 0, prevLabourPct: 0, prevMaterialsPct: 0, depositTotal: 500 }));
  eq('a deposit larger than the invoice is applied only up to the subtotal', covers.depositApplied, 200);
  check('...and the zero-due invoice is blocked', covers.errors.some(e => /covers this whole invoice/.test(e)), covers.errors);
  const carried = lib.interimInvoiceMath(Object.assign({}, base, { labourPct: 20, materialsPct: 0, prevLabourPct: 0, prevMaterialsPct: 0, depositTotal: 1000, depositAppliedSoFar: 700 }));
  eq('an unallocated remainder carries to the next invoice', carried.depositApplied, 300);
}

// ── Browser copy agrees on live inputs ──────────────────────────────────────
[
  { labourPct: 40, materialsPct: 50, prevLabourPct: 0, prevMaterialsPct: 0, depositTotal: 500 },
  { labourPct: 33.33, materialsPct: 12.5, prevLabourPct: 10, prevMaterialsPct: 0, variations: [{ amount: 320.5 }] },
  { labourPct: 30, materialsPct: 0, prevLabourPct: 40, prevMaterialsPct: 0 }
].forEach((c, i) => {
  const input = Object.assign({}, base, c);
  eq('browser preview matches the server record, case ' + (i + 1),
    JSON.parse(JSON.stringify(sandbox.interimInvoiceMath(input))), lib.interimInvoiceMath(input));
});

// ── 5. Line text ────────────────────────────────────────────────────────────
{
  const lines = lib.interimInvoiceLineItems({
    labourPct: 40, prevLabourPct: 0, labourAmount: 1600,
    materialsPct: 50, prevMaterialsPct: 0, materialsAmount: 500,
    variations: [{ description: 'Variation: Bedroom 3', amount: 320 }]
  });
  eq('labour line text', lines[0].description, 'Labour: 40% of quoted works (previously invoiced 0%)');
  eq('labour posts to 201', lines[0].accountCode, '201');
  eq('materials line text', lines[1].description, 'Materials: 50% of quoted materials (previously invoiced 0%)');
  eq('materials post to 202', lines[1].accountCode, '202');
  eq('a variation keeps its own description', lines[2].description, 'Variation: Bedroom 3');
  eq('no deposit line on the Xero invoice', lines.length, 3);
  const noMats = lib.interimInvoiceLineItems({ labourPct: 70, prevLabourPct: 40, labourAmount: 1200, materialsPct: 50, prevMaterialsPct: 50, materialsAmount: 0, variations: [] });
  eq('a share that bills nothing gets no line', noMats.map(l => l.description), ['Labour: 70% of quoted works (previously invoiced 40%)']);
  eq('percentages print as people write them', [lib.fmtInvoicePct(33.333), lib.fmtInvoicePct(40), lib.fmtInvoicePct(12.5)], ['33.33', '40', '12.5']);
}

// ── Server-side planning (what the route records) ───────────────────────────
{
  const body = { idempotencyKey: 'abcdef0123456789', quotedLabour: 4000, quotedMaterials: 1000, labourPct: 40, materialsPct: 50,
                 variations: [{ kind: 'room', sourceId: 'r1', description: 'Variation: Bedroom 3', amount: 320 }] };
  const first = lib.planInterimInvoice({ existing: [], depositTotal: 500, body });
  eq('plan: first interim is sequence 1', first.row && first.row.sequence, 1);
  eq('plan: subtotal includes the ticked variation', first.row && first.row.subtotal, 2420);
  eq('plan: deposit applied', first.row && first.row.depositApplied, 500);
  const existing = [Object.assign({ id: 'x', jobId: 'j', type: 'interim', variationLines: first.row.variationLines,
    labourPctCumulative: 40, materialsPctCumulative: 50 }, first.row)];
  const again = lib.planInterimInvoice({ existing, depositTotal: 500, body: Object.assign({}, body, { idempotencyKey: 'bcdef01234567890', labourPct: 70 }) });
  check('plan: a variation already billed cannot be billed again', /already been billed/.test(again.error || ''), again.error);
  const second = lib.planInterimInvoice({ existing, depositTotal: 500, body: Object.assign({}, body, { idempotencyKey: 'bcdef01234567890', labourPct: 70, variations: [] }) });
  eq('plan: second interim is sequence 2', second.row && second.row.sequence, 2);
  eq('plan: second interim bills the 30% difference only', second.row && second.row.labourAmount, 1200);
  eq('plan: its line says what was billed before', second.row && second.row.lineItems[0].description, 'Labour: 70% of quoted works (previously invoiced 40%)');
  eq('plan: no second deposit deduction', second.row && second.row.depositApplied, 0);
  const afterFinal = lib.planInterimInvoice({ existing: existing.concat([{ type: 'final', sequence: 2, depositApplied: 0, variationLines: [] }]), depositTotal: 0, body });
  check('plan: no interim after the final invoice', /already has its final invoice/.test(afterFinal.error || ''), afterFinal.error);
  const noKey = lib.planInterimInvoice({ existing: [], depositTotal: 0, body: Object.assign({}, body, { idempotencyKey: '' }) });
  check('plan: an idempotency key is required', /idempotencyKey/.test(noKey.error || ''), noKey.error);
}

// ── 6. The final invoice's deductions ───────────────────────────────────────
{
  const lines = JSON.parse(JSON.stringify(sandbox.interimDeductionLines([
    { sequence: 1, number: 'INV-0042', work: 1920, materials: 500 },
    { sequence: 2, number: 'INV-0047', work: 1200, materials: 0 }
  ])));
  eq('one deduction per interim, split by the account it posted to', lines, [
    { description: 'Less: interim invoice INV-0042', quantity: 1, unitAmount: -1920, accountCode: '201' },
    { description: 'Less: interim invoice INV-0042 (materials)', quantity: 1, unitAmount: -500, accountCode: '202' },
    { description: 'Less: interim invoice INV-0047', quantity: 1, unitAmount: -1200, accountCode: '201' }
  ]);
  const total = lines.reduce((t, l) => t + l.unitAmount, 0);
  eq('the deductions total the interims\' subtotals (before deposit)', total, -(2420 + 1200));
}

// ── The Xero payload ────────────────────────────────────────────────────────
{
  const payload = lib.buildInterimXeroInvoice({ xeroContactId: 'c-1', xeroReference: 'Smith — interim 1',
    lineItems: [{ description: 'Labour: 40% of quoted works (previously invoiced 0%)', quantity: 1, unitAmount: 1600, accountCode: '201' }] });
  const inv = payload.Invoices[0];
  eq('ACCREC, like the completion invoice', inv.Type, 'ACCREC');
  eq('always a DRAFT', inv.Status, 'DRAFT');
  eq('not VAT registered: NoTax', inv.LineAmountTypes, 'NoTax');
  eq('the linked contact', inv.Contact, { ContactID: 'c-1' });
}

pass.forEach(n => console.log('  ✓ ' + n));
fail.forEach(n => console.log('  ✗ ' + n));
console.log('\n' + pass.length + ' passed, ' + fail.length + ' failed');
process.exit(fail.length ? 1 : 0);
