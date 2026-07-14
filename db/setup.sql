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

-- ── Debt Management App ─────────────────────────────────────────────────
-- Fully separate personal debt-tracking tool, served from /debt, sharing
-- only this Postgres instance with the paint app. Tables are namespaced
-- debt_plan_ so they can never collide with the paint app's schema above.
-- Single-user, so settings/cashflow are single fixed-id rows rather than
-- per-user or per-job scoped.

CREATE TABLE IF NOT EXISTS debt_plan_debts (
  id INTEGER PRIMARY KEY,
  name VARCHAR NOT NULL,
  balance NUMERIC NOT NULL DEFAULT 0,
  apr NUMERIC NOT NULL DEFAULT 0,
  min NUMERIC NOT NULL DEFAULT 0,
  arrears NUMERIC NOT NULL DEFAULT 0,
  due INTEGER,
  account VARCHAR NOT NULL DEFAULT 'personal',
  note VARCHAR NOT NULL DEFAULT ''
);
INSERT INTO debt_plan_debts (id, name, balance, apr, min, arrears, due, account, note) VALUES
  (2,  'Currys',       965.72,   39.9, 25,     0,        15,   'personal', 'Est. figures'),
  (3,  'Natwest CC',   1111.90,  26.9, 40.03,  0,        10,   'personal', ''),
  (4,  'PayPal',       2017.25,  0,    93.44,  0,        11,   'personal', '0% interest'),
  (5,  'Brewers',      2200.89,  0,    0,      2200.89,  1,    'business', 'Trade account — full balance in arrears'),
  (6,  'Amex',         4065.64,  30.4, 205,    65.64,    28,   'business', ''),
  (7,  'Updraft',      3583.81,  17.9, 264.66, 793.98,   20,   'personal', ''),
  (8,  'Bounce Back',  7733.65,  2.5,  182.08, 177.48,   14,   'business', ''),
  (9,  'NatWest Loan', 17122.68, 19,   520.01, 2662.97,  15,   'personal', ''),
  (10, 'Van',          20600,    0,    400,    0,        NULL, 'business', 'Family loan — low priority'),
  (11, 'HMRC',         31510.32, 0,    0,      0,        NULL, 'business', 'Needs Time to Pay arrangement')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS debt_plan_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  budget INTEGER NOT NULL DEFAULT 2000,
  sweep_pct INTEGER NOT NULL DEFAULT 50,
  savings_pct INTEGER NOT NULL DEFAULT 10,
  tight_threshold INTEGER NOT NULL DEFAULT 600,
  last_milestone VARCHAR NOT NULL DEFAULT ''
);
INSERT INTO debt_plan_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS debt_plan_cashflow (
  id INTEGER PRIMARY KEY DEFAULT 1,
  biz_pot NUMERIC NOT NULL DEFAULT 0,
  per_pot NUMERIC NOT NULL DEFAULT 0,
  savings_pot NUMERIC NOT NULL DEFAULT 0,
  paid_this_cycle JSONB NOT NULL DEFAULT '[]'
);
INSERT INTO debt_plan_cashflow (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS debt_plan_income_log (
  id SERIAL PRIMARY KEY,
  amount NUMERIC NOT NULL,
  biz_amt NUMERIC NOT NULL DEFAULT 0,
  per_amt NUMERIC NOT NULL DEFAULT 0,
  saved_amt NUMERIC NOT NULL DEFAULT 0,
  date VARCHAR NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
