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
