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
//   2. Labour line by line: each room/item (and each extra) has its own
//      cumulative %, bills only the difference from what that line was
//      already billed, and comes to exactly its price at 100% however many
//      invoices it took. Materials are itemised, per product.
//   3. The guards: no line going backwards, nothing above 100%, nothing
//      billed twice (a stale view is refused), nothing issued with nothing
//      to pay.
//   4. The deposit: all of what's left comes off by default, a smaller share
//      can be chosen to keep a float, and whatever isn't used carries on.
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

// ── 2. Labour: each line its own cumulative % ──────────────────────────────
const L = (key, lineTotal, pct, prevPct, billedBefore) =>
  ({ key, description: key, lineTotal, pct, prevPct: prevPct || 0, billedBefore: billedBefore || 0 });
const base = { labour: [], variations: [], materials: [], depositTotal: 0, depositAppliedSoFar: 0 };
const TINS = [{ amount: 180 }, { amount: 320 }];
{
  const first = lib.interimInvoiceMath(Object.assign({}, base, {
    labour: [L('Lounge', 1800, 100), L('Hall', 2000, 50), L('Kitchen', 900, 0)], materials: TINS }));
  eq('a room marked done bills its whole price', first.labourLines[0].amount, 1800);
  eq('a room half done bills half', first.labourLines[1].amount, 1000);
  eq('a room not started bills nothing', first.labourLines[2].amount, 0);
  eq('labour total is the lines added up', first.labourAmount, 2800);
  eq('subtotal adds the materials', first.subtotal, 3300);
  eq('no errors', first.errors, []);
  const second = lib.interimInvoiceMath(Object.assign({}, base, {
    labour: [L('Lounge', 1800, 100, 100, 1800), L('Hall', 2000, 100, 50, 1000), L('Kitchen', 900, 25)] }));
  eq('finishing a half-done room bills only the other half', second.labourLines[1].amount, 1000);
  eq('a room already invoiced in full bills nothing more', second.labourLines[0].amount, 0);
  eq('...and the next room starts', second.labourLines[2].amount, 225);
}
{
  // Thirds of an awkward figure, one line over three invoices. Each interim's
  // total is trimmed down to a clean £5; whatever that leaves unbilled is
  // still owed, and the final invoice (full price less what was billed)
  // squares it to the penny.
  let prev = 0, billed = 0; const subtotals = [];
  [33.33, 66.67, 100].forEach(pct => {
    const r = lib.interimInvoiceMath(Object.assign({}, base, { labour: [L('Lounge', 1000.01, pct, prev, billed)] }));
    subtotals.push(r.subtotal);
    billed = Math.round((billed + r.labourAmount) * 100) / 100;
    prev = pct;
  });
  eq('every interim total is a clean £5', subtotals.map(t => Math.round(t * 100) % 500), [0, 0, 0]);
  check('interims never bill more than the line is worth', billed <= 1000.01, billed);
  eq('the final picks up exactly what the interims left', Math.round((1000.01 - billed) * 100) / 100, 0.01);
}
{
  // An amendment re-priced the room between invoices: the second bills the
  // new price less what was actually billed, never the old price twice.
  const r = lib.interimInvoiceMath(Object.assign({}, base, { labour: [L('Lounge', 2000, 100, 50, 900)] }));
  eq('a re-priced line bills new price less what was billed', r.labourAmount, 1100);
}

