// Windows and doors fixture — the server's half (WINDOWS_DOORS_SPEC.md).
//
// Three tables, and the rows are the whole record: the app prices them in the
// browser (public/windoors.js, the same module this file requires for the
// report), the server stores them and draws the report from them. There is no
// price anywhere in these tables, which is what lets the client-facing page
// render the report straight from them.
//
//   job_property    one row per job using the fixture: the house style, the
//                   per-side floor layout, the job's default prep level and
//                   whether pane/frame marking is switched on
//   job_openings    one row per window or door
//   opening_marks   one row per marked pane or frame part, stamped with the
//                   stage it was made in ('quote' or 'variation')
//
// Same save strategy as snags and the spec ticks: one row per PUT, one row
// per DELETE, no replace-all -- every write is On Site data that can be made
// in a dead spot and has to queue and replay on its own.
//
// Deliberately no foreign keys, like snags: the offline queue replays writes
// in order but a DELETE of an opening can race a mark PUT from a second
// device, and a stray mark on an opening that no longer exists prices as
// nothing (priceJob skips it) rather than failing the whole replay.
// Children are cleaned up by hand in DELETE /jobs/:id and when an opening is
// deleted.

const db = require('../db');
const Windoors = require('../public/windoors');

let schemaReady = null;
function ensureWindoorsSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS job_property (
          job_id VARCHAR PRIMARY KEY,
          style VARCHAR NOT NULL DEFAULT 'georgian',
          detail_enabled BOOLEAN NOT NULL DEFAULT TRUE,
          default_prep VARCHAR NOT NULL DEFAULT 'light',
          layout JSONB NOT NULL DEFAULT '{}',
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )`);
      await db.query(`
        CREATE TABLE IF NOT EXISTS job_openings (
          id VARCHAR PRIMARY KEY,
          job_id VARCHAR NOT NULL,
          side VARCHAR NOT NULL,
          floor INTEGER NOT NULL DEFAULT 0,
          kind VARCHAR NOT NULL,
          position INTEGER NOT NULL DEFAULT 1,
          nickname VARCHAR,
          type VARCHAR NOT NULL,
          size_tier VARCHAR NOT NULL,
          rows INTEGER NOT NULL DEFAULT 1,
          cols INTEGER NOT NULL DEFAULT 1,
          prep_level VARCHAR,
          prep_stage VARCHAR NOT NULL DEFAULT 'quote',
          quote_prep_level VARCHAR,
          prep_variation_id VARCHAR,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )`);
      await db.query('CREATE UNIQUE INDEX IF NOT EXISTS job_openings_slot ON job_openings (job_id, side, floor, kind, position)');
      await db.query('CREATE INDEX IF NOT EXISTS job_openings_job ON job_openings (job_id)');
      await db.query(`
        CREATE TABLE IF NOT EXISTS opening_marks (
          id VARCHAR PRIMARY KEY,
          job_id VARCHAR NOT NULL,
          opening_id VARCHAR NOT NULL,
          element_id VARCHAR NOT NULL,
          action_key VARCHAR NOT NULL,
          stage VARCHAR NOT NULL DEFAULT 'quote',
          variation_id VARCHAR,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )`);
      await db.query('CREATE INDEX IF NOT EXISTS opening_marks_job ON opening_marks (job_id)');
      await db.query('CREATE INDEX IF NOT EXISTS opening_marks_opening ON opening_marks (opening_id)');
    })().catch(err => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

const keysOf = list => new Set(list.map(x => x.key));
const SIDES = keysOf(Windoors.SIDES);
const STYLES = keysOf(Windoors.STYLES);
const KINDS = new Set(['window', 'door']);
const WINDOW_TYPES = keysOf(Windoors.WINDOW_TYPES);
const DOOR_TYPES = keysOf(Windoors.DOOR_TYPES);
const WINDOW_TIERS = keysOf(Windoors.WINDOW_TIERS);
const DOOR_TIERS = keysOf(Windoors.DOOR_TIERS);
const PREP = keysOf(Windoors.PREP_LEVELS);
const ACTIONS = keysOf(Windoors.ACTIONS);
const STAGES = new Set(['quote', 'variation']);

// Validation is a hard gate, not a clean-up: every value here is read back by
// a list lookup in the pricing, and an unknown one would price as nothing in
// silence. A bad row is refused with a 400 so the phone says so.
function normaliseProperty(body) {
  const layout = {};
  const raw = (body && body.layout) || {};
  Windoors.SIDES.forEach(s => {
    const l = raw[s.key];
    if (!l) return;
    layout[s.key] = {
      floors: (Array.isArray(l.floors) ? l.floors : []).slice(0, 6).map(f => ({
        windows: Math.max(0, Math.min(20, Math.floor(+(f && f.windows) || 0))),
        doors: Math.max(0, Math.min(6, Math.floor(+(f && f.doors) || 0))),
      })),
      confirmed: !!l.confirmed,
    };
  });
  return {
    style: STYLES.has(body && body.style) ? body.style : 'georgian',
    detail_enabled: body && body.detailEnabled === false ? false : true,
    default_prep: PREP.has(body && body.defaultPrep) ? body.defaultPrep : 'light',
    layout,
  };
}

function normaliseOpening(body) {
  const b = body || {};
  if (!SIDES.has(b.side)) return { error: 'side must be front, back, left or right' };
  if (!KINDS.has(b.kind)) return { error: 'kind must be window or door' };
  const types = b.kind === 'door' ? DOOR_TYPES : WINDOW_TYPES;
  const tiers = b.kind === 'door' ? DOOR_TIERS : WINDOW_TIERS;
  if (!types.has(b.type)) return { error: 'unknown ' + b.kind + ' type' };
  if (!tiers.has(b.sizeTier)) return { error: 'unknown size tier' };
  const grid = v => Math.max(1, Math.min(8, Math.floor(+v || 1)));
  return {
    side: b.side,
    floor: Math.max(0, Math.min(5, Math.floor(+b.floor || 0))),
    kind: b.kind,
    position: Math.max(1, Math.floor(+b.position || 1)),
    nickname: String(b.nickname || '').trim().slice(0, 60) || null,
    type: b.type,
    size_tier: b.sizeTier,
    rows: grid(b.rows),
    cols: grid(b.cols),
    prep_level: PREP.has(b.prepLevel) ? b.prepLevel : null,
    prep_stage: b.prepStage === 'variation' ? 'variation' : 'quote',
    quote_prep_level: PREP.has(b.quotePrepLevel) ? b.quotePrepLevel : null,
    prep_variation_id: b.prepStage === 'variation' && b.prepVariationId ? String(b.prepVariationId) : null,
  };
}

function normaliseMark(body) {
  const b = body || {};
  if (!b.openingId) return { error: 'openingId is required' };
  if (!b.elementId || !/^[a-z_]+(-\d+)?$/.test(String(b.elementId))) return { error: 'elementId is not a known element' };
  if (!ACTIONS.has(b.actionKey)) return { error: 'unknown action' };
  const stage = STAGES.has(b.stage) ? b.stage : 'quote';
  return {
    opening_id: String(b.openingId),
    element_id: String(b.elementId),
    action_key: b.actionKey,
    stage,
    variation_id: stage === 'variation' && b.variationId ? String(b.variationId) : null,
  };
}

// Rows as the module wants them (snake_case keys -- the same names the spec
// uses, so public/windoors.js reads the table's own vocabulary).
function mapProperty(r) {
  if (!r) return null;
  return { style: r.style, detail_enabled: r.detail_enabled !== false, default_prep: r.default_prep || 'light', layout: r.layout || {} };
}
function mapOpening(r) {
  return {
    id: r.id, side: r.side, floor: +r.floor || 0, kind: r.kind, position: +r.position || 1,
    nickname: r.nickname || null, type: r.type, size_tier: r.size_tier, rows: +r.rows || 1, cols: +r.cols || 1,
    prep_level: r.prep_level || null, prep_stage: r.prep_stage || 'quote',
    quote_prep_level: r.quote_prep_level || null, prep_variation_id: r.prep_variation_id || null,
  };
}
function mapMark(r) {
  return {
    id: r.id, opening_id: r.opening_id, element_id: r.element_id, action_key: r.action_key,
    stage: r.stage || 'quote', variation_id: r.variation_id || null, created_at: r.created_at,
  };
}

// Everything one job has, or null when it has never used the fixture.
// Tolerates the tables not existing yet (a database that has never had one).
async function readWindoors(jobId) {
  try {
    await ensureWindoorsSchema();
  } catch (err) {
    return null;
  }
  const [p, o, m] = await Promise.all([
    db.query('SELECT style, detail_enabled, default_prep, layout FROM job_property WHERE job_id = $1', [jobId]),
    db.query('SELECT * FROM job_openings WHERE job_id = $1 ORDER BY side, floor, kind, position', [jobId]),
    db.query('SELECT * FROM opening_marks WHERE job_id = $1 ORDER BY created_at ASC', [jobId]),
  ]);
  return {
    property: mapProperty(p.rows[0]),
    openings: o.rows.map(mapOpening),
    marks: m.rows.map(mapMark),
  };
}

// The variations the report can speak to, and when each was approved. Two
// sources, because an answer can live in either: the app's own record on
// jobs.data (approved by hand on site, or adopted from the link), and the
// published job_variations row (the client's own tap, not yet adopted by the
// app). Either one saying "approved" is enough -- both are the client's yes.
async function reportVariations(jobId, jobData) {
  const out = {};
  ((jobData && jobData.windoorsVariations) || []).forEach(v => {
    if (!v || !v.id) return;
    out[v.id] = { id: v.id, status: v.variationStatus || 'pending', approvedAt: v.variationApprovedAt || null };
  });
  const published = await db.query(
    `SELECT source_id, status, approved_at FROM job_variations WHERE job_id = $1 AND source_kind = 'windoors'`, [jobId]
  ).catch(() => ({ rows: [] }));
  published.rows.forEach(r => {
    if (r.status !== 'approved') return;
    const cur = out[r.source_id];
    if (!cur || cur.status !== 'approved') out[r.source_id] = { id: r.source_id, status: 'approved', approvedAt: r.approved_at };
  });
  return Object.keys(out).map(k => out[k]);
}

// The report as an HTML fragment for one job, or '' when there is nothing to
// report (no fixture, or no work marked).
async function jobReportHtml(jobId, jobData, opts) {
  const data = await readWindoors(jobId);
  if (!data || !data.property || !data.openings.length) return '';
  const variations = await reportVariations(jobId, jobData);
  return Windoors.reportHtml(data, variations, opts || {});
}

module.exports = {
  ensureWindoorsSchema,
  normaliseProperty,
  normaliseOpening,
  normaliseMark,
  mapProperty,
  mapOpening,
  mapMark,
  readWindoors,
  reportVariations,
  jobReportHtml,
};
