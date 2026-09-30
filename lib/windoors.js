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
//   job_openings    one row per window, door or bay (a bay's windows are
//                   rows of their own, pointing at it by parent_opening_id)
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
      // Paint (v2.83.0): coats and the colour numbers (see the colours
      // table) the windows and the doors are painted in. NULL colour = the
      // job's default colour 1, as an unset room surface is.
      await db.query('ALTER TABLE job_property ADD COLUMN IF NOT EXISTS coats INTEGER NOT NULL DEFAULT 2');
      await db.query('ALTER TABLE job_property ADD COLUMN IF NOT EXISTS window_colour INTEGER');
      await db.query('ALTER TABLE job_property ADD COLUMN IF NOT EXISTS door_colour INTEGER');
      // The paint PRODUCT for each (v2.84.0): {window: {range, band}, door:
      // {...}}, a material range/band exactly as a room's override stores
      // one. Empty = the Settings exterior woodwork topcoat.
      await db.query("ALTER TABLE job_property ADD COLUMN IF NOT EXISTS paint_products JSONB NOT NULL DEFAULT '{}'");
      // Stage 2 (WINDOWS_DOORS_STAGE2_SPEC.md): the house's appearance --
      // period, finish, form, roof and the period's details. NULL on a job
      // saved before it, which reads as its style's defaults (see
      // Windoors.appearanceOf). style is still written, = appearance.period.
      await db.query('ALTER TABLE job_property ADD COLUMN IF NOT EXISTS appearance JSONB');
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
      // Stage 2: the level (lower ground / the floors / dormers), bays and
      // their windows, and whether the pane layout was set by hand (the
      // elevation draws the period's glazing until it is). Existing rows are
      // all 'standard'.
      await db.query("ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS level VARCHAR NOT NULL DEFAULT 'standard'");
      await db.query('ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS bay_shape VARCHAR');
      await db.query('ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS bay_storeys INTEGER');
      await db.query('ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS parent_opening_id VARCHAR');
      await db.query('ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS panes_set BOOLEAN NOT NULL DEFAULT FALSE');
      // A sash's bottom sash rows when they differ from the top (3-over-6).
      // NULL = the same as rows, which every row saved before it is.
      await db.query('ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS rows_bottom INTEGER');
      // Other items (v2.86.0): a garage door, a porch -- priced from their
      // own figures (Windoors.baseMinutes / priceJob / openingPaintM2).
      // NULL on every other kind.
      await db.query('ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS other_mins REAL');
      await db.query('ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS other_cost REAL');
      await db.query('ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS other_m2 REAL');
      // Access set by hand ('ground' / 'firstFloor' / 'ladderTower'). NULL =
      // Auto: read from where the opening sits (Windoors.autoAccess).
      await db.query('ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS access VARCHAR');
      // Site prep changes the client has already answered, before the live
      // one (v2.91.1): [{variation_id, level}]. Empty on every older row.
      await db.query("ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS prep_steps JSONB NOT NULL DEFAULT '[]'");
      // Not in this job (v2.89.0): drawn, not priced. include_variation_id
      // is set when one is brought into the job on site, as a variation.
      await db.query('ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS excluded BOOLEAN NOT NULL DEFAULT FALSE');
      await db.query('ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS include_variation_id VARCHAR');
      // An Other item priced by time or at a set price (v2.89.0). NULL
      // pricing = by time; other_unit is only how its time is shown.
      await db.query('ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS other_pricing VARCHAR');
      await db.query('ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS other_price REAL');
      await db.query('ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS other_unit VARCHAR');
      // Drawn as a porch over a ground-floor door (v2.90.0): its style, and
      // which door (D1 = 1). NULL = a tile under the house.
      await db.query('ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS other_draw VARCHAR');
      await db.query('ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS other_door INTEGER');
      // The slot now includes the level: W1 on the lower ground and W1 on
      // the ground floor are both floor 0. (A bay's windows are numbered
      // 101, 102... -- see Windoors.bayChildPosition -- so they never share
      // a slot with an ordinary window.)
      await db.query('DROP INDEX IF EXISTS job_openings_slot');
      await db.query('CREATE UNIQUE INDEX IF NOT EXISTS job_openings_slot2 ON job_openings (job_id, side, level, floor, kind, position)');
      await db.query('CREATE INDEX IF NOT EXISTS job_openings_parent ON job_openings (parent_opening_id)');
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
      // Ticked off on site as done (v2.86.0). NULL = not yet; the report
      // shows only ticked marks.
      await db.query('ALTER TABLE opening_marks ADD COLUMN IF NOT EXISTS done_at TIMESTAMP');
      // Repair size tiers (RESIN_REPAIR_TIERS_SPEC.md). Tiered actions only
      // (resin); NULL reads as Medium in both, so nothing moves on migration.
      // agreed_size_tier is the tier the client agreed -- the floor -- set
      // when the quote is accepted or the mark's variation is sent.
      await db.query('ALTER TABLE opening_marks ADD COLUMN IF NOT EXISTS size_tier VARCHAR');
      await db.query('ALTER TABLE opening_marks ADD COLUMN IF NOT EXISTS agreed_size_tier VARCHAR');
      await db.query('ALTER TABLE opening_marks ADD COLUMN IF NOT EXISTS upgraded_at TIMESTAMP');
      await db.query('CREATE INDEX IF NOT EXISTS opening_marks_job ON opening_marks (job_id)');
      await db.query('CREATE INDEX IF NOT EXISTS opening_marks_opening ON opening_marks (opening_id)');
    })().catch(err => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

const keysOf = list => new Set(list.map(x => x.key));
const SIDES = keysOf(Windoors.SIDES);
const STYLES = keysOf(Windoors.STYLES);
const KINDS = new Set(['window', 'door', 'bay', 'other']);
const OTHER_PAINT = keysOf(Windoors.OTHER_PAINT);
const LEVELS = keysOf(Windoors.LEVELS);
const BAY_SHAPES = keysOf(Windoors.BAY_SHAPES);
const WINDOW_TYPES = keysOf(Windoors.WINDOW_TYPES);
const DOOR_TYPES = keysOf(Windoors.DOOR_TYPES);
const WINDOW_TIERS = keysOf(Windoors.WINDOW_TIERS);
const DOOR_TIERS = keysOf(Windoors.DOOR_TIERS);
const PREP = keysOf(Windoors.PREP_LEVELS);
const ACTIONS = keysOf(Windoors.ACTIONS);
const REPAIR_TIERS = keysOf(Windoors.REPAIR_TIERS);
const STAGES = new Set(['quote', 'variation']);
const ACCESS = keysOf(Windoors.ACCESS_LEVELS);
const PORCHES = keysOf(Windoors.PORCH_STYLES);

// Validation is a hard gate, not a clean-up: every value here is read back by
// a list lookup in the pricing, and an unknown one would price as nothing in
// silence. A bad row is refused with a 400 so the phone says so.
function colourNum(v) {
  const n = Math.floor(+v);
  return Number.isFinite(n) && n >= 1 ? n : null;
}
// {window: {range, band}, door: {range, band}} -- anything else dropped. band
// null means "not picked yet" on a multi-band range (the room picker's rule:
// a band is never guessed), '' is a real unbanded range.
function normalisePaintProducts(v) {
  const out = {};
  ['window', 'door'].forEach(k => {
    const p = v && v[k];
    if (!p || !p.range) return;
    out[k] = { range: String(p.range).slice(0, 120), band: p.band == null ? null : String(p.band).slice(0, 120) };
  });
  return out;
}
function normaliseProperty(body) {
  const layout = {};
  const raw = (body && body.layout) || {};
  Windoors.SIDES.forEach(s => {
    const l = raw[s.key];
    if (!l) return;
    const n = (v, max) => Math.max(0, Math.min(max, Math.floor(+v || 0)));
    const lg = l.lower_ground, rf = l.roof;
    layout[s.key] = {
      floors: (Array.isArray(l.floors) ? l.floors : []).slice(0, 6).map(f => ({
        windows: n(f && f.windows, 20),
        doors: n(f && f.doors, 6),
        bays: n(f && f.bays, 4),
      })),
      lower_ground: lg && typeof lg === 'object' ? { windows: n(lg.windows, 20), doors: n(lg.doors, 6) } : null,
      roof: rf && typeof rf === 'object' ? { windows: n(rf.windows, 20) } : null,
      confirmed: !!l.confirmed,
    };
  });
  // No appearance in the body (an app shell from before stage 2) = leave the
  // stored one alone: null here, COALESCEd in the upsert.
  const appearance = body && body.appearance && typeof body.appearance === 'object'
    ? Windoors.normaliseAppearance(body.appearance, body.style) : null;
  return {
    style: appearance ? appearance.period : (STYLES.has(body && body.style) ? body.style : 'georgian'),
    appearance,
    detail_enabled: body && body.detailEnabled === false ? false : true,
    default_prep: PREP.has(body && body.defaultPrep) ? body.defaultPrep : 'light',
    layout,
    coats: Math.max(1, Math.min(3, Math.floor(+(body && body.coats) || 2))),
    window_colour: colourNum(body && body.windowColour),
    door_colour: colourNum(body && body.doorColour),
    paint_products: normalisePaintProducts(body && body.paintProducts),
  };
}

function normaliseOpening(body) {
  const b = body || {};
  if (!SIDES.has(b.side)) return { error: 'side must be front, back, left or right' };
  if (!KINDS.has(b.kind)) return { error: 'kind must be window, door, bay or other' };
  const level = b.level == null ? 'standard' : b.level;
  if (!LEVELS.has(level)) return { error: 'level must be lower_ground, standard or roof' };
  if (level === 'roof' && b.kind !== 'window') return { error: 'only windows go in the roof' };
  if (b.kind === 'bay' && level !== 'standard') return { error: 'a bay stands on one of the floors' };
  // Absent (an app shell from before it) or null = Auto.
  const access = b.access == null ? null : b.access;
  if (access !== null && !ACCESS.has(access)) return { error: 'access must be ground, firstFloor, ladderTower or auto' };
  const parent = b.parentOpeningId ? String(b.parentOpeningId) : null;
  if (parent && (b.kind !== 'window' || level !== 'standard')) return { error: "a bay's openings are windows on its floors" };
  let type = b.type, sizeTier = b.sizeTier, bayShape = null, bayStoreys = null;
  const figure = (v, max) => { const n = +v; return Number.isFinite(n) && n > 0 ? Math.min(max, Math.round(n * 100) / 100) : 0; };
  let other = { other_mins: null, other_cost: null, other_m2: null, other_pricing: null, other_price: null, other_unit: null, other_draw: null, other_door: null };
  if (b.kind === 'other') {
    // Not on a floor: its own row under the side, named by its nickname.
    if (level !== 'standard' || parent) return { error: 'an other item sits on the side, not a level' };
    if (!String(b.nickname || '').trim()) return { error: 'an other item needs a name' };
    type = OTHER_PAINT.has(type) ? type : 'door';
    sizeTier = 'standard';
    other = {
      other_mins: figure(b.otherMins, Windoors.OTHER_MAX_MINS), other_cost: figure(b.otherCost, 100000), other_m2: figure(b.otherM2, 200),
      other_pricing: b.otherPricing === 'price' ? 'price' : 'time',
      other_price: figure(b.otherPrice, Windoors.OTHER_MAX_PRICE),
      other_unit: b.otherUnit === 'hours' || b.otherUnit === 'days' ? b.otherUnit : 'mins',
      other_draw: PORCHES.has(b.otherDraw) ? b.otherDraw : null,
      other_door: PORCHES.has(b.otherDraw) ? Math.max(1, Math.min(6, Math.floor(+b.otherDoor || 1))) : null,
    };
  } else if (b.kind === 'bay') {
    // A bay's own row: its shape is its type, and it has no size of its own
    // (its windows do).
    bayShape = BAY_SHAPES.has(b.bayShape) ? b.bayShape : 'canted';
    bayStoreys = +b.bayStoreys === 2 ? 2 : 1;
    type = bayShape; sizeTier = 'medium';
  } else {
    const types = b.kind === 'door' ? DOOR_TYPES : WINDOW_TYPES;
    const tiers = b.kind === 'door' ? DOOR_TIERS : WINDOW_TIERS;
    if (!types.has(type)) return { error: 'unknown ' + b.kind + ' type' };
    if (!tiers.has(sizeTier)) return { error: 'unknown size tier' };
  }
  const grid = v => Math.max(1, Math.min(8, Math.floor(+v || 1)));
  return {
    side: b.side,
    // Only the floors are numbered; the lower ground and the roof are 0.
    floor: level === 'standard' && b.kind !== 'other' ? Math.max(0, Math.min(5, Math.floor(+b.floor || 0))) : 0,
    level,
    kind: b.kind,
    position: Math.max(1, Math.floor(+b.position || 1)),
    bay_shape: bayShape,
    bay_storeys: bayStoreys,
    parent_opening_id: parent,
    panes_set: !!b.panesSet,
    nickname: String(b.nickname || '').trim().slice(0, 60) || null,
    type,
    size_tier: sizeTier,
    rows: grid(b.rows),
    // Only a sash has two sashes; and a bottom that matches the top is
    // stored as "same" so the two can't drift.
    rows_bottom: b.kind === 'window' && type === 'sash' && b.rowsBottom != null && grid(b.rowsBottom) !== grid(b.rows) ? grid(b.rowsBottom) : null,
    cols: grid(b.cols),
    prep_level: PREP.has(b.prepLevel) ? b.prepLevel : null,
    prep_stage: b.prepStage === 'variation' ? 'variation' : 'quote',
    quote_prep_level: PREP.has(b.quotePrepLevel) ? b.quotePrepLevel : null,
    prep_variation_id: b.prepStage === 'variation' && b.prepVariationId ? String(b.prepVariationId) : null,
    // Answered site steps (Windoors.prepSteps). Only a site change has any,
    // and a handful at most -- each one is a separate answered variation.
    prep_steps: b.prepStage === 'variation' && Array.isArray(b.prepSteps)
      ? b.prepSteps.filter(st => st && st.variation_id && PREP.has(st.level)).slice(0, 20)
          .map(st => ({ variation_id: String(st.variation_id).slice(0, 64), level: st.level }))
      : [],
    // An Other item's minutes are its own total: no access to set.
    access: b.kind === 'other' ? null : access,
    // An Other item is deleted rather than left out, so never excluded.
    excluded: b.kind !== 'other' && !!b.excluded,
    include_variation_id: b.kind !== 'other' && !b.excluded && b.includeVariationId ? String(b.includeVariationId) : null,
    ...other,
  };
}

// A tick's time, or null for unticked. A time the phone can't have meant
// (unparseable) still counts as ticked -- now.
function doneAt(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}
function normaliseMark(body) {
  const b = body || {};
  if (!b.openingId) return { error: 'openingId is required' };
  if (!b.elementId || !/^[a-z_]+(-\d+)?$/.test(String(b.elementId))) return { error: 'elementId is not a known element' };
  if (!ACTIONS.has(b.actionKey)) return { error: 'unknown action' };
  const stage = STAGES.has(b.stage) ? b.stage : 'quote';
  // Only a tiered action has a size; an unknown tier is refused rather than
  // quietly read as Medium, the same hard gate as everything else here.
  const tiered = Windoors.isTiered(b.actionKey);
  for (const k of ['sizeTier', 'agreedSizeTier']) {
    if (tiered && b[k] != null && b[k] !== '' && !REPAIR_TIERS.has(b[k])) return { error: 'unknown repair size' };
  }
  const tier = v => (tiered && REPAIR_TIERS.has(v) ? v : null);
  return {
    opening_id: String(b.openingId),
    element_id: String(b.elementId),
    action_key: b.actionKey,
    stage,
    variation_id: stage === 'variation' && b.variationId ? String(b.variationId) : null,
    done_at: doneAt(b.doneAt),
    size_tier: tier(b.sizeTier),
    agreed_size_tier: tier(b.agreedSizeTier),
    upgraded_at: tiered && b.upgradedAt ? doneAt(b.upgradedAt) : null,
  };
}

// Rows as the module wants them (snake_case keys -- the same names the spec
// uses, so public/windoors.js reads the table's own vocabulary).
function mapProperty(r) {
  if (!r) return null;
  return {
    style: r.style,
    appearance: r.appearance && typeof r.appearance === 'object' ? Windoors.normaliseAppearance(r.appearance, r.style) : null,
    detail_enabled: r.detail_enabled !== false, default_prep: r.default_prep || 'light', layout: r.layout || {},
    coats: r.coats == null ? 2 : +r.coats,
    window_colour: r.window_colour == null ? null : +r.window_colour,
    door_colour: r.door_colour == null ? null : +r.door_colour,
    paint_products: r.paint_products || {},
  };
}
function mapOpening(r) {
  return {
    id: r.id, side: r.side, floor: +r.floor || 0, level: r.level || 'standard', kind: r.kind, position: +r.position || 1,
    bay_shape: r.bay_shape || null, bay_storeys: r.bay_storeys == null ? null : +r.bay_storeys,
    parent_opening_id: r.parent_opening_id || null, panes_set: !!r.panes_set,
    nickname: r.nickname || null, type: r.type, size_tier: r.size_tier, rows: +r.rows || 1, cols: +r.cols || 1,
    rows_bottom: r.rows_bottom == null ? null : +r.rows_bottom,
    other_mins: r.other_mins == null ? null : +r.other_mins,
    other_cost: r.other_cost == null ? null : +r.other_cost,
    other_m2: r.other_m2 == null ? null : +r.other_m2,
    other_pricing: r.other_pricing === 'price' ? 'price' : (r.kind === 'other' ? 'time' : null),
    other_price: r.other_price == null ? null : +r.other_price,
    other_unit: r.other_unit || null,
    other_draw: r.other_draw || null, other_door: r.other_door == null ? null : +r.other_door,
    excluded: !!r.excluded, include_variation_id: r.include_variation_id || null,
    prep_level: r.prep_level || null, prep_stage: r.prep_stage || 'quote',
    quote_prep_level: r.quote_prep_level || null, prep_variation_id: r.prep_variation_id || null,
    prep_steps: Array.isArray(r.prep_steps) ? r.prep_steps : [],
    access: ACCESS.has(r.access) ? r.access : null,
  };
}
function mapMark(r) {
  return {
    id: r.id, opening_id: r.opening_id, element_id: r.element_id, action_key: r.action_key,
    stage: r.stage || 'quote', variation_id: r.variation_id || null, created_at: r.created_at,
    done_at: r.done_at || null,
    size_tier: r.size_tier || null,
    agreed_size_tier: r.agreed_size_tier || null,
    upgraded_at: r.upgraded_at || null,
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
    db.query('SELECT * FROM job_property WHERE job_id = $1', [jobId]),
    db.query('SELECT * FROM job_openings WHERE job_id = $1 ORDER BY side, level, floor, kind, position', [jobId]),
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
  normalisePaintProducts,
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
