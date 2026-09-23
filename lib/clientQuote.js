// Client-facing variation approval — the shared half.
//
// See CLIENT_APPROVAL_SPEC.md. Two consumers, deliberately kept apart:
//   · routes/publicQuote.js — the token-gated page the CLIENT opens, mounted
//     ahead of the app's login gate because a client has no account.
//   · routes/api.js — the authenticated endpoints Nicky's app uses to mint a
//     link and publish the priced lines onto it.
// Everything they both need (the schema, the token) lives here so the two
// can never disagree about the shape of a link or of a published line.

const crypto = require('crypto');
const db = require('../db');

// db/setup.sql is not run on deploy (same situation as quote_snapshots and
// the debt app's tables), so the schema is created lazily on first use --
// once per process, memoised, and only from the routes that need it.
//
// job_variations is the PUBLISHED, client-facing record of a job's extras.
// It is not the app's variation data: that stays where it has always lived
// (rooms.data / exterior_items.data / jobs.data, flagged isVariation and
// priced by the calc engine in the browser). This table is a SNAPSHOT of
// what a specific client was shown and what they answered, for the same
// reason quote_snapshots exists -- a variation the client approved at £320
// has to still read £320 after the day rate moves, and the server has no
// calc engine to re-derive it with anyway.
//
// Hence the one foreign key in this schema. Every other table here is
// cleaned up by hand in DELETE /jobs/:id, which is fine for data the app can
// regenerate; an orphaned row in THIS table is a price a client agreed to,
// still reachable on a live public URL, belonging to a job that no longer
// exists. ON DELETE CASCADE makes that unrepresentable rather than a thing
// to remember.
let schemaReady = null;
function ensureClientQuoteSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await db.query('ALTER TABLE jobs ADD COLUMN IF NOT EXISTS client_token VARCHAR');
      // Partial: every job without a link shares a NULL, which a plain
      // unique index would (correctly) allow but which reads confusingly.
      await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS jobs_client_token
                        ON jobs (client_token) WHERE client_token IS NOT NULL`);
      await db.query(`
        CREATE TABLE IF NOT EXISTS job_variations (
          id VARCHAR PRIMARY KEY,
          job_id VARCHAR NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
          source_kind VARCHAR NOT NULL,
          source_id VARCHAR NOT NULL,
          description VARCHAR NOT NULL,
          amount NUMERIC NOT NULL DEFAULT 0,
          status VARCHAR NOT NULL DEFAULT 'pending',
          approved_at TIMESTAMP,
          declined_at TIMESTAMP,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )`);
      // (source_kind, source_id) is the app-side carrier of the variation --
      // a room id, an exterior item id, 'kitchen', a fitted unit id, a free
      // line id. Unique per job so re-publishing after a re-measure UPDATES
      // the line the client is looking at rather than minting a second copy
      // of the same extra beside it.
      await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS job_variations_source
                        ON job_variations (job_id, source_kind, source_id)`);
      await db.query('CREATE INDEX IF NOT EXISTS job_variations_job ON job_variations (job_id)');
    })().catch(err => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

const VARIATION_STATUSES = new Set(['pending', 'approved', 'declined']);
// The carrier a published line came from. The four '*delta' kinds are extra
// work added INSIDE an already-measured carrier (VARIATIONS_SPEC.md Part 2) --
// deliberately distinct from the plain kinds, because job_variations is unique
// on (job_id, source_kind, source_id) and a delta sharing 'room' with a
// whole-room variation on the same room would collide, one silently
// overwriting the other.
//
// This set is a hard gate: PUT /jobs/:id/client-variations rejects the WHOLE
// payload on an unknown kind, so a kind missing from here does not degrade to
// dropping one line -- it takes "Send for approval" down for that job entirely.
const VARIATION_KINDS = new Set([
  'room', 'ext', 'kitchen', 'fittedunit', 'free',
  'roomdelta', 'extdelta', 'kitchendelta', 'fittedunitdelta'
]);

// 24 random bytes, base64url — 192 bits in 32 URL-safe characters. The link
// is the only credential on the client-facing page, so it has to be
// unguessable rather than merely unlikely; at this width, brute force is not
// a threat model, which is why the throttle in routes/publicQuote.js exists
// for abuse rather than for security.
function newClientToken() {
  return crypto.randomBytes(24).toString('base64url');
}

// Returns the job's link token, generating one on first use. Idempotent by
// design: the handoff allows either "on quote acceptance" or "lazily on first
// Send for approval", and doing both means the token is simply whatever the
// job already has.
//
// The UPDATE is guarded on client_token IS NULL rather than written blind, so
// two devices tapping Send at the same moment converge on ONE token instead of
// the slower one silently invalidating a link that has already been texted to
// the client. It also deliberately does not touch updated_at: GET /jobs orders
// by it, and minting a link is not a change to the job worth reshuffling the
// jobs list for.
async function ensureClientToken(jobId) {
  const existing = await db.query('SELECT client_token FROM jobs WHERE id = $1', [jobId]);
  if (!existing.rows.length) return null;
  if (existing.rows[0].client_token) return existing.rows[0].client_token;
  const updated = await db.query(
    'UPDATE jobs SET client_token = $2 WHERE id = $1 AND client_token IS NULL RETURNING client_token',
    [jobId, newClientToken()]
  );
  if (updated.rows.length) return updated.rows[0].client_token;
  const raced = await db.query('SELECT client_token FROM jobs WHERE id = $1', [jobId]);
  return raced.rows[0] ? raced.rows[0].client_token : null;
}

// Constant-time token comparison. The job is looked up by ID and the token
// compared here rather than matched in the WHERE clause, so the comparison
// itself leaks nothing through timing. Same digest trick as
// routes/appLogin.js: timingSafeEqual demands equal-length buffers, and
// hashing both sides gives that without leaking length.
function tokenMatches(supplied, stored) {
  if (!supplied || !stored) return false;
  const a = crypto.createHash('sha256').update(String(supplied)).digest();
  const b = crypto.createHash('sha256').update(String(stored)).digest();
  return crypto.timingSafeEqual(a, b);
}

// The client-facing view of one job: business branding, the ORIGINAL quote
// total as a single figure, the published variation lines, and the running
// total. Returns null when the job doesn't exist or the token doesn't match —
// the caller turns both into the same generic 404, so the page never
// distinguishes "no such job" from "wrong token".
//
// The original total comes from the immutable snapshot (quote_snapshots,
// newest revision), NOT from re-running any calculation: that is the whole
// point of ACCEPTED_SNAPSHOT_SPEC.md and it matters even more here, where the
// reader is the client. Jobs accepted before snapshots shipped, and jobs
// reconciled from Xero, fall back to the acceptedSnapshot headline cache on
// jobs.data — the same order of authority jobHeadlineTotal() uses in the app.
async function loadClientQuote(jobId, token) {
  const jobResult = await db.query(
    'SELECT id, name, data, client_token FROM jobs WHERE id = $1', [jobId]
  );
  const job = jobResult.rows[0];
  if (!job || !tokenMatches(token, job.client_token)) return null;

  const data = job.data || {};
  const [snapshotResult, variationsResult, settingsResult, invoicesResult] = await Promise.all([
    db.query(
      'SELECT data FROM quote_snapshots WHERE job_id = $1 ORDER BY version DESC LIMIT 1', [jobId]
    ).catch(err => { if (err.code === '42P01') return { rows: [] }; throw err; }),
    db.query(
      `SELECT id, source_kind, source_id, description, amount, status, approved_at, declined_at, created_at
         FROM job_variations WHERE job_id = $1 ORDER BY created_at ASC`, [jobId]
    ),
    db.query('SELECT data FROM settings WHERE id = 1'),
    // Invoices issued so far (STAGED_INVOICING_SPEC.md) -- ONLY those Xero
    // reports as approved or paid. A draft is still being checked and could
    // change, so the client never sees one before it has actually been sent.
    // Tolerates a database that has never had an invoice (no table yet) or
    // predates the status columns: both mean "nothing to show".
    db.query(
      `SELECT type, sequence, xero_invoice_number, xero_date, subtotal, xero_total,
              xero_status, xero_amount_paid, xero_amount_due
         FROM invoices WHERE job_id = $1 AND xero_status = ANY($2::text[]) ORDER BY sequence ASC`,
      [jobId, ['AUTHORISED', 'PAID']]
    ).catch(err => { if (err.code === '42P01' || err.code === '42703') return { rows: [] }; throw err; }),
  ]);

  const snapshotTotals = snapshotResult.rows[0]?.data?.totals || null;
  const cachedTotal = data.acceptedSnapshot ? +data.acceptedSnapshot.estQuoteTotal : NaN;
  const originalTotal = snapshotTotals && snapshotTotals.incVat != null
    ? +snapshotTotals.incVat
    : (Number.isFinite(cachedTotal) ? cachedTotal : null);

  const variations = variationsResult.rows.map(r => ({
    id: r.id,
    description: r.description,
    amount: +r.amount || 0,
    status: r.status,
    // The date the line is stamped with is the date of its ANSWER once it has
    // one, and the date it was sent while it is still waiting — which is what
    // someone reading the page actually wants to know about each row.
    at: r.approved_at || r.declined_at || r.created_at,
    answeredAt: r.approved_at || r.declined_at || null,
  }));
  const approvedTotal = variations
    .filter(v => v.status === 'approved')
    .reduce((sum, v) => sum + v.amount, 0);

  const invoices = invoicesResult.rows.map(r => ({
    type: r.type,
    sequence: r.sequence,
    number: r.xero_invoice_number || null,
    date: r.xero_date || null,
    // Xero's total is the authority once it has one (it is what the client's
    // copy says); the app's own record is the fallback.
    total: r.xero_total != null ? +r.xero_total : +r.subtotal || 0,
    paid: r.xero_status === 'PAID',
    amountPaid: r.xero_amount_paid == null ? null : +r.xero_amount_paid,
    amountDue: r.xero_amount_due == null ? null : +r.xero_amount_due,
  }));
  const invoicedTotal = invoices.reduce((t, i) => t + i.total, 0);

  const settings = settingsResult.rows[0]?.data || {};
  return {
    job: {
      id: job.id,
      name: job.name || '',
      client: data.xeroClient || '',
    },
    business: {
      name: settings.businessName || 'NH Estimator',
      logoDataUri: settings.logoDataUri || null,
    },
    originalTotal,
    variations,
    approvedTotal,
    // What the job now costs: the agreed quote plus everything the client has
    // said yes to. Pending lines are deliberately NOT in it — the running
    // total must never quietly bill work nobody has agreed to — and declined
    // ones never will be.
    runningTotal: (originalTotal || 0) + approvedTotal,
    invoices,
    invoicedTotal,
  };
}

module.exports = {
  ensureClientQuoteSchema,
  ensureClientToken,
  tokenMatches,
  loadClientQuote,
  VARIATION_STATUSES,
  VARIATION_KINDS,
};
