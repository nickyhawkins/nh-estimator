#!/usr/bin/env node
'use strict';

// ── One-off migration: rebuild the accepted quotes that were never frozen ───
//
// Every job accepted before quote_snapshots shipped has no frozen figures, so
// the app has been re-deriving what those clients agreed to from whatever the
// Rates page said at the moment you looked. Each rate change since acceptance
// has silently moved historical numbers — on invoiced work included. The app
// change stops it happening from now on; this script repairs what already
// happened.
//
// It does NOT try to recompute anything. Recomputing is the bug. The figures
// come from Xero, where the documents the client actually received have been
// sitting unchanged the whole time:
//
//   1. The job's own Xero QUOTE (jobs.data.xeroQuoteId / xeroQuoteNumber).
//      Itemised, exact, and the literal document the client agreed to.
//   2. A match by contact name, reference and date, for jobs whose Xero link
//      was never recorded. Proposed, never applied without --allow-fuzzy.
//   3. Nothing. Left alone, and listed — a job with no Xero quote is one to
//      look at by hand, not to guess at. Run with --explain to see why.
//
// QUOTES ONLY by default. --include-invoices adds the job's Xero invoice as a
// fallback for jobs whose quote isn't in Xero at all; it is off by default
// because an invoice is the BILL — variations and materials-as-used are inside
// it — so reconciling an accepted quote from one silently records a figure the
// client never agreed to.
//
// Snapshots written here are marked 'xero_lines' or 'totals_only' rather than
// 'full', so nothing pretends to be a capture taken at the moment of
// acceptance. 'totals_only' means the agreed money is right and there was no
// line detail to rebuild; the app says so wherever it shows one.
//
// USAGE
//   node scripts/migrate-accepted-snapshots.js              # dry run (default)
//   node scripts/migrate-accepted-snapshots.js --apply      # write snapshots
//   node scripts/migrate-accepted-snapshots.js --apply --allow-fuzzy
//   node scripts/migrate-accepted-snapshots.js --explain    # why didn't X match?
//   node scripts/migrate-accepted-snapshots.js --include-invoices
//   node scripts/migrate-accepted-snapshots.js --file export.json [--apply]
//   node scripts/migrate-accepted-snapshots.js --job <id> --apply
//
// --file takes a Xero export (the JSON body of a Quotes or Invoices API
// response, or an array of either) for running without a live Xero
// connection — an export already on disk is exactly as authoritative as the
// API, and often easier to get hold of.
//
// SAFE TO RE-RUN. A job that already has a snapshot is skipped, always: this
// script has no way to overwrite one (there is no such endpoint and it issues
// no UPDATE), so the worst a second run can do is nothing.

require('dotenv').config();
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const db = require('../db');
const { getAccessToken } = require('../routes/xero');

// Overridable so the paging loop can be exercised against a stub — the one
// part of this script that --file cannot test, and the part that was silently
// dropping every quote past the first hundred.
const XERO_API_URL = process.env.XERO_API_URL || 'https://api.xero.com/api.xro/2.0';

const argv = process.argv.slice(2);
const hasFlag = (f) => argv.includes(f);
const flagValue = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };

const APPLY = hasFlag('--apply');
const ALLOW_FUZZY = hasFlag('--allow-fuzzy');
const ONLY_JOB = flagValue('--job');
const EXPORT_FILE = flagValue('--file');
// QUOTES ONLY unless asked otherwise. An invoice is the BILL -- variations and
// materials-as-used are inside it -- so reconciling an accepted quote from one
// records a number the client never agreed to as though they had. It stays
// available behind a flag for jobs whose quote genuinely doesn't exist in Xero,
// where a caveated invoice figure beats a figure that keeps drifting, but it is
// not something to opt into by accident.
const INCLUDE_INVOICES = hasFlag('--include-invoices');
// Print the near-misses for every job that didn't match. The answer to "but
// it IS in Xero" is always in here: a contact typed differently, a date
// outside the window, or a document that was never loaded at all.
const EXPLAIN = hasFlag('--explain');
// How far apart an acceptance date and a Xero document date may be and still
// be considered the same job, when there's no id to go on. Wide enough for
// "quoted in March, accepted in April", narrow enough that a repeat client's
// next job doesn't get adopted by mistake.
const FUZZY_DAY_WINDOW = +(flagValue('--fuzzy-days') || 120);

