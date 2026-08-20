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
// IMPORTED JOBS ARE SKIPPED. A job created by importAcceptedQuote() already
// holds its agreed total as a stored figure that no calc touches, so it never
// drifted; and if it was amended here afterwards, the Xero quote covers only
// the original part of what was agreed. --include-imported overrides.
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
//   node scripts/migrate-accepted-snapshots.js --pick <jobId>=QU-0287 --apply
//
// NB npm swallows flags: `npm run migrate:accepted-snapshots -- --apply`, with
// the bare `--`, or the flag never reaches this script and the run silently
// does something other than what was typed.
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
// Jobs created by importAcceptedQuote() are skipped by default -- see
// classifyImported() for why. --include-imported reconciles them anyway.
const INCLUDE_IMPORTED = hasFlag('--include-imported');
// Print the near-misses for every job that didn't match. The answer to "but
// it IS in Xero" is always in here: a contact typed differently, a date
// outside the window, or a document that was never loaded at all.
const EXPLAIN = hasFlag('--explain');
// --pick <jobId>=<quoteNumber>, repeatable. Settles an ambiguous job by naming
// its quote outright, which beats switching --allow-fuzzy on for the whole run
// and trusting that the top-scoring candidate happened to be the right one.
const PICKS = new Map();
argv.forEach((a, i) => {
  if (a !== '--pick') return;
  const [jobId, ref] = String(argv[i + 1] || '').split('=');
  if (jobId && ref) PICKS.set(jobId, ref.trim());
});
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

