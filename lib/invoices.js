// Staged invoicing — interim invoices part way through a job, and the
// balancing final invoice that follows them. See STAGED_INVOICING_SPEC.md.
//
// Two consumers:
//   · routes/api.js  — records an interim (server decides the figures from
//     the job's own invoice history, so two devices can't both bill 40%).
//   · routes/xero.js — writes a recorded interim to Xero as an ACCREC draft,
//     reading the row back rather than trusting a request body, so what
//     lands in Xero is exactly what was recorded.
//
// WHAT AN INTERIM BILLS:
//   · Labour line by line: each of the accepted quote's lines (a room, an
//     exterior item, a custom line) carries its own CUMULATIVE % complete --
//     100% when the room is done, 50% when half of it is -- and bills only
//     the difference from what that line was already billed. Sundries are
//     left for the final invoice.
//   · Materials ITEMISED: the products ticked as bought on the On Site list
//     that no invoice has billed yet, at the same sell prices the final
//     invoice uses. Billed quantities are recorded per product, so buying a
//     third tin after two were billed puts just the one on the next invoice,
//     and the final invoice lists only what is still unbilled.
//   · Approved variations the same way as labour lines, each with its own %.
//
// The three pure functions below (interimInvoiceMath, interimInvoiceLineItems,
// fmtInvoicePct) exist TWICE: here, and verbatim in public/index.html, where
// the builder previews the invoice offline. The browser copy is a preview;
// this copy is the one that decides what is recorded. They must never drift
// -- scripts/test-staged-invoicing.js asserts the two sources are identical,
// character for character, and fails the moment one is edited alone.

const db = require('../db');
const { ensureClientQuoteSchema, VARIATION_KINDS } = require('./clientQuote');