const ACCEPTED_STATUSES = ['accepted', 'completed', 'invoiced'];

// ── Xero fetch ──────────────────────────────────────────────────────────────

async function xeroGet(pathname) {
  const accessToken = await getAccessToken();
  const result = await db.query('SELECT xero_tenant_id FROM settings WHERE id = 1');
  const tenantId = result.rows[0] && result.rows[0].xero_tenant_id;
  if (!tenantId) throw new Error('No Xero tenant on the settings row — reconnect Xero first.');
  const resp = await axios.get(`${XERO_API_URL}${pathname}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Xero-Tenant-Id': tenantId,
      Accept: 'application/json'
    }
  });
  return resp.data;
}

// Xero's own /Quotes and /Invoices list responses, or a file holding either.
// Both are normalised to one shape so everything downstream stops caring
// which it came from.
function normaliseDocument(doc, kind) {
  const lineItems = (doc.LineItems || []).map((li) => ({
    description: (li.Description || '').trim(),
    quantity: li.Quantity == null ? 1 : +li.Quantity,
    unitAmount: +li.UnitAmount || 0,
    lineTotal: li.LineAmount == null ? (+li.Quantity || 1) * (+li.UnitAmount || 0) : +li.LineAmount,
    accountCode: li.AccountCode || '',
    itemCode: li.ItemCode || ''
  }));
  return {
    kind,
    id: doc.QuoteID || doc.InvoiceID || null,
    number: doc.QuoteNumber || doc.InvoiceNumber || '',
    status: doc.Status || '',
    reference: doc.Reference || '',
    contactName: (doc.Contact && doc.Contact.Name) || '',
    contactId: (doc.Contact && doc.Contact.ContactID) || null,
    date: xeroDate(doc.DateString || doc.Date),
    total: +doc.Total || 0,
    subTotal: doc.SubTotal == null ? null : +doc.SubTotal,
    totalTax: doc.TotalTax == null ? null : +doc.TotalTax,
    terms: doc.Terms || '',
    lineItems
  };
}

// Xero dates arrive either ISO ("2026-03-04T00:00:00") or as the legacy
// /Date(1234567890000+0000)/ millisecond form, depending on endpoint and
// serialiser. Both, or null.
function xeroDate(v) {
  if (!v) return null;
  const legacy = /\/Date\((\d+)/.exec(String(v));
  if (legacy) return new Date(+legacy[1]).toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

// Xero returns at most 100 records per page and gives no "more pages" flag --
// a short page IS the end marker. Fetching without a `page` parameter silently
// hands back the first 100 and nothing else, which for a full-history sweep
// like this one is the difference between "no matching Xero document" and
// "that quote was never loaded". Anything past the first hundred quotes simply
// did not exist as far as the matcher was concerned.
const XERO_PAGE_SIZE = 100;
async function xeroGetAllPages(pathname, key) {
  const out = [];
  for (let page = 1; ; page++) {
    const sep = pathname.includes('?') ? '&' : '?';
    const data = await xeroGet(`${pathname}${sep}page=${page}`);
    const rows = data[key] || [];
    out.push(...rows);
    if (rows.length < XERO_PAGE_SIZE) break;
    // A hard stop so a paging bug on either side can't spin forever against a
    // rate-limited API. 20,000 documents is far past this business's history.
    if (page >= 200) {
      console.warn(`  ⚠ stopped paging ${key} at page ${page} — check the result looks complete`);
      break;
    }
  }
  return out;
}

async function loadXeroDocuments() {
  if (EXPORT_FILE) {
    const raw = JSON.parse(fs.readFileSync(EXPORT_FILE, 'utf8'));
    const quotes = raw.Quotes || (Array.isArray(raw) ? raw.filter(d => d.QuoteID) : []);
    const invoices = raw.Invoices || (Array.isArray(raw) ? raw.filter(d => d.InvoiceID) : []);
    if (!quotes.length && !invoices.length) {
      throw new Error(`${EXPORT_FILE} holds no Quotes or Invoices — expected a Xero API response body or an array of documents.`);
    }
    return quotes.map(q => normaliseDocument(q, 'quote'))
      .concat(INCLUDE_INVOICES ? invoices.map(i => normaliseDocument(i, 'invoice')) : []);
  }
  // Every quote, not just ACCEPTED: a job may have been accepted in the app
  // and never flipped in Xero, and its SENT quote is still the document the
  // client agreed to.
  const quotes = await xeroGetAllPages('/Quotes', 'Quotes');
  const docs = quotes.map(q => normaliseDocument(q, 'quote'));
  if (INCLUDE_INVOICES) {
    const invoices = await xeroGetAllPages('/Invoices?where=Type=="ACCREC"', 'Invoices');
    docs.push(...invoices.map(i => normaliseDocument(i, 'invoice')));
  }
  return docs;
}

// ── Matching a job to its Xero document ─────────────────────────────────────

// Words that carry no identifying information and differ freely between how a
// client is typed into this app and how they're typed into Xero. Without this,
// "Mrs J Patel" and "J Patel" are simply two different people.
const NOISE_TOKENS = new Set([
  'mr', 'mrs', 'ms', 'miss', 'dr', 'sir', 'madam',
  'ltd', 'limited', 'llp', 'plc', 'inc', 'co', 'company',
  'and', 'the', 'at', 'of'
]);

const tokenise = (v) => String(v || '')
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .split(' ')
  .filter(t => t && !NOISE_TOKENS.has(t));

// How much of the SMALLER name is present in the larger, 0..1. Containment
// rather than equality, because the two sides are the same client typed twice
// by hand months apart: "D & S Hall" vs "D and S Hall", "Patel" vs "Mrs J
// Patel", "Blake Ltd" vs "Blake Limited". Requiring those to be identical
// after normalisation is why real matches were being reported as "no matching
// Xero document" -- the document was right there, spelled slightly differently.
function nameSimilarity(a, b) {
  const A = tokenise(a), B = tokenise(b);
  if (!A.length || !B.length) return 0;
  const [small, large] = A.length <= B.length ? [A, B] : [B, A];
  const largeSet = new Set(large);
  const shared = small.filter(t => largeSet.has(t));
  if (!shared.length) return 0;
  // A single shared token has to be substantial to count -- two unrelated
  // clients both on "Street" or "House" is not evidence of anything.
  if (shared.length === 1 && shared[0].length < 4 && small.length > 1) return 0;
  return shared.length / small.length;
}

function daysBetween(isoA, isoB) {
  if (!isoA || !isoB) return null;
  const a = Date.parse(isoA), b = Date.parse(isoB);
  if (isNaN(a) || isNaN(b)) return null;
  return Math.abs(a - b) / 86400000;
}

// Scores every candidate and returns them ranked, so both the matcher and
// --explain read from the same numbers -- a near-miss report that scored
// differently from the matcher would be worse than none.
function scoreCandidates(job, docs) {
  const d = job.data || {};
  // The client can be recorded as xeroClient, and the Xero side can carry the
  // identifying string as either the contact or the reference -- a job named
  // for its address ("Ermine Street") frequently matches the Xero REFERENCE
  // rather than the contact. Try each of ours against each of theirs and keep
  // the best; a match found on any pairing is still a match.
  const ourNames = [d.xeroClient, job.name].filter(Boolean);
  const ourRefs = [d.xeroRef, job.name].filter(Boolean);
  const acceptedAt = (d.acceptedAt || '').slice(0, 10) || null;
  const best = (ours, theirs) => ours.reduce((m, o) => Math.max(m, nameSimilarity(o, theirs)), 0);

  return docs.map((x) => {
    const nameScore = best(ourNames, x.contactName);
    const refScore = best(ourRefs, x.reference);
    const identity = Math.max(nameScore, refScore * 0.9);
    // Nothing recognisable in common: not a candidate at any date.
    if (identity < 0.5) return null;
    const gap = daysBetween(acceptedAt, x.date);
    // The date is a TIEBREAKER, never a veto. It used to reject outright
    // beyond the window, which threw away perfect name matches on old jobs --
    // including any job with no acceptedAt recorded at all, and any quote
    // written well before the client got round to saying yes. A far-off date
    // now costs a candidate points and earns it a warning, rather than
    // deleting it.
    const dateScore = gap == null ? 0
      : gap <= FUZZY_DAY_WINDOW ? 2 - (gap / FUZZY_DAY_WINDOW) * 2
      : -1;
    const score = identity * 4 + (nameScore > 0 && refScore > 0 ? 1 : 0) + dateScore + (x.kind === 'quote' ? 1 : 0);
    return { doc: x, score, gap, nameScore, refScore, identity };
  }).filter(Boolean).sort((a, b) => b.score - a.score);
}

function matchJob(job, docs) {
  const d = job.data || {};
  // 1. The job recorded which quote it produced. Nothing beats that.
  if (d.xeroQuoteId) {
    const hit = docs.find(x => x.kind === 'quote' && x.id === d.xeroQuoteId);
    if (hit) return { doc: hit, confidence: 'exact', why: 'linked xeroQuoteId' };
  }
  if (d.xeroQuoteNumber) {
    const hit = docs.find(x => x.kind === 'quote' && x.number
      && x.number.trim().toUpperCase() === String(d.xeroQuoteNumber).trim().toUpperCase());
    if (hit) return { doc: hit, confidence: 'exact', why: 'linked quote number ' + d.xeroQuoteNumber };
  }
  // 2. The linked INVOICE, only when explicitly asked for (--include-invoices).
  // It is the bill, not the quote: see the flag's comment.
  if (INCLUDE_INVOICES) {
    if (d.xeroInvoiceId) {
      const hit = docs.find(x => x.kind === 'invoice' && x.id === d.xeroInvoiceId);
      if (hit) return { doc: hit, confidence: 'exact', why: 'linked xeroInvoiceId (invoice, not quote)' };
    }
    if (d.xeroInvoiceNumber) {
      const hit = docs.find(x => x.kind === 'invoice' && x.number
        && x.number.trim().toUpperCase() === String(d.xeroInvoiceNumber).trim().toUpperCase());
      if (hit) return { doc: hit, confidence: 'exact', why: 'linked invoice number ' + d.xeroInvoiceNumber };
    }
  }
  // 3. No usable link. Contact/reference similarity, date as a tiebreaker.
  // Never applied on its own say-so.
  const scored = scoreCandidates(job, docs);
  if (!scored.length) return null;
  const top = scored[0];
  const how = top.nameScore >= top.refScore ? 'contact' : 'reference';
  const exactness = top.identity >= 0.999 ? '' : ` (~${Math.round(top.identity * 100)}% name match)`;
  const dateNote = top.gap == null ? ', no acceptance date to check against'
    : top.gap > FUZZY_DAY_WINDOW ? `, but ${Math.round(top.gap)} days from acceptance — check this is the right job`
    : `, ${Math.round(top.gap)} days from acceptance`;
  // Two candidates that score the same are a coin toss, and a coin toss over
  // what a client agreed to pay is not a migration, it's a guess.
  if (scored.length > 1 && Math.abs(top.score - scored[1].score) < 0.5) {
    return { doc: top.doc, confidence: 'ambiguous', scored, why:
      `${scored.length} similar Xero documents (${scored.slice(0, 3).map(c => c.doc.number || c.doc.id).join(', ')})` };
  }
  return { doc: top.doc, confidence: 'fuzzy', scored, why: `matched on ${how}${exactness}${dateNote}` };
}

// ── Rebuilding a snapshot from a Xero document ──────────────────────────────

// Account codes are the app's own convention on every quote it writes, and
// Nicky's hand-made quotes generally follow it too: 201 labour, 202 materials.
// A line with neither still lands somewhere sensible — the description does
// the work when the code doesn't.
function classifyLine(line) {
  if (line.accountCode === '202') return 'materials';
  if (line.accountCode === '201') return 'work';
  if (/paint|emulsion|primer|undercoat|tin|ltr|litre|material/i.test(line.description)) return 'materials';
  return 'work';
}

function buildSnapshotFromDocument(job, match) {
  const doc = match.doc;
  const d = job.data || {};
  const money = (n) => Math.round((+n || 0) * 100) / 100;
  const real = doc.lineItems.filter(l => l.description || Math.abs(l.lineTotal) > 0.005);
  // Xero documents carry description-only rows as section dividers (the app
  // writes them itself — see routes/xero.js). They're layout, not money.
  const priced = real.filter(l => Math.abs(l.lineTotal) > 0.005);

  const work = [], materials = [];
  priced.forEach((l) => {
    const row = {
      description: l.description || (classifyLine(l) === 'materials' ? 'Materials' : 'Labour'),
      note: '',
      quantity: l.quantity,
      unitPrice: money(l.unitAmount),
      lineTotal: money(l.lineTotal),
      itemCode: l.itemCode || ''
    };
    (classifyLine(l) === 'materials' ? materials : work).push(row);
  });

  const hasLines = priced.length > 0;
  const total = money(doc.total);
  const materialsTotal = money(materials.reduce((s, r) => s + r.lineTotal, 0));
  const labourTotal = money(work.reduce((s, r) => s + r.lineTotal, 0));

  // No line detail: one honest lump. The agreed money is right and the
  // breakdown is genuinely unknown — inventing a plausible split would be
  // worse than saying so, because a plausible split gets believed.
  const fallbackWork = hasLines ? work : [{
    description: 'Agreed total' + (doc.number ? ' — ' + doc.number : ''),
    note: 'reconciled from Xero; no line detail available',
    quantity: 1, unitPrice: total, lineTotal: total
  }];

  const level = hasLines ? 'xero_lines' : 'totals_only';
  const acceptedAt = d.acceptedAt || (doc.date ? doc.date + 'T00:00:00.000Z' : new Date().toISOString());

  return {
    level,
    acceptedAt,
    note: `reconciled from Xero ${doc.kind} ${doc.number || doc.id || ''}`.trim() + ` (${match.why})`,
    payload: {
      schema: 1,
      capturedAt: new Date().toISOString(),
      // Says loudly, in the record itself, that this was rebuilt after the
      // fact and from what.
      source: 'xero-reconciliation',
      reconciliation: {
        documentKind: doc.kind,
        documentNumber: doc.number || null,
        documentId: doc.id || null,
        documentDate: doc.date,
        documentStatus: doc.status,
        confidence: match.confidence,
        matchedBy: match.why,
        hasLineDetail: hasLines,
        // An invoice is the bill, not the quote: variations and
        // materials-as-used are inside this figure. Said explicitly so nobody
        // later reads it as the accepted quote and wonders why it's high.
        caveat: doc.kind === 'invoice'
          ? 'Rebuilt from the INVOICE. It may include variations and materials as used, so it can exceed the quote that was accepted.'
          : (hasLines ? null : 'No line detail in the Xero export — the total is exact, the breakdown is not available.')
      },
      job: {
        id: job.id, name: job.name || '',
        client: d.xeroClient || doc.contactName || '', reference: d.xeroRef || doc.reference || '',
        contact: d.contact || null,
        xeroQuoteId: d.xeroQuoteId || (doc.kind === 'quote' ? doc.id : null) || null,
        xeroQuoteNumber: d.xeroQuoteNumber || (doc.kind === 'quote' ? doc.number : null) || null
      },
      // The client-facing model, in exactly the shape buildClientQuoteHtml()
      // and buildClientQuotePdf() render — so a reconciled quote opens and
      // prints like any other rather than needing its own renderer.
      quote: {
        clientName: d.xeroClient || doc.contactName || '',
        address: [(d.contact || {}).street, (d.contact || {}).town, (d.contact || {}).postcode].filter(Boolean).join(', '),
        jobName: job.name || '',
        today: doc.date || acceptedAt.slice(0, 10),
        work: fallbackWork.length ? {
          rows: fallbackWork.map(r => ({ emoji: '', label: r.description, sub: r.note || '', amount: r.lineTotal })),
          subtotalLabel: 'Labour subtotal', subtotal: hasLines ? labourTotal : total
        } : null,
        imported: null,
        variations: null,
        materials: materials.length ? {
          rows: materials.map(r => ({ emoji: '', label: r.description,
                                      sub: r.quantity !== 1 ? r.quantity + ' × £' + r.unitPrice.toFixed(2) : '',
                                      amount: r.lineTotal })),
          subtotalLabel: 'Materials subtotal', subtotal: materialsTotal,
          note: 'Materials are estimated here and billed as actually used.'
        } : null,
        colours: [],
        payment: null,
        total: total,
        totalInclVariations: null,
        terms: doc.terms || ''
      },
      lines: { work: fallbackWork, imported: [], materials },
      materials: { lines: materials, trackingOnly: [], working: [], total: materialsTotal },
      // Deliberately mostly null. These are the fields a live capture fills
      // from the calc, and this snapshot has no calc behind it — writing
      // plausible numbers here would be exactly the fabrication the whole
      // feature exists to stop. dayRate is the ONE exception worth recording,
      // as the rate in force today, clearly labelled as such.
      labour: {
        mode: 'reconciled-from-xero',
        dayRate: null, hoursPerDay: null,
        calculatedDays: null, diaryDays: null,
        onSiteDays: (d.acceptedSnapshot && +d.acceptedSnapshot.estOnSiteDays) || null,
        rawLabour: null, sundries: null,
        labourTotal: hasLines ? labourTotal : total,
        honouredAmount: null
      },
      markup: { type: null, value: null, effectivePct: null,
                commercial: !!d.commercial, commercialPct: null, standalone: !!d.standalone },
      totals: {
        labour: hasLines ? labourTotal : total,
        materials: materialsTotal,
        importedBaseline: 0,
        // Not VAT registered — every document this app writes goes out NoTax.
        // The Xero figures are read straight across rather than being split.
        vatRegistered: (doc.totalTax || 0) > 0.005,
        vatRate: 0,
        exVat: doc.subTotal != null ? money(doc.subTotal) : total,
        vat: money(doc.totalTax || 0),
        incVat: total,
        deposit: null, depositBasis: null, balance: null
      },
      // No rates block: the rates that produced these figures are not
      // recoverable, and an empty object would read as "priced at zero".
      rates: null
    }
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function ensureSnapshotTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS quote_snapshots (
      id VARCHAR PRIMARY KEY,
      job_id VARCHAR NOT NULL,
      version INTEGER NOT NULL,
      accepted_at TIMESTAMP NOT NULL DEFAULT NOW(),
      reconciliation_level VARCHAR NOT NULL DEFAULT 'full',
      note VARCHAR NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS quote_snapshots_job_version ON quote_snapshots (job_id, version)`);
  await db.query(`CREATE INDEX IF NOT EXISTS quote_snapshots_job ON quote_snapshots (job_id)`);
}