// ── Clean £5 totals: the labour is trimmed, never the materials ─────────────
{
  const r = lib.interimInvoiceMath(Object.assign({}, base, {
    labour: [L('Lounge', 1523.47, 100), L('Hall', 1845.5, 33)],
    materials: [{ amount: 193 }, { amount: 114.6 }] }));
  // 1523.47 + 609.02 + 307.60 = 2440.09 -> 2440.00, trim 0.09
  eq('the total is brought down to the nearest £5', [r.subtotal, r.roundingTrim], [2440, 0.09]);
  eq('materials are untouched', r.materialsAmount, 307.6);
  eq('the trim comes off the labour lines, in proportion',
    r.labourLines.map(l => l.amount), [1523.41, 608.99]);
  const noLabour = lib.interimInvoiceMath(Object.assign({}, base, { materials: [{ amount: 193 }, { amount: 114.6 }] }));
  eq('no labour on the invoice: nothing to trim, exact total', [noLabour.subtotal, noLabour.roundingTrim], [307.6, 0]);
  const tiny = lib.interimInvoiceMath(Object.assign({}, base, { labour: [L('Lounge', 30, 10)] }));
  eq('a trim that would leave nothing to bill is skipped', [tiny.subtotal, tiny.roundingTrim, tiny.errors], [3, 0, []]);
  const exact = lib.interimInvoiceMath(Object.assign({}, base, { labour: [L('Lounge', 4000, 40)] }));
  eq('an already-clean total is left alone', [exact.subtotal, exact.roundingTrim], [1600, 0]);
  const whole = lib.interimInvoiceLineItems({ labour: [
    { description: 'Lounge', pct: 40, prevPct: 0, amount: r.labourLines[0].amount },
    { description: 'Hall', pct: 40, prevPct: 0, amount: r.labourLines[1].amount }] });
  eq('a whole-job line carries the trimmed labour total', whole[0].unitAmount, 2132.4);
}

// ── 3. Guards ───────────────────────────────────────────────────────────────
{
  const back = lib.interimInvoiceMath(Object.assign({}, base, { labour: [L('Hall', 2000, 30, 50, 1000)], materials: TINS }));
  check('a line below what was already invoiced is refused', back.errors.some(e => /Hall is cumulative — it cannot go below the 50%/.test(e)), back.errors);
  const over = lib.interimInvoiceMath(Object.assign({}, base, { labour: [L('Hall', 2000, 101)] }));
  check('above 100% is refused', over.errors.some(e => /between 0 and 100/.test(e)), over.errors);
  const nothing = lib.interimInvoiceMath(Object.assign({}, base, { labour: [L('Hall', 2000, 50, 50, 1000)] }));
  check('nothing new to bill is refused', nothing.errors.some(e => /Nothing to bill/.test(e)), nothing.errors);
  const matsOnly = lib.interimInvoiceMath(Object.assign({}, base, { labour: [L('Hall', 2000, 50, 50, 1000)], materials: TINS }));
  eq('an interim of materials alone is allowed', matsOnly.errors, []);
  const cheaper = lib.interimInvoiceMath(Object.assign({}, base, { labour: [L('Hall', 800, 60, 50, 1000)] }));
  check('a line re-priced below what was billed is refused, not credited', cheaper.errors.some(e => /below what was already invoiced/.test(e)), cheaper.errors);
}

// ── Variations: same mechanism ──────────────────────────────────────────────
{
  const r = lib.interimInvoiceMath(Object.assign({}, base, { variations: [L('Variation: Garage door', 180, 50)] }));
  eq('half an extra bills half its price', r.variationsAmount, 90);
  const r2 = lib.interimInvoiceMath(Object.assign({}, base, { variations: [L('Variation: Garage door', 180, 100, 50, 90)] }));
  eq('finishing it bills the rest', r2.variationsAmount, 90);
}

