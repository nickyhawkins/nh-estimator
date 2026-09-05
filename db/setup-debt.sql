-- ── Debt Management App ─────────────────────────────────────────────────
-- Fully separate personal debt-tracking tool, served from /debt, sharing
-- only this Postgres instance with the paint app.
--
-- ONLY run this on an instance that sets DEBT_APP_ENABLED=true (the
-- owner's personal instance). Customer instances (see
-- MULTI_INSTANCE_PILOT_SPEC.md) get db/setup.sql alone — the seed data
-- below is personal and must never reach another database. Tables are namespaced
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

-- Debt ids deliberately skipped this cycle (mirror of paid_this_cycle's
-- tick-list). A missed debt is excluded from the cycle's payment totals and
-- the sweep split, and the ids are archived into cycle_history.notes as
-- {"missed":[ids]} when the cycle closes. ALSO applied lazily by
-- routes/debt.js on first API request (this file is not run on deploy),
-- same as the debt_push_* tables below.
ALTER TABLE debt_plan_cashflow ADD COLUMN IF NOT EXISTS missed_this_cycle JSONB NOT NULL DEFAULT '[]';

-- Soft-delete for debts: debt_plan_cycle_history's debt_snapshot/debts_paid
-- reference debt ids from past cycles, so a cleared (or abandoned) debt is
-- archived rather than deleted — hidden from every live view, row and
-- history intact. ALSO applied lazily by routes/debt.js, like
-- missed_this_cycle above.
ALTER TABLE debt_plan_debts ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE;

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
  -- Borrowing from one of the app's OWN pots (v2.60.0): 'biz', 'per',
  -- 'savings', 'bufferBiz' or 'bufferPer'. NULL is the tab's original
  -- meaning -- a note about money owed to a person, which moves nothing.
  -- A pot loan takes the money out of that pot when it is logged and is put
  -- back off the top of the next pay-in, so repaid_amount tracks part
  -- repayments: a pay-in too small to clear it repays what it can.
  pot TEXT,
  repaid_amount NUMERIC NOT NULL DEFAULT 0,
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

-- ── RETIRED (v2.57.0): Floor & Target payments ──────────────────────────
-- floor_payment and floor_shortfalls are no longer read or written by the
-- app. Across the whole live plan the floor was set equal to the contractual
-- minimum on every debt but one, and never above it — it never said anything
-- `min` did not already say, while costing a second verdict, a payment state,
-- a priority order and a catch-up ledger. What it was invented for (a light
-- month shouldn't read as a failed one) is now done by the month-ahead buffer,
-- with money rather than relabelling.
--
-- The columns are LEFT IN PLACE, unwritten, so the change is reversible and no
-- history is destroyed. floor_paid_this_cycle is still written: it holds the
-- "paid the minimum only" tick-list, which survived the removal — renaming a
-- column to rename a concept is not worth a migration.
--
-- Original note follows.
-- ── Floor & Target payments ─────────────────────────────────────────────
-- Each debt carries two numbers: the TARGET (the plan's payment, driven by
-- `min` + the monthly budget, unchanged) and a FLOOR — the minimum committed
-- payment sized to a worst-case income month, which is the number creditors
-- are told. A cycle is judged on both, so a light month that still meets
-- every floor is "on track" rather than a failed month.
--
-- floor_payment is deliberately NULLABLE: NULL means "no floor agreed yet"
-- (Brewers' arrears-only trade account, HMRC pre-Time-to-Pay), which keeps
-- those debts out of the floors check instead of inventing a commitment for
-- them. The backfill seeds every existing floor from its contractual minimum
-- and runs EXACTLY ONCE — inside the not-exists guard — so clearing a floor
-- back to "not set" in the app isn't undone by the next deploy.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'debt_plan_debts' AND column_name = 'floor_payment'
  ) THEN
    ALTER TABLE debt_plan_debts ADD COLUMN floor_payment NUMERIC;
    UPDATE debt_plan_debts SET floor_payment = min WHERE min > 0;
  END IF;
END $$;

-- Cash cushion filled BEFORE any debt allocation (see allocateIncome() in
-- public/debt.html). buffer_target 0 = feature off, which is the default:
-- turning it on diverts real money, so it's the user's choice, not a guess.
-- LEGACY: one undifferentiated jar. Superseded by the per-account pair
-- below, which is what the app now reads and writes; these two columns are
-- kept, unwritten, so the split can be rolled back without losing the money.
ALTER TABLE debt_plan_settings ADD COLUMN IF NOT EXISTS buffer_target NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE debt_plan_cashflow ADD COLUMN IF NOT EXISTS buffer_pot NUMERIC NOT NULL DEFAULT 0;

-- ── A month ahead: the buffer, split by account ─────────────────────────
-- The point of the buffer is to hold one month of CONTRACTUAL MINIMUMS, so a
-- light month pays them out of stored cash instead of putting them into
-- arrears. (Minimums, not floors: a missed floor writes an inert catch-up
-- ledger entry, a missed minimum is money genuinely overdue.)
--
-- It has to be two jars, because bizPot and perPot are two real bank
-- accounts and neither can rescue the other -- a £905 personal cushion does
-- nothing for a £387 business minimum. The single-jar migration puts every
-- legacy penny on the PERSONAL side, which is where it physically was: the
-- Log-money-in modal's transfer panel has always routed the buffer to the
-- personal account alongside savings and living money.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'debt_plan_cashflow' AND column_name = 'buffer_per'
  ) THEN
    ALTER TABLE debt_plan_cashflow ADD COLUMN buffer_biz NUMERIC NOT NULL DEFAULT 0;
    ALTER TABLE debt_plan_cashflow ADD COLUMN buffer_per NUMERIC NOT NULL DEFAULT 0;
    UPDATE debt_plan_cashflow SET buffer_per = buffer_pot;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'debt_plan_settings' AND column_name = 'buffer_target_per'
  ) THEN
    ALTER TABLE debt_plan_settings ADD COLUMN buffer_target_biz NUMERIC NOT NULL DEFAULT 0;
    ALTER TABLE debt_plan_settings ADD COLUMN buffer_target_per NUMERIC NOT NULL DEFAULT 0;
    UPDATE debt_plan_settings SET buffer_target_per = buffer_target;
  END IF;
