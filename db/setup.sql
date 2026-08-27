-- Jobs table: makes a job first-class so the app can hold more than one
-- at a time. rooms/exterior_items/colours/materials_snapshot below all
-- carry a job_id and belong to exactly one job. Fully separate jobs, no
-- duplicate-as-template. settings/colour_library stay global (no job_id).
CREATE TABLE IF NOT EXISTS jobs (
  id VARCHAR PRIMARY KEY,
  name VARCHAR NOT NULL,
  data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
INSERT INTO jobs (id, name) VALUES ('default', 'My Job') ON CONFLICT DO NOTHING;

-- Sessions table (for express-session)
CREATE TABLE IF NOT EXISTS session (
  sid VARCHAR NOT NULL COLLATE "default",
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL,
  CONSTRAINT session_pkey PRIMARY KEY (sid)
);
CREATE INDEX IF NOT EXISTS IDX_session_expire ON session(expire);

-- Settings table
CREATE TABLE IF NOT EXISTS settings (
  id SERIAL PRIMARY KEY,
  data JSONB NOT NULL DEFAULT '{}',
  xero_token JSONB,
  xero_tenant_id VARCHAR,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Insert default settings row
INSERT INTO settings (data) VALUES ('{}') ON CONFLICT DO NOTHING;

-- Rooms table
CREATE TABLE IF NOT EXISTS rooms (
  id VARCHAR PRIMARY KEY,
  name VARCHAR NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS job_id VARCHAR;
UPDATE rooms SET job_id = 'default' WHERE job_id IS NULL;
ALTER TABLE rooms ALTER COLUMN job_id SET NOT NULL;

-- HSL state table
CREATE TABLE IF NOT EXISTS hsl_state (
  id SERIAL PRIMARY KEY,
  data JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO hsl_state (data) VALUES ('{}') ON CONFLICT DO NOTHING;

-- Exterior items table (mirrors rooms structure)
CREATE TABLE IF NOT EXISTS exterior_items (
  id VARCHAR PRIMARY KEY,
  label VARCHAR NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
ALTER TABLE exterior_items ADD COLUMN IF NOT EXISTS job_id VARCHAR;
UPDATE exterior_items SET job_id = 'default' WHERE job_id IS NULL;
ALTER TABLE exterior_items ALTER COLUMN job_id SET NOT NULL;

-- Colours table (job-scoped list of {number, label, brand, code}, same
-- lifecycle as rooms/exterior_items — not a permanent setting, cleared
-- with the job). brand/code are filled from the colour_library below,
-- either via autocomplete match or after saving a new library entry.
CREATE TABLE IF NOT EXISTS colours (
  number INTEGER PRIMARY KEY,
  label VARCHAR NOT NULL DEFAULT '',
  brand VARCHAR NOT NULL DEFAULT '',
  code VARCHAR NOT NULL DEFAULT '',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
ALTER TABLE colours ADD COLUMN IF NOT EXISTS brand VARCHAR NOT NULL DEFAULT '';
ALTER TABLE colours ADD COLUMN IF NOT EXISTS code VARCHAR NOT NULL DEFAULT '';

-- job_id makes `number` unique per-job rather than globally unique, so
-- the old single-column PK has to go. Postgres has no
-- "ADD CONSTRAINT IF NOT EXISTS", so swapping to a composite PK isn't
-- safely re-runnable -- drop the PK and use a unique index instead,
-- since both DROP CONSTRAINT IF EXISTS and CREATE UNIQUE INDEX IF NOT
-- EXISTS are idempotent.
ALTER TABLE colours ADD COLUMN IF NOT EXISTS job_id VARCHAR;
UPDATE colours SET job_id = 'default' WHERE job_id IS NULL;
ALTER TABLE colours ALTER COLUMN job_id SET NOT NULL;
ALTER TABLE colours DROP CONSTRAINT IF EXISTS colours_pkey;
CREATE UNIQUE INDEX IF NOT EXISTS colours_job_number_uniq ON colours(job_id, number);

-- Colour reference library: global and permanent, NOT job-scoped and NOT
-- cleared by Clear Rooms/Clear Everything (more like settings than a job
-- record). Seeded once with the Farrow & Ball and Little Greene full
-- ranges (see db/seed-colour-library.js); grows over time as unmatched
-- colours are saved on first use from the Colours tab. See FEATURES.md.
CREATE TABLE IF NOT EXISTS colour_library (
  id SERIAL PRIMARY KEY,
  name VARCHAR NOT NULL,
  brand VARCHAR NOT NULL,
  code VARCHAR NOT NULL DEFAULT '',
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(name, brand)
);

-- Materials snapshot table (job-scoped, editable list of priced material
-- lines for the current quote -- same lifecycle as rooms/exterior_items,
-- not a permanent setting. Populated by "recalculate from rooms", then
-- edited/deleted/added-to as a frozen snapshot until explicitly
-- recalculated again. See MATERIALS_SPEC.md.)
CREATE TABLE IF NOT EXISTS materials_snapshot (
  id VARCHAR PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
ALTER TABLE materials_snapshot ADD COLUMN IF NOT EXISTS job_id VARCHAR;
UPDATE materials_snapshot SET job_id = 'default' WHERE job_id IS NULL;
ALTER TABLE materials_snapshot ALTER COLUMN job_id SET NOT NULL;

-- Material actuals (job-scoped log of what was really bought and used, as
-- opposed to materials_snapshot's estimate of what SHOULD be needed).
-- See MATERIAL_TRACKING_SPEC.md.
--
-- THIS TABLE IS THE INVOICE. Materials go on the quote as an estimate and the
-- client is billed for what was actually used, so these quantities are the
-- input to the bill -- not a reconciliation note. Two consequences that look
-- like inconsistencies with the rest of the schema and are deliberate:
--
-- 1. NOT a `data JSONB` blob, unlike rooms/exterior_items/materials_snapshot.
--    Those get round-tripped whole (write the blob, read the blob). This one
--    gets QUERIED -- Phase 3 aggregates quantities and margin across jobs,
--    which over JSONB means (data->>'actual_quantity')::numeric casts and no
--    real index on the join key. Don't "fix" the inconsistency.
--
-- 2. Deliberately NOT hung off materials_snapshot line ids.
--    recalculateMaterialsSnapshot() is a full overwrite that regenerates
--    id: uid() for every line on every run, and recalculating is a normal
--    action (rooms changed -> re-pull materials). Anything keyed on those ids
--    would orphan on the first recalc mid-job -- silently destroying the
--    invoice. item_code is stable across recalcs; line ids are not.
CREATE TABLE IF NOT EXISTS material_actuals (
  id VARCHAR PRIMARY KEY,
  job_id VARCHAR NOT NULL,
  item_code VARCHAR,            -- Xero item code; NULL for free-text entries
  description VARCHAR NOT NULL, -- denormalised so free-text entries, and items
                                -- later recoded in Xero, still read properly
  actual_quantity NUMERIC NOT NULL DEFAULT 0,
  unit_amount NUMERIC,          -- only for free-text rows, which have no Xero
                                -- 202 price to derive from; NULL otherwise so
                                -- real items always price from live Xero data
  bought BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
-- Which job colour (see the colours table above) a row not on the estimate
-- was bought for. Only meaningful on rows added from the On Site tab's own
-- "Add material" form (onEstimate: false client-side) -- a row pulled from
-- the estimate is one PRODUCT and can legitimately cover more than one
-- colour (see the big comment on material_actuals_job_item below), so it
-- keeps its existing read-only, auto-derived colour breakdown instead.
ALTER TABLE material_actuals ADD COLUMN IF NOT EXISTS colour_number INTEGER;
-- ONE actual row per product per job: a tracking row is a PRODUCT, not an
-- estimate line. item_code is NOT unique within the snapshot (a colour band is
-- a PRICE band covering many colours, so two colours on one range yield two
-- estimate lines sharing item codes), so the estimate is rolled up by item_code
-- before joining. This index is the storage-level guarantee behind that.
-- Partial, because free-text rows have no code and must stay many-per-job.
CREATE UNIQUE INDEX IF NOT EXISTS material_actuals_job_item
  ON material_actuals (job_id, item_code) WHERE item_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS material_actuals_job ON material_actuals (job_id);

-- Labour log (job-scoped, one row per DATE on site) -- the labour half of
-- actuals, alongside material_actuals' materials half. See
-- CALIBRATION_SPEC.md Phase A. Columns not JSONB for the same reason as
-- material_actuals: Phase C aggregates days across jobs, which over JSONB
-- means casts and no usable index. Don't "fix" the inconsistency.
--
-- days is PERSON-days at the one day-rate: 1 = a full day, 0.5 = a half
-- day, 2 = two people all day. Matches how settings.dr prices labour.
CREATE TABLE IF NOT EXISTS labour_log (
  id VARCHAR PRIMARY KEY,
  job_id VARCHAR NOT NULL,
  work_date DATE NOT NULL,
  days NUMERIC NOT NULL DEFAULT 1,
  note VARCHAR NOT NULL DEFAULT '',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
-- ONE row per job per date: tapping "+ Log today" twice must edit the
-- existing day, never create a duplicate that double-counts it. The PUT
-- upserts on this index, same pattern as material_actuals_job_item.
CREATE UNIQUE INDEX IF NOT EXISTS labour_log_job_date ON labour_log (job_id, work_date);
CREATE INDEX IF NOT EXISTS labour_log_job ON labour_log (job_id);


-- ── Accepted-quote snapshots ────────────────────────────────────────────
-- THE AGREED FIGURES. Everything else in this schema stores INPUTS (room
-- dimensions, toggles, material lines) that the app re-prices from the
-- current Rates page every time it renders. That is right for a draft and
-- catastrophic for an accepted quote: change a coverage rate or a labour
-- constant and every quote the client already signed silently re-prices
-- itself, invoiced jobs included. This table is the fix -- the calc
-- pipeline is run ONCE at acceptance and its whole output serialised here,
-- and from that moment the accepted view/PDF/final invoice read this row
-- instead of the calc functions.
--
-- Three properties are the whole point, and none of them is decoration:
--
-- 1. APPEND-ONLY. There is no UPDATE and no DELETE path anywhere in the app
--    (routes/api.js exposes GET and POST only, and the POST is a bare
--    INSERT). Amending an accepted quote writes a NEW row at version + 1;
--    the superseded row stays exactly as written, which is what makes the
--    history auditable rather than merely retained.
-- 2. A TABLE, not another key on jobs.data. jobs.data is PUT-merged whole
--    on every status change, note edit and schedule tweak -- a snapshot
--    living there would be one careless spread away from being rewritten
--    by a caller that had no idea it was carrying it. Separate rows can
--    only be written by the one route that writes them.
-- 3. SELF-CONTAINED. data holds the finished line items, prices and totals,
--    NOT ids pointing at rooms/materials_snapshot rows that will be edited,
--    recalculated or deleted later in the job's life. A snapshot must still
--    render correctly after the job it came from has been rebuilt.
--
-- reconciliation_level distinguishes a snapshot captured by the app at the
-- moment of acceptance ('full') from one rebuilt after the fact by
-- scripts/migrate-accepted-snapshots.js out of Xero export figures --
-- 'xero_lines' where Xero had the itemised detail, 'totals_only' where it
-- had nothing but a total. The last of those is honest about being a
-- reconstruction and the UI says so; it is still infinitely better than
-- re-deriving the figures from today's rates.
CREATE TABLE IF NOT EXISTS quote_snapshots (
  id VARCHAR PRIMARY KEY,
  job_id VARCHAR NOT NULL,
  version INTEGER NOT NULL,
  accepted_at TIMESTAMP NOT NULL DEFAULT NOW(),
  reconciliation_level VARCHAR NOT NULL DEFAULT 'full',
  note VARCHAR NOT NULL DEFAULT '',
  data JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
-- One row per revision per job. The POST derives version from MAX+1 inside
-- the same statement, so this index is the storage-level guarantee that two
-- devices accepting at once can't both claim v1 -- the loser gets a 409 and
-- retries, rather than silently overwriting the winner.
CREATE UNIQUE INDEX IF NOT EXISTS quote_snapshots_job_version
  ON quote_snapshots (job_id, version);
CREATE INDEX IF NOT EXISTS quote_snapshots_job ON quote_snapshots (job_id);

-- ── Shopping list ───────────────────────────────────────────────────────
-- The Price Lookup screen's companion: a flat, GLOBAL list (not job-scoped
-- -- a shop run buys for whatever's on) of things to pick up. Rows come from
-- either a Price Lookup result ("Add to list": name/code/inc-VAT price
-- copied in at add time -- a snapshot, deliberately not re-priced later) or
-- free text ("+ Add item": masking tape, a specific brush -- no code, NULL
-- price). Nothing here touches Xero. Ticked rows stay until "Clear ticked"
-- so the list shows what's already in the trolley mid-shop. Client-generated
-- ids + per-row PUT upsert, same contract as labour_log/material_actuals.
CREATE TABLE IF NOT EXISTS shopping_list (
  id VARCHAR PRIMARY KEY,
  name VARCHAR NOT NULL,
  item_code VARCHAR NOT NULL DEFAULT '',
  price NUMERIC,                          -- inc VAT; NULL = free-text item, no price
  ticked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
-- Source-job names (e.g. ["Ermine Street"]) for rows added from a job's
-- materials list, so mid-shop the list says WHY a tin is on it. Metadata
-- only -- the list itself stays one flat, global list, never fragmented
-- into per-job views. Job NAMES, not ids, snapshotted at add time: the
-- tag must still read after the job is renamed/deleted, and it's display-
-- only so nothing joins on it. Adding an already-listed item (same code,
-- or same free-text name) from another job appends its tag to the
-- existing row rather than duplicating the line.
ALTER TABLE shopping_list ADD COLUMN IF NOT EXISTS job_tags JSONB NOT NULL DEFAULT '[]';

-- Debt Management App tables live in db/setup-debt.sql — run that file
-- ONLY on an instance with DEBT_APP_ENABLED=true (it contains personal
-- seed data). See MULTI_INSTANCE_PILOT_SPEC.md WS2.