// ── 4. Deposit ──────────────────────────────────────────────────────────────
{
  const lounge = [L('Lounge', 4000, 40)];
  const r = lib.interimInvoiceMath(Object.assign({}, base, { labour: lounge, materials: TINS, depositTotal: 500 }));
  eq('deposit comes off the first interim', r.depositApplied, 500);
  eq('amount due is subtotal less deposit', r.amountDue, 1600);
  const later = lib.interimInvoiceMath(Object.assign({}, base, { labour: [L('Lounge', 4000, 70, 40, 1600)], depositTotal: 500, depositAppliedSoFar: 500 }));
  eq('an applied deposit is not applied again', later.depositApplied, 0);
  const covers = lib.interimInvoiceMath(Object.assign({}, base, { labour: [L('Lounge', 4000, 5)], depositTotal: 500 }));
  eq('a deposit larger than the invoice is applied only up to the subtotal', covers.depositApplied, 200);
  eq('...and an invoice the deposit covers entirely is allowed (£0 to pay)', [covers.amountDue, covers.errors], [0, []]);
  // Splitting the deposit to keep a float: take £600 of £1,250 now.
  const split = lib.interimInvoiceMath(Object.assign({}, base, { labour: [L('Lounge', 4000, 40)], depositTotal: 1250, depositToApply: 600 }));
  eq('a chosen share of the deposit comes off', [split.depositApplied, split.amountDue], [600, 1000]);
  const rest = lib.interimInvoiceMath(Object.assign({}, base, { labour: [L('Lounge', 4000, 70, 40, 1600)], depositTotal: 1250, depositAppliedSoFar: 600 }));
  eq('the rest is taken by default on the next invoice', rest.depositApplied, 650);
  const none = lib.interimInvoiceMath(Object.assign({}, base, { labour: [L('Lounge', 4000, 40)], depositTotal: 1250, depositToApply: 0 }));
  eq('none of it can be taken, keeping it all back', [none.depositApplied, none.errors], [0, []]);
  const tooMuch = lib.interimInvoiceMath(Object.assign({}, base, { labour: [L('Lounge', 4000, 10)], depositTotal: 1250, depositToApply: 500 }));
  check('no more than the invoice total can come off', tooMuch.errors.some(e => /Only 400.00 of the deposit/.test(e)), tooMuch.errors);
  const overLeft = lib.interimInvoiceMath(Object.assign({}, base, { labour: [L('Lounge', 4000, 40)], depositTotal: 1250, depositAppliedSoFar: 1000, depositToApply: 300 }));
  check('no more than what is left of the deposit', overLeft.errors.some(e => /Only 250.00 of the deposit.*what is left/.test(e)), overLeft.errors);
  const carried = lib.interimInvoiceMath(Object.assign({}, base, { labour: [L('Lounge', 4000, 20)], depositTotal: 1000, depositAppliedSoFar: 700 }));
  eq('an unallocated remainder carries to the next invoice', carried.depositApplied, 300);
}

// ── Browser copy agrees on live inputs ──────────────────────────────────────
[
  { labour: [L('Lounge', 1800, 100), L('Hall', 2000, 50)], materials: TINS, depositTotal: 500 },
  { labour: [L('Lounge', 1000.01, 66.67, 33.33, 333.3)], materials: [{ amount: 41.99 }], variations: [L('Variation: x', 320.5, 50)] },
  { labour: [L('Hall', 2000, 30, 40, 800)] }
].forEach((c, i) => {
  const input = Object.assign({}, base, c);
  eq('browser preview matches the server record, case ' + (i + 1),
    JSON.parse(JSON.stringify(sandbox.interimInvoiceMath(input))), lib.interimInvoiceMath(input));
});

// ── 5. Line text and layout ─────────────────────────────────────────────────
{
  const lines = lib.interimInvoiceLineItems({
    labour: [{ description: 'Lounge', pct: 100, prevPct: 50, amount: 900 },
             { description: 'Hall, stairs & landing', pct: 50, prevPct: 0, amount: 1000 },
             { description: 'Kitchen', pct: 0, prevPct: 0, amount: 0 }],
    variations: [{ description: 'Variation: Bedroom 3', pct: 100, prevPct: 0, amount: 320 }],
    materials: [{ itemCode: 'TIK-OPT7-10', description: 'Tikkurila Optiva 7 10L — Hague Blue', quantity: 2, unitAmount: 90 },
                { itemCode: '', description: 'Masking tape', quantity: 3, unitAmount: 4.5 }]
  });
  eq('a finished room reads complete, with what went before', lines[0].description, 'Lounge — complete (previously invoiced 50%)');
  eq('a part-done room reads its %', lines[1].description, 'Hall, stairs & landing — 50% complete');
  eq('labour posts to 201', lines[0].accountCode, '201');
  eq('a line billing nothing is left off', lines.some(l => /Kitchen/.test(l.description)), false);
  eq('a variation reads the same way, at 201', [lines[2].description, lines[2].accountCode], ['Variation: Bedroom 3 — complete', '201']);
  eq('materials sit under a MATERIALS heading, as on the final invoice', lines[3], { description: 'MATERIALS' });
  eq('each product is its own line: quantity, sell price, item code, 202', lines[4],
    { description: 'Tikkurila Optiva 7 10L — Hague Blue', quantity: 2, unitAmount: 90, accountCode: '202', itemCode: 'TIK-OPT7-10' });
  eq('a free-text product carries no item code', lines[5].itemCode, undefined);
  eq('no deposit or sundries line', lines.length, 6);
  eq('percentages print as people write them', [lib.fmtInvoicePct(33.333), lib.fmtInvoicePct(40), lib.fmtInvoicePct(12.5)], ['33.33', '40', '12.5']);
}