END $$;

-- Per-debt floor shortfalls carried across cycles: [{id,name,amount,since}].
-- Written when a cycle closes with a floor unmet, and only ever cleared by an
-- explicit user action ("Catch up" or "Clear") — a shortfall is NEVER rolled
-- into the next cycle's required payment on its own.
ALTER TABLE debt_plan_cashflow ADD COLUMN IF NOT EXISTS floor_shortfalls JSONB NOT NULL DEFAULT '[]';

-- The third state a cycle payment can be in: floor paid, target not. Without
-- it the two verdicts could never diverge — every payment is all-or-nothing —
-- and "floors met, target missed" is exactly the month this feature exists
-- to stop treating as a failure. Mutually exclusive with paid_this_cycle and
-- missed_this_cycle; cleared with them when a cycle closes.
ALTER TABLE debt_plan_cashflow ADD COLUMN IF NOT EXISTS floor_paid_this_cycle JSONB NOT NULL DEFAULT '[]';

-- Buffer allocations are logged alongside the pot splits so deleting an
-- income entry can reverse the buffer top-up too. buffer_amt is the legacy
-- total, still written so an older client reading the row sees the whole
-- top-up; the two per-account columns are what a delete actually reverses.
ALTER TABLE debt_plan_income_log ADD COLUMN IF NOT EXISTS buffer_amt NUMERIC NOT NULL DEFAULT 0;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'debt_plan_income_log' AND column_name = 'buffer_per_amt'
  ) THEN
    ALTER TABLE debt_plan_income_log ADD COLUMN buffer_biz_amt NUMERIC NOT NULL DEFAULT 0;
    ALTER TABLE debt_plan_income_log ADD COLUMN buffer_per_amt NUMERIC NOT NULL DEFAULT 0;
    UPDATE debt_plan_income_log SET buffer_per_amt = buffer_amt;
  END IF;
END $$;

-- Ledger of what each live "paid"/"floor" tick took off a balance this cycle,
-- keyed by debt id -- ticking a payment now applies it to the debt straight
-- away, which is what lets balances and arrears move between balance syncs:
--   { "9": { "name": "NatWest Loan", "nominal": 778.72, "snowball": false,
--            "amount": 778.72, "arrearsAmt": 258.71, "potAmt": 778.72 } }
-- `nominal` is the figure displayed and archived to history; the other three
-- are what an un-tick puts back (they differ from the payment whenever the
-- arrears clamp bites or the pot held less than the payment). Cleared with
-- the tick-lists when a cycle closes. ALSO applied lazily by routes/debt.js.
ALTER TABLE debt_plan_cashflow ADD COLUMN IF NOT EXISTS applied_payments JSONB NOT NULL DEFAULT '{}';

-- Stamped the first time the automatic cycle roller (lib/debtCycle.js) runs
-- against this database. NULL means it has never run, and that first run is a
-- grace: the cycle open at that moment predates the roller and has been
-- reconciled by hand, so it adopts the date and closes nothing. ALSO applied
-- lazily, by lib/debtCycle.js itself rather than routes/debt.js -- the 8am
-- cron can roll before any API request has been served.
ALTER TABLE debt_plan_settings ADD COLUMN IF NOT EXISTS auto_roll_started_at TIMESTAMP;

-- Borrowing from one of the app's own pots (v2.60.0). See the pot/repaid_amount
-- columns on debt_plan_borrowed above; these are the lazy migrations for a
-- database that already has the table, ALSO applied by routes/debt.js.
ALTER TABLE debt_plan_borrowed ADD COLUMN IF NOT EXISTS pot TEXT;
ALTER TABLE debt_plan_borrowed ADD COLUMN IF NOT EXISTS repaid_amount NUMERIC NOT NULL DEFAULT 0;

-- What a pay-in put back into which pot, kept on the income row so deleting
-- that row undoes the repayment as well as the allocation:
--   { "total": 200, "byPot": { "savings": 200 }, "loans": [ { "id": 4, "amount": 200 } ] }
-- NULL on every pay-in that repaid nothing, which is most of them.
ALTER TABLE debt_plan_income_log ADD COLUMN IF NOT EXISTS pot_repay JSONB;
