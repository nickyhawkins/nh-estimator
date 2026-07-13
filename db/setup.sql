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
