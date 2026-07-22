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
-- ONE actual row per product per job: a tracking row is a PRODUCT, not an
-- estimate line. item_code is NOT unique within the snapshot (a colour band is
-- a PRICE band covering many colours, so two colours on one range yield two
-- estimate lines sharing item codes), so the estimate is rolled up by item_code
-- before joining. This index is the storage-level guarantee behind that.
-- Partial, because free-text rows have no code and must stay many-per-job.
CREATE UNIQUE INDEX IF NOT EXISTS material_actuals_job_item
  ON material_actuals (job_id, item_code) WHERE item_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS material_actuals_job ON material_actuals (job_id);

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

-- Tracks when the current (not-yet-archived) cycle began, so new-cycle can
-- compute started_at for the debt_plan_cycle_history row it writes.
ALTER TABLE debt_plan_settings ADD COLUMN IF NOT EXISTS cycle_started_at TIMESTAMP NOT NULL DEFAULT NOW();

-- Due-date push notifications (ntfy.sh) and the 28-day cycle-reset nudge,
-- both driven by the same daily cron job -- see lib/debtNotify.js.
ALTER TABLE debt_plan_settings ADD COLUMN IF NOT EXISTS notify_days_before INTEGER NOT NULL DEFAULT 3;
ALTER TABLE debt_plan_settings ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN NOT NULL DEFAULT true;

-- Multi-device conflict detection: each write endpoint compares the
-- client's last-known updated_at against the current value before writing,
-- and 409s (with the fresh row) if another device wrote in between.
ALTER TABLE debt_plan_debts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();
ALTER TABLE debt_plan_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();
ALTER TABLE debt_plan_cashflow ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

CREATE OR REPLACE FUNCTION debt_plan_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS debt_plan_debts_updated_at ON debt_plan_debts;
CREATE TRIGGER debt_plan_debts_updated_at
  BEFORE UPDATE ON debt_plan_debts
  FOR EACH ROW EXECUTE FUNCTION debt_plan_set_updated_at();

DROP TRIGGER IF EXISTS debt_plan_settings_updated_at ON debt_plan_settings;
CREATE TRIGGER debt_plan_settings_updated_at
  BEFORE UPDATE ON debt_plan_settings
  FOR EACH ROW EXECUTE FUNCTION debt_plan_set_updated_at();

DROP TRIGGER IF EXISTS debt_plan_cashflow_updated_at ON debt_plan_cashflow;
CREATE TRIGGER debt_plan_cashflow_updated_at
  BEFORE UPDATE ON debt_plan_cashflow
  FOR EACH ROW EXECUTE FUNCTION debt_plan_set_updated_at();

-- One row per completed cycle, written by POST /debt/api/new-cycle just
-- before it clears the income log and tick-list. Nothing is ever deleted
-- from this table -- it's the source for the History tab and (later) the
-- annual summary. debts_paid/debt_snapshot come from the client, since the
-- payoff simulation itself is client-side only (see debt-app-roadmap.md).
CREATE TABLE IF NOT EXISTS debt_plan_cycle_history (
  id SERIAL PRIMARY KEY,
  cycle_number INTEGER NOT NULL,
  started_at TIMESTAMP,
  closed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  total_income NUMERIC NOT NULL DEFAULT 0,
  total_paid NUMERIC NOT NULL DEFAULT 0,
  biz_pot_close NUMERIC NOT NULL DEFAULT 0,
  per_pot_close NUMERIC NOT NULL DEFAULT 0,
  debts_paid JSONB NOT NULL DEFAULT '[]',
  debt_snapshot JSONB NOT NULL DEFAULT '[]',
  notes TEXT
);

-- Standalone notes tab for informal short-term borrowing (people or named
-- savings pots). Purely informational -- no other table or endpoint reads
-- from this one. See Debt Management App/debt-app-borrowed-money.md.
CREATE TABLE IF NOT EXISTS debt_plan_borrowed (
  id SERIAL PRIMARY KEY,
  source_name TEXT NOT NULL,
  is_savings BOOLEAN NOT NULL DEFAULT FALSE,
  amount NUMERIC NOT NULL,
  note TEXT,
  borrowed_at DATE NOT NULL DEFAULT CURRENT_DATE,
  repaid BOOLEAN NOT NULL DEFAULT FALSE,
  repaid_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS debt_plan_borrowed_updated_at ON debt_plan_borrowed;
CREATE TRIGGER debt_plan_borrowed_updated_at
  BEFORE UPDATE ON debt_plan_borrowed
  FOR EACH ROW EXECUTE FUNCTION debt_plan_set_updated_at();

-- Web Push (debt app, Feature 4 extension): push straight to the installed
-- PWA, alongside ntfy. These tables are ALSO created lazily by
-- lib/debtPush.js on first use (this file is not run automatically on
-- deploy), so they're documented here for fresh installs rather than being
-- a required migration step. The VAPID keypair is generated server-side on
-- first use and persisted so subscriptions survive restarts; one
-- subscription row per enabled device.
CREATE TABLE IF NOT EXISTS debt_push_vapid (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  public_key TEXT NOT NULL,
  private_key TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS debt_push_subscriptions (
  id SERIAL PRIMARY KEY,
  endpoint TEXT UNIQUE NOT NULL,
  subscription JSONB NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