// db/setup.sql is not run on deploy (same situation as quote_snapshots and
// job_variations), so the schema is created lazily on first use -- once per
// process, memoised, and only from the routes that need it.
//
// A real foreign key, like job_variations': an invoice row is a record of
// money asked for in Xero, and one that outlived its job would be a figure
// the Billing view could never show again. Deleting the job cascades it.
let schemaReady = null;
function ensureInvoiceSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      // job_variations must exist before the column below can be added to it.
      await ensureClientQuoteSchema();
      await db.query(`
        CREATE TABLE IF NOT EXISTS invoices (
          id VARCHAR PRIMARY KEY,
          job_id VARCHAR NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
          type VARCHAR NOT NULL,
          sequence INTEGER NOT NULL,
          labour_pct_cumulative NUMERIC NOT NULL DEFAULT 0,
          quoted_labour NUMERIC NOT NULL DEFAULT 0,
          labour_amount NUMERIC NOT NULL DEFAULT 0,
          materials_amount NUMERIC NOT NULL DEFAULT 0,
          variations_amount NUMERIC NOT NULL DEFAULT 0,
          subtotal NUMERIC NOT NULL DEFAULT 0,
          deposit_applied NUMERIC NOT NULL DEFAULT 0,
          amount_due NUMERIC NOT NULL DEFAULT 0,
          stage_ref VARCHAR,
          labour_lines JSONB NOT NULL DEFAULT '[]',
          material_lines JSONB NOT NULL DEFAULT '[]',
          variation_lines JSONB NOT NULL DEFAULT '[]',
          line_items JSONB NOT NULL DEFAULT '[]',
          xero_contact_id VARCHAR,
          xero_client_name VARCHAR,
          xero_reference VARCHAR,
          xero_invoice_id VARCHAR,
          xero_invoice_number VARCHAR,
          sync_state VARCHAR NOT NULL DEFAULT 'notSynced',
          synced_at TIMESTAMP,
          last_attempt_at TIMESTAMP,
          last_error VARCHAR,
          idempotency_key VARCHAR NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )`);
      // One invoice per sequence number per job: two devices issuing at once
      // both compute the same next number, and this turns the loser into a
      // 409 instead of a second "interim 2".
      await db.query('CREATE UNIQUE INDEX IF NOT EXISTS invoices_job_sequence ON invoices (job_id, sequence)');
      // The same key is sent to Xero as Idempotency-Key, and a replayed issue
      // (lost reply, second tap) must find the row it already made.
      await db.query('CREATE UNIQUE INDEX IF NOT EXISTS invoices_idempotency_key ON invoices (idempotency_key)');
      await db.query('CREATE INDEX IF NOT EXISTS invoices_job ON invoices (job_id)');
      // Xero's own view of each invoice, read back by /auth/invoice-statuses.
      // The client's page shows an invoice only once Xero has it AUTHORISED
      // (approved -- no longer a draft) or PAID, so these decide what a client
      // can see. Added with ALTER, not in the CREATE, because the table was
      // already live when they arrived.
      await db.query(`ALTER TABLE invoices
        ADD COLUMN IF NOT EXISTS xero_status VARCHAR,
        ADD COLUMN IF NOT EXISTS xero_date DATE,
        ADD COLUMN IF NOT EXISTS xero_total NUMERIC,
        ADD COLUMN IF NOT EXISTS xero_amount_paid NUMERIC,
        ADD COLUMN IF NOT EXISTS xero_amount_due NUMERIC,
        ADD COLUMN IF NOT EXISTS xero_checked_at TIMESTAMP`);
      // Which invoice a PUBLISHED variation line was billed on. The app's own
      // record of what was billed is invoices.variation_lines (every approved
      // extra, published or not); this column is the same fact stamped on the
      // client-facing row where one exists.
      await db.query('ALTER TABLE job_variations ADD COLUMN IF NOT EXISTS invoiced_on_invoice_id VARCHAR');
    })().catch(err => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

// ── Shared with public/index.html (keep identical — see header) ─────────────

// "40", "33.33", "12.5" -- a percentage as a person would write it on an
// invoice, never "40.00" and never a float artefact like 33.330000000000005.
function fmtInvoicePct(n) {
  var r = Math.round((+n || 0) * 100) / 100;
  return String(r);
}

// The whole money story of one interim invoice. Pure: the caller supplies the
// lines and the job's billing so far, and gets back every figure plus the
// reasons (if any) it can't be issued.
//
//   labour      quote lines (a room, an exterior item, a custom line...):
//               [{key, description, lineTotal, pct, prevPct, billedBefore}]
//   variations  approved extras, same shape -- a % of an extra works the same
//               way as a % of a room
//   materials   bought products not yet billed: [{amount}]
//   depositTotal / depositAppliedSoFar   the deposit received / already set
//               against earlier invoices
//   depositToApply  how much of what's left to take off THIS invoice; null
//               means all of it (up to the invoice total). Less keeps a float
//               back for a later invoice -- the rest carries forward, and the
//               final invoice takes whatever is still unused.
//
// Every labour and variation line carries its OWN cumulative % complete and
// bills the difference: its line total at the new % (rounded) less what it
// has already been billed. So a room invoiced at 50% then marked complete
// comes to exactly its quoted price, to the penny, however many invoices it
// took -- and if an amendment re-priced it in between, the second invoice
// bills the new price less what the first one actually billed, never the
// old figure twice.
function interimInvoiceMath(p) {
  var money = function(n) { return Math.round((+n || 0) * 100) / 100; };
  var pct = function(n) { return Math.round((+n || 0) * 100) / 100; };
  var errors = [];
  var bill = function(lines, what) {
    return (lines || []).map(function(l) {
      var newP = pct(l.pct), prevP = pct(l.prevPct);
      var name = l.description || what;
      var amount = 0;
      if (newP < 0 || newP > 100) errors.push(name + ': the percentage must be between 0 and 100.');
      else if (newP < prevP) errors.push(name + ' is cumulative — it cannot go below the ' + fmtInvoicePct(prevP) + '% already invoiced.');
      else if (newP > prevP) {
        amount = money(money(money(l.lineTotal) * newP / 100) - money(l.billedBefore));
        if (amount < 0) {
          errors.push(name + ': its price is now below what was already invoiced for it — settle the difference on the final invoice.');
          amount = 0;
        }
      }
      return { key: l.key, amount: amount };
    });
  };
  var labourLines = bill(p.labour, 'Labour');
  var variationLines = bill(p.variations, 'Variation');
  var sum = function(list) { return money((list || []).reduce(function(t, v) { return t + (+v.amount || 0); }, 0)); };
  var labourAmount = sum(labourLines);
  var variationsAmount = sum(variationLines);
  var materialsAmount = sum(p.materials);
  var subtotal = money(labourAmount + materialsAmount + variationsAmount);
  // A clean total, like the quote's (Nicky, 2026-09-24): the invoice total is
  // brought DOWN to the nearest £5 by trimming the LABOUR only -- materials
  // stay at their real prices, extras at their agreed amounts. Down, not up:
  // an interim bills work in progress and must never ask for more than it's
  // worth. Nothing is lost -- each line records the £ it was actually billed,
  // so the trimmed pennies are picked up by the next invoice to touch that
  // line, and in the end by the final, which squares up to the penny.
  // The trim is spread over this invoice's part-done labour lines in
  // proportion (the quote's own rounding spread), the remainder landing on the
  // largest. No trim when there's no part-done labour to take it from, or when
  // it would leave nothing to bill at all.
  var step = 5;
  var target = Math.floor(Math.round(subtotal * 100) / (step * 100)) * step;
  var trim = money(subtotal - target);
  var roundingTrim = 0;
  // Only PART-DONE lines take the trim. A line taken to 100% on this invoice
  // bills its exact remaining price, pennies and all (Nicky, 2026-09-25:
  // "jobs completed 100% shouldn't have the pennies skimmed") -- a room
  // marked done is settled, not left owing 47p for the final. So when every
  // labour line billing here is being completed, nothing is trimmed and the
  // invoice keeps its exact total.
  var trimmable = labourLines.filter(function(l, i) {
    return l.amount > 0 && pct((p.labour || [])[i] && p.labour[i].pct) < 100;
  });
  var trimmableAmount = sum(trimmable);
  if (trim > 0.005 && target > 0 && trimmableAmount >= trim) {
    var largest = null, trimmed = 0;
    trimmable.forEach(function(l) {
      var cut = money(trim * l.amount / trimmableAmount);
      l.amount = money(l.amount - cut);
      trimmed = money(trimmed + cut);
      if (!largest || l.amount > largest.amount) largest = l;
    });
    if (largest) largest.amount = money(largest.amount - money(trim - trimmed));
    roundingTrim = trim;
    labourAmount = sum(labourLines);
    subtotal = money(labourAmount + materialsAmount + variationsAmount);
  }
  // The deposit: all of what's left by default (up to this invoice's total),
  // or the share chosen. An invoice the deposit covers entirely (£0 to pay)
  // is allowed -- that is a choice, not a mistake.
  var depositLeft = Math.max(0, money((+p.depositTotal || 0) - (+p.depositAppliedSoFar || 0)));
  var depositMax = subtotal > 0 ? money(Math.min(depositLeft, subtotal)) : 0;
  var depositApplied = depositMax;
  if (p.depositToApply != null && p.depositToApply !== '') {
    var asked = money(p.depositToApply);
    if (asked < 0) errors.push('The deposit to take off cannot be negative.');
    else if (asked > depositMax + 0.005) {
      errors.push('Only ' + depositMax.toFixed(2) + ' of the deposit can come off this invoice' +
        (depositLeft > depositMax + 0.005 ? ' (its total).' : ' (what is left of it).'));
    } else depositApplied = asked;
  }
  var amountDue = money(subtotal - depositApplied);
  if (!errors.length && !(subtotal > 0)) {
    errors.push('Nothing to bill — raise a percentage, mark a room done, or tick materials.');
  }
  return {
    labourLines: labourLines, variationLines: variationLines,
    labourAmount: labourAmount, materialsAmount: materialsAmount,
    variationsAmount: variationsAmount, subtotal: subtotal, roundingTrim: roundingTrim,
    depositLeftBefore: depositLeft, depositApplied: depositApplied,
    amountDue: amountDue, errors: errors
  };
}

// The Xero lines for one interim, laid out like the final invoice: the quote's
// own labour lines, then variations (both 201), then a MATERIALS heading over
// one line per product (202, item code carried). Only lines that bill
// something appear, each saying how far through it is:
//   "Lounge — complete (previously invoiced 50%)"
//   "Hall, stairs & landing — 50% complete"
// Sundries are never here: they are a % of the whole job's labour and are
// billed in full on the final invoice. The deposit is NOT a line either: it is
// a Xero prepayment, allocated to this invoice by hand in Xero.
//
// A WHOLE-JOB % reads as one line. When every labour line on the quote (p.labour
// must be ALL of them, billing or not) moves from the same % to the same % --
// "Set every line to 40%", or a quote stage -- a row per room all saying
// "40% complete" is noise, so labour prints as
//   "Labour: 40% of quoted works (previously invoiced 0%)"
// for the lines' total. The per-line record underneath is unchanged, so a later
// invoice can still go room by room. A one-line quote keeps its own wording.
function interimInvoiceLineItems(p) {
  var pct = function(n) { return Math.round((+n || 0) * 100) / 100; };
  var text = function(l) {
    return l.description + ' — ' + (pct(l.pct) >= 100 ? 'complete' : fmtInvoicePct(l.pct) + '% complete') +
      (pct(l.prevPct) > 0 ? ' (previously invoiced ' + fmtInvoicePct(l.prevPct) + '%)' : '');
  };
  var billing = function(l) { return Math.abs(+l.amount || 0) > 0.005; };
  var labour = p.labour || [];
  var first = labour[0];
  var wholeJob = labour.length > 1 && labour.some(billing) && labour.every(function(l) {
    return pct(l.pct) === pct(first.pct) && pct(l.prevPct) === pct(first.prevPct);
  });
  var lines = [];
  if (wholeJob) {
    var total = Math.round(labour.reduce(function(t, l) { return t + (+l.amount || 0); }, 0) * 100) / 100;
    lines.push({ description: 'Labour: ' + fmtInvoicePct(first.pct) + '% of quoted works (previously invoiced ' + fmtInvoicePct(first.prevPct) + '%)',
                 quantity: 1, unitAmount: total, accountCode: '201' });
  }
  (wholeJob ? [] : labour).concat(p.variations || []).forEach(function(l) {
    if (!billing(l)) return;
    lines.push({ description: text(l), quantity: 1, unitAmount: +l.amount, accountCode: '201' });
  });
  if ((p.materials || []).length) {
    lines.push({ description: 'MATERIALS' });
    p.materials.forEach(function(m) {
      var line = { description: m.description, quantity: +m.quantity || 0, unitAmount: +m.unitAmount || 0, accountCode: '202' };
      if (m.itemCode) line.itemCode = m.itemCode;
      lines.push(line);
    });
  }
  return lines;
}

// ── Server-only ──────────────────────────────────────────────────────────────

const num = (v) => (v == null ? 0 : +v);
function mapInvoiceRow(r) {
  return {
    id: r.id, jobId: r.job_id, type: r.type, sequence: r.sequence,
    labourPctCumulative: num(r.labour_pct_cumulative),
    quotedLabour: num(r.quoted_labour),
    labourAmount: num(r.labour_amount), materialsAmount: num(r.materials_amount),
    variationsAmount: num(r.variations_amount), subtotal: num(r.subtotal),
    depositApplied: num(r.deposit_applied), amountDue: num(r.amount_due),
    stageRef: r.stage_ref || null,
    labourLines: r.labour_lines || [],
    materialLines: r.material_lines || [],
    variationLines: r.variation_lines || [],
    lineItems: r.line_items || [],
    xeroInvoiceId: r.xero_invoice_id || null,
    xeroInvoiceNumber: r.xero_invoice_number || null,
    syncState: r.sync_state, syncedAt: r.synced_at, lastAttemptAt: r.last_attempt_at,
    lastError: r.last_error || null,
    xeroStatus: r.xero_status || null,
    xeroDate: r.xero_date || null,
    xeroTotal: r.xero_total == null ? null : +r.xero_total,
    xeroAmountPaid: r.xero_amount_paid == null ? null : +r.xero_amount_paid,
    xeroAmountDue: r.xero_amount_due == null ? null : +r.xero_amount_due,
    xeroCheckedAt: r.xero_checked_at || null,
    idempotencyKey: r.idempotency_key, createdAt: r.created_at
  };
}

const round4 = (n) => Math.round(n * 10000) / 10000;

// Everything an interim needs from the job's billing so far. Labour and
// variation lines are tracked per key: the highest % reached and the £ billed
// in total. Materials per product: the quantity billed.
function billingSoFar(existing) {
  const interims = existing.filter(r => r.type === 'interim');
  const labour = {}, variations = {}, billedQty = {};
  const track = (map, l) => {
    const t = map[l.key] || (map[l.key] = { pct: 0, billed: 0 });
    t.pct = Math.max(t.pct, +l.pct || 0);
    t.billed = Math.round((t.billed + (+l.amount || 0)) * 100) / 100;
  };
  existing.forEach(r => {
    (r.labourLines || []).forEach(l => track(labour, l));
    (r.variationLines || []).forEach(l => track(variations, l));
    (r.materialLines || []).forEach(m => { billedQty[m.key] = round4((billedQty[m.key] || 0) + (+m.quantity || 0)); });
  });
  return {
    interims,
    hasFinal: existing.some(r => r.type === 'final'),
    labourBilled: interims.reduce((t, r) => t + r.labourAmount, 0),
    depositAppliedSoFar: existing.reduce((t, r) => t + r.depositApplied, 0),
    nextSequence: existing.reduce((m, r) => Math.max(m, r.sequence), 0) + 1,
    labour, variations, billedQty
  };
}

const STALE = 'Another invoice has been issued on this job since this one was started — reopen the builder and check the figures.';

// Validates an issue request against the job's own history and returns the
// row to insert, or { error } (with conflict: true where the request was built
// from a stale view of the job's billing). Pure, so every rule is testable
// without a database: the route supplies `existing` (mapped rows) and the
// deposit.
//
// The server cannot price anything (the calc engine and the Xero price index
// live in the browser), so it takes the line totals, quantities and prices it
// is sent. What it holds the line on is double billing: every labour and
// variation line states the % and £ the builder believed were already
// invoiced, every material the quantity, and if that is not what the invoice
// rows say, another invoice landed in between and the request is refused.
function planInterimInvoice({ existing, depositTotal, body }) {
  const b = body || {};
  const so = billingSoFar(existing || []);
  if (so.hasFinal) return { error: 'This job already has its final invoice — nothing more can be billed as an interim.' };
  const key = String(b.idempotencyKey || '');
  if (!/^[A-Za-z0-9-]{8,128}$/.test(key)) return { error: 'idempotencyKey is required' };
  const finite = (v) => typeof v === 'number' && isFinite(v);
  const money = (n) => Math.round(n * 100) / 100;
  const pct = (n) => Math.round(n * 100) / 100;

  // Labour and variation lines share one shape and one set of checks.
  const readLines = (raw, what, extra) => {
    const out = [];
    const seen = new Set();
    for (const l of (Array.isArray(raw) ? raw : [])) {
      if (!l || !String(l.description || '').trim() || !finite(l.lineTotal) || !(l.lineTotal >= 0)
          || !finite(l.pct) || !finite(l.prevPct) || !finite(l.billedBefore)) {
        return { error: 'Each ' + what + ' line needs a description, a line total, a % and what was invoiced before' };
      }
      const line = extra ? extra(l) : { key: String(l.key || '') };
      if (line.error) return line;
      if (!line.key) return { error: 'Each ' + what + ' line needs a key' };
      if (seen.has(line.key)) return { error: 'The same ' + what + ' line is listed twice' };
      seen.add(line.key);
      const had = (what === 'labour' ? so.labour : so.variations)[line.key] || { pct: 0, billed: 0 };
      if (Math.abs(had.pct - l.prevPct) > 0.005 || Math.abs(had.billed - l.billedBefore) > 0.005) {
        return { conflict: true, error: STALE };
      }
      out.push(Object.assign(line, {
        description: String(l.description).trim().slice(0, 4000), lineTotal: money(l.lineTotal),
        pct: pct(l.pct), prevPct: pct(had.pct), billedBefore: had.billed
      }));
    }
    return { lines: out };
  };
  const labourIn = readLines(b.labour, 'labour');
  if (labourIn.error) return labourIn;
  const variationsIn = readLines(b.variations, 'variation', (v) => {
    if (!VARIATION_KINDS.has(v.kind) || !v.sourceId) return { error: 'Each variation needs a kind and a sourceId' };
    return { key: v.kind + ':' + v.sourceId, kind: v.kind, sourceId: String(v.sourceId) };
  });
  if (variationsIn.error) return variationsIn;

  const materials = [];
  const seenMat = new Set();
  for (const m of (Array.isArray(b.materials) ? b.materials : [])) {
    if (!m || !m.key || !String(m.description || '').trim() || !finite(m.quantity) || !(m.quantity > 0)
        || !finite(m.unitAmount) || !(m.unitAmount > 0) || !finite(m.billedBefore) || m.billedBefore < 0) {
      return { error: 'Each material needs a key, description, a quantity above zero, a price and the quantity billed before' };
    }
    const k = String(m.key);
    if (seenMat.has(k)) return { error: 'The same material is listed twice' };
    if (Math.abs((so.billedQty[k] || 0) - m.billedBefore) > 0.0001) return { conflict: true, error: STALE };
    seenMat.add(k);
    const quantity = round4(m.quantity);
    const unitAmount = money(m.unitAmount);
    materials.push({ key: k, itemCode: m.itemCode ? String(m.itemCode) : '', description: String(m.description).trim().slice(0, 4000),
                     quantity, unitAmount, amount: money(quantity * unitAmount) });
  }

  const math = interimInvoiceMath({
    labour: labourIn.lines, variations: variationsIn.lines, materials,
    depositTotal, depositAppliedSoFar: so.depositAppliedSoFar,
    depositToApply: finite(b.depositToApply) ? b.depositToApply : null
  });
  if (math.errors.length) return { error: math.errors.join(' ') };

  // Only the lines that bill something are recorded -- the rest are unchanged.
  const withAmounts = (lines, amounts) => lines
    .map((l, i) => Object.assign({}, l, { amount: amounts[i].amount }))
    .filter(l => l.amount > 0.005)
    .map(({ billedBefore, ...l }) => l);
  const labourLines = withAmounts(labourIn.lines, math.labourLines);
  // Every labour line, billing or not, for the layout: it needs them all to
  // tell a whole-job % from a room-by-room invoice.
  const allLabour = labourIn.lines.map((l, i) => Object.assign({}, l, { amount: math.labourLines[i].amount }));
  const variationLines = withAmounts(variationsIn.lines, math.variationLines);
  // The overall labour % (display only): everything billed on labour so far,
  // this invoice included, against the quote's labour lines.
  const quotedLabour = money(labourIn.lines.reduce((t, l) => t + l.lineTotal, 0));
  const overallPct = quotedLabour > 0 ? pct((so.labourBilled + math.labourAmount) / quotedLabour * 100) : 0;
  return {
    row: {
      type: 'interim', sequence: so.nextSequence,
      labourPctCumulative: Math.min(100, overallPct),
      quotedLabour,
      labourAmount: math.labourAmount, materialsAmount: math.materialsAmount,
      variationsAmount: math.variationsAmount, subtotal: math.subtotal,
      depositApplied: math.depositApplied, amountDue: math.amountDue,
      stageRef: b.stageRef ? String(b.stageRef).slice(0, 64) : null,
      labourLines, materialLines: materials, variationLines,
      lineItems: interimInvoiceLineItems({ labour: allLabour, variations: variationLines, materials }),
      idempotencyKey: key
    }
  };
}

// The ACCREC draft for a recorded interim. Same conventions as the final
// invoice's /create-invoice: DRAFT (reviewed and sent from Xero), NoTax (not
// VAT registered), today's date, linked contact or by-name fallback, a
// description-only row as the MATERIALS divider, item codes carried.
function buildInterimXeroInvoice(row) {
  const fmt2 = (n) => Math.round(n * 100) / 100;
  return {
    Invoices: [{
      Type: 'ACCREC',
      Contact: row.xeroContactId ? { ContactID: row.xeroContactId } : { Name: row.xeroClientName || 'Client' },
      Date: new Date().toISOString().split('T')[0],
      Status: 'DRAFT',
      LineAmountTypes: 'NoTax',
      Reference: row.xeroReference || '',
      LineItems: (row.lineItems || []).map(l => {
        if (l.quantity == null && l.unitAmount == null) return { Description: l.description };
        const line = {
          Description: l.description,
          Quantity: +l.quantity || 0,
          UnitAmount: fmt2(+l.unitAmount || 0),
          AccountCode: l.accountCode
        };
        if (l.itemCode) line.ItemCode = l.itemCode;
        return line;
      })
    }]
  };
}

// What a CLIENT may see of a job's invoices: only those Xero has approved or
// marked paid. A draft is still Nicky's to check and change, and must never
// reach the client's page before it has reached the client.
const CLIENT_VISIBLE_STATUSES = ['AUTHORISED', 'PAID'];
// Xero's statuses for an invoice that no longer stands.
const DEAD_STATUSES = ['VOIDED', 'DELETED'];

module.exports = {
  CLIENT_VISIBLE_STATUSES, DEAD_STATUSES,
  ensureInvoiceSchema,
  fmtInvoicePct, interimInvoiceMath, interimInvoiceLineItems,
  mapInvoiceRow, billingSoFar, planInterimInvoice, buildInterimXeroInvoice
};