const gbp = (n) => n == null ? '—' : '£' + (+n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

async function main() {
  console.log('\nAccepted-quote reconciliation' + (APPLY ? '' : '  (DRY RUN — nothing will be written)'));
  console.log('─'.repeat(72));

  await ensureSnapshotTable();

  const jobsResult = await db.query('SELECT id, name, data FROM jobs ORDER BY updated_at DESC');
  const existing = await db.query('SELECT DISTINCT job_id FROM quote_snapshots');
  const haveSnapshot = new Set(existing.rows.map(r => r.job_id));

  const candidates = jobsResult.rows.filter((j) => {
    const d = j.data || {};
    if (ONLY_JOB && j.id !== ONLY_JOB) return false;
    if (!ACCEPTED_STATUSES.includes(d.status)) return false;
    // Already frozen. Never touched — this script cannot overwrite a snapshot
    // and does not try to.
    if (haveSnapshot.has(j.id)) return false;
    return true;
  });

  const alreadyFrozen = jobsResult.rows.filter(j => ACCEPTED_STATUSES.includes((j.data || {}).status) && haveSnapshot.has(j.id)).length;
  console.log(`${jobsResult.rows.length} jobs · ${alreadyFrozen} accepted and already frozen · ${candidates.length} accepted and unfrozen\n`);

  if (!candidates.length) {
    console.log('Nothing to reconcile — every accepted quote already has frozen figures.\n');
    return;
  }

  let docs;
  try {
    docs = await loadXeroDocuments();
  } catch (err) {
    console.error('Could not load the Xero figures: ' + err.message);
    console.error('\nEither connect Xero (the app’s Settings → Xero) or pass an export with --file.\n');
    process.exitCode = 1;
    return;
  }
  const quoteCount = docs.filter(x => x.kind === 'quote').length;
  const invoiceCount = docs.filter(x => x.kind === 'invoice').length;
  console.log(`${quoteCount} Xero quotes loaded`
    + (INCLUDE_INVOICES ? ` · ${invoiceCount} invoices (--include-invoices)` : ' · invoices not searched (--include-invoices to add them)'));
  // The count is worth reading. Xero pages at 100, and a total that lands
  // exactly on a multiple of 100 is the shape a truncated fetch has.
  if (quoteCount === 0) console.log('  ⚠ no quotes came back at all — is this the right Xero organisation?');
  console.log('');

  const done = [], skipped = [], needsReview = [];

  for (const job of candidates) {
    const d = job.data || {};
    const match = matchJob(job, docs);
    if (!match) {
      // The figure the app has been showing, for the by-hand list — so a job
      // with no Xero record at least says what number is currently in play.
      // near: the best candidates the matcher DID consider, so --explain can
      // say why none of them won rather than leaving "not in Xero" as the only
      // available conclusion — which, when the document plainly is in Xero,
      // is the wrong one.
      skipped.push({ job, reason: 'no matching Xero quote',
                     showing: d.acceptedSnapshot ? +d.acceptedSnapshot.estQuoteTotal || null : null,
                     near: scoreCandidates(job, docs).slice(0, 3),
                     hasLink: !!(d.xeroQuoteId || d.xeroQuoteNumber) });
      continue;
    }
    if ((match.confidence === 'fuzzy' || match.confidence === 'ambiguous') && !ALLOW_FUZZY) {
      needsReview.push({ job, match });
      continue;
    }
    const built = buildSnapshotFromDocument(job, match);
    if (APPLY) {
      try {
        await db.query(
          // $2 casts because it is both an inserted value and a WHERE
          // predicate, which Postgres refuses to infer a single type for.
          `INSERT INTO quote_snapshots (id, job_id, version, accepted_at, reconciliation_level, note, data)
           SELECT $1, $2::varchar, COALESCE(MAX(version), 0) + 1, $3::timestamptz, $4, $5, $6
             FROM quote_snapshots WHERE job_id = $2::varchar`,
          [crypto.randomUUID(), job.id, built.acceptedAt, built.level, built.note, built.payload]
        );
        // The lock the spec asks for, and it is entirely the snapshot's
        // existence: with a row here the app reads the agreed figures and
        // never the live calc, so a future rate change cannot reach this job.
        // The status is left exactly as it is — these jobs are already
        // accepted/completed/invoiced, and rewriting a lifecycle field to
        // "lock" something that is already locked would only risk moving a
        // job backwards in the pipeline.
        done.push({ job, built, match });
      } catch (err) {
        skipped.push({ job, reason: 'write failed: ' + err.message, showing: null });
      }
    } else {
      done.push({ job, built, match });
    }
  }

  const line = (j, amount, tail) =>
    `  ${(j.name || j.id).slice(0, 34).padEnd(34)} ${gbp(amount).padStart(12)}   ${tail}`;

  if (done.length) {
    console.log((APPLY ? 'RECONCILED' : 'WOULD RECONCILE') + ` — ${done.length} job${done.length === 1 ? '' : 's'}`);
    done.forEach(({ job, built, match }) => {
      const was = (job.data || {}).acceptedSnapshot ? +(job.data.acceptedSnapshot.estQuoteTotal) || null : null;
      const now = built.payload.totals.incVat;
      const drift = was != null && Math.abs(now - was) > 0.005
        ? `  (app was showing ${gbp(was)} — out by ${gbp(Math.abs(now - was))})` : '';
      console.log(line(job, now, `${built.level}  ·  ${match.why}${drift}`));
      if (built.payload.reconciliation.caveat) console.log(`  ${' '.repeat(34)} ${' '.repeat(12)}   ⚠ ${built.payload.reconciliation.caveat}`);
    });
    console.log('');
  }

  if (needsReview.length) {
    console.log(`NEEDS A HUMAN — ${needsReview.length} job${needsReview.length === 1 ? '' : 's'} matched only by contact/date`);
    needsReview.forEach(({ job, match }) => {
      console.log(line(job, match.doc.total, `${match.doc.kind} ${match.doc.number || match.doc.id} · ${match.why}`));
    });
    console.log('  Check these are the right documents, then re-run with --allow-fuzzy.\n');
  }

  if (skipped.length) {
    console.log(`NO XERO QUOTE — ${skipped.length} job${skipped.length === 1 ? '' : 's'} left alone`);
    skipped.forEach(({ job, reason, showing, near, hasLink }) => {
      console.log(line(job, showing, reason + (showing != null ? ' · that figure is still live and will keep drifting' : '')));
      // A job that HAS a recorded quote id/number and still didn't match is a
      // different problem from one that never had a link: its quote has been
      // deleted or voided in Xero, or belongs to another organisation. Worth
      // saying, because it is the case most likely to read as "but it's right
      // there" when it isn't the same document any more.
      if (hasLink) {
        const d = job.data || {};
        console.log(`  ${' '.repeat(34)} ${' '.repeat(12)}   ↳ this job is linked to ${d.xeroQuoteNumber || d.xeroQuoteId}, which was not in the Xero data — deleted, voided, or a different Xero organisation`);
      }
      if (EXPLAIN) {
        if (!near || !near.length) {
          console.log(`  ${' '.repeat(34)} ${' '.repeat(12)}   ↳ nothing in Xero shares a name or reference with "${(job.data || {}).xeroClient || job.name}"`);
        } else {
          near.forEach((c) => {
            console.log(`  ${' '.repeat(34)} ${' '.repeat(12)}   ↳ closest: ${c.doc.kind} ${c.doc.number || c.doc.id} "${c.doc.contactName}"`
              + ` ${gbp(c.doc.total)} · name ${Math.round(c.nameScore * 100)}% · ref ${Math.round(c.refScore * 100)}%`
              + (c.gap == null ? ' · no acceptance date' : ` · ${Math.round(c.gap)} days apart`));
          });
        }
      }
    });
    if (!EXPLAIN) console.log('  Re-run with --explain to see the closest Xero documents and why each was rejected.');
    console.log('  These need the agreed figure entering by hand, or accepting that they stay live.\n');
  }

  console.log('─'.repeat(72));
  if (!APPLY) {
    console.log('Dry run. Re-run with --apply to write these snapshots.\n');
  } else {
    console.log(`${done.length} accepted quote${done.length === 1 ? '' : 's'} frozen. Rate changes can no longer move them.\n`);
  }
}

main()
  .catch((err) => { console.error('\nMigration failed:', err.message); process.exitCode = 1; })
  .finally(() => db.pool.end());
