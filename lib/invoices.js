// Staged invoicing — interim invoices part way through a job, and the
// balancing final invoice that deducts them. See STAGED_INVOICING_SPEC.md.
//
// Two consumers:
//   · routes/api.js  — records an interim (server decides the figures from
//     the job's own invoice history, so two devices can't both bill 40%).
//   · routes/xero.js — writes a recorded interim to Xero as an ACCREC draft,
//     reading the row back rather than trusting a request body, so what
//     lands in Xero is exactly what was recorded.
//
// THE PRINCIPLE: every interim records a CUMULATIVE % complete for labour
// and for materials, and bills only the difference from what was already
// billed. A second invoice at 70% after a first at 40% bills 30%, never 70%,
// and the final invoice simply deducts every interim's subtotal.
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
          materials_pct_cumulative NUMERIC NOT NULL DEFAULT 0,
          quoted_labour NUMERIC NOT NULL DEFAULT 0,
          quoted_materials NUMERIC NOT NULL DEFAULT 0,
          labour_amount NUMERIC NOT NULL DEFAULT 0,
          materials_amount NUMERIC NOT NULL DEFAULT 0,
          variations_amount NUMERIC NOT NULL DEFAULT 0,
          subtotal NUMERIC NOT NULL DEFAULT 0,
          deposit_applied NUMERIC NOT NULL DEFAULT 0,
          amount_due NUMERIC NOT NULL DEFAULT 0,
          stage_ref VARCHAR,
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

const INVOICE_TYPES = new Set(['interim', 'final']);
const SYNC_STATES = new Set(['notSynced', 'failed', 'synced']);

// ── Shared with public/index.html (keep identical — see header) ─────────────

// "40", "33.33", "12.5" -- a percentage as a person would write it on an
// invoice, never "40.00" and never a float artefact like 33.330000000000005.
function fmtInvoicePct(n) {
  var r = Math.round((+n || 0) * 100) / 100;
  return String(r);
}

// The whole money story of one interim invoice. Pure: the caller supplies the
// quoted bases and the job's billing so far, and gets back every figure plus
// the reasons (if any) it can't be issued.
//
//   quotedLabour / quotedMaterials  the accepted quote's figures (materials
//                                   at quoted sell prices, markup in)
//   labourPct / materialsPct        the NEW cumulative % complete
//   prevLabourPct / prevMaterialsPct  the cumulative % already invoiced
//   variations                      ticked extras, billed in full: [{amount}]
//   depositTotal                    the deposit actually received
//   depositAppliedSoFar             deposit already set against earlier invoices
//
// Amounts bill the difference between two ROUNDED cumulative figures rather
// than rounding the difference, so however many interims a job takes, the
// labour billed at 100% is exactly the quoted labour to the penny.
function interimInvoiceMath(p) {
  var money = function(n) { return Math.round((+n || 0) * 100) / 100; };
  var pct = function(n) { return Math.round((+n || 0) * 100) / 100; };
  var qL = money(p.quotedLabour), qM = money(p.quotedMaterials);
  var newL = pct(p.labourPct), newM = pct(p.materialsPct);
  var prevL = pct(p.prevLabourPct), prevM = pct(p.prevMaterialsPct);
  var errors = [];
  if (newL < 0 || newM < 0) errors.push('A percentage cannot be negative.');
  if (newL > 100) errors.push('Labour cannot go above 100% complete.');
  if (newM > 100) errors.push('Materials cannot go above 100% complete.');
  if (newL < prevL) errors.push('Labour is cumulative — it cannot go below the ' + fmtInvoicePct(prevL) + '% already invoiced.');
  if (newM < prevM) errors.push('Materials are cumulative — they cannot go below the ' + fmtInvoicePct(prevM) + '% already invoiced.');
  var labourAmount = money(money(qL * newL / 100) - money(qL * prevL / 100));
  var materialsAmount = money(money(qM * newM / 100) - money(qM * prevM / 100));
  var variationsAmount = money((p.variations || []).reduce(function(t, v) { return t + (+v.amount || 0); }, 0));
  var subtotal = money(labourAmount + materialsAmount + variationsAmount);
  // The deposit comes off the first interim; whatever that invoice can't
  // absorb carries forward to the next one (interim or final).
  var depositLeft = Math.max(0, money((+p.depositTotal || 0) - (+p.depositAppliedSoFar || 0)));
  var depositApplied = subtotal > 0 ? money(Math.min(depositLeft, subtotal)) : 0;
  var amountDue = money(subtotal - depositApplied);
  if (!errors.length && !(amountDue > 0)) {
    errors.push(subtotal > 0
      ? 'The deposit still to be applied (' + depositLeft.toFixed(2) + ') covers this whole invoice — there is nothing for the client to pay yet. Bill a larger share first.'
      : 'Nothing to bill — raise a percentage or tick a variation.');
  }
  return {
    labourAmount: labourAmount, materialsAmount: materialsAmount,
    variationsAmount: variationsAmount, subtotal: subtotal,
    depositLeftBefore: depositLeft, depositApplied: depositApplied,
    amountDue: amountDue, errors: errors
  };
}

