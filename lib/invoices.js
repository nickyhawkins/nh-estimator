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
//   · Labour as a CUMULATIVE % complete of the quoted labour, billing only
//     the difference from what was already billed. A second invoice at 70%
//     after a first at 40% bills 30%, never 70%.
//   · Materials ITEMISED: the products ticked as bought on the On Site list
//     that no invoice has billed yet, at the same sell prices the final
//     invoice uses. Billed quantities are recorded per product, so buying a
//     third tin after two were billed puts just the one on the next invoice,
//     and the final invoice lists only what is still unbilled.
//   · Approved variations ticked in full.
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
// quoted labour and the job's billing so far, and gets back every figure plus
// the reasons (if any) it can't be issued.
//
//   quotedLabour                the accepted quote's labour
//   labourPct / prevLabourPct   the NEW cumulative % complete / % already invoiced
//   materials                   bought products not yet billed: [{amount}]
//   variations                  ticked extras, billed in full: [{amount}]
//   depositTotal                the deposit actually received
//   depositAppliedSoFar         deposit already set against earlier invoices
//
// Labour bills the difference between two ROUNDED cumulative figures rather
// than rounding the difference, so however many interims a job takes, the
// labour billed at 100% is exactly the quoted labour to the penny.
function interimInvoiceMath(p) {
  var money = function(n) { return Math.round((+n || 0) * 100) / 100; };
  var pct = function(n) { return Math.round((+n || 0) * 100) / 100; };
  var sum = function(list) { return money((list || []).reduce(function(t, v) { return t + (+v.amount || 0); }, 0)); };
  var qL = money(p.quotedLabour);
  var newL = pct(p.labourPct), prevL = pct(p.prevLabourPct);
  var errors = [];
  if (newL < 0) errors.push('A percentage cannot be negative.');
  if (newL > 100) errors.push('Labour cannot go above 100% complete.');
  if (newL < prevL) errors.push('Labour is cumulative — it cannot go below the ' + fmtInvoicePct(prevL) + '% already invoiced.');
  var labourAmount = money(money(qL * newL / 100) - money(qL * prevL / 100));
  var materialsAmount = sum(p.materials);
  var variationsAmount = sum(p.variations);
  var subtotal = money(labourAmount + materialsAmount + variationsAmount);
  // The deposit comes off the first interim; whatever that invoice can't
  // absorb carries forward to the next one (interim or final).
  var depositLeft = Math.max(0, money((+p.depositTotal || 0) - (+p.depositAppliedSoFar || 0)));
  var depositApplied = subtotal > 0 ? money(Math.min(depositLeft, subtotal)) : 0;
  var amountDue = money(subtotal - depositApplied);
  if (!errors.length && !(amountDue > 0)) {
    errors.push(subtotal > 0
      ? 'The deposit still to be applied (' + depositLeft.toFixed(2) + ') covers this whole invoice — there is nothing for the client to pay yet. Bill a larger share first.'
      : 'Nothing to bill — raise the labour percentage, or tick materials or a variation.');
  }
  return {
    labourAmount: labourAmount, materialsAmount: materialsAmount,
    variationsAmount: variationsAmount, subtotal: subtotal,
    depositLeftBefore: depositLeft, depositApplied: depositApplied,
    amountDue: amountDue, errors: errors
  };
}

