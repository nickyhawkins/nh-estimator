# Debt Plan App — Claude Code Integration Handoff

## Context
I've built a debt management web app through conversation with Claude (claude.ai). It currently exists as a single self-contained HTML file. I want to integrate it into my existing project (already running on Render with a Node/Express backend and PostgreSQL database) as a second app alongside my paint estimator, served from the same server.

## Current stack (existing paint app)
- Node.js / Express backend
- PostgreSQL database (Render managed)
- Frontend served as HTML from Express routes
- Deployed on Render, connected via GitHub

## What needs to happen
1. Add a `/debt` route (or similar) that serves the debt plan app
2. Replace all `localStorage` calls in the frontend with API calls to new Express endpoints
3. Create the necessary PostgreSQL tables to persist the debt data
4. Keep the paint app completely unaffected — separate routes, namespaced tables

---

## The debt app — full feature spec

### What it does
A personal debt management tool that:
- Tracks 10 debts split between business and personal accounts
- Runs a two-phase payoff strategy: **arrears first (highest arrears balance first)**, then **snowball (smallest balance first)**
- Manages a cash flow cycle with a business pot and personal pot
- Logs income and splits it automatically between business pot, personal pot, savings, and living money
- Tick-off payment list per cycle with automatic pot drawdown
- Syncs real balances at the start of each new cycle
- Surplus detection — when all payments done and money left in pot, prompts to apply it to current target debt
- What-if calculator — shows months saved for lump sum or extra monthly payments
- Milestone celebrations — arrears cleared, 25/50/75% total debt cleared
- Tight week mode — when cycle income is low, shows MUST PAY / PAY SOON / CAN WAIT triage

### Data that needs to persist (currently in localStorage)

#### Debts table (`debt_plan_debts`)
Each debt has:
- `id` (integer, primary key — fixed IDs 2-11, no id 1)
- `name` (text)
- `balance` (numeric) — updated each sync cycle
- `apr` (numeric)
- `min` (numeric) — minimum monthly payment
- `arrears` (numeric) — overdue amount
- `due` (integer or null) — day of month payment is due
- `account` (text) — 'business' or 'personal'
- `note` (text)

Initial debt values (seed data):
```
id=2,  Currys,       balance=965.72,   apr=39.9, min=25,     arrears=0,        due=15, account=personal
id=3,  Natwest CC,   balance=1111.90,  apr=26.9, min=40.03,  arrears=0,        due=10, account=personal
id=4,  PayPal,       balance=2017.25,  apr=0,    min=93.44,  arrears=0,        due=11, account=personal
id=5,  Brewers,      balance=2200.89,  apr=0,    min=0,      arrears=2200.89,  due=1,  account=business
id=6,  Amex,         balance=4065.64,  apr=30.4, min=205,    arrears=65.64,    due=28, account=business
id=7,  Updraft,      balance=3583.81,  apr=17.9, min=264.66, arrears=793.98,   due=20, account=personal
id=8,  Bounce Back,  balance=7733.65,  apr=2.5,  min=182.08, arrears=177.48,   due=14, account=business
id=9,  NatWest Loan, balance=17122.68, apr=19,   min=520.01, arrears=2662.97,  due=15, account=personal
id=10, Van,          balance=20600,    apr=0,    min=400,    arrears=0,        due=null, account=business
id=11, HMRC,         balance=31510.32, apr=0,    min=0,      arrears=0,        due=null, account=business, note="Needs Time to Pay arrangement"
```

#### Settings table (`debt_plan_settings`)
Key-value pairs (or single row):
- `budget` (integer) — monthly debt target, default 2000
- `sweep_pct` (integer) — % of income swept to debt pots, default 50
- `savings_pct` (integer) — % of income swept to savings, default 10
- `tight_threshold` (integer) — tight week income threshold, default 600
- `last_milestone` (text) — last milestone key shown, default ''

#### Cash flow state table (`debt_plan_cashflow`)
Single row representing the current cycle:
- `biz_pot` (numeric) — current business pot balance
- `per_pot` (numeric) — current personal pot balance
- `savings_pot` (numeric) — running savings total (hidden from UI)
- `paid_this_cycle` (integer array or JSON) — array of debt IDs ticked off this cycle

