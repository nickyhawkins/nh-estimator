// Job spec sheet — the shared half.
//
// See JOB_SPEC_SHEET_SPEC.md. Three consumers, deliberately kept apart:
//   · routes/publicSpec.js — the token-gated page a helper or client opens,
//     mounted ahead of the app's login gate because neither has an account.
//   · routes/api.js — the authenticated endpoints Nicky's app uses to read
//     and write ticks, and to publish or revoke the live link.
//   · the app itself, which builds the model (jobSpecModel() in
//     public/index.html) and posts it here finished.
// Everything the first two both need — the schema, the token, the model's
// shape, the tick vocabulary — lives here so they can never disagree about
// what a row or a tick is.
//
// NOTHING IN THIS FILE CALCULATES. The describing logic (which surfaces a
// room has, what colour each is going, which product, what prep) is the app's
// calc engine, it runs nowhere else, and a second implementation of it on the
// server is exactly the duplicate-describing-function failure this repo keeps
// writing specs about (CLIENT_APPROVAL_SPEC.md, "Why the prices are
// published, not computed"). The phone publishes a FINISHED model and the
// server stores it, serves it and escapes it. It is data the page displays,
// never markup, and never something to re-derive.

const crypto = require('crypto');
const db = require('../db');
const { tokenMatches } = require('./clientQuote');