// The Xero lines for one interim, laid out like the final invoice: labour,
// then variations (both 201), then a MATERIALS heading over one line per
// product (202, item code carried). A labour share that bills nothing gets no
// line (a £0.00 "Labour: 40% (previously invoiced 40%)" reads like an error
// on a client's document). The deposit is NOT a line: it is a Xero
// prepayment, allocated to this invoice by hand in Xero.
function interimInvoiceLineItems(p) {
  var lines = [];
  if (Math.abs(+p.labourAmount || 0) > 0.005) {
    lines.push({ description: 'Labour: ' + fmtInvoicePct(p.labourPct) + '% of quoted works (previously invoiced ' + fmtInvoicePct(p.prevLabourPct) + '%)',
                 quantity: 1, unitAmount: +p.labourAmount, accountCode: '201' });
  }
  (p.variations || []).forEach(function(v) {
    lines.push({ description: v.description, quantity: 1, unitAmount: +v.amount || 0, accountCode: '201' });
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
    materialLines: r.material_lines || [],
    variationLines: r.variation_lines || [],
    lineItems: r.line_items || [],
    xeroInvoiceId: r.xero_invoice_id || null,
    xeroInvoiceNumber: r.xero_invoice_number || null,
    syncState: r.sync_state, syncedAt: r.synced_at, lastAttemptAt: r.last_attempt_at,
    lastError: r.last_error || null,
    idempotencyKey: r.idempotency_key, createdAt: r.created_at
  };
}

const round4 = (n) => Math.round(n * 10000) / 10000;

// Everything an interim needs from the job's billing so far.
function billingSoFar(existing) {
  const interims = existing.filter(r => r.type === 'interim');
  const billedKeys = new Set();
  const billedQty = {};
  existing.forEach(r => {
    (r.variationLines || []).forEach(v => billedKeys.add(v.kind + ':' + v.sourceId));
    (r.materialLines || []).forEach(m => { billedQty[m.key] = round4((billedQty[m.key] || 0) + (+m.quantity || 0)); });
  });
  return {
    interims,
    hasFinal: existing.some(r => r.type === 'final'),
    prevLabourPct: interims.reduce((m, r) => Math.max(m, r.labourPctCumulative), 0),
    depositAppliedSoFar: existing.reduce((t, r) => t + r.depositApplied, 0),
    nextSequence: existing.reduce((m, r) => Math.max(m, r.sequence), 0) + 1,
    billedKeys, billedQty
  };
}

// Validates an issue request against the job's own history and returns the
// row to insert, or { error } (with conflict: true where the request was built
// from a stale view of the job's billing). Pure, so every rule is testable
// without a database: the route supplies `existing` (mapped rows) and the
// deposit.
//
// The server cannot price materials (the Xero price index lives in the
// browser), so it takes the quantities and prices it is sent. What it CAN
// hold the line on is double billing: every material line states how much of
// that product the builder believed was already billed, and if that is not
// what the invoice rows say, another invoice landed in between and the
// request is refused rather than billing the same tins twice.
function planInterimInvoice({ existing, depositTotal, body }) {
  const b = body || {};
  const so = billingSoFar(existing || []);
  if (so.hasFinal) return { error: 'This job already has its final invoice — nothing more can be billed as an interim.' };
  const key = String(b.idempotencyKey || '');
  if (!/^[A-Za-z0-9-]{8,128}$/.test(key)) return { error: 'idempotencyKey is required' };
  const finite = (v) => typeof v === 'number' && isFinite(v);
  for (const f of ['quotedLabour', 'labourPct']) {
    if (!finite(b[f])) return { error: f + ' must be a number' };
  }
  if (b.quotedLabour < 0) return { error: 'Quoted labour cannot be negative' };

  const materials = [];
  const seenMat = new Set();
  for (const m of (Array.isArray(b.materials) ? b.materials : [])) {
    if (!m || !m.key || !String(m.description || '').trim() || !finite(m.quantity) || !(m.quantity > 0)
        || !finite(m.unitAmount) || !(m.unitAmount > 0) || !finite(m.billedBefore) || m.billedBefore < 0) {
      return { error: 'Each material needs a key, description, a quantity above zero, a price and the quantity billed before' };
    }
    const k = String(m.key);
    if (seenMat.has(k)) return { error: 'The same material is listed twice' };
    if (Math.abs((so.billedQty[k] || 0) - m.billedBefore) > 0.0001) {
      return { conflict: true, error: 'Another invoice has billed materials on this job since this one was started — reopen the builder and check the list.' };
    }
    seenMat.add(k);
    const quantity = round4(m.quantity);
    const unitAmount = Math.round(m.unitAmount * 100) / 100;
    materials.push({ key: k, itemCode: m.itemCode ? String(m.itemCode) : '', description: String(m.description).trim().slice(0, 4000),
                     quantity, unitAmount, amount: Math.round(quantity * unitAmount * 100) / 100 });
  }

  const variations = [];
  const seen = new Set();
  for (const v of (Array.isArray(b.variations) ? b.variations : [])) {
    if (!v || !VARIATION_KINDS.has(v.kind) || !v.sourceId || !String(v.description || '').trim() || !finite(v.amount) || !(v.amount > 0)) {
      return { error: 'Each variation needs a kind, sourceId, description and an amount above zero' };
    }
    const k = v.kind + ':' + v.sourceId;
    if (seen.has(k)) return { error: 'The same variation is ticked twice' };
    if (so.billedKeys.has(k)) return { error: '"' + v.description + '" has already been billed on an earlier invoice' };
    seen.add(k);
    variations.push({ kind: v.kind, sourceId: String(v.sourceId), description: String(v.description).trim().slice(0, 4000),
                      amount: Math.round(v.amount * 100) / 100 });
  }

  const math = interimInvoiceMath({
    quotedLabour: b.quotedLabour, labourPct: b.labourPct, prevLabourPct: so.prevLabourPct,
    materials, variations, depositTotal, depositAppliedSoFar: so.depositAppliedSoFar
  });
  if (math.errors.length) return { error: math.errors.join(' ') };

  const labourPct = Math.round(b.labourPct * 100) / 100;
  return {
    row: {
      type: 'interim', sequence: so.nextSequence,
      labourPctCumulative: labourPct,
      quotedLabour: Math.round(b.quotedLabour * 100) / 100,
      labourAmount: math.labourAmount, materialsAmount: math.materialsAmount,
      variationsAmount: math.variationsAmount, subtotal: math.subtotal,
      depositApplied: math.depositApplied, amountDue: math.amountDue,
      stageRef: b.stageRef ? String(b.stageRef).slice(0, 64) : null,
      materialLines: materials,
      variationLines: variations,
      lineItems: interimInvoiceLineItems({
        labourPct, prevLabourPct: so.prevLabourPct, labourAmount: math.labourAmount,
        materials, variations
      }),
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

module.exports = {
  ensureInvoiceSchema,
  fmtInvoicePct, interimInvoiceMath, interimInvoiceLineItems,
  mapInvoiceRow, billingSoFar, planInterimInvoice, buildInterimXeroInvoice
};