// ── Jobs imported from Xero ─────────────────────────────────────────────────
// importAcceptedQuote() creates a job from an already-accepted Xero quote and
// stamps the agreed total onto acceptedSnapshot.estQuoteTotal. That figure is a
// STORED CONSTANT -- Summary renders it directly (importedJobSummaryHtml), no
// calc function is involved -- so these jobs were never drifting, which is the
// entire problem this migration exists to repair. Reconciling them achieves
// nothing at best.
//
// At worst it destroys information. Once such a job is AMENDED here -- rooms
// added to work that was originally agreed in Xero -- the app prices it as the
// frozen imported baseline PLUS the added scope. The Xero quote is then only
// part of the agreed money, and writing it as the whole snapshot would silently
// drop everything agreed since.
//
// So they are skipped and listed, not silently swallowed: the amended ones need
// a snapshot taken in the app (open the job, Amend), which is the only place
// that can see both halves.
function classifyImported(job, scopeCounts) {
  const d = job.data || {};
  const snap = d.acceptedSnapshot || {};
  if (!snap.importedFromXero) {
    // The other Xero-shaped job: measured normally, but with labour honoured at
    // a price agreed in a pre-app quote. Its agreed total is that honoured
    // figure plus materials as measured, which no Xero quote states -- so a
    // Xero quote total is the wrong number for it too.
    if (d.isXeroImported && d.honouredLabourAmount != null) {
      return { imported: true, kind: 'honoured',
               note: `labour honoured at ${gbp(+d.honouredLabourAmount)} — its agreed total is that plus materials as measured, which no single Xero quote states` };
    }
    return null;
  }
  const scope = scopeCounts.get(job.id) || 0;
  const hasOwnScope = scope > 0
    || (Array.isArray(d.customItems) && d.customItems.length > 0)
    || (d.kitchen && Object.keys(d.kitchen).length > 0)
    || (Array.isArray(d.fittedUnits) && d.fittedUnits.length > 0);
  return hasOwnScope
    ? { imported: true, kind: 'amended',
        note: 'imported, then amended here — the Xero quote is only the original part of what was agreed' }
    : { imported: true, kind: 'pure',
        note: 'imported total is already a stored figure and does not drift' };
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

// Split in two on purpose. Every exact link in the whole run is resolved
// BEFORE any fuzzy guess is allowed to claim a document -- see the two passes
// in main(). Without that ordering, a job processed early can take, on a name
// match, the very quote that a job processed later is explicitly linked to,
// and the same agreed figures get written onto two different jobs. That
// happened on the first real run: two "Beryl Parsons" jobs both landed on
// £1,210.33, one by link and one by contact name.
function matchExactLink(job, docs) {
  const d = job.data || {};
  // The job recorded which quote it produced. Nothing beats that.
  if (d.xeroQuoteId) {
    const hit = docs.find(x => x.kind === 'quote' && x.id === d.xeroQuoteId);
    if (hit) return { doc: hit, confidence: 'exact', why: 'linked xeroQuoteId' };
  }
  if (d.xeroQuoteNumber) {
    const hit = docs.find(x => x.kind === 'quote' && x.number
      && x.number.trim().toUpperCase() === String(d.xeroQuoteNumber).trim().toUpperCase());
    if (hit) return { doc: hit, confidence: 'exact', why: 'linked quote number ' + d.xeroQuoteNumber };
  }
  // The linked INVOICE, only when explicitly asked for (--include-invoices).
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
  return null;
}

// No usable link. Contact/reference similarity, date as a tiebreaker. Never
// applied on its own say-so. `docs` here has already had every exactly-linked
// document removed by main(), so a guess can never steal another job's quote.
function matchFuzzy(job, docs) {
  const scored = scoreCandidates(job, docs);
  if (!scored.length) return null;
  const top = scored[0];
  const how = top.nameScore >= top.refScore ? 'contact' : 'reference';
  const exactness = top.identity >= 0.999 ? '' : ` (~${Math.round(top.identity * 100)}% name match)`;
  const dateNote = top.gap == null ? ', no acceptance date to check against'
    : top.gap > FUZZY_DAY_WINDOW ? `, but ${Math.round(top.gap)} days from acceptance — check this is the right job`
    : `, ${Math.round(top.gap)} day${Math.round(top.gap) === 1 ? '' : 's'} from acceptance`;
  // Two candidates that score the same are a coin toss, and a coin toss over
  // what a client agreed to pay is not a migration, it's a guess.
  // Only the candidates actually TIED with the leader make this ambiguous.
  // Counting every scored candidate reported "26 similar Xero documents" for a
  // repeat client with 26 quotes on file, which overstates the problem and,
  // worse, gives nothing to choose between: the three ids it printed weren't
  // necessarily the three that were close.
  const tied = scored.filter(c => Math.abs(top.score - c.score) < 0.5);
  if (tied.length > 1) {
    return { doc: top.doc, confidence: 'ambiguous', scored, tied, why:
      `${tied.length} equally good matches — ` + tied.slice(0, 4).map(c =>
        `${c.doc.number || c.doc.id} ${gbp(c.doc.total)}${c.doc.date ? ' ' + c.doc.date : ''}`).join('  |  ') };
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
    note: (match.correcting ? 'CORRECTION — ' : '')
      + `reconciled from Xero ${doc.kind} ${doc.number || doc.id || ''}`.trim() + ` (${match.why})`,
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
    // Already frozen. Skipped — EXCEPT when explicitly --picked, which is how
    // a wrong reconciliation gets corrected. Earlier runs let --allow-fuzzy
    // settle ambiguous matches, so some jobs were frozen against the wrong
    // quote of several; naming the right one appends a CORRECTIVE REVISION.
    // The bad revision is not deleted or edited (it cannot be) — it stays in
    // the history where an audit can see what happened, and the app reads the
    // latest revision, which is now the right one.
    if (haveSnapshot.has(j.id)) {
      return PICKS.has(j.id) || PICKS.has(j.name)
        || [...PICKS.keys()].some(k => k.toLowerCase() === String(j.name || '').toLowerCase());
    }
    return true;
  });

  const alreadyFrozen = jobsResult.rows.filter(j => ACCEPTED_STATUSES.includes((j.data || {}).status) && haveSnapshot.has(j.id)).length;
  console.log(`${jobsResult.rows.length} jobs · ${alreadyFrozen} accepted and already frozen · ${candidates.length} accepted and unfrozen\n`);

  // ── Headline repair ──────────────────────────────────────────────────────
  // acceptedSnapshot.estQuoteTotal is a DERIVED CACHE of the current revision,
  // read by Home, the Jobs list and the attention strip because those render
  // jobs whose snapshots aren't loaded. Earlier runs of this script wrote
  // quote_snapshots without updating it, so a reconciled job showed the new
  // figure on Summary and the old one on Home. Bringing the cache back in line
  // with its source is not a mutation of the record: the snapshot itself is
  // never touched, and nothing here can change what was agreed.
  const stale = [];
  {
    const latest = await db.query(
      `SELECT DISTINCT ON (job_id) job_id, version, data
         FROM quote_snapshots ORDER BY job_id, version DESC`);
    const byJob = new Map(jobsResult.rows.map(j => [j.id, j]));
    for (const row of latest.rows) {
      const job = byJob.get(row.job_id);
      if (!job) continue;
      const totals = (row.data && row.data.totals) || {};
      if (totals.incVat == null) continue;
      const cached = (job.data || {}).acceptedSnapshot || {};
      if (cached.estQuoteTotal != null && Math.abs(+cached.estQuoteTotal - +totals.incVat) <= 0.005) continue;
      stale.push({ job, was: cached.estQuoteTotal == null ? null : +cached.estQuoteTotal, now: +totals.incVat, version: row.version });
      if (!APPLY) continue;
      const headline = { estQuoteTotal: totals.incVat, estLabourTotal: totals.labour, estMaterialsTotal: totals.materials };
      const lab = (row.data && row.data.labour) || {};
      if (lab.onSiteDays != null) headline.estOnSiteDays = lab.onSiteDays;
      await db.query(
        `UPDATE jobs SET data = jsonb_set(
           COALESCE(data, '{}'::jsonb), '{acceptedSnapshot}',
           COALESCE(data->'acceptedSnapshot', '{}'::jsonb) || $2::jsonb, true
         ), updated_at = NOW() WHERE id = $1`,
        [job.id, JSON.stringify(headline)]);
    }
  }
  if (stale.length) {
    console.log(`${APPLY ? 'REPAIRED' : 'WOULD REPAIR'} — ${stale.length} job${stale.length === 1 ? '' : 's'} showing a different total on Home than on Summary`);
    stale.forEach(({ job, was, now, version }) => {
      console.log(`  ${(job.name || job.id).slice(0, 34).padEnd(34)} ${gbp(now).padStart(12)}   Home was showing ${gbp(was)} · revision ${version} is the agreed figure`);
    });
    console.log('  The snapshots themselves are untouched — only the cached figure the job list reads.\n');
  }

  if (!candidates.length && !stale.length) {
    console.log('Nothing to reconcile — every accepted quote already has frozen figures.\n');
    return;
  }
  if (!candidates.length) {
    console.log(!APPLY ? 'Nothing left to reconcile. Re-run with --apply to write the repairs above.\n'
                       : 'Nothing left to reconcile.\n');
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

  // Does each job have measured scope of its own? Needed to tell an untouched
  // import from one that has been amended here since.
  const scopeCounts = new Map();
  for (const t of ['rooms', 'exterior_items']) {
    const r = await db.query(`SELECT job_id, count(*)::int AS n FROM ${t} GROUP BY job_id`);
    r.rows.forEach(row => scopeCounts.set(row.job_id, (scopeCounts.get(row.job_id) || 0) + row.n));
  }

  const done = [], skipped = [], needsReview = [], imported = [];

  // ── Pass 1: every exact link in the run, before any guess ────────────────
  // One Xero quote can only ever belong to one job. Resolving all the explicit
  // links first, and taking those documents out of the pool, is what stops a
  // name-based guess claiming a quote that another job is linked to by id.
  const matches = new Map();
  const claimed = new Map(); // doc id -> the job that holds it
  // Imported jobs come out of the run before anything is matched, so they can't
  // claim a Xero quote that a normally-measured job needs.
  const workable = [];
  for (const job of candidates) {
    const imp = classifyImported(job, scopeCounts);
    if (imp && !INCLUDE_IMPORTED) { imported.push({ job, ...imp }); continue; }
    workable.push(job);
  }

  for (const job of workable) {
    const m = matchExactLink(job, docs);
    if (!m) continue;
    matches.set(job.id, m);
    if (m.doc.id) claimed.set(m.doc.id, job);
  }

  // ── Pass 2: fuzzy, over what's left ──────────────────────────────────────
  // --pick jobId=QU-0287 forces one job onto one quote, which is how an
  // ambiguous case gets settled: name it explicitly rather than turning
  // --allow-fuzzy on for the whole run and hoping the leader was right.
  for (const job of candidates) {
    if (matches.has(job.id)) continue;
    // Accept the job's NAME as well as its id -- the report is full of names and
    // the ids never appear on screen unless something needs deciding, so
    // requiring an id would mean going and looking one up to answer a question
    // the tool just asked you.
    const forced = PICKS.get(job.id)
      || PICKS.get(job.name)
      || [...PICKS.entries()].find(([k]) => k.toLowerCase() === String(job.name || '').toLowerCase())?.[1];
    if (forced) {
      const hit = docs.find(x => (x.number || '').trim().toUpperCase() === forced.toUpperCase() || x.id === forced);
      if (!hit) {
        skipped.push({ job, reason: `--pick ${forced} matched no Xero document`, showing: null, near: [], hasLink: false });
        continue;
      }
      const owner = claimed.get(hit.id);
      if (owner && owner.id !== job.id) {
        skipped.push({ job, reason: `--pick ${forced} is already linked to "${owner.name}"`, showing: null, near: [], hasLink: false });
        continue;
      }
      const correcting = haveSnapshot.has(job.id);
      matches.set(job.id, { doc: hit, confidence: 'exact', correcting,
        why: `picked by hand (--pick ${forced})${correcting ? ' — CORRECTS the revision already stored' : ''}` });
      if (hit.id) claimed.set(hit.id, job);
      continue;
    }
    const available = docs.filter(x => !x.id || !claimed.has(x.id));
    const m = matchFuzzy(job, available);
    if (!m) continue;
    matches.set(job.id, m);
    // A fuzzy match claims its document too, so two same-named jobs can't both
    // land on it. Greedy in job order -- good enough, because anything this
    // reaches is going in front of a human anyway.
    if (m.doc.id) claimed.set(m.doc.id, job);
  }

  for (const job of workable) {
    const d = job.data || {};
    const match = matches.get(job.id) || null;
    if (!match) {
      // The figure the app has been showing, for the by-hand list — so a job
      // with no Xero record at least says what number is currently in play.
      // near: the best candidates the matcher DID consider, so --explain can
      // say why none of them won rather than leaving "not in Xero" as the only
      // available conclusion — which, when the document plainly is in Xero,
      // is the wrong one.
      skipped.push({ job, reason: 'no matching Xero quote',
                     showing: d.acceptedSnapshot ? +d.acceptedSnapshot.estQuoteTotal || null : null,
                     near: scoreCandidates(job, docs.filter(x => !x.id || !claimed.has(x.id))).slice(0, 3),
                     hasLink: !!(d.xeroQuoteId || d.xeroQuoteNumber) });
      continue;
    }
    // --allow-fuzzy accepts a CONFIDENT guess. It must never resolve an
    // AMBIGUITY: "several equally good candidates and I can't tell them apart"
    // is not something a blanket flag gets to decide, because the thing being
    // decided is what a client agreed to pay. Those need --pick, always.
    //
    // A match whose date sits outside the window is the same kind of problem
    // wearing a different hat -- it was the only candidate, but the only
    // candidate can still be the wrong one. On the first real run this path
    // proposed a 2020 quote for a 2026 job.
    const wildDate = match.confidence === 'fuzzy' && match.scored && match.scored[0]
      && match.scored[0].gap != null && match.scored[0].gap > FUZZY_DAY_WINDOW;
    if (match.confidence === 'ambiguous' || wildDate) {
      needsReview.push({ job, match, hard: true,
        why: match.confidence === 'ambiguous'
          ? 'several equally good candidates — say which one'
          : `nearest quote is ${Math.round(match.scored[0].gap)} days from acceptance` });
      continue;
    }
    if (match.confidence === 'fuzzy' && !ALLOW_FUZZY) {
      needsReview.push({ job, match, hard: false, why: 'matched by name, not by a recorded link' });
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
        // Bring the job's acceptedSnapshot HEADLINE into step with the
        // revision just written. This is not optional bookkeeping: Home, the
        // Jobs list and the attention strip all read
        // acceptedSnapshot.estQuoteTotal directly, because they render jobs
        // whose snapshots aren't loaded. Writing quote_snapshots without
        // updating it leaves Summary showing the reconciled figure and Home
        // showing the old one for the same job -- which is exactly what
        // happened on the first real run.
        //
        // captureQuoteSnapshot() already does this for acceptances made in the
        // app; the migration simply wasn't doing its half.
        //
        // Merged, never replaced, and only for keys this snapshot actually
        // knows: importedFromXero, hand-edited figures and the day estimates a
        // Xero quote can't supply all live on the same object and must survive.
        const headline = {
          estQuoteTotal: built.payload.totals.incVat,
          estLabourTotal: built.payload.totals.labour,
          estMaterialsTotal: built.payload.totals.materials
        };
        if (built.payload.labour && built.payload.labour.onSiteDays != null) {
          headline.estOnSiteDays = built.payload.labour.onSiteDays;
        }
        await db.query(
          `UPDATE jobs SET data = jsonb_set(
             COALESCE(data, '{}'::jsonb), '{acceptedSnapshot}',
             COALESCE(data->'acceptedSnapshot', '{}'::jsonb) || $2::jsonb, true
           ), updated_at = NOW() WHERE id = $1`,
          [job.id, JSON.stringify(headline)]
        );
        // The lock the spec asks for, and it is entirely the snapshot's
        // existence: with a row here the app reads the agreed figures and
        // never the live calc, so a future rate change cannot reach this job.
        // The STATUS is left exactly as it is — these jobs are already
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
      // acceptedSnapshot.estQuoteTotal is the ACCEPTANCE STAMP -- the figure
      // the app froze onto the job when it was marked accepted. It is NOT
      // "what the app is showing", which is the live recalculation this script
      // deliberately never runs, and the earlier wording said otherwise.
      // The distinction matters: a gap here is the app's own record and the
      // Xero document disagreeing about this job (quote amended in Xero after
      // acceptance, or the job edited in the app between sending and
      // accepting), not a measure of how far rates have drifted.
      const stamp = (job.data || {}).acceptedSnapshot ? +(job.data.acceptedSnapshot.estQuoteTotal) || null : null;
      const now = built.payload.totals.incVat;
      const delta = stamp == null ? null : now - stamp;
      // A penny or two is this script summing rounded Xero lines where the app
      // rounded a float once. It is not a discrepancy and must not be shouted
      // about alongside ones that are.
      const note = delta == null || Math.abs(delta) <= 0.05 ? ''
        : `  ⚠ acceptance stamp said ${gbp(stamp)} — differs by ${gbp(Math.abs(delta))}`;
      console.log(line(job, now, `${built.level}  ·  ${match.why}${note}`));
      if (built.payload.reconciliation.caveat) console.log(`  ${' '.repeat(34)} ${' '.repeat(12)}   ⚠ ${built.payload.reconciliation.caveat}`);
    });
    const big = done.filter(({ job, built }) => {
      const stamp = (job.data || {}).acceptedSnapshot ? +(job.data.acceptedSnapshot.estQuoteTotal) || null : null;
      return stamp != null && Math.abs(built.payload.totals.incVat - stamp) > 0.05;
    });
    if (big.length) {
      console.log(`\n  ${big.length} job${big.length === 1 ? '' : 's'} above ${big.length === 1 ? 'disagrees' : 'disagree'} with the app's own acceptance stamp by more than a rounding penny.`);
      console.log('  The Xero quote is the document the client actually received, so it wins — but these are');
      console.log('  worth eyeballing before --apply, since a large gap usually means the quote was amended in');
      console.log('  Xero after acceptance, or the job was edited here between sending the quote and accepting it.');
    }
    console.log('');
  }

  // Two different asks, so two different sections. Lumping them together was
  // most of why this report was hard to act on: "confirm this name match looks
  // right" and "choose between five quotes" need different answers, and the
  // one command offered (--allow-fuzzy) only ever addressed the first.
  const softReview = needsReview.filter(r => !r.hard);
  const hardReview = needsReview.filter(r => r.hard);

  if (softReview.length) {
    console.log(`MATCHED BY NAME — ${softReview.length} job${softReview.length === 1 ? '' : 's'}, no recorded link but only one plausible quote`);
    softReview.forEach(({ job, match }) => {
      console.log(line(job, match.doc.total, `${match.doc.number || match.doc.id} · ${match.why}`));
    });
    console.log('  If those look right, add --allow-fuzzy to accept them.\n');
  }

  if (hardReview.length) {
    console.log(`NEEDS YOUR DECISION — ${hardReview.length} job${hardReview.length === 1 ? '' : 's'}; --allow-fuzzy will NOT settle these`);
    hardReview.forEach(({ job, match, why }) => {
      console.log(line(job, null, why));
      const opts = (match.tied && match.tied.length ? match.tied : (match.scored || []).slice(0, 4));
      opts.slice(0, 5).forEach((c) => {
        console.log(`  ${' '.repeat(34)} ${' '.repeat(12)}   ${(c.doc.number || c.doc.id).padEnd(10)} ${gbp(c.doc.total).padStart(11)}  ${c.doc.date || ''}  ${c.doc.contactName}`);
      });
      console.log(`  ${' '.repeat(34)} ${' '.repeat(12)}   → --pick "${job.name}"=QU-XXXX`);
    });
    console.log('');
  }

  if (imported.length) {
    const amended = imported.filter(i => i.kind !== 'pure');
    console.log(`IMPORTED FROM XERO — ${imported.length} job${imported.length === 1 ? '' : 's'} skipped, deliberately`);
    imported.forEach(({ job, note }) => {
      const stamp = (job.data || {}).acceptedSnapshot ? +(job.data.acceptedSnapshot.estQuoteTotal) || null : null;
      console.log(line(job, stamp, note));
    });
    console.log('  These already hold their agreed total as a stored figure, so no rate change can move it —');
    console.log('  reconciling them from Xero would gain nothing.');
    if (amended.length) {
      // Two different reasons to land here, and only one of them is "amended":
      // a honoured-labour job was never amended, its agreed total simply isn't
      // any single Xero figure. The advice is the same for both, the wording
      // shouldn't claim otherwise.
      console.log(`  ${amended.length} of them ${amended.length === 1 ? 'holds' : 'hold'} agreed money that no Xero quote states in full.`);
      console.log('  Those need a snapshot taken in the app — open the job and use Amend, which is the only');
      console.log('  place that can see every part of what was agreed at once.');
    }
    console.log('  --include-imported reconciles them from Xero anyway, overwriting what is already there.\n');
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

  // ── What to do next ─────────────────────────────────────────────────────
  // The report used to end on a bare "re-run with --apply", which left every
  // other section as an unanswered question. Each step below is a command that
  // can be pasted, in the order it should be run.
  console.log('─'.repeat(72));
  const cmd = 'npm run migrate:accepted-snapshots --';
  const carry = [
    ALLOW_FUZZY ? '--allow-fuzzy' : '',
    INCLUDE_INVOICES ? '--include-invoices' : '',
    ...[...PICKS.entries()].map(([k, v]) => `--pick "${k}"=${v}`)
  ].filter(Boolean).join(' ');

  if (APPLY) {
    console.log(`${done.length} accepted quote${done.length === 1 ? '' : 's'} frozen. Rate changes can no longer move them.`);
    if (hardReview.length || softReview.length || skipped.length) {
      console.log(`Still outstanding: ${hardReview.length} needing a decision, ${softReview.length} name-matched, ${skipped.length} with no Xero quote.`);
    }
    console.log('');
    return;
  }

  console.log('WHAT TO DO NEXT\n');
  let step = 1;
  if (done.length) {
    console.log(`  ${step++}. ${done.length} job${done.length === 1 ? ' is' : 's are'} ready. Nothing else is needed for these — write them:`);
    console.log('        ' + [cmd, carry, '--apply'].filter(Boolean).join(' '));
    console.log('     Re-running later is safe: anything already frozen is skipped.\n');
  }
  if (hardReview.length) {
    console.log(`  ${step++}. ${hardReview.length} job${hardReview.length === 1 ? '' : 's'} above need you to name the right quote. Look each one up in Xero,`);
    console.log('     then add a --pick for it (repeatable, and it can go on the same run as --apply):');
    console.log('        ' + [cmd, carry, `--pick "${hardReview[0].job.name}"=QU-XXXX`, '--apply'].filter(Boolean).join(' '));
    console.log('');
  }
  if (softReview.length && !ALLOW_FUZZY) {
    console.log(`  ${step++}. ${softReview.length} job${softReview.length === 1 ? '' : 's'} matched on the client name alone. If those quotes look right, add --allow-fuzzy.\n`);
  }
  const amendedImports = imported.filter(i => i.kind !== 'pure');
  if (amendedImports.length) {
    console.log(`  ${step++}. ${amendedImports.length} imported job${amendedImports.length === 1 ? '' : 's'} hold agreed money no Xero quote states in full. Nothing to run here —`);
    console.log('     open each in the app and use Amend, which freezes every part of what was agreed together.\n');
  }
  if (skipped.length) {
    console.log(`  ${step++}. ${skipped.length} job${skipped.length === 1 ? ' has' : 's have'} no Xero quote at all. --explain says why for each.`);
    console.log('     These stay live and keep drifting until a figure is entered by hand — decide whether that matters.\n');
  }
  console.log('  Nothing has been written. Every command above is safe to run more than once.\n');
}

main()
  .catch((err) => { console.error('\nMigration failed:', err.message); process.exitCode = 1; })
  .finally(() => db.pool.end());