// ── A whole-job % reads as one labour line ──────────────────────────────────
{
  const at = (pct, prevPct) => [
    { description: 'Lounge', pct, prevPct, amount: 600 * (pct - prevPct) / 40 },
    { description: 'Hall', pct, prevPct, amount: 720 * (pct - prevPct) / 40 },
    { description: 'Front bedroom', pct, prevPct, amount: 200 * (pct - prevPct) / 40 }];
  const one = lib.interimInvoiceLineItems({ labour: at(40, 0), variations: [{ description: 'Variation: Door', pct: 100, prevPct: 0, amount: 180 }] });
  eq('every room at the same % prints one labour line', one[0], { description: 'Labour: 40% of quoted works (previously invoiced 0%)', quantity: 1, unitAmount: 1520, accountCode: '201' });
  eq('...variations still listed after it', one.map(l => l.description), ['Labour: 40% of quoted works (previously invoiced 0%)', 'Variation: Door — complete']);
  const again = lib.interimInvoiceLineItems({ labour: at(70, 40) });
  eq('a second whole-job step says what went before', again[0].description, 'Labour: 70% of quoted works (previously invoiced 40%)');
  const mixed = lib.interimInvoiceLineItems({ labour: [
    { description: 'Lounge', pct: 100, prevPct: 0, amount: 1500 },
    { description: 'Hall', pct: 40, prevPct: 0, amount: 720 },
    { description: 'Front bedroom', pct: 40, prevPct: 0, amount: 200 }] });
  eq('rooms at different %s stay room by room', mixed.map(l => l.description), ['Lounge — complete', 'Hall — 40% complete', 'Front bedroom — 40% complete']);
  const doneBefore = lib.interimInvoiceLineItems({ labour: [
    { description: 'Lounge', pct: 100, prevPct: 100, amount: 0 },
    { description: 'Hall', pct: 60, prevPct: 0, amount: 1080 },
    { description: 'Front bedroom', pct: 60, prevPct: 0, amount: 300 }] });
  eq('a room already finished earlier keeps it room by room', doneBefore.map(l => l.description), ['Hall — 60% complete', 'Front bedroom — 60% complete']);
  const single = lib.interimInvoiceLineItems({ labour: [{ description: 'Labour as quoted', pct: 40, prevPct: 0, amount: 1600 }] });
  eq('a one-line quote keeps its own wording', single[0].description, 'Labour as quoted — 40% complete');
  const nothing = lib.interimInvoiceLineItems({ labour: at(40, 40).map(l => Object.assign(l, { amount: 0 })), materials: [{ description: 'Tape', quantity: 1, unitAmount: 4 }] });
  eq('no labour moving, no labour line', nothing.map(l => l.description), ['MATERIALS', 'Tape']);
}