#### Income log table (`debt_plan_income_log`)
One row per income entry, all cleared on new cycle start:
- `id` (serial)
- `amount` (numeric)
- `biz_amt` (numeric) — swept to business pot
- `per_amt` (numeric) — swept to personal pot
- `saved_amt` (numeric) — swept to savings
- `date` (text) — display date string e.g. "3 Jul"
- `created_at` (timestamp)

---

## API endpoints needed

```
GET  /debt/api/state          — returns all debts, settings, cashflow, income log in one payload
POST /debt/api/debts          — update debts array (full replace on sync)
POST /debt/api/settings       — update settings key/values
POST /debt/api/cashflow       — update pot balances and paid list
POST /debt/api/income         — add income log entry
DELETE /debt/api/income/:id   — delete income log entry
POST /debt/api/new-cycle      — clear income log + paid list, optionally update balances
```

---

## Frontend architecture

The frontend is currently one HTML file (~900 lines) with all JS inline. When integrating:

- Serve the HTML from `GET /debt`
- Replace all `localStorage.getItem/setItem` calls with `fetch()` calls to the API endpoints above
- The `persist()` function currently does all localStorage writes — replace it with debounced API calls or explicit save calls
- The `renderAll()` function drives the entire UI reactively from in-memory state — keep this pattern, just change how state is loaded (from API on page load) and saved (to API on change)
- On page load, fetch `/debt/api/state` and hydrate all state variables before calling `renderAll()`

### Key state variables to hydrate from API:
```javascript
let debts = [];           // from debt_plan_debts
let budget = 2000;        // from settings
let sweepPct = 50;        // from settings
let savingsPct = 10;      // from settings
let tightThreshold = 600; // from settings
let lastMilestone = '';   // from settings
let bizPot = 0;           // from cashflow
let perPot = 0;           // from cashflow
let savingsPot = 0;       // from cashflow
let paidThisCycle = [];   // from cashflow
let incomeLog = [];        // from income_log table
let view = 'cashflow';    // UI only, not persisted
let selectedMonth = 1;    // UI only, not persisted
let editDraft = {};        // UI only, not persisted
let syncDraft = {};        // UI only, not persisted
```

---

## Simulation logic (pure JS, keep as-is)

The core simulation runs entirely client-side — no need to move it to the backend. Keep these functions exactly as they are:
- `simulate(debts, budget)` — runs month-by-month payoff projection
- `getCyclePayments()` — derives this cycle's payment list from month 1 of simulation
- `getCurrentTarget()` — finds the current arrears/snowball target debt
- `getMilestones(months)` — finds payoff month for each debt
- `getMonthLabel(m, short)` — converts month number to label (starts July 2026)

---

## Styling / design
- Dark theme: background `#0f1117`, cards `#1a1d2e`, borders `#2a2d3e`
- Accent colours: blue `#5b8def`, green `#7db87d`, orange `#e0923b`, red `#e05c5c`
- Font: system `-apple-system, 'Inter', 'Segoe UI', sans-serif`
- Mobile-first, designed for iPhone Safari / home screen PWA
- Apple touch icon embedded as base64 PNG (snowball icon, dark background)
- `<meta name="apple-mobile-web-app-capable" content="yes">` for standalone mode

---

## Tabs / views
1. **Cash Flow** (home) — pots, log money in, tick-list, tight week triage, surplus prompt, income log, sweep settings
2. **What If?** — lump sum calculator, extra monthly slider, quick comparison table
3. **Schedule** — month-by-month payment breakdown with phase indicator, navigable by month
4. **Milestones** — debt payoff timeline
5. **Edit Debts** — editable fields for all debts including account (business/personal) assignment
6. **All Debts** — read-only overview

---

## Deployment notes
- Single user app (personal use only) — no auth needed unless you want to add it later
- The HTML file to use as the starting point is attached / in this conversation
- Tables should be namespaced with `debt_plan_` prefix to avoid clashing with paint app tables
- Render free tier Postgres is fine — data volume is tiny
- If the paint app already has a db connection pool set up, reuse it for the debt app routes

---

## What to build first (suggested order)
1. Create the PostgreSQL tables with seed data
2. Add the Express routes (`/debt` serving HTML, `/debt/api/*` for data)
3. Update the frontend to load state from API on init, save on change
4. Test the full cycle: load → log income → tick payments → new cycle → balances update
5. Deploy and verify data persists across sessions and devices