// db/setup.sql is not run on deploy (same situation as quote_snapshots,
// job_variations and snags), so the schema is created lazily on first use --
// once per process, memoised, and only from the routes that need it.
//
// spec_ticks is COLUMNS, not a JSON blob, for the reason snags gave: status
// is queried and counted. One row per (row, step) rather than one row per row
// with two status columns, so a Prep tick and a Painted tick can never
// overwrite each other -- which matters now that two people can tick at once,
// one on the phone and one on the link.
//
// Both tables carry a real foreign key, like job_variations and for the same
// reason: an orphaned job_spec_sheets row is a live public URL belonging to a
// job that no longer exists. ON DELETE CASCADE makes that unrepresentable
// rather than a thing to remember.
let schemaReady = null;
function ensureSpecSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      // Its OWN token, deliberately not jobs.client_token. That one opens the
      // client's variation page, which has Approve and Decline buttons on it,
      // and handing it to a helper hands them those buttons. Two tokens means
      // either link can be revoked without touching the other.
      await db.query('ALTER TABLE jobs ADD COLUMN IF NOT EXISTS spec_token VARCHAR');
      await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS jobs_spec_token
                        ON jobs (spec_token) WHERE spec_token IS NOT NULL`);
      await db.query(`
        CREATE TABLE IF NOT EXISTS spec_ticks (
          job_id VARCHAR NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
          item_key VARCHAR NOT NULL,
          step VARCHAR NOT NULL,
          status VARCHAR NOT NULL DEFAULT 'open',
          completed_at TIMESTAMP,
          source VARCHAR NOT NULL DEFAULT 'app',
          updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
          PRIMARY KEY (job_id, item_key, step)
        )`);
      await db.query('CREATE INDEX IF NOT EXISTS spec_ticks_job ON spec_ticks (job_id)');
      // The published model. One row per job, replaced wholesale on every
      // publish -- last write wins, so a queued retry is always safe.
      await db.query(`
        CREATE TABLE IF NOT EXISTS job_spec_sheets (
          job_id VARCHAR PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
          model JSONB NOT NULL,
          published_at TIMESTAMP NOT NULL DEFAULT NOW()
        )`);
    })().catch(err => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

// The two ticks a row can carry, and the two states each can be in. Validated
// rather than free text for the same reason snag phases are: an unknown value
// would store a tick nothing ever reads back.
const SPEC_STEPS = new Set(['prep', 'done']);
const SPEC_TICK_STATUSES = new Set(['open', 'done']);
const SPEC_SOURCES = new Set(['app', 'link']);

// A row key is '<kind>:<id>:<role>' built from record ids -- 'room:ab12:ceiling'
// -- so it is short by construction. The cap is there to stop the table being
// filled with junk, not to describe a real key.
const ITEM_KEY_MAX = 200;

// Model limits. A twenty-room house with every surface measured is some
// hundreds of rows; 4000 is far past any real job and well short of anything
// that would trouble a JSONB column or the page that renders it.
const MODEL_MAX_ROWS = 4000;
const MODEL_MAX_STAGES = 40;
const MODEL_MAX_BYTES = 512 * 1024;
const TEXT_MAX = 400;

const str = (v, max) => String(v == null ? '' : v).slice(0, max || TEXT_MAX);

// Rebuilds the posted model as a clean object of plain strings, dropping
// every key it does not know about. Returns null when the shape is wrong.
//
// This is a whitelist rather than a check-and-pass-through on purpose: what
// comes back out of here is rendered onto a public page, and the narrower the
// thing stored the less there is for the escaping on render to be the only
// guard against. Escaping still happens -- both, not either.
function normaliseSpecModel(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (!Array.isArray(raw.rows) || !Array.isArray(raw.stages)) return null;
  if (raw.rows.length > MODEL_MAX_ROWS || raw.stages.length > MODEL_MAX_STAGES) return null;

  const stages = [];
  const stageKeys = new Set();
  for (const s of raw.stages) {
    const key = str(s && s.key, 60).trim();
    if (!key || stageKeys.has(key)) continue;
    stageKeys.add(key);
    stages.push({ key, label: str(s && s.label, 80) });
  }
  if (!stages.length) return null;

  const rows = [];
  const seen = new Set();
  for (const r of raw.rows) {
    if (!r || typeof r !== 'object') continue;
    const key = str(r.key, ITEM_KEY_MAX).trim();
    if (!key || seen.has(key)) continue;
    // A row's stage has to be one the model itself declares, or the By Stage
    // view would have a row with nowhere to sit.
    const stage = str(r.stage, 60).trim();
    if (!stageKeys.has(stage)) continue;
    // Order matters and is the row's own: ['prep','done'] for a painted
    // surface, ['done'] for a papered one or a custom item.
    const steps = Array.isArray(r.steps)
      ? r.steps.map(s => str(s, 10).trim()).filter(s => SPEC_STEPS.has(s))
      : [];
    if (!steps.length) continue;
    seen.add(key);
    rows.push({
      key,
      steps: [...new Set(steps)],
      stage,
      areaKey: str(r.areaKey, ITEM_KEY_MAX),
      area: str(r.area, 120),
      label: str(r.label, 120),
      coats: str(r.coats, 60),
      colour: str(r.colour, 200),
      product: str(r.product, 200),
      prep: str(r.prep, TEXT_MAX),
      includes: str(r.includes, TEXT_MAX),
      tag: str(r.tag, 80),
      // Said against the AREA, not the row: the extra-work flag is per-carrier
      // and never names a surface (VARIATIONS_SPEC.md Part 2).
      areaNote: str(r.areaNote, 120),
    });
  }
  if (!rows.length) return null;

  const model = {
    jobName: str(raw.jobName, 200),
    address: str(raw.address, 300),
    stages,
    rows,
  };
  // Belt and braces on the cap: the per-field slices above bound it already,
  // but a model is stored whole and served whole, so the whole is what the
  // limit should be on.
  if (Buffer.byteLength(JSON.stringify(model), 'utf8') > MODEL_MAX_BYTES) return null;
  return model;
}

// May this tick be written? The rule the PUBLIC route lives or dies by: a
// tick is accepted only if item_key is a row in THAT job's published model
// and step is one of THAT row's steps. That is what stops the table being
// filled with junk by anyone holding the link, and it is why the published
// model is what gets checked rather than a length cap alone.
//
// Pure and exported so the route and its test ask the same question of the
// same code -- a second copy of this rule in a test would be a test of the
// copy.
function tickAllowedByModel(model, itemKey, step) {
  if (!model || !Array.isArray(model.rows)) return false;
  if (!itemKey || itemKey.length > ITEM_KEY_MAX) return false;
  if (!SPEC_STEPS.has(step)) return false;
  const row = model.rows.find(r => r.key === itemKey);
  return !!(row && row.steps.indexOf(step) >= 0);
}

// 24 random bytes, base64url -- 192 bits in 32 URL-safe characters, the same
// width and the same reasoning as the client link's token (lib/clientQuote.js).
// The token is the only gate on the page, so it has to be unguessable rather
// than merely unlikely.
function newSpecToken() {
  return crypto.randomBytes(24).toString('base64url');
}

// Returns the job's spec-sheet token, minting one on first use. Idempotent,
// and guarded on spec_token IS NULL rather than written blind, so two devices
// tapping Share at the same moment converge on ONE token instead of the
// slower one silently invalidating a link that has already been sent. Like
// ensureClientToken it deliberately does not touch updated_at: GET /jobs
// orders by it, and minting a link is not a change to the job worth
// reshuffling the jobs list for.
async function ensureSpecToken(jobId) {
  const existing = await db.query('SELECT spec_token FROM jobs WHERE id = $1', [jobId]);
  if (!existing.rows.length) return null;
  if (existing.rows[0].spec_token) return existing.rows[0].spec_token;
  const updated = await db.query(
    'UPDATE jobs SET spec_token = $2 WHERE id = $1 AND spec_token IS NULL RETURNING spec_token',
    [jobId, newSpecToken()]
  );
  if (updated.rows.length) return updated.rows[0].spec_token;
  const raced = await db.query('SELECT spec_token FROM jobs WHERE id = $1', [jobId]);
  return raced.rows[0] ? raced.rows[0].spec_token : null;
}

// The path the helper opens. A path rather than a full URL for the same
// reason clientQuotePath is: the server has no reliable idea what hostname
// the instance is reached on (Render proxies, custom domains), and the app
// pairs it with its own location.origin, which is by definition the right one.
const specSheetPath = (token) => '/s/' + encodeURIComponent(token);

// Every tick on a job, as the app and the page both read them.
async function readSpecTicks(jobId) {
  const result = await db.query(
    `SELECT item_key, step, status, completed_at, source
       FROM spec_ticks WHERE job_id = $1`, [jobId]
  );
  return result.rows.map(r => ({
    itemKey: r.item_key,
    step: r.step,
    status: r.status,
    completedAt: r.completed_at,
    source: r.source || 'app',
  }));
}

// One tick, upserted on its natural key. completed_at is derived from status
// here rather than trusted from the body -- "done" with no date, or a date
// left behind on a row ticked back to open, are both states the UI would then
// have to explain. The caller may pass its own stamp (the app ticks offline,
// and the moment it was ticked is what the record should say, not the moment
// the queue flushed); an unparseable or missing one falls back to now.
async function writeSpecTick({ jobId, itemKey, step, status, completedAt, source }) {
  const st = SPEC_TICK_STATUSES.has(status) ? status : 'open';
  const stamp = st === 'done'
    ? (Number.isNaN(Date.parse(completedAt)) ? new Date().toISOString() : completedAt)
    : null;
  await db.query(`
    INSERT INTO spec_ticks (job_id, item_key, step, status, completed_at, source, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, NOW())
    ON CONFLICT (job_id, item_key, step) DO UPDATE SET
      status = $4, completed_at = $5, source = $6, updated_at = NOW()
  `, [jobId, itemKey, step, st, stamp, SPEC_SOURCES.has(source) ? source : 'app']);
  return { itemKey, step, status: st, completedAt: stamp, source: SPEC_SOURCES.has(source) ? source : 'app' };
}

// The published sheet behind a token, or null. Resolving the job BY token is
// a plain indexed lookup and is deliberately NOT the authorization decision:
// it only chooses which row to check. The decision is tokenMatches()'s
// constant-time compare, exactly as on the client quote page -- so a bad
// token and a job whose sheet was never published are indistinguishable from
// outside, and both render the same generic 404.
async function loadSpecSheet(token) {
  if (!token) return null;
  const found = await db.query('SELECT id, name, spec_token FROM jobs WHERE spec_token = $1', [token]);
  const job = found.rows[0];
  if (!job || !tokenMatches(token, job.spec_token)) return null;
  const [sheetResult, settingsResult] = await Promise.all([
    db.query('SELECT model, published_at FROM job_spec_sheets WHERE job_id = $1', [job.id]),
    db.query('SELECT data FROM settings WHERE id = 1'),
  ]);
  const sheet = sheetResult.rows[0];
  // A token with no model behind it is Stop-sharing half-done, or a link
  // minted and never published. Same generic dead end as a wrong token.
  if (!sheet || !sheet.model) return null;
  const model = normaliseSpecModel(sheet.model);
  if (!model) return null;
  const settings = settingsResult.rows[0]?.data || {};
  return {
    jobId: job.id,
    model,
    publishedAt: sheet.published_at,
    ticks: await readSpecTicks(job.id),
    business: {
      name: settings.businessName || 'NH Estimator',
      logoDataUri: settings.logoDataUri || null,
    },
  };
}

module.exports = {
  ensureSpecSchema,
  tickAllowedByModel,
  ensureSpecToken,
  newSpecToken,
  specSheetPath,
  normaliseSpecModel,
  readSpecTicks,
  writeSpecTick,
  loadSpecSheet,
  SPEC_STEPS,
  SPEC_TICK_STATUSES,
  SPEC_SOURCES,
  ITEM_KEY_MAX,
};