// The Xero lines for one interim. Labour and variations post to 201 and
// materials to 202 -- the same accounts the final invoice uses, so the
// "Less: interim" lines on the final net revenue back out of the right place.
// A share that bills nothing gets no line (a £0.00 "Materials: 0%" row reads
// like an error on a client's document). The deposit is NOT a line: it is a
// Xero prepayment, allocated to this invoice by hand in Xero.
function interimInvoiceLineItems(p) {
  var lines = [];
  if (Math.abs(+p.labourAmount || 0) > 0.005) {
    lines.push({ description: 'Labour: ' + fmtInvoicePct(p.labourPct) + '% of quoted works (previously invoiced ' + fmtInvoicePct(p.prevLabourPct) + '%)',
                 quantity: 1, unitAmount: +p.labourAmount, accountCode: '201' });
  }
  if (Math.abs(+p.materialsAmount || 0) > 0.005) {
    lines.push({ description: 'Materials: ' + fmtInvoicePct(p.materialsPct) + '% of quoted materials (previously invoiced ' + fmtInvoicePct(p.prevMaterialsPct) + '%)',
                 quantity: 1, unitAmount: +p.materialsAmount, accountCode: '202' });
  }
  (p.variations || []).forEach(function(v) {
    lines.push({ description: v.description, quantity: 1, unitAmount: +v.amount || 0, accountCode: '201' });
  });
  return lines;
}

// ── Server-only ──────────────────────────────────────────────────────────────

const num = (v) => (v == null ? 0 : +v);
function mapInvoiceRow(r) {
  return {
    id: r.id, jobId: r.job_id, type: r.type, sequence: r.sequence,
    labourPctCumulative: num(r.labour_pct_cumulative),
    materialsPctCumulative: num(r.materials_pct_cumulative),
    quotedLabour: num(r.quoted_labour), quotedMaterials: num(r.quoted_materials),
    labourAmount: num(r.labour_amount), materialsAmount: num(r.materials_amount),
    variationsAmount: num(r.variations_amount), subtotal: num(r.subtotal),
    depositApplied: num(r.deposit_applied), amountDue: num(r.amount_due),
    stageRef: r.stage_ref || null,
    variationLines: r.variation_lines || [],
    lineItems: r.line_items || [],
    xeroInvoiceId: r.xero_invoice_id || null,
    xeroInvoiceNumber: r.xero_invoice_number || null,
    syncState: r.sync_state, syncedAt: r.synced_at, lastAttemptAt: r.last_attempt_at,
    lastError: r.last_error || null,
    idempotencyKey: r.idempotency_key, createdAt: r.created_at
  };
}