// ── Server-side planning (what the route records) ───────────────────────────
{
  const tin = { key: 'code:TIK-OPT7-10', itemCode: 'TIK-OPT7-10', description: 'Optiva 7 10L', quantity: 2, unitAmount: 90, billedBefore: 0 };
  const lounge = { key: 'room:a', description: 'Lounge', lineTotal: 1800, pct: 100, prevPct: 0, billedBefore: 0 };
  const hall = { key: 'room:b', description: 'Hall', lineTotal: 2000, pct: 50, prevPct: 0, billedBefore: 0 };
  const door = { kind: 'free', sourceId: 'fv1', description: 'Variation: Garage door', lineTotal: 180, pct: 50, prevPct: 0, billedBefore: 0 };
  const body = { idempotencyKey: 'abcdef0123456789', labour: [lounge, hall], materials: [tin], variations: [door] };
  const first = lib.planInterimInvoice({ existing: [], depositTotal: 500, body });
  eq('plan: first interim is sequence 1', first.row && first.row.sequence, 1);
  eq('plan: subtotal = rooms + half the extra + tins', first.row && first.row.subtotal, 1800 + 1000 + 90 + 180);
  eq('plan: each labour line is recorded with its % and £',
    first.row && first.row.labourLines.map(l => [l.key, l.pct, l.amount]), [['room:a', 100, 1800], ['room:b', 50, 1000]]);
  eq('plan: overall labour % for display', first.row && first.row.labourPctCumulative, 73.68);
  eq('plan: the billed quantity is recorded per product', first.row && first.row.materialLines.map(m => [m.key, m.quantity, m.amount]), [['code:TIK-OPT7-10', 2, 180]]);
  eq('plan: deposit applied', first.row && first.row.depositApplied, 500);
  const existing = [Object.assign({ id: 'x', jobId: 'j' }, first.row)];
  const so = lib.billingSoFar(existing);
  eq('billing so far per line', so.labour, { 'room:a': { pct: 100, billed: 1800 }, 'room:b': { pct: 50, billed: 1000 } });
  const next = (over) => Object.assign({}, body, { idempotencyKey: 'bcdef01234567890', materials: [] }, over);
  const second = lib.planInterimInvoice({ existing, depositTotal: 500, body: next({
    labour: [Object.assign({}, lounge, { prevPct: 100, billedBefore: 1800 }),
             Object.assign({}, hall, { pct: 100, prevPct: 50, billedBefore: 1000 })],
    variations: [Object.assign({}, door, { pct: 100, prevPct: 50, billedBefore: 90 })],
    materials: [Object.assign({}, tin, { quantity: 1, billedBefore: 2 })] }) });
  eq('plan: second interim is sequence 2', second.row && second.row.sequence, 2);
  eq('plan: only the line that moved is recorded', second.row && second.row.labourLines.map(l => [l.key, l.prevPct, l.pct, l.amount]), [['room:b', 50, 100, 1000]]);
  eq('plan: its text says what went before', second.row && second.row.lineItems[0].description, 'Hall — complete (previously invoiced 50%)');
  eq('plan: the rest of the extra', second.row && second.row.variationsAmount, 90);
  eq('plan: ...and just the extra tin', second.row && second.row.materialsAmount, 90);
  eq('plan: no second deposit deduction', second.row && second.row.depositApplied, 0);
  const whole = lib.planInterimInvoice({ existing: [], depositTotal: 0, body: Object.assign({}, body, { materials: [], variations: [],
    labour: [Object.assign({}, lounge, { pct: 40 }), Object.assign({}, hall, { pct: 40 })] }) });
  eq('plan: a whole-job % is recorded per line but invoiced as one line',
    [whole.row && whole.row.labourLines.length, whole.row && whole.row.lineItems.map(l => [l.description, l.unitAmount])],
    [2, [['Labour: 40% of quoted works (previously invoiced 0%)', 1520]]]);
  const kept = lib.planInterimInvoice({ existing: [], depositTotal: 1250, body: Object.assign({}, body, { depositToApply: 600 }) });
  eq('plan: the chosen deposit share is recorded', [kept.row && kept.row.depositApplied, kept.row && kept.row.amountDue], [600, 2470]);
  const staleLabour = lib.planInterimInvoice({ existing, depositTotal: 500, body: next({ labour: [Object.assign({}, hall, { pct: 100 })], variations: [] }) });
  check('plan: a labour line built from a stale view is refused as a conflict', staleLabour.conflict === true, staleLabour);
  const staleTin = lib.planInterimInvoice({ existing, depositTotal: 500, body: next({ labour: [], variations: [], materials: [tin] }) });
  check('plan: materials billed since the builder opened are refused as a conflict', staleTin.conflict === true && /reopen the builder/.test(staleTin.error || ''), staleTin);
  const unpriced = lib.planInterimInvoice({ existing: [], depositTotal: 0, body: Object.assign({}, body, { materials: [Object.assign({}, tin, { unitAmount: 0 })] }) });
  check('plan: an unpriced material is refused', /price/.test(unpriced.error || ''), unpriced.error);
  const badKind = lib.planInterimInvoice({ existing: [], depositTotal: 0, body: Object.assign({}, body, { variations: [Object.assign({}, door, { kind: 'nope' })] }) });
  check('plan: an unknown variation kind is refused', /kind/.test(badKind.error || ''), badKind.error);
  const afterFinal = lib.planInterimInvoice({ existing: existing.concat([{ type: 'final', sequence: 2, depositApplied: 0 }]), depositTotal: 0, body });
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