// Everything an interim needs from the job's billing so far.
function billingSoFar(existing) {
  const interims = existing.filter(r => r.type === 'interim');
  const billedKeys = new Set();
  existing.forEach(r => (r.variationLines || []).forEach(v => billedKeys.add(v.kind + ':' + v.sourceId)));
  return {
    interims,
    hasFinal: existing.some(r => r.type === 'final'),
    prevLabourPct: interims.reduce((m, r) => Math.max(m, r.labourPctCumulative), 0),
    prevMaterialsPct: interims.reduce((m, r) => Math.max(m, r.materialsPctCumulative), 0),
    depositAppliedSoFar: existing.reduce((t, r) => t + r.depositApplied, 0),
    nextSequence: existing.reduce((m, r) => Math.max(m, r.sequence), 0) + 1,
    billedKeys
  };
}

// Validates an issue request against the job's own history and returns the
// row to insert, or { error }. Pure, so every rule is testable without a
// database: the route supplies `existing` (mapped rows) and the deposit.
function planInterimInvoice({ existing, depositTotal, body }) {
  const b = body || {};
  const so = billingSoFar(existing || []);
  if (so.hasFinal) return { error: 'This job already has its final invoice — nothing more can be billed as an interim.' };
  const key = String(b.idempotencyKey || '');
  if (!/^[A-Za-z0-9-]{8,128}$/.test(key)) return { error: 'idempotencyKey is required' };
  const finite = (v) => typeof v === 'number' && isFinite(v);
  for (const f of ['quotedLabour', 'quotedMaterials', 'labourPct', 'materialsPct']) {
    if (!finite(b[f])) return { error: f + ' must be a number' };
  }
  if (b.quotedLabour < 0 || b.quotedMaterials < 0) return { error: 'Quoted figures cannot be negative' };

  const raw = Array.isArray(b.variations) ? b.variations : [];
  const variations = [];
  const seen = new Set();
  for (const v of raw) {
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
    quotedLabour: b.quotedLabour, quotedMaterials: b.quotedMaterials,
    labourPct: b.labourPct, materialsPct: b.materialsPct,
    prevLabourPct: so.prevLabourPct, prevMaterialsPct: so.prevMaterialsPct,
    variations, depositTotal, depositAppliedSoFar: so.depositAppliedSoFar
  });
  if (math.errors.length) return { error: math.errors.join(' ') };

  const labourPct = Math.round(b.labourPct * 100) / 100;
  const materialsPct = Math.round(b.materialsPct * 100) / 100;
  return {
    row: {
      type: 'interim', sequence: so.nextSequence,
      labourPctCumulative: labourPct, materialsPctCumulative: materialsPct,
      quotedLabour: Math.round(b.quotedLabour * 100) / 100,
      quotedMaterials: Math.round(b.quotedMaterials * 100) / 100,
      labourAmount: math.labourAmount, materialsAmount: math.materialsAmount,
      variationsAmount: math.variationsAmount, subtotal: math.subtotal,
      depositApplied: math.depositApplied, amountDue: math.amountDue,
      stageRef: b.stageRef ? String(b.stageRef).slice(0, 64) : null,
      variationLines: variations,
      lineItems: interimInvoiceLineItems({
        labourPct, prevLabourPct: so.prevLabourPct, labourAmount: math.labourAmount,
        materialsPct, prevMaterialsPct: so.prevMaterialsPct, materialsAmount: math.materialsAmount,
        variations
      }),
      idempotencyKey: key
    }
  };
}

// The ACCREC draft for a recorded interim. Same conventions as the final
// invoice's /create-invoice: DRAFT (reviewed and sent from Xero), NoTax (not
// VAT registered), today's date, linked contact or by-name fallback.
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
      LineItems: (row.lineItems || []).map(l => ({
        Description: l.description,
        Quantity: +l.quantity || 0,
        UnitAmount: fmt2(+l.unitAmount || 0),
        AccountCode: l.accountCode
      }))
    }]
  };
}

module.exports = {
  ensureInvoiceSchema, INVOICE_TYPES, SYNC_STATES,
  fmtInvoicePct, interimInvoiceMath, interimInvoiceLineItems,
  mapInvoiceRow, billingSoFar, planInterimInvoice, buildInterimXeroInvoice
};
